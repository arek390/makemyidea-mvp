import { ENGINE_DB_PATH, getEngineDb } from './db.mjs'

export const getDbHealth = () => {
  const db = getEngineDb()
  const questionCount = db.prepare('SELECT COUNT(*) as count FROM questions').get()?.count ?? 0
  const questionTextsCount = db
    .prepare('SELECT COUNT(*) as count FROM question_texts')
    .get()?.count ?? 0
  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get()?.count ?? 0
  const langs = db
    .prepare('SELECT lang, COUNT(*) as count FROM question_texts GROUP BY lang ORDER BY lang')
    .all()
  return {
    dbPath: ENGINE_DB_PATH,
    questions: questionCount,
    questionTexts: questionTextsCount,
    sessions: sessionCount,
    langs,
  }
}
