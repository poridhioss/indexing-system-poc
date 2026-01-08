# Cursor Architecture: Security & Indexing Deep Dive

This document explains how Cursor (and similar AI code editors) handle codebase indexing while protecting user code privacy. Based on official Cursor documentation and technical analysis.

## Table of Contents

1. [Security Model](#security-model-code-never-stored-on-server)
2. [What the Server Stores](#what-the-server-actually-stores)
3. [Path Obfuscation](#path-obfuscation)
4. [Query-Time Flow](#query-time-flow-how-search-works)
5. [Indexing Pipeline](#indexing-pipeline)
6. [Sync Intervals](#sync-intervals)
7. [Key Takeaways](#key-takeaways)

## Security Model: Code Never Stored on Server

A critical design principle: **your actual source code is NEVER permanently stored on the server**. This addresses the primary security concern users have about AI code tools.

### What Happens During Indexing

1. **Client sends chunks temporarily**: Code chunks are sent to the server for embedding generation
2. **Server generates embeddings**: The embedding model processes the code
3. **Code is immediately discarded**: After embedding generation, the raw code is deleted from server memory
4. **Only embeddings are stored**: The numerical vectors (not readable code) go to the vector database

```
┌─────────────────────────────────────────────────────────────┐
│                     INDEXING FLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Client                           Server                    │
│  ┌─────────┐                     ┌─────────┐               │
│  │ Chunk 1 │────── send ────────>│ Process │               │
│  │ Chunk 2 │                     │         │               │
│  │ Chunk 3 │                     │ Generate│               │
│  └─────────┘                     │Embedding│               │
│                                  └────┬────┘               │
│                                       │                     │
│                                       ▼                     │
│                              ┌────────────────┐            │
│                              │ DISCARD CODE   │◄── Important│
│                              └────────────────┘            │
│                                       │                     │
│                                       ▼                     │
│                              ┌────────────────┐            │
│                              │ Store ONLY:    │            │
│                              │ - Embeddings   │            │
│                              │ - Chunk hashes │            │
│                              │ - Obfusc. paths│            │
│                              └────────────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## What the Server Actually Stores

| Data | Stored? | Where | Purpose |
|------|---------|-------|---------|
| Raw source code | **NO** | Never stored | Security |
| Embeddings | Yes | Turbopuffer (vector DB) | Semantic search |
| Chunk hashes | Yes | AWS cache | Deduplication |
| File paths | Yes (obfuscated) | With embeddings | Location reference |
| Line ranges | Yes | With embeddings | Code location |

### Why Store Chunk Hashes?

Chunk hashes enable the "skip if unchanged" optimization:

```
Next sync:
  Client: "Here's chunk hash abc123"
  Server: "I already have embedding for abc123, skip it"

Result: No re-embedding needed, no code sent
```

This is the key to efficient incremental indexing - the server can recognize unchanged chunks by their hash without ever seeing the code again.

## Path Obfuscation

File paths are encrypted or obfuscated before storage. The server stores something like `enc:a7f3e2b1...` instead of `/users/john/secret-project/auth.ts`. This provides an additional layer of privacy.

```
Original path:    /users/john/company/src/auth/login.ts
Obfuscated:       enc:7f3e2b1a9c4d8f...
Line range:       42-87

The server knows "there's code at lines 42-87 of encrypted-path"
but cannot determine the actual file location or project structure.
```

## Query-Time Flow (How Search Works)

When you search your codebase, here's what actually happens:

```
┌────────────────────────────────────────────────────────────────┐
│                    QUERY-TIME FLOW                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Step 1: User Query                                            │
│  ────────────────────                                          │
│  Client → Server: "find authentication logic"                  │
│                                                                │
│  Step 2: Semantic Search                                       │
│  ────────────────────                                          │
│  Server: Searches embeddings in Turbopuffer                    │
│  Server: Finds top-k matching embeddings                       │
│                                                                │
│  Step 3: Return Metadata (NOT Code)                            │
│  ────────────────────                                          │
│  Server → Client: [                                            │
│    { path: "enc:abc...", lines: [42, 87], score: 0.92 },       │
│    { path: "enc:def...", lines: [10, 45], score: 0.87 }        │
│  ]                                                             │
│                                                                │
│  Step 4: Client Reads Locally                                  │
│  ────────────────────                                          │
│  Client: Decrypts paths → reads code from LOCAL disk           │
│  Client: Extracts relevant code snippets                       │
│                                                                │
│  Step 5: LLM Request                                           │
│  ────────────────────                                          │
│  Client → Server: Query + code snippets (temporary)            │
│  Server: Sends to LLM for response                             │
│  Server: Returns answer, discards code                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**The key insight**: The server never needs to store your code because the client always has access to the original files on disk.

## Indexing Pipeline

### Initial Index (First Time)

```
Client-side:
1. Scan files (respect .gitignore)
2. Build Merkle tree from file hashes
3. Parse AST with Tree-sitter
4. Create semantic chunks (functions, classes)
5. Hash each chunk: SHA-256(chunk.text)
6. Send chunks + hashes to server

Server-side:
1. Generate embeddings for each chunk
2. DISCARD the raw code immediately
3. Store embeddings in Turbopuffer (indexed by chunk hash)
4. Cache chunk hashes in AWS
5. Store obfuscated paths + line ranges with embeddings
```

### Incremental Sync (Two-Phase Protocol)

The incremental sync uses a **two-phase protocol** to minimize data transfer:

```
┌─────────────────────────────────────────────────────────────────┐
│              PHASE 1: MERKLE ROOT COMPARISON                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                              Server                     │
│  ┌──────────────┐                   ┌──────────────┐           │
│  │ Merkle Root  │────── sync ──────>│ Merkle Root  │           │
│  │ "abc123..."  │                   │ "xyz789..."  │           │
│  └──────────────┘                   └──────────────┘           │
│                                            │                    │
│                                            ▼                    │
│                                     Roots different!            │
│                                     Request dirty files         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              PHASE 2: METADATA EXCHANGE (NO CODE YET)           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client processes dirty queue:                                  │
│  1. Re-parse changed files with Tree-sitter                     │
│  2. Re-chunk into semantic units                                │
│  3. Compute new chunk hashes                                    │
│                                                                 │
│  Client sends METADATA ONLY (no code):                          │
│  ┌─────────────────────────────────────────┐                   │
│  │ {                                        │                   │
│  │   file: "enc:abc...",                   │                   │
│  │   chunks: [                              │                   │
│  │     { hash: "aaa111", lines: [1,20] },  │  ← Only hashes    │
│  │     { hash: "bbb222", lines: [22,45] }, │    and metadata   │
│  │     { hash: "ccc333", lines: [47,80] }  │    NO CODE        │
│  │   ]                                      │                   │
│  │ }                                        │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                 │
│  Server checks AWS cache:                                       │
│  ┌─────────────────────────────────────────┐                   │
│  │ "aaa111" → EXISTS in cache (skip)       │                   │
│  │ "bbb222" → NOT FOUND (need embedding)   │                   │
│  │ "ccc333" → EXISTS in cache (skip)       │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                 │
│  Server responds with needed chunks:                            │
│  "Send code for: bbb222"                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              PHASE 3: CODE TRANSFER (ONLY CHANGED)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client sends ONLY requested chunks:                            │
│  ┌─────────────────────────────────────────┐                   │
│  │ {                                        │                   │
│  │   hash: "bbb222",                       │                   │
│  │   code: "function login() { ... }"      │  ← Only this one  │
│  │ }                                        │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                 │
│  Server:                                                        │
│  1. Generate embedding for bbb222                               │
│  2. DISCARD the code immediately                                │
│  3. Store embedding in Turbopuffer                              │
│  4. Update hash cache in AWS                                    │
│  5. Confirm sync complete                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Two-Phase?

| Approach | Data Transferred | Network Cost |
|----------|------------------|--------------|
| Send all code | 500 chunks × 2KB = 1MB | High |
| Send all hashes first | 500 hashes × 64B = 32KB | Low |
| Then send only changed | 1 chunk × 2KB = 2KB | Minimal |
| **Total with two-phase** | **~34KB** | **97% savings** |

The two-phase protocol ensures:
1. **Minimal data transfer** - Only hashes sent initially
2. **Server-side deduplication** - Cache lookup before requesting code
3. **Privacy** - Code only sent when absolutely necessary

## Sync Intervals

Cursor uses periodic sync rather than real-time sync:

| Event | Action | Timing |
|-------|--------|--------|
| File save | Update local Merkle tree, mark dirty | Immediate (local only) |
| Periodic sync | Send dirty files to server | ~5-10 minutes |
| Project open | Full sync if needed | On startup |
| Manual trigger | Force sync | User-initiated |

This batching approach:
- Reduces server load by 100x
- Groups multiple rapid edits
- Minimizes network traffic
- Still provides fresh enough index for most use cases

## Key Takeaways

### For Security

1. **Code is temporary**: Raw code exists on server only during embedding generation
2. **Embeddings are not reversible**: Cannot reconstruct code from embeddings
3. **Paths are obfuscated**: Server doesn't know your actual file structure
4. **Local-first design**: Client reads code locally at query time

### For Performance

1. **Chunk hashes enable deduplication**: Only embed new/changed code
2. **Merkle tree enables O(1) change detection**: Compare roots first
3. **Batched sync reduces overhead**: ~10 min intervals, not real-time
4. **Vector DB enables semantic search**: Find by meaning, not just keywords

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE SUMMARY                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CLIENT (Local Disk)         SERVER                         │
│  ┌──────────────────┐       ┌──────────────────┐           │
│  │ Source files     │       │ Embeddings       │           │
│  │ Merkle tree      │       │ (Turbopuffer)    │           │
│  │ File hashes      │       │                  │           │
│  │ Chunk hashes     │       │ Chunk hashes     │           │
│  │ Dirty queue      │       │ (AWS cache)      │           │
│  │                  │       │                  │           │
│  │ ACTUAL CODE ✓    │       │ NO CODE ✗        │           │
│  └──────────────────┘       └──────────────────┘           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This architecture enables powerful AI features while maintaining user privacy - a critical balance for production code editors.

## Sources

- [Cursor Privacy Policy](https://cursor.sh/privacy)
- [Cursor Security Documentation](https://cursor.sh/security)
- Technical analysis of Cursor's indexing behavior
