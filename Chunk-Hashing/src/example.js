const { SemanticChunker } = require('./chunker');
const { ChunkHasher } = require('./chunk-hasher');
const { HashRegistry } = require('./hash-registry');
const { DirtyQueue } = require('./dirty-queue');

async function main() {
    // Initialize chunker (from previous lab)
    const chunker = new SemanticChunker({
        maxChunkSize: 4000,
        minChunkSize: 50,
    });

    await chunker.initialize({
        javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
        python: require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    });

    // Initialize hasher (SHA-256 by default - industry standard)
    // Use { useLegacyMD5: true } for puku-vs-editor compatibility
    const hasher = new ChunkHasher();
    await hasher.initialize();

    // Initialize registry (stores file hashes and chunk hashes)
    const registry = new HashRegistry();

    // Initialize dirty queue (tracks files changed since last sync)
    const dirtyQueue = new DirtyQueue();

    console.log(`Using hash algorithm: ${hasher.getAlgorithm().toUpperCase()}\n`);

    // ============================================================
    // PHASE 1: INITIAL INDEXING (First time opening project)
    // ============================================================
    console.log('=' .repeat(60));
    console.log('PHASE 1: INITIAL INDEXING');
    console.log('=' .repeat(60));
    console.log('\nSimulating: User opens project for the first time\n');

    const originalCode = `
/**
 * User management module
 */
import { db } from './database';

async function getUser(id) {
    return await db.users.findById(id);
}

class UserService {
    constructor(database) {
        this.db = database;
    }

    async create(userData) {
        const user = new User(userData);
        await this.db.users.insert(user);
        return user;
    }

    async update(id, changes) {
        return await this.db.users.update(id, changes);
    }
}

export { getUser, UserService };
    `.trim();

    const filePath = 'src/user-service.js';

    // Step 1: Hash the file content
    console.log('Step 1: Hash file content');
    const fileHash = hasher.hashFile(originalCode, filePath);
    console.log(`  File hash: ${fileHash.substring(0, 16)}...`);

    // Step 2: Parse AST and create chunks
    console.log('\nStep 2: Parse AST → Create semantic chunks');
    const chunks = chunker.chunk(originalCode, 'javascript');
    console.log(`  Created ${chunks.length} chunks`);

    // Step 3: Hash each chunk
    console.log('\nStep 3: Hash each chunk');
    const hashedChunks = hasher.hashChunks(chunks, filePath);
    hashedChunks.forEach((chunk, i) => {
        console.log(`  ${i + 1}. [${chunk.type}] ${chunk.name || '(anonymous)'} → ${chunk.contentHash.substring(0, 12)}...`);
    });

    // Step 4: Save to registry (local storage)
    console.log('\nStep 4: Save to registry (simulates .puku/file-hashes.json)');
    registry.registerFile(filePath, hashedChunks, fileHash);
    console.log(`  Registered: ${filePath}`);
    console.log(`  Registry stats:`, registry.getStats());

    // Mark initial sync complete
    dirtyQueue.clearAll();
    console.log('\n✅ Initial indexing complete. Last sync:', dirtyQueue.lastSync);

    // ============================================================
    // PHASE 2: USER EDITS FILE (File watcher detects change)
    // ============================================================
    console.log('\n' + '=' .repeat(60));
    console.log('PHASE 2: USER EDITS FILE');
    console.log('=' .repeat(60));
    console.log('\nSimulating: User modifies src/user-service.js and saves\n');

    // Modified code: changed getUser function, added new function
    const modifiedCode = `
/**
 * User management module
 */
import { db } from './database';

async function getUser(id) {
    // Added retry logic
    for (let i = 0; i < 3; i++) {
        try {
            return await db.users.findById(id);
        } catch (err) {
            if (i === 2) throw err;
        }
    }
}

async function deleteUser(id) {
    return await db.users.remove(id);
}

class UserService {
    constructor(database) {
        this.db = database;
    }

    async create(userData) {
        const user = new User(userData);
        await this.db.users.insert(user);
        return user;
    }

    async update(id, changes) {
        return await this.db.users.update(id, changes);
    }
}

export { getUser, deleteUser, UserService };
    `.trim();

    // Step 1: File watcher fires → compute new file hash
    console.log('Step 1: File watcher fires → Compute new file hash');
    const newFileHash = hasher.hashFile(modifiedCode, filePath);
    console.log(`  Old hash: ${fileHash.substring(0, 16)}...`);
    console.log(`  New hash: ${newFileHash.substring(0, 16)}...`);

    // Step 2: Check if file changed (compare with registry)
    console.log('\nStep 2: Check if file changed (isIndexed check)');
    const fileChanged = !registry.isIndexed(filePath, newFileHash);
    console.log(`  File changed: ${fileChanged}`);

    if (fileChanged) {
        // Step 3: Mark file as DIRTY (queue for later sync)
        console.log('\nStep 3: Mark file as DIRTY (queue for sync)');
        const oldHash = registry.fileHashes.get(filePath);
        dirtyQueue.markDirty(filePath, oldHash, newFileHash);
        console.log(`  Added to dirty queue: ${filePath}`);
        console.log(`  Dirty queue:`, dirtyQueue.getStats());

        // NOTE: In real implementation, we would NOT re-chunk immediately
        // We would wait for periodic sync (Lab 06+)
        // But for demonstration, we show the full flow here
    }

    // ============================================================
    // PHASE 3: PERIODIC SYNC (Every ~10 minutes in real system)
    // ============================================================
    console.log('\n' + '=' .repeat(60));
    console.log('PHASE 3: PERIODIC SYNC');
    console.log('=' .repeat(60));
    console.log('\nSimulating: 10-minute sync timer fires\n');

    // Process dirty files
    const dirtyFiles = dirtyQueue.getDirtyFiles();
    console.log(`Dirty files to process: ${dirtyFiles.length}`);

    for (const dirtyFilePath of dirtyFiles) {
        console.log(`\nProcessing: ${dirtyFilePath}`);

        // In real implementation, read file from disk
        // Here we use modifiedCode directly
        const fileContent = modifiedCode;

        // Step 1: Re-chunk the file (AST parsing)
        console.log('  Step 1: Re-chunk file (AST parsing)');
        const newChunks = chunker.chunk(fileContent, 'javascript');
        console.log(`    Created ${newChunks.length} chunks`);

        // Step 2: Hash the new chunks
        console.log('  Step 2: Hash new chunks');
        const newHashedChunks = hasher.hashChunks(newChunks, dirtyFilePath);

        // Step 3: Compare chunk hashes with registry
        console.log('  Step 3: Compare chunk hashes');
        const diff = registry.compareChunks(dirtyFilePath, newHashedChunks);

        console.log('\n  Change Detection Results:');
        console.log(`    Added: ${diff.added.length} chunks`);
        diff.added.forEach(c => console.log(`      + ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        console.log(`    Modified: ${diff.modified.length} chunks`);
        diff.modified.forEach(c => console.log(`      ~ ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        console.log(`    Unchanged: ${diff.unchanged.length} chunks`);
        diff.unchanged.forEach(c => console.log(`      = ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        console.log(`    Removed: ${diff.removed.length} chunks`);
        diff.removed.forEach(c => console.log(`      - ${c.name || c.type} (${c.contentHash.substring(0, 8)})`));

        // Step 4: Only these chunks need re-embedding (sent to server)
        const chunksToEmbed = [...diff.added, ...diff.modified];
        console.log(`\n  Step 4: Chunks requiring re-embedding: ${chunksToEmbed.length}`);
        console.log('    (In real system: send these to server for embedding)');

        // Step 5: Update registry with new state
        console.log('\n  Step 5: Update registry');
        const changeDetails = dirtyQueue.getChangeDetails(dirtyFilePath);
        registry.updateFile(dirtyFilePath, newHashedChunks, changeDetails.newHash);
        console.log('    Registry updated with new file hash and chunk hashes');

        // Step 6: Clear file from dirty queue
        dirtyQueue.clearFile(dirtyFilePath);
        console.log('    Cleared from dirty queue');
    }

    // Mark sync complete
    dirtyQueue.clearAll();
    console.log('\n✅ Sync complete. Last sync:', dirtyQueue.lastSync);
    console.log('Final registry stats:', registry.getStats());

    // ============================================================
    // BONUS: Demonstrate unchanged file scenario
    // ============================================================
    console.log('\n' + '=' .repeat(60));
    console.log('BONUS: UNCHANGED FILE SCENARIO');
    console.log('=' .repeat(60));
    console.log('\nSimulating: User saves file without changes\n');

    // User saves file but content is identical
    const unchangedHash = hasher.hashFile(modifiedCode, filePath);
    const hasChanged = !registry.isIndexed(filePath, unchangedHash);

    console.log(`File hash: ${unchangedHash.substring(0, 16)}...`);
    console.log(`Is indexed with same content? ${registry.isIndexed(filePath, unchangedHash)}`);
    console.log(`File changed: ${hasChanged}`);

    if (!hasChanged) {
        console.log('\n✅ File unchanged - skip all processing (fast path)');
        console.log('   No AST parsing, no chunking, no hashing needed');
    }

    // ============================================================
    // SUMMARY: The Complete Flow
    // ============================================================
    console.log('\n' + '=' .repeat(60));
    console.log('SUMMARY: THE COMPLETE FLOW');
    console.log('=' .repeat(60));
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                    LAB 05 DEMONSTRATES                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  PHASE 1: Initial Indexing                                   │
│  ─────────────────────────                                   │
│  1. Hash file content (SHA-256)                              │
│  2. Parse AST → Create chunks (Tree-sitter)                  │
│  3. Hash each chunk (SHA-256)                                │
│  4. Save to registry (local storage)                         │
│                                                              │
│  PHASE 2: User Edits File                                    │
│  ────────────────────────                                    │
│  1. File watcher fires on save                               │
│  2. Compute new file hash                                    │
│  3. Compare with stored hash                                 │
│  4. If different → Mark as DIRTY                             │
│     (Do NOT re-chunk yet - wait for sync)                    │
│                                                              │
│  PHASE 3: Periodic Sync (Future Labs)                        │
│  ────────────────────────────────────                        │
│  1. Process dirty files                                      │
│  2. Re-chunk each dirty file                                 │
│  3. Hash new chunks                                          │
│  4. Compare chunk hashes → Find: added/modified/unchanged    │
│  5. Re-embed ONLY changed chunks                             │
│  6. Update registry + Clear dirty queue                      │
│                                                              │
│  KEY OPTIMIZATION                                            │
│  ────────────────                                            │
│  • File hash gate: Skip if file unchanged (~1ms check)       │
│  • Chunk comparison: Re-embed only what changed              │
│  • Result: 1000x cost reduction vs naive approach            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
`);
}

main().catch(console.error);
