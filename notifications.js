// NOTIFICATIONS: stores in-app alerts in SQLite and optionally pushes
// real-time alerts to Discord, Slack, or Telegram (zero dependencies).

const db = require("./db");

async function pushExternalAlert(profile, title, message, link) {
  if (!profile) return;

  // 1. Discord or Slack Webhook (user pastes webhook URL in Profile settings)
  const webhookUrl = (profile.webhook_url || "").trim();
  if (webhookUrl && /^https:\/\/(discord\.com|discordapp\.com|hooks\.slack\.com)\//i.test(webhookUrl)) {
    try {
      const fullText = `**${title}**\n${message}${link ? `\n${link}` : ""}`;
      const payload = webhookUrl.includes("slack.com")
        ? { text: `*${title}*\n${message}${link ? `\n${link}` : ""}` }
        : { content: fullText };
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      console.error("Webhook notification failed:", err.message);
    }
  }

  // 2. Telegram Bot push (requires TELEGRAM_BOT_TOKEN in .env + user's telegram_chat_id)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = (profile.telegram_chat_id || "").trim();
  if (botToken && chatId) {
    try {
      const text = `${title}\n\n${message}${link ? `\n\n${link}` : ""}`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      console.error("Telegram notification failed:", err.message);
    }
  }
}

function createNotification(userId, { type = "job_match", title, message, link = "", pushExternal = false }) {
  db.prepare(
    "INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, type, title, message, link);

  if (pushExternal) {
    const profile = db.prepare("SELECT webhook_url, telegram_chat_id FROM profiles WHERE user_id = ?").get(userId);
    // Fire-and-forget so external alert latency never blocks HTTP responses.
    pushExternalAlert(profile, title, message, link).catch(() => {});
  }
}

function checkFollowUpReminders(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const due = db.prepare(`
    SELECT id, company, role, follow_up_date
    FROM applications
    WHERE user_id = ?
      AND follow_up_date != ''
      AND follow_up_date <= ?
      AND status NOT IN ('Offer', 'Rejected')
  `).all(userId, today);

  for (const app of due) {
    const marker = `Follow-up due: ${app.role} at ${app.company}`;
    const alreadyNotified = db.prepare(`
      SELECT id FROM notifications
      WHERE user_id = ? AND type = 'reminder' AND title = ? AND created_at > datetime('now', '-1 day')
    `).get(userId, marker);

    if (!alreadyNotified) {
      createNotification(userId, {
        type: "reminder",
        title: marker,
        message: `Scheduled follow-up (${app.follow_up_date}) is due. Open Job Tracker to send a polite follow-up.`,
        link: "/tracker.html",
        pushExternal: true,
      });
    }
  }
}

module.exports = { createNotification, checkFollowUpReminders, pushExternalAlert };
