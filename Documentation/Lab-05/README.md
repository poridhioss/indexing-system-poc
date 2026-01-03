# File Watcher Implementation

Before you can detect code changes for incremental re-indexing, you need a way to know when files change. This lab teaches you how to implement a file watcher using OS-level APIs that forms the foundation of the change detection pipeline.

When a user saves a file, the watcher fires an event. This triggers hash computation and determines whether the file needs to be re-indexed.

## Prerequisites

- Completed **AST-Based Semantic Code Chunking** lab
- Node.js 18+ installed
- Basic understanding of event-driven programming

## What You'll Learn

1. How file watching works at the OS level
2. Setting up chokidar for cross-platform file watching
3. Filtering watched files by extension
4. Computing content hashes on file changes
5. Handling file add, change, and delete events

## Part 1: Why File Watching?

### The Real-Time Detection Problem

In a code indexing system, you need to know when files change so you can:

1. **Update the hash registry** - Detect if content actually changed
2. **Mark files as dirty** - Queue for next sync cycle
3. **Trigger re-indexing** - Only for files that changed

Without a file watcher, you'd have to scan the entire codebase periodically, which is slow and inefficient.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         FILE WATCHER IN THE PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   User saves file                                                                │
│        │                                                                         │
│        ▼                                                                         │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│   │   OS-level  │────>│   Chokidar  │────>│  Compute    │────>│ Mark as     │   │
│   │   fs.watch  │     │   Event     │     │  File Hash  │     │   DIRTY     │   │
│   └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘   │
│                                                                      │          │
│                                                                      ▼          │
│                                                              ┌─────────────┐    │
│                                                              │ Dirty Queue │    │
│                                                              │ (Lab 06+)   │    │
│                                                              └─────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **fs.watch** | Node.js built-in file watcher (OS-level, but unreliable) |
| **chokidar** | Cross-platform wrapper with better reliability |
| **Debouncing** | Wait for writes to finish before firing event |
| **Filtering** | Only watch source files (`.js`, `.ts`, `.py`, etc.) |
| **Ignored paths** | Skip `node_modules`, `.git`, build directories |

## Part 2: Chokidar vs fs.watch

### Why Not Use fs.watch Directly?

Node.js provides `fs.watch()` for file watching, but it has issues:

| Issue | fs.watch | chokidar |
|-------|----------|----------|
| **macOS rename bug** | Fires duplicate events | Handles correctly |
| **Recursive watching** | Not on all platforms | Works everywhere |
| **File vs directory** | Confusing behavior | Consistent API |
| **Write stability** | No debouncing | Configurable |
| **Glob patterns** | Not supported | Full support |

### Chokidar Features

```javascript
const chokidar = require('chokidar');

chokidar.watch('./src', {
    ignored: ['**/node_modules/**', '**/.git/**'],
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
        stabilityThreshold: 100,  // Wait 100ms after last write
        pollInterval: 50,
    },
});
```

## Part 3: Project Setup

```bash
mkdir file-watcher
cd file-watcher
npm init -y
npm install chokidar
```

**Dependencies**:

| Package | Version | Purpose |
|---------|---------|---------|
| `chokidar` | ^5.0.0 | Cross-platform file watching |

Note: We use Node.js built-in `crypto` module for SHA-256 hashing.

## Part 4: Implementation

### Step 1: Simple File Watcher

Create `src/watcher.js`:

```javascript
const chokidar = require('chokidar');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

/**
 * SimpleFileWatcher - Demonstrates basic file watching for code indexing
 *
 * Key concepts:
 * 1. Watch for file changes using OS-level APIs (via chokidar)
 * 2. Fire events on: add, change, unlink (delete)
 * 3. Ignore: node_modules, .git, and other non-source files
 */
class SimpleFileWatcher {
    constructor(options = {}) {
        this.watchPath = options.watchPath || '.';
        this.ignored = options.ignored || [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/*.log',
        ];
        this.extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs'];
        this.watcher = null;

        // Callbacks
        this.onFileAdded = options.onFileAdded || this._defaultHandler('added');
        this.onFileChanged = options.onFileChanged || this._defaultHandler('changed');
        this.onFileDeleted = options.onFileDeleted || this._defaultHandler('deleted');
        this.onReady = options.onReady || (() => {});
        this.onError = options.onError || ((err) => console.error('Watcher error:', err));
    }

    /**
     * Default handler that logs events
     */
    _defaultHandler(eventType) {
        return (filePath) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] File ${eventType}: ${filePath}`);
        };
    }

    /**
     * Check if file should be watched based on extension
     */
    _shouldWatch(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.extensions.includes(ext);
    }

    /**
     * Compute SHA-256 hash of file content
     * Industry standard: SHA-256(file_path || file_content)
     */
    _hashFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return crypto.createHash('sha256').update(filePath + content).digest('hex');
        } catch (err) {
            return null;
        }
    }

    /**
     * Start watching for file changes
     */
    start() {
        console.log(`Starting file watcher on: ${path.resolve(this.watchPath)}`);
        console.log(`Watching extensions: ${this.extensions.join(', ')}`);
        console.log(`Ignoring: ${this.ignored.join(', ')}`);
        console.log('');

        this.watcher = chokidar.watch(this.watchPath, {
            ignored: this.ignored,
            persistent: true,
            ignoreInitial: false,  // Set to true to skip initial scan
            awaitWriteFinish: {
                stabilityThreshold: 100,  // Wait 100ms after last write
                pollInterval: 50,
            },
        });

        // File added
        this.watcher.on('add', (filePath) => {
            if (this._shouldWatch(filePath)) {
                const hash = this._hashFile(filePath);
                this.onFileAdded(filePath, hash);
            }
        });

        // File changed
        this.watcher.on('change', (filePath) => {
            if (this._shouldWatch(filePath)) {
                const hash = this._hashFile(filePath);
                this.onFileChanged(filePath, hash);
            }
        });

        // File deleted
        this.watcher.on('unlink', (filePath) => {
            if (this._shouldWatch(filePath)) {
                this.onFileDeleted(filePath, null);
            }
        });

        // Ready (initial scan complete)
        this.watcher.on('ready', () => {
            console.log('Initial scan complete. Watching for changes...\n');
            this.onReady();
        });

        // Error
        this.watcher.on('error', (err) => {
            this.onError(err);
        });

        return this;
    }

    /**
     * Stop watching
     */
    stop() {
        if (this.watcher) {
            this.watcher.close();
            console.log('File watcher stopped.');
        }
    }

    /**
     * Get list of watched files
     */
    getWatchedFiles() {
        if (!this.watcher) return [];
        const watched = this.watcher.getWatched();
        const files = [];
        for (const [dir, items] of Object.entries(watched)) {
            for (const item of items) {
                const fullPath = path.join(dir, item);
                if (this._shouldWatch(fullPath)) {
                    files.push(fullPath);
                }
            }
        }
        return files;
    }
}

module.exports = { SimpleFileWatcher };
```

### Step 2: Example Usage

Create `src/example.js`:

```javascript
const { SimpleFileWatcher } = require('./watcher');
const path = require('path');
const fs = require('fs');

// Create test directory
const testDir = path.join(__dirname, '../test-project');
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
}

console.log('FILE WATCHER DEMONSTRATION');
console.log('='.repeat(50));

// Create watcher with custom handlers
const watcher = new SimpleFileWatcher({
    watchPath: testDir,
    onFileAdded: (filePath, hash) => {
        console.log(`[ADD]    ${path.basename(filePath)}`);
        console.log(`         Hash: ${hash ? hash.substring(0, 16) + '...' : 'N/A'}`);
    },
    onFileChanged: (filePath, hash) => {
        console.log(`[CHANGE] ${path.basename(filePath)}`);
        console.log(`         Hash: ${hash ? hash.substring(0, 16) + '...' : 'N/A'}`);
    },
    onFileDeleted: (filePath) => {
        console.log(`[DELETE] ${path.basename(filePath)}`);
    },
    onReady: () => {
        // Demo: Create, modify, delete a file
        demonstrateFileOperations();
    },
});

watcher.start();

async function demonstrateFileOperations() {
    const demoFile = path.join(testDir, 'demo.js');

    console.log('\nStep 1: Creating file...');
    fs.writeFileSync(demoFile, 'function hello() { console.log("Hello!"); }');

    await sleep(200);

    console.log('\nStep 2: Modifying file...');
    fs.writeFileSync(demoFile, 'function hello(name) { console.log("Hello, " + name); }');

    await sleep(200);

    console.log('\nStep 3: Deleting file...');
    fs.unlinkSync(demoFile);

    await sleep(200);

    watcher.stop();
    process.exit(0);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

## Part 5: Running the Example

```bash
cd file-watcher
npm install
node src/example.js
```

**Expected Output**:

```
FILE WATCHER DEMONSTRATION
==================================================
Starting file watcher on: /path/to/file-watcher/test-project
Watching extensions: .js, .ts, .jsx, .tsx, .py, .java, .go, .rs
Ignoring: **/node_modules/**, **/.git/**, **/dist/**, **/build/**, **/*.log

Initial scan complete. Watching for changes...

Step 1: Creating file...
[ADD]    demo.js
         Hash: a7f3e2b1c4d5e6f7...

Step 2: Modifying file...
[CHANGE] demo.js
         Hash: 8b9c0d1e2f3a4b5c...

Step 3: Deleting file...
[DELETE] demo.js

File watcher stopped.
```

## Part 6: Manual Testing

You can also test manually by running the watcher in interactive mode:

```bash
node src/watcher.js ./test-project
```

Then in another terminal:

```bash
# Create a file
echo "console.log('test');" > test-project/test.js

# Modify the file
echo "console.log('modified');" >> test-project/test.js

# Delete the file
rm test-project/test.js
```

## Part 7: Key Implementation Details

### 1. Extension Filtering

Only watch source files to reduce noise:

```javascript
const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs'];

function shouldWatch(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return extensions.includes(ext);
}
```

### 2. Ignored Paths

Skip directories that don't contain source code:

```javascript
const ignored = [
    '**/node_modules/**',  // Dependencies
    '**/.git/**',          // Version control
    '**/dist/**',          // Build output
    '**/build/**',         // Build output
    '**/*.log',            // Log files
];
```

### 3. Write Stability

Wait for file writes to complete before firing events:

```javascript
awaitWriteFinish: {
    stabilityThreshold: 100,  // Wait 100ms after last write
    pollInterval: 50,         // Check every 50ms
}
```

### 4. Hash on Event

Compute hash immediately when event fires:

```javascript
this.watcher.on('change', (filePath) => {
    const hash = crypto
        .createHash('sha256')
        .update(filePath + content)  // Include path in hash
        .digest('hex');
    this.onFileChanged(filePath, hash);
});
```

## Summary

In this lab, you learned:

| Concept | Description |
|---------|-------------|
| **File Watching** | Using OS-level APIs to detect file changes |
| **Chokidar** | Cross-platform file watcher with reliability |
| **Event Types** | add, change, unlink (delete) |
| **Extension Filtering** | Only watch source files |
| **Hash on Event** | Compute content hash immediately |

### Key Takeaways

1. **File watcher is the first step** - Detects when user saves a file
2. **OS-level APIs are fast** - Events fire within milliseconds
3. **Chokidar handles edge cases** - Cross-platform reliability
4. **Hash immediately** - Compute hash when event fires, not later
5. **Filter early** - Only process source files

### How This Fits in the Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    INDEXING PIPELINE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Lab 05: FILE WATCHER (This Lab)                                │
│  ─────────────────────────────────                              │
│  • Detect file changes using chokidar                           │
│  • Filter by extension (.js, .ts, .py, etc.)                   │
│  • Compute SHA-256 hash on event                                │
│  • Fire callbacks for add/change/delete                         │
│                                                                  │
│                         │                                        │
│                         ▼                                        │
│                                                                  │
│  Lab 06: CHUNK HASHING (Next Lab)                               │
│  ─────────────────────────────────                              │
│  • Compare new hash with stored hash                            │
│  • If changed → Mark file as DIRTY                              │
│  • Parse AST → Create chunks → Hash chunks                      │
│  • Compare chunk hashes → Find changed chunks                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## What's Next

In upcoming labs, you'll use the file watcher to:

- **Lab 06: Chunk Hashing** - Hash file content, detect changes, and compare chunk hashes
- **Lab 07: Merkle Tree** - Build file-level Merkle trees using SHA-256 hashes
- **Lab 08: Client-Server Sync** - Sync Merkle trees between client and server
- **Lab 09: Selective Re-indexing** - Only re-embed chunks that actually changed
