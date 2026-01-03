/**
 * Monaco Editor Integration
 *
 * Wraps Monaco Editor with VFS integration and provides a clean API
 * for the rest of the application.
 */

import * as monaco from 'monaco-editor';
import { vfs, VFSEvent } from './vfs';

// ============================================================================
// Types
// ============================================================================

export interface EditorTab {
  path: string;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export type EditorEventType = 'tabOpen' | 'tabClose' | 'tabChange' | 'contentChange';

export interface EditorEvent {
  type: EditorEventType;
  path: string;
  content?: string;
}

export type EditorListener = (event: EditorEvent) => void;

// ============================================================================
// Monaco Configuration
// ============================================================================

// Configure Monaco workers
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const getWorkerModule = (moduleUrl: string, label: string) => {
      return new Worker(
        new URL(moduleUrl, import.meta.url),
        { type: 'module', name: label }
      );
    };

    switch (label) {
      case 'json':
        return getWorkerModule(
          'monaco-editor/esm/vs/language/json/json.worker.js',
          label
        );
      case 'css':
      case 'scss':
      case 'less':
        return getWorkerModule(
          'monaco-editor/esm/vs/language/css/css.worker.js',
          label
        );
      case 'html':
      case 'handlebars':
      case 'razor':
        return getWorkerModule(
          'monaco-editor/esm/vs/language/html/html.worker.js',
          label
        );
      case 'typescript':
      case 'javascript':
        return getWorkerModule(
          'monaco-editor/esm/vs/language/typescript/ts.worker.js',
          label
        );
      default:
        return getWorkerModule(
          'monaco-editor/esm/vs/editor/editor.worker.js',
          label
        );
    }
  },
};

// ============================================================================
// Editor Manager Class
// ============================================================================

export class EditorManager {
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private tabs: Map<string, EditorTab> = new Map();
  private activeTab: string | null = null;
  private listeners: Set<EditorListener> = new Set();
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Listen to VFS changes to update models
    vfs.subscribe(this.handleVFSEvent.bind(this));
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize Monaco editor in a container element
   */
  initialize(container: HTMLElement): void {
    if (this.editor) {
      this.editor.dispose();
    }

    this.editor = monaco.editor.create(container, {
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 14,
      fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      glyphMargin: true,
      folding: true,
      bracketPairColorization: { enabled: true },
      renderLineHighlight: 'all',
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'on',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      smoothScrolling: true,
    });

    // Listen to content changes
    this.editor.onDidChangeModelContent(() => {
      if (this.activeTab) {
        this.handleContentChange(this.activeTab);
      }
    });
  }

  /**
   * Dispose of the editor
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    for (const tab of this.tabs.values()) {
      tab.model.dispose();
    }
    this.tabs.clear();
    this.editor?.dispose();
    this.editor = null;
  }

  // --------------------------------------------------------------------------
  // Event System
  // --------------------------------------------------------------------------

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EditorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Editor listener error:', error);
      }
    }
  }

  private handleVFSEvent(event: VFSEvent): void {
    if (event.type === 'delete' && this.tabs.has(event.path)) {
      this.closeTab(event.path);
    } else if (event.type === 'update' && event.node?.type === 'file') {
      const tab = this.tabs.get(event.path);
      if (tab) {
        const currentContent = tab.model.getValue();
        const newContent = event.node.content;
        // Only update if content is different (to avoid infinite loops)
        if (currentContent !== newContent) {
          tab.model.setValue(newContent);
        }
      }
    }
  }

  private handleContentChange(path: string): void {
    // Debounce save to VFS
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      const tab = this.tabs.get(path);
      if (tab) {
        const content = tab.model.getValue();
        vfs.writeFile(path, content);
        this.emit({ type: 'contentChange', path, content });
      }
    }, 500);
  }

  // --------------------------------------------------------------------------
  // Tab Management
  // --------------------------------------------------------------------------

  /**
   * Open a file in a new tab (or switch to existing tab)
   */
  openFile(path: string): boolean {
    // Check if tab already exists
    if (this.tabs.has(path)) {
      this.switchToTab(path);
      return true;
    }

    // Read file from VFS
    const file = vfs.getFile(path);
    if (!file) {
      console.error(`File not found: ${path}`);
      return false;
    }

    // Create Monaco model
    const model = monaco.editor.createModel(
      file.content,
      file.language,
      monaco.Uri.parse(`file://${path}`)
    );

    // Create tab
    const tab: EditorTab = { path, model };
    this.tabs.set(path, tab);

    // Switch to new tab
    this.switchToTab(path);
    this.emit({ type: 'tabOpen', path });

    return true;
  }

  /**
   * Close a tab
   */
  closeTab(path: string): void {
    const tab = this.tabs.get(path);
    if (!tab) return;

    // Save view state
    if (this.editor && this.activeTab === path) {
      tab.viewState = this.editor.saveViewState() ?? undefined;
    }

    // Dispose model
    tab.model.dispose();
    this.tabs.delete(path);

    // Switch to another tab if this was active
    if (this.activeTab === path) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.switchToTab(remainingTabs[remainingTabs.length - 1]);
      } else {
        this.activeTab = null;
        this.editor?.setModel(null);
      }
    }

    this.emit({ type: 'tabClose', path });
  }

  /**
   * Switch to a specific tab
   */
  switchToTab(path: string): void {
    const tab = this.tabs.get(path);
    if (!tab || !this.editor) return;

    // Save current view state
    if (this.activeTab) {
      const currentTab = this.tabs.get(this.activeTab);
      if (currentTab) {
        currentTab.viewState = this.editor.saveViewState() ?? undefined;
      }
    }

    // Switch model
    this.editor.setModel(tab.model);

    // Restore view state
    if (tab.viewState) {
      this.editor.restoreViewState(tab.viewState);
    }

    this.activeTab = path;
    this.emit({ type: 'tabChange', path });
  }

  /**
   * Get all open tabs
   */
  getTabs(): string[] {
    return Array.from(this.tabs.keys());
  }

  /**
   * Get active tab path
   */
  getActiveTab(): string | null {
    return this.activeTab;
  }

  /**
   * Check if a file has unsaved changes
   */
  hasUnsavedChanges(path: string): boolean {
    const tab = this.tabs.get(path);
    if (!tab) return false;

    const vfsContent = vfs.readFile(path);
    const editorContent = tab.model.getValue();
    return vfsContent !== editorContent;
  }

  // --------------------------------------------------------------------------
  // Editor Operations
  // --------------------------------------------------------------------------

  /**
   * Get the current content
   */
  getContent(): string {
    return this.editor?.getValue() ?? '';
  }

  /**
   * Set content (use with caution - prefer VFS operations)
   */
  setContent(content: string): void {
    this.editor?.setValue(content);
  }

  /**
   * Get cursor position
   */
  getCursorPosition(): { line: number; column: number } | null {
    const position = this.editor?.getPosition();
    return position ? { line: position.lineNumber, column: position.column } : null;
  }

  /**
   * Set cursor position
   */
  setCursorPosition(line: number, column: number): void {
    this.editor?.setPosition({ lineNumber: line, column });
    this.editor?.focus();
  }

  /**
   * Get selected text
   */
  getSelection(): string {
    const selection = this.editor?.getSelection();
    if (!selection) return '';
    return this.editor?.getModel()?.getValueInRange(selection) ?? '';
  }

  /**
   * Focus the editor
   */
  focus(): void {
    this.editor?.focus();
  }

  /**
   * Get Monaco editor instance (for advanced usage)
   */
  getMonacoEditor(): monaco.editor.IStandaloneCodeEditor | null {
    return this.editor;
  }

  /**
   * Get Monaco model for a path
   */
  getModel(path: string): monaco.editor.ITextModel | null {
    return this.tabs.get(path)?.model ?? null;
  }

  // --------------------------------------------------------------------------
  // Theme
  // --------------------------------------------------------------------------

  /**
   * Set editor theme
   */
  setTheme(theme: 'vs' | 'vs-dark' | 'hc-black'): void {
    monaco.editor.setTheme(theme);
  }
}

// Export singleton instance
export const editorManager = new EditorManager();
