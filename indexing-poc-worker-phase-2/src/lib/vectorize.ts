import type {
    VectorizeIndex,
    ChunkMetadata,
    VectorizeVector,
    SearchResult,
    ChunkType,
} from '../types';

// Vectorize batch size limit
const VECTORIZE_BATCH_SIZE = 100;

/**
 * Upsert chunks to Vectorize
 *
 * @param vectorize - Vectorize index binding
 * @param chunks - Processed chunks with embeddings
 */
export async function upsertChunks(
    vectorize: VectorizeIndex,
    chunks: Array<{
        hash: string;
        embedding: number[];
        metadata: ChunkMetadata;
    }>
): Promise<void> {
    if (chunks.length === 0) return;

    const vectors: VectorizeVector[] = chunks.map((chunk) => ({
        id: chunk.hash,
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
}

/**
 * Search for similar chunks
 *
 * @param vectorize - Vectorize index binding
 * @param embedding - Query embedding vector
 * @param projectId - Filter by project
 * @param topK - Number of results to return
 * @returns Array of search results with scores
 */
export async function searchChunks(
    vectorize: VectorizeIndex,
    embedding: number[],
    projectId: string,
    topK: number = 10
): Promise<SearchResult[]> {
    const response = await vectorize.query(embedding, {
        topK: topK * 2, // Fetch more to filter by projectId
        returnMetadata: true,
    });

    // Filter by projectId and map to SearchResult
    const results: SearchResult[] = [];

    for (const match of response.matches) {
        const metadata = match.metadata as Record<string, unknown> | undefined;

        if (metadata && metadata.projectId === projectId) {
            results.push({
                hash: match.id,
                score: match.score,
                summary: metadata.summary as string,
                type: metadata.type as ChunkType,
                name: (metadata.name as string) || null,
                languageId: metadata.languageId as string,
                lines: [
                    metadata.lineStart as number,
                    metadata.lineEnd as number,
                ],
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
 * @param hashes - Array of chunk hashes to delete
 */
export async function deleteChunks(
    vectorize: VectorizeIndex,
    hashes: string[]
): Promise<void> {
    if (hashes.length === 0) return;

    // Vectorize supports batch delete
    for (let i = 0; i < hashes.length; i += VECTORIZE_BATCH_SIZE) {
        const batch = hashes.slice(i, i + VECTORIZE_BATCH_SIZE);
        const batchNum = Math.floor(i / VECTORIZE_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(hashes.length / VECTORIZE_BATCH_SIZE);

        console.log(
            `[Vectorize] Deleting batch ${batchNum}/${totalBatches} (${batch.length} vectors)`
        );

        await vectorize.deleteByIds(batch);
    }
}
