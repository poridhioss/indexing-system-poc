# Puku Labs Editor

A lightweight, web-based code editor for demonstrating Puku Labs concepts including:

- **Virtual File System (VFS)** - In-memory file system with change tracking
- **Merkle Trees** - Efficient change detection and sync
- **AST Parsing** - Tree-sitter based code chunking
- **Semantic Search** - Embedding-based code search

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

## Project Structure

```
editor/
├── index.html              # Entry point
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
├── vite.config.ts          # Vite bundler config
└── src/
    ├── main.ts             # Application entry
    ├── styles.css          # Dark theme styles
    ├── core/
    │   ├── vfs.ts          # Virtual File System
    │   └── editor.ts       # Monaco Editor wrapper
    ├── components/
    │   ├── FileExplorer.ts # File tree component
    │   ├── TabBar.ts       # Editor tabs
    │   ├── StatusBar.ts    # Status information
    │   └── LabPanel.ts     # Lab demo panel
    └── labs/               # Lab implementations (future)
```

## Features

### Virtual File System

The VFS provides an in-memory file system that:
- Tracks file changes with content hashes
- Emits events for file operations
- Supports file/directory CRUD operations
- Computes SHA-256 hashes for change detection

### Monaco Editor Integration

Full VS Code editing experience:
- Syntax highlighting for 50+ languages
- Multi-tab support with view state preservation
- Auto-save to VFS with debouncing
- IntelliSense and code completion

### Lab Demo Panel

Interactive demonstrations of:
- **VFS Demo** - File tree visualization, hash computation
- **Merkle Tree** - Tree structure and root hash calculation
- More labs coming...

## Labs Roadmap

### Phase 1: Foundation (Labs 03-05)
- Virtual File System basics
- File watching and change detection
- Content hashing with SHA-256

### Phase 2: Merkle Trees (Labs 06-08)
- Merkle tree fundamentals
- Client-side tree implementation
- Change detection with tree diff

### Phase 3: AST & Embeddings (Labs 09-11)
- Tree-sitter integration
- AST-based code chunking
- Embedding generation

### Phase 4: Search & Sync (Labs 12-14)
- Vector similarity search
- Hybrid search (BM25 + semantic)
- Server-side Merkle sync

### Phase 5: Integration (Labs 15-17)
- Real-time indexing pipeline
- Privacy and encryption
- Full integration demo

## Development

### Build Commands

```bash
npm run dev       # Start dev server with HMR
npm run build     # Production build to dist/
npm run preview   # Preview production build
```

### Adding a New Lab

1. Create lab component in `src/labs/`
2. Register in `src/main.ts` via `labPanel.registerTab()`
3. Implement the `render(container)` function

Example:

```typescript
app.labPanel.registerTab({
  id: 'my-lab',
  label: 'My Lab',
  render: (container) => {
    container.innerHTML = `
      <div class="lab-section">
        <h3 class="lab-section-title">My Lab Demo</h3>
        <button class="lab-button" id="btn-action">Do Something</button>
        <div class="lab-output" id="output">Ready.</div>
      </div>
    `;

    container.querySelector('#btn-action')?.addEventListener('click', () => {
      // Lab logic here
    });
  },
});
```

## Technology Stack

- **Vite** - Fast dev server and bundler
- **TypeScript** - Type-safe JavaScript
- **Monaco Editor** - VS Code's editor component
- **CSS Variables** - Themeable dark UI

## License

MIT
