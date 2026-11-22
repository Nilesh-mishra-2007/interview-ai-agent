// GITHUB INTEGRATION: fetches a user's public GitHub profile and top repositories
// using Node's built-in fetch(). No npm packages needed.
// Optional: set GITHUB_TOKEN in .env to raise rate limit from 60/hr to 5,000/hr.

const { AppError } = require("./errors");

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Interview-AI-Career-Agent",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

// Accepts either "octocat" or "https://github.com/octocat"
function cleanUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const match = raw.match(/github\.com\/([A-Za-z0-9-]+)(?:\/|$)/i);
  const username = match ? match[1] : raw.replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(username)) {
    throw new AppError(400, "Invalid GitHub username. Example: octocat or https://github.com/octocat");
  }
  return username;
}

async function fetchGitHubProfile(input) {
  const username = cleanUsername(input);
  const headers = githubHeaders();

  let userRes, reposRes;
  try {
    [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      }),
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=20&type=owner`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      }),
    ]);
  } catch (err) {
    console.error("GitHub fetch failed:", err.message);
    throw new AppError(502, "Could not reach GitHub API. Please try again.");
  }

  if (userRes.status === 404) {
    throw new AppError(404, `GitHub user "${username}" was not found.`);
  }
  if (userRes.status === 403) {
    throw new AppError(429, "GitHub API rate limit reached. Add GITHUB_TOKEN to .env or try again later.");
  }
  if (!userRes.ok) {
    throw new AppError(502, `GitHub API error (HTTP ${userRes.status}).`);
  }

  const user = await userRes.json();
  const rawRepos = reposRes.ok ? await reposRes.json() : [];

  const ownRepos = (Array.isArray(rawRepos) ? rawRepos : [])
    .filter((r) => !r.fork)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0) || String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 12);

  const languageCounts = {};
  const topicSet = new Set();

  const repos = ownRepos.map((r) => {
    if (r.language) languageCounts[r.language] = (languageCounts[r.language] || 0) + 1;
    if (Array.isArray(r.topics)) r.topics.forEach((t) => topicSet.add(t));
    return {
      name: r.name,
      description: r.description || "",
      language: r.language || "",
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      url: r.html_url,
      homepage: r.homepage || "",
      topics: Array.isArray(r.topics) ? r.topics.slice(0, 6) : [],
      updatedAt: r.updated_at,
    };
  });

  const topLanguages = Object.entries(languageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);

  return {
    username: user.login,
    name: user.name || "",
    bio: user.bio || "",
    company: user.company || "",
    location: user.location || "",
    blog: user.blog || "",
    profileUrl: user.html_url,
    avatarUrl: user.avatar_url || "",
    publicRepos: user.public_repos || 0,
    followers: user.followers || 0,
    topLanguages,
    topics: [...topicSet].slice(0, 20),
    repos,
  };
}

// Formats synced GitHub data into a concise text block for Gemini prompts.
function formatGitHubForAI(githubJson) {
  if (!githubJson) return "";
  let g;
  try {
    g = typeof githubJson === "string" ? JSON.parse(githubJson) : githubJson;
  } catch {
    return "";
  }
  if (!g || !g.username) return "";

  const lines = [
    `GitHub Profile: ${g.profileUrl} (${g.publicRepos || 0} public repos, ${g.followers || 0} followers)`,
  ];
  if (g.bio) lines.push(`GitHub Bio: ${g.bio}`);
  if (g.topLanguages?.length) lines.push(`Top GitHub Languages: ${g.topLanguages.join(", ")}`);
  if (g.topics?.length) lines.push(`GitHub Topics: ${g.topics.join(", ")}`);
  if (Array.isArray(g.repos) && g.repos.length) {
    lines.push("Notable GitHub Projects:");
    for (const r of g.repos.slice(0, 8)) {
      const meta = [r.language, r.stars ? `${r.stars}★` : ""].filter(Boolean).join(", ");
      lines.push(`- ${r.name}${meta ? ` (${meta})` : ""}: ${r.description || "No description"} [${r.url}]`);
    }
  }
  return lines.join("\n");
}

module.exports = { fetchGitHubProfile, formatGitHubForAI, cleanUsername };
