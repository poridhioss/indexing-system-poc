# Chunk Hashing Strategies

In Lab 04, you built a semantic chunker that splits code into meaningful units (functions, classes, methods). In Lab 05, you built a file watcher to detect file changes. Now you need a way to efficiently detect when chunks change. This lab teaches you content-based hashing strategies that form the foundation of incremental re-indexing.

When a file changes, you don't want to re-embed the entire codebase. By hashing each chunk, you can compare hashes and only re-embed chunks that actually changed.

## Prerequisites

- Completed **Lab 04: AST-Based Semantic Code Chunking**
- Completed **Lab 05: File Watcher Implementation**
- Node.js 18+ installed
- Understanding of hash functions (basic)

## What You'll Learn

1. Why content-based hashing is essential for incremental indexing
2. MD5 vs SHA-256: when to use each algorithm
3. Implementing chunk hashing with normalization
4. Building a hash registry for change detection
5. Integrating hashing with the semantic chunker (matching puku-vs-editor)

## Part 1: Why Hash Chunks?

### The Re-indexing Problem

Consider a codebase with 10,000 files and 50,000 chunks. When a developer changes one file:

**Without Hashing (Naive Approach)**:
- Re-parse all 10,000 files
- Re-chunk everything
- Re-embed 50,000 chunks
- Cost: ~$5-10 per change, 10+ minutes

**With Hashing (Smart Approach)**:
- Hash the changed file
- Compare with stored hash
- Re-chunk only changed files
- Re-embed only changed chunks
- Cost: ~$0.001 per change, <1 second

### Hash-Based Change Detection Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         HASH-BASED CHANGE DETECTION                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   File Changed                                                                  │
│        │                                                                        │
│        ▼                                                                        │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                      │
│   │  Re-chunk   │────>│ Hash Each   │────>│  Compare    │                      │
│   │    File     │     │   Chunk     │     │   Hashes    │                      │
│   └─────────────┘     └─────────────┘     └─────────────┘                      │
│                                                  │                              │
│                              ┌───────────────────┼───────────────────┐          │
│                              │                   │                   │          │
│                              ▼                   ▼                   ▼          │
│                        ┌──────────┐        ┌──────────┐        ┌──────────┐    │
│                        │   NEW    │        │ MODIFIED │        │UNCHANGED │    │
│                        │  Chunk   │        │  Chunk   │        │  Chunk   │    │
│                        └──────────┘        └──────────┘        └──────────┘    │
│                              │                   │                   │          │
│                              ▼                   ▼                   ▼          │
│                        ┌──────────┐        ┌──────────┐        ┌──────────┐    │
│                        │ Generate │        │ Generate │        │   Skip   │    │
│                        │Embedding │        │Embedding │        │Re-embed  │    │
│                        └──────────┘        └──────────┘        └──────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Part 2: Hash Algorithm Comparison

### MD5 vs SHA-256

| Aspect | MD5 | SHA-256 |
|--------|-----|---------|
| **Speed** | ~600 MB/s | ~400 MB/s |
| **Output** | 128 bits (32 hex chars) | 256 bits (64 hex chars) |
| **Collision Resistance** | Broken (but fine for change detection) | Cryptographic |
| **Use Case** | Fast change detection, caching | Security, integrity, Merkle trees |
| **Node.js** | Built-in (`crypto`) | Built-in (`crypto`) |

### Which to Use?

For chunk hashing in code indexing:
- **MD5** is preferred for speed and compatibility with puku-vs-editor
- Collision probability is negligible for change detection use case
- We're not protecting against malicious attacks, just detecting changes

For Merkle tree integrity:
- **SHA-256** is preferred
- Cryptographic guarantees matter for tree integrity

### Puku-vs-editor Approach (What We Use)

```
File Level:  MD5 (for content change detection, same as chunks)
Chunk Level: MD5 (matching puku-vs-editor implementation)
Merkle Tree: SHA-256 (for cryptographic integrity)
```

This matches the production implementation in puku-vs-editor.

## Part 3: Project Setup

Create a new project that extends your semantic chunker:

```bash
mkdir chunk-hashing
cd chunk-hashing
npm init -y
npm install web-tree-sitter tree-sitter-javascript tree-sitter-python
```

**Dependencies**:

| Package | Purpose |
|---------|---------|
| `web-tree-sitter` | AST parsing (from previous lab) |
| `tree-sitter-*` | Language grammars |

Note: We use Node.js built-in `crypto` module for MD5/SHA-256, no external packages needed.

## Part 4: Implementation

### Step 1: Hash Utilities

Create `src/hash-utils.js`:

```javascript
const crypto = require('crypto');

/**
 * Compute MD5 hash of content (same as puku-vs-editor)
 * Used for file-level content hashing to detect changes
 * @param {string} content - Content to hash
 * @returns {string} Hex-encoded MD5 hash
 */
function md5(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Compute SHA-256 hash of content
 * Used for Merkle tree (cryptographic integrity)
 * @param {string} content - Content to hash
 * @returns {string} Hex-encoded SHA-256 hash
 */
function sha256(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Normalize content before hashing (optional)
 * Removes variations that shouldn't affect semantic meaning:
 * - Trailing whitespace
 * - Multiple blank lines -> single blank line
 * - Consistent line endings (CRLF -> LF)
 *
 * Note: puku-vs-editor does NOT normalize before hashing.
 * This is provided for optional use cases.
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
 * Compute content hash (MD5, matching puku-vs-editor)
 * @param {string} content - Content to hash
 * @param {boolean} normalize - Whether to normalize content first (default: false)
 * @returns {string} MD5 hash of content
 */
function hashContent(content, normalize = false) {
    const toHash = normalize ? normalizeContent(content) : content;
    return md5(toHash);
}

module.exports = {
    md5,
    sha256,
    normalizeContent,
    hashContent,
};
```

### Step 2: Chunk Hasher

Create `src/chunk-hasher.js`:

```javascript
const { hashContent, md5 } = require('./hash-utils');

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
        this.contentHash = contentHash;  // MD5 hash (matching puku-vs-editor)
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
 * Uses MD5 to match puku-vs-editor implementation
 */
class ChunkHasher {
    constructor() {
        // No initialization needed - MD5 is built into Node.js crypto
    }

    /**
     * Initialize the hasher (no-op for MD5, kept for API compatibility)
     */
    async initialize() {
        // MD5 doesn't require initialization
        return Promise.resolve();
    }

    /**
     * Hash a single chunk using MD5 (matching puku-vs-editor)
     * @param {object} chunk - Semantic chunk from SemanticChunker
     * @param {string} filePath - File path for the chunk
     * @returns {HashedChunk}
     */
    hashChunk(chunk, filePath) {
        const contentHash = hashContent(chunk.text);

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
     * Compute file-level content hash (MD5, matching puku-vs-editor)
     * Used to check if file content has changed
     * @param {string} content - File content
     * @returns {string} MD5 hash
     */
    hashFile(content) {
        return md5(content);
    }
}

module.exports = { ChunkHasher, HashedChunk };
```

### Step 3: Hash Registry for Change Detection

Create `src/hash-registry.js`:

```javascript
/**
 * HashRegistry - Stores and compares chunk hashes for change detection
 * Matches puku-vs-editor's cache structure (using contentHash)
 */
class HashRegistry {
    constructor() {
        // Map: filePath -> Map<contentHash, HashedChunk>
        this.fileChunks = new Map();
        // Map: contentHash -> HashedChunk (global lookup)
        this.hashIndex = new Map();
        // Map: filePath -> contentHash (file-level)
        this.fileHashes = new Map();
    }

    /**
     * Check if a file is already indexed with the same content hash
     * Matches puku-vs-editor's isIndexed() method
     * @param {string} filePath - File path (uri)
     * @param {string} contentHash - MD5 hash of file content
     * @returns {boolean}
     */
    isIndexed(filePath, contentHash) {
        const storedHash = this.fileHashes.get(filePath);
        return storedHash === contentHash;
    }

    /**
     * Register chunks from a file
     * @param {string} filePath - File path
     * @param {HashedChunk[]} chunks - Hashed chunks
     * @param {string} contentHash - MD5 hash of the entire file
     */
    registerFile(filePath, chunks, contentHash) {
        // Store file hash
        this.fileHashes.set(filePath, contentHash);

        // Create chunk map for this file
        const chunkMap = new Map();
        for (const chunk of chunks) {
            chunkMap.set(chunk.contentHash, chunk);
            this.hashIndex.set(chunk.contentHash, chunk);
        }
        this.fileChunks.set(filePath, chunkMap);
    }

    /**
     * Check if a file has changed (alias for !isIndexed)
     * @param {string} filePath - File path
     * @param {string} newContentHash - New content hash
     * @returns {boolean}
     */
    hasFileChanged(filePath, newContentHash) {
        return !this.isIndexed(filePath, newContentHash);
    }

    /**
     * Compare new chunks against stored chunks and categorize changes
     * @param {string} filePath - File path
     * @param {HashedChunk[]} newChunks - New hashed chunks
     * @returns {{ added: HashedChunk[], modified: HashedChunk[], unchanged: HashedChunk[], removed: HashedChunk[] }}
     */
    compareChunks(filePath, newChunks) {
        const oldChunkMap = this.fileChunks.get(filePath) || new Map();
        const newChunkHashes = new Set(newChunks.map(c => c.contentHash));

        const result = {
            added: [],      // New chunks not in old set
            modified: [],   // Chunks with same position but different hash (approximation)
            unchanged: [],  // Chunks with same hash
            removed: [],    // Old chunks not in new set
        };

        // Categorize new chunks
        for (const chunk of newChunks) {
            if (oldChunkMap.has(chunk.contentHash)) {
                result.unchanged.push(chunk);
            } else {
                // Check if there's a chunk at similar position (heuristic for "modified")
                const similarOld = this._findSimilarChunk(chunk, oldChunkMap);
                if (similarOld) {
                    result.modified.push(chunk);
                } else {
                    result.added.push(chunk);
                }
            }
        }

        // Find removed chunks
        for (const [contentHash, chunk] of oldChunkMap) {
            if (!newChunkHashes.has(contentHash)) {
                // Check if it was "modified" (replaced by similar chunk)
                const wasModified = result.modified.some(
                    m => this._isSimilarPosition(m, chunk)
                );
                if (!wasModified) {
                    result.removed.push(chunk);
                }
            }
        }

        return result;
    }

    /**
     * Find a chunk at similar position (same name or overlapping lines)
     * @private
     */
    _findSimilarChunk(newChunk, oldChunkMap) {
        for (const [, oldChunk] of oldChunkMap) {
            if (this._isSimilarPosition(newChunk, oldChunk)) {
                return oldChunk;
            }
        }
        return null;
    }

    /**
     * Check if two chunks are at similar positions
     * @private
     */
    _isSimilarPosition(chunk1, chunk2) {
        // Same name (symbolName)
        if (chunk1.name && chunk1.name === chunk2.name) {
            return true;
        }
        // Overlapping line ranges
        const overlap = Math.min(chunk1.lineEnd, chunk2.lineEnd) -
                       Math.max(chunk1.lineStart, chunk2.lineStart);
        const minSize = Math.min(chunk1.lineCount, chunk2.lineCount);
        return overlap > minSize * 0.5; // >50% overlap
    }

    /**
     * Update registry with new chunks (after processing changes)
     * @param {string} filePath - File path
     * @param {HashedChunk[]} chunks - New chunks
     * @param {string} contentHash - New content hash
     */
    updateFile(filePath, chunks, contentHash) {
        // Remove old chunks from hash index
        const oldChunkMap = this.fileChunks.get(filePath);
        if (oldChunkMap) {
            for (const [hash] of oldChunkMap) {
                this.hashIndex.delete(hash);
            }
        }

        // Register new state
        this.registerFile(filePath, chunks, contentHash);
    }

    /**
     * Remove a file from the registry
     * @param {string} filePath - File path
     */
    removeFile(filePath) {
        const chunkMap = this.fileChunks.get(filePath);
        if (chunkMap) {
            for (const [hash] of chunkMap) {
                this.hashIndex.delete(hash);
            }
        }
        this.fileChunks.delete(filePath);
        this.fileHashes.delete(filePath);
    }

    /**
     * Get chunks for a specific file
     * Matches puku-vs-editor's getChunksForFile()
     * @param {string} filePath - File path
     * @returns {HashedChunk[]}
     */
    getChunksForFile(filePath) {
        const chunkMap = this.fileChunks.get(filePath);
        if (!chunkMap) {
            return [];
        }
        return Array.from(chunkMap.values());
    }

    /**
     * Get statistics about the registry
     */
    getStats() {
        let totalChunks = 0;
        for (const [, chunkMap] of this.fileChunks) {
            totalChunks += chunkMap.size;
        }

        return {
            fileCount: this.fileChunks.size,
            totalChunks: totalChunks,
            uniqueHashes: this.hashIndex.size,
        };
    }

    /**
     * Check if a chunk hash exists (for deduplication)
     * @param {string} contentHash - Chunk content hash
     * @returns {boolean}
     */
    hasHash(contentHash) {
        return this.hashIndex.has(contentHash);
    }

    /**
     * Get chunk by hash
     * @param {string} contentHash - Chunk content hash
     * @returns {HashedChunk | undefined}
     */
    getByHash(contentHash) {
        return this.hashIndex.get(contentHash);
    }
}

module.exports = { HashRegistry };
```

### Step 4: Example Usage

Create `src/example.js`:

```javascript
const { SemanticChunker } = require('./chunker');
const { ChunkHasher } = require('./chunk-hasher');
const { HashRegistry } = require('./hash-registry');

async function main() {
    // Initialize chunker (from previous lab)
    const chunker = new SemanticChunker({
        maxChunkSize: 4000,
        minChunkSize: 50,
    });

    await chunker.initialize({
        javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
        python: require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    });

    // Initialize hasher (uses MD5 like puku-vs-editor)
    const hasher = new ChunkHasher();
    await hasher.initialize();

    // Initialize registry
    const registry = new HashRegistry();

    // === INITIAL INDEXING ===
    console.log('=== Initial Indexing ===\n');

    const originalCode = `
/**
 * User management module
 */
import { db } from './database';

async function getUser(id) {
    return await db.users.findById(id);
}

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
}

export { getUser, UserService };
    `.trim();

    const filePath = 'src/user-service.js';

    // Chunk and hash
    const chunks = chunker.chunk(originalCode, 'javascript');
    const hashedChunks = hasher.hashChunks(chunks, filePath);
    const fileHash = hasher.hashFile(originalCode);

    // Register in registry
    registry.registerFile(filePath, hashedChunks, fileHash);

    console.log('Initial chunks:');
    hashedChunks.forEach((chunk, i) => {
        console.log(`  ${i + 1}. ${chunk.toString()}`);
    });
    console.log(`\nFile hash: ${fileHash.substring(0, 16)}...`);
    console.log(`Registry stats:`, registry.getStats());

    // === SIMULATE FILE CHANGE ===
    console.log('\n\n=== Simulating File Change ===\n');

    // Modified code: changed getUser function, added new function
    const modifiedCode = `
/**
 * User management module
 */
import { db } from './database';

async function getUser(id) {
    // Added retry logic
    for (let i = 0; i < 3; i++) {
        try {
            return await db.users.findById(id);
        } catch (err) {
            if (i === 2) throw err;
        }
    }
}

async function deleteUser(id) {
    return await db.users.remove(id);
}

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
}

export { getUser, deleteUser, UserService };
    `.trim();

    // Check if file changed
    const newFileHash = hasher.hashFile(modifiedCode);
    const fileChanged = registry.hasFileChanged(filePath, newFileHash);

    console.log(`File changed: ${fileChanged}`);

    if (fileChanged) {
        // Re-chunk and hash
        const newChunks = chunker.chunk(modifiedCode, 'javascript');
        const newHashedChunks = hasher.hashChunks(newChunks, filePath);

        // Compare with old chunks
        const diff = registry.compareChunks(filePath, newHashedChunks);

        console.log('\nChange Detection Results:');
        console.log(`  Added: ${diff.added.length} chunks`);
        diff.added.forEach(c => console.log(`    + ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        console.log(`  Modified: ${diff.modified.length} chunks`);
        diff.modified.forEach(c => console.log(`    ~ ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        console.log(`  Unchanged: ${diff.unchanged.length} chunks`);
        diff.unchanged.forEach(c => console.log(`    = ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        console.log(`  Removed: ${diff.removed.length} chunks`);
        diff.removed.forEach(c => console.log(`    - ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        // Only these chunks need re-embedding:
        const chunksToEmbed = [...diff.added, ...diff.modified];
        console.log(`\nChunks requiring re-embedding: ${chunksToEmbed.length}`);

        // Update registry
        registry.updateFile(filePath, newHashedChunks, newFileHash);
        console.log('Registry updated.');
        console.log('New registry stats:', registry.getStats());
    }

    // === PYTHON EXAMPLE ===
    console.log('\n\n=== Python Example ===\n');

    const pythonCode = `
"""Authentication module"""
from hashlib import sha256

def hash_password(password: str) -> str:
    """Hash a password using SHA-256."""
    return sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    return hash_password(password) == hashed

class Authenticator:
    def __init__(self, user_store):
        self.users = user_store

    def login(self, username: str, password: str):
        user = self.users.get(username)
        if not user:
            raise ValueError("User not found")
        if not verify_password(password, user.password_hash):
            raise ValueError("Invalid password")
        return self._generate_token(user)

    def _generate_token(self, user) -> str:
        import secrets
        return secrets.token_urlsafe(32)
    `.trim();

    const pyFilePath = 'src/auth.py';
    const pyChunks = chunker.chunk(pythonCode, 'python');
    const pyHashedChunks = hasher.hashChunks(pyChunks, pyFilePath);
    const pyFileHash = hasher.hashFile(pythonCode);

    registry.registerFile(pyFilePath, pyHashedChunks, pyFileHash);

    console.log('Python chunks:');
    pyHashedChunks.forEach((chunk, i) => {
        console.log(`  ${i + 1}. [${chunk.type}] ${chunk.name || '(anonymous)'}`);
        console.log(`     Hash: ${chunk.contentHash.substring(0, 16)}...`);
        console.log(`     Lines: ${chunk.lineStart}-${chunk.lineEnd}`);
    });

    console.log('\nFinal registry stats:', registry.getStats());

    // === DEMONSTRATE isIndexed() CHECK ===
    console.log('\n\n=== Checking isIndexed (puku-vs-editor pattern) ===\n');

    // This pattern matches puku-vs-editor's cache check
    const testPath = 'src/user-service.js';
    const testContent = modifiedCode;
    const testHash = hasher.hashFile(testContent);

    if (registry.isIndexed(testPath, testHash)) {
        console.log(`File ${testPath} is already indexed with same content - skip re-indexing`);
    } else {
        console.log(`File ${testPath} needs re-indexing (content changed or new file)`);
    }
}

main().catch(console.error);
```

### Step 5: Copy Chunker from Previous Lab

Copy the chunker files from the Semantic-chunking-with-AST project:

```bash
# Copy from previous lab
cp ../Semantic-chunking-with-AST/src/semantic-nodes.js src/
cp ../Semantic-chunking-with-AST/src/chunk.js src/
cp ../Semantic-chunking-with-AST/src/chunker.js src/
```

## Part 5: Running the Example

```bash
cd chunk-hashing
npm install
node src/example.js
```

**Expected Output**:

```
=== Initial Indexing ===

Initial chunks:
  1. [block] (anonymous) @ src/user-service.js:1-4 (a1b2c3d4...)
  2. [function] getUser @ src/user-service.js:6-8 (e5f6g7h8...)
  3. [class] UserService @ src/user-service.js:10-24 (i9j0k1l2...)
  4. [block] (anonymous) @ src/user-service.js:26-26 (m3n4o5p6...)

File hash: 7f8a9b0c1d2e3f4g...
Registry stats: { fileCount: 1, totalChunks: 4, uniqueHashes: 4 }


=== Simulating File Change ===

File changed: true

Change Detection Results:
  Added: 1 chunks
    + deleteUser (q7r8s9t0)
  Modified: 1 chunks
    ~ getUser (u1v2w3x4)
  Unchanged: 2 chunks
    = UserService (i9j0k1l2)
    = block (a1b2c3d4)
  Removed: 0 chunks

Chunks requiring re-embedding: 2
Registry updated.
New registry stats: { fileCount: 1, totalChunks: 5, uniqueHashes: 5 }
```

## Summary

In this lab, you learned:

| Concept | Description |
|---------|-------------|
| **Content Hashing** | Converting chunk content to fixed-length MD5 hash |
| **MD5 vs SHA-256** | MD5 for fast change detection, SHA-256 for Merkle tree integrity |
| **isIndexed Pattern** | Check if file already indexed before re-processing (puku-vs-editor pattern) |
| **Hash Registry** | Storing and comparing hashes for change detection |
| **Change Categories** | Added, Modified, Unchanged, Removed chunks |

### Key Takeaways

1. **Hash chunks, not just files** - Enables fine-grained change detection
2. **MD5 for content hashing** - Fast, compatible with puku-vs-editor
3. **SHA-256 for Merkle tree** - Use for cryptographic integrity in upcoming labs
4. **isIndexed() pattern** - Skip re-indexing files that haven't changed
5. **Registry pattern** - Store hashes for efficient comparison

### How This Aligns with Cursor's Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHANGE DETECTION FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. File Watcher detects change                                  │
│                    │                                             │
│                    ▼                                             │
│  2. MD5 hash file content ◄── Lab 06 (this lab)                  │
│                    │                                             │
│                    ▼                                             │
│  3. isIndexed(path, hash)?                                       │
│          │                                                       │
│     ┌────┴────┐                                                  │
│     │ YES     │ NO                                               │
│     │         ▼                                                  │
│     │    Re-chunk file                                           │
│     │         │                                                  │
│     │         ▼                                                  │
│     │    Compare chunk hashes                                    │
│     │         │                                                  │
│     │         ▼                                                  │
│     │    Re-embed only changed chunks                            │
│     │         │                                                  │
│     ▼         ▼                                                  │
│    SKIP    Update registry + Merkle tree                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## What's Next

In upcoming labs, you'll use chunk hashing to:

- **Lab 07: Merkle Tree** - Build file-level Merkle trees using SHA-256 hashes
- **Lab 08: Client-Server Sync** - Sync Merkle trees between client and server (like Cursor)
- **Lab 09: Selective Re-indexing** - Only re-embed chunks that actually changed
