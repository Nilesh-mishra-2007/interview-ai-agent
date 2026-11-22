// LOGIN HELPERS: password hashing and login sessions.
// Uses only Node's built-in "crypto" module.

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const db = require("./db");

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;

// Passwords are never stored as plain text - only a salted hash.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(attempt, Buffer.from(hash, "hex"));
}

// The browser keeps a random token in a cookie. We store only its hash.
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()); // tidy up old ones
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sha256(token), userId, expiresAt);

  return { token, maxAgeSeconds: SESSION_DAYS * 24 * 60 * 60 };
}

function getUserFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.id, users.username, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(sha256(token), Date.now());
  return row ? { id: row.id, username: row.username, email: row.email } : null;
}

function deleteSession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

// Cookie text. "HttpOnly" = JavaScript on the page can't read it (safer).
// "Secure" = only sent over HTTPS (switched on when NODE_ENV=production).
function sessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearCookie() {
  return sessionCookie("", 0);
}

module.exports = {
  hashPassword, checkPassword,
  createSession, getUserFromToken, deleteSession,
  sessionCookie, clearCookie,
};
