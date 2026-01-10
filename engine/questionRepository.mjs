import { getEngineDb } from './db.mjs'

const ensureQuestionTextsTable = (db) => {
  db.exec(
    `CREATE TABLE IF NOT EXISTS question_texts (
      question_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (question_id, lang),
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )`
  )
}

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

const insertQuestionText = (db) =>
  db.prepare(
    `INSERT INTO question_texts (question_id, lang, text)
     VALUES (@question_id, @lang, @text)
     ON CONFLICT(question_id, lang) DO UPDATE SET
       text = excluded.text`
  )





export const insertQuestions = (questions) => {
  const db = getEngineDb()
  ensureQuestionTextsTable(db)
  const baseById = new Map()
  const texts = []

  questions.forEach((q) => {
    if (!q?.id || !q?.text) return
    const lang = String(q.lang || 'pl').toLowerCase()
    texts.push({ question_id: q.id, lang, text: q.text })
    const current = baseById.get(q.id)
    if (!current || (current.lang !== 'pl' && lang === 'pl')) {
      baseById.set(q.id, { ...q, lang })
    }
  })

  const baseQuestions = Array.from(baseById.values())

  const tx = db.transaction((items, translations) => {
    const insertQ = insertQuestion(db)
    const insertT = insertTag(db)
    const insertText = insertQuestionText(db)
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
    translations.forEach((entry) => {
      insertText.run(entry)
    })
  })
  tx(baseQuestions, texts)
  return { inserted: baseQuestions.length }
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
      `SELECT
         q.id,
         COALESCE(t_lang.text, t_pl.text, q.text) AS text,
         q.group_code, q.mode_code, q.category_code, q.intent_code,
         q.difficulty, q.priority, q.is_active, q.lang
       FROM questions q
       LEFT JOIN question_texts t_lang
         ON t_lang.question_id = q.id AND t_lang.lang = @lang
       LEFT JOIN question_texts t_pl
         ON t_pl.question_id = q.id AND t_pl.lang = 'pl'
       WHERE q.is_active = 1`
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
        q.id,
        COALESCE(t_lang.text, t_pl.text, q.text) AS text,
        t_lang.text AS lang_text,
        t_pl.text AS pl_text,
        q.group_code, q.mode_code, q.category_code, q.intent_code,
        q.difficulty, q.priority, q.is_active, q.lang,
        COALESCE(GROUP_CONCAT(t.tag), '') AS tags_csv
     FROM questions q
     LEFT JOIN question_texts t_lang
       ON t_lang.question_id = q.id AND t_lang.lang = @lang
     LEFT JOIN question_texts t_pl
       ON t_pl.question_id = q.id AND t_pl.lang = 'pl'
     LEFT JOIN question_tags t ON t.question_id = q.id
     WHERE q.is_active = 1
     GROUP BY q.id`
  ).all({ lang })

  return rows.map((r) => ({
    ...r,
    lang_text: r.lang_text ?? null,
    pl_text: r.pl_text ?? null,
    tags: r.tags_csv ? r.tags_csv.split(',') : [],
  }))
}
