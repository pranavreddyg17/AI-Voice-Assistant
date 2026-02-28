# Insurance Voice Assistant

An elderly person uploads their insurance document and records their voice explaining their problem. The system clones their voice, understands the issue via RAG over policy documents, writes a negotiation script, then handles the live agent conversation in real-time using Mistral—with optional telephony via ElevenLabs.

## Architecture

```
USER INPUT
    ├── Voice Recording (ElevenLabs STT / Voice Clone)
    └── Document Upload (PDF)
         │
         ▼
[PHASE 1: UNDERSTANDING]
Qdrant (vector store) + Mistral Large → RAG → Case Summary
         │
         ▼
[PHASE 2: SCRIPT GENERATION]
Mistral Large → Negotiation Script (HITL: user reviews/approves)
         │
         ▼
[PHASE 3–4: LIVE CONVERSATION]
WebSocket simulation (or ElevenLabs Telephony)
Mistral Small → handles agent utterances → ElevenLabs TTS (cloned voice)
         │
         ▼
[PHASE 5: EVAL]
Weights & Biases (optional)
```

## Tech Stack

| Layer | Tool |
|-------|------|
| Frontend | React (Vite) |
| Backend | FastAPI |
| STT / Voice Clone / TTS | ElevenLabs |
| Embeddings | mistral-embed |
| Vector DB | Qdrant (in-memory) |
| Script Gen | mistral-large-latest |
| Live Conv | mistral-small-latest |
| PDF Parse | pdfplumber |

## Setup

### 1. Clone and install

```bash
cd MistralHack
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Environment

Create `backend/.env` with your API keys:

```bash
cp .env.example backend/.env
```

Edit `backend/.env`:

```
MISTRAL_API_KEY=your_mistral_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

### 4. Run

**Terminal 1 – Backend:**
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 – Frontend:**
```bash
cd frontend
npm run dev
```

Open http://localhost:5173

## Demo Flow

1. **Upload policy PDF** – Document is chunked and embedded in Qdrant.
2. **Record voice** – Describe your problem (e.g. "They denied my claim for my hospital stay, policy number 12345"). Voice is transcribed and cloned.
3. **Case summary** – RAG retrieves relevant policy chunks; Mistral Large generates a structured case summary.
4. **Script generation** – Mistral Large produces a negotiation script.
5. **Approve script** – Review, edit if needed, then approve.
6. **Live call (simulation)** – A teammate acts as the insurance agent. Type their responses; the system answers via Mistral Small and speaks with your cloned voice via TTS.

## API Endpoints

- `POST /api/upload/document` – Upload PDF
- `POST /api/voice/record` – Upload voice recording
- `POST /api/rag/case-summary` – Get case summary
- `POST /api/script/generate` – Generate script
- `POST /api/script/approve` – Approve script
- `POST /api/call/start` – Register call (before WebSocket)
- `POST /api/call/tts` – Text-to-speech with cloned voice
- `WS /ws/call/{session_id}` – Live call simulation

## Notes

- **Voice cloning**: Aim for ~30–60 seconds of clear speech for good results.
- **Simulation mode**: Uses WebSocket instead of real telephony so a teammate can play the agent.
- **Qdrant**: In-memory; policy data is lost on backend restart.
- **W&B**: Set `WANDB_API_KEY` in `.env` to enable evaluation logging.
