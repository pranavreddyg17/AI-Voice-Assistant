"""Application configuration from environment variables."""
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    
    # API Keys
    mistral_api_key: str = ""
    elevenlabs_api_key: str = ""
    
    # Twilio (optional, for production telephony)
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    elevenlabs_agent_id: str = ""
    elevenlabs_phone_number_id: str = ""
    
    # W&B
    wandb_api_key: str = ""
    wandb_project: str = "insurance-voice-assistant"
    
    # App
    upload_dir: str = "uploads"  # relative to backend dir
    chunk_size: int = 500
    chunk_overlap: int = 50
    rag_top_k: int = 5
    
    class Config:
        env_file = str(Path(__file__).resolve().parent.parent / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
