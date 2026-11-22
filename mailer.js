// EMAIL ENGINE (Zero dependencies — uses Node 22 built-in fetch)
// Supports Resend (RESEND_API_KEY) OR Brevo (BREVO_API_KEY).
// If neither key is set in local dev, logs emails & OTP codes cleanly to the terminal
// so you can test the full registration & job alert flow immediately!

const { AppError } = require("./errors");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getEmailProvider() {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.BREVO_API_KEY) return "brevo";
  return "console";
}

async function sendEmail({ to, subject, html, text }) {
  const provider = getEmailProvider();
  const fromEmail = process.env.FROM_EMAIL || "Interview AI <onboarding@resend.dev>";

  if (provider === "console") {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(500, "Email service is not configured. Set RESEND_API_KEY or BREVO_API_KEY in environment variables.");
    }
    console.log("\n================ [DEV EMAIL PREVIEW] ================");
    console.log(`To:      ${to}`);
    console.log(`From:    ${fromEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    console.log("=====================================================\n");
    return { delivered: false, mode: "console" };
  }

  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Resend error:", res.status, data);
      throw new AppError(502, `Could not send email (${data.message || `HTTP ${res.status}`})`);
    }
    return { delivered: true, mode: "resend", id: data.id };
  }

  if (provider === "brevo") {
    // Parse "Name <email@domain.com>" or plain "email@domain.com"
    const match = fromEmail.match(/^(.*)<([^>]+)>$/);
    const sender = match
      ? { name: match[1].trim() || "Interview AI", email: match[2].trim() }
      : { name: "Interview AI", email: fromEmail.trim() };

    const recipients = (Array.isArray(to) ? to : [to]).map((email) => ({ email }));
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: recipients,
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Brevo error:", res.status, data);
      throw new AppError(502, `Could not send email (${data.message || `HTTP ${res.status}`})`);
    }
    return { delivered: true, mode: "brevo", id: data.messageId };
  }
}

// 1. Registration 6-digit OTP email
async function sendOtpEmail({ to, username, otp }) {
  const safeName = escapeHtml(username || "there");
  const subject = `${otp} is your Interview AI verification code`;
  const text = `Hi ${username || "there"},\n\nYour Interview AI verification OTP is: ${otp}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0d1117;color:#e6edf3;border-radius:12px;">
      <h2 style="margin:0 0 8px;color:#ffffff;">Interview <span style="color:#ff2d78;">AI</span></h2>
      <p style="margin:0 0 16px;color:#8b949e;">Hi ${safeName}, use the 6-digit code below to verify your email and finish creating your account:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;padding:18px;background:#161b22;border:1px solid #2a3348;border-radius:10px;color:#ff2d78;margin:16px 0;">
        ${escapeHtml(otp)}
      </div>
      <p style="margin:16px 0 0;font-size:13px;color:#8b949e;">This code expires in <strong>10 minutes</strong>. Never share it with anyone.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text });
}

// 2. Instant notification to Admin when a new user registers
async function sendAdminSignupAlert({ username, email }) {
  const adminEmails = String(process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!adminEmails.length) return;

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const subject = `New user registered: ${username} (${email})`;
  const text = `A new user registered on Interview AI:\n\nUsername: ${username}\nEmail: ${email}\n\nView all registered users: ${appUrl}/admin.html`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:20px;background:#0d1117;color:#e6edf3;border-radius:10px;">
      <h3 style="margin:0 0 12px;color:#ffffff;">New User Registered on Interview <span style="color:#ff2d78;">AI</span></h3>
      <p style="margin:0 0 6px;"><strong>Username:</strong> ${escapeHtml(username)}</p>
      <p style="margin:0 0 14px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
      <a href="${escapeHtml(appUrl)}/admin.html" style="display:inline-block;padding:10px 16px;background:#e1034d;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open Admin Email List →</a>
    </div>
  `;
  await sendEmail({ to: adminEmails, subject, html, text }).catch((err) =>
    console.error("Admin signup alert email failed:", err.message)
  );
}

// 3. Automatic Job Match Alert email to a registered user
async function sendJobAlertEmail({ to, username, jobs }) {
  if (!to || !Array.isArray(jobs) || !jobs.length) return;
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const top = jobs[0];
  const subject = `${jobs.length} new job match${jobs.length > 1 ? "es" : ""}: ${top.title} at ${top.company}`;

  const textLines = [
    `Hi ${username || "there"},`,
    "",
    `Your AI Career Agent found ${jobs.length} new job${jobs.length > 1 ? "s" : ""} matching your profile:`,
    "",
    ...jobs.map((j) => `- ${j.title} at ${j.company} (${j.matchScore}% match)${j.location ? ` — ${j.location}` : ""}\n  Apply: ${j.applyUrl}`),
    "",
    `Prepare tailored ATS resumes & cover letters here: ${appUrl}/agent.html`,
    `Manage email alerts in Profile: ${appUrl}/profile.html`,
  ];

  const cardsHtml = jobs
    .map(
      (j) => `
      <div style="padding:14px;background:#161b22;border:1px solid #2a3348;border-radius:8px;margin-bottom:10px;">
        <div style="font-size:15px;font-weight:700;color:#ffffff;">${escapeHtml(j.title)} — ${escapeHtml(j.company)}</div>
        <div style="font-size:13px;color:#8b949e;margin:4px 0 10px;">
          Match: <strong style="color:#3fb950;">${j.matchScore}%</strong>
          ${j.location ? ` &bull; ${escapeHtml(j.location)}` : ""}
          ${j.source ? ` &bull; ${escapeHtml(j.source)}` : ""}
        </div>
        <a href="${escapeHtml(j.applyUrl)}" style="display:inline-block;padding:7px 12px;background:#e1034d;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Apply Now ↗</a>
      </div>`
    )
    .join("");

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0d1117;color:#e6edf3;border-radius:12px;">
      <h2 style="margin:0 0 8px;color:#ffffff;">Interview <span style="color:#ff2d78;">AI</span> Job Alert</h2>
      <p style="margin:0 0 16px;color:#8b949e;">Hi ${escapeHtml(username || "there")}, your AI Job Agent found new roles matching your field:</p>
      ${cardsHtml}
      <p style="margin:18px 0 6px;">
        <a href="${escapeHtml(appUrl)}/agent.html" style="color:#ff2d78;font-weight:600;">Open AI Job Agent to generate 1-click ATS Resumes &amp; Cover Letters →</a>
      </p>
      <p style="margin:0;font-size:12px;color:#8b949e;">
        To pause job alert emails, uncheck Email Job Alerts in your <a href="${escapeHtml(appUrl)}/profile.html" style="color:#8b949e;">Profile settings</a>.
      </p>
    </div>
  `;

  return sendEmail({ to, subject, html, text: textLines.join("\n") });
}

module.exports = {
  getEmailProvider,
  sendEmail,
  sendOtpEmail,
  sendAdminSignupAlert,
  sendJobAlertEmail,
};
