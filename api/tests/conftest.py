"""Hermetic test setup: in-memory database, no vendor keys, no response cache on disk."""

import os

# In-memory SQLite by default; set TEST_DATABASE_URL to run the same tests against a (throwaway) Postgres database.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite://")
os.environ["APP_ENV"] = "test"

import pytest  # noqa: E402

from app.config import settings  # noqa: E402

# api/.env.local holds real keys; tests must never reach a vendor.
for _key in ("anthropic_api_key", "sarvam_api_key", "azure_speech_key", "gemini_api_key"):
    setattr(settings, _key, None)
settings.speech_cache = False
settings.keep_awake_url = None  # never call out, even if the environment sets it
settings.diagnosis_debounce_s = 0  # no waiting in tests


@pytest.fixture
def db():
    from app.db import Base, SessionLocal, engine

    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
