# AST-Based Semantic Code Chunking

When building AI-powered code search or retrieval-augmented generation (RAG) systems, how you split code into chunks dramatically affects quality. In this lab, you'll build a semantic code chunker that uses Tree-sitter ASTs to split code by meaningful boundaries—functions, classes, and methods—instead of arbitrary line counts.

This is exactly how Cursor, PUKU-Editor, GitHub Copilot, and production AI code assistants chunk code for embeddings and search.

## Prerequisites

- Familiarity with JavaScript/TypeScript and Node.js
- Node.js 18+ installed

## Project Overview

## What You'll Learn

1. Why semantic chunking produces better embeddings than line-based
2. Identifying semantic boundaries in code (functions, classes, methods)
3. Building a multi-language semantic chunker
4. Handling edge cases (large functions, nested structures)
5. Adding metadata to chunks for better retrieval
6. Gap-filling strategies for code between functions

## Part 1: Semantic Chunking

### Why Chunk Code at All?

AI embedding models have token limits (typically 512-8192 tokens). A large codebase can't be embedded as one unit. We must split it into chunks that:

1. **Fit the model's context window** - Under token limit
2. **Preserve meaning** - Complete semantic units
3. **Enable retrieval** - Searchable, relevant segments

### Line-Based Chunking Problems

Traditional text splitters fail with code:

```python
# Line-based chunker (500 chars per chunk)
def calculate_order_total(items, tax_rate, discount_co  # ← Cut here!
de):
    """Calculate the total price of an order."""
    subtotal = sum(item.price * item.quantity for item in items)
```

**Problems:**
- `discount_code` becomes `discount_co` and `de`
- Embedding model sees broken identifiers
- Search for "discount" won't match this chunk

### Semantic Chunking

The word `Semantic` means "related to meaning." A semantic chunker splits code at meaningful boundaries:

```python
# Semantic chunker (by function boundaries)

# Chunk 1: Complete function
def calculate_order_total(items, tax_rate, discount_code):
    """Calculate the total price of an order."""
    subtotal = sum(item.price * item.quantity for item in items)
    discount = apply_discount(subtotal, discount_code)
    return (subtotal - discount) * (1 + tax_rate)

# Chunk 2: Complete function
def apply_discount(amount, code):
    """Apply discount code to amount."""
    discounts = {"SAVE10": 0.10, "SAVE20": 0.20}
    return amount * discounts.get(code, 0)
```

**Benefits:**
- Complete functions with full signatures
- Docstrings included for context
- Better embeddings = better search

### What Makes a "Semantic Unit"?

| Language | Semantic Units |
|----------|----------------|
| **JavaScript/TypeScript** | function, class, method, arrow function, interface |
| **Python** | function (def), class, method, async def |
| **Go** | function, method, struct, interface |
| **Rust** | fn, impl, struct, enum, trait |
| **Java** | class, method, interface |


## Part 2: Building the Semantic Chunker

### Project Setup

Create a new project:

```bash
mkdir semantic-chunker
cd semantic-chunker
npm init -y
npm install web-tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-python
```

### Core Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SEMANTIC CHUNKER ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   Source Code ──► Tree-sitter ──► AST ──► Node Filter ──► Size Check ──► Chunks │
│                                              │               │                   │
│                                              ▼               ▼                   │
│                                        Function?         Too big?                │
│                                        Class?            Split children          │
│                                        Method?           or fallback             │
│                                              │               │                   │
│                                              ▼               ▼                   │
│                                         Extract           Recurse                │
│                                         Metadata          or Line-split          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Define Semantic Node Types

Create `src/semantic-nodes.js`:

```javascript
/**
 * Semantic node types for different languages
 * These are AST node types that represent meaningful code units
 */
const SEMANTIC_NODES = {
    javascript: {
        // Top-level declarations
        function: ['function_declaration', 'generator_function_declaration'],
        class: ['class_declaration'],
        method: ['method_definition'],
        arrow: ['arrow_function'],
        variable: ['lexical_declaration', 'variable_declaration'],
        export: ['export_statement'],
    },
    typescript: {
        function: ['function_declaration', 'generator_function_declaration'],
        class: ['class_declaration'],
        method: ['method_definition'],
        arrow: ['arrow_function'],
        interface: ['interface_declaration'],
        type: ['type_alias_declaration'],
        enum: ['enum_declaration'],
        variable: ['lexical_declaration', 'variable_declaration'],
        export: ['export_statement'],
    },
    python: {
        function: ['function_definition'],
        class: ['class_definition'],
        // Python methods are function_definition inside class_definition
        decorated: ['decorated_definition'],
    },
    go: {
        function: ['function_declaration'],
        method: ['method_declaration'],
        type: ['type_declaration'],
        struct: ['struct_type'],
        interface: ['interface_type'],
    },
    rust: {
        function: ['function_item'],
        impl: ['impl_item'],
        struct: ['struct_item'],
        enum: ['enum_item'],
        trait: ['trait_item'],
        mod: ['mod_item'],
    },
};

/**
 * Get all semantic node types for a language (flattened)
 */
function getSemanticTypes(language) {
    const langNodes = SEMANTIC_NODES[language];
    if (!langNodes) return [];
    return Object.values(langNodes).flat();
}

module.exports = { SEMANTIC_NODES, getSemanticTypes };
```

### Step 2: The Chunk Data Structure

Create `src/chunk.js`:

```javascript
/**
 * Represents a semantic code chunk
 */
class SemanticChunk {
    constructor({
        text,
        type,
        name,
        lineStart,
        lineEnd,
        language,
        metadata = {}
    }) {
        this.text = text;
        this.type = type;           // 'function', 'class', 'method', 'block'
        this.name = name;           // Function/class name or null
        this.lineStart = lineStart; // 1-indexed
        this.lineEnd = lineEnd;     // 1-indexed
        this.language = language;
        this.metadata = metadata;   // Extra info (params, return type, etc.)
    }

    /**
     * Character count (for size limits)
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
     * Create a summary string for debugging
     */
    toString() {
        return `[${this.type}] ${this.name || '(anonymous)'} (lines ${this.lineStart}-${this.lineEnd}, ${this.charCount} chars)`;
    }
}

module.exports = { SemanticChunk };
```

### Step 3: The Core Chunker

Create `src/chunker.js`:

```javascript
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
```

---

## Part 3: Using the Chunker

### Basic Usage Example

Create `src/example.js`:

```javascript
const { SemanticChunker } = require('./chunker');
const path = require('path');

async function main() {
    // Initialize chunker with language grammars
    const chunker = new SemanticChunker({
        maxChunkSize: 4000,
        minChunkSize: 50,
    });

    await chunker.initialize({
        javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
        python: require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    });

    // Sample JavaScript code
    const jsCode = `
/**
 * User management module
 */
import { db } from './database';

const MAX_RETRIES = 3;

/**
 * Fetch a user by ID
 * @param {string} id - User ID
 * @returns {Promise<User>}
 */
async function getUser(id) {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await db.users.findById(id);
        } catch (err) {
            if (i === MAX_RETRIES - 1) throw err;
        }
    }
}

/**
 * User service class
 */
class UserService {
    constructor(database) {
        this.db = database;
    }

    async create(userData) {
        const user = new User(userData);
        await this.db.users.insert(user);
        return user;
    }

    async update(id, changes) {
        return await this.db.users.update(id, changes);
    }

    async delete(id) {
        return await this.db.users.remove(id);
    }
}

// Helper function
const validateEmail = (email) => {
    return email.includes('@') && email.includes('.');
};

export { getUser, UserService, validateEmail };
    `.trim();

    console.log('=== JavaScript Chunks ===\n');
    const jsChunks = chunker.chunk(jsCode, 'javascript');

    jsChunks.forEach((chunk, i) => {
        console.log(`--- Chunk ${i + 1} ---`);
        console.log(`Type: ${chunk.type}`);
        console.log(`Name: ${chunk.name || '(none)'}`);
        console.log(`Lines: ${chunk.lineStart}-${chunk.lineEnd} (${chunk.lineCount} lines)`);
        console.log(`Size: ${chunk.charCount} characters`);
        if (Object.keys(chunk.metadata).length > 0) {
            console.log(`Metadata:`, chunk.metadata);
        }
        console.log(`Preview: ${chunk.text.split('\n')[0].substring(0, 60)}...`);
        console.log();
    });

    // Sample Python code
    const pyCode = `
"""
User authentication module
"""
from typing import Optional
from hashlib import sha256

class AuthenticationError(Exception):
    """Raised when authentication fails."""
    pass

def hash_password(password: str) -> str:
    """Hash a password using SHA-256."""
    return sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    return hash_password(password) == hashed

class Authenticator:
    """Handles user authentication."""

    def __init__(self, user_store):
        self.users = user_store

    def login(self, username: str, password: str) -> Optional[str]:
        """Attempt to log in a user."""
        user = self.users.get(username)
        if not user:
            raise AuthenticationError("User not found")

        if not verify_password(password, user.password_hash):
            raise AuthenticationError("Invalid password")

        return self._generate_token(user)

    def _generate_token(self, user) -> str:
        """Generate an authentication token."""
        import secrets
        return secrets.token_urlsafe(32)
    `.trim();

    console.log('\n=== Python Chunks ===\n');
    const pyChunks = chunker.chunk(pyCode, 'python');

    pyChunks.forEach((chunk, i) => {
        console.log(`--- Chunk ${i + 1} ---`);
        console.log(`Type: ${chunk.type}`);
        console.log(`Name: ${chunk.name || '(none)'}`);
        console.log(`Lines: ${chunk.lineStart}-${chunk.lineEnd}`);
        console.log(`Size: ${chunk.charCount} characters`);
        console.log(`Preview: ${chunk.text.split('\n')[0].substring(0, 60)}...`);
        console.log();
    });
}

main().catch(console.error);
```

**Expected Output:**
```
=== JavaScript Chunks ===

--- Chunk 1 ---
Type: block
Name: (none)
Lines: 1-6 (6 lines)
Size: 89 characters
Metadata: { gapFill: true }
Preview: /**
 * User management module
 */
import { db } from './data...

--- Chunk 2 ---
Type: function
Name: getUser
Lines: 8-19 (12 lines)
Size: 312 characters
Metadata: { parameters: [ 'id' ], async: true }
Preview: /**
 * Fetch a user by ID
 * @param {string} id - User ID...

--- Chunk 3 ---
Type: class
Name: UserService
Lines: 21-40 (20 lines)
Size: 456 characters
Metadata: {}
Preview: /**
 * User service class
 */
class UserService {...

--- Chunk 4 ---
Type: function
Name: validateEmail
Lines: 42-44 (3 lines)
Size: 78 characters
Metadata: { parameters: [ 'email' ] }
Preview: const validateEmail = (email) => {...

--- Chunk 5 ---
Type: block
Name: (none)
Lines: 46-46 (1 lines)
Size: 52 characters
Metadata: { gapFill: true }
Preview: export { getUser, UserService, validateEmail };...
```

---

## Part 4: Advanced Features

### Adding Contextualized Text

For better embeddings, prepend context to each chunk:

```javascript
/**
 * Generate contextualized text for embedding
 * Includes file path, scope chain, and metadata
 */
function contextualizeChunk(chunk, filePath) {
    const lines = [];

    // File context
    lines.push(`File: ${filePath}`);

    // Scope/hierarchy
    if (chunk.metadata.parent) {
        lines.push(`Parent: ${chunk.metadata.parent}`);
    }

    // Type and name
    if (chunk.name) {
        lines.push(`${chunk.type}: ${chunk.name}`);
    }

    // Parameters (for functions)
    if (chunk.metadata.parameters?.length > 0) {
        lines.push(`Parameters: ${chunk.metadata.parameters.join(', ')}`);
    }

    // Return type (TypeScript)
    if (chunk.metadata.returnType) {
        lines.push(`Returns: ${chunk.metadata.returnType}`);
    }

    // Separator
    lines.push('---');

    // Actual code
    lines.push(chunk.text);

    return lines.join('\n');
}

// Example usage:
const contextualizedText = contextualizeChunk(chunk, 'src/services/user.js');

/*
Output:
File: src/services/user.js
Parent: UserService
method: create
Parameters: userData
---
async create(userData) {
    const user = new User(userData);
    await this.db.users.insert(user);
    return user;
}
*/
```

### Handling Nested Structures

For classes with methods, extract methods as separate chunks:

```javascript
/**
 * Extract methods from a class as separate chunks
 */
function extractMethodsFromClass(classChunk, code, language) {
    const chunks = [];

    // Parse the class body
    const parser = new Parser();
    parser.setLanguage(languages[language]);
    const tree = parser.parse(classChunk.text);

    // Find method definitions
    function findMethods(node) {
        if (node.type === 'method_definition') {
            const name = node.childForFieldName('name')?.text;
            chunks.push(new SemanticChunk({
                text: node.text,
                type: 'method',
                name: name,
                lineStart: classChunk.lineStart + node.startPosition.row,
                lineEnd: classChunk.lineStart + node.endPosition.row,
                language: language,
                metadata: {
                    parent: classChunk.name,
                    className: classChunk.name,
                },
            }));
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            findMethods(node.namedChild(i));
        }
    }

    findMethods(tree.rootNode);
    return chunks;
}
```

### Overlap Support for Boundary Queries

Add overlapping context to help with queries that span chunk boundaries:

```javascript
/**
 * Add overlap to chunks
 */
function addOverlap(chunks, code, overlapLines = 5) {
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

        return {
            ...chunk,
            textWithOverlap: [prefix, chunk.text, suffix].filter(Boolean).join('\n\n// ---\n\n'),
            metadata: {
                ...chunk.metadata,
                hasOverlap: true,
            },
        };
    });
}
```

---

## Part 5: Complete Working Example

Create `src/complete-example.js`:

```javascript
const TreeSitter = require('web-tree-sitter');
const Parser = TreeSitter.Parser;

/**
 * Production-ready Semantic Code Chunker
 */
class ProductionChunker {
    constructor(config = {}) {
        this.config = {
            maxChunkSize: config.maxChunkSize || 8000,
            minChunkSize: config.minChunkSize || 100,
            includeMetadata: config.includeMetadata !== false,
            contextualizeText: config.contextualizeText || false,
        };
        this.parser = null;
        this.languages = new Map();
    }

    async init() {
        await Parser.init();
        this.parser = new Parser();
    }

    async loadLanguage(name, wasmPath) {
        const lang = await TreeSitter.Language.load(wasmPath);
        this.languages.set(name, lang);
    }

    chunk(code, language, filePath = 'unknown') {
        const langGrammar = this.languages.get(language);
        if (!langGrammar) {
            return this._fallbackChunk(code, language, filePath);
        }

        this.parser.setLanguage(langGrammar);
        const tree = this.parser.parse(code);
        const chunks = [];

        this._traverse(tree.rootNode, code, language, filePath, chunks);

        // Sort and fill gaps
        return this._fillGaps(chunks, code, language, filePath);
    }

    _traverse(node, code, language, filePath, chunks, context = {}) {
        const semanticTypes = this._getSemanticTypes(language);

        if (semanticTypes.includes(node.type)) {
            const size = node.text.length;

            if (size >= this.config.minChunkSize && size <= this.config.maxChunkSize) {
                chunks.push(this._createChunk(node, language, filePath, context));
                return; // Don't recurse
            }

            if (size > this.config.maxChunkSize) {
                // Recurse into children with updated context
                const newContext = {
                    ...context,
                    parent: this._getName(node) || context.parent,
                };
                for (let i = 0; i < node.namedChildCount; i++) {
                    this._traverse(node.namedChild(i), code, language, filePath, chunks, newContext);
                }
                return;
            }
        }

        // Recurse into children
        for (let i = 0; i < node.namedChildCount; i++) {
            this._traverse(node.namedChild(i), code, language, filePath, chunks, context);
        }
    }

    _createChunk(node, language, filePath, context) {
        const name = this._getName(node);
        const type = this._getType(node.type);

        const chunk = {
            text: node.text,
            type: type,
            name: name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            charCount: node.text.length,
            language: language,
            filePath: filePath,
        };

        if (this.config.includeMetadata) {
            chunk.metadata = this._extractMetadata(node, context);
        }

        if (this.config.contextualizeText) {
            chunk.contextualizedText = this._contextualize(chunk);
        }

        return chunk;
    }

    _getName(node) {
        return node.childForFieldName('name')?.text ||
               node.childForFieldName('identifier')?.text ||
               (node.type === 'arrow_function' && node.parent?.type === 'variable_declarator'
                   ? node.parent.childForFieldName('name')?.text
                   : null);
    }

    _getType(nodeType) {
        const map = {
            'function_declaration': 'function',
            'function_definition': 'function',
            'arrow_function': 'function',
            'method_definition': 'method',
            'class_declaration': 'class',
            'class_definition': 'class',
            'interface_declaration': 'interface',
        };
        return map[nodeType] || 'block';
    }

    _getSemanticTypes(language) {
        const types = {
            javascript: ['function_declaration', 'class_declaration', 'method_definition', 'arrow_function'],
            typescript: ['function_declaration', 'class_declaration', 'method_definition', 'arrow_function', 'interface_declaration'],
            python: ['function_definition', 'class_definition'],
        };
        return types[language] || [];
    }

    _extractMetadata(node, context) {
        const meta = {};

        if (context.parent) {
            meta.parent = context.parent;
        }

        const params = node.childForFieldName('parameters');
        if (params) {
            meta.parameters = [];
            for (let i = 0; i < params.namedChildCount; i++) {
                meta.parameters.push(params.namedChild(i).text);
            }
        }

        if (node.text.trimStart().startsWith('async')) {
            meta.async = true;
        }

        return meta;
    }

    _contextualize(chunk) {
        const lines = [`// File: ${chunk.filePath}`];

        if (chunk.metadata?.parent) {
            lines.push(`// Parent: ${chunk.metadata.parent}`);
        }

        if (chunk.name) {
            lines.push(`// ${chunk.type}: ${chunk.name}`);
        }

        lines.push('');
        lines.push(chunk.text);

        return lines.join('\n');
    }

    _fillGaps(chunks, code, language, filePath) {
        if (chunks.length === 0) {
            return this._fallbackChunk(code, language, filePath);
        }

        chunks.sort((a, b) => a.lineStart - b.lineStart);
        const lines = code.split('\n');
        const result = [];
        let current = 1;

        for (const chunk of chunks) {
            if (chunk.lineStart > current) {
                const gap = lines.slice(current - 1, chunk.lineStart - 1).join('\n').trim();
                if (gap.length >= this.config.minChunkSize) {
                    result.push({
                        text: gap,
                        type: 'block',
                        name: null,
                        lineStart: current,
                        lineEnd: chunk.lineStart - 1,
                        charCount: gap.length,
                        language: language,
                        filePath: filePath,
                        metadata: { gapFill: true },
                    });
                }
            }
            result.push(chunk);
            current = chunk.lineEnd + 1;
        }

        // Trailing gap
        if (current <= lines.length) {
            const gap = lines.slice(current - 1).join('\n').trim();
            if (gap.length >= this.config.minChunkSize) {
                result.push({
                    text: gap,
                    type: 'block',
                    name: null,
                    lineStart: current,
                    lineEnd: lines.length,
                    charCount: gap.length,
                    language: language,
                    filePath: filePath,
                    metadata: { gapFill: true },
                });
            }
        }

        return result;
    }

    _fallbackChunk(code, language, filePath) {
        const lines = code.split('\n');
        const chunks = [];
        const size = 50;
        const overlap = 10;

        for (let i = 0; i < lines.length; i += size - overlap) {
            const start = i + 1;
            const end = Math.min(i + size, lines.length);
            const text = lines.slice(i, end).join('\n').trim();

            if (text.length >= this.config.minChunkSize) {
                chunks.push({
                    text: text,
                    type: 'block',
                    name: null,
                    lineStart: start,
                    lineEnd: end,
                    charCount: text.length,
                    language: language,
                    filePath: filePath,
                    metadata: { fallback: true },
                });
            }
        }

        return chunks;
    }
}

// ============================================
// Demo
// ============================================

async function demo() {
    const chunker = new ProductionChunker({
        maxChunkSize: 4000,
        minChunkSize: 50,
        includeMetadata: true,
        contextualizeText: true,
    });

    await chunker.init();
    await chunker.loadLanguage('javascript',
        require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'));

    const code = `
/**
 * Shopping cart module
 */
const TAX_RATE = 0.08;

class ShoppingCart {
    constructor() {
        this.items = [];
    }

    addItem(product, quantity) {
        this.items.push({ product, quantity });
    }

    removeItem(productId) {
        this.items = this.items.filter(i => i.product.id !== productId);
    }

    getTotal() {
        const subtotal = this.items.reduce(
            (sum, item) => sum + item.product.price * item.quantity,
            0
        );
        return subtotal * (1 + TAX_RATE);
    }
}

function formatCurrency(amount) {
    return '$' + amount.toFixed(2);
}

export { ShoppingCart, formatCurrency };
    `.trim();

    console.log('=== Semantic Chunking Demo ===\n');
    const chunks = chunker.chunk(code, 'javascript', 'src/cart.js');

    chunks.forEach((chunk, i) => {
        console.log(`\n========== Chunk ${i + 1} ==========`);
        console.log(`Type: ${chunk.type}`);
        console.log(`Name: ${chunk.name || '(anonymous)'}`);
        console.log(`Lines: ${chunk.lineStart}-${chunk.lineEnd}`);
        console.log(`Size: ${chunk.charCount} chars`);
        console.log(`Metadata:`, JSON.stringify(chunk.metadata, null, 2));
        console.log(`\n--- Code ---`);
        console.log(chunk.text);
    });

    // Show contextualized version for one chunk
    const funcChunk = chunks.find(c => c.type === 'function');
    if (funcChunk?.contextualizedText) {
        console.log('\n\n========== Contextualized Text (for embeddings) ==========');
        console.log(funcChunk.contextualizedText);
    }
}

demo().catch(console.error);
```

---

## Summary

In this lab, you learned:

| Concept | Description |
|---------|-------------|
| **Semantic Chunking** | Splitting code by meaningful boundaries (functions, classes) |
| **Why It Matters** | Better embeddings, better AI search results |
| **Node Type Mapping** | Different AST node types for each language |
| **Size Constraints** | Min/max chunk sizes to balance granularity and context |
| **Gap Filling** | Handling code between semantic units |
| **Metadata Extraction** | Parameters, return types, parent scope |
| **Contextualization** | Adding file/scope info for better embeddings |

### Key Takeaways

1. **Line-based chunking breaks code semantics** - Function names get split, context is lost
2. **AST-based chunking preserves meaning** - Complete functions, classes, methods
3. **Metadata improves retrieval** - Know what a chunk is without reading it
4. **Contextualized text helps embeddings** - AI understands scope and relationships
5. **Fallback is important** - Some files can't be parsed, handle gracefully

---

## What's Next

In upcoming labs, you'll use this semantic chunker to:

- **File Watcher**: Detect code changes in real-time
- **Chunk Hashing**: Generate content-based hashes for chunks
- **Merkle Tree**: Implement file-level Merkle trees for incremental re-indexing
- **Embedding Database**: Store and query embeddings for semantic search

---

## Exercises

1. **Add TypeScript Support**: Load the TypeScript grammar and test with `.ts` files

2. **Extract Docstrings**: Include JSDoc/docstrings in chunk metadata

3. **Dependency Analysis**: Track which chunks import/reference other chunks

4. **Deduplication**: Detect and deduplicate identical chunks across files

5. **Benchmark**: Compare embedding quality between line-based and semantic chunking

---

## Resources

- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [AST-Aware Code Chunking (Supermemory)](https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/)
- [Aider Tree-sitter Chunking](https://aider.chat/2024/09/09/treesitter.html)
- [code-chunk npm package](https://www.npmjs.com/package/code-chunk)
