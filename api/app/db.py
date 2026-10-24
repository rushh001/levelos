from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings

_sqlite = settings.database_url.startswith("sqlite")
_memory = settings.database_url in ("sqlite://", "sqlite:///:memory:")
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _sqlite else {},
    # In-memory SQLite (tests): one shared connection, or every session would see an empty database.
    poolclass=StaticPool if _memory else None,
    pool_pre_ping=not _sqlite,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
