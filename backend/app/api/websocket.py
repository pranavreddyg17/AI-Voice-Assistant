"""WebSocket handler for live simulated call."""
import json
import time
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict

from app.services.rag_service import retrieve_relevant_chunks
from app.services.call_handler import process_agent_utterance
from app.services.eval_service import log_call_run


# Active call state per session
_active_calls: Dict[str, dict] = {}


def register_call(
    session_id: str,
    script: str,
    rag_context: str,
    user_problem: str,
    rag_chunks: list = None,
) -> None:
    """Register call context for a session."""
    _active_calls[session_id] = {
        "script": script,
        "rag_context": rag_context,
        "user_problem": user_problem,
        "rag_chunks": rag_chunks or [],
        "history": [],
        "start_time": time.time(),
    }


async def handle_call_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket handler for live call simulation.
    Receives agent utterances (text), returns our response (text) + optional TTS trigger.
    """
    await websocket.accept()
    call_state = _active_calls.get(session_id)
    if not call_state:
        await websocket.send_json({"error": "Call not registered. Generate and approve script first."})
        await websocket.close()
        return
    
    script = call_state["script"]
    rag_context = call_state["rag_context"]
    history = call_state["history"]
    
    # Send ready signal
    await websocket.send_json({
        "type": "ready",
        "message": "Call started. Agent can now speak.",
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "agent_speech")
            
            if msg_type == "agent_speech":
                agent_text = data.get("text", "").strip()
                if not agent_text:
                    continue
                
                # Add to history
                history.append({"role": "user", "content": agent_text})
                
                start = time.time()
                response = process_agent_utterance(
                    agent_text=agent_text,
                    conversation_history=history[:-1],
                    script=script,
                    rag_context=rag_context,
                )
                latency_ms = (time.time() - start) * 1000
                
                history.append({"role": "assistant", "content": response})
                
                await websocket.send_json({
                    "type": "response",
                    "text": response,
                    "latency_ms": latency_ms,
                    "role": "customer",
                })
            
            elif msg_type == "end_call":
                break
    
    except WebSocketDisconnect:
        pass
    finally:
        if session_id in _active_calls:
            state = _active_calls[session_id]
            duration = time.time() - state.get("start_time", time.time())
            hist = state.get("history", [])
            transcript_str = "\n".join(
                f"{h.get('role', '')}: {h.get('content', '')}" for h in hist
            )
            log_call_run(
                session_id=session_id,
                rag_chunks=state.get("rag_chunks", []),
                script_approved=True,
                call_duration_seconds=duration,
                turns_count=len(hist),
                resolution_achieved=False,
                full_transcript=transcript_str,
            )
            del _active_calls[session_id]
