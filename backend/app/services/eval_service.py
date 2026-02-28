"""Weights & Biases evaluation logging."""
from typing import List, Optional
from datetime import datetime


_wandb_initialized = False


def _ensure_wandb():
    global _wandb_initialized
    if _wandb_initialized:
        return True
    try:
        import wandb
        from app.config import get_settings
        api_key = get_settings().wandb_api_key
        if api_key:
            wandb.login(key=api_key)
        wandb.init(project=get_settings().wandb_project, reinit=True)
        _wandb_initialized = True
        return True
    except Exception:
        return False


def log_call_run(
    session_id: str,
    rag_chunks: List[str],
    script_approved: bool,
    call_duration_seconds: float,
    turns_count: int,
    resolution_achieved: bool,
    full_transcript: str,
    grounding_score: Optional[float] = None,
    avg_latency_ms: Optional[float] = None,
) -> None:
    """Log a complete call run to W&B."""
    if not _ensure_wandb():
        return
    try:
        import wandb
        wandb.log({
            "session_id": session_id,
            "rag_retrieved_chunks": len(rag_chunks),
            "script_approved": script_approved,
            "call_duration_seconds": call_duration_seconds,
            "turns_count": turns_count,
            "resolution_achieved": resolution_achieved,
            "grounding_score": grounding_score,
            "avg_latency_ms": avg_latency_ms,
            "full_transcript": wandb.Html(f"<pre>{full_transcript}</pre>"),
        })
    except Exception:
        pass
