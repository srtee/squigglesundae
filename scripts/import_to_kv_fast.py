#!/usr/bin/env python3
"""
Fast batch import to Cloudflare KV using the API directly.

Usage:
    export CF_API_TOKEN=your_token
    export CF_ACCOUNT_ID=your_account_id
    python scripts/import_to_kv_fast.py data/embeddings.jsonl -n YOUR_KV_NAMESPACE_ID

Install dependencies:
    pip install requests
"""

import argparse
import json
import os
import struct
import sys
import time

try:
    import requests
    from dotenv import load_dotenv
except ImportError:
    print("Error: Missing dependencies. Run: pip install requests python-dotenv")
    sys.exit(1)

load_dotenv()


def embed_to_bytes(embedding):
    """Convert float list to binary (Float32)"""
    return struct.pack("f" * len(embedding), *embedding)


def base64_encode(data):
    """Base64 encode binary data"""
    import base64

    return base64.b64encode(data).decode()


class CloudflareKV:
    def __init__(self, namespace_id, account_id=None, api_token=None):
        self.namespace_id = namespace_id
        self.account_id = account_id or os.environ.get("CF_ACCOUNT_ID")
        self.api_token = api_token or os.environ.get("CF_API_TOKEN")
        self.base_url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/storage/kv/namespaces/{namespace_id}"
        self.headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

    def bulk_write(self, writes):
        """
        writes: list of {"key": "...", "value": "...", "base64": bool}
        Max 10,000 keys per call
        """
        url = f"{self.base_url}/bulk"
        payload = {"items": writes}

        response = requests.put(url, headers=self.headers, json=payload)
        if not response.ok:
            print(f"Bulk write error: {response.status_code} - {response.text}")
            return False
        return True

    def bulk_read(self, keys):
        """Read multiple keys at once"""
        url = f"{self.base_url}/bulk"
        payload = {"keys": [{"name": k} for k in keys]}

        response = requests.post(url, headers=self.headers, json=payload)
        if not response.ok:
            return {}
        result = response.json()
        return {
            item["name"]: item.get("value")
            for item in result.get("result", [])
            if item.get("success")
        }


def import_posts_fast(
    input_file, namespace_id, account_id, api_token, batch_size=10000
):
    start_time = time.time()
    kv = CloudflareKV(namespace_id, account_id, api_token)

    with open(input_file) as f:
        posts = [json.loads(line) for line in f if line.strip()]

    total = len(posts)
    print(f"Importing {total} posts to KV namespace {namespace_id}")
    print(f"Using batch size: {batch_size}")

    # Phase 1: Write posts and embeddings
    print("\nPhase 1: Writing posts and embeddings...")
    writes = []
    for i, post in enumerate(posts):
        post_id = post["post_id"]

        metadata = {
            "post_id": post_id,
            "member_id": post["member_id"],
            "member_name": post["member_name"],
            "text": post["text"],
            "created_at": post.get("created_at", ""),
            "topics": post.get("topics", []),
            "location": post.get("location", {}),
        }

        writes.append(
            {
                "key": f"post:{post_id}",
                "value": json.dumps(metadata),
            }
        )

        embed_bytes = embed_to_bytes(post["embedding"])
        writes.append(
            {
                "key": f"embedding:{post_id}",
                "value": base64_encode(embed_bytes),
                "base64": True,
            }
        )

        if len(writes) >= batch_size:
            kv.bulk_write(writes)
            print(f"  Written {i + 1}/{total} posts")
            writes = []

    if writes:
        kv.bulk_write(writes)
        print(f"  Written {total}/{total} posts")

    # Phase 2: Build indexes
    print("\nPhase 2: Building indexes...")
    member_index = {}
    city_index = {}
    country_index = {}
    region_index = {}
    all_post_ids = [p["post_id"] for p in posts]

    for post in posts:
        post_id = post["post_id"]
        member_id = post["member_id"]
        location = post.get("location", {})

        if member_id not in member_index:
            member_index[member_id] = []
        member_index[member_id].append(post_id)

        if location.get("city"):
            city = location["city"].lower()
            if city not in city_index:
                city_index[city] = []
            city_index[city].append(post_id)

        if location.get("country"):
            country = location["country"].lower()
            if country not in country_index:
                country_index[country] = []
            country_index[country].append(post_id)

        if location.get("region"):
            region = location["region"].lower()
            if region not in region_index:
                region_index[region] = []
            region_index[region].append(post_id)

    # Write all indexes
    writes = []
    for member_id, post_ids in member_index.items():
        writes.append(
            {
                "key": f"member_index:{member_id}",
                "value": json.dumps(post_ids),
            }
        )

    for city, post_ids in city_index.items():
        writes.append(
            {
                "key": f"location_index:city:{city}",
                "value": json.dumps(post_ids),
            }
        )

    for country, post_ids in country_index.items():
        writes.append(
            {
                "key": f"location_index:country:{country}",
                "value": json.dumps(post_ids),
            }
        )

    for region, post_ids in region_index.items():
        writes.append(
            {
                "key": "location_index:region:{region}",
                "value": json.dumps(post_ids),
            }
        )

    # Write all_posts index
    writes.append(
        {
            "key": "index:all_posts",
            "value": json.dumps(all_post_ids),
        }
    )

    print(f"  Writing {len(writes)} index entries...")
    kv.bulk_write(writes)

    elapsed = time.time() - start_time
    print(f"\nDone! Imported {total} posts in {elapsed:.1f} seconds")
    print(f"Total keys written: {len(posts) * 2 + len(writes)}")


def main():
    parser = argparse.ArgumentParser(description="Fast import posts to Cloudflare KV")
    parser.add_argument("input", help="Input JSONL file with embeddings")
    parser.add_argument("--namespace-id", "-n", help="KV Namespace ID (or set in .env)")
    parser.add_argument(
        "--account-id",
        "-a",
        help="Cloudflare Account ID (or set CF_ACCOUNT_ID in .env)",
    )
    parser.add_argument(
        "--api-token", "-t", help="Cloudflare API Token (or set CF_API_TOKEN in .env)"
    )
    parser.add_argument(
        "--batch-size",
        "-b",
        type=int,
        default=10000,
        help="Max keys per API call (max 10000)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: Input file {args.input} not found")
        sys.exit(1)

    namespace_id = args.namespace_id or os.environ.get("CF_KV_NAMESPACE_ID")
    account_id = args.account_id or os.environ.get("CF_ACCOUNT_ID")
    api_token = args.api_token or os.environ.get("CF_API_TOKEN")

    missing = []
    if not namespace_id:
        missing.append("CF_KV_NAMESPACE_ID")
    if not account_id:
        missing.append("CF_ACCOUNT_ID")
    if not api_token:
        missing.append("CF_API_TOKEN")

    if missing:
        print(f"Error: Missing required env vars: {', '.join(missing)}")
        print("Provide as arguments or set in .env file:")
        print("  CF_KV_NAMESPACE_ID=your_namespace_id")
        print("  CF_ACCOUNT_ID=your_account_id")
        print("  CF_API_TOKEN=your_api_token")
        sys.exit(1)

    import_posts_fast(args.input, namespace_id, account_id, api_token, args.batch_size)


if __name__ == "__main__":
    main()
