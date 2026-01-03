/**
 * Status Bar Component
 *
 * Displays editor status information: cursor position, language, file info.
 */

import { editorManager } from '../core/editor';
import { vfs } from '../core/vfs';

export class StatusBar {
  private container: HTMLElement;
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className = 'status-bar';

    // Update periodically for cursor position
    this.updateInterval = setInterval(() => this.render(), 200);

    // Subscribe to editor events
    editorManager.subscribe(() => this.render());

    // Initial render
    this.render();
  }

  dispose(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }

  render(): void {
    const activeTab = editorManager.getActiveTab();
    const stats = vfs.getStats();
    const cursor = editorManager.getCursorPosition();

    let languageInfo = '';
    let cursorInfo = '';
    let encodingInfo = 'UTF-8';

    if (activeTab) {
      const file = vfs.getFile(activeTab);
      if (file) {
        languageInfo = file.language;
      }
    }

    if (cursor) {
      cursorInfo = `Ln ${cursor.line}, Col ${cursor.column}`;
    }

    this.container.innerHTML = `
      <div class="status-left">
        <span class="status-item" title="Files in workspace">
          📁 ${stats.files} files
        </span>
        <span class="status-item" title="Total size">
          💾 ${this.formatBytes(stats.totalSize)}
        </span>
      </div>
      <div class="status-right">
        ${cursorInfo ? `<span class="status-item">${cursorInfo}</span>` : ''}
        <span class="status-item">${encodingInfo}</span>
        ${languageInfo ? `<span class="status-item">${languageInfo}</span>` : ''}
      </div>
    `;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
