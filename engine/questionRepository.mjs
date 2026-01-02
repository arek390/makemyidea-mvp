import { getEngineDb } from './db.mjs'

const insertQuestion = (db) =>
  db.prepare(
    `INSERT INTO questions
    (id, text, group_code, mode_code, category_code, intent_code, difficulty, priority, is_active, lang)
    VALUES (@id, @text, @group_code, @mode_code, @category_code, @intent_code, @difficulty, @priority, @is_active, @lang)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      group_code = excluded.group_code,
      mode_code = excluded.mode_code,
      category_code = excluded.category_code,
      intent_code = excluded.intent_code,
      difficulty = excluded.difficulty,
      priority = excluded.priority,
      is_active = excluded.is_active,
      lang = excluded.lang`
  )

const insertTag = (db) =>
  db.prepare(`INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (@question_id, @tag)`)






export const insertQuestions = (questions) => {
  const db = getEngineDb()
  const tx = db.transaction((items) => {
    const insertQ = insertQuestion(db)
    const insertT = insertTag(db)
    items.forEach((q) => {
      insertQ.run({
        id: q.id,
        text: q.text,
        group_code: q.group_code,
        mode_code: q.mode_code,
        category_code: q.category_code,
        intent_code: q.intent_code,
        difficulty: q.difficulty,
        priority: q.priority ?? 50,
        is_active: q.is_active ?? 1,
        lang: q.lang ?? 'pl',
      })
      if (Array.isArray(q.tags)) {
        q.tags.forEach((tag) => insertT.run({ question_id: q.id, tag }))
      }
    })
  })
  tx(questions)
  return { inserted: questions.length }
}

export const getQuestionById = (id) => {
  const db = getEngineDb()
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
}

export const listQuestionTags = (questionId) => {
  const db = getEngineDb()
  return db
    .prepare('SELECT tag FROM question_tags WHERE question_id = ? ORDER BY tag ASC')
    .all(questionId)
    .map((row) => row.tag)
}

export const listQuestions = ({ lang }) => {
  const db = getEngineDb()
  const rows = db
    .prepare(
      `SELECT id, text, group_code, mode_code, category_code, intent_code, difficulty, priority, is_active, lang
       FROM questions
       WHERE is_active = 1 AND lang = @lang`
    )
    .all({ lang })
  return rows.map((row) => ({
    ...row,
    tags: listQuestionTags(row.id),
  }))
}







export const listQuestionsWithTags = ({ lang }) => {
  const db = getEngineDb()
  const rows = db.prepare(
    `SELECT
        q.id, q.text, q.group_code, q.mode_code, q.category_code, q.intent_code,
        q.difficulty, q.priority, q.is_active, q.lang,
        COALESCE(GROUP_CONCAT(t.tag), '') AS tags_csv
     FROM questions q
     LEFT JOIN question_tags t ON t.question_id = q.id
     WHERE q.is_active = 1 AND q.lang = @lang
     GROUP BY q.id`
  ).all({ lang })

  return rows.map((r) => ({
    ...r,
    tags: r.tags_csv ? r.tags_csv.split(',') : [],
  }))
}
