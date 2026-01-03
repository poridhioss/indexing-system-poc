/**
 * HashRegistry - Stores and compares chunk hashes for change detection
 * Matches puku-vs-editor's cache structure (using contentHash)
 */
class HashRegistry {
    constructor() {
        // Map: filePath -> Map<contentHash, HashedChunk>
        this.fileChunks = new Map();
        // Map: contentHash -> HashedChunk (global lookup)
        this.hashIndex = new Map();
        // Map: filePath -> contentHash (file-level)
        this.fileHashes = new Map();
    }

    /**
     * Check if a file is already indexed with the same content hash
     * Matches puku-vs-editor's isIndexed() method
     * @param {string} filePath - File path (uri)
     * @param {string} contentHash - MD5 hash of file content
     * @returns {boolean}
     */
    isIndexed(filePath, contentHash) {
        const storedHash = this.fileHashes.get(filePath);
        return storedHash === contentHash;
    }

    /**
     * Register chunks from a file
     * @param {string} filePath - File path
     * @param {HashedChunk[]} chunks - Hashed chunks
     * @param {string} contentHash - MD5 hash of the entire file
     */
    registerFile(filePath, chunks, contentHash) {
        // Store file hash
        this.fileHashes.set(filePath, contentHash);

        // Create chunk map for this file
        const chunkMap = new Map();
        for (const chunk of chunks) {
            chunkMap.set(chunk.contentHash, chunk);
            this.hashIndex.set(chunk.contentHash, chunk);
        }
        this.fileChunks.set(filePath, chunkMap);
    }

    /**
     * Check if a file has changed (alias for !isIndexed)
     * @param {string} filePath - File path
     * @param {string} newContentHash - New content hash
     * @returns {boolean}
     */
    hasFileChanged(filePath, newContentHash) {
        return !this.isIndexed(filePath, newContentHash);
    }

    /**
     * Compare new chunks against stored chunks and categorize changes
     * @param {string} filePath - File path
     * @param {HashedChunk[]} newChunks - New hashed chunks
     * @returns {{ added: HashedChunk[], modified: HashedChunk[], unchanged: HashedChunk[], removed: HashedChunk[] }}
     */
    compareChunks(filePath, newChunks) {
        const oldChunkMap = this.fileChunks.get(filePath) || new Map();
        const newChunkHashes = new Set(newChunks.map(c => c.contentHash));

        const result = {
            added: [],      // New chunks not in old set
            modified: [],   // Chunks with same position but different hash (approximation)
            unchanged: [],  // Chunks with same hash
            removed: [],    // Old chunks not in new set
        };

        // Categorize new chunks
        for (const chunk of newChunks) {
            if (oldChunkMap.has(chunk.contentHash)) {
                result.unchanged.push(chunk);
            } else {
                // Check if there's a chunk at similar position (heuristic for "modified")
                const similarOld = this._findSimilarChunk(chunk, oldChunkMap);
                if (similarOld) {
                    result.modified.push(chunk);
                } else {
                    result.added.push(chunk);
                }
            }
        }

        // Find removed chunks
        for (const [contentHash, chunk] of oldChunkMap) {
            if (!newChunkHashes.has(contentHash)) {
                // Check if it was "modified" (replaced by similar chunk)
                const wasModified = result.modified.some(
                    m => this._isSimilarPosition(m, chunk)
                );
                if (!wasModified) {
                    result.removed.push(chunk);
                }
            }
        }

        return result;
    }

    /**
     * Find a chunk at similar position (same name or overlapping lines)
     * @private
     */
    _findSimilarChunk(newChunk, oldChunkMap) {
        for (const [, oldChunk] of oldChunkMap) {
            if (this._isSimilarPosition(newChunk, oldChunk)) {
                return oldChunk;
            }
        }
        return null;
    }

    /**
     * Check if two chunks are at similar positions
     * @private
     */
    _isSimilarPosition(chunk1, chunk2) {
        // Same name (symbolName)
        if (chunk1.name && chunk1.name === chunk2.name) {
            return true;
        }
        // Overlapping line ranges
        const overlap = Math.min(chunk1.lineEnd, chunk2.lineEnd) -
                       Math.max(chunk1.lineStart, chunk2.lineStart);
        const minSize = Math.min(chunk1.lineCount, chunk2.lineCount);
        return overlap > minSize * 0.5; // >50% overlap
    }

    /**
     * Update registry with new chunks (after processing changes)
     * @param {string} filePath - File path
     * @param {HashedChunk[]} chunks - New chunks
     * @param {string} contentHash - New content hash
     */
    updateFile(filePath, chunks, contentHash) {
        // Remove old chunks from hash index
        const oldChunkMap = this.fileChunks.get(filePath);
        if (oldChunkMap) {
            for (const [hash] of oldChunkMap) {
                this.hashIndex.delete(hash);
            }
        }

        // Register new state
        this.registerFile(filePath, chunks, contentHash);
    }

    /**
     * Remove a file from the registry
     * @param {string} filePath - File path
     */
    removeFile(filePath) {
        const chunkMap = this.fileChunks.get(filePath);
        if (chunkMap) {
            for (const [hash] of chunkMap) {
                this.hashIndex.delete(hash);
            }
        }
        this.fileChunks.delete(filePath);
        this.fileHashes.delete(filePath);
    }

    /**
     * Get chunks for a specific file
     * Matches puku-vs-editor's getChunksForFile()
     * @param {string} filePath - File path
     * @returns {HashedChunk[]}
     */
    getChunksForFile(filePath) {
        const chunkMap = this.fileChunks.get(filePath);
        if (!chunkMap) {
            return [];
        }
        return Array.from(chunkMap.values());
    }

    /**
     * Get statistics about the registry
     */
    getStats() {
        let totalChunks = 0;
        for (const [, chunkMap] of this.fileChunks) {
            totalChunks += chunkMap.size;
        }

        return {
            fileCount: this.fileChunks.size,
            totalChunks: totalChunks,
            uniqueHashes: this.hashIndex.size,
        };
    }

    /**
     * Check if a chunk hash exists (for deduplication)
     * @param {string} contentHash - Chunk content hash
     * @returns {boolean}
     */
    hasHash(contentHash) {
        return this.hashIndex.has(contentHash);
    }

    /**
     * Get chunk by hash
     * @param {string} contentHash - Chunk content hash
     * @returns {HashedChunk | undefined}
     */
    getByHash(contentHash) {
        return this.hashIndex.get(contentHash);
    }
}

module.exports = { HashRegistry };
