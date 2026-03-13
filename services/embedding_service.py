#!/usr/bin/env python3
"""
Local embedding service - runs on your home machine.
Exposes HTTP endpoint for generating embeddings.

Run: python services/embedding_service.py
"""

import os
import sys
from datetime import datetime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.embeddings import EmbeddingGenerator


app = FastAPI(title="Local Embedding Service")

embedding_generator: EmbeddingGenerator = None


class EmbedRequest(BaseModel):
    text: str


class BatchEmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embedding: list[float]
    dimension: int
    model: str
    timestamp: str


class BatchEmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dimension: int
    model: str
    count: int
    timestamp: str


@app.on_event("startup")
def startup():
    global embedding_generator
    print("Loading embedding model...")
    embedding_generator = EmbeddingGenerator()
    embedding_generator.load_model()
    print(f"Model loaded: {embedding_generator.model_name}")
    print(f"Embedding dimension: {embedding_generator.embedding_dimension}")


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "model": embedding_generator.model_name
        if embedding_generator
        else "not loaded",
        "dimension": embedding_generator.embedding_dimension
        if embedding_generator
        else 0,
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    embedding = embedding_generator.encode_single(request.text)
    return EmbedResponse(
        embedding=embedding,
        dimension=len(embedding),
        model=embedding_generator.model_name,
        timestamp=datetime.utcnow().isoformat(),
    )


@app.post("/embed_batch", response_model=BatchEmbedResponse)
def embed_batch(request: BatchEmbedRequest):
    if not request.texts:
        raise HTTPException(status_code=400, detail="Texts cannot be empty")

    texts = [t for t in request.texts if t.strip()]
    if not texts:
        raise HTTPException(status_code=400, detail="No valid texts provided")

    embeddings = embedding_generator.encode(texts, batch_size=32)
    return BatchEmbedResponse(
        embeddings=embeddings.tolist(),
        dimension=embeddings.shape[1],
        model=embedding_generator.model_name,
        count=len(texts),
        timestamp=datetime.utcnow().isoformat(),
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
