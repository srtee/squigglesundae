import chromadb
from chromadb.config import Settings
from typing import Optional
import numpy as np
from datetime import datetime
import json
import os


class VectorStore:
    def __init__(self, persist_directory: str = "./data/chroma_db"):
        self.persist_directory = persist_directory
        self.client: Optional[chromadb.PersistentClient] = None
        self.collection = None

    def initialize(self, embedding_dimension: int):
        os.makedirs(self.persist_directory, exist_ok=True)
        self.client = chromadb.PersistentClient(path=self.persist_directory)
        self.collection = self.client.get_or_create_collection(
            name="intro_posts",
            metadata={"hnsw:space": "cosine"}
        )
        return self

    def add_post(
        self,
        post_id: str,
        text: str,
        embedding: list[float],
        member_id: str,
        member_name: str,
        created_at: str,
        city: Optional[str] = None,
        country: Optional[str] = None,
        region: Optional[str] = None
    ):
        metadata = {
            "post_id": post_id,
            "member_id": member_id,
            "member_name": member_name,
            "created_at": created_at,
            "text": text[:500]
        }
        if city:
            metadata["city"] = city
        if country:
            metadata["country"] = country
        if region:
            metadata["region"] = region

        self.collection.add(
            ids=[post_id],
            embeddings=[embedding],
            documents=[text],
            metadatas=[metadata]
        )

    def add_posts(self, posts: list[dict]):
        ids = []
        embeddings = []
        documents = []
        metadatas = []

        for post in posts:
            metadata = {
                "post_id": post["post_id"],
                "member_id": post["member_id"],
                "member_name": post["member_name"],
                "created_at": post["created_at"],
                "text": post["text"][:500]
            }
            if post.get("city"):
                metadata["city"] = post["city"]
            if post.get("country"):
                metadata["country"] = post["country"]
            if post.get("region"):
                metadata["region"] = post["region"]

            ids.append(post["post_id"])
            embeddings.append(post["embedding"])
            documents.append(post["text"])
            metadatas.append(metadata)

        self.collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )

    def search(
        self,
        query_embedding: list[float],
        n_results: int = 10,
        member_id: Optional[str] = None,
        city: Optional[str] = None,
        country: Optional[str] = None,
        region: Optional[str] = None
    ) -> list[dict]:
        where = {}
        if member_id:
            where["member_id"] = member_id
        if city:
            where["city"] = city
        if country:
            where["country"] = country
        if region:
            where["region"] = region

        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where if where else None,
            include=["documents", "metadatas", "distances"]
        )

        output = []
        if results["documents"] and len(results["documents"]) > 0:
            for i, doc in enumerate(results["documents"][0]):
                output.append({
                    "post_id": results["metadatas"][0][i]["post_id"],
                    "text": doc,
                    "member_id": results["metadatas"][0][i]["member_id"],
                    "member_name": results["metadatas"][0][i]["member_name"],
                    "similarity": 1 - results["distances"][0][i],
                    "metadata": results["metadatas"][0][i]
                })
        return output

    def get_by_member(self, member_id: str) -> list[dict]:
        results = self.collection.get(
            where={"member_id": member_id},
            include=["documents", "metadatas"]
        )
        output = []
        if results["documents"]:
            for i, doc in enumerate(results["documents"]):
                output.append({
                    "post_id": results["ids"][i],
                    "text": doc,
                    "member_id": results["metadatas"][i]["member_id"],
                    "member_name": results["metadatas"][i]["member_name"]
                })
        return output

    def count(self) -> int:
        return self.collection.count()

    def delete_post(self, post_id: str):
        self.collection.delete(ids=[post_id])

    def clear(self):
        self.client.delete_collection("intro_posts")
        self.collection = self.client.get_or_create_collection(
            name="intro_posts",
            metadata={"hnsw:space": "cosine"}
        )


def create_vector_store(persist_dir: str = "./data/chroma_db") -> VectorStore:
    return VectorStore(persist_dir)
