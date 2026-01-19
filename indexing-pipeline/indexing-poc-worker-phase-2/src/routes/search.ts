import { Hono } from 'hono';
import type { Env, Variables, SearchRequest, SearchResponse } from '../types';
import { generateQueryEmbedding } from '../lib/ai';
import { searchChunks } from '../lib/vectorize';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /v1/search
 *
 * Semantic vector search for code chunks.
 * Generates query embedding, searches Vectorize, returns ranked results.
 */
search.post('/', async (c) => {
    const startTime = Date.now();
    const userId = c.get('userId');

    let body: SearchRequest;
    try {
        body = await c.req.json<SearchRequest>();
    } catch {
        return c.json(
            {
                error: 'Bad Request',
                message: 'Invalid JSON body',
            },
            400
        );
    }

    const { query, projectId, topK = 10 } = body;

    if (!query) {
        return c.json(
            { error: 'Bad Request', message: 'query is required' },
            400
        );
    }

    if (!projectId) {
        return c.json(
            { error: 'Bad Request', message: 'projectId is required' },
            400
        );
    }

    console.log(`[Search] Query: "${query}" for project ${projectId}`);

    try {
        // Generate embedding for query
        const queryEmbedding = await generateQueryEmbedding(c.env.AI, query);

        // Check if we got a zero vector (indicates failure)
        const isZeroVector = queryEmbedding.every((v) => v === 0);
        if (isZeroVector) {
            console.warn('[Search] Query embedding failed, returning empty results');
            const took = Date.now() - startTime;
            return c.json({
                results: [],
                query,
                took,
                warning: 'Query embedding failed, no results returned',
            } as SearchResponse & { warning: string });
        }

        // Search Vectorize (filtered by userId + projectId for isolation)
        const results = await searchChunks(
            c.env.VECTORIZE,
            queryEmbedding,
            userId,
            projectId,
            topK
        );

        const took = Date.now() - startTime;
        console.log(`[Search] Found ${results.length} results in ${took}ms`);

        return c.json({
            results,
            query,
            took,
        } as SearchResponse);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Search failed';
        console.error('[Search] Error:', message);
        return c.json({ error: 'Search failed', message }, 500);
    }
});

export default search;
