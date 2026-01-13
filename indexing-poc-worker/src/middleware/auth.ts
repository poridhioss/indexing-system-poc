import { createMiddleware } from 'hono/factory';
import type { Env, Variables, ErrorResponse } from '../types';

/**
 * Simple token-based auth middleware for POC
 *
 * For now, accepts a static dev token and extracts userId from it.
 * Will be replaced with proper JWT validation later.
 *
 * Expected header: Authorization: Bearer {token}
 *
 * Token format for POC: "dev-token-{userId}"
 * Example: "dev-token-user123" -> userId = "user123"
 */
export const authMiddleware = createMiddleware<{
    Bindings: Env;
    Variables: Variables;
}>(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
        const error: ErrorResponse = {
            error: 'Unauthorized',
            message: 'Missing Authorization header',
        };
        return c.json(error, 401);
    }

    if (!authHeader.startsWith('Bearer ')) {
        const error: ErrorResponse = {
            error: 'Unauthorized',
            message: 'Invalid Authorization header format. Expected: Bearer {token}',
        };
        return c.json(error, 401);
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // POC: Simple token validation
    // Token format: "dev-token-{userId}"
    if (!token.startsWith('dev-token-')) {
        const error: ErrorResponse = {
            error: 'Unauthorized',
            message: 'Invalid token format',
        };
        return c.json(error, 401);
    }

    // Extract userId from token
    const userId = token.slice(10); // Remove "dev-token-" prefix

    if (!userId || userId.length === 0) {
        const error: ErrorResponse = {
            error: 'Unauthorized',
            message: 'Token missing userId',
        };
        return c.json(error, 401);
    }

    // Set userId in context for route handlers
    c.set('userId', userId);

    await next();
});
