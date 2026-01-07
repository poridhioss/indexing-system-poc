import * as parcelWatcher from '@parcel/watcher';
import * as fs from 'fs';
import * as path from 'path';
import { MerkleTreeBuilder } from './merkle-tree.js';

export interface WatcherOptions {
    watchPath?: string;
    ignored?: string[];
    extensions?: string[];
    onFileChanged?: (filePath: string, newRoot: string) => void;
    onReady?: () => void;
    onError?: (err: Error) => void;
}

export class MerkleWatcher {
    private watchPath: string;
    private ignored: string[];
    private extensions: string[];
    private subscription: parcelWatcher.AsyncSubscription | null = null;
    private merkleBuilder: MerkleTreeBuilder;

    private onFileChanged: (filePath: string, newRoot: string) => void;
    private onReady: () => void;
    private onError: (err: Error) => void;

    constructor(options: WatcherOptions = {}) {
        this.watchPath = options.watchPath || './test-project';
        this.ignored = options.ignored || [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.puku/**',
            '**/*.log',
        ];
        this.extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx'];

        this.onFileChanged = options.onFileChanged || this._defaultHandler;
        this.onReady = options.onReady || (() => {});
        this.onError = options.onError || ((err) => console.error('Watcher error:', err));

        this.merkleBuilder = new MerkleTreeBuilder();
    }

    private _defaultHandler(filePath: string, newRoot: string): void {
        console.log(`[MERKLE UPDATE] ${filePath}`);
        console.log(`               New root: ${newRoot.substring(0, 16)}...`);
    }

    private _shouldIgnore(filePath: string): boolean {
        const relativePath = path.relative(this.watchPath, filePath);

        for (const pattern of this.ignored) {
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

    private _shouldWatch(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.extensions.includes(ext);
    }

    /**
     * Build initial Merkle tree
     */
    async buildInitialTree(): Promise<string> {
        console.log(`Building initial Merkle tree for: ${this.watchPath}`);
        const tree = this.merkleBuilder.buildFromDirectory(this.watchPath, this.extensions);
        console.log(`Merkle root: ${tree.hash}`);
        console.log('\nTree structure:');
        this.merkleBuilder.printTree(tree);
        return tree.hash;
    }

    /**
     * Start watching for file changes
     */
    async start(): Promise<this> {
        // Build initial tree if not exists
        const state = this.merkleBuilder.loadMerkleState();
        if (!state) {
            await this.buildInitialTree();
        } else {
            console.log(`Loaded existing Merkle state. Root: ${state.root.substring(0, 16)}...`);
        }

        console.log(`\nWatching directory: ${this.watchPath}`);

        // Subscribe to file system events
        this.subscription = await parcelWatcher.subscribe(
            this.watchPath,
            (err: Error | null, events: parcelWatcher.Event[]) => {
                if (err) {
                    this.onError(err);
                    return;
                }

                for (const event of events) {
                    const filePath = event.path;

                    // Filter
                    if (!this._shouldWatch(filePath) || this._shouldIgnore(filePath)) {
                        continue;
                    }

                    if (event.type === 'create' || event.type === 'update') {
                        // File created or modified
                        console.log(`\n[${event.type.toUpperCase()}] ${filePath}`);

                        const oldRoot = this.getCurrentRoot();
                        const newRoot = this.merkleBuilder.updateFileHash(filePath);

                        // Only fire callback if root actually changed
                        if (newRoot && oldRoot !== newRoot) {
                            this.onFileChanged(filePath, newRoot);
                        }
                    } else if (event.type === 'delete') {
                        console.log(`\n[DELETE] ${filePath}`);

                        const oldRoot = this.getCurrentRoot();
                        const newRoot = this.merkleBuilder.deleteFile(filePath);

                        // Fire callback if deletion changed the tree
                        if (newRoot && oldRoot !== newRoot) {
                            this.onFileChanged(filePath, newRoot);
                        }
                    }
                }
            }
        );

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
            console.log('Watcher stopped');
        }
    }

    /**
     * Get current Merkle root
     */
    getCurrentRoot(): string | null {
        const state = this.merkleBuilder.loadMerkleState();
        return state ? state.root : null;
    }

    /**
     * Get dirty files queue
     */
    getDirtyFiles(): string[] {
        const queue = this.merkleBuilder.getDirtyQueue();
        return queue ? queue.dirtyFiles : [];
    }

    /**
     * Simulate server sync (clear dirty queue)
     */
    simulateSync(): void {
        const queue = this.merkleBuilder.getDirtyQueue();
        if (queue && queue.dirtyFiles.length > 0) {
            console.log('\n=== SIMULATING SERVER SYNC ===');
            console.log(`Syncing ${queue.dirtyFiles.length} dirty files:`);
            queue.dirtyFiles.forEach(f => console.log(`  - ${f}`));
            console.log('Server would now:');
            console.log('  1. Compare chunk hashes for these files');
            console.log('  2. Re-embed only changed chunks');
            console.log('  3. Update vector database');
            this.merkleBuilder.clearDirtyQueue();
            console.log('Dirty queue cleared.');
        } else {
            console.log('\nNo dirty files to sync.');
        }
    }
}
