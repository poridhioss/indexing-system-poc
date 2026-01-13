import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import health from './routes/health';
import indexInit from './routes/index-init';
import indexCheck from './routes/index-check';
import indexSync from './routes/index-sync';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health check - no auth required
app.route('/v1/health', health);

// Protected routes - require auth
app.use('/v1/index/*', authMiddleware);
app.route('/v1/index/init', indexInit);
app.route('/v1/index/check', indexCheck);
app.route('/v1/index/sync', indexSync);

// Root endpoint
app.get('/', (c) => {
    return c.json({
        name: 'indexing-poc-worker',
        version: '1.0.0',
        endpoints: {
            health: 'GET /v1/health',
            init: 'POST /v1/index/init',
            check: 'POST /v1/index/check',
            sync: 'POST /v1/index/sync',
        },
    });
});

// 404 handler
app.notFound((c) => {
    return c.json(
        {
            error: 'Not Found',
            message: `Route ${c.req.method} ${c.req.path} not found`,
        },
        404
    );
});

// Error handler
app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json(
        {
            error: 'Internal Server Error',
            message: err.message || 'An unexpected error occurred',
        },
        500
    );
});

export default app;
