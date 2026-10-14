# Research brief 3: Speech recognition for children's oral reading (Hindi/English) and a 16-day architecture

Researched 15 Oct 2026 via web (AI-assisted). Prices and model names drift; re-check before committing.

**Three points that shape the design**
- **Claude cannot take audio** (docs: "All current models support text and image input, text output" — https://platform.claude.com/docs/en/about-claude/models/overview). Pipeline: audio → ASR/alignment → structured miscue JSON → Claude.
- **No vendor tunes for Indian children's read speech.** Credible approach: two paths compared deterministically — an unbiased "what was actually said" decode, and a reference-aware alignment/score. Claude only interprets structured differences.
- **Offline = record and queue + provisional scoring.** Don't promise full on-device scoring.

## 1. Cloud ASR

| Service | Hindi / en-IN / code-mix | Word timing / confidence | Price |
|---|---|---|---|
| **Azure Pronunciation Assessment** | **hi-IN, en-IN, ta-IN** (33 locales) | Per-word offset/duration, accuracy score, ErrorType | ≈ STT price ~$1/audio-hr (official page didn't render; from MS Q&A/third parties). F0: 5 audio-hrs/month free |
| Sarvam `saaras:v4` (v3 available; `saarika:v2.5` being deprecated) | 23 languages; modes transcribe / verbatim / codemix / translit / translate | **No word timestamps** (chunk-level), no word confidence | ₹30/hr (~$0.35); ₹100 free credit per docs (third party says ₹1,000) |
| AI4Bharat IndicConformer | 22 languages | CTC posteriors (self-hosted) | Free, MIT |
| Google Chirp 3 | hi-IN, en-IN GA; one dominant language | Word timestamps optional "with some degradation"; confidence not a true confidence | ~$0.016/min; $0.003/min dynamic batch |
| OpenAI | Hindi OK | Word timestamps only on whisper-1 ($0.006/min) | gpt-transcribe ~$0.0045/min (aggregators); 4o-mini-transcribe $0.003/min |
| ElevenLabs Scribe v2 | Hindi among 90+ | Word timestamps | $0.22/hr batch, $0.39/hr realtime |
| Deepgram Nova-3 Multilingual | Hindi + code-switching (10 languages) | Word timestamps + confidence | $0.0052/min; $200 free credit |

**Azure Pronunciation Assessment** (https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- Closest ready-made fit for miscue detection: scripted mode with `ReferenceText` + `EnableMiscue=true` → per-word `Omission` / `Insertion` / `Mispronunciation` (accuracy < 60), plus accuracy, fluency, completeness.
- `EnableMiscue` only for audio ≤ 30 s; continuous mode doesn't support it (compute omissions yourself).
- Prosody, syllable scores and phoneme *names* en-US only; hi-IN gets phoneme scores without labels. No mixed-language audio.
- Scores against native speakers; MS suggests looser thresholds for children (https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/pronunciation-assessment/characteristics-and-limitations-pronunciation-assessment).
- Locales: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment

**Sarvam** (https://docs.sarvam.ai/api-reference-docs/models/saaras; pricing https://docs.sarvam.ai/api-reference-docs/pricing): REST ≤ 30 s/request; batch ≤ 2 h. Verbatim mode keeps fillers; unclear whether it preserves mispronunciations.

**AI4Bharat IndicConformer**: `ai4bharat/indic-conformer-600m-multilingual` (600M, hybrid CTC+RNNT, gated, Hindi WER 13.2 on Vaani, ~2.4 GB fp32 — https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual). Hindi-only large ~120M (`indicconformer_stt_hi_hybrid_ctc_rnnt_large`, gated); community int8 ONNX at https://huggingface.co/OpenVoiceOS/ai4bharat-indicconformer-hi-onnx — runs on CPU. **CTC head enables forced alignment and GOP.** Card points to newer "Indic-Transcribe" (25+ languages, ~1.2B, Aug 2026) — provenance unverified.

**IndicWhisper / Vistaar** (https://github.com/AI4Bharat/vistaar): Hindi WER 10.3% on Kathbath (2023).

**Bhashini** (https://bhashini.gitbook.io/bhashini-apis): ULCA models (mostly AI4Bharat); pipeline search → config → compute with userID + ULCA key. Free for PoC; production needs contact. Signup URL/turnaround unverified — **apply early**.

**Child speech:** no vendor claims child tuning; all benchmarks are adult. In a Bambara reading study children under 10 accounted for most residual errors (https://arxiv.org/abs/2606.31508).

## 2. The auto-correction problem

- **Compare decodes under different constraints.** IIT Bombay two-pass miscue detector (Gothi et al., Interspeech 2024, https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html). Dutch study: forced-decoding confidence best predicted correct reading (r = .45); expected miscues in the LM helped (https://arxiv.org/abs/2306.03444).
- **CTC forced alignment + GOP.** Align reference to CTC posteriors; score each word against a free no-LM greedy decode. Segmentation-free GOP (https://arxiv.org/abs/2507.16838); Parikh et al., Interspeech 2025 (https://arxiv.org/abs/2506.02080). `torchaudio.functional.forced_align` removed in torchaudio 2.9 — pin 2.8 or write a small Viterbi aligner.
- **Verbatim prompting** needs fine-tuning (Smith et al., Interspeech 2025, https://arxiv.org/abs/2505.23627) — too much for 16 days. With off-the-shelf APIs, **never pass the passage as prompt/keyterms on the "what was said" pass.**
- **Error taxonomy for Claude's prompt:** Raman & Rao, Interspeech 2025 (https://www.isca-archive.org/interspeech_2025/raman25_interspeech.html).
- **Devanagari helps**: near-phonemic, so akshara-level diff approximates phoneme analysis; a matra error = same consonant, different vowel sign.
- Precedents judges know: IIT Bombay TARA; Wadhwani Vachan Samiksha (no public technical paper); NeurIPS 2026 multidimensional ORF paper.

## 3. Offline / on-device

- **vosk-browser**: `vosk-model-small-hi-0.22` is 42 MB (adult WER ~21–25%); `small-en-in` 36 MB (WER 49%) (https://alphacephei.com/vosk/models). `new model.KaldiRecognizer(sampleRate, grammar?)` — grammar format undocumented (Vosk convention: JSON array of phrases + "[unk]"); test it. Original repo 404; `@lichess-org/vosk-browser` fork reported maintained. Grammar constraint = strongest LM bias → use only for closed-set tasks (letter/word grids) and provisional timing.
- **sherpa-onnx**: WASM build, no official Hindi model; community IndicConformer conversions. Feasible native Android; risky in browser in 16 days.
- **whisper.cpp / transformers.js**: tiny 75 MiB (~273 MB RAM), base 142 MiB, small 466 MiB; Hindi quality from tiny/base poor and LM bias is the problem. Not recommended.
- **Moonshine**: English-only. **Chrome Web Speech / Android SpeechRecognizer**: LM-corrected, no word timing — unusable for scoring.
- **Recommendation**: MediaRecorder (Opus, ~150 KB/min) → IndexedDB queue → upload on reconnect (Background Sync + retry on open). Offline provisional results: teacher tap-to-mark (classic manual ORF) + vosk for letter/word grids. Server scoring is authoritative.

## 4. Indic TTS for instructions

- **Pre-generate every fixed prompt as static audio and precache in the PWA** (offline, consistent voice). Sources: Sarvam Bulbul `bulbul:v4-flash` (11 languages + En-Hi code-mix voice; ₹30/10K chars — https://docs.sarvam.ai/api-reference-docs/getting-started/models/bulbul); Indic-Parler-TTS (0.9B, Apache-2.0, 21 languages, 69 voices, gated — https://huggingface.co/ai4bharat/indic-parler-tts); Bhashini TTS (free PoC).
- Web Speech SpeechSynthesis depends on phone's system TTS; hi-IN common but not guaranteed on budget phones; voices load async (`onvoiceschanged`); `localService` indicates offline. Fallback only, for dynamic text like a child's name.

## 5. Datasets and Claude

- Adult: Kathbath (1,684 h, 12 languages, gated, CC-BY-4.0 — https://huggingface.co/datasets/ai4bharat/Kathbath); IndicVoices (https://arxiv.org/abs/2403.01926); SPRING-INX (https://asr.iitm.ac.in/dataset).
- Children: ASER dataset (5,301 children, 81,330 clips, Hi/Mr/En; release unclear — https://arxiv.org/abs/1912.04381); HiACC (Hinglish adult+child, 1,858 child segments; licence unverified — https://www.sciencedirect.com/science/article/pii/S2352340925006109); IIT Bombay 1,110-child English set (availability unclear). Worth contacting Preeti Rao's group or Wadhwani AI.
- **Build your own test set**: 30–50 consented clips, incl. adults making deliberate matra swaps, skips and guesses; hand-label; report word-level agreement.
- **Claude pricing** (https://platform.claude.com/docs/en/about-claude/pricing): Haiku 5.5 $0.10/$0.50; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20 per MTok. Batch 50% off; cache reads 5–10% of input. ~3K in + 600 out ≈ $0.012 on Sonnet 5.5, ~$0.0006 on Haiku 5.5. **$500 ≈ 40,000 Sonnet assessments.** Cache the rubric; use low effort.

## 6. Recommended 16-day architecture

**Client (PWA, Workbox)**: ASER-level tasks (letters → words → paragraph → story); instruction audio precached; one clip per item ≤ 30 s (fits Azure miscue limit, simplifies alignment); IndexedDB queue; provisional offline scoring.

**Server (FastAPI on a free CPU host)**
1. Resample 16 kHz + VAD.
2. **Path A (free, Hindi)**: IndicConformer-hi CTC — greedy decode + forced alignment of reference → per-word heard text, timing, GOP.
3. **Path B (cheap; strongest for English)**: Azure Pronunciation Assessment scripted mode (hi-IN / en-IN) with `EnableMiscue`. Sarvam verbatim as Hindi tie-breaker.
4. **Deterministic scorer**: word + akshara alignment; labels correct / substitution / omission / insertion / repetition / self-correction; long pauses → hesitation; WCPM. Where A and B disagree → **"uncertain"**.
5. **Claude (structured outputs)**: receives only JSON; classifies letter recognition / matra / blending (fragments + pause timing) / sight word / guessing (real-word substitution sharing first akshara); cites evidence; writes teacher summary in Hindi/English.
6. **Teacher review**: uncertain words highlighted, one-tap override; overrides saved as labels → dataset grows.

**Degradation story**: no network → instructions, recording, manual/provisional scoring work, sync later; flaky 2G → ~150 KB/min upload with retries; online → full scoring + Claude; paid APIs down → Path A alone.

**Schedule**: days 1–3 recorder, queue, test set; 4–8 Paths A/B + scorer; 9–11 Claude classifier + teacher UI; 12–14 evaluation + threshold tuning; 15–16 demo.

**Unverified / possibly outdated**: Azure and Google prices; Sarvam free credit; OpenAI gpt-transcribe price; Indic-Transcribe provenance; Bhashini signup; vosk-browser grammar format; Chrome Android on-device recognition and hi-IN TTS; children's dataset licences; HF Spaces free CPU specs.
