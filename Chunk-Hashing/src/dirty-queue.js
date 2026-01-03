/**
 * DirtyQueue - Tracks files that have changed since last sync
 *
 * When a file is saved, the system:
 * 1. Computes new file hash
 * 2. Compares with stored hash
 * 3. If different, marks file as "dirty" (queued for sync)
 *
 * During periodic sync (Lab 06+), dirty files are:
 * 1. Re-chunked (AST parsing)
 * 2. Chunk hashes compared
 * 3. Only changed chunks re-embedded
 * 4. Cleared from dirty queue
 */
class DirtyQueue {
    constructor() {
        // Set of dirty file paths
        this.dirtyFiles = new Set();
        // Timestamp of last sync
        this.lastSync = null;
        // Map: filePath -> { oldHash, newHash, timestamp }
        this.changeDetails = new Map();
    }

    /**
     * Mark a file as dirty (changed since last sync)
     * @param {string} filePath - File path
     * @param {string} oldHash - Previous file hash (or null if new file)
     * @param {string} newHash - New file hash
     */
    markDirty(filePath, oldHash, newHash) {
        this.dirtyFiles.add(filePath);
        this.changeDetails.set(filePath, {
            oldHash,
            newHash,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Check if a file is dirty
     * @param {string} filePath - File path
     * @returns {boolean}
     */
    isDirty(filePath) {
        return this.dirtyFiles.has(filePath);
    }

    /**
     * Get all dirty files
     * @returns {string[]}
     */
    getDirtyFiles() {
        return Array.from(this.dirtyFiles);
    }

    /**
     * Get change details for a file
     * @param {string} filePath - File path
     * @returns {{ oldHash: string, newHash: string, timestamp: string } | undefined}
     */
    getChangeDetails(filePath) {
        return this.changeDetails.get(filePath);
    }

    /**
     * Clear a single file from the dirty queue (after processing)
     * @param {string} filePath - File path
     */
    clearFile(filePath) {
        this.dirtyFiles.delete(filePath);
        this.changeDetails.delete(filePath);
    }

    /**
     * Clear all dirty files (after full sync)
     */
    clearAll() {
        this.dirtyFiles.clear();
        this.changeDetails.clear();
        this.lastSync = new Date().toISOString();
    }

    /**
     * Get queue statistics
     */
    getStats() {
        return {
            dirtyCount: this.dirtyFiles.size,
            lastSync: this.lastSync,
            files: this.getDirtyFiles(),
        };
    }

    /**
     * Export queue state for persistence
     * In a real implementation, this would be saved to .puku/dirty-queue.json
     * @returns {object}
     */
    toJSON() {
        return {
            lastSync: this.lastSync,
            dirtyFiles: this.getDirtyFiles(),
            changeDetails: Object.fromEntries(this.changeDetails),
        };
    }

    /**
     * Import queue state from persistence
     * @param {object} data - Saved queue state
     */
    fromJSON(data) {
        this.lastSync = data.lastSync || null;
        this.dirtyFiles = new Set(data.dirtyFiles || []);
        this.changeDetails = new Map(Object.entries(data.changeDetails || {}));
    }
}

module.exports = { DirtyQueue };
