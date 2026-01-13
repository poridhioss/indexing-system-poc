import { Hono } from 'hono';
import type {
    Env,
    Variables,
    IndexCheckRequest,
    IndexCheckResponse,
    ErrorResponse,
} from '../types';
import { getMerkleRoot } from '../lib/kv-store';

const indexCheck = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /v1/index/check
 *
 * Quick O(1) check if project needs sync.
 * Compares client's merkle root with server's stored root.
 */
indexCheck.post('/', async (c) => {
    const userId = c.get('userId');

    // Parse request body
    let body: IndexCheckRequest;
    try {
        body = await c.req.json<IndexCheckRequest>();
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

    // Get stored merkle root
    const serverRoot = await getMerkleRoot(c.env.INDEX_KV, userId, body.projectId);

    // Compare roots
    const changed = serverRoot !== body.merkleRoot;

    const response: IndexCheckResponse = {
        changed,
        serverRoot,
    };

    return c.json(response, 200);
});

export default indexCheck;
