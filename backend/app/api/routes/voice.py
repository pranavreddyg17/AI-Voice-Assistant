"""Voice recording and cloning routes."""
import uuid
import os
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.config import get_settings
from app.services.elevenlabs_service import clone_voice, speech_to_text

router = APIRouter(prefix="/voice", tags=["voice"])


@router.post("/record")
async def process_voice_recording(
    file: UploadFile = File(...),
    session_id: str = Form(None),
):
    """
    Accept voice recording (mp3/wav), transcribe it, and clone the voice.
    Returns: transcript, voice_id, session_id
    """
    allowed = (".mp3", ".wav", ".webm", ".m4a", ".ogg")
    if not file.filename or not file.filename.lower().endswith(allowed):
        raise HTTPException(400, "Allowed formats: mp3, wav, webm, m4a, ogg")
    
    settings = get_settings()
    upload_dir = Path(__file__).resolve().parent.parent.parent.parent / settings.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)
    session_id = session_id or str(uuid.uuid4())
    ext = Path(file.filename).suffix or ".mp3"
    file_path = upload_dir / f"{session_id}_voice{ext}"
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    try:
        transcript = await run_in_threadpool(speech_to_text, str(file_path))
        voice_id = await run_in_threadpool(clone_voice, str(file_path), f"user_{session_id[:8]}")
        return {
            "session_id": session_id,
            "transcript": transcript,
            "voice_id": voice_id,
            "message": "Voice processed and cloned",
        }
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/record-with-session")
async def process_voice_with_session(
    file: UploadFile = File(...),
    session_id: str = None,
):
    """
    Process voice when we already have a session (e.g. from document upload).
    """
    if not session_id:
        session_id = str(uuid.uuid4())
    
    allowed = (".mp3", ".wav", ".webm", ".m4a", ".ogg")
    if not file.filename or not file.filename.lower().endswith(allowed):
        raise HTTPException(400, "Allowed formats: mp3, wav, webm, m4a, ogg")
    
    settings = get_settings()
    upload_dir = Path(__file__).resolve().parent.parent.parent.parent / settings.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename).suffix or ".mp3"
    file_path = upload_dir / f"{session_id}_voice{ext}"
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    try:
        transcript = await run_in_threadpool(speech_to_text, str(file_path))
        voice_id = await run_in_threadpool(clone_voice, str(file_path), f"user_{session_id[:8]}")
        return {
            "session_id": session_id,
            "transcript": transcript,
            "voice_id": voice_id,
            "message": "Voice processed and cloned",
        }
    except Exception as e:
        raise HTTPException(500, str(e))
