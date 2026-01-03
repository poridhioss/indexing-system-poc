# Case Study: Cursor IDE Codebase Indexing Architecture

This document provides a deep technical analysis of how Cursor IDE indexes codebases, with a comparison to Puku's approach. Understanding Cursor's architecture helps us build better indexing systems for AI code assistants.

---

## Overview: What Makes Cursor's Indexing Special?

Cursor uses a sophisticated multi-layered architecture for codebase indexing:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       CURSOR INDEXING ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   LOCAL (Your Machine)                    REMOTE (Cursor Servers)               │
│   ────────────────────                    ───────────────────────                │
│                                                                                  │
│   ┌─────────────┐                         ┌─────────────────────┐               │
│   │  Codebase   │                         │  Turbopuffer        │               │
│   │  Files      │                         │  (Vector DB)        │               │
│   └──────┬──────┘                         └──────────▲──────────┘               │
│          │                                           │                          │
│          ▼                                           │                          │
│   ┌─────────────┐     Encrypted      ┌──────────────┴──────────┐               │
│   │ Merkle Tree │ ──── Chunks ─────► │  Embedding Generation   │               │
│   │ (Hashes)    │                    │  (OpenAI/Custom Model)  │               │
│   └──────┬──────┘                    └─────────────────────────┘               │
│          │                                                                      │
│          ▼                                                                      │
│   ┌─────────────┐                         ┌─────────────────────┐               │
│   │ Tree-sitter │                         │  AWS Embedding      │               │
│   │ AST Chunking│                         │  Cache (by hash)    │               │
│   └─────────────┘                         └─────────────────────┘               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key Innovation:** Cursor combines **Merkle trees** for efficient change detection with **AST-based chunking** for semantic understanding.

---

## Part 1: Merkle Tree Architecture

### What is a Merkle Tree?

A Merkle tree (hash tree) is a data structure where:
- **Leaf nodes** = Hash of individual files
- **Internal nodes** = Hash of child node hashes combined
- **Root** = Single hash representing entire codebase state

```
                        ROOT HASH
                    ┌───────────────┐
                    │   abc123...   │  ← Changes if ANY file changes
                    └───────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
        ┌─────┴─────┐             ┌─────┴─────┐
        │  def456   │             │  ghi789   │  ← Directory hashes
        └─────┬─────┘             └─────┬─────┘
              │                         │
       ┌──────┴──────┐           ┌──────┴──────┐
       │             │           │             │
   ┌───┴───┐   ┌───┴───┐   ┌───┴───┐   ┌───┴───┐
   │ hash1 │   │ hash2 │   │ hash3 │   │ hash4 │  ← File hashes
   └───────┘   └───────┘   └───────┘   └───────┘
       │           │           │           │
   main.js    utils.js    api.ts     types.ts
```

### Why Cursor Uses Merkle Trees

| Problem | Without Merkle Tree | With Merkle Tree |
|---------|---------------------|------------------|
| **Detect changes** | Check every file (O(n)) | Compare root hash (O(1)) |
| **Find changed files** | Diff all files | Walk tree path (O(log n)) |
| **Sync to server** | Upload all files | Upload only changed |
| **Re-index** | Re-embed everything | Re-embed deltas only |

### Cursor's Merkle Tree Implementation

According to [Engineer's Codex](https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast):

```javascript
// Pseudocode of Cursor's approach
class CursorMerkleClient {
    // On startup
    async startupHandshake() {
        const localTree = this.computeMerkleTree(projectFiles);
        const rootHash = localTree.root.hash;

        // Send root hash to server
        const serverTree = await api.sendRootHash(rootHash);

        // Server compares and returns which subtrees differ
        const changedPaths = this.findDifferences(localTree, serverTree);

        // Only sync changed files
        await this.syncChangedFiles(changedPaths);
    }

    // Every 10 minutes
    async periodicSync() {
        const currentTree = this.computeMerkleTree(projectFiles);
        const changes = this.diffWithServer(currentTree);

        if (changes.length > 0) {
            await this.uploadChangedChunks(changes);
        }
    }
}
```

### Efficiency Gains

From [ByteByteGo](https://blog.bytebytego.com/p/how-cursor-serves-billions-of-ai):

> "By comparing these trees every few minutes, Cursor can pinpoint exactly which files have been modified and only send those changed parts for re-indexing, minimizing bandwidth and latency."

**Real-world impact:**
- 10,000 file codebase, 5 files changed
- **Without Merkle:** Upload 10,000 files → Re-embed 10,000 chunks
- **With Merkle:** Upload 5 files → Re-embed ~15 chunks

---

## Part 2: AST-Based Code Chunking

### Why Not Simple Text Splitting?

Cursor explicitly avoids naive chunking approaches:

| Method | Problem |
|--------|---------|
| **Character-based** | Cuts mid-word: `functio` + `n getName()` |
| **Line-based** | Cuts mid-function: half of logic in chunk 1, half in chunk 2 |
| **Token-based** | Better but still arbitrary boundaries |
| **AST-based** | ✅ Respects semantic boundaries (functions, classes) |

### Cursor's Chunking Strategy

From the [Cursor documentation](https://docs.cursor.com/context/codebase-indexing):

> "Cursor uses AST-based splitting with `tree-sitter` to parse code into logical blocks (functions, classes). It respects token limits by merging sibling AST nodes without exceeding model token caps (e.g., 8k for OpenAI), and maintains semantic boundaries to avoid mid-function splits for better embeddings."

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CURSOR CHUNKING PROCESS                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   Source File                    Tree-sitter AST              Chunks            │
│   ───────────                    ───────────────              ──────            │
│                                                                                  │
│   class User {                   class_declaration ─────────► Chunk 1           │
│     constructor() {...}           ├─ method_def ─────────────► (merged if small)│
│     getName() {...}               ├─ method_def                                 │
│     getEmail() {...}              └─ method_def                                 │
│   }                                                                             │
│                                                                                 │
│   function validate() {          function_declaration ──────► Chunk 2          │
│     ...100 lines...                                                            │
│   }                                                                             │
│                                                                                  │
│   const helper = () => {...}     arrow_function ────────────► Chunk 3          │
│                                                                (if > min size)  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Token Limit Handling

Cursor respects embedding model limits (OpenAI's text-embedding-3-small: 8,192 tokens):

```javascript
// Pseudocode
function chunkWithTokenLimit(astNode, maxTokens = 8000) {
    if (countTokens(astNode.text) <= maxTokens) {
        return [createChunk(astNode)];
    }

    // Too big - split by children
    const chunks = [];
    let currentChunk = [];
    let currentTokens = 0;

    for (const child of astNode.children) {
        const childTokens = countTokens(child.text);

        if (currentTokens + childTokens > maxTokens) {
            // Flush current chunk
            chunks.push(mergeNodes(currentChunk));
            currentChunk = [child];
            currentTokens = childTokens;
        } else {
            currentChunk.push(child);
            currentTokens += childTokens;
        }
    }

    if (currentChunk.length > 0) {
        chunks.push(mergeNodes(currentChunk));
    }

    return chunks;
}
```

---

## Part 3: Embedding & Storage

### Embedding Generation

Cursor uses OpenAI's embedding models (or custom models):

```
Chunk Text → Encryption (local) → Server → Decryption → Embedding Model → Vector
                                                              │
                                                              ▼
                                            [0.023, -0.156, 0.089, ..., 0.042]
                                                    (1536 dimensions for OpenAI)
```

### Storage: Turbopuffer

Cursor stores embeddings in [Turbopuffer](https://turbopuffer.com/), a vector database optimized for:
- Fast nearest-neighbor search
- Filtering by metadata (file path, line numbers)
- High availability

**What's stored:**
| Field | Description |
|-------|-------------|
| `embedding` | 1536-dim vector |
| `file_path` | Obfuscated/encrypted path |
| `line_start` | Starting line number |
| `line_end` | Ending line number |
| `chunk_hash` | For cache lookup |

### Embedding Cache (AWS)

> "Cursor stores embeddings in a cache in AWS, indexed by the hash of the chunk, ensuring that re-indexing the same codebase is much faster."

**Cache benefits:**
- Same chunk across different users = same embedding
- Team members share cache (via git commit hash derivation)
- Re-opening project doesn't re-compute embeddings

---

## Part 4: Query Flow (RAG)

When you ask Cursor about your codebase:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CURSOR RAG QUERY FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   1. USER QUERY                                                                 │
│      "How does authentication work?"                                            │
│                     │                                                           │
│                     ▼                                                           │
│   2. QUERY EMBEDDING                                                            │
│      [0.12, -0.08, ...] ──────────────────────┐                                │
│                                               │                                 │
│                                               ▼                                 │
│   3. VECTOR SEARCH (Turbopuffer)                                               │
│      Find top-k similar chunk embeddings                                        │
│      Returns: [file: "auth.ts:10-50", file: "login.ts:5-30", ...]             │
│                     │                                                           │
│                     ▼                                                           │
│   4. LOCAL FILE RETRIEVAL                                                       │
│      Read actual code from YOUR machine                                         │
│      (Server only has embeddings, not code)                                     │
│                     │                                                           │
│                     ▼                                                           │
│   5. LLM CONTEXT ASSEMBLY                                                       │
│      [System Prompt] + [Retrieved Code Chunks] + [User Query]                  │
│                     │                                                           │
│                     ▼                                                           │
│   6. LLM RESPONSE                                                              │
│      "Authentication uses JWT tokens in auth.ts. The login flow..."            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 5: Privacy & Security Design

### Key Privacy Features

| Feature | How It Works |
|---------|--------------|
| **Path Obfuscation** | Directory segments encrypted separately |
| **Chunk Encryption** | Code encrypted locally before upload |
| **No Code Storage** | Server discards code after embedding |
| **Embedding One-way** | Cannot reconstruct code from vectors |
| **Privacy Mode** | Optional stricter controls |

### .cursorignore Support

```gitignore
# .cursorignore - files to exclude from indexing
.env
*.secret
credentials/
node_modules/
```

---

## Part 6: Cursor vs Puku - Architecture Comparison

### Side-by-Side Comparison

| Aspect | Cursor | Puku (Current) |
|--------|--------|----------------|
| **Change Detection** | Merkle Tree (O(log n)) | Content Hash (O(n)) |
| **Chunking** | AST (tree-sitter) | AST (tree-sitter) ✅ |
| **Summarization** | ❌ None (direct embedding) | ✅ LLM summaries |
| **Embedding Model** | OpenAI (1536-dim) | OpenRouter (1024-dim) |
| **Vector Storage** | Turbopuffer (cloud) | sqlite-vec (local) |
| **Sync** | Client-server every 10 min | Local only |
| **Privacy** | Encrypted chunks to server | All local ✅ |
| **Caching** | AWS (by chunk hash) | SQLite (by content hash) |

### Architecture Diagrams

**Cursor (Cloud-centric):**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Local     │     │   Cursor    │     │ Turbopuffer │     │    LLM      │
│   Files     │────►│   Server    │────►│  Vector DB  │────►│  (OpenAI)   │
│             │     │             │     │   (Cloud)   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
     Merkle            Embedding           Storage            Query
     Hashes            Generation          + Search
```

**Puku (Local-first):**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Local     │     │  Puku       │     │  sqlite-vec │     │    LLM      │
│   Files     │────►│  Extension  │────►│   (Local)   │────►│ (OpenRouter)│
│             │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
     Content           Chunking +          Storage            Query
     Hashes           Summarization        + Search
```

### What Puku Could Adopt from Cursor

| Feature | Benefit | Implementation Effort |
|---------|---------|----------------------|
| **Merkle Tree** | O(log n) change detection | Medium |
| **Incremental Sync** | Only re-embed changed files | Medium |
| **Embedding Cache by Hash** | Skip duplicate chunks | Low |
| **AST Node Merging** | Better token utilization | Low |

### What Puku Does Better

| Feature | Puku Advantage |
|---------|----------------|
| **LLM Summarization** | Better semantic matching for natural language queries |
| **Local-First** | No data leaves machine, faster queries |
| **sqlite-vec** | Modern, embedded, no cloud dependency |
| **Open Source** | Extensible, auditable |

---

## Part 7: Implementing Merkle Trees (For Puku)

### Basic Merkle Tree Implementation

```typescript
import * as crypto from 'crypto';

interface MerkleNode {
    hash: string;
    path: string;
    children?: MerkleNode[];
    isFile: boolean;
}

class MerkleTree {
    private root: MerkleNode | null = null;

    /**
     * Compute hash of a file's contents
     */
    private hashFile(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Compute hash of children hashes combined
     */
    private hashChildren(children: MerkleNode[]): string {
        const combined = children.map(c => c.hash).sort().join('');
        return crypto.createHash('sha256').update(combined).digest('hex');
    }

    /**
     * Build tree from file system
     */
    async buildTree(files: Map<string, string>): Promise<MerkleNode> {
        // Group files by directory
        const tree = this.groupByDirectory(files);

        // Build bottom-up
        this.root = this.buildNode('/', tree);
        return this.root;
    }

    /**
     * Find changed files between two trees
     */
    findChanges(oldTree: MerkleNode, newTree: MerkleNode): string[] {
        const changes: string[] = [];

        function compare(oldNode: MerkleNode | undefined, newNode: MerkleNode | undefined, path: string) {
            // New file
            if (!oldNode && newNode) {
                if (newNode.isFile) changes.push(path);
                else newNode.children?.forEach(c => compare(undefined, c, `${path}/${c.path}`));
                return;
            }

            // Deleted file
            if (oldNode && !newNode) {
                if (oldNode.isFile) changes.push(path);
                return;
            }

            // Both exist - compare hashes
            if (oldNode!.hash === newNode!.hash) return; // No change in subtree

            // Hash differs
            if (newNode!.isFile) {
                changes.push(path);
            } else {
                // Recurse into children
                const oldChildren = new Map(oldNode!.children?.map(c => [c.path, c]));
                const newChildren = new Map(newNode!.children?.map(c => [c.path, c]));

                const allPaths = new Set([...oldChildren.keys(), ...newChildren.keys()]);
                for (const childPath of allPaths) {
                    compare(oldChildren.get(childPath), newChildren.get(childPath), `${path}/${childPath}`);
                }
            }
        }

        compare(oldTree, newTree, '');
        return changes;
    }
}
```

### Integration with Puku

```typescript
// In pukuIndexingService.ts
class PukuIndexingService {
    private merkleTree: MerkleTree;
    private lastTree: MerkleNode | null = null;

    async incrementalReindex() {
        // Build current tree
        const currentTree = await this.merkleTree.buildTree(this.fileContents);

        if (this.lastTree) {
            // Find only changed files
            const changedPaths = this.merkleTree.findChanges(this.lastTree, currentTree);

            console.log(`[Indexing] ${changedPaths.length} files changed (Merkle diff)`);

            // Only re-chunk and re-embed changed files
            for (const path of changedPaths) {
                await this.reindexFile(path);
            }
        } else {
            // First run - index everything
            await this.fullReindex();
        }

        this.lastTree = currentTree;
    }
}
```

---

## Summary

### Cursor's Key Innovations

1. **Merkle Trees** - O(log n) change detection instead of O(n)
2. **AST Chunking** - Semantic boundaries, not arbitrary splits
3. **Cloud Sync** - Team sharing, cross-device continuity
4. **Embedding Cache** - Skip re-computation for identical chunks
5. **Privacy Design** - Encryption, obfuscation, no code storage

### What We Can Learn

| Lesson | Application |
|--------|-------------|
| Merkle trees are essential for large codebases | Implement in Puku Labs 06-08 |
| AST chunking beats line-based | Already implemented in Puku ✅ |
| Caching by content hash saves compute | Puku has basic version, can improve |
| 10-minute sync interval is practical | Consider for Puku file watcher |

---

## Sources

- [How Cursor Indexes Codebases Fast - Engineer's Codex](https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast)
- [How Cursor Serves Billions of AI Completions - ByteByteGo](https://blog.bytebytego.com/p/how-cursor-serves-billions-of-ai)
- [Cursor Official Documentation - Codebase Indexing](https://docs.cursor.com/context/codebase-indexing)
- [How Cursor Works - BitPeak](https://bitpeak.com/how-cursor-works-deep-dive-into-vibe-coding/)
- [Cursor Security Documentation](https://cursor.com/security)
