# POC Implementation Plan: KV + Vectorize

## Overview

Two-phase implementation approach for the indexing worker, designed to integrate with Labs 4-7.

| Phase | Focus | Components |
|-------|-------|------------|
| **Phase 1** | Core Sync Infrastructure | KV storage, Merkle comparison, Two-phase sync |
| **Phase 2** | AI Processing Pipeline | Summarization, Embeddings, Vectorize storage |

---

## Architecture Decision

**Chosen Architecture: KV + Vectorize**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FINAL ARCHITECTURE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SERVER (Cloudflare Worker)                                                 │
│  ├── KV: INDEX_STATE                                                        │
│  │   ├── merkleRoot:{userId}:{projectId} → "abc123..."                      │
│  │   └── chunkHash:{hash} → "1"                                             │
│  │                                                                          │
│  └── Vectorize: CODE_EMBEDDINGS (Phase 2)                                   │
│      └── vectors with metadata                                              │
│                                                                              │
│  CLIENT (Labs 4-7)                                                          │
│  ├── File Watcher (Lab-04)                                                  │
│  ├── Merkle Tree (Lab-05)                                                   │
│  ├── AST Chunker (Lab-06)                                                   │
│  ├── Chunk Hasher (Lab-07)                                                  │
│  └── SQLite Cache (new)                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Sync Infrastructure

### Goal
Implement the two-phase sync protocol with KV storage. No AI processing yet - just hash-based synchronization.

### Phase 1 Flows

#### Flow 1.1: First Time Project Open
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FIRST TIME PROJECT OPEN (Phase 1)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CLIENT                                                                      │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. User opens project                                                       │
│  2. File Watcher scans all files                                            │
│  3. Merkle Tree computes file hashes → root hash                            │
│  4. AST Chunker parses all files → semantic chunks                          │
│  5. Chunk Hasher creates HashedChunk[] (hash + reference, no code)          │
│  6. Store merkle state in .puku/merkle-state.json                           │
│  7. Send to server: POST /v1/index/init                                     │
│                                                                              │
│  REQUEST PAYLOAD                                                            │
│  ────────────────────────────────────────────────────────────────────────   │
│  {                                                                           │
│    "userId": "user-123",                                                    │
│    "projectId": "project-456",                                              │
│    "merkleRoot": "abc123...",                                               │
│    "chunks": [                                                               │
│      { "hash": "chunk-hash-1", "type": "function", "name": "login",         │
│        "lines": [10, 25], "filePath": "src/auth.ts" },                      │
│      { "hash": "chunk-hash-2", "type": "class", "name": "AuthService",      │
│        "lines": [30, 80], "filePath": "src/auth.ts" }                       │
│    ]                                                                         │
│  }                                                                           │
│  NOTE: No code sent yet! Just hashes and metadata.                          │
│                                                                              │
│  SERVER                                                                      │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. Store merkle root in KV: merkleRoot:{userId}:{projectId}                │
│  2. Check which chunk hashes are NOT in KV cache                            │
│  3. Return list of needed hashes                                            │
│                                                                              │
│  RESPONSE                                                                   │
│  ────────────────────────────────────────────────────────────────────────   │
│  {                                                                           │
│    "status": "need_chunks",                                                 │
│    "needed": ["chunk-hash-1", "chunk-hash-2"],  // All hashes (first time) │
│    "cached": []                                                              │
│  }                                                                           │
│                                                                              │
│  CLIENT (continued)                                                         │
│  ────────────────────────────────────────────────────────────────────────   │
│  8. Read code from disk for needed chunks (using HashedChunk.reference)     │
│  9. Send to server: POST /v1/index/chunks                                   │
│                                                                              │
│  REQUEST PAYLOAD                                                            │
│  ────────────────────────────────────────────────────────────────────────   │
│  {                                                                           │
│    "chunks": [                                                               │
│      { "hash": "chunk-hash-1", "code": "function login(...) {...}",         │
│        "type": "function", "name": "login", "languageId": "typescript" },   │
│      { "hash": "chunk-hash-2", "code": "class AuthService {...}",           │
│        "type": "class", "name": "AuthService", "languageId": "typescript" } │
│    ]                                                                         │
│  }                                                                           │
│                                                                              │
│  SERVER                                                                      │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. Store chunk hashes in KV: chunkHash:{hash} → "1"                        │
│  2. (Phase 2: Summarize + Embed + Store in Vectorize)                       │
│  3. Return confirmation                                                      │
│                                                                              │
│  RESPONSE                                                                   │
│  ────────────────────────────────────────────────────────────────────────   │
│  {                                                                           │
│    "status": "indexed",                                                     │
│    "chunksProcessed": 2                                                     │
│  }                                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Flow 1.2: Ongoing File Changes (Background)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ONGOING FILE CHANGES (Phase 1)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CLIENT (Background - No Server Contact)                                    │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. User saves a file                                                        │
│  2. File Watcher detects change via @parcel/watcher                         │
│  3. Merkle Tree recomputes:                                                 │
│     - File hash for changed file                                            │
│     - Updates affected branch nodes                                         │
│     - Computes new root hash                                                │
│  4. Dirty Queue adds file: .puku/dirty-queue.json                           │
│                                                                              │
│  LOCAL STATE                                                                │
│  ────────────────────────────────────────────────────────────────────────   │
│  .puku/merkle-state.json:                                                   │
│  {                                                                           │
│    "root": "xyz789...",  // Updated root                                    │
│    "leaves": [...],                                                          │
│    "timestamp": "2024-01-11T..."                                            │
│  }                                                                           │
│                                                                              │
│  .puku/dirty-queue.json:                                                    │
│  {                                                                           │
│    "lastSync": "2024-01-11T10:00:00Z",                                      │
│    "dirtyFiles": [                                                           │
│      "/abs/path/src/auth.ts",                                               │
│      "/abs/path/src/user.ts"                                                │
│    ]                                                                         │
│  }                                                                           │
│                                                                              │
│  No server contact until periodic sync!                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Flow 1.3: Periodic Sync (Every 10 Minutes)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PERIODIC SYNC - Two-Phase Protocol (Phase 1)              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  STEP 1: Merkle Root Check                                                  │
│  ────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  CLIENT                                                                      │
│  POST /v1/index/check                                                       │
│  {                                                                           │
│    "userId": "user-123",                                                    │
│    "projectId": "project-456",                                              │
│    "merkleRoot": "xyz789..."  // Current client root                        │
│  }                                                                           │
│                                                                              │
│  SERVER                                                                      │
│  1. Get stored root from KV: merkleRoot:{userId}:{projectId}                │
│  2. Compare with client's root                                              │
│                                                                              │
│  RESPONSE (roots match - no sync needed)                                    │
│  {                                                                           │
│    "changed": false,                                                        │
│    "serverRoot": "xyz789..."                                                │
│  }                                                                           │
│  → Client does nothing, clears dirty queue                                  │
│                                                                              │
│  RESPONSE (roots differ - sync needed)                                      │
│  {                                                                           │
│    "changed": true,                                                         │
│    "serverRoot": "abc123..."  // Server's old root                          │
│  }                                                                           │
│  → Continue to Step 2                                                       │
│                                                                              │
│  ════════════════════════════════════════════════════════════════════════   │
│                                                                              │
│  STEP 2: Two-Phase Sync                                                     │
│  ────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  PHASE 2A: Hash Check (No Code)                                             │
│  ─────────────────────────────                                              │
│                                                                              │
│  CLIENT                                                                      │
│  1. Read dirty queue: .puku/dirty-queue.json                                │
│  2. AST Chunker parses ONLY dirty files                                     │
│  3. Chunk Hasher creates HashedChunk[] for dirty files                      │
│  4. Send hashes to server                                                   │
│                                                                              │
│  POST /v1/index/sync                                                        │
│  {                                                                           │
│    "phase": 1,                                                              │
│    "userId": "user-123",                                                    │
│    "projectId": "project-456",                                              │
│    "merkleRoot": "xyz789...",                                               │
│    "chunks": [                                                               │
│      { "hash": "new-hash-1", "type": "function", "name": "login",           │
│        "lines": [10, 30] },                                                 │
│      { "hash": "existing-hash", "type": "function", "name": "logout",       │
│        "lines": [35, 45] }                                                  │
│    ]                                                                         │
│  }                                                                           │
│  NOTE: No code sent! Just hashes.                                           │
│                                                                              │
│  SERVER                                                                      │
│  1. Update merkle root in KV                                                │
│  2. Check each hash against KV cache                                        │
│  3. Return which hashes are NOT cached                                      │
│                                                                              │
│  RESPONSE                                                                   │
│  {                                                                           │
│    "needed": ["new-hash-1"],        // Not in cache, need code              │
│    "cached": ["existing-hash"]      // Already have, skip                   │
│  }                                                                           │
│                                                                              │
│  ─────────────────────────────                                              │
│  PHASE 2B: Code Transfer (Only Needed Chunks)                               │
│  ─────────────────────────────                                              │
│                                                                              │
│  CLIENT                                                                      │
│  1. For each "needed" hash, read code from disk using chunk reference       │
│  2. Send only the needed chunks with code                                   │
│                                                                              │
│  POST /v1/index/sync                                                        │
│  {                                                                           │
│    "phase": 2,                                                              │
│    "chunks": [                                                               │
│      {                                                                       │
│        "hash": "new-hash-1",                                                │
│        "code": "function login(user, pass) { ... }",                        │
│        "type": "function",                                                  │
│        "name": "login",                                                     │
│        "languageId": "typescript"                                           │
│      }                                                                       │
│    ]                                                                         │
│  }                                                                           │
│                                                                              │
│  SERVER                                                                      │
│  1. Store chunk hashes in KV: chunkHash:{hash} → "1"                        │
│  2. (Phase 2: Summarize + Embed + Store in Vectorize)                       │
│  3. Return confirmation                                                      │
│                                                                              │
│  RESPONSE                                                                   │
│  {                                                                           │
│    "status": "synced",                                                      │
│    "chunksProcessed": 1                                                     │
│  }                                                                           │
│                                                                              │
│  CLIENT (continued)                                                         │
│  1. Clear dirty queue: .puku/dirty-queue.json = { dirtyFiles: [] }          │
│  2. Update lastSync timestamp                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/v1/index/init` | POST | First-time project registration |
| `/v1/index/check` | POST | Merkle root comparison |
| `/v1/index/sync` | POST | Two-phase sync (phase 1 & 2) |
| `/v1/index/chunks` | POST | Receive chunks with code |

### Phase 1 Server Storage (KV Only)

```
KV Namespace: INDEX_STATE
├── merkleRoot:{userId}:{projectId} → "abc123..."    # Current root per project
└── chunkHash:{hash} → "1"                           # Global dedup cache
```

### Phase 1 Worker Structure

```
indexing-poc-worker/
├── src/
│   ├── index.ts              # Entry point, Hono app
│   ├── types.ts              # TypeScript interfaces
│   ├── routes/
│   │   ├── health.ts         # GET /health
│   │   ├── index-init.ts     # POST /v1/index/init
│   │   ├── index-check.ts    # POST /v1/index/check
│   │   ├── index-sync.ts     # POST /v1/index/sync
│   │   └── index-chunks.ts   # POST /v1/index/chunks
│   └── lib/
│       ├── kv-store.ts       # KV operations wrapper
│       ├── merkle-store.ts   # Merkle root operations
│       └── hash-store.ts     # Chunk hash cache operations
├── wrangler.toml
├── package.json
└── tsconfig.json
```

### Phase 1 Deliverables

1. **Worker deployed to Cloudflare** with KV binding
2. **API endpoints** for init, check, sync, chunks
3. **KV storage** for merkle roots and chunk hashes
4. **Integration tests** with Labs 4-7 client code

---

## Phase 2: AI Processing Pipeline

### Goal
Add summarization, embedding generation, and Vectorize storage on top of Phase 1.

### Phase 2 Additions

#### Flow 2.1: First Time Project Open (With AI)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FIRST TIME PROJECT OPEN (Phase 2)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Same as Phase 1, but after receiving chunks with code:                     │
│                                                                              │
│  SERVER (after POST /v1/index/chunks)                                       │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. Store chunk hashes in KV (same as Phase 1)                              │
│                                                                              │
│  2. SUMMARIZE chunks via OpenRouter                                         │
│     - Batch chunks (up to 50 per request)                                   │
│     - Call Qwen 2.5 Coder 32B                                               │
│     - Parse numbered response format                                        │
│     - Get summaries[]                                                        │
│                                                                              │
│  3. EMBED summaries via OpenRouter                                          │
│     - Call Codestral Embed                                                  │
│     - Get embeddings[][] (1024 dims each)                                   │
│                                                                              │
│  4. STORE in Vectorize                                                      │
│     - Upsert vectors with metadata                                          │
│     - id: "{userId}:{projectId}:{chunkHash}"                                │
│     - values: embedding[]                                                   │
│     - metadata: { summary, type, name, filePath, lines }                    │
│                                                                              │
│  5. Return to client with summaries + embeddings                            │
│                                                                              │
│  RESPONSE                                                                   │
│  ────────────────────────────────────────────────────────────────────────   │
│  {                                                                           │
│    "status": "indexed",                                                     │
│    "chunksProcessed": 2,                                                    │
│    "results": [                                                              │
│      {                                                                       │
│        "hash": "chunk-hash-1",                                              │
│        "summary": "authenticates user with username and password",          │
│        "embedding": [0.1, 0.2, ...]                                         │
│      },                                                                      │
│      {                                                                       │
│        "hash": "chunk-hash-2",                                              │
│        "summary": "authentication service managing user sessions",          │
│        "embedding": [0.3, 0.4, ...]                                         │
│      }                                                                       │
│    ]                                                                         │
│  }                                                                           │
│                                                                              │
│  CLIENT                                                                      │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. Store in local SQLite cache:                                            │
│     { hash, summary, embedding, type, name, filePath, lines }               │
│  2. Ready for local semantic search                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Flow 2.2: Periodic Sync (With AI)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PERIODIC SYNC (Phase 2)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Same two-phase protocol as Phase 1, but:                                   │
│                                                                              │
│  After receiving needed chunks with code (Phase 2B):                        │
│                                                                              │
│  SERVER                                                                      │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. Store chunk hashes in KV                                                │
│  2. SUMMARIZE new chunks                                                    │
│  3. EMBED summaries                                                         │
│  4. UPSERT to Vectorize                                                     │
│  5. DELETE old vectors for removed chunks (optional)                        │
│  6. Return summaries + embeddings to client                                 │
│                                                                              │
│  RESPONSE                                                                   │
│  ────────────────────────────────────────────────────────────────────────   │
│  {                                                                           │
│    "status": "synced",                                                      │
│    "chunksProcessed": 1,                                                    │
│    "results": [                                                              │
│      {                                                                       │
│        "hash": "new-hash-1",                                                │
│        "summary": "handles user login with updated validation",             │
│        "embedding": [0.5, 0.6, ...]                                         │
│      }                                                                       │
│    ]                                                                         │
│  }                                                                           │
│                                                                              │
│  CLIENT                                                                      │
│  ────────────────────────────────────────────────────────────────────────   │
│  1. Update local SQLite cache with new results                              │
│  2. Clear dirty queue                                                       │
│  3. Local search index updated                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2 API Endpoints (Additional)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/summarize/batch` | POST | Standalone summarization |
| `/v1/embeddings` | POST | Standalone embeddings |
| `/v1/search` | POST | Semantic search (optional) |

### Phase 2 Server Storage

```
KV Namespace: INDEX_STATE (same as Phase 1)
├── merkleRoot:{userId}:{projectId} → "abc123..."
└── chunkHash:{hash} → "1"

Vectorize Index: CODE_EMBEDDINGS (NEW)
└── vectors: [{
      id: "{userId}:{projectId}:{chunkHash}",
      values: float[1024],
      metadata: {
        userId: string,
        projectId: string,
        summary: string,
        type: "function" | "class" | "method",
        name: string,
        filePath: string,
        lines: [start, end]
      }
    }]
```

### Phase 2 Worker Structure (Additions)

```
indexing-poc-worker/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── index-init.ts
│   │   ├── index-check.ts
│   │   ├── index-sync.ts
│   │   ├── index-chunks.ts
│   │   ├── summarize.ts      # NEW: POST /v1/summarize/batch
│   │   ├── embeddings.ts     # NEW: POST /v1/embeddings
│   │   └── search.ts         # NEW: POST /v1/search (optional)
│   └── lib/
│       ├── kv-store.ts
│       ├── merkle-store.ts
│       ├── hash-store.ts
│       ├── openrouter.ts     # NEW: OpenRouter API client
│       └── vectorize.ts      # NEW: Vectorize operations
├── wrangler.toml             # Updated with Vectorize binding
├── package.json
└── tsconfig.json
```

### Phase 2 Deliverables

1. **OpenRouter integration** for summarization + embeddings
2. **Vectorize storage** for semantic search
3. **Updated API responses** with summaries + embeddings
4. **Client SQLite cache** implementation
5. **Search endpoint** (optional)

---

## Implementation Timeline

### Phase 1 Tasks

| # | Task | Description |
|---|------|-------------|
| 1.1 | Project setup | Create worker project, configure wrangler, KV namespace |
| 1.2 | Types | Define TypeScript interfaces for all request/response |
| 1.3 | KV Store | Implement merkle-store.ts and hash-store.ts |
| 1.4 | Health endpoint | GET /health |
| 1.5 | Init endpoint | POST /v1/index/init |
| 1.6 | Check endpoint | POST /v1/index/check |
| 1.7 | Sync endpoint | POST /v1/index/sync (phase 1 & 2) |
| 1.8 | Chunks endpoint | POST /v1/index/chunks |
| 1.9 | Deploy | Deploy to Cloudflare Workers |
| 1.10 | Integration | Test with Labs 4-7 client code |

### Phase 2 Tasks

| # | Task | Description |
|---|------|-------------|
| 2.1 | OpenRouter client | Implement summarization + embedding API calls |
| 2.2 | Vectorize setup | Create Vectorize index, add binding |
| 2.3 | Vectorize store | Implement vector upsert/delete operations |
| 2.4 | Update chunks endpoint | Add AI processing pipeline |
| 2.5 | Summarize endpoint | POST /v1/summarize/batch (standalone) |
| 2.6 | Embeddings endpoint | POST /v1/embeddings (standalone) |
| 2.7 | Search endpoint | POST /v1/search (optional) |
| 2.8 | Client SQLite | Implement local cache storage |
| 2.9 | Integration | Full end-to-end testing |

---

## Client Integration Points

### Labs to Integrate

| Lab | Component | Integration Point |
|-----|-----------|-------------------|
| Lab-04 | File Watcher | Triggers dirty queue updates |
| Lab-05 | Merkle Tree | Provides root hash for sync check |
| Lab-06 | AST Chunker | Parses dirty files into chunks |
| Lab-07 | Chunk Hasher | Creates HashedChunk with references |

### New Client Components

| Component | Purpose |
|-----------|---------|
| **Sync Client** | HTTP client for worker API calls |
| **Sync Timer** | 10-minute periodic sync trigger |
| **SQLite Cache** | Local storage for summaries + embeddings |

### Client Flow Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT INTEGRATION                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Existing Labs                          New Components                       │
│  ─────────────                          ──────────────                       │
│                                                                              │
│  ┌─────────────┐                       ┌─────────────┐                      │
│  │ File Watcher│──── file change ─────>│ Merkle Tree │                      │
│  │  (Lab-04)   │                       │  (Lab-05)   │                      │
│  └─────────────┘                       └──────┬──────┘                      │
│                                               │                              │
│                                               ▼                              │
│                                        ┌─────────────┐                      │
│                                        │ Dirty Queue │                      │
│                                        └──────┬──────┘                      │
│                                               │                              │
│                                               ▼ (every 10 min)              │
│                                        ┌─────────────┐                      │
│                                        │ Sync Timer  │ ◄── NEW              │
│                                        └──────┬──────┘                      │
│                                               │                              │
│                                               ▼                              │
│  ┌─────────────┐                       ┌─────────────┐                      │
│  │ AST Chunker │◄── dirty files ───────│ Sync Client │ ◄── NEW              │
│  │  (Lab-06)   │                       └──────┬──────┘                      │
│  └──────┬──────┘                              │                              │
│         │                                     │                              │
│         ▼                                     ▼                              │
│  ┌─────────────┐                       ┌─────────────┐                      │
│  │Chunk Hasher │── hashes ────────────>│   Worker    │                      │
│  │  (Lab-07)   │                       │   (API)     │                      │
│  └──────┬──────┘                       └──────┬──────┘                      │
│         │                                     │                              │
│         │ code (from reference)               │ summaries + embeddings      │
│         │                                     │                              │
│         └─────────────────────────────────────┼──────────────────────────>  │
│                                               │                              │
│                                               ▼                              │
│                                        ┌─────────────┐                      │
│                                        │SQLite Cache │ ◄── NEW              │
│                                        └─────────────┘                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Configuration

### wrangler.toml (Phase 1)

```toml
name = "indexing-poc"
main = "src/index.ts"
compatibility_date = "2024-11-24"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "INDEX_KV"
id = "xxx"  # Create with: wrangler kv:namespace create INDEX_KV
```

### wrangler.toml (Phase 2 - Additional)

```toml
# ... Phase 1 config ...

[vars]
OPENROUTER_API_URL = "https://openrouter.ai/api/v1"
SUMMARIZATION_MODEL = "qwen/qwen-2.5-coder-32b-instruct"
EMBEDDING_MODEL = "mistralai/codestral-embed-2505"
EMBEDDING_DIMENSIONS = "1024"

[[vectorize]]
binding = "VECTORIZE"
index_name = "code-embeddings"
```

---

## Success Criteria

### Phase 1

- [ ] Worker deploys successfully
- [ ] KV namespace created and bound
- [ ] `/health` returns 200
- [ ] `/v1/index/init` stores merkle root and returns needed hashes
- [ ] `/v1/index/check` correctly compares roots
- [ ] `/v1/index/sync` phase 1 returns needed vs cached hashes
- [ ] `/v1/index/sync` phase 2 stores chunk hashes in KV
- [ ] Integration with Labs 4-7 works end-to-end

### Phase 2

- [ ] OpenRouter API calls work (summarization + embeddings)
- [ ] Vectorize index created and bound
- [ ] Vectors stored with correct metadata
- [ ] API returns summaries + embeddings to client
- [ ] Client SQLite cache stores results
- [ ] Semantic search works (optional)
- [ ] Full end-to-end flow validated

---

## Testing Strategy

### Phase 1 Tests

```bash
# Health check
curl http://localhost:8787/health

# First time init
curl -X POST http://localhost:8787/v1/index/init \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","projectId":"p1","merkleRoot":"abc","chunks":[...]}'

# Merkle root check
curl -X POST http://localhost:8787/v1/index/check \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","projectId":"p1","merkleRoot":"abc"}'

# Sync phase 1 (hashes only)
curl -X POST http://localhost:8787/v1/index/sync \
  -H "Content-Type: application/json" \
  -d '{"phase":1,"userId":"u1","projectId":"p1","merkleRoot":"xyz","chunks":[...]}'

# Sync phase 2 (with code)
curl -X POST http://localhost:8787/v1/index/sync \
  -H "Content-Type: application/json" \
  -d '{"phase":2,"chunks":[{"hash":"...","code":"...","type":"function",...}]}'
```

### Phase 2 Tests

```bash
# Summarization
curl -X POST http://localhost:8787/v1/summarize/batch \
  -H "Content-Type: application/json" \
  -d '{"chunks":[{"text":"function..."}],"languageId":"typescript"}'

# Embeddings
curl -X POST http://localhost:8787/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input":["summary text"]}'

# Search (optional)
curl -X POST http://localhost:8787/v1/search \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","projectId":"p1","query":"authentication logic","limit":5}'
```

---

## Summary

| Phase | Components | Storage | API Endpoints |
|-------|------------|---------|---------------|
| **Phase 1** | Two-phase sync, KV cache | KV only | init, check, sync, chunks |
| **Phase 2** | AI pipeline, Vectorize | KV + Vectorize | + summarize, embeddings, search |

**Ready to proceed with Phase 1 implementation?**
