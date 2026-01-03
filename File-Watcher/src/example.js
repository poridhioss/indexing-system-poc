const { SimpleFileWatcher } = require('./watcher');
const path = require('path');
const fs = require('fs');

/**
 * File Watcher Example
 *
 * Demonstrates:
 * 1. Setting up a file watcher with chokidar
 * 2. Detecting file add/change/delete events
 * 3. Computing file hashes for change detection
 *
 * This is the first step in the indexing pipeline:
 * File Watcher → Hash → Mark Dirty → Periodic Sync → Re-chunk → Re-embed
 */

// Create test directory
const testDir = path.join(__dirname, '../test-project');
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
    console.log(`Created test directory: ${testDir}\n`);
}

console.log('='.repeat(60));
console.log('FILE WATCHER DEMONSTRATION');
console.log('='.repeat(60));
console.log('\nThis demo shows how file watching works in a code indexing system.');
console.log('The watcher detects file changes and computes content hashes.\n');

// Track events for demonstration
const events = [];

// Create watcher with custom handlers
const watcher = new SimpleFileWatcher({
    watchPath: testDir,
    extensions: ['.js', '.ts', '.py', '.java', '.go'],
    onFileAdded: (filePath, hash) => {
        const event = {
            type: 'ADD',
            file: path.basename(filePath),
            hash: hash ? hash.substring(0, 16) + '...' : 'N/A',
            time: new Date().toISOString(),
        };
        events.push(event);
        console.log(`[ADD]    ${event.file}`);
        console.log(`         Hash: ${event.hash}`);
        console.log(`         → In real system: Register in hash registry`);
        console.log('');
    },
    onFileChanged: (filePath, hash) => {
        const event = {
            type: 'CHANGE',
            file: path.basename(filePath),
            hash: hash ? hash.substring(0, 16) + '...' : 'N/A',
            time: new Date().toISOString(),
        };
        events.push(event);
        console.log(`[CHANGE] ${event.file}`);
        console.log(`         New Hash: ${event.hash}`);
        console.log(`         → In real system: Compare hash, mark dirty if changed`);
        console.log('');
    },
    onFileDeleted: (filePath) => {
        const event = {
            type: 'DELETE',
            file: path.basename(filePath),
            time: new Date().toISOString(),
        };
        events.push(event);
        console.log(`[DELETE] ${event.file}`);
        console.log(`         → In real system: Remove from registry, update Merkle tree`);
        console.log('');
    },
    onReady: () => {
        console.log('-'.repeat(60));
        console.log('Watcher is ready! Now demonstrating file operations...\n');

        // Automatically demonstrate file operations
        setTimeout(() => demonstrateFileOperations(), 500);
    },
});

// Start watching
watcher.start();

/**
 * Demonstrate file operations automatically
 */
async function demonstrateFileOperations() {
    const demoFile = path.join(testDir, 'demo.js');

    console.log('STEP 1: Creating a new file...');
    console.log('-'.repeat(40));
    fs.writeFileSync(demoFile, `
// Demo file for file watcher
function hello() {
    console.log("Hello, World!");
}

module.exports = { hello };
`.trim());

    // Wait for event to be processed
    await sleep(300);

    console.log('\nSTEP 2: Modifying the file...');
    console.log('-'.repeat(40));
    fs.writeFileSync(demoFile, `
// Demo file for file watcher (modified)
function hello(name) {
    console.log("Hello, " + name + "!");
}

function goodbye(name) {
    console.log("Goodbye, " + name + "!");
}

module.exports = { hello, goodbye };
`.trim());

    await sleep(300);

    console.log('\nSTEP 3: Deleting the file...');
    console.log('-'.repeat(40));
    fs.unlinkSync(demoFile);

    await sleep(300);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('DEMONSTRATION COMPLETE');
    console.log('='.repeat(60));
    console.log('\nEvent Summary:');
    events.forEach((e, i) => {
        console.log(`  ${i + 1}. [${e.type}] ${e.file} ${e.hash ? `(${e.hash})` : ''}`);
    });

    console.log('\n' + '-'.repeat(60));
    console.log('HOW THIS FITS INTO THE INDEXING PIPELINE');
    console.log('-'.repeat(60));
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                    FILE WATCHER ROLE                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. FILE WATCHER (This Lab)                                  │
│     • Detect file changes using OS-level APIs (chokidar)    │
│     • Fire events: add, change, delete                      │
│     • Compute file hash (SHA-256)                           │
│                                                              │
│  2. DIRTY QUEUE (Lab 06)                                     │
│     • Compare new hash with stored hash                     │
│     • If different → Mark file as DIRTY                     │
│     • Queue for next sync cycle                             │
│                                                              │
│  3. PERIODIC SYNC (Future Labs)                              │
│     • Every ~10 minutes                                      │
│     • Process dirty files                                    │
│     • Re-chunk changed files                                │
│     • Re-embed only changed chunks                          │
│     • Update Merkle tree                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
`);

    console.log('Watched files at end:', watcher.getWatchedFiles().length);

    // Stop watcher
    watcher.stop();
    process.exit(0);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    watcher.stop();
    process.exit(0);
});
