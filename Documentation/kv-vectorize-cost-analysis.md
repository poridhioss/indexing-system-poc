# KV + Vectorize: Detailed Cost & Bandwidth Analysis

This document provides comprehensive cost and bandwidth calculations for the recommended **KV + Vectorize** architecture.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Assumptions](#assumptions)
3. [Bandwidth Analysis](#bandwidth-analysis)
4. [KV Cost Analysis](#kv-cost-analysis)
5. [Vectorize Cost Analysis](#vectorize-cost-analysis)
6. [OpenRouter API Costs](#openrouter-api-costs)
7. [Total Cost Summary](#total-cost-summary)
8. [Scaling Projections](#scaling-projections)
9. [Free Tier Coverage](#free-tier-coverage)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       KV + VECTORIZE ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CLOUDFLARE KV (INDEX_STATE)                                                │
│  ├── merkleRoot:{userId} → "abc123..."          # Per-user merkle root      │
│  ├── merkleRoot:{userId}:{projectId} → "..."    # Per-project root          │
│  └── chunkHash:{hash} → "1"                     # Global dedup cache        │
│                                                                              │
│  CLOUDFLARE VECTORIZE (CODE_EMBEDDINGS)                                     │
│  └── vectors: [{                                                            │
│        id: "{userId}:{projectId}:{chunkHash}",                              │
│        values: float[1024],                     # 1024-dim embedding        │
│        metadata: {                                                          │
│          userId: string,                                                    │
│          projectId: string,                                                 │
│          summary: string,                       # Natural language summary  │
│          type: "function" | "class" | "method",                             │
│          name: string,                                                      │
│          filePath: string,                      # Obfuscated path           │
│          lines: [start, end],                                               │
│          lastAccessed: timestamp                # For TTL cleanup           │
│        }                                                                    │
│      }]                                                                     │
│                                                                              │
│  CLIENT-SIDE (SQLite Cache)                                                 │
│  └── embeddings: {hash, summary, embedding, type, name, filePath, lines}    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Assumptions

### User & Usage Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Active users | 500 | Concurrent paying users |
| Projects per user | 3 | Average open projects |
| Sync interval | 10 minutes | Background sync frequency |
| Active hours per day | 8 | Typical work day |
| Syncs per user per day | 48 | 6 syncs/hour × 8 hours |
| Total syncs per month | 720,000 | 500 × 48 × 30 days |

### Codebase Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Files per project | 500 | Average source files |
| Chunks per file | 10 | Functions, classes, methods |
| Chunks per project | 5,000 | 500 files × 10 chunks |
| Chunks per user | 15,000 | 3 projects × 5,000 chunks |
| Total chunks (all users) | 7.5M | 500 users × 15,000 chunks |

### Data Size Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Average chunk size | 2 KB | Code snippet |
| Chunk hash size | 64 bytes | SHA-256 hex string |
| Merkle root size | 64 bytes | SHA-256 hex string |
| Summary size | 200 bytes | Natural language text |
| Embedding dimensions | 1024 | Codestral Embed output |
| Embedding size | 4 KB | 1024 × 4 bytes (float32) |
| Metadata size | 500 bytes | JSON metadata per vector |

### Change Frequency

| Parameter | Value | Notes |
|-----------|-------|-------|
| Files changed per sync | 2 | Typical edit session |
| Chunks changed per sync | 5 | ~2-3 chunks per changed file |
| New chunks per sync | 3 | Actually need embedding |
| Cached chunks per sync | 2 | Already have embedding |

---

## Bandwidth Analysis

### Per-Sync Bandwidth

#### Phase 1: Merkle Root Check
```
Request:  { merkleRoot: "64 bytes" }
Response: { changed: true/false, serverRoot: "64 bytes" }

Bandwidth: ~200 bytes per sync
```

#### Phase 2: Hash Check (If Changed)
```
Request:  {
  merkleRoot: "64 bytes",
  chunks: [
    { hash: "64 bytes", type: "10 bytes", name: "50 bytes", lines: [n,n] }
  ] × 5 chunks
}
Response: { needed: ["hash1", "hash2", "hash3"], cached: ["hash4", "hash5"] }

Bandwidth: ~1 KB per sync (5 chunks × 150 bytes + response)
```

#### Phase 3: Code Transfer (Only Needed Chunks)
```
Request:  {
  chunks: [
    { hash: "64 bytes", code: "2 KB", languageId: "20 bytes", type, name }
  ] × 3 chunks (only new ones)
}
Response: {
  received: ["hash1", "hash2", "hash3"],
  summaries: ["200 bytes each"] × 3,
  embeddings: [[1024 floats]] × 3
}

Request bandwidth:  ~6.5 KB (3 chunks × 2.2 KB each)
Response bandwidth: ~13 KB (3 × 4 KB embeddings + 3 × 200 bytes summaries)
```

### Bandwidth Summary Per Sync

| Phase | Direction | Size | Frequency |
|-------|-----------|------|-----------|
| Phase 1 (check) | Upload | 200 B | Every sync |
| Phase 1 (check) | Download | 200 B | Every sync |
| Phase 2 (hashes) | Upload | 1 KB | 50% of syncs |
| Phase 2 (hashes) | Download | 500 B | 50% of syncs |
| Phase 3 (code) | Upload | 6.5 KB | 50% of syncs |
| Phase 3 (code) | Download | 13 KB | 50% of syncs |

**Average bandwidth per sync: ~11 KB** (accounting for 50% no-change syncs)

### Monthly Bandwidth (500 Users)

| Metric | Calculation | Result |
|--------|-------------|--------|
| Syncs per month | 500 × 48 × 30 | 720,000 |
| Avg bandwidth per sync | 11 KB | 11 KB |
| **Total monthly bandwidth** | 720K × 11 KB | **~7.7 GB** |

### Bandwidth Comparison: Two-Phase vs Direct

| Approach | Data Sent | Monthly (500 users) |
|----------|-----------|---------------------|
| **Two-Phase Protocol** | ~11 KB/sync | ~7.7 GB |
| Direct (all chunks) | ~100 KB/sync | ~70 GB |
| **Savings** | | **90%** |

### Cloudflare Bandwidth Cost

| Tier | Bandwidth Limit | Cost |
|------|-----------------|------|
| Free | Unlimited | $0 |
| Pro | Unlimited | $0 |
| Business | Unlimited | $0 |

**Cloudflare bandwidth is FREE and unlimited.** This is a major advantage.

---

## KV Cost Analysis

### KV Operations Per Sync

| Operation | Count | When |
|-----------|-------|------|
| **Reads** | | |
| Get merkle root | 1 | Every sync |
| Check chunk hashes | 5 | When changed (50%) |
| **Writes** | | |
| Update merkle root | 1 | When changed (50%) |
| Store new chunk hashes | 3 | When changed (50%) |

### Monthly KV Operations

| Operation | Calculation | Monthly Total |
|-----------|-------------|---------------|
| Merkle root reads | 720K syncs × 1 | 720,000 |
| Hash check reads | 720K × 0.5 × 5 | 1,800,000 |
| **Total Reads** | | **2,520,000** |
| Merkle root writes | 720K × 0.5 × 1 | 360,000 |
| Hash writes | 720K × 0.5 × 3 | 1,080,000 |
| **Total Writes** | | **1,440,000** |

### KV Pricing

| Tier | Read Cost | Write Cost |
|------|-----------|------------|
| Free | 100K/day | 1K/day |
| Paid | $0.50/million | $5.00/million |

### Monthly KV Cost

| Component | Operations | Rate | Cost |
|-----------|------------|------|------|
| Reads | 2.52M | $0.50/M | $1.26 |
| Writes | 1.44M | $5.00/M | $7.20 |
| **Total KV** | | | **$8.46/month** |

### KV Storage

| Data Type | Per User | Total (500) | Size |
|-----------|----------|-------------|------|
| Merkle roots | 3 projects | 1,500 keys | ~100 KB |
| Chunk hashes | 15,000 | 7.5M keys | ~500 MB |

KV storage is included in the base pricing, no additional cost.

---

## Vectorize Cost Analysis

### Vectorize Dimensions

| Parameter | Value |
|-----------|-------|
| Embedding dimensions | 1024 |
| Vectors per user | 15,000 |
| Total vectors (500 users) | 7,500,000 |
| Total dimensions stored | 7.68 billion |

### Vectorize Operations Per Sync

| Operation | Count | When |
|-----------|-------|------|
| Vector upserts | 3 | New chunks (50% of syncs) |
| Vector queries | 0 | Only during search |

### Vectorize Pricing (Cloudflare)

| Component | Rate |
|-----------|------|
| Stored dimensions | $0.05 per million dimensions/month |
| Queried dimensions | $0.01 per million dimensions |
| Write operations | $0.01 per million mutations |

### Monthly Vectorize Cost (Storage)

| Component | Calculation | Cost |
|-----------|-------------|------|
| Stored dimensions | 7.68B dims × $0.05/M | **$384/month** |

**Wait - this is much higher than estimated!** Let me recalculate:

### Corrected Vectorize Storage Calculation

```
500 users × 15,000 vectors × 1024 dims = 7,680,000,000 dimensions
7.68B dims ÷ 1,000,000 = 7,680 million dimensions
7,680 × $0.05 = $384/month
```

This is significantly higher than our initial estimate. Let me verify Cloudflare Vectorize pricing:

### Cloudflare Vectorize Pricing (2024)

| Plan | Included | Overage |
|------|----------|---------|
| Workers Paid ($5/mo) | 5M stored vector dimensions | $0.04/M additional |
| | 50M queried dimensions | $0.035/M additional |

### Revised Vectorize Cost

| Component | Calculation | Cost |
|-----------|-------------|------|
| Base (Workers Paid) | Includes 5M dims | $5.00 |
| Additional storage | (7,680M - 5M) × $0.04 | $307.00 |
| **Total Vectorize** | | **$312/month** |

### Cost Reduction Strategies

#### Strategy 1: Reduce Vectors Per User

| Chunks/User | Total Dims | Monthly Cost |
|-------------|------------|--------------|
| 15,000 | 7.68B | $312 |
| 5,000 | 2.56B | $102 |
| 2,000 | 1.02B | $40 |
| 1,000 | 512M | $20 |

#### Strategy 2: TTL-Based Cleanup

Delete vectors for inactive projects (30 days):

| Active Projects | Vectors | Monthly Cost |
|-----------------|---------|--------------|
| 100% (all) | 7.5M | $312 |
| 50% active | 3.75M | $155 |
| 25% active | 1.875M | $75 |

#### Strategy 3: Lower Dimension Embeddings

| Dimensions | Storage | Monthly Cost |
|------------|---------|--------------|
| 1024 (default) | 7.68B | $312 |
| 512 | 3.84B | $155 |
| 256 | 1.92B | $77 |

#### Strategy 4: Client-Side Only (No Vectorize)

| Approach | Server Cost | Trade-off |
|----------|-------------|-----------|
| KV Only | $8.46/mo | No cross-device sync |
| KV + Vectorize | $320/mo | Full cross-device sync |

---

## OpenRouter API Costs

### Summarization (Qwen 2.5 Coder 32B)

| Parameter | Value |
|-----------|-------|
| Model | qwen/qwen-2.5-coder-32b-instruct |
| Input cost | $0.07 / 1M tokens |
| Output cost | $0.16 / 1M tokens |
| Avg chunk size | 500 tokens |
| Avg summary size | 50 tokens |

### Monthly Summarization Cost

| Component | Calculation | Cost |
|-----------|-------------|------|
| Chunks to summarize | 720K syncs × 0.5 × 3 chunks | 1.08M chunks |
| Input tokens | 1.08M × 500 tokens | 540M tokens |
| Output tokens | 1.08M × 50 tokens | 54M tokens |
| Input cost | 540M × $0.07/M | $37.80 |
| Output cost | 54M × $0.16/M | $8.64 |
| **Total Summarization** | | **$46.44/month** |

### Embeddings (Codestral Embed)

| Parameter | Value |
|-----------|-------|
| Model | mistralai/codestral-embed-2505 |
| Cost | $0.08 / 1M tokens |
| Avg summary size | 50 tokens |

### Monthly Embedding Cost

| Component | Calculation | Cost |
|-----------|-------------|------|
| Summaries to embed | 1.08M | |
| Tokens | 1.08M × 50 tokens | 54M tokens |
| **Total Embeddings** | 54M × $0.08/M | **$4.32/month** |

---

## Total Cost Summary

### Scenario A: Full Vectorize (All Vectors Stored)

| Component | Monthly Cost |
|-----------|--------------|
| Cloudflare Workers Paid | $5.00 |
| KV Operations | $8.46 |
| Vectorize Storage (7.68B dims) | $307.00 |
| Vectorize Queries | ~$2.00 |
| OpenRouter Summarization | $46.44 |
| OpenRouter Embeddings | $4.32 |
| **Total** | **~$373/month** |
| **Per User (500)** | **$0.75/user** |

### Scenario B: Reduced Vectors (2K per user)

| Component | Monthly Cost |
|-----------|--------------|
| Cloudflare Workers Paid | $5.00 |
| KV Operations | $8.46 |
| Vectorize Storage (1B dims) | $40.00 |
| Vectorize Queries | ~$2.00 |
| OpenRouter Summarization | $46.44 |
| OpenRouter Embeddings | $4.32 |
| **Total** | **~$106/month** |
| **Per User (500)** | **$0.21/user** |

### Scenario C: TTL Cleanup (25% Active)

| Component | Monthly Cost |
|-----------|--------------|
| Cloudflare Workers Paid | $5.00 |
| KV Operations | $8.46 |
| Vectorize Storage (1.9B dims) | $75.00 |
| Vectorize Queries | ~$2.00 |
| OpenRouter Summarization | $46.44 |
| OpenRouter Embeddings | $4.32 |
| **Total** | **~$141/month** |
| **Per User (500)** | **$0.28/user** |

### Scenario D: Client-Only (No Vectorize)

| Component | Monthly Cost |
|-----------|--------------|
| Cloudflare Workers Paid | $5.00 |
| KV Operations | $8.46 |
| OpenRouter Summarization | $46.44 |
| OpenRouter Embeddings | $4.32 |
| **Total** | **~$64/month** |
| **Per User (500)** | **$0.13/user** |

---

## Scaling Projections

### Cost at Different User Counts

| Users | KV Cost | Vectorize (TTL 25%) | OpenRouter | Total | Per User |
|-------|---------|---------------------|------------|-------|----------|
| 100 | $1.70 | $15 | $10 | $27 | $0.27 |
| 500 | $8.46 | $75 | $51 | $134 | $0.27 |
| 1,000 | $17 | $150 | $102 | $269 | $0.27 |
| 5,000 | $85 | $750 | $510 | $1,345 | $0.27 |
| 10,000 | $170 | $1,500 | $1,020 | $2,690 | $0.27 |

**Cost scales linearly with users.**

---

## Free Tier Coverage

### Cloudflare Free Tier

| Service | Free Limit | Our Usage (500 users) | Coverage |
|---------|------------|----------------------|----------|
| Workers requests | 100K/day | ~24K/day | ✅ Covered |
| KV reads | 100K/day | ~84K/day | ✅ Covered |
| KV writes | 1K/day | ~48K/day | ❌ Exceeded |
| Vectorize dims | 5M | 7.68B | ❌ Exceeded |

**Free tier insufficient for 500 users. Paid plan required.**

### Break-Even Point (Free Tier)

| Users | KV Writes/Day | Vectorize Dims | Free Tier? |
|-------|---------------|----------------|------------|
| 5 | 480 | 76.8M | ❌ No (Vectorize) |
| 10 | 960 | 153.6M | ❌ No |
| 1 | 96 | 15.4M | ❌ No |

**Vectorize exceeds free tier even for 1 user.** Must use paid plan.

---

## Recommendations

### For POC (1-10 Users)
- Use **KV Only** with client-side vectors
- Cost: ~$5/month (Workers Paid)
- No cross-device sync, but validates architecture

### For MVP (10-100 Users)
- Use **KV + Vectorize with aggressive TTL**
- Keep only 1,000 vectors per user (recent files)
- Cost: ~$30-50/month

### For Production (500+ Users)
- Use **KV + Vectorize with TTL cleanup**
- Implement 30-day inactive project cleanup
- Cost: ~$140/month for 500 users

### For Enterprise (1000+ Users)
- Consider **self-hosted vector DB** (Qdrant, Milvus)
- Or negotiate volume pricing with Cloudflare
- Cost: Depends on infrastructure

---

## Summary

| Metric | Value |
|--------|-------|
| **Architecture** | KV + Vectorize |
| **Bandwidth/sync** | ~11 KB |
| **Bandwidth/month** | ~7.7 GB (FREE) |
| **KV cost** | $8.46/month |
| **Vectorize cost** | $75-312/month (depends on TTL) |
| **OpenRouter cost** | ~$51/month |
| **Total (500 users)** | $134-373/month |
| **Per user** | $0.27-0.75 |

### Key Insights

1. **Bandwidth is FREE** - Cloudflare doesn't charge for bandwidth
2. **Vectorize storage is the largest cost** - 80% of infrastructure cost
3. **TTL cleanup is essential** - Reduces Vectorize cost by 75%
4. **OpenRouter costs are fixed** - Scale linearly with usage
5. **Two-phase protocol saves 90% bandwidth** - But bandwidth is free anyway
6. **Consider client-only for MVP** - $64/month vs $134-373/month
