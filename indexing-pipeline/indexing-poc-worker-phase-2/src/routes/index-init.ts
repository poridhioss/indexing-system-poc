import { Hono } from 'hono';
import type {
    Env,
    Variables,
    IndexInitRequest,
    IndexInitResponse,
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

const indexInit = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Check if an embedding is a zero vector (fallback from failed AI)
 */
function isZeroVector(embedding: number[]): boolean {
    return embedding.every((v) => v === 0);
}

/**
 * POST /v1/index/init
 *
 * First-time full indexing when user opens a new project.
 * Stores merkle root, all chunk hashes, generates summaries,
 * creates embeddings, and stores vectors in Vectorize.
 */
indexInit.post('/', async (c) => {
    const userId = c.get('userId');

    // Parse request body
    let body: IndexInitRequest;
    try {
        body = await c.req.json<IndexInitRequest>();
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

    if (!body.chunks || !Array.isArray(body.chunks)) {
        const error: ErrorResponse = {
            error: 'Bad Request',
            message: 'chunks array is required',
        };
        return c.json(error, 400);
    }

    const { projectId, merkleRoot, chunks } = body;

    console.log(`[Init] Processing ${chunks.length} chunks for project ${projectId}`);

    // Store merkle root
    await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);

    // Process chunks with AI (cache-optimized)
    let aiProcessed = 0;
    let cacheHits = 0;
    let vectorsStored = 0;
    const aiErrors: string[] = [];

    if (chunks.length > 0) {
        try {
            // Check cache for all chunks
            console.log(`[Init] Checking cache for ${chunks.length} chunks`);
            const cacheResults = await getManyCachedEmbeddings(
                c.env.INDEX_KV,
                chunks.map((chunk) => chunk.hash)
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
                    // Cache hit - reuse summary and embedding
                    cachedChunks.push({
                        chunk,
                        summary: cached.summary,
                        embedding: cached.embedding,
                    });
                    cacheHits++;
                } else {
                    // Cache miss - needs AI processing
                    uncachedChunks.push(chunk);
                }
            }

            console.log(
                `[Init] Cache hits: ${cacheHits}, Cache misses: ${uncachedChunks.length}`
            );

            // Process uncached chunks with AI
            const newSummaries: string[] = [];
            const newEmbeddings: number[][] = [];

            if (uncachedChunks.length > 0) {
                console.log(
                    `[Init] Generating summaries for ${uncachedChunks.length} uncached chunks`
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
                        `[Init] Summary count mismatch: ${summaries.length} vs ${uncachedChunks.length}`
                    );
                    aiErrors.push('Summary count mismatch');
                    const response: IndexInitResponse = {
                        status: 'partial',
                        merkleRoot,
                        chunksReceived: chunks.length,
                        aiProcessed: 0,
                        cacheHits,
                        vectorsStored: 0,
                        aiErrors,
                    };
                    return c.json(response, 200);
                }

                console.log(
                    `[Init] Generating embeddings for ${summaries.length} summaries`
                );
                const embeddings = await generateEmbeddings(c.env.AI, summaries);

                // Validate embeddings
                if (embeddings.length !== summaries.length) {
                    console.error(
                        `[Init] Embedding count mismatch: ${embeddings.length} vs ${summaries.length}`
                    );
                    aiErrors.push('Embedding count mismatch');
                    const response: IndexInitResponse = {
                        status: 'partial',
                        merkleRoot,
                        chunksReceived: chunks.length,
                        aiProcessed: 0,
                        cacheHits,
                        vectorsStored: 0,
                        aiErrors,
                    };
                    return c.json(response, 200);
                }

                newSummaries.push(...summaries);
                newEmbeddings.push(...embeddings);

                // Store in cache for future use (only non-zero vectors)
                const validEmbeddings = uncachedChunks
                    .map((chunk, i) => ({
                        hash: chunk.hash,
                        summary: summaries[i],
                        embedding: embeddings[i],
                    }))
                    .filter((item) => !isZeroVector(item.embedding));

                if (validEmbeddings.length > 0) {
                    console.log(
                        `[Init] Caching ${validEmbeddings.length} valid embeddings (skipped ${uncachedChunks.length - validEmbeddings.length} zero vectors)`
                    );
                    await setManyCachedEmbeddings(c.env.INDEX_KV, validEmbeddings);
                } else {
                    console.warn('[Init] No valid embeddings to cache (all zero vectors)');
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
                        summary, // From cache
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
                        summary: newSummaries[i], // Newly generated
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
                `[Init] Upserting ${vectorizeChunks.length} vectors to Vectorize`
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
            console.error('[Init] AI processing error:', message);
            aiErrors.push(message);
        }
    }

    const response: IndexInitResponse = {
        status: aiErrors.length > 0 ? 'partial' : 'indexed',
        merkleRoot,
        chunksReceived: chunks.length,
        aiProcessed,
        cacheHits,
        vectorsStored,
        aiErrors: aiErrors.length > 0 ? aiErrors : undefined,
    };

    return c.json(response, 200);
});

export default indexInit;
