import { Hono } from 'hono';
import type {
    Env,
    Variables,
    IndexSyncRequest,
    IndexSyncPhase1Request,
    IndexSyncPhase2Request,
    IndexSyncPhase1Response,
    IndexSyncPhase2Response,
    ErrorResponse,
} from '../types';
import {
    setMerkleRoot,
    setChunkHashes,
    categorizeChunkHashes,
} from '../lib/kv-store';

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
 *          Server stores new hashes and updates merkle root
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
        return handlePhase1(c, body as IndexSyncPhase1Request, userId, ttlSeconds);
    }

    // Handle Phase 2: Code transfer
    return handlePhase2(c, body as IndexSyncPhase2Request, userId, ttlSeconds);
});

/**
 * Phase 1: Check which hashes are needed vs cached
 */
async function handlePhase1(
    c: Parameters<typeof indexSync.post>[1] extends (c: infer C) => unknown ? C : never,
    body: IndexSyncPhase1Request,
    userId: string,
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
 * Phase 2: Store new chunks and update merkle root
 */
async function handlePhase2(
    c: Parameters<typeof indexSync.post>[1] extends (c: infer C) => unknown ? C : never,
    body: IndexSyncPhase2Request,
    userId: string,
    ttlSeconds: number
) {
    // Extract hashes from chunks with code
    const hashes = body.chunks.map((chunk) => chunk.hash);

    // Store all chunk hashes
    await setChunkHashes(c.env.INDEX_KV, hashes, ttlSeconds);

    // Update merkle root
    await setMerkleRoot(c.env.INDEX_KV, userId, body.projectId, body.merkleRoot);

    const response: IndexSyncPhase2Response = {
        status: 'stored',
        received: hashes,
        merkleRoot: body.merkleRoot,
        message: 'Chunks stored. AI processing disabled in Phase 1.',
    };

    return c.json(response, 200);
}

export default indexSync;
