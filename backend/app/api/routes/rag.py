"""RAG and case summary routes."""
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.services.rag_service import retrieve_relevant_chunks
from app.services.mistral_service import generate_case_summary

router = APIRouter(prefix="/rag", tags=["rag"])


class CaseSummaryRequest(BaseModel):
    session_id: str
    user_problem: str


@router.post("/case-summary")
async def get_case_summary(req: CaseSummaryRequest):
    """Retrieve RAG chunks and generate structured case summary."""
    try:
        chunks = await run_in_threadpool(retrieve_relevant_chunks, req.user_problem, req.session_id)
        summary = await run_in_threadpool(generate_case_summary, chunks, req.user_problem)
        return {
            "case_summary": summary,
            "rag_chunks": chunks,
        }
    except Exception as e:
        raise HTTPException(500, str(e))
