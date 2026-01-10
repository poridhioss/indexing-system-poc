import * as fs from 'fs';
import * as path from 'path';
import { ChunkHasher } from './chunk-hasher';

async function main(): Promise<void> {
    const hasher = new ChunkHasher({
        maxChunkSize: 4000,
        minChunkSize: 50,
    });

    await hasher.initialize({
        javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
        python: require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    });

    const testProjectDir = path.resolve(__dirname, '../test-project/src');
    const testFiles = ['user-service.js', 'validator.js', 'api.js'];

    console.log('\n=== Chunk Hashing Demo ===\n');

    let totalChunks = 0;

    for (const fileName of testFiles) {
        const filePath = path.join(testProjectDir, fileName);
        const code = fs.readFileSync(filePath, 'utf-8');

        const hashedChunks = hasher.hashFile(code, 'javascript', filePath);
        totalChunks += hashedChunks.length;

        console.log(`${fileName} → ${hashedChunks.length} chunks`);
        hashedChunks.forEach((chunk) => {
            console.log(`  ${chunk.type} "${chunk.name}" [${chunk.hash.substring(0, 12)}...]`);
        });
    }

    console.log(`\nTotal: ${testFiles.length} files, ${totalChunks} chunks`);
}

main().catch(console.error);