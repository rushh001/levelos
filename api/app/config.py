from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[1]
# Development-only signing key; production refuses to start with it (app.auth.check_secret).
DEV_JWT_SECRET = "levelos-dev-only-insecure-jwt-secret-change-me"


class Settings(BaseSettings):
    # .env.local (secrets, gitignored) overrides .env; real environment variables override both.
    # Empty values (KEY=) fall back to the defaults below.
    model_config = SettingsConfigDict(
        env_file=(API_DIR / ".env", API_DIR / ".env.local"),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    app_env: str = "dev"
    database_url: str = "sqlite:///./levelos.db"
    jwt_secret: str = DEV_JWT_SECRET
    cors_origins: str = "http://localhost:5173"
    content_dir: Path = API_DIR.parent / "content"
    # Vendor responses keyed by audio hash, so re-running a clip never spends free-tier credit twice (off in prod).
    speech_cache: bool = True
    speech_cache_dir: Path = API_DIR / ".cache" / "speech"

    anthropic_api_key: str | None = None
    claude_model: str = "claude-opus-5-5"
    claude_validator_model: str = "claude-haiku-5-5"
    # Hard spend caps (app/llm/budget.py). Each database keeps its own ledger: keep the local cap small.
    claude_budget_usd: float = 400.0
    claude_daily_budget_usd: float = 25.0
    claude_diagnosis_effort: str = "medium"
    claude_activity_effort: str = "medium"
    # Wait this long after the last change before diagnosing, so a burst of teacher taps costs one call.
    diagnosis_debounce_s: float = 8.0

    sarvam_api_key: str | None = None
    sarvam_model: str = "saaras:v3"
    azure_speech_key: str | None = None
    azure_speech_region: str = "centralindia"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash"  # Oct 2026, free tier: verbatim and ~5 s; 2.5 is closed to new keys, 3.8 times out, lite models auto-correct
    # Gemini's free tier may use uploads for training, so it never hears real children unless this is set
    # (paid tier). Scripted adult clips in eval/ still use it.
    gemini_for_children: bool = False

    keep_audio: bool = False  # also write raw uploads to disk (consented evaluation set only)
    # Recordings kept (as small MP3) so the teacher can listen again; deleted after this many days. 0 = never stored.
    audio_retention_days: int = 30

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
