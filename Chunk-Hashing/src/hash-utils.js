const crypto = require('crypto');

/**
 * Compute MD5 hash of content
 * Used for puku-vs-editor compatibility (legacy content hashing)
 *
 * Note: For new implementations, prefer SHA-256.
 * MD5 is only kept for backwards compatibility with puku-vs-editor.
 *
 * @param {string} content - Content to hash
 * @returns {string} Hex-encoded MD5 hash
 */
function md5(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Compute SHA-256 hash of content
 * Industry standard for content hashing and Merkle trees
 *
 * Used by: Git, Bazel, Nix, Cursor
 *
 * @param {string} content - Content to hash
 * @returns {string} Hex-encoded SHA-256 hash
 */
function sha256(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Compute file hash using industry-standard approach
 * Formula: SHA-256(file_path || file_content)
 *
 * Including the path ensures files with identical content
 * but different locations produce different hashes.
 *
 * This is how Cursor, Git, and other tools hash files for Merkle trees.
 *
 * @param {string} filePath - File path (relative or absolute)
 * @param {string} content - File content
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashFile(filePath, content) {
    return sha256(filePath + content);
}

/**
 * Compute chunk hash using SHA-256
 * For semantic chunks, we hash just the content (path is tracked separately)
 *
 * @param {string} content - Chunk content
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashChunk(content) {
    return sha256(content);
}

/**
 * Normalize content before hashing (optional)
 * Removes variations that shouldn't affect semantic meaning:
 * - Trailing whitespace
 * - Multiple blank lines -> single blank line
 * - Consistent line endings (CRLF -> LF)
 *
 * Note: Most systems do NOT normalize before hashing.
 * This is provided for optional use cases where whitespace shouldn't matter.
 *
 * @param {string} content - Raw content
 * @returns {string} Normalized content
 */
function normalizeContent(content) {
    return content
        // Normalize line endings (Windows -> Unix)
        .replace(/\r\n/g, '\n')
        // Remove trailing whitespace from each line
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        // Collapse multiple blank lines into one
        .replace(/\n{3,}/g, '\n\n')
        // Remove trailing newline
        .trimEnd();
}

/**
 * Compute content hash (SHA-256, industry standard)
 * @param {string} content - Content to hash
 * @param {boolean} normalize - Whether to normalize content first (default: false)
 * @returns {string} SHA-256 hash of content
 */
function hashContent(content, normalize = false) {
    const toHash = normalize ? normalizeContent(content) : content;
    return sha256(toHash);
}

/**
 * Legacy: Compute content hash using MD5 (puku-vs-editor compatibility)
 * @param {string} content - Content to hash
 * @returns {string} MD5 hash of content
 * @deprecated Use hashContent() with SHA-256 for new implementations
 */
function hashContentMD5(content) {
    return md5(content);
}

module.exports = {
    md5,
    sha256,
    hashFile,
    hashChunk,
    normalizeContent,
    hashContent,
    hashContentMD5,
};
