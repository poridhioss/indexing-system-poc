import type { Env } from '../types';

/**
 * KV key prefixes
 */
const MERKLE_ROOT_PREFIX = 'merkleRoot';
const CHUNK_HASH_PREFIX = 'chunkHash';

/**
 * Build merkle root key: merkleRoot:{userId}:{projectId}
 */
function getMerkleRootKey(userId: string, projectId: string): string {
    return `${MERKLE_ROOT_PREFIX}:${userId}:${projectId}`;
}

/**
 * Build chunk hash key: chunkHash:{hash}
 */
function getChunkHashKey(hash: string): string {
    return `${CHUNK_HASH_PREFIX}:${hash}`;
}

/**
 * Get stored merkle root for a project
 */
export async function getMerkleRoot(
    kv: KVNamespace,
    userId: string,
    projectId: string
): Promise<string | null> {
    const key = getMerkleRootKey(userId, projectId);
    return await kv.get(key);
}

/**
 * Store merkle root for a project (no TTL - persists indefinitely)
 */
export async function setMerkleRoot(
    kv: KVNamespace,
    userId: string,
    projectId: string,
    merkleRoot: string
): Promise<void> {
    const key = getMerkleRootKey(userId, projectId);
    await kv.put(key, merkleRoot);
}

/**
 * Check if a chunk hash exists in cache
 */
export async function hasChunkHash(
    kv: KVNamespace,
    hash: string
): Promise<boolean> {
    const key = getChunkHashKey(hash);
    const value = await kv.get(key);
    return value !== null;
}

/**
 * Store a chunk hash with TTL
 */
export async function setChunkHash(
    kv: KVNamespace,
    hash: string,
    ttlSeconds: number
): Promise<void> {
    const key = getChunkHashKey(hash);
    await kv.put(key, '1', { expirationTtl: ttlSeconds });
}

/**
 * Refresh TTL for an existing chunk hash
 * (Re-put with same value extends the TTL)
 */
export async function refreshChunkHash(
    kv: KVNamespace,
    hash: string,
    ttlSeconds: number
): Promise<void> {
    await setChunkHash(kv, hash, ttlSeconds);
}

/**
 * Check multiple hashes and categorize as needed vs cached
 * Also refreshes TTL for cached hashes
 */
export async function categorizeChunkHashes(
    kv: KVNamespace,
    hashes: string[],
    ttlSeconds: number
): Promise<{ needed: string[]; cached: string[] }> {
    const needed: string[] = [];
    const cached: string[] = [];

    // Check all hashes in parallel
    const results = await Promise.all(
        hashes.map(async (hash) => {
            const exists = await hasChunkHash(kv, hash);
            return { hash, exists };
        })
    );

    // Categorize and refresh TTL for cached
    for (const { hash, exists } of results) {
        if (exists) {
            cached.push(hash);
            // Refresh TTL in background (fire-and-forget)
            refreshChunkHash(kv, hash, ttlSeconds).catch(() => {
                // Ignore refresh errors
            });
        } else {
            needed.push(hash);
        }
    }

    return { needed, cached };
}

/**
 * Store multiple chunk hashes with TTL
 */
export async function setChunkHashes(
    kv: KVNamespace,
    hashes: string[],
    ttlSeconds: number
): Promise<void> {
    await Promise.all(
        hashes.map((hash) => setChunkHash(kv, hash, ttlSeconds))
    );
}
