from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (registers tables on Base)
from .config import settings
from .db import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Hackathon-scale schema management: create tables if missing. Swap for Alembic if the schema churns.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="LevelOS API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "env": settings.app_env,
        "version": app.version,
        "speech_paths": {
            "sarvam": bool(settings.sarvam_api_key),
            "azure": bool(settings.azure_speech_key),
            "gemini": bool(settings.gemini_api_key),
        },
        "claude": bool(settings.anthropic_api_key),
    }
