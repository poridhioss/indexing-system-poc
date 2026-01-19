/**
 * KV Store helpers for merkle root storage
 *
 * Note: Chunk hash caching has been removed in favor of embedding cache only.
 * The embedding cache (in embedding-cache.ts) provides all necessary caching
 * functionality while being simpler and more efficient.
 */

/**
 * KV key prefix for merkle roots
 */
const MERKLE_ROOT_PREFIX = 'merkleRoot';

/**
 * Build merkle root key: merkleRoot:{userId}:{projectId}
 */
function getMerkleRootKey(userId: string, projectId: string): string {
    return `${MERKLE_ROOT_PREFIX}:${userId}:${projectId}`;
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
