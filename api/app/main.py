from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (registers tables on Base)
from .api import activities as activity_routes
from .api import auth as auth_routes
from .api import checkins as checkin_routes
from .api import classes as class_routes
from .auth import check_secret
from .config import settings
from .content import available_languages, languages
from .db import Base, SessionLocal, engine
from .llm import budget
from .services.checkins import migrate_levels, purge_audio
from .speech.audio import ffmpeg_available


@asynccontextmanager
async def lifespan(_: FastAPI):
    check_secret()
    # Hackathon-scale schema management: create tables if missing. Swap for Alembic if the schema churns.
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        purge_audio(db)  # recordings past the retention period
        db.commit()
        migrate_levels(db)  # one level per child -> one per language (no-op once done)
    finally:
        db.close()
    yield


app = FastAPI(title="LevelOS API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_routes.router)
app.include_router(class_routes.router)
app.include_router(checkin_routes.router)
app.include_router(activity_routes.router)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "env": settings.app_env,
        "version": app.version,
        "ffmpeg": ffmpeg_available(),
        "languages": available_languages(),
        "speech_paths": {
            "sarvam": bool(settings.sarvam_api_key),
            "azure": bool(settings.azure_speech_key),
            "gemini": bool(settings.gemini_api_key),
        },
        "claude": bool(settings.anthropic_api_key),
        "claude_budget": _budget_status(),
        "audio_retention_days": settings.audio_retention_days,
    }


def _budget_status() -> dict:
    db = SessionLocal()
    try:
        return budget.status(db)
    finally:
        db.close()


@app.get("/api/languages")
def list_languages() -> list[dict]:
    """Assessment languages with an item bank. Tier 2 is shown as beta in the UI."""
    return [{"code": code, "name": cfg["name"], "english_name": cfg["english_name"], "tier": cfg["tier"]}
            for code, cfg in languages().items() if code in available_languages()]
