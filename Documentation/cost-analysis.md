# Cost Analysis & Architecture Options

This document provides detailed cost analysis for the Puku indexing system using Cloudflare services. Use this as a reference for architecture decisions.

## Table of Contents

1. [Assumptions](#assumptions)
2. [Cloudflare Services Overview](#cloudflare-services-overview)
3. [Architecture Options](#architecture-options)
   - [Option 1: KV + Vectorize](#option-1-kv--vectorize-recommended)
   - [Option 2: KV + D1](#option-2-kv--d1-no-server-vectors)
   - [Option 3: KV Only](#option-3-kv-only-minimal)
4. [Cost Comparison](#cost-comparison)
5. [Free Tier Limits](#cloudflare-free-tier-limits)
6. [Storage Service Analysis](#storage-service-analysis)
7. [Decision Matrix](#decision-matrix)
8. [Recommended Architecture](#recommended-architecture)

---

## Assumptions

Base parameters for cost calculations (500 active users):

| Parameter | Value | Notes |
|-----------|-------|-------|
| Active users | 500 | Concurrent paying users |
| Sync interval | 10 minutes | Periodic sync frequency |
| Syncs per user per day | 48 | 6 syncs/hour × 8 hours |
| Total syncs per month | 720,000 | 500 × 48 × 30 |
| Chunks per user | 50,000 | Average codebase size |
| Changed chunks per sync | ~5 | Typical edit session |
| Vector dimensions | 1024 | Codestral Embed output |
| Avg chunk size | 2 KB | Code snippet size |

---

## Cloudflare Services Overview

### Pricing Comparison

| Service | Purpose | Read Cost | Write Cost | Storage Cost | Best For |
|---------|---------|-----------|------------|--------------|----------|
| **KV** | Key-value store | $0.50/M | $5.00/M | $0.50/GB | Fast lookups, cache |
| **D1** | SQLite database | $0.75/M rows | $1.00/M rows | $0.75/GB | Structured queries |
| **Vectorize** | Vector database | $0.01/M queries | $0.01/M mutations | $0.05/M dims | Similarity search |
| **R2** | Object storage | $0.36/M Class B | $0.36/M Class A | $0.015/GB | Large files |

### Key Characteristics

| Service | Latency | Query Capability | Max Value Size |
|---------|---------|------------------|----------------|
| **KV** | ~50ms (global) | Key lookup only | 25 MB |
| **D1** | ~10ms (regional) | Full SQL | 2 GB database |
| **Vectorize** | ~20ms | Similarity search | 1M vectors/index |
| **R2** | ~50ms | None (object key) | 5 TB/object |

---

## Architecture Options

### Option 1: KV + Vectorize (Recommended)

**Best for**: Production systems needing cross-device sync and server-side search.

```
┌─────────────────────────────────────────────────────────────────┐
│                    KV + VECTORIZE ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  KV Namespace: INDEX_STATE                                      │
│  ├── merkleRoot:{userId} → "abc123..."     # Per-user root      │
│  └── chunkHash:{hash} → "1"                # Global dedup cache │
│                                                                  │
│  Vectorize Index: CODE_EMBEDDINGS                               │
│  └── vectors: [{                                                │
│        id: "{userId}:{chunkHash}",                              │
│        values: [0.1, 0.2, ...],           # 1024 dimensions     │
│        metadata: {                                              │
│          userId, summary, type, name, filePath, lines           │
│        }                                                        │
│      }]                                                         │
│                                                                  │
│  CLIENT-SIDE (SQLite):                                          │
│  └── embeddings table (cache):                                  │
│      {hash, summary, embedding, type, name, filePath, lines}    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Cost Breakdown (500 Users, 10-min Sync)

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **KV Reads** | 720K syncs × 6 reads/sync = 4.32M | $2.16 |
| **KV Writes** | 720K syncs × 0.6 writes/sync = 432K | $2.16 |
| **Vectorize Storage** | 500 users × 50K vectors × 1024 dims = 25.6B dims | ~$25.00 |
| **Vectorize Queries** | 720K syncs × 2 queries = 1.44M | ~$1.44 |
| **Vectorize Writes** | 720K syncs × 5 upserts = 3.6M | ~$3.60 |
| **Total** | | **~$34/month** |

#### Pros & Cons

| Pros | Cons |
|------|------|
| Native vector similarity search | Higher cost ($34 vs $6) |
| Cross-device sync (vectors on server) | Vectorize still in beta |
| Fast semantic search at query time | More complex architecture |
| No large client-side storage needed | Vendor lock-in to Cloudflare |

---

### Option 2: KV + D1 (No Server Vectors)

**Best for**: Budget-conscious deployments where cross-device sync isn't critical.

```
┌─────────────────────────────────────────────────────────────────┐
│                      KV + D1 ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  KV Namespace: INDEX_STATE                                      │
│  ├── merkleRoot:{userId} → "abc123..."     # Per-user root      │
│  └── chunkHash:{hash} → "1"                # Global dedup cache │
│                                                                  │
│  D1 Database: INDEX_METADATA                                    │
│  └── sync_history table:                                        │
│      {userId, syncedAt, chunksProcessed, status}                │
│                                                                  │
│  CLIENT-SIDE (SQLite):                                          │
│  └── embeddings table (PRIMARY storage):                        │
│      {hash, summary, embedding, type, name, filePath, lines}    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Cost Breakdown (500 Users, 10-min Sync)

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **KV Reads** | 720K syncs × 6 reads = 4.32M | $2.16 |
| **KV Writes** | 720K syncs × 0.6 writes = 432K | $2.16 |
| **D1 Reads** | 720K syncs × 1 read = 720K | $0.54 |
| **D1 Writes** | 720K syncs × 1 write = 720K | $0.72 |
| **Total** | | **~$6/month** |

#### Pros & Cons

| Pros | Cons |
|------|------|
| Much cheaper ($6 vs $34) | No cross-device sync |
| Simpler architecture | Client stores ~200MB vectors/project |
| Full SQL queries on metadata | No server-side semantic search |
| Client has full control | Vectors lost if client cache cleared |

---

### Option 3: KV Only (Minimal)

**Best for**: POC/testing or minimal viable product.

```
┌─────────────────────────────────────────────────────────────────┐
│                      KV ONLY ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  KV Namespace: INDEX_STATE                                      │
│  ├── merkleRoot:{userId} → "abc123..."     # Per-user root      │
│  └── chunkHash:{hash} → "1"                # Global dedup cache │
│                                                                  │
│  CLIENT-SIDE (SQLite):                                          │
│  └── embeddings table:                                          │
│      {hash, summary, embedding, type, name, filePath, lines}    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Cost Breakdown (500 Users, 10-min Sync)

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **KV Reads** | 4.32M | $2.16 |
| **KV Writes** | 432K | $2.16 |
| **Total** | | **~$5/month** |

#### Pros & Cons

| Pros | Cons |
|------|------|
| Cheapest option | No server-side metadata |
| Simplest architecture | No cross-device sync |
| Fast hash lookups | No audit trail |
| Easy to implement | Limited analytics capability |

---

## Cost Comparison

### Side-by-Side Summary

| Option | Monthly Cost | Per User | Cross-Device | Server Search | Complexity |
|--------|--------------|----------|--------------|---------------|------------|
| **KV + Vectorize** | ~$34 | $0.068 | Yes | Yes | Medium |
| **KV + D1** | ~$6 | $0.012 | No | No | Low |
| **KV Only** | ~$5 | $0.010 | No | No | Lowest |

### Per-User Cost with $50/month Budget

| Budget Item | KV+Vectorize | KV+D1 | KV Only |
|-------------|--------------|-------|---------|
| Cloudflare Infrastructure | $34 | $6 | $5 |
| OpenRouter (Summarization) | $10 | $10 | $10 |
| OpenRouter (Embeddings) | $6 | $6 | $6 |
| **Total** | **$50** | **$22** | **$21** |
| **Per User (500 users)** | **$0.10** | **$0.044** | **$0.042** |

### Scaling Costs

| Users | KV+Vectorize | KV+D1 | KV Only |
|-------|--------------|-------|---------|
| 100 | ~$10 | ~$2 | ~$1 |
| 500 | ~$34 | ~$6 | ~$5 |
| 1,000 | ~$65 | ~$12 | ~$10 |
| 5,000 | ~$320 | ~$55 | ~$45 |
| 10,000 | ~$640 | ~$110 | ~$90 |

---

## Cloudflare Free Tier Limits

| Service | Free Tier Limit | Monthly Equivalent | Sufficient For |
|---------|-----------------|-------------------|----------------|
| **Workers** | 100K requests/day | ~3M/month | POC testing |
| **KV Reads** | 100K/day | ~3M/month | ~200 users |
| **KV Writes** | 1K/day | ~30K/month | ~20 users |
| **D1 Reads** | 5M/day | ~150M/month | Very generous |
| **D1 Writes** | 100K/day | ~3M/month | ~200 users |
| **D1 Storage** | 5 GB | 5 GB | ~50 users |
| **Vectorize Queries** | 30M dims/month | ~30K queries | ~20 users |
| **Vectorize Storage** | 5M dims | ~5K vectors | Testing only |
| **Bandwidth** | Unlimited | Unlimited | All users |

### Free Tier Sufficiency

| Use Case | Free Tier Supports? |
|----------|---------------------|
| Local development | Yes |
| POC with 10 users | Yes |
| Beta with 50 users | Partial (KV writes limited) |
| Production 500+ users | No (paid plan required) |

---

## Storage Service Analysis

### R2 Scope Analysis

| Use Case | R2 Suitable? | Recommendation |
|----------|--------------|----------------|
| Vector embeddings | No | No query capability |
| Hash cache | No | KV is faster |
| Merkle roots | No | KV is simpler |
| Large file backups | Yes | Project snapshots |
| WASM binaries | Yes | Tree-sitter grammars |
| Audit logs (historical) | Yes | Compressed sync logs |
| Code snapshots | Yes | Version history |

**Verdict**: R2 is **not needed** for core indexing pipeline. Consider for auxiliary features only.

### Why Not D1 for Vectors?

| Aspect | D1 | Vectorize |
|--------|-----|-----------|
| Vector search | Manual (slow) | Native (fast) |
| Similarity queries | Not supported | Built-in |
| Storage efficiency | Poor for BLOBs | Optimized |
| Query latency | ~10ms + compute | ~20ms total |

D1 would require storing vectors as BLOBs and computing similarity in application code - inefficient and slow.

### Why Not KV for Vectors?

| Aspect | KV | Vectorize |
|--------|-----|-----------|
| Storage model | Key-value only | Vector index |
| Similarity search | Not possible | Native |
| Batch queries | Sequential | Parallel |
| Metadata filtering | Not possible | Supported |

KV cannot perform similarity search - you'd need to fetch ALL vectors and compute locally.

---

## Decision Matrix

### Quick Reference

| If You Need... | Choose | Monthly Cost |
|----------------|--------|--------------|
| Cross-device vector sync | KV + Vectorize | ~$34 |
| Server-side semantic search | KV + Vectorize | ~$34 |
| Lowest cost, client-side vectors | KV Only | ~$5 |
| Audit trail + cheap | KV + D1 | ~$6 |
| Future scalability | KV + Vectorize | ~$34 |
| POC/MVP | KV Only | ~$5 |

### Feature Comparison

| Feature | KV+Vectorize | KV+D1 | KV Only |
|---------|--------------|-------|---------|
| Merkle root storage | Yes | Yes | Yes |
| Hash deduplication | Yes | Yes | Yes |
| Server-side vectors | Yes | No | No |
| Cross-device sync | Yes | No | No |
| Semantic search (server) | Yes | No | No |
| Audit trail | Yes | Yes | No |
| Client-side search | Yes | Yes | Yes |
| Offline capability | Partial | Full | Full |

---

## Recommended Architecture

### POC Phase (Testing)

```
SERVER:
└── In-memory stores (no Cloudflare dependencies)
    ├── Map<userId, merkleRoot>
    └── Set<chunkHash>

CLIENT:
└── SQLite cache for embeddings
```

**Cost**: $0 (local development only)

### MVP Phase (Early Users)

```
SERVER (Cloudflare):
├── KV: merkleRoot:{userId}, chunkHash:{hash}
└── (No Vectorize yet)

CLIENT:
└── SQLite: primary vector storage
```

**Cost**: ~$5/month for 500 users

### Production Phase (Scale)

```
SERVER (Cloudflare):
├── KV: merkleRoot:{userId}, chunkHash:{hash}
└── Vectorize: {userId}:{hash} → embedding + metadata

CLIENT:
└── SQLite: local cache for fast search
```

**Cost**: ~$34/month for 500 users

### Final Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRODUCTION ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SERVER (Cloudflare):                                           │
│  ├── KV: merkleRoot:{userId}, chunkHash:{hash}                  │
│  └── Vectorize: {userId}:{hash} → embedding + metadata          │
│                                                                  │
│  CLIENT (Local):                                                │
│  └── SQLite: {hash, summary, embedding, ...} (cache)            │
│                                                                  │
│  FLOW:                                                          │
│  1. Client computes chunks → sends hashes                       │
│  2. Server checks KV → returns needed hashes                    │
│  3. Client sends code for needed chunks                         │
│  4. Server generates summaries + embeddings                     │
│  5. Server stores in Vectorize, returns to client               │
│  6. Client caches in SQLite for fast local search               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary

| Phase | Architecture | Monthly Cost | Users Supported |
|-------|--------------|--------------|-----------------|
| POC | In-memory | $0 | Local only |
| MVP | KV Only | ~$5 | 500 |
| Production | KV + Vectorize | ~$34 | 500 |
| Scale | KV + Vectorize | ~$640 | 10,000 |

**Recommended path**: Start with KV Only for MVP, migrate to KV + Vectorize when cross-device sync becomes a priority.
