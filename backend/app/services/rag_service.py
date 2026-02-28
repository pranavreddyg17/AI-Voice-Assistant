"""RAG service: embeddings + Qdrant vector store + retrieval."""
from typing import List, Optional
from qdrant_client import QdrantClient, models
from mistralai import Mistral
import uuid
import os

from app.config import get_settings
from app.services.pdf_ingestion import extract_text_from_pdf, chunk_text


# In-memory Qdrant for hackathon (persists only during process lifecycle)
_qdrant_client: Optional[QdrantClient] = None
_collection_name = "insurance_policy"
_mistral_client: Optional[Mistral] = None


def _get_qdrant() -> QdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = QdrantClient(":memory:")
    return _qdrant_client


def _get_mistral() -> Mistral:
    global _mistral_client
    if _mistral_client is None:
        api_key = get_settings().mistral_api_key
        if not api_key:
            raise ValueError("MISTRAL_API_KEY not set")
        _mistral_client = Mistral(api_key=api_key)
    return _mistral_client


def _embed_texts(texts: List[str]) -> List[List[float]]:
    """Get embeddings from Mistral embed model."""
    client = _get_mistral()
    response = client.embeddings.create(
        model="mistral-embed",
        inputs=texts,
    )
    # Response structure: response.data is list of EmbeddingResponse
    return [item.embedding for item in response.data]


def ingest_document(pdf_path: str, session_id: str) -> int:
    """
    Ingest PDF, chunk, embed, and store in Qdrant.
    Returns number of chunks stored.
    """
    text = extract_text_from_pdf(pdf_path)
    chunks = chunk_text(
        text,
        chunk_size=get_settings().chunk_size,
        overlap=get_settings().chunk_overlap,
    )
    
    if not chunks:
        return 0
    
    client = _get_qdrant()
    embeddings = _embed_texts(chunks)
    
    # Create collection if needed (mistral-embed = 1024 dims)
    collections = client.get_collections().collections
    if not any(c.name == _collection_name for c in collections):
        client.create_collection(
            collection_name=_collection_name,
            vectors_config=models.VectorParams(size=1024, distance=models.Distance.COSINE),
        )
    
    points = [
        models.PointStruct(
            id=str(uuid.uuid4()),
            vector=emb,
            payload={"text": chunk, "session_id": session_id},
        )
        for chunk, emb in zip(chunks, embeddings)
    ]
    
    client.upsert(collection_name=_collection_name, points=points)
    return len(chunks)


def retrieve_relevant_chunks(
    query: str,
    session_id: Optional[str] = None,
    top_k: Optional[int] = None,
) -> List[str]:
    """
    Retrieve top-k chunks relevant to the user's query.
    """
    top_k = top_k or get_settings().rag_top_k
    
    try:
        query_embedding = _embed_texts([query])[0]
    except Exception:
        return []
    
    client = _get_qdrant()
    
    # Check collection exists
    collections = client.get_collections().collections
    if not any(c.name == _collection_name for c in collections):
        return []
    
    scroll_filter = None
    if session_id:
        scroll_filter = models.Filter(
            must=[models.FieldCondition(key="session_id", match=models.MatchValue(value=session_id))]
        )
    
    try:
        results = client.search(
            collection_name=_collection_name,
            query_vector=query_embedding,
            limit=top_k,
            query_filter=scroll_filter,
        )
    except Exception:
        return []
    
    return [hit.payload.get("text", "") for hit in results]
