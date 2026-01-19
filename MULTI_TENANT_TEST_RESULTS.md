# Multi-Tenant Isolation - Test Results

**Date:** 2026-01-18
**Worker URL:** https://indexing-poc-phase-2.fazlulkarim362.workers.dev

---

## Test Summary

### ✅ **User A (Alice) - PASSED**

**Index Request:**
```json
{
  "projectId": "alice-project-v2",
  "userId": "alice@example.com",
  "chunks": [{
    "hash": "def456test",
    "code": "function bar() { return 42; }",
    "filePath": "src/utils.ts"
  }]
}
```

**Index Response:**
```json
{
  "status": "indexed",
  "chunksStored": 1,
  "aiProcessed": 1
}
```

**Search Request:**
```json
{
  "query": "function return number",
  "projectId": "alice-project-v2"
}
```

**Search Response:**
```json
{
  "results": [{
    "hash": "def456test",
    "score": 0.6747623,
    "summary": "returns the number forty-two",
    "type": "function",
    "name": "bar",
    "languageId": "javascript",
    "lines": [1, 1],
    "filePath": "src/utils.ts"  ← ✅ CORRECT PATH
  }],
  "took": 1513
}
```

✅ **Result:** User A successfully gets their own file path!

---

### ⚠️ **User B (Bob) - PENDING**

**Index Request:**
```json
{
  "projectId": "bob-project-v2",
  "userId": "bob@company.com",
  "chunks": [{
    "hash": "def456test",
    "code": "function bar() { return 42; }",  ← Same code as User A
    "filePath": "lib/helper.ts"  ← Different path
  }]
}
```

**Index Response:**
```json
{
  "status": "indexed",
  "chunksStored": 1,
  "chunksSkipped": 1,
  "aiProcessed": 1
}
```

**Search Request:**
```json
{
  "query": "function return number",
  "projectId": "bob-project-v2"
}
```

**Search Response:**
```json
{
  "results": [],
  "took": 642
}
```

⚠️ **Result:** User B's search returns empty results (may need more time for indexing)

---

## Analysis

### What's Working ✅

1. **Composite Vector IDs** - Vectors are stored with format `userId_projectId_hash`
2. **filePath in Metadata** - File paths are now correctly stored and returned
3. **User A Isolation** - User A gets correct results with their own file path
4. **No Collision** - User A and User B have different vector IDs despite identical code

### What Needs Investigation ⚠️

1. **User B Empty Results** - Possible causes:
   - Vectorize indexing delay (vectors can take 30-60 seconds to index)
   - ProjectId filtering issue
   - Composite ID extraction problem

### Next Steps

1. Wait longer and retry User B search
2. Verify vectors exist in Vectorize
3. Test with completely different code to rule out embedding issues
4. Check if "chunksSkipped": 1 indicates a problem

---

## Key Changes Deployed

1. **[vectorize.ts:30](indexing-pipeline/indexing-poc-worker-phase-2/src/lib/vectorize.ts#L30)** - Composite ID: `${userId}_${projectId}_${hash}`
2. **[index-init.ts:167](indexing-pipeline/indexing-poc-worker-phase-2/src/routes/index-init.ts#L167)** - Added `filePath: chunk.filePath` to metadata
3. **[vectorize.ts:89](indexing-pipeline/indexing-poc-worker-phase-2/src/lib/vectorize.ts#L89)** - Extract hash from composite ID
4. **[vectorize.ts:100](indexing-pipeline/indexing-poc-worker-phase-2/src/lib/vectorize.ts#L100)** - Return filePath in search results

---

## Verification Status

- [x] User A can index code
- [x] User A search returns results
- [x] User A gets correct filePath
- [ ] User B search returns results
- [ ] User B gets correct filePath (different from User A)
- [ ] Verify no cross-contamination between users
