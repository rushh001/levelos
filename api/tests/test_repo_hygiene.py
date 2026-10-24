"""Guards against committing secrets: the tracked .env.example files must never carry real values."""

from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
EXAMPLES = [REPO / "api" / ".env.example", REPO / "web" / ".env.example"]
SECRET_SUFFIXES = ("_KEY", "_SECRET", "_TOKEN", "DATABASE_URL")


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: str(p.relative_to(REPO)))
def test_env_examples_hold_no_secrets(path):
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        name, value = (s.strip() for s in line.split("=", 1))
        if name.endswith(SECRET_SUFFIXES) and name != "DATABASE_URL":
            assert value == "", f"{path.name}: {name} has a value; real keys go in api/.env.local (gitignored)"
