# AI-Powered Code Indexing Pipeline (Phase 2)

Building on the Phase 1 indexing pipeline from Lab-08, this lab extends the Cloudflare Worker with AI capabilities. You'll add code summarization using Workers AI, generate embeddings for semantic search, and store vectors in Cloudflare Vectorize.

This is exactly how production AI code editors like Cursor and PUKU Editor implement their semantic search capabilities.

## Project Overview

In **Phase 1**, we built the foundation:
- Two-phase sync protocol (hash check + code transfer)
- KV storage for merkle roots and chunk hashes
- Client-side file watching, Merkle tree, and chunk hashing

In **Phase 2** (this lab), we add AI processing:
- **Summarization**: Generate natural language summaries from code chunks
- **Embeddings**: Generate 1024-dimensional vectors from summaries
- **Vector Storage**: Store embeddings in Cloudflare Vectorize
- **Semantic Search**: Query code by natural language

## Prerequisites

- Completed Lab-08 (Complete Indexing Pipeline Phase 1)
- Cloudflare account with Workers AI access (free tier works)
- Wrangler CLI installed (`npm install -g wrangler`)
- Node.js 18+ installed

## What You'll Learn

1. Using Cloudflare Workers AI for code summarization
2. Generating embeddings with Workers AI
3. Storing and querying vectors with Cloudflare Vectorize
4. Batch processing with timeout handling
5. Building semantic search endpoints

## Architecture Overview

### Phase 1 vs Phase 2 Data Flow

**Phase 1 (Lab-08):**
```
Client Chunks --> Server --> KV (store hashes)
```

**Phase 2 (this lab):**
```
Client Chunks --> Server --> AI Summarize --> AI Embed --> Vectorize --> KV (store hashes)
```

### AI Processing Pipeline

```
                                    PHASE 2: AI PROCESSING
+------------------+     +------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |     |                  |
|   Code Chunks    | --> |   Summarization  | --> |    Embeddings    | --> |    Vectorize     |
|                  |     |   (Qwen 2.5)     |     |   (BGE Large)    |     |    (Storage)     |
|                  |     |                  |     |                  |     |                  |
+------------------+     +------------------+     +------------------+     +------------------+
        |                        |                        |                        |
   From client              Natural language         1024-dim vectors        Stored with
   (code + metadata)        summaries for            for similarity         metadata for
                            semantic search           matching               retrieval
```

### API Endpoints

| Endpoint | Method | Purpose | Phase |
|----------|--------|---------|-------|
| `/v1/health` | GET | Health check | 1 |
| `/v1/index/init` | POST | First-time indexing + AI processing | 1+2 |
| `/v1/index/check` | POST | O(1) change detection | 1 |
| `/v1/index/sync` | POST | Two-phase sync + AI processing | 1+2 |
| `/v1/search` | POST | Semantic code search | 2 |
| `/v1/summarize/batch` | POST | Standalone summarization | 2 |
| `/v1/embeddings` | POST | Standalone embeddings (OpenAI-compatible) | 2 |

## Part 1: Project Setup

### Clone and Navigate

```bash
cd indexing-system-poc/indexing-poc-worker-phase-2
npm install
```

### Project Structure

```
indexing-poc-worker-phase-2/
├── src/
│   ├── index.ts              # Main Hono app entry point
│   ├── types.ts              # Extended type definitions
│   ├── lib/
│   │   ├── kv-store.ts       # KV helper functions (from Phase 1)
│   │   ├── ai.ts             # NEW: AI processing (summarize + embed)
│   │   └── vectorize.ts      # NEW: Vectorize operations
│   ├── middleware/
│   │   └── auth.ts           # Auth middleware (from Phase 1)
│   └── routes/
│       ├── health.ts         # GET /v1/health
│       ├── index-init.ts     # POST /v1/index/init (updated with AI)
│       ├── index-check.ts    # POST /v1/index/check
│       ├── index-sync.ts     # POST /v1/index/sync (updated with AI)
│       ├── search.ts         # NEW: POST /v1/search
│       ├── summarize.ts      # NEW: POST /v1/summarize/batch
│       └── embeddings.ts     # NEW: POST /v1/embeddings
├── wrangler.toml             # Cloudflare configuration (updated)
├── package.json
└── tsconfig.json
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `hono` | ^4.0.0 | Lightweight web framework |
| `wrangler` | ^3.0.0 | Cloudflare CLI |
| `typescript` | ^5.0.0 | TypeScript compiler |

### Cloudflare Services Used

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| **Workers** | Serverless compute | 100K requests/day |
| **KV** | Key-value storage | 100K reads/day, 1K writes/day |
| **Workers AI** | AI inference | 10K neurons/day |
| **Vectorize** | Vector database | 5M vectors, 30M queried dims/month |

## Part 2: Configuration

### Step 1: Configure wrangler.toml

[wrangler.toml](../../indexing-poc-worker-phase-2/wrangler.toml)

```toml
name = "indexing-poc-phase-2"
main = "src/index.ts"
compatibility_date = "2024-11-24"
compatibility_flags = ["nodejs_compat"]

# Your Cloudflare account ID
account_id = "your-account-id-here"

[vars]
DEV_TOKEN = "dev-token-12345"
CHUNK_HASH_TTL = "2592000"

# Workers AI binding (FREE - 10K neurons/day)
[ai]
binding = "AI"

# KV namespace for merkle roots and chunk hashes
[[kv_namespaces]]
binding = "INDEX_KV"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"

# Vectorize for embeddings storage
[[vectorize]]
binding = "VECTORIZE"
index_name = "code-chunks"
```

### Step 2: Create Vectorize Index

Before deploying, create the Vectorize index:

```bash
wrangler vectorize create code-chunks --dimensions 1024 --metric cosine
```

**Expected output:**
```
Created Vectorize index "code-chunks" with 1024 dimensions and cosine metric.
```

## Part 3: Type Definitions

### Extended Types for Phase 2

[src/types.ts](../../indexing-poc-worker-phase-2/src/types.ts)

```typescript
// Workers AI Types
export interface Ai {
    run(
        model: string,
        inputs: AiTextGenerationInput | AiEmbeddingInput
    ): Promise<AiTextGenerationOutput | AiEmbeddingOutput>;
}

export interface AiTextGenerationInput {
    messages: Array<{ role: string; content: string }>;
    max_tokens?: number;
    temperature?: number;
}

export interface AiEmbeddingInput {
    text: string | string[];
}

export interface AiTextGenerationOutput {
    response: string;
}

export interface AiEmbeddingOutput {
    shape: number[];
    data: number[][];
}

// Vectorize Types
export interface VectorizeIndex {
    insert(vectors: VectorizeVector[]): Promise<VectorizeInsertResult>;
    upsert(vectors: VectorizeVector[]): Promise<VectorizeInsertResult>;
    query(vector: number[], options: VectorizeQueryOptions): Promise<VectorizeMatches>;
    deleteByIds(ids: string[]): Promise<VectorizeDeleteResult>;
}

export interface VectorizeVector {
    id: string;
    values: number[];
    metadata?: Record<string, unknown>;
}

// Chunk Metadata (stored in Vectorize)
export interface ChunkMetadata {
    projectId: string;
    userId: string;
    summary: string;
    type: ChunkType;
    name: string | null;
    languageId: string;
    lines: [number, number];
    charCount: number;
}

// Search Types
export interface SearchRequest {
    query: string;
    projectId: string;
    topK?: number;
}

export interface SearchResponse {
    results: SearchResult[];
    query: string;
    took: number;
}

export interface SearchResult {
    hash: string;
    score: number;
    summary: string;
    type: ChunkType;
    name: string | null;
    languageId: string;
    lines: [number, number];
}

// Environment Bindings (Extended)
export interface Env {
    // Phase 1 bindings
    INDEX_KV: KVNamespace;
    DEV_TOKEN: string;
    CHUNK_HASH_TTL: string;

    // Phase 2 bindings
    AI: Ai;
    VECTORIZE: VectorizeIndex;
}
```

## Part 4: AI Processing Module

### The AI Helper Functions

[src/lib/ai.ts](../../indexing-poc-worker-phase-2/src/lib/ai.ts)

```typescript
import type { Ai, AiTextGenerationOutput, AiEmbeddingOutput } from '../types';

const SUMMARIZATION_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
const EMBEDDING_DIMENSIONS = 1024;

const AI_TIMEOUT_MS = 25000;
const SUMMARY_BATCH_SIZE = 50;
const EMBEDDING_BATCH_SIZE = 100;

/**
 * Wrap an AI call with timeout handling
 */
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
): Promise<T | null> {
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId!);
        return result;
    } catch {
        clearTimeout(timeoutId!);
        return null;
    }
}
```

**Key design decisions:**

1. **Timeout handling**: Workers AI can be slow; 25s timeout prevents hanging requests
2. **Batch sizes**: 50 for summarization (more tokens), 100 for embeddings (less compute)
3. **Fallback values**: Return placeholder summaries/zero vectors on failure

### Summarization with Language Grouping

```typescript
/**
 * Group chunks by language for better summarization quality
 */
function groupByLanguage(
    chunks: Array<{ code: string; languageId: string }>
): Map<string, Array<{ code: string; index: number }>> {
    const groups = new Map<string, Array<{ code: string; index: number }>>();

    chunks.forEach((chunk, index) => {
        const lang = chunk.languageId;
        if (!groups.has(lang)) {
            groups.set(lang, []);
        }
        groups.get(lang)!.push({ code: chunk.code, index });
    });

    return groups;
}

/**
 * Generate summaries for code chunks
 * Groups by language for better quality, processes in batches
 */
export async function generateSummaries(
    ai: Ai,
    chunks: Array<{ code: string; languageId: string }>
): Promise<string[]> {
    if (chunks.length === 0) return [];

    const summaries: string[] = new Array(chunks.length).fill('Code chunk');
    const languageGroups = groupByLanguage(chunks);

    for (const [languageId, groupChunks] of languageGroups) {
        // Process each language group in batches
        for (let i = 0; i < groupChunks.length; i += SUMMARY_BATCH_SIZE) {
            const batch = groupChunks.slice(i, i + SUMMARY_BATCH_SIZE);
            const batchSummaries = await summarizeBatch(ai, batch, languageId);

            // Map results back to original indices
            batch.forEach((chunk, batchIdx) => {
                summaries[chunk.index] = batchSummaries[batchIdx];
            });
        }
    }

    return summaries;
}
```

**Language grouping benefits:**
- Better context for the LLM (all TypeScript, all Python, etc.)
- More consistent summary quality
- Reduced confusion from mixed syntax

### Batch Summarization

```typescript
async function summarizeBatch(
    ai: Ai,
    chunks: Array<{ code: string; index: number }>,
    languageId: string
): Promise<string[]> {
    const chunksText = chunks
        .map((chunk, i) => `[CHUNK ${i + 1}]\n${chunk.code}\n`)
        .join('\n');

    const prompt = `Summarize each ${languageId} code chunk in natural language for semantic search.

IMPORTANT: Output summaries directly. Do NOT use <think>, <thinking>, or any XML tags.

Rules:
- Use plain English verbs (sends, calculates, stores, retrieves, validates, etc)
- Focus on WHAT it does, not HOW (avoid technical jargon)
- Include inputs and outputs in natural language
- Format: [N] summary text (numbered list starting from 1)
- NO code syntax, NO thinking process, NO XML tags
- Output EXACTLY ${chunks.length} summaries, one per chunk

Good examples:
[1] sends email notification to user with message, takes userId and message, returns success status
[2] calculates total price from shopping cart items by summing individual item prices
[3] stores user preferences in database, validates input format before saving

${chunksText}

Output ${chunks.length} numbered summaries (format: [1] summary, [2] summary, etc):`;

    const response = await withTimeout(
        ai.run(SUMMARIZATION_MODEL, {
            messages: [{ role: 'user', content: prompt }],
            max_tokens: chunks.length * 100,
            temperature: 0.3,
        }),
        AI_TIMEOUT_MS
    );

    // Parse response and extract summaries
    // ... (parsing logic)

    return summaries;
}
```

### Embedding Generation

```typescript
/**
 * Generate embeddings for text summaries
 * Processes in batches of 100
 */
export async function generateEmbeddings(
    ai: Ai,
    texts: string[]
): Promise<number[][]> {
    if (texts.length === 0) return [];

    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);

        const response = await withTimeout(
            ai.run(EMBEDDING_MODEL, { text: batch }),
            AI_TIMEOUT_MS
        );

        const embeddingResponse = response as AiEmbeddingOutput | null;

        if (!embeddingResponse || !embeddingResponse.data) {
            // Fallback: return zero vectors
            embeddings.push(
                ...batch.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0))
            );
            continue;
        }

        embeddings.push(...embeddingResponse.data);
    }

    return embeddings;
}

/**
 * Generate embedding for a single search query
 */
export async function generateQueryEmbedding(
    ai: Ai,
    query: string
): Promise<number[] | null> {
    const response = await withTimeout(
        ai.run(EMBEDDING_MODEL, { text: [query] }),
        AI_TIMEOUT_MS
    );

    const embeddingResponse = response as AiEmbeddingOutput | null;

    if (!embeddingResponse?.data?.[0]) {
        return null;
    }

    return embeddingResponse.data[0];
}
```

## Part 5: Vectorize Module

### Vector Database Operations

[src/lib/vectorize.ts](../../indexing-poc-worker-phase-2/src/lib/vectorize.ts)

```typescript
import type { VectorizeIndex, ChunkMetadata, VectorizeVector, SearchResult } from '../types';

const VECTORIZE_BATCH_SIZE = 100;

/**
 * Upsert chunks to Vectorize
 */
export async function upsertChunks(
    vectorize: VectorizeIndex,
    chunks: Array<{
        hash: string;
        embedding: number[];
        metadata: ChunkMetadata;
    }>
): Promise<void> {
    if (chunks.length === 0) return;

    const vectors: VectorizeVector[] = chunks.map((chunk) => ({
        id: chunk.hash,
        values: chunk.embedding,
        metadata: chunk.metadata as unknown as Record<string, unknown>,
    }));

    // Batch upsert (100 vectors per batch)
    for (let i = 0; i < vectors.length; i += VECTORIZE_BATCH_SIZE) {
        const batch = vectors.slice(i, i + VECTORIZE_BATCH_SIZE);
        await vectorize.upsert(batch);
    }
}

/**
 * Search for similar chunks
 */
export async function searchChunks(
    vectorize: VectorizeIndex,
    embedding: number[],
    projectId: string,
    topK: number = 10
): Promise<SearchResult[]> {
    const response = await vectorize.query(embedding, {
        topK: topK * 2,  // Fetch more to filter by projectId
        returnMetadata: true,
    });

    // Filter by projectId and map to SearchResult
    const results: SearchResult[] = [];

    for (const match of response.matches) {
        const metadata = match.metadata as unknown as ChunkMetadata;

        if (metadata && metadata.projectId === projectId) {
            results.push({
                hash: match.id,
                score: match.score,
                summary: metadata.summary,
                type: metadata.type,
                name: metadata.name,
                languageId: metadata.languageId,
                lines: metadata.lines,
            });
        }

        if (results.length >= topK) break;
    }

    return results;
}
```

## Part 6: Updated Route Handlers

### Index Init with AI Processing

[src/routes/index-init.ts](../../indexing-poc-worker-phase-2/src/routes/index-init.ts)

```typescript
indexInit.post('/', async (c) => {
    const userId = c.get('userId');
    const ttlSeconds = parseInt(c.env.CHUNK_HASH_TTL, 10) || 2592000;

    const body = await c.req.json<IndexInitRequest>();
    const { projectId, merkleRoot, chunks } = body;

    // Step 1: Check existing hashes
    const allHashes = chunks.map((chunk) => chunk.hash);
    const existingChecks = await Promise.all(
        allHashes.map(async (hash) => ({
            hash,
            exists: await hasChunkHash(c.env.INDEX_KV, hash),
        }))
    );

    const newChunks = chunks.filter(
        (chunk) => !existingChecks.find((c) => c.hash === chunk.hash)?.exists
    );

    // Step 2: Store merkle root and hashes
    await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);
    await setChunkHashes(c.env.INDEX_KV, allHashes, ttlSeconds);

    // Step 3: AI processing for new chunks
    let aiProcessed = 0;
    const aiErrors: string[] = [];

    if (newChunks.length > 0) {
        try {
            // Generate summaries
            const summaries = await generateSummaries(
                c.env.AI,
                newChunks.map((chunk) => ({
                    code: chunk.code,
                    languageId: chunk.languageId,
                }))
            );

            // Validate array alignment
            if (summaries.length !== newChunks.length) {
                aiErrors.push(`Summary count mismatch`);
                // Return early with partial status
            }

            // Generate embeddings
            const embeddings = await generateEmbeddings(c.env.AI, summaries);

            // Validate array alignment
            if (embeddings.length !== summaries.length) {
                aiErrors.push(`Embedding count mismatch`);
                // Return early with partial status
            }

            // Upsert to Vectorize
            const vectorizeChunks = newChunks.map((chunk, i) => ({
                hash: chunk.hash,
                embedding: embeddings[i],
                metadata: {
                    projectId,
                    userId,
                    summary: summaries[i],
                    type: chunk.type,
                    name: chunk.name,
                    languageId: chunk.languageId,
                    lines: chunk.lines,
                    charCount: chunk.charCount,
                } as ChunkMetadata,
            }));

            await upsertChunks(c.env.VECTORIZE, vectorizeChunks);
            aiProcessed = newChunks.length;
        } catch (error: unknown) {
            aiErrors.push(error instanceof Error ? error.message : 'AI processing failed');
        }
    }

    return c.json({
        status: aiErrors.length > 0 ? 'partial' : 'indexed',
        merkleRoot,
        chunksStored: newChunks.length,
        chunksSkipped: chunks.length - newChunks.length,
        aiProcessed,
        aiErrors: aiErrors.length > 0 ? aiErrors : undefined,
    });
});
```

### Search Endpoint

[src/routes/search.ts](../../indexing-poc-worker-phase-2/src/routes/search.ts)

```typescript
search.post('/', async (c) => {
    const startTime = Date.now();
    const body = await c.req.json<SearchRequest>();

    // Validate request
    if (!body.query || !body.projectId) {
        return c.json({ error: 'query and projectId are required' }, 400);
    }

    const topK = body.topK ?? 10;

    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(c.env.AI, body.query);

    if (!queryEmbedding) {
        return c.json({ error: 'Failed to generate query embedding' }, 500);
    }

    // Search Vectorize
    const results = await searchChunks(
        c.env.VECTORIZE,
        queryEmbedding,
        body.projectId,
        topK
    );

    const took = Date.now() - startTime;

    return c.json({
        results,
        query: body.query,
        took,
    });
});
```

## Part 7: Deploy and Test the Worker

### Deploy to Cloudflare

```bash
cd indexing-poc-worker-phase-2
wrangler deploy
```

**Deployed URL:** `https://indexing-poc-phase-2.fazlulkarim362.workers.dev`

### Test with curl

#### Test 1: Root Endpoint (API Info)

```bash
curl https://indexing-poc-phase-2.fazlulkarim362.workers.dev/
```

**Expected:**
```json
{
  "name": "indexing-poc-worker-phase-2",
  "version": "2.0.0",
  "endpoints": {
    "health": "GET /v1/health",
    "init": "POST /v1/index/init",
    "check": "POST /v1/index/check",
    "sync": "POST /v1/index/sync",
    "search": "POST /v1/search",
    "summarize": "POST /v1/summarize/batch",
    "embeddings": "POST /v1/embeddings"
  }
}
```

#### Test 2: Health Check

```bash
curl https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/health
```

**Expected:**
```json
{"status":"ok","timestamp":"2026-01-15T10:00:00.000Z","version":"1.0.0"}
```

#### Test 3: Initialize with AI Processing

**Note:** Use unique hash values each time you test. If hashes already exist in KV cache, they will be skipped (this is the expected two-phase sync optimization).

```bash
curl -X POST https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/index/init \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-project",
    "merkleRoot": "root-'$(date +%s)'",
    "chunks": [
      {
        "hash": "hash-add-'$(date +%s)'",
        "code": "function add(a, b) { return a + b; }",
        "type": "function",
        "name": "add",
        "languageId": "javascript",
        "lines": [1, 3],
        "charCount": 36
      },
      {
        "hash": "hash-multiply-'$(date +%s)'",
        "code": "function multiply(x, y) { return x * y; }",
        "type": "function",
        "name": "multiply",
        "languageId": "javascript",
        "lines": [5, 7],
        "charCount": 42
      }
    ]
  }'
```

**Expected:**
```json
{
  "status": "indexed",
  "merkleRoot": "root-1736945000",
  "chunksStored": 2,
  "chunksSkipped": 0,
  "aiProcessed": 2
}
```

**Note:** If you see `chunksSkipped: 2` and `aiProcessed: 0`, the hashes were already cached. Use different hash values.

#### Test 4: Check for Changes

```bash
curl -X POST https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/index/check \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{"projectId": "my-project", "merkleRoot": "abc123"}'
```

**Expected:**
```json
{"changed": false, "serverRoot": "abc123"}
```

#### Test 5: Sync Phase 1 (Hash Check)

```bash
curl -X POST https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/index/sync \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{
    "phase": 1,
    "projectId": "my-project",
    "merkleRoot": "xyz789",
    "chunks": [
      {"hash": "h1", "type": "function", "name": "add", "lines": [1, 3], "charCount": 36},
      {"hash": "h3", "type": "function", "name": "subtract", "lines": [10, 12], "charCount": 40}
    ]
  }'
```

**Expected (h1 cached, h3 needed):**
```json
{"needed": ["h3"], "cached": ["h1"]}
```

#### Test 6: Sync Phase 2 (Code Transfer + AI)

```bash
curl -X POST https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/index/sync \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{
    "phase": 2,
    "projectId": "my-project",
    "merkleRoot": "xyz789",
    "chunks": [
      {
        "hash": "h3",
        "code": "function subtract(a, b) { return a - b; }",
        "type": "function",
        "name": "subtract",
        "languageId": "javascript",
        "lines": [10, 12],
        "charCount": 40
      }
    ]
  }'
```

**Expected:**
```json
{
  "status": "stored",
  "received": ["h3"],
  "merkleRoot": "xyz789",
  "aiProcessed": 1,
  "message": "Chunks processed with AI and stored in vector database"
}
```

#### Test 7: Semantic Search

```bash
curl -X POST https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/search \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "function that adds two numbers",
    "projectId": "my-project",
    "topK": 5
  }'
```

**Expected:**
```json
{
  "results": [
    {
      "hash": "h1",
      "score": 0.89,
      "summary": "adds two numbers together and returns the sum",
      "type": "function",
      "name": "add",
      "languageId": "javascript",
      "lines": [1, 3]
    }
  ],
  "query": "function that adds two numbers",
  "took": 245
}
```

#### Test 8: Standalone Summarization

```bash
curl -X POST https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/summarize/batch \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{
    "chunks": [
      {"text": "function validate(email) { return email.includes(\"@\"); }"}
    ],
    "languageId": "javascript"
  }'
```

**Expected:**
```json
{
  "summaries": ["validates email address by checking for @ symbol, returns true if valid"]
}
```

#### Test 9: Standalone Embeddings (OpenAI-compatible)

```bash
curl -X POST https://indexing-poc-phase-2.fazlulkarim362.workers.dev/v1/embeddings \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{
    "input": ["validates email format", "sends notification to user"]
  }'
```

**Expected:**
```json
{
  "object": "list",
  "data": [
    {"object": "embedding", "embedding": [0.012, -0.034, ...], "index": 0},
    {"object": "embedding", "embedding": [0.056, 0.078, ...], "index": 1}
  ],
  "model": "@cf/baai/bge-large-en-v1.5",
  "usage": {"prompt_tokens": 7, "total_tokens": 7}
}
```

## Part 8: Key Concepts

### Array Alignment Validation

A critical safety check ensures summaries and embeddings align with chunks:

```typescript
// VALIDATION: Ensure summaries count matches chunks
if (summaries.length !== chunks.length) {
    console.error(`Summary count mismatch: ${summaries.length} vs ${chunks.length}`);
    return { status: 'partial', aiErrors: ['Summary count mismatch'] };
}

// VALIDATION: Ensure embeddings count matches summaries
if (embeddings.length !== summaries.length) {
    console.error(`Embedding count mismatch: ${embeddings.length} vs ${summaries.length}`);
    return { status: 'partial', aiErrors: ['Embedding count mismatch'] };
}
```

Without this validation, misaligned arrays could store wrong embeddings for chunks.

### Timeout Handling Strategy

AI calls can be slow or hang. The timeout wrapper ensures graceful degradation:

```typescript
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
}
```

On timeout, fallback values are used instead of failing the entire request.

### Vectorize Metadata Limitations

Cloudflare Vectorize has specific metadata constraints:
- Arrays can only contain strings (not numbers)
- We store `lines: [1, 3]` as separate fields: `lineStart: 1`, `lineEnd: 3`

```typescript
// Convert metadata for Vectorize compatibility
const vectors = chunks.map((chunk) => ({
    id: chunk.hash,
    values: chunk.embedding,
    metadata: {
        projectId: chunk.metadata.projectId,
        summary: chunk.metadata.summary,
        type: chunk.metadata.type,
        name: chunk.metadata.name || '',
        lineStart: chunk.metadata.lines[0],  // Not lines array!
        lineEnd: chunk.metadata.lines[1],
        // ...
    },
}));
```

### Batch Processing Limits

| Operation | Batch Size | Reason |
|-----------|------------|--------|
| Summarization | 50 chunks | More tokens per chunk, longer prompts |
| Embeddings | 100 texts | Smaller inputs, faster processing |
| Vectorize Upsert | 100 vectors | API limit |

### Cost Analysis (500 Users)

| Component | Monthly Usage | Cost |
|-----------|---------------|------|
| KV Reads | ~4.32M | $2.16 |
| KV Writes | ~432K | $2.16 |
| Vectorize Storage | 25M vectors | ~$25 |
| Vectorize Queries | 1.44M | ~$1.44 |
| Workers AI | Within free tier | $0 |
| **Total** | | **~$31/month** |

## Conclusion

You've built an AI-powered code indexing pipeline that:

1. **Generates semantic summaries**: Natural language descriptions for code search
2. **Creates embeddings**: 1024-dimensional vectors for similarity matching
3. **Stores in Vectorize**: Persistent vector storage with metadata
4. **Enables semantic search**: Find code by natural language queries
5. **Handles failures gracefully**: Timeout handling and fallback values

**Phase 2 Complete!**

The pipeline now supports full semantic code search. Combined with the Phase 1 sync infrastructure, you have a production-ready indexing system similar to what powers Cursor and other AI code editors.

### Next Steps

- Integrate with the client from Lab-08 for end-to-end testing
- Add more sophisticated search filters (by type, language, etc.)
- Implement chunk deletion when files are removed
- Add analytics and monitoring
