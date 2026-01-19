/**
 * Indexing POC Client
 *
 * Client library for the two-phase sync protocol
 * Integrates Merkle Tree Builder, Chunk Hasher, and Worker API
 */

// Main client
export { SyncClient, type SyncResult } from './sync-client';

// Individual components
export { ApiClient, ApiError } from './api-client';
export { CodeReader } from './code-reader';
export { ProjectConfigManager } from './config';

// Types
export type {
    // Chunk types
    ChunkType,
    ChunkReference,

    // Init
    InitChunk,
    IndexInitRequest,
    IndexInitResponse,

    // Check
    IndexCheckRequest,
    IndexCheckResponse,

    // Sync Phase 1
    SyncChunkMeta,
    IndexSyncPhase1Request,
    IndexSyncPhase1Response,

    // Sync Phase 2
    SyncChunkWithCode,
    IndexSyncPhase2Request,
    IndexSyncPhase2Response,

    // Health
    HealthResponse,

    // Error
    ErrorResponse,

    // Config
    ProjectConfig,
    SyncClientConfig,
} from './types';
