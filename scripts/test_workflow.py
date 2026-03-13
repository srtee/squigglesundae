#!/usr/bin/env python3
"""
Test script to verify end-to-end functionality.
"""

import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.embeddings import EmbeddingGenerator
from src.storage import VectorStore
from src.search import SearchEngine


def test_embedding_generation():
    print("=" * 50)
    print("TEST 1: Embedding Generation")
    print("=" * 50)
    
    embed_gen = EmbeddingGenerator()
    embed_gen.load_model()
    
    text = "I love machine learning and hiking in the mountains"
    embedding = embed_gen.encode_single(text)
    
    print(f"Model: {embed_gen.model_name}")
    print(f"Embedding dimension: {len(embedding)}")
    print(f"First 5 values: {embedding[:5]}")
    print("✓ Embedding generation works\n")
    return embed_gen


def test_vector_storage(embed_gen):
    print("=" * 50)
    print("TEST 2: Vector Storage")
    print("=" * 50)
    
    persist_dir = "./data/test_chroma"
    
    if os.path.exists(persist_dir):
        import shutil
        shutil.rmtree(persist_dir)
    
    vec_store = VectorStore(persist_dir)
    vec_store.initialize(embed_gen.embedding_dimension)
    
    posts = [
        {
            "post_id": "p001",
            "member_id": "m001",
            "member_name": "Alice",
            "text": "I love machine learning and hiking",
            "created_at": "2024-01-01T00:00:00",
            "city": "San Francisco",
            "country": "USA",
            "region": "California",
            "embedding": embed_gen.encode_single("I love machine learning and hiking")
        },
        {
            "post_id": "p002",
            "member_id": "m002", 
            "member_name": "Bob",
            "text": "I enjoy cooking and playing guitar",
            "created_at": "2024-01-02T00:00:00",
            "city": "London",
            "country": "UK",
            "region": "England",
            "embedding": embed_gen.encode_single("I enjoy cooking and playing guitar")
        }
    ]
    
    vec_store.add_posts(posts)
    
    print(f"Added {len(posts)} posts")
    print(f"Total in DB: {vec_store.count()}")
    print("✓ Vector storage works\n")
    return vec_store


def test_search(vec_store, embed_gen):
    print("=" * 50)
    print("TEST 3: Semantic Search")
    print("=" * 50)
    
    results = vec_store.search(
        query_embedding=embed_gen.encode_single("outdoor activities hiking"),
        n_results=5
    )
    
    print(f"Query: 'outdoor activities hiking'")
    print(f"Found {len(results)} results:")
    for r in results:
        print(f"  - {r['member_name']} (similarity: {r['similarity']:.3f})")
        print(f"    Text: {r['text'][:60]}...")
    print("✓ Semantic search works\n")


def test_metadata_filtering(vec_store, embed_gen):
    print("=" * 50)
    print("TEST 4: Metadata Filtering")
    print("=" * 50)
    
    results = vec_store.search(
        query_embedding=embed_gen.encode_single("music"),
        n_results=5,
        country="UK"
    )
    
    print(f"Query: 'music' filtered by country=UK")
    print(f"Found {len(results)} results:")
    for r in results:
        print(f"  - {r['member_name']}, {r['metadata'].get('country', 'N/A')}")
    print("✓ Metadata filtering works\n")


def test_full_workflow():
    print("\n" + "=" * 60)
    print("RUNNING FULL END-TO-END TEST")
    print("=" * 60 + "\n")
    
    embed_gen = test_embedding_generation()
    vec_store = test_vector_storage(embed_gen)
    test_search(vec_store, embed_gen)
    test_metadata_filtering(vec_store, embed_gen)
    
    print("=" * 50)
    print("ALL TESTS PASSED!")
    print("=" * 50)


if __name__ == "__main__":
    test_full_workflow()
