from sentence_transformers import SentenceTransformer
import numpy as np
from typing import Optional
import os


class EmbeddingGenerator:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self.model: Optional[SentenceTransformer] = None

    def load_model(self):
        if self.model is None:
            self.model = SentenceTransformer(self.model_name)
        return self.model

    def encode(self, texts: list[str], batch_size: int = 32) -> np.ndarray:
        model = self.load_model()
        embeddings = model.encode(texts, batch_size=batch_size, show_progress_bar=True)
        return embeddings

    def encode_single(self, text: str) -> list[float]:
        model = self.load_model()
        embedding = model.encode([text], show_progress_bar=False)
        return embedding[0].tolist()

    @property
    def embedding_dimension(self) -> int:
        model = self.load_model()
        return model.get_sentence_embedding_dimension()


def create_generator() -> EmbeddingGenerator:
    return EmbeddingGenerator()
