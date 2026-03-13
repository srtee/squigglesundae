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
| `scripts/bulk_init.py` | Bulk import corpus (50% initialization) |
| `scripts/ingest_post.py` | Add single new post |
| `scripts/test_workflow.py` | Run tests |

## Drift Prevention

This system uses **static pre-trained embeddings** (not fine-tuned on community data):
- All posts use identical embedding model
- No retraining = no model drift
- Early and late joiners have equal search quality
- Vocabulary extensions can be added later if needed without retraining

## Cloud Deployment

For serverless deployment (Lambda/GCF/Azure Functions), use `scripts/ingest_post.py` as the handler. The script accepts JSON input and writes to the vector database.

## License

MIT - See LICENSE file
