import * as crypto from 'crypto';

/**
 * Chunk type enumeration
 */
export type ChunkType = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'struct' | 'impl' | 'trait' | 'block';

/**
 * Metadata attached to a hashed chunk
 * Contains reference information to retrieve the source code locally
 */
export interface ChunkMetadata {
    parent?: string;
    parameters?: string[];
    returnType?: string;
    async?: boolean;
    exported?: boolean;
    gapFill?: boolean;
    fallback?: boolean;
    [key: string]: unknown;
}

/**
 * Reference to locate the source code on disk
 * Used during Phase 3 when server requests actual code
 */
export interface ChunkReference {
    relativePath: string; // RELATIVE path to source file (relative to project root)
    lineStart: number;    // 1-indexed start line
    lineEnd: number;      // 1-indexed end line
    charStart: number;    // Character offset from file start
    charEnd: number;      // Character offset end
}

/**
 * Options for creating a HashedChunk
 */
export interface HashedChunkOptions {
    text: string;              // Temporary - used only for hashing, then discarded
    type: ChunkType;
    name: string | null;
    language: string;
    reference: ChunkReference;
    metadata?: ChunkMetadata;
}

/**
 * Represents a hashed code chunk ready for two-phase sync
 *
 * IMPORTANT: This does NOT store the actual code!
 * - `hash` is SHA-256 of the code content
 * - `reference` contains file path + line numbers to retrieve code when needed
 *
 * This design enables:
 * 1. Send only hashes to server (Phase 2)
 * 2. Server checks cache by hash
 * 3. Client reads code locally only for chunks server requests (Phase 3)
 */
export class HashedChunk {
    readonly hash: string;           // SHA-256 hash of code content
    readonly type: ChunkType;
    readonly name: string | null;
    readonly language: string;
    readonly reference: ChunkReference;
    readonly metadata: ChunkMetadata;
    readonly charCount: number;      // Size info (without storing actual code)

    constructor(options: HashedChunkOptions) {
        // Compute hash from code content
        this.hash = HashedChunk.computeHash(options.text);
        this.charCount = options.text.length;

        // Store metadata (NOT the code!)
        this.type = options.type;
        this.name = options.name;
        this.language = options.language;
        this.reference = options.reference;
        this.metadata = options.metadata ?? {};

        // The `text` parameter is NOT stored - it's only used for hashing
    }

    /**
     * Compute SHA-256 hash of code content
     */
    static computeHash(content: string): string {
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }

    /**
     * Line count computed from reference
     */
    get lineCount(): number {
        return this.reference.lineEnd - this.reference.lineStart + 1;
    }

    /**
     * Create a summary string for debugging
     */
    toString(): string {
        return `[${this.type}] ${this.name ?? '(anonymous)'} @ ${this.reference.relativePath}:${this.reference.lineStart}-${this.reference.lineEnd} (hash: ${this.hash.substring(0, 8)}...)`;
    }

    /**
     * Convert to metadata-only object for sending to server (Phase 1)
     * NO code included - only hash, metadata, and reference info
     */
    toSyncPayload(): ChunkSyncPayload {
        return {
            hash: this.hash,
            type: this.type,
            name: this.name,
            languageId: this.language,
            lines: [this.reference.lineStart, this.reference.lineEnd],
            charCount: this.charCount,
            filePath: this.reference.relativePath,
        };
    }
}

/**
 * Payload sent to server during Phase 1 (metadata exchange)
 * Contains hash + metadata, NO code
 */
export interface ChunkSyncPayload {
    hash: string;
    type: ChunkType;
    name: string | null;
    languageId: string;
    lines: [number, number];  // [lineStart, lineEnd]
    charCount: number;
    filePath: string;
}

/**
 * File-level sync payload containing all chunk hashes
 */
export interface FileSyncPayload {
    relativePath: string;     // RELATIVE path (can be obfuscated before sending)
    chunks: ChunkSyncPayload[];
}
