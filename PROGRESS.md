# LevelOS — progress tracker

Last updated: **Wed 15 Oct 2026** · Build deadline **Sat 1 Nov, 11:59pm** (17 days) · Last commit: `5347fdb` on `main`
Plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) · Research: [docs/research/](docs/research/)

Owners: **CC** = Claude Code (writes code/docs), **Z** = Zaid (accounts, keys, phones, hosting, teachers, video), **R** = Raazi (content curation, user testing, PPT).

---

## 1. Done

### Research & planning
- [x] Read hackathon guidelines + submitted deck; researched build-stage fine print, jury, judging weights → [research/01](docs/research/01-hackathon-and-pedagogy.md)
- [x] ASER procedure/scoring, EGRA/EGMA, NIPUN targets, TaRL grouping + activities, CBSE FLN resources, Hindi error taxonomy (Raman & Rao 2025) → research/01
- [x] Competitive landscape (Wadhwani Vaachan Samiksha, IIT-B TARA, Pratham PadhAI / Tech-in-TaRL, Read Along Classroom, Tools Competition 2025 winner) and our defensible gap → [research/02](docs/research/02-competitive-landscape.md)
- [x] Speech-tech options for child speech, the ASR auto-correct problem, offline strategy, Claude pricing → [research/03](docs/research/03-asr-and-architecture.md)
- [x] Build plan with scope, architecture, stack, day-by-day schedule, submission artefacts, risks → [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)

### Decisions taken (15 Oct)
- [x] API hosting: Render free tier + UptimeRobot keep-alive (or personal Azure if Z provides it)
- [x] Open-source under MIT at submission (private until 1 Nov)
- [x] Multilingual by design, tiered: **Tier 1 validated** = Hindi, English · **Tier 2 beta** = Marathi, Gujarati, Kannada, Tamil, Telugu, Odia
- [x] Gemini key available → optional third reference-free speech path
- [x] No company (WellDoc) resources; all keys/hosting are personal
- [x] GitHub: `rushh001/levelos` over SSH

### Repo & infrastructure
- [x] Monorepo scaffold: `web/` (React 18 + Vite + TS + Tailwind, vite-plugin-pwa, Dexie, i18n hi/en), `api/` (FastAPI, SQLAlchemy 2, pydantic-settings), `content/`, `eval/`, `docs/`
- [x] Web builds and type-checks; service worker + manifest generated (7 precache entries)
- [x] API boots; `GET /api/health` reports which speech paths/Claude keys are configured
- [x] Dockerfile (python 3.12 + ffmpeg), `render.yaml`, `.env.example` for api and web, `.gitignore`, `.gitattributes`, MIT `LICENSE`, README stub
- [x] Data model: Teacher, Classroom, Student, Checkin, ItemResult, Diagnosis, LevelHistory, GeneratedActivity ([models.py](api/app/models.py))
- [x] Language data-pack config with vendor locale map ([content/languages.json](content/languages.json))
- [x] First commit pushed to GitHub

### Core engine (deterministic, tested — 37 tests passing)
- [x] **ASER rules engine** [aser_rules.py](api/app/levels/aser_rules.py): 4/5 letters, 4/5 words, ≤3 passage mistakes + halting approximation, adaptive ladder (start by grade/history, up on pass, down on fail, bracketing, 4-item cap), **two-check confirmation guardrail**, cohort mapping
- [x] **Multi-path aligner** [align.py](api/app/speech/align.py): grapheme-cluster (akshara) alignment for any script, matra-aware similarity, Devanagari nukta/chandrabindu normalisation, English letter-name aliases, repeat + self-correction handling (EGRA convention), **fusion across vendors with per-word `uncertain` flag**

### Speech path clients (written, untested — need keys)
- [x] [sarvam.py](api/app/speech/sarvam.py) — `saaras:v3` verbatim (no reference text passed, by design)
- [x] [azure.py](api/app/speech/azure.py) — reference-free STT + scripted Pronunciation Assessment (hi/en/ta, `EnableMiscue`, ≤30 s)
- [x] [gemini.py](api/app/speech/gemini.py) — audio-native verbatim transcription prompt
- [x] [audio.py](api/app/speech/audio.py) — ffmpeg → 16 kHz mono WAV, duration, loudness check

---

## 2. Blocked / waiting on a person

| Item | Needed from | Why it blocks |
|---|---|---|
| `ANTHROPIC_API_KEY` (hackathon credits) | Z — check Hack2Skill dashboard / email | Diagnosis + activity generation can't be tested |
| `SARVAM_API_KEY` | Z — dashboard.sarvam.ai | Speech path A |
| `AZURE_SPEECH_KEY` + region (personal Azure, F0 Speech resource) | Z | Speech path B + Pronunciation Assessment; the Day-1 spike |
| `GEMINI_API_KEY` | Z — already has it | Speech path C |
| ffmpeg on this PC: `winget install Gyan.FFmpeg` | Z | Local audio conversion |
| Hosting target confirmation (Render free vs personal Azure) | Z | Deploy on Wed 22 |
| Neon Postgres URL (free), Vercel account (personal) | Z | Deploy |
| 2–3 real test clips (a child/adult reading the Hindi paragraph + 5 letters, recorded on an Android phone) | Z | Day-1 spike needs real audio, not TTS |
| Mentor booking link (education mentor first) | Z — when organisers send it | Item-bank and ASER-fidelity review |
| Hack2Skill "resources to help build" files (logged-in dashboard) | Z | May contain official item/activity material |

Put keys in `api/.env` (copy `api/.env.example`). Never commit `.env`.

---

## 3. Next steps (in order)

| # | Step | Owner | Requires | Target |
|---|---|---|---|---|
| 1 | **Day-1 spike**: run 2–3 real clips through Sarvam, Azure STT, Azure PA (hi-IN + EnableMiscue), Gemini; compare transcripts; confirm Tier-2 locale coverage in Azure STT + Sarvam; pick primary path per language | CC (Z supplies keys + clips) | Keys 1–4, ffmpeg, clips | Thu 16 |
| 2 | **Item banks v0** (`content/items/hi.json`, `en.json`): per ASER spec — 5-letter sets, 5 familiar words (2 letters + 1–2 matras), Std-I paragraph (4 sentences ≤6 words), Std-II story (7–10 sentences); ≥2 variants per level | CC drafts → R reviews with an educator | Nothing to start; educator/mentor review before Sun 19 | Thu 16 draft, Sun 19 reviewed |
| 3 | **Scorer + orchestrator** (`scorer.py`, `scoring.py`): convert WAV → run paths concurrently → fuse → errors/hesitations/WCPM → `ItemOutcome` → ASER level; confidence gating (silent/short clip → re-record) | CC | Nothing | Fri 17 |
| 4 | **Claude diagnosis** (`llm/diagnose.py`): structured output with fixed error-pattern enum, evidence, Hi+En teacher summary; cached system prompt; unit tests with recorded fixtures | CC | `ANTHROPIC_API_KEY` to run; code can be written without it | Sat 18 |
| 5 | **API routes**: teacher login (login + PIN → JWT), classes, students, check-in create/upload-item/finish, result with uncertain words, teacher override (word, level) | CC | Nothing | Sun 19 |
| 6 | **PWA check-in flow**: login → class → child → ladder screens (big text + audio prompt + mic) → upload → result screen with uncertain-word confirm | CC | An Android phone (Chrome) to test MediaRecorder; `npm run dev --host` on the LAN | Sun 19 |
| 7 | **Dashboard**: roster, student history, 3 cohort cards with dominant error patterns (confirmed level, provisional flagged) | CC | Nothing | Mon 20 |
| 8 | **Activity bank curation** (`content/activities/*.json`, 30–50 entries with level, patterns, materials, 10-min steps, **source citation**) | R (+ CC to structure/ingest) | Pratham TaRL session guide + TLM note, NIPUN guidelines, CBSE–CSF compendiums, StoryWeaver (links in research/01 §6) | Mon 20 – Wed 22 |
| 9 | **Activity generator + validator** (`llm/activities.py`, `llm/validate.py`), "Generate 10-min activity" UI, teacher rating | CC | Claude key; activity bank v0 (even 10 entries) | Tue 21 |
| 10 | **Deploy v1**: API (Render/Azure) + web (Vercel) + Neon; seed demo class with history; UptimeRobot on `/api/health`; `CORS_ORIGINS` set | CC + Z | Hosting decision, Neon URL, Vercel account, UptimeRobot (free) | Wed 22 |
| 11 | **Teacher round 1** (3 teachers, 20 min each on the live link): log confusions, Hindi wording, what they'd do with a cohort card | R + Z | 3 teachers recruited (govt/private/NGO/tuition all fine); consent template (CC drafts) | Wed 22 – Thu 23 |
| 12 | **Offline**: precache shell/items/audio; Dexie queue; sync on reconnect; pending badges; **tap-to-mark provisional scoring**; airplane-mode + throttled tests on 2 phones | CC + Z (phones) | Two Android phones | Thu 23 – Fri 24 |
| 13 | **Instruction audio** for all 8 languages, pre-generated and precached | CC | Sarvam key (Bulbul TTS) or Indic-Parler on Colab; native check of Tier-2 phrasing | Fri 24 |
| 14 | **Tier-2 item banks** adapted from ASER testing tools (mr, gu, kn, ta, te, or) | R + CC | ASER tools PDFs per language (asercentre.org), terms check, native-speaker spot checks (15 min each) | Tue 21 – Sat 25 |
| 15 | **Eval set + harness** (`eval/`): 30–50 consented clips (children + adults simulating matra swaps/skips/guesses), hand labels, word-level and level agreement, uncertain rate, override rate → `eval/results.md` | Z + R record/label; CC harness | Consent form; 5–10 children with parental consent; adult volunteers | Fri 24 – Sun 26 |
| 16 | **Teacher round 2** + before/after changes, quotes → `docs/user-testing.md` | R + Z | Same teachers | Mon 27 |
| 17 | **Hosting hardening**: test logins for evaluators, 3–5 sample clips uploadable without a child, frozen `v1.0-submission` tag, error states, cold-start check | CC + Z | Deployed v1 | Mon 27 – Tue 28 |
| 18 | **FEATURE FREEZE** → README (run locally, `.env.example`, AI services list, ASER citations, eval numbers, guardrails, limitations), architecture diagram | CC | — | Wed 29 |
| 19 | **PPT** (AI layers, guardrails, offline matrix, differentiation, user testing, roadmap) + **video script** | R (+ CC drafts) | Eval numbers, teacher quotes, screenshots | Tue 28 – Thu 30 |
| 20 | **3-min video** recorded/edited/uploaded (unlisted YouTube) | Z | Working deployed demo, 2 phones, screen recorder | Thu 30 – Fri 31 |
| 21 | **Submit** on Hack2Skill: demo link + logins, repo access for evaluator IDs, video link, PPT; flip repo public (MIT); **no commits after** | Z | Everything above | Sat 1 Nov, afternoon |

---

## 4. Open questions / decisions pending
- Primary speech path per language after the spike (Sarvam v3 verbatim vs v4; whether Gemini is reliable enough to count as a vote).
- Hosting: Render free or personal Azure (App Service / Container Apps). Dockerfile works for both.
- Whether to show Tier-2 languages in the demo at all (plan: visible but labelled "beta"; never demoed live unless spot-checked).
- Consent form wording for child recordings (CC to draft; Z/R to adapt).

## 5. How to check the current state
```bash
cd api && .venv/Scripts/python -m pytest -q          # 37 tests
cd api && .venv/Scripts/uvicorn app.main:app --reload  # http://localhost:8000/api/health
cd web && npm run dev                                 # http://localhost:5173
```

## 6. Log
- **15 Oct** — research, plan, decisions, scaffold, ASER rules + aligner + speech clients; first push (`5347fdb`).
