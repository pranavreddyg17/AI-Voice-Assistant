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
    Accept voice recording and transcribe it.
    Voice cloning is deferred to /voice/clone to keep this fast.
    Returns: transcript, session_id
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
        return {
            "session_id": session_id,
            "transcript": transcript,
            "message": "Voice transcribed successfully",
        }
    except Exception as e:
        # If STT fails, still return session — user can type their problem
        return {
            "session_id": session_id,
            "transcript": "",
            "message": f"Transcription unavailable: {str(e)}",
        }


@router.post("/clone")
async def clone_user_voice(
    file: UploadFile = File(...),
    session_id: str = Form(None),
):
    """
    Clone a voice from an audio file. Called separately from transcription
    so it doesn't block the main flow.
    Returns: voice_id, session_id
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
    
    # Only write if file doesn't already exist (may already be saved from /record)
    if not file_path.exists():
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
    else:
        await file.read()  # consume the upload
    
    try:
        voice_id = await run_in_threadpool(clone_voice, str(file_path), f"user_{session_id[:8]}")
        return {
            "session_id": session_id,
            "voice_id": voice_id,
            "message": "Voice cloned successfully",
        }
    except Exception as e:
        raise HTTPException(500, f"Voice cloning failed: {str(e)}")
