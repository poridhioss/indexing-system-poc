const { hashContent, hashFile, hashChunk, hashContentMD5 } = require('./hash-utils');

/**
 * Represents a hashed chunk with content and metadata
 * Matches puku-vs-editor's chunk structure
 */
class HashedChunk {
    constructor({
        text,
        contentHash,
        type,
        name,
        lineStart,
        lineEnd,
        language,
        filePath,
        metadata = {}
    }) {
        this.text = text;
        this.contentHash = contentHash;  // SHA-256 hash (industry standard)
        this.type = type;                // chunkType in puku-vs-editor
        this.name = name;                // symbolName in puku-vs-editor
        this.lineStart = lineStart;
        this.lineEnd = lineEnd;
        this.language = language;        // languageId in puku-vs-editor
        this.filePath = filePath;        // uri in puku-vs-editor
        this.metadata = metadata;
    }

    /**
     * Character count
     */
    get charCount() {
        return this.text.length;
    }

    /**
     * Line count
     */
    get lineCount() {
        return this.lineEnd - this.lineStart + 1;
    }

    /**
     * Unique identifier combining file path and hash
     */
    get id() {
        return `${this.filePath}:${this.contentHash.substring(0, 12)}`;
    }

    toString() {
        return `[${this.type}] ${this.name || '(anonymous)'} @ ${this.filePath}:${this.lineStart}-${this.lineEnd} (${this.contentHash.substring(0, 8)}...)`;
    }
}

/**
 * ChunkHasher - Adds hashing capability to semantic chunks
 *
 * Default: SHA-256 (industry standard, used by Git, Cursor, etc.)
 * Legacy: MD5 available for puku-vs-editor compatibility
 */
class ChunkHasher {
    /**
     * @param {object} options - Configuration options
     * @param {boolean} options.useLegacyMD5 - Use MD5 instead of SHA-256 (for puku-vs-editor compatibility)
     */
    constructor(options = {}) {
        this.useLegacyMD5 = options.useLegacyMD5 || false;
    }

    /**
     * Initialize the hasher (no-op, kept for API compatibility)
     */
    async initialize() {
        return Promise.resolve();
    }

    /**
     * Hash a single chunk
     * @param {object} chunk - Semantic chunk from SemanticChunker
     * @param {string} filePath - File path for the chunk
     * @returns {HashedChunk}
     */
    hashChunk(chunk, filePath) {
        const contentHash = this.useLegacyMD5
            ? hashContentMD5(chunk.text)
            : hashContent(chunk.text);

        return new HashedChunk({
            text: chunk.text,
            contentHash: contentHash,
            type: chunk.type,
            name: chunk.name,
            lineStart: chunk.lineStart,
            lineEnd: chunk.lineEnd,
            language: chunk.language,
            filePath: filePath,
            metadata: { ...chunk.metadata },
        });
    }

    /**
     * Hash multiple chunks from a file
     * @param {object[]} chunks - Array of semantic chunks
     * @param {string} filePath - File path
     * @returns {HashedChunk[]}
     */
    hashChunks(chunks, filePath) {
        return chunks.map(chunk => this.hashChunk(chunk, filePath));
    }

    /**
     * Compute file-level content hash
     * Industry standard: SHA-256(file_path || file_content)
     *
     * @param {string} content - File content
     * @param {string} filePath - File path (optional, for industry-standard hashing)
     * @returns {string} Hash of file
     */
    hashFile(content, filePath = '') {
        if (this.useLegacyMD5) {
            // Legacy: MD5 of content only (puku-vs-editor pattern)
            return hashContentMD5(content);
        }
        // Industry standard: SHA-256(path || content)
        return filePath ? hashFile(filePath, content) : hashContent(content);
    }

    /**
     * Get the hash algorithm being used
     * @returns {string} 'sha256' or 'md5'
     */
    getAlgorithm() {
        return this.useLegacyMD5 ? 'md5' : 'sha256';
    }
}

module.exports = { ChunkHasher, HashedChunk };
