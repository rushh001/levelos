# Deploying LevelOS — step by step

The app already runs on a laptop. Deploying puts it on the internet so judges (and the teachers testing it) can open it on their own phones, any time, over HTTPS (phones only allow the microphone on HTTPS pages).

| What | Where | Address you will get |
|---|---|---|
| Phone app (`web/`) | **Vercel** | `https://<name>.vercel.app` |
| API: speech scoring, ASER rules, Claude, logins (`api/` + `content/`) | **Render** (Docker) | `https://<name>.onrender.com` |
| Database | **Neon Postgres, created from Vercel's Storage tab** | a `postgresql://…` connection string |

All three are on free plans (limits change; check current terms). Total time: about 45 minutes, most of it waiting for builds.

**Order matters** because each side needs the other's address: database → Render → Vercel → back to Render to allow the Vercel address.

Button names below are as of October 2026; if one has moved, look for the nearest equivalent.

---

## Step 0 — Put the code on GitHub

Render and Vercel deploy straight from `github.com/rushh001/levelos`. Claude Code commits and pushes when you say "commit" (commits are authored as Mohd Zaid Husain <rushhinjam@gmail.com>; the push uses this laptop's SSH key, which logs in as `rushh001`). The repository can stay private: Render and Vercel ask for access to it when you connect them.

---

## Step 1 — Create the database (Vercel → Storage → Neon)

1. Go to **vercel.com** and sign in with GitHub (account `rushh001`).
2. Open the **Storage** tab (top menu of your Vercel dashboard) → **Create Database** → choose **Neon** (Serverless Postgres) → **Continue**.
3. Choose:
   - **Region: Singapore** (`aws-ap-southeast-1`) — the same region as the API on Render, and the closest to India.
   - **Plan: Free**.
   - **Name:** `levelos-db`.
   Then **Create**.
4. If Vercel offers to **connect the database to a project**, you can skip it: the web app never talks to the database; only the API on Render does.
5. Open the new database and find its connection details (a **.env.local** or **Quickstart** tab, with a **Show secret** button). You will see several variables. Copy the one called **`DATABASE_URL_UNPOOLED`** (it may also be shown as `POSTGRES_URL_NON_POOLING`). Check: its host name does **not** contain `-pooler`. It looks like
   `postgresql://neondb_owner:••••@ep-xxxx-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   Why the unpooled one: the API keeps its own small connection pool, and the direct connection avoids problems between the database driver and Neon's pooler.
6. Paste it into **`api/.env.local`** on this laptop as
   `PROD_DATABASE_URL=postgresql://…`
   (that file is gitignored). Do **not** paste it into a chat or into any file in the repository. Claude Code then checks the connection and prepares the database from here.

---

## Step 2 — Deploy the API on Render

1. Go to **render.com** → **Get Started** → sign up with **GitHub** (`rushh001`).
2. In the dashboard: **New +** → **Blueprint**.
3. **Connect GitHub** if asked, and give Render access to **only** the `rushh001/levelos` repository. Select it.
4. Render reads `render.yaml` from the repository and shows one service, **`levelos-api`** (Docker, Free, Singapore). It asks for the values it cannot fill itself:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the **unpooled** Neon URL from step 1 |
   | `CORS_ORIGINS` | for now `https://example.com` (the real Vercel address goes here in step 4) |
   | `ANTHROPIC_API_KEY` | from `api/.env.local` |
   | `SARVAM_API_KEY` | from `api/.env.local` |
   | `AZURE_SPEECH_KEY` | from `api/.env.local` (key 1) |

   Filled automatically from `render.yaml`: `APP_ENV=prod`, `SEED_DEMO=true` (creates the demo logins and class on first start), `JWT_SECRET` (generated), `AZURE_SPEECH_REGION=centralindia`, `CLAUDE_BUDGET_USD=400`, `CLAUDE_DAILY_BUDGET_USD=25` (hard caps on Claude spend). There is deliberately no Gemini key on the server.
5. Click **Apply** (or **Deploy Blueprint**). The first build takes about 5–8 minutes (it installs ffmpeg and the Python packages). Click into the service and watch **Logs**.
6. When the service shows **Live**, copy its address from the top of the page, e.g. `https://levelos-api.onrender.com`.
7. Open `https://levelos-api.onrender.com/api/health` in a browser. You should see:
   - `"ok": true`, `"env": "prod"`, `"ffmpeg": true`, `"languages": ["hi", "en"]`
   - `"speech_paths": {"sarvam": true, "azure": true, "gemini": false}` and `"claude": true`
   - `"claude_budget": {"spent_usd": 0, "cap_usd": 400, "available": true, …}`

   If any of these is off, see **Troubleshooting** at the end.

<details>
<summary>If you prefer not to use the Blueprint (manual setup)</summary>

**New +** → **Web Service** → choose the repository → **Language: Docker** → **Dockerfile Path:** `api/Dockerfile` → **Docker Build Context Directory:** `.` (the repository root) → **Instance Type: Free** → **Region: Singapore** → under **Advanced**, **Health Check Path:** `/api/health` → add every variable listed in `render.yaml` by hand (for `JWT_SECRET`, use any random string of 40+ characters) → **Create Web Service**.
</details>

---

## Step 3 — Deploy the phone app on Vercel

1. On **vercel.com**: **Add New…** → **Project** → under **Import Git Repository** choose `rushh001/levelos` (if it is not listed, use **Adjust GitHub App Permissions** to give Vercel access to that repository).
2. On the **Configure Project** screen:
   - **Root Directory:** click **Edit** → select **`web`** → **Continue**.
   - **Framework Preset:** Vite (detected automatically). Leave the build and output settings as they are; `web/vercel.json` sets them (`npm run build`, output `dist`).
   - **Environment Variables:** add `VITE_API_BASE` = your Render address from step 2, e.g. `https://levelos-api.onrender.com` (no trailing slash). This is the only variable the app needs. Anything starting with `VITE_` ends up inside the app's public code, so never put a key here.
3. Click **Deploy** (about 1–2 minutes). When it finishes, open the project and copy the **production** address, e.g. `https://levelos.vercel.app`. You can choose a nicer name under **Settings → Domains** (for example `levelos-rushhies.vercel.app`); if you change it, use the new address in step 4.
4. Check one setting: **Settings → General → Root Directory**. The option to **include files outside the root directory in the build step** must be **on** (it is by default). The app bundles the reading cards from `content/items/`, which is outside `web/`.

---

## Step 4 — Let the app talk to the API (CORS)

The API only answers web pages from addresses it has been told about.

1. Render → **levelos-api** → **Environment** → edit **`CORS_ORIGINS`** → set it to the exact Vercel address from step 3, e.g. `https://levelos.vercel.app` (https, no trailing slash; several addresses can be separated by commas).
2. **Save Changes**. Render redeploys by itself (about 1–2 minutes).

---

## Step 5 — Test it like a judge would

On an **Android phone in Chrome** (also try a laptop browser):

1. Open the Vercel address. Tap **डेमो कक्षा देखें** (Try the demo class). If the API was asleep, the first load can take up to a minute (step 6 prevents that).
2. The dashboard shows three reading groups with 16 children. Open **फ़रहान** (not checked yet) → **पढ़ने की जाँच शुरू करें** → allow the microphone → read the word card aloud → stop. The result appears in about 5–15 seconds and the next card follows.
3. Finish the check: the result page shows the level and a quick analysis; the detailed Claude analysis replaces it within about 30 seconds.
4. On the dashboard, open **▶ 10 मिनट की गतिविधि** on a group: a 10-minute plan appears (about 20–40 seconds the first time each day).
5. **Offline**: with the app open on the dashboard and a child's page visited once, turn on **airplane mode** → reload → the app still opens → start a check-in → record or tap-mark → the summary shows **⏳ 1** → turn airplane mode off → within a minute the ⏳ disappears and the child's page shows the synced check-in.
6. Log out and in as **`judge`**, PIN **`2026`**: the same demo class, separate from `demo`.

---

## Step 6 — Keep the API awake (UptimeRobot)

Render's free plan puts the API to sleep after about 15 minutes without visitors; the next visitor then waits about a minute. A free monitor that visits every 5 minutes keeps it awake.

1. **uptimerobot.com** → sign up (free).
2. **Add New Monitor** → type **HTTP(s)** → URL `https://levelos-api.onrender.com/api/health` → interval **5 minutes** → **Create Monitor**.

The phone app on Vercel never sleeps, so the app itself always opens; only scoring waits if the API is asleep.

---

## Step 7 — Give the demo class Claude diagnoses (optional, about $0.65 once)

The seeded children start with rule-based ("quick") diagnoses. Once `PROD_DATABASE_URL` is in `api/.env.local` (step 1), Claude Code runs this from the laptop; to do it yourself in Git Bash:

```bash
cd api
export DATABASE_URL="$(grep '^PROD_DATABASE_URL=' .env.local | cut -d= -f2-)"
.venv/Scripts/python -m scripts.diagnose_pending --dry-run           # how many, estimated cost
.venv/Scripts/python -m scripts.diagnose_pending --teacher demo
.venv/Scripts/python -m scripts.diagnose_pending --teacher judge
.venv/Scripts/python -m scripts.claude_spend                         # the hosted demo's Claude spend so far
unset DATABASE_URL
```

---

## After the deploy

- **Updates**: every push to `main` redeploys both the API (Render) and the app (Vercel) automatically.
- **Hackathon rule**: no commits after the deadline (Sat 1 Nov, 11:59 pm). Push the final version before then and leave it; the hosted demo must stay up through the evaluation window (finale 18 Nov).
- **Claude spend**: `/api/health` shows `claude_budget`; `scripts.claude_spend` (step 7) gives the breakdown. This laptop's testing has its own ledger; add both against the $500 credit.
- **Keys**: they live only in Render's environment variables and in `api/.env.local`. Rotate the Azure keys after the hackathon (they were shared in a chat).

---

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| Vercel build fails: cannot resolve `../../../content/items/hi.json` | Files outside `web/` are not included | Step 3.4: turn on "include files outside the root directory", redeploy |
| The app opens but login says it can't reach the server (older builds said "wrong login ID or PIN" for every login) | `CORS_ORIGINS` on Render does not list the app's address, or the API is waking up | Step 4; check with the command below this table; wait a minute and retry |
| `/api/health` shows 502 or 503 | The API is starting or asleep, or it crashed | Wait 60 s; if it persists, read Render → **Logs** |
| Render log: `JWT_SECRET must be set in production` | `JWT_SECRET` is missing | Set it to any random string of 40+ characters |
| Render log mentions SSL, `prepared statement`, or the database host | Pooled URL, or `?sslmode=require` missing | Use the **unpooled** URL from step 1.5, including `?sslmode=require` |
| `/api/health` shows `"claude": false` | No Anthropic key on Render | Add `ANTHROPIC_API_KEY` in Render → Environment |
| The microphone does not start | Not on HTTPS, or permission blocked | Use the Vercel `https://` address; Chrome → site settings → Microphone → Allow |
| The `demo` login does not work | The demo data was not created | Check `SEED_DEMO=true` in Render; or Render → **Shell**: `python -m scripts.seed_demo --if-empty` |
| Everything worked yesterday, today the first request is slow | The API slept (no monitor) | Step 6 |

**Is the app's address allowed to call the API?** Run this from any terminal, using your two addresses. `200` means allowed; `400` means `CORS_ORIGINS` does not list the app's address.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS https://levelos-api.onrender.com/api/auth/login \
  -H "Origin: https://levelos-nine.vercel.app" -H "Access-Control-Request-Method: POST"
```
