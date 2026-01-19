# Multi-Tenant Isolation - POC Changes

**Date:** 2026-01-18
**Purpose:** Implement complete user isolation using composite vector IDs

---

## Summary

These changes ensure that User A and User B can have identical code at different file paths without collisions. Each user gets their own vectors in Vectorize with correct metadata.

---

## Changes Made

### 1. Updated Vector ID Format (vectorize.ts)

**File:** `indexing-poc-worker-phase-2/src/lib/vectorize.ts` (Line 30)

**Change:**
```typescript
// Before
id: chunk.hash,

// After
id: `${chunk.metadata.userId}_${chunk.metadata.projectId}_${chunk.hash}`,
```

**Purpose:** Create composite IDs to prevent User B from overwriting User A's vectors.

**Example:**
- User A: `alice@example.com_alice-project_abc123`
- User B: `bob@company.com_bob-project_abc123`

---

### 2. Process All Chunks (index-init.ts)

**File:** `indexing-poc-worker-phase-2/src/routes/index-init.ts` (Line 81)

**Change:**
```typescript
// Before
const newChunks = chunks.filter((chunk) => !existingHashes.has(chunk.hash));

// After
// POC: Process all chunks with AI for simplicity (no cache optimization yet)
const newChunks = chunks;
```

**Purpose:** For POC, call AI for all chunks (no caching optimization). Ensures every user gets their metadata stored.

---

### 3. Extract Hash from Composite ID (vectorize.ts)

**File:** `indexing-poc-worker-phase-2/src/lib/vectorize.ts` (Line 89)

**Change:**
```typescript
// Before
hash: match.id,

// After
// Extract original hash from composite ID (format: userId_projectId_hash)
const hashPart = match.id.split('_')[2] || match.id;
hash: hashPart,
```

**Purpose:** Return the original content hash to the client (strip userId and projectId prefix).

---

### 4. Update Delete Function (vectorize.ts)

**File:** `indexing-poc-worker-phase-2/src/lib/vectorize.ts` (Line 120-143)

**Change:**
```typescript
// Before
export async function deleteChunks(
    vectorize: VectorizeIndex,
    hashes: string[]
): Promise<void>

// After
export async function deleteChunks(
    vectorize: VectorizeIndex,
    userId: string,      // Added
    projectId: string,   // Added
    hashes: string[]
): Promise<void> {
    // POC: Convert hashes to composite IDs
    const compositeIds = hashes.map(hash => `${userId}_${projectId}_${hash}`);
    // ... use compositeIds for deletion
}
```

**Purpose:** Convert hashes to composite IDs before deleting so Vectorize can find them.

---

### 5. Added filePath to Types

**File:** `indexing-poc-worker-phase-2/src/types.ts`

**Changes:**
- Added `filePath: string` to `ChunkMetadata` interface (Line 107)
- Added `filePath: string` to `SearchResult` interface (Line 134)

**Purpose:** Store and return file paths in search results for RAG integration.

---

## How It Works Now

### User A Indexes:
```
Code: function foo() { return 1; }
Hash: abc123
Path: src/utils.ts

Stored in Vectorize:
  ID: alice@example.com_alice-project_abc123
  Metadata: {
    projectId: "alice-project",
    userId: "alice@example.com",
    filePath: "src/utils.ts",
    ...
  }
```

### User B Indexes (Same Code):
```
Code: function foo() { return 1; }
Hash: abc123 (same!)
Path: lib/helper.ts (different!)

Stored in Vectorize:
  ID: bob@company.com_bob-project_abc123
  Metadata: {
    projectId: "bob-project",
    userId: "bob@company.com",
    filePath: "lib/helper.ts",
    ...
  }
```

### Search Results:
- User A searches → Gets: `{filePath: "src/utils.ts"}` ✅
- User B searches → Gets: `{filePath: "lib/helper.ts"}` ✅

**No collision!** Each user has their own vector with correct metadata.

---

## Trade-offs (POC Phase)

### ✅ Benefits:
- **Complete isolation**: No metadata collisions
- **Simple**: Minimal code changes
- **Correct**: Each user gets their own data
- **Works immediately**: No complex caching logic

### ⚠️ Limitations (For Future):
- **No cost savings**: Every user calls AI (no embedding reuse)
- **Slower**: No cache hits for common code
- **Duplicate storage**: Same code embedded multiple times

---

## Migration Path (Production)

When ready for production optimization:

1. Add KV embedding cache layer (`embedding:{hash}` → `{summary, embedding}`)
2. Check cache before calling AI
3. Reuse cached embeddings with new user metadata
4. Keep composite ID format (no breaking changes)
5. Achieve 90%+ AI cost savings

---

## Testing

Test with two users indexing the same code:

```bash
# User A indexes
curl -X POST ".../v1/index/init" \
  -H "Authorization: Bearer dev-token-userA" \
  -d '{
    "projectId": "projectA",
    "chunks": [{"hash": "abc123", "code": "function foo() {}", "filePath": "src/utils.ts"}]
  }'

# User B indexes (same code, different path)
curl -X POST ".../v1/index/init" \
  -H "Authorization: Bearer dev-token-userB" \
  -d '{
    "projectId": "projectB",
    "chunks": [{"hash": "abc123", "code": "function foo() {}", "filePath": "lib/helper.ts"}]
  }'

# User A searches
curl -X POST ".../v1/search" \
  -H "Authorization: Bearer dev-token-userA" \
  -d '{"query": "foo function", "projectId": "projectA"}'
# Returns: filePath: "src/utils.ts" ✅

# User B searches
curl -X POST ".../v1/search" \
  -H "Authorization: Bearer dev-token-userB" \
  -d '{"query": "foo function", "projectId": "projectB"}'
# Returns: filePath: "lib/helper.ts" ✅
```

---

## Files Modified

1. `indexing-poc-worker-phase-2/src/lib/vectorize.ts`
2. `indexing-poc-worker-phase-2/src/routes/index-init.ts`
3. `indexing-poc-worker-phase-2/src/types.ts`

**Total:** 3 files, ~20 lines of code changed

---

## Next Steps

✅ Deploy to test environment
✅ Test with two different users/projects
✅ Verify search returns correct filePaths
⏳ Later: Add KV embedding cache for cost optimization
⏳ Later: Implement proper file deletion endpoint
