# Cloudflare Workers Search System - Design Document

## Overview

This directory contains Cloudflare Workers serverless functions for a community intro post search system. The system provides semantic search capabilities for community introduction posts.

## Architecture Decisions

### 1. Embedding Handling in Edge Environment

**Problem**: Cloudflare Workers have limited CPU/memory (128MB) and cannot load heavy ML models like sentence-transformers (all-MiniLM-L6-v2 ~90MB).

**Solution**: Local embedding service running on your infrastructure, accessed via Cloudflare Tunnel.

```typescript
// Using local embedding service (your infrastructure)
export async function getEmbedding(text: string, env: Env): Promise<number[]> {
  const response = await fetch(`${env.EMBEDDING_SERVICE_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return response.json().embedding;
}
```

**Benefits**:
- Data stays on your infrastructure (privacy)
- No external API costs
- Uses same MiniLM model as local Python version (384 dimensions)
- You control the hardware

**Setup**:
- Run `services/embedding_service.py` on your home machine
- Expose via Cloudflare Tunnel (see DEPLOY.md)

### 2. Storage Approach

**Decision**: Workers KV for vector storage + in-memory cosine similarity.

**Why not Chroma/Vector DB?**
- Chroma requires Python runtime
- External vector DBs (Pinecone, Weaviate) add latency and cost

**Storage Schema in KV**:

| Key Pattern | Value Type | Description |
|-------------|------------|-------------|
| `post:{post_id}` | JSON | Post metadata |
| `embedding:{post_id}` | Binary (Float32Array) | Vector data |
| `member_index:{member_id}` | JSON array | Post IDs by member |
| `location_index:city:{city}` | JSON array | Post IDs by city |
| `location_index:country:{country}` | JSON array | Post IDs by country |
| `location_index:region:{region}` | JSON array | Post IDs by region |
| `index:all_posts` | JSON array | All post IDs |

**Trade-offs**:
- Pro: Zero external dependencies, fast reads from edge
- Con: Must iterate all candidates for similarity search
- Con: KV has 1MB value limit (handled by storing vectors as binary)

### 3. Environment Variables

Required variables for deployment:

```bash
# Your local embedding service (via Cloudflare Tunnel)
EMBEDDING_SERVICE_URL=https://embedding.yourdomain.com

# Auto-created by wrangler
VECTOR_STORE (KV namespace binding)
```

## API Endpoints

### Ingest Worker (`src/ingest.ts`)

```
POST / - Ingest a new post
Content-Type: application/json

{
  "post_id": "uuid",
  "member_id": "uuid", 
  "member_name": "John Doe",
  "text": "Hello, I'm from...",
  "location": { "city": "NYC", "country": "USA" },
  "created_at": "2024-01-01T00:00:00Z"
}
```

### Search Worker (`src/search.ts`)

```
GET /search?q=query&n=10&city=NYC
POST /search { "query": "...", "n_results": 10 }
GET /stats
GET /member/{member_id}
GET /health
```

## Deployment

```bash
cd workers
npm install

# Deploy ingest worker
wrangler deploy --config wrangler.toml src/ingest.ts

# Deploy search worker  
wrangler deploy --config search-wrangler.toml src/search.ts
```

## Pipeline Flow

```
[New Post] 
    |
    v
[POST to Ingest Worker]
    |
    v
[Call Embedding API] --> [Store in KV]
    |
    v
[Update indexes (member, location)]
```

```
[Search Query]
    |
    v
[GET /search?q=...]
    |
    v
[Call Embedding API for query]
    |
    v
[Fetch candidate posts from KV]
    |
    v
[Compute cosine similarity in Worker]
    |
    v
[Return sorted results]
```

## Limitations & Future Improvements

1. **Scale**: Current design works for ~10K posts. For larger scale:
   - Use Workers Durable Objects for vector index
   - Or migrate to Pinecone/Weaviate

2. **Embedding Model**: Switch from OpenAI to local model for:
   - Privacy (data stays in your infrastructure)
   - Cost reduction at scale
   - Use a separate Python Cloudflare Worker with the model

3. **Caching**: Consider caching:
   - Query embeddings (Durable Objects)
   - Frequently accessed posts (KV with longer TTL)
