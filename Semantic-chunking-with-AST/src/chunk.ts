/**
 * Chunk type enumeration
 */
export type ChunkType = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'struct' | 'impl' | 'trait' | 'block';

/**
 * Metadata attached to a chunk
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
 * Options for creating a SemanticChunk
 */
export interface SemanticChunkOptions {
    text: string;
    type: ChunkType;
    name: string | null;
    lineStart: number;
    lineEnd: number;
    language: string;
    metadata?: ChunkMetadata;
}

/**
 * Represents a semantic code chunk
 */
export class SemanticChunk {
    readonly text: string;
    readonly type: ChunkType;
    readonly name: string | null;
    readonly lineStart: number;  // 1-indexed
    readonly lineEnd: number;    // 1-indexed
    readonly language: string;
    readonly metadata: ChunkMetadata;

    constructor(options: SemanticChunkOptions) {
        this.text = options.text;
        this.type = options.type;
        this.name = options.name;
        this.lineStart = options.lineStart;
        this.lineEnd = options.lineEnd;
        this.language = options.language;
        this.metadata = options.metadata ?? {};
    }

    /**
     * Character count (for size limits)
     */
    get charCount(): number {
        return this.text.length;
    }

    /**
     * Line count
     */
    get lineCount(): number {
        return this.lineEnd - this.lineStart + 1;
    }

    /**
     * Create a summary string for debugging
     */
    toString(): string {
        return `[${this.type}] ${this.name ?? '(anonymous)'} (lines ${this.lineStart}-${this.lineEnd}, ${this.charCount} chars)`;
    }
}
