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

// Run directly if executed as main
if (require.main === module) {
    const watchPath = process.argv[2] || './test-project';

    // Create test directory if it doesn't exist
    if (!fs.existsSync(watchPath)) {
        fs.mkdirSync(watchPath, { recursive: true });
        console.log(`Created test directory: ${watchPath}\n`);
    }

    const watcher = new SimpleFileWatcher({
        watchPath: watchPath,
        onFileAdded: (filePath, hash) => {
            console.log(`[ADD]    ${filePath}`);
            console.log(`         Hash: ${hash ? hash.substring(0, 16) + '...' : 'N/A'}`);
        },
        onFileChanged: (filePath, hash) => {
            console.log(`[CHANGE] ${filePath}`);
            console.log(`         Hash: ${hash ? hash.substring(0, 16) + '...' : 'N/A'}`);
        },
        onFileDeleted: (filePath) => {
            console.log(`[DELETE] ${filePath}`);
        },
    });

    watcher.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        watcher.stop();
        process.exit(0);
    });

    console.log('\nPress Ctrl+C to stop watching.\n');
    console.log('Try creating/editing/deleting files in the test-project directory.');
    console.log('Example commands:');
    console.log('  echo "console.log(1)" > test-project/test.js');
    console.log('  echo "console.log(2)" >> test-project/test.js');
    console.log('  rm test-project/test.js');
    console.log('');
}
