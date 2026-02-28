"""ElevenLabs services: voice clone, STT, TTS."""
from pathlib import Path
from typing import Optional
from elevenlabs.client import ElevenLabs

from app.config import get_settings


_client: Optional[ElevenLabs] = None


def _get_client() -> ElevenLabs:
    global _client
    if _client is None:
        api_key = get_settings().elevenlabs_api_key
        if not api_key:
            raise ValueError("ELEVENLABS_API_KEY not set")
        _client = ElevenLabs(api_key=api_key)
    return _client


def clone_voice(audio_path: str, name: str = "user_voice") -> str:
    """
    Create instant voice clone from audio file using IVC.
    Returns voice_id.
    """
    client = _get_client()
    path = Path(audio_path).resolve()
    # voices.add accepts File: path string, file obj, or (filename, content)
    with open(path, "rb") as f:
        voice = client.voices.add(
            name=name,
            files=[(path.name, f.read())],
            description="Customer voice clone for insurance negotiation",
        )
    return voice.voice_id


def speech_to_text(audio_path: str) -> str:
    """Transcribe audio to text using ElevenLabs STT API (SDK 1.10 lacks STT, so we use HTTP)."""
    import requests
    settings = get_settings()
    url = "https://api.elevenlabs.io/v1/speech-to-text"
    with open(audio_path, "rb") as f:
        # Pass filename, file object, and content type
        files = {"file": (Path(audio_path).name, f, "audio/mpeg")}
        data = {"model_id": "scribe_v2"}
        headers = {"xi-api-key": settings.elevenlabs_api_key}
        r = requests.post(url, files=files, data=data, headers=headers)
    r.raise_for_status()
    out = r.json()
    return out.get("text", "")


def text_to_speech(
    text: str,
    voice_id: str,
    output_path: Optional[str] = None,
) -> bytes:
    """
    Convert text to speech using cloned voice.
    Returns audio bytes.
    """
    client = _get_client()
    audio = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_turbo_v2_5",
        output_format="mp3_44100_128",
    )
    if isinstance(audio, bytes):
        result = audio
    elif hasattr(audio, "__iter__") and not isinstance(audio, (str, bytes)):
        result = b"".join(chunk if isinstance(chunk, bytes) else chunk for chunk in audio)
    else:
        result = bytes(audio) if audio else b""
    if output_path:
        with open(output_path, "wb") as f:
            f.write(result)
    return result


def generate_audio_stream(text: str, voice_id: str):
    """Stream TTS audio for real-time playback."""
    client = _get_client()
    return client.text_to_speech.stream(
        voice_id=voice_id,
        text=text,
        model_id="eleven_turbo_v2_5",
        output_format="mp3_44100_128",
    )
