"""Pydantic schemas for API request/response."""
from pydantic import BaseModel, Field
from typing import Optional, List


class CaseSummary(BaseModel):
    """Structured summary of the insurance case from RAG."""
    policy_number: Optional[str] = None
    customer_name: Optional[str] = None
    problem_summary: str
    relevant_provisions: List[str]
    key_facts: List[str]
    suggested_demands: List[str]


class NegotiationScript(BaseModel):
    """Generated negotiation script structure."""
    opening_statement: str
    key_claims: List[str]
    anticipated_objections: List[dict]  # [{objection, rebuttal}]
    acceptable_resolution: str
    fallback: str
    closing: str
    full_script: str  # Combined for HITL display


class ScriptApprovalRequest(BaseModel):
    """User approval of the generated script."""
    session_id: str
    approved: bool = True
    edits: Optional[str] = None  # User's edits to apply


class CallInitRequest(BaseModel):
    """Request to initiate an outbound call."""
    session_id: str
    recipient_phone: str  # For demo: could be teammate's number
    use_simulation: bool = True  # Demo mode: simulate without Twilio


class TranscriptUpdate(BaseModel):
    """Live transcript update during call."""
    role: str  # "customer" | "agent"
    text: str
    timestamp: str
