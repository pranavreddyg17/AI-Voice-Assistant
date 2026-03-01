"""Call initiation and TTS routes."""
import base64
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.services.elevenlabs_service import text_to_speech
from app.services.rag_service import retrieve_relevant_chunks
from app.api.websocket import register_call

router = APIRouter(prefix="/call", tags=["call"])


class StartCallRequest(BaseModel):
    session_id: str
    script: str
    user_problem: str


@router.post("/start")
async def start_call(req: StartCallRequest):
    """Register call context for WebSocket. Call this before connecting to WS."""
    try:
        chunks = await run_in_threadpool(retrieve_relevant_chunks, req.user_problem, req.session_id)
        rag_context = "\n\n".join(chunks)
        register_call(
            session_id=req.session_id,
            script=req.script,
            rag_context=rag_context,
            user_problem=req.user_problem,
            rag_chunks=chunks,
        )
        return {"ok": True, "message": "Call registered. Connect to WebSocket."}
    except Exception as e:
        raise HTTPException(500, str(e))


class TTSRequest(BaseModel):
    text: str
    voice_id: str


@router.post("/tts")
async def get_tts_audio(req: TTSRequest):
    """Convert response text to speech with cloned voice. Returns base64 MP3."""
    try:
        audio_bytes = await run_in_threadpool(text_to_speech, req.text, req.voice_id)
        return {
            "audio_base64": base64.b64encode(audio_bytes).decode(),
            "format": "mp3",
        }
    except Exception as e:
        raise HTTPException(500, str(e))
