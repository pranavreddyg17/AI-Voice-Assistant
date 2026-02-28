"""Document upload routes."""
import uuid
import os
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from app.config import get_settings
from app.services.rag_service import ingest_document
from app.services.pdf_ingestion import extract_text_from_pdf

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("/document")
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Form(None),
):
    """Upload insurance policy PDF and ingest into RAG. Optionally pass session_id to reuse."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are allowed")
    
    settings = get_settings()
    upload_dir = Path(__file__).resolve().parent.parent.parent.parent / settings.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)
    session_id = (session_id or str(uuid.uuid4())).strip() or str(uuid.uuid4())
    file_path = upload_dir / f"{session_id}.pdf"
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    from fastapi.concurrency import run_in_threadpool

    try:
        count = await run_in_threadpool(ingest_document, str(file_path), session_id)
        return {
            "session_id": session_id,
            "chunks_ingested": count,
            "message": "Document ingested successfully",
        }
    except Exception as e:
        raise HTTPException(500, str(e))
