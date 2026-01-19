import * as fs from 'fs';
import * as path from 'path';
import type { ChunkReference } from './types';

/**
 * Reads code from disk using ChunkReference
 * Used in Phase 2 to retrieve code for chunks the server needs
 */
export class CodeReader {
    private projectRoot: string;
    private cache: Map<string, string> = new Map();

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
    }

    /**
     * Read code for a chunk using its reference
     */
    readChunk(reference: ChunkReference): string {
        const absolutePath = this.toAbsolutePath(reference.relativePath);

        // Get file content (with caching)
        let content = this.cache.get(reference.relativePath);
        if (!content) {
            content = fs.readFileSync(absolutePath, 'utf8');
            this.cache.set(reference.relativePath, content);
        }

        // Extract chunk using character offsets (more precise)
        return content.slice(reference.charStart, reference.charEnd);
    }

    /**
     * Read code for multiple chunks
     * Returns a map of hash -> code
     */
    readChunks(
        chunks: Array<{ hash: string; reference: ChunkReference }>
    ): Map<string, string> {
        const result = new Map<string, string>();

        for (const chunk of chunks) {
            try {
                const code = this.readChunk(chunk.reference);
                result.set(chunk.hash, code);
            } catch (err) {
                console.error(`Failed to read chunk ${chunk.hash}:`, err);
            }
        }

        return result;
    }

    /**
     * Read entire file content
     */
    readFile(relativePath: string): string {
        const absolutePath = this.toAbsolutePath(relativePath);
        return fs.readFileSync(absolutePath, 'utf8');
    }

    /**
     * Convert relative path to absolute path
     */
    private toAbsolutePath(relativePath: string): string {
        const normalized = relativePath.split('/').join(path.sep);
        return path.join(this.projectRoot, normalized);
    }

    /**
     * Clear the file content cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Invalidate cache for a specific file
     */
    invalidateFile(relativePath: string): void {
        this.cache.delete(relativePath);
    }
}
