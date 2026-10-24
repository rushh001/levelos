"""Shared HTTP for speech vendors.

- Retries only where the vendor cannot have billed us: connection/DNS failures (request never sent), 429 and 5xx.
  A read timeout is not retried, because the request may already have been processed and charged.
- Per-vendor concurrency limits: Azure's F0 tier allows one concurrent recognition, so calls queue instead of
  failing with 429.
"""

from __future__ import annotations

import asyncio

import httpx

RETRY_STATUS = {429, 500, 502, 503, 504}
CONCURRENCY = {"azure": 1, "sarvam": 2, "gemini": 2}

_semaphores: dict[tuple[str, int], asyncio.Semaphore] = {}


def _semaphore(vendor: str) -> asyncio.Semaphore:
    # Semaphores bind to the running event loop, so keep one per (vendor, loop).
    key = (vendor, id(asyncio.get_running_loop()))
    if key not in _semaphores:
        _semaphores[key] = asyncio.Semaphore(CONCURRENCY.get(vendor, 4))
    return _semaphores[key]


async def post(vendor: str, url: str, *, attempts: int = 5, timeout_s: float = 30.0, **kwargs) -> httpx.Response:
    delay = 1.0
    for attempt in range(attempts):
        last = attempt == attempts - 1
        try:
            async with _semaphore(vendor):
                async with httpx.AsyncClient(timeout=timeout_s) as client:
                    r = await client.post(url, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            if last:
                raise
        else:
            if r.status_code not in RETRY_STATUS or last:
                return r
            retry_after = r.headers.get("retry-after", "")
            if retry_after.isdigit():
                delay = max(delay, float(retry_after))
        await asyncio.sleep(delay)
        delay *= 2
    raise AssertionError("unreachable")
