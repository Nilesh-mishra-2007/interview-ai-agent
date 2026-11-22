// ALL API ENDPOINTS
// Pattern: add(METHOD, URL, handler, { login: true if authentication required })

const crypto = require("node:crypto");
const db = require("./db");
const auth = require("./auth");
const ai = require("./ai");
const github = require("./github");
const jobs = require("./jobs");
const mailer = require("./mailer");
const { createNotification, checkFollowUpReminders } = require("./notifications");
const { AppError } = require("./errors");

const routes = [];
function add(method, path, handler, options = {}) {
  routes.push({ method, path, handler, login: options.login === true });
}

const DAILY_AI_LIMIT = Number(process.env.DAILY_AI_LIMIT || process.env.DAILY_REPORT_LIMIT || 40);
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const VALID_APP_STATUSES = ["Saved", "Applied", "Screening", "Interview", "Offer", "Rejected"];
const OTP_TTL_MS = 10 * 60 * 1000;      // 10 minutes
const OTP_COOLDOWN_MS = 30 * 1000;      // 30 seconds between resends
const OTP_MAX_ATTEMPTS = 5;

// ---------- Helpers ----------

const str = (value, maxLen = 10000) =>
  typeof value === "string" ? value.trim().slice(0, maxLen) : "";

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const toIso = (sqliteTime) =>
  sqliteTime ? String(sqliteTime).replace(" ", "T") + (String(sqliteTime).includes("T") ? "" : "Z") : "";

function isAdminEmail(email) {
  const configured = String(process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 && configured.includes(String(email || "").toLowerCase());
}

function requireAdmin(ctx) {
  if (!ctx.user || !isAdminEmail(ctx.user.email)) {
    throw new AppError(403, "Admin access required. Set ADMIN_EMAIL in .env to your account email.");
  }
}

function startSession(ctx, userId) {
  const { token, maxAgeSeconds } = auth.createSession(userId);
  ctx.headers["Set-Cookie"] = auth.sessionCookie(token, maxAgeSeconds);
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function parsePdfBase64(base64) {
  if (!base64) return null;
  const buf = Buffer.from(String(base64), "base64");
  if (buf.length > MAX_PDF_BYTES) throw new AppError(413, "Resume PDF is too big (maximum 3 MB)");
  if (buf.subarray(0, 4).toString() !== "%PDF") throw new AppError(400, "Resume must be a valid PDF file");
  return buf;
}

function enforceDailyLimit(userId, action) {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ? AND created_at > datetime('now', '-1 day')")
    .get(userId);
  if (count >= DAILY_AI_LIMIT) {
    throw new AppError(429, `Daily AI limit reached (${DAILY_AI_LIMIT} generations/day). Please try again tomorrow.`);
  }
  db.prepare("INSERT INTO ai_usage (user_id, action) VALUES (?, ?)").run(userId, action);
}

function ensureProfile(userId) {
  db.prepare("INSERT OR IGNORE INTO profiles (user_id) VALUES (?)").run(userId);
  return db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId);
}

function findReport(ctx) {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT * FROM reports WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "Interview report not found");
  return row;
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- Accounts, Email OTP Verification & Auth ----------

add("POST", "/api/auth/send-otp", async (ctx) => {
  const username = str(ctx.body.username, 30);
  const email = str(ctx.body.email, 120).toLowerCase();

  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError(400, "Please enter a valid email address");

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) throw new AppError(400, "An account already exists with this email address");

  const now = Date.now();
  const prev = db.prepare("SELECT sent_at FROM email_otps WHERE email = ?").get(email);
  if (prev && now - prev.sent_at < OTP_COOLDOWN_MS) {
    const waitSec = Math.ceil((OTP_COOLDOWN_MS - (now - prev.sent_at)) / 1000);
    throw new AppError(429, `Please wait ${waitSec}s before requesting another OTP.`);
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const codeHash = sha256(`${email}:${otp}`);

  db.prepare(`
    INSERT INTO email_otps (email, code_hash, expires_at, attempts, sent_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(email) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      sent_at = excluded.sent_at
  `).run(email, codeHash, now + OTP_TTL_MS, now);

  const delivery = await mailer.sendOtpEmail({ to: email, username, otp });
  return {
    ok: true,
    mode: delivery.mode,
    message:
      delivery.mode === "console"
        ? "Dev mode: OTP printed in your server terminal (configure RESEND_API_KEY or BREVO_API_KEY for real emails)."
        : `Verification OTP sent to ${email}. Check your inbox (and spam folder).`,
  };
});

add("POST", "/api/auth/register", async (ctx) => {
  const username = str(ctx.body.username, 30);
  const email = str(ctx.body.email, 120).toLowerCase();
  const password = typeof ctx.body.password === "string" ? ctx.body.password : "";
  const otp = str(ctx.body.otp, 10);

  if (username.length < 2 || username.length > 30) throw new AppError(400, "Username must be 2 to 30 characters");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError(400, "Please enter a valid email address");
  if (password.length < 8) throw new AppError(400, "Password must be at least 8 characters");
  if (!/^\d{6}$/.test(otp)) throw new AppError(400, "Please enter the 6-digit verification OTP sent to your email");

  const otpRow = db.prepare("SELECT * FROM email_otps WHERE email = ?").get(email);
  if (!otpRow) throw new AppError(400, "Please request a verification OTP first");
  if (Date.now() > otpRow.expires_at) {
    db.prepare("DELETE FROM email_otps WHERE email = ?").run(email);
    throw new AppError(400, "OTP has expired. Please request a new code.");
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    db.prepare("DELETE FROM email_otps WHERE email = ?").run(email);
    throw new AppError(429, "Too many wrong OTP attempts. Please request a new code.");
  }

  const expectedHash = sha256(`${email}:${otp}`);
  const matches = crypto.timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(otpRow.code_hash, "hex"));
  if (!matches) {
    db.prepare("UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?").run(email);
    throw new AppError(400, "Invalid OTP code. Please check and try again.");
  }

  const exists = db.prepare("SELECT id FROM users WHERE email = ? OR username = ?").get(email, username);
  if (exists) throw new AppError(400, "An account already exists with this email or username");

  db.prepare("DELETE FROM email_otps WHERE email = ?").run(email);

  const result = db
    .prepare("INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, 1)")
    .run(username, email, await auth.hashPassword(password));
  const userId = Number(result.lastInsertRowid);
  ensureProfile(userId);

  createNotification(userId, {
    type: "system",
    title: "Welcome to Interview AI Career Agent!",
    message: "Link your GitHub & LinkedIn in Profile, set your target roles, and run your first AI Job Agent scan.",
    link: "/profile.html",
  });

  // Notify admin via email (fire-and-forget)
  mailer.sendAdminSignupAlert({ username, email }).catch(() => {});

  startSession(ctx, userId);
  ctx.status = 201;
  return { user: { id: userId, username, email } };
});

add("POST", "/api/auth/login", async (ctx) => {
  const email = str(ctx.body.email, 120).toLowerCase();
  const password = typeof ctx.body.password === "string" ? ctx.body.password : "";

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !(await auth.checkPassword(password, user.password_hash))) {
    throw new AppError(401, "Invalid email or password");
  }

  ensureProfile(user.id);
  startSession(ctx, user.id);
  return { user: { id: user.id, username: user.username, email: user.email } };
});

add("POST", "/api/auth/logout", async (ctx) => {
  auth.deleteSession(getCookie(ctx.req, "session"));
  ctx.headers["Set-Cookie"] = auth.clearCookie();
  return { message: "Logged out" };
});

add("GET", "/api/auth/me", async (ctx) => {
  checkFollowUpReminders(ctx.user.id);
  const { unread } = db
    .prepare("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0")
    .get(ctx.user.id);
  return {
    user: ctx.user,
    unreadNotifications: unread,
    isAdmin: isAdminEmail(ctx.user.email),
  };
}, { login: true });

// ---------- Admin Dashboard: Registered Email List, CSV Export & Job Broadcast ----------

add("GET", "/api/admin/users", async (ctx) => {
  requireAdmin(ctx);
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.email, u.email_verified, u.created_at,
      p.full_name, p.target_roles, p.skills, p.github_username, p.email_alerts_enabled
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    ORDER BY u.id DESC
  `).all();

  return {
    stats: {
      totalUsers: rows.length,
      verifiedUsers: rows.filter((r) => r.email_verified !== 0).length,
      emailOptIn: rows.filter((r) => r.email_alerts_enabled !== 0).length,
      emailProvider: mailer.getEmailProvider(),
    },
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      fullName: r.full_name || "",
      targetRoles: r.target_roles || "",
      skills: r.skills || "",
      githubUsername: r.github_username || "",
      emailVerified: r.email_verified !== 0,
      emailAlertsEnabled: r.email_alerts_enabled !== 0,
      createdAt: toIso(r.created_at),
    })),
  };
}, { login: true });

add("GET", "/api/admin/users.csv", async (ctx) => {
  requireAdmin(ctx);
  const rows = db.prepare(`
    SELECT u.id, u.username, u.email, u.email_verified, u.created_at,
           p.full_name, p.target_roles, p.skills, p.github_username, p.email_alerts_enabled
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    ORDER BY u.id DESC
  `).all();

  const header = ["ID", "Username", "Email", "Full Name", "Verified", "Email Alerts On", "Target Roles", "Skills", "GitHub", "Registered At"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.id, r.username, r.email, r.full_name || "",
      r.email_verified !== 0 ? "Yes" : "No",
      r.email_alerts_enabled !== 0 ? "Yes" : "No",
      r.target_roles || "", r.skills || "", r.github_username || "", toIso(r.created_at),
    ].map(csvEscape).join(","));
  }
  ctx.rawContentType = "text/csv; charset=utf-8";
  ctx.headers["Content-Disposition"] = 'attachment; filename="registered-users.csv"';
  return lines.join("\n");
}, { login: true });

add("POST", "/api/admin/broadcast-job", async (ctx) => {
  requireAdmin(ctx);
  const title = str(ctx.body.title, 160);
  const company = str(ctx.body.company, 120);
  const location = str(ctx.body.location, 120);
  const applyUrl = str(ctx.body.applyUrl, 500);
  const filterKeyword = str(ctx.body.filterKeyword, 80).toLowerCase();

  if (!title || !company || !applyUrl) {
    throw new AppError(400, "Job Title, Company, and Apply URL are required");
  }

  let recipients = db.prepare(`
    SELECT u.username, u.email, p.target_roles, p.skills
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE COALESCE(p.email_alerts_enabled, 1) = 1
  `).all();

  if (filterKeyword) {
    recipients = recipients.filter((r) =>
      `${r.target_roles || ""} ${r.skills || ""}`.toLowerCase().includes(filterKeyword)
    );
  }

  let sent = 0;
  let failed = 0;
  const jobPayload = [{ title, company, location, source: "Admin Job Alert", matchScore: 95, applyUrl }];

  for (const r of recipients) {
    try {
      await mailer.sendJobAlertEmail({ to: r.email, username: r.username, jobs: jobPayload });
      sent++;
    } catch {
      failed++;
    }
  }

  return {
    ok: true,
    sent,
    failed,
    message: `Sent job alert email to ${sent} registered user${sent === 1 ? "" : "s"}${failed ? ` (${failed} failed)` : ""}.`,
  };
}, { login: true });

// ---------- Connected Profile (GitHub + LinkedIn + Master Resume + Preferences) ----------

add("GET", "/api/profile", async (ctx) => {
  const p = ensureProfile(ctx.user.id);
  return {
    profile: {
      fullName: p.full_name || "",
      headline: p.headline || "",
      phone: p.phone || "",
      location: p.location || "",
      targetRoles: p.target_roles || "",
      skills: p.skills || "",
      experienceLevel: p.experience_level || "entry",
      preferredLocation: p.preferred_location || "Remote",
      workMode: p.work_mode || "any",
      minMatchScore: p.min_match_score ?? 65,
      autoScanEnabled: Boolean(p.auto_scan_enabled),
      emailAlertsEnabled: p.email_alerts_enabled !== 0,
      githubUsername: p.github_username || "",
      githubData: p.github_data ? JSON.parse(p.github_data) : null,
      githubSyncedAt: toIso(p.github_synced_at),
      linkedinUrl: p.linkedin_url || "",
      portfolioUrl: p.portfolio_url || "",
      bio: p.bio || "",
      hasMasterResume: Boolean(p.master_resume_pdf),
      masterResumeName: p.master_resume_name || "",
      atsBoards: p.ats_boards || "",
      webhookUrl: p.webhook_url || "",
      telegramChatId: p.telegram_chat_id || "",
    },
    apiStatus: {
      gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY),
      emailProvider: mailer.getEmailProvider(),
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      adzuna: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
      jsearch: Boolean(process.env.RAPIDAPI_KEY),
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    },
  };
}, { login: true });

add("PUT", "/api/profile", async (ctx) => {
  const existing = ensureProfile(ctx.user.id);
  const b = ctx.body;

  let masterResumePdf = existing.master_resume_pdf;
  let masterResumeName = existing.master_resume_name || "";
  if (b.removeMasterResume) {
    masterResumePdf = null;
    masterResumeName = "";
  } else if (b.masterResumeBase64) {
    masterResumePdf = parsePdfBase64(b.masterResumeBase64);
    masterResumeName = str(b.masterResumeName, 120) || "master-resume.pdf";
  }

  const minMatchScore = Math.max(0, Math.min(100, Math.round(Number(b.minMatchScore ?? existing.min_match_score ?? 65))));

  db.prepare(`
    UPDATE profiles SET
      full_name = ?, headline = ?, phone = ?, location = ?,
      target_roles = ?, skills = ?, experience_level = ?,
      preferred_location = ?, work_mode = ?, min_match_score = ?,
      auto_scan_enabled = ?, email_alerts_enabled = ?,
      github_username = ?, linkedin_url = ?,
      portfolio_url = ?, bio = ?, master_resume_pdf = ?, master_resume_name = ?,
      ats_boards = ?, webhook_url = ?, telegram_chat_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(
    str(b.fullName ?? existing.full_name, 120),
    str(b.headline ?? existing.headline, 160),
    str(b.phone ?? existing.phone, 40),
    str(b.location ?? existing.location, 120),
    str(b.targetRoles ?? existing.target_roles, 300),
    str(b.skills ?? existing.skills, 1000),
    str(b.experienceLevel ?? existing.experience_level, 30),
    str(b.preferredLocation ?? existing.preferred_location, 120),
    str(b.workMode ?? existing.work_mode, 30),
    minMatchScore,
    b.autoScanEnabled === false ? 0 : 1,
    b.emailAlertsEnabled === false ? 0 : 1,
    str(b.githubUsername ?? existing.github_username, 80),
    str(b.linkedinUrl ?? existing.linkedin_url, 250),
    str(b.portfolioUrl ?? existing.portfolio_url, 250),
    str(b.bio ?? existing.bio, 5000),
    masterResumePdf,
    masterResumeName,
    str(b.atsBoards ?? existing.ats_boards, 300),
    str(b.webhookUrl ?? existing.webhook_url, 300),
    str(b.telegramChatId ?? existing.telegram_chat_id, 60),
    ctx.user.id
  );

  return { ok: true, message: "Career profile saved." };
}, { login: true });

add("POST", "/api/profile/github-sync", async (ctx) => {
  const existing = ensureProfile(ctx.user.id);
  const input = str(ctx.body.githubUsername || existing.github_username, 120);
  if (!input) throw new AppError(400, "Please enter your GitHub username or profile URL");

  const ghData = await github.fetchGitHubProfile(input);

  let mergedSkills = existing.skills || "";
  if (!mergedSkills.trim() && ghData.topLanguages.length) {
    mergedSkills = [...new Set([...ghData.topLanguages, ...ghData.topics.slice(0, 8)])].join(", ");
  }

  db.prepare(`
    UPDATE profiles SET
      github_username = ?,
      github_data = ?,
      github_synced_at = CURRENT_TIMESTAMP,
      full_name = CASE WHEN full_name = '' THEN ? ELSE full_name END,
      location = CASE WHEN location = '' THEN ? ELSE location END,
      skills = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(
    ghData.username,
    JSON.stringify(ghData),
    ghData.name || "",
    ghData.location || "",
    mergedSkills,
    ctx.user.id
  );

  return { githubData: ghData, mergedSkills };
}, { login: true });

// ---------- Interview Strategy Reports ----------

add("POST", "/api/interviews", async (ctx) => {
  const jobDescription = str(ctx.body.jobDescription, 6000);
  const selfDescription = str(ctx.body.selfDescription, 5000);
  if (!jobDescription) throw new AppError(400, "Please paste the job description");

  const profile = ensureProfile(ctx.user.id);
  const resumePdf = ctx.body.resumeBase64
    ? parsePdfBase64(ctx.body.resumeBase64)
    : (ctx.body.useMasterResume !== false && profile.master_resume_pdf ? Buffer.from(profile.master_resume_pdf) : null);

  const extraContext = jobs.buildCandidateSummary(profile);
  if (!resumePdf && !selfDescription && !extraContext) {
    throw new AppError(400, "Please upload a resume, write a self-description, or fill out your Career Profile.");
  }

  enforceDailyLimit(ctx.user.id, "interview_report");
  const report = await ai.generateReport({ resumePdf, selfDescription, jobDescription, extraContext });

  const { technicalQuestions, behavioralQuestions, skillGaps, preparationPlan } = report;
  const result = db
    .prepare(`INSERT INTO reports
      (user_id, title, job_description, self_description, resume_pdf, match_score, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      ctx.user.id,
      report.title,
      jobDescription,
      selfDescription || extraContext,
      resumePdf,
      report.matchScore,
      JSON.stringify({ technicalQuestions, behavioralQuestions, skillGaps, preparationPlan })
    );

  ctx.status = 201;
  return { id: Number(result.lastInsertRowid) };
}, { login: true });

add("GET", "/api/interviews", async (ctx) => {
  const rows = db
    .prepare("SELECT id, title, match_score, created_at FROM reports WHERE user_id = ? ORDER BY id DESC")
    .all(ctx.user.id);
  return {
    reports: rows.map((r) => ({ id: r.id, title: r.title, matchScore: r.match_score, createdAt: toIso(r.created_at) })),
  };
}, { login: true });

add("GET", "/api/interviews/:id", async (ctx) => {
  const row = findReport(ctx);
  return {
    report: {
      id: row.id,
      title: row.title,
      jobDescription: row.job_description,
      matchScore: row.match_score,
      createdAt: toIso(row.created_at),
      ...JSON.parse(row.data),
    },
  };
}, { login: true });

add("POST", "/api/interviews/:id/resume", async (ctx) => {
  const row = findReport(ctx);
  if (row.resume_json && !ctx.body.regenerate) return { resume: JSON.parse(row.resume_json) };

  const profile = ensureProfile(ctx.user.id);
  enforceDailyLimit(ctx.user.id, "report_resume");
  const resume = await ai.generateResume({
    resumePdf: row.resume_pdf ? Buffer.from(row.resume_pdf) : (profile.master_resume_pdf ? Buffer.from(profile.master_resume_pdf) : null),
    selfDescription: row.self_description,
    jobDescription: row.job_description,
    extraContext: jobs.buildCandidateSummary(profile),
  });
  db.prepare("UPDATE reports SET resume_json = ? WHERE id = ?").run(JSON.stringify(resume), row.id);
  return { resume };
}, { login: true });

// ---------- Dedicated ATS-Friendly Resume Studio ----------

add("GET", "/api/ats", async (ctx) => {
  const rows = db
    .prepare("SELECT id, title, company, ats_score, created_at FROM ats_resumes WHERE user_id = ? ORDER BY id DESC")
    .all(ctx.user.id);
  return {
    resumes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      company: r.company,
      atsScore: r.ats_score,
      createdAt: toIso(r.created_at),
    })),
  };
}, { login: true });

add("POST", "/api/ats/generate", async (ctx) => {
  const jobDescription = str(ctx.body.jobDescription, 6000);
  const selfDescription = str(ctx.body.selfDescription, 5000);
  if (!jobDescription) throw new AppError(400, "Please paste a job description");

  const profile = ensureProfile(ctx.user.id);
  const resumePdf = ctx.body.resumeBase64
    ? parsePdfBase64(ctx.body.resumeBase64)
    : (profile.master_resume_pdf ? Buffer.from(profile.master_resume_pdf) : null);

  const extraContext = jobs.buildCandidateSummary(profile);
  if (!resumePdf && !selfDescription && !extraContext) {
    throw new AppError(400, "Upload a resume PDF, add a short bio, or link your GitHub in Profile first.");
  }

  enforceDailyLimit(ctx.user.id, "ats_resume");
  const bundle = await ai.generateAtsResume({ resumePdf, selfDescription, jobDescription, extraContext });

  const result = db.prepare(`
    INSERT INTO ats_resumes (user_id, title, company, job_description, ats_score, analysis_json, resume_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    ctx.user.id,
    str(ctx.body.title, 120) || bundle.title,
    str(ctx.body.company, 120) || bundle.company,
    jobDescription,
    bundle.atsAnalysis.overallScore,
    JSON.stringify(bundle.atsAnalysis),
    JSON.stringify(bundle.resume)
  );

  const id = Number(result.lastInsertRowid);
  ctx.status = 201;
  return {
    id,
    title: str(ctx.body.title, 120) || bundle.title,
    company: str(ctx.body.company, 120) || bundle.company,
    atsAnalysis: bundle.atsAnalysis,
    resume: bundle.resume,
  };
}, { login: true });

add("GET", "/api/ats/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT * FROM ats_resumes WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "ATS resume not found");
  return {
    item: {
      id: row.id,
      title: row.title,
      company: row.company,
      jobDescription: row.job_description,
      atsScore: row.ats_score,
      atsAnalysis: JSON.parse(row.analysis_json),
      resume: JSON.parse(row.resume_json),
      outreach: row.cover_letter_json ? JSON.parse(row.cover_letter_json) : null,
      createdAt: toIso(row.created_at),
    },
  };
}, { login: true });

add("PUT", "/api/ats/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT id FROM ats_resumes WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "ATS resume not found");
  if (!ctx.body.resume || typeof ctx.body.resume !== "object") {
    throw new AppError(400, "Invalid resume payload");
  }
  db.prepare("UPDATE ats_resumes SET resume_json = ? WHERE id = ?").run(JSON.stringify(ctx.body.resume), id);
  return { ok: true };
}, { login: true });

add("POST", "/api/ats/:id/outreach", async (ctx) => {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT * FROM ats_resumes WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "ATS resume not found");
  if (row.cover_letter_json && !ctx.body.regenerate) {
    return { outreach: JSON.parse(row.cover_letter_json) };
  }

  const profile = ensureProfile(ctx.user.id);
  enforceDailyLimit(ctx.user.id, "outreach_pack");
  const outreach = await ai.generateOutreachPack({
    resumePdf: profile.master_resume_pdf ? Buffer.from(profile.master_resume_pdf) : null,
    selfDescription: JSON.stringify(JSON.parse(row.resume_json)),
    jobDescription: row.job_description,
    extraContext: jobs.buildCandidateSummary(profile),
  });
  db.prepare("UPDATE ats_resumes SET cover_letter_json = ? WHERE id = ?").run(JSON.stringify(outreach), id);
  return { outreach };
}, { login: true });

add("DELETE", "/api/ats/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  db.prepare("DELETE FROM ats_resumes WHERE id = ? AND user_id = ?").run(id, ctx.user.id);
  return { ok: true };
}, { login: true });

// ---------- AI Job Discovery & Apply-Assist Agent ----------

add("GET", "/api/agent/jobs", async (ctx) => {
  const rows = db.prepare(`
    SELECT * FROM discovered_jobs
    WHERE user_id = ? AND status != 'dismissed'
    ORDER BY match_score DESC, id DESC
    LIMIT 60
  `).all(ctx.user.id);

  return {
    jobs: rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      company: r.company,
      location: r.location,
      workMode: r.work_mode,
      salary: r.salary,
      applyUrl: r.apply_url,
      description: r.description,
      postedAt: r.posted_at,
      matchScore: r.match_score,
      matchReason: r.match_reason,
      matchedSkills: JSON.parse(r.matched_skills || "[]"),
      missingSkills: JSON.parse(r.missing_skills || "[]"),
      status: r.status,
      applyPack: r.apply_pack_json ? JSON.parse(r.apply_pack_json) : null,
      discoveredAt: toIso(r.discovered_at),
    })),
  };
}, { login: true });

add("POST", "/api/agent/scan", async (ctx) => {
  enforceDailyLimit(ctx.user.id, "agent_scan");
  const customQuery = str(ctx.body.query, 120);
  const result = await jobs.runAgentScanForUser(ctx.user.id, { customQuery, notify: true });
  return result;
}, { login: true });

add("POST", "/api/agent/jobs/:id/prep", async (ctx) => {
  const id = Number(ctx.params.id);
  const job = Number.isInteger(id)
    ? db.prepare("SELECT * FROM discovered_jobs WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!job) throw new AppError(404, "Job not found");
  if (job.apply_pack_json && !ctx.body.regenerate) {
    return { applyPack: JSON.parse(job.apply_pack_json) };
  }

  const profile = ensureProfile(ctx.user.id);
  const extraContext = jobs.buildCandidateSummary(profile);
  const resumePdf = profile.master_resume_pdf ? Buffer.from(profile.master_resume_pdf) : null;

  enforceDailyLimit(ctx.user.id, "apply_pack");
  const [atsBundle, outreach] = await Promise.all([
    ai.generateAtsResume({ resumePdf, selfDescription: profile.bio || "", jobDescription: job.description, extraContext }),
    ai.generateOutreachPack({ resumePdf, selfDescription: profile.bio || "", jobDescription: job.description, extraContext }),
  ]);

  const atsRes = db.prepare(`
    INSERT INTO ats_resumes (user_id, title, company, job_description, ats_score, analysis_json, resume_json, cover_letter_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ctx.user.id,
    job.title,
    job.company,
    job.description,
    atsBundle.atsAnalysis.overallScore,
    JSON.stringify(atsBundle.atsAnalysis),
    JSON.stringify(atsBundle.resume),
    JSON.stringify(outreach)
  );

  const pack = {
    atsResumeId: Number(atsRes.lastInsertRowid),
    atsScore: atsBundle.atsAnalysis.overallScore,
    matchedKeywords: atsBundle.atsAnalysis.matchedKeywords,
    missingKeywords: atsBundle.atsAnalysis.missingKeywords,
    outreach,
  };

  db.prepare("UPDATE discovered_jobs SET apply_pack_json = ?, status = CASE WHEN status = 'new' THEN 'saved' ELSE status END WHERE id = ?")
    .run(JSON.stringify(pack), id);

  return { applyPack: pack };
}, { login: true });

add("POST", "/api/agent/jobs/:id/track", async (ctx) => {
  const id = Number(ctx.params.id);
  const job = Number.isInteger(id)
    ? db.prepare("SELECT * FROM discovered_jobs WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!job) throw new AppError(404, "Job not found");

  const status = VALID_APP_STATUSES.includes(ctx.body.status) ? ctx.body.status : "Applied";
  const appliedAt = status === "Applied" ? new Date().toISOString().slice(0, 10) : "";
  const pack = job.apply_pack_json ? JSON.parse(job.apply_pack_json) : null;

  const existingApp = db
    .prepare("SELECT id FROM applications WHERE user_id = ? AND discovered_job_id = ?")
    .get(ctx.user.id, id);

  let appId;
  if (existingApp) {
    db.prepare("UPDATE applications SET status = ?, applied_at = COALESCE(NULLIF(applied_at, ''), ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, appliedAt, existingApp.id);
    appId = existingApp.id;
  } else {
    const res = db.prepare(`
      INSERT INTO applications
        (user_id, discovered_job_id, ats_resume_id, company, role, location, salary, source, apply_url, job_description, match_score, status, applied_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ctx.user.id,
      id,
      pack?.atsResumeId || null,
      job.company,
      job.title,
      job.location,
      job.salary,
      job.source,
      job.apply_url,
      job.description,
      job.match_score,
      status,
      appliedAt,
      job.match_reason || ""
    );
    appId = Number(res.lastInsertRowid);
  }

  db.prepare("UPDATE discovered_jobs SET status = ? WHERE id = ?")
    .run(status === "Applied" ? "applied" : "saved", id);

  return { applicationId: appId, status };
}, { login: true });

add("POST", "/api/agent/jobs/:id/status", async (ctx) => {
  const id = Number(ctx.params.id);
  const status = ["new", "saved", "applied", "dismissed"].includes(ctx.body.status) ? ctx.body.status : "saved";
  db.prepare("UPDATE discovered_jobs SET status = ? WHERE id = ? AND user_id = ?").run(status, id, ctx.user.id);
  return { ok: true };
}, { login: true });

// ---------- Job Application Tracker & Pipeline Manager ----------

add("GET", "/api/applications", async (ctx) => {
  const rows = db
    .prepare("SELECT * FROM applications WHERE user_id = ? ORDER BY updated_at DESC, id DESC")
    .all(ctx.user.id);

  const stats = { total: rows.length, Saved: 0, Applied: 0, Screening: 0, Interview: 0, Offer: 0, Rejected: 0 };
  for (const r of rows) {
    if (stats[r.status] !== undefined) stats[r.status]++;
  }
  const submitted = stats.Applied + stats.Screening + stats.Interview + stats.Offer + stats.Rejected;
  const responses = stats.Screening + stats.Interview + stats.Offer;
  stats.responseRate = submitted > 0 ? Math.round((responses / submitted) * 100) : 0;

  return {
    stats,
    applications: rows.map((r) => ({
      id: r.id,
      discoveredJobId: r.discovered_job_id,
      reportId: r.report_id,
      atsResumeId: r.ats_resume_id,
      company: r.company,
      role: r.role,
      location: r.location,
      salary: r.salary,
      source: r.source,
      applyUrl: r.apply_url,
      jobDescription: r.job_description,
      matchScore: r.match_score,
      status: r.status,
      appliedAt: r.applied_at,
      followUpDate: r.follow_up_date,
      notes: r.notes,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    })),
  };
}, { login: true });

add("POST", "/api/applications", async (ctx) => {
  const b = ctx.body;
  const company = str(b.company, 120);
  const role = str(b.role, 160);
  if (!company || !role) throw new AppError(400, "Company and Role are required");

  const status = VALID_APP_STATUSES.includes(b.status) ? b.status : "Saved";
  const appliedAt = str(b.appliedAt, 20) || (status === "Applied" ? new Date().toISOString().slice(0, 10) : "");

  const res = db.prepare(`
    INSERT INTO applications
      (user_id, company, role, location, salary, source, apply_url, job_description, match_score, status, applied_at, follow_up_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ctx.user.id,
    company,
    role,
    str(b.location, 120),
    str(b.salary, 80),
    str(b.source, 60) || "Manual",
    str(b.applyUrl, 500),
    str(b.jobDescription, 6000),
    b.matchScore != null && b.matchScore !== "" ? Number(b.matchScore) : null,
    status,
    appliedAt,
    str(b.followUpDate, 20),
    str(b.notes, 2000)
  );

  ctx.status = 201;
  return { id: Number(res.lastInsertRowid) };
}, { login: true });

add("PATCH", "/api/applications/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  const existing = Number.isInteger(id)
    ? db.prepare("SELECT * FROM applications WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!existing) throw new AppError(404, "Application not found");

  const b = ctx.body;
  const status = b.status && VALID_APP_STATUSES.includes(b.status) ? b.status : existing.status;
  let appliedAt = b.appliedAt !== undefined ? str(b.appliedAt, 20) : existing.applied_at;
  if (status === "Applied" && !appliedAt) appliedAt = new Date().toISOString().slice(0, 10);

  db.prepare(`
    UPDATE applications SET
      company = ?, role = ?, location = ?, salary = ?, source = ?, apply_url = ?,
      job_description = ?, status = ?, applied_at = ?, follow_up_date = ?, notes = ?,
      ats_resume_id = COALESCE(?, ats_resume_id),
      report_id = COALESCE(?, report_id),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    b.company !== undefined ? str(b.company, 120) : existing.company,
    b.role !== undefined ? str(b.role, 160) : existing.role,
    b.location !== undefined ? str(b.location, 120) : existing.location,
    b.salary !== undefined ? str(b.salary, 80) : existing.salary,
    b.source !== undefined ? str(b.source, 60) : existing.source,
    b.applyUrl !== undefined ? str(b.applyUrl, 500) : existing.apply_url,
    b.jobDescription !== undefined ? str(b.jobDescription, 6000) : existing.job_description,
    status,
    appliedAt,
    b.followUpDate !== undefined ? str(b.followUpDate, 20) : existing.follow_up_date,
    b.notes !== undefined ? str(b.notes, 2000) : existing.notes,
    b.atsResumeId ?? null,
    b.reportId ?? null,
    id
  );

  return { ok: true };
}, { login: true });

add("DELETE", "/api/applications/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  db.prepare("DELETE FROM applications WHERE id = ? AND user_id = ?").run(id, ctx.user.id);
  return { ok: true };
}, { login: true });

add("GET", "/api/applications/export.csv", async (ctx) => {
  const rows = db
    .prepare("SELECT company, role, status, location, salary, source, match_score, applied_at, follow_up_date, apply_url, notes FROM applications WHERE user_id = ? ORDER BY id DESC")
    .all(ctx.user.id);

  const header = ["Company", "Role", "Status", "Location", "Salary", "Source", "Match Score", "Applied Date", "Follow-Up Date", "Apply URL", "Notes"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.company, r.role, r.status, r.location, r.salary, r.source,
      r.match_score ?? "", r.applied_at, r.follow_up_date, r.apply_url, r.notes,
    ].map(csvEscape).join(","));
  }
  ctx.rawContentType = "text/csv; charset=utf-8";
  ctx.headers["Content-Disposition"] = 'attachment; filename="job-applications.csv"';
  return lines.join("\n");
}, { login: true });

// ---------- Notifications ----------

add("GET", "/api/notifications", async (ctx) => {
  checkFollowUpReminders(ctx.user.id);
  const rows = db
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40")
    .all(ctx.user.id);
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      link: r.link,
      isRead: Boolean(r.is_read),
      createdAt: toIso(r.created_at),
    })),
  };
}, { login: true });

add("POST", "/api/notifications/read-all", async (ctx) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(ctx.user.id);
  return { ok: true };
}, { login: true });

add("POST", "/api/notifications/:id/read", async (ctx) => {
  const id = Number(ctx.params.id);
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(id, ctx.user.id);
  return { ok: true };
}, { login: true });

// ---------- Skill Learning Roadmaps ----------

add("GET", "/api/roadmaps", async (ctx) => {
  const rows = db
    .prepare("SELECT id, title, target_role, level, weeks, progress_json, data_json, created_at FROM roadmaps WHERE user_id = ? ORDER BY id DESC")
    .all(ctx.user.id);
  return {
    roadmaps: rows.map((r) => {
      const data = JSON.parse(r.data_json);
      const progress = JSON.parse(r.progress_json || "{}");
      const totalItems = (data.phases || []).reduce((acc, p) => acc + (p.topics?.length || 0) + 1, 0);
      const doneItems = Object.values(progress).filter(Boolean).length;
      return {
        id: r.id,
        title: r.title,
        targetRole: r.target_role,
        level: r.level,
        weeks: r.weeks,
        percentComplete: totalItems > 0 ? Math.min(100, Math.round((doneItems / totalItems) * 100)) : 0,
        createdAt: toIso(r.created_at),
      };
    }),
  };
}, { login: true });

add("POST", "/api/roadmaps/generate", async (ctx) => {
  const targetRole = str(ctx.body.targetRole, 180);
  const jobDescription = str(ctx.body.jobDescription, 5000);
  if (!targetRole && !jobDescription) {
    throw new AppError(400, "Enter a target role/skill or paste a job description");
  }

  const profile = ensureProfile(ctx.user.id);
  const level = ["beginner", "intermediate", "advanced"].includes(ctx.body.level) ? ctx.body.level : "intermediate";
  const weeks = Math.max(2, Math.min(24, Number(ctx.body.weeks) || 8));

  enforceDailyLimit(ctx.user.id, "roadmap");
  const roadmap = await ai.generateRoadmap({
    targetRole: targetRole || "Role from Job Description",
    currentSkills: str(ctx.body.currentSkills, 1000) || profile.skills || "",
    jobDescription,
    level,
    weeks,
    extraContext: jobs.buildCandidateSummary(profile),
  });

  const res = db.prepare(`
    INSERT INTO roadmaps (user_id, title, target_role, level, weeks, data_json, progress_json)
    VALUES (?, ?, ?, ?, ?, ?, '{}')
  `).run(ctx.user.id, roadmap.title, targetRole || roadmap.title, level, roadmap.estimatedWeeks, JSON.stringify(roadmap));

  ctx.status = 201;
  return { id: Number(res.lastInsertRowid), roadmap };
}, { login: true });

add("GET", "/api/roadmaps/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT * FROM roadmaps WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "Roadmap not found");
  return {
    roadmap: {
      id: row.id,
      title: row.title,
      targetRole: row.target_role,
      level: row.level,
      weeks: row.weeks,
      data: JSON.parse(row.data_json),
      progress: JSON.parse(row.progress_json || "{}"),
      createdAt: toIso(row.created_at),
    },
  };
}, { login: true });

add("PATCH", "/api/roadmaps/:id/progress", async (ctx) => {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT id, progress_json FROM roadmaps WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "Roadmap not found");

  const progress = JSON.parse(row.progress_json || "{}");
  const key = str(ctx.body.key, 80);
  if (!key) throw new AppError(400, "Missing progress key");
  progress[key] = Boolean(ctx.body.done);

  db.prepare("UPDATE roadmaps SET progress_json = ? WHERE id = ?").run(JSON.stringify(progress), id);
  return { progress };
}, { login: true });

add("DELETE", "/api/roadmaps/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  db.prepare("DELETE FROM roadmaps WHERE id = ? AND user_id = ?").run(id, ctx.user.id);
  return { ok: true };
}, { login: true });

// ---------- Interactive JD-Based AI Mock Interviewer ----------

add("GET", "/api/mock", async (ctx) => {
  const rows = db
    .prepare("SELECT id, title, interview_type, difficulty, max_questions, status, history_json, summary_json, created_at FROM mock_sessions WHERE user_id = ? ORDER BY id DESC")
    .all(ctx.user.id);
  return {
    sessions: rows.map((r) => {
      const history = JSON.parse(r.history_json || "[]");
      const summary = r.summary_json ? JSON.parse(r.summary_json) : null;
      return {
        id: r.id,
        title: r.title,
        interviewType: r.interview_type,
        difficulty: r.difficulty,
        answeredCount: history.filter((h) => h.answer).length,
        maxQuestions: r.max_questions,
        status: r.status,
        overallScore: summary?.overallScore ?? null,
        verdict: summary?.verdict ?? null,
        createdAt: toIso(r.created_at),
      };
    }),
  };
}, { login: true });

add("POST", "/api/mock/start", async (ctx) => {
  const jobDescription = str(ctx.body.jobDescription, 6000);
  if (!jobDescription) throw new AppError(400, "Please paste a job description to start the mock interview");

  const interviewType = ["mixed", "technical", "behavioral", "system_design"].includes(ctx.body.interviewType)
    ? ctx.body.interviewType
    : "mixed";
  const difficulty = ["junior", "mid", "senior"].includes(ctx.body.difficulty) ? ctx.body.difficulty : "mid";
  const maxQuestions = Math.max(3, Math.min(10, Number(ctx.body.maxQuestions) || 5));

  const profile = ensureProfile(ctx.user.id);
  enforceDailyLimit(ctx.user.id, "mock_start");

  const started = await ai.startMockInterview({
    jobDescription,
    interviewType,
    difficulty,
    candidateSummary: jobs.buildCandidateSummary(profile),
    resumePdf: profile.master_resume_pdf ? Buffer.from(profile.master_resume_pdf) : null,
  });

  const history = [
    {
      questionNumber: 1,
      topic: started.topic,
      question: started.firstQuestion,
      intro: started.interviewerIntro,
      answer: "",
      score: null,
      strengths: [],
      improvements: [],
      modelAnswer: "",
    },
  ];

  const res = db.prepare(`
    INSERT INTO mock_sessions (user_id, title, job_description, interview_type, difficulty, max_questions, history_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(ctx.user.id, started.title, jobDescription, interviewType, difficulty, maxQuestions, JSON.stringify(history));

  ctx.status = 201;
  return { id: Number(res.lastInsertRowid), session: { id: Number(res.lastInsertRowid), title: started.title, interviewType, difficulty, maxQuestions, status: "active", history, summary: null } };
}, { login: true });

add("GET", "/api/mock/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT * FROM mock_sessions WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "Mock interview session not found");
  return {
    session: {
      id: row.id,
      title: row.title,
      jobDescription: row.job_description,
      interviewType: row.interview_type,
      difficulty: row.difficulty,
      maxQuestions: row.max_questions,
      status: row.status,
      history: JSON.parse(row.history_json || "[]"),
      summary: row.summary_json ? JSON.parse(row.summary_json) : null,
      createdAt: toIso(row.created_at),
    },
  };
}, { login: true });

add("POST", "/api/mock/:id/answer", async (ctx) => {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? db.prepare("SELECT * FROM mock_sessions WHERE id = ? AND user_id = ?").get(id, ctx.user.id)
    : null;
  if (!row) throw new AppError(404, "Mock interview session not found");
  if (row.status === "completed") throw new AppError(400, "This mock interview is already completed");

  const answer = str(ctx.body.answer, 4000);
  if (!answer) throw new AppError(400, "Please enter your answer");

  const history = JSON.parse(row.history_json || "[]");
  const current = history[history.length - 1];
  const isFinalQuestion = history.length >= row.max_questions || Boolean(ctx.body.finishNow);

  const profile = ensureProfile(ctx.user.id);
  enforceDailyLimit(ctx.user.id, "mock_answer");

  const evaluation = await ai.evaluateMockAnswer({
    jobDescription: row.job_description,
    interviewType: row.interview_type,
    difficulty: row.difficulty,
    candidateSummary: jobs.buildCandidateSummary(profile),
    history: history.slice(0, -1),
    currentQuestion: current.question,
    userAnswer: answer,
    isFinalQuestion,
  });

  current.answer = answer;
  current.score = evaluation.score;
  current.strengths = evaluation.strengths;
  current.improvements = evaluation.improvements;
  current.modelAnswer = evaluation.modelAnswer;

  let nextStatus = "active";
  let summaryJson = null;

  if (isFinalQuestion || !evaluation.nextQuestion) {
    nextStatus = "completed";
    summaryJson = JSON.stringify(evaluation.sessionSummary);
  } else {
    history.push({
      questionNumber: history.length + 1,
      topic: evaluation.nextTopic,
      question: evaluation.nextQuestion,
      answer: "",
      score: null,
      strengths: [],
      improvements: [],
      modelAnswer: "",
    });
  }

  db.prepare("UPDATE mock_sessions SET history_json = ?, summary_json = ?, status = ? WHERE id = ?")
    .run(JSON.stringify(history), summaryJson, nextStatus, id);

  return {
    status: nextStatus,
    history,
    summary: evaluation.sessionSummary,
  };
}, { login: true });

add("DELETE", "/api/mock/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  db.prepare("DELETE FROM mock_sessions WHERE id = ? AND user_id = ?").run(id, ctx.user.id);
  return { ok: true };
}, { login: true });

// ---------- Health Check ----------

add("GET", "/api/health", async () => ({ ok: true, version: "2.1.0" }));

module.exports = { routes, getCookie };
