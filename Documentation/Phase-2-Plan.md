# Phase 2: AI-Powered Code Indexing

Phase 2 extends the indexing pipeline with AI capabilities. When code chunks are synced to the server, they are now processed through summarization and embedding generation, then stored in a vector database for semantic search.

**Phase 1 (Complete):** Client → Server → Store hash in KV
**Phase 2 (This Plan):** Client → Server → Summarize → Embed → Store in Vectorize

## Tech Stack (100% Free)

| Service | Provider | Model/Product | Cost |
|---------|----------|---------------|------|
| Summarization | Workers AI | `@cf/qwen/qwen2.5-coder-32b-instruct` | FREE |
| Embeddings | Workers AI | `@cf/baai/bge-large-en-v1.5` (1024d) | FREE |
| Vector Storage | Cloudflare | Vectorize | FREE (5M vectors) |
| Hash Storage | Cloudflare | KV | FREE (existing) |

### Free Tier Limits

| Resource | Free Limit | Our Usage (500 chunks) |
|----------|------------|------------------------|
| Workers AI | 10,000 neurons/day | ~1,000 neurons |
| Vectorize | 5M vectors, 30M dimensions | ~500 vectors |
| KV | 100K reads/day | ~1K reads |

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT SIDE                              │
├─────────────────────────────────────────────────────────────────┤
│  File Watcher → Merkle Tree → Chunk Hasher → Sync Client       │
│                                                    │            │
│                                            POST /v1/index/init  │
│                                            POST /v1/index/sync  │
└────────────────────────────────────────────────────┬────────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER SIDE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Receive chunks with code                                    │
│     │                                                           │
│     ▼                                                           │
│  2. Store hashes in KV (existing Phase 1 logic)                │
│     │                                                           │
│     ▼                                                           │
│  3. Generate summaries ──────────────────────────────┐         │
│     │  Workers AI: qwen2.5-coder-32b-instruct        │         │
│     │  "function calculateTotal" →                    │         │
│     │  "calculates total price from cart items"       │         │
│     │                                                 │         │
│     ▼                                                 │         │
│  4. Generate embeddings ◄────────────────────────────┘         │
│     │  Workers AI: bge-large-en-v1.5                           │
│     │  "calculates total..." → [0.02, -0.15, ..., 0.12]        │
│     │                          (1024 dimensions)                │
│     │                                                           │
│     ▼                                                           │
│  5. Store in Vectorize                                          │
│     │  id: chunk-hash                                           │
│     │  values: [1024 floats]                                    │
│     │  metadata: {summary, type, name, ...}                     │
│     │                                                           │
│     ▼                                                           │
│  6. Return response with AI processing stats                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Search Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      SEMANTIC SEARCH                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Query: "function that calculates price"                   │
│     │                                                           │
│     ▼                                                           │
│  1. Generate query embedding                                    │
│     │  Workers AI: bge-large-en-v1.5                           │
│     │  → [0.01, -0.18, ..., 0.09] (1024d)                      │
│     │                                                           │
│     ▼                                                           │
│  2. Query Vectorize (cosine similarity)                         │
│     │  Find top K most similar vectors                          │
│     │                                                           │
│     ▼                                                           │
│  3. Return results with metadata                                │
│     │  [{hash, score: 0.92, summary, type, name, lines}, ...]  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

### Current (Phase 1)

```
indexing-poc-worker-phase-2/
├── src/
│   ├── index.ts              # Hono app entry
│   ├── types.ts              # Type definitions
│   ├── lib/
│   │   └── kv-store.ts       # KV operations
│   ├── middleware/
│   │   └── auth.ts           # Auth middleware
│   └── routes/
│       ├── health.ts         # GET /v1/health
│       ├── index-init.ts     # POST /v1/index/init
│       ├── index-check.ts    # POST /v1/index/check
│       └── index-sync.ts     # POST /v1/index/sync
├── wrangler.toml
├── package.json
└── tsconfig.json
```

### Target (Phase 2)

```
indexing-poc-worker-phase-2/
├── src/
│   ├── index.ts              # UPDATED: Add AI binding + new routes
│   ├── types.ts              # UPDATED: Add AI types
│   ├── lib/
│   │   ├── kv-store.ts       # Existing (no change)
│   │   ├── ai.ts             # NEW: AI helpers (summarize, embed)
│   │   └── vectorize.ts      # NEW: Vectorize helpers
│   ├── middleware/
│   │   └── auth.ts           # Existing (no change)
│   └── routes/
│       ├── health.ts         # Existing (no change)
│       ├── index-init.ts     # UPDATED: Add AI processing
│       ├── index-check.ts    # Existing (no change)
│       ├── index-sync.ts     # UPDATED: Add AI processing
│       ├── summarize.ts      # NEW: POST /v1/summarize/batch (standalone)
│       ├── embeddings.ts     # NEW: POST /v1/embeddings (standalone)
│       └── search.ts         # NEW: POST /v1/search
├── wrangler.toml             # UPDATED: Add AI + Vectorize bindings
├── package.json
└── tsconfig.json
```

**Key Pattern (from puku-worker):** Summarization and embeddings are exposed as **standalone endpoints** that can be called independently or used internally during indexing.

---

## Implementation Steps

### Step 1: Update wrangler.toml

Add Workers AI and Vectorize bindings:

```toml
name = "indexing-poc-phase-2"
main = "src/index.ts"
compatibility_date = "2024-11-24"
compatibility_flags = ["nodejs_compat"]

account_id = "your-account-id"

[vars]
DEV_TOKEN = "dev-token-12345"
CHUNK_HASH_TTL = "2592000"

# Workers AI binding (FREE - 10K neurons/day)
[ai]
binding = "AI"

# KV for hash storage (existing from Phase 1)
[[kv_namespaces]]
binding = "INDEX_KV"
id = "your-kv-id"
preview_id = "your-preview-kv-id"

# Vectorize for embeddings storage (FREE - 5M vectors)
[[vectorize]]
binding = "VECTORIZE"
index_name = "code-chunks"
```

### Step 2: Create Vectorize Index

```bash
# Create the vector index with 1024 dimensions (matches bge-large-en-v1.5)
wrangler vectorize create code-chunks --dimensions 1024 --metric cosine
```

### Step 3: Extend Types (src/types.ts)

```typescript
// ============================================
// Workers AI Types
// ============================================

export interface Ai {
  run(model: string, inputs: AiTextGenerationInput | AiEmbeddingInput): Promise<any>;
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

// ============================================
// Vectorize Types
// ============================================

export interface VectorizeIndex {
  insert(vectors: VectorizeVector[]): Promise<VectorizeInsertResult>;
  upsert(vectors: VectorizeVector[]): Promise<VectorizeInsertResult>;
  query(vector: number[], options: VectorizeQueryOptions): Promise<VectorizeMatches>;
  deleteByIds(ids: string[]): Promise<VectorizeDeleteResult>;
}

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata?: Record<string, any>;
}

export interface VectorizeQueryOptions {
  topK: number;
  returnMetadata?: boolean;
  returnValues?: boolean;
}

export interface VectorizeMatches {
  matches: VectorizeMatch[];
}

export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, any>;
  values?: number[];
}

// ============================================
// Extended Environment
// ============================================

export interface Env {
  // Existing from Phase 1
  INDEX_KV: KVNamespace;
  DEV_TOKEN: string;
  CHUNK_HASH_TTL: string;

  // New for Phase 2
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

// ============================================
// Chunk Metadata (stored in Vectorize)
// ============================================

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

// ============================================
// Search Types
// ============================================

export interface SearchRequest {
  query: string;
  projectId: string;
  topK?: number;  // default: 10
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  took: number;  // milliseconds
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

// ============================================
// AI Processing Types
// ============================================

export interface ProcessedChunk {
  hash: string;
  summary: string;
  embedding: number[];
  metadata: ChunkMetadata;
}

export interface AiProcessingResult {
  processed: number;
  skipped: number;
  errors: string[];
}
```

### Step 4: Create Summarize Route (src/routes/summarize.ts)

Following the puku-worker pattern, we create a standalone batch summarization endpoint with timeout handling.

```typescript
import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const SUMMARIZATION_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const AI_TIMEOUT_MS = 25000;  // 25 second timeout

interface SummarizeRequest {
  chunks: Array<{ text: string }>;
  languageId: string;
}

const summarize = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  } catch (error) {
    clearTimeout(timeoutId!);
    return null;
  }
}

// POST /v1/summarize/batch - Generate code summaries for semantic search
summarize.post('/batch', async (c) => {
  const request = await c.req.json<SummarizeRequest>();
  const env = c.env;

  console.log(`[SummaryGenerator] Generating summaries for ${request.chunks.length} ${request.languageId} chunks`);

  // Create batch prompt (same pattern as puku-worker)
  const chunksText = request.chunks
    .map((chunk, i) => `[CHUNK ${i + 1}]\n${chunk.text}\n`)
    .join('\n');

  const prompt = `Summarize each ${request.languageId} code chunk in natural language for semantic search.

IMPORTANT: Output summaries directly. Do NOT use <think>, <thinking>, or any XML tags.

Rules:
- Use plain English verbs (sends, calculates, stores, retrieves, validates, etc)
- Focus on WHAT it does, not HOW (avoid technical jargon)
- Include inputs and outputs in natural language
- Format: [N] summary text (numbered list starting from 1)
- NO code syntax, NO thinking process, NO XML tags
- Output EXACTLY ${request.chunks.length} summaries, one per chunk

Good examples:
[1] sends email notification to user with message, takes userId and message, returns success status
[2] calculates total price from shopping cart items by summing individual item prices
[3] stores user preferences in database, validates input format before saving

${chunksText}

Output ${request.chunks.length} numbered summaries (format: [1] summary, [2] summary, etc):`;

  try {
    console.log(`[SummaryGenerator] Calling Workers AI with ${request.chunks.length} chunks`);
    const startTime = Date.now();

    // ✅ Call Workers AI with timeout
    const response = await withTimeout(
      env.AI.run(SUMMARIZATION_MODEL, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: request.chunks.length * 100,
        temperature: 0.3,
      }),
      AI_TIMEOUT_MS
    );

    const duration = Date.now() - startTime;
    console.log(`[SummaryGenerator] Workers AI responded in ${duration}ms`);

    // ✅ Handle timeout - return fallback
    if (!response) {
      console.warn('[SummaryGenerator] AI call timed out, using fallback summaries');
      return c.json({
        summaries: request.chunks.map(() => 'Code chunk'),
        timedOut: true,
      });
    }

    let summariesText = response.response;

    // Check if response is empty - use fallback
    if (!summariesText) {
      console.warn('[SummaryGenerator] No content in response, using fallback summaries');
      return c.json({
        summaries: request.chunks.map(() => 'Code chunk'),
      });
    }

    // Remove thinking tags if present (safety measure)
    summariesText = summariesText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Check if response is empty after stripping thinking tags
    if (summariesText.length < 10) {
      console.warn('[SummaryGenerator] Response was only thinking tags, using fallback');
      return c.json({
        summaries: request.chunks.map(() => 'Code chunk'),
      });
    }

    // Parse summaries from response
    const lines = summariesText.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('<'));
    const summaries: string[] = [];

    for (let i = 0; i < request.chunks.length; i++) {
      const pattern = new RegExp(`^\\[${i + 1}\\]\\s*(.+)$`);
      let found = false;

      for (const line of lines) {
        const match = line.match(pattern);
        if (match) {
          summaries.push(match[1].trim());
          found = true;
          break;
        }
      }

      if (!found) {
        // Fallback: try to find any remaining unparsed line
        const remainingLines = lines.filter((l: string) => !summaries.some((s) => l.includes(s)));

        if (remainingLines.length > 0) {
          const line = remainingLines[0].replace(/^\[\d+\]\s*/, '').trim();
          summaries.push(line || 'Code chunk');
        } else {
          summaries.push('Code chunk');
        }
      }
    }

    console.log(`[SummaryGenerator] Generated ${summaries.length}/${request.chunks.length} summaries`);

    return c.json({ summaries });
  } catch (error: any) {
    console.error('[SummaryGenerator] Error:', {
      name: error?.name,
      message: error?.message,
    });

    // ✅ Return fallback on error instead of 500
    return c.json({
      summaries: request.chunks.map(() => 'Code chunk'),
      error: error?.message || 'Summary generation failed',
    });
  }
});

export default summarize;
```

### Step 5: Create Embeddings Route (src/routes/embeddings.ts)

```typescript
import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
const EMBEDDING_DIMENSIONS = 1024;
const AI_TIMEOUT_MS = 25000;  // 25 second timeout

interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

const embeddings = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  } catch (error) {
    clearTimeout(timeoutId!);
    return null;
  }
}

// POST /v1/embeddings - Generate embeddings (OpenAI-compatible)
embeddings.post('/', async (c) => {
  const request = await c.req.json<EmbeddingRequest>();
  const env = c.env;

  // Validate request
  if (!request.input) {
    return c.json(
      {
        error: {
          message: 'input is required',
          type: 'invalid_request_error',
        },
      },
      400
    );
  }

  // Normalize input to array
  const texts = Array.isArray(request.input) ? request.input : [request.input];

  console.log(`[Embeddings] Generating embeddings for ${texts.length} texts`);

  try {
    const startTime = Date.now();

    // ✅ Call Workers AI with timeout
    const response = await withTimeout(
      env.AI.run(EMBEDDING_MODEL, {
        text: texts,
      }),
      AI_TIMEOUT_MS
    );

    const duration = Date.now() - startTime;
    console.log(`[Embeddings] Workers AI responded in ${duration}ms`);

    // ✅ Handle timeout - return zero vectors as fallback
    if (!response || !response.data) {
      console.warn('[Embeddings] AI call timed out or failed, returning zero vectors');
      return c.json({
        object: 'list',
        data: texts.map((_, index) => ({
          object: 'embedding',
          embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
          index,
        })),
        model: EMBEDDING_MODEL,
        timedOut: true,
        usage: {
          prompt_tokens: texts.join(' ').split(/\s+/).length,
          total_tokens: texts.join(' ').split(/\s+/).length,
        },
      });
    }

    // ✅ Validate response length matches input
    if (response.data.length !== texts.length) {
      console.warn(`[Embeddings] Response length mismatch: ${response.data.length} vs ${texts.length}`);
      // Pad with zero vectors if needed
      while (response.data.length < texts.length) {
        response.data.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
      }
    }

    // Format response (OpenAI-compatible)
    return c.json({
      object: 'list',
      data: response.data.map((embedding: number[], index: number) => ({
        object: 'embedding',
        embedding,
        index,
      })),
      model: EMBEDDING_MODEL,
      usage: {
        prompt_tokens: texts.join(' ').split(/\s+/).length,
        total_tokens: texts.join(' ').split(/\s+/).length,
      },
    });
  } catch (error: any) {
    console.error('[Embeddings] Error:', error);

    // ✅ Return zero vectors as fallback instead of 500
    return c.json({
      object: 'list',
      data: texts.map((_, index) => ({
        object: 'embedding',
        embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
        index,
      })),
      model: EMBEDDING_MODEL,
      error: error?.message || 'Embedding generation failed',
      usage: {
        prompt_tokens: texts.join(' ').split(/\s+/).length,
        total_tokens: texts.join(' ').split(/\s+/).length,
      },
    });
  }
});

export default embeddings;
```

### Step 6: Create Vectorize Helper (src/lib/vectorize.ts)

```typescript
import type { VectorizeIndex, ChunkMetadata, VectorizeVector, SearchResult } from '../types';

/**
 * Upsert chunks to Vectorize
 *
 * @param vectorize - Vectorize index binding
 * @param chunks - Processed chunks with embeddings
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

  const vectors: VectorizeVector[] = chunks.map(chunk => ({
    id: chunk.hash,
    values: chunk.embedding,
    metadata: chunk.metadata,
  }));

  // Vectorize supports batch upsert up to 1000 vectors
  const BATCH_SIZE = 100;

  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    await vectorize.upsert(batch);
  }
}

/**
 * Search for similar chunks
 *
 * @param vectorize - Vectorize index binding
 * @param embedding - Query embedding vector
 * @param projectId - Filter by project
 * @param topK - Number of results to return
 * @returns Array of search results with scores
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
    const metadata = match.metadata as ChunkMetadata;

    if (metadata.projectId === projectId) {
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

/**
 * Delete chunks from Vectorize
 *
 * @param vectorize - Vectorize index binding
 * @param hashes - Array of chunk hashes to delete
 */
export async function deleteChunks(
  vectorize: VectorizeIndex,
  hashes: string[]
): Promise<void> {
  if (hashes.length === 0) return;

  // Vectorize supports batch delete
  const BATCH_SIZE = 100;

  for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
    const batch = hashes.slice(i, i + BATCH_SIZE);
    await vectorize.deleteByIds(batch);
  }
}
```

### Step 7: Create AI Helper (src/lib/ai.ts)

This helper wraps the same logic used in the standalone endpoints for internal use. It includes **batch processing** with a maximum of 50 chunks per API call to stay within model context limits.

**Key Robustness Features:**
1. ✅ **Timeout Handling**: 25-second timeout per AI call using AbortController
2. ✅ **Per-Batch Error Handling**: Failed batches return fallback summaries, don't break entire flow
3. ✅ **Language Grouping**: Chunks grouped by languageId before batching for better summaries
4. ✅ **Array Length Validation**: Ensures summaries.length === chunks.length before proceeding

```typescript
import type { Ai } from '../types';

const SUMMARIZATION_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';

// Batch size limits (based on model context window)
const SUMMARIZATION_BATCH_SIZE = 50;  // ~18,750 tokens, safe for 32k context
const EMBEDDING_BATCH_SIZE = 100;     // BGE model handles larger batches

// Timeout for AI calls (Workers have 30s CPU limit, leave buffer)
const AI_TIMEOUT_MS = 25000;

/**
 * Wrap an AI call with timeout handling
 * Returns null on timeout instead of throwing
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
        });
      }),
    ]);
    clearTimeout(timeoutId);
    return result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error(`[AI] ${operationName} failed:`, error.message);
    return null;
  }
}

/**
 * Generate summaries for a single batch of chunks (internal helper)
 * Max 50 chunks per call to stay within context limits
 *
 * IMPORTANT: All chunks in a batch should have the same languageId
 * Returns fallback summaries on failure (never throws)
 */
async function summarizeBatch(
  ai: Ai,
  chunks: Array<{ code: string; languageId: string }>
): Promise<string[]> {
  const languageId = chunks[0].languageId;

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

  // Call AI with timeout
  const response = await withTimeout(
    ai.run(SUMMARIZATION_MODEL, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: chunks.length * 100,
      temperature: 0.3,
    }),
    AI_TIMEOUT_MS,
    `Summarization batch (${chunks.length} ${languageId} chunks)`
  );

  // Fallback on timeout or error
  if (!response) {
    console.warn(`[AI] Batch failed, using fallback for ${chunks.length} chunks`);
    return chunks.map(() => 'Code chunk');
  }

  let summariesText = response.response || '';

  // Remove thinking tags if present
  summariesText = summariesText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (summariesText.length < 10) {
    // Fallback if response is empty
    return chunks.map(() => 'Code chunk');
  }

  // Parse summaries
  const lines = summariesText.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('<'));
  const summaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const pattern = new RegExp(`^\\[${i + 1}\\]\\s*(.+)$`);
    let found = false;

    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        summaries.push(match[1].trim());
        found = true;
        break;
      }
    }

    if (!found) {
      summaries.push('Code chunk');
    }
  }

  return summaries;
}

/**
 * Group chunks by languageId to ensure each batch has same language
 * This improves summary quality since prompt is language-specific
 */
function groupByLanguage(
  chunks: Array<{ code: string; languageId: string; originalIndex: number }>
): Map<string, Array<{ code: string; languageId: string; originalIndex: number }>> {
  const groups = new Map<string, Array<{ code: string; languageId: string; originalIndex: number }>>();

  for (const chunk of chunks) {
    const existing = groups.get(chunk.languageId) || [];
    existing.push(chunk);
    groups.set(chunk.languageId, existing);
  }

  return groups;
}

/**
 * Generate summaries for code chunks with automatic batching
 * Processes in batches of 50 chunks max per API call
 *
 * Features:
 * - Groups chunks by languageId before batching
 * - 25s timeout per batch with fallback
 * - Guarantees output length === input length
 */
export async function generateSummaries(
  ai: Ai,
  chunks: Array<{ code: string; languageId: string }>
): Promise<string[]> {
  if (chunks.length === 0) return [];

  // Track original indices for reassembly
  const chunksWithIndex = chunks.map((chunk, i) => ({ ...chunk, originalIndex: i }));

  // Group by language for better prompts
  const languageGroups = groupByLanguage(chunksWithIndex);

  // Result array (will be filled in original order)
  const allSummaries: string[] = new Array(chunks.length);

  // Process each language group
  for (const [languageId, langChunks] of languageGroups) {
    console.log(`[AI] Processing ${langChunks.length} ${languageId} chunks`);

    // Process in batches of 50
    for (let i = 0; i < langChunks.length; i += SUMMARIZATION_BATCH_SIZE) {
      const batch = langChunks.slice(i, i + SUMMARIZATION_BATCH_SIZE);
      const batchNum = Math.floor(i / SUMMARIZATION_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(langChunks.length / SUMMARIZATION_BATCH_SIZE);

      console.log(`[AI] Summarizing ${languageId} batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);

      // Get summaries for this batch (with timeout + fallback)
      const batchSummaries = await summarizeBatch(ai, batch);

      // Map summaries back to original indices
      for (let j = 0; j < batch.length; j++) {
        allSummaries[batch[j].originalIndex] = batchSummaries[j];
      }
    }
  }

  // Final validation: ensure no undefined values
  for (let i = 0; i < allSummaries.length; i++) {
    if (!allSummaries[i]) {
      console.warn(`[AI] Missing summary at index ${i}, using fallback`);
      allSummaries[i] = 'Code chunk';
    }
  }

  return allSummaries;
}

/**
 * Generate embeddings for text array with automatic batching
 * Processes in batches of 100 texts max per API call
 *
 * Features:
 * - 25s timeout per batch with fallback (zero vector)
 * - Guarantees output length === input length
 */
export async function generateEmbeddings(
  ai: Ai,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allEmbeddings: number[][] = [];

  // We need to know embedding dimensions for fallback
  // BGE-large-en-v1.5 outputs 1024 dimensions
  const EMBEDDING_DIMENSIONS = 1024;

  // Process in batches of 100
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchNum = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(texts.length / EMBEDDING_BATCH_SIZE);

    console.log(`[AI] Embedding batch ${batchNum}/${totalBatches} (${batch.length} texts)`);

    // Call AI with timeout
    const response = await withTimeout(
      ai.run(EMBEDDING_MODEL, {
        text: batch,
      }),
      AI_TIMEOUT_MS,
      `Embedding batch ${batchNum}`
    );

    if (response && response.data && response.data.length === batch.length) {
      // Success - add embeddings
      allEmbeddings.push(...response.data);
    } else {
      // Fallback - use zero vectors (will have low similarity scores)
      console.warn(`[AI] Embedding batch ${batchNum} failed, using zero vectors for ${batch.length} texts`);
      for (let j = 0; j < batch.length; j++) {
        allEmbeddings.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
      }
    }
  }

  // Final validation
  if (allEmbeddings.length !== texts.length) {
    console.error(`[AI] Embedding count mismatch: got ${allEmbeddings.length}, expected ${texts.length}`);
    // Pad with zero vectors if needed
    while (allEmbeddings.length < texts.length) {
      allEmbeddings.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
    }
  }

  return allEmbeddings;
}

/**
 * Generate embedding for a single query (used in search)
 */
export async function generateQueryEmbedding(
  ai: Ai,
  query: string
): Promise<number[]> {
  const response = await withTimeout(
    ai.run(EMBEDDING_MODEL, {
      text: [query],
    }),
    AI_TIMEOUT_MS,
    'Query embedding'
  );

  if (response && response.data && response.data[0]) {
    return response.data[0];
  }

  // Fallback: zero vector (will return no results, better than crashing)
  console.warn('[AI] Query embedding failed, returning zero vector');
  return new Array(1024).fill(0);
}
```

**Robustness Summary:**

| Issue | Solution |
|-------|----------|
| AI call hangs forever | 25-second timeout with AbortController |
| Single batch fails | Returns fallback summaries, continues processing |
| Mixed languages in batch | Groups by languageId before batching |
| Array length mismatch | Validates and pads with fallbacks if needed |

**Batch Processing:**

| Operation | Batch Size | Why |
|-----------|------------|-----|
| Summarization | 50 chunks | ~375 tokens/chunk × 50 = ~18,750 tokens (safe for 32K context) |
| Embeddings | 100 texts | BGE model handles larger batches efficiently |

**Example with 120 chunks (60 TypeScript + 60 Python):**
```
Language Grouping:
  - TypeScript: 60 chunks → 2 batches (50 + 10)
  - Python: 60 chunks → 2 batches (50 + 10)

Summarization: 4 API calls total
Embeddings: 2 API calls (100 + 20)
```

### Step 8: Update index-init.ts

```typescript
import { Hono } from 'hono';
import type { Env, Variables, IndexInitRequest, ChunkMetadata } from '../types';
import { setMerkleRoot, setChunkHashes, hasChunkHash } from '../lib/kv-store';
import { generateSummaries, generateEmbeddings } from '../lib/ai';
import { upsertChunks } from '../lib/vectorize';

const indexInit = new Hono<{ Bindings: Env; Variables: Variables }>();

indexInit.post('/', async (c) => {
  const userId = c.get('userId');
  const ttlSeconds = parseInt(c.env.CHUNK_HASH_TTL, 10) || 2592000;

  const body = await c.req.json<IndexInitRequest>();
  const { projectId, merkleRoot, chunks } = body;

  console.log(`[Init] Processing ${chunks.length} chunks for project ${projectId}`);

  // Step 1: Check existing hashes (existing Phase 1 logic)
  const allHashes = chunks.map((chunk) => chunk.hash);
  const existingChecks = await Promise.all(
    allHashes.map(async (hash) => ({
      hash,
      exists: await hasChunkHash(c.env.INDEX_KV, hash),
    }))
  );

  const existingHashes = new Set(existingChecks.filter((c) => c.exists).map((c) => c.hash));
  const newChunks = chunks.filter((chunk) => !existingHashes.has(chunk.hash));

  console.log(`[Init] New chunks: ${newChunks.length}, Cached: ${existingHashes.size}`);

  // Step 2: Store merkle root and hashes in KV
  await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);
  await setChunkHashes(c.env.INDEX_KV, allHashes, ttlSeconds);

  // Step 3: Process new chunks with AI
  let aiProcessed = 0;
  let aiErrors: string[] = [];

  if (newChunks.length > 0) {
    try {
      // Generate summaries
      console.log(`[Init] Generating summaries for ${newChunks.length} chunks`);
      const summaries = await generateSummaries(
        c.env.AI,
        newChunks.map((chunk) => ({
          code: chunk.code,
          languageId: chunk.languageId,
        }))
      );

      // ✅ VALIDATION: Ensure summaries count matches chunks
      if (summaries.length !== newChunks.length) {
        console.error(`[Init] Summary count mismatch: ${summaries.length} vs ${newChunks.length} chunks`);
        aiErrors.push(`Summary count mismatch: got ${summaries.length}, expected ${newChunks.length}`);
        // Don't proceed to embeddings/vectorize if counts don't match
        return c.json({
          status: 'partial',
          merkleRoot,
          chunksStored: newChunks.length,
          chunksSkipped: existingHashes.size,
          aiProcessed: 0,
          aiErrors,
        });
      }

      // Generate embeddings from summaries
      console.log(`[Init] Generating embeddings for ${summaries.length} summaries`);
      const embeddings = await generateEmbeddings(c.env.AI, summaries);

      // ✅ VALIDATION: Ensure embeddings count matches summaries
      if (embeddings.length !== summaries.length) {
        console.error(`[Init] Embedding count mismatch: ${embeddings.length} vs ${summaries.length} summaries`);
        aiErrors.push(`Embedding count mismatch: got ${embeddings.length}, expected ${summaries.length}`);
        return c.json({
          status: 'partial',
          merkleRoot,
          chunksStored: newChunks.length,
          chunksSkipped: existingHashes.size,
          aiProcessed: 0,
          aiErrors,
        });
      }

      // Prepare chunks for Vectorize (now safe - all arrays aligned)
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

      // Upsert to Vectorize
      console.log(`[Init] Upserting ${vectorizeChunks.length} vectors to Vectorize`);
      await upsertChunks(c.env.VECTORIZE, vectorizeChunks);

      aiProcessed = newChunks.length;
    } catch (error: any) {
      console.error('[Init] AI processing error:', error);
      aiErrors.push(error.message || 'AI processing failed');
    }
  }

  return c.json({
    status: 'indexed',
    merkleRoot,
    chunksStored: newChunks.length,
    chunksSkipped: existingHashes.size,
    aiProcessed,
    aiErrors: aiErrors.length > 0 ? aiErrors : undefined,
  });
});

export default indexInit;
```

### Step 9: Update index-sync.ts (Phase 2 handler)

```typescript
// In handlePhase2 function, add AI processing similar to index-init.ts

async function handlePhase2(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  body: IndexSyncPhase2Request,
  userId: string,
  ttlSeconds: number
) {
  const { projectId, merkleRoot, chunks } = body;

  console.log(`[Sync P2] Processing ${chunks.length} chunks`);

  // Step 1: Store hashes in KV (existing)
  const hashes = chunks.map((chunk) => chunk.hash);
  await setChunkHashes(c.env.INDEX_KV, hashes, ttlSeconds);
  await setMerkleRoot(c.env.INDEX_KV, userId, projectId, merkleRoot);

  // Step 2: AI processing (NEW)
  let aiProcessed = 0;
  let aiErrors: string[] = [];

  if (chunks.length > 0) {
    try {
      // Generate summaries
      const summaries = await generateSummaries(
        c.env.AI,
        chunks.map((chunk) => ({
          code: chunk.code,
          languageId: chunk.languageId,
        }))
      );

      // ✅ VALIDATION: Ensure summaries count matches chunks
      if (summaries.length !== chunks.length) {
        console.error(`[Sync P2] Summary count mismatch: ${summaries.length} vs ${chunks.length}`);
        aiErrors.push(`Summary count mismatch: got ${summaries.length}, expected ${chunks.length}`);
        return c.json({
          status: 'partial',
          received: hashes,
          merkleRoot,
          aiProcessed: 0,
          aiErrors,
          message: 'AI processing failed - summary count mismatch',
        });
      }

      // Generate embeddings
      const embeddings = await generateEmbeddings(c.env.AI, summaries);

      // ✅ VALIDATION: Ensure embeddings count matches summaries
      if (embeddings.length !== summaries.length) {
        console.error(`[Sync P2] Embedding count mismatch: ${embeddings.length} vs ${summaries.length}`);
        aiErrors.push(`Embedding count mismatch: got ${embeddings.length}, expected ${summaries.length}`);
        return c.json({
          status: 'partial',
          received: hashes,
          merkleRoot,
          aiProcessed: 0,
          aiErrors,
          message: 'AI processing failed - embedding count mismatch',
        });
      }

      // Upsert to Vectorize (now safe - all arrays aligned)
      const vectorizeChunks = chunks.map((chunk, i) => ({
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
      aiProcessed = chunks.length;
    } catch (error: any) {
      console.error('[Sync P2] AI error:', error);
      aiErrors.push(error.message);
    }
  }

  return c.json({
    status: 'stored',
    received: hashes,
    merkleRoot,
    aiProcessed,
    aiErrors: aiErrors.length > 0 ? aiErrors : undefined,
    message: 'Chunks processed with AI and stored in vector database',
  });
}
```

### Step 10: Create Search Route (src/routes/search.ts)

```typescript
import { Hono } from 'hono';
import type { Env, Variables, SearchRequest, SearchResponse } from '../types';
import { generateQueryEmbedding } from '../lib/ai';
import { searchChunks } from '../lib/vectorize';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

search.post('/', async (c) => {
  const startTime = Date.now();
  const userId = c.get('userId');

  const body = await c.req.json<SearchRequest>();
  const { query, projectId, topK = 10 } = body;

  if (!query || !projectId) {
    return c.json(
      { error: 'Bad Request', message: 'query and projectId are required' },
      400
    );
  }

  console.log(`[Search] Query: "${query}" for project ${projectId}`);

  try {
    // Generate embedding for query
    const queryEmbedding = await generateQueryEmbedding(c.env.AI, query);

    // Search Vectorize
    const results = await searchChunks(
      c.env.VECTORIZE,
      queryEmbedding,
      projectId,
      topK
    );

    const took = Date.now() - startTime;
    console.log(`[Search] Found ${results.length} results in ${took}ms`);

    return c.json({
      results,
      query,
      took,
    } as SearchResponse);
  } catch (error: any) {
    console.error('[Search] Error:', error);
    return c.json(
      { error: 'Search failed', message: error.message },
      500
    );
  }
});

export default search;
```

### Step 11: Update Main Entry (src/index.ts)

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import health from './routes/health';
import indexInit from './routes/index-init';
import indexCheck from './routes/index-check';
import indexSync from './routes/index-sync';
import search from './routes/search';           // NEW
import summarize from './routes/summarize';     // NEW - standalone endpoint
import embeddings from './routes/embeddings';   // NEW - standalone endpoint

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health check - no auth required
app.route('/v1/health', health);

// Protected routes - require auth
app.use('/v1/index/*', authMiddleware);
app.use('/v1/search', authMiddleware);
app.use('/v1/summarize/*', authMiddleware);
app.use('/v1/embeddings', authMiddleware);

// Index routes (existing + updated)
app.route('/v1/index/init', indexInit);
app.route('/v1/index/check', indexCheck);
app.route('/v1/index/sync', indexSync);

// New Phase 2 routes
app.route('/v1/search', search);
app.route('/v1/summarize', summarize);    // POST /v1/summarize/batch
app.route('/v1/embeddings', embeddings);  // POST /v1/embeddings

export default app;
```

---

## API Reference

### Existing Endpoints (No Change)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/health` | GET | Health check |
| `/v1/index/check` | POST | O(1) change detection |

### Updated Endpoints

| Endpoint | Method | Change |
|----------|--------|--------|
| `/v1/index/init` | POST | Now includes AI processing |
| `/v1/index/sync` | POST | Phase 2 now includes AI processing |

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/search` | POST | Semantic vector search |
| `/v1/summarize/batch` | POST | Standalone batch summarization (puku-worker pattern) |
| `/v1/embeddings` | POST | Standalone embeddings generation (OpenAI-compatible) |

### Search Request/Response

**Request:**
```json
POST /v1/search
Authorization: Bearer dev-token-user123
Content-Type: application/json

{
  "query": "function that calculates price",
  "projectId": "my-project",
  "topK": 10
}
```

**Response:**
```json
{
  "results": [
    {
      "hash": "abc123...",
      "score": 0.92,
      "summary": "calculates total price from shopping cart items",
      "type": "function",
      "name": "calculateTotal",
      "languageId": "typescript",
      "lines": [10, 25]
    },
    {
      "hash": "def456...",
      "score": 0.85,
      "summary": "applies discount to product price",
      "type": "function",
      "name": "applyDiscount",
      "languageId": "typescript",
      "lines": [30, 45]
    }
  ],
  "query": "function that calculates price",
  "took": 150
}
```

### Summarize Batch Request/Response

**Request:**
```json
POST /v1/summarize/batch
Authorization: Bearer dev-token-user123
Content-Type: application/json

{
  "chunks": [
    { "text": "function add(a, b) { return a + b; }" },
    { "text": "class Calculator { multiply(x, y) { return x * y; } }" }
  ],
  "languageId": "typescript"
}
```

**Response:**
```json
{
  "summaries": [
    "adds two numbers together and returns the result",
    "calculator class that multiplies two numbers"
  ]
}
```

### Embeddings Request/Response (OpenAI-compatible)

**Request:**
```json
POST /v1/embeddings
Authorization: Bearer dev-token-user123
Content-Type: application/json

{
  "input": ["adds two numbers together", "multiplies two values"],
  "model": "@cf/baai/bge-large-en-v1.5"
}
```

**Response:**
```json
{
  "object": "list",
  "data": [
    { "object": "embedding", "embedding": [0.02, -0.15, ...], "index": 0 },
    { "object": "embedding", "embedding": [0.03, -0.12, ...], "index": 1 }
  ],
  "model": "@cf/baai/bge-large-en-v1.5",
  "usage": { "prompt_tokens": 8, "total_tokens": 8 }
}
```

---

## Vectorize Schema

```typescript
{
  id: "chunk-hash",                    // Unique identifier (SHA-256 of code)
  values: [0.02, -0.15, ..., 0.12],   // 1024-dimensional embedding vector
  metadata: {
    projectId: "my-project",
    userId: "user123",
    summary: "calculates total price from cart items",
    type: "function",                  // function, class, method, etc.
    name: "calculateTotal",            // Function/class name (nullable)
    languageId: "typescript",
    lines: [10, 25],                   // Start and end line numbers
    charCount: 450                     // Character count of code
  }
}
```

---

## Setup Commands

```bash
# 1. Navigate to Phase 2 worker
cd indexing-poc-worker-phase-2

# 2. Create Vectorize index (one-time setup)
wrangler vectorize create code-chunks --dimensions 1024 --metric cosine

# 3. Update wrangler.toml with the Vectorize index name
# [[vectorize]]
# binding = "VECTORIZE"
# index_name = "code-chunks"

# 4. Install dependencies
npm install

# 5. Start local development
npm run dev

# 6. Test with curl
curl -X POST http://localhost:8787/v1/search \
  -H "Authorization: Bearer dev-token-user123" \
  -H "Content-Type: application/json" \
  -d '{"query":"calculate price","projectId":"my-project","topK":5}'

# 7. Deploy to Cloudflare
wrangler deploy
```

---

## Testing Checklist

### Basic Functionality
- [ ] `/v1/health` returns ok
- [ ] `/v1/index/init` processes chunks and returns `aiProcessed` count
- [ ] `/v1/index/check` works (no change from Phase 1)
- [ ] `/v1/index/sync` Phase 1 works (hash check)
- [ ] `/v1/index/sync` Phase 2 processes chunks with AI
- [ ] `/v1/search` returns relevant results

### AI Processing
- [ ] Summaries are generated in natural language
- [ ] Embeddings are 1024-dimensional
- [ ] Vectors are stored in Vectorize with metadata
- [ ] Search returns results sorted by relevance score

### Error Handling
- [ ] AI errors don't break the sync flow
- [ ] Fallback summaries are used when AI fails
- [ ] Error messages are returned in response

---

## Cost Monitoring

Check your Workers AI usage in Cloudflare dashboard:
- Dashboard → Workers & Pages → Workers AI

Free tier limits:
- 10,000 neurons/day
- Resets daily at midnight UTC

Neuron usage estimates:
- 1 summarization call (5 chunks) ≈ 50 neurons
- 1 embedding call (5 texts) ≈ 10 neurons
- 1 search query ≈ 2 neurons

---

## Next Steps After Phase 2

1. **Client Integration**: Update `indexing-poc-client` to use search endpoint
2. **UI Integration**: Build search UI in VS Code extension
3. **Caching**: Add client-side embedding cache
4. **Reranking**: Add cross-encoder reranking for better results
5. **Incremental Updates**: Handle chunk deletions when files change
