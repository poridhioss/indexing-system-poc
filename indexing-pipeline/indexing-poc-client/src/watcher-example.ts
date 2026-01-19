/**
 * Watcher Example - Tests the full flow with file watching
 *
 * Demonstrates:
 * 1. Initial sync (new project)
 * 2. File watcher detecting changes (updates merkle tree + dirty queue locally)
 * 3. Periodic sync every N minutes (configurable)
 * 4. Two-phase sync protocol for bandwidth efficiency
 *
 * Usage:
 *   npm start
 *
 * Then modify files in test-project/src/ to see changes accumulate.
 * Sync happens automatically every SYNC_INTERVAL_MS or on Ctrl+C.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { SyncClient } from './sync-client';
import { ApiClient } from './api-client';

// Import watcher from internal lib
import { MerkleWatcher } from './lib/watcher';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
// const BASE_URL = 'http://127.0.0.1:8787';
const BASE_URL = 'https://indexing-pipeline-worker-poc.fazlulkarim362.workers.dev/';
const AUTH_TOKEN = 'dev-token-watchertest';
const PROJECT_ROOT = path.resolve(__dirname, '../test-project');
const EXTENSIONS = ['.ts', '.js'];

// Sync interval: 10 minutes (600000ms) for production, 30 seconds for testing
const SYNC_INTERVAL_MS = 30 * 1000; // 30 seconds for demo (use 10 * 60 * 1000 for production)

// WASM files for tree-sitter (installed locally in client)
const LANGUAGE_CONFIGS = {
    typescript: path.join(__dirname, '../node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm'),
    javascript: path.join(__dirname, '../node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm'),
};

// State
let syncClient: SyncClient;
let merkleWatcher: MerkleWatcher;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let pendingChanges: Set<string> = new Set();
let lastSyncTime: Date = new Date();

async function main() {
    console.log('='.repeat(60));
    console.log('File Watcher + Periodic Sync');
    console.log('='.repeat(60));
    console.log(`\nProject: ${PROJECT_ROOT}`);
    console.log(`Worker: ${BASE_URL}`);
    console.log(`Sync interval: ${SYNC_INTERVAL_MS / 1000}s\n`);

    // Step 1: Check worker health
    console.log('1. Checking worker health...');
    const apiClient = new ApiClient(BASE_URL, AUTH_TOKEN);
    try {
        const health = await apiClient.health();
        console.log(`   Worker status: ${health.status}`);
    } catch (err) {
        console.error('   Worker not available. Start with: cd indexing-poc-worker && npm run dev');
        process.exit(1);
    }

    // Step 2: Create sync client
    console.log('\n2. Creating sync client...');
    syncClient = new SyncClient({
        baseUrl: BASE_URL,
        authToken: AUTH_TOKEN,
        projectRoot: PROJECT_ROOT,
        extensions: EXTENSIONS,
    });

    // Step 3: Initialize tree-sitter
    console.log('\n3. Initializing tree-sitter...');
    try {
        await syncClient.initialize(LANGUAGE_CONFIGS);
        console.log('   Tree-sitter initialized');
    } catch (err) {
        console.error('   Failed to initialize tree-sitter:', err);
        process.exit(1);
    }

    // Step 4: Initial sync (on project open)
    console.log('\n4. Running initial sync...');
    const initialResult = await syncClient.sync();
    console.log(`   Initial sync complete: ${initialResult.chunksTotal} chunks`);
    console.log(`   Needed: ${initialResult.chunksNeeded}, Cached: ${initialResult.chunksCached}`);
    lastSyncTime = new Date();

    // Step 5: Start file watcher
    console.log('\n5. Starting file watcher...');
    console.log('   Watching for changes in:', PROJECT_ROOT);
    console.log('   Extensions:', EXTENSIONS.join(', '));

    merkleWatcher = new MerkleWatcher({
        projectRoot: PROJECT_ROOT,
        extensions: EXTENSIONS,
        onFileChanged: handleFileChange,
        onReady: () => {
            console.log('\n' + '='.repeat(60));
            console.log('WATCHING FOR CHANGES');
            console.log(`Next sync in ${SYNC_INTERVAL_MS / 1000}s (or press Ctrl+C to sync & exit)`);
            console.log('='.repeat(60));
            console.log('\nTry editing files in test-project/src/ ...\n');
        },
        onError: (err) => {
            console.error('Watcher error:', err);
        },
    });

    await merkleWatcher.start();

    // Step 6: Start periodic sync timer
    console.log(`\n6. Starting periodic sync (every ${SYNC_INTERVAL_MS / 1000}s)...`);
    syncInterval = setInterval(async () => {
        await performPeriodicSync();
    }, SYNC_INTERVAL_MS);

    // Handle Ctrl+C - sync before exit
    process.on('SIGINT', async () => {
        console.log('\n\nShutting down...');

        // Clear interval
        if (syncInterval) {
            clearInterval(syncInterval);
        }

        // Perform final sync if there are pending changes
        const dirtyFiles = merkleWatcher.getDirtyFiles();
        if (dirtyFiles.length > 0) {
            console.log(`\nPending changes: ${dirtyFiles.length} files`);
            console.log('Performing final sync before exit...');
            await performPeriodicSync();
        } else {
            console.log('\nNo pending changes.');
        }

        await merkleWatcher.stop();
        process.exit(0);
    });
}

/**
 * Handle file change event (create, update, or delete)
 * Only updates local state - does NOT trigger sync
 */
function handleFileChange(relativePath: string, newRoot: string) {
    console.log(`[FILE CHANGED] ${relativePath}`);
    console.log(`               New merkle root: ${newRoot.substring(0, 16)}...`);
    console.log(`               (queued for next sync)`);

    pendingChanges.add(relativePath);

    // Show status
    const timeSinceLastSync = Math.round((Date.now() - lastSyncTime.getTime()) / 1000);
    const timeUntilNextSync = Math.round((SYNC_INTERVAL_MS / 1000) - timeSinceLastSync);
    console.log(`               Next sync in ~${Math.max(0, timeUntilNextSync)}s\n`);
}

/**
 * Perform periodic sync with server
 */
async function performPeriodicSync() {
    const dirtyFiles = merkleWatcher.getDirtyFiles();

    console.log('\n' + '-'.repeat(40));
    console.log(`PERIODIC SYNC (${dirtyFiles.length} files in dirty queue)`);
    console.log('-'.repeat(40));

    // Even if no dirty files, still check with server (handles reopen scenario)
    try {
        const result = await syncClient.sync();

        console.log(`\nSync Result:`);
        console.log(`  Total chunks: ${result.chunksTotal}`);
        console.log(`  Needed (new): ${result.chunksNeeded}`);
        console.log(`  Cached: ${result.chunksCached}`);
        console.log(`  Message: ${result.message}`);

        if (result.chunksTotal > 0) {
            const savings = ((result.chunksCached / result.chunksTotal) * 100).toFixed(1);
            console.log(`  Bandwidth savings: ${savings}%`);
        }

        lastSyncTime = new Date();
        pendingChanges.clear();

        console.log('\n' + '='.repeat(60));
        console.log('WATCHING FOR CHANGES');
        console.log(`Next sync in ${SYNC_INTERVAL_MS / 1000}s`);
        console.log('='.repeat(60) + '\n');

    } catch (err) {
        console.error('Sync failed:', err);
    }
}

main().catch(console.error);
