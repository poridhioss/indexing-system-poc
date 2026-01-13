import { Hono } from 'hono';
import type {
    Env,
    Variables,
    IndexInitRequest,
    IndexInitResponse,
    ErrorResponse,
} from '../types';
import { setMerkleRoot, setChunkHashes, hasChunkHash } from '../lib/kv-store';

const indexInit = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /v1/index/init
 *
 * First-time full indexing when user opens a new project.
 * Stores merkle root and all chunk hashes.
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

    // Extract all chunk hashes
    const allHashes = body.chunks.map((chunk) => chunk.hash);

    // Check which hashes already exist (for chunksSkipped count)
    const existingChecks = await Promise.all(
        allHashes.map(async (hash) => ({
            hash,
            exists: await hasChunkHash(c.env.INDEX_KV, hash),
        }))
    );

    const existingHashes = existingChecks.filter((c) => c.exists).map((c) => c.hash);
    const newHashes = existingChecks.filter((c) => !c.exists).map((c) => c.hash);

    // Store merkle root
    await setMerkleRoot(c.env.INDEX_KV, userId, body.projectId, body.merkleRoot);

    // Store all chunk hashes (including existing ones to refresh TTL)
    await setChunkHashes(c.env.INDEX_KV, allHashes, ttlSeconds);

    const response: IndexInitResponse = {
        status: 'indexed',
        merkleRoot: body.merkleRoot,
        chunksStored: newHashes.length,
        chunksSkipped: existingHashes.length,
    };

    return c.json(response, 200);
});

export default indexInit;
