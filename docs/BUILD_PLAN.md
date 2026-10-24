# LevelOS — Build Stage plan (15 Oct → 1 Nov 2026)

Team rushhies · Challenge 02 "Learning-Level Visibility" · Deadline **Sat 1 Nov, 11:59pm** (aim to submit by Sat afternoon)

Research behind these decisions: [research/01](research/01-hackathon-and-pedagogy.md) · [research/02](research/02-competitive-landscape.md) · [research/03](research/03-asr-and-architecture.md)

---

## 0. What we are building (frozen scope)

One sentence: **a PWA on the teacher's phone that runs a 3-minute ASER-style reading check per child, scores it with two independent speech paths, has Claude diagnose the error pattern, groups the class into TaRL cohorts, and generates a 10-minute activity from a curated official activity bank — working offline for everything except the scoring itself.**

The demo loop judges must see in under 3 minutes:

1. Teacher opens class → taps child → child reads letters / words / paragraph aloud (one clip per item, ≤30 s).
2. Result in ~10 s: level (ASER rules), per-word marks, error pattern ("blending / scaffolding errors", "matra errors", …), uncertain words highlighted for one-tap teacher confirmation.
3. Dashboard regroups class into 3 cohort cards with dominant difficulties.
4. "Generate 10-min activity" → activity adapted from a cited bank entry (Pratham TaRL / NIPUN / CBSE-CSF).
5. Airplane mode → check-in still runs (recording + teacher tap-to-mark provisional score) → reconnect → syncs and upgrades to AI score.

### In scope
- **Multilingual by design, tiered by evidence** (decision 15 Oct):
  - **Tier 1 — validated:** Hindi, English. Full item banks, teacher UI, instruction audio, eval set, teacher testing.
  - **Tier 2 — supported, not yet validated:** Marathi, Gujarati, Kannada, Tamil, Telugu, Odia (final list after the Day-1 vendor-coverage check). Item banks adapted from ASER Centre's published per-language testing tools (with attribution; check terms), instruction audio pre-generated, same engine. Labelled "beta" in the UI and the PPT.
  - Adding a language = adding data (item bank + audio + UI strings), not code. The engine (grapheme-cluster alignment, ASER rules, Claude taxonomy with script notes) is language-agnostic.
- Reading only (ASER reading ladder: Beginner / Letter / Word / Paragraph / Story).
- Single role: teacher. Children never touch menus (teacher selects child; child sees big text + mic).
- Evaluator conveniences: test logins, seeded demo class with history, 3–5 sample audio clips uploadable without a child present.

### Explicitly out (goes in Roadmap slide)
- Numeracy (ASER maths ladder is the natural extension), validation of Tier-2 languages, child self-service, on-device ASR, parent reports, DIKSHA/G-Shala/SwiftChat integration, fine-tuned child ASR.

### Deck claims we are correcting (be upfront in the PPT)
| Deck said | Build does |
|---|---|
| 10+ languages | Multilingual engine; Tier 1 validated (Hindi, English), Tier 2 supported-not-validated (6 languages) — the PPT says which is which |
| Activities "from official CBSE FLN toolkit" | Curated bank with per-activity source (CBSE banks have no activities) |
| 85% agreement with teachers | We *measure* it on our own labelled clip set and report the real number |
| Letter→word→paragraph ladder | Adaptive start, **ASER scoring rules exactly** (≤3 errors paragraph; 4/5 words; 4/5 letters) |

---

## 1. Architecture

```
┌──────────────── Teacher's Android phone (PWA) ────────────────┐
│ React + Vite + TS + Tailwind · vite-plugin-pwa (Workbox)      │
│ Dexie (IndexedDB): queued check-ins, cached roster/dashboard  │
│ MediaRecorder (Opus/webm, ~150 KB/min) · precached item bank  │
│ + instruction audio (pre-generated Indic TTS)                 │
│ Offline: record + teacher tap-to-mark → provisional level     │
└──────────────┬────────────────────────────────────────────────┘
               │ HTTPS, retry/background-sync
┌──────────────▼──────────── FastAPI (Python, Docker) ──────────┐
│ 1 ffmpeg → 16 kHz WAV, trim silence                           │
│ 2 Path A "what was said": Sarvam saaras verbatim (23 langs,   │
│     no reference text)                                        │
│   Path B "what was said", 2nd vendor: Azure STT (no ref)      │
│   Path B+ (hi/en/ta only): Azure Pronunciation Assessment     │
│     scripted mode, EnableMiscue → per-word accuracy/miscue    │
│ 3 Deterministic scorer: word + grapheme-cluster alignment →   │
│   correct/sub/omit/insert/self-correct, hesitations, WCPM;    │
│   A≠B → "uncertain"                                           │
│ 4 ASER rules engine → level (code decides, never the LLM)     │
│ 5 Claude (structured output): error-pattern diagnosis +       │
│   teacher summary (Hi/En), evidence per claim                 │
│ 6 Cohorts (confirmed levels) · Activity generator: filter     │
│   bank → Claude adapts one entry → Haiku validator pass       │
│ Postgres (Neon free) · audio deleted after scoring (see note) │
└───────────────────────────────────────────────────────────────┘
```

**Why two speech paths:** general ASR "auto-corrects" children's errors toward the real word. Two independent vendors decoding *without* the reference fail differently; where they disagree with each other or with the reference we mark the word uncertain — the most honest signal we can get in 17 days — and the teacher's tap on an uncertain word becomes a labelled example. For Hindi/English/Tamil, Azure Pronunciation Assessment adds a reference-aware per-word accuracy score as a third opinion.

**Multilingual design rules:**
- Alignment works on Unicode grapheme clusters (`regex` `\X`), so akshara in Devanagari, Tamil, Kannada etc. and letters in English are handled by one code path; "matra error" generalises to "vowel-sign error" across Indic abugidas.
- Every language is a data pack: `content/items/<lang>.json`, `content/audio/<lang>/`, `web/src/locales/<lang>.json`, plus a one-line vendor-locale map (`sarvam`, `azure_stt`, `azure_pa?`).
- Claude's taxonomy prompt carries short script notes per language (vowel signs, conjuncts, schwa; English phonics categories) — one prompt, parameterised.
- UI language (teacher) and assessment language (child) are independent settings.

**Claude's jobs (make AI visibly central):**
| Call | Model | Input | Output (schema-enforced) |
|---|---|---|---|
| Diagnosis | `claude-opus-5-5`, effort low/medium, cached system prompt | item text, per-word alignment from A and B with timings, grade, language | per-word label (Raman & Rao taxonomy), `error_patterns[]` from fixed enum, `evidence[]`, teacher summary Hi+En, `confidence` |
| Activity generation | `claude-opus-5-5` | cohort's dominant patterns, size, materials available, top-k bank candidates | 10-min plan with `source_activity_id` ∈ candidates, steps, materials, "what to watch for" |
| Validator | `claude-haiku-5-5` | generated plan + source entry | `faithful_to_source`, `age_appropriate`, `safe`, `issues[]` — reject → regenerate once → fall back to the raw bank entry |

Error-pattern enum (v1): `letter_recognition`, `matra_vowel_sign`, `conjunct`, `blending_scaffolding`, `sight_word`, `guessing_from_first_akshara`, `fluency_only`, `insufficient_audio`.

**Guardrails (this list becomes a PPT slide):**
1. Level is decided by ASER rules in code; Claude cannot change it.
2. Two-path disagreement → word marked uncertain → teacher confirms with one tap.
3. Confidence gating: poor audio (short / silent / clipped) → "please re-record", never a level change.
4. Level change confirmed only after **2 agreeing check-ins** (provisional vs confirmed).
5. Structured outputs with fixed enums; anything else is rejected.
6. Activities must cite a bank entry; validator pass; raw bank entry as fallback.
7. Teacher can override any level, group, or word; overrides are logged and shown in the eval.
8. Child data: first name + avatar only, audio deleted after scoring (kept only for the consented eval set), no real children in the hosted demo.
   *Changed 24 Oct:* recordings are now kept for 30 days as a small MP3 so the teacher can listen again when confirming uncertain words or reviewing later; only that class's teacher can play them, they are deleted automatically after `AUDIO_RETENTION_DAYS`, and the teacher can delete them at any time (see [document.md §6](../document.md#6-recordings-and-replay)).

---

## 2. Stack & services

| Layer | Choice | Notes |
|---|---|---|
| Web | React 18 + Vite + TypeScript + Tailwind, vite-plugin-pwa, Dexie | Hosted on **Vercel** (free, always up) |
| API | Python 3.12+ FastAPI, SQLAlchemy, pydantic, httpx, `anthropic`, rapidfuzz, `regex`, ffmpeg in Docker | **Render free tier (Docker) + UptimeRobot ping every 5 min** (decision 15 Oct). Risk accepted: a missed ping → ~50 s cold start. Dry run on Day 16 includes a cold-start check; the video is the fallback. |
| DB | Postgres on **Neon** (free) | Render's free disk is ephemeral, so no SQLite |
| Speech A | **Sarvam** `saaras` verbatim (₹30/hr), 23 languages | Backup: Deepgram Nova-3 ($200 credit; Hindi only among Indic) |
| Speech B | **Azure Speech** STT (reference-free) for all languages + **Pronunciation Assessment** REST for hi-IN / en-IN / ta-IN, F0 tier (5 h/month free) | Day-1 spike: hi-IN `EnableMiscue`, and which Tier-2 locales Azure STT + Sarvam both cover |
| Speech C (optional) | **Gemini** audio input (AI Studio key, free tier) prompted for verbatim transcription, no reference | Third reference-free opinion → per-word majority vote; useful where Azure lacks a Tier-2 locale. Demo only on free tier (training-data policy); production = paid tier or drop. Not used for diagnosis — that stays Claude. |
| LLM | Claude via `anthropic` SDK, structured outputs, prompt caching | ~$0.02/check-in on Opus → $500 ≈ 20k check-ins |
| TTS | Pre-generated instruction audio per language (Sarvam Bulbul, 11 languages; Indic-Parler-TTS for the rest) committed to `content/audio/<lang>/` | Zero runtime dependency, works offline |
| Repo | GitHub, monorepo, **private until submission → public under MIT on 1 Nov** (decision 15 Oct; +$250 credits) | Evaluator IDs get read access |

Local dev needs: Node 24 ✓, Python 3.13 ✓, git ✓, **ffmpeg (install: `winget install Gyan.FFmpeg`)**, Docker Desktop (optional, for parity with Render).

### Repo layout
```
levelos/
  web/            PWA
  api/            FastAPI app, Dockerfile
    app/speech/   sarvam.py, azure_pa.py, align.py, scorer.py
    app/levels/   aser_rules.py (pure functions, unit-tested)
    app/llm/      diagnose.py, activities.py, validate.py, schemas.py, prompts/
  content/
    items/        ASER-style item banks, one JSON per language: letters, words, paragraphs, stories, ≥2 variants each
    activities/   curated activity bank (JSON) with source citations (Tier 1 languages; Tier 2 falls back to English/Hindi activity text)
    audio/<lang>/ instruction prompts per language
    languages.json  per-language config: script, vendor locales, tier, UI availability
  eval/           consented labelled clips (git-lfs or external), harness, results.md
  docs/           research/, architecture diagram, PPT source, video script
  README.md, .env.example, LICENSE
```

---

## 3. Data model (minimum)

- `teacher(id, name, login, pin_hash, ui_lang)`
- `class(id, teacher_id, name, grade)`
- `student(id, class_id, first_name, avatar, grade, home_lang, confirmed_level, provisional_level)`
- `checkin(id, student_id, started_at, language, items[], status: queued|scored|needs_review, offline_marks?, result_json, level_suggested, level_confirmed_by_teacher?)`
- `item_result(checkin_id, item_id, path_a_json, path_b_json, words[] {ref, heard_a, heard_b, label, uncertain, teacher_label?}, wcpm, errors, hesitations)`
- `diagnosis(checkin_id, error_patterns[], evidence[], summary_hi, summary_en, confidence, model, prompt_version)`
- `level_history(student_id, at, provisional, confirmed, source: ai|teacher|offline)`
- `activity(id, level_group, patterns[], title_hi/en, materials, steps, source{name,url,page})`
- `generated_activity(id, class_id, cohort, source_activity_id, plan_json, validator_json, teacher_rating?)`

---

## 4. ASER rules engine (the part Rukmini Banerji will check)

- Letters: show 5 → ≥4 correct = pass. Words: 5 familiar words (2 letters + 1–2 matras) → ≥4 = pass.
- Paragraph (4 sentences, ≤6 words each): ≤3 errors **and** read as sentences. We approximate "as sentences" with: hesitations (>3 s pauses) ≤ 2 and WCPM above a floor (tunable, Grade-aware); otherwise "halting" → fail. Self-corrections count as correct (EGRA).
- Story (7–10 sentences): same criteria.
- Adaptive start: Grade 1 / unknown → letters; Grade 2 → words; Grade 3 or last confirmed ≥ Word → paragraph. Pass → go up, fail → go down; max 4 items; stop when level is bracketed.
- Level = highest item passed comfortably. Provisional on every check-in; **confirmed** when two consecutive check-ins agree.
- Cohorts (deck's 3 cards): Letter group = Beginner + Letter · Word group = Word · Paragraph group = Paragraph + Story. (TaRL pairs Word+Paragraph; teacher can drag.)

All of this is pure Python with unit tests, cited to ASER 2024 tasks in the README.

---

## 5. Evaluation & user testing (35% of the score — treat as a feature)

**Eval set (`eval/`)**: 30–50 clips, ≤30 s each, Hindi + English: real children where consent is possible, plus adults deliberately producing matra swaps, skipped words, first-letter guesses, letter-by-letter sounding out. Hand-label per word. Harness reports: word-level agreement (A, B, fused), level agreement vs human, uncertain-word rate, override rate. Put the table in README and PPT whatever the numbers are.

**Teacher sessions** (2 rounds, 3+ teachers — government, private, NGO or tuition all count):
- Round 1 (by ~23 Oct): 20-min video call or in person; watch them run a check-in on the live link; capture what confused them, what they'd do with the cohort card, Hindi UI wording.
- Round 2 (by ~27 Oct): same teachers, after changes; collect quotes + one "before/after" change each.
- Artefacts: `docs/user-testing.md` (log, quotes, changes made), consent template, screenshots. This becomes the 1–2 page "User Inputs and Testing" section.

---

## 6. Day-by-day

| Date | Build (Claude Code + Zaid) | Content / people (Raazi + Zaid) |
|---|---|---|
| **Wed 15** | Plan agreed; repo scaffold; `.env.example` | Create accounts: Azure Speech (F0), Sarvam, Anthropic key from credits, Neon, Vercel, Render, GitHub repo |
| **Thu 16** | **Spikes**: Azure PA hi-IN miscue on a real clip; Sarvam verbatim; Azure STT + Sarvam locale coverage for Tier-2 list; MediaRecorder on Android Chrome → ffmpeg → WAV | Draft Hindi + English item bank v0 (ASER spec: 2 variants per level); download ASER testing tools for Tier-2 languages (check terms); download Hack2Skill "resources" from dashboard |
| **Fri 17** | Recorder UI + upload; scorer (alignment, labels, WCPM); ASER rules + tests | Book mentor slots (education mentor first — ask about ASER fidelity + items) |
| **Sat 18** | Claude diagnosis v1 (structured output, cached prompt); result screen with uncertain-word confirm | Consent form; start recruiting 3 teachers + children for clips |
| **Sun 19** | Auth (teacher login), class/student CRUD, check-in flow end-to-end online | Item bank review with an educator |
| **Mon 20** | Dashboard: roster, student history, cohort cards with dominant patterns | Activity bank curation starts (target 30–50 entries, each with source) |
| **Tue 21** | Activity generator + validator + "Generate" UI; teacher override everywhere | Activity bank continues; Tier-2 item banks ingested from ASER tools (JSON), native-speaker spot check where possible |
| **Wed 22** | Deploy v1 to Vercel + Render + Neon; seed demo class; UptimeRobot | **Teacher round 1 scheduled 22–23** |
| **Thu 23** | Offline: PWA precache (shell, items, audio), Dexie queue, sync on reconnect, pending badges | Teacher round 1 feedback logged |
| **Fri 24** | Offline tap-to-mark provisional scoring; instruction audio generated for all languages + precached; throttled/airplane tests on 2 phones | Record eval clips (children + adults), Hindi + English; a few Tier-2 clips if speakers are at hand |
| **Sat 25** | Fixes from round 1; Hindi UI strings; large-font child screens | Label eval clips |
| **Sun 26** | Eval harness; tune thresholds; results.md | — |
| **Mon 27** | Hosting hardening: test logins, 3–5 sample clips, frozen tag; error states | **Teacher round 2**; quotes + before/after |
| **Tue 28** | Polish + bug bash on real Android phones; architecture diagram | PPT draft (AI layers, guardrails, offline matrix, testing, roadmap) |
| **Wed 29** | **FEATURE FREEZE.** README, `.env.example`, AI-services list, run-locally steps | Video script (see §7) |
| **Thu 30** | Fix-only; dry run *as an evaluator* (fresh login, throttled network, sample clip) | Record video |
| **Fri 31** | Final tag `v1.0-submission`; repo access for evaluator IDs; flip public | Upload video; finalise PPT |
| **Sat 1 Nov** | **Submit by afternoon.** No commits after. | — |

Buffer: none explicit — Sun 26 and Tue 28 can absorb slips. If Day-1 spikes fail (Azure hi-IN miscue unavailable), fallback = Path B becomes Azure plain STT with reference-free decode + our own aligner; still two paths.

---

## 7. Submission artefacts

**Video (3:00 hard stop)**: 0:00–0:20 problem (one line from Frontline; "assessing 40 children takes hours") · 0:20–1:40 walkthrough: child check-in → result with uncertain word confirmed → dashboard regroup → generate activity · 1:40–2:10 airplane mode check-in → reconnect → sync · 2:10–2:35 AI layers + guardrails in 4 frames · 2:35–3:00 teacher quote + eval numbers + roadmap.

**PPT (short)**: 1 AI/LLM calls in layers (input → processing → guardrails → evaluation → output) · 2 Guardrails · 3 Works in real scenarios (offline matrix: what needs network, what degrades) · 4 User inputs & testing (1–2 pp) · 5 Roadmap (1–2 pp) · + 1 differentiation slide vs Wadhwani / TARA / Read Along Classroom / Pratham (early-grade floor, score→action, one phone, offline, continuous).

**README**: what it is, architecture diagram, run locally, `.env.example`, **every AI service and where keys go**, ASER rule citations, eval results, guardrails, known limitations, licence.

---

## 8. Things only you can do (start today)

1. Anthropic API key from the hackathon credits (check Hack2Skill dashboard / email). Also download any "resources to help build" files there.
2. Azure account → Speech resource (F0, region `centralindia`): key + region.
3. Sarvam AI key (docs.sarvam.ai). Optional backup: Deepgram.
4. Neon Postgres (free) connection string; Vercel + Render (or Railway) accounts; GitHub repo `levelos` (private for now) — add me the paths and I'll scaffold.
5. Install ffmpeg: `winget install Gyan.FFmpeg`; `pip install anthropic` happens via the project venv.
6. Book both mentor sessions as soon as the booking link arrives (education mentor in week 1).
7. Recruit 3 teachers and 5–10 children (with parental consent) for clips and two feedback rounds.
8. ~~Decide: hosting · open-source · languages~~ **Decided 15 Oct:** Render free + keep-alive ping · MIT at submission · multilingual, tiered (Tier 1 Hindi/English validated; Tier 2 six languages supported).
9. UptimeRobot (free) monitor on the API `/health` once deployed.
10. Find native speakers for a 15-minute spot check of each Tier-2 item bank (friends, colleagues, Discord).

## 9. Open risks
| Risk | Mitigation |
|---|---|
| Azure PA hi-IN miscue doesn't behave as documented | Day-1 spike; fallback in §6 |
| Child speech scoring visibly wrong in demo | Uncertain-word UX makes disagreement a feature; demo with clips we've validated |
| No teachers/children reachable | Adults + teammates' families for clips; teacher feedback from any teacher incl. tuition/NGO — document honestly |
| Demo breaks under throttling in front of evaluator | Offline is built on Day 9–10, tested on 2 phones, and dry-run on Day 16 |
| "Pratham/Wadhwani already do this" | Differentiation slide; early-grade floor + score→action + offline; propose integration not competition |
| Tier-2 languages look half-baked to a native-speaker judge | Label "beta" everywhere; show the data-pack mechanism; never demo a Tier-2 language live unless spot-checked |
| Free-tier cold start during evaluation | UptimeRobot 5-min ping; cold-start check in the Day-16 dry run; video as fallback |
