import { Hono } from 'hono';
import type {
    Env,
    Variables,
    SummarizeRequest,
    AiTextGenerationOutput,
} from '../types';

const SUMMARIZATION_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const AI_TIMEOUT_MS = 25000; // 25 second timeout

const summarize = new Hono<{ Bindings: Env; Variables: Variables }>();

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
 * POST /v1/summarize/batch
 *
 * Generate code summaries for semantic search.
 * Standalone endpoint that can be called independently.
 */
summarize.post('/batch', async (c) => {
    let request: SummarizeRequest;
    try {
        request = await c.req.json<SummarizeRequest>();
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

    if (!request.chunks || !Array.isArray(request.chunks)) {
        return c.json(
            {
                error: {
                    message: 'chunks array is required',
                    type: 'invalid_request_error',
                },
            },
            400
        );
    }

    if (!request.languageId) {
        return c.json(
            {
                error: {
                    message: 'languageId is required',
                    type: 'invalid_request_error',
                },
            },
            400
        );
    }

    console.log(
        `[SummaryGenerator] Generating summaries for ${request.chunks.length} ${request.languageId} chunks`
    );

    // Create batch prompt (same pattern as puku-worker)
    const chunksText = request.chunks
        .map((chunk, i) => `[CHUNK ${i + 1}]\n${chunk.text}\n`)
        .join('\n');

    const prompt = `Summarize each ${request.languageId} code chunk in natural language for semantic search.

IMPORTANT: Output summaries directly. Do NOT use <think>, <thinking>, or any XML tags.

Rules:
- Use plain English verbs (sends, calculates, stores, retrieves, validates, etc)
- Focus on WHAT it does, not HOW (avoid technical jargon)
- Include inputs and outputs in natural language
- Format: [N] summary text (numbered list starting from 1)
- NO code syntax, NO thinking process, NO XML tags
- Output EXACTLY ${request.chunks.length} summaries, one per chunk

Good examples:
[1] sends email notification to user with message, takes userId and message, returns success status
[2] calculates total price from shopping cart items by summing individual item prices
[3] stores user preferences in database, validates input format before saving

${chunksText}

Output ${request.chunks.length} numbered summaries (format: [1] summary, [2] summary, etc):`;

    try {
        console.log(
            `[SummaryGenerator] Calling Workers AI with ${request.chunks.length} chunks`
        );
        const startTime = Date.now();

        // Call Workers AI with timeout
        const response = await withTimeout(
            env.AI.run(SUMMARIZATION_MODEL, {
                messages: [{ role: 'user', content: prompt }],
                max_tokens: request.chunks.length * 100,
                temperature: 0.3,
            }),
            AI_TIMEOUT_MS
        );

        const duration = Date.now() - startTime;
        console.log(`[SummaryGenerator] Workers AI responded in ${duration}ms`);

        // Handle timeout - return fallback
        if (!response) {
            console.warn(
                '[SummaryGenerator] AI call timed out, using fallback summaries'
            );
            return c.json({
                summaries: request.chunks.map(() => 'Code chunk'),
                timedOut: true,
            });
        }

        const textResponse = response as AiTextGenerationOutput;
        let summariesText = textResponse.response;

        // Check if response is empty - use fallback
        if (!summariesText) {
            console.warn(
                '[SummaryGenerator] No content in response, using fallback summaries'
            );
            return c.json({
                summaries: request.chunks.map(() => 'Code chunk'),
            });
        }

        // Remove thinking tags if present (safety measure)
        summariesText = summariesText
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .trim();

        // Check if response is empty after stripping thinking tags
        if (summariesText.length < 10) {
            console.warn(
                '[SummaryGenerator] Response was only thinking tags, using fallback'
            );
            return c.json({
                summaries: request.chunks.map(() => 'Code chunk'),
            });
        }

        // Parse summaries from response
        const lines = summariesText
            .split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l && !l.startsWith('<'));
        const summaries: string[] = [];

        for (let i = 0; i < request.chunks.length; i++) {
            const pattern = new RegExp(`^\\[${i + 1}\\]\\s*(.+)$`);
            let found = false;

            for (const line of lines) {
                const match = line.match(pattern);
                if (match) {
                    summaries.push(match[1].trim());
                    found = true;
                    break;
                }
            }

            if (!found) {
                // Fallback: try to find any remaining unparsed line
                const remainingLines = lines.filter(
                    (l: string) => !summaries.some((s) => l.includes(s))
                );

                if (remainingLines.length > 0) {
                    const line = remainingLines[0]
                        .replace(/^\[\d+\]\s*/, '')
                        .trim();
                    summaries.push(line || 'Code chunk');
                } else {
                    summaries.push('Code chunk');
                }
            }
        }

        console.log(
            `[SummaryGenerator] Generated ${summaries.length}/${request.chunks.length} summaries`
        );

        return c.json({ summaries });
    } catch (error: unknown) {
        const message =
            error instanceof Error ? error.message : 'Summary generation failed';
        console.error('[SummaryGenerator] Error:', message);

        // Return fallback on error instead of 500
        return c.json({
            summaries: request.chunks.map(() => 'Code chunk'),
            error: message,
        });
    }
});

export default summarize;
