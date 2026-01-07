import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface MerkleNode {
    hash: string;
    left?: MerkleNode;
    right?: MerkleNode;
    filePath?: string; // Only for leaf nodes
}

export interface MerkleState {
    root: string;
    leaves: { filePath: string; hash: string }[];
    timestamp: string;
}

export interface DirtyQueue {
    lastSync: string;
    dirtyFiles: string[];
}

export class MerkleTreeBuilder {
    private stateDir: string;
    private merkleStatePath: string;
    private dirtyQueuePath: string;

    constructor(stateDir: string = '.puku') {
        this.stateDir = stateDir;
        this.merkleStatePath = path.join(stateDir, 'merkle-state.json');
        this.dirtyQueuePath = path.join(stateDir, 'dirty-queue.json');

        // Create state directory if it doesn't exist
        if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
        }
    }

    /**
     * Compute SHA-256 hash of file path + content
     */
    hashFile(filePath: string): string | null {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return crypto
                .createHash('sha256')
                .update(filePath + content)
                .digest('hex');
        } catch (err) {
            console.error(`Failed to hash file ${filePath}:`, err);
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
    buildTree(leaves: { filePath: string; hash: string }[]): MerkleNode {
        if (leaves.length === 0) {
            throw new Error('Cannot build Merkle tree with no leaves');
        }

        // Create leaf nodes
        let nodes: MerkleNode[] = leaves.map(leaf => ({
            hash: leaf.hash,
            filePath: leaf.filePath,
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
     */
    buildFromDirectory(dirPath: string, extensions: string[] = ['.js', '.ts', '.tsx', '.jsx']): MerkleNode {
        const leaves: { filePath: string; hash: string }[] = [];

        const scanDir = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.resolve(path.join(dir, entry.name));

                // Skip node_modules, .git, etc.
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.puku') {
                    continue;
                }

                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (extensions.includes(ext)) {
                        const hash = this.hashFile(fullPath);
                        if (hash) {
                            // Store absolute path directly
                            leaves.push({ filePath: fullPath, hash });
                        }
                    }
                }
            }
        };

        scanDir(dirPath);

        // Sort leaves by file path for consistency
        leaves.sort((a, b) => a.filePath.localeCompare(b.filePath));

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
     */
    updateFileHash(filePath: string): string | null {
        // Load current state
        const state = this.loadMerkleState();
        if (!state) {
            console.error('No merkle state found. Run initial build first.');
            return null;
        }

        // Compute new hash
        const newHash = this.hashFile(filePath);
        if (!newHash) {
            return null;
        }

        // Update or add leaf (direct path comparison)
        const existingLeaf = state.leaves.find(l => l.filePath === filePath);
        if (existingLeaf) {
            // Check if hash actually changed
            if (existingLeaf.hash === newHash) {
                console.log(`File ${filePath} unchanged (same hash)`);
                return state.root; // No change
            }
            existingLeaf.hash = newHash;
        } else {
            // New file
            state.leaves.push({ filePath, hash: newHash });
            state.leaves.sort((a, b) => a.filePath.localeCompare(b.filePath));
        }

        // Rebuild tree
        const tree = this.buildTree(state.leaves);

        // Save updated state
        this.saveMerkleState({
            root: tree.hash,
            leaves: state.leaves,
            timestamp: new Date().toISOString(),
        });

        // Add to dirty queue
        this.addToDirtyQueue(filePath);

        console.log(`Merkle root updated: ${state.root} -> ${tree.hash}`);
        return tree.hash;
    }

    /**
     * Remove file from tree and recompute Merkle root
     */
    deleteFile(filePath: string): string | null {
        // Load current state
        const state = this.loadMerkleState();
        if (!state) {
            console.error('No merkle state found. Run initial build first.');
            return null;
        }

        // Find the file in leaves (direct path comparison)
        const leafIndex = state.leaves.findIndex(l => l.filePath === filePath);
        if (leafIndex === -1) {
            console.log(`File ${filePath} not found in tree`);
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
            this.addToDirtyQueue(filePath);
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

        // Add to dirty queue
        this.addToDirtyQueue(filePath);

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
     * Add file to dirty queue
     */
    addToDirtyQueue(filePath: string): void {
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
        if (!queue.dirtyFiles.includes(filePath)) {
            queue.dirtyFiles.push(filePath);
        }

        fs.writeFileSync(this.dirtyQueuePath, JSON.stringify(queue, null, 2));
    }

    /**
     * Get dirty queue
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
     * Print tree structure (for debugging)
     */
    printTree(node: MerkleNode, depth: number = 0): void {
        const indent = '  '.repeat(depth);
        const shortHash = node.hash.substring(0, 8);

        if (node.filePath) {
            console.log(`${indent}[LEAF] ${shortHash} - ${node.filePath}`);
        } else {
            console.log(`${indent}[NODE] ${shortHash}`);
            if (node.left) this.printTree(node.left, depth + 1);
            if (node.right) this.printTree(node.right, depth + 1);
        }
    }
}
