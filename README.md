# LevelOS

A 3-minute, voice-first reading check on the teacher's phone that shows each child's real reading level, explains what kind of mistakes they make, regroups the class for Teaching at the Right Level, and gives the teacher a 10-minute activity for each group. It works offline.

Built for the AI for Foundational Learning Hackathon (Challenge 02: Learning-Level Visibility) by Team rushhies.

**Demo logins** (teacher role, the only role): `demo` / PIN `1234`, or `judge` / PIN `2026`. The login page also has a "Try the demo class" button. The demo class (Grade 2, Hindi) holds 16 fictional children with two weeks of synthetic check-in history; no real child's data is in the hosted demo.

## What happens in a check-in

1. The teacher opens a child and taps **Start reading check**. The child sees a large card (letters, words, a paragraph or a story) and can hear the instruction (🔊, pre-recorded). The teacher records the child reading; one short clip per item.
2. **Two independent speech recognisers** (Sarvam and Azure) transcribe the clip *without seeing the expected text*, so they cannot "auto-correct" the child's mistakes. Clips longer than 28 s are cut at pauses for the vendors' limits.
3. A **deterministic scorer** aligns each transcript with the expected text on akshara (grapheme-cluster) level and marks every word correct, wrong, skipped, or self-corrected (self-corrections count as correct, as in EGRA). Where the recognisers disagree about whether a word was read correctly, the word is marked **uncertain**. Azure Pronunciation Assessment, which *does* see the text, never votes on its own: it only breaks a tie between the two, or is the second opinion when only one recogniser is up.
4. **ASER's rules decide the level, in code.** Letters and words: 4 of 5. Paragraph and story: at most 3 mistakes and read "as sentences" (not halting: no more than 2 long pauses *inside* sentences, and not extremely slow). The ladder is adaptive: it starts by grade or last confirmed level, goes up on a pass and down on a fail, and stops once the level is bracketed. If uncertain words could change an item's pass/fail, the teacher confirms them with one tap before the ladder moves on.
5. **Two agreeing check-ins confirm a level.** Until then the level is shown as provisional (dotted, with "?").
6. **Error-pattern diagnosis.** Code computes akshara-level features for every wrong word (vowel sign only, first and last akshara right, conjunct involved, sight word…). A rule-based diagnosis appears at once; **Claude** (Opus 5.5) then reads the same structured evidence, names the main pattern(s) from a fixed list, cites the exact words, and writes a two-sentence summary for the teacher in Hindi and English. Every citation is checked against the evidence; anything unsupported is dropped.
7. The **dashboard** regroups the class into three TaRL groups (Beginner + Letter, Word, Paragraph + Story) with each group's most common difficulties. The teacher can move a child between groups.
8. **10-minute activity** per group: code picks three candidates from a curated bank of 17 activities (each entry cites its source: Pratham TaRL session guide and materials note, ASER, StoryWeaver), Claude adapts one to the group's actual misread words, and Claude Haiku checks it is faithful to the source, age-appropriate, safe and fits 10 minutes. If it fails twice, or there is no network, the teacher gets the bank entry itself.

## Guardrails

| Risk | What the system does |
|---|---|
| Speech AI hears what it expects, hiding the child's errors | Recognisers never see the expected text; two vendors must agree; the text-aware path never votes alone |
| A wrong transcription changes a child's level | Words the recognisers disagree on are *uncertain*; if they could flip an item, the teacher confirms them before the result counts |
| One bad day moves a child | A level is confirmed only by two agreeing check-ins; one check-in only sets a provisional level |
| The LLM decides the level | It cannot: ASER rules in code decide it; Claude only explains the errors |
| The LLM invents evidence | Fixed pattern list and JSON schema; it may cite only word indices from the evidence; citations are verified and unsupported patterns dropped; rule-based fallback |
| Unsafe or off-source activity | Must adapt one of three cited bank entries (schema enum); deterministic checks + a second-model review; one retry; bank entry as fallback |
| Poor audio | Too short, silent, too long, or the wrong card read: "please record again", never a level |
| The teacher knows better | Every word and every level can be corrected; corrections are logged and levels are replayed from history |
| Claude credit runs out before the evaluation | Every call is logged with its cost; hard total and daily caps (hosted demo: $400 total, $25/day); when a cap is reached the app keeps working on the rule-based diagnosis and bank activities; teacher corrections in quick succession cost one call |
| Child data | First name + emoji avatar only; audio is not stored after scoring (only for a consented evaluation set, off by default); Gemini's free tier, which may train on uploads, is never sent children's audio |

## What works offline

| | Online | Offline |
|---|---|---|
| Open the app, class, groups, child pages | ✓ | ✓ (cached on the phone) |
| Reading cards and spoken instructions | ✓ | ✓ (shipped with the app) |
| Run a check-in, adaptive ladder | ✓ AI-scored | ✓ teacher taps the mistakes; ladder runs on the phone |
| Level | ✓ | ✓ provisional, from the taps |
| Recording | ✓ | ✓ kept on the phone until sent |
| AI scoring, diagnosis, activity generation | ✓ | sent automatically when the network returns; where the AI disagrees with a tap, that word comes back for the teacher to confirm |
| Activity | ✓ adapted by Claude | the curated bank entry |

## Architecture

```
Teacher's phone (PWA: React + Vite + Tailwind, Workbox, Dexie/IndexedDB)
  big-text reading cards · MediaRecorder (Opus) · bundled item banks + instruction audio
  offline: ASER ladder on tap-marks (lib/aser.ts) → queue → sync
        │  HTTPS (JWT)
        ▼
FastAPI (Python 3.12, Docker) ── Postgres (Neon) / SQLite locally
  1 ffmpeg → 16 kHz WAV; quality gate (short / silent / long / wrong card)
  2 speech paths in parallel, cut into ≤28 s segments, responses cached in dev
      Sarvam saaras v3 (verbatim / codemix) ─┐ reference-free
      Azure STT ─────────────────────────────┤
      Azure Pronunciation Assessment ───── tie-breaker only (sees the text)
  3 align.py: akshara alignment, repeats, self-corrections, fusion → uncertain words
  4 aser_rules.py: item pass/fail, ladder, two-check confirmation, cohorts
  5 llm/diagnose.py: features → Claude Opus 5.5 (JSON schema) → citation check; rules fallback
  6 llm/activities.py: bank candidates → Claude Opus 5.5 adapts → Claude Haiku 5.5 reviews; bank fallback
```

## AI services and keys

| Service | Used for | Key (in `api/.env.local`) |
|---|---|---|
| Anthropic Claude `claude-opus-5-5` | Error-pattern diagnosis; activity adaptation | `ANTHROPIC_API_KEY` |
| Anthropic Claude `claude-haiku-5-5` | Reviewing generated activities | `ANTHROPIC_API_KEY` |
| Sarvam AI `saaras:v3` | Speech path A (reference-free; `verbatim` for Hindi, `codemix` for English) | `SARVAM_API_KEY` |
| Azure Speech (F0) | Speech path B (reference-free STT), Pronunciation Assessment (tie-breaker), instruction audio (TTS, pre-generated) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Google Gemini `gemini-3.5-flash` (optional) | Third reference-free path, **evaluation clips by adults only** | `GEMINI_API_KEY` |

Measured cost: about **$0.02 per check-in diagnosis** and **$0.05 per activity** ([eval/README.md](eval/README.md#claude-cost-measured)). Spend caps: `CLAUDE_BUDGET_USD`, `CLAUDE_DAILY_BUDGET_USD`; report: `python -m scripts.claude_spend`. Without `ANTHROPIC_API_KEY`, or once a cap is reached, the app still works: diagnosis and activities fall back to the rule-based versions. The level never depends on any LLM.

## Run locally

Prerequisites: Python 3.12, Node 20+. ffmpeg is optional (a bundled binary is used if it is not on PATH).

```bash
# API
cd api
python -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env.local        # put your keys here; .env.local is gitignored
python -m scripts.seed_demo       # demo logins + class
uvicorn app.main:app --reload --port 8000

# Web (second terminal)
cd web
npm install
npm run dev                       # http://localhost:5173 (proxies /api to :8000)
npm run dev:https                 # same, with a self-signed certificate, for testing the microphone on a phone on the LAN
```

Tests: `cd api && .venv/Scripts/python -m pytest` (110 tests, no network, no keys needed). Web: `cd web && npm run build` (type-check + production build with service worker).

Deploying (API on Render, app on Vercel, Postgres from Vercel's Neon storage): step-by-step guide in [docs/DEPLOY.md](docs/DEPLOY.md).

## Evaluation

`api/scripts/run_clips.py` runs labelled clips through every speech path and reports per-word agreement with what was said, plus pass/fail against the expected result. On nine real recordings (an adult on an Android phone, Hindi and English, scripted mistakes; gold labels confirmed by listening back) the live configuration agreed on **117 of 118 words (99.2%)** and gave the expected pass/fail on **9 of 9** clips; the one miss was marked uncertain and sent to the teacher. It also caught a slip the reader did not notice (रानी read for रीना). Children's voices are not yet in the set. Details: [eval/README.md](eval/README.md).

## Content and sources

- Item banks (`content/items/hi.json`, `en.json`): original text written to the ASER 2024 reading-tool specification (letters; familiar 2-letter words with 1–2 matras; Std I paragraph of 4 sentences of at most 6 words; Std II story of 7–10 sentences). A test enforces the spec for every bank. English uses the same five-level ladder (ASER's own English tool uses a different one).
- Activity bank (`content/activities/bank.json`): 17 activities adapted from Pratham / TaRL Africa *Planning TaRL Sessions* (2021) and *Literacy TLM Note* (2021), the ASER 2024 procedure, and StoryWeaver; each entry cites its source.
- ASER rules: ASER Centre, *ASER 2024 Assessment Tasks*. Error categories: Raman & Rao, Interspeech 2025.
- Language support: Hindi and English are complete (Tier 1). Marathi, Gujarati, Kannada, Tamil, Telugu and Odia are configured in the engine (Tier 2: vendor locales, script handling), but have no item banks yet.

## Known limitations

- Accuracy on real children's speech is not yet measured: the nine real recordings so far are of an adult. The item and activity banks are drafts awaiting an educator's review.
- The scorer's per-word timing (for the "halting" rule) comes from Azure Pronunciation Assessment where available (Hindi, English) and otherwise from silence detection in the audio, which a noisy classroom can mask.
- The free tiers (Azure F0: one request at a time; Render: sleeps after inactivity) make the hosted demo slower than a paid deployment.

## Licence

MIT, see [LICENSE](LICENSE).
