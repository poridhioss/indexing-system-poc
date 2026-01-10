# Chunk Hashing for Two-Phase Sync

After creating semantic chunks with Tree-sitter, you need to compute hashes for each chunk to enable efficient server synchronization. This lab teaches you how to hash chunks and store references—not the actual code—so that code is only sent to the server when explicitly requested.

This is exactly how PUKU Editor, Cursor and other production AI code editors implement their two-phase sync protocol to minimize data transfer and protect user code privacy.

## Prerequisites

- Completed **Semantic Code Chunking Lab**
- Node.js 18+ installed

## What You'll Learn

1. Why chunk hashing enables efficient sync
2. Computing SHA-256 hashes for semantic chunks
3. Storing chunk references instead of code
4. Creating sync payloads for server communication
5. The two-phase sync protocol in practice

## Part 1: Why Chunk Hashing?

### The Data Transfer Problem

When syncing code to a server for embedding generation, you face a key challenge: **how do you minimize data transfer while still enabling the server to generate embeddings?**

![Data Transfer Problem](./images/infra-1.svg)

Consider a typical development workflow. You open a project with 1,000 files containing 10,000 semantic chunks. Throughout the day, you edit maybe 5-10 files, changing perhaps 20 chunks total. Without an efficient sync mechanism, every sync would send all 10,000 chunks to the server—megabytes of code transferred just to update a handful of changes. The server would re-embed everything, wasting compute resources on 9,980 unchanged chunks. At scale, this becomes prohibitively expensive in bandwidth, API costs, and time.

![Chunk Hashing Solution](./images/infra-2.svg)

Chunk hashing solves this by introducing a two-phase protocol. In Phase 1, the client computes SHA-256 hashes for each chunk and sends only these hashes to the server—no actual code. The server checks each hash against its cache to identify which chunks are new or changed. In Phase 2, the client sends code only for the chunks the server explicitly requests. This means if you changed 20 chunks out of 10,000, only those 20 chunks' code gets transferred.

### The Two-Phase Sync Protocol

The two-phase protocol separates metadata exchange from code transfer:

![Phase 1: Metadata Exchange](./images/infra-3.svg)

In **Phase 1**, the client parses source files with Tree-Sitter, creates semantic chunks, and computes SHA-256 hashes. Only hashes are sent to the server—no actual code. The server checks each hash against its cache store and identifies which chunks are missing (new or changed).

![Phase 2: Code Transfer](./images/infra-4.svg)

In **Phase 2**, the client sends actual code only for the chunks the server requested. The client retrieves this code using the stored reference (file path + line numbers). The server then processes these chunks (generates embeddings, summaries, etc.) and discards the code immediately after. This approach achieves **97% bandwidth savings** compared to sending all code upfront.

### Why Store References, Not Code?

A key design decision: **HashedChunk stores a reference to the code, not the code itself.**

In the Semantic Chunking Lab, we store the actual code text along with metadata like type, name, and line numbers. This works fine for immediate processing, but becomes inefficient when you need to track thousands of chunks across a large codebase.

`HashedChunk` takes a different approach. Instead of storing the code, it stores a SHA-256 hash of the code plus a reference (file path and line numbers) that can retrieve the code later. The code is read from disk only when the server actually requests it.

This design is memory efficient because large codebases don't bloat memory with stored code strings. It's always fresh because code is read from disk when needed, not from a potentially stale cache. It's simpler because there's no local chunk cache to sync. And it lets the server decide what's needed—only chunks with unknown hashes require code transfer.

## Part 2: Project Setup

Clone the repository and navigate to the Chunk-Hashing project:

```bash
git clone https://github.com/poridhioss/indexing-system-poc.git
cd indexing-system-poc/Chunk-Hashing
npm install
```

### Project Structure

```
Chunk-Hashing/
├── src/
│   ├── hashed-chunk.ts      # HashedChunk class (hash + reference)
│   ├── chunk-hasher.ts      # ChunkHasher (parse → chunk → hash)
│   ├── semantic-nodes.ts    # Language-specific AST node mappings
│   ├── example.ts           # Usage demonstration
│   └── index.ts             # Public exports
├── test-project/
│   └── src/
│       ├── user-service.js  # Sample user service module
│       ├── validator.js     # Sample validation utilities
│       └── api.js           # Sample API client module
├── dist/                    # Compiled output
├── package.json
└── tsconfig.json
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `web-tree-sitter` | ^0.20.8 | AST parsing for semantic chunking |
| `tree-sitter-javascript` | ^0.20.1 | JavaScript grammar |
| `tree-sitter-python` | ^0.20.4 | Python grammar |
| `crypto` | built-in | SHA-256 hashing |

## Part 3: Implementation Walkthrough

### Step 1: The ChunkReference Interface

[hashed-chunk.ts:25-32](../../Chunk-Hashing/src/hashed-chunk.ts#L25-L32)

```typescript
export interface ChunkReference {
    filePath: string;     // Absolute path to source file
    lineStart: number;    // 1-indexed start line
    lineEnd: number;      // 1-indexed end line
    charStart: number;    // Character offset from file start
    charEnd: number;      // Character offset end
}
```

The `ChunkReference` interface stores everything needed to retrieve the code from disk later. When the server requests a specific chunk (by hash), we use this reference to read the exact lines from the file.

### Step 2: The HashedChunk Class

[hashed-chunk.ts:48-78](../../Chunk-Hashing/src/hashed-chunk.ts#L48-L78)

```typescript
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

    static computeHash(content: string): string {
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }
}
```

**Critical design point**: The `text` parameter is passed to the constructor for hash computation, but is NOT stored as a class property. After `computeHash()` runs, the code is discarded. Only the hash and reference remain.

### Step 3: Creating Sync Payloads

[hashed-chunk.ts:85-100](../../Chunk-Hashing/src/hashed-chunk.ts#L85-L100)

```typescript
/**
 * Convert to metadata-only object for sending to server (Phase 1)
 * NO code included - only hash and reference info
 */
toSyncPayload(): ChunkSyncPayload {
    return {
        hash: this.hash,
        type: this.type,
        name: this.name,
        lines: [this.reference.lineStart, this.reference.lineEnd],
        charCount: this.charCount,
    };
}
```

The `toSyncPayload()` method creates the object sent to the server during Phase 2. Notice there's no `code` field—only the hash and metadata. This is what enables the bandwidth savings.

### Step 4: The ChunkHasher Class

[chunk-hasher.ts:45-85](../../Chunk-Hashing/src/chunk-hasher.ts#L45-L85)

```typescript
export class ChunkHasher {
    /**
     * Hash a file's code into chunks
     * Returns HashedChunk[] (hash + reference, no code stored)
     */
    hashFile(code: string, language: string, filePath: string): HashedChunk[] {
        const langGrammar = this.languages.get(language);

        if (!langGrammar || !this.parser) {
            return this.fallbackHash(code, language, filePath);
        }

        // Parse the code with Tree-sitter
        this.parser.setLanguage(langGrammar);
        const tree = this.parser.parse(code);

        // Extract semantic chunks and compute hashes
        const chunks: HashedChunk[] = [];
        const semanticTypes = getSemanticTypes(language);

        this.extractAndHashChunks(tree.rootNode, code, language, filePath, semanticTypes, chunks);

        // Fill gaps between chunks
        return this.fillGaps(chunks, code, language, filePath);
    }
}
```

The `ChunkHasher` class combines semantic chunking with hash computation. It parses code with Tree-sitter, extracts semantic units, and creates `HashedChunk` objects for each.

### Step 5: Creating HashedChunks from AST Nodes

[chunk-hasher.ts:130-165](../../Chunk-Hashing/src/chunk-hasher.ts#L130-L165)

```typescript
private createHashedChunk(
    node: Node,
    code: string,
    language: string,
    filePath: string,
    parentName: string | null
): HashedChunk {
    const name = this.getNodeName(node);
    const type = this.getChunkType(node.type);
    const metadata = this.extractMetadata(node, language);

    if (parentName) {
        metadata.parent = parentName;
    }

    // Create reference to locate code on disk
    const reference: ChunkReference = {
        filePath,
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
```

This method extracts information from an AST node and creates a `HashedChunk`. The `node.text` is passed for hash computation, but remember—it's not stored in the resulting object.

### Step 6: File Sync Payload

[chunk-hasher.ts:87-95](../../Chunk-Hashing/src/chunk-hasher.ts#L87-L95)

```typescript
/**
 * Create a file sync payload for Phase 1 (metadata exchange)
 * This is what gets sent to the server - hashes only, no code
 */
createSyncPayload(chunks: HashedChunk[], filePath: string): FileSyncPayload {
    return {
        filePath,  // Could be obfuscated before sending
        chunks: chunks.map(chunk => chunk.toSyncPayload()),
    };
}
```

The `FileSyncPayload` aggregates all chunk hashes for a single file. This is the complete payload sent to the server during Phase 1.

## Part 4: The Two-Phase Protocol in Action

### Complete Sync Flow

![Complete Sync Flow](./images/infra-5.svg)

### Phase 1: Metadata Exchange

Client sends `FileSyncPayload` containing only hashes and metadata:

```json
{
  "filePath": "src/auth.ts",
  "chunks": [
    { "hash": "abc123...", "type": "function", "name": "login", "lines": [10, 25] },
    { "hash": "def456...", "type": "class", "name": "AuthService", "lines": [30, 80] }
  ]
}
```

Server checks cache:
- `abc123` → EXISTS (skip)
- `def456` → NOT FOUND (need code)

Server responds: `"Send code for: def456"`

### Phase 2: Code Transfer

Client reads code using the stored reference and sends only the requested chunk:

```json
{
  "hash": "def456...",
  "code": "class AuthService { ... }"
}
```

Server then:
1. Generates embedding from code
2. **DISCARDS** the code immediately
3. Stores embedding in vector database
4. Caches hash for future comparisons

### Reading Code from Reference

When the server requests a chunk, the client uses the reference to read the code:

```typescript
// Server requests chunk by hash
const neededHash = "def456...";
const chunk = hashedChunks.find(c => c.hash === neededHash);

// Read code using reference
const fileContent = fs.readFileSync(chunk.reference.filePath, 'utf8');
const lines = fileContent.split('\n');
const chunkCode = lines.slice(
    chunk.reference.lineStart - 1,
    chunk.reference.lineEnd
).join('\n');

// Send to server
sendToServer({ hash: neededHash, code: chunkCode });
```

## Part 5: Running the Example

### Build and Run

```bash
npm run build
npm start
```

### Expected Output

The example processes three JavaScript files from the `test-project/src/` folder and outputs a clean summary:

```
=== Chunk Hashing Demo ===

user-service.js → 4 chunks
  function "getUser" [a1b2c3d4e5f6...]
  function "createUser" [b2c3d4e5f6a1...]
  class "UserService" [c3d4e5f6a1b2...]
  block "(anonymous)" [d4e5f6a1b2c3...]

validator.js → 3 chunks
  function "validateEmail" [e5f6a1b2c3d4...]
  function "validatePassword" [f6a1b2c3d4e5...]
  function "sanitizeInput" [a1b2c3d4e5f6...]

api.js → 3 chunks
  function "fetchData" [b2c3d4e5f6a1...]
  function "postData" [c3d4e5f6a1b2...]
  block "(anonymous)" [d4e5f6a1b2c3...]

Total: 3 files, 10 chunks
```

The output demonstrates:
1. **Files processed** - Each file from the test project is chunked
2. **Chunks per file** - Shows how many semantic chunks were extracted
3. **Chunk details** - Type, name, and truncated hash for each chunk
4. **Total summary** - Overall count of files and chunks processed

**Note**: The example focuses on demonstrating chunking and hashing. The `toSyncPayload()` and `createSyncPayload()` methods in the codebase are prepared for the two-phase sync protocol but are not demonstrated in this example. In a production our upcomming labs we will be using these methods to create payloads for server communication.

### Bandwidth Savings at Scale

| Scenario | Without Two-Phase | With Two-Phase | Savings |
|----------|-------------------|----------------|---------|
| 100 chunks, 1 changed | 200 KB (all code) | 6.4 KB + 2 KB | 96% |
| 500 chunks, 5 changed | 1 MB (all code) | 32 KB + 10 KB | 96% |
| 1000 chunks, 10 changed | 2 MB (all code) | 64 KB + 20 KB | 96% |

The savings scale linearly—the more chunks you have, the more you save by only sending hashes first.

## Conclusion

You've built a chunk hashing system that enables efficient two-phase synchronization—the same protocol used by Cursor and production AI code editors. By computing SHA-256 hashes and storing references instead of code, you've created the foundation for bandwidth-efficient server communication.

The key insight: **send metadata first, code only when needed**. This approach achieves 96%+ bandwidth savings while maintaining the ability to generate embeddings for any code chunk on demand. Combined with the Merkle tree from Lab-06, you now have a complete change detection and synchronization system ready for production use.
