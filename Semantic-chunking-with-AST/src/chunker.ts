import { Parser, Language, Node } from 'web-tree-sitter';
import { getSemanticTypes } from './semantic-nodes';
import { SemanticChunk, ChunkType, ChunkMetadata } from './chunk';

/**
 * Configuration for the semantic chunker
 */
export interface ChunkerConfig {
    maxChunkSize: number;      // Max characters per chunk
    minChunkSize: number;      // Min characters (skip tiny chunks)
    fallbackLineSize: number;  // Lines per chunk when falling back
    fallbackOverlap: number;   // Overlap lines in fallback mode
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: ChunkerConfig = {
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
 * AST-based Semantic Code Chunker
 * Splits code by semantic boundaries (functions, classes, etc.)
 */
export class SemanticChunker {
    private config: ChunkerConfig;
    private parser: Parser | null = null;
    private languages: Map<string, Language> = new Map();

    constructor(config: Partial<ChunkerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize Tree-sitter and load language grammars
     */
    async initialize(languageConfigs: LanguageConfigs): Promise<void> {
        await Parser.init();
        this.parser = new Parser();

        // Load each language grammar
        for (const [lang, wasmPath] of Object.entries(languageConfigs)) {
            const language = await Language.load(wasmPath);
            this.languages.set(lang, language);
        }
    }

    /**
     * Chunk source code into semantic units
     *
     * @param code - Source code to chunk
     * @param language - Language identifier (javascript, python, etc.)
     * @returns Array of semantic chunks
     */
    chunk(code: string, language: string): SemanticChunk[] {
        const langGrammar = this.languages.get(language);

        if (!langGrammar || !this.parser) {
            console.warn(`Language '${language}' not loaded, using fallback`);
            return this.fallbackChunk(code, language);
        }

        // Parse the code
        this.parser.setLanguage(langGrammar);
        const tree = this.parser.parse(code);

        if (!tree) {
            console.warn(`Failed to parse code for language '${language}', using fallback`);
            return this.fallbackChunk(code, language);
        }

        // Extract semantic chunks
        const chunks: SemanticChunk[] = [];
        const semanticTypes = getSemanticTypes(language);

        this.extractChunks(tree.rootNode, code, language, semanticTypes, chunks);

        // Fill gaps between chunks
        return this.fillGaps(chunks, code, language);
    }

    /**
     * Recursively extract semantic chunks from AST
     */
    private extractChunks(
        node: Node,
        code: string,
        language: string,
        semanticTypes: string[],
        chunks: SemanticChunk[],
        parentName: string | null = null
    ): void {
        // Check if this node is a semantic unit
        if (semanticTypes.includes(node.type)) {
            const text = node.text;
            const charCount = text.length;

            // Check size constraints
            if (charCount >= this.config.minChunkSize) {
                if (charCount <= this.config.maxChunkSize) {
                    // Good size - extract as a chunk
                    const chunk = this.createChunk(node, code, language, parentName);
                    chunks.push(chunk);
                    return; // Don't recurse into children
                } else {
                    // Too large - try to split by children
                    const childChunks = this.splitLargeNode(node, code, language, semanticTypes);
                    if (childChunks.length > 0) {
                        chunks.push(...childChunks);
                        return;
                    }
                    // If no children found, fall through to extract anyway
                    const chunk = this.createChunk(node, code, language, parentName);
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
                this.extractChunks(child, code, language, semanticTypes, chunks, newParent);
            }
        }
    }

    /**
     * Create a SemanticChunk from an AST node
     */
    private createChunk(
        node: Node,
        code: string,
        language: string,
        parentName: string | null
    ): SemanticChunk {
        const name = this.getNodeName(node);
        const type = this.getChunkType(node.type);
        const metadata = this.extractMetadata(node, language);

        if (parentName) {
            metadata.parent = parentName;
        }

        return new SemanticChunk({
            text: node.text,
            type,
            name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            language,
            metadata,
        });
    }

    /**
     * Extract the name from a node (function name, class name, etc.)
     */
    private getNodeName(node: Node): string | null {
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
    private extractMetadata(node: Node, _language: string): ChunkMetadata {
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
        node: Node,
        code: string,
        language: string,
        semanticTypes: string[]
    ): SemanticChunk[] {
        const chunks: SemanticChunk[] = [];

        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child && semanticTypes.includes(child.type) && child.text.length >= this.config.minChunkSize) {
                const parentName = this.getNodeName(node);
                const chunk = this.createChunk(child, code, language, parentName);
                chunks.push(chunk);
            }
        }

        return chunks;
    }

    /**
     * Fill gaps between semantic chunks with block chunks
     */
    private fillGaps(chunks: SemanticChunk[], code: string, language: string): SemanticChunk[] {
        if (chunks.length === 0) {
            return this.fallbackChunk(code, language);
        }

        // Sort chunks by line number
        chunks.sort((a, b) => a.lineStart - b.lineStart);

        const lines = code.split('\n');
        const result: SemanticChunk[] = [];
        let currentLine = 1;

        for (const chunk of chunks) {
            // Check for gap before this chunk
            if (chunk.lineStart > currentLine) {
                const gapText = lines.slice(currentLine - 1, chunk.lineStart - 1).join('\n').trim();

                if (gapText.length >= this.config.minChunkSize) {
                    result.push(new SemanticChunk({
                        text: gapText,
                        type: 'block',
                        name: null,
                        lineStart: currentLine,
                        lineEnd: chunk.lineStart - 1,
                        language,
                        metadata: { gapFill: true },
                    }));
                }
            }

            result.push(chunk);
            currentLine = chunk.lineEnd + 1;
        }

        // Check for gap after last chunk
        if (currentLine <= lines.length) {
            const gapText = lines.slice(currentLine - 1).join('\n').trim();

            if (gapText.length >= this.config.minChunkSize) {
                result.push(new SemanticChunk({
                    text: gapText,
                    type: 'block',
                    name: null,
                    lineStart: currentLine,
                    lineEnd: lines.length,
                    language,
                    metadata: { gapFill: true },
                }));
            }
        }

        return result;
    }

    /**
     * Fallback to line-based chunking when AST parsing fails
     */
    private fallbackChunk(code: string, language: string): SemanticChunk[] {
        const chunks: SemanticChunk[] = [];
        const lines = code.split('\n');
        const { fallbackLineSize, fallbackOverlap, minChunkSize } = this.config;

        for (let i = 0; i < lines.length; i += (fallbackLineSize - fallbackOverlap)) {
            const lineStart = i + 1;
            const lineEnd = Math.min(i + fallbackLineSize, lines.length);
            const chunkLines = lines.slice(i, lineEnd);
            const text = chunkLines.join('\n').trim();

            if (text.length >= minChunkSize) {
                chunks.push(new SemanticChunk({
                    text,
                    type: 'block',
                    name: null,
                    lineStart,
                    lineEnd,
                    language,
                    metadata: { fallback: true },
                }));
            }
        }

        return chunks;
    }

    /**
     * Extract methods from a class chunk as separate chunks
     * Useful when a class exceeds maxChunkSize
     */
    extractMethodsFromClass(classChunk: SemanticChunk): SemanticChunk[] {
        const chunks: SemanticChunk[] = [];
        const language = classChunk.language;
        const langGrammar = this.languages.get(language);

        if (!langGrammar || !this.parser) {
            return chunks;
        }

        // Parse the class body
        this.parser.setLanguage(langGrammar);
        const tree = this.parser.parse(classChunk.text);

        if (!tree) {
            return chunks;
        }

        // Find method definitions
        const findMethods = (node: Node): void => {
            if (node.type === 'method_definition') {
                const name = node.childForFieldName('name')?.text ?? null;
                chunks.push(new SemanticChunk({
                    text: node.text,
                    type: 'method',
                    name: name,
                    lineStart: classChunk.lineStart + node.startPosition.row,
                    lineEnd: classChunk.lineStart + node.endPosition.row,
                    language: language,
                    metadata: {
                        parent: classChunk.name ?? undefined,
                    },
                }));
            }
            for (let i = 0; i < node.namedChildCount; i++) {
                const child = node.namedChild(i);
                if (child) {
                    findMethods(child);
                }
            }
        };

        findMethods(tree.rootNode);
        return chunks;
    }

    /**
     * Add overlap context to chunks for better boundary queries
     * Each chunk gets lines from neighboring chunks
     */
    addOverlap(chunks: SemanticChunk[], code: string, overlapLines: number = 5): SemanticChunk[] {
        const lines = code.split('\n');

        return chunks.map((chunk, i) => {
            // Get context from previous chunk
            let prefix = '';
            if (i > 0) {
                const prevEnd = chunks[i - 1].lineEnd;
                const contextStart = Math.max(prevEnd - overlapLines, 0);
                prefix = lines.slice(contextStart, prevEnd).join('\n');
            }

            // Get context from next chunk
            let suffix = '';
            if (i < chunks.length - 1) {
                const nextStart = chunks[i + 1].lineStart - 1;
                const contextEnd = Math.min(nextStart + overlapLines, lines.length);
                suffix = lines.slice(nextStart, contextEnd).join('\n');
            }

            // Create new chunk with overlap text
            const textWithOverlap = [prefix, chunk.text, suffix].filter(Boolean).join('\n\n// ---\n\n');

            return new SemanticChunk({
                text: textWithOverlap,
                type: chunk.type,
                name: chunk.name,
                lineStart: chunk.lineStart,
                lineEnd: chunk.lineEnd,
                language: chunk.language,
                metadata: {
                    ...chunk.metadata,
                    hasOverlap: true,
                    originalCharCount: chunk.charCount,
                },
            });
        });
    }
}
