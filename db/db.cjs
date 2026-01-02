const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

let db = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function applyPragmas(conn) {
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("busy_timeout = 5000");
  conn.pragma("foreign_keys = ON");
}

function runSchema(conn) {
  const schemaPath = path.join(PROJECT_ROOT, "db", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  conn.exec(schemaSql);
}

function getDb() {
  if (db) return db;

  ensureDataDir();
  const conn = new Database(DB_PATH);
  applyPragmas(conn);
  runSchema(conn);

  db = conn;
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
