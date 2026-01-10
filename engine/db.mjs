import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'engine.sqlite')
const SCHEMA_PATH = process.env.SQLITE_SCHEMA || path.join(process.cwd(), 'db', 'schema.sql')
let engineDb = null
let didLogDbPath = false

const applyPragmas = (db) => {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
}

export const initEngineDb = () => {
  if (engineDb) return engineDb
  fs.mkdirSync(DATA_DIR, { recursive: true })
  engineDb = new Database(DB_PATH)
  applyPragmas(engineDb)
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  engineDb.exec(schema)
  if (process.env.DEBUG_ENGINE === '1' && !didLogDbPath) {
    console.log(JSON.stringify({ event: 'engine_db_path', path: DB_PATH }))
    didLogDbPath = true
  }
  return engineDb
}

export const getEngineDb = () => engineDb ?? initEngineDb()
export const ENGINE_DB_PATH = DB_PATH
