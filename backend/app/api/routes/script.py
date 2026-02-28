"""Script generation and approval routes."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.mistral_service import generate_negotiation_script

router = APIRouter(prefix="/script", tags=["script"])

# In-memory store for approved scripts (per session)
_approved_scripts: dict = {}


class ScriptRequest(BaseModel):
    session_id: str
    user_problem: str
    case_summary: dict


class ScriptApprovalRequest(BaseModel):
    session_id: str
    approved: bool = True
    edits: Optional[str] = None
    full_script: str = ""


from fastapi.concurrency import run_in_threadpool

@router.post("/generate")
async def generate_script(req: ScriptRequest):
    """Generate negotiation script from case summary."""
    try:
        script = await run_in_threadpool(generate_negotiation_script, req.case_summary, req.user_problem)
        return {"script": script.model_dump()}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/approve")
async def approve_script(req: ScriptApprovalRequest):
    """User approves (and optionally edits) the script. Required before call."""
    if not req.approved:
        return {"approved": False, "message": "Script not approved"}
    
    # In a real app we'd fetch the current script for this session and apply edits
    script_text = req.edits if req.edits else req.full_script
    _approved_scripts[req.session_id] = {
        "approved": True,
        "full_script": script_text,
    }
    return {"approved": True, "message": "Script approved"}


def get_approved_script(session_id: str, fallback_script: str = "") -> Optional[str]:
    """Get the approved script for a session."""
    data = _approved_scripts.get(session_id)
    if not data or not data.get("approved"):
        return None
    return data.get("full_script", fallback_script)
