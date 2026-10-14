# LevelOS

A voice-first reading-level check that shows each child's real level and tells the teacher exactly what to do next.

Built for the AI for Foundational Learning Hackathon (Challenge 02: Learning-Level Visibility) by Team rushhies.

> Status: Build Stage, in progress. See [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## What it does

1. On the teacher's phone, a child reads letters, words, a paragraph or a story aloud (ASER-style ladder, one short clip per item).
2. Two independent speech recognisers transcribe the clip without seeing the expected text; a deterministic scorer aligns both against the expected text and marks each word correct / substituted / omitted / inserted / self-corrected. Words the recognisers disagree on are flagged *uncertain* for a one-tap teacher check.
3. ASER's rules (in code, not in the LLM) decide the child's level. A level change is confirmed only after two agreeing check-ins.
4. Claude diagnoses the error pattern (letter recognition, vowel-sign/matra, conjunct, blending/scaffolding, sight word, guessing, fluency-only) with evidence, and writes a short teacher summary.
5. The dashboard regroups the class into Teaching-at-the-Right-Level cohorts and generates a 10-minute activity adapted from a curated, cited activity bank (Pratham TaRL, NIPUN Bharat, CBSE–CSF compendiums).
6. Offline: recording and teacher tap-to-mark scoring work without network; clips queue and sync when connectivity returns.

## Repo layout

```
web/       React + Vite PWA (teacher phone app)
api/       FastAPI backend (speech paths, scorer, ASER rules, Claude)
content/   item banks per language, activity bank, instruction audio, language config
eval/      labelled clips + harness + results
docs/      build plan, research, architecture, user testing log
```

## Run locally

Prerequisites: Node 20+, Python 3.12+, ffmpeg on PATH.

```bash
# API
cd api
python -m venv .venv && .venv/Scripts/activate   # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                               # fill in keys
uvicorn app.main:app --reload --port 8000

# Web
cd web
npm install
npm run dev                                        # http://localhost:5173, proxies /api → :8000
```

## AI services used

| Service | Purpose | Key |
|---|---|---|
| Anthropic Claude (`claude-opus-5-5`, `claude-haiku-5-5`) | Error-pattern diagnosis, activity adaptation, activity validation | `ANTHROPIC_API_KEY` |
| Sarvam AI `saaras` | Speech path A (reference-free transcription, Indian languages) | `SARVAM_API_KEY` |
| Azure Speech | Speech path B (reference-free STT) and Pronunciation Assessment for hi/en/ta | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Google Gemini (optional) | Speech path C (audio-native verbatim transcription) | `GEMINI_API_KEY` |

The level decision, alignment and scoring are deterministic code (`api/app/levels`, `api/app/speech/align.py`); no LLM is involved in them.

## Licence

MIT — see [LICENSE](LICENSE).
