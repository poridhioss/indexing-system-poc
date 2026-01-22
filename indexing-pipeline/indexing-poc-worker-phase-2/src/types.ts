// ============================================
// Chunk Types
// ============================================

export type ChunkType =
    | 'function'
    | 'class'
    | 'method'
    | 'interface'
    | 'type'
    | 'enum'
    | 'struct'
    | 'impl'
    | 'trait'
    | 'block';

// ============================================
// Workers AI Types
// ============================================

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

// ============================================
// Vectorize Types
// ============================================

export interface VectorizeIndex {
    insert(vectors: VectorizeVector[]): Promise<VectorizeInsertResult>;
    upsert(vectors: VectorizeVector[]): Promise<VectorizeInsertResult>;
    query(
        vector: number[],
        options: VectorizeQueryOptions
    ): Promise<VectorizeMatches>;
    deleteByIds(ids: string[]): Promise<VectorizeDeleteResult>;
}

export interface VectorizeVector {
    id: string;
    values: number[];
    metadata?: Record<string, unknown>;
}

export interface VectorizeInsertResult {
    count: number;
    ids: string[];
}

export interface VectorizeDeleteResult {
    count: number;
    ids: string[];
}

export interface VectorizeQueryOptions {
    topK: number;
    returnMetadata?: 'all' | 'indexed' | 'none'; // V2 API
    returnValues?: boolean;
}

export interface VectorizeMatches {
    matches: VectorizeMatch[];
}

export interface VectorizeMatch {
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
    values?: number[];
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
    filePath: string;
}

// ============================================
// Search Types
// ============================================

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
    filePath: string;
}

// ============================================
// Summarize Types
// ============================================

export interface SummarizeRequest {
    chunks: Array<{ text: string }>;
    languageId: string;
}

export interface SummarizeResponse {
    summaries: string[];
    timedOut?: boolean;
    error?: string;
}

// ============================================
// Embeddings Types (OpenAI-compatible)
// ============================================

export interface EmbeddingRequest {
    input: string | string[];
    model?: string;
}

export interface EmbeddingResponse {
    object: 'list';
    data: Array<{
        object: 'embedding';
        embedding: number[];
        index: number;
    }>;
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
    timedOut?: boolean;
    error?: string;
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

// ============================================
// /v1/index/init
// ============================================

export interface InitChunk {
    hash: string;
    code: string;
    type: ChunkType;
    name: string | null;
    languageId: string;
    lines: [number, number];
    charCount: number;
    filePath: string;
}

export interface IndexInitRequest {
    projectId: string;
    merkleRoot: string;
    chunks: InitChunk[];
}

export interface IndexInitResponse {
    status: 'indexed' | 'partial';
    merkleRoot: string;
    chunksReceived: number;
    aiProcessed: number;
    cacheHits: number;
    vectorsStored: number; // Actual vectors stored (excludes zero vectors from failed AI)
    aiErrors?: string[];
}

// ============================================
// /v1/index/check
// ============================================

export interface IndexCheckRequest {
    projectId: string;
    merkleRoot: string;
}

export interface IndexCheckResponse {
    changed: boolean;
    serverRoot: string | null;
}

// ============================================
// /v1/index/sync - Phase 1
// ============================================

export interface SyncChunkMeta {
    hash: string;
    type: ChunkType;
    name: string | null;
    languageId: string;
    lines: [number, number];
    charCount: number;
    filePath: string;
}

export interface IndexSyncPhase1Request {
    phase: 1;
    projectId: string;
    merkleRoot: string;
    chunks: SyncChunkMeta[];
}

export interface IndexSyncPhase1Response {
    needed: string[];
    vectorized: number;
    cacheHits: number;
}

// ============================================
// /v1/index/sync - Phase 2
// ============================================

export interface SyncChunkWithCode {
    hash: string;
    code: string;
    type: ChunkType;
    name: string | null;
    languageId: string;
    lines: [number, number];
    charCount: number;
    filePath: string;
}

export interface IndexSyncPhase2Request {
    phase: 2;
    projectId: string;
    merkleRoot: string;
    chunks: SyncChunkWithCode[];
}

export interface IndexSyncPhase2Response {
    status: 'stored' | 'partial';
    received: string[];
    merkleRoot: string;
    message: string;
    aiProcessed?: number;
    cacheHits?: number;
    vectorsStored?: number; // Actual vectors stored (excludes zero vectors from failed AI)
    aiErrors?: string[];
}

// ============================================
// Combined Sync Request (discriminated union)
// ============================================

export type IndexSyncRequest = IndexSyncPhase1Request | IndexSyncPhase2Request;
export type IndexSyncResponse = IndexSyncPhase1Response | IndexSyncPhase2Response;

// ============================================
// /v1/health
// ============================================

export interface HealthResponse {
    status: 'ok';
    timestamp: string;
    version: string;
}

// ============================================
// Error Response
// ============================================

export interface ErrorResponse {
    error: string;
    message: string;
    details?: unknown;
}

// ============================================
// Environment Bindings
// ============================================

export interface Env {
    // Phase 1 bindings
    INDEX_KV: KVNamespace;
    DEV_TOKEN: string;

    // Phase 2 bindings (AI + Vectorize)
    AI: Ai;
    VECTORIZE: VectorizeIndex;

    // Sentry bindings
    SENTRY_DSN: string;
    CF_VERSION_METADATA: { id: string };
}

// ============================================
// Context Variables (set by middleware)
// ============================================

export interface Variables {
    userId: string;
}
