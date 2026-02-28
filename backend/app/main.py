"""Insurance Voice Assistant - FastAPI entry point."""
from contextlib import asynccontextmanager
from dotenv import load_dotenv

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import upload, voice, rag, script, call
from app.api.websocket import handle_call_websocket

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: ensure upload dir exists."""
    from pathlib import Path
    settings = get_settings()
    upload_dir = Path(__file__).resolve().parent.parent / settings.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)
    yield
    # Shutdown cleanup if needed
    pass


app = FastAPI(
    title="Insurance Voice Assistant",
    description="Elderly person uploads policy, records voice, system negotiates with insurance using cloned voice",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(rag.router, prefix="/api")
app.include_router(script.router, prefix="/api")
app.include_router(call.router, prefix="/api")


@app.get("/")
async def root():
    return {"message": "Insurance Voice Assistant API", "docs": "/docs"}


@app.get("/health")
async def health():
    """Check API keys are configured (does not verify they work)."""
    settings = get_settings()
    return {
        "mistral_configured": bool(settings.mistral_api_key),
        "elevenlabs_configured": bool(settings.elevenlabs_api_key),
        "qdrant": "in-memory",
    }


@app.websocket("/ws/call/{session_id}")
async def websocket_call(websocket: WebSocket, session_id: str):
    await handle_call_websocket(websocket, session_id)
