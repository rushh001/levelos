# Offline tests

Playwright drives the installed Chrome through the DevTools protocol and checks what a teacher meets with no network, a weak one, or one that drops mid-check. Each test states what *should* happen; a failing test is a place where the app breaks offline.

It runs against a **local production build** (the service worker exists only in a build) and a local API with a throwaway SQLite database (`api/e2e.db`) seeded with the demo class. It never touches the hosted demo. No API keys are needed: without speech keys a recording is not AI-scored, so online checks fall back to tap-marking.

```bash
# once
cd api && py -3.12 -m venv .venv && .venv/Scripts/pip install -r requirements.txt
cd web && npm ci
cd e2e && npm install

# every run (builds the web app, seeds the database, starts both servers)
cd e2e && npx playwright test
npx playwright show-report          # screenshots of every step, notes, traces
npx playwright test -g "4\. the network drops"   # one scenario
```

| Condition | How it is simulated |
|---|---|
| No network (airplane mode) | `context.setOffline(true)` + every request aborted |
| Connected but no internet | API requests aborted at once; the phone still says "online" |
| Weak signal | API requests held and never answered |
| Slow 3G | DevTools `Network.emulateNetworkConditions` (2 s latency, 400 kbps) |
| Microphone | Chrome's fake device playing `.fixtures/reading.wav` (made by `global-setup.ts`) |

`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` (set in `playwright.config.ts`) is required: without it, offline mode and blocking do not reach requests the service worker makes, and "offline" tests would still talk to the server. `tests/zz-harness.spec.ts` checks this.

Known gap: DevTools throttling applies to the page's own requests, not to API reads that go through the service worker, so the slow-3G timings for reading pages are optimistic.
