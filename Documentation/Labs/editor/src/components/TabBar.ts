/**
 * Tab Bar Component
 *
 * Displays open file tabs with close buttons and active tab highlighting.
 */

import { editorManager, EditorEvent } from '../core/editor';
import { getFileName } from '../core/vfs';

export class TabBar {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className = 'tab-bar';

    // Subscribe to editor events
    editorManager.subscribe(this.handleEditorEvent.bind(this));

    // Initial render
    this.render();
  }

  private handleEditorEvent(event: EditorEvent): void {
    if (['tabOpen', 'tabClose', 'tabChange'].includes(event.type)) {
      this.render();
    }
  }

  render(): void {
    this.container.innerHTML = '';

    const tabs = editorManager.getTabs();
    const activeTab = editorManager.getActiveTab();

    for (const path of tabs) {
      const tab = document.createElement('div');
      tab.className = `tab ${path === activeTab ? 'active' : ''}`;

      const hasUnsaved = editorManager.hasUnsavedChanges(path);

      tab.innerHTML = `
        <span class="tab-icon">${this.getFileIcon(path)}</span>
        <span class="tab-label">${getFileName(path)}${hasUnsaved ? ' •' : ''}</span>
        <button class="tab-close" title="Close">×</button>
      `;

      // Click to switch tab
      tab.onclick = (e) => {
        if (!(e.target as HTMLElement).classList.contains('tab-close')) {
          editorManager.switchToTab(path);
        }
      };

      // Close button
      const closeBtn = tab.querySelector('.tab-close');
      closeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        editorManager.closeTab(path);
      });

      // Middle-click to close
      tab.onmousedown = (e) => {
        if (e.button === 1) {
          e.preventDefault();
          editorManager.closeTab(path);
        }
      };

      this.container.appendChild(tab);
    }

    // Empty state
    if (tabs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tab-empty';
      empty.textContent = 'No files open';
      this.container.appendChild(empty);
    }
  }

  private getFileIcon(path: string): string {
    const filename = getFileName(path);
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    const icons: Record<string, string> = {
      '.ts': '🔷',
      '.tsx': '⚛️',
      '.js': '🟨',
      '.jsx': '⚛️',
      '.json': '📋',
      '.html': '🌐',
      '.css': '🎨',
      '.md': '📝',
      '.py': '🐍',
    };
    return icons[ext] || '📄';
  }
}
