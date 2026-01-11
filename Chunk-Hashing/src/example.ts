import * as fs from 'fs';
import * as path from 'path';
import { ChunkHasher } from './chunk-hasher';

async function main(): Promise<void> {
    // Project root is the test-project directory
    const projectRoot = path.resolve(__dirname, '../test-project');

    const hasher = new ChunkHasher(projectRoot, {
        maxChunkSize: 4000,
        minChunkSize: 50,
    });

    await hasher.initialize({
        javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
        python: require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    });

    const testFiles = ['src/user-service.js', 'src/validator.js', 'src/api.js'];

    console.log('\n=== Chunk Hashing Demo (Relative Paths) ===\n');
    console.log(`Project root: ${projectRoot}\n`);

    let totalChunks = 0;

    for (const relativePath of testFiles) {
        const absolutePath = path.join(projectRoot, relativePath);
        const code = fs.readFileSync(absolutePath, 'utf-8');

        // Can pass either absolute or relative path - will be converted internally
        const hashedChunks = hasher.hashFile(code, 'javascript', absolutePath);
        totalChunks += hashedChunks.length;

        console.log(`${relativePath} → ${hashedChunks.length} chunks`);
        hashedChunks.forEach((chunk) => {
            // chunk.reference.relativePath now contains relative path
            console.log(`  ${chunk.type} "${chunk.name}" @ ${chunk.reference.relativePath}:${chunk.reference.lineStart}-${chunk.reference.lineEnd} [${chunk.hash.substring(0, 12)}...]`);
        });
        console.log('');
    }

    console.log(`Total: ${testFiles.length} files, ${totalChunks} chunks`);

    // Demonstrate sync payload
    console.log('\n=== Example Sync Payload ===\n');
    const sampleFile = 'src/user-service.js';
    const sampleCode = fs.readFileSync(path.join(projectRoot, sampleFile), 'utf-8');
    const sampleChunks = hasher.hashFile(sampleCode, 'javascript', sampleFile);
    const payload = hasher.createSyncPayload(sampleChunks, sampleFile);

    console.log(`File: ${payload.relativePath}`);
    console.log(`Chunks: ${payload.chunks.length}`);
    payload.chunks.forEach((c, i) => {
        console.log(`  [${i}] ${c.type} "${c.name}" lines ${c.lines[0]}-${c.lines[1]} (${c.charCount} chars) hash: ${c.hash.substring(0, 12)}...`);
    });
}

main().catch(console.error);
