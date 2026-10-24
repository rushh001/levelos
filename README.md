# LevelOS

**A 3-minute, voice-first reading check on the teacher's phone.** It finds each child's real reading level the ASER way, shows what kind of mistakes the child makes, regroups the class for Teaching at the Right Level, and gives the teacher a 10-minute activity for each group. Hindi and English. Works offline.

Built for the AI for Foundational Learning Hackathon (Challenge 02: Learning-Level Visibility) by Team rushhies.

**Live demo: [levelos-nine.vercel.app](https://levelos-nine.vercel.app)** (API status: [levelos-api.onrender.com/api/health](https://levelos-api.onrender.com/api/health)). The API runs on a free plan; if it has been idle, the first login can take up to a minute.

**Demo logins** (teacher is the only role): `demo` / PIN `1234` or `judge` / PIN `2026` — or tap **Try the demo class** on the login page. The demo class (Grade 2) has 16 fictional children, each with two weeks of history in English and in Hindi; no real child's data is in the hosted demo.

📖 **How everything works, stage by stage:** [document.md](document.md)

---

## What it does

- **Adaptive reading check (ASER)**: letters → words → paragraph → story, one card at a time, moving up on a pass and down on a fail until the level is bracketed. The child reads from a large card; the teacher records.
- **English and regional-language tests**: as in ASER, each child is tested in English and in their regional language (Hindi today), with a separate level and group in each. Switching the app to English switches the test to English; a **Reading test** switch picks the language on its own. The app opens in English.
- **Scoring that cannot "auto-correct" the child**: two speech recognisers (Sarvam, Azure) transcribe without seeing the text; deterministic code aligns their transcripts with the card akshara by akshara and marks every word right, wrong, skipped or self-corrected.
- **Honest uncertainty**: words the recognisers disagree on are marked *uncertain*; if they could change the result, the teacher confirms them — listening to the child's recording, with a 🔊 per word — before the check moves on.
- **ASER rules in code decide the level**; two agreeing check-ins confirm it; the teacher can override anything.
- **Diagnosis by Claude**: the error pattern (matras, conjuncts, blending, letter confusion, sight words, guessing, fluency; for English: letter sounds, vowel sounds, blends) with the exact words as evidence, and a short note for the teacher in Hindi and English.
- **Class dashboard** in three TaRL groups with each group's main difficulties.
- **10-minute activity per group**, adapted by Claude from a cited bank of 22 activities (Pratham TaRL, ASER, StoryWeaver; English groups get phonics versions, never barakhadi or matra work) and checked by a second model.
- **Replay**: every card's recording can be played again for 30 days (only by that teacher), with words highlighted as they are read.
- **Offline**: the app, class data, cards and spoken instructions work without network; the teacher taps the mistakes, the ladder runs on the phone, and everything syncs and is AI-checked when the network returns.

## How a check-in flows

```
phone: record a card ─► API: ffmpeg → quality gate (silent / short / long / wrong card → re-record)
  ─► speech: Sarvam + Azure STT (never see the text) · Azure Pronunciation Assessment (tie-break, timings)
  ─► align + fuse words (akshara level) → uncertain words → teacher confirms if they could flip the card
  ─► ASER rules: 4/5 letters or words; paragraph/story ≤3 mistakes, not halting → next card or level
  ─► level (provisional → confirmed by 2 check-ins) → diagnosis (rules at once, Claude in the background)
  ─► dashboard groups → 10-minute activity (Claude adapts a cited bank entry, Claude Haiku reviews it)
```

Every stage, rule and number is described in [document.md §4](document.md#4-a-check-in-stage-by-stage).

**Architecture**: React PWA on Vercel → FastAPI in Docker on Render → Postgres on Neon (via Vercel Storage); speech by Sarvam and Azure; Claude via the Anthropic API.

## AI services and keys

| Service | Used for | Key (`api/.env.local`, never committed) |
|---|---|---|
| Anthropic **Claude Opus 5.5** (`claude-opus-5-5`) | Error-pattern diagnosis (~$0.02 per check-in); adapting activities (~$0.05 each) | `ANTHROPIC_API_KEY` |
| Anthropic **Claude Haiku 5.5** (`claude-haiku-5-5`) | Reviewing each generated activity | `ANTHROPIC_API_KEY` |
| **Sarvam AI** `saaras:v3` | Speech recognition path A (reference-free) | `SARVAM_API_KEY` |
| **Azure Speech** | Speech recognition path B (reference-free), Pronunciation Assessment (tie-break, word timings), pre-recorded instructions (TTS) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Google Gemini `gemini-3.5-flash` | Evaluation script only (adult test clips); never used for children's audio | `GEMINI_API_KEY` (optional) |

**No LLM decides a level.** Without `ANTHROPIC_API_KEY`, or once the spend cap is reached, diagnosis and activities fall back to rule-based and bank versions and the app keeps working.

## Guardrails

- Recognisers that vote never see the expected text; the text-aware one only breaks ties.
- Disagreements become uncertain words; the teacher confirms them (by ear) whenever they could change a result.
- Two agreeing check-ins to confirm a level; teacher overrides logged; levels replayed from history.
- Claude: fixed pattern list and JSON schema, citations verified against the evidence, rule-based fallback, no gender guessed from names; activities must adapt a cited bank entry and pass a second-model review.
- Poor audio is never scored: "please record again".
- **Spend caps** on Claude (hosted demo: $400 total, $25 a day) with a cost ledger, so the credit lasts through the evaluation.
- Child data: first name + emoji only; recordings kept 30 days for the teacher, then deleted (or deleted by the teacher any time).

Full table: [document.md §8](document.md#8-guardrails).

## Offline

| | Online | Offline |
|---|---|---|
| Open the app, class, groups, children | ✓ | ✓ cached on the phone |
| Cards and spoken instructions | ✓ | ✓ shipped in the app |
| Check-in and level | ✓ AI-scored | ✓ teacher taps the mistakes, ladder on the phone, provisional level |
| AI scoring, diagnosis, activity | ✓ | sent automatically when back online; AI–tap disagreements come back for confirmation |

## Results

On nine real recordings (an adult reading scripted mistakes in Hindi and English on an Android phone; references confirmed by listening back), the live configuration agreed on **117 of 118 words (99.2%)** and gave the expected pass/fail on **9 of 9** cards; the one miss was sent to the teacher as uncertain, and it caught a slip the reader didn't notice. Children's voices are not yet in the set. Details: [eval/README.md](eval/README.md).

130 automated tests (SQLite and Postgres); end-to-end browser runs against the production Docker image (recorded check-in, activity, offline round trip, replay).

## Run locally

Prerequisites: Python 3.12, Node 20+ (ffmpeg optional; a bundled copy is used).

```bash
# API
cd api
python -m venv .venv
.venv/Scripts/activate              # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env.local          # add your keys
python -m scripts.seed_demo         # demo logins + class
uvicorn app.main:app --reload --port 8000

# Web (second terminal)
cd web
npm install
npm run dev                         # http://localhost:5173 (proxies /api to :8000)
npm run dev:https                   # self-signed HTTPS, to test the microphone on a phone on the same Wi-Fi
```

Or the API exactly as deployed: `docker build -f api/Dockerfile -t levelos-api .` from the repository root, then run it with `APP_ENV=prod`, `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGINS` and the keys ([document.md §15](document.md#15-configuration) lists every setting).

Tests: `cd api && .venv/Scripts/python -m pytest` (no network or keys needed).

## Deploy

Step by step, about 45 minutes, free plans: [docs/DEPLOY.md](docs/DEPLOY.md) — database from Vercel Storage (Neon), API on Render (`render.yaml`), web app on Vercel (root directory `web`).

## Repository

```
web/       React PWA (teacher's phone)
api/       FastAPI: speech pipeline, scorer, ASER rules, Claude, spend caps; scripts; tests
content/   item banks (hi, en), activity bank, language config
eval/      scripted test clips, gold transcripts, results
docs/      deploy guide, recording script, build plan, research briefs
```

More: [document.md](document.md) (full description) · [PROGRESS.md](PROGRESS.md) (status) · [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) · [docs/research/](docs/research/)

## Content and sources

Item banks are original texts written to the ASER 2024 reading-tool specification (test-enforced); the activity bank adapts activities from Pratham / TaRL Africa *Planning TaRL Sessions* (2021) and *Literacy TLM Note* (2021), the ASER 2024 procedure and StoryWeaver, each entry citing its source. Both are drafts awaiting an educator's review. Error categories follow Raman & Rao (Interspeech 2025). English and Hindi are complete. Regional languages come next, after mentor approval: Marathi, Odia, Tamil, Kannada and Telugu (and Gujarati) are configured in the engine but have no item banks yet, and Malayalam is still to be configured; each is a data pack (language config, item bank, instruction audio, review), not new code ([document.md §11](document.md#11-content-item-banks-activities-languages)).

## Known limitations

- Accuracy on children's voices is not yet measured (the real recordings so far are of an adult).
- Item and activity banks are AI-drafted and await an educator's review.
- Single letters are hardest for the recognisers, so letter cards ask the teacher to confirm more often (replay makes it quick).
- The English test uses the same letter → word → paragraph → story ladder as Hindi, not ASER's own English tool (capital letters, small letters, words, sentences, meaning).
- On free plans the API sleeps when idle (a monitor keeps it awake) and Azure allows one request at a time.

## Licence

MIT — see [LICENSE](LICENSE).
