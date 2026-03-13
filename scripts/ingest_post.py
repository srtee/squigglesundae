#!/usr/bin/env python3
"""
Serverless/new post ingestion script.
Can be run as: python scripts/ingest_post.py --post-id "123" --member-id "m1" --text "Hello..."

Or integrated with cloud functions (AWS Lambda, GCP Cloud Functions, etc.)
"""

import argparse
import json
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.embeddings import EmbeddingGenerator
from src.storage import VectorStore


def ingest_post(
    post_id: str,
    member_id: str,
    member_name: str,
    text: str,
    city: str = None,
    country: str = None,
    region: str = None,
    persist_dir: str = "./data/chroma_db"
):
    print(f"Processing post {post_id} for member {member_id}")
    
    embed_gen = EmbeddingGenerator()
    embed_gen.load_model()
    
    embedding = embed_gen.encode_single(text)
    print(f"Generated embedding: {len(embedding)} dimensions")
    
    vec_store = VectorStore(persist_dir)
    vec_store.initialize(embed_gen.embedding_dimension)
    
    created_at = datetime.utcnow().isoformat()
    
    vec_store.add_post(
        post_id=post_id,
        text=text,
        embedding=embedding,
        member_id=member_id,
        member_name=member_name,
        created_at=created_at,
        city=city,
        country=country,
        region=region
    )
    
    print(f"Successfully ingested post {post_id}. Total posts: {vec_store.count()}")
    return {"status": "success", "post_id": post_id, "embedding_dim": len(embedding)}


def ingest_from_json(post_json: str, persist_dir: str = "./data/chroma_db"):
    post = json.loads(post_json)
    return ingest_post(
        post_id=post["post_id"],
        member_id=post["member_id"],
        member_name=post["member_name"],
        text=post["text"],
        city=post.get("city"),
        country=post.get("country"),
        region=post.get("region"),
        persist_dir=persist_dir
    )


def main():
    parser = argparse.ArgumentParser(description="Ingest a new intro post")
    parser.add_argument("--post-id", help="Post ID")
    parser.add_argument("--member-id", help="Member ID")
    parser.add_argument("--member-name", help="Member display name")
    parser.add_argument("--text", help="Post text content")
    parser.add_argument("--city", help="City")
    parser.add_argument("--country", help="Country")
    parser.add_argument("--region", help="Region")
    parser.add_argument("--json", help="Post as JSON string")
    parser.add_argument("--persist-dir", default="./data/chroma_db", help="Vector DB directory")
    
    args = parser.parse_args()
    
    if args.json:
        result = ingest_from_json(args.json, args.persist_dir)
    elif args.post_id and args.member_id and args.text:
        result = ingest_post(
            post_id=args.post_id,
            member_id=args.member_id,
            member_name=args.member_name or args.member_id,
            text=args.text,
            city=args.city,
            country=args.country,
            region=args.region,
            persist_dir=args.persist_dir
        )
    else:
        parser.print_help()
        sys.exit(1)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()
