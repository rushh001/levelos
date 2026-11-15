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

### 25 Oct — every child tested in English and the regional language; English first (asked for by Z)
- [x] Z: switching the app to English only changed the interface; children were still tested in Hindi. Now, as in ASER, each child takes an **English** and a **regional-language** (Hindi) reading test, each with its own ladder history, level, two-check confirmation and group (new `student_levels` table; older databases are moved over at startup, checked against a copy of the deployed data)
- [x] Switching the app language switches the reading test too; a **Reading test** switch (Hindi | English) on the class and child pages picks it on its own. The app opens in English
- [x] Dashboard groups, group set by hand, start level, diagnoses, activities and offline check-ins all follow the reading test; check-ins show their language
- [x] Demo children got two weeks of English history as well (lower than their Hindi, as for most second-language readers); a deployed demo gets it on its next start, without a reset
- [x] Activities: the 5 Hindi-script methods (barakhadi, matras, conjuncts) are never offered for English; 5 English versions of them added (letter-sound chart, letter-card word building, change one vowel, sound strings, break and join blends), same sources
- [x] English checks: error patterns and the instant rule-based advice in English-reading terms (letter sounds, vowel sounds, blends); a tap-marked check now says so instead of "record somewhere quieter"
- [x] 130 API tests; browser run: dashboard per language, app-language toggle, an English check (tap-marked) moving only the English level, English group activity

### 25 Oct (later) — one language at a time, from the teacher's side (asked for by Z)
- [x] Audit: every teacher screen captured in English and in Hindi (24 screens). Mixing came from data, not labels: Hindi names and class name in English, Hindi example words in English activities, English-only source notes, English server errors, and the English test explained in English to a Hindi-medium child
- [x] Names per interface language (Meena / मीना, Class 2 – A / कक्षा 2 – अ); diagnosis text shows the name in the app's language; a teacher can add a child's second spelling; a deployed demo gets the names on its next start (new `names` column added at startup)
- [x] What the teacher says to the child: Hindi test in Hindi; English test in the class's language (Hindi in the Hindi app, as ASER does), meaning shown below, matching 🔊 recording (4 new Hindi recordings)
- [x] Activities: example words follow the language the group reads; source notes in Hindi; earlier activities listed in the app's language (were always Hindi)
- [x] Errors in the app's language (no server text); "reading check" and "card" instead of check-in / item; correct plurals ("1 child")
- [x] Class page banner lists the children waiting for confirmation, one tap opens the check; back from a class reaches the class list (was a loop with one class); test language shown under the page title (titles no longer cut off); each language's level with its own status on the child page
- [x] 134 API tests; browser run repeated in both languages

### 25 Oct (night) — Marathi, Tamil, Kannada, Bengali reading tests (beta) (asked for by Z)
- [x] Z chose: children tested in these four languages (same ASER flow as Hindi), teacher screens stay English/Hindi; the team finds native speakers to review the cards
- [x] Reading cards for all four (3 letter, 3 word cards, 2 paragraphs, 2 stories each, parallel to the Hindi bank), instructions in each language (+ English/Hindi meaning), 16 spoken instructions; Bengali added to the language config; Odia's unverified Azure code set (`or-IN`, confirmed in Microsoft's list)
- [x] Reading-speed floors per language: their words are longer (aksharas per word: Hindi 1.97, Bengali 2.52, Marathi 2.71, Kannada 3.27, Tamil 4.01), so Hindi's 15 / 20 would have marked fluent readers as halting; floors give the same aksharas a minute (Marathi 11 / 15, Bengali 12 / 16, Kannada 9 / 12, Tamil 7.5 / 10), on the server and offline
- [x] Common-word lists, Claude script notes (Bengali, Tamil, Kannada), rule-based advice without Hindi-only terms, activity examples in each script (uyirmei / kagunita charts named as such), offline cards for every language, language menu for new classes (beta marked)
- [x] Synthetic-voice check through the live pipeline: paragraphs 4 / 4 fully correct, word cards 12 / 12 after replacing five words the recognisers heard as more common ones; single letters unreliable in all four → letters the recognisers did not both hear as right go to the teacher (`confirm_letters`); in every language, a letter neither heard goes to the teacher. Hindi/English real-recording eval unchanged (117 / 118, 9 / 9 cards)
- [x] Browser run: a Tamil class created, a child tested in Tamil (cards, Tamil instruction with English/Hindi meaning), grouped by the Tamil level
- [x] 145 API tests

### 25 Oct (late night) — teacher's screens in Marathi, Kannada, Tamil, Bengali (asked for by Z)
- [x] Z: a Kannada test's result offered Hindi; a Kannada class should show Kannada and English, not Hindi, and the same for the others
- [x] Interface in Marathi, Kannada, Tamil and Bengali (all strings, AI-drafted); the language button pairs English with the class's language (EN ⇄ ಕ for a Kannada class) and remembers it for pages without a class
- [x] Diagnoses (Claude and the rule-based fallback) and activities in English and the class's language; Claude is told the teacher's language and its own terms (kagunita, uyirmei, ottakshara) and still never genders the child; these classes' earlier diagnoses (written in Hindi) are rewritten at startup
- [x] Activity bank translated into the four languages (22 activities: title, materials, steps, what to watch for, source note), so the activity without Claude or offline is in the class's language too
- [x] The English test's instruction spoken in each of the four languages (16 clips); dates in each language's format
- [x] 150 API tests

### 26 Oct — child-friendly, animated UI (asked for by the mentor: "one of the best and simplest UIs", visuals children like)
- [x] Z chose: a simple mascot (yes), the English picture-meaning check (later), six Show-the-class screens
- [x] A visual identity: warm palette, the Baloo display face in every script (bundled, 195 KB, offline), card and button system, enter and press motion, skeletons with the parrot; off under reduced-motion
- [x] Child-facing moments in the check: parrot that speaks the instruction, the ASER ladder on screen, live microphone meter, a star burst with "शाबाश!" in the test's language after every card (pass or fail stays a small teacher line)
- [x] Show the class: full-screen tappable versions of six activities (matra/vowel chain, look-alike pairs, word building + swap, flash cards, barakhadi/kagunita/uyirmei/letter-sound chart with a running pointer, find the wrong word), driven by the bank's per-language examples and the plan's practice words; chart data per script in languages.json
- [x] Teacher pages restyled (login, classes, dashboard with group glyphs, child, result, activity); browser screenshots of every screen in English; strings in all six languages
- [x] Z: a check now starts at the child's last level even before it is confirmed, and a first test in a new language no higher than the other test's level; the ladder drawn as stairs with the parrot on the current step; the child's page links to its group's activity

### 26 Oct (later) — activities with pictures, sounds, songs and rhymes (asked for by Z: "make them interesting … music, poems, images, animations")
- [x] Pictures: 169 Std 1 words in six languages mapped to OpenMoji drawings (80 files, 221 KB, CC BY-SA 4.0), curated and verified by agents; `scripts/fetch_pictures.py`
- [x] The meaning step after a word card (ASER's English tool asks word meaning): a word and three pictures, the teacher taps what the child points to; stored on the card, shown on the result, given to the diagnosis; never part of the level; offline too
- [x] Sounds synthesised on the phone (chime, soft wrong note, fanfare, ticks, a music-box melody); mute button remembered on the phone
- [x] Songs: the alphabet song over a–z and a chant for any row of the barakhadi / kagunita / uyirmei chart, cells lighting up in time
- [x] Two new bank activities in six languages: "Rhyme and read" (an original four-line rhyme per language, written and then checked by a second agent, recorded line by line with the language's voice, 24 clips) and "Match words to pictures"; their source notes say honestly what is the source's and what is ours
- [x] Flash cards flip over with their picture; word building shows the word's picture; the chart's English letters carry OpenMoji pictures; a "More to show the class" shelf on the activity page opens any screen in two taps
- [x] A six-lens review of the day's work (child's view, teacher's flow, React correctness, offline and performance, backend and data, languages and copy): 46 notes, the real ones fixed — the stop button now silences a song, the fanfare no longer plays twice, the parrot sits centred on its step, the teacher's cue (the letter to say, the word to find) hides behind an eye so the class listens instead of reading it, the meaning step never shows a child a wrong mark and asks "कहाँ है?" (no gender to agree with), flash cards show the word alone, the chart gains ण ङ ञ and ড় ঢ় য়, the regional source notes now say what is ours, misleading English pictures removed, iOS audio unlocked on the first tap, offline sync resends missing meaning answers, the activity bank no longer ships whole in the app (760 → 569 KB)
- [x] Found on the way: timestamps left the server without a UTC offset, so between midnight and 05:30 IST the app took today's activity for yesterday's and made a new one on each visit; fixed with a test
- [x] 173 API tests
- [x] Z: one language control — the Reading test switch sets the interface language too (Hindi test → Hindi app, Tamil → Tamil); the header language button removed. Then, at Z's request, the test's spoken instruction, its 🔊 clip and the meaning question follow the same rule (the English test is explained in English, not in the child's language); the `en-<lang>` clips are gone
- [x] Mentor (teacher): a card can be skipped instead of forced on the child — "too hard" moves the ladder down, "too easy" up; the level comes from the cards actually read (online and offline; skipped cards give the diagnosis no evidence)
- [x] Mentor (teacher): activities grounded in real, free-to-use texts rather than only TaRL formats — research (two agents: NEP/NIPUN Bharat and state FLN programmes; state textbooks and copyright) showed textbook text cannot be reused (NCERT/state books all-rights-reserved, DIKSHA CC BY-NC-ND) but public-domain classics and CC0/CC BY works can; four agents gathered verified texts per language; `content/texts/<lang>.json` (16 texts in six languages, each with author, death year or licence, source URL, text copied exactly) + three new bank activities in six languages ("Read a classic rhyme", "Read and answer" citing NIPUN Bharat's Grade-3 goal, "Word hunt in a rhyme") + a text "Show the class" screen (read line by line, find a word, find words by first letter, questions with answers) + the text and its credit on the activity page; candidates prefer a text activity on a tie; 162 API tests
- [x] Z: Claude's main 10-minute activity must come from books and the CBSE / state-board curriculum, not the Pratham / TaRL list — every group's activity is now built on a free text (only text activities are offered to Claude where the language has texts; the TaRL / ASER bank stays for the shelf and for a language without texts); six more text activities (letter cards and clap for the sound for Letter groups, break and join and word cards for Word groups, read a story together and read and retell for Paragraph groups), each citing the NCERT NCF-FS competency it serves (NCERT, Learning Outcomes at the Foundational Stage); the three earlier text activities re-cited to NCF-FS; ten more texts (26 in all) so texts rotate per group; the group's last activity is left out so "another activity" brings another routine; practice words must come from the text; under every activity: the book the text comes from and the NCERT goal (prompt act-v6). Textbook pages (NCERT, state boards) are still never copied: all-rights-reserved or CC BY-NC-ND; 166 API tests
- [x] Z: activities must match the reading level (a child who cannot read letters cannot read a word): a Letter group now reads only letters taken from the rhyme (the teacher says the rhyme aloud; misread letters first), a Word group only single short words from it, paragraph readers a short rhyme (about 35 words, ASER's paragraph length), story readers a story or a long poem (the Paragraph group gets stories when most of its children read at story level); bank entries say what the children read (`reads`) and for whom (`readers`); letter and word steps rewritten so the children never read a line; three new activities (find and write the letters, sort the word cards, fill the missing word); the reviewer checks the level (`fits_level`); a letters screen for Show the class; two short Bengali rhymes (28 texts); prompt act-v7; 167 API tests
- [x] Z: skip made simple — one "Skip this card" button (no too hard / too easy); a skipped card counts for nothing: the level comes only from the cards read (letters skipped and words skipped: no level, where the app used to say Letter); after a skip the check goes to the nearest card not tried yet, easier first, never back to a skipped one; same rule offline; diagnosis prompt diag-v7; 166 API tests
- [x] Z: a Letter or Word group card shows only its letters or words; the rhyme is folded behind a "show the rhyme for the teacher" button; the Letter group shelf no longer offers the rhyme and word-picture screens (now Word group only)
- [x] Z: a child not checked yet starts at letters (not by grade); a group the teacher chooses by hand gives only that level's card, no other level (`checkins.fixed_level`, online and offline); an unfinished check follows the teacher's current choice when reopened (nothing read, or only skips: starts over, skips cleared; cards already read and a group chosen since: that group's card next, then it ends); 169 API tests
- [x] Z: a Story group of its own (Letter, Word, Paragraph, Story; story readers had shared the Paragraph group): on the dashboard, in the group menu (chosen by hand: only the story card), with its own 10-minute activity (read and answer, read a story together, read and retell, a long poem); 170 API tests
- [x] Z: Paragraph and Story groups get homework on the text (rhyme: read it aloud at home twice, copy two lines; story: read it at home, retell it, write two sentences) instead of a practice-word list; six languages; shown on older plans too; 171 API tests
- [x] Z: teacher sign-up (name, email, PIN 4–8 digits) gives a unique 6-digit login ID, shown once to write down; one account per email (`teachers.email`, added on start-up); a language menu on the login and sign-up screens only; 173 API tests
- [x] Z (1 Nov): offline, everything works but voice scoring and sign-up/login — 10-minute activities made on the phone from the bundled book bank by the server's rules ("Made on this phone (offline)"); new class, new child, group change and activity rating kept in an outbox and sent when back online (temporary IDs replaced, offline checks follow); reads use the phone's copy when there is no network, and the outbox goes first when it returns; LM Studio support: on a computer running LM Studio its local model adapts the offline activity ("Generated offline using LM Studio"), checked by the same rules, else the phone-made one
- [x] Z (1 Nov): the free API keeps itself awake — `/api/ping` (no database); the server calls its own public address every 10 minutes (`RENDER_EXTERNAL_URL`); a GitHub Actions schedule wakes it every 30 minutes; the web app wakes it as it opens; Render's health check moved to `/api/ping` so Neon can still sleep; README: how to try offline; 176 API tests
- [x] Z (1 Nov): delete a class (class list → Delete → confirm): its children, checks, recordings, levels and activities go too, the Claude spend ledger stays; works offline (outbox); the shared demo class of the `demo` and `judge` logins cannot be deleted; a class or child made offline is created once even if the app closes mid-sync (`local_id`); README: how offline works; app tried with children in a school (Z); 179 API tests

---

- [x] Z (14 Nov, jury feedback: activities lengthy and hard to follow): each activity is 3 short steps (one line, ≤ 12 words) with a picture each, checked in code for Claude, LM Studio and the 12 book activities (rewritten in all six languages); "🎯 Made for this group" opens every activity: the group's most common mistakes (children per mistake, ✓ where the activity works on it) and the letters or words they misread (⭐ on the cards); 🔊 Listen to this activity: read aloud in the teacher's language (Azure neural voice, `POST /api/speech`, clips kept), with a slider and Step 1/2/3 chips, kept on the phone for offline, the phone's voice otherwise; ⏱ Start the 10 minutes: one step at a time with a timer; details folded away; the Haiku reviewer also checks easy to follow and works on the group's mistakes (act-v8); fixed `scripts.seed_demo` (it called a function renamed earlier); 186 API tests
- [x] Z (14 Nov): Letter groups get no poem (it confused teachers): letter cards of the letters the children misread, then the language's ASER letters, each with a picture word (ग → गाय 🐄), else an alphabet-chart word or an ASER word-card word; the misread list folds away; an activity made online stays today's activity offline (with its recording)
- [x] Z (14 Nov): "Made for this group" folds to one line (the group's main mistake and how many children make it), tap to see all; the activity screen checked end to end in all six languages (Letter, Word, Paragraph and Story groups: Claude's 3 steps in the class's script, the folded line, letter cards with pictures and no poem, the Azure voice, step-by-step mode) on local demo classes in Marathi, Kannada, Tamil and Bengali
- [x] Z (14 Nov): language menu on "My classes" too (as on login and sign-up): changes the screen at once, no logout; it also becomes the preferred reading test, so a class that offers it opens in it; "1 child" in the five regional languages (was the plural)
- [x] Z (14 Nov): text ran off the screen: the teacher's copy of a story or rhyme used the child's large reading size (it overrode the size set for it), so long Kannada and Tamil words spilled past the card; the "More to show the class" buttons stretched the page sideways in Tamil. Now a normal reading size, long words wrap, and every screen (my classes, class, child, all four groups' activities with every fold open, each step of the 10 minutes, Show the class) is checked in all six languages at 360 px: 163 screens, nothing off the screen or cut off
- [x] Z (14 Nov, jury feedback: the same questions came up again; strengthen offline): letter and word cards drawn for each check from per-language pools (about 25 letters, 60 words; at least 2 pictured words for the meaning step); 10 paragraphs and 8 stories per language (Claude-drafted, `scripts/draft_cards.py`, held in code to the ASER spec and the reviewed cards' difficulty; about $1.35); never a card the child read in their last 3 checks or the one the child before them just read; the same rule offline on the phone; every child, both tests and the groups' activities saved on the phone in the background as a class opens; the header says "Offline" whenever the server cannot be reached (also on a Wi-Fi with no internet); offline everything checked end to end in Hindi and Tamil (header, language menu, a child never opened, a check recorded and corrected by tapping, the provisional level, the 10-minute activity with listen, step by step, Show the class and rating, new class, new child, group change, deleting a class, then sync, AI scoring and the teacher confirming what the AI was unsure of); fixed: with no network a child's check left unfinished online could not be checked (now a check on the phone takes over, and the old one is closed on sync); an online check whose network goes now continues on the phone ("Continue offline"); the confirm list broke long words letter by letter (each word now on its own line); story cards use the textbook face; every paragraph and story card (108) checked at 360 px; offline listening in every language (an activity seen online keeps its recording; one made on the phone plays the book activities' lines recorded once per language with Azure, `scripts/make_activity_audio.py`, downloaded in the background); every class saved from My classes, not only the ones opened (a Marathi class never opened online did not load offline); "not saved on this phone yet" said plainly; every reading card checked at 360 px in all six languages; 200 API tests
- [x] Z (15 Nov, offline gone through file by file, with a second independent review): every past result of every child opens offline (a child's page lists each check in full; only the latest were saved, so an older one said "not saved"); the teacher's corrections work offline (tap a word, confirm the uncertain words, change the level, delete the recordings), worked out on the phone by the server's own rules (`web/src/lib/rescore.ts`, checked against the server on 884 corrections of real checks) and sent later; "Continue offline" goes on from the cards already read, and a check never counts twice (the old one closed first; one that had finished after all is not sent again); "Try again" when the network is back; an offline check is dated when it was done (`started_at`), not when it was sent; a class or child made offline opens under either ID after a sync; a phone shared by teachers sends each one's waiting work only under their own login (logging out with work waiting warns); a server error never drops a change made offline (it pauses and tries again); requests that hang are given up and the phone's copy is used; a failing server counts as no server (the check or activity is made on the phone); a check the server refuses offers "Send again" / "Remove from this phone" after 3 tries; the phone's storage is marked persistent; double taps on new class / new child make one; end-to-end test with the servers really stopped and started; 201 API tests
- [x] Z (15 Nov, offline Listen in Tamil, Marathi, Kannada): the recorded activity lines were downloaded only after every class had been saved (minutes), and marked as saved even when the service worker had not kept them (on the first visit it is not yet in charge), so offline an activity made on the phone said "needs the internet" in the languages the computer has no voice for (Hindi and English fell back to its own voice). Now they are saved first, as soon as a class opens online (a second or two), by the app itself into the cache, checked file by file, and played from the phone's copy; today's activity of each group is kept read aloud too; Listen no longer waits on the network when the header says Offline. End-to-end test with both servers stopped and the browser offline: every group (Letter, Word, Paragraph, Story) in Kannada, Tamil, Marathi, Bengali and Hindi is heard, the activity on screen and a new one made on the phone, with sound really playing
- [x] Z (15 Nov): pressing Listen on a new activity while its recording was still being kept for offline sent the same recording twice; the server then saved the same clips twice (500, UNIQUE constraint) and Listen stuck on "needs the internet". Now the phone sends one request per recording, the server makes a clip once and keeps it once (and a clip kept meanwhile by another server process is no error), and a failure while online offers "Try again"; 203 API tests
- [x] Z (15 Nov, after PR #2): the recorded activity lines had moved to after a class was fully saved, its groups' activities read aloud included (26 s after opening a Kannada class; about 70 s on "My classes"), so a fresh phone that went offline within that time could not hear an activity made on the phone in Kannada, Tamil, Marathi or Bengali. Now they start as soon as the class's pages are saved (the pages still come first), and on "My classes" once the first class's pages are; 216 API tests, the web race tests and the offline browser tests pass

## 2. Blocked / waiting on a person

| Item | Needed from | Why it blocks |
|---|---|---|
| Recordings of children (with written parental consent) | Z + R | Accuracy on children's voices — the claim judges care about |
| Render **Health Check Path** → `/api/ping`, only if the service was made by hand rather than from `render.yaml` ([docs/DEPLOY.md](docs/DEPLOY.md) step 6) | Z | `/api/health` reads the database, so Neon's free compute would never sleep now that the API stays up |
| Android phone test (Chrome) | Z | Microphone, layout and offline on a real budget phone |
| 3 teachers for one round of testing (Tue 28 – Wed 29) | Z + R | User-testing evidence (35% of the score) |
| Educator check of item banks + activity bank (status: draft) | R | Fidelity claims in the PPT |
| Native-speaking teachers to check the Marathi, Tamil, Kannada and Bengali cards, word lists, interface strings, advice and activity translations (beta) | Z + R | Beta languages shown to judges as reviewed, not just drafted |
| Rotate the Azure keys after the hackathon (they were pasted in chat) | Z | Hygiene |

---

## 3. Next steps

| # | Step | Owner | Target |
|---|---|---|---|
| 1 | ~~Anthropic key → live diagnoses + activities~~ done 24 Oct | — | ✓ |
| 2 | ~~Real clips → eval → tune~~ done 24 Oct (deviations confirmed) | — | ✓ |
| 3 | ~~Deploy (Vercel + Neon storage, Render)~~ done 24 Oct; still to do: UptimeRobot, then `diagnose_pending` for the demo class | Z, CC | Sun 26 |
| 3b | Decide with the mentor: move the English test to ASER's English tool (capital letters → small letters → words → sentences, meaning asked in the child's language)? Today English uses the shared ladder | Z + mentor, CC builds | Mon 27 |
| 4 | Phone test on Android: online + airplane mode | Z | Mon 27 |
| 5 | Teacher round (3 teachers, live link) → fixes → `docs/user-testing.md` | R + Z, CC fixes | Tue 28 – Wed 29 |
| 6 | Evaluation set: 30–50 consented clips (adults simulating errors; children only with parental consent) → results table | Z + R record, CC harness | by Wed 29 |
| 7 | Feature freeze; consent form, PPT outline, video script drafts | CC drafts, R/Z finalise | Wed 29 |
| 8 | 3-min video | Z | Thu 30 – Fri 31 |
| 9 | Submit; flip repo public (MIT); no commits after | Z | Sat 1 Nov afternoon |
| 10 | ~~Marathi, Tamil, Kannada, Bengali reading tests (beta)~~ done 25 Oct; next: Odia, Telugu, Malayalam (configure first) — each needs an item bank, instruction audio, word lists and an educator's review; later the teacher's screens in those languages | Z + R, CC | after approval |

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
- **25 Oct** — every child tested in English and the regional language (own level and group each); app opens in English; English activities and advice.
- **25 Oct (later)** — one language at a time from the teacher's side: names, instructions to the child, activities, errors and wording.
- **25 Oct (night)** — Marathi, Tamil, Kannada and Bengali reading tests in beta; speed floors per language; teacher-confirmed letter cards.
- **25 Oct (late night)** — teacher's screens, diagnoses and activities in Marathi, Kannada, Tamil and Bengali; the language button pairs English with the class's language.
