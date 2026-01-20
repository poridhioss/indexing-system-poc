# AI-Powered Semantic Code Search

Building on the Phase 1 indexing pipeline from Lab-08, this lab extends the Cloudflare Worker with AI capabilities. You'll add code summarization using Workers AI, generate embeddings for semantic search, and store vectors in Cloudflare Vectorize with **multi-tenant isolation** and **global embedding cache** for 70-90% AI cost savings.

This is exactly how production AI code editors like Cursor and PUKU Editor implement their semantic search capabilities.

## What's New in This Design

### Improvements Over Previous Design

#### 1. Global Embedding Cache for Efficiency

Previously, each user's chunk data was stored separately in KV with simple TTL-based expiration. The new design introduces a **global embedding cache** keyed by content hash (`embedding:{hash}`). This means when User A indexes a function like `add(a, b)`, the AI-generated summary and 1024-dimensional embedding are cached globally. When User B later indexes the exact same code, they get an instant cache hit—no AI processing required. This shared cache delivers **70-90% cost savings** across users indexing common libraries, utilities, or boilerplate code.

#### 2. Multi-Tenant Isolation for Security

The previous design assumed a single user, storing vectors with simple hash IDs. The new design implements **complete tenant isolation** using composite vector IDs in the format `{userId}_{projectId}_{hash}`. This ensures:
- User A cannot see or search User B's code, even if they share the same content hash
- The same user can have identical code in different projects without collision
- Search queries filter by both `userId` AND `projectId` in metadata for double verification

#### 3. Zero Vector Filtering for Reliability

AI services can fail due to timeouts, rate limits, or cold starts. Previously, these failures resulted in corrupted data. The new design uses **zero vectors** as fallback markers and filters them at multiple points:
- Never cache zero vectors (prevents poisoning the global cache)
- Never store zero vectors in Vectorize (prevents `-1` similarity scores)
- Retry logic for query embeddings with 500ms backoff

#### 4. Enhanced Metadata with File Tracking

The previous design lacked file path information, making it impossible to navigate to code locations. The new design stores complete `filePath` in vector metadata, enabling IDE integrations to jump directly to the source file and line number when users click on search results.

## Prerequisites

- Complete Indexing Pipeline Phase 1
- Cloudflare account with Workers AI access (free tier works)
- Wrangler CLI installed (`npm install -g wrangler`)
- Node.js 18+ installed
- `curl` and `jq` for API testing

## What You'll Learn

1. Implementing multi-tenant vector storage with user isolation
2. Building a global embedding cache for AI cost optimization
3. Using Cloudflare Workers AI for code summarization
4. Generating embeddings and storing in Cloudflare Vectorize
5. Handling AI failures gracefully with zero vector filtering
6. Building semantic search with proper tenant isolation

## Architecture Overview

### High-Level System Architecture

Multiple clients connect to our Cloudflare Worker through the Hono API Router. All requests pass through Auth Middleware which extracts the userId from the Bearer token. The router then directs requests to the appropriate endpoint handler.

![High-Level Architecture](./images/indexing-1.svg)

**Components:**
- **Hono API Router**: Lightweight, fast routing for all incoming requests
- **Auth Middleware**: Validates Bearer tokens and extracts userId for multi-tenant isolation
- **Route Handlers**: Four main endpoints - `/index/check`, `/index/init`, `/index/sync`, and `/search`

### AI Processing Layer

The AI processing layer handles code summarization and embedding generation using Cloudflare Workers AI.

![AI Processing](./images/indexing-2.svg)

**Three AI Functions:**
- **generateSummaries**: Takes code chunks and produces natural language descriptions using `@cf/qwen/qwen2.5-coder-32b-instruct`
- **generateEmbeddings**: Converts summaries into 1024-dimensional vectors using `@cf/baai/bge-large-en-v1.5`
- **generateQueryEmbeddings**: Converts search queries into vectors for similarity matching

### Worker Services Layer

The worker uses two storage backends - KV Namespace for caching and Vectorize for vector storage.

![Worker Services](./images/indexing-3.svg)

**Storage Components:**
- **Embedding Cache**: Stores AI-generated summaries and embeddings globally by content hash
- **KV Store**: Stores merkle roots for change detection per user/project
- **Vectorize Ops**: Handles vector upsert and search operations with multi-tenant filtering

## Endpoint Flow Diagrams

### 1. `/index/init` - First-Time Project Indexing

This endpoint handles the initial indexing of a project. It processes all code chunks, checks the global cache for existing embeddings, and stores new vectors.

![Index Init Flow](./images/indexing-4.svg)

**Flow:**
1. Client sends code chunks with metadata (projectId, merkleRoot, code, filePath, etc.)
2. Worker checks the global embedding cache for each chunk's content hash
3. **Cache HIT** (green path): Retrieve existing summary + embedding from cache
4. **Cache MISS** (red path): Send to AI for summarization and embedding generation, then cache the result
5. Both paths converge to add user-specific metadata (filePath, projectId, userId)
6. Store vectors in Vectorize with composite ID: `{userId}_{projectId}_{hash}`

**Key Point:** The embedding is shared globally, but each user gets their own vector with their own metadata.

### 2. `/index/check` - Change Detection

A lightweight endpoint that compares merkle roots to detect if re-indexing is needed. No AI calls involved.

![Index Check Flow](./images/indexing-5.svg)

**Flow:**
1. Client sends current merkleRoot for their project
2. Worker retrieves stored merkle root from KV
3. Compare the two roots
4. **Match** (green): Return `changed: false` - no sync needed
5. **Different** (red): Return `changed: true` - client should sync

**Key Point:** O(1) complexity - just a single KV lookup and string comparison.

### 3. `/index/sync` - Two-Phase Incremental Sync

This endpoint uses a two-phase protocol to minimize data transfer. Phase 1 identifies what's needed, Phase 2 only transfers missing code.

**Phase 1: Metadata Only (No Code Transfer)**

![Sync Phase 1](./images/indexing-6.svg)

**Phase 1 Flow:**
1. Client sends hashes + metadata (NO code content)
2. Worker checks embedding cache for all hashes
3. **Cache HIT** (green): Get cached embedding, add user metadata, store in Vectorize immediately
4. **Cache MISS** (red): Add hash to "needed" list
5. Return response with `needed` array (hashes that require code) and `cacheHits` count

**Phase 2: Code Only for Misses**

![Sync Phase 2](./images/indexing-7.svg)

**Phase 2 Flow:**
1. Client sends code ONLY for hashes in the `needed` array
2. Worker processes with AI (summarize + embed)
3. Cache the results globally for future users
4. Add user-specific metadata and store in Vectorize

**Key Point:** If 90% of chunks hit the cache, only 10% of code content needs to be transferred in Phase 2.

### 4. Multi-Tenant Data Isolation

This is the core architectural pattern that enables cost sharing while maintaining security.

![Multi-Tenant Isolation](./images/indexing-8.svg)

**Two-Layer Architecture:**

**Layer 1 - Global Embedding Cache (Shared):**
- Key: `embedding:{contentHash}`
- Value: `{summary, embedding}`
- Shared across ALL users - same code = same hash = same embedding

**Layer 2 - Vector Storage (Isolated per User):**
- Each user has their own vectors in Vectorize
- Vector ID format: `{userId}_{projectId}_{hash}`
- Metadata includes user-specific data: filePath, lines, projectId

**Example:**
- Alice indexes `add(a,b)` → hash001 → AI generates embedding → cached globally → stored as `alice_proj-a_hash001`
- Bob indexes same `add(a,b)` → hash001 → **cache HIT** (no AI cost!) → stored as `bob_proj-b_hash001`
- Both users have the same embedding but different file paths and project IDs

### 5. Two-Phase Sync Sequence

This sequence diagram shows the complete flow of the two-phase sync protocol with all service interactions.

![Two-Phase Sync Sequence](./images/indexing-9.svg)

**Complete Sequence:**

**Phase 1 (Metadata Only):**
1. Client sends `POST /sync` with `phase:1`, chunks contain `{hash, metadata}` but NO code
2. Worker checks embedding cache for all hashes
3. Cache returns hits and misses
4. For cache hits: Worker upserts to Vectorize with user metadata immediately
5. Worker returns `{needed: [miss_hashes], cacheHits: N}`

**Phase 2 (Code for Misses):**
1. Client sends `POST /sync` with `phase:2`, chunks contain `{hash, code}` only for needed hashes
2. Worker sends code to Workers AI for summarization
3. Workers AI returns summaries
4. Worker sends summaries to Workers AI for embedding generation
5. Workers AI returns 1024-dimensional vectors
6. For valid (non-zero) embeddings: Store in global cache AND upsert to Vectorize
7. Worker returns `{status: "stored", vectorsStored: N}`

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/` | GET | No | API info and version |
| `/v1/health` | GET | No | Health check |
| `/v1/index/init` | POST | Yes | First-time project indexing with AI |
| `/v1/index/check` | POST | Yes | O(1) change detection via Merkle root |
| `/v1/index/sync` | POST | Yes | Two-phase sync with embedding cache |
| `/v1/search` | POST | Yes | Semantic code search |
| `/v1/summarize/batch` | POST | Yes | Standalone summarization |
| `/v1/embeddings` | POST | Yes | OpenAI-compatible embeddings |

## Part 1: Project Setup

### Clone and Navigate

```bash
cd indexing-system-poc/indexing-pipeline/indexing-poc-worker-phase-2
npm install
```

### Project Structure

```
indexing-poc-worker-phase-2/
├── src/
│   ├── index.ts                 # Main Hono app entry point
│   ├── types.ts                 # Type definitions
│   ├── lib/
│   │   ├── kv-store.ts          # KV helpers (merkle roots)
│   │   ├── embedding-cache.ts   # Global embedding cache
│   │   ├── ai.ts                # AI processing (summarize + embed)
│   │   └── vectorize.ts         # Vectorize operations
│   ├── middleware/
│   │   └── auth.ts              # Auth middleware
│   └── routes/
│       ├── health.ts            # GET /v1/health
│       ├── index-init.ts        # POST /v1/index/init
│       ├── index-check.ts       # POST /v1/index/check
│       ├── index-sync.ts        # POST /v1/index/sync
│       ├── search.ts            # POST /v1/search
│       ├── summarize.ts         # POST /v1/summarize/batch
│       └── embeddings.ts        # POST /v1/embeddings
├── wrangler.toml                # Cloudflare configuration
├── api-tests.http               # REST Client test file
├── package.json
└── tsconfig.json
```

### Cloudflare Services Used

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| **Workers** | Serverless compute | 100K requests/day |
| **KV** | Merkle roots + embedding cache | 100K reads/day, 1K writes/day |
| **Workers AI** | Summarization + embeddings | 10K neurons/day |
| **Vectorize** | Vector database | 5M vectors, 30M queried dims/month |

## Part 2: Deploy Cloudflare Resources

### Step 1: Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser for authentication. After login, verify with:

```bash
npx wrangler whoami
```

### Step 2: Create KV Namespace

```bash
# Create production namespace
npx wrangler kv:namespace create INDEX_KV
```

**Expected output:**
```
🌀 Creating namespace with title "indexing-poc-phase-2-INDEX_KV"
✨ Success!
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "INDEX_KV"
id = "c682d9b69609426584b8bb43e8efad26"
```

Copy the `id` value for your `wrangler.toml`.

```bash
# Create preview namespace (for local dev)
npx wrangler kv:namespace create INDEX_KV --preview
```

### Step 3: Create Vectorize Index

```bash
npx wrangler vectorize create vectorize-poc --dimensions=1024 --metric=cosine
```

**Important**: BGE Large produces 1024-dimensional vectors. The metric must be `cosine` for semantic similarity.

### Step 4: Configure wrangler.toml

```toml
name = "indexing-poc-phase-2"
main = "src/index.ts"
compatibility_date = "2024-11-24"
compatibility_flags = ["nodejs_compat"]

account_id = "your-account-id-here"

[vars]
DEV_TOKEN = "dev-token-12345"

[ai]
binding = "AI"

[[kv_namespaces]]
binding = "INDEX_KV"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-id"

[[vectorize]]
binding = "VECTORIZE"
index_name = "vectorize-poc"
```

### Step 5: Deploy the Worker

```bash
npx wrangler deploy
```

Save your worker URL for testing.

## Part 3: Testing with curl and jq

Set your worker URL:

```bash
export WORKER_URL="https://indexing-poc-phase-2.your-subdomain.workers.dev"
```

### Test 1: Health Check

```bash
curl -s "$WORKER_URL/v1/health" | jq .
```

### Test 2: Initialize Project (Alice)

```bash
curl -s -X POST "$WORKER_URL/v1/index/init" \
  -H "Authorization: Bearer dev-token-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "alice-project",
    "merkleRoot": "merkle-alice-001",
    "chunks": [
      {
        "hash": "hash001",
        "code": "function add(a, b) { return a + b; }",
        "type": "function",
        "name": "add",
        "languageId": "javascript",
        "lines": [1, 1],
        "charCount": 38,
        "filePath": "src/math/add.ts"
      }
    ]
  }' | jq .
```

**Expected (first time - AI processing):**
```json
{
  "status": "indexed",
  "merkleRoot": "merkle-alice-001",
  "chunksReceived": 1,
  "aiProcessed": 1,
  "cacheHits": 0,
  "vectorsStored": 1
}
```

### Test 3: Initialize Same Code (Bob) - Cache Hit!

```bash
curl -s -X POST "$WORKER_URL/v1/index/init" \
  -H "Authorization: Bearer dev-token-67890" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "bob-project",
    "merkleRoot": "merkle-bob-001",
    "chunks": [
      {
        "hash": "hash001",
        "code": "function add(a, b) { return a + b; }",
        "type": "function",
        "name": "add",
        "languageId": "javascript",
        "lines": [1, 1],
        "charCount": 38,
        "filePath": "lib/utils/add.js"
      }
    ]
  }' | jq .
```

**Expected (cache hit - NO AI cost!):**
```json
{
  "status": "indexed",
  "merkleRoot": "merkle-bob-001",
  "chunksReceived": 1,
  "aiProcessed": 0,
  "cacheHits": 1,
  "vectorsStored": 1
}
```

### Test 4: Check for Changes

```bash
curl -s -X POST "$WORKER_URL/v1/index/check" \
  -H "Authorization: Bearer dev-token-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "alice-project",
    "merkleRoot": "merkle-alice-001"
  }' | jq .
```

**Expected:**
```json
{
  "changed": false,
  "serverRoot": "merkle-alice-001"
}
```

### Test 5: Sync Phase 1 (Metadata Only)

```bash
curl -s -X POST "$WORKER_URL/v1/index/sync" \
  -H "Authorization: Bearer dev-token-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "phase": 1,
    "projectId": "alice-project",
    "merkleRoot": "merkle-alice-002",
    "chunks": [
      {
        "hash": "hash001",
        "type": "function",
        "name": "add",
        "languageId": "javascript",
        "lines": [1, 1],
        "charCount": 38,
        "filePath": "src/math/add.ts"
      },
      {
        "hash": "hash003-new",
        "type": "function",
        "name": "subtract",
        "languageId": "javascript",
        "lines": [5, 5],
        "charCount": 44,
        "filePath": "src/math/subtract.ts"
      }
    ]
  }' | jq .
```

**Expected:**
```json
{
  "needed": ["hash003-new"],
  "vectorized": 1,
  "cacheHits": 1
}
```

### Test 6: Sync Phase 2 (Code for Misses)

```bash
curl -s -X POST "$WORKER_URL/v1/index/sync" \
  -H "Authorization: Bearer dev-token-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "phase": 2,
    "projectId": "alice-project",
    "merkleRoot": "merkle-alice-002",
    "chunks": [
      {
        "hash": "hash003-new",
        "code": "function subtract(a, b) { return a - b; }",
        "type": "function",
        "name": "subtract",
        "languageId": "javascript",
        "lines": [5, 5],
        "charCount": 44,
        "filePath": "src/math/subtract.ts"
      }
    ]
  }' | jq .
```

**Expected:**
```json
{
  "status": "stored",
  "received": ["hash003-new"],
  "merkleRoot": "merkle-alice-002",
  "aiProcessed": 1,
  "vectorsStored": 1
}
```

### Test 7: Semantic Search

**Wait 10-15 seconds** after indexing for Vectorize to process, then:

```bash
curl -s -X POST "$WORKER_URL/v1/search" \
  -H "Authorization: Bearer dev-token-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "add two numbers together",
    "projectId": "alice-project",
    "topK": 5
  }' | jq .
```

**Expected:**
```json
{
  "results": [
    {
      "hash": "hash001",
      "score": 0.89,
      "summary": "adds two numbers together...",
      "type": "function",
      "name": "add",
      "filePath": "src/math/add.ts"
    }
  ],
  "query": "add two numbers together"
}
```

### Test 8: Search Isolation (Bob sees different paths)

```bash
curl -s -X POST "$WORKER_URL/v1/search" \
  -H "Authorization: Bearer dev-token-67890" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "add two numbers together",
    "projectId": "bob-project",
    "topK": 5
  }' | jq .
```

**Expected (same hash, different filePath):**
```json
{
  "results": [
    {
      "hash": "hash001",
      "score": 0.89,
      "summary": "adds two numbers together...",
      "filePath": "lib/utils/add.js"
    }
  ]
}
```

## Part 4: Key Concepts

### 1. Vector ID Format

```
{userId}_{projectId}_{contentHash}
```

| Component | Example | Purpose |
|-----------|---------|---------|
| userId | `alice` | From auth token - isolates users |
| projectId | `my-project` | From request - isolates projects |
| contentHash | `abc123` | SHA-256 of code content |

### 2. Cache Hit Rate = Cost Savings

The cache hit rate directly translates to AI cost savings. When multiple users index the same code (common libraries, utilities, boilerplate), only the first user pays the AI processing cost. All subsequent users get instant cache hits with zero AI cost.

For example, if three users index the same 100-chunk library: User 1 processes all 100 chunks with AI (pays full cost), while Users 2 and 3 get 100% cache hits (completely free). This results in 67% total cost savings. In production environments with many users sharing common code patterns, savings typically reach 70-90%.

### 3. Zero Vector Filtering

AI can fail. When it does, zero vectors are returned and filtered:
- Never cached (prevents cache poisoning)
- Never stored in Vectorize (prevents -1 scores)

## Conclusion

You've built a production-ready AI-powered code indexing system with:

1. **Multi-tenant isolation**: Each user's vectors are completely isolated
2. **Global embedding cache**: 70-90% AI cost savings across users
3. **Graceful error handling**: Zero vectors never corrupt the system
4. **Semantic search**: Natural language code discovery
5. **Two-phase sync**: Minimal data transfer, maximum efficiency

### Next Steps

- Integrate with the Phase 1 client for end-to-end testing
- Add authentication with proper JWT validation
- Implement vector deletion for removed chunks
- Add monitoring and alerting for AI failures
