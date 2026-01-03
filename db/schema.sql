-- Enable WAL mode for better concurrency
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

-- =========================
-- QUESTIONS (corpus)
-- =========================
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  group_code TEXT NOT NULL CHECK (group_code IN ('A','B','C')),
  mode_code INTEGER NOT NULL CHECK (mode_code IN (1,2,3)),
  category_code TEXT NOT NULL,
  intent_code TEXT NOT NULL,
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  priority INTEGER NOT NULL DEFAULT 50,
  is_active INTEGER NOT NULL DEFAULT 1,
  lang TEXT NOT NULL DEFAULT 'pl'
);

CREATE INDEX IF NOT EXISTS idx_questions_group_mode
ON questions(group_code, mode_code);

CREATE TABLE IF NOT EXISTS question_texts (
  question_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (question_id, lang),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- =========================
-- QUESTION TAGS
-- =========================
CREATE TABLE IF NOT EXISTS question_tags (
  question_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (question_id, tag),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_tags_tag
ON question_tags(tag);

-- =========================
-- SESSIONS
-- =========================
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_group_code TEXT,
  last_mode_code INTEGER,
  last_category_code TEXT,
  stuck_counter INTEGER NOT NULL DEFAULT 0
);

-- =========================
-- BOARD ITEMS
-- =========================
CREATE TABLE IF NOT EXISTS board_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('idea','observation','doubt','question')),
  text TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  entry_type TEXT,
  prompt_type TEXT,
  matrix_row TEXT,
  matrix_col TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_board_items_session
ON board_items(session_id, created_at);

-- =========================
-- ASKED QUESTIONS (no repeats)
-- =========================
CREATE TABLE IF NOT EXISTS asked_questions (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  asked_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, question_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);


-- =========================
-- SESSION STATE (facilitation)
-- =========================
CREATE TABLE IF NOT EXISTS session_state (
  session_id TEXT PRIMARY KEY,
  depth_level INTEGER NOT NULL DEFAULT 3,
  hard_streak INTEGER NOT NULL DEFAULT 0,
  last_question_id TEXT,
  last_difficulty INTEGER,
  asked_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- =========================
-- SESSION ANSWERS
-- =========================
CREATE TABLE IF NOT EXISTS session_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  answer_signal TEXT NOT NULL,
  matrix_row TEXT NOT NULL,
  matrix_col TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);
