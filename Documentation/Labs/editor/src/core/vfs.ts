/**
 * Virtual File System (VFS) - In-memory file system for the editor
 *
 * This is the foundation for all lab demonstrations. It provides:
 * - File and directory operations (CRUD)
 * - Event system for file changes
 * - Path utilities
 * - Content hashing for change detection
 */

// ============================================================================
// Types
// ============================================================================

export interface VFSFile {
  type: 'file';
  name: string;
  path: string;
  content: string;
  language: string;
  lastModified: number;
}

export interface VFSDirectory {
  type: 'directory';
  name: string;
  path: string;
  children: Map<string, VFSNode>;
}

export type VFSNode = VFSFile | VFSDirectory;

export type VFSEventType = 'create' | 'update' | 'delete' | 'rename';

export interface VFSEvent {
  type: VFSEventType;
  path: string;
  oldPath?: string; // For rename events
  node?: VFSNode;
}

export type VFSListener = (event: VFSEvent) => void;

// ============================================================================
// Language Detection
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.md': 'markdown',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
};

function detectLanguage(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.'));
  return EXTENSION_TO_LANGUAGE[ext] || 'plaintext';
}

// ============================================================================
// Path Utilities
// ============================================================================

export function normalizePath(path: string): string {
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  // Remove trailing slash (except for root)
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  // Normalize multiple slashes
  path = path.replace(/\/+/g, '/');
  return path;
}

export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash);
}

export function getFileName(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '';
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'));
}

// ============================================================================
// Virtual File System Class
// ============================================================================

export class VirtualFileSystem {
  private root: VFSDirectory;
  private listeners: Set<VFSListener> = new Set();

  constructor() {
    this.root = {
      type: 'directory',
      name: '',
      path: '/',
      children: new Map(),
    };
  }

  // --------------------------------------------------------------------------
  // Event System
  // --------------------------------------------------------------------------

  subscribe(listener: VFSListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: VFSEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('VFS listener error:', error);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Node Access
  // --------------------------------------------------------------------------

  private getNode(path: string): VFSNode | undefined {
    const normalized = normalizePath(path);
    if (normalized === '/') return this.root;

    const parts = normalized.split('/').filter(Boolean);
    let current: VFSNode = this.root;

    for (const part of parts) {
      if (current.type !== 'directory') return undefined;
      const child = current.children.get(part);
      if (!child) return undefined;
      current = child;
    }

    return current;
  }

  private getParentDirectory(path: string): VFSDirectory | undefined {
    const parentPath = getParentPath(path);
    const parent = this.getNode(parentPath);
    return parent?.type === 'directory' ? parent : undefined;
  }

  // --------------------------------------------------------------------------
  // File Operations
  // --------------------------------------------------------------------------

  /**
   * Check if a path exists
   */
  exists(path: string): boolean {
    return this.getNode(path) !== undefined;
  }

  /**
   * Check if a path is a file
   */
  isFile(path: string): boolean {
    const node = this.getNode(path);
    return node?.type === 'file';
  }

  /**
   * Check if a path is a directory
   */
  isDirectory(path: string): boolean {
    const node = this.getNode(path);
    return node?.type === 'directory';
  }

  /**
   * Read file content
   */
  readFile(path: string): string | undefined {
    const node = this.getNode(path);
    return node?.type === 'file' ? node.content : undefined;
  }

  /**
   * Get file info
   */
  getFile(path: string): VFSFile | undefined {
    const node = this.getNode(path);
    return node?.type === 'file' ? node : undefined;
  }

  /**
   * Write/create a file
   */
  writeFile(path: string, content: string): boolean {
    const normalized = normalizePath(path);
    const fileName = getFileName(normalized);
    const parent = this.getParentDirectory(normalized);

    if (!parent) {
      // Auto-create parent directories
      this.mkdirp(getParentPath(normalized));
      return this.writeFile(path, content);
    }

    const existing = parent.children.get(fileName);
    const isUpdate = existing?.type === 'file';

    const file: VFSFile = {
      type: 'file',
      name: fileName,
      path: normalized,
      content,
      language: detectLanguage(fileName),
      lastModified: Date.now(),
    };

    parent.children.set(fileName, file);
    this.emit({
      type: isUpdate ? 'update' : 'create',
      path: normalized,
      node: file,
    });

    return true;
  }

  /**
   * Delete a file or directory
   */
  delete(path: string): boolean {
    const normalized = normalizePath(path);
    if (normalized === '/') return false; // Can't delete root

    const fileName = getFileName(normalized);
    const parent = this.getParentDirectory(normalized);

    if (!parent || !parent.children.has(fileName)) {
      return false;
    }

    parent.children.delete(fileName);
    this.emit({ type: 'delete', path: normalized });
    return true;
  }

  /**
   * Rename/move a file or directory
   */
  rename(oldPath: string, newPath: string): boolean {
    const node = this.getNode(oldPath);
    if (!node) return false;

    const normalizedOld = normalizePath(oldPath);
    const normalizedNew = normalizePath(newPath);

    // Delete from old location
    const oldParent = this.getParentDirectory(normalizedOld);
    const oldName = getFileName(normalizedOld);
    if (oldParent) {
      oldParent.children.delete(oldName);
    }

    // Add to new location
    const newParent = this.getParentDirectory(normalizedNew);
    const newName = getFileName(normalizedNew);

    if (!newParent) {
      this.mkdirp(getParentPath(normalizedNew));
      return this.rename(oldPath, newPath);
    }

    // Update node's path and name
    const updatedNode = { ...node, name: newName, path: normalizedNew };
    if (updatedNode.type === 'directory') {
      this.updateChildPaths(updatedNode, normalizedNew);
    }

    newParent.children.set(newName, updatedNode);
    this.emit({ type: 'rename', path: normalizedNew, oldPath: normalizedOld });
    return true;
  }

  private updateChildPaths(dir: VFSDirectory, basePath: string): void {
    for (const [name, child] of dir.children) {
      const newPath = joinPath(basePath, name);
      if (child.type === 'file') {
        (child as VFSFile).path = newPath;
      } else {
        (child as VFSDirectory).path = newPath;
        this.updateChildPaths(child as VFSDirectory, newPath);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Directory Operations
  // --------------------------------------------------------------------------

  /**
   * Create a directory
   */
  mkdir(path: string): boolean {
    const normalized = normalizePath(path);
    if (this.exists(normalized)) return false;

    const dirName = getFileName(normalized);
    const parent = this.getParentDirectory(normalized);

    if (!parent) return false;

    const dir: VFSDirectory = {
      type: 'directory',
      name: dirName,
      path: normalized,
      children: new Map(),
    };

    parent.children.set(dirName, dir);
    this.emit({ type: 'create', path: normalized, node: dir });
    return true;
  }

  /**
   * Create directory and all parent directories
   */
  mkdirp(path: string): boolean {
    const normalized = normalizePath(path);
    if (normalized === '/') return true;
    if (this.exists(normalized)) return this.isDirectory(normalized);

    const parts = normalized.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;
      if (!this.exists(currentPath)) {
        this.mkdir(currentPath);
      }
    }

    return true;
  }

  /**
   * List directory contents
   */
  readdir(path: string): string[] {
    const node = this.getNode(path);
    if (node?.type !== 'directory') return [];
    return Array.from(node.children.keys());
  }

  /**
   * Get all files recursively
   */
  getAllFiles(path: string = '/'): VFSFile[] {
    const files: VFSFile[] = [];
    const node = this.getNode(path);

    if (!node) return files;

    if (node.type === 'file') {
      files.push(node);
    } else {
      for (const child of node.children.values()) {
        if (child.type === 'file') {
          files.push(child);
        } else {
          files.push(...this.getAllFiles(child.path));
        }
      }
    }

    return files;
  }

  /**
   * Get directory tree structure (for UI rendering)
   */
  getTree(path: string = '/'): VFSNode | undefined {
    return this.getNode(path);
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /**
   * Compute SHA-256 hash of content (for change detection)
   */
  async computeHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Get statistics about the file system
   */
  getStats(): { files: number; directories: number; totalSize: number } {
    let files = 0;
    let directories = 0;
    let totalSize = 0;

    const traverse = (node: VFSNode) => {
      if (node.type === 'file') {
        files++;
        totalSize += node.content.length;
      } else {
        directories++;
        for (const child of node.children.values()) {
          traverse(child);
        }
      }
    };

    traverse(this.root);
    return { files, directories: directories - 1, totalSize }; // -1 to exclude root
  }

  /**
   * Clear all files (reset to empty)
   */
  clear(): void {
    this.root.children.clear();
    this.emit({ type: 'delete', path: '/' });
  }

  /**
   * Alias for mkdir (for convenience)
   */
  createDirectory(path: string): boolean {
    return this.mkdirp(path);
  }

  /**
   * Get all file hashes (synchronous version using simple hash)
   */
  getAllHashes(): Record<string, string> {
    const hashes: Record<string, string> = {};
    const files = this.getAllFiles();

    for (const file of files) {
      // Simple hash for demo purposes (real impl would use SHA-256)
      let hash = 0;
      for (let i = 0; i < file.content.length; i++) {
        const char = file.content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      hashes[file.path] = Math.abs(hash).toString(16).padStart(16, '0');
    }

    return hashes;
  }

  /**
   * Load sample project for demonstrations
   */
  loadSampleProject(): void {
    this.clear();

    // Create directory structure
    this.mkdirp('/src/components');
    this.mkdirp('/src/utils');
    this.mkdirp('/src/types');

    // Main entry point
    this.writeFile('/src/index.ts', `import { App } from './components/App';
import { UserService } from './services/UserService';

const app = new App();
const userService = new UserService();

async function main() {
  const users = await userService.getUsers();
  app.render(users);
}

main();
`);

    // Types
    this.writeFile('/src/types/user.ts', `export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
  createdAt: Date;
}

export interface UserCreateRequest {
  name: string;
  email: string;
  role?: User['role'];
}

export interface UserUpdateRequest {
  name?: string;
  email?: string;
  role?: User['role'];
}
`);

    // Components
    this.writeFile('/src/components/App.ts', `import { User } from '../types/user';
import { UserCard } from './UserCard';

export class App {
  private container: HTMLElement;

  constructor() {
    this.container = document.getElementById('app') || document.body;
  }

  render(users: User[]): void {
    this.container.innerHTML = '';

    const header = document.createElement('h1');
    header.textContent = 'User Management';
    this.container.appendChild(header);

    const userList = document.createElement('div');
    userList.className = 'user-list';

    for (const user of users) {
      const card = new UserCard(user);
      userList.appendChild(card.render());
    }

    this.container.appendChild(userList);
  }
}
`);

    this.writeFile('/src/components/UserCard.ts', `import { User } from '../types/user';
import { formatDate } from '../utils/formatters';

export class UserCard {
  constructor(private user: User) {}

  render(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = \`
      <h3>\${this.user.name}</h3>
      <p class="email">\${this.user.email}</p>
      <span class="role">\${this.user.role}</span>
      <span class="date">Joined: \${formatDate(this.user.createdAt)}</span>
    \`;
    return card;
  }
}
`);

    // Services
    this.mkdirp('/src/services');
    this.writeFile('/src/services/UserService.ts', `import { User, UserCreateRequest, UserUpdateRequest } from '../types/user';
import { generateId } from '../utils/helpers';

export class UserService {
  private users: Map<string, User> = new Map();

  async getUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async createUser(request: UserCreateRequest): Promise<User> {
    const user: User = {
      id: generateId(),
      name: request.name,
      email: request.email,
      role: request.role || 'user',
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateUser(id: string, request: UserUpdateRequest): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updated: User = {
      ...user,
      ...request,
    };
    this.users.set(id, updated);
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}
`);

    // Utilities
    this.writeFile('/src/utils/helpers.ts', `/**
 * Generate a unique ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
`);

    this.writeFile('/src/utils/formatters.ts', `/**
 * Format a date for display
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Format a number with commas
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return \`\${size.toFixed(1)} \${units[unitIndex]}\`;
}
`);

    // Config files
    this.writeFile('/package.json', `{
  "name": "sample-project",
  "version": "1.0.0",
  "description": "Sample project for Puku Labs demonstrations",
  "main": "src/index.ts",
  "scripts": {
    "start": "ts-node src/index.ts",
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
`);

    this.writeFile('/tsconfig.json', `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
`);

    this.writeFile('/README.md', `# Sample Project

This is a sample project for demonstrating Puku Labs features.

## Structure

\`\`\`
src/
  components/   # UI components
  services/     # Business logic
  types/        # TypeScript interfaces
  utils/        # Helper functions
\`\`\`

## Features

- User management
- Type-safe data handling
- Utility functions
`);
  }
}

// Export singleton instance
export const vfs = new VirtualFileSystem();

// Export helper function for loading sample project
export function loadSampleProject(): void {
  vfs.loadSampleProject();
}
