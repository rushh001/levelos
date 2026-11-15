# Offline tests

Playwright drives the installed Chrome through the DevTools protocol and checks what a teacher meets with no network, a weak one, or one that drops mid-check. Each test states what *should* happen; a failing test is a place where the app breaks offline.

It runs against a **local production build** (the service worker exists only in a build) and a local API with a throwaway SQLite database (`api/e2e.db`) seeded with the demo class. It never touches the hosted demo. The API runs with `NO_AI=1`: no speech services or Claude even if `api/.env` has keys (the fake microphone's tone would only cost money and come back "not sure"), so the teacher marks every card, the same way on every run.

```bash
# once, from the repository root (Windows: .venv\Scripts\pip; macOS/Linux: .venv/bin/pip)
(cd api && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)
(cd web && npm ci)
(cd e2e && npm install)

# every run, from e2e/ (builds the web app, seeds the database, starts both servers)
cd e2e && npx playwright test
npx playwright show-report          # screenshots of every step, notes, traces
npx playwright test -g "4\. the network drops"   # one scenario
```

## Network lab: try it by hand

```bash
cd e2e && npm run lab               # builds the app, starts the API and the app, opens two windows
npm run lab -- --no-build           # reuse the last build
npm run lab -- --reset              # fresh demo data (api/lab.db)
npm run lab -- --fake-mic           # the microphone plays a tone file instead of your voice
```

On the left, the app in a phone-sized window, loaded as it is (nothing is added to the app or its page). On the right, a control window whose buttons change the phone window's network live: 🟢 Online · ✈️ Airplane mode · 📵 No internet (requests fail at once) · 📶 Weak signal (requests never answer) · 🐢 Slow 3G · 🎲 Flaky (half fail). Also ⏱️ airplane mode in 5 s (to lose the network mid-card), 🔄 reload and 🧹 fresh phone (wipes what the app keeps on the phone). It uses its own database (`api/lab.db`) and the speech keys in `api/.env` / `api/.env.local` if there are any: with them the AI marks the cards you read, without them you mark them (`--fake-mic` turns the AI off). Close a window or press Ctrl+C to stop.

Every session is recorded to `e2e/lab-sessions/<date-time>/` (git-ignored): `events.log` (every page, network switch, API request with its result and time, held or failed request, console error, pop-up and answer, whether AI marking is on, and what the app keeps on the phone each time it changes), `screens/` (a screenshot every 5 s while the screen changes, and at every page or network change) and `api.log`. The phone's pop-ups ("Stop this check?") show in the control window with OK / Cancel.

## How the tests simulate the network

| Condition | How it is simulated |
|---|---|
| No network (airplane mode) | `context.setOffline(true)` + every request aborted |
| Connected but no internet | API requests aborted at once; the phone still says "online" |
| Weak signal | API requests held and never answered |
| Slow 3G | DevTools `Network.emulateNetworkConditions` (2 s latency, 400 kbps) |
| Flaky connection | the new child's request dropped (`connectionreset`) while pages still load (test 12) |

Tests 13–16 cover working offline: a check moves the child into a group on the class page at once and ⏳ lists it; the activity made on the phone stars the letters just misread; the class page says it is ready offline; a word tapped while the child reads stays marked.
| Microphone | Chrome's fake device playing `.fixtures/reading.wav` (made by `global-setup.ts`) |

`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` (set in `playwright.config.ts`) is required: without it, offline mode and blocking do not reach requests the service worker makes, and "offline" tests would still talk to the server. `tests/zz-harness.spec.ts` checks this.

Every check runs on the phone (`/check/<id>`), so scenarios with and without network go through the same screen. Test 10 checks that the app *asks* the browser to keep its data; Chrome itself says yes only to an app added to the home screen (or used often), and always no in a fresh test browser.

Known gap: DevTools throttling applies to the page's own requests, not to API reads that go through the service worker, so the slow-3G timings for reading pages are optimistic.

## Acceptance run: a teacher's day, watched tap by tap

```bash
cd e2e && npm run lab                                  # the lab's API and app (or let the run start them)
npx playwright test -c playwright.uat.config.ts        # all 11 scenarios, in a visible window
npx playwright test -c playwright.uat.config.ts -g "S7 "   # one
```

`uat/uat.spec.ts` drives the app's screens like a teacher. For every card shown, Azure's voice (`uat_say.py`, the keys in `api/.env`) reads it into the microphone (and the speakers), with mistakes planted where the scenario wants them, and the **real AI** marks the cards when there is network. Buttons are found by the app's own words in any of its six languages, so a Hindi check (shown in Hindi) runs too. Scenarios: online in English (Level found, one more card, the result) and Hindi; slow 3G; weak signal; flaky; Wi-Fi with no internet; airplane mode (checks, groups moving at once, ⏳, the activity, the sync); the network dropping mid-check; mistakes of every kind (left out, vowel slips, self-corrections, halting, silence, the wrong text); activities made on the phone for every group in both languages, held to the app's own quality rules; the question bank with no internet. The report, with a screenshot of every step and the AI's marks word by word against the planted mistakes, is written to `e2e/uat-reports/<date>/report.html` (git-ignored); `UAT_APPEND=<earlier folders>` merges earlier runs' scenarios into it.
