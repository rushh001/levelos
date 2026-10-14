# Research brief 2: Competitive landscape for LevelOS

Researched 15 Oct 2026 via web (AI-assisted). Scale figures mostly self-reported by the organisations.

**Short version:** AI oral reading checks already run at scale in India (Wadhwani AI: 9M+ students). Not deployed anywhere found: diagnosis of *which early sub-skill* is failing, plus teacher-led grouping and an activity, on one shared teacher phone, offline. Three prototypes sketch that idea (section 4). LevelOS should present itself as the deployed, early-grade version of that idea, not as "the first AI ORF".

## 1. AI ORF tools in India

**Wadhwani AI — "Vaachan Samiksha"** (the incumbent)
- Teacher's phone; child reads one paragraph. Inside Gujarat's G-Shala and ConveGenius SwiftChat since July 2023.
- Output: CWPM, accuracy, lists of correct/substituted/missed/extra words, pause time; dashboards by school→state (https://solve.mit.edu/solutions/87925, https://www.wadhwaniai.org/vaachan-samiksha-leveraging-ai-to-bridge-the-literacy-divide/). Comprehension feature added recently.
- Scale: Grades 2–8 in Gujarat and Rajasthan. Jan 2026: 34M assessments, 9.2M students, ~379k teachers, ~100k schools (https://www.wadhwaniai.org/impact/education-solutions/oral-reading-fluency/).
- Languages: Gujarati live; Hindi/English "built and tested" vs "in progress" (sources conflict).
- Offline: "not yet available, under development" (MIT Solve; undated).
- Accuracy: no published WER / human-agreement figure.
- Limits: passage-level only (little signal for a non-reader); teachers set aside two periods/day for batches of 5–10 children; remediation module only at prototype stage; no grouping feature documented.

**Google Read Along (Bolo)**
- Child alone with "Diya". Offline on 1 GB RAM phones. English + Hindi, Marathi, Tamil, Telugu, Bengali, Gujarati, Urdu. Used in UP (Mission Prerna), Telangana, Gujarat, Tamil Nadu (18 lakh+) (https://readalong.google/intl/en_in/fln).
- **Since June 2026, "Read Along in Google Classroom" is free for Workspace for Education**: teachers see accuracy, speed, comprehension, "phonics skills", misread/skipped words, top-10 problem words, and can use Gemini to create differentiated activities (https://workspaceupdates.googleblog.com/2026/06/read-along-in-google-classroom-is-now-available-to-all-education-users-to-support-foundational-literacy.html). Needs an account and device per child; no automatic grouping.

**UP Nipun Lakshya / Nipun Plus; ConveGenius**
- Nipun Plus (June 2025): classes 1–8 question bank, quarterly; supervisors spot-check 5 children/class in classes 1–3. Nipun Lakshya: weekly micro-quizzes.
- No evidence UP uses AI ORF; no evidence ConveGenius has its own ORF engine (hosts Wadhwani's in Gujarat). VSK chatbots in 14 states as of 2023.

**IIT Bombay TARA** — WCPM + prosody, English and Hindi; KVS ~7 lakh students grades 3–8 across 1,200 schools; remediation "planned"; accuracy "matches human experts", no number (https://acr.iitbombay.org/iit-bombays-tara-mobile-app-to-help-achieve-nationwide-oral-reading-fluency/).

**Pratham**
- PadhAI (Mar 2025): custom Indic ASR; WCPM, fluency, comprehension, "phonetics"; low-connectivity; child can use independently. Scale/languages/accuracy unpublished (https://pratham.org.uk/pratham-launches-padhai-transforming-literacy-with-ai-powered-reading-assessments).
- **Tech in TaRL with Anthropic (Feb 2026)**: AI reading assessments, nudges, conversational bot; RCT planned (https://pratham.org/2026/02/16/pratham-partners-with-anthropic-to-enable-ai-learning-tools-for-learners/). Features not public.
- ASER speech dataset: ~5,300 children aged 6–14, Hindi/Marathi/English (https://export.arxiv.org/abs/1912.04381).

**EkStep/Sunbird ALL (with AI4Bharat)** — child-facing practice; locates struggle at sentence/word/syllable level and drills; 7,000+ Telangana schools (vendor case study).

**Microsoft Reading Progress / Reading Coach** — Teams, account per student; auto-detect tags mispronunciation/omission/insertion/repetition; Hindi/Telugu/Tamil/Marathi/Kannada reportedly supported (not fully verified); no Indian government-school use found.

**Sarvam / AI4Bharat** — no school ORF pilot; Sarvam Saaras claims 22 languages + code-mixed (component, not rival).

**Also watch:** LearnBharat (Wadhwani Foundation) — AI FLN assessment incl. number recognition, teacher dashboards in 15 languages, proof-of-concept seeking pilots (https://learnbharat.wadhwanifoundation.org/about). NeurIPS 2026 paper on multidimensional ORF across 7 Indian languages (https://neurips.cc/virtual/2026/163803).

## 2. Global tools

| Tool | What | Teacher grouping / remediation? |
|---|---|---|
| Amira | K–3 read-aloud tutor; phoneme-level reports; 65+ micro-interventions by error type | Yes — "group students with similar struggles". Closest to LevelOS's diagnosis; needs device per child, US-only |
| Ello | Consumer phonics coach | No |
| Literably | ASR + human transcribers; accuracy, WCPM, self-corrections | Not verified |
| Lexia Core5 | Adaptive, not voice | Action Plans → scripted small-group lessons (grouping+activity pattern without speech) |
| EIDU (Kenya) | GenAI finds gaps, writes ~15-min small-group plans | Yes — J-PAL pilot integrated with TaRL (https://www.povertyactionlab.org/initiative-project/ai-powered-structured-pedagogy-programs-impact-student-learning-and-teacher). Closest conceptual match to the activity generator |

## 3. Teacher-facing diagnosis in India (incl. numeracy)

Mindspark/Ei (misconception categories, needs labs); Shiksha Copilot (MSR + Sikshana, lesson plans En/Kannada, 1,043 teachers, https://arxiv.org/abs/2507.00456 — plans, doesn't diagnose); Rocket Learning "Appu" (voice tutor ages 3–6); Chimple (offline games, dashboard "formative not diagnostic", UP RCT 2025–26); Top Parent (parent app, level check); Gooru Navigator; Khan Academy India; Pratham "Anytime Testing Machine" uses Claude to grade handwritten answers (https://claude.com/customers/pratham-international); TeachMitra (small open-source Gemini coach aligned to NIPUN).

## 4. Prior "AI + TaRL grouping / cohort remediation"

- **Tools Competition 2025 winner "AI-Enabled ORF in Hindi"** (Lords Education and Health Society, with a Wadhwani AI scientist): "Reading Cohorts Module" sorts children into Alphabetic / Sub-lexical / Lexical / Fluent; RAG module generates cohort-specific remediation (https://tools-competition.org/winner/oral-reading-fluency/). **Nearly LevelOS's pitch.** Deployment status not public.
- Pratham Tech in TaRL (Anthropic-backed).
- EIDU GenAI + TaRL (Kenya).
- No prior winners of this hackathon (first edition).

## 5. Synthesis

**Gaps LevelOS can credibly claim**
1. **The early-grade floor** — deployed tools score passages (Wadhwani grades 2–8, TARA 3–8). A Class 1 non-reader scores ~0 WCPM. A letters→words→passage ladder naming the failing sub-skill is not in any deployed Indian tool (only Lords prototype; Amira in US).
2. **Score → action** — grouping + same-day 10-min activity grounded in official NIPUN/SCERT/Pratham toolkits exists only in prototypes/pilots.
3. **One shared teacher phone** — Read Along Classroom, Reading Progress, Amira, Ello assume device + account per child.
4. **Offline-first** — Wadhwani's offline "under development"; Read Along offline but child-facing only.
5. **Code-mixed / dialect speech** — no tool documents handling it.
6. **Continuous not periodic** — UP runs quarterly with 5-child spot checks.

**Objections a judge may raise**
- "Wadhwani already does this for 9M+ students, and a Wadhwani-linked team won in 2025 with cohorts + RAG remediation." → name the gap precisely (below-passage diagnosis, toolkit-grounded activities, offline); propose plugging into G-Shala/SwiftChat rather than competing.
- "Pratham (TaRL's creator) is building Tech in TaRL with Anthropic." → expect this; Rukmini Banerji is on the jury.
- "Read Along Classroom is free with phonics insights and Gemini activities." → shared-device, offline government-school setting.
- Accuracy: single letters/phonemes from 6-year-olds is much harder than passage words; judges will want agreement with human assessors on even a small sample.
- Teacher time: one phone × 40 children ≈ 80 min; Gujarat teachers already set aside two periods a day.
- "Grouping alone is trivial" — TaRL's paper tool groups a class in minutes; value must come from diagnosis + activity.
- Feasibility/adoption: offline Indic child-speech on low-end phones is hard; DPDP Act for child voice data; states already bought into VSK/SwiftChat.

**Not verified:** AI ORF in UP's Nipun apps; Wadhwani's offline status and accuracy; PadhAI's scale and languages; Tech in TaRL's features; Hindi in Reading Progress; Shiksha Copilot Telangana scale.
