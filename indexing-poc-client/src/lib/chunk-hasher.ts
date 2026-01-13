import Parser from 'web-tree-sitter';

// Type aliases from web-tree-sitter
type Language = Awaited<ReturnType<typeof Parser.Language.load>>;
type SyntaxNode = ReturnType<Parser['parse']> extends { rootNode: infer N } ? N : never;
import * as path from 'path';
import { getSemanticTypes } from './semantic-nodes';
import { HashedChunk, ChunkType, ChunkMetadata, ChunkReference, FileSyncPayload } from './hashed-chunk';

/**
 * Configuration for the chunk hasher
 */
export interface ChunkHasherConfig {
    maxChunkSize: number;      // Max characters per chunk
    minChunkSize: number;      // Min characters (skip tiny chunks)
    fallbackLineSize: number;  // Lines per chunk when falling back
    fallbackOverlap: number;   // Overlap lines in fallback mode
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: ChunkHasherConfig = {
    maxChunkSize: 8000,
    minChunkSize: 100,
    fallbackLineSize: 50,
    fallbackOverlap: 10,
};

/**
 * Language configuration mapping language name to WASM path
 */
export type LanguageConfigs = Record<string, string>;

/**
 * AST-based Chunk Hasher
 *
 * Splits code into semantic chunks and computes SHA-256 hashes.
 * Designed for two-phase sync protocol:
 * - Phase 1: Send hashes + metadata (no code)
 * - Phase 2: Send code only for chunks server requests
 *
 * Key difference from SemanticChunker:
 * - Returns HashedChunk (hash + reference) instead of SemanticChunk (code included)
 * - Code is read on-demand using reference when needed
 * - All paths stored as RELATIVE paths (relative to projectRoot)
 */
export class ChunkHasher {
    private config: ChunkHasherConfig;
    private projectRoot: string;
    private parser: Parser | null = null;
    private languages: Map<string, Language> = new Map();

    /**
     * Create a new ChunkHasher
     * @param projectRoot - The root directory of the project (used to compute relative paths)
     * @param config - Optional configuration overrides
     */
    constructor(projectRoot: string, config: Partial<ChunkHasherConfig> = {}) {
        this.projectRoot = path.resolve(projectRoot);
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Convert absolute path to relative path (relative to projectRoot)
     * Normalizes to forward slashes for cross-platform consistency
     */
    toRelativePath(absolutePath: string): string {
        const relative = path.relative(this.projectRoot, absolutePath);
        // Normalize to forward slashes for consistency across platforms
        return relative.split(path.sep).join('/');
    }

    /**
     * Convert relative path to absolute path
     */
    toAbsolutePath(relativePath: string): string {
        // Handle both forward slashes and backslashes
        const normalized = relativePath.split('/').join(path.sep);
        return path.join(this.projectRoot, normalized);
    }

    /**
     * Get the project root path
     */
    getProjectRoot(): string {
        return this.projectRoot;
    }

    /**
     * Initialize Tree-sitter and load language grammars
     */
    async initialize(languageConfigs: LanguageConfigs): Promise<void> {
        await Parser.init();
        this.parser = new Parser();

        // Load each language grammar
        for (const [lang, wasmPath] of Object.entries(languageConfigs)) {
            const language = await Parser.Language.load(wasmPath);
            this.languages.set(lang, language);
        }
    }

    /**
     * Hash a file's code into chunks
     *
     * @param code - Source code content
     * @param language - Language identifier (javascript, python, etc.)
     * @param filePath - Can be absolute OR relative path (will be converted to relative)
     * @returns Array of hashed chunks (hash + metadata, no code stored)
     */
    hashFile(code: string, language: string, filePath: string): HashedChunk[] {
        // Convert to relative path if absolute
        const relativePath = path.isAbsolute(filePath)
            ? this.toRelativePath(filePath)
            : filePath;

        const langGrammar = this.languages.get(language);

        if (!langGrammar || !this.parser) {
            console.warn(`Language '${language}' not loaded, using fallback`);
            return this.fallbackHash(code, language, relativePath);
        }

        // Parse the code
        this.parser.setLanguage(langGrammar);
        const tree = this.parser.parse(code);

        if (!tree) {
            console.warn(`Failed to parse code for language '${language}', using fallback`);
            return this.fallbackHash(code, language, relativePath);
        }

        // Extract and hash semantic chunks
        const chunks: HashedChunk[] = [];
        const semanticTypes = getSemanticTypes(language);

        this.extractAndHashChunks(tree.rootNode, code, language, relativePath, semanticTypes, chunks);

        // Fill gaps between chunks
        return this.fillGaps(chunks, code, language, relativePath);
    }

    /**
     * Create a file sync payload for Phase 2 (metadata exchange)
     * This is what gets sent to the server - hashes only, no code
     * @param chunks - Array of hashed chunks
     * @param filePath - Can be absolute OR relative path (will be converted to relative)
     */
    createSyncPayload(chunks: HashedChunk[], filePath: string): FileSyncPayload {
        // Convert to relative path if absolute
        const relativePath = path.isAbsolute(filePath)
            ? this.toRelativePath(filePath)
            : filePath;

        return {
            relativePath,  // Could be obfuscated before sending
            chunks: chunks.map(chunk => chunk.toSyncPayload()),
        };
    }

    /**
     * Recursively extract and hash semantic chunks from AST
     */
    private extractAndHashChunks(
        node: SyntaxNode,
        code: string,
        language: string,
        filePath: string,
        semanticTypes: string[],
        chunks: HashedChunk[],
        parentName: string | null = null
    ): void {
        // Check if this node is a semantic unit
        if (semanticTypes.includes(node.type)) {
            const text = node.text;
            const charCount = text.length;

            // Check size constraints
            if (charCount >= this.config.minChunkSize) {
                if (charCount <= this.config.maxChunkSize) {
                    // Good size - extract and hash as a chunk
                    const chunk = this.createHashedChunk(node, code, language, filePath, parentName);
                    chunks.push(chunk);
                    return; // Don't recurse into children
                } else {
                    // Too large - try to split by children
                    const childChunks = this.splitLargeNode(node, code, language, filePath, semanticTypes);
                    if (childChunks.length > 0) {
                        chunks.push(...childChunks);
                        return;
                    }
                    // If no children found, fall through to extract anyway
                    const chunk = this.createHashedChunk(node, code, language, filePath, parentName);
                    chunks.push(chunk);
                    return;
                }
            }
        }

        // Recurse into named children
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child) {
                const newParent = this.getNodeName(node) ?? parentName;
                this.extractAndHashChunks(child, code, language, filePath, semanticTypes, chunks, newParent);
            }
        }
    }

    /**
     * Create a HashedChunk from an AST node
     * Computes hash and stores reference (NOT the code itself)
     */
    private createHashedChunk(
        node: SyntaxNode,
        code: string,
        language: string,
        relativePath: string,
        parentName: string | null
    ): HashedChunk {
        const name = this.getNodeName(node);
        const type = this.getChunkType(node.type);
        const metadata = this.extractMetadata(node, language);

        if (parentName) {
            metadata.parent = parentName;
        }

        // Create reference to locate code on disk (uses RELATIVE path)
        const reference: ChunkReference = {
            relativePath,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            charStart: node.startIndex,
            charEnd: node.endIndex,
        };

        return new HashedChunk({
            text: node.text,  // Used for hashing, then discarded
            type,
            name,
            language,
            reference,
            metadata,
        });
    }

    /**
     * Extract the name from a node (function name, class name, etc.)
     */
    private getNodeName(node: SyntaxNode): string | null {
        // Try common field names
        const nameNode = node.childForFieldName('name') ??
                         node.childForFieldName('identifier');

        if (nameNode) {
            return nameNode.text;
        }

        // For arrow functions assigned to variables
        if (node.type === 'arrow_function' && node.parent?.type === 'variable_declarator') {
            return node.parent.childForFieldName('name')?.text ?? null;
        }

        // For exported declarations
        if (node.type === 'export_statement') {
            const declaration = node.childForFieldName('declaration');
            if (declaration) {
                return this.getNodeName(declaration);
            }
        }

        return null;
    }

    /**
     * Map AST node type to chunk type
     */
    private getChunkType(nodeType: string): ChunkType {
        const typeMap: Record<string, ChunkType> = {
            'function_declaration': 'function',
            'function_definition': 'function',
            'generator_function_declaration': 'function',
            'arrow_function': 'function',
            'method_definition': 'method',
            'method_declaration': 'method',
            'class_declaration': 'class',
            'class_definition': 'class',
            'interface_declaration': 'interface',
            'type_alias_declaration': 'type',
            'enum_declaration': 'enum',
            'struct_item': 'struct',
            'impl_item': 'impl',
            'trait_item': 'trait',
            'decorated_definition': 'function',
        };
        return typeMap[nodeType] ?? 'block';
    }

    /**
     * Extract metadata from a node (parameters, return type, etc.)
     */
    private extractMetadata(node: SyntaxNode, _language: string): ChunkMetadata {
        const metadata: ChunkMetadata = {};

        // Extract parameters
        const params = node.childForFieldName('parameters');
        if (params) {
            metadata.parameters = [];
            for (let i = 0; i < params.namedChildCount; i++) {
                const param = params.namedChild(i);
                if (param) {
                    metadata.parameters.push(param.text);
                }
            }
        }

        // Extract return type (TypeScript)
        const returnType = node.childForFieldName('return_type');
        if (returnType) {
            metadata.returnType = returnType.text;
        }

        // Check for async
        if (node.text.startsWith('async ')) {
            metadata.async = true;
        }

        // Check for export
        if (node.parent?.type === 'export_statement') {
            metadata.exported = true;
        }

        return metadata;
    }

    /**
     * Split a large node by extracting its children
     */
    private splitLargeNode(
        node: SyntaxNode,
        code: string,
        language: string,
        relativePath: string,
        semanticTypes: string[]
    ): HashedChunk[] {
        const chunks: HashedChunk[] = [];

        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child && semanticTypes.includes(child.type) && child.text.length >= this.config.minChunkSize) {
                const parentName = this.getNodeName(node);
                const chunk = this.createHashedChunk(child, code, language, relativePath, parentName);
                chunks.push(chunk);
            }
        }

        return chunks;
    }

    /**
     * Fill gaps between semantic chunks with block chunks
     */
    private fillGaps(chunks: HashedChunk[], code: string, language: string, relativePath: string): HashedChunk[] {
        if (chunks.length === 0) {
            return this.fallbackHash(code, language, relativePath);
        }

        // Sort chunks by line number
        chunks.sort((a, b) => a.reference.lineStart - b.reference.lineStart);

        const lines = code.split('\n');
        const result: HashedChunk[] = [];
        let currentLine = 1;

        for (const chunk of chunks) {
            // Check for gap before this chunk
            if (chunk.reference.lineStart > currentLine) {
                const gapStartLine = currentLine;
                const gapEndLine = chunk.reference.lineStart - 1;
                const gapLines = lines.slice(gapStartLine - 1, gapEndLine);
                const gapText = gapLines.join('\n').trim();

                if (gapText.length >= this.config.minChunkSize) {
                    // Calculate char offsets for gap
                    const charStart = this.getCharOffset(lines, gapStartLine);
                    const charEnd = this.getCharOffset(lines, gapEndLine + 1) - 1;

                    const reference: ChunkReference = {
                        relativePath,
                        lineStart: gapStartLine,
                        lineEnd: gapEndLine,
                        charStart,
                        charEnd,
                    };

                    result.push(new HashedChunk({
                        text: gapText,
                        type: 'block',
                        name: null,
                        language,
                        reference,
                        metadata: { gapFill: true },
                    }));
                }
            }

            result.push(chunk);
            currentLine = chunk.reference.lineEnd + 1;
        }

        // Check for gap after last chunk
        if (currentLine <= lines.length) {
            const gapLines = lines.slice(currentLine - 1);
            const gapText = gapLines.join('\n').trim();

            if (gapText.length >= this.config.minChunkSize) {
                const charStart = this.getCharOffset(lines, currentLine);
                const charEnd = code.length;

                const reference: ChunkReference = {
                    relativePath,
                    lineStart: currentLine,
                    lineEnd: lines.length,
                    charStart,
                    charEnd,
                };

                result.push(new HashedChunk({
                    text: gapText,
                    type: 'block',
                    name: null,
                    language,
                    reference,
                    metadata: { gapFill: true },
                }));
            }
        }

        return result;
    }

    /**
     * Calculate character offset for a given line number
     */
    private getCharOffset(lines: string[], lineNumber: number): number {
        let offset = 0;
        for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for newline
        }
        return offset;
    }

    /**
     * Fallback to line-based chunking when AST parsing fails
     */
    private fallbackHash(code: string, language: string, relativePath: string): HashedChunk[] {
        const chunks: HashedChunk[] = [];
        const lines = code.split('\n');
        const { fallbackLineSize, fallbackOverlap, minChunkSize } = this.config;

        for (let i = 0; i < lines.length; i += (fallbackLineSize - fallbackOverlap)) {
            const lineStart = i + 1;
            const lineEnd = Math.min(i + fallbackLineSize, lines.length);
            const chunkLines = lines.slice(i, lineEnd);
            const text = chunkLines.join('\n').trim();

            if (text.length >= minChunkSize) {
                const charStart = this.getCharOffset(lines, lineStart);
                const charEnd = this.getCharOffset(lines, lineEnd + 1) - 1;

                const reference: ChunkReference = {
                    relativePath,
                    lineStart,
                    lineEnd,
                    charStart,
                    charEnd,
                };

                chunks.push(new HashedChunk({
                    text,
                    type: 'block',
                    name: null,
                    language,
                    reference,
                    metadata: { fallback: true },
                }));
            }
        }

        return chunks;
    }
}
