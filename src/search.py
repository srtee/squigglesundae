from typing import Optional
from .embeddings import EmbeddingGenerator
from .storage import VectorStore
import os


class SearchEngine:
    def __init__(self, embedding_generator: EmbeddingGenerator, vector_store: VectorStore):
        self.embedding_generator = embedding_generator
        self.vector_store = vector_store

    def search(
        self,
        query: str,
        n_results: int = 10,
        member_id: Optional[str] = None,
        city: Optional[str] = None,
        country: Optional[str] = None,
        region: Optional[str] = None
    ) -> list[dict]:
        query_embedding = self.embedding_generator.encode_single(query)
        return self.vector_store.search(
            query_embedding=query_embedding,
            n_results=n_results,
            member_id=member_id,
            city=city,
            country=country,
            region=region
        )

    def search_with_embedding(
        self,
        query_embedding: list[float],
        n_results: int = 10,
        member_id: Optional[str] = None,
        city: Optional[str] = None,
        country: Optional[str] = None,
        region: Optional[str] = None
    ) -> list[dict]:
        return self.vector_store.search(
            query_embedding=query_embedding,
            n_results=n_results,
            member_id=member_id,
            city=city,
            country=country,
            region=region
        )

    def get_member_posts(self, member_id: str) -> list[dict]:
        return self.vector_store.get_by_member(member_id)

    def get_stats(self) -> dict:
        return {
            "total_posts": self.vector_store.count(),
            "embedding_model": self.embedding_generator.model_name,
            "embedding_dimension": self.embedding_generator.embedding_dimension
        }


def create_search_engine(persist_dir: str = "./data/chroma_db") -> SearchEngine:
    embed_gen = EmbeddingGenerator()
    vec_store = VectorStore(persist_dir)
    vec_store.initialize(embed_gen.embedding_dimension)
    return SearchEngine(embed_gen, vec_store)
