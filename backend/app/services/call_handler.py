"""Live call handler: orchestration of Mistral Small + tool execution + TTS."""
import json
import re
from typing import List, Dict, Callable
from duckduckgo_search import DDGS

from app.services.mistral_service import handle_live_turn


def _web_search(query: str) -> str:
    """Web search using DuckDuckGo (no API key needed)."""
    try:
        results = DDGS().text(query, max_results=3)
        snippets = [r.get("body", "") for r in results if r.get("body")]
        return "\n".join(snippets[:3]) if snippets else "No results found."
    except Exception as e:
        return f"Search failed: {str(e)}"


def _calculator(expression: str) -> str:
    """Safely evaluate a math expression."""
    try:
        # Only allow numbers, +, -, *, /, (, ), .
        if not re.match(r"^[\d\s\+\-\*\/\(\)\.]+$", expression):
            return "Invalid expression"
        result = eval(expression)
        return str(result)
    except Exception as e:
        return f"Error: {str(e)}"


TOOL_HANDLERS = {
    "web_search": _web_search,
    "calculator": _calculator,
}


def process_agent_utterance(
    agent_text: str,
    conversation_history: List[dict],
    script: str,
    rag_context: str,
) -> str:
    """
    Process what the insurance agent said, return our bot's response.
    """
    return handle_live_turn(
        agent_utterance=agent_text,
        conversation_history=conversation_history,
        script=script,
        rag_context=rag_context,
        tool_handlers=TOOL_HANDLERS,
    )
