# Vosk on the phone: does it hear reading mistakes? (test, not in the app)

Could a small speech model that runs on the phone (Vosk, no network) pre-mark cards when there is no network? Tested on
English and Hindi with the app's own aligner, the way Sarvam and Azure are judged in [../README.md](../README.md).

```bash
# from the repository root
(cd api && .venv/bin/python ../eval/vosk/make_clips.py)      # 1. clips (Azure voice, ~3,000 TTS characters)
eval/vosk/.venv/bin/python eval/vosk/transcribe.py           # 2. what Vosk hears (setup: python3 -m venv eval/vosk/.venv; eval/vosk/.venv/bin/pip install vosk numpy; models below)
(cd api && .venv/bin/python ../eval/vosk/score.py --online)  # 3. scores; --online also runs the app's online AI
```

Models (in `models/`, git-ignored): `vosk-model-small-en-in-0.4` (36 MB download), `vosk-model-small-en-us-0.15`
(40 MB), `vosk-model-small-hi-0.22` (42 MB), from alphacephei.com/vosk/models.

## The test (15 Nov 2026)

41 clips, 400 words, 66 of them read wrongly: the 9 scripts of `eval/scripted.json` and 32 cards from the app's banks
with mistakes planted (a letter or word swapped for another of the bank, a word of a passage left out). Each read four
ways: the app's Azure voice (clean), the same voice higher and slower (child-like), and both with a classroom behind
them (three other readings at once and a hiss, 10 dB below). Two modes: **free** (its whole vocabulary) and
**restricted** (only the card's words, plus "unknown"), as an app would use it. Full tables: [results.md](results.md).

| English, restricted (en-us small) | Words right | Mistakes caught | False alarms | Card pass/fail right |
|---|---|---|---|---|
| clean | 96.4% | 28/32 (88%) | 1.9% | 19/20 |
| child-like | 95.4% | 28/32 (88%) | 3.1% | 17/20 |
| clean + classroom | 90.2% | 24/32 (75%) | 6.8% | 13/20 |
| child-like + classroom | 79.9% | 21/32 (66%) | 17.3% | 10/20 |
| *online AI, clean / child-like + classroom* | *100% / 88.1%* | *100% / 88%* | *0% / 11.7%* | *20/20 / 15/20* |

| Hindi, restricted (hi small) | Words right | Mistakes caught | False alarms | Card pass/fail right |
|---|---|---|---|---|
| clean | 93.2% | 30/34 (88%) | 5.8% | 19/21 |
| child-like | 85.4% | 30/34 (88%) | 15.1% | 14/21 |
| clean + classroom | 85.0% | 28/34 (82%) | 14.5% | 13/21 |
| child-like + classroom | 63.1% | 31/34 (91%) | 42.4% | 7/21 |
| *online AI, clean / child-like + classroom* | *99.0% / 87.4%* | *100% / 100%* | *1.2% / 15.1%* | *21/21 / 15/21* |

## What it shows

- **Restricted mode hides exactly the mistakes that matter.** The missed mistakes on the clean voice: sin → "sun",
  pin → "pen", jar → "jug", पनी → "पानी", केल → "केला". Told the card's words, the model snaps a near miss onto the
  printed word, and vowel mistakes (cat/cut, pin/pen) are the commonest the app tracks. About 1 mistake in 8 would be
  pre-ticked as read right in a quiet room, 1 in 3 with a classroom behind (English).
- **Free mode catches nearly every mistake but cries wolf**: 9–17% of correctly read words marked wrong on a clean
  voice, 25–35% child-like, over 40% with noise. A teacher would have to re-check everything.
- **Passages are its best case** (English 99% of words, every mistake caught; Hindi 98.5%, 12 of 13), **Hindi letters
  its worst** (36–40% false alarms even clean).
- **Noise and a child-like voice hurt it far more than the online AI**: with both, English drops to 80% of words right
  against 88% for Sarvam + Azure; Hindi to 63% against 87%.
- Speed is no problem: restricted mode ran at 0.004× real time on this Mac (a phone in a browser is perhaps 10–30×
  slower, still far faster than the child reads). Size is: 54–78 MB on disk per language.

## Verdict

Not good enough to pre-mark cards. Its likeliest error, a mistake pre-ticked as right, is the one a reading check
exists to catch, and teachers would learn to trust the ticks. At most it could be tried on passages only, as a hint the
teacher confirms, and only after a test on real children's recordings in a classroom (with consent): synthetic adult
voices flatter every model (the online AI scored 100% on them), so these numbers are a ceiling, not a forecast. The
sample is small (66 mistakes), so each percentage is uncertain by several points.
