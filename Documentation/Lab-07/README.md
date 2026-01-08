# Chunk Hashing for Two-Phase Sync

This lab implements chunk hashing—the bridge between semantic chunking (Lab-04) and server sync. Instead of storing actual code in chunks, we compute SHA-256 hashes and store references (file path + line numbers) to retrieve code on demand.

## Prerequisites

- Completed Lab-04 (Semantic Chunking with AST)
- Understanding of the two-phase sync protocol (see `Pipeline/cursor-architecture.md`)
- Node.js and npm installed

## Why Chunk Hashing?

The two-phase sync protocol requires sending **hashes first, code later**:

```
┌─────────────────────────────────────────────────────────────┐
│                    TWO-PHASE SYNC                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Phase 2: Send hashes + metadata (NO CODE)                  │
│  ─────────────────────────────────────────                  │
│  Client → Server: [                                         │
│    { hash: "abc123", lines: [1,20], type: "function" },    │
│    { hash: "def456", lines: [22,45], type: "class" }       │
│  ]                                                          │
│                                                             │
│  Server checks cache → "I need code for hash def456"        │
│                                                             │
│  Phase 3: Send ONLY requested code                          │
│  ─────────────────────────────────────────                  │
│  Client reads code locally using reference                  │
│  Client → Server: { hash: "def456", code: "class..." }     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key insight**: We don't store code in chunks. We store:
- Hash (SHA-256 of code content)
- Reference (file path + line numbers to retrieve code when needed)

## Project Setup

```bash
cd indexing-system-poc/Chunk-Hashing
npm install
npm run build
npm start
```

## Project Structure

```
Chunk-Hashing/
├── src/
│   ├── hashed-chunk.ts      # HashedChunk class (hash + reference, NO code)
│   ├── chunk-hasher.ts      # ChunkHasher (parse → chunk → hash)
│   ├── semantic-nodes.ts    # Language-specific AST node mappings
│   ├── example.ts           # Usage demonstration
│   └── index.ts             # Public exports
├── dist/                    # Compiled output
├── package.json
└── tsconfig.json
```

## Core Concepts

### HashedChunk vs SemanticChunk

| Property | SemanticChunk (Lab-04) | HashedChunk (Lab-07) |
|----------|------------------------|----------------------|
| `text` | ✅ Full code content | ❌ NOT stored |
| `hash` | ❌ Not computed | ✅ SHA-256 of code |
| `reference` | ❌ Not needed | ✅ File path + lines |
| `type`, `name`, `metadata` | ✅ Yes | ✅ Yes |

### ChunkReference

```typescript
interface ChunkReference {
    filePath: string;     // Absolute path to source file
    lineStart: number;    // 1-indexed start line
    lineEnd: number;      // 1-indexed end line
    charStart: number;    // Character offset from file start
    charEnd: number;      // Character offset end
}
```

This reference allows reading the code from disk when server requests it.

## Implementation

### Step 1: HashedChunk Class

[hashed-chunk.ts](../../Chunk-Hashing/src/hashed-chunk.ts)

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
        // ... other metadata

        // The `text` parameter is NOT stored - it's only used for hashing
    }

    static computeHash(content: string): string {
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }
}
```

**Key point**: The `text` parameter is used only for computing the hash, then discarded. The code is NOT stored in the chunk.

### Step 2: ChunkHasher Class

[chunk-hasher.ts](../../Chunk-Hashing/src/chunk-hasher.ts)

```typescript
export class ChunkHasher {
    /**
     * Hash a file's code into chunks
     * Returns HashedChunk[] (hash + reference, no code stored)
     */
    hashFile(code: string, language: string, filePath: string): HashedChunk[] {
        // Parse with Tree-sitter
        const tree = this.parser.parse(code);

        // Extract semantic chunks and compute hashes
        const chunks: HashedChunk[] = [];
        this.extractAndHashChunks(tree.rootNode, code, language, filePath, semanticTypes, chunks);

        // Fill gaps between chunks
        return this.fillGaps(chunks, code, language, filePath);
    }

    /**
     * Create sync payload for Phase 2 (metadata exchange)
     * This is what gets sent to server - hashes only, no code
     */
    createSyncPayload(chunks: HashedChunk[], filePath: string): FileSyncPayload {
        return {
            filePath,
            chunks: chunks.map(chunk => chunk.toSyncPayload()),
        };
    }
}
```

### Step 3: Sync Payload

The `FileSyncPayload` is what gets sent to the server during Phase 2:

```typescript
interface FileSyncPayload {
    filePath: string;         // Can be obfuscated before sending
    chunks: ChunkSyncPayload[];
}

interface ChunkSyncPayload {
    hash: string;
    type: ChunkType;
    name: string | null;
    lines: [number, number];  // [lineStart, lineEnd]
    charCount: number;
}
```

**Notice**: No `code` field! The server receives only hashes and metadata.

## Running the Example

```bash
npm start
```

Output:

```
=== Chunk Hashing Demo ===

📁 Processing file: C:\project\src\user-service.js

--- Hashed Chunks (no code stored!) ---

Chunk 1:
  Type: block
  Name: (none)
  Hash: 487855891acbe530...
  Lines: 1-12
  Size: 181 chars

Chunk 2:
  Type: function
  Name: getUser
  Hash: 495864761bf8e61d...
  Lines: 13-21
  Size: 226 chars

📤 Phase 2 Payload (sent to server):

FileSyncPayload:
  filePath: C:\project\src\user-service.js
  chunks: [
    { hash: "487855891acbe530...", type: "block", lines: [1, 12] }
    { hash: "495864761bf8e61d...", type: "function", name: "getUser", lines: [13, 21] }
    ...
  ]

⚡ Notice: NO actual code in the payload!

📊 Summary:
  Payload size: ~614 bytes (hashes only)
  Code size: ~997 bytes (NOT sent unless requested)
  Savings: 38.4% less data in Phase 2
```

## How This Fits in the Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    FULL PIPELINE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. File Watcher (Lab-03)                                   │
│     Detects file changes → adds to dirty queue              │
│                                                             │
│  2. Merkle Tree (Lab-06)                                    │
│     O(1) change detection via root comparison               │
│                                                             │
│  3. Semantic Chunking (Lab-04)                              │
│     Parse AST → extract functions, classes, methods         │
│                                                             │
│  4. Chunk Hashing (Lab-07) ← YOU ARE HERE                   │
│     Compute SHA-256 hashes, store references                │
│                                                             │
│  5. Two-Phase Sync                                          │
│     Phase 2: Send hashes → Server checks cache              │
│     Phase 3: Send code only for new/changed chunks          │
│                                                             │
│  6. Server Processing                                       │
│     Generate embeddings → Discard code → Store in VectorDB  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Why Not Store Code Locally?

1. **Memory efficiency** - Large codebases would require significant memory
2. **Always fresh** - Reading from disk ensures we send current code
3. **Simpler state** - No need to sync local chunk cache
4. **Server decides** - Server cache determines what's needed

### Why Store References?

Without references, we'd need to re-parse the entire file to extract specific chunks. References provide O(1) code retrieval:

```typescript
// Phase 3: Server requests chunk by hash
const neededHash = "495864761bf8e61d...";
const chunk = chunks.find(c => c.hash === neededHash);

// Read code using reference
const code = fs.readFileSync(chunk.reference.filePath, 'utf8');
const lines = code.split('\n');
const chunkCode = lines.slice(
    chunk.reference.lineStart - 1,
    chunk.reference.lineEnd
).join('\n');

// Send to server
sendToServer({ hash: neededHash, code: chunkCode });
```

## Summary

| Concept | Description |
|---------|-------------|
| **HashedChunk** | Hash + reference, no code stored |
| **ChunkHasher** | Parses code, computes hashes, creates sync payloads |
| **ChunkReference** | File path + line numbers for code retrieval |
| **FileSyncPayload** | What gets sent to server (hashes only) |
| **Two-Phase Sync** | Hashes first, code only when requested |

This chunk hashing layer enables efficient sync with minimal data transfer—only new or changed chunks' code is ever sent to the server.
