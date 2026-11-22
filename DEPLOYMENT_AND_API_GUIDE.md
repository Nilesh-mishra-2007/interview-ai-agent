# Deployment & API Keys Guide — Interview AI Career Agent (v2.0)

This guide walks you through getting every API key (both required and optional), running the app locally, and deploying it live on **Render**, **Railway**, or your own **Ubuntu VPS** with HTTPS.

Because the project uses **zero npm packages** and **Node.js 22's built-in SQLite (`node:sqlite`)**, there is no build step and no external database server to manage.

## 1. API Keys Cheat Sheet

Only **one** key (`GEMINI_API_KEY`) is required to run the entire app—including GitHub sync, free job scanning (Remotive + Arbeitnow + Greenhouse/Lever), ATS Resume Studio, Job Tracker, Skill Roadmaps, and Interactive Mock Interviews. Everything else is an optional upgrade.

| Variable | Required? | What It Unlocks | Cost / Free Tier | Where to Get It |
| :--- | :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Required** | Powers all AI features (ATS Resumes, Job Scoring, Roadmaps, Mock Interviewer, Cover Letters) | Free tier available | `https://aistudio.google.com/apikey` |
| `GITHUB_TOKEN` | Optional | Raises GitHub sync limit from 60 req/hr to 5,000 req/hr | Free | `https://github.com/settings/tokens` |
| `ADZUNA_APP_ID` & `ADZUNA_APP_KEY` | Optional | Adds India (`in`), US, UK, EU, SG live job listings to the AI Job Agent | Free developer tier | `https://developer.adzuna.com/` |
| `RAPIDAPI_KEY` | Optional | Enables **JSearch** (legally aggregates LinkedIn, Indeed, Glassdoor & Naukri jobs via API) | Free monthly tier | `https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch` |
| `TELEGRAM_BOT_TOKEN` | Optional | Sends instant job match & follow-up alerts to your Telegram | Free | Message `@BotFather` on Telegram |
| Discord / Slack Webhook | Optional (set in UI) | Sends instant job alerts to a Discord or Slack channel | Free | Discord Channel Settings → Integrations → Webhooks |

## 2. Step-by-Step: How to Get Each Key

### A. Google Gemini API Key (Required)
1. Open `https://aistudio.google.com/apikey` and sign in with your Google account.
2. Click **Create API key**, choose or create a Google Cloud project, and copy the key (`AIza...`).
3. Put it in `.env` (locally) or your host's Environment Variables as:
   ```env
   GEMINI_API_KEY=AIzaYourActualKeyHere
   ```

### B. GitHub Personal Access Token (Optional — Recommended for Multi-User Sites)
1. Go to `https://github.com/settings/tokens` → **Fine-grained tokens** (or Classic) → **Generate new token**.
2. Give it a name (e.g., `interview-ai-read`), leave repository permissions at **Public Repositories (read-only)**, and generate.
3. Copy the token (`ghp_...` or `github_pat_...`) and set `GITHUB_TOKEN=...`.

### C. Adzuna Job Board API (Optional — Great for India & Global Roles)
1. Create a free developer account at `https://developer.adzuna.com/`.
2. Open your dashboard to copy your **Application ID** (`ADZUNA_APP_ID`) and **Application Key** (`ADZUNA_APP_KEY`).
3. Set your preferred country code (`ADZUNA_COUNTRY=in` for India, `us` for USA, `gb` for UK, `de` for Germany, `sg` for Singapore).

### D. JSearch via RapidAPI (Optional — LinkedIn, Indeed, Glassdoor & Naukri Feed)
1. Sign in at `https://rapidapi.com/` and open the **JSearch** API page.
2. Click **Subscribe to Test** and select the **Basic (Free)** plan.
3. Copy the `X-RapidAPI-Key` value from the code snippet header and set `RAPIDAPI_KEY=...`.

### E. Instant Job Alerts via Discord or Telegram (Optional)
- **Discord (easiest):** In any Discord server you own, open **Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**. Paste that URL directly into the **Profile** page inside the web app (no `.env` edit needed).
- **Telegram:**
  1. Message `@BotFather` on Telegram, send `/newbot`, and copy the bot token into `.env` as `TELEGRAM_BOT_TOKEN=...`.
  2. Start a chat with your new bot, then message `@userinfobot` to get your numeric Chat ID.
  3. Paste your Chat ID into the **Profile** page inside the web app and click **Save Career Profile**.

### F. Tracking Specific Companies (Zero API Keys Needed)
In the **Profile** page under **Custom Company ATS Boards**, you can track public Greenhouse or Lever job boards directly using `provider:slug`, for example:
```text
greenhouse:stripe, greenhouse:databricks, lever:netflix
```

## 3. Run Locally (5 Minutes)

1. **Verify Node.js 22.13+:**
   ```bash
   node -v
   ```
   If older than `v22.13.0`, download the latest LTS from `https://nodejs.org`.
2. **Unzip the project** and open a terminal inside the `interview-ai-agent` folder.
3. **Create `.env`:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and paste your `GEMINI_API_KEY` (plus any optional keys you want).
4. **Start the server:**
   ```bash
   npm start
   ```
5. Open `http://localhost:3000`, register an account, go to **Profile** to sync your GitHub & upload your Master Resume PDF, and click **Run AI Scan Now** in **AI Job Agent**.

## 4. Push Your Code to GitHub First

Before deploying to Render or Railway, push the folder to a GitHub repository (`.gitignore` automatically excludes `.env` and `data/app.db` so your secrets stay safe):

```bash
cd interview-ai-agent
git init
git add .
git commit -m "Interview AI Career Agent v2.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

**Security check:** Never upload `.env` or `data/app.db` to GitHub.

## 5. Deployment Options

### Option A: Render.com (Easiest Click-and-Deploy)
1. Sign in at `https://render.com` and click **New + → Web Service**.
2. Connect your GitHub repository.
3. Configure the service:
   - **Runtime:** Node
   - **Build Command:** `npm install` (finishes in 1 second — zero dependencies)
   - **Start Command:** `npm start`
4. Open **Environment** and add your variables:
   - `GEMINI_API_KEY` = your Gemini key
   - `NODE_ENV` = `production`
   - `NODE_VERSION` = `22.13.0` (ensures `node:sqlite` is available)
   - `AGENT_POLL_MINUTES` = `60`
   - *(Optional)* `GITHUB_TOKEN`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_COUNTRY`, `RAPIDAPI_KEY`, `TELEGRAM_BOT_TOKEN`
5. Click **Create Web Service**. Render gives you a live HTTPS URL automatically.
6. **Important for Permanent Data:** Render's free tier wipes local files on redeploy. To keep user accounts, tracked jobs, and roadmaps permanently, attach a **Persistent Disk** (mount path `/var/data`) in Render settings and add `DB_PATH=/var/data/app.db`.

### Option B: Railway.app (Fast + Persistent Volume)
1. Sign in at `https://railway.app` → **New Project → Deploy from GitHub repo**.
2. In your service's **Variables** tab, add `GEMINI_API_KEY`, `NODE_ENV=production`, `PORT=3000`, `DB_PATH=/data/app.db`, plus any optional keys.
3. Add a **Volume** mounted at `/data` so SQLite persists across redeploys.
4. Open **Settings → Networking → Generate Domain** to get your live HTTPS link.

### Option C: Your Own Ubuntu 24.04 VPS (Best Value & Full Control)
Works on DigitalOcean, Hetzner, Hostinger VPS, or AWS Lightsail (1 GB RAM is plenty):

1. **Point your domain** (`yourdomain.com` and `www.yourdomain.com`) to your server's IP address using DNS **A records**.
2. **SSH in and install Node.js 22 + Git:**
   ```bash
   ssh root@YOUR_SERVER_IP
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install -y nodejs git
   node -v
   ```
3. **Clone your repo and configure `.env`:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git interview-ai
   cd interview-ai
   cp .env.example .env
   nano .env
   ```
   Set `GEMINI_API_KEY=...`, `NODE_ENV=production`, `PORT=3000`, and any optional API keys. Save with `Ctrl+O`, `Enter`, `Ctrl+X`.
4. **Keep the app running 24/7 with PM2:**
   ```bash
   npm install -g pm2
   pm2 start npm --name interview-ai -- start
   pm2 save
   pm2 startup
   ```
5. **Enable automatic HTTPS with Caddy:**
   ```bash
   apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
   apt update && apt install -y caddy
   nano /etc/caddy/Caddyfile
   ```
   Put this inside `/etc/caddy/Caddyfile`:
   ```caddy
   yourdomain.com, www.yourdomain.com {
       reverse_proxy localhost:3000
   }
   ```
   Reload Caddy and enable the firewall:
   ```bash
   systemctl reload caddy
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
   ```
6. **Updating later & backing up SQLite:**
   ```bash
   # Pull updates
   cd interview-ai && git pull && pm2 restart interview-ai

   # Backup database from your laptop
   scp root@YOUR_SERVER_IP:interview-ai/data/app.db ./backup-app.db
   ```

## 6. Quick Troubleshooting

| Symptom | Cause & Fix |
| :--- | :--- |
| `Cannot find module 'node:sqlite'` | Node.js is below 22.13. Upgrade to Node 22 LTS or set `NODE_VERSION=22.13.0` on Render. |
| `The server has no GEMINI_API_KEY` | Add `GEMINI_API_KEY` to `.env` (local) or Environment Variables (cloud) and restart. |
| Logged out immediately after login on live site | `NODE_ENV=production` requires HTTPS for cookies. Use HTTPS (Render/Railway/Caddy) or unset `NODE_ENV` locally. |
| GitHub sync says rate limit reached | Public GitHub API allows 60 calls/hour per IP. Add a free `GITHUB_TOKEN` to `.env` for 5,000/hour. |
| AI Job Agent only returns remote tech jobs | Remotive & Arbeitnow are remote-focused. Add free `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` (`ADZUNA_COUNTRY=in`) or `RAPIDAPI_KEY` (JSearch) for local/hybrid India & global roles. |
| Gemini returns `429` or model error | Free-tier quota hit (wait 1 minute) or model renamed (set `GEMINI_MODEL=gemini-2.5-flash` in `.env`). |
