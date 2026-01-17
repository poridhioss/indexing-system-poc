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
import {
    setMerkleRoot,
    setChunkHashes,
    categorizeChunkHashes,
} from '../lib/kv-store';
import { generateSummaries, generateEmbeddings } from '../lib/ai';
import { upsertChunks } from '../lib/vectorize';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const indexSync = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /v1/index/sync
 *
 * Two-phase sync protocol for efficient updates.
 *
 * Phase 1: Client sends chunk hashes (no code)
 *          Server returns which are needed vs cached
 *
 * Phase 2: Client sends code only for needed chunks
 *          Server stores new hashes, generates summaries,
 *          creates embeddings, and updates Vectorize
 */
indexSync.post('/', async (c) => {
    const userId = c.get('userId');
    const ttlSeconds = parseInt(c.env.CHUNK_HASH_TTL, 10) || 2592000;

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

    // Handle Phase 1: Hash check
    if (body.phase === 1) {
        return handlePhase1(c, body as IndexSyncPhase1Request, ttlSeconds);
    }

    // Handle Phase 2: Code transfer + AI processing
    return handlePhase2(
        c,
        body as IndexSyncPhase2Request,
        userId,
        ttlSeconds
    );
});

/**
 * Phase 1: Check which hashes are needed vs cached
 */
async function handlePhase1(
    c: AppContext,
    body: IndexSyncPhase1Request,
    ttlSeconds: number
) {
    // Extract all hashes from chunks
    const hashes = body.chunks.map((chunk) => chunk.hash);

    // Categorize hashes (also refreshes TTL for cached ones)
    const { needed, cached } = await categorizeChunkHashes(
        c.env.INDEX_KV,
        hashes,
        ttlSeconds
    );

    const response: IndexSyncPhase1Response = {
        needed,
        cached,
    };

    return c.json(response, 200);
}

/**
 * Phase 2: Store new chunks, generate summaries/embeddings, update Vectorize
 */
async function handlePhase2(
    c: AppContext,
    body: IndexSyncPhase2Request,
    userId: string,
    ttlSeconds: number
) {
    const { projectId, merkleRoot, chunks } = body;

    console.log(`[Sync P2] Processing ${chunks.length} chunks`);

    // Step 1: Store hashes in KV (existing)
    const hashes = chunks.map((chunk) => chunk.hash);
    await setChunkHashes(c.env.INDEX_KV, hashes, ttlSeconds);
    await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);

    // Step 2: AI processing
    let aiProcessed = 0;
    const aiErrors: string[] = [];

    if (chunks.length > 0) {
        try {
            // Generate summaries
            const summaries = await generateSummaries(
                c.env.AI,
                chunks.map((chunk) => ({
                    code: chunk.code,
                    languageId: chunk.languageId,
                }))
            );

            // VALIDATION: Ensure summaries count matches chunks
            if (summaries.length !== chunks.length) {
                console.error(
                    `[Sync P2] Summary count mismatch: ${summaries.length} vs ${chunks.length}`
                );
                aiErrors.push(
                    `Summary count mismatch: got ${summaries.length}, expected ${chunks.length}`
                );
                const response: IndexSyncPhase2Response = {
                    status: 'partial',
                    received: hashes,
                    merkleRoot,
                    aiProcessed: 0,
                    aiErrors,
                    message: 'AI processing failed - summary count mismatch',
                };
                return c.json(response, 200);
            }

            // Generate embeddings
            const embeddings = await generateEmbeddings(c.env.AI, summaries);

            // VALIDATION: Ensure embeddings count matches summaries
            if (embeddings.length !== summaries.length) {
                console.error(
                    `[Sync P2] Embedding count mismatch: ${embeddings.length} vs ${summaries.length}`
                );
                aiErrors.push(
                    `Embedding count mismatch: got ${embeddings.length}, expected ${summaries.length}`
                );
                const response: IndexSyncPhase2Response = {
                    status: 'partial',
                    received: hashes,
                    merkleRoot,
                    aiProcessed: 0,
                    aiErrors,
                    message: 'AI processing failed - embedding count mismatch',
                };
                return c.json(response, 200);
            }

            // Upsert to Vectorize (now safe - all arrays aligned)
            const vectorizeChunks = chunks.map((chunk, i) => ({
                hash: chunk.hash,
                embedding: embeddings[i],
                metadata: {
                    projectId,
                    userId,
                    summary: summaries[i],
                    type: chunk.type,
                    name: chunk.name,
                    languageId: chunk.languageId,
                    lines: chunk.lines,
                    charCount: chunk.charCount,
                } as ChunkMetadata,
            }));

            await upsertChunks(c.env.VECTORIZE, vectorizeChunks);
            aiProcessed = chunks.length;
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
        aiErrors: aiErrors.length > 0 ? aiErrors : undefined,
        message:
            aiErrors.length > 0
                ? 'Chunks stored but AI processing had errors'
                : 'Chunks processed with AI and stored in vector database',
    };

    return c.json(response, 200);
}

export default indexSync;
