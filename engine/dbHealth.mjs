import { ENGINE_DB_PATH, getEngineDb } from './db.mjs'

export const getDbHealth = (db = getEngineDb()) => {
  const questionsCount = db.prepare('SELECT COUNT(*) as n FROM questions').get()?.n ?? 0
  const questionTextsCount = db.prepare('SELECT COUNT(*) as n FROM question_texts').get()?.n ?? 0
  const questionTextsByLang = db
    .prepare('SELECT lang, COUNT(*) as n FROM question_texts GROUP BY lang ORDER BY lang')
    .all()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name)
  return {
    questionsCount,
    questionTextsCount,
    questionTextsByLang,
    tables,
    dbPath: ENGINE_DB_PATH,
  }
}
