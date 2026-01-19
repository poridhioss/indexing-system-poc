import { Hono, Context } from 'hono';
import type {
    Env,
    Variables,
    IndexSyncRequest,
    IndexSyncPhase1Request,
    IndexSyncPhase2Request,
    IndexSyncPhase1Response,
    IndexSyncPhase2Response,
    ErrorResponse,
    ChunkMetadata,
} from '../types';
import { setMerkleRoot } from '../lib/kv-store';
import { generateSummaries, generateEmbeddings } from '../lib/ai';
import { upsertChunks } from '../lib/vectorize';
import {
    getManyCachedEmbeddings,
    setManyCachedEmbeddings,
} from '../lib/embedding-cache';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const indexSync = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Check if an embedding is a zero vector (fallback from failed AI)
 */
function isZeroVector(embedding: number[]): boolean {
    return embedding.every((v) => v === 0);
}

/**
 * POST /v1/index/sync
 *
 * Two-phase sync protocol for efficient updates.
 *
 * Phase 1: Client sends chunk metadata (no code)
 *          Server checks embedding cache, upserts HITs to Vectorize,
 *          returns which hashes need code (cache misses)
 *
 * Phase 2: Client sends code only for needed chunks
 *          Server generates summaries/embeddings, caches them,
 *          and upserts to Vectorize
 */
indexSync.post('/', async (c) => {
    const userId = c.get('userId');

    // Parse request body
    let body: IndexSyncRequest;
    try {
        body = await c.req.json<IndexSyncRequest>();
    } catch {
        const error: ErrorResponse = {
            error: 'Bad Request',
            message: 'Invalid JSON body',
        };
        return c.json(error, 400);
    }

    // Validate required fields
    if (!body.projectId) {
        const error: ErrorResponse = {
            error: 'Bad Request',
            message: 'projectId is required',
        };
        return c.json(error, 400);
    }

    if (!body.merkleRoot) {
        const error: ErrorResponse = {
            error: 'Bad Request',
            message: 'merkleRoot is required',
        };
        return c.json(error, 400);
    }

    if (body.phase !== 1 && body.phase !== 2) {
        const error: ErrorResponse = {
            error: 'Bad Request',
            message: 'phase must be 1 or 2',
        };
        return c.json(error, 400);
    }

    if (!body.chunks || !Array.isArray(body.chunks)) {
        const error: ErrorResponse = {
            error: 'Bad Request',
            message: 'chunks array is required',
        };
        return c.json(error, 400);
    }

    // Handle Phase 1: Check embedding cache, upsert HITs
    if (body.phase === 1) {
        return handlePhase1(c, body as IndexSyncPhase1Request, userId);
    }

    // Handle Phase 2: AI process misses, upsert to Vectorize
    return handlePhase2(c, body as IndexSyncPhase2Request, userId);
});

/**
 * Phase 1: Check embedding cache, upsert HITs to Vectorize, return needed hashes
 *
 * New design:
 * - Check embedding cache for all chunk hashes
 * - For HITs: Upsert to Vectorize immediately with user's metadata
 * - Return needed hashes (misses) so client only sends code for those
 */
async function handlePhase1(
    c: AppContext,
    body: IndexSyncPhase1Request,
    userId: string
) {
    const { projectId, merkleRoot, chunks } = body;

    console.log(`[Sync P1] Processing ${chunks.length} chunks for project ${projectId}`);

    // Step 1: Check embedding cache for all hashes
    const hashes = chunks.map((chunk) => chunk.hash);
    const cacheResults = await getManyCachedEmbeddings(c.env.INDEX_KV, hashes);

    // Step 2: Separate HITs vs MISSes
    const hits: Array<{
        chunk: (typeof chunks)[0];
        summary: string;
        embedding: number[];
    }> = [];
    const needed: string[] = [];

    for (const chunk of chunks) {
        const cached = cacheResults.get(chunk.hash);
        if (cached) {
            hits.push({
                chunk,
                summary: cached.summary,
                embedding: cached.embedding,
            });
        } else {
            needed.push(chunk.hash);
        }
    }

    console.log(`[Sync P1] Cache hits: ${hits.length}, Cache misses: ${needed.length}`);

    // Step 3: Upsert HITs to Vectorize immediately
    if (hits.length > 0) {
        const vectorizeChunks = hits.map(({ chunk, summary, embedding }) => ({
            hash: chunk.hash,
            embedding,
            metadata: {
                projectId,
                userId,
                summary,
                type: chunk.type,
                name: chunk.name,
                languageId: chunk.languageId,
                lines: chunk.lines,
                charCount: chunk.charCount,
                filePath: chunk.filePath,
            } as ChunkMetadata,
        }));

        console.log(`[Sync P1] Upserting ${vectorizeChunks.length} cached vectors to Vectorize`);
        const vectorsStored = await upsertChunks(c.env.VECTORIZE, vectorizeChunks);

        if (vectorsStored < vectorizeChunks.length) {
            console.warn(
                `[Sync P1] ${vectorizeChunks.length - vectorsStored} cached embeddings were zero vectors (skipped)`
            );
        }
    }

    // Step 4: Store merkle root
    await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);

    // Step 5: Return needed hashes
    const response: IndexSyncPhase1Response = {
        needed,
        vectorized: hits.length,
        cacheHits: hits.length,
    };

    return c.json(response, 200);
}

/**
 * Phase 2: AI process needed chunks, cache embeddings, upsert to Vectorize
 *
 * Only receives chunks that were returned as "needed" from Phase 1.
 * Still checks embedding cache in case another user cached between phases.
 */
async function handlePhase2(
    c: AppContext,
    body: IndexSyncPhase2Request,
    userId: string
) {
    const { projectId, merkleRoot, chunks } = body;

    console.log(`[Sync P2] Processing ${chunks.length} chunks`);

    // Store merkle root
    await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);

    let aiProcessed = 0;
    let cacheHits = 0;
    let vectorsStored = 0;
    const aiErrors: string[] = [];
    const hashes = chunks.map((chunk) => chunk.hash);

    if (chunks.length > 0) {
        try {
            // Check cache again (another user may have cached between phases)
            console.log(`[Sync P2] Checking cache for ${chunks.length} chunks`);
            const cacheResults = await getManyCachedEmbeddings(
                c.env.INDEX_KV,
                hashes
            );

            // Separate cached vs uncached chunks
            const cachedChunks: Array<{
                chunk: (typeof chunks)[0];
                summary: string;
                embedding: number[];
            }> = [];

            const uncachedChunks: typeof chunks = [];

            for (const chunk of chunks) {
                const cached = cacheResults.get(chunk.hash);
                if (cached) {
                    cachedChunks.push({
                        chunk,
                        summary: cached.summary,
                        embedding: cached.embedding,
                    });
                    cacheHits++;
                } else {
                    uncachedChunks.push(chunk);
                }
            }

            console.log(
                `[Sync P2] Cache hits: ${cacheHits}, Cache misses: ${uncachedChunks.length}`
            );

            // Process uncached chunks with AI
            const newSummaries: string[] = [];
            const newEmbeddings: number[][] = [];

            if (uncachedChunks.length > 0) {
                console.log(
                    `[Sync P2] Generating summaries for ${uncachedChunks.length} uncached chunks`
                );
                const summaries = await generateSummaries(
                    c.env.AI,
                    uncachedChunks.map((chunk) => ({
                        code: chunk.code,
                        languageId: chunk.languageId,
                    }))
                );

                // Validate summaries
                if (summaries.length !== uncachedChunks.length) {
                    console.error(
                        `[Sync P2] Summary count mismatch: ${summaries.length} vs ${uncachedChunks.length}`
                    );
                    aiErrors.push('Summary count mismatch');
                    const response: IndexSyncPhase2Response = {
                        status: 'partial',
                        received: hashes,
                        merkleRoot,
                        aiProcessed: 0,
                        cacheHits,
                        aiErrors,
                        message: 'AI processing failed - summary count mismatch',
                    };
                    return c.json(response, 200);
                }

                console.log(
                    `[Sync P2] Generating embeddings for ${summaries.length} summaries`
                );
                const embeddings = await generateEmbeddings(c.env.AI, summaries);

                // Validate embeddings
                if (embeddings.length !== summaries.length) {
                    console.error(
                        `[Sync P2] Embedding count mismatch: ${embeddings.length} vs ${summaries.length}`
                    );
                    aiErrors.push('Embedding count mismatch');
                    const response: IndexSyncPhase2Response = {
                        status: 'partial',
                        received: hashes,
                        merkleRoot,
                        aiProcessed: 0,
                        cacheHits,
                        aiErrors,
                        message: 'AI processing failed - embedding count mismatch',
                    };
                    return c.json(response, 200);
                }

                newSummaries.push(...summaries);
                newEmbeddings.push(...embeddings);

                // Store in cache for future users (only non-zero vectors)
                const validEmbeddings = uncachedChunks
                    .map((chunk, i) => ({
                        hash: chunk.hash,
                        summary: summaries[i],
                        embedding: embeddings[i],
                    }))
                    .filter((item) => !isZeroVector(item.embedding));

                if (validEmbeddings.length > 0) {
                    console.log(
                        `[Sync P2] Caching ${validEmbeddings.length} valid embeddings (skipped ${uncachedChunks.length - validEmbeddings.length} zero vectors)`
                    );
                    await setManyCachedEmbeddings(c.env.INDEX_KV, validEmbeddings);
                } else {
                    console.warn('[Sync P2] No valid embeddings to cache (all zero vectors)');
                }

                aiProcessed = uncachedChunks.length;
            }

            // Combine cached + newly generated results
            const vectorizeChunks: Array<{
                hash: string;
                embedding: number[];
                metadata: ChunkMetadata;
            }> = [];

            // Add cached chunks
            for (const { chunk, summary, embedding } of cachedChunks) {
                vectorizeChunks.push({
                    hash: chunk.hash,
                    embedding,
                    metadata: {
                        projectId,
                        userId,
                        summary,
                        type: chunk.type,
                        name: chunk.name,
                        languageId: chunk.languageId,
                        lines: chunk.lines,
                        charCount: chunk.charCount,
                        filePath: chunk.filePath,
                    } as ChunkMetadata,
                });
            }

            // Add newly processed chunks
            for (let i = 0; i < uncachedChunks.length; i++) {
                const chunk = uncachedChunks[i];
                vectorizeChunks.push({
                    hash: chunk.hash,
                    embedding: newEmbeddings[i],
                    metadata: {
                        projectId,
                        userId,
                        summary: newSummaries[i],
                        type: chunk.type,
                        name: chunk.name,
                        languageId: chunk.languageId,
                        lines: chunk.lines,
                        charCount: chunk.charCount,
                        filePath: chunk.filePath,
                    } as ChunkMetadata,
                });
            }

            // Upsert all to Vectorize (returns count of valid vectors stored)
            console.log(
                `[Sync P2] Upserting ${vectorizeChunks.length} vectors to Vectorize`
            );
            vectorsStored = await upsertChunks(c.env.VECTORIZE, vectorizeChunks);

            if (vectorsStored < vectorizeChunks.length) {
                aiErrors.push(
                    `${vectorizeChunks.length - vectorsStored} chunks had zero vectors (AI embedding failed)`
                );
            }
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : 'AI processing failed';
            console.error('[Sync P2] AI error:', message);
            aiErrors.push(message);
        }
    }

    const response: IndexSyncPhase2Response = {
        status: aiErrors.length > 0 ? 'partial' : 'stored',
        received: hashes,
        merkleRoot,
        aiProcessed,
        cacheHits,
        vectorsStored,
        aiErrors: aiErrors.length > 0 ? aiErrors : undefined,
        message:
            aiErrors.length > 0
                ? 'Chunks stored but AI processing had errors'
                : 'Chunks processed with AI and stored in vector database',
    };

    return c.json(response, 200);
}

export default indexSync;
