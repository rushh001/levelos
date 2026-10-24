# LevelOS — progress tracker

Last updated: **Fri 24 Oct 2026** · Build deadline **Sat 1 Nov, 11:59pm** (8 days) · Last commit: `9c52598` on `main` (24 Oct work is not committed yet)
Plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) · Research: [docs/research/](docs/research/) · Deploy: [docs/DEPLOY.md](docs/DEPLOY.md)

Owners: **CC** = Claude Code (writes code/docs), **Z** = Zaid (accounts, keys, phones, hosting, teachers, video), **R** = Raazi (content curation, user testing, PPT).

---

## 1. Done

### 15 Oct — research, plan, scaffold
- [x] Research briefs 01–03, build plan, decisions (Render + Neon + Vercel, MIT at submission, Tier 1 hi/en + Tier 2 six languages)
- [x] Monorepo scaffold; ASER rules engine; multi-path aligner; speech clients (untested)

### 24 Oct — Phases 0–4, 6, 7 built and tested (CC)
- [x] **Engine fixes**: letter cards in every Indic script (were scored wrong outside Devanagari), uncertain only when paths disagree on right/wrong, positional letter cards (b/d reversal = 2 errors), spelling kept for display (सड़क not सडक)
- [x] **Item banks** hi + en v0 to the ASER spec (3 letter, 3 word, 2 paragraph, 2 story variants each), test-enforced; **recording script** + gold transcripts for 9 test clips
- [x] **Speech pipeline**: Sarvam + Azure STT + Azure PA (+ optional Gemini) in parallel, ≤28 s segmentation for slow readers, retries, Azure F0 one-at-a-time, response cache (each clip paid once), quality gate (short / silent / long / wrong card), PA as tie-breaker only, pauses from PA timing or from the audio
- [x] **Spike on synthetic clips** (Azure TTS): 118/118 words agree with gold for Sarvam and Azure; all 9 clips pass/fail as expected → [eval/README.md](eval/README.md). Findings applied: Sarvam `codemix` for English, first-akshara letter matching, Gemini `gemini-3.5-flash` (2.5 closed to new keys)
- [x] **API**: teacher login (ID + PIN → JWT), classes, children, adaptive check-in ladder, teacher review of uncertain words *before* the ladder moves on, overrides, level replay (two-check confirmation), dashboard cohorts, tap-to-mark, offline sync endpoint
- [x] **Diagnosis**: akshara-level evidence features → rule-based diagnosis at once → Claude Opus 5.5 (JSON schema, refusal fallback) in the background, citations verified. *Runs on rules until the Anthropic key is added.*
- [x] **Activity bank** (17 entries, each cited) + generator (Claude adapts one of 3 candidates) + Haiku reviewer + bank fallback; rating
- [x] **Phone app**: login, classes, dashboard (3 cohort cards, dominant difficulties, add child), child page, check-in (big cards, recorder, review, tap-to-mark), result (level, diagnosis, tappable words, override), activity page; Hindi + English UI
- [x] **Offline**: app + cached class data open offline; check-in runs on the phone (record + tap, ladder ported to TS, parity test); queue + automatic sync; AI re-scores synced recordings and flags disagreements; instruction audio pre-generated (Azure TTS) and precached
- [x] **Demo seed**: logins `demo`/1234 and `judge`/2026, 16 fictional children with history
- [x] **Deploy prep**: Dockerfile (seeds on first start), render.yaml, web/vercel.json, [docs/DEPLOY.md](docs/DEPLOY.md); README for judges
- [x] **Verification**: end-to-end runs in headless Edge with a WAV file as microphone (online check-in; offline → reload → check-in → reconnect → sync → AI diagnosis)

### 24 Oct (later) — real recordings, Claude live, spend protection (CC)
- [x] **9 real recordings** (Z, adult, Android): against what was actually said (5 reading deviations confirmed by Z listening back), live configuration **117/118 words (99.2%)**, **9/9 clips** pass/fail as expected; an unnoticed slip (रानी for रीना) was caught → [eval/README.md](eval/README.md)
- [x] Fixes from them: halting = long pauses *inside sentences* (≥2.5 s), joined/split compounds ("everyday") not errors, "ghee" for g
- [x] **Claude live**: diagnosis ≈ **$0.02** per check-in (Opus 5.5, effort medium chosen after a low/medium comparison on real evidence), activity ≈ **$0.05**; prompt caching works; gender-neutral Hindi/English wording enforced (Claude had guessed gender from names)
- [x] **Spend protection**: every call logged with tokens + $; hard caps (hosted $400 total / $25 per day; local $30 / $15); app falls back to rules when capped; bursts of teacher corrections cost one call; `scripts/claude_spend.py` report; `scripts/diagnose_pending.py` to give the demo class Claude diagnoses (~$0.65 once)
- [x] **Spent so far (local ledger): $0.22** of the $500 credit
- [x] 110 API tests

### 24 Oct (evening) — deploy prep verified, recording replay, documentation (CC)
- [x] Committed and pushed `117c462` (author: Mohd Zaid Husain <rushhinjam@gmail.com>, repo-local identity; SSH as `rushh001`)
- [x] Neon database (via Vercel Storage) checked: direct URL, Singapore; **all tests pass on Postgres 18**; demo data seeded
- [x] **Docker image built exactly as Render will** (110 s); production-mode container + production web build verified in a browser: recorded check-in with a real voice, activity, offline round trip; image also checked read-only against Neon
- [x] **Recording replay** (asked for by Z): recordings kept 30 days as small MP3 for the class's teacher; confirm panel has ▶ whole card and 🔊 per word, and shows what each recogniser heard (for letters, the letter); result page plays each card with the words highlighted; teacher can delete recordings; auto-purge after `AUDIO_RETENTION_DAYS`
- [x] Fixes: dashboard no longer refetches every child's page on each visit; "detailed analysis coming" only when Claude is available
- [x] README rewritten; **[document.md](document.md)**: full description of every stage, service, rule, guardrail, data and configuration
- [x] Group set by hand on a child's page now sets where the reading check starts (asked for by Z)
- [x] 118 API tests

### 24 Oct (night) — hosted demo deployed, login fix (Z deployed; CC)
- [x] Pushed `5fb28f0`; Z deployed the web app to **https://levelos-nine.vercel.app** (Vercel) and the API to **https://levelos-api.onrender.com** (Render, Neon database); demo data seeded, `demo` and `judge` logins work against the API
- [x] Every login from the hosted app failed: `CORS_ORIGINS` on Render ended in a slash (`…vercel.app/`), which never matches the origin a browser sends. The API now ignores a trailing slash, path or capitals in `CORS_ORIGINS`
- [x] Login page: "wrong login ID or PIN" only for a real wrong PIN; "can't reach the server" when the request is blocked or the network is down; a note while the free server wakes up
- [x] 119 API tests

---

## 2. Blocked / waiting on a person

| Item | Needed from | Why it blocks |
|---|---|---|
| Recordings of children (with written parental consent) | Z + R | Accuracy on children's voices — the claim judges care about |
| Keep-alive monitor on `/api/health` ([docs/DEPLOY.md](docs/DEPLOY.md) step 6), if not set up yet | Z | Without it the free API sleeps and the first login takes up to a minute |
| Android phone test (Chrome) | Z | Microphone, layout and offline on a real budget phone |
| 3 teachers for one round of testing (Tue 28 – Wed 29) | Z + R | User-testing evidence (35% of the score) |
| Educator check of item banks + activity bank (status: draft) | R | Fidelity claims in the PPT |
| Rotate the Azure keys after the hackathon (they were pasted in chat) | Z | Hygiene |

---

## 3. Next steps

| # | Step | Owner | Target |
|---|---|---|---|
| 1 | ~~Anthropic key → live diagnoses + activities~~ done 24 Oct | — | ✓ |
| 2 | ~~Real clips → eval → tune~~ done 24 Oct (deviations confirmed) | — | ✓ |
| 3 | ~~Deploy (Vercel + Neon storage, Render)~~ done 24 Oct; still to do: UptimeRobot, then `diagnose_pending` for the demo class | Z, CC | Sun 26 |
| 4 | Phone test on Android: online + airplane mode | Z | Mon 27 |
| 5 | Teacher round (3 teachers, live link) → fixes → `docs/user-testing.md` | R + Z, CC fixes | Tue 28 – Wed 29 |
| 6 | Evaluation set: 30–50 consented clips (adults simulating errors; children only with parental consent) → results table | Z + R record, CC harness | by Wed 29 |
| 7 | Feature freeze; consent form, PPT outline, video script drafts | CC drafts, R/Z finalise | Wed 29 |
| 8 | 3-min video | Z | Thu 30 – Fri 31 |
| 9 | Submit; flip repo public (MIT); no commits after | Z | Sat 1 Nov afternoon |

## 4. Open questions
- Tier-2 languages: engine and vendor config exist, no item banks. Plan: mention as "engine-ready" in the PPT, do not demo.
- Whether to show Gemini anywhere in the demo (currently: eval only, never children's audio).

## 5. How to check the current state
```bash
cd api && .venv/Scripts/python -m pytest -q                 # 118 tests
cd api && .venv/Scripts/python -m scripts.seed_demo --reset   # demo data (local SQLite)
cd api && .venv/Scripts/uvicorn app.main:app --reload         # http://localhost:8000/api/health
cd web && npm run dev                                         # http://localhost:5173
```

## 6. Log
- **15 Oct** — research, plan, decisions, scaffold, ASER rules + aligner + speech clients; first push (`5347fdb`).
- **24 Oct** — Phases 0–4, 6, 7 implemented and verified locally (see §1); not yet committed (waiting for Z's go-ahead).
- **24 Oct (later)** — real recordings scored, Claude live (spent $0.22), spend caps added.
- **24 Oct (evening)** — pushed `117c462`; Postgres + Docker verified; recording replay; README + document.md.
- **24 Oct (night)** — pushed `5fb28f0`; Z deployed to Vercel + Render (Neon); fixed login blocked by a trailing slash in `CORS_ORIGINS`.
