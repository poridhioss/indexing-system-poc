import * as Sentry from '@sentry/cloudflare';
import type { Ai, AiTextGenerationOutput, AiEmbeddingOutput } from '../types';

const SUMMARIZATION_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';

// Batch size limits (based on model context window)
const SUMMARIZATION_BATCH_SIZE = 50; // ~18,750 tokens, safe for 32k context
const EMBEDDING_BATCH_SIZE = 100; // BGE model handles larger batches

// Timeout for AI calls (Workers have 30s CPU limit, leave buffer)
const AI_TIMEOUT_MS = 25000; // 25s for batch operations (increased for reliability)
const QUERY_TIMEOUT_MS = 15000; // 15s for single query embedding

// Embedding dimensions for fallback
const EMBEDDING_DIMENSIONS = 1024;

/**
 * Wrap an AI call with timeout handling
 * Returns null on timeout instead of throwing
 */
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
): Promise<T | null> {
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId!);
        return result;
    } catch (error: unknown) {
        clearTimeout(timeoutId!);
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[AI] ${operationName} failed:`, message);
        return null;
    }
}

/**
 * Generate summaries for a single batch of chunks (internal helper)
 * Max 50 chunks per call to stay within context limits
 *
 * IMPORTANT: All chunks in a batch should have the same languageId
 * Returns fallback summaries on failure (never throws)
 */
async function summarizeBatch(
    ai: Ai,
    chunks: Array<{ code: string; languageId: string }>
): Promise<string[]> {
    const languageId = chunks[0].languageId;

    const chunksText = chunks
        .map((chunk, i) => `[CHUNK ${i + 1}]\n${chunk.code}\n`)
        .join('\n');

    const prompt = `Summarize each ${languageId} code chunk in natural language for semantic search.

IMPORTANT: Output summaries directly. Do NOT use <think>, <thinking>, or any XML tags.

Rules:
- Use plain English verbs (sends, calculates, stores, retrieves, validates, etc)
- Focus on WHAT it does, not HOW (avoid technical jargon)
- Include inputs and outputs in natural language
- Format: [N] summary text (numbered list starting from 1)
- NO code syntax, NO thinking process, NO XML tags
- Output EXACTLY ${chunks.length} summaries, one per chunk

Good examples:
[1] sends email notification to user with message, takes userId and message, returns success status
[2] calculates total price from shopping cart items by summing individual item prices
[3] stores user preferences in database, validates input format before saving

${chunksText}

Output ${chunks.length} numbered summaries (format: [1] summary, [2] summary, etc):`;

    // Call AI with timeout
    const response = await withTimeout(
        ai.run(SUMMARIZATION_MODEL, {
            messages: [{ role: 'user', content: prompt }],
            max_tokens: chunks.length * 100,
            temperature: 0.3,
        }),
        AI_TIMEOUT_MS,
        `Summarization batch (${chunks.length} ${languageId} chunks)`
    );

    // Fallback on timeout or error
    if (!response) {
        console.warn(
            `[AI] Batch failed, using fallback for ${chunks.length} chunks`
        );
        return chunks.map(() => 'Code chunk');
    }

    const textResponse = response as AiTextGenerationOutput;
    let summariesText = textResponse.response || '';

    // Remove thinking tags if present
    summariesText = summariesText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();

    if (summariesText.length < 10) {
        // Fallback if response is empty
        return chunks.map(() => 'Code chunk');
    }

    // Parse summaries
    const lines = summariesText
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l && !l.startsWith('<'));
    const summaries: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
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
            summaries.push('Code chunk');
        }
    }

    return summaries;
}

/**
 * Group chunks by languageId to ensure each batch has same language
 * This improves summary quality since prompt is language-specific
 */
function groupByLanguage(
    chunks: Array<{ code: string; languageId: string; originalIndex: number }>
): Map<
    string,
    Array<{ code: string; languageId: string; originalIndex: number }>
> {
    const groups = new Map<
        string,
        Array<{ code: string; languageId: string; originalIndex: number }>
    >();

    for (const chunk of chunks) {
        const existing = groups.get(chunk.languageId) || [];
        existing.push(chunk);
        groups.set(chunk.languageId, existing);
    }

    return groups;
}

/**
 * Generate summaries for code chunks with automatic batching
 * Processes in batches of 50 chunks max per API call
 *
 * Features:
 * - Groups chunks by languageId before batching
 * - 25s timeout per batch with fallback
 * - Guarantees output length === input length
 */
export async function generateSummaries(
    ai: Ai,
    chunks: Array<{ code: string; languageId: string }>
): Promise<string[]> {
    if (chunks.length === 0) return [];

    return await Sentry.startSpan(
        {
            name: 'generate-summaries',
            op: 'ai.summarize',
            attributes: {
                'ai.model': SUMMARIZATION_MODEL,
                'ai.chunks_count': chunks.length,
            },
        },
        async () => {
            // Track original indices for reassembly
            const chunksWithIndex = chunks.map((chunk, i) => ({
                ...chunk,
                originalIndex: i,
            }));

            // Group by language for better prompts
            const languageGroups = groupByLanguage(chunksWithIndex);

            // Result array (will be filled in original order)
            const allSummaries: string[] = new Array(chunks.length);

            // Process each language group
            for (const [languageId, langChunks] of languageGroups) {
                console.log(`[AI] Processing ${langChunks.length} ${languageId} chunks`);

                // Process in batches of 50
                for (let i = 0; i < langChunks.length; i += SUMMARIZATION_BATCH_SIZE) {
                    const batch = langChunks.slice(i, i + SUMMARIZATION_BATCH_SIZE);
                    const batchNum = Math.floor(i / SUMMARIZATION_BATCH_SIZE) + 1;
                    const totalBatches = Math.ceil(
                        langChunks.length / SUMMARIZATION_BATCH_SIZE
                    );

                    console.log(
                        `[AI] Summarizing ${languageId} batch ${batchNum}/${totalBatches} (${batch.length} chunks)`
                    );

                    // Get summaries for this batch (with timeout + fallback)
                    const batchSummaries = await summarizeBatch(ai, batch);

                    // Map summaries back to original indices
                    for (let j = 0; j < batch.length; j++) {
                        allSummaries[batch[j].originalIndex] = batchSummaries[j];
                    }
                }
            }

            // Final validation: ensure no undefined values
            for (let i = 0; i < allSummaries.length; i++) {
                if (!allSummaries[i]) {
                    console.warn(`[AI] Missing summary at index ${i}, using fallback`);
                    allSummaries[i] = 'Code chunk';
                }
            }

            return allSummaries;
        }
    );
}

/**
 * Generate embeddings for text array with automatic batching
 * Processes in batches of 100 texts max per API call
 *
 * Features:
 * - 25s timeout per batch with fallback (zero vector)
 * - Guarantees output length === input length
 */
export async function generateEmbeddings(
    ai: Ai,
    texts: string[]
): Promise<number[][]> {
    if (texts.length === 0) return [];

    return await Sentry.startSpan(
        {
            name: 'generate-embeddings',
            op: 'ai.embed',
            attributes: {
                'ai.model': EMBEDDING_MODEL,
                'ai.texts_count': texts.length,
            },
        },
        async () => {
            const allEmbeddings: number[][] = [];

            // Process in batches of 100
            for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
                const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
                const batchNum = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(texts.length / EMBEDDING_BATCH_SIZE);

                console.log(
                    `[AI] Embedding batch ${batchNum}/${totalBatches} (${batch.length} texts)`
                );

                // Call AI with timeout
                const response = await withTimeout(
                    ai.run(EMBEDDING_MODEL, {
                        text: batch,
                    }),
                    AI_TIMEOUT_MS,
                    `Embedding batch ${batchNum}`
                );

                const embeddingResponse = response as AiEmbeddingOutput | null;

                if (
                    embeddingResponse &&
                    embeddingResponse.data &&
                    embeddingResponse.data.length === batch.length
                ) {
                    // Success - add embeddings
                    allEmbeddings.push(...embeddingResponse.data);
                } else {
                    // Fallback - use zero vectors (will have low similarity scores)
                    console.warn(
                        `[AI] Embedding batch ${batchNum} failed, using zero vectors for ${batch.length} texts`
                    );
                    for (let j = 0; j < batch.length; j++) {
                        allEmbeddings.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
                    }
                }
            }

            // Final validation
            if (allEmbeddings.length !== texts.length) {
                console.error(
                    `[AI] Embedding count mismatch: got ${allEmbeddings.length}, expected ${texts.length}`
                );
                // Pad with zero vectors if needed
                while (allEmbeddings.length < texts.length) {
                    allEmbeddings.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
                }
            }

            return allEmbeddings;
        }
    );
}

/**
 * Generate embedding for a single query (used in search)
 * Includes retry logic for transient failures
 */
export async function generateQueryEmbedding(
    ai: Ai,
    query: string
): Promise<number[]> {
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const response = await withTimeout(
            ai.run(EMBEDDING_MODEL, {
                text: [query],
            }),
            QUERY_TIMEOUT_MS,
            `Query embedding (attempt ${attempt}/${MAX_RETRIES})`
        );

        const embeddingResponse = response as AiEmbeddingOutput | null;

        if (
            embeddingResponse &&
            embeddingResponse.data &&
            embeddingResponse.data[0]
        ) {
            return embeddingResponse.data[0];
        }

        // If not last attempt, wait briefly before retry
        if (attempt < MAX_RETRIES) {
            console.warn(`[AI] Query embedding attempt ${attempt} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Fallback: zero vector (will return no results, better than crashing)
    console.warn('[AI] Query embedding failed after retries, returning zero vector');
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
}
