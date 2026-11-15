# Vosk small models: results

## English

| Model | Mode | Voice | Agree | Errors caught | False alarms | Card pass/fail right | Speed |
|---|---|---|---|---|---|---|---|
| small-en-in-0.4 | free | clean | 178/194 (91.8%) | 31/32 (96.9%) | 15/162 (9.3%) | 16/20 | 0.034 |
| small-en-in-0.4 | grammar | clean | 187/194 (96.4%) | 27/32 (84.4%) | 2/162 (1.2%) | 18/20 | 0.004 |
| small-en-in-0.4 | free | child | 153/194 (78.9%) | 32/32 (100.0%) | 41/162 (25.3%) | 10/20 | 0.032 |
| small-en-in-0.4 | grammar | child | 180/194 (92.8%) | 26/32 (81.2%) | 8/162 (4.9%) | 16/20 | 0.004 |
| small-en-in-0.4 | free | clean_noisy | 122/194 (62.9%) | 28/32 (87.5%) | 68/162 (42.0%) | 6/20 | 0.062 |
| small-en-in-0.4 | grammar | clean_noisy | 158/194 (81.4%) | 28/32 (87.5%) | 32/162 (19.8%) | 8/20 | 0.004 |
| small-en-in-0.4 | free | child_noisy | 85/194 (43.8%) | 29/32 (90.6%) | 106/162 (65.4%) | 6/20 | 0.053 |
| small-en-in-0.4 | grammar | child_noisy | 132/194 (68.0%) | 27/32 (84.4%) | 57/162 (35.2%) | 8/20 | 0.004 |
| small-en-us-0.15 | free | clean | 167/194 (86.1%) | 32/32 (100.0%) | 27/162 (16.7%) | 9/20 | 0.046 |
| small-en-us-0.15 | grammar | clean | 187/194 (96.4%) | 28/32 (87.5%) | 3/162 (1.9%) | 19/20 | 0.004 |
| small-en-us-0.15 | free | child | 153/194 (78.9%) | 31/32 (96.9%) | 40/162 (24.7%) | 8/20 | 0.044 |
| small-en-us-0.15 | grammar | child | 185/194 (95.4%) | 28/32 (87.5%) | 5/162 (3.1%) | 17/20 | 0.004 |
| small-en-us-0.15 | free | clean_noisy | 115/194 (59.3%) | 28/32 (87.5%) | 75/162 (46.3%) | 6/20 | 0.082 |
| small-en-us-0.15 | grammar | clean_noisy | 175/194 (90.2%) | 24/32 (75.0%) | 11/162 (6.8%) | 13/20 | 0.004 |
| small-en-us-0.15 | free | child_noisy | 96/194 (49.5%) | 26/32 (81.2%) | 92/162 (56.8%) | 6/20 | 0.079 |
| small-en-us-0.15 | grammar | child_noisy | 155/194 (79.9%) | 21/32 (65.6%) | 28/162 (17.3%) | 10/20 | 0.004 |
| online AI (Sarvam + Azure) | live | clean | 194/194 (100.0%) | 32/32 (100.0%) | 0/162 (0.0%) | 20/20 | — |
| online AI (Sarvam + Azure) | live | child_noisy | 171/194 (88.1%) | 28/32 (87.5%) | 19/162 (11.7%) | 15/20 | — |

By card type (clean voice):

| Model | Mode | Card | Agree | Errors caught | False alarms |
|---|---|---|---|---|---|
| small-en-in-0.4 | free | paragraph | 98.4% | 14/14 (100.0%) | 2/110 (1.8%) |
| small-en-in-0.4 | grammar | paragraph | 98.4% | 14/14 (100.0%) | 2/110 (1.8%) |
| small-en-in-0.4 | free | letter | 85.7% | 8/9 (88.9%) | 4/26 (15.4%) |
| small-en-in-0.4 | grammar | letter | 97.1% | 8/9 (88.9%) | 0/26 (0.0%) |
| small-en-in-0.4 | free | word | 74.3% | 9/9 (100.0%) | 9/26 (34.6%) |
| small-en-in-0.4 | grammar | word | 88.6% | 5/9 (55.6%) | 0/26 (0.0%) |
| small-en-us-0.15 | free | paragraph | 96.8% | 14/14 (100.0%) | 4/110 (3.6%) |
| small-en-us-0.15 | grammar | paragraph | 99.2% | 14/14 (100.0%) | 1/110 (0.9%) |
| small-en-us-0.15 | free | letter | 62.9% | 9/9 (100.0%) | 13/26 (50.0%) |
| small-en-us-0.15 | grammar | letter | 91.4% | 8/9 (88.9%) | 2/26 (7.7%) |
| small-en-us-0.15 | free | word | 71.4% | 9/9 (100.0%) | 10/26 (38.5%) |
| small-en-us-0.15 | grammar | word | 91.4% | 6/9 (66.7%) | 0/26 (0.0%) |
| online AI (Sarvam + Azure) | live | paragraph | 100.0% | 14/14 (100.0%) | 0/110 (0.0%) |
| online AI (Sarvam + Azure) | live | letter | 100.0% | 9/9 (100.0%) | 0/26 (0.0%) |
| online AI (Sarvam + Azure) | live | word | 100.0% | 9/9 (100.0%) | 0/26 (0.0%) |

## Hindi

| Model | Mode | Voice | Agree | Errors caught | False alarms | Card pass/fail right | Speed |
|---|---|---|---|---|---|---|---|
| small-hi-0.22 | free | clean | 191/206 (92.7%) | 34/34 (100.0%) | 15/172 (8.7%) | 18/21 | 0.042 |
| small-hi-0.22 | grammar | clean | 192/206 (93.2%) | 30/34 (88.2%) | 10/172 (5.8%) | 19/21 | 0.004 |
| small-hi-0.22 | free | child | 145/206 (70.4%) | 34/34 (100.0%) | 61/172 (35.5%) | 8/21 | 0.059 |
| small-hi-0.22 | grammar | child | 176/206 (85.4%) | 30/34 (88.2%) | 26/172 (15.1%) | 14/21 | 0.004 |
| small-hi-0.22 | free | clean_noisy | 143/206 (69.4%) | 32/34 (94.1%) | 61/172 (35.5%) | 10/21 | 0.147 |
| small-hi-0.22 | grammar | clean_noisy | 175/206 (85.0%) | 28/34 (82.4%) | 25/172 (14.5%) | 13/21 | 0.005 |
| small-hi-0.22 | free | child_noisy | 87/206 (42.2%) | 32/34 (94.1%) | 117/172 (68.0%) | 8/21 | 0.145 |
| small-hi-0.22 | grammar | child_noisy | 130/206 (63.1%) | 31/34 (91.2%) | 73/172 (42.4%) | 7/21 | 0.005 |
| online AI (Sarvam + Azure) | live | clean | 204/206 (99.0%) | 34/34 (100.0%) | 2/172 (1.2%) | 21/21 | — |
| online AI (Sarvam + Azure) | live | child_noisy | 180/206 (87.4%) | 34/34 (100.0%) | 26/172 (15.1%) | 15/21 | — |

By card type (clean voice):

| Model | Mode | Card | Agree | Errors caught | False alarms |
|---|---|---|---|---|---|
| small-hi-0.22 | free | paragraph | 97.1% | 13/13 (100.0%) | 4/123 (3.3%) |
| small-hi-0.22 | grammar | paragraph | 98.5% | 12/13 (92.3%) | 1/123 (0.8%) |
| small-hi-0.22 | free | word | 97.1% | 11/11 (100.0%) | 1/24 (4.2%) |
| small-hi-0.22 | grammar | word | 91.4% | 8/11 (72.7%) | 0/24 (0.0%) |
| small-hi-0.22 | free | letter | 71.4% | 10/10 (100.0%) | 10/25 (40.0%) |
| small-hi-0.22 | grammar | letter | 74.3% | 10/10 (100.0%) | 9/25 (36.0%) |
| online AI (Sarvam + Azure) | live | paragraph | 100.0% | 13/13 (100.0%) | 0/123 (0.0%) |
| online AI (Sarvam + Azure) | live | word | 100.0% | 11/11 (100.0%) | 0/24 (0.0%) |
| online AI (Sarvam + Azure) | live | letter | 94.3% | 10/10 (100.0%) | 2/25 (8.0%) |

## Words a model does not know (left out of its restricted vocabulary)

- small-en-in-0.4: aa, buh, cee, dabloo, double u, doubleu, ef, eff, emm, enn, ess, fuh, guh, ih, juh, kuh, muh, nn, nuh, oo, pe, puh, ss, vuh, wuh, yuh
- small-en-us-0.15: dabloo, double u, doubleu, emm, enn, fuh, guh, juh, vuh, wuh, yuh
- small-hi-0.22: none

## What it heard (scripted clips, clean voice)

| Clip | Model | Mode | Said | Heard |
|---|---|---|---|---|
| en-para-a__clean | small-en-in-0.4 | free | I have a red ball. I play with it every day. My dog likes my ball. He runs after it. | i have a red ball i play with it every day my dog likes my ball he runs after it |
| en-para-a__clean | small-en-in-0.4 | grammar | I have a red ball. I play with it every day. My dog likes my ball. He runs after it. | i have a red ball i play with it every day my dog likes my ball he runs after it |
| en-para-a__mistakes | small-en-in-0.4 | free | I have a red bell. I play with it day. My dog licks likes my ball. He runs after it. | i have a red bell i play with a day my dog licks likes my ball he runs after it |
| en-para-a__mistakes | small-en-in-0.4 | grammar | I have a red bell. I play with it day. My dog licks likes my ball. He runs after it. | i have a red [unk] i play with a day my dog likes likes my ball he runs after it |
| en-letter-b__mistakes | small-en-in-0.4 | free | b d n e g | b d n. gee |
| en-letter-b__mistakes | small-en-in-0.4 | grammar | b d n e g | bee dee n ee jee |
| en-word-a__mistakes | small-en-in-0.4 | free | cat sin pin bus hat | cat sin pain bus had |
| en-word-a__mistakes | small-en-in-0.4 | grammar | cat sin pin bus hat | cat sun pen bus hat |
| en-para-a__clean | small-en-us-0.15 | free | I have a red ball. I play with it every day. My dog likes my ball. He runs after it. | i have a red ball i play with it every day my dog likes my ball he runs after it |
| en-para-a__clean | small-en-us-0.15 | grammar | I have a red ball. I play with it every day. My dog likes my ball. He runs after it. | i have a red ball i play with it every day my dog likes my ball he runs after it |
| en-para-a__mistakes | small-en-us-0.15 | free | I have a red bell. I play with it day. My dog licks likes my ball. He runs after it. | i have a red bell i play with the d my dog licks likes my ball he runs after it |
| en-para-a__mistakes | small-en-us-0.15 | grammar | I have a red bell. I play with it day. My dog licks likes my ball. He runs after it. | i have a red [unk] i play with a day my dog likes likes my ball he runs after it |
| en-letter-b__mistakes | small-en-us-0.15 | free | b d n e g | be d an he gee |
| en-letter-b__mistakes | small-en-us-0.15 | grammar | b d n e g | bee dee n ee jee |
| en-word-a__mistakes | small-en-us-0.15 | free | cat sin pin bus hat | cat sin been bus hat |
| en-word-a__mistakes | small-en-us-0.15 | grammar | cat sin pin bus hat | cat sun pen bus hat |
| hi-para-a__clean | small-hi-0.22 | free | मेरा नाम रीना है। मेरे पास एक गाय है। गाय का रंग सफेद है। वह रोज घास खाती है। | मेरा नाम रीना है मेरे पास एक गाय है गाय का रंग सफेद है वह रोज घास खाती है |
| hi-para-a__clean | small-hi-0.22 | grammar | मेरा नाम रीना है। मेरे पास एक गाय है। गाय का रंग सफेद है। वह रोज घास खाती है। | मेरा नाम रीना है मेरे पास एक गाय है गाय का रंग सफेद है वह रोज घास खाती है |
| hi-para-a__mistakes | small-hi-0.22 | free | मेरा मेरा नाम रीना है। मेरे पास गाय है। गाय का रंग सफाद सफेद है। वह रोज घास खाता है। | मेरा मेरा नाम रीना है मेरे पास गाय है गाय का रंग सफेद सफेद है वह रोज घास खाता है |
| hi-para-a__mistakes | small-hi-0.22 | grammar | मेरा मेरा नाम रीना है। मेरे पास गाय है। गाय का रंग सफाद सफेद है। वह रोज घास खाता है। | मेरा मेरा नाम रीना है मेरे पास गाय है गाय का रंग सफेद सफेद है वह रोज घास खाती [unk] |
| hi-para-b__halting | small-hi-0.22 | free | आज बहुत बारिश हुई। सड़क पर ⏸ पानी भर गया। मोहन ने ⏸ कागज की नाव बनाई। नाव पानी में ⏸ तैरने लगी। | आज बहुत बारिश हुई सड़क पर पानी भर गया मोहन ने कागज की नाव बनाए नाव पानी में पैर में लगी |
| hi-para-b__halting | small-hi-0.22 | grammar | आज बहुत बारिश हुई। सड़क पर ⏸ पानी भर गया। मोहन ने ⏸ कागज की नाव बनाई। नाव पानी में ⏸ तैरने लगी। | आज बहुत बारिश हुई सड़क पर पानी भर गया मोहन ने कागज की नाव बनाई नाव पानी में तैरने लगी |
| hi-word-a__mistakes | small-hi-0.22 | free | गाय पनी मोर केल दिन | गाय बनी मोर खेल दिन |
| hi-word-a__mistakes | small-hi-0.22 | grammar | गाय पनी मोर केल दिन | गाय पानी मोर केला दिन |
| hi-letter-a__mistakes | small-hi-0.22 | free | क म श र ल | का माँ शा रा ला |
| hi-letter-a__mistakes | small-hi-0.22 | grammar | क म श र ल | म र ल |
