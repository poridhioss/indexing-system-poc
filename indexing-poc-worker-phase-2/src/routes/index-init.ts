import { Hono } from 'hono';
import type {
    Env,
    Variables,
    IndexInitRequest,
    IndexInitResponse,
    ErrorResponse,
    ChunkMetadata,
} from '../types';
import { setMerkleRoot, setChunkHashes, hasChunkHash } from '../lib/kv-store';
import { generateSummaries, generateEmbeddings } from '../lib/ai';
import { upsertChunks } from '../lib/vectorize';

const indexInit = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /v1/index/init
 *
 * First-time full indexing when user opens a new project.
 * Stores merkle root, all chunk hashes, generates summaries,
 * creates embeddings, and stores vectors in Vectorize.
 */
indexInit.post('/', async (c) => {
    const userId = c.get('userId');
    const ttlSeconds = parseInt(c.env.CHUNK_HASH_TTL, 10) || 2592000; // 30 days default

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

    // Step 1: Check which hashes already exist (for chunksSkipped count)
    const allHashes = chunks.map((chunk) => chunk.hash);
    const existingChecks = await Promise.all(
        allHashes.map(async (hash) => ({
            hash,
            exists: await hasChunkHash(c.env.INDEX_KV, hash),
        }))
    );

    const existingHashes = new Set(
        existingChecks.filter((check) => check.exists).map((check) => check.hash)
    );
    const newChunks = chunks.filter((chunk) => !existingHashes.has(chunk.hash));

    console.log(
        `[Init] New chunks: ${newChunks.length}, Cached: ${existingHashes.size}`
    );

    // Step 2: Store merkle root and hashes in KV
    await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);
    await setChunkHashes(c.env.INDEX_KV, allHashes, ttlSeconds);

    // Step 3: Process new chunks with AI
    let aiProcessed = 0;
    const aiErrors: string[] = [];

    if (newChunks.length > 0) {
        try {
            // Generate summaries
            console.log(
                `[Init] Generating summaries for ${newChunks.length} chunks`
            );
            const summaries = await generateSummaries(
                c.env.AI,
                newChunks.map((chunk) => ({
                    code: chunk.code,
                    languageId: chunk.languageId,
                }))
            );

            // VALIDATION: Ensure summaries count matches chunks
            if (summaries.length !== newChunks.length) {
                console.error(
                    `[Init] Summary count mismatch: ${summaries.length} vs ${newChunks.length} chunks`
                );
                aiErrors.push(
                    `Summary count mismatch: got ${summaries.length}, expected ${newChunks.length}`
                );
                // Don't proceed to embeddings/vectorize if counts don't match
                const response: IndexInitResponse = {
                    status: 'partial',
                    merkleRoot,
                    chunksStored: newChunks.length,
                    chunksSkipped: existingHashes.size,
                    aiProcessed: 0,
                    aiErrors,
                };
                return c.json(response, 200);
            }

            // Generate embeddings from summaries
            console.log(
                `[Init] Generating embeddings for ${summaries.length} summaries`
            );
            const embeddings = await generateEmbeddings(c.env.AI, summaries);

            // VALIDATION: Ensure embeddings count matches summaries
            if (embeddings.length !== summaries.length) {
                console.error(
                    `[Init] Embedding count mismatch: ${embeddings.length} vs ${summaries.length} summaries`
                );
                aiErrors.push(
                    `Embedding count mismatch: got ${embeddings.length}, expected ${summaries.length}`
                );
                const response: IndexInitResponse = {
                    status: 'partial',
                    merkleRoot,
                    chunksStored: newChunks.length,
                    chunksSkipped: existingHashes.size,
                    aiProcessed: 0,
                    aiErrors,
                };
                return c.json(response, 200);
            }

            // Prepare chunks for Vectorize (now safe - all arrays aligned)
            const vectorizeChunks = newChunks.map((chunk, i) => ({
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

            // Upsert to Vectorize
            console.log(
                `[Init] Upserting ${vectorizeChunks.length} vectors to Vectorize`
            );
            await upsertChunks(c.env.VECTORIZE, vectorizeChunks);

            aiProcessed = newChunks.length;
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'AI processing failed';
            console.error('[Init] AI processing error:', message);
            aiErrors.push(message);
        }
    }

    const response: IndexInitResponse = {
        status: aiErrors.length > 0 ? 'partial' : 'indexed',
        merkleRoot,
        chunksStored: newChunks.length,
        chunksSkipped: existingHashes.size,
        aiProcessed,
        aiErrors: aiErrors.length > 0 ? aiErrors : undefined,
    };

    return c.json(response, 200);
});

export default indexInit;
