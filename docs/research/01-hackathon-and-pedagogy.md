# Research brief 1: Hackathon rules, ASER/EGRA/NIPUN, TaRL, Hindi error types

Researched 15 Oct 2026 via web (AI-assisted). Items marked **not verified** need a human check before being quoted in a deck.

## 1. The hackathon

Sources: landing page (https://hack2skill.com/event/aiforfoundationallearning/) and the Guidelines PDF.

- Run by ShikshaNext with Anthropic, on Hack2Skill. CSF is managing partner; IHFC (IIT Delhi) is knowledge partner.
- Timeline: Build closes **1 Nov 2026, 11:59pm**. Top 10 announced 10 Nov. Grand Finale in person 18 Nov, 10am–2pm. Guidelines recommend submitting a few hours early.
- Challenge 02 readings: Frontline 2025 article (https://frontline.thehindu.com/the-nation/education/multigrade-multilevel-classrooms-india-policy-reform/article69909413.ece) and J-PAL's TaRL case study (https://www.povertyactionlab.org/case-study/teaching-right-level-improve-learning). Explainer video: https://drive.google.com/file/d/15-kwh5-PtI2PoJQpnTLrC0ihT92DDvS7/view
- Overall reading list: CSF *Systemic Drivers of FL Outcomes* (2021); NITI Aayog *School Education System in India* (2026); CSF *Bharat Survey for EdTech* (2025); IndiaAI/CSF/EkStep *AI-in-Education Casebook* (2026).

### Build deliverables (4)
1. **Hosted demo** — must stay reachable for the whole evaluation window. Web preferred; if mobile-only, an APK with install steps. Include test logins for every role, 3–5 sample inputs, and a frozen version.
2. **Repo** — read access for "Tech4Dev evaluator IDs". README with setup, how to run locally, `.env.example`, list of every AI service/model called and where keys are needed. No secrets, no real-user personal data, **no commits after the deadline**.
3. **3-minute YouTube video** — judges may stop at 3:00; also the fallback if the demo link fails.
4. **Short PPT** — AI/LLM calls "in layers" (input, processing, guardrails, evaluation, output); how wrong AI outputs are handled; offline behaviour (which parts need connectivity, what degrades gracefully) — **"Evaluators will test real-world, low-connectivity behaviour."**; user-testing evidence (1–2 pages); roadmap (1–2 pages).

### Build judging
- Efficacy & user centricity 35% — names "vernacular language, voice first" and "proof of testing and refinement basis user input".
- Effective AI use & technical strength 30% — guardrails, works in real scenarios.
- Innovation 25%. Roadmap 10%.

### Rules / support
- AI must be central. Claude credits must be used for at least one part. Built during the window. Open-sourcing: +$250 credits, no effect on judging.
- $500 credits per team at Build; +$500 for Top 10. Two 40-min mentor sessions (one education, one technical).
- Prizes: ₹3.5L / ₹2.5L / ₹1.5L, plus five Ideate ideas at ₹50k; ₹10L total.
- Jury: Rukmini Banerji (Pratham, ex-CEO), Jonathan Stern (Gates Foundation), Raahil Rai (Anthropic), Ishmeet Singh (CSF CEO), Piyush Prasad (IHFC), Mekin Maheshwari, Rahul Kulkarni, Shridhar Sethuram.
- Contacts: Discord https://discord.gg/KMKtbxBJpW; support+aiforfnl@hack2skill.com.
- First edition (no prior year found). "Resources to help build solutions" are probably on the logged-in Hack2Skill dashboard — **not verified**.

## 2. ASER reading & maths tool (ASER 2024 Assessment Tasks)

Source: https://asercentre.org/wp-content/uploads/2022/12/ASER-2024-assessment-tasks.pdf

Items: letters = commonly used letters; words = familiar words, 2 letters + 1–2 matras; Std I paragraph = 4 linked sentences, ≤6 words each; Std II story = 7–10 sentences. Tool controls how many conjuncts appear.

Procedure (start at the paragraph):
- Child picks one of two paragraphs, reads with a finger on the text.
- **Paragraph level**: reads as sentences, fluently even if slowly, **≤3 mistakes**. Not at this level if read as a string of words, haltingly, or fluently with >3 mistakes.
- Pass paragraph → story. Same criteria → **Story level**; else Paragraph.
- Fail paragraph → words. Child picks 5 words; ≥4/5 correct → try paragraph again; if still struggling → **Word level**.
- <4/5 words → letters. ≥4/5 correct → try words again, else **Letter level**. <4/5 letters → **Beginner**.
- Record the highest level reached comfortably.

Maths (start at subtraction): two 2-digit subtraction with borrowing (must read numbers and sign; careless mistake gets a second chance). Both correct → division (3-digit ÷ 1-digit; quotient and remainder both right → Division, else Subtraction). Not both → number recognition 11–99 (≥4/5), then 1–9 (≥4/5), else Beginner.

## 3. EGRA / EGMA (RTI toolkits, https://shared.rti.org/node/257)

EGRA core subtasks: listening comprehension, letter identification (sounds or names), nonword reading, ORF with comprehension. Extras: phonemic awareness, familiar words. Timed subtasks 60 s; rate = correct × 60 ÷ (60 − seconds remaining). Early stop: zero correct in first line (10 items). Marking: slash errors; self-corrections count correct; 3-second hesitation → "Please go on", marked incorrect; each item coded correct / incorrect / no response. Comprehension: only questions covered by text read; "fluent with comprehension" = whole passage + ≥80% questions. **EGRA has no miscue taxonomy.** Note for alphasyllabic scripts: diacritic count/type/non-linear placement affect reading; ~5 years to fluency vs ~3 in English.

EGMA: number identification (20 items, 60 s), number discrimination (10, untimed), missing number (10, untimed), add/sub L1 (20 each, 60 s, sums ≤19, strategy recorded), add/sub L2 (5 each, untimed, skipped if L1 = 0), word problems (6). Untimed subtasks stop after 4 consecutive errors.

## 4. NIPUN Bharat targets (Guidelines 2021; target year 2026-27)

| Stage | Literacy | Numeracy |
|---|---|---|
| Balvatika | Recognises letters and sounds; reads simple 2–3 letter words | Numerals to 10 |
| Grade 1 | Reads short sentences of 4–5 simple words in unseen text (no wpm) | Numbers to 99; simple add/sub |
| Grade 2 | Reads with meaning at **45–60 wpm** | Numbers to 999; subtraction within 99 |
| Grade 3 | Reads with meaning at **≥60 wpm** | Numbers to 9999; simple multiplication |

FLS 2022 Grade 3 Hindi "meets minimum proficiency" ≈ 35–54 cwpm — **secondary source** (Wadhwani AI page); government PDFs 404.

## 5. CBSE FLN resources (https://cbseacademic.nic.in/fln/teacher-corner.html)

- Question banks (Word files): Hindi, Maths, English Classes 1–5; EVS 3–5. Hindi Class 1 ≈ 72 items, each tagged with an NCERT learning-outcome code (e.g. HO102); types MCQ/true-false/oral/matching/short/long. Each item has an answer and a **"Possible errors or misconceptions"** note (e.g. "मात्राओं की अशुद्धि", "वर्ण और मात्रा संबंधित त्रुटियां"). **No remediation activities in the banks.**
- Compendiums: Literacy Grades 1–3 (Hindi), Numeracy Grades 1–3 (En/Hi), by CSF with CARE India; lesson/activity sets tied to NCERT Rimjhim chapters with StoryWeaver links. Legacy Hindi font — structure **not confirmed**.
- CBSE–Pratham "Assessment of Foundational Reading" course (https://cbseacademic.nic.in/pratham/, 9 languages): ASER-style 5-level tool; sight / action / special / CVC word lists.
- No document titled "CBSE FLN assessment toolkit" found; "FLN Toolkit" and "Assessment Bank" headings have no links.

## 6. TaRL / Pratham

- Grouping by level from a one-on-one ASER-like test: **Beginner + Letter together, Word + Paragraph together, Story separately.** Teacher takes one level group or runs a mixed class with group leaders.
- Models: learning camps (~10 days, 2–3 h/day, 3–5 camps/yr) or government model (1–2 h/day). Six RCTs; in UP, camps roughly doubled paragraph/story readers.
- Reassessment: baseline/midline/endline plus ongoing checks; children move up on teacher observation, "does not need to wait for the midline" (https://assets-global.website-files.com/61366d43ebd6df56d9b67a11/61b1ea8ea66c7e20310e4ffd_Planning%20TaRL%20Sessions_Dec_2021.pdf).
- Session outlines (whole class → small group → individual):
  - Beginner + Letter: chat/story/picture reading (10–15); syllable-chart (barakhadi) reading (10–15); basket or flashcard game (10–15); mind map / rhyming words / beginning–ending sound game (15–30). Alternative: take a 2-syllable word from a paragraph, write its syllable strings (ba be bi bo bu…), read them, build words; nonsense words fine.
  - Word + Paragraph: paragraph/story reading (20–30); mind map, "correct the incorrect", story-making (20); copying/dictation.
  - Story: lesson-based activity and mind maps for comprehension.
- 45-hour plan for Beginner + Letter: days 1–15 letters & syllables; 16–30 words/sentences/paragraphs; 31–45 varied reading and self-writing. Word + Paragraph → Story in ~15–25 days.
- Materials (https://assets-global.website-files.com/61366d43ebd6df56d9b67a11/61a10edb3d8918dd5cc508a2_Literacy%20TLM%20Note_25%20Nov.pdf): paragraphs 4 sentences × 4–5 words; stories 60–80 words + 2–3 questions; consonant/vowel flashcards; picture cards; barakhadi chart read horizontally/vertically/diagonally/zig-zag.
- Open resources: teachingattherightlevel.org (no Hindi activity bank), StoryWeaver (https://storyweaver.org.in), DIKSHA NIPUN content, CBSE compendiums.

## 7. Frontline, "The great fiction of India's classrooms" (Merlia Shaukath, 27 Aug 2025)

- 40–90% of primary schools are multigrade; every classroom is multilevel.
- Teacher has 20–30 children across grades/levels; textbooks assume grade level; "Assessments are not levelled either."
- "Grade level equals learning level" is the fiction; >70% of Class V government-school children struggle with Class II arithmetic.
- Tamil Nadu's **Ennum Ezhuthum**: Classes I–III under one teacher with shared themes and level-pitched tasks (Class I identifies letter sounds, II blends, III segments and spells).
- Quote to cite: teachers need "tools for assessing progress in fluid and continuous ways".

## 8. Hindi (Devanagari) error types

- **Matra errors** — flagged repeatedly in CBSE item notes; non-linear vowel-sign placement (ि written before, said after).
- **Conjuncts** — Bhide et al. 2021 (https://ora.ox.ac.uk/objects/uuid:a472fe56-43c5-462f-abab-0b58b11f8c4f): opaque conjuncts, non-left-to-right components, written≠spoken syllables, aspirated consonants.
- **Similar-looking akshara** — e.g. घ/ध, ब/व, म/भ (illustrative pairs, not sourced).
- **Letter-by-letter without blending** — ASER's "string of words"/"halting"; remediation = syllable strings, identify→blend→segment.
- **Best taxonomy: Raman & Rao, Interspeech 2025 (IIT Bombay)** (https://www.isca-archive.org/interspeech_2025/raman25_interspeech.pdf): words = correct / deleted / substituted / inserted; substitutions = real-word vs non-word, then initial-part correct / final-part correct / scaffolding (first+last correct) / some overlap / none. Hindi Grade 3: 91.9% correct, 7.5% substituted, 0.6% deleted, 3.0% inserted; **63% of Hindi substitutions were non-words** (decoding, not guessing); scaffolding errors most common; phone recogniser caught at-risk readers at F1 0.74.
- Schwa deletion — likely over-pronounced by letter-by-letter decoders (inference, unsourced).
- **No standard national Hindi miscue taxonomy exists.**
