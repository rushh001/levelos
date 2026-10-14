from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "dev"
    database_url: str = "sqlite:///./levelos.db"
    jwt_secret: str = "dev-secret-change-me"
    cors_origins: str = "http://localhost:5173"
    content_dir: Path = Path(__file__).resolve().parents[2] / "content"

    anthropic_api_key: str | None = None
    claude_model: str = "claude-opus-5-5"
    claude_validator_model: str = "claude-haiku-5-5"

    sarvam_api_key: str | None = None
    azure_speech_key: str | None = None
    azure_speech_region: str = "centralindia"
    gemini_api_key: str | None = None

    keep_audio: bool = False

    @field_validator("database_url")
    @classmethod
    def _use_psycopg_driver(cls, v: str) -> str:
        # Neon/Render hand out postgres:// or postgresql:// URLs; SQLAlchemy 2 + psycopg3 needs the explicit driver.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
