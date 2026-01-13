import * as path from 'path';
import { ApiClient } from './api-client';
import { CodeReader } from './code-reader';
import { ProjectConfigManager } from './config';
import type {
    SyncClientConfig,
    InitChunk,
    SyncChunkMeta,
    SyncChunkWithCode,
    IndexInitResponse,
    IndexCheckResponse,
    IndexSyncPhase1Response,
    IndexSyncPhase2Response,
} from './types';

// Internal lib imports
import { MerkleTreeBuilder } from './lib/merkle-tree';
import { ChunkHasher, type LanguageConfigs } from './lib/chunk-hasher';
import type { HashedChunk } from './lib/hashed-chunk';

/**
 * Result of a sync operation
 */
export interface SyncResult {
    success: boolean;
    merkleRoot: string;
    chunksTotal: number;
    chunksNeeded: number;
    chunksCached: number;
    message: string;
}

/**
 * Main sync client that orchestrates the entire sync flow
 * Integrates MerkleTreeBuilder, ChunkHasher, and API calls
 *
 * Flow for existing project (periodic sync):
 * 1. Check merkle root with server
 * 2. If changed → only parse dirty files from dirty-queue.json
 * 3. Send ONLY dirty chunk hashes to server
 * 4. Server says which are needed
 * 5. Send code for needed chunks
 */
export class SyncClient {
    private projectRoot: string;
    private apiClient: ApiClient;
    private codeReader: CodeReader;
    private configManager: ProjectConfigManager;
    private merkleBuilder: MerkleTreeBuilder;
    private chunkHasher: ChunkHasher;
    private extensions: string[];

    // Map of hash -> HashedChunk for looking up chunk details (for phase 2)
    private chunkMap: Map<string, HashedChunk> = new Map();

    constructor(config: SyncClientConfig) {
        this.projectRoot = path.resolve(config.projectRoot);
        this.extensions = config.extensions ?? ['.js', '.ts', '.tsx', '.jsx'];

        this.apiClient = new ApiClient(config.baseUrl, config.authToken);
        this.codeReader = new CodeReader(this.projectRoot);
        this.configManager = new ProjectConfigManager(this.projectRoot);
        this.merkleBuilder = new MerkleTreeBuilder(this.projectRoot);
        this.chunkHasher = new ChunkHasher(this.projectRoot);
    }

    /**
     * Initialize the chunk hasher with language grammars
     */
    async initialize(languageConfigs: LanguageConfigs): Promise<void> {
        await this.chunkHasher.initialize(languageConfigs);
    }

    /**
     * Main sync entry point - handles all scenarios automatically
     */
    async sync(): Promise<SyncResult> {
        console.log(`\n=== Starting Sync for ${this.projectRoot} ===\n`);

        // Step 1: Check if this is a new project
        const isNew = this.configManager.isNewProject();
        console.log(`Is new project: ${isNew}`);

        // Step 2: Get or create project config
        const projectConfig = this.configManager.getOrCreateConfig();
        console.log(`Project ID: ${projectConfig.projectId}`);

        // Step 3: Build merkle tree (always needed for root comparison)
        console.log('\nBuilding Merkle tree...');
        const tree = this.merkleBuilder.buildFromDirectory(this.extensions);
        const merkleRoot = tree.hash;
        console.log(`Merkle root: ${merkleRoot}`);

        // Step 4: Determine flow based on project status
        if (isNew) {
            return this.handleNewProject(projectConfig.projectId, merkleRoot);
        } else {
            return this.handleExistingProject(projectConfig.projectId, merkleRoot);
        }
    }

    /**
     * Handle new project: Chunk ALL files, call /init with all chunks
     */
    private async handleNewProject(
        projectId: string,
        merkleRoot: string
    ): Promise<SyncResult> {
        console.log('\n--- Flow: New Project (Full Init) ---');

        // Chunk ALL files for new project
        console.log('Chunking all files...');
        const chunks = await this.chunkAllFiles();
        console.log(`Total chunks: ${chunks.length}`);

        // Build chunk lookup map
        this.buildChunkMap(chunks);

        // Build init request with all chunks + code
        const initChunks: InitChunk[] = chunks.map((chunk) => ({
            hash: chunk.hash,
            code: this.codeReader.readChunk(chunk.reference),
            type: chunk.type,
            name: chunk.name,
            languageId: chunk.language,
            lines: [chunk.reference.lineStart, chunk.reference.lineEnd] as [number, number],
            charCount: chunk.charCount,
        }));

        console.log(`Sending ${initChunks.length} chunks to /init...`);

        const response: IndexInitResponse = await this.apiClient.init({
            projectId,
            merkleRoot,
            chunks: initChunks,
        });

        console.log(`Init response: ${response.chunksStored} stored, ${response.chunksSkipped} skipped`);

        // Clear dirty queue after successful init
        this.merkleBuilder.clearDirtyQueue();

        return {
            success: true,
            merkleRoot: response.merkleRoot,
            chunksTotal: chunks.length,
            chunksNeeded: response.chunksStored,
            chunksCached: response.chunksSkipped,
            message: `New project indexed successfully`,
        };
    }

    /**
     * Handle existing project: Check first, then sync only dirty files if needed
     */
    private async handleExistingProject(
        projectId: string,
        merkleRoot: string
    ): Promise<SyncResult> {
        console.log('\n--- Flow: Existing Project (Check + Sync) ---');

        // Step 1: Check if sync is needed (compare merkle roots)
        console.log('Checking server state...');
        const checkResponse: IndexCheckResponse = await this.apiClient.check({
            projectId,
            merkleRoot,
        });

        console.log(`Server root: ${checkResponse.serverRoot}`);
        console.log(`Changed: ${checkResponse.changed}`);

        // If server has no data, do full init
        if (checkResponse.serverRoot === null) {
            console.log('Server has no data for this project, doing full init...');
            return this.handleNewProject(projectId, merkleRoot);
        }

        // If no changes, we're done
        if (!checkResponse.changed) {
            console.log('No changes detected, sync complete');
            return {
                success: true,
                merkleRoot,
                chunksTotal: 0,
                chunksNeeded: 0,
                chunksCached: 0,
                message: 'Already in sync',
            };
        }

        // Step 2: Get dirty files and chunk only those
        const dirtyQueue = this.merkleBuilder.getDirtyQueue();
        const dirtyFiles = dirtyQueue?.dirtyFiles ?? [];

        console.log(`Dirty files: ${dirtyFiles.length}`);
        dirtyFiles.forEach(f => console.log(`  - ${f}`));

        let chunks: HashedChunk[];

        if (dirtyFiles.length === 0) {
            // Merkle changed but no dirty files = REOPEN scenario
            // Watcher wasn't running, so dirty queue is empty
            // Must chunk ALL files to find what changed
            console.log('\nReopen detected (no dirty queue), chunking all files...');
            chunks = await this.chunkAllFiles();
            console.log(`Total chunks: ${chunks.length}`);
        } else {
            // Normal periodic sync - chunk only dirty files
            console.log('\nChunking dirty files only...');
            chunks = await this.chunkDirtyFiles(dirtyFiles);
            console.log(`Dirty chunks: ${chunks.length}`);
        }

        // Build chunk lookup map
        this.buildChunkMap(chunks);

        // Step 3: Two-phase sync
        return this.twoPhaseSync(projectId, merkleRoot, chunks);
    }

    /**
     * Chunk all files in the project (for init)
     */
    private async chunkAllFiles(): Promise<HashedChunk[]> {
        const merkleState = this.merkleBuilder.loadMerkleState()!;
        const allChunks: HashedChunk[] = [];

        for (const leaf of merkleState.leaves) {
            const code = this.codeReader.readFile(leaf.relativePath);
            const language = this.getLanguageFromPath(leaf.relativePath);
            const chunks = this.chunkHasher.hashFile(code, language, leaf.relativePath);
            allChunks.push(...chunks);
        }

        return allChunks;
    }

    /**
     * Chunk only the dirty files (for periodic sync)
     */
    private async chunkDirtyFiles(dirtyFiles: string[]): Promise<HashedChunk[]> {
        const dirtyChunks: HashedChunk[] = [];

        for (const relativePath of dirtyFiles) {
            try {
                const code = this.codeReader.readFile(relativePath);
                const language = this.getLanguageFromPath(relativePath);
                const chunks = this.chunkHasher.hashFile(code, language, relativePath);
                dirtyChunks.push(...chunks);
            } catch (err) {
                // File might have been deleted
                console.log(`  Skipping ${relativePath} (might be deleted)`);
            }
        }

        return dirtyChunks;
    }

    /**
     * Build chunk lookup map for phase 2
     */
    private buildChunkMap(chunks: HashedChunk[]): void {
        this.chunkMap.clear();
        for (const chunk of chunks) {
            this.chunkMap.set(chunk.hash, chunk);
        }
    }

    /**
     * Execute two-phase sync protocol
     */
    private async twoPhaseSync(
        projectId: string,
        merkleRoot: string,
        chunks: HashedChunk[]
    ): Promise<SyncResult> {
        console.log('\n--- Phase 1: Hash Check ---');

        // Phase 1: Send hashes only (for dirty chunks)
        const syncChunks: SyncChunkMeta[] = chunks.map((chunk) => chunk.toSyncPayload());

        const phase1Response: IndexSyncPhase1Response = await this.apiClient.syncPhase1({
            phase: 1,
            projectId,
            merkleRoot,
            chunks: syncChunks,
        });

        console.log(`Needed: ${phase1Response.needed.length}`);
        console.log(`Cached: ${phase1Response.cached.length}`);

        // If nothing needed, just update merkle root
        if (phase1Response.needed.length === 0) {
            console.log('All chunks cached, no code transfer needed');
            // Still send phase 2 with empty chunks to update merkle root
            await this.apiClient.syncPhase2({
                phase: 2,
                projectId,
                merkleRoot,
                chunks: [],
            });

            // Clear dirty queue
            this.merkleBuilder.clearDirtyQueue();

            return {
                success: true,
                merkleRoot,
                chunksTotal: chunks.length,
                chunksNeeded: 0,
                chunksCached: phase1Response.cached.length,
                message: 'All chunks cached, merkle root updated',
            };
        }

        console.log('\n--- Phase 2: Code Transfer ---');

        // Phase 2: Send code for needed chunks
        const neededHashes = new Set(phase1Response.needed);
        const neededChunks: SyncChunkWithCode[] = [];

        for (const chunk of chunks) {
            if (neededHashes.has(chunk.hash)) {
                neededChunks.push({
                    hash: chunk.hash,
                    code: this.codeReader.readChunk(chunk.reference),
                    type: chunk.type,
                    name: chunk.name,
                    languageId: chunk.language,
                    lines: [chunk.reference.lineStart, chunk.reference.lineEnd] as [number, number],
                    charCount: chunk.charCount,
                });
            }
        }

        console.log(`Sending ${neededChunks.length} chunks with code...`);

        const phase2Response: IndexSyncPhase2Response = await this.apiClient.syncPhase2({
            phase: 2,
            projectId,
            merkleRoot,
            chunks: neededChunks,
        });

        console.log(`Received: ${phase2Response.received.length}`);
        console.log(`Message: ${phase2Response.message}`);

        // Clear dirty queue
        this.merkleBuilder.clearDirtyQueue();

        return {
            success: true,
            merkleRoot: phase2Response.merkleRoot,
            chunksTotal: chunks.length,
            chunksNeeded: phase1Response.needed.length,
            chunksCached: phase1Response.cached.length,
            message: `Synced ${phase1Response.needed.length} new chunks`,
        };
    }

    /**
     * Get language ID from file path
     */
    private getLanguageFromPath(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const langMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'tsx',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.rs': 'rust',
            '.go': 'go',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
        };
        return langMap[ext] ?? 'text';
    }

    /**
     * Health check
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.apiClient.health();
            return response.status === 'ok';
        } catch {
            return false;
        }
    }
}
