// DATABASE
// Uses Node.js 22 built-in SQLite ("node:sqlite"). Everything lives in one file
// (data/app.db) — no MongoDB or Postgres server required.

const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  -- User accounts
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Email OTP verification codes (hashed, 10-minute expiry)
  CREATE TABLE IF NOT EXISTS email_otps (
    email      TEXT PRIMARY KEY COLLATE NOCASE,
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    sent_at    INTEGER NOT NULL
  );

  -- Active browser sessions
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- Connected career profile (GitHub, LinkedIn, master resume, job agent & email alert preferences)
  CREATE TABLE IF NOT EXISTS profiles (
    user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name            TEXT DEFAULT '',
    headline             TEXT DEFAULT '',
    phone                TEXT DEFAULT '',
    location             TEXT DEFAULT '',
    target_roles         TEXT DEFAULT '',
    skills               TEXT DEFAULT '',
    experience_level     TEXT DEFAULT 'entry',
    preferred_location   TEXT DEFAULT 'Remote',
    work_mode            TEXT DEFAULT 'any',
    min_match_score      INTEGER DEFAULT 65,
    auto_scan_enabled    INTEGER DEFAULT 1,
    email_alerts_enabled INTEGER DEFAULT 1,
    github_username      TEXT DEFAULT '',
    github_data          TEXT DEFAULT '',
    github_synced_at     TEXT,
    linkedin_url         TEXT DEFAULT '',
    portfolio_url        TEXT DEFAULT '',
    bio                  TEXT DEFAULT '',
    master_resume_pdf    BLOB,
    master_resume_name   TEXT DEFAULT '',
    ats_boards           TEXT DEFAULT '',
    webhook_url          TEXT DEFAULT '',
    telegram_chat_id     TEXT DEFAULT '',
    updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Original interview preparation reports
  CREATE TABLE IF NOT EXISTS reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    job_description  TEXT NOT NULL,
    self_description TEXT,
    resume_pdf       BLOB,
    match_score      INTEGER,
    data             TEXT NOT NULL,
    resume_json      TEXT,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Standalone ATS-friendly resumes + ATS score analyses + cover letters
  CREATE TABLE IF NOT EXISTS ats_resumes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    company           TEXT DEFAULT '',
    job_description   TEXT NOT NULL,
    ats_score         INTEGER DEFAULT 0,
    analysis_json     TEXT NOT NULL,
    resume_json       TEXT NOT NULL,
    cover_letter_json TEXT,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Jobs discovered by the AI Career Agent
  CREATE TABLE IF NOT EXISTS discovered_jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id      TEXT NOT NULL,
    source           TEXT NOT NULL,
    title            TEXT NOT NULL,
    company          TEXT NOT NULL,
    location         TEXT DEFAULT '',
    work_mode        TEXT DEFAULT '',
    salary           TEXT DEFAULT '',
    apply_url        TEXT NOT NULL,
    description      TEXT NOT NULL,
    posted_at        TEXT DEFAULT '',
    match_score      INTEGER DEFAULT 0,
    match_reason     TEXT DEFAULT '',
    matched_skills   TEXT DEFAULT '[]',
    missing_skills   TEXT DEFAULT '[]',
    status           TEXT NOT NULL DEFAULT 'new',
    apply_pack_json  TEXT,
    discovered_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, external_id)
  );

  -- Job application tracker & pipeline manager
  CREATE TABLE IF NOT EXISTS applications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discovered_job_id INTEGER REFERENCES discovered_jobs(id) ON DELETE SET NULL,
    report_id         INTEGER REFERENCES reports(id) ON DELETE SET NULL,
    ats_resume_id     INTEGER REFERENCES ats_resumes(id) ON DELETE SET NULL,
    company           TEXT NOT NULL,
    role              TEXT NOT NULL,
    location          TEXT DEFAULT '',
    salary            TEXT DEFAULT '',
    source            TEXT DEFAULT 'Manual',
    apply_url         TEXT DEFAULT '',
    job_description   TEXT DEFAULT '',
    match_score       INTEGER,
    status            TEXT NOT NULL DEFAULT 'Saved',
    applied_at        TEXT DEFAULT '',
    follow_up_date    TEXT DEFAULT '',
    notes             TEXT DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- In-app notifications
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'job_match',
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    link       TEXT DEFAULT '',
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- AI skill learning roadmaps with curated resources & progress tracking
  CREATE TABLE IF NOT EXISTS roadmaps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    target_role   TEXT DEFAULT '',
    level         TEXT DEFAULT 'intermediate',
    weeks         INTEGER DEFAULT 8,
    data_json     TEXT NOT NULL,
    progress_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Interactive JD-based AI Mock Interview sessions
  CREATE TABLE IF NOT EXISTS mock_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    job_description TEXT NOT NULL,
    interview_type  TEXT NOT NULL DEFAULT 'mixed',
    difficulty      TEXT NOT NULL DEFAULT 'mid',
    max_questions   INTEGER NOT NULL DEFAULT 6,
    history_json    TEXT NOT NULL DEFAULT '[]',
    summary_json    TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Daily AI usage counter
  CREATE TABLE IF NOT EXISTS ai_usage (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_discovered_user ON discovered_jobs(user_id, match_score DESC);
  CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, id DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_user ON ai_usage(user_id, created_at);
`);

// Safe migrations for existing databases upgraded from v2.0 -> v2.1
function addColumnIfMissing(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}
addColumnIfMissing("users", "email_verified", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("profiles", "email_alerts_enabled", "INTEGER DEFAULT 1");

module.exports = db;
