import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import * as parcelWatcher from '@parcel/watcher';

/**
 * Options for SimpleFileWatcher
 */
export interface FileWatcherOptions {
    watchPath?: string;
    ignored?: string[];
    extensions?: string[];
    onFileAdded?: (filePath: string, hash: string | null) => void;
    onFileChanged?: (filePath: string, hash: string | null) => void;
    onFileDeleted?: (filePath: string, hash: string | null) => void;
    onReady?: () => void;
    onError?: (err: Error) => void;
}

/**
 * SimpleFileWatcher - Demonstrates basic file watching for code indexing
 *
 * Key concepts:
 * 1. Watch for file changes using OS-level APIs (via @parcel/watcher)
 * 2. Fire events on: add, change, unlink (delete)
 * 3. Ignore: node_modules, .git, and other non-source files
 */
export class SimpleFileWatcher {
    private watchPath: string;
    private ignored: string[];
    private extensions: string[];
    private subscription: parcelWatcher.AsyncSubscription | null = null;
    private trackedFiles = new Set<string>();

    // Callbacks
    public onFileAdded: (filePath: string, hash: string | null) => void;
    public onFileChanged: (filePath: string, hash: string | null) => void;
    public onFileDeleted: (filePath: string, hash: string | null) => void;
    public onReady: () => void;
    public onError: (err: Error) => void;

    constructor(options: FileWatcherOptions = {}) {
        this.watchPath = options.watchPath || '.';
        this.ignored = options.ignored || [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/*.log',
        ];
        this.extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs'];

        // Callbacks
        this.onFileAdded = options.onFileAdded || this._defaultHandler('added');
        this.onFileChanged = options.onFileChanged || this._defaultHandler('changed');
        this.onFileDeleted = options.onFileDeleted || this._defaultHandler('deleted');
        this.onReady = options.onReady || (() => {});
        this.onError = options.onError || ((err: Error) => console.error('Watcher error:', err));
    }

    /**
     * Default handler that logs events
     */
    private _defaultHandler(eventType: string): (filePath: string, hash: string | null) => void {
        return (filePath: string) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] File ${eventType}: ${filePath}`);
        };
    }

    /**
     * Check if file should be watched based on extension
     */
    private _shouldWatch(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.extensions.includes(ext);
    }

    /**
     * Check if file should be ignored based on patterns
     */
    private _shouldIgnore(filePath: string): boolean {
        const relativePath = path.relative(this.watchPath, filePath);

        for (const pattern of this.ignored) {
            // Convert glob pattern to simple string matching
            const regexPattern = pattern
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*')
                .replace(/\//g, '[\\\\/]');

            const regex = new RegExp(regexPattern);
            if (regex.test(relativePath) || regex.test(filePath)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Compute SHA-256 hash of file content
     */
    private _hashFile(filePath: string): string | null {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return crypto.createHash('sha256').update(filePath + content).digest('hex');
        } catch (err) {
            return null;
        }
    }

    /**
     * Perform initial scan of directory
     */
    private async _initialScan(): Promise<void> {
        const scanDir = (dir: string) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    if (this._shouldIgnore(fullPath)) {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        scanDir(fullPath);
                    } else if (entry.isFile() && this._shouldWatch(fullPath)) {
                        this.trackedFiles.add(fullPath);
                        const hash = this._hashFile(fullPath);
                        this.onFileAdded(fullPath, hash);
                    }
                }
            } catch (err) {
                // Ignore directories we can't read
            }
        };

        scanDir(this.watchPath);
    }

    /**
     * Start watching for file changes
     */
    async start(): Promise<this> {
        console.log(`Starting file watcher on: ${path.resolve(this.watchPath)}`);
        console.log(`Watching extensions: ${this.extensions.join(', ')}`);
        console.log(`Ignoring: ${this.ignored.join(', ')}`);
        console.log('');

        // Perform initial scan
        await this._initialScan();

        // Start watching for changes
        this.subscription = await parcelWatcher.subscribe(
            this.watchPath,
            (err: Error | null, events: parcelWatcher.Event[]) => {
                if (err) {
                    this.onError(err);
                    return;
                }

                for (const event of events) {
                    const filePath = event.path;

                    // Skip if should be ignored
                    if (this._shouldIgnore(filePath)) {
                        continue;
                    }

                    // Skip if not a watched extension
                    if (!this._shouldWatch(filePath)) {
                        continue;
                    }

                    // Handle different event types
                    if (event.type === 'create') {
                        if (!this.trackedFiles.has(filePath)) {
                            this.trackedFiles.add(filePath);
                            const hash = this._hashFile(filePath);
                            this.onFileAdded(filePath, hash);
                        }
                    } else if (event.type === 'update') {
                        const hash = this._hashFile(filePath);
                        this.onFileChanged(filePath, hash);
                    } else if (event.type === 'delete') {
                        this.trackedFiles.delete(filePath);
                        this.onFileDeleted(filePath, null);
                    }
                }
            }
        );

        console.log('Initial scan complete. Watching for changes...\n');
        this.onReady();

        return this;
    }

    /**
     * Stop watching
     */
    async stop(): Promise<void> {
        if (this.subscription) {
            await this.subscription.unsubscribe();
            this.subscription = null;
            console.log('File watcher stopped.');
        }
    }

    /**
     * Get list of watched files
     */
    getWatchedFiles(): string[] {
        return Array.from(this.trackedFiles);
    }
}

// Run directly if executed as main
const isMainModule = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
                     (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (isMainModule) {
    (async () => {
        const watchPath = process.argv[2] || './test-project';

        // Create test directory if it doesn't exist
        if (!fs.existsSync(watchPath)) {
            fs.mkdirSync(watchPath, { recursive: true });
            console.log(`Created test directory: ${watchPath}\n`);
        }

        const watcher = new SimpleFileWatcher({
            watchPath: watchPath,
            onFileAdded: (filePath: string, hash: string | null) => {
                console.log(`[ADD]    ${filePath}`);
                console.log(`         Hash: ${hash ? hash.substring(0, 16) + '...' : 'N/A'}`);
            },
            onFileChanged: (filePath: string, hash: string | null) => {
                console.log(`[CHANGE] ${filePath}`);
                console.log(`         Hash: ${hash ? hash.substring(0, 16) + '...' : 'N/A'}`);
            },
            onFileDeleted: (filePath: string) => {
                console.log(`[DELETE] ${filePath}`);
            },
        });

        await watcher.start();

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\nShutting down...');
            await watcher.stop();
            process.exit(0);
        });

        console.log('\nPress Ctrl+C to stop watching.\n');
        console.log('Try creating/editing/deleting files in the test-project directory.');
        console.log('Example commands:');
        console.log('  echo "console.log(1)" > test-project/test.js');
        console.log('  echo "console.log(2)" >> test-project/test.js');
        console.log('  rm test-project/test.js');
        console.log('');
    })();
}
