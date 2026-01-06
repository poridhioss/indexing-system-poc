import { MerkleWatcher } from './watcher.js';

async function main() {
    console.log('=== Merkle Tree Builder Demo ===\n');

    const watcher = new MerkleWatcher({
        watchPath: './test-project',
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        onFileChanged: (filePath, newRoot) => {
            console.log(`\n✓ Merkle tree updated!`);
            console.log(`  File: ${filePath}`);
            console.log(`  New root: ${newRoot.substring(0, 16)}...`);

            const dirtyFiles = watcher.getDirtyFiles();
            console.log(`\n  Dirty queue: ${dirtyFiles.length} file(s)`);
        },
        onReady: () => {
            console.log('\n✓ Watcher ready. Monitoring for changes...');
            console.log('\nTry editing a file in test-project/ to see the Merkle tree update!');
            console.log('Press Ctrl+C to stop.\n');
        },
    });

    // Build initial tree and start watching
    await watcher.start();

    // Simulate periodic sync every 30 seconds
    setInterval(() => {
        watcher.simulateSync();
    }, 30000);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\nShutting down...');
        await watcher.stop();
        process.exit(0);
    });
}

main().catch(console.error);
