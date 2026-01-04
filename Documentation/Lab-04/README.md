# Semantic Code Chunking with Tree-sitter

When building AI-powered code search or retrieval-augmented generation (RAG) systems, how you split code into chunks dramatically affects quality. In this lab, you'll build a semantic code chunker that uses Tree-sitter ASTs to split code by meaningful boundaries—functions, classes, and methods—instead of arbitrary line counts.

This is exactly how Cursor, PUKU-Editor, GitHub Copilot, and production AI code assistants chunk code for embeddings and search.

## Prerequisites

- Basic knowledge of TypeScript
- Familiarity with ASTs and Tree-sitter is helpful but not required
- Node.js and npm installed

## Project Overview

This project builds a semantic code chunker—a tool that takes source code and splits it into meaningful pieces. Instead of cutting code at random line numbers, it understands the structure and keeps complete functions, classes, and methods together.

![Project Overview](./images/infra-5.svg)

The chunker takes two inputs: your source code and the programming language. It uses Tree-sitter to understand the code structure, then outputs an array of chunks—each containing a complete, meaningful piece of code ready for embedding or search.

## What You'll Learn

1. Why semantic chunking produces better embeddings than line-based
2. Identifying semantic boundaries in code (functions, classes, methods)
3. Building a multi-language semantic chunker
4. Handling edge cases (large functions, nested structures)
5. Adding metadata to chunks for better retrieval
6. Gap-filling strategies for code between functions

## Part 1: Semantic Chunking

### Why Chunk Code at All?

AI embedding models have token limits (typically 512-8192 tokens). A large codebase can't be embedded as one unit. We must split it into chunks that:

1. **Fit the model's context window** - Under token limit
2. **Preserve meaning** - Complete semantic units
3. **Enable retrieval** - Searchable, relevant segments

The diagram below illustrates this process. Source files of varying sizes (5000, 2000, 3000 lines) pass through a semantic chunker that produces embedding-ready chunks. Each chunk respects token limits while preserving complete code units.

![Embeddings](./images/infra-3.svg)

### Line-Based vs Semantic Chunking

There are two fundamental approaches to splitting code into chunks:

| Approach | How It Works | Best For |
|----------|--------------|----------|
| **Line-Based** | Splits at fixed character/line counts regardless of code structure | Plain text, prose, logs |
| **Semantic** | Splits at code boundaries (functions, classes, methods) using AST parsing | Source code, structured data |

Line-based chunking treats code as plain text—simple but destructive. Semantic chunking understands code structure—complex but preserves meaning. For AI code search and RAG systems, semantic chunking produces dramatically better results because embeddings capture complete, meaningful code units rather than arbitrary text fragments.

### Line-Based Chunking Problems

Traditional text splitters fail with code:

```python
# Line-based chunker (500 chars per chunk)
def calculate_order_total(items, tax_rate, discount_co  # ← Cut here!
de):
    """Calculate the total price of an order."""
    subtotal = sum(item.price * item.quantity for item in items)
```

**Problems:**
- `discount_code` becomes `discount_co` and `de`
- Embedding model sees broken identifiers
- Search for "discount" won't match this chunk

### Semantic Chunking

The word `Semantic` means "related to meaning." A semantic chunker splits code at meaningful boundaries:

```python
# Semantic chunker (by function boundaries)

# Chunk 1: Complete function
def calculate_order_total(items, tax_rate, discount_code):
    """Calculate the total price of an order."""
    subtotal = sum(item.price * item.quantity for item in items)
    discount = apply_discount(subtotal, discount_code)
    return (subtotal - discount) * (1 + tax_rate)

# Chunk 2: Complete function
def apply_discount(amount, code):
    """Apply discount code to amount."""
    discounts = {"SAVE10": 0.10, "SAVE20": 0.20}
    return amount * discounts.get(code, 0)
```

**Benefits:**
- Complete functions with full signatures
- Docstrings included for context
- Better embeddings = better search

### What Makes a "Semantic Unit"?

A semantic unit is any self-contained code construct that represents a complete, meaningful piece of functionality. These are the natural boundaries where code can be split without losing context. The diagram below shows the semantic units for each language—notice how each language has its own constructs (Python uses `def` and `class`, Rust uses `fn` and `impl`, etc.), but they all represent the same concept: complete, standalone code blocks that make sense on their own.

![Semantic Unit](./images/infra-4.svg)


## Part 2: Building the Semantic Chunker

Now that you understand why semantic chunking matters and what constitutes a semantic unit, let's explore a working implementation. In this part, you'll clone a pre-built semantic chunker, examine its architecture, and understand how each component works together to transform raw source code into meaningful, embedding-ready chunks.

The implementation consists of three core modules:
1. **semantic-nodes.ts** - Maps programming languages to their AST node types
2. **chunk.ts** - Defines the data structure for representing chunks
3. **chunker.ts** - The main chunker that orchestrates parsing, extraction, and gap filling

### Project Setup

Clone the repository and navigate to the semantic chunker project:

```bash
git clone https://github.com/poridhioss/indexing-system-poc.git
cd indexing-system-poc/Semantic-chunking-with-AST
npm install
```

### Project Structure

```
Semantic-chunking-with-AST/
├── src/
│   ├── semantic-nodes.ts    # Language-specific AST node mappings
│   ├── chunk.ts             # SemanticChunk data structure
│   ├── chunker.ts           # Core SemanticChunker class
│   ├── example.ts           # Usage demonstration
│   └── index.ts             # Public exports
├── dist/                    # Compiled output
├── package.json
└── tsconfig.json
```

The TypeScript configuration uses ES2020 target with strict type checking. It outputs compiled files to `dist/` while keeping source in `src/`, and generates declaration files for type exports. The `esModuleInterop` flag enables seamless imports from CommonJS modules like `web-tree-sitter`.

### Core Architecture

The semantic chunker follows a pipeline architecture. The diagram below shows the complete flow from input to output.

![Core Architecture](./images/infra-2.svg)

**Input Stage:** The chunker accepts source code, a language identifier (e.g., "javascript", "python"), and configuration parameters like max/min chunk sizes.

**Initialization:** Before processing, the chunker loads the appropriate Tree-sitter WASM grammar for the target language and fetches the semantic node types specific to that language.

**Parsing:** Tree-sitter parses the source code into an Abstract Syntax Tree (AST). If parsing fails, the system gracefully falls back to line-based chunking.

**AST Traversal & Size Check:** The chunker walks the AST looking for semantic boundaries. Each potential chunk is checked against size constraints—chunks within limits are extracted directly, while oversized chunks are split into smaller units.

**Gap Filling:** After extracting semantic chunks, gap filling captures any code between them (imports, constants, comments) that would otherwise be lost.

**Output:** The final result is an array of semantic chunks, each containing the code text along with rich metadata like type, name, line numbers, and parent context.

### Step 1: Define Semantic Node Types

This module defines a mapping between programming languages and their AST node types that represent semantic boundaries. The `SEMANTIC_NODES` constant maps each supported language (JavaScript, TypeScript, Python, Go, Rust) to its meaningful code constructs like functions, classes, and methods. The `getSemanticTypes()` helper function flattens all node types for a given language into a single array, making it easy to check if an AST node represents a semantic boundary during traversal.

**See the implementation in `src/semantic-nodes.ts`.**

### Step 2: The Chunk Data Structure

This module (`src/chunk.ts`) defines the data structure for representing a semantic code chunk:

- **ChunkType** - Union type enumerating all chunk categories (function, class, method, interface, etc.)
- **ChunkMetadata** - Interface storing context like parent scope, function parameters, return types, and flags for async/exported functions
- **SemanticChunk** - Main class encapsulating chunk properties with:
  - `charCount` and `lineCount` computed getters for size tracking
  - `toString()` method for debugging output
  - `contextualize(filePath)` method that prepends metadata (file path, parent scope, type, parameters) before the code text—essential for generating embedding-ready text that includes context about where the code lives in the codebase

**See the implementation in `src/chunk.ts`.**

### Step 3: The Core Chunker

This module (`src/chunker.ts`) is the main chunker implementation that orchestrates the entire semantic chunking process:

**Core Methods:**
- `initialize()` - Loads language grammars from WASM files
- `chunk()` - Main entry point that parses code and extracts chunks
- `extractChunks()` - Recursively walks the AST looking for semantic nodes
- `createChunk()` - Builds a SemanticChunk from an AST node with metadata
- `splitLargeNode()` - Handles oversized chunks by extracting child nodes
- `fillGaps()` - Creates block chunks for code between semantic units (imports, constants, comments)
- `fallbackChunk()` - Provides line-based chunking when AST parsing fails

**Chunk Processing Methods:**
- `extractMethodsFromClass(classChunk)` - When a class exceeds the max chunk size, this method breaks it down into individual method chunks. Each method retains a reference to its parent class name in metadata, preserving the hierarchical relationship.
- `addOverlap(chunks, code, overlapLines)` - Adds context lines from neighboring chunks to each chunk's text. This helps retrieval find relevant results when searches span chunk boundaries.

**See the implementation in `src/chunker.ts`.**

### Gap Filling Explained

Gap filling ensures that code between semantic chunks (imports, constants, exports) is not lost during chunking. After extracting functions and classes, the chunker identifies any lines not covered by semantic chunks and packages them as "block" type chunks with `gapFill: true` metadata.

## Putting It All Together

Here's how everything works from start to finish:

1. **You provide code** → Pass your source code and language (e.g., "javascript") to the chunker

2. **Tree-sitter parses it** → The code becomes a tree structure where each node represents a piece of code (function, class, variable, etc.)

3. **Chunker walks the tree** → It looks for nodes that match semantic types (like `function_declaration` or `class_definition`)

4. **Size check** → Each match is checked against your size limits:
   - Too small? Skip it
   - Just right? Extract it as a chunk
   - Too big? Break it down further

5. **Gap filling** → Any code between chunks (imports, constants) gets packaged as "block" chunks

6. **Output** → You get an array of `SemanticChunk` objects, each with:
   - The code text
   - Type (function, class, method, etc.)
   - Name (if it has one)
   - Line numbers
   - Metadata (parent scope, parameters, etc.)

7. **Ready for use** → Call `chunk.contextualize(filePath)` to get embedding-ready text with context, or use the raw text directly

That's the complete flow—from raw code to structured, meaningful chunks ready for AI embedding and search.

## Part 3: Running the Example

Run the example to see the semantic chunker in action:

```bash
npm start
```

This runs `src/example.ts` which demonstrates the SemanticChunker with sample JavaScript and Python code. The example initializes the chunker with custom size limits (4000 max, 50 min characters), loads JavaScript and Python language grammars from their WASM files, then processes sample code from both languages.

**Expected Output:**

![Example Output](./images/image-1.png)

![Example Output 2](./images/image-2.png)

The output shows each chunk's type, name, line range, character count, and metadata—demonstrating how semantic chunking preserves complete functions and classes while extracting meaningful names and parameters.

**See the implementation in `src/example.ts`.**

## Summary

In this lab, you learned:

| Concept | Description |
|---------|-------------|
| **Semantic Chunking** | Splitting code by meaningful boundaries (functions, classes) |
| **Why It Matters** | Better embeddings, better AI search results |
| **Node Type Mapping** | Different AST node types for each language |
| **Size Constraints** | Min/max chunk sizes to balance granularity and context |
| **Gap Filling** | Handling code between semantic units |
| **Metadata Extraction** | Parameters, return types, parent scope |
| **Contextualization** | Adding file/scope info for better embeddings |

By building this semantic chunker, you've taken a crucial step toward creating high-quality AI-powered code search and retrieval systems that understand code structure and meaning.