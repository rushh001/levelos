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

LevelOS is a phone web app for primary-school teachers in India. In about three minutes per child it finds the child's **reading level** using the ASER method (Beginner, Letter, Word, Paragraph, Story), shows **what kind of mistakes** the child makes, regroups the whole class into **Teaching at the Right Level** groups, and gives the teacher a **10-minute activity** for each group. As in ASER, each child is tested **in English and in their regional language** (Hindi; Marathi, Tamil, Kannada and Bengali in beta), with a separate level and group in each. It runs on one shared teacher phone and keeps working **without a network**.

It was built for the AI for Foundational Learning Hackathon (Challenge 02: Learning-Level Visibility) by Team rushhies.

**Who uses it**: only the teacher. Children never log in or touch menus; they only read from a large card on the teacher's phone.

**What makes it different** (from the team's research, [docs/research/02](docs/research/02-competitive-landscape.md)): existing AI reading tools in India score passages only (so a child who cannot yet read a passage scores zero), need a device per child, and stop at a score. LevelOS starts at letters, names the failing sub-skill, turns the result into grouping and an activity the same day, and works offline on one phone.

---

## 2. What the teacher does

| Screen | What happens |
|---|---|
| **Login** | Login ID + numeric PIN. "Try the demo class" logs into the demo. A language menu (English and the five regional interfaces, each named in its own script) sets the language of the login and sign-up screens only; inside the app the reading test sets it. |
| **Sign up** | A new teacher enters a name, an email and a PIN (4–8 digits) and is given a unique 6-digit login ID, shown big once with a note to write it down; the teacher is then logged in. One account per email. |
| **Class dashboard** | A **Reading test** switch (Hindi \| English) picks the language. The class split into three reading groups (Letter, Word, Paragraph) in that language, with each group's most common difficulties; children with a dotted border are not yet confirmed; children not yet checked in that language are listed separately; a banner shows check-ins waiting for the teacher's confirmation. Add children (first name + emoji). |
| **Child page** | The child's level in each language (confirmed or provisional); the Reading test switch; **Start English reading check** (or Hindi); the latest diagnosis and the group in that language (the group can be set by hand — the next check in that language then starts at the group's level); past check-ins, each tagged with its language. |
| **Check-in** | One card at a time in large text (letters, words, a paragraph or a story) with the instruction to read to the child (and a 🔊 button that plays it). The teacher taps the microphone, the child reads, the teacher taps stop. About 5–15 seconds later the result of that card shows and the next card appears. If the app is unsure about some words, it asks the teacher to confirm them (with the recording to listen to) before moving on. The teacher can always mark a card by tapping instead of recording. |
| **Result** | The level, the diagnosis ("what to work on"), every word marked (wrong in red, unsure in amber, self-corrected ↺), long pauses and reading speed, **▶ listen** to each card with the words highlighted as they are read, change the level, correct any word, delete the recordings. |
| **10-minute activity** | From a group card: a 10-minute plan for that group, adapted to the words the children actually misread, with steps, materials, practice words, what to watch for and the source it comes from; the teacher can rate it. |
| **Show the class** | Eight activities also open as a full-screen, big-text, tappable version the teacher holds up to the group: change one matra / vowel (each change glows), look-alike letters (say one, a child taps it), build a word from letter and matra cards with its picture (then swap one), quick-flash word cards that flip over with their picture (✓ / again piles), the barakhadi / kagunita / uyirmei or letter-sound chart with a pointer running along a row, column, diagonal or zig-zag and a *sing* mode (the alphabet song over a–z, or the row as a chant), find the wrong word, match words to pictures, and rhyme and read (an original four-line rhyme per language, read aloud line by line by the language's own voice, then "find the word"). The examples come from the bank entry in the group's language and the plan's practice words. Right answers chime, wrong ones get a soft low note; the teacher can mute it. |
| **Meaning step** | After a word card, when enough of its words have pictures: the word and three pictures; the child points, the teacher taps (two rounds), as ASER's English tool asks the meaning of words read. Noted on the result and shown to the diagnosis; never part of the level. Works offline too. |

The interface has one language control: the **Reading test** switch on the class and child pages. Choosing a test puts the whole app in that language — Hindi, English, or Marathi, Tamil, Kannada or Bengali (beta) — and a check, its result and a group's activity are shown in the language of their test. The app opens in English and remembers the last choice on the phone.

**One language at a time.** In English everything is in English, and in the class's language everything is in that language: labels, messages (including errors, which never show the server's technical text), diagnosis summaries, activity steps and source notes, and names when a child or class has both spellings (the demo's children read Meena in English and मीना in Hindi; a teacher adding a child can give the second spelling). Only the child's own reading material stays in the language being tested. Activity examples follow the language the group reads, so an English group never sees Hindi example words.

**What the teacher says to the child** before each card is in the language of the test, like everything else on the screen: a Hindi test in Hindi, the English test in English ("Read these letters one by one."), a Tamil test in Tamil; the 🔊 recording says the same line. A teacher who wants to explain the English test in the child's own language, as ASER testers do, simply does so.

**Built for the teacher's day**: "reading check" and "card" rather than technical terms; a banner on the class page lists the children whose reading check waits for the teacher's confirmation, and one tap opens it; the class list is one tap back from a class (to add another class).

**Made for children too.** The child sees a parrot (a parrot, because in India it is the childhood companion that talks) that speaks the instruction, the ASER ladder climbing as cards are passed, a microphone whose ring grows with their voice, and after every card a second of stars and "शाबाश!" / "Well done!" in the language of the test, the same whether the card passed or not: the pass or fail is a small line for the teacher. Animations are short and skippable, and off for phones set to reduce motion. The reading cards themselves stay in the plain system typeface, never the rounded display face used for headings, because a child learning to read must see textbook letter shapes.

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
| Language | the reading test the teacher chose (English, or the class's regional language); each language has its own cards, history, level and group |
| Where to start (all in the language being tested) | a **group the teacher set by hand** → that group's card only (Letter group → letters, Word group → words, Paragraph group → paragraph): the check gives that one card and ends, no other level is tested (a pass sets that level; letters failed → Beginner; a higher card failed gives no level, since nothing below it was read, and the teacher may choose one); otherwise the child's last level in this test, confirmed or not (Word/Paragraph/Story → that rung, Beginner/Letter → letters), from where the ladder moves up and down; a child not checked yet in this test starts at **letters**, whatever the grade. An unfinished check follows the teacher's current choice when it is opened again: with nothing read (or only skips, which are cleared) it starts over; with cards read and a group chosen since, the group's card comes next and then the check ends |
| Next card | pass → one rung up; fail → one rung down; stop when the level is bracketed (a pass just below a fail), at the top or bottom, or after 4 cards read |
| Skipping a card | one **Skip this card** button: the teacher may skip the card shown instead of making the child read it. A skipped card counts for nothing: neither a pass nor a fail. The level comes only from the cards the child read; if none was read there is no level (the teacher may choose one or stop the check). After a skip the ladder moves to the nearest card not tried yet, an easier one first, and never back to a skipped card. A skipped card has no words: it gives the diagnosis no evidence and does not count towards the 4-card cap |
| Which variant | the first variant of that rung the child did not read in this or the previous check-in (variants rotate) |
| If the teacher is asked to confirm words | the ladder waits until they are confirmed, because the next rung depends on that card's pass/fail |

Code: `api/app/levels/aser_rules.py` (`start_level`, `next_item_level`), `api/app/services/checkins.py` (`next_item`). The same rules run on the phone for offline check-ins (`web/src/lib/aser.ts`; a test keeps the two in sync).

### Stage 1 — Recording on the phone

- `MediaRecorder` in the browser: Opus/WebM at 24 kbps on Android Chrome (about 150 KB per minute), MP4/AAC on iPhone Safari. One clip per card. Recording stops by itself after 2 minutes.
- The instruction for each rung, in every test language (and the English test's in every regional language), is pre-recorded with Azure neural voices and shipped inside the app, so the 🔊 button works offline.
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

**Letter cards** get two more rules, because recognisers are weakest on a single spoken letter: a letter **no** recogniser heard is uncertain (silence from both is no proof the child skipped it), and in the beta languages (`confirm_letters`: Marathi, Tamil, Kannada, Bengali) every letter they did not both hear as right goes to the teacher, who confirms it by ear with the recording.

Code: `api/app/speech/align.py`, `api/app/speech/scorer.py`.

### Stage 5 — Scoring the card (ASER rules, in code)

| Card | Passes when |
|---|---|
| Letters (5) | at least 4 of 5 correct |
| Words (5) | at least 4 of 5 correct |
| Paragraph / story | at most 3 mistakes (wrong + skipped) **and** read "as sentences": no more than 2 long pauses **inside sentences** (2.5 s or more, from word timings), and not extremely slow (at least 15 correct words a minute for a paragraph, 20 for a story — in Hindi and English; languages with longer words have proportionally lower floors for the same reading pace: Marathi 11 / 15, Bengali 12 / 16, Kannada 9 / 12, Tamil 7.5 / 10) |

- Pauses between sentences never count: ASER passes a slow reader who reads sentence by sentence. When word timings are not available (no PA), pauses over 3 s are counted from the silence in the audio instead.
- **Uncertain words**: the card is scored in the best case (every uncertain word right) and the worst case (every one wrong). If the two results differ, the card **needs review**: the teacher confirms those words (listening to the recording) before the ladder moves on. If they cannot change the result, the teacher is not interrupted.
- The teacher's answer always overrides the machines for that word.

Code: `api/app/levels/aser_rules.py` (`item_passed`, `Thresholds`), `api/app/speech/scorer.py` (`ItemScore.evaluate`).

### Stage 6 — The level

- **Level of the check-in** = the highest rung passed. If nothing passed and letters were never tried (for example the child failed the paragraph and the session ended), the cards do not place the child: the app asks for one more card or for the teacher to choose the level, rather than calling it "Beginner".
- **Two-check confirmation**: a child's level is *provisional* after one check-in and *confirmed* when two check-ins in a row agree. One bad day does not move a confirmed level.
- **Teacher override**: the teacher can set the level of any check-in; it is logged and wins.
- Levels are always **replayed** from the child's check-in history (oldest first), so a later correction of an old check-in keeps everything consistent.
- **Per language**: each language is replayed on its own, so an English check moves only the English level, and a Hindi and an English check never count as the two agreeing checks.

Code: `api/app/services/checkins.py` (`placed_level`, `_settle`, `replay_levels`), `aser_rules.update_levels`. Databases from before levels were kept per language are moved over at startup (`migrate_levels`).

### Stage 7 — Diagnosis: what kind of mistakes (Claude)

1. **Evidence (code)**: for every wrong word, deterministic features — only the vowel sign changed; first and last akshara right but the middle wrong (scaffolding); first akshara right; error on a conjunct; a common sight word; what each recogniser heard; pauses and speed per card; and, for a word card, how many words the child knew the meaning of in the picture step.
2. **Instant rule-based diagnosis**: shown at once (and the only one when offline or when Claude is unavailable).
3. **Claude Opus 5.5** (in the background, about 8 s after the last change so a burst of teacher corrections costs one call): reads only the structured evidence — no audio, no level decision — and returns JSON in a fixed schema: up to three **error patterns** from a fixed list, the evidence (cited by word index), whether each substitution is a real word, and a two-to-three-sentence summary for the teacher in English and the class's language (Hindi for a Hindi class, Kannada for a Kannada class; classes in a language without an interface get Hindi) with one thing to practise this week.
4. **Checks**: every cited word must exist in the evidence; a pattern resting only on uncertain words, or citing nothing, is dropped; if nothing valid remains the rule-based diagnosis stays. Summaries use the child's name without guessing gender (Hindi constructions like "मीना को … में कठिनाई है"; in Marathi, Kannada and Tamil the name comes first, "ಮೀನಾ: …", since their verbs show gender too).

Error patterns: letter recognition, vowel signs (matras), conjunct letters, blending sounds into words, common sight words, guessing from the first letter, accurate but slow or halting, kind of error not clear (unclear audio, or a check marked by tapping, which shows which words were wrong but not what was said). For an **English** check the same patterns are named in English-reading terms — letter names and sounds (b/d, p/q), vowel sounds (cat/cut), blends and digraphs (sh, ch, st), sounding out and blending (c-a-t → cat), sight words (the, was, said) — and the rule-based summary gives English-reading advice (letter-sound chart, word families, not barakhadi or matras) in both summary languages.

Settings: effort `medium` (chosen after comparing low and medium on real check-ins), structured output, server-side refusal fallback (a false-positive safety decline is re-run on Anthropic's recommended fallback model), the system prompt is prompt-cached. Measured cost: **about $0.02 per check-in**.

Code: `api/app/llm/evidence.py`, `rules.py`, `diagnose.py`, `prompts.py`, `patterns.py`.

### Stage 8 — Grouping the class (TaRL)

Children are grouped by their level in the reading test shown (confirmed if available, else provisional, shown with a dotted border); English and the regional language have separate groups, because a child's two levels often differ:

| Group | Levels |
|---|---|
| Letter group | Beginner + Letter |
| Word group | Word |
| Paragraph group | Paragraph |
| Story group | Story |

Each group card shows its most common difficulties (from the children's latest diagnoses in that language). The teacher can move a child to another group by hand, separately for each language; the child's next reading check in that language then gives only that group's card (see "Where to start").

Code: `aser_rules.cohort_for_level`, `api/app/api/classes.py` (`dashboard`).

### Stage 9 — 10-minute activity (Claude + a second-model review)

1. **Candidates (code)**: the three bank activities that best match the group's difficulties, from the twelve built on a text (three for each reading level). What the children read matches their level, because a child who cannot read letters cannot read a word: a Letter group reads only letters taken from the rhyme (the teacher says the rhyme aloud; the letters the children misread in their check come first), a Word group only single short words from it, paragraph readers a short rhyme of about 35 words (ASER's paragraph length) and story readers a story or a long poem (the Story group). The letters come from the rhyme's word starts (most frequent first) and the words are its two-to-three-akshara words (English: two to five letters); the plan carries them as `material`, and the rhyme is marked as one the teacher reads aloud. A Paragraph or Story group gets homework on its text instead (`homework` in the bank, per kind of text: read a rhyme aloud at home twice and copy two lines; read a story at home, retell it and write two sentences), in every interface language. Each has the group read a real poem or story from a free book (`content/texts/`, credited) and serves a goal of NCERT's foundational-stage curriculum (NCF-FS 2022: C-10.1 phonological awareness, C-10.3 letters, C-10.4 fluent reading, C-10.5 understanding a story, C-10.6 reading poems, with C-11.1 and C-11.2 for English). The activity the group did last is left out and each text activity gets the text the group has not read yet (or read longest ago), so "another activity" brings another routine and another text. A language without texts falls back to the method bank (Pratham TaRL, ASER), where Hindi-script methods are never offered for English and their English versions never for Hindi.
2. **Adaptation — Claude Opus 5.5**: chooses one candidate (the schema only allows those three ids) and adapts it into a 10-minute plan for this group: 3–4 steps with minutes, materials a government school has, practice items (a Letter or Word group: exactly its letters or words; otherwise 4–8 words copied from the text, chosen for the group's difficulty), what to watch for, and one line on why — in English and the class's language. No children's names.
3. **Checks**: code checks the source id, that the steps add up to 8–12 minutes, that every step is bilingual and that the practice words are in the text (others are dropped; fewer than three left sends the plan back); **Claude Haiku 5.5** then reviews the plan against the bank entry: faithful to the source, age-appropriate, safe, fits 10 minutes, and fits the level (the children read only letters, single words or the text, as the entry says). On a rejection the plan is regenerated once with the reviewer's issues.
4. **Fallback**: if the plan still fails, Claude is unavailable, or the spend cap is reached, the teacher gets the bank entry itself, with its text and the text's words. Under every plan: the book the text comes from (title, author, year, licence, link) and the NCERT goal it serves.

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

**Accounts**: one role, the teacher, with a login ID and a numeric PIN (bcrypt-hashed); the app keeps a 30-day login token (JWT). The demo logins are `demo` / 1234 and `judge` / 2026. Sign-up (`POST /api/auth/signup`: name, email, PIN 4–8 digits) creates a teacher with a random unused 6-digit login ID (100000–999999) and returns it with a token; an email already used gets 409. There is no email verification or PIN reset yet, and no limit on wrong PIN attempts.

**Database tables**

| Table | Holds |
|---|---|
| `teachers` | login, name, email (sign-up), PIN hash, interface language |
| `classrooms` | name (and its spelling per interface language, if given), grade, regional reading language (English is tested alongside it) |
| `students` | **first name and an emoji only** (the name may also be stored in the other script, e.g. Meena / मीना), grade, home language if it differs from the class's |
| `student_levels` | per child and language: provisional and confirmed level, group set by hand |
| `checkins` | one reading check: language, starting rung, status (in progress / needs review / scored / abandoned), suggested and final level, override flag, the phone's ID for offline check-ins |
| `item_results` | one card: the full scored result (every word, what each recogniser heard, timings, pauses, speed, pass/fail), source (AI or taps), the meaning step's answers |
| `item_audio` | the MP3 playback copy of a card's recording (kept 30 days) |
| `diagnoses` | error patterns, evidence, summaries, confidence, model used |
| `level_history` | every change of a child's level and its cause |
| `generated_activities` | each activity plan, its review, the source entry, the teacher's rating |
| `llm_usage` | every Claude call's tokens and cost |

**What leaves the server**: audio goes to Sarvam and Azure for transcription; structured evidence (words, features, the child's first name) goes to Anthropic for the diagnosis; group-level information (no names) for activities. Nothing else is shared.

**Real children**: the hosted demo contains only fictional children; recordings of real children are only for a consented evaluation set.

---

## 11. Content: item banks, activities, languages

- **Item banks** (`content/items/hi.json`, `en.json`): original texts written to the ASER 2024 reading-tool specification — commonly used letters (5 per card); familiar words of two letters with one or two matras (5 per card); a Std I paragraph (4 linked sentences of at most 6 words); a Std II story (7–10 sentences). Three variants of each card, two of each passage. A test checks every bank against the specification. English uses the same five-level ladder (lowercase letters, CVC words, a 4-sentence paragraph, a story); ASER's own English tool uses a different one — capital letters → small letters → simple words → simple sentences, with the meaning of words and sentences asked in the child's language. Status: draft, awaiting an educator's review.
- **Activity bank** (`content/activities/bank.json`): 36 activities. Twelve are built on a text and serve NCERT NCF-FS goals (cited to NCERT's *Learning Outcomes at the Foundational Stage*); they are the ones Claude adapts. The other 24, each adapted to about 10 minutes from an activity described in its cited source (two, "Rhyme and read" and "Match words to pictures", extend their sources' chart reading and picture cards, and say so in their notes) — Pratham / TaRL Africa *Planning TaRL Sessions* (2021) and *Literacy TLM Note* (2021), the ASER 2024 procedure, StoryWeaver. Five work only in Indic scripts and five are their English versions (same method, phonics content), marked with `script`. Written in English and Hindi, with Marathi, Kannada, Tamil and Bengali versions for those classes' teachers (AI-drafted, to be reviewed with the cards). Status: draft, each entry to be checked against its source.
- **Instruction audio** (`web/public/audio/<lang>/<level>.mp3`, each test in its own language): generated by `scripts/make_instruction_audio.py` (`--missing` makes only new files).
- **Show-the-class data**: the screens read the bank entry's `examples` for the group's language (`chain`, `build`, `swap`, `ex1`, `fix`, `row`, `column`, `words`) and the plan's practice words; the letter chart (consonants × vowel signs per Indic script, letters with picture words for English) is `chart` in `languages.json`. Adding a language's chart is one line of data.
- **Rhymes** (`content/rhymes/<lang>.json`): one original four-line rhyme per language in Std 1 vocabulary (drafted and checked by a second pass, awaiting native-speaking educators), with the words to find; `scripts/make_rhyme_audio.py` records each line with the language's Azure voice into `web/public/audio/rhyme/<lang>/`.
- **Texts** (`content/texts/<lang>.json`): real poems and short stories a group reads, one file per language — public domain in India (the author died before 1966, or an anonymous work older than 60 years) or openly licensed (CC0, CC BY-SA) — copied exactly from the cited page (Wikisource, Wikibooks, Kavita Kosh, Project Gutenberg), with the author, year, licence and source URL; stories carry 3–4 comprehension questions we wrote. Twelve bank activities are built on them (`uses_text`: rhyme | story; `reads`: letters | words | text; `readers`: the reading levels it is for): letter cards, clap for the sound, find and write the letters (Letter groups read letters); word cards, break and join, sort the word cards (Word groups read words); classic rhyme, word hunt, fill the missing word (paragraph readers, short rhymes); read and answer, read a story together, read and retell, a long poem (story readers). Texts rotate per group; a text activity is only offered in a language that has such a text, the plan carries the text (Claude adapts the steps but never the text), the activity page shows it with its credit, and the "Show the class" screen reads it line by line, finds words or letters, or walks through the questions. `api/tests/test_texts.py` refuses any text without a verified licence. Textbook text (NCERT, Balbharati, Samacheer, SCERT) is never used: those books are all-rights-reserved or CC BY-NC-ND. Texts: Hindi: रामनरेश त्रिपाठी "नंदू को जुकाम", सुभद्राकुमारी चौहान "बादल हैं किसके काका?", श्रीधर पाठक "उठो भई उठो" (first eight lines), प्रेमचंद "दो बैलों की कथा" (passage); English: Jane Taylor "The Star", Christina Rossetti "Who has seen the wind?", "Humpty Dumpty" and "Rain" (The Real Mother Goose, 1916), "The Crow and the Pitcher" and "The Fox and the Grapes" (The Æsop for Children, 1919); Marathi: बालकवी "आनंदी आनंद गडे" and "श्रावणमासी हर्ष मानसी", साने गुरुजी "श्यामची आई" (passage); Tamil: பாரதியார் "பாப்பாப் பாட்டு", கவிமணி "முத்தந் தா" and "ஊகமுள்ள காகம்", ஔவையார் "ஆத்திசூடி" (opening), முல்லை முத்தையா "ஏமாந்த ஓநாய்" (Tamil Nadu Government nationalised book, CC0); Kannada: ಪಂಜೆ ಮಂಗೇಶರಾವ್ "ಹಾವಿನ ಹಾಡು", the folk rhymes "ಹುಯ್ಯೋ ಹುಯ್ಯೋ ಮಳೆರಾಯ" and "ಆನೆ ಬಂತೊಂದಾನೆ" and "ತೋಳ ಮತ್ತು ಸಿಂಹ" (Aesop retold), all from Kannada Wikisource (CC BY-SA 4.0 page text); Bengali: সুকুমার রায় "বাবুরাম সাপুড়ে", যোগীন্দ্রনাথ সরকার "এক যে রাজা", "হাজার চুমা" and "উপবাসী", উপেন্দ্রকিশোর রায়চৌধুরী "পিঁপড়ে আর পিঁপড়ীর কথা" and "টুনটুনি আর বিড়ালের কথা" (opening).
- **Pictures** (`content/pictures.json`, `web/public/pictures/`): the words of the word cards and other Std 1 words mapped to OpenMoji drawings (CC BY-SA 4.0, [openmoji.org](https://openmoji.org)), fetched once by `scripts/fetch_pictures.py` from a curated word → emoji list. A word without a picture simply has none: the meaning step runs only when a card has three or more pictured words. The song melodies and sound effects are synthesised on the phone (`web/src/lib/sound.ts`, `music.ts`); the alphabet song's tune is the public-domain "Twinkle, Twinkle".
- **Languages** (`content/languages.json`):
  - **English and Hindi** are complete (Tier 1: item banks, instruction audio, interface, real-recording evaluation).
  - **Marathi, Tamil, Kannada and Bengali** are in **beta** (Tier 2): reading cards to the ASER specification (drafted, parallel to the Hindi bank for comparable difficulty, awaiting review by native-speaking educators), instruction audio, common-word lists, activity examples in each script, script notes for Claude, and a reading-speed floor per language. The teacher's screens, diagnoses and activities are in that language and English (AI-drafted translations, awaiting the same review); the child reads in the class's language, and the teacher says the instruction in it. Diagnoses a class received before its language had an interface (in Hindi and English) are rewritten in its language when the server starts. Letter cards are confirmed by the teacher (see Stage 4).
  - **Gujarati, Telugu and Odia** are configured in the engine (vendor locales, script handling) without item banks; **Malayalam** is not configured yet.
  - Every child takes the English test and the test in their regional language. Adding a language is mostly data: a `languages.json` entry (Sarvam, Azure and voice locales, speed floor), an item bank written to the ASER specification, instruction audio (`scripts/make_instruction_audio.py`), its common-word list, activity examples in its script, the language's name in the interface strings, and an educator's review. Giving its teachers their screens in it as well takes a strings file (`web/src/locales/`), `"ui": true`, the rule-based advice templates (`api/app/llm/rules.py`), the activity texts and the English test's instruction in it.

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

**Beta languages (synthetic voices, plumbing only)**: an Azure neural voice read every Marathi, Tamil, Kannada and Bengali word card, the first paragraph and two letter cards, scored by the live pipeline. Paragraphs: 4 / 4 read fully correctly. Word cards: all 12 pass; five words the recognisers heard as a more common word (Tamil படம் → பணம் "money", இலை → இல்லை "no"; Kannada ದೋಣಿ → "Dhoni"; Marathi गाय → काय "what", बोट → पोट) were replaced with equally familiar words. Single letters were unreliable in all four languages, hence teacher-confirmed letter cards. This shows the services, locales and scripts work end to end; it says nothing about children's speech.

**Software tests**: 153 automated API tests (no network or keys needed), run on SQLite and on Postgres; browser end-to-end runs (online check-in with a real recording as the microphone, activity, the full offline round trip, recording replay) against the production Docker image.

---

## 13. Technology stack

| Layer | Technology |
|---|---|
| Web app | React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6, i18next (six interface languages), vite-plugin-pwa (Workbox service worker), Dexie (IndexedDB), MediaRecorder, Web Audio (microphone meter); the Baloo display fonts (SIL OFL) bundled per script, one weight, 195 KB in all; body text and reading cards use the phone's system fonts |
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
                       make_instruction_audio, make_rhyme_audio, fetch_pictures
  tests/               173 tests
  Dockerfile
web/
  src/pages/           Login, Signup, Classes, ClassDashboard, Student, Checkin, OfflineCheckin, Result, ActivityPage
  src/components/      header and shared UI, Mascot (the parrot), Ladder, Celebration, Stars, RecordControls,
                       WordChips, ReviewPanel, TapToMark, InstructionAudio, SayToChild,
                       MeaningCheck (the picture step), SoundToggle,
                       show/ (Show the class: Chain, Pairs, Build, Flash, Chart, FindWrong, PictureMatch, Rhyme)
  src/lib/             types, auth, useRecorder, useClip (replay), aser (offline ladder), content, offline (sync),
                       graphemes (cards and syllables), cheer (what the child hears after a card),
                       sound (synthesised chimes and tunes), music (the songs), pictures (word pictures)
  src/api.ts           API client (offline cache, recordings)
  src/db.ts            IndexedDB tables (offline queue, clips, cache)
  src/locales/         interface strings: en, hi, mr, kn, ta, bn
  public/audio/        pre-recorded instructions, and rhyme/ for the rhymes' lines
  public/fonts/        the display face (Baloo, OFL), one file per script
  public/pictures/     OpenMoji drawings for the word pictures (CC BY-SA 4.0)
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
| `CORS_ORIGINS` | `http://localhost:5173` | the web app's address(es) allowed to call the API, comma-separated (a trailing slash or path is ignored) |
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
- **Beta languages** (Marathi, Tamil, Kannada, Bengali): reading cards, interface strings, rule-based advice, activity translations, rhymes and picture word lists are AI-drafted and await native-speaking educators; accuracy is checked only with synthetic voices; the speed floors are derived from word length, not yet from children's readings; letter cards rely on the teacher. Odia, Telugu and Gujarati have no item banks yet; Malayalam is not configured.
- **The English ladder** follows the shared letter → word → paragraph → story ladder, not ASER's English tool (capital letters, small letters, words, sentences, meaning); moving to the ASER English tool is the natural next step if English stays the focus.
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
