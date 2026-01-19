import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import health from './routes/health';
import indexInit from './routes/index-init';
import indexCheck from './routes/index-check';
import indexSync from './routes/index-sync';
import search from './routes/search';
import summarize from './routes/summarize';
import embeddings from './routes/embeddings';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health check - no auth required
app.route('/v1/health', health);

// Protected routes - require auth
app.use('/v1/index/*', authMiddleware);
app.use('/v1/search', authMiddleware);
app.use('/v1/summarize/*', authMiddleware);
app.use('/v1/embeddings', authMiddleware);

// Phase 1 routes (existing)
app.route('/v1/index/init', indexInit);
app.route('/v1/index/check', indexCheck);
app.route('/v1/index/sync', indexSync);

// Phase 2 routes (new)
app.route('/v1/search', search);
app.route('/v1/summarize', summarize);
app.route('/v1/embeddings', embeddings);

// Root endpoint
app.get('/', (c) => {
    return c.json({
        name: 'indexing-poc-worker-phase-2',
        version: '2.0.0',
        endpoints: {
            // Phase 1 endpoints
            health: 'GET /v1/health',
            init: 'POST /v1/index/init',
            check: 'POST /v1/index/check',
            sync: 'POST /v1/index/sync',
            // Phase 2 endpoints
            search: 'POST /v1/search',
            summarize: 'POST /v1/summarize/batch',
            embeddings: 'POST /v1/embeddings',
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
