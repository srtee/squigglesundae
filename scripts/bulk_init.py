#!/usr/bin/env python3
"""
Bulk initialization script for processing initial 50% of corpus.
Run locally with large corpus: python scripts/bulk_init.py --input data/corpus.jsonl

This script:
1. Reads posts from input file
2. Generates embeddings using pre-trained model (no fine-tuning = no drift)
3. Saves embeddings for import to vector DB
"""

import argparse
import json
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.embeddings import EmbeddingGenerator
from src.storage import VectorStore


def load_posts(input_file: str, limit: int = None) -> list[dict]:
    posts = []
    with open(input_file, 'r') as f:
        for line in f:
            if line.strip():
                posts.append(json.loads(line))
                if limit and len(posts) >= limit:
                    break
    return posts


def generate_embeddings(posts: list[dict], embed_gen: EmbeddingGenerator) -> list[dict]:
    texts = [p["text"] for p in posts]
    print(f"Generating embeddings for {len(texts)} posts...")
    
    embeddings = embed_gen.encode(texts, batch_size=64)
    
    for i, post in enumerate(posts):
        post["embedding"] = embeddings[i].tolist()
    
    return posts


def import_to_vector_db(posts: list[dict], persist_dir: str):
    print(f"Importing {len(posts)} posts to vector DB at {persist_dir}...")
    
    embed_gen = EmbeddingGenerator()
    vec_store = VectorStore(persist_dir)
    vec_store.initialize(embed_gen.embedding_dimension)
    
    batch_size = 100
    for i in range(0, len(posts), batch_size):
        batch = posts[i:i+batch_size]
        vec_store.add_posts(batch)
        print(f"Imported {min(i+batch_size, len(posts))}/{len(posts)} posts")
    
    print(f"Total posts in DB: {vec_store.count()}")
    return vec_store


def save_embeddings(posts: list[dict], output_file: str):
    with open(output_file, 'w') as f:
        for post in posts:
            f.write(json.dumps(post) + '\n')
    print(f"Saved {len(posts)} embeddings to {output_file}")


def main():
    parser = argparse.ArgumentParser(description="Bulk initialize embeddings from corpus")
    parser.add_argument("--input", required=True, help="Input JSONL file with posts")
    parser.add_argument("--output", help="Output file for embeddings (optional)")
    parser.add_argument("--persist-dir", default="./data/chroma_db", help="Vector DB directory")
    parser.add_argument("--limit", type=int, help="Limit number of posts to process")
    parser.add_argument("--skip-db", action="store_true", help="Only generate embeddings, don't import to DB")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"Error: Input file {args.input} not found")
        sys.exit(1)
    
    print(f"Loading posts from {args.input}...")
    posts = load_posts(args.input, args.limit)
    print(f"Loaded {len(posts)} posts")
    
    embed_gen = EmbeddingGenerator()
    print(f"Using embedding model: {embed_gen.model_name}")
    print(f"Embedding dimension: {embed_gen.embedding_dimension}")
    
    posts = generate_embeddings(posts, embed_gen)
    
    if args.output:
        save_embeddings(posts, args.output)
    
    if not args.skip_db:
        import_to_vector_db(posts, args.persist_dir)
    
    print("Bulk initialization complete!")


if __name__ == "__main__":
    main()
