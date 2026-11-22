// INTERVIEW AI CAREER AGENT v2.1 — BROWSER APP
// Includes: Black/White BG Toggle, Email OTP Registration, Admin Email List + Broadcast,
// GitHub Sync, AI Job Agent, Tracker, ATS Resume Studio, Skill Roadmaps, and Mock Interviewer.

const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "checked" || key === "disabled" || key === "selected") {
      node[key] = Boolean(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

async function api(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Something went wrong. Please try again.");
  return data;
}

function showError(message) {
  const box = $("#error");
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function hideError() {
  const box = $("#error");
  if (box) box.hidden = true;
}

function showOverlay(msg) {
  const ov = $("#overlay");
  if (!ov) return;
  if ($("#overlay-text") && msg) $("#overlay-text").textContent = msg;
  ov.hidden = false;
}

function hideOverlay() {
  const ov = $("#overlay");
  if (ov) ov.hidden = true;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function scoreClass(score) {
  return score >= 80 ? "score--high" : score >= 60 ? "score--mid" : "score--low";
}

const queryParam = (name) => new URLSearchParams(location.search).get(name);

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "✓ Copied";
      setTimeout(() => (btn.textContent = prev), 1500);
    }
  } catch {
    alert("Could not copy automatically. Please select and copy manually.");
  }
}

function safeHref(url) {
  const s = String(url || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

// ---------- Black / White Background Mode Toggle ----------

function applySavedBgMode() {
  const mode = localStorage.getItem("bg_mode") || "black";
  document.body.classList.toggle("bg-white", mode === "white");
  return mode;
}

function createBgToggleButton(extraClass = "") {
  const getLabel = () => (document.body.classList.contains("bg-white") ? "⬛ Black BG" : "⬜ White BG");
  const btn = el("button", {
    class: `notif-btn ${extraClass}`.trim(),
    type: "button",
    title: "Switch background between Black and White",
    onClick: () => {
      const nextWhite = !document.body.classList.contains("bg-white");
      document.body.classList.toggle("bg-white", nextWhite);
      localStorage.setItem("bg_mode", nextWhite ? "white" : "black");
      btn.textContent = getLabel();
    },
  }, getLabel());
  return btn;
}

applySavedBgMode();

// ---------- Auth & Unified Navigation Bar + Notifications ----------

async function requireLogin() {
  try {
    const data = await api("/api/auth/me");
    renderTopbar(data.user, data.unreadNotifications || 0, Boolean(data.isAdmin));
    return data;
  } catch {
    location.href = "/login.html";
    return new Promise(() => {});
  }
}

function renderTopbar(user, unreadCount, isAdmin) {
  const mount = $("#app-topbar");
  if (!mount) return;
  const page = document.body.dataset.page;

  const links = [
    ["home", "/", "Interview Plans"],
    ["agent", "/agent.html", "AI Job Agent"],
    ["tracker", "/tracker.html", "Job Tracker"],
    ["ats", "/ats-resume.html", "ATS Resume"],
    ["roadmaps", "/roadmaps.html", "Roadmaps"],
    ["mock", "/mock.html", "Mock Interview"],
    ["profile", "/profile.html", "Profile"],
  ];
  if (isAdmin) links.push(["admin", "/admin.html", "Admin Emails"]);

  const badge = unreadCount > 0 ? el("span", { class: "notif-badge", id: "notif-badge" }, String(unreadCount)) : null;
  const notifPanel = el("div", { class: "notif-panel", id: "notif-panel", hidden: "hidden" });

  async function toggleNotifs() {
    if (!notifPanel.hidden) {
      notifPanel.hidden = true;
      return;
    }
    notifPanel.hidden = false;
    notifPanel.replaceChildren(el("p", { class: "muted" }, "Loading alerts..."));
    try {
      const { notifications } = await api("/api/notifications");
      const header = el("div", { class: "card__head" },
        el("strong", {}, "Job & Agent Alerts"),
        el("button", {
          class: "link-button",
          type: "button",
          onClick: async () => {
            await api("/api/notifications/read-all", { method: "POST" });
            const b = $("#notif-badge");
            if (b) b.remove();
            toggleNotifs();
          },
        }, "Mark all read")
      );
      if (!notifications.length) {
        notifPanel.replaceChildren(header, el("p", { class: "muted" }, "No alerts yet. Run an AI Job Scan to get notified!"));
        return;
      }
      notifPanel.replaceChildren(
        header,
        ...notifications.map((n) =>
          el("div", { class: `notif-item ${n.isRead ? "" : "notif-item--unread"}` },
            el("span", { class: "notif-item__title" }, n.title),
            el("span", { class: "notif-item__msg" }, n.message),
            el("div", { class: "inline-row" },
              n.link && el("a", {
                href: n.link,
                onClick: () => api(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {}),
              }, "Open →"),
              el("span", { class: "muted" }, new Date(n.createdAt).toLocaleDateString())
            )
          )
        )
      );
    } catch {
      notifPanel.replaceChildren(el("p", { class: "error" }, "Could not load alerts."));
    }
  }

  mount.replaceChildren(
    el("div", { class: "topbar" },
      el("a", { class: "brand", href: "/" }, "Interview ", el("span", { class: "highlight" }, "AI")),
      el("nav", { class: "nav-links" },
        ...links.map(([key, href, label]) =>
          el("a", { class: `nav-link ${page === key ? "nav-link--active" : ""}`, href }, label)
        )
      ),
      el("div", { class: "topbar__right" },
        createBgToggleButton(),
        el("button", { class: "notif-btn", type: "button", onClick: toggleNotifs, title: "Job Alerts" }, "🔔", badge),
        notifPanel,
        el("span", { class: "muted" }, user.username),
        el("button", {
          class: "link-button",
          type: "button",
          onClick: async () => {
            await api("/api/auth/logout", { method: "POST" });
            location.href = "/login.html";
          },
        }, "Log out")
      )
    )
  );
}

// ---------- Shared ATS Resume Paper Renderer + Plain Text Exporter ----------

function renderResumePaper(paperEl, resume) {
  const section = (title, ...content) => {
    const items = content.flat().filter(Boolean);
    return items.length ? el("section", {}, el("h2", {}, title), ...items) : null;
  };

  const contact = [resume.email, resume.phone, resume.location, ...(resume.links || [])]
    .filter(Boolean)
    .join("  |  ");

  paperEl.replaceChildren(
    ...[
      el("h1", {}, resume.fullName || "Your Name"),
      resume.headline && el("p", { class: "headline" }, resume.headline),
      contact && el("p", { class: "contact" }, contact),
      resume.summary && section("Professional Summary", el("p", {}, resume.summary)),
      section(
        "Technical Skills",
        (resume.skills || []).map((s) =>
          el("p", {}, el("strong", {}, s.category ? `${s.category}: ` : ""), (s.items || []).join(", "))
        )
      ),
      section(
        "Experience",
        (resume.experience || []).map((job) =>
          el("div", { class: "entry" },
            el("div", { class: "entry__head" },
              el("strong", {}, [job.role, job.company].filter(Boolean).join(" — ")),
              el("span", {}, job.period || "")
            ),
            el("ul", {}, ...(job.bullets || []).map((b) => el("li", {}, b)))
          )
        )
      ),
      section(
        "Projects",
        (resume.projects || []).map((p) =>
          el("div", { class: "entry" },
            el("div", { class: "entry__head" },
              el("strong", {}, p.name || ""),
              p.techStack && el("span", {}, p.techStack)
            ),
            el("p", {}, [p.description, p.link].filter(Boolean).join(" — "))
          )
        )
      ),
      section(
        "Education",
        (resume.education || []).map((e) =>
          el("div", { class: "entry__head" },
            el("span", {}, [e.degree, e.institution].filter(Boolean).join(", ")),
            el("span", {}, e.period || "")
          )
        )
      ),
      section(
        "Certifications & Achievements",
        (resume.certifications || []).length
          ? el("ul", {}, ...(resume.certifications || []).map((c) => el("li", {}, c)))
          : null
      ),
    ].filter(Boolean)
  );
}

function resumeToPlainText(r) {
  const lines = [];
  lines.push((r.fullName || "YOUR NAME").toUpperCase());
  if (r.headline) lines.push(r.headline);
  const contact = [r.email, r.phone, r.location, ...(r.links || [])].filter(Boolean).join(" | ");
  if (contact) lines.push(contact);
  if (r.summary) lines.push("", "PROFESSIONAL SUMMARY", r.summary);
  if (r.skills?.length) {
    lines.push("", "TECHNICAL SKILLS");
    r.skills.forEach((s) => lines.push(`${s.category ? s.category + ": " : ""}${(s.items || []).join(", ")}`));
  }
  if (r.experience?.length) {
    lines.push("", "EXPERIENCE");
    r.experience.forEach((e) => {
      lines.push(`${e.role} — ${e.company} (${e.period || ""})`);
      (e.bullets || []).forEach((b) => lines.push(`- ${b}`));
    });
  }
  if (r.projects?.length) {
    lines.push("", "PROJECTS");
    r.projects.forEach((p) => {
      lines.push(`${p.name}${p.techStack ? ` [${p.techStack}]` : ""}`);
      lines.push(`- ${p.description}${p.link ? ` (${p.link})` : ""}`);
    });
  }
  if (r.education?.length) {
    lines.push("", "EDUCATION");
    r.education.forEach((e) => lines.push(`${e.degree}, ${e.institution} (${e.period || ""})`));
  }
  if (r.certifications?.length) {
    lines.push("", "CERTIFICATIONS");
    r.certifications.forEach((c) => lines.push(`- ${c}`));
  }
  return lines.join("\n");
}

// ---------- LOGIN & REGISTER (WITH EMAIL OTP) ----------

function loginPage() {
  document.body.append(createBgToggleButton("theme-float"));
  api("/api/auth/me").then(() => (location.href = "/")).catch(() => {});
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    $("#submit").disabled = true;
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: { email: $("#email").value, password: $("#password").value },
      });
      location.href = "/";
    } catch (err) {
      showError(err.message);
      $("#submit").disabled = false;
    }
  });
}

function registerPage() {
  document.body.append(createBgToggleButton("theme-float"));
  const sendBtn = $("#send-otp");
  const otpBox = $("#otp-box");
  const otpInput = $("#otp");
  const otpInfo = $("#otp-info");
  const submitBtn = $("#submit");

  let cooldownTimer = null;
  function startCooldown(seconds) {
    let left = seconds;
    sendBtn.disabled = true;
    sendBtn.textContent = `Resend OTP in ${left}s`;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(cooldownTimer);
        sendBtn.disabled = false;
        sendBtn.textContent = "Resend Verification OTP";
      } else {
        sendBtn.textContent = `Resend OTP in ${left}s`;
      }
    }, 1000);
  }

  sendBtn.addEventListener("click", async () => {
    hideError();
    otpInfo.hidden = true;
    const email = $("#email").value.trim();
    const username = $("#username").value.trim();
    if (!email) return showError("Please enter your email address first.");

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending OTP...";
    try {
      const res = await api("/api/auth/send-otp", {
        method: "POST",
        body: { email, username },
      });
      otpBox.hidden = false;
      otpInput.required = true;
      submitBtn.disabled = false;
      otpInfo.textContent = res.message;
      otpInfo.hidden = false;
      otpInput.focus();
      startCooldown(30);
    } catch (err) {
      showError(err.message);
      sendBtn.disabled = false;
      sendBtn.textContent = "Send Verification OTP";
    }
  });

  $("#register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    submitBtn.disabled = true;
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: {
          username: $("#username").value,
          email: $("#email").value,
          password: $("#password").value,
          otp: otpInput.value.trim(),
        },
      });
      location.href = "/";
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
    }
  });
}

// ---------- ADMIN EMAIL LIST & BROADCAST PAGE ----------

async function adminPage() {
  await requireLogin();
  let allUsers = [];

  async function loadAdmin() {
    hideError();
    try {
      const { stats, users } = await api("/api/admin/users");
      allUsers = users;
      $("#admin-stats").replaceChildren(
        el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num" }, String(stats.totalUsers)), el("span", { class: "kpi-card__label" }, "Registered Users")),
        el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num", style: "color:var(--low)" }, String(stats.verifiedUsers)), el("span", { class: "kpi-card__label" }, "OTP Verified")),
        el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num", style: "color:var(--info)" }, String(stats.emailOptIn)), el("span", { class: "kpi-card__label" }, "Job Alert Opt-In")),
        el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num", style: "font-size:1.1rem;text-transform:uppercase;" }, stats.emailProvider), el("span", { class: "kpi-card__label" }, "Email Provider"))
      );
      renderUsers();
    } catch (err) {
      showError(err.message);
    }
  }

  function renderUsers() {
    const q = ($("#admin-search").value || "").toLowerCase();
    const list = allUsers.filter((u) =>
      !q || `${u.username} ${u.email} ${u.targetRoles} ${u.skills}`.toLowerCase().includes(q)
    );
    if (!list.length) {
      $("#admin-users-list").replaceChildren(el("p", { class: "muted" }, "No registered users match this search."));
      return;
    }
    $("#admin-users-list").replaceChildren(
      ...list.map((u) =>
        el("article", { class: "job-card" },
          el("div", { class: "job-card__top" },
            el("div", {},
              el("strong", {}, `${u.username} — ${u.email}`),
              el("p", { class: "muted" }, [
                u.targetRoles && `Target: ${u.targetRoles}`,
                u.githubUsername && `GitHub: @${u.githubUsername}`,
                `Joined: ${new Date(u.createdAt).toLocaleDateString()}`,
              ].filter(Boolean).join(" • "))
            ),
            el("div", { class: "inline-row" },
              el("span", { class: `badge ${u.emailVerified ? "badge--ok" : "badge--warn"}` }, u.emailVerified ? "OTP Verified" : "Unverified"),
              el("span", { class: `badge ${u.emailAlertsEnabled ? "badge--info" : ""}` }, u.emailAlertsEnabled ? "Email Alerts ON" : "Alerts OFF")
            )
          )
        )
      )
    );
  }

  $("#admin-search").addEventListener("input", renderUsers);

  $("#broadcast-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    const okBox = $("#admin-success");
    okBox.hidden = true;
    const btn = $("#bcSubmit");
    btn.disabled = true;
    btn.textContent = "Sending emails...";
    try {
      const res = await api("/api/admin/broadcast-job", {
        method: "POST",
        body: {
          title: $("#bcTitle").value,
          company: $("#bcCompany").value,
          location: $("#bcLocation").value,
          applyUrl: $("#bcUrl").value,
          filterKeyword: $("#bcFilter").value,
        },
      });
      okBox.textContent = res.message;
      okBox.hidden = false;
      e.target.reset();
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "📧 Send Job Alert Email Now";
    }
  });

  await loadAdmin();
}

// ---------- HOME PAGE ----------

async function homePage() {
  await requireLogin();

  const jobBox = $("#jobDescription");
  const prefJd = sessionStorage.getItem("prefill_jd");
  if (prefJd) {
    jobBox.value = prefJd;
    sessionStorage.removeItem("prefill_jd");
    $("#counter").textContent = `${jobBox.value.length} / 6000 chars`;
  }
  jobBox.addEventListener("input", () => {
    $("#counter").textContent = `${jobBox.value.length} / 6000 chars`;
  });

  api("/api/profile").then(({ profile }) => {
    const bits = [];
    if (profile.githubUsername) bits.push(`GitHub (@${profile.githubUsername})`);
    if (profile.hasMasterResume) bits.push(`Master Resume (${profile.masterResumeName})`);
    if (profile.linkedinUrl) bits.push("LinkedIn linked");
    if (bits.length) {
      const b = $("#profile-banner");
      b.textContent = `Connected profile active: ${bits.join(" • ")}. You can generate immediately without re-uploading!`;
      b.hidden = false;
    }
  }).catch(() => {});

  const fileInput = $("#resume");
  const dropzone = $("#dropzone");
  fileInput.addEventListener("change", () => {
    $("#file-name").textContent = fileInput.files[0] ? fileInput.files[0].name : "PDF only (max 3 MB)";
  });
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragging"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event("change"));
    }
  });

  window.addEventListener("pageshow", () => hideOverlay());

  $("#report-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    const file = fileInput.files[0];
    if (file && !file.name.toLowerCase().endsWith(".pdf")) return showError("The resume must be a PDF file.");
    if (file && file.size > 3 * 1024 * 1024) return showError("The resume is too big (maximum 3 MB).");

    showOverlay("Building your interview plan... this can take up to a minute.");
    try {
      const resumeBase64 = file ? await fileToBase64(file) : "";
      const { id } = await api("/api/interviews", {
        method: "POST",
        body: { jobDescription: jobBox.value, selfDescription: $("#selfDescription").value, resumeBase64 },
      });
      location.href = `/report.html?id=${id}`;
    } catch (err) {
      hideOverlay();
      showError(err.message);
    }
  });

  const { reports } = await api("/api/interviews");
  if (reports.length > 0) {
    $("#recent").hidden = false;
    $("#reports-list").replaceChildren(
      ...reports.map((r) =>
        el("a", { class: "report-item", href: `/report.html?id=${r.id}` },
          el("h3", {}, r.title),
          el("p", { class: "muted" }, `Generated on ${new Date(r.createdAt).toLocaleDateString()}`),
          el("p", { class: scoreClass(r.matchScore) }, `Match Score: ${r.matchScore}%`)
        )
      )
    );
  }
}

// ---------- PROFILE & INTEGRATIONS PAGE ----------

async function profilePage() {
  await requireLogin();
  const successBox = $("#success");
  const showSuccess = (msg) => { successBox.textContent = msg; successBox.hidden = false; };

  function renderGitHubPreview(gh) {
    const box = $("#github-preview");
    if (!gh || !gh.username) { box.hidden = true; return; }
    box.hidden = false;
    box.replaceChildren(
      el("div", { class: "gh-header" },
        gh.avatarUrl && el("img", { class: "gh-avatar", src: gh.avatarUrl, alt: gh.username }),
        el("div", {},
          el("strong", {}, `${gh.name || gh.username} (@${gh.username})`),
          el("p", { class: "muted" }, `${gh.publicRepos} public repos • ${gh.followers} followers • Languages: ${(gh.topLanguages || []).join(", ") || "N/A"}`)
        )
      ),
      el("div", { class: "gh-repos" },
        ...(gh.repos || []).slice(0, 6).map((r) =>
          el("a", { class: "gh-repo", href: safeHref(r.url), target: "_blank", rel: "noopener" },
            el("strong", {}, r.name),
            el("p", { class: "muted" }, `${r.language || "Code"} • ★ ${r.stars}`),
            r.description && el("p", { class: "muted" }, r.description.slice(0, 80))
          )
        )
      )
    );
  }

  const { profile, apiStatus } = await api("/api/profile");
  const pill = (label, ok) => el("span", { class: `badge ${ok ? "badge--ok" : "badge--warn"}` }, `${label}: ${ok ? "Connected" : "Optional"}`);
  $("#api-pills").replaceChildren(
    el("span", { class: `badge ${apiStatus.gemini ? "badge--ok" : ""}` }, `Gemini AI: ${apiStatus.gemini ? "Active" : "Missing Key"}`),
    el("span", { class: `badge ${apiStatus.emailProvider !== "console" ? "badge--ok" : "badge--warn"}` }, `Email: ${apiStatus.emailProvider}`),
    pill("GitHub Token", apiStatus.githubToken),
    pill("Adzuna", apiStatus.adzuna),
    pill("JSearch", apiStatus.jsearch),
    pill("Telegram", apiStatus.telegram)
  );

  const map = {
    fullName: profile.fullName,
    headline: profile.headline,
    phone: profile.phone,
    location: profile.location,
    targetRoles: profile.targetRoles,
    skills: profile.skills,
    experienceLevel: profile.experienceLevel,
    preferredLocation: profile.preferredLocation,
    workMode: profile.workMode,
    minMatchScore: profile.minMatchScore,
    githubUsername: profile.githubUsername,
    linkedinUrl: profile.linkedinUrl,
    portfolioUrl: profile.portfolioUrl,
    bio: profile.bio,
    atsBoards: profile.atsBoards,
    webhookUrl: profile.webhookUrl,
    telegramChatId: profile.telegramChatId,
  };
  for (const [id, val] of Object.entries(map)) {
    if ($(`#${id}`)) $(`#${id}`).value = val ?? "";
  }
  $("#autoScanEnabled").checked = profile.autoScanEnabled;
  if ($("#emailAlertsEnabled")) $("#emailAlertsEnabled").checked = profile.emailAlertsEnabled;

  if (profile.hasMasterResume) {
    $("#masterResumeStatus").textContent = `Saved: ${profile.masterResumeName}`;
    $("#removeMasterResume").hidden = false;
  }
  renderGitHubPreview(profile.githubData);

  $("#sync-github").addEventListener("click", async () => {
    hideError();
    successBox.hidden = true;
    const btn = $("#sync-github");
    btn.disabled = true;
    btn.textContent = "Syncing...";
    try {
      const { githubData, mergedSkills } = await api("/api/profile/github-sync", {
        method: "POST",
        body: { githubUsername: $("#githubUsername").value },
      });
      renderGitHubPreview(githubData);
      if (mergedSkills && !$("#skills").value.trim()) $("#skills").value = mergedSkills;
      showSuccess(`Synced GitHub @${githubData.username} (${githubData.repos.length} repositories imported)!`);
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync GitHub";
    }
  });

  $("#removeMasterResume").addEventListener("click", async () => {
    await api("/api/profile", { method: "PUT", body: { removeMasterResume: true } });
    $("#masterResumeStatus").textContent = "Master resume removed.";
    $("#removeMasterResume").hidden = true;
  });

  $("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    successBox.hidden = true;
    const btn = $("#save-profile");
    btn.disabled = true;
    try {
      const file = $("#masterResumeFile").files[0];
      let masterResumeBase64 = "";
      let masterResumeName = "";
      if (file) {
        if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("Master resume must be a PDF file.");
        if (file.size > 3 * 1024 * 1024) throw new Error("PDF must be under 3 MB.");
        masterResumeBase64 = await fileToBase64(file);
        masterResumeName = file.name;
      }

      await api("/api/profile", {
        method: "PUT",
        body: {
          fullName: $("#fullName").value,
          headline: $("#headline").value,
          phone: $("#phone").value,
          location: $("#location").value,
          targetRoles: $("#targetRoles").value,
          skills: $("#skills").value,
          experienceLevel: $("#experienceLevel").value,
          preferredLocation: $("#preferredLocation").value,
          workMode: $("#workMode").value,
          minMatchScore: Number($("#minMatchScore").value || 65),
          autoScanEnabled: $("#autoScanEnabled").checked,
          emailAlertsEnabled: $("#emailAlertsEnabled") ? $("#emailAlertsEnabled").checked : true,
          githubUsername: $("#githubUsername").value,
          linkedinUrl: $("#linkedinUrl").value,
          portfolioUrl: $("#portfolioUrl").value,
          bio: $("#bio").value,
          atsBoards: $("#atsBoards").value,
          webhookUrl: $("#webhookUrl").value,
          telegramChatId: $("#telegramChatId").value,
          masterResumeBase64,
          masterResumeName,
        },
      });
      if (masterResumeName) {
        $("#masterResumeStatus").textContent = `Saved: ${masterResumeName}`;
        $("#removeMasterResume").hidden = false;
      }
      showSuccess("Career profile saved! Your AI Job Agent and Email Alerts are ready.");
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- AI JOB AGENT PAGE ----------

async function agentPage() {
  await requireLogin();
  let allJobs = [];
  let currentFilter = "all";

  async function loadJobs() {
    const data = await api("/api/agent/jobs");
    allJobs = data.jobs || [];
    renderJobs();
  }

  function renderJobs() {
    const filtered = allJobs.filter((j) => {
      if (currentFilter === "high") return j.matchScore >= 70;
      if (currentFilter === "saved") return j.status === "saved" || Boolean(j.applyPack);
      if (currentFilter === "applied") return j.status === "applied";
      return true;
    });
    $("#job-count").textContent = `${filtered.length} job${filtered.length === 1 ? "" : "s"} shown`;

    if (!filtered.length) {
      $("#jobs-list").replaceChildren(
        el("div", { class: "card" },
          el("p", { class: "muted" }, "No jobs in this view yet. Make sure your target roles & skills are saved in Profile, then click 'Run AI Scan Now' above!")
        )
      );
      return;
    }

    $("#jobs-list").replaceChildren(
      ...filtered.map((job) => {
        const packContainer = el("div", { class: "pack-box", hidden: job.applyPack ? null : "hidden" });
        const renderPack = (pack) => {
          packContainer.hidden = false;
          const out = pack.outreach || {};
          packContainer.replaceChildren(
            el("div", { class: "card__head" },
              el("strong", {}, `AI Apply Pack Ready — ATS Score: ${pack.atsScore}%`),
              el("a", { class: "button primary-button small-btn", href: `/ats-resume.html?id=${pack.atsResumeId}` }, "Open & Print ATS Resume →")
            ),
            out.coverLetter && el("details", { open: "open" },
              el("summary", {}, "Tailored Cover Letter"),
              el("div", { class: "pre-box" }, out.coverLetter),
              el("button", { class: "button ghost-btn small-btn", type: "button", onClick: (e) => copyText(out.coverLetter, e.target) }, "Copy Cover Letter")
            ),
            out.coldEmailBody && el("details", {},
              el("summary", {}, `Recruiter Cold Email — Subject: ${out.coldEmailSubject || ""}`),
              el("div", { class: "pre-box" }, `Subject: ${out.coldEmailSubject}\n\n${out.coldEmailBody}`),
              el("button", { class: "button ghost-btn small-btn", type: "button", onClick: (e) => copyText(`Subject: ${out.coldEmailSubject}\n\n${out.coldEmailBody}`, e.target) }, "Copy Email")
            ),
            out.linkedinNote && el("details", {},
              el("summary", {}, "LinkedIn Connection Note"),
              el("div", { class: "pre-box" }, out.linkedinNote),
              el("button", { class: "button ghost-btn small-btn", type: "button", onClick: (e) => copyText(out.linkedinNote, e.target) }, "Copy Note")
            ),
            (out.screeningAnswers || []).length > 0 && el("details", {},
              el("summary", {}, "Suggested Application Screening Answers"),
              ...(out.screeningAnswers || []).map((sa) =>
                el("div", { class: "pre-box" }, `Q: ${sa.question}\nA: ${sa.answer}`)
              )
            )
          );
        };
        if (job.applyPack) renderPack(job.applyPack);

        return el("article", { class: "job-card" },
          el("div", { class: "job-card__top" },
            el("div", {},
              el("h3", {}, job.title),
              el("p", { class: "muted" }, [job.company, job.location, job.workMode, job.salary, job.source].filter(Boolean).join(" • "))
            ),
            el("div", { class: "inline-row" },
              el("span", { class: `score-pill ${scoreClass(job.matchScore)}` }, `${job.matchScore}% Match`),
              job.status === "applied" && el("span", { class: "badge badge--ok" }, "Applied")
            )
          ),
          job.matchReason && el("p", {}, job.matchReason),
          el("div", { class: "chip-wrap" },
            ...(job.matchedSkills || []).map((s) => el("span", { class: "skill-tag skill-tag--low" }, `✓ ${s}`)),
            ...(job.missingSkills || []).map((s) => el("span", { class: "skill-tag skill-tag--high" }, `Gap: ${s}`))
          ),
          el("div", { class: "inline-row" },
            el("button", {
              class: "button primary-button small-btn",
              type: "button",
              onClick: async (e) => {
                const btn = e.target;
                btn.disabled = true;
                btn.textContent = "Prepping Pack (~25s)...";
                try {
                  const { applyPack } = await api(`/api/agent/jobs/${job.id}/prep`, { method: "POST" });
                  job.applyPack = applyPack;
                  renderPack(applyPack);
                  btn.textContent = "✓ Pack Ready";
                } catch (err) {
                  showError(err.message);
                  btn.disabled = false;
                  btn.textContent = "✨ Prepare Apply Pack";
                }
              },
            }, job.applyPack ? "✓ Pack Ready" : "✨ Prepare Apply Pack"),
            safeHref(job.applyUrl) && el("a", {
              class: "button ghost-btn small-btn",
              href: safeHref(job.applyUrl),
              target: "_blank",
              rel: "noopener",
            }, "Apply on Site ↗"),
            el("button", {
              class: "button ghost-btn small-btn",
              type: "button",
              onClick: async () => {
                await api(`/api/agent/jobs/${job.id}/track`, { method: "POST", body: { status: "Applied" } });
                job.status = "applied";
                renderJobs();
              },
            }, "✓ Mark Applied & Track"),
            el("button", {
              class: "button ghost-btn small-btn",
              type: "button",
              onClick: () => {
                sessionStorage.setItem("prefill_jd", `${job.title} at ${job.company}\n\n${job.description}`);
                location.href = "/mock.html";
              },
            }, "🎙️ Practice Mock"),
            el("button", {
              class: "link-button",
              type: "button",
              onClick: async () => {
                await api(`/api/agent/jobs/${job.id}/status`, { method: "POST", body: { status: "dismissed" } });
                allJobs = allJobs.filter((x) => x.id !== job.id);
                renderJobs();
              },
            }, "Dismiss")
          ),
          packContainer
        );
      })
    );
  }

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("filter-chip--active", b === btn));
      renderJobs();
    });
  });

  $("#run-scan").addEventListener("click", async () => {
    hideError();
    $("#scan-status").hidden = true;
    showOverlay("AI Agent is fetching live job boards and scoring matches against your profile...");
    try {
      const res = await api("/api/agent/scan", { method: "POST", body: { query: $("#scan-query").value } });
      $("#scan-status").textContent = res.message;
      $("#scan-status").hidden = false;
      await loadJobs();
    } catch (err) {
      showError(err.message);
    } finally {
      hideOverlay();
    }
  });

  await loadJobs();
}

// ---------- JOB APPLICATION TRACKER PAGE ----------

async function trackerPage() {
  await requireLogin();
  const STATUSES = ["Saved", "Applied", "Screening", "Interview", "Offer", "Rejected"];
  let apps = [];
  let statusFilter = "ALL";

  async function loadApps() {
    const { stats, applications } = await api("/api/applications");
    apps = applications;
    $("#tracker-stats").replaceChildren(
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num" }, String(stats.total)), el("span", { class: "kpi-card__label" }, "Total Tracked")),
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num" }, String(stats.Applied)), el("span", { class: "kpi-card__label" }, "Applied")),
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num", style: "color:var(--info)" }, String(stats.Interview)), el("span", { class: "kpi-card__label" }, "Interviews")),
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num", style: "color:var(--low)" }, String(stats.Offer)), el("span", { class: "kpi-card__label" }, "Offers")),
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num" }, `${stats.responseRate}%`), el("span", { class: "kpi-card__label" }, "Response Rate"))
    );
    renderApps();
  }

  function renderApps() {
    const q = ($("#tracker-search").value || "").toLowerCase();
    const list = apps.filter((a) => {
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (q && !`${a.company} ${a.role} ${a.location}`.toLowerCase().includes(q)) return false;
      return true;
    });

    if (!list.length) {
      $("#apps-list").replaceChildren(
        el("div", { class: "card" }, el("p", { class: "muted" }, "No applications match this filter. Add one above or send jobs straight from the AI Job Agent!"))
      );
      return;
    }

    $("#apps-list").replaceChildren(
      ...list.map((a) => {
        const statusSel = el("select", {
          class: "field-input field-input--sm",
          onChange: async (e) => {
            await api(`/api/applications/${a.id}`, { method: "PATCH", body: { status: e.target.value } });
            await loadApps();
          },
        }, ...STATUSES.map((s) => el("option", { value: s, selected: a.status === s }, s)));

        const followInput = el("input", {
          type: "date",
          class: "field-input field-input--sm",
          value: a.followUpDate || "",
          title: "Follow-up reminder date",
          onChange: async (e) => {
            await api(`/api/applications/${a.id}`, { method: "PATCH", body: { followUpDate: e.target.value } });
          },
        });

        return el("article", { class: "job-card" },
          el("div", { class: "job-card__top" },
            el("div", {},
              el("h3", {}, `${a.role} — ${a.company}`),
              el("p", { class: "muted" }, [
                a.location,
                a.salary,
                a.source && `Source: ${a.source}`,
                a.appliedAt && `Applied: ${a.appliedAt}`,
                a.matchScore != null && `Match: ${a.matchScore}%`,
              ].filter(Boolean).join(" • "))
            ),
            el("div", { class: "inline-row" }, statusSel, followInput)
          ),
          a.notes && el("p", { class: "muted" }, `Notes: ${a.notes}`),
          el("div", { class: "inline-row" },
            safeHref(a.applyUrl) && el("a", { class: "button ghost-btn small-btn", href: safeHref(a.applyUrl), target: "_blank", rel: "noopener" }, "Job Post ↗"),
            a.atsResumeId
              ? el("a", { class: "button ghost-btn small-btn", href: `/ats-resume.html?id=${a.atsResumeId}` }, "📄 Open ATS Resume")
              : a.jobDescription && el("button", {
                  class: "button ghost-btn small-btn",
                  type: "button",
                  onClick: () => {
                    sessionStorage.setItem("prefill_jd", a.jobDescription);
                    sessionStorage.setItem("prefill_title", a.role);
                    sessionStorage.setItem("prefill_company", a.company);
                    location.href = "/ats-resume.html";
                  },
                }, "📄 Build ATS Resume"),
            a.jobDescription && el("button", {
              class: "button ghost-btn small-btn",
              type: "button",
              onClick: () => {
                sessionStorage.setItem("prefill_jd", a.jobDescription);
                location.href = "/mock.html";
              },
            }, "🎙️ Mock Interview"),
            a.jobDescription && el("button", {
              class: "button ghost-btn small-btn",
              type: "button",
              onClick: () => {
                sessionStorage.setItem("prefill_jd", a.jobDescription);
                location.href = "/";
              },
            }, "📘 Interview Plan"),
            el("button", {
              class: "button danger-btn small-btn",
              type: "button",
              onClick: async () => {
                await api(`/api/applications/${a.id}`, { method: "DELETE" });
                await loadApps();
              },
            }, "Delete")
          )
        );
      })
    );
  }

  $("#toggle-add").addEventListener("click", () => ($("#add-app-form").hidden = !$("#add-app-form").hidden));
  $("#cancel-add").addEventListener("click", () => ($("#add-app-form").hidden = true));
  $("#tracker-search").addEventListener("input", renderApps);

  document.querySelectorAll("#status-filters [data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      statusFilter = btn.dataset.status;
      document.querySelectorAll("#status-filters [data-status]").forEach((b) => b.classList.toggle("filter-chip--active", b === btn));
      renderApps();
    });
  });

  $("#add-app-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    try {
      await api("/api/applications", {
        method: "POST",
        body: {
          company: $("#appCompany").value,
          role: $("#appRole").value,
          location: $("#appLocation").value,
          salary: $("#appSalary").value,
          status: $("#appStatus").value,
          followUpDate: $("#appFollowUp").value,
          source: $("#appSource").value,
          applyUrl: $("#appUrl").value,
          jobDescription: $("#appJd").value,
          notes: $("#appNotes").value,
        },
      });
      e.target.reset();
      $("#add-app-form").hidden = true;
      await loadApps();
    } catch (err) {
      showError(err.message);
    }
  });

  await loadApps();
}

// ---------- ATS-FRIENDLY RESUME STUDIO PAGE ----------

async function atsPage() {
  await requireLogin();
  let activeItem = null;

  const prefJd = sessionStorage.getItem("prefill_jd");
  if (prefJd) { $("#atsJd").value = prefJd; sessionStorage.removeItem("prefill_jd"); }
  const prefTitle = sessionStorage.getItem("prefill_title");
  if (prefTitle) { $("#atsTitle").value = prefTitle; sessionStorage.removeItem("prefill_title"); }
  const prefComp = sessionStorage.getItem("prefill_company");
  if (prefComp) { $("#atsCompany").value = prefComp; sessionStorage.removeItem("prefill_company"); }

  async function loadList() {
    const { resumes } = await api("/api/ats");
    if (!resumes.length) { $("#ats-saved-wrap").hidden = true; return; }
    $("#ats-saved-wrap").hidden = false;
    $("#ats-saved-list").replaceChildren(
      ...resumes.map((r) =>
        el("a", {
          class: "report-item",
          href: `/ats-resume.html?id=${r.id}`,
          onClick: (e) => { e.preventDefault(); loadDetail(r.id); },
        },
          el("h3", {}, `${r.title}${r.company ? ` — ${r.company}` : ""}`),
          el("p", { class: "muted" }, new Date(r.createdAt).toLocaleDateString()),
          el("p", { class: scoreClass(r.atsScore) }, `ATS Score: ${r.atsScore}%`)
        )
      )
    );
  }

  function renderOutreach(out) {
    const box = $("#ats-outreach-box");
    box.hidden = false;
    box.replaceChildren(
      el("h2", {}, "Tailored Cover Letter & Recruiter Outreach"),
      el("p", { class: "small-label" }, "Cover Letter"),
      el("div", { class: "pre-box" }, out.coverLetter),
      el("button", { class: "button ghost-btn small-btn", type: "button", onClick: (e) => copyText(out.coverLetter, e.target) }, "Copy Cover Letter"),
      el("p", { class: "small-label" }, `Recruiter Cold Email — Subject: ${out.coldEmailSubject}`),
      el("div", { class: "pre-box" }, out.coldEmailBody),
      el("button", { class: "button ghost-btn small-btn", type: "button", onClick: (e) => copyText(`Subject: ${out.coldEmailSubject}\n\n${out.coldEmailBody}`, e.target) }, "Copy Cold Email"),
      el("p", { class: "small-label" }, "LinkedIn Connection Note"),
      el("div", { class: "pre-box" }, out.linkedinNote),
      el("button", { class: "button ghost-btn small-btn", type: "button", onClick: (e) => copyText(out.linkedinNote, e.target) }, "Copy LinkedIn Note")
    );
  }

  function showActive(item) {
    activeItem = item;
    $("#ats-workspace").hidden = false;
    $("#ats-active-title").textContent = `${item.title}${item.company ? ` @ ${item.company}` : ""} — ATS Report`;
    const a = item.atsAnalysis || {};
    $("#ats-scores").replaceChildren(
      el("div", { class: "kpi-card" }, el("span", { class: `kpi-card__num ${scoreClass(a.overallScore)}` }, `${a.overallScore}%`), el("span", { class: "kpi-card__label" }, "Overall ATS Score")),
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num" }, `${a.keywordScore}%`), el("span", { class: "kpi-card__label" }, "Keyword Match")),
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num" }, `${a.impactScore}%`), el("span", { class: "kpi-card__label" }, "Impact & Verbs")),
      el("div", { class: "kpi-card" }, el("span", { class: "kpi-card__num" }, `${a.structureScore}%`), el("span", { class: "kpi-card__label" }, "ATS Structure"))
    );
    $("#ats-matched").replaceChildren(
      ...(a.matchedKeywords || []).map((k) => el("span", { class: "skill-tag skill-tag--low" }, k))
    );
    $("#ats-missing").replaceChildren(
      ...(a.missingKeywords?.length
        ? a.missingKeywords.map((k) => el("span", { class: "skill-tag skill-tag--high" }, k))
        : [el("span", { class: "muted" }, "None — great keyword coverage!")])
    );
    $("#ats-tips").replaceChildren(...(a.tips || []).map((t) => el("li", {}, t)));

    if (item.outreach) renderOutreach(item.outreach);
    else $("#ats-outreach-box").hidden = true;

    const paper = $("#paper");
    paper.hidden = false;
    renderResumePaper(paper, item.resume);
    document.title = `${item.resume.fullName || "ATS Resume"} - ${item.title}`;
  }

  async function loadDetail(id) {
    hideError();
    try {
      const { item } = await api(`/api/ats/${id}`);
      showActive(item);
      history.replaceState(null, "", `/ats-resume.html?id=${id}`);
    } catch (err) {
      showError(err.message);
    }
  }

  $("#ats-template").addEventListener("change", (e) => {
    const paper = $("#paper");
    paper.classList.toggle("ats-classic", e.target.value === "classic");
    paper.classList.toggle("ats-modern", e.target.value === "modern");
  });

  $("#ats-toggle-edit").addEventListener("click", (e) => {
    const paper = $("#paper");
    const editing = paper.contentEditable === "true";
    paper.contentEditable = editing ? "false" : "true";
    paper.classList.toggle("is-editing", !editing);
    e.target.textContent = editing ? "✏️ Edit Text" : "✓ Done Editing";
  });

  $("#ats-copy-txt").addEventListener("click", (e) => {
    if (activeItem) copyText(resumeToPlainText(activeItem.resume), e.target);
  });

  $("#ats-print").addEventListener("click", () => window.print());

  $("#ats-outreach-btn").addEventListener("click", async () => {
    if (!activeItem) return;
    showOverlay("Writing your tailored cover letter, recruiter cold email, and LinkedIn note...");
    try {
      const { outreach } = await api(`/api/ats/${activeItem.id}/outreach`, { method: "POST" });
      activeItem.outreach = outreach;
      renderOutreach(outreach);
    } catch (err) {
      showError(err.message);
    } finally {
      hideOverlay();
    }
  });

  $("#ats-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    showOverlay("Generating your ATS-friendly resume and scoring keyword alignment...");
    try {
      const file = $("#atsResumeFile").files[0];
      const resumeBase64 = file ? await fileToBase64(file) : "";
      const created = await api("/api/ats/generate", {
        method: "POST",
        body: {
          title: $("#atsTitle").value,
          company: $("#atsCompany").value,
          jobDescription: $("#atsJd").value,
          selfDescription: $("#atsSelf").value,
          resumeBase64,
        },
      });
      await loadList();
      showActive({ ...created, outreach: null });
    } catch (err) {
      showError(err.message);
    } finally {
      hideOverlay();
    }
  });

  await loadList();
  const initialId = queryParam("id");
  if (initialId) await loadDetail(initialId);
}

// ---------- SKILL ROADMAPS PAGE ----------

async function roadmapsPage() {
  await requireLogin();

  const prefJd = sessionStorage.getItem("prefill_jd");
  if (prefJd) { $("#rmJd").value = prefJd; sessionStorage.removeItem("prefill_jd"); }
  const prefRole = sessionStorage.getItem("prefill_role");
  if (prefRole) { $("#rmRole").value = prefRole; sessionStorage.removeItem("prefill_role"); }

  async function loadList() {
    const { roadmaps } = await api("/api/roadmaps");
    if (!roadmaps.length) { $("#rm-saved-wrap").hidden = true; return; }
    $("#rm-saved-wrap").hidden = false;
    $("#rm-saved-list").replaceChildren(
      ...roadmaps.map((r) =>
        el("a", {
          class: "report-item",
          href: `#roadmap-${r.id}`,
          onClick: (e) => { e.preventDefault(); loadDetail(r.id); },
        },
          el("h3", {}, r.title),
          el("p", { class: "muted" }, `${r.weeks} weeks • ${r.level}`),
          el("div", { class: "progress-bar" }, el("div", { class: "progress-bar__fill", style: `width:${r.percentComplete}%` })),
          el("p", { class: "muted" }, `${r.percentComplete}% complete`)
        )
      )
    );
  }

  function renderDetail(rm) {
    const mount = $("#rm-detail");
    mount.hidden = false;
    const progress = rm.progress || {};
    const phases = rm.data.phases || [];

    const total = phases.reduce((acc, p) => acc + (p.topics?.length || 0) + 1, 0);
    const calcPct = () => {
      const done = Object.values(progress).filter(Boolean).length;
      return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    };

    const pctText = el("span", { class: "badge badge--ok" }, `${calcPct()}% Completed`);
    const barFill = el("div", { class: "progress-bar__fill", style: `width:${calcPct()}%` });

    const toggleItem = async (key, checked) => {
      progress[key] = checked;
      pctText.textContent = `${calcPct()}% Completed`;
      barFill.style.width = `${calcPct()}%`;
      await api(`/api/roadmaps/${rm.id}/progress`, { method: "PATCH", body: { key, done: checked } });
      loadList();
    };

    mount.replaceChildren(
      el("div", { class: "card" },
        el("div", { class: "card__head" },
          el("h2", {}, rm.data.title || rm.title),
          el("div", { class: "inline-row" },
            pctText,
            el("button", {
              class: "button danger-btn small-btn",
              type: "button",
              onClick: async () => {
                await api(`/api/roadmaps/${rm.id}`, { method: "DELETE" });
                mount.hidden = true;
                await loadList();
              },
            }, "Delete")
          )
        ),
        el("p", {}, rm.data.overview || ""),
        el("div", { class: "progress-bar" }, barFill)
      ),
      ...phases.map((phase) => {
        const projKey = `p${phase.phaseNumber}_project`;
        return el("section", { class: "card" },
          el("div", { class: "card__head" },
            el("h3", {}, `${phase.title}`),
            el("span", { class: "day-badge" }, phase.duration || `Phase ${phase.phaseNumber}`)
          ),
          el("p", { class: "muted" }, `Goal: ${phase.goal}`),
          el("p", { class: "small-label" }, "Topics Checklist"),
          el("div", { class: "stack-list" },
            ...(phase.topics || []).map((t, idx) => {
              const key = `p${phase.phaseNumber}_t${idx}`;
              return el("label", { class: "topic-check" },
                el("input", { type: "checkbox", checked: Boolean(progress[key]), onChange: (e) => toggleItem(key, e.target.checked) }),
                el("span", {}, t)
              );
            })
          ),
          el("p", { class: "small-label" }, "Best Curated Resources"),
          el("div", { class: "resource-grid" },
            ...(phase.resources || []).map((res) =>
              el("div", { class: "resource-card" },
                el("div", { class: "inline-row" },
                  el("span", { class: "badge badge--info" }, res.type),
                  el("span", { class: "badge badge--ok" }, res.cost)
                ),
                safeHref(res.url)
                  ? el("a", { href: safeHref(res.url), target: "_blank", rel: "noopener" }, el("strong", {}, `${res.name} ↗`))
                  : el("strong", {}, res.name),
                el("p", { class: "muted" }, res.why)
              )
            )
          ),
          el("label", { class: "topic-check" },
            el("input", { type: "checkbox", checked: Boolean(progress[projKey]), onChange: (e) => toggleItem(projKey, e.target.checked) }),
            el("span", {}, el("strong", {}, "Hands-On Mini-Project: "), phase.miniProject)
          ),
          el("div", { class: "info-box" }, el("strong", {}, "Interview Checkpoint: "), phase.checkpointQuestion)
        );
      })
    );
  }

  async function loadDetail(id) {
    const { roadmap } = await api(`/api/roadmaps/${id}`);
    renderDetail(roadmap);
  }

  $("#roadmap-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    showOverlay("Building your structured skill roadmap with curated resources...");
    try {
      const { id } = await api("/api/roadmaps/generate", {
        method: "POST",
        body: {
          targetRole: $("#rmRole").value,
          level: $("#rmLevel").value,
          weeks: Number($("#rmWeeks").value || 8),
          jobDescription: $("#rmJd").value,
        },
      });
      await loadList();
      await loadDetail(id);
    } catch (err) {
      showError(err.message);
    } finally {
      hideOverlay();
    }
  });

  await loadList();
}

// ---------- INTERACTIVE JD MOCK INTERVIEWER PAGE ----------

async function mockPage() {
  await requireLogin();

  const prefJd = sessionStorage.getItem("prefill_jd");
  if (prefJd) { $("#mockJd").value = prefJd; sessionStorage.removeItem("prefill_jd"); }

  async function loadHistory() {
    const { sessions } = await api("/api/mock");
    if (!sessions.length) { $("#mock-history-wrap").hidden = true; return; }
    $("#mock-history-wrap").hidden = false;
    $("#mock-history-list").replaceChildren(
      ...sessions.map((s) =>
        el("a", {
          class: "report-item",
          href: `#mock-${s.id}`,
          onClick: (e) => { e.preventDefault(); openSession(s.id); },
        },
          el("h3", {}, s.title),
          el("p", { class: "muted" }, `${s.interviewType} • ${s.difficulty} • ${s.answeredCount}/${s.maxQuestions} answered`),
          s.overallScore != null
            ? el("p", { class: scoreClass(s.overallScore) }, `${s.overallScore}% — ${s.verdict}`)
            : el("p", { class: "highlight" }, "In progress →")
        )
      )
    );
  }

  function renderSession(session) {
    const mount = $("#mock-active");
    mount.hidden = false;

    const nodes = [
      el("div", { class: "card" },
        el("div", { class: "card__head" },
          el("h2", {}, `${session.title} (${session.interviewType} • ${session.difficulty})`),
          el("span", { class: `badge ${session.status === "completed" ? "badge--ok" : ""}` },
            session.status === "completed" ? "Completed" : `Question ${session.history.length} of ${session.maxQuestions}`
          )
        )
      ),
    ];

    session.history.forEach((turn) => {
      const answered = Boolean(turn.answer);
      const cardChildren = [
        turn.intro && el("p", { class: "muted" }, turn.intro),
        el("div", { class: "inline-row" },
          el("span", { class: "day-badge" }, `Question ${turn.questionNumber}`),
          turn.topic && el("span", { class: "badge badge--info" }, turn.topic),
          turn.score != null && el("span", { class: `badge ${turn.score >= 7 ? "badge--ok" : "badge--warn"}` }, `Score: ${turn.score}/10`)
        ),
        el("p", { class: "mock-q" }, turn.question),
      ];

      if (answered) {
        cardChildren.push(
          el("div", { class: "mock-answer-box" }, el("strong", {}, "Your Answer: "), turn.answer),
          el("div", { class: "mock-feedback" },
            el("p", {}, el("strong", {}, "Strengths: "), (turn.strengths || []).join(" • ")),
            el("p", {}, el("strong", {}, "Improvements: "), (turn.improvements || []).join(" • ")),
            el("p", {}, el("strong", {}, "Model Answer: "), turn.modelAnswer)
          )
        );
      } else if (session.status === "active") {
        const textarea = el("textarea", {
          class: "panel__textarea panel__textarea--short",
          placeholder: "Type your answer here (or click 🎤 Speak Answer)...",
          maxlength: "4000",
        });

        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        const micBtn = SpeechRec
          ? el("button", {
              class: "button ghost-btn small-btn",
              type: "button",
              onClick: (e) => {
                const rec = new SpeechRec();
                rec.lang = "en-US";
                e.target.textContent = "🔴 Listening...";
                rec.onresult = (ev) => {
                  const transcript = ev.results[0][0].transcript;
                  textarea.value = `${textarea.value} ${transcript}`.trim();
                };
                rec.onend = () => (e.target.textContent = "🎤 Speak Answer");
                rec.start();
              },
            }, "🎤 Speak Answer")
          : null;

        const submitAnswer = async (finishNow = false) => {
          if (!textarea.value.trim()) return showError("Please enter your answer before submitting.");
          hideError();
          showOverlay("Evaluating your answer and preparing the next question...");
          try {
            const res = await api(`/api/mock/${session.id}/answer`, {
              method: "POST",
              body: { answer: textarea.value, finishNow },
            });
            session.status = res.status;
            session.history = res.history;
            session.summary = res.summary;
            renderSession(session);
            loadHistory();
          } catch (err) {
            showError(err.message);
          } finally {
            hideOverlay();
          }
        };

        cardChildren.push(
          textarea,
          el("div", { class: "inline-row" },
            el("button", { class: "button primary-button small-btn", type: "button", onClick: () => submitAnswer(false) }, "Submit Answer →"),
            micBtn,
            el("button", { class: "button ghost-btn small-btn", type: "button", onClick: () => submitAnswer(true) }, "Submit & Finish Early")
          )
        );
      }

      nodes.push(el("article", { class: "mock-turn" }, ...cardChildren));
    });

    if (session.summary) {
      const s = session.summary;
      nodes.push(
        el("div", { class: "card" },
          el("div", { class: "card__head" },
            el("h2", {}, "Final Interview Scorecard"),
            el("span", { class: `score-pill ${scoreClass(s.overallScore)}` }, `${s.overallScore}% — ${s.verdict}`)
          ),
          el("div", { class: "grid-2" },
            el("div", {}, el("p", { class: "small-label" }, "Top Strengths"), el("ul", { class: "clean-list" }, ...(s.topStrengths || []).map((x) => el("li", {}, x)))),
            el("div", {}, el("p", { class: "small-label" }, "Focus Areas Before Real Interview"), el("ul", { class: "clean-list" }, ...(s.focusAreas || []).map((x) => el("li", {}, x))))
          )
        )
      );
    }

    mount.replaceChildren(...nodes);
  }

  async function openSession(id) {
    const { session } = await api(`/api/mock/${id}`);
    renderSession(session);
  }

  $("#mock-start-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    showOverlay("AI Interviewer is reading the JD and preparing your first question...");
    try {
      const { session } = await api("/api/mock/start", {
        method: "POST",
        body: {
          jobDescription: $("#mockJd").value,
          interviewType: $("#mockType").value,
          difficulty: $("#mockDifficulty").value,
          maxQuestions: Number($("#mockCount").value || 5),
        },
      });
      renderSession(session);
      loadHistory();
    } catch (err) {
      showError(err.message);
    } finally {
      hideOverlay();
    }
  });

  await loadHistory();
}

// ---------- REPORT PAGE ----------

async function reportPage() {
  await requireLogin();
  const id = queryParam("id");

  let report;
  try {
    report = (await api(`/api/interviews/${encodeURIComponent(id)}`)).report;
  } catch (err) {
    $("#loading").hidden = true;
    return showError(err.message);
  }

  $("#loading").hidden = true;
  $("#report").hidden = false;
  document.title = `${report.title} — Interview AI`;
  $("#resume-link").href = `/resume.html?id=${report.id}`;

  $("#launch-mock").addEventListener("click", () => {
    sessionStorage.setItem("prefill_jd", report.jobDescription || "");
    location.href = "/mock.html";
  });
  $("#launch-roadmap").addEventListener("click", () => {
    sessionStorage.setItem("prefill_jd", report.jobDescription || "");
    sessionStorage.setItem("prefill_role", report.title || "");
    location.href = "/roadmaps.html";
  });
  $("#save-to-tracker").addEventListener("click", async (e) => {
    await api("/api/applications", {
      method: "POST",
      body: {
        company: "Target Company",
        role: report.title,
        jobDescription: report.jobDescription,
        matchScore: report.matchScore,
        status: "Saved",
        source: "Interview Plan",
      },
    });
    e.target.textContent = "✓ Saved to Tracker";
    e.target.disabled = true;
  });

  $("#job-title").textContent = report.title;
  $("#score-ring").className = `score-ring ${scoreClass(report.matchScore)}`;
  $("#score-ring").textContent = `${report.matchScore}%`;
  $("#score-text").textContent =
    report.matchScore >= 80 ? "Strong match for this role" :
    report.matchScore >= 60 ? "Good match, a few gaps to close" : "Needs work — follow the plan!";
  $("#gaps").replaceChildren(
    ...(report.skillGaps.length
      ? report.skillGaps.map((gap) => el("span", { class: `skill-tag skill-tag--${gap.severity}` }, gap.skill))
      : [el("p", { class: "muted" }, "No major gaps found.")])
  );

  const questionList = (title, questions) =>
    el("section", {},
      el("div", { class: "content-header" }, el("h2", {}, title), el("span", { class: "muted" }, `${questions.length} questions`)),
      ...questions.map((q, i) =>
        el("details", { class: "q-card" },
          el("summary", {}, el("span", { class: "q-index" }, `Q${i + 1}`), q.question),
          el("div", { class: "q-body" },
            el("span", { class: "tag tag--intention" }, "Intention"), el("p", {}, q.intention),
            el("span", { class: "tag tag--answer" }, "Model answer"), el("p", {}, q.answer)
          )
        )
      )
    );

  const roadmap = () =>
    el("section", {},
      el("div", { class: "content-header" }, el("h2", {}, "7-Day Preparation Plan"), el("span", { class: "muted" }, `${report.preparationPlan.length}-day plan`)),
      ...report.preparationPlan.map((day) =>
        el("div", { class: "roadmap-day" },
          el("div", { class: "roadmap-day__head" }, el("span", { class: "day-badge" }, `Day ${day.day}`), el("h3", {}, day.focus)),
          el("ul", {}, ...day.tasks.map((task) => el("li", {}, task)))
        )
      )
    );

  const tabs = {
    technical: () => questionList("Technical Questions", report.technicalQuestions),
    behavioral: () => questionList("Behavioral Questions", report.behavioralQuestions),
    roadmap,
  };

  function showTab(name) {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle("nav-item--active", button.dataset.tab === name);
    });
    $("#content").replaceChildren(tabs[name]());
  }
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
  showTab("technical");
}

// ---------- RESUME PAGE ----------

async function resumePage() {
  await requireLogin();
  const id = queryParam("id");
  $("#back").href = `/report.html?id=${encodeURIComponent(id)}`;
  $("#print").addEventListener("click", () => window.print());

  let resume;
  try {
    resume = (await api(`/api/interviews/${encodeURIComponent(id)}/resume`, { method: "POST" })).resume;
  } catch (err) {
    $("#loading").hidden = true;
    return showError(err.message);
  }

  if (resume.atsAnalysis) {
    const a = resume.atsAnalysis;
    const banner = $("#resume-ats-banner");
    banner.hidden = false;
    banner.replaceChildren(
      el("div", { class: "card" },
        el("div", { class: "card__head" },
          el("strong", {}, `ATS Compatibility Score: ${a.overallScore}% (Keywords: ${a.keywordScore}% • Impact: ${a.impactScore}% • Structure: ${a.structureScore}%)`),
          el("span", { class: "badge badge--ok" }, "ATS Single-Column Ready")
        ),
        a.missingKeywords?.length > 0 && el("p", { class: "muted" }, `Missing JD keywords (not fabricated): ${a.missingKeywords.join(", ")}`)
      )
    );
  }

  renderResumePaper($("#paper"), resume);
  document.title = `${resume.fullName || "Resume"} - ATS Resume`;
  $("#loading").hidden = true;
  $("#paper").hidden = false;
  $("#hint").hidden = false;
  $("#print").disabled = false;
}

// ---------- Boot ----------

const pages = {
  login: loginPage,
  register: registerPage,
  admin: adminPage,
  home: homePage,
  profile: profilePage,
  agent: agentPage,
  tracker: trackerPage,
  ats: atsPage,
  roadmaps: roadmapsPage,
  mock: mockPage,
  report: reportPage,
  resume: resumePage,
};
pages[document.body.dataset.page]?.();
