# LevelOS — how it works

A complete description of the LevelOS web app: what it does for a teacher, what happens at every stage of a reading check, which services and AI models each stage uses, the rules and numbers involved, how it works offline, what data it keeps, how AI spending is controlled, how well it performs, and how it is built and deployed.

For a short overview see [README.md](README.md); deployment steps are in [docs/DEPLOY.md](docs/DEPLOY.md); evaluation details in [eval/README.md](eval/README.md).

---

## Contents
1. [What LevelOS is](#1-what-levelos-is)
2. [What the teacher does](#2-what-the-teacher-does)
3. [Architecture](#3-architecture)
4. [A check-in, stage by stage](#4-a-check-in-stage-by-stage)
5. [Offline mode](#5-offline-mode)
6. [Recordings and replay](#6-recordings-and-replay)
7. [AI and external services](#7-ai-and-external-services)
8. [Guardrails](#8-guardrails)
9. [Controlling AI spend](#9-controlling-ai-spend)
10. [Data, privacy and accounts](#10-data-privacy-and-accounts)
11. [Content: item banks, activities, languages](#11-content-item-banks-activities-languages)
12. [Evaluation and results](#12-evaluation-and-results)
13. [Technology stack](#13-technology-stack)
14. [Code map](#14-code-map)
15. [Configuration](#15-configuration)
16. [Running, testing and deploying](#16-running-testing-and-deploying)
17. [Known limitations and next steps](#17-known-limitations-and-next-steps)
18. [Glossary](#18-glossary)

---

## 1. What LevelOS is

LevelOS is a phone web app for primary-school teachers in India. In about three minutes per child it finds the child's **reading level** using the ASER method (Beginner, Letter, Word, Paragraph, Story), shows **what kind of mistakes** the child makes, regroups the whole class into **Teaching at the Right Level** groups, and gives the teacher a **10-minute activity** for each group. It works in Hindi and English, on one shared teacher phone, and keeps working **without a network**.

It was built for the AI for Foundational Learning Hackathon (Challenge 02: Learning-Level Visibility) by Team rushhies.

**Who uses it**: only the teacher. Children never log in or touch menus; they only read from a large card on the teacher's phone.

**What makes it different** (from the team's research, [docs/research/02](docs/research/02-competitive-landscape.md)): existing AI reading tools in India score passages only (so a child who cannot yet read a passage scores zero), need a device per child, and stop at a score. LevelOS starts at letters, names the failing sub-skill, turns the result into grouping and an activity the same day, and works offline on one phone.

---

## 2. What the teacher does

| Screen | What happens |
|---|---|
| **Login** | Login ID + numeric PIN. "Try the demo class" logs into the demo. |
| **Class dashboard** | The class split into three reading groups (Letter, Word, Paragraph) with each group's most common difficulties; children with a dotted border are not yet confirmed; children not yet checked are listed separately; a banner shows check-ins waiting for the teacher's confirmation. Add children (first name + emoji). |
| **Child page** | Level (confirmed or provisional), latest diagnosis, group (can be set by hand — the next reading check then starts at that group's level), past check-ins, **Start reading check**. |
| **Check-in** | One card at a time in large text (letters, words, a paragraph or a story) with the instruction to read to the child (and a 🔊 button that plays it). The teacher taps the microphone, the child reads, the teacher taps stop. About 5–15 seconds later the result of that card shows and the next card appears. If the app is unsure about some words, it asks the teacher to confirm them (with the recording to listen to) before moving on. The teacher can always mark a card by tapping instead of recording. |
| **Result** | The level, the diagnosis ("what to work on"), every word marked (wrong in red, unsure in amber, self-corrected ↺), long pauses and reading speed, **▶ listen** to each card with the words highlighted as they are read, change the level, correct any word, delete the recordings. |
| **10-minute activity** | From a group card: a 10-minute plan for that group, adapted to the words the children actually misread, with steps, materials, practice words, what to watch for and the source it comes from; the teacher can rate it. |

The whole interface is in Hindi and English (toggle in the header).

---

## 3. Architecture

```
┌─────────────── Teacher's phone: web app (PWA) ────────────────┐
│ React + TypeScript + Tailwind · installable, works offline     │
│ Item banks + instruction audio shipped inside the app          │
│ MediaRecorder (Opus) · IndexedDB queue (Dexie) · ASER ladder   │
│ for offline check-ins · Hindi / English UI                     │
└──────────────┬─────────────────────────────────────────────────┘
               │ HTTPS + JSON (login token)        hosted on Vercel
┌──────────────▼──────────── API (FastAPI, Python, Docker) ──────┐
│ ffmpeg → quality gate → speech services in parallel →          │
│ alignment + fusion → ASER rules → level                        │
│ Claude: diagnosis, activity adaptation · spend ledger + caps   │
│ teacher login, classes, children, check-ins, recordings        │      hosted on Render
└───────┬─────────────────────┬──────────────────────┬───────────┘
        │                     │                      │
   Postgres (Neon)     Speech services         Anthropic API
   via Vercel Storage  Sarvam · Azure Speech   Claude Opus 5.5
                                               Claude Haiku 5.5
```

- **Web app** (`web/`): a progressive web app; Vercel serves it over HTTPS (needed for the microphone on phones).
- **API** (`api/` plus `content/`): one Docker container on Render (free plan, Singapore). Stateless apart from the database.
- **Database**: Postgres on Neon, created from Vercel's Storage tab (direct, unpooled connection). SQLite is used for local development and tests.
- **Speech**: Sarvam AI and Azure Speech (region Central India). Google Gemini is used only by the evaluation script.
- **LLM**: Anthropic Claude via the official `anthropic` SDK.

---

## 4. A check-in, stage by stage

Every recorded card goes through the same stages. Stages 2–6 run on the API for each card; 7–9 run when the check-in is finished.

### Stage 0 — Choosing what the child reads (adaptive ASER ladder)

| Rule | Value |
|---|---|
| Card types (rungs) | letter → word → paragraph → story |
| Where to start | a **group the teacher set by hand** → that group's level (Letter group → letters, Word group → words, Paragraph group → paragraph); otherwise the last confirmed level (Word/Paragraph/Story → that rung, Beginner/Letter → letters); otherwise by grade (Grade ≤1 or unknown → letters, Grade 2 → words, Grade ≥3 → paragraph) |
| Next card | pass → one rung up; fail → one rung down; stop when the level is bracketed (a pass just below a fail), at the top or bottom, or after 4 cards |
| Which variant | the first variant of that rung the child did not read in this or the previous check-in (variants rotate) |
| If the teacher is asked to confirm words | the ladder waits until they are confirmed, because the next rung depends on that card's pass/fail |

Code: `api/app/levels/aser_rules.py` (`start_level`, `next_item_level`), `api/app/services/checkins.py` (`next_item`). The same rules run on the phone for offline check-ins (`web/src/lib/aser.ts`; a test keeps the two in sync).

### Stage 1 — Recording on the phone

- `MediaRecorder` in the browser: Opus/WebM at 24 kbps on Android Chrome (about 150 KB per minute), MP4/AAC on iPhone Safari. One clip per card. Recording stops by itself after 2 minutes.
- The instruction for each rung (Hindi and English) is pre-recorded with Azure neural voices and shipped inside the app, so the 🔊 button works offline.
- Code: `web/src/lib/useRecorder.ts`, `web/src/pages/Checkin.tsx`.

### Stage 2 — Audio preparation and quality gate (API)

1. **Convert** whatever the phone sent (WebM, MP4, OGG, WAV…) to 16 kHz mono WAV with ffmpeg (the format every speech service accepts).
2. **Quality gate** — the card is sent back for re-recording, and no speech service is called (no credit spent), if the clip is:
   - shorter than 0.6 s ("too short"),
   - silent (loudness below −50 dBFS, or no speech detected),
   - longer than 3 minutes ("too long"), or
   - clearly the wrong card: on a letter or word card, the recognisers heard more than twice the expected number of words plus three.
3. **Segment** long clips for the services' 30-second limits: clips over 28 s are cut at the quietest point (energy smoothed over ~200 ms, so a cut never falls inside a word) between 14 and 28 s into each segment. A slow child can easily take a minute over a paragraph.
4. **Keep a playback copy** (MP3, see [section 6](#6-recordings-and-replay)).

Code: `api/app/speech/audio.py`, `api/app/speech/scorer.py`.

### Stage 3 — Speech recognition

The central idea: **a speech recogniser that knows the expected text "hears" the expected text**, hiding exactly the mistakes a reading check must catch. So the voting recognisers are never given the text.

| Path | Service | Sees the text? | Role |
|---|---|---|---|
| A | **Sarvam AI `saaras:v3`** — `verbatim` mode for Hindi (keeps mispronunciations), `codemix` for English (verbatim writes English sentences in Devanagari) | no | votes; primary for Hindi |
| B | **Azure Speech-to-Text** (short-audio REST, detailed format, Central India) | no | votes; primary for English |
| PA | **Azure Pronunciation Assessment** (scripted, `EnableMiscue`, clips ≤30 s) | **yes** | never votes on its own: breaks a tie between A and B, is the second opinion if only one of them answered, and supplies **per-word timings** |
| C | Google Gemini `gemini-3.5-flash` | no | **evaluation only** (adult test clips); never used in check-ins (its free tier may train on uploads) |

The paths run in parallel. Calls are retried on network/DNS failures, 429 and 5xx (never on a read timeout, which may already have been billed); Azure calls are made one at a time (the free F0 tier allows one concurrent request). In development every vendor response is cached by audio hash, so re-running a clip costs nothing.

Why PA cannot vote: on real recordings its transcript repeated the printed words — it "heard" रीना, सफेद, खाती where रानी, सफाद, खाता were said ([eval/README.md](eval/README.md)).

Code: `api/app/speech/sarvam.py`, `azure.py`, `gemini.py`, `http.py`, `cache.py`.

### Stage 4 — Alignment and fusion (deterministic)

Each recogniser's transcript is aligned with the expected text, word by word, by an edit-distance alignment (Needleman–Wunsch) whose similarity is measured on **aksharas** (Unicode grapheme clusters, so क्ष or स्कू counts as one unit, in every Indic script and in English). Each expected word gets a label:

| Label | Meaning |
|---|---|
| correct | read as printed |
| sub | read as something else (similar words are paired, e.g. कमल → कमाल) |
| omit | skipped |
| self_correct | wrong first, then corrected (counts as **correct**, EGRA convention) |
| (extra) | inserted or repeated words are recorded separately and do not count as errors |

Normalisation so that spelling quirks of the recognisers are not counted as reading errors: nukta and chandrabindu variants (ज़/ज, माँ/मां), letter case, punctuation; joined or split compounds ("every day" heard as "everyday", "बैठकर" as "बैठ कर"). On **letter cards** a letter said aloud comes back as a syllable or even a word (म → माँ, र → राह), so only the first akshara's consonant is compared; letter cards are aligned position by position, so a b/d reversal counts as two errors; English letter names and sounds are accepted ("bee", "ghee").

**Fusion**: each recogniser votes on whether each word was read correctly (majority; a tie goes to PA's verdict when available, otherwise to the language's primary path). A word is **uncertain** when the recognisers disagree on right-or-wrong (a disagreement only in kind — correct vs self-corrected, wrong word vs skipped — does not count).

Code: `api/app/speech/align.py`, `api/app/speech/scorer.py`.

### Stage 5 — Scoring the card (ASER rules, in code)

| Card | Passes when |
|---|---|
| Letters (5) | at least 4 of 5 correct |
| Words (5) | at least 4 of 5 correct |
| Paragraph / story | at most 3 mistakes (wrong + skipped) **and** read "as sentences": no more than 2 long pauses **inside sentences** (2.5 s or more, from word timings), and not extremely slow (at least 15 correct words a minute for a paragraph, 20 for a story) |

- Pauses between sentences never count: ASER passes a slow reader who reads sentence by sentence. When word timings are not available (no PA), pauses over 3 s are counted from the silence in the audio instead.
- **Uncertain words**: the card is scored in the best case (every uncertain word right) and the worst case (every one wrong). If the two results differ, the card **needs review**: the teacher confirms those words (listening to the recording) before the ladder moves on. If they cannot change the result, the teacher is not interrupted.
- The teacher's answer always overrides the machines for that word.

Code: `api/app/levels/aser_rules.py` (`item_passed`, `Thresholds`), `api/app/speech/scorer.py` (`ItemScore.evaluate`).

### Stage 6 — The level

- **Level of the check-in** = the highest rung passed. If nothing passed and letters were never tried (for example the child failed the paragraph and the session ended), the cards do not place the child: the app asks for one more card or for the teacher to choose the level, rather than calling it "Beginner".
- **Two-check confirmation**: a child's level is *provisional* after one check-in and *confirmed* when two check-ins in a row agree. One bad day does not move a confirmed level.
- **Teacher override**: the teacher can set the level of any check-in; it is logged and wins.
- Levels are always **replayed** from the child's check-in history (oldest first), so a later correction of an old check-in keeps everything consistent.

Code: `api/app/services/checkins.py` (`placed_level`, `_settle`, `replay_levels`), `aser_rules.update_levels`.

### Stage 7 — Diagnosis: what kind of mistakes (Claude)

1. **Evidence (code)**: for every wrong word, deterministic features — only the vowel sign changed; first and last akshara right but the middle wrong (scaffolding); first akshara right; error on a conjunct; a common sight word; what each recogniser heard; pauses and speed per card.
2. **Instant rule-based diagnosis**: shown at once (and the only one when offline or when Claude is unavailable).
3. **Claude Opus 5.5** (in the background, about 8 s after the last change so a burst of teacher corrections costs one call): reads only the structured evidence — no audio, no level decision — and returns JSON in a fixed schema: up to three **error patterns** from a fixed list, the evidence (cited by word index), whether each substitution is a real word, and a two-to-three-sentence summary for the teacher in Hindi and English with one thing to practise this week.
4. **Checks**: every cited word must exist in the evidence; a pattern resting only on uncertain words, or citing nothing, is dropped; if nothing valid remains the rule-based diagnosis stays. Summaries use the child's name without guessing gender (Hindi constructions like "मीना को … में कठिनाई है").

Error patterns: letter recognition, vowel signs (matras), conjunct letters, blending sounds into words, common sight words, guessing from the first letter, accurate but slow or halting, not enough clear audio.

Settings: effort `medium` (chosen after comparing low and medium on real check-ins), structured output, server-side refusal fallback (a false-positive safety decline is re-run on Anthropic's recommended fallback model), the system prompt is prompt-cached. Measured cost: **about $0.02 per check-in**.

Code: `api/app/llm/evidence.py`, `rules.py`, `diagnose.py`, `prompts.py`, `patterns.py`.

### Stage 8 — Grouping the class (TaRL)

Children are grouped by their level (confirmed if available, else provisional, shown with a dotted border):

| Group | Levels |
|---|---|
| Letter group | Beginner + Letter |
| Word group | Word |
| Paragraph group | Paragraph + Story |

Each group card shows its most common difficulties (from the children's latest diagnoses). The teacher can move a child to another group by hand; the child's next reading check then starts at that group's level and moves up or down from there, so a child who has outgrown the group is found rather than held in it.

Code: `aser_rules.cohort_for_level`, `api/app/api/classes.py` (`dashboard`).

### Stage 9 — 10-minute activity (Claude + a second-model review)

1. **Candidates (code)**: from a curated bank of 17 activities, each citing its source, the three that best match the group's difficulties.
2. **Adaptation — Claude Opus 5.5**: chooses one candidate (the schema only allows those three ids) and adapts it into a 10-minute plan for this group: 3–4 steps with minutes, materials a government school has, 4–8 practice words taken from the words the children misread, what to watch for, and one line on why — in Hindi and English. No children's names.
3. **Checks**: code checks the source id, that the steps add up to 8–12 minutes and that every step is bilingual; **Claude Haiku 5.5** then reviews the plan against the bank entry: faithful to the source, age-appropriate, safe, fits 10 minutes. On a rejection the plan is regenerated once with the reviewer's issues.
4. **Fallback**: if the plan still fails, Claude is unavailable, or the spend cap is reached, the teacher gets the bank entry itself with the group's practice words.

Measured cost: **about $0.05 per activity**. The teacher can rate each activity (1–5).

Code: `api/app/llm/activities.py`, `api/app/api/activities.py`, `content/activities/bank.json`.

---

## 5. Offline mode

The judges test low-connectivity behaviour, so offline is designed in, not added.

| | Online | Offline |
|---|---|---|
| Open the app, class, groups, child pages | ✓ | ✓ the app is cached by its service worker; the last data from the server is cached on the phone (the dashboard pre-loads every child's page, at most every 10 minutes) |
| Reading cards and spoken instructions | ✓ | ✓ shipped inside the app |
| Run a check-in with the ASER ladder | ✓ AI-scored | ✓ the teacher records (optional) and **taps the mistakes**; the ladder runs on the phone |
| Level | ✓ | ✓ provisional, from the taps |
| AI scoring, diagnosis, activity | ✓ | sent automatically when the network returns |

**Sync** (when the network returns, on start, and every minute): each offline check-in is created on the server with the phone's ID (so retries never duplicate) and the same starting rung; the taps are replayed through the same ladder; the check-in is finished; then each recording is AI-scored. Wherever the AI disagrees with the teacher's tap on a word, that word becomes **uncertain** for the teacher to confirm — the level is never silently overwritten. Recordings are deleted from the phone once the server has them. A ⏳ badge shows how many check-ins are waiting.

Code: `web/src/lib/offline.ts`, `web/src/pages/OfflineCheckin.tsx`, `web/src/db.ts`, `api/app/services/checkins.py` (`attach_audio`).

---

## 6. Recordings and replay

When the app is unsure about a word, the teacher confirms it — and judging by ear is far more reliable than reading a machine's guess. So recordings are kept for the teacher to listen to:

- **Format**: a playback copy in MP3 (mono, 32 kbps, about 4 KB per second of speech): it seeks reliably (to play a single word) and plays on every phone, including iPhones.
- **In the confirmation panel**: ▶ plays the whole card; 🔊 next to each unsure word plays just that moment (from the word's timing, or the gap between its neighbours); it also shows what each recogniser heard (for letters, the letter: "र · श").
- **On the result page** (later, from the child's history): ▶ per card, with each word highlighted as it is read.
- **Who can listen**: only the teacher of that class (login required; another teacher gets "not found").
- **How long**: 30 days (`AUDIO_RETENTION_DAYS`), then deleted automatically (at server start and on every new upload). The teacher can delete a check-in's recordings at any time; the scores stay. Setting the retention to 0 stores nothing.
- Recordings are stored in the database (table `item_audio`), not on the server's disk (Render's free disk is wiped on restart).

Code: `api/app/services/checkins.py` (`_keep_recording`, `purge_audio`, `delete_audio`), `api/app/api/checkins.py`, `web/src/lib/useClip.ts`, `web/src/components/ReviewPanel.tsx`, `web/src/pages/Result.tsx`.

---

## 7. AI and external services

| Service / model | Stage | What for | Sees | Cost (measured or list) |
|---|---|---|---|---|
| **Claude Opus 5.5** (`claude-opus-5-5`) | 7, 9 | Error-pattern diagnosis; adapting an activity | structured evidence (no audio, no names except the child's first name in the diagnosis) | ~$0.02 per diagnosis, ~$0.05 per activity |
| **Claude Haiku 5.5** (`claude-haiku-5-5`) | 9 | Reviewing each generated activity | the plan and its bank entry | ~$0.0007 per review |
| **Sarvam AI** `saaras:v3` | 3 | Speech recognition, path A | audio only | about ₹30 per hour of audio |
| **Azure Speech** STT | 3 | Speech recognition, path B | audio only | free tier: 5 audio hours per month |
| **Azure Pronunciation Assessment** | 3 | Tie-breaker, word timings | audio + the expected text | same Azure tier |
| **Azure neural TTS** | build time | The spoken instructions shipped in the app | the instruction text | a few hundred characters, once |
| **Google Gemini** `gemini-3.5-flash` | evaluation only | Third opinion on adult test clips | audio only | free tier |

**The level is never decided by an LLM.** Scoring and levels are deterministic code; the LLM explains errors and adapts activities, and both have rule-based fallbacks.

---

## 8. Guardrails

| Risk | What the system does |
|---|---|
| Speech AI "hears" what it expects and hides the child's errors | Voting recognisers never see the text; the text-aware path never votes alone |
| A wrong transcription changes a child's level | Disagreements become uncertain words; if they could change a card's result, the teacher confirms them (listening to the recording) before it counts |
| One bad day moves a child | Levels are confirmed only by two agreeing check-ins |
| The LLM decides the level | It cannot: ASER rules in code decide; the LLM only explains |
| The LLM invents evidence or patterns | Fixed pattern list and JSON schema; citations by word index, verified; unsupported patterns dropped; rule-based fallback |
| Unsafe or off-source activity | Must adapt one of three cited bank entries; deterministic checks + a second-model review; one retry; the bank entry as fallback |
| Poor audio | Too short, silent, too long or the wrong card → "please record again", never a level |
| The teacher knows better | Every word and every level can be corrected; corrections are logged; levels are replayed from history |
| Claude credit runs out before the evaluation | Every call is logged with its cost; hard total and daily caps; at a cap the app keeps working on rules and the bank |
| Child data | First name + emoji avatar only; recordings kept 30 days for the teacher's replay, then deleted; the teacher can delete them any time; no audio is sent to free-tier Gemini; the hosted demo contains no real children |
| Gender assumptions | Diagnoses never guess the child's gender from the name |

---

## 9. Controlling AI spend

The Claude credit ($500 for the hackathon) must last through the evaluation window, so spend is controlled in code:

- **Ledger**: every Claude call is recorded in the `llm_usage` table with model, input/output/cached tokens and its dollar cost (Opus 5.5: $4 in / $20 out per million tokens; Haiku 5.5: $0.10 / $0.50; cache reads are much cheaper).
- **Hard caps**: `CLAUDE_BUDGET_USD` (total) and `CLAUDE_DAILY_BUDGET_USD`. The hosted demo uses $400 total and $25 per day (a reserve stays within the $500); local development uses small caps. When a cap is reached, diagnosis and activities fall back to their rule-based and bank versions and the app keeps working.
- **Fewer calls**: diagnoses wait for a quiet moment (a burst of corrections costs one call); Claude is skipped when the evidence has not changed; the system prompt is prompt-cached; each class gets at most one automatic activity per group per day.
- **Visibility**: `/api/health` shows the spend and whether Claude is available; `python -m scripts.claude_spend` gives the breakdown by purpose and day.

At about $0.02 per check-in, $400 covers roughly 20,000 check-in diagnoses.

---

## 10. Data, privacy and accounts

**Accounts**: one role, the teacher, with a login ID and a numeric PIN (bcrypt-hashed); the app keeps a 30-day login token (JWT). The demo logins are `demo` / 1234 and `judge` / 2026.

**Database tables**

| Table | Holds |
|---|---|
| `teachers` | login, name, PIN hash, interface language |
| `classrooms` | name, grade, reading language |
| `students` | **first name and an emoji only**, grade, provisional and confirmed level, manual group |
| `checkins` | one reading check: language, starting rung, status (in progress / needs review / scored / abandoned), suggested and final level, override flag, the phone's ID for offline check-ins |
| `item_results` | one card: the full scored result (every word, what each recogniser heard, timings, pauses, speed, pass/fail), source (AI or taps) |
| `item_audio` | the MP3 playback copy of a card's recording (kept 30 days) |
| `diagnoses` | error patterns, evidence, summaries, confidence, model used |
| `level_history` | every change of a child's level and its cause |
| `generated_activities` | each activity plan, its review, the source entry, the teacher's rating |
| `llm_usage` | every Claude call's tokens and cost |

**What leaves the server**: audio goes to Sarvam and Azure for transcription; structured evidence (words, features, the child's first name) goes to Anthropic for the diagnosis; group-level information (no names) for activities. Nothing else is shared.

**Real children**: the hosted demo contains only fictional children; recordings of real children are only for a consented evaluation set.

---

## 11. Content: item banks, activities, languages

- **Item banks** (`content/items/hi.json`, `en.json`): original texts written to the ASER 2024 reading-tool specification — commonly used letters (5 per card); familiar words of two letters with one or two matras (5 per card); a Std I paragraph (4 linked sentences of at most 6 words); a Std II story (7–10 sentences). Three variants of each card, two of each passage. A test checks every bank against the specification. English uses the same five-level ladder (ASER's own English tool uses a different one). Status: draft, awaiting an educator's review.
- **Activity bank** (`content/activities/bank.json`): 17 activities, each adapted to about 10 minutes from an activity described in its cited source — Pratham / TaRL Africa *Planning TaRL Sessions* (2021) and *Literacy TLM Note* (2021), the ASER 2024 procedure, StoryWeaver. Status: draft, each entry to be checked against its source.
- **Instruction audio** (`web/public/audio/<lang>/<level>.mp3`): generated by `scripts/make_instruction_audio.py`.
- **Languages** (`content/languages.json`): Hindi and English are complete (Tier 1: item banks, instruction audio, interface). Marathi, Gujarati, Kannada, Tamil, Telugu and Odia are configured in the engine (Tier 2: vendor locales, script handling for every Indic script) but have no item banks yet. Adding a language means adding data (an item bank, instruction audio, interface strings), not code.

---

## 12. Evaluation and results

`api/scripts/run_clips.py` sends labelled test recordings through every speech path and reports per-word agreement with what was actually said, and whether each card passed or failed as expected ([eval/README.md](eval/README.md)).

**Real recordings** (nine clips, an adult on an Android phone reading scripted mistakes in Hindi and English, 118 words; reference transcripts confirmed by the reader listening back):

| | Words matching what was said | Cards with the expected pass/fail |
|---|---|---|
| **Live configuration (Sarvam + Azure, PA tie-break)** | **117 / 118 (99.2%)** | **9 / 9** |
| Sarvam alone | 117 / 118 | |
| Azure STT alone | 112 / 118 | |
| With Gemini as a third opinion | 118 / 118 | 9 / 9 |

The one miss was marked uncertain and sent to the teacher. The system also caught a slip the reader did not notice (रानी read for रीना). These are adult voices in a quiet room; children's voices and classroom noise are harder, and children's recordings (with parental consent) are the next evaluation step.

**Software tests**: 118 automated API tests (no network or keys needed), run on SQLite and on Postgres; browser end-to-end runs (online check-in with a real recording as the microphone, activity, the full offline round trip, recording replay) against the production Docker image.

---

## 13. Technology stack

| Layer | Technology |
|---|---|
| Web app | React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6, i18next (Hindi/English), vite-plugin-pwa (Workbox service worker), Dexie (IndexedDB), MediaRecorder |
| API | Python 3.12, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic 2 / pydantic-settings, httpx, Anthropic Python SDK, rapidfuzz (edit distance), `regex` (grapheme clusters), bcrypt, PyJWT, psycopg 3, ffmpeg (imageio-ffmpeg locally) |
| Database | Postgres (Neon) in production; SQLite in development and tests |
| Hosting | Vercel (web app), Render free plan with Docker (API), Neon via Vercel Storage (database), UptimeRobot (keep-alive ping) |
| Tests | pytest (API), TypeScript type-check, Playwright with Microsoft Edge (local end-to-end runs) |

---

## 14. Code map

```
api/
  app/
    main.py            app setup, routers, /api/health, startup (tables, purge old recordings)
    config.py          every setting (environment variables, .env / .env.local)
    models.py          database tables
    auth.py            login, PIN hashing, tokens
    content.py         loads item banks and language config
    serialize.py       JSON shapes returned by the API
    api/               HTTP routes: auth, classes (dashboard), checkins (ladder, recordings), activities
    services/checkins.py   check-in lifecycle: ladder, scoring, review, overrides, level replay, offline sync, recordings
    levels/aser_rules.py   ASER rules: pass/fail, ladder, two-check confirmation, groups
    speech/            audio (ffmpeg, quality, segments, MP3), sarvam / azure / gemini clients, tts,
                       http (retries, concurrency), cache, align (alignment + fusion), scorer (the pipeline)
    llm/               evidence, rules (fallback diagnosis), diagnose (Claude), prompts, patterns,
                       activities (generate + review), budget (spend ledger and caps)
  scripts/             seed_demo, run_clips (evaluation), claude_spend, diagnose_pending,
                       make_instruction_audio
  tests/               118 tests
  Dockerfile
web/
  src/pages/           Login, Classes, ClassDashboard, Student, Checkin, OfflineCheckin, Result, ActivityPage
  src/components/      header and shared UI, WordChips, ReviewPanel, TapToMark, InstructionAudio
  src/lib/             types, auth, useRecorder, useClip (replay), aser (offline ladder), content, offline (sync)
  src/api.ts           API client (offline cache, recordings)
  src/db.ts            IndexedDB tables (offline queue, clips, cache)
  src/locales/         Hindi and English strings
  public/audio/        pre-recorded instructions
  vercel.json
content/               item banks, activity bank, language config
eval/                  scripted clips, gold transcripts, results
docs/                  build plan, research, deploy guide, recording script
render.yaml            Render blueprint
```

---

## 15. Configuration

API settings (environment variables; locally in `api/.env.local`, which is never committed):

| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV` | `dev` | `prod` turns off the response cache and requires `JWT_SECRET` |
| `DATABASE_URL` | local SQLite | Postgres URL in production (the unpooled Neon URL) |
| `JWT_SECRET` | dev value | signing key for login tokens (required in production) |
| `CORS_ORIGINS` | `http://localhost:5173` | the web app's address(es) allowed to call the API |
| `SEED_DEMO` | — | `true`: create the demo logins and class on first start |
| `ANTHROPIC_API_KEY` | — | Claude (without it: rule-based diagnosis and bank activities) |
| `CLAUDE_MODEL` / `CLAUDE_VALIDATOR_MODEL` | `claude-opus-5-5` / `claude-haiku-5-5` | models |
| `CLAUDE_BUDGET_USD` / `CLAUDE_DAILY_BUDGET_USD` | 400 / 25 | spend caps |
| `CLAUDE_DIAGNOSIS_EFFORT` / `CLAUDE_ACTIVITY_EFFORT` | `medium` | effort levels |
| `DIAGNOSIS_DEBOUNCE_S` | 8 | wait after the last change before diagnosing |
| `SARVAM_API_KEY`, `SARVAM_MODEL` | —, `saaras:v3` | speech path A |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | —, `centralindia` | speech path B, PA, TTS |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FOR_CHILDREN` | —, `gemini-3.5-flash`, false | evaluation only |
| `AUDIO_RETENTION_DAYS` | 30 | how long recordings are kept for replay (0 = never stored) |
| `KEEP_AUDIO` | false | also keep raw uploads on disk (consented evaluation set only) |
| `PROD_DATABASE_URL` | — | local only: the hosted database, for maintenance scripts |

Web app: `VITE_API_BASE` — the API's address (empty in development, where Vite proxies `/api`).

---

## 16. Running, testing and deploying

- **Run locally**: see [README.md](README.md#run-locally) (Python 3.12 + Node 20; ffmpeg optional).
- **Tests**: `cd api && .venv/Scripts/python -m pytest` (SQLite); set `TEST_DATABASE_URL` to run them on a throwaway Postgres database.
- **Evaluation**: `python -m scripts.run_clips clips` ([eval/README.md](eval/README.md)).
- **Docker**: `docker build -f api/Dockerfile -t levelos-api .` from the repository root builds exactly what Render builds.
- **Deploy**: step-by-step in [docs/DEPLOY.md](docs/DEPLOY.md) — database from Vercel Storage (Neon), API on Render (blueprint `render.yaml`), web app on Vercel (root directory `web`), CORS, keep-alive monitor.

---

## 17. Known limitations and next steps

- **Children's voices**: accuracy so far is measured on an adult's recordings; children's recordings (with parental consent) are next.
- **Content review**: the item banks and activity bank are AI-drafted and must be checked by an educator against their sources before they are presented as ASER- or TaRL-faithful.
- **Single letters** are the hardest for the recognisers (Azure especially), so letter cards ask the teacher to confirm more often; the replay makes that quick.
- **Halting** uses word timings where Azure Pronunciation Assessment is available (Hindi, English, Tamil) and otherwise silence detection, which a noisy classroom can mask.
- **Tier 2 languages** have no item banks yet.
- **Free tiers**: the API sleeps after inactivity on Render's free plan (a monitor keeps it awake); Azure's free tier allows one request at a time.
- **Roadmap** (from the build plan): numeracy (the ASER maths ladder), validated Tier 2 languages, integration with state platforms, parent reports, on-device speech recognition.

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **ASER** | Annual Status of Education Report; its simple one-to-one reading test (Beginner, Letter, Word, Paragraph, Story) is the method LevelOS follows |
| **TaRL** | Teaching at the Right Level (Pratham): grouping children by learning level rather than grade |
| **Akshara** | a written syllable unit of Indian scripts (consonant + vowel sign, or a conjunct) |
| **Matra** | a vowel sign attached to a consonant (ा, ि, ी, …) |
| **Conjunct** | two or more consonants joined into one akshara (क्ष, त्र, स्त) |
| **WCPM** | words correct per minute |
| **EGRA** | Early Grade Reading Assessment; source of the self-correction rule and the 3-second hesitation |
| **Reference-free** | a speech recogniser that is not given the expected text |
| **PA** | Azure Pronunciation Assessment, a text-aware scorer |
| **Uncertain word** | a word the recognisers disagree on; the teacher confirms it when it could change a result |
| **Provisional / confirmed level** | a level from one check-in / agreed by two check-ins in a row |
| **PWA** | progressive web app: installable, works offline |
| **CORS** | the browser rule that only lets listed web addresses call the API |
