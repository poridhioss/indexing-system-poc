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
}

export interface IndexInitRequest {
    projectId: string;
    merkleRoot: string;
    chunks: InitChunk[];
}

export interface IndexInitResponse {
    status: 'indexed';
    merkleRoot: string;
    chunksStored: number;
    chunksSkipped: number;
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
    lines: [number, number];
    charCount: number;
}

export interface IndexSyncPhase1Request {
    phase: 1;
    projectId: string;
    merkleRoot: string;
    chunks: SyncChunkMeta[];
}

export interface IndexSyncPhase1Response {
    needed: string[];
    cached: string[];
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
}

export interface IndexSyncPhase2Request {
    phase: 2;
    projectId: string;
    merkleRoot: string;
    chunks: SyncChunkWithCode[];
}

export interface IndexSyncPhase2Response {
    status: 'stored';
    received: string[];
    merkleRoot: string;
    message: string;
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
    INDEX_KV: KVNamespace;
    DEV_TOKEN: string;
    CHUNK_HASH_TTL: string;
}

// ============================================
// Context Variables (set by middleware)
// ============================================

export interface Variables {
    userId: string;
}
