import { Hono } from 'hono';
import type { Env, Variables, HealthResponse } from '../types';

const health = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /v1/health
 *
 * Health check endpoint - no auth required
 */
health.get('/', (c) => {
    const response: HealthResponse = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    };
    return c.json(response);
});

export default health;
