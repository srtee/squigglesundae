# Community Intro Post Search

A simple neural-network-based NLP solution for semantic search across community member introduction posts.

## Overview

This project enables members to search through introductory posts using thematic/keyword queries. It uses sentence embeddings (not LLMs) for semantic similarity search with metadata filtering.

## Features

- **Semantic Search** - Find posts by theme, not just keywords
- **Metadata Filtering** - Filter by member, location (city/country/region)
- **Serverless-Ready** - Individual post ingestion via CLI or cloud functions
- **Bulk Import** - Initialize with large corpus
- **No Drift** - Pre-trained static embeddings ensure fair treatment of early and late joiners

## Architecture

```
Posts → Embeddings (MiniLM) → Chroma DB → Search API
```

- **Embedding Model**: `all-MiniLM-L6-v2` (static, pre-trained)
- **Vector Store**: Chroma (persistent, local)
- **No fine-tuning**: Ensures no embedding drift over time

## Quick Start

### Setup

```bash
# Create virtual environment
uv venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install dependencies
uv pip install -r requirements.txt
```

### Import Sample Data

```bash
python3 scripts/bulk_init.py --input data/sample_corpus.jsonl
```

### Add New Post

```bash
python3 scripts/ingest_post.py \
  --post-id "p013" \
  --member-id "m013" \
  --member-name "New Member" \
  --text "My introduction text..." \
  --city "Boston" \
  --country "USA"
```

### Search

```python
from src.search import create_search_engine

engine = create_search_engine()

# Basic search
results = engine.search("hiking outdoors")

# With filters
results = engine.search(
    "machine learning",
    n_results=10,
    country="USA"
)
```

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/bulk_init.py` | Bulk import corpus (50% initialization) to local Chroma DB |
| `scripts/import_to_kv.py` | Bulk import to Cloudflare Workers KV |
| `scripts/import_to_kv_fast.py` | Faster parallel import to Workers KV |
| `scripts/ingest_post.py` | Add single new post |
| `scripts/test_workflow.py` | Run tests |

## Importing from Slack (Waves Archive)

If your community uses Slack and the Waves archive service, you can bulk import introduction posts.

### 1. Export from Waves

Export your Slack workspace data. Waves typically provides:
- JSON files per channel
- User directory with profile info
- Message files with timestamps

### 2. Identify Intro Posts

Look for posts in your #introductions or similar channel. Typical patterns:
- First-time posts from new members
- Posts matching your onboarding flow

### 3. Convert to JSONL Format

Create a conversion script or manually extract posts. Example:

```python
# convert_waves.py - Example conversion script
import json
import os

def convert_waves_export(waves_export_path, output_file):
    """Convert Waves Slack export to JSONL format."""
    
    with open(output_file, 'w') as out:
        # Load your Waves export files
        # Adjust based on Waves' actual format
        
        for channel_file in os.listdir(f"{waves_export_path}/channels"):
            if "introduction" not in channel_file.lower():
                continue
                
            with open(f"{waves_export_path}/channels/{channel_file}") as f:
                messages = json.load(f)
                
            for msg in messages:
                # Filter for intro posts (adjust criteria as needed)
                if is_intro_post(msg):
                    post = {
                        "post_id": msg.get("ts"),  # or generate UUID
                        "member_id": msg.get("user"),
                        "member_name": get_user_name(msg.get("user"), waves_export_path),
                        "text": msg.get("text"),
                        "city": get_user_field(msg.get("user"), "city", waves_export_path),
                        "country": get_user_field(msg.get("user"), "country", waves_export_path),
                        "region": get_user_field(msg.get("user"), "region", waves_export_path),
                    }
                    out.write(json.dumps(post) + '\n')

def is_intro_post(msg):
    """Determine if message is an intro post."""
    # Add your criteria - e.g., channel name, message patterns, etc.
    return True  # Adjust as needed
```

### 4. Import

```bash
# Local Chroma DB
python scripts/bulk_init.py --input data/converted_intros.jsonl

# Or to Cloudflare Workers KV
python scripts/import_to_kv_fast.py --input data/converted_intros.jsonl --env .env
```

### Tips

- **Deduplicate**: Check for duplicate posts by `post_id` or `member_id`
- **Text cleaning**: Remove @mentions, emojis, or URLs if needed
- **Metadata**: Extract location from user profiles in Waves user directory
- **Chunking**: If posts are very long, consider chunking before embedding

## Drift Prevention

This system uses **static pre-trained embeddings** (not fine-tuned on community data):
- All posts use identical embedding model
- No retraining = no model drift
- Early and late joiners have equal search quality
- Vocabulary extensions can be added later if needed without retraining

## Cloud Deployment

For serverless deployment (Lambda/GCF/Azure Functions), use `scripts/ingest_post.py` as the handler. The script accepts JSON input and writes to the vector database.

## Frontend

The frontend is a password-protected web interface for searching posts.

### Build & Deploy to GitHub Pages

#### Option 1: GitHub Actions (Recommended - secrets stored in GitHub)

1. Go to your repo Settings → Secrets and variables → Actions
2. Add these secrets:
   - `API_BASE` - Your Cloudflare Workers URL
   - `FRONTEND_PASSWORD` - Your desired password
3. Enable GitHub Pages: Settings → Pages → Source = GitHub Actions
4. Push to main - deployment will happen automatically

#### Option 2: Local Build

```bash
# Set environment variables
export API_BASE="https://your-worker.workers.dev"
export FRONTEND_PASSWORD="YourSecurePassword"

# Build and deploy to gh-pages
cd frontend
npm install
npm run deploy
```

### Configuration

| Secret | Required | Description |
|--------|----------|-------------|
| `API_BASE` | No | Cloudflare Workers URL. If not set, uses current domain. |
| `FRONTEND_PASSWORD` | No | Password for frontend access. If not set, uses default. |

### Password Protection

Password is stored in GitHub secrets (not in source code) and injected at build time.

Note: This is client-side protection only. For true security, implement authentication at the API level.

## License

MIT - See LICENSE file
