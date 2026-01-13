import * as parcelWatcher from '@parcel/watcher';
import * as path from 'path';
import { MerkleTreeBuilder } from './merkle-tree';

export interface WatcherOptions {
    /**
     * The root directory of the project to watch
     * This is used as the base for all relative paths
     */
    projectRoot: string;
    ignored?: string[];
    extensions?: string[];
    /**
     * Callback when a file changes
     * @param relativePath - The RELATIVE path of the changed file
     * @param newRoot - The new Merkle root hash
     */
    onFileChanged?: (relativePath: string, newRoot: string) => void;
    onReady?: () => void;
    onError?: (err: Error) => void;
}

export class MerkleWatcher {
    private projectRoot: string;
    private ignored: string[];
    private extensions: string[];
    private subscription: parcelWatcher.AsyncSubscription | null = null;
    private merkleBuilder: MerkleTreeBuilder;

    private onFileChanged: (relativePath: string, newRoot: string) => void;
    private onReady: () => void;
    private onError: (err: Error) => void;

    constructor(options: WatcherOptions) {
        // Resolve projectRoot to absolute path
        this.projectRoot = path.resolve(options.projectRoot);

        this.ignored = options.ignored || [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.puku/**',
            '**/*.log',
        ];
        this.extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx'];

        this.onFileChanged = options.onFileChanged || this._defaultHandler.bind(this);
        this.onReady = options.onReady || (() => {});
        this.onError = options.onError || ((err) => console.error('Watcher error:', err));

        // Create MerkleTreeBuilder with projectRoot
        this.merkleBuilder = new MerkleTreeBuilder(this.projectRoot);
    }

    private _defaultHandler(relativePath: string, newRoot: string): void {
        console.log(`[MERKLE UPDATE] ${relativePath}`);
        console.log(`               New root: ${newRoot.substring(0, 16)}...`);
    }

    /**
     * Convert absolute path to relative path
     * Normalizes to forward slashes for cross-platform consistency
     */
    private _toRelativePath(absolutePath: string): string {
        const relative = path.relative(this.projectRoot, absolutePath);
        // Normalize to forward slashes for consistency
        return relative.split(path.sep).join('/');
    }

    private _shouldIgnore(filePath: string): boolean {
        // Use relative path for pattern matching
        const relativePath = path.isAbsolute(filePath)
            ? this._toRelativePath(filePath)
            : filePath;

        for (const pattern of this.ignored) {
            const regexPattern = pattern
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*')
                .replace(/\//g, '[\\\\/]');

            const regex = new RegExp(regexPattern);
            if (regex.test(relativePath)) {
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
        console.log(`Building initial Merkle tree for: ${this.projectRoot}`);
        const tree = this.merkleBuilder.buildFromDirectory(this.extensions);
        console.log(`Merkle root: ${tree.hash}`);
        console.log('\nTree structure:');
        this.merkleBuilder.printTree(tree);
        return tree.hash;
    }

    /**
     * Start watching for file changes
     *
     * NOTE: @parcel/watcher provides ABSOLUTE paths in events.
     * We convert them to relative paths before passing to callbacks.
     */
    async start(): Promise<this> {
        // Build initial tree if not exists
        const state = this.merkleBuilder.loadMerkleState();
        if (!state) {
            await this.buildInitialTree();
        } else {
            console.log(`Loaded existing Merkle state. Root: ${state.root.substring(0, 16)}...`);
        }

        console.log(`\nWatching directory: ${this.projectRoot}`);

        // Subscribe to file system events
        // NOTE: parcelWatcher provides ABSOLUTE paths - we handle conversion internally
        this.subscription = await parcelWatcher.subscribe(
            this.projectRoot,
            (err: Error | null, events: parcelWatcher.Event[]) => {
                if (err) {
                    this.onError(err);
                    return;
                }

                for (const event of events) {
                    // parcelWatcher provides ABSOLUTE path
                    const absolutePath = event.path;

                    // Filter
                    if (!this._shouldWatch(absolutePath) || this._shouldIgnore(absolutePath)) {
                        continue;
                    }

                    // Convert to relative path for display and storage
                    const relativePath = this._toRelativePath(absolutePath);

                    if (event.type === 'create' || event.type === 'update') {
                        // File created or modified
                        console.log(`\n[${event.type.toUpperCase()}] ${relativePath}`);

                        const oldRoot = this.getCurrentRoot();
                        // Pass absolute path - MerkleTreeBuilder will convert internally
                        const newRoot = this.merkleBuilder.updateFileHash(absolutePath);

                        // Only fire callback if root actually changed
                        if (newRoot && oldRoot !== newRoot) {
                            // Pass RELATIVE path to callback
                            this.onFileChanged(relativePath, newRoot);
                        }
                    } else if (event.type === 'delete') {
                        console.log(`\n[DELETE] ${relativePath}`);

                        const oldRoot = this.getCurrentRoot();
                        // Pass absolute path - MerkleTreeBuilder will convert internally
                        const newRoot = this.merkleBuilder.deleteFile(absolutePath);

                        // Fire callback if deletion changed the tree
                        if (newRoot && oldRoot !== newRoot) {
                            // Pass RELATIVE path to callback
                            this.onFileChanged(relativePath, newRoot);
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
     * Get dirty files queue (contains RELATIVE paths)
     */
    getDirtyFiles(): string[] {
        const queue = this.merkleBuilder.getDirtyQueue();
        return queue ? queue.dirtyFiles : [];
    }

    /**
     * Get the project root path
     */
    getProjectRoot(): string {
        return this.projectRoot;
    }

    /**
     * Get the MerkleTreeBuilder instance
     */
    getMerkleBuilder(): MerkleTreeBuilder {
        return this.merkleBuilder;
    }
}
