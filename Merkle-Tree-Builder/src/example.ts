import { MerkleWatcher } from './watcher.js';
import * as path from 'path';

async function main() {
    console.log('=== Merkle Tree Builder Demo (Relative Paths) ===\n');

    // Use test-project relative to current working directory
    const projectRoot = path.resolve('./test-project');
    console.log(`Project root: ${projectRoot}\n`);

    const watcher = new MerkleWatcher({
        projectRoot: projectRoot,
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        onFileChanged: (relativePath, newRoot) => {
            // relativePath is now RELATIVE (e.g., "src/auth.ts")
            console.log(`\n✓ Merkle tree updated!`);
            console.log(`  File: ${relativePath}`);  // Shows relative path
            console.log(`  New root: ${newRoot.substring(0, 16)}...`);

            const dirtyFiles = watcher.getDirtyFiles();
            console.log(`\n  Dirty queue: ${dirtyFiles.length} file(s)`);
            // Dirty files are also relative paths
            dirtyFiles.forEach(f => console.log(`    - ${f}`));
        },
        onReady: () => {
            console.log('\n✓ Watcher ready. Monitoring for changes...');
            console.log('\nTry editing a file in test-project/ to see the Merkle tree update!');
            console.log('Press Ctrl+C to stop.\n');

            // Show the merkle state file location
            const state = watcher.getMerkleBuilder().loadMerkleState();
            if (state) {
                console.log('Current Merkle state:');
                console.log(`  Root: ${state.root.substring(0, 16)}...`);
                console.log(`  Files tracked: ${state.leaves.length}`);
                console.log('\nLeaves (relative paths):');
                state.leaves.forEach(leaf => {
                    console.log(`  ${leaf.relativePath} -> ${leaf.hash.substring(0, 8)}...`);
                });
            }
        },
    });

    // Build initial tree and start watching
    await watcher.start();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\nShutting down...');
        await watcher.stop();
        process.exit(0);
    });
}

main().catch(console.error);