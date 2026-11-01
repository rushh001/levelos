from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, inspect, text
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


# Columns added to a table after it first shipped: create_all() makes missing tables but never alters existing ones.
ADDED_COLUMNS = {("students", "names"): "JSON", ("classrooms", "names"): "JSON", ("item_results", "meaning"): "JSON",
                 ("checkins", "fixed_level"): "BOOLEAN DEFAULT FALSE", ("teachers", "email"): "VARCHAR(254)",
                 ("classrooms", "local_id"): "VARCHAR(64)", ("students", "local_id"): "VARCHAR(64)"}


def create_schema(bind: Engine = engine) -> None:
    """Create missing tables, then add the columns newer code expects to tables an older version created."""
    from . import models  # noqa: F401  (registers every table on Base)

    Base.metadata.create_all(bind=bind)
    existing = inspect(bind)
    with bind.begin() as conn:
        for (table, column), ddl in ADDED_COLUMNS.items():
            if column not in {c["name"] for c in existing.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
