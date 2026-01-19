/**
 * Simple KV-based embedding cache
 *
 * Caches AI-generated summaries and embeddings by content hash.
 * This enables reuse across users with identical code.
 *
 * Cache Key Format: `embedding:{hash}`
 * Cache Value: { summary: string, embedding: number[] }
 * TTL: 90 days (longer than chunk hash TTL)
 */

export interface CachedEmbedding {
    summary: string;
    embedding: number[];
}

const CACHE_KEY_PREFIX = 'embedding:';
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

/**
 * Get cached summary and embedding for a content hash
 */
export async function getCachedEmbedding(
    kv: KVNamespace,
    hash: string
): Promise<CachedEmbedding | null> {
    const key = `${CACHE_KEY_PREFIX}${hash}`;
    const cached = await kv.get<CachedEmbedding>(key, 'json');
    return cached;
}

/**
 * Store summary and embedding in cache
 */
export async function setCachedEmbedding(
    kv: KVNamespace,
    hash: string,
    summary: string,
    embedding: number[]
): Promise<void> {
    const key = `${CACHE_KEY_PREFIX}${hash}`;
    const value: CachedEmbedding = { summary, embedding };
    await kv.put(key, JSON.stringify(value), {
        expirationTtl: CACHE_TTL_SECONDS,
    });
}

/**
 * Get multiple cached embeddings at once
 */
export async function getManyCachedEmbeddings(
    kv: KVNamespace,
    hashes: string[]
): Promise<Map<string, CachedEmbedding>> {
    const results = new Map<string, CachedEmbedding>();

    // Fetch all in parallel
    const promises = hashes.map(async (hash) => {
        const cached = await getCachedEmbedding(kv, hash);
        if (cached) {
            results.set(hash, cached);
        }
    });

    await Promise.all(promises);
    return results;
}

/**
 * Store multiple embeddings at once
 */
export async function setManyCachedEmbeddings(
    kv: KVNamespace,
    embeddings: Array<{ hash: string; summary: string; embedding: number[] }>
): Promise<void> {
    const promises = embeddings.map(({ hash, summary, embedding }) =>
        setCachedEmbedding(kv, hash, summary, embedding)
    );

    await Promise.all(promises);
}
