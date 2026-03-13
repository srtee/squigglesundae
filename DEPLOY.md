# Deployment Guide

This guide walks through deploying the complete system: local embedding service behind CloudFlare Tunnel + Cloudflare Workers.

## Architecture

```
[New Post] → [Cloudflare Worker] → [Cloudflare Tunnel] → [Local Embedding Service (home machine)]
                                                                         ↓
[Search] → [Cloudflare Worker] ←────────────────────────────────────── [Local Vector Store (home machine)]
```

## Prerequisites

- Home machine with Python 3.11+
- Cloudflare account
- Domain name managed by Cloudflare
- Cloudflare Tunnel installed on home machine (`cloudflared`)

---

## Part 1: Local Embedding Service

### 1.1 Install Dependencies

On your home machine:

```bash
# Clone repo and set up Python environment
cd squigglesundae
uv venv
source .venv/bin/activate

# Install embedding service dependencies
uv pip install -r requirements.txt
uv pip install fastapi uvicorn
```

### 1.2 Start Embedding Service

```bash
# Start the service on port 8080
python services/embedding_service.py
```

The service provides:
- `GET /health` - Health check
- `POST /embed` - Single text embedding
- `POST /embed_batch` - Batch embeddings

---

## Part 2: CloudFlare Tunnel

### 2.1 Install cloudflared

```bash
# macOS
brew install cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### 2.2 Authenticate

```bash
cloudflared tunnel login
```

This opens browser for Cloudflare authentication.

### 2.3 Create Tunnel

```bash
# Create tunnel named "home-services"
cloudflared tunnel create home-services
```

Note the tunnel ID (UUID) in the output.

### 2.4 Configure Tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_UUID>
protocol: http2
ingress:
  - hostname: embedding.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

### 2.5 Point Domain to Tunnel

```bash
# Create DNS CNAME record
cloudflared tunnel route dns home-services embedding.yourdomain.com
```

### 2.6 Start Tunnel

```bash
cloudflared tunnel run home-services
```

Or as a service (recommended for production):
```bash
sudo cloudflared service install
```

---

## Part 3: Cloudflare Workers

### 3.1 Create KV Namespace

```bash
cd workers
npm install

# Create KV namespace
wrangler kv:namespace create VECTOR_STORE
```

Copy the namespace ID to `wrangler.toml` (replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`).

### 3.2 Configure Environment Variables

Set `EMBEDDING_SERVICE_URL` in wrangler.toml or via secrets:

```bash
# Set secret (recommended for production)
wrangler secret put EMBEDDING_SERVICE_URL
# Enter: https://embedding.yourdomain.com
```

### 3.3 Deploy Workers

```bash
# Deploy combined worker (ingest + search in one)
wrangler deploy --config combined-wrangler.toml
```

Or deploy individually:
```bash
wrangler deploy --config wrangler.toml        # Ingest only
wrangler deploy --config search-wrangler.toml # Search only
```

### 3.4 Test Deployment

```bash
# Health check
curl https://your-worker.subdomain.workers.dev/health

# Ingest a post
curl -X POST https://your-worker.subdomain.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{
    "post_id": "test-001",
    "member_id": "member-001",
    "member_name": "Test User",
    "text": "I love hiking and photography",
    "location": {"city": "Seattle", "country": "USA"},
    "created_at": "2024-01-01T00:00:00Z"
  }'

# Search
curl "https://your-worker.subdomain.workers.dev/search?q=outdoor%20activities"
```

---

## Part 4: Initial Data Import

### 4.1 Bulk Import via Python (Local)

For the initial 50% corpus, use the local Python tools:

```bash
# Generate embeddings and store locally
python scripts/bulk_init.py --input data/your_corpus.jsonl --persist-dir ./data/chroma_db
```

### 4.2 Import to Cloudflare KV

For searching via Workers, you need to import to KV. Create an import script:

```python
# scripts/import_to_kv.py (create this)
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.embeddings import EmbeddingGenerator
from src.storage import VectorStore
from workers.src.lib import (
    getEmbedding, serializeEmbedding, buildPostKey, 
    buildEmbeddingKey, buildMemberIndexKey, buildLocationIndexKey,
    Env
)

# This would use wrangler to upload to KV
# Or use Cloudflare API directly
```

Note: The current Workers implementation stores everything in KV. For large-scale data, consider:
- Using Workers Durable Objects for vector index
- Or keeping the Python/Chroma backend and having Workers query it via HTTP

---

## Environment Summary

| Component | URL | Environment Variable |
|-----------|-----|---------------------|
| Embedding Service | `https://embedding.yourdomain.com` | `EMBEDDING_SERVICE_URL` |
| Vector Store | Cloudflare KV | `VECTOR_STORE` (binding) |

---

## Troubleshooting

### Embedding service unreachable
```bash
# Check tunnel status
cloudflared tunnel info home-services

# Check service is running
curl http://localhost:8080/health
```

### Workers can't reach embedding service
```bash
# Verify DNS
dig embedding.yourdomain.com

# Check SSL certificate
curl -v https://embedding.yourdomain.com/health
```

### KV errors
```bash
# List KV keys
wrangler kv:key list --namespace-id <ID>
```

---

## Security Notes

- Embedding service runs on your infrastructure - data never leaves your control
- Use HTTPS (cloudflared handles TLS)
- Consider adding API key authentication to embedding service
- Workers KV has built-in Cloudflare security
