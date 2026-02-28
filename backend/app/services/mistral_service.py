"""Mistral AI services: case summary, script generation, live conversation."""
from typing import List, Optional
from mistralai import Mistral

from app.config import get_settings
from app.models.schemas import CaseSummary, NegotiationScript


_mistral_client: Optional[Mistral] = None


def _get_client() -> Mistral:
    global _mistral_client
    if _mistral_client is None:
        api_key = get_settings().mistral_api_key
        if not api_key:
            raise ValueError("MISTRAL_API_KEY not set")
        _mistral_client = Mistral(api_key=api_key)
    return _mistral_client


# Tools for live conversation (MCP-style: web search, calculator)
def _create_tools():
    return [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web for insurance regulations, policy terms, or claim procedures. Use when you need to verify a regulation or find supporting information.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query",
                        }
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "calculator",
                "description": "Perform calculations for claim amounts, percentages, or deductibles. Use when discussing numbers with the agent.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "Mathematical expression to evaluate, e.g. '1500 * 0.8' or '500 - 100'",
                        }
                    },
                    "required": ["expression"],
                },
            },
        },
    ]


def generate_case_summary(
    rag_chunks: List[str],
    user_problem: str,
) -> dict:
    """
    Use Mistral Large to generate a structured case summary from RAG context.
    """
    client = _get_client()
    
    policy_context = "\n\n---\n\n".join(rag_chunks) if rag_chunks else "No policy context available."
    
    system_prompt = """You are an insurance case analyst. Extract and structure key information from the policy document.
Output valid JSON with these exact keys:
{
  "policy_number": "string or null",
  "customer_name": "string or null",
  "problem_summary": "string",
  "relevant_provisions": ["list", "of", "strings"],
  "key_facts": ["list", "of", "strings"],
  "suggested_demands": ["list", "of", "strings"]
}
Be concise. Only output the JSON, no markdown."""

    user_prompt = f"""Policy document excerpts:
{policy_context[:8000]}

Customer's stated problem: {user_problem}

Generate the structured case summary as JSON."""

    response = client.chat.complete(
        model="mistral-large-latest",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    
    import json
    content = response.choices[0].message.content
    return json.loads(content)


def generate_negotiation_script(
    case_summary: dict,
    user_problem: str,
) -> NegotiationScript:
    """
    Use Mistral Large to generate a negotiation script.
    """
    client = _get_client()
    
    summary_str = str(case_summary)
    
    system_prompt = """You are an insurance negotiation expert helping an elderly customer. Be firm but polite. Know their rights.
Generate a phone script for negotiating with the insurance company. Structure your response as JSON with:
- opening_statement: How to greet and state the purpose
- key_claims: List of numbered main points to make
- anticipated_objections: List of {objection, rebuttal} objects
- acceptable_resolution: What would satisfy the customer
- fallback: What to accept if not ideal
- closing: How to end the call
- full_script: Combined script as a single readable string (paragraphs, numbered points) for the user to review
Output ONLY valid JSON, no markdown."""

    user_prompt = f"""Case summary: {summary_str}
Customer's problem: {user_problem}

Generate the negotiation script as JSON."""

    response = client.chat.complete(
        model="mistral-large-latest",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        response_format={"type": "json_object"},
    )
    
    import json
    content = response.choices[0].message.content
    data = json.loads(content)
    
    def _ensure_string(val):
        if isinstance(val, dict):
            return " ".join(str(v) for v in val.values())
        return str(val) if val else ""

    # Ensure full_script exists
    if "full_script" not in data:
        data["full_script"] = "\n".join([
            _ensure_string(data.get("opening_statement")),
            "\nKey claims:\n" + "\n".join(str(x) for x in data.get("key_claims", [])),
            "\nAcceptable resolution: " + _ensure_string(data.get("acceptable_resolution")),
            "\nClosing: " + _ensure_string(data.get("closing", "")),
        ])
    
    return NegotiationScript(
        opening_statement=_ensure_string(data.get("opening_statement")),
        key_claims=[str(x) for x in data.get("key_claims", [])],
        anticipated_objections=data.get("anticipated_objections", []),
        acceptable_resolution=_ensure_string(data.get("acceptable_resolution")),
        fallback=_ensure_string(data.get("fallback")),
        closing=_ensure_string(data.get("closing")),
        full_script=_ensure_string(data.get("full_script")),
    )


def handle_live_turn(
    agent_utterance: str,
    conversation_history: List[dict],
    script: str,
    rag_context: str,
    tool_handlers: dict,
) -> str:
    """
    Process a live agent utterance with Mistral Small. Returns the bot response.
    """
    client = _get_client()
    tools = _create_tools()
    
    system_content = f"""You are speaking on behalf of an elderly customer in a live insurance phone call. Use their cloned voice.
Your negotiation script:
{script[:3000]}

Relevant policy context:
{rag_context[:2000]}

Rules:
- Stay in character as the customer
- Be concise—this is real-time conversation
- Stick to the script but adapt naturally
- Use tools when you need to look up regulations or calculate numbers
- Don't repeat yourself. If the agent asks a question, answer directly."""

    messages = [
        {"role": "system", "content": system_content},
        *conversation_history,
        {"role": "user", "content": agent_utterance},
    ]
    
    max_iterations = 3
    for _ in range(max_iterations):
        response = client.chat.complete(
            model="mistral-small-latest",
            messages=messages,
            tools=tools,
            tool_choice="auto",
            temperature=0.5,
        )
        
        msg = response.choices[0].message
        if not msg.tool_calls:
            return msg.content or ""
        
        # Handle tool calls
        messages.append(msg)
        for tc in msg.tool_calls:
            fn_name = tc.function.name
            import json
            args = json.loads(tc.function.arguments)
            handler = tool_handlers.get(fn_name)
            if handler:
                result = handler(**args)
            else:
                result = f"Tool {fn_name} not available"
            messages.append({
                "role": "tool",
                "content": str(result),
                "name": fn_name,
            })
    
    return "I need a moment to verify that. Could you hold briefly?"
