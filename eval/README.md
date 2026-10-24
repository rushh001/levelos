# Evaluation

How well the speech paths and the scorer agree with what was actually read.

## How it works
- `scripted.json`: each test clip has a gold transcript (`said`: exactly what the reader was asked to say, mistakes included) and the expected outcome. Gold per-word labels come from aligning `said` with the item text using the same aligner.
- `clips/` (real recordings, gitignored) and `clips_tts/` (synthetic, gitignored): audio named `<clip-name>.<ext>`. How to record: [docs/recording-script.md](../docs/recording-script.md).
- `api/scripts/run_clips.py` sends each clip through every configured speech path, scores it, and reports per-word agreement with gold for each path and for the fused result. Vendor responses are cached in `api/.cache/speech`, so re-running costs nothing. Output: `results/<dir>.json`.

```bash
cd api
.venv/Scripts/python -m scripts.run_clips clips              # real recordings, all paths (adult clips only)
.venv/Scripts/python -m scripts.run_clips clips --no-gemini  # as in live check-ins: Sarvam + Azure
.venv/Scripts/python -m scripts.run_clips --tts              # synthesise clips_tts/ from scripted.json
.venv/Scripts/python -m scripts.run_clips clips_tts          # score synthetic clips
```

## Results: real recordings (24 Oct 2026)

Nine clips recorded on an Android phone by an adult following [the recording script](../docs/recording-script.md): 5 Hindi, 4 English, 118 reference words, 114 s of audio. Gold labels are **what was actually said**, confirmed by the reader listening back ([gold/clips.json](gold/clips.json)): in five places the reading differed from the script (रानी for रीना in both Hindi paragraphs, मोरा for मेरा, no self-correction after सफाद or licks, स as printed instead of the scripted श).

| Path | Per-word agreement with what was said (read correctly or not) |
|---|---|
| Sarvam `saaras:v3` | 117 / 118 (99.2%) |
| Azure STT | 112 / 118 (94.9%) |
| Gemini `gemini-3.5-flash` (eval only, never children's audio) | 117 / 118 (99.2%) |
| **Fused, as in live check-ins (Sarvam + Azure, PA tie-break)** | **117 / 118 (99.2%)** |
| Fused with Gemini as a third opinion | 118 / 118 (100%) |

Pass/fail as expected on **9 of 9** clips in both configurations, including the halting paragraph (three mid-sentence pauses of 3.3, 2.9 and 3.4 s: fails) and the b/d reversal (two errors). The one live-configuration miss is the letter स, which Azure STT did not hear at all: the word was marked *uncertain* and the item sent for the teacher's one-tap confirmation, so it was asked about rather than silently scored.

**An unnoticed reading error was caught.** In the "clean" paragraph the reader said रानी for रीना without realising it; both reference-free recognisers reported रानी, and the scorer marked it.

**Why the text-aware path never votes on its own.** Azure Pronunciation Assessment is given the printed text. Its transcript repeats the printed words (it wrote रीना, सफेद, खाती where रानी, सफाद, खाता were said), so it can never say *what* the child read. Its per-word error flags are a useful second opinion — they caught 4 of the 5 errors in the Hindi paragraph (missing खाती→खाता, scored 78/100) and all 3 in English — which is how it is used: to break a tie between the two recognisers (right once here, on मोरा; wrong once, on स, which went to the teacher).

What this does not show: an adult voice in a quiet room, reading slowly. Children's voices and classroom noise are harder; the next set must include them (with parental consent).

### Findings from the real recordings that changed the system
- **Halting**: the old rule (more than 2 pauses over 3 s, anywhere) missed the halting reading because one deliberate pause was 2.9 s. ASER's criterion is reading "as sentences", so now only pauses *inside* a sentence count, from 2.5 s; pauses between sentences never count (slow but sentence-wise reading passes).
- **Joined/split words**: Azure wrote "everyday" for "every day"; joined or split compounds now count as read correctly.
- **Letter names**: Azure writes the letter g as "ghee"; added as an accepted form.
- **Azure STT on single letters is weak** ("का माँ रहा नौ" for क म स र ल), so letter cards get more uncertain words, which the teacher confirms with a tap. Sarvam was right on every letter.
- **Gemini auto-corrects** (heard पानी where पनी was said); it stays out of live check-ins.

## Results: synthetic clips (24 Oct 2026)

The same nine scripts read by Azure neural voices: every path agreed with gold on 118/118 words (Gemini 117/118) and all nine clips scored as expected. This tested the plumbing; it says nothing about children's speech. Findings: Sarvam's `verbatim` mode writes English sentences in Devanagari (English now uses `codemix`); Azure Pronunciation Assessment echoes the expected word even when it was misread, so it never votes on its own.

## Claude cost (measured)

| Call | Model | Tokens (avg) | Cost |
|---|---|---|---|
| Diagnosis of one check-in | `claude-opus-5-5`, effort medium | ~700 in (+ ~2,500 cached system prompt) / ~700 out | **~$0.02** |
| 10-minute activity | `claude-opus-5-5` + `claude-haiku-5-5` review | 2,500 in / 1,800 out + review | **~$0.05** |

Effort low vs medium was compared on three real check-ins: same patterns and citations; medium gave more specific advice for similar cost, so medium is used.
