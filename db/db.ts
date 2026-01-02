import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const PROJECT_ROOT = process.cwd();

// DB file OUTSIDE iCloud is already solved (you moved project locally)
// Keep DB file in a local folder inside project for MVP:
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

let db: Database.Database | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function applyPragmas(conn: Database.Database) {
  // Concurrency & stability settings for MVP
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("busy_timeout = 5000");
  conn.pragma("foreign_keys = ON");
}

function runSchema(conn: Database.Database) {
  const schemaPath = path.join(PROJECT_ROOT, "db", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  conn.exec(schemaSql);
}

export function getDb(): Database.Database {
  if (db) return db;

  ensureDataDir();

  const conn = new Database(DB_PATH);
  applyPragmas(conn);
  runSchema(conn);

  db = conn;
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
