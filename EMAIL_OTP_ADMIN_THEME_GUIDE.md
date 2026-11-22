# Setup Guide: Email OTP Verification, Admin Email List, Automatic Job Emails & Black/White Background Toggle

All four features are now built directly into **`interview-ai-agent-v2.1.zip`** with **zero npm dependencies**.

## 1. What Was Added

| Feature | Files Updated / Added | How It Works |
| :--- | :--- | :--- |
| **Email OTP Verification on Register** | `mailer.js`, `db.js`, `routes.js`, `public/register.html`, `public/app.js` | Users click **Send Verification OTP**, receive a 6-digit code (expires in 10 min, max 5 tries, 30s resend cooldown), and must verify it to create their account. |
| **Admin Registered Email List + CSV Export** | `routes.js`, `public/admin.html`, `public/app.js` | When logged in with your `ADMIN_EMAIL`, an **Admin Emails** tab appears in the top bar showing all registered users, a 1-click **Download Email List (CSV)** button, and instant email alerts whenever someone registers. |
| **Automatic Job Alert Emails + Manual Broadcast** | `jobs.js`, `mailer.js`, `routes.js`, `public/admin.html`, `public/profile.html` | Whenever the AI Job Agent discovers high-match jobs, it automatically emails the registered user (if they keep Email Alerts checked in Profile). Admins can also broadcast a specific job to all opted-in users (or filter by skill) from `/admin.html`. |
| **Black / White Background Toggle** | `public/style.css`, `public/app.js` | Click **⬜ White BG / ⬛ Black BG** in the top bar (or top-right on login/register) to switch the page background between pure black and crisp white while keeping your pink accent and card text colors intact. Saved automatically in `localStorage`. |

## 2. Step-by-Step Setup (3 Minutes)

### Step 1: Unzip & Open the Right Folder
Unzip `interview-ai-agent-v2.1.zip` and open the folder that directly contains `package.json` and `server.js` in VS Code (or `cd` into it in your terminal).

### Step 2: Add Email & Admin Settings to `.env`
Copy `.env.example` to `.env` (or add these lines to your existing `.env`):

```env
GEMINI_API_KEY=your-gemini-key

# Your own email address — unlocks the Admin Emails tab & signup alerts
ADMIN_EMAIL=you@example.com
APP_URL=http://localhost:3000

# Option A: Resend (free 3,000 emails/month) — https://resend.com/api-keys
RESEND_API_KEY=re_your_resend_key
FROM_EMAIL=Interview AI <onboarding@resend.dev>

# Option B: Brevo (free 300 emails/day) — https://app.brevo.com/settings/keys/api
# BREVO_API_KEY=xkeysib_your_brevo_key
# FROM_EMAIL=Interview AI <your-verified-sender@yourdomain.com>
```

> **Test immediately with zero email setup:** If you leave `RESEND_API_KEY` and `BREVO_API_KEY` commented out while running locally, the server automatically prints every 6-digit OTP and email preview right inside your VS Code terminal!

### Step 3: Get a Free Email API Key (For Real Inbox Delivery)
- **Resend (easiest):**
  1. Sign up free at `https://resend.com` → **API Keys** → **Create API Key**.
  2. Paste the key into `RESEND_API_KEY` in `.env`.
  3. On Resend's free sandbox (`onboarding@resend.dev`), you can test sending to your own Resend account email right away. To send OTPs and job alerts to *any* user's email address, add your domain in **Resend → Domains** (takes 2 DNS records) and set `FROM_EMAIL=Interview AI <alerts@yourdomain.com>`.
- **Brevo (alternative without a custom domain):**
  1. Sign up free at `https://www.brevo.com/` → **SMTP & API → API Keys → Generate**.
  2. Verify a single sender email in **Senders & IP**, then set `BREVO_API_KEY` and `FROM_EMAIL` in `.env`.

### Step 4: Run & Test
```powershell
npm start
```
1. Open `http://localhost:3000/register.html`.
2. Register using the exact email you set in `ADMIN_EMAIL`, click **Send Verification OTP**, enter the 6-digit code (from your inbox or VS Code terminal), and finish registering.
3. You'll now see the **Admin Emails** link in the top navigation bar (to view/export all registered emails and broadcast job alerts) and the **⬜ White BG / ⬛ Black BG** toggle next to the bell icon!
