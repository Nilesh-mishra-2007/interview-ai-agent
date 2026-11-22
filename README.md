# Interview AI — Career Agent Pro (v2.0)

An all-in-one, **zero-dependency** Node.js 22 + SQLite + Google Gemini career assistant. No `npm install`, no build step, no external database server.

## What's Inside

1. **Connected Career Profile (`public/profile.html`)** — Sync your live **GitHub** repos/languages via GitHub REST API, link your **LinkedIn URL**, save your **Master Resume / LinkedIn PDF**, and configure target roles, preferred locations, custom Greenhouse/Lever ATS boards, and Discord/Slack/Telegram job alerts.
2. **AI Job Discovery & Apply-Assist Agent (`public/agent.html`)** — Scans live job boards (**Remotive** and **Arbeitnow** work free with no keys; optional **Adzuna** & **JSearch/RapidAPI** add India/LinkedIn/Indeed/Naukri coverage), scores every job against your profile, and builds a 1-click **Apply Pack** (tailored ATS Resume, Cover Letter, Recruiter Cold Email, LinkedIn Note, and Screening Q&As).
3. **Real-Time Job Notifications (`notifications.js`)** — Background scanner (`AGENT_POLL_MINUTES`) sends in-app bell alerts + optional Discord/Slack/Telegram push notifications for high-match jobs and overdue application follow-ups.
4. **Job Application Tracker (`public/tracker.html`)** — Manage applications across `Saved → Applied → Screening → Interview → Offer / Rejected`, track response rates, set follow-up reminder dates, export CSV, and launch ATS resumes or mock interviews directly from any tracked job.
5. **ATS-Friendly Resume Studio (`public/ats-resume.html`)** — Generate parser-safe, single-column ATS resumes tailored to any job description with a live **ATS Compatibility Score** (Keywords, Impact, Structure), Matched vs. Missing keyword chips, zero-fabrication guard, Classic/Modern templates, inline editing, plain-text copy, PDF print, and Cover Letter/Cold Outreach generator.
6. **AI Skill Roadmaps (`public/roadmaps.html`)** — Multi-week structured roadmaps with curated top free/paid resources, portfolio mini-projects, interview checkpoints, and checkable progress saved in SQLite.
7. **Interactive JD Mock Interviewer (`public/mock.html`)** — Practice live interviews based on any JD with typed or browser voice dictation (`SpeechRecognition`), instant 1–10 scoring, strengths/improvements, model answers, adaptive follow-ups, and a final Hire Verdict scorecard.
8. **Interview Strategy Plans (`public/index.html` & `public/report.html`)** — All original features preserved and upgraded to auto-use your synced Career Profile and GitHub projects.

## Quick Start (Local)

1. Install **Node.js 22.13+** (`node -v` to verify).
2. Copy `.env.example` to `.env` and add your free `GEMINI_API_KEY` from Google AI Studio (`https://aistudio.google.com/apikey`).
3. Run:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000`, register an account, link your GitHub & target roles in **Profile**, and run your first **AI Job Agent** scan!

For full API key setup and cloud deployment (Render, Railway, and Ubuntu VPS), open **`DEPLOYMENT_AND_API_GUIDE.md`**.
