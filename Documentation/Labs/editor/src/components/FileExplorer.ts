/**
 * File Explorer Component
 *
 * Renders a tree view of the Virtual File System with expand/collapse,
 * context menus, and file operations.
 */

import { vfs, VFSDirectory, VFSEvent, getFileName } from '../core/vfs';
import { editorManager } from '../core/editor';

// ============================================================================
// Types
// ============================================================================

interface TreeNodeState {
  expanded: boolean;
}

// ============================================================================
// File Explorer Class
// ============================================================================

export class FileExplorer {
  private container: HTMLElement;
  private nodeStates: Map<string, TreeNodeState> = new Map();
  private selectedPath: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className = 'file-explorer';

    // Subscribe to VFS changes
    vfs.subscribe(this.handleVFSEvent.bind(this));

    // Subscribe to editor tab changes
    editorManager.subscribe((event) => {
      if (event.type === 'tabChange') {
        this.selectPath(event.path);
      }
    });

    // Initial render
    this.render();
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  private handleVFSEvent(_event: VFSEvent): void {
    // Re-render on any VFS change
    this.render();
  }

  private handleNodeClick(path: string, isDirectory: boolean, event: MouseEvent): void {
    event.stopPropagation();

    if (isDirectory) {
      this.toggleExpanded(path);
    } else {
      this.selectPath(path);
      editorManager.openFile(path);
    }
  }

  private handleContextMenu(path: string, isDirectory: boolean, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.showContextMenu(path, isDirectory, event.clientX, event.clientY);
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  private isExpanded(path: string): boolean {
    return this.nodeStates.get(path)?.expanded ?? (path === '/');
  }

  private toggleExpanded(path: string): void {
    const current = this.isExpanded(path);
    this.nodeStates.set(path, { expanded: !current });
    this.render();
  }

  private selectPath(path: string): void {
    this.selectedPath = path;
    this.render();
  }

  // --------------------------------------------------------------------------
  // Context Menu
  // --------------------------------------------------------------------------

  private showContextMenu(path: string, isDirectory: boolean, x: number, y: number): void {
    // Remove existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const items: { label: string; action: () => void }[] = [];

    if (isDirectory) {
      items.push({
        label: 'New File',
        action: () => this.promptNewFile(path),
      });
      items.push({
        label: 'New Folder',
        action: () => this.promptNewFolder(path),
      });
    }

    if (path !== '/') {
      items.push({
        label: 'Rename',
        action: () => this.promptRename(path),
      });
      items.push({
        label: 'Delete',
        action: () => this.confirmDelete(path),
      });
    }

    for (const item of items) {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      menuItem.textContent = item.label;
      menuItem.onclick = () => {
        menu.remove();
        item.action();
      };
      menu.appendChild(menuItem);
    }

    document.body.appendChild(menu);

    // Close menu on click outside
    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  // --------------------------------------------------------------------------
  // File Operations
  // --------------------------------------------------------------------------

  private promptNewFile(parentPath: string): void {
    const name = prompt('Enter file name:');
    if (name) {
      const path = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
      vfs.writeFile(path, '');
      editorManager.openFile(path);
    }
  }

  private promptNewFolder(parentPath: string): void {
    const name = prompt('Enter folder name:');
    if (name) {
      const path = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
      vfs.mkdir(path);
      this.nodeStates.set(parentPath, { expanded: true });
      this.render();
    }
  }

  private promptRename(path: string): void {
    const oldName = getFileName(path);
    const newName = prompt('Enter new name:', oldName);
    if (newName && newName !== oldName) {
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;
      vfs.rename(path, newPath);
    }
  }

  private confirmDelete(path: string): void {
    const name = getFileName(path);
    if (confirm(`Delete "${name}"?`)) {
      vfs.delete(path);
    }
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  render(): void {
    this.container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'explorer-header';
    header.innerHTML = `
      <span class="explorer-title">EXPLORER</span>
      <div class="explorer-actions">
        <button class="icon-btn" title="New File" data-action="new-file">+</button>
        <button class="icon-btn" title="New Folder" data-action="new-folder">📁</button>
        <button class="icon-btn" title="Refresh" data-action="refresh">↻</button>
      </div>
    `;

    // Add action handlers
    header.querySelector('[data-action="new-file"]')?.addEventListener('click', () => {
      this.promptNewFile('/');
    });
    header.querySelector('[data-action="new-folder"]')?.addEventListener('click', () => {
      this.promptNewFolder('/');
    });
    header.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
      this.render();
    });

    this.container.appendChild(header);

    const tree = document.createElement('div');
    tree.className = 'file-tree';

    const rootNode = vfs.getTree('/');
    if (rootNode && rootNode.type === 'directory') {
      this.renderDirectory(rootNode, tree, 0);
    }

    this.container.appendChild(tree);
  }

  private renderDirectory(dir: VFSDirectory, container: HTMLElement, depth: number): void {
    // Sort children: directories first, then files, alphabetically
    const children = Array.from(dir.children.values()).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const child of children) {
      const isExpanded = this.isExpanded(child.path);
      const isSelected = this.selectedPath === child.path;

      const node = document.createElement('div');
      node.className = `tree-node ${isSelected ? 'selected' : ''}`;

      const content = document.createElement('div');
      content.className = 'tree-node-content';
      content.style.paddingLeft = `${depth * 16 + 8}px`;

      if (child.type === 'directory') {
        content.innerHTML = `
          <span class="tree-icon">${isExpanded ? '▼' : '▶'}</span>
          <span class="tree-icon">📁</span>
          <span class="tree-label">${child.name}</span>
        `;
      } else {
        const icon = this.getFileIcon(child.name);
        content.innerHTML = `
          <span class="tree-icon" style="visibility: hidden">▶</span>
          <span class="tree-icon">${icon}</span>
          <span class="tree-label">${child.name}</span>
        `;
      }

      content.onclick = (e) => this.handleNodeClick(child.path, child.type === 'directory', e);
      content.oncontextmenu = (e) => this.handleContextMenu(child.path, child.type === 'directory', e);

      node.appendChild(content);
      container.appendChild(node);

      // Render children if directory is expanded
      if (child.type === 'directory' && isExpanded) {
        this.renderDirectory(child, container, depth + 1);
      }
    }
  }

  private getFileIcon(filename: string): string {
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    const icons: Record<string, string> = {
      '.ts': '🔷',
      '.tsx': '⚛️',
      '.js': '🟨',
      '.jsx': '⚛️',
      '.json': '📋',
      '.html': '🌐',
      '.css': '🎨',
      '.scss': '🎨',
      '.md': '📝',
      '.py': '🐍',
      '.rs': '🦀',
      '.go': '🐹',
      '.java': '☕',
      '.c': '©️',
      '.cpp': '➕',
      '.h': '📎',
      '.yml': '⚙️',
      '.yaml': '⚙️',
      '.sh': '💻',
      '.sql': '🗃️',
    };
    return icons[ext] || '📄';
  }
}
