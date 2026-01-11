# Phase 1: Core Sync Infrastructure Implementation Plan

## Overview

This document outlines the complete Phase 1 implementation plan for the POC Indexing Worker. Phase 1 focuses on **core sync infrastructure with KV only** (no AI processing). AI summarization and embeddings will be added in Phase 2.

---

## Architecture Overview

```mermaid
flowchart TB
    subgraph Client["Client (VS Code Extension)"]
        FW[File Watcher]
        MT[Merkle Tree Builder]
        CH[Chunk Hasher]
        SC[Sync Client]
        LStore[".puku/merkle-state.json"]
    end

    subgraph Server["Cloudflare Worker"]
        API[Hono API]
        MStore[KV: merkleRoot]
        HStore[KV: chunkHashes]
    end

    FW --> MT
    MT --> CH
    CH --> SC
    MT --> LStore
    SC <--> API
    API --> MStore
    API --> HStore
```

---

## Complete Flow Diagrams

### Flow 1: First Time Project Open

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Server (KV)

    U->>C: Opens project first time
    C->>C: Scan ALL files
    C->>C: Build Merkle tree
    C->>C: Chunk ALL files
    C->>C: Compute hashes

    C->>S: POST /index/init<br/>{merkleRoot, chunks[] with code}
    S->>S: Store merkleRoot in KV
    S->>S: Store each chunkHash in KV
    S-->>C: {status: "indexed", chunksStored: N}

    C->>C: Save merkle-state.json locally
```

### Flow 2: Project Reopen (No Changes)

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Server (KV)

    U->>C: Reopens project
    C->>C: Scan ALL files (unavoidable)
    C->>C: Rebuild Merkle tree
    C->>C: Re-chunk ALL files (unavoidable)

    C->>S: POST /index/check<br/>{merkleRoot: "abc123"}
    S->>S: Compare with stored root
    S-->>C: {changed: false}

    Note over C: Done! No sync needed
```

### Flow 3: Project Reopen (With Changes)

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Server (KV)

    U->>C: Reopens project (files changed offline)
    C->>C: Scan ALL files
    C->>C: Rebuild Merkle tree (NEW root)
    C->>C: Re-chunk ALL files

    C->>S: POST /index/check<br/>{merkleRoot: "xyz789"}
    S->>S: Compare: "xyz789" ≠ "abc123"
    S-->>C: {changed: true, serverRoot: "abc123"}

    C->>S: POST /index/sync (phase 1)<br/>{phase: 1, chunks: [all hashes]}
    S->>S: Check each hash in KV
    S-->>C: {needed: ["hash5"], cached: ["hash1","hash2",...]}

    C->>C: Read code for needed chunks only
    C->>S: POST /index/sync (phase 2)<br/>{phase: 2, chunks: [{hash, code}]}
    S->>S: Store new hash in KV
    S->>S: Update merkleRoot
    S-->>C: {status: "stored", received: ["hash5"]}
```

### Flow 4: Live Editing (Watcher Running)

```mermaid
sequenceDiagram
    participant U as User
    participant FW as File Watcher
    participant C as Client
    participant S as Server (KV)

    U->>FW: Edits src/auth.ts
    FW->>C: onChange("src/auth.ts")
    C->>C: Update Merkle tree (just this file)
    C->>C: Re-chunk just this file
    C->>C: Add to dirty queue

    Note over C: Debounce/batch changes...

    C->>S: POST /index/sync (phase 1)<br/>{chunks: [changed chunk hashes]}
    S-->>C: {needed: ["newHash"], cached: []}

    C->>S: POST /index/sync (phase 2)<br/>{chunks: [{hash, code}]}
    S-->>C: {status: "stored"}

    C->>C: Clear dirty queue
```

---

## API Endpoints

### 1. POST `/v1/index/init` - First Time Indexing

**When Called**:
- First time user opens project
- Server has no data (`/check` returns `serverRoot: null`)
- User manually triggers re-index

**Request:**
```json
{
  "merkleRoot": "abc123...",
  "chunks": [
    {
      "hash": "chunk-hash-1",
      "type": "function",
      "name": "login",
      "lines": [10, 25],
      "charCount": 500,
      "code": "function login() { ... }",
      "languageId": "typescript"
    }
  ]
}
```

**Response:**
```json
{
  "status": "indexed",
  "merkleRoot": "abc123...",
  "chunksStored": 1
}
```

**Server Actions:**
- Store `merkleRoot:{userId}` → `"abc123..."`
- Store `chunkHash:{hash}` → `"1"` for each chunk

---

### 2. POST `/v1/index/check` - Change Detection

**When Called**:
- On project open (after rebuilding local Merkle tree)
- Periodically during session

**Request:**
```json
{
  "merkleRoot": "abc123..."
}
```

**Response (no change):**
```json
{
  "changed": false,
  "serverRoot": "abc123..."
}
```

**Response (change detected):**
```json
{
  "changed": true,
  "serverRoot": "xyz789..."
}
```

**Response (no server data):**
```json
{
  "changed": true,
  "serverRoot": null
}
```

---

### 3. POST `/v1/index/sync` - Two-Phase Sync

#### Phase 1: Hash Check

**Purpose**: Server tells client which chunks need code

**Request:**
```json
{
  "phase": 1,
  "merkleRoot": "abc123...",
  "chunks": [
    {
      "hash": "chunk-hash-1",
      "type": "function",
      "name": "login",
      "lines": [10, 25],
      "charCount": 500
    },
    {
      "hash": "chunk-hash-2",
      "type": "class",
      "name": "AuthService",
      "lines": [30, 80],
      "charCount": 1200
    }
  ]
}
```

**Response:**
```json
{
  "needed": ["chunk-hash-2"],
  "cached": ["chunk-hash-1"]
}
```

#### Phase 2: Code Transfer

**Purpose**: Client sends code only for needed chunks

**Request:**
```json
{
  "phase": 2,
  "merkleRoot": "abc123...",
  "chunks": [
    {
      "hash": "chunk-hash-2",
      "code": "class AuthService { ... }",
      "type": "class",
      "name": "AuthService",
      "languageId": "typescript"
    }
  ]
}
```

**Response (Phase 1 POC - no AI):**
```json
{
  "status": "stored",
  "received": ["chunk-hash-2"],
  "message": "Chunks stored. AI processing disabled in Phase 1."
}
```

---

## Data Storage

### What Goes Where

```mermaid
flowchart LR
    subgraph Client["Client (Local)"]
        MS["merkle-state.json<br/>- root hash<br/>- leaves with relativePath"]
        DQ["dirty-queue.json<br/>- dirty file list"]
        CR["ChunkReference<br/>- relativePath<br/>- lineStart/End<br/>- charStart/End"]
    end

    subgraph Server["Server (KV)"]
        MR["merkleRoot:{userId}<br/>→ 'abc123...'"]
        CH["chunkHash:{hash}<br/>→ '1'"]
    end

    MS -.->|"merkleRoot only"| MR
    CR -.->|"hash only (no path)"| CH
```

### Client-Side Storage

**merkle-state.json:**
```json
{
  "root": "abc123...",
  "leaves": [
    { "relativePath": "src/auth.ts", "hash": "..." },
    { "relativePath": "src/api.ts", "hash": "..." }
  ],
  "timestamp": "2026-01-11T12:00:00Z"
}
```

**dirty-queue.json:**
```json
{
  "lastSync": "2026-01-11T12:00:00Z",
  "dirtyFiles": ["src/auth.ts"]
}
```

**ChunkReference (in memory):**
```typescript
{
  relativePath: "src/auth.ts",  // NOT sent to server
  lineStart: 10,
  lineEnd: 25,
  charStart: 234,
  charEnd: 567
}
```

### Server-Side Storage (KV)

| Key Pattern | Value | Purpose |
|-------------|-------|---------|
| `merkleRoot:{userId}` | `"abc123..."` | Quick change detection |
| `chunkHash:{hash}` | `"1"` | Cache check for chunks |

---

## What Gets Sent to Server vs Stays Local

| Data | Sent to Server? | Purpose |
|------|-----------------|---------|
| `merkleRoot` | ✅ Yes | O(1) change detection |
| `hash` | ✅ Yes | Identify chunk uniquely |
| `type` | ✅ Yes | "function", "class", etc. |
| `name` | ✅ Yes | Function/class name |
| `lines` | ✅ Yes | Line range metadata |
| `charCount` | ✅ Yes | Size info |
| `code` | ✅ Phase 2 only | Actual content (only for new chunks) |
| `relativePath` | ❌ No | Privacy - client only |
| `charStart/End` | ❌ No | Client uses to read code |

---

## Why Relative Paths?

```mermaid
flowchart TB
    subgraph Absolute["Absolute Path Problem"]
        A1["Machine A: C:\Users\alice\project\src\auth.ts"]
        A2["Machine B: /home/bob/project/src/auth.ts"]
        A3["Different paths = Different hashes!"]
        A4["Cache doesn't work across devices ❌"]
        A1 --> A3
        A2 --> A3
        A3 --> A4
    end

    subgraph Relative["Relative Path Solution"]
        R1["Machine A: src/auth.ts"]
        R2["Machine B: src/auth.ts"]
        R3["Same paths = Same hashes!"]
        R4["Cache works across devices ✅"]
        R1 --> R3
        R2 --> R3
        R3 --> R4
    end
```

---

## Optimization Summary

### Where Two-Phase Saves

| Step | Without Two-Phase | With Two-Phase | Savings |
|------|-------------------|----------------|---------|
| Client scanning | Scan all files | Scan all files | None |
| Client chunking | Chunk all files | Chunk all files | None |
| Network (check) | - | 64 bytes | - |
| Network (sync) | 400KB (all code) | 4KB hashes + changed code | ~96% |
| Server storage | Store all | Store only new | Depends |
| AI processing | Process all (Phase 2) | Process only new (Phase 2) | ~96% |

### Timeline Example

```
Project: 100 files, 100 chunks
User edited 1 file offline, reopens project:

Client work (unavoidable):
├── Scan 100 files
├── Build Merkle tree
└── Chunk 100 files

Network transfer:
├── /check: 64 bytes
├── /sync phase 1: ~4KB (100 hashes)
└── /sync phase 2: ~4KB (1 chunk code)

Server work:
├── Compare 100 hashes with KV
└── Store 1 new hash
```

---

## Project Structure

```
indexing-system-poc/
├── Client/                          # Client-side library (NEW)
│   ├── src/
│   │   ├── index.ts                 # Main exports
│   │   ├── types.ts                 # Shared types
│   │   ├── sync-client.ts           # HTTP client for worker API
│   │   └── code-reader.ts           # Read code by ChunkReference
│   └── package.json
│
├── indexing-poc-worker/             # Cloudflare Worker (NEW)
│   ├── src/
│   │   ├── index.ts                 # Hono app entry point
│   │   ├── types.ts                 # Request/response interfaces
│   │   ├── routes/
│   │   │   ├── index-init.ts        # POST /v1/index/init
│   │   │   ├── index-check.ts       # POST /v1/index/check
│   │   │   └── index-sync.ts        # POST /v1/index/sync
│   │   └── lib/
│   │       └── kv-store.ts          # KV operations
│   └── wrangler.toml
│
├── Merkle-Tree-Builder/             # Existing (updated for relative paths)
├── Chunk-Hashing/                   # Existing (updated for relative paths)
├── File-Watcher/                    # Existing
└── Documentation/
```

---

## Implementation Steps

### Step 1: Create Worker Package
```bash
mkdir indexing-poc-worker
cd indexing-poc-worker
npm init -y
npm install hono
npm install -D wrangler typescript @cloudflare/workers-types
```

### Step 2: Configure wrangler.toml
```toml
name = "indexing-poc"
main = "src/index.ts"
compatibility_date = "2024-11-24"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "INDEX_KV"
id = "create-with-wrangler"
```

### Step 3: Implement Endpoints
1. `/v1/index/init` - Store merkle root + all chunk hashes
2. `/v1/index/check` - Compare merkle roots
3. `/v1/index/sync` - Two-phase hash check + code storage

### Step 4: Create Client Package
1. `sync-client.ts` - HTTP calls to worker
2. `code-reader.ts` - Read code using ChunkReference

### Step 5: Integration Test
- Test full flow: init → check → sync

---

## Success Criteria

| Criteria | Description |
|----------|-------------|
| ✅ Relative paths | All local storage uses relative paths |
| ✅ Worker deploys | `wrangler dev` runs without errors |
| ✅ /init works | Stores merkle root and chunk hashes |
| ✅ /check works | Returns changed: true/false correctly |
| ✅ /sync phase 1 | Returns needed vs cached hashes |
| ✅ /sync phase 2 | Stores new chunk hashes |
| ✅ Integration test | Full flow works end-to-end |

---

## Phase 2 Preview (Not This Phase)

After Phase 1 is complete:

1. **OpenRouter Integration** - Summarization with Qwen Coder
2. **Embeddings** - Codestral via OpenRouter
3. **Vectorize Storage** - Store embeddings for semantic search
4. **Enhanced /sync response** - Return summaries + embeddings

---

## Cost Estimate

| Phase | Architecture | Monthly Cost (500 users) |
|-------|--------------|--------------------------|
| Phase 1 | KV Only | ~$5 |
| Phase 2 | KV + Vectorize | ~$34-75 |

---

*Document updated: 2026-01-11*
*Status: Ready for implementation*
