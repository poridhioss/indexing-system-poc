/**
 * Chunk Hashing Module
 *
 * Provides chunk hashing for two-phase sync protocol:
 * - Phase 2: Send hashes + metadata (no code)
 * - Phase 3: Send code only for chunks server requests
 */

export { ChunkHasher, ChunkHasherConfig, DEFAULT_CONFIG, LanguageConfigs } from './chunk-hasher';
export {
    HashedChunk,
    ChunkType,
    ChunkMetadata,
    ChunkReference,
    HashedChunkOptions,
    ChunkSyncPayload,
    FileSyncPayload,
} from './hashed-chunk';
export { getSemanticTypes, SEMANTIC_NODES, SupportedLanguage, LanguageNodeTypes } from './semantic-nodes';
