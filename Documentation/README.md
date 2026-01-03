# Cursor-Like Codebase Indexing Labs

This lab series teaches you how to build a production-ready codebase indexing system similar to Cursor's AI-powered code search. You'll learn the complete pipeline from parsing code to building Merkle trees for incremental re-indexing.

## What You'll Build

By the end of this series, you'll have implemented:

- FIM (Fill-In-Middle) code completion backend
- AST-based semantic code chunking using Tree-sitter
- Merkle tree for efficient change detection
- Client-server sync mechanism for incremental updates
- Vector database for semantic code search
- Complete indexing pipeline with embeddings

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CODEBASE INDEXING PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │   Source    │    │  Tree-sitter│    │   Semantic  │    │   Content   │      │
│  │    Files    │───>│  AST Parse  │───>│   Chunking  │───>│   Hashing   │      │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘      │
│                                                                  │              │
│                                                                  ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │   Vector    │    │  Embedding  │    │   Merkle    │    │    Chunk    │      │
│  │  Database   │<───│  Generation │<───│    Tree     │<───│    Store    │      │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘      │
│                                                                                 │
│  Change Detection & Incremental Re-indexing:                                   │
│  ─────────────────────────────────────────────                                 │
│  1. File watcher detects changes                                               │
│  2. File-level Merkle tree identifies modified files                           │
│  3. Only changed files are re-parsed and re-chunked                            │
│  4. Only affected chunks are re-embedded                                       │
│  5. Vector database updated incrementally                                      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Lab Plan

| Lab | Title | Status | Description |
|-----|-------|--------|-------------|
| **Lab 01** | Introduction to Codestral and FIM | Done | Set up Codestral API, understand FIM (Fill-In-Middle) completion |
| **Lab 02** | Deploy FIM Backend on AWS Lambda | Done | Build serverless FIM backend using AWS Lambda + API Gateway |
| **Lab 03** | Deploy FIM Backend on Cloudflare Workers | Done | Build edge FIM backend using Cloudflare Workers + Hono.js |
| **Lab 04** | AST-Based Semantic Code Chunking | Done | Use Tree-sitter to parse code into AST and create semantic chunks |
| **Lab 05** | Chunk Hashing Strategies | Pending | Implement content-based hashing for chunks (SHA-256, xxHash) |
| **Lab 06** | File Watcher Implementation | Pending | Build file system watcher to detect code changes in real-time |
| **Lab 07** | Basic Merkle Tree Implementation | Pending | Build file-level Merkle tree for efficient change detection |
| **Lab 08** | Client-Server Merkle Tree Sync | Pending | Implement dual Merkle trees (client + server) with sync protocol |
| **Lab 09** | Change Detection & Selective Re-indexing | Pending | Detect changed files and selectively re-embed only affected chunks |
| **Lab 10** | Embedding Database with Cloudflare | Pending | Store and query embeddings using Cloudflare D1 + Vectorize |
| **Lab 11** | Full Indexing Pipeline | Pending | Complete end-to-end indexing flow with all components integrated |

## How Cursor Does It

Based on Cursor's official documentation and security page:

> "Cursor computes a Merkle tree of hashes of **all files** in the directory."
> — cursor.com/security

### Key Insights

1. **File-Level Merkle Tree**: Cursor uses file-level hashing (not chunk-level) for the Merkle tree
2. **Dual Trees**: Client maintains local Merkle tree, server maintains remote copy
3. **10-Minute Sync**: Trees are synchronized every 10 minutes
4. **Selective Embedding**: Only files with changed hashes are re-processed
5. **Hybrid Approach**: File Merkle for change detection + chunk hashing for selective re-embedding

### Why File-Level (Not Chunk-Level)?

| Problem | Chunk-Level Merkle | File-Level Merkle |
|---------|-------------------|-------------------|
| **Tree Stability** | Chunk boundaries shift on edit | File boundaries are stable |
| **Comparison** | Need Tree-sitter first | Just hash raw file bytes |
| **Sync Complexity** | Complex reconciliation | Simple hash comparison |
| **Memory Overhead** | Many nodes (chunks) | Fewer nodes (files) |

## Learning Path

### Phase 1: Backend Foundation
**Codestral FIM, AWS Lambda, Cloudflare Workers**

Understanding AI code completion APIs and building serverless backends.

### Phase 2: Code Parsing
**AST-Based Semantic Chunking with Tree-sitter**

Learning Tree-sitter for AST parsing and semantic code chunking.

### Phase 3: Change Detection
**File Watcher, Chunk Hashing, Merkle Tree, Client-Server Sync**

Building the Merkle tree system for efficient incremental updates.

### Phase 4: Storage & Integration
**Embedding Database, Full Pipeline**

Connecting everything with vector database and complete pipeline.

## Prerequisites

- Basic command line knowledge
- Node.js 18+ installed
- Git installed
- Understanding of JavaScript/TypeScript

## Getting Started

Start with Lab 01:

```bash
cd Lab-01
# Follow the README.md instructions
```

Each lab builds on the previous one. Complete them in order for the best learning experience.

## Reference Materials

- [CURSOR-CASE-STUDY.md](./CURSOR-CASE-STUDY.md) - Detailed analysis of Cursor's indexing approach
- [LABS-RESOURCE-MAPPING.md](./LABS-RESOURCE-MAPPING.md) - Resource links for each lab
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [Merkle Tree Wikipedia](https://en.wikipedia.org/wiki/Merkle_tree)

## Lab Structure

Each lab follows a consistent structure:

```
Lab-XX/
├── README.md          # Lab instructions and explanations
├── images/            # Screenshots and diagrams
│   ├── image-*.png    # Step-by-step screenshots
│   └── infra-*.svg    # Architecture diagrams
└── src/               # (some labs) Source code
```

## Contributing

These labs are part of the Puku Editor project. Contributions and improvements are welcome.
