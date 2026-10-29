# LevelOS

**A 3-minute, voice-first reading check on the teacher's phone.** It finds each child's real reading level the ASER way, shows what kind of mistakes the child makes, regroups the class for Teaching at the Right Level, and gives the teacher a 10-minute activity for each group. Hindi and English, with Marathi, Tamil, Kannada and Bengali in beta. Works offline.

Built for the AI for Foundational Learning Hackathon (Challenge 02: Learning-Level Visibility) by Team rushhies.

**Live demo: [levelos-nine.vercel.app](https://levelos-nine.vercel.app)** (API status: [levelos-api.onrender.com/api/health](https://levelos-api.onrender.com/api/health)). The API runs on a free plan; if it has been idle, the first login can take up to a minute.

**Demo logins** (teacher is the only role): `demo` / PIN `1234` or `judge` / PIN `2026` — or tap **Try the demo class** on the login page. A new teacher can **create an account** (name, email, PIN) and is given a 6-digit login ID; the login and sign-up screens have a language menu. The demo class (Grade 2) has 16 fictional children, each with two weeks of history in English and in Hindi; no real child's data is in the hosted demo.

📖 **How everything works, stage by stage:** [document.md](document.md)

---

## What it does

- **Adaptive reading check (ASER)**: letters → words → paragraph → story, one card at a time, moving up on a pass and down on a fail until the level is bracketed. A child not checked yet starts at letters; a group the teacher picks by hand gets only that group's card. The child reads from a large card; the teacher records. A card that is clearly too hard or too easy can be **skipped** instead of forced on the child: a skipped card counts for nothing, the check moves on to a card not tried yet, and the level comes only from the cards the child read (none read, no level).
- **English and regional-language tests**: as in ASER, each child is tested in English and in their regional language (Hindi; **Marathi, Tamil, Kannada and Bengali in beta**), with a separate level and group in each. One switch, **Reading test**, chooses the test and with it the language of the whole app: choose Hindi and everything is in Hindi (names, advice, activities, messages), choose English and everything is in English, choose Tamil and everything is in Tamil — including what the teacher says to the child before each card and its 🔊 recording.
- **Scoring that cannot "auto-correct" the child**: two speech recognisers (Sarvam, Azure) transcribe without seeing the text; deterministic code aligns their transcripts with the card akshara by akshara and marks every word right, wrong, skipped or self-corrected.
- **Honest uncertainty**: words the recognisers disagree on are marked *uncertain*; if they could change the result, the teacher confirms them — listening to the child's recording, with a 🔊 per word — before the check moves on.
- **ASER rules in code decide the level**; two agreeing check-ins confirm it; the teacher can override anything.
- **Diagnosis by Claude**: the error pattern (matras, conjuncts, blending, letter confusion, sight words, guessing, fluency; for English: letter sounds, vowel sounds, blends) with the exact words as evidence, and a short note for the teacher in English and the class's language.
- **Class dashboard** in four reading groups (Letter, Word, Paragraph, Story) with each group's main difficulties.
- **10-minute activity per group, built on a book**: Claude adapts one of twelve activities built on a real poem or story from a free book, each serving a goal of NCERT's foundational-stage curriculum (NCF-FS 2022, the curriculum CBSE follows and state boards adapt), and a second model checks it, including that it fits the level. What the children read matches their level, because a child who cannot read letters cannot read a word: a Letter group reads only letters taken from the rhyme (the teacher says the rhyme aloud; the letters the children misread in their check come first), a Word group only single short words from it, paragraph readers a short rhyme of about 35 words (ASER's paragraph length) and story readers a story or a long poem (the Story group). Letter groups: letter cards, clap for the sound, find and write the letters. Word groups: word cards, break and join words, sort the word cards. Paragraph readers: read a classic rhyme, word hunt, fill the missing word. Story readers: read and answer, read a story together, read and retell, a long poem. Paragraph and Story groups also get homework on the text they read (read it aloud at home, retell it, write two sentences), instead of a list of single words. "Another activity" brings another routine and another text. The earlier method bank (Pratham TaRL, ASER) stays for the Show-the-class shelf and for a language without texts.
- **Real texts, free to use, credited**: 28 texts in `content/texts/` across the six languages: public-domain classics (Balkavi, Sane Guruji, Bharathiyar, Avvaiyar, Kavimani, Subhadra Kumari Chauhan, Shridhar Pathak, Premchand, Sukumar Ray, Upendrakishore, Panje Mangeshrao, Jane Taylor, Mother Goose, Aesop) and openly licensed ones (the Tamil Nadu Government's CC0 books, folk rhymes on Kannada Wikisource under CC BY-SA). Under every activity the teacher sees the book the text comes from, with its licence, and the NCERT goal it serves. A test refuses any text that is not public domain in India (author died before 1966) or openly licensed. NCERT and state-board textbook pages are never copied: they are all-rights-reserved or CC BY-NC-ND.
- **Made for children too**: a parrot mascot that speaks the instruction, the ASER ladder climbing on screen, a live microphone meter, and a burst of stars with "शाबाश!" (in the language of the test) after every card, pass or not — the result itself stays with the teacher. The reading cards stay in plain textbook letters.
- **Show the class**: eight activities open as full-screen, big-text, tappable versions the teacher holds up to the group, in every language, with pictures, sounds and songs: change one matra or vowel (the changed syllable glows), look-alike letters (say one, a child taps it), build a word from letter and matra cards (with its picture), quick-flash word cards that flip over with their picture, the barakhadi / kagunita / uyirmei or letter-sound chart with a pointer that runs along a row, column, diagonal or zig-zag and a **sing** mode (the alphabet song, or the row as a chant), find the wrong word in a sentence, **match words to pictures**, and **rhyme and read**: an original four-line rhyme per language, read aloud line by line by the language's voice, then "find the word". Chimes and a fanfare are synthesised on the phone (nothing to download) and can be muted.
- **Meaning, not just decoding**: after a word card, the child is shown a word and three pictures and points to the right one (as ASER's English tool asks the meaning of words read); the teacher taps what the child points to. It is noted for the diagnosis and never changes the level. Pictures are OpenMoji drawings bundled with the app.
- **Replay**: every card's recording can be played again for 30 days (only by that teacher), with words highlighted as they are read.
- **Offline**: the app, class data, cards and spoken instructions work without network; the teacher taps the mistakes, the ladder runs on the phone, and everything syncs and is AI-checked when the network returns.

## How a check-in flows

```
phone: record a card ─► API: ffmpeg → quality gate (silent / short / long / wrong card → re-record)
  ─► speech: Sarvam + Azure STT (never see the text) · Azure Pronunciation Assessment (tie-break, timings)
  ─► align + fuse words (akshara level) → uncertain words → teacher confirms if they could flip the card
  ─► ASER rules: 4/5 letters or words; paragraph/story ≤3 mistakes, not halting → next card or level
  ─► level (provisional → confirmed by 2 check-ins) → diagnosis (rules at once, Claude in the background)
  ─► dashboard groups → 10-minute activity (Claude adapts a book-based bank entry, Claude Haiku reviews it)
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

153 automated tests (SQLite and Postgres); end-to-end browser runs against the production Docker image (recorded check-in, activity, offline round trip, replay).

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

Item banks are original texts written to the ASER 2024 reading-tool specification (test-enforced); the activity bank's main activities are built on free texts and NCERT's NCF-FS goals, and its earlier entries adapt activities from Pratham / TaRL Africa *Planning TaRL Sessions* (2021) and *Literacy TLM Note* (2021), the ASER 2024 procedure and StoryWeaver, each entry citing its source. Both are drafts awaiting an educator's review. Error categories follow Raman & Rao (Interspeech 2025). English and Hindi are complete. **Marathi, Tamil, Kannada and Bengali are in beta**: the child is tested in that language with ASER-style reading cards (drafted, awaiting native-speaking educators), spoken instructions, a reading-speed floor fitted to the language's word length and activity examples in its script, with the teacher's screens, diagnoses and activities in that language and English (translations drafted, awaiting the same review); checked end to end with synthetic voices only. Odia, Telugu and Gujarati are configured without item banks; Malayalam is still to be configured. Each language is a data pack (language config, item bank, instruction audio, word lists, review), not new code ([document.md §11](document.md#11-content-item-banks-activities-languages)).

## Known limitations

- Accuracy on children's voices is not yet measured (the real recordings so far are of an adult).
- Item and activity banks are AI-drafted and await an educator's review.
- Single letters are hardest for the recognisers, so letter cards ask the teacher to confirm more often (replay makes it quick).
- The English test uses the same letter → word → paragraph → story ladder as Hindi, not ASER's own English tool (capital letters, small letters, words, sentences, meaning).
- Beta languages (Marathi, Tamil, Kannada, Bengali) are not yet validated with children, and their strings, activity translations, rhymes and picture word lists are AI-drafted, awaiting native-speaking reviewers; single letters are unreliable for the recognisers there, so the teacher confirms letter cards by ear.
- On free plans the API sleeps when idle (a monitor keeps it awake) and Azure allows one request at a time.

## Licence

MIT — see [LICENSE](LICENSE). Bundled third-party work: the word pictures are [OpenMoji](https://openmoji.org) drawings (CC BY-SA 4.0); the display typeface is the Baloo family (SIL Open Font License); the alphabet song's tune is the public-domain "Twinkle, Twinkle, Little Star".
The reading texts in `content/texts/` are public domain or openly licensed, each credited on screen and in the file: Hindi: रामनरेश त्रिपाठी "नंदू को जुकाम", सुभद्राकुमारी चौहान "बादल हैं किसके काका?", श्रीधर पाठक "उठो भई उठो" (first eight lines), प्रेमचंद "दो बैलों की कथा" (passage); English: Jane Taylor "The Star", Christina Rossetti "Who has seen the wind?", "Humpty Dumpty" and "Rain" (The Real Mother Goose, 1916), "The Crow and the Pitcher" and "The Fox and the Grapes" (The Æsop for Children, 1919); Marathi: बालकवी "आनंदी आनंद गडे" and "श्रावणमासी हर्ष मानसी", साने गुरुजी "श्यामची आई" (passage); Tamil: பாரதியார் "பாப்பாப் பாட்டு", கவிமணி "முத்தந் தா" and "ஊகமுள்ள காகம்", ஔவையார் "ஆத்திசூடி" (opening), முல்லை முத்தையா "ஏமாந்த ஓநாய்" (Tamil Nadu Government nationalised book, CC0); Kannada: ಪಂಜೆ ಮಂಗೇಶರಾವ್ "ಹಾವಿನ ಹಾಡು", the folk rhymes "ಹುಯ್ಯೋ ಹುಯ್ಯೋ ಮಳೆರಾಯ" and "ಆನೆ ಬಂತೊಂದಾನೆ" and "ತೋಳ ಮತ್ತು ಸಿಂಹ" (Aesop retold), all from Kannada Wikisource (CC BY-SA 4.0 page text); Bengali: সুকুমার রায় "বাবুরাম সাপুড়ে", যোগীন্দ্রনাথ সরকার "এক যে রাজা", "হাজার চুমা" and "উপবাসী", উপেন্দ্রকিশোর রায়চৌধুরী "পিঁপড়ে আর পিঁপড়ীর কথা" and "টুনটুনি আর বিড়ালের কথা" (opening).
