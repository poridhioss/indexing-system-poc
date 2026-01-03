/**
 * Puku Labs Editor - Main Entry Point
 *
 * A lightweight web-based editor for demonstrating Puku Labs concepts:
 * - Merkle trees for sync
 * - Tree-sitter AST parsing
 * - Embedding-based semantic search
 * - Hybrid search with RRF fusion
 */

import { loadSampleProject } from './core/vfs';
import { editorManager } from './core/editor';
import { FileExplorer } from './components/FileExplorer';
import { TabBar } from './components/TabBar';
import { StatusBar } from './components/StatusBar';
import { LabPanel } from './components/LabPanel';

// ============================================================================
// Application State
// ============================================================================

interface AppState {
  fileExplorer: FileExplorer | null;
  tabBar: TabBar | null;
  statusBar: StatusBar | null;
  labPanel: LabPanel | null;
}

const app: AppState = {
  fileExplorer: null,
  tabBar: null,
  statusBar: null,
  labPanel: null,
};

// ============================================================================
// Lab Panel - Empty for now, will be implemented as we build each lab
// ============================================================================

/**
 * Register the lab panel
 * This panel will display visualizations and demos as we implement each lab
 */
function registerLabDemos(): void {
  if (!app.labPanel) return;

  // Empty panel - ready for lab implementations
  app.labPanel.registerTab({
    id: 'demo',
    label: 'Demo',
    render: (container) => {
      container.innerHTML = `
        <div style="padding: var(--spacing-md); color: var(--text-secondary);">
          <p>Lab demo panel ready.</p>
          <p style="margin-top: var(--spacing-sm); font-size: var(--font-size-sm); color: var(--text-muted);">
            Visualizations will appear here as we implement each lab.
          </p>
        </div>
      `;
    },
  });
}

// ============================================================================
// Initialization
// ============================================================================

function initialize(): void {
  console.log('Puku Labs Editor initializing...');

  // Load sample project into VFS
  loadSampleProject();
  console.log('Sample project loaded');

  // Get container elements
  const sidebar = document.getElementById('sidebar');
  const tabBarEl = document.getElementById('tab-bar');
  const editorContainer = document.getElementById('editor-container');
  const panelArea = document.getElementById('panel-area');
  const statusBarEl = document.getElementById('status-bar');

  console.log('DOM elements:', { sidebar, tabBarEl, editorContainer, panelArea, statusBarEl });

  if (!sidebar || !tabBarEl || !editorContainer || !panelArea || !statusBarEl) {
    console.error('Missing required DOM elements');
    return;
  }

  // Initialize Monaco editor
  console.log('Initializing Monaco editor...');
  try {
    editorManager.initialize(editorContainer);
    console.log('Monaco editor initialized');
  } catch (e) {
    console.error('Monaco editor failed to initialize:', e);
  }

  // Initialize components
  console.log('Initializing components...');
  app.fileExplorer = new FileExplorer(sidebar);
  console.log('FileExplorer initialized');

  app.tabBar = new TabBar(tabBarEl);
  console.log('TabBar initialized');

  app.statusBar = new StatusBar(statusBarEl);
  console.log('StatusBar initialized');

  app.labPanel = new LabPanel(panelArea);
  console.log('LabPanel initialized');

  // Register lab demos
  registerLabDemos();
  console.log('Lab demos registered');

  // Open a default file
  editorManager.openFile('/src/index.ts');

  console.log('Puku Labs Editor ready!');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
