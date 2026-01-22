import { createMiddleware } from 'hono/factory';
import * as Sentry from '@sentry/cloudflare';
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
    // Track incoming request
    Sentry.addBreadcrumb({
        category: 'http',
        message: `${c.req.method} ${c.req.path}`,
        level: 'info',
        data: { url: c.req.url, method: c.req.method },
    });

    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
        Sentry.setUser({ id: 'anonymous' });
        Sentry.captureMessage('Auth failed: Missing Authorization header', {
            level: 'warning',
            tags: { auth_failure: 'missing_header' },
            extra: { path: c.req.path, method: c.req.method },
        });
        const error: ErrorResponse = {
            error: 'Unauthorized',
            message: 'Missing Authorization header',
        };
        return c.json(error, 401);
    }

    if (!authHeader.startsWith('Bearer ')) {
        Sentry.setUser({ id: 'anonymous' });
        Sentry.captureMessage('Auth failed: Invalid Authorization header format', {
            level: 'warning',
            tags: { auth_failure: 'invalid_format' },
            extra: { path: c.req.path, method: c.req.method },
        });
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
        Sentry.addBreadcrumb({
            category: 'auth',
            message: 'Invalid token format',
            level: 'warning',
        });
        Sentry.setUser({ id: 'anonymous' });
        Sentry.captureMessage('Auth failed: Invalid token format', {
            level: 'warning',
            tags: { auth_failure: 'invalid_token' },
            extra: { path: c.req.path, method: c.req.method },
        });
        const error: ErrorResponse = {
            error: 'Unauthorized',
            message: 'Invalid token format',
        };
        return c.json(error, 401);
    }

    // Extract userId from token
    const userId = token.slice(10); // Remove "dev-token-" prefix

    if (!userId || userId.length === 0) {
        Sentry.setUser({ id: 'anonymous' });
        Sentry.captureMessage('Auth failed: Token missing userId', {
            level: 'warning',
            tags: { auth_failure: 'missing_userid' },
            extra: { path: c.req.path, method: c.req.method },
        });
        const error: ErrorResponse = {
            error: 'Unauthorized',
            message: 'Token missing userId',
        };
        return c.json(error, 401);
    }

    // Set Sentry user context for all subsequent events
    Sentry.setUser({
        id: userId,
        username: userId,
    });

    // Set searchable tags
    Sentry.setTag('user_id', userId);
    Sentry.setTag('request_path', c.req.path);

    Sentry.addBreadcrumb({
        category: 'auth',
        message: `Authenticated: ${userId}`,
        level: 'info',
    });

    // Set userId in context for route handlers
    c.set('userId', userId);

    await next();
});
