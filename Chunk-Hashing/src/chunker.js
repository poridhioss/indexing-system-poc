const TreeSitter = require('web-tree-sitter');
const Parser = TreeSitter.Parser;
const { getSemanticTypes } = require('./semantic-nodes');
const { SemanticChunk } = require('./chunk');

/**
 * Configuration for the semantic chunker
 */
const DEFAULT_CONFIG = {
    maxChunkSize: 8000,      // Max characters per chunk
    minChunkSize: 100,       // Min characters (skip tiny chunks)
    fallbackLineSize: 50,    // Lines per chunk when falling back
    fallbackOverlap: 10,     // Overlap lines in fallback mode
};

/**
 * AST-based Semantic Code Chunker
 * Splits code by semantic boundaries (functions, classes, etc.)
 */
class SemanticChunker {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.parser = null;
        this.languages = {};
    }

    /**
     * Initialize Tree-sitter and load language grammars
     */
    async initialize(languageConfigs) {
        await Parser.init();
        this.parser = new Parser();

        // Load each language grammar
        for (const [lang, wasmPath] of Object.entries(languageConfigs)) {
            this.languages[lang] = await TreeSitter.Language.load(wasmPath);
        }
    }

    /**
     * Chunk source code into semantic units
     *
     * @param {string} code - Source code to chunk
     * @param {string} language - Language identifier (javascript, python, etc.)
     * @returns {SemanticChunk[]} Array of semantic chunks
     */
    chunk(code, language) {
        if (!this.languages[language]) {
            console.warn(`Language '${language}' not loaded, using fallback`);
            return this._fallbackChunk(code, language);
        }

        // Parse the code
        this.parser.setLanguage(this.languages[language]);
        const tree = this.parser.parse(code);

        // Extract semantic chunks
        const chunks = [];
        const semanticTypes = getSemanticTypes(language);

        this._extractChunks(tree.rootNode, code, language, semanticTypes, chunks);

        // Fill gaps between chunks
        const filledChunks = this._fillGaps(chunks, code, language);

        return filledChunks;
    }

    /**
     * Recursively extract semantic chunks from AST
     */
    _extractChunks(node, code, language, semanticTypes, chunks, parentName = null) {
        // Check if this node is a semantic unit
        if (semanticTypes.includes(node.type)) {
            const text = node.text;
            // console.log(node)
            const charCount = text.length;

            // Check size constraints
            if (charCount >= this.config.minChunkSize) {
                if (charCount <= this.config.maxChunkSize) {
                    // Good size - extract as a chunk
                    const chunk = this._createChunk(node, code, language, parentName);
                    chunks.push(chunk);
                    return; // Don't recurse into children
                } else {
                    // Too large - try to split by children
                    const childChunks = this._splitLargeNode(node, code, language, semanticTypes);
                    if (childChunks.length > 0) {
                        chunks.push(...childChunks);
                        return;
                    }
                    // If no children found, fall through to extract anyway
                    const chunk = this._createChunk(node, code, language, parentName);
                    chunks.push(chunk);
                    return;
                }
            }
        }

        // Recurse into named children
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            const newParent = this._getNodeName(node) || parentName;
            this._extractChunks(child, code, language, semanticTypes, chunks, newParent);
        }
    }

    /**
     * Create a SemanticChunk from an AST node
     */
    _createChunk(node, code, language, parentName) {
        const name = this._getNodeName(node);
        const type = this._getChunkType(node.type);
        const metadata = this._extractMetadata(node, language);

        if (parentName) {
            metadata.parent = parentName;
        }

        return new SemanticChunk({
            text: node.text,
            type: type,
            name: name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            language: language,
            metadata: metadata,
        });
    }

    /**
     * Extract the name from a node (function name, class name, etc.)
     */
    _getNodeName(node) {
        // Try common field names
        const nameNode = node.childForFieldName('name') ||
                         node.childForFieldName('identifier');

        if (nameNode) {
            return nameNode.text;
        }

        // For arrow functions assigned to variables
        if (node.type === 'arrow_function' && node.parent?.type === 'variable_declarator') {
            return node.parent.childForFieldName('name')?.text;
        }

        // For exported declarations
        if (node.type === 'export_statement') {
            const declaration = node.childForFieldName('declaration');
            if (declaration) {
                return this._getNodeName(declaration);
            }
        }

        return null;
    }

    /**
     * Map AST node type to chunk type
     */
    _getChunkType(nodeType) {
        const typeMap = {
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
        return typeMap[nodeType] || 'block';
    }

    /**
     * Extract metadata from a node (parameters, return type, etc.)
     */
    _extractMetadata(node, language) {
        const metadata = {};

        // Extract parameters
        const params = node.childForFieldName('parameters');
        if (params) {
            metadata.parameters = [];
            for (let i = 0; i < params.namedChildCount; i++) {
                const param = params.namedChild(i);
                metadata.parameters.push(param.text);
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
    _splitLargeNode(node, code, language, semanticTypes) {
        const chunks = [];

        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (semanticTypes.includes(child.type) && child.text.length >= this.config.minChunkSize) {
                const parentName = this._getNodeName(node);
                const chunk = this._createChunk(child, code, language, parentName);
                chunks.push(chunk);
            }
        }

        return chunks;
    }

    /**
     * Fill gaps between semantic chunks with block chunks
     */
    _fillGaps(chunks, code, language) {
        if (chunks.length === 0) {
            return this._fallbackChunk(code, language);
        }

        // Sort chunks by line number
        chunks.sort((a, b) => a.lineStart - b.lineStart);

        const lines = code.split('\n');
        const result = [];
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
                        language: language,
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
                    language: language,
                    metadata: { gapFill: true },
                }));
            }
        }

        return result;
    }

    /**
     * Fallback to line-based chunking when AST parsing fails
     */
    _fallbackChunk(code, language) {
        const chunks = [];
        const lines = code.split('\n');
        const { fallbackLineSize, fallbackOverlap, minChunkSize } = this.config;

        for (let i = 0; i < lines.length; i += (fallbackLineSize - fallbackOverlap)) {
            const lineStart = i + 1;
            const lineEnd = Math.min(i + fallbackLineSize, lines.length);
            const chunkLines = lines.slice(i, lineEnd);
            const text = chunkLines.join('\n').trim();

            if (text.length >= minChunkSize) {
                chunks.push(new SemanticChunk({
                    text: text,
                    type: 'block',
                    name: null,
                    lineStart: lineStart,
                    lineEnd: lineEnd,
                    language: language,
                    metadata: { fallback: true },
                }));
            }
        }

        return chunks;
    }
}

module.exports = { SemanticChunker, DEFAULT_CONFIG };