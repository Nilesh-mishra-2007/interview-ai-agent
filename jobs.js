// LIVE JOB DISCOVERY ENGINE
// Fetches real jobs from free public APIs (Remotive, Arbeitnow) + optional
// Adzuna, JSearch (RapidAPI: LinkedIn/Indeed/Glassdoor/Naukri), and public
// Greenhouse/Lever company ATS boards — all with Node's built-in fetch().
// Automatically sends in-app + Email + Discord/Slack/Telegram alerts on high matches!

const db = require("./db");
const ai = require("./ai");
const mailer = require("./mailer");
const { formatGitHubForAI } = require("./github");
const { createNotification, checkFollowUpReminders } = require("./notifications");

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 1. Remotive (FREE, no API key required)
async function fetchRemotive(query) {
  try {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=15`;
    const data = await fetchJson(url);
    return (data.jobs || []).map((j) => ({
      externalId: `remotive:${j.id}`,
      source: "Remotive",
      title: j.title || "Untitled Role",
      company: j.company_name || "Unknown Company",
      location: j.candidate_required_location || "Remote",
      workMode: "Remote",
      salary: j.salary || "",
      applyUrl: j.url || "",
      description: stripHtml(j.description).slice(0, 3500),
      postedAt: j.publication_date || "",
    }));
  } catch (err) {
    console.warn("Remotive fetch skipped:", err.message);
    return [];
  }
}

// 2. Arbeitnow (FREE, no API key required)
async function fetchArbeitnow() {
  try {
    const data = await fetchJson("https://www.arbeitnow.com/api/job-board-api");
    return (data.data || []).slice(0, 25).map((j) => ({
      externalId: `arbeitnow:${j.slug}`,
      source: "Arbeitnow",
      title: j.title || "Untitled Role",
      company: j.company_name || "Unknown Company",
      location: j.location || (j.remote ? "Remote" : ""),
      workMode: j.remote ? "Remote" : "Onsite/Hybrid",
      salary: "",
      applyUrl: j.url || "",
      description: stripHtml(j.description).slice(0, 3500),
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : "",
    }));
  } catch (err) {
    console.warn("Arbeitnow fetch skipped:", err.message);
    return [];
  }
}

// 3. Adzuna (OPTIONAL — free developer API key in .env)
async function fetchAdzuna(query, location) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return [];

  const country = (process.env.ADZUNA_COUNTRY || "in").toLowerCase();
  try {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: "15",
      what: query,
    });
    if (location && location.toLowerCase() !== "remote" && location.toLowerCase() !== "any") {
      params.set("where", location);
    }
    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`;
    const data = await fetchJson(url);
    return (data.results || []).map((j) => ({
      externalId: `adzuna:${j.id}`,
      source: `Adzuna (${country.toUpperCase()})`,
      title: j.title || "Untitled Role",
      company: j.company?.display_name || "Unknown Company",
      location: j.location?.display_name || "",
      workMode: /remote/i.test(`${j.title} ${j.description}`) ? "Remote" : "Onsite/Hybrid",
      salary: j.salary_min || j.salary_max
        ? `${j.salary_min ? Math.round(j.salary_min) : "?"} - ${j.salary_max ? Math.round(j.salary_max) : "?"}`
        : "",
      applyUrl: j.redirect_url || "",
      description: stripHtml(j.description).slice(0, 3500),
      postedAt: j.created || "",
    }));
  } catch (err) {
    console.warn("Adzuna fetch skipped:", err.message);
    return [];
  }
}

// 4. JSearch via RapidAPI (OPTIONAL — aggregates LinkedIn, Indeed, Glassdoor, Naukri)
async function fetchJSearch(query, location) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return [];

  try {
    const fullQuery = location && location.toLowerCase() !== "any" ? `${query} in ${location}` : query;
    const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(fullQuery)}&num_pages=1&date_posted=week`;
    const data = await fetchJson(url, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
      },
    });
    return (data.data || []).slice(0, 15).map((j) => ({
      externalId: `jsearch:${j.job_id}`,
      source: j.job_publisher || "JSearch",
      title: j.job_title || "Untitled Role",
      company: j.employer_name || "Unknown Company",
      location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || (j.job_is_remote ? "Remote" : ""),
      workMode: j.job_is_remote ? "Remote" : "Onsite/Hybrid",
      salary: j.job_min_salary || j.job_max_salary
        ? `${j.job_salary_currency || ""} ${j.job_min_salary || "?"}-${j.job_max_salary || "?"}`.trim()
        : "",
      applyUrl: j.job_apply_link || j.job_google_link || "",
      description: stripHtml(j.job_description).slice(0, 3500),
      postedAt: j.job_posted_at_datetime_utc || "",
    }));
  } catch (err) {
    console.warn("JSearch fetch skipped:", err.message);
    return [];
  }
}

// 5. Custom Company ATS Boards (Greenhouse & Lever)
async function fetchCustomAtsBoards(atsBoardsText) {
  const entries = String(atsBoardsText || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

  const jobs = [];
  for (const entry of entries) {
    const [provider, slug] = entry.split(":").map((s) => s.trim().toLowerCase());
    if (!provider || !slug || !/^[a-z0-9-_]+$/.test(slug)) continue;
    try {
      if (provider === "greenhouse") {
        const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
        for (const j of (data.jobs || []).slice(0, 15)) {
          jobs.push({
            externalId: `gh:${slug}:${j.id}`,
            source: `Greenhouse (${slug})`,
            title: j.title || "Untitled Role",
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            location: j.location?.name || "",
            workMode: /remote/i.test(j.location?.name || "") ? "Remote" : "Onsite/Hybrid",
            salary: "",
            applyUrl: j.absolute_url || "",
            description: stripHtml(j.content).slice(0, 3500),
            postedAt: j.updated_at || "",
          });
        }
      } else if (provider === "lever") {
        const data = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
        for (const j of (Array.isArray(data) ? data : []).slice(0, 15)) {
          jobs.push({
            externalId: `lever:${slug}:${j.id}`,
            source: `Lever (${slug})`,
            title: j.text || "Untitled Role",
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            location: j.categories?.location || "",
            workMode: j.workplaceType || "",
            salary: "",
            applyUrl: j.hostedUrl || j.applyUrl || "",
            description: stripHtml(j.descriptionPlain || j.description).slice(0, 3500),
            postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : "",
          });
        }
      }
    } catch (err) {
      console.warn(`ATS board ${entry} skipped:`, err.message);
    }
  }
  return jobs;
}

function keywordScore(job, keywords) {
  if (!keywords.length) return 1;
  const haystack = `${job.title} ${job.description} ${job.location}`.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (kw.length >= 2 && haystack.includes(kw)) hits += job.title.toLowerCase().includes(kw) ? 3 : 1;
  }
  return hits;
}

function buildCandidateSummary(profile) {
  const parts = [];
  if (profile.full_name) parts.push(`Name: ${profile.full_name}`);
  if (profile.headline) parts.push(`Headline: ${profile.headline}`);
  if (profile.target_roles) parts.push(`Target Roles: ${profile.target_roles}`);
  if (profile.experience_level) parts.push(`Experience Level: ${profile.experience_level}`);
  if (profile.skills) parts.push(`Skills: ${profile.skills}`);
  if (profile.bio) parts.push(`Background & Summary:\n${profile.bio}`);
  if (profile.linkedin_url) parts.push(`LinkedIn: ${profile.linkedin_url}`);
  if (profile.portfolio_url) parts.push(`Portfolio: ${profile.portfolio_url}`);
  const gh = formatGitHubForAI(profile.github_data);
  if (gh) parts.push(gh);
  return parts.join("\n\n");
}

async function runAgentScanForUser(userId, { customQuery = "", notify = true } = {}) {
  checkFollowUpReminders(userId);

  const profile = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId);
  if (!profile) {
    return { scanned: 0, added: 0, highMatches: 0, message: "Please save your Career Profile first." };
  }

  const primaryRole = (customQuery || profile.target_roles || profile.headline || "software engineer")
    .split(",")[0]
    .trim();
  const location = (profile.preferred_location || "Remote").trim();

  const keywords = `${customQuery} ${profile.target_roles || ""} ${profile.skills || ""}`
    .toLowerCase()
    .split(/[,;|\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  const batches = await Promise.all([
    fetchRemotive(primaryRole),
    fetchArbeitnow(),
    fetchAdzuna(primaryRole, location),
    fetchJSearch(primaryRole, location),
    fetchCustomAtsBoards(profile.ats_boards),
  ]);

  const allRaw = batches.flat().filter((j) => j.applyUrl && j.title);

  const existingIds = new Set(
    db.prepare("SELECT external_id FROM discovered_jobs WHERE user_id = ?")
      .all(userId)
      .map((r) => r.external_id)
  );

  let candidates = allRaw.filter((j) => !existingIds.has(j.externalId));

  if (profile.work_mode === "remote") {
    const remoteOnly = candidates.filter((j) => /remote/i.test(`${j.workMode} ${j.location} ${j.title}`));
    if (remoteOnly.length) candidates = remoteOnly;
  }

  candidates = candidates
    .map((j) => ({ ...j, _kw: keywordScore(j, keywords) }))
    .sort((a, b) => b._kw - a._kw)
    .slice(0, 10);

  if (candidates.length === 0) {
    return { scanned: allRaw.length, added: 0, highMatches: 0, message: "No new unseen jobs found right now." };
  }

  const candidateSummary = buildCandidateSummary(profile);
  const scores = await ai.scoreJobsBatch({
    candidateSummary,
    resumePdf: profile.master_resume_pdf ? Buffer.from(profile.master_resume_pdf) : null,
    jobs: candidates,
  });

  const scoreById = new Map(scores.map((s) => [String(s.externalId), s]));
  const minScore = Number(profile.min_match_score || 65);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO discovered_jobs
      (user_id, external_id, source, title, company, location, work_mode, salary, apply_url, description, posted_at, match_score, match_reason, matched_skills, missing_skills)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  const highMatches = [];

  for (const job of candidates) {
    const scored = scoreById.get(job.externalId) || {
      matchScore: Math.min(80, 40 + job._kw * 5),
      reason: "Matched based on your target role and skill keywords.",
      matchedSkills: [],
      missingSkills: [],
    };
    const matchScore = Math.max(0, Math.min(100, Math.round(Number(scored.matchScore) || 0)));

    const res = insert.run(
      userId,
      job.externalId,
      job.source,
      job.title,
      job.company,
      job.location,
      job.workMode,
      job.salary,
      job.applyUrl,
      job.description,
      job.postedAt,
      matchScore,
      String(scored.reason || ""),
      JSON.stringify(Array.isArray(scored.matchedSkills) ? scored.matchedSkills : []),
      JSON.stringify(Array.isArray(scored.missingSkills) ? scored.missingSkills : [])
    );

    if (res.changes > 0) {
      added++;
      if (matchScore >= minScore) highMatches.push({ ...job, matchScore });
    }
  }

  if (notify && highMatches.length > 0) {
    highMatches.sort((a, b) => b.matchScore - a.matchScore);
    const top = highMatches[0];
    createNotification(userId, {
      type: "job_match",
      title: `${highMatches.length} new matching job${highMatches.length > 1 ? "s" : ""} found!`,
      message: `Top match (${top.matchScore}%): ${top.title} at ${top.company} (${top.source}). Open AI Job Agent to prep your application pack.`,
      link: "/agent.html",
      pushExternal: true,
    });

    // Automatically send Job Alert email to the registered user if enabled
    if (profile.email_alerts_enabled !== 0) {
      const user = db.prepare("SELECT username, email FROM users WHERE id = ?").get(userId);
      if (user?.email) {
        mailer
          .sendJobAlertEmail({ to: user.email, username: user.username, jobs: highMatches.slice(0, 5) })
          .catch((err) => console.error(`Job alert email failed for ${user.email}:`, err.message));
      }
    }
  }

  return {
    scanned: allRaw.length,
    added,
    highMatches: highMatches.length,
    message: `Scanned ${allRaw.length} listings, added ${added} new jobs (${highMatches.length} strong matches ≥ ${minScore}%).`,
  };
}

function startBackgroundAgent() {
  const minutes = Number(process.env.AGENT_POLL_MINUTES ?? 60);
  if (!minutes || minutes <= 0) return;

  const intervalMs = Math.max(10, minutes) * 60 * 1000;
  console.log(`AI Career Agent background scanner enabled (every ${Math.max(10, minutes)} min).`);

  setInterval(async () => {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENAI_API_KEY) return;
    const users = db.prepare(
      "SELECT user_id FROM profiles WHERE auto_scan_enabled = 1 AND (target_roles != '' OR skills != '')"
    ).all();
    for (const { user_id } of users) {
      try {
        await runAgentScanForUser(user_id, { notify: true });
      } catch (err) {
        console.error(`Background scan failed for user ${user_id}:`, err.message);
      }
    }
  }, intervalMs).unref();
}

module.exports = { runAgentScanForUser, startBackgroundAgent, buildCandidateSummary };
