import * as path from 'path';
import { ChunkHasher } from './chunk-hasher';
import { HashedChunk, FileSyncPayload } from './hashed-chunk';

async function main(): Promise<void> {
    // Initialize hasher with language grammars
    const hasher = new ChunkHasher({
        maxChunkSize: 4000,
        minChunkSize: 50,
    });

    await hasher.initialize({
        javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
        python: require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    });

    // Sample JavaScript code
    const jsCode = `
/**
 * User management module
 */
import { db } from './database';

const MAX_RETRIES = 3;

/**
 * Fetch a user by ID
 * @param {string} id - User ID
 * @returns {Promise<User>}
 */
async function getUser(id) {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await db.users.findById(id);
        } catch (err) {
            if (i === MAX_RETRIES - 1) throw err;
        }
    }
}

/**
 * User service class
 */
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

    async delete(id) {
        return await this.db.users.remove(id);
    }
}

// Helper function
const validateEmail = (email) => {
    return email.includes('@') && email.includes('.');
};

export { getUser, UserService, validateEmail };
    `.trim();

    // Simulate a file path (in real usage, this would be the actual file path)
    const jsFilePath = path.resolve('/project/src/user-service.js');

    console.log('=== Chunk Hashing Demo ===\n');
    console.log('This demonstrates the two-phase sync protocol:\n');
    console.log('Phase 2: Compute hashes locally, send ONLY metadata to server');
    console.log('Phase 3: Server requests specific chunks by hash, client sends code\n');
    console.log('─'.repeat(60));

    // Hash the file into chunks
    console.log('\n📁 Processing file:', jsFilePath);
    console.log('\n--- Hashed Chunks (no code stored!) ---\n');

    const hashedChunks = hasher.hashFile(jsCode, 'javascript', jsFilePath);

    hashedChunks.forEach((chunk, i) => {
        console.log(`Chunk ${i + 1}:`);
        console.log(`  Type: ${chunk.type}`);
        console.log(`  Name: ${chunk.name ?? '(none)'}`);
        console.log(`  Hash: ${chunk.hash.substring(0, 16)}...`);
        console.log(`  Lines: ${chunk.reference.lineStart}-${chunk.reference.lineEnd}`);
        console.log(`  Size: ${chunk.charCount} chars`);
        if (Object.keys(chunk.metadata).length > 0) {
            console.log(`  Metadata:`, chunk.metadata);
        }
        console.log();
    });

    // Create sync payload (what would be sent to server in Phase 2)
    console.log('─'.repeat(60));
    console.log('\n📤 Phase 2 Payload (sent to server):\n');

    const syncPayload = hasher.createSyncPayload(hashedChunks, jsFilePath);

    console.log('FileSyncPayload:');
    console.log(`  filePath: ${syncPayload.filePath}`);
    console.log(`  chunks: [`);
    syncPayload.chunks.forEach((chunk, i) => {
        console.log(`    ${i + 1}. { hash: "${chunk.hash.substring(0, 16)}...", type: "${chunk.type}", name: "${chunk.name}", lines: [${chunk.lines.join(', ')}] }`);
    });
    console.log(`  ]`);

    console.log('\n⚡ Notice: NO actual code in the payload!');
    console.log('   Server will check these hashes against its cache.');
    console.log('   Only new/changed chunks will be requested in Phase 3.\n');

    // Demonstrate Phase 3 - reading code for specific chunks
    console.log('─'.repeat(60));
    console.log('\n📥 Phase 3 Simulation:\n');
    console.log('Server responds: "Need code for chunk with hash starting with:', hashedChunks[1]?.hash.substring(0, 16) + '..."');
    console.log('\nClient reads from disk using reference:');
    console.log(`  File: ${hashedChunks[1]?.reference.filePath}`);
    console.log(`  Lines: ${hashedChunks[1]?.reference.lineStart}-${hashedChunks[1]?.reference.lineEnd}`);
    console.log(`  CharRange: ${hashedChunks[1]?.reference.charStart}-${hashedChunks[1]?.reference.charEnd}`);
    console.log('\nCode would be extracted from file and sent to server.');
    console.log('Server generates embedding, then DISCARDS the code.\n');

    // Show JSON representation
    console.log('─'.repeat(60));
    console.log('\n📋 Full Sync Payload (JSON):\n');
    console.log(JSON.stringify(syncPayload, null, 2));

    // Summary statistics
    console.log('\n─'.repeat(60));
    console.log('\n📊 Summary:\n');
    console.log(`  Total chunks: ${hashedChunks.length}`);
    console.log(`  Total size: ${hashedChunks.reduce((sum, c) => sum + c.charCount, 0)} chars`);
    console.log(`  Payload size: ~${JSON.stringify(syncPayload).length} bytes (hashes only)`);
    console.log(`  Code size: ~${jsCode.length} bytes (NOT sent unless requested)`);
    console.log(`  Savings: ${((1 - JSON.stringify(syncPayload).length / jsCode.length) * 100).toFixed(1)}% less data in Phase 2`);
}

main().catch(console.error);
