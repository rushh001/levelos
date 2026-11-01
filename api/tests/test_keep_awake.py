"""The free Render server keeps itself awake: /api/ping, the address it calls, and the calling loop."""

import asyncio

import httpx
from fastapi.testclient import TestClient

from app import main
from app.config import Settings


def test_ping_reads_no_database(monkeypatch):
    def no_db():
        raise AssertionError("/api/ping must not open a database session (Neon would never sleep)")

    monkeypatch.setattr(main, "SessionLocal", no_db)
    r = TestClient(main.app).get("/api/ping")
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_keep_awake_address_comes_from_render(monkeypatch):
    monkeypatch.delenv("KEEP_AWAKE_URL", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert Settings().keep_awake_url is None  # local runs: off
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://levelos-api.onrender.com")
    assert Settings().keep_awake_url == "https://levelos-api.onrender.com"
    monkeypatch.setenv("KEEP_AWAKE_URL", "https://api.example.org")
    assert Settings().keep_awake_url == "https://api.example.org"


def test_keep_awake_calls_its_own_address_and_outlives_failures(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if len(calls) == 1:
            raise httpx.ConnectError("asleep")  # a missed call must not stop the loop
        return httpx.Response(200, json={"ok": True})

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))

    async def run():
        task = asyncio.create_task(main._keep_awake("https://api.example.org", 0))
        async def three():
            while len(calls) < 3:
                await asyncio.sleep(0)
        await asyncio.wait_for(three(), timeout=5)
        task.cancel()

    asyncio.run(run())
    assert calls[:3] == ["https://api.example.org/api/ping"] * 3
