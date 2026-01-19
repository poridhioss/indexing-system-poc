import { Hono } from 'hono';
import type { Env, Variables, EmbeddingRequest, AiEmbeddingOutput } from '../types';

const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
const EMBEDDING_DIMENSIONS = 1024;
const AI_TIMEOUT_MS = 25000; // 25 second timeout

const embeddings = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Wrap an AI call with timeout handling
 */
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
): Promise<T | null> {
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId!);
        return result;
    } catch {
        clearTimeout(timeoutId!);
        return null;
    }
}

/**
 * POST /v1/embeddings
 *
 * Generate embeddings (OpenAI-compatible format).
 * Standalone endpoint that can be called independently.
 */
embeddings.post('/', async (c) => {
    let request: EmbeddingRequest;
    try {
        request = await c.req.json<EmbeddingRequest>();
    } catch {
        return c.json(
            {
                error: {
                    message: 'Invalid JSON body',
                    type: 'invalid_request_error',
                },
            },
            400
        );
    }

    const env = c.env;

    // Validate request
    if (!request.input) {
        return c.json(
            {
                error: {
                    message: 'input is required',
                    type: 'invalid_request_error',
                },
            },
            400
        );
    }

    // Normalize input to array
    const texts = Array.isArray(request.input)
        ? request.input
        : [request.input];

    console.log(`[Embeddings] Generating embeddings for ${texts.length} texts`);

    try {
        const startTime = Date.now();

        // Call Workers AI with timeout
        const response = await withTimeout(
            env.AI.run(EMBEDDING_MODEL, {
                text: texts,
            }),
            AI_TIMEOUT_MS
        );

        const duration = Date.now() - startTime;
        console.log(`[Embeddings] Workers AI responded in ${duration}ms`);

        const embeddingResponse = response as AiEmbeddingOutput | null;

        // Handle timeout - return zero vectors as fallback
        if (!embeddingResponse || !embeddingResponse.data) {
            console.warn(
                '[Embeddings] AI call timed out or failed, returning zero vectors'
            );
            return c.json({
                object: 'list',
                data: texts.map((_, index) => ({
                    object: 'embedding',
                    embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
                    index,
                })),
                model: EMBEDDING_MODEL,
                timedOut: true,
                usage: {
                    prompt_tokens: texts.join(' ').split(/\s+/).length,
                    total_tokens: texts.join(' ').split(/\s+/).length,
                },
            });
        }

        // Validate response length matches input
        if (embeddingResponse.data.length !== texts.length) {
            console.warn(
                `[Embeddings] Response length mismatch: ${embeddingResponse.data.length} vs ${texts.length}`
            );
            // Pad with zero vectors if needed
            while (embeddingResponse.data.length < texts.length) {
                embeddingResponse.data.push(
                    new Array(EMBEDDING_DIMENSIONS).fill(0)
                );
            }
        }

        // Format response (OpenAI-compatible)
        return c.json({
            object: 'list',
            data: embeddingResponse.data.map(
                (embedding: number[], index: number) => ({
                    object: 'embedding',
                    embedding,
                    index,
                })
            ),
            model: EMBEDDING_MODEL,
            usage: {
                prompt_tokens: texts.join(' ').split(/\s+/).length,
                total_tokens: texts.join(' ').split(/\s+/).length,
            },
        });
    } catch (error: unknown) {
        const message =
            error instanceof Error
                ? error.message
                : 'Embedding generation failed';
        console.error('[Embeddings] Error:', message);

        // Return zero vectors as fallback instead of 500
        return c.json({
            object: 'list',
            data: texts.map((_, index) => ({
                object: 'embedding',
                embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
                index,
            })),
            model: EMBEDDING_MODEL,
            error: message,
            usage: {
                prompt_tokens: texts.join(' ').split(/\s+/).length,
                total_tokens: texts.join(' ').split(/\s+/).length,
            },
        });
    }
});

export default embeddings;
