import type {
    VectorizeIndex,
    ChunkMetadata,
    VectorizeVector,
    SearchResult,
    ChunkType,
} from '../types';

// Vectorize batch size limit
const VECTORIZE_BATCH_SIZE = 100;

// Vectorize max ID length is 64 bytes
const MAX_VECTOR_ID_LENGTH = 64;

/**
 * Generate a short, unique vector ID that fits within Vectorize's 64-byte limit.
 * Format: {shortUserId}_{shortProjectId}_{shortHash}
 *
 * We use first 8 chars of each component to stay well under the limit:
 * 8 + 1 + 8 + 1 + 16 = 34 bytes (safe margin)
 */
function generateVectorId(userId: string, projectId: string, hash: string): string {
    // Use short prefixes to stay under 64 bytes
    const shortUserId = userId.substring(0, 8);
    const shortProjectId = projectId.substring(0, 8);
    const shortHash = hash.substring(0, 16); // 16 chars of SHA-256 is still unique enough

    return `${shortUserId}_${shortProjectId}_${shortHash}`;
}

/**
 * Check if an embedding is a zero vector (fallback from failed AI)
 */
function isZeroVector(embedding: number[]): boolean {
    return embedding.every((v) => v === 0);
}

/**
 * Upsert chunks to Vectorize
 * Filters out chunks with zero vectors (failed AI embeddings)
 *
 * @param vectorize - Vectorize index binding
 * @param chunks - Processed chunks with embeddings
 * @returns Number of chunks actually upserted (excluding zero vectors)
 */
export async function upsertChunks(
    vectorize: VectorizeIndex,
    chunks: Array<{
        hash: string;
        embedding: number[];
        metadata: ChunkMetadata;
    }>
): Promise<number> {
    if (chunks.length === 0) return 0;

    // Filter out zero vectors - these are failed AI embeddings
    const validChunks = chunks.filter((chunk) => {
        if (isZeroVector(chunk.embedding)) {
            console.warn(
                `[Vectorize] Skipping chunk ${chunk.hash} - zero vector (AI embedding failed)`
            );
            return false;
        }
        return true;
    });

    if (validChunks.length === 0) {
        console.warn('[Vectorize] No valid vectors to upsert (all zero vectors)');
        return 0;
    }

    if (validChunks.length < chunks.length) {
        console.warn(
            `[Vectorize] Filtered out ${chunks.length - validChunks.length} zero vectors`
        );
    }

    const vectors: VectorizeVector[] = validChunks.map((chunk) => ({
        // POC: Use composite ID for complete user isolation (shortened to fit 64-byte limit)
        id: generateVectorId(chunk.metadata.userId, chunk.metadata.projectId, chunk.hash),
        values: chunk.embedding,
        metadata: {
            projectId: chunk.metadata.projectId,
            userId: chunk.metadata.userId,
            summary: chunk.metadata.summary,
            type: chunk.metadata.type,
            name: chunk.metadata.name || '',
            languageId: chunk.metadata.languageId,
            lineStart: chunk.metadata.lines[0],
            lineEnd: chunk.metadata.lines[1],
            charCount: chunk.metadata.charCount,
            filePath: chunk.metadata.filePath,
        },
    }));

    // Vectorize supports batch upsert up to 1000 vectors
    // We use 100 for safety
    for (let i = 0; i < vectors.length; i += VECTORIZE_BATCH_SIZE) {
        const batch = vectors.slice(i, i + VECTORIZE_BATCH_SIZE);
        const batchNum = Math.floor(i / VECTORIZE_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(vectors.length / VECTORIZE_BATCH_SIZE);

        console.log(
            `[Vectorize] Upserting batch ${batchNum}/${totalBatches} (${batch.length} vectors)`
        );

        await vectorize.upsert(batch);
    }

    return validChunks.length;
}

/**
 * Search for similar chunks
 *
 * @param vectorize - Vectorize index binding
 * @param embedding - Query embedding vector
 * @param userId - Filter by user (for multi-tenant isolation)
 * @param projectId - Filter by project
 * @param topK - Number of results to return
 * @returns Array of search results with scores
 */
export async function searchChunks(
    vectorize: VectorizeIndex,
    embedding: number[],
    userId: string,
    projectId: string,
    topK: number = 10
): Promise<SearchResult[]> {
    const response = await vectorize.query(embedding, {
        topK: Math.min(topK * 3, 20), // Fetch more to filter, max 20 when returnMetadata='all'
        returnMetadata: 'all', // V2 API: 'all' | 'indexed' | 'none'
        returnValues: true, // Required for accurate similarity scores
    });

    // Filter by userId AND projectId for multi-tenant isolation
    const results: SearchResult[] = [];

    for (const match of response.matches) {
        const metadata = match.metadata as Record<string, unknown> | undefined;

        // Must match both userId AND projectId for proper isolation
        if (metadata && metadata.userId === userId && metadata.projectId === projectId) {
            // Extract short hash from composite ID (format: shortUserId_shortProjectId_shortHash)
            // Note: This is the truncated hash, not the full hash
            const hashPart = match.id.split('_')[2] || match.id;

            results.push({
                hash: hashPart,
                score: match.score ?? 0, // Vectorize may return undefined for unindexed vectors
                summary: metadata.summary as string,
                type: metadata.type as ChunkType,
                name: (metadata.name as string) || null,
                languageId: metadata.languageId as string,
                lines: [
                    metadata.lineStart as number,
                    metadata.lineEnd as number,
                ],
                filePath: metadata.filePath as string,
            });
        }

        if (results.length >= topK) break;
    }

    return results;
}

/**
 * Delete chunks from Vectorize
 *
 * @param vectorize - Vectorize index binding
 * @param userId - User ID for composite ID
 * @param projectId - Project ID for composite ID
 * @param hashes - Array of chunk hashes to delete
 */
export async function deleteChunks(
    vectorize: VectorizeIndex,
    userId: string,
    projectId: string,
    hashes: string[]
): Promise<void> {
    if (hashes.length === 0) return;

    // POC: Convert hashes to composite IDs (shortened to fit 64-byte limit)
    const compositeIds = hashes.map(hash => generateVectorId(userId, projectId, hash));

    // Vectorize supports batch delete
    for (let i = 0; i < compositeIds.length; i += VECTORIZE_BATCH_SIZE) {
        const batch = compositeIds.slice(i, i + VECTORIZE_BATCH_SIZE);
        const batchNum = Math.floor(i / VECTORIZE_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(compositeIds.length / VECTORIZE_BATCH_SIZE);

        console.log(
            `[Vectorize] Deleting batch ${batchNum}/${totalBatches} (${batch.length} vectors)`
        );

        await vectorize.deleteByIds(batch);
    }
}
