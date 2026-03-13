#!/usr/bin/env python3
"""
Import posts with pre-computed embeddings to Cloudflare KV.

Usage:
    python scripts/import_to_kv.py data/embeddings.jsonl -n YOUR_KV_NAMESPACE_ID

This script handles:
- post:{post_id} - Post metadata
- embedding:{post_id} - Binary embedding vector
- member_index:{member_id} - Post IDs by member
- location_index:city:{city} - Post IDs by city
- location_index:country:{country} - Post IDs by country
- location_index:region:{region} - Post IDs by region
- index:all_posts - All post IDs
"""

import argparse
import json
import os
import struct
import subprocess
import sys

try:
    from dotenv import load_dotenv
except ImportError:
    pass  # Optional, will work without it
else:
    load_dotenv()


def embed_to_bytes(embedding):
    """Convert float list to binary (Float32)"""
    return struct.pack("f" * len(embedding), *embedding)


def kv_get(key, namespace_id):
    """Get a KV key value"""
    result = subprocess.run(
        ["wrangler", "kv:key", "get", key, "--namespace-id", namespace_id, "--json"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return result.stdout
    return None


def kv_put(key, value, namespace_id):
    """Put a value into KV"""
    if isinstance(value, (dict, list)):
        with open("/tmp/kv_value.json", "w") as f:
            json.dump(value, f)
        subprocess.run(
            [
                "wrangler",
                "kv:key",
                "put",
                key,
                "--namespace-id",
                namespace_id,
                "--value-file",
                "/tmp/kv_value.json",
            ],
            check=True,
        )
    else:
        subprocess.run(
            [
                "wrangler",
                "kv:key",
                "put",
                key,
                "--namespace-id",
                namespace_id,
                "--value",
                str(value),
            ],
            check=True,
        )


def kv_put_binary(key, data, namespace_id):
    """Put binary data into KV"""
    with open("/tmp/kv_binary.bin", "wb") as f:
        f.write(data)
    subprocess.run(
        [
            "wrangler",
            "kv:key",
            "put",
            key,
            "--namespace-id",
            namespace_id,
            "--value-file",
            "/tmp/kv_binary.bin",
        ],
        check=True,
    )


def add_to_index(index_key, post_id, namespace_id):
    """Add a post_id to an index list"""
    existing = kv_get(index_key, namespace_id)
    if existing is None:
        post_ids = []
    elif isinstance(existing, list):
        post_ids = existing
    else:
        post_ids = [existing]

    if post_id not in post_ids:
        post_ids.append(post_id)
        kv_put(index_key, post_ids, namespace_id)


def import_posts(input_file, namespace_id, batch_size=50):
    imported = 0
    errors = 0

    with open(input_file) as f:
        posts = [json.loads(line) for line in f if line.strip()]

    total = len(posts)
    print(f"Importing {total} posts to KV namespace {namespace_id}")

    # First pass: import all posts and embeddings, collect all post IDs
    all_post_ids = []
    for i, post in enumerate(posts):
        try:
            post_id = post["post_id"]
            all_post_ids.append(post_id)

            metadata = {
                "post_id": post_id,
                "member_id": post["member_id"],
                "member_name": post["member_name"],
                "text": post["text"],
                "created_at": post.get("created_at", ""),
                "topics": post.get("topics", []),
                "location": post.get("location", {}),
            }

            # Store post metadata
            kv_put(f"post:{post_id}", metadata, namespace_id)

            # Store embedding as binary
            embedding = post["embedding"]
            embed_bytes = embed_to_bytes(embedding)
            kv_put_binary(f"embedding:{post_id}", embed_bytes, namespace_id)

            imported += 1
            if (i + 1) % batch_size == 0:
                print(f"Posts: {i + 1}/{total}")

        except Exception as e:
            print(f"Error importing {post.get('post_id', 'unknown')}: {e}")
            errors += 1

    print(f"Imported {imported} posts, building indexes...")

    # Second pass: build indexes
    for i, post in enumerate(posts):
        try:
            post_id = post["post_id"]
            member_id = post["member_id"]
            location = post.get("location", {})

            # Member index
            add_to_index(f"member_index:{member_id}", post_id, namespace_id)

            # Location indexes
            if location.get("city"):
                add_to_index(
                    f"location_index:city:{location['city'].lower()}",
                    post_id,
                    namespace_id,
                )
            if location.get("country"):
                add_to_index(
                    f"location_index:country:{location['country'].lower()}",
                    post_id,
                    namespace_id,
                )
            if location.get("region"):
                add_to_index(
                    f"location_index:region:{location['region'].lower()}",
                    post_id,
                    namespace_id,
                )

            if (i + 1) % batch_size == 0:
                print(f"Indexes: {i + 1}/{total}")

        except Exception as e:
            print(f"Error indexing {post.get('post_id', 'unknown')}: {e}")
            errors += 1

    # Update all_posts index
    existing_all = kv_get("index:all_posts", namespace_id)
    if existing_all is None:
        all_posts = all_post_ids
    elif isinstance(existing_all, list):
        all_posts = existing_all + [
            pid for pid in all_post_ids if pid not in existing_all
        ]
    else:
        all_posts = [existing_all] + all_post_ids
    kv_put("index:all_posts", all_posts, namespace_id)

    print(f"\nDone: {imported} imported, {errors} errors")
    print(f"Total posts in index: {len(all_posts)}")


def main():
    parser = argparse.ArgumentParser(description="Import posts to Cloudflare KV")
    parser.add_argument("input", help="Input JSONL file with embeddings")
    parser.add_argument(
        "--namespace-id",
        "-n",
        help="KV Namespace ID (or set CF_KV_NAMESPACE_ID in .env)",
    )
    parser.add_argument(
        "--batch-size", "-b", type=int, default=50, help="Batch size for progress"
    )
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: Input file {args.input} not found")
        sys.exit(1)

    namespace_id = args.namespace_id or os.environ.get("CF_KV_NAMESPACE_ID")
    if not namespace_id:
        print("Error: Provide --namespace-id or set CF_KV_NAMESPACE_ID in .env")
        sys.exit(1)

    import_posts(args.input, namespace_id, args.batch_size)


if __name__ == "__main__":
    main()
