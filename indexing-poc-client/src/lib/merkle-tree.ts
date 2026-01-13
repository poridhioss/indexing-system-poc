import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface MerkleNode {
    hash: string;
    left?: MerkleNode;
    right?: MerkleNode;
    relativePath?: string; // Only for leaf nodes - RELATIVE to project root
}

export interface MerkleState {
    root: string;
    leaves: { relativePath: string; hash: string }[];  // RELATIVE paths
    timestamp: string;
}

export interface DirtyQueue {
    lastSync: string;
    dirtyFiles: string[];  // RELATIVE paths
}

export class MerkleTreeBuilder {
    private projectRoot: string;
    private stateDir: string;
    private merkleStatePath: string;
    private dirtyQueuePath: string;

    /**
     * Create a new MerkleTreeBuilder
     * @param projectRoot - The root directory of the project (used to compute relative paths)
     * @param stateDir - Directory to store state files (default: .puku inside projectRoot)
     */
    constructor(projectRoot: string, stateDir?: string) {
        // Normalize and resolve projectRoot to absolute path
        this.projectRoot = path.resolve(projectRoot);

        // State directory defaults to .puku inside project root
        this.stateDir = stateDir ?? path.join(this.projectRoot, '.puku');
        this.merkleStatePath = path.join(this.stateDir, 'merkle-state.json');
        this.dirtyQueuePath = path.join(this.stateDir, 'dirty-queue.json');

        // Create state directory if it doesn't exist
        if (!fs.existsSync(this.stateDir)) {
            fs.mkdirSync(this.stateDir, { recursive: true });
        }
    }

    /**
     * Convert absolute path to relative path (relative to projectRoot)
     * Normalizes to forward slashes for cross-platform consistency
     */
    toRelativePath(absolutePath: string): string {
        const relative = path.relative(this.projectRoot, absolutePath);
        // Normalize to forward slashes for consistency across platforms
        return relative.split(path.sep).join('/');
    }

    /**
     * Convert relative path to absolute path
     */
    toAbsolutePath(relativePath: string): string {
        // Handle both forward slashes and backslashes
        const normalized = relativePath.split('/').join(path.sep);
        return path.join(this.projectRoot, normalized);
    }

    /**
     * Compute SHA-256 hash of RELATIVE path + content
     * Using relative path ensures same hash across different machines
     */
    hashFile(relativePath: string): string | null {
        try {
            const absolutePath = this.toAbsolutePath(relativePath);
            const content = fs.readFileSync(absolutePath, 'utf8');
            // Hash using RELATIVE path (not absolute) for cross-device consistency
            return crypto
                .createHash('sha256')
                .update(relativePath + content)
                .digest('hex');
        } catch (err) {
            console.error(`Failed to hash file ${relativePath}:`, err);
            return null;
        }
    }

    /**
     * Hash two child hashes together to create parent hash
     */
    private hashPair(left: string, right: string): string {
        return crypto
            .createHash('sha256')
            .update(left + right)
            .digest('hex');
    }

    /**
     * Build Merkle tree from leaf hashes
     */
    buildTree(leaves: { relativePath: string; hash: string }[]): MerkleNode {
        if (leaves.length === 0) {
            throw new Error('Cannot build Merkle tree with no leaves');
        }

        // Create leaf nodes
        let nodes: MerkleNode[] = leaves.map(leaf => ({
            hash: leaf.hash,
            relativePath: leaf.relativePath,
        }));

        // Build tree bottom-up
        while (nodes.length > 1) {
            const nextLevel: MerkleNode[] = [];

            for (let i = 0; i < nodes.length; i += 2) {
                const left = nodes[i];
                const right = nodes[i + 1];

                if (right) {
                    // Pair exists, hash them together
                    const parentHash = this.hashPair(left.hash, right.hash);
                    nextLevel.push({
                        hash: parentHash,
                        left,
                        right,
                    });
                } else {
                    // Odd node, promote it up (or duplicate it)
                    nextLevel.push(left);
                }
            }

            nodes = nextLevel;
        }

        return nodes[0];
    }

    /**
     * Scan directory and build Merkle tree from all files
     * @param extensions - File extensions to include (default: common code files)
     */
    buildFromDirectory(extensions: string[] = ['.js', '.ts', '.tsx', '.jsx']): MerkleNode {
        const leaves: { relativePath: string; hash: string }[] = [];

        const scanDir = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                // Skip node_modules, .git, etc.
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.puku') {
                    continue;
                }

                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (extensions.includes(ext)) {
                        // Convert to relative path
                        const relativePath = this.toRelativePath(fullPath);
                        const hash = this.hashFile(relativePath);
                        if (hash) {
                            leaves.push({ relativePath, hash });
                        }
                    }
                }
            }
        };

        scanDir(this.projectRoot);

        // Sort leaves by relative path for consistency
        leaves.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        const tree = this.buildTree(leaves);

        // Save state
        this.saveMerkleState({
            root: tree.hash,
            leaves,
            timestamp: new Date().toISOString(),
        });

        return tree;
    }

    /**
     * Recompute Merkle root after file change
     * @param filePath - Can be absolute OR relative path
     */
    updateFileHash(filePath: string): string | null {
        // Load current state
        const state = this.loadMerkleState();
        if (!state) {
            console.error('No merkle state found. Run initial build first.');
            return null;
        }

        // Convert to relative path if absolute
        const relativePath = path.isAbsolute(filePath)
            ? this.toRelativePath(filePath)
            : filePath;

        // Compute new hash
        const newHash = this.hashFile(relativePath);
        if (!newHash) {
            return null;
        }

        // Update or add leaf
        const existingLeaf = state.leaves.find(l => l.relativePath === relativePath);
        if (existingLeaf) {
            // Check if hash actually changed
            if (existingLeaf.hash === newHash) {
                console.log(`File ${relativePath} unchanged (same hash)`);
                return state.root; // No change
            }
            existingLeaf.hash = newHash;
        } else {
            // New file
            state.leaves.push({ relativePath, hash: newHash });
            state.leaves.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        }

        // Rebuild tree
        const tree = this.buildTree(state.leaves);

        // Save updated state
        this.saveMerkleState({
            root: tree.hash,
            leaves: state.leaves,
            timestamp: new Date().toISOString(),
        });

        // Add to dirty queue (as relative path)
        this.addToDirtyQueue(relativePath);

        console.log(`Merkle root updated: ${state.root} -> ${tree.hash}`);
        return tree.hash;
    }

    /**
     * Remove file from tree and recompute Merkle root
     * @param filePath - Can be absolute OR relative path
     */
    deleteFile(filePath: string): string | null {
        // Load current state
        const state = this.loadMerkleState();
        if (!state) {
            console.error('No merkle state found. Run initial build first.');
            return null;
        }

        // Convert to relative path if absolute
        const relativePath = path.isAbsolute(filePath)
            ? this.toRelativePath(filePath)
            : filePath;

        // Find the file in leaves
        const leafIndex = state.leaves.findIndex(l => l.relativePath === relativePath);
        if (leafIndex === -1) {
            console.log(`File ${relativePath} not found in tree`);
            return state.root; // File wasn't tracked, no change
        }

        // Remove the leaf
        state.leaves.splice(leafIndex, 1);

        // If no leaves left, return empty string
        if (state.leaves.length === 0) {
            console.log('No files left in tree');
            this.saveMerkleState({
                root: '',
                leaves: [],
                timestamp: new Date().toISOString(),
            });
            this.addToDirtyQueue(relativePath);
            return '';
        }

        // Rebuild tree with remaining leaves
        const tree = this.buildTree(state.leaves);

        // Save updated state
        this.saveMerkleState({
            root: tree.hash,
            leaves: state.leaves,
            timestamp: new Date().toISOString(),
        });

        // Add to dirty queue (as relative path)
        this.addToDirtyQueue(relativePath);

        console.log(`File deleted. Merkle root updated: ${state.root} -> ${tree.hash}`);
        return tree.hash;
    }

    /**
     * Save Merkle state to disk
     */
    saveMerkleState(state: MerkleState): void {
        fs.writeFileSync(this.merkleStatePath, JSON.stringify(state, null, 2));
    }

    /**
     * Load Merkle state from disk
     */
    loadMerkleState(): MerkleState | null {
        try {
            if (!fs.existsSync(this.merkleStatePath)) {
                return null;
            }
            const data = fs.readFileSync(this.merkleStatePath, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Failed to load merkle state:', err);
            return null;
        }
    }

    /**
     * Add file to dirty queue (stores relative path)
     * @param filePath - Can be absolute OR relative path
     */
    addToDirtyQueue(filePath: string): void {
        // Convert to relative path if absolute
        const relativePath = path.isAbsolute(filePath)
            ? this.toRelativePath(filePath)
            : filePath;

        let queue: DirtyQueue;

        try {
            if (fs.existsSync(this.dirtyQueuePath)) {
                const data = fs.readFileSync(this.dirtyQueuePath, 'utf8');
                queue = JSON.parse(data);
            } else {
                queue = {
                    lastSync: new Date().toISOString(),
                    dirtyFiles: [],
                };
            }
        } catch (err) {
            queue = {
                lastSync: new Date().toISOString(),
                dirtyFiles: [],
            };
        }

        // Add to queue if not already present
        if (!queue.dirtyFiles.includes(relativePath)) {
            queue.dirtyFiles.push(relativePath);
        }

        fs.writeFileSync(this.dirtyQueuePath, JSON.stringify(queue, null, 2));
    }

    /**
     * Get dirty queue (contains relative paths)
     */
    getDirtyQueue(): DirtyQueue | null {
        try {
            if (!fs.existsSync(this.dirtyQueuePath)) {
                return null;
            }
            const data = fs.readFileSync(this.dirtyQueuePath, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Failed to load dirty queue:', err);
            return null;
        }
    }

    /**
     * Clear dirty queue (after sync)
     */
    clearDirtyQueue(): void {
        const queue: DirtyQueue = {
            lastSync: new Date().toISOString(),
            dirtyFiles: [],
        };
        fs.writeFileSync(this.dirtyQueuePath, JSON.stringify(queue, null, 2));
    }

    /**
     * Get the project root path
     */
    getProjectRoot(): string {
        return this.projectRoot;
    }

    /**
     * Print tree structure (for debugging)
     */
    printTree(node: MerkleNode, depth: number = 0): void {
        const indent = '  '.repeat(depth);
        const shortHash = node.hash.substring(0, 8);

        if (node.relativePath) {
            console.log(`${indent}[LEAF] ${shortHash} - ${node.relativePath}`);
        } else {
            console.log(`${indent}[NODE] ${shortHash}`);
            if (node.left) this.printTree(node.left, depth + 1);
            if (node.right) this.printTree(node.right, depth + 1);
        }
    }
}
