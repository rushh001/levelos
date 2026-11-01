# 📖 LevelOS

> **A 3-minute, voice-first reading check on the teacher's phone.**
> Finds each child's reading level the ASER way 🪜, shows *why* they struggle 🧠, groups the class 👥, and gives each group a 10-minute activity 📚. **Works offline** 📴.

🏆 AI for Foundational Learning Hackathon · Challenge 02: Learning-Level Visibility · Team **rushhies**

| | |
|---|---|
| 🌐 **Live app** | **[levelos-nine.vercel.app](https://levelos-nine.vercel.app)** |
| 🩺 API status | [levelos-api.onrender.com/api/health](https://levelos-api.onrender.com/api/health) |
| 📘 Full details | [document.md](document.md) — every stage, rule and number |

---

## 🔑 Test logins

👩‍🏫 **Teacher** is the only role; children never log in.

| Login ID | PIN | Note |
|---|---|---|
| `demo` | `1234` | or just tap **Try the demo class** |
| `judge` | `2026` | same demo class, its own copy |
| ➕ new | your own | **Create account** (name, email, PIN) → you get a 6-digit login ID |

🏫 Demo class: Grade 2, 16 fictional children, two weeks of history in English and Hindi. The shared demo class can't be deleted.

## ▶️ Try these

1. 🎙️ **Reading check:** open **Farhan** (*Not checked yet*) → **Start reading check** → read the card aloud → see the level and what he struggles with.
2. 📚 **Activity:** on the class page, tap **▶ 10-minute activity** on a group → a plan built on a real poem or story, at that group's level → **Another activity**.
3. 🌏 **Language:** switch **Reading test** between English and Hindi (Marathi, Tamil, Kannada, Bengali in beta) → the whole app follows.
4. 📴 **Offline:** open the class once → ✈️ airplane mode → reload → run a check by tapping mistakes, add a child, get an activity → ⏳ counts what's waiting → network on → it all syncs.
5. 🖐️ **Show the class:** on an activity, tap **Show the class** → full-screen letter chart (try **Sing**), word ↔ picture match, rhymes.

---

## ✨ What it does

| | |
|---|---|
| 🪜 **Adaptive ASER check** | letters → words → paragraph → story; up on a pass, down on a fail · ⏭️ **Skip** a card and it never counts |
| 🙈 **Fair scoring** | 2 speech recognisers transcribe **without seeing the text**, so they can't "auto-correct" the child; code marks each word ✅ right · ❌ wrong · ⏭️ skipped · 🔁 self-corrected |
| 👂 **Honest uncertainty** | recognisers disagree → the teacher listens 🔊 and confirms |
| 📐 **Rules decide the level** | ASER rules in code, not AI · 2 agreeing checks confirm · teacher can override |
| 🧠 **Diagnosis** | Claude names the error pattern (matras, conjuncts, blending, guessing…) with the exact words as evidence |
| 👥 **4 groups** | Letter · Word · Paragraph · Story, with each group's main difficulty |
| 📚 **10-minute activity** | built on a free, credited poem or story, matched to the level · 📝 homework for Paragraph and Story |
| 🌏 **2 tests per child** | English + regional language, each with its own level and group |
| 🧒 **Child-friendly** | 🦜 parrot mascot, ladder on screen, ⭐ "शाबाश!" after every card, picture meaning check |
| 🔁 **Replay** | every card's recording for 30 days, words highlighted as read |
| 🗂️ **Classes** | create · add children · move groups · 🗑️ delete a class |

**How a check flows**

```
🎙️ record a card → 🔇 quality gate (silent / too short / wrong card → record again)
→ 🗣️ Sarvam + Azure, blind to the text → 🔤 align word by word → 👂 teacher confirms unsure words
→ 🪜 ASER rules → 📊 level → 🧠 diagnosis (rules at once, Claude in the background) → 📚 activity
```

🏗️ 📱 React PWA (Vercel) → ⚙️ FastAPI in Docker (Render) → 🐘 Postgres (Neon)

---

## 🤖 AI services and keys

🔐 **Where keys are needed:** only on the API server: in `api/.env.local` locally (copy [`api/.env.example`](api/.env.example)), or in Render → **Environment** when hosted. 📱 The web app and the phones hold no keys.

| Service | What it does | Key |
|---|---|---|
| 🧠 **Claude Opus 5.5** `claude-opus-5-5` | diagnosis (~$0.02 a check) · adapts activities (~$0.05 each) | `ANTHROPIC_API_KEY` |
| 🔍 **Claude Haiku 5.5** `claude-haiku-5-5` | reviews every activity (faithful, safe, fits the level) | `ANTHROPIC_API_KEY` |
| 🗣️ **Sarvam** `saaras:v3` | speech → text, path A | `SARVAM_API_KEY` |
| 🗣️ **Azure Speech** | speech → text, path B · pronunciation tie-break · spoken instructions (TTS) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| 🧪 **Gemini** `gemini-3.5-flash` | evaluation script only; **never hears children** | `GEMINI_API_KEY` (optional) |
| 💻 **LM Studio** (optional, local) | offline activity wording on a laptop | none · `VITE_LMSTUDIO_URL` in [`web/.env.example`](web/.env.example) |

💡 **No AI decides a level.** With no Claude key, or once the budget is used, the app falls back to rule-based diagnoses and bank activities and keeps working.

🔎 **Where the calls are in the code:**
- Claude: [`api/app/llm/diagnose.py`](api/app/llm/diagnose.py), [`api/app/llm/activities.py`](api/app/llm/activities.py), spend caps in [`api/app/llm/budget.py`](api/app/llm/budget.py)
- Speech: [`api/app/speech/`](api/app/speech/) (`sarvam.py`, `azure.py`, `gemini.py`)
- LM Studio: [`web/src/lib/lmstudio.ts`](web/src/lib/lmstudio.ts)

## 🛡️ Guardrails

- 🙈 The recognisers that vote never see the text; the one that does only breaks ties.
- 👂 Unsure words go to the teacher whenever they could change the result.
- ✅ 2 agreeing checks confirm a level; overrides are logged.
- 📐 Claude works from a fixed pattern list and a JSON schema, and its evidence is checked. An activity must adapt a cited bank entry and pass the Haiku review.
- 🔇 Bad audio is never scored ("please record again").
- 💰 Spend caps: $400 total, $25 a day.
- 🔒 Children: first name + emoji only · recordings deleted after 30 days · never sent to Gemini.

➡️ [document.md §8](document.md#8-guardrails)

---

## 📴 Offline

| ✅ Works offline | 🌐 Needs the network |
|---|---|
| 📱 Open the app, classes, children, groups | 🔑 Sign-up and login |
| 🪜 Reading check (teacher taps the mistakes) + provisional level | 🗣️ AI scoring of recordings (sent when back online) |
| 📚 10-minute activity, made on the phone from the book bank | 🧠 Claude diagnosis (when back online) |
| 🗂️ New class · new child · group change · rating · delete a class | |
| 🔊 Cards, pictures, spoken instructions | |

**⚙️ How it works**

- 📦 **PWA:** the app, cards, pictures and audio are stored on the phone.
- 💾 **Data:** every page opened is kept in the phone's database (IndexedDB).
- 🪜 **Same rules:** the ASER ladder runs on the phone too (a test keeps it in step with the server).
- 📤 **Outbox:** changes wait on the phone (⏳ badge). A class or child made offline gets a temporary ID and is created only once.
- 🔄 **Back online:** changes are sent first, then the checks. Recordings get AI-scored, and any word where the AI ≠ the teacher comes back to confirm. A level never changes silently.

**💻 LM Studio: offline AI on a laptop (optional)**

1. Install [LM Studio](https://lmstudio.ai) → download a small instruct model (e.g. Qwen2.5 3B or 7B Instruct) → load it.
2. **Developer** tab → start the server (port 1234) → turn on **Enable CORS**.
3. Open the app in Chrome on that laptop (allow access to apps on this device if Chrome asks). Offline activities now say **"Generated offline using LM Studio"**.

✔️ The plan is checked by the same rules (3–4 steps, ~10 minutes, the teacher's language); otherwise the phone-made activity is used. ⏱️ Expect 30–90 s per activity without a GPU. A phone always gets the phone-made activity.

---

## 🎯 Results

| Scripted test set: 9 recordings, 118 words, Hindi + English | |
|---|---|
| ✅ Words agreed | **117 / 118 (99.2%)** |
| ✅ Card pass / fail correct | **9 / 9** |

- 👧 Also tried with children in a school.
- 🧪 179 automated API tests, plus browser runs: online check, activity, offline round trip, replay.
- ➡️ [eval/README.md](eval/README.md)

---

## 🛠️ Run locally

Needs 🐍 Python 3.12 · 🟢 Node 20+ (ffmpeg optional; a copy is bundled)

| 📄 Sample env file | Copy to | What goes in it |
|---|---|---|
| [`api/.env.example`](api/.env.example) | `api/.env.local` | 🔑 AI keys + settings (database, login secret, spend caps) |
| [`web/.env.example`](web/.env.example) | `web/.env` (optional) | 🌐 `VITE_API_BASE` for a deployed API · 💻 `VITE_LMSTUDIO_URL` for LM Studio |

```bash
# ⚙️ API
cd api
python -m venv .venv
.venv/Scripts/activate              # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env.local          # add your keys
python -m scripts.seed_demo         # demo logins + class
uvicorn app.main:app --reload --port 8000

# 📱 Web (second terminal)
cd web
npm install
npm run dev                         # http://localhost:5173 (proxies /api to :8000)
npm run dev:https                   # HTTPS, to test the microphone from a phone on the same Wi-Fi
```

- 🐳 **As deployed:** `docker build -f api/Dockerfile -t levelos-api .` from the repo root, then run it with `APP_ENV=prod`, `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGINS` and the keys (all settings: [document.md §15](document.md#15-configuration)).
- 🧪 **Tests:** `cd api && .venv/Scripts/python -m pytest` (no network or keys needed).

## 🚀 Deploy

- 📋 [docs/DEPLOY.md](docs/DEPLOY.md): about 45 minutes, all free plans: 🐘 Neon (via Vercel Storage) · ⚙️ Render (`render.yaml`) · 📱 Vercel (`web/`).
- ⏰ **Always awake:**
  - the API pings itself every 10 minutes;
  - a [GitHub Actions schedule](.github/workflows/keep-awake.yml) wakes it every 30 minutes;
  - the app wakes it as it opens;
  - `/api/ping` skips the database, so Neon can still sleep.

## 📚 Content and sources

- 📝 **Reading cards:** original texts written to the ASER 2024 spec (test-enforced).
- 📖 **28 free, credited texts:** public domain in India, CC0 or CC BY-SA. Authors include Premchand, Subhadra Kumari Chauhan, Bharathiyar, Sukumar Ray and Aesop.
- 🎯 **Goals:** NCERT NCF-FS (foundational stage). 🚫 No textbook text is copied (copyright).
- 🧩 **Methods:** Pratham / TaRL Africa (2021) · StoryWeaver · ASER 2024.
- 🔤 **Error types:** Raman & Rao (Interspeech 2025).
- ➡️ [document.md §11](document.md#11-content-item-banks-activities-languages)

## 🔒 Secrets and privacy

- 🚫 **No keys in the repo:** every `.env*` file is gitignored except the `.env.example` templates, and a test fails if a key or secret in them gets a value.
- 🧒 **No real children's data:** the demo children are fictional; recordings (`recordings/`, `eval/clips/`) and databases are never committed.
- 🧊 **Frozen at submission:** no commits after 1 Nov 2026, 23:59 IST; the evaluated version is the last commit before then.

## 🗂️ Repository

```
web/       📱 React PWA (teacher's phone)
api/       ⚙️ FastAPI: speech, scorer, ASER rules, Claude, spend caps, tests
content/   📚 item banks, activity bank, texts, language config
eval/      🎯 scripted test clips, gold transcripts, results
docs/      📋 deploy guide, recording script, build plan, research
.github/   ⏰ keep-awake schedule
```

## 📄 Licence

MIT ([LICENSE](LICENSE)) · 🖼️ [OpenMoji](https://openmoji.org) pictures (CC BY-SA 4.0) · 🔤 Baloo font (OFL) · 🎵 "Twinkle, Twinkle" tune (public domain)
