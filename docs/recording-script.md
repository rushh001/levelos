# Recording script for test clips

Nine short clips, about 3 minutes of audio in total. Any adult can record them; deliberate mistakes are the point. Real children only with a parent's written consent.

## How to record
- Android phone, quiet room, phone 20–30 cm from the mouth. Any recorder app works (Voice Recorder, or a WhatsApp voice note to yourself); m4a, ogg, webm or wav are all fine.
- Start recording, wait one second, read, wait one second, stop. Say nothing else ("okay, starting…").
- Read at a child's pace: slow and clear, not rushed.
- Name each file exactly as below and put it in `eval/clips/` (gitignored, never committed), e.g. `eval/clips/hi-para-a__mistakes.m4a`.

## Clips
Read **exactly** what is in the "Say" column, including the mistakes.

| File name | Say | What it tests |
|---|---|---|
| `hi-para-a__clean` | मेरा नाम रीना है। मेरे पास एक गाय है। गाय का रंग सफेद है। वह रोज घास खाती है। | Clean Hindi paragraph |
| `hi-para-a__mistakes` | मेरा **मेरा** नाम रीना है। मेरे पास गाय है। गाय का रंग **सफाद** सफेद है। वह रोज घास **खाता** है। | Repeat, skipped एक, self-correction, matra error |
| `hi-para-b__halting` | आज बहुत बारिश हुई। सड़क पर *(4 s pause)* पानी भर गया। मोहन ने *(4 s pause)* कागज की नाव बनाई। नाव पानी में *(4 s pause)* तैरने लगी। | Every word right but halting → must fail |
| `hi-word-a__mistakes` | गाय … **पनी** … मोर … **केल** … दिन | Dropped matras (3 of 5) |
| `hi-letter-a__mistakes` | क … म … **श** … र … ल | One wrong letter (4 of 5) |
| `en-para-a__clean` | I have a red ball. I play with it every day. My dog likes my ball. He runs after it. | Clean English paragraph |
| `en-para-a__mistakes` | I have a red **bell**. I play with it day. My dog **licks** likes my ball. He runs after it. | Substitution, skipped "every", self-correction |
| `en-letter-b__mistakes` | **bee** … **dee** … en … ee … gee | Letter names, b/d swapped (3 of 5) |
| `en-word-a__mistakes` | cat … **sin** … **pin** … bus … hat | Vowel errors (3 of 5) |

"…" means a short natural gap (about 1 second) between letters or words.

## If a child is available (with consent)
Also record `hi-para-a__child1` and `hi-word-a__child1`: the child reads the paragraph and the five words from [content/items/hi.json](../content/items/hi.json) naturally. Note anything they got wrong in a text file with the same name (`hi-para-a__child1.txt`).

## Cost
About 3 minutes of audio: roughly ₹2 of Sarvam credit and 6 of Azure F0's 300 free minutes per run. Responses are cached, so re-running costs nothing.
