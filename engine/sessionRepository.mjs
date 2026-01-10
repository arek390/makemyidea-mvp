import crypto from 'node:crypto'
import { getEngineDb } from './db.mjs'

const nowMs = () => Date.now()

const ensureSessionsColumns = () => {
  const db = getEngineDb()
  const columns = db.prepare(`PRAGMA table_info(sessions)`).all().map((row) => row.name)
  if (!columns.includes('name')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN name TEXT').run()
  }
}

const ensureBoardItemsColumns = () => {
  const db = getEngineDb()
  const columns = db.prepare(`PRAGMA table_info(board_items)`).all().map((row) => row.name)
  const missing = []
  if (!columns.includes('entry_type')) missing.push('entry_type')
  if (!columns.includes('prompt_type')) missing.push('prompt_type')
  if (!columns.includes('matrix_row')) missing.push('matrix_row')
  if (!columns.includes('matrix_col')) missing.push('matrix_col')
  if (!columns.includes('label')) missing.push('label')
  if (missing.length) {
    missing.forEach((col) => db.prepare(`ALTER TABLE board_items ADD COLUMN ${col} TEXT`).run())
  }
}

export const listSessionAnswers = (sessionId) => {
  const db = getEngineDb()
  return db
    .prepare(
      `SELECT question_id, answer, answer_signal, matrix_row, matrix_col, created_at
       FROM session_answers
       WHERE session_id = @session_id
       ORDER BY created_at ASC`
    )
    .all({ session_id: sessionId })
}

export const listRecentSessionAnswers = (sessionId, limit = 10) => {
  const db = getEngineDb()
  return db
    .prepare(
      `SELECT question_id, answer, answer_signal, matrix_row, matrix_col, created_at
       FROM session_answers
       WHERE session_id = @session_id
       ORDER BY created_at DESC
       LIMIT @limit`
    )
    .all({ session_id: sessionId, limit })
}







export const createSession = ({ name }) => {
  const db = getEngineDb()
  ensureSessionsColumns()
  const id = crypto.randomUUID()
  const timestamp = nowMs()
  db.prepare(
    `INSERT INTO sessions (id, name, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter)
     VALUES (@id, @name, @created_at, @updated_at, NULL, NULL, NULL, 0)`
  ).run({ id, name: name || null, created_at: timestamp, updated_at: timestamp })
  return { sessionId: id }
}

export const updateSessionName = ({ sessionId, name }) => {
  const db = getEngineDb()
  ensureSessionsColumns()
  db.prepare(
    `UPDATE sessions
     SET name = COALESCE(NULLIF(@name, ''), name),
         updated_at = @updated_at
     WHERE id = @id`
  ).run({ id: sessionId, name, updated_at: nowMs() })
}

export const getSession = (sessionId) => {
  const db = getEngineDb()
  ensureSessionsColumns()
  return db
    .prepare(
      `SELECT id, name, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter
       FROM sessions WHERE id = @id`
    )
    .get({ id: sessionId })
}


export const listSessions = ({ limit = 50 } = {}) => {
  const db = getEngineDb()
  ensureSessionsColumns()
  return db
    .prepare(
      `SELECT id, name, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter
       FROM sessions
       ORDER BY updated_at DESC
       LIMIT @limit`
    )
    .all({ limit })
}

export const updateSessionState = ({
  sessionId,
  last_group_code,
  last_mode_code,
  last_category_code,
  stuck_counter,
}) => {
  const db = getEngineDb()
  db.prepare(
    `UPDATE sessions
     SET updated_at = @updated_at,
         last_group_code = @last_group_code,
         last_mode_code = @last_mode_code,
         last_category_code = @last_category_code,
         stuck_counter = COALESCE(@stuck_counter, stuck_counter)
     WHERE id = @id`
  ).run({
    updated_at: nowMs(),
    last_group_code,
    last_mode_code,
    last_category_code,
    stuck_counter,
    id: sessionId,
  })
}

export const addBoardItem = ({
  sessionId,
  type,
  text,
  entry_type,
  prompt_type,
  matrix_row,
  matrix_col,
  label,
}) => {
  const db = getEngineDb()
  ensureBoardItemsColumns()
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO board_items (id, session_id, type, text, label, created_at, entry_type, prompt_type, matrix_row, matrix_col)
     VALUES (@id, @session_id, @type, @text, @label, @created_at, @entry_type, @prompt_type, @matrix_row, @matrix_col)`
  ).run({
    id,
    session_id: sessionId,
    type,
    text,
    label: label ?? null,
    created_at: nowMs(),
    entry_type,
    prompt_type,
    matrix_row,
    matrix_col,
  })
  return { id, label: label ?? null }
}

export const listBoardItems = ({ sessionId, limit = 50 }) => {
  const db = getEngineDb()
  ensureBoardItemsColumns()
  return db
    .prepare(
      `SELECT id, type, text, label, created_at, entry_type, prompt_type, matrix_row, matrix_col
       FROM board_items
       WHERE session_id = @session_id
       ORDER BY created_at DESC
       LIMIT @limit`
    )
    .all({ session_id: sessionId, limit })
}

export const getBoardItem = (id) => {
  const db = getEngineDb()
  ensureBoardItemsColumns()
  return db
    .prepare(
      `SELECT id, session_id, type, text, label, created_at, entry_type, prompt_type, matrix_row, matrix_col
       FROM board_items
       WHERE id = @id`
    )
    .get({ id })
}

export const updateBoardItem = ({ id, text }) => {
  const db = getEngineDb()
  return db
    .prepare(
      `UPDATE board_items
       SET text = @text
       WHERE id = @id`
    )
    .run({ id, text })
}

export const updateBoardItemLabel = ({ id, label }) => {
  const db = getEngineDb()
  ensureBoardItemsColumns()
  return db
    .prepare(
      `UPDATE board_items
       SET label = @label
       WHERE id = @id`
    )
    .run({ id, label: label ?? null })
}

export const deleteBoardItem = (id) => {
  const db = getEngineDb()
  return db
    .prepare(
      `DELETE FROM board_items
       WHERE id = @id`
    )
    .run({ id })
}

export const deleteSession = (id) => {
  const db = getEngineDb()
  return db
    .prepare(
      `DELETE FROM sessions
       WHERE id = @id`
    )
    .run({ id })
}

export const recordAskedQuestion = ({ sessionId, questionId }) => {
  const db = getEngineDb()
  db.prepare(
    `INSERT OR IGNORE INTO asked_questions (session_id, question_id, asked_at)
     VALUES (@session_id, @question_id, @asked_at)`
  ).run({ session_id: sessionId, question_id: questionId, asked_at: nowMs() })
}

export const hasAskedQuestion = ({ sessionId, questionId }) => {
  const db = getEngineDb()
  const row = db
    .prepare(
      `SELECT 1 FROM asked_questions WHERE session_id = @session_id AND question_id = @question_id`
    )
    .get({ session_id: sessionId, question_id: questionId })
  return Boolean(row)
}

export const ensureSessionExists = (sessionId) => {
  if (!sessionId) return null
  const existing = getSession(sessionId)
  if (existing) return existing
  const created = ensureSession(sessionId)
  if (process.env.DEBUG_SESSION === '1') {
    console.log(
      JSON.stringify({
        event: 'session_auto_created',
        sessionId,
      })
    )
  }
  return created
}

export const ensureSessionState = (sessionId) => {
  ensureSessionExists(sessionId)
  const db = getEngineDb()
  const timestamp = nowMs()
  db.prepare(
    `INSERT INTO session_state (session_id, depth_level, hard_streak, last_question_id, last_difficulty, asked_count, updated_at)
     VALUES (@session_id, 3, 0, NULL, NULL, 0, @updated_at)
     ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at`
  ).run({ session_id: sessionId, updated_at: timestamp })
  return getSessionState(sessionId)
}

export const getSessionState = (sessionId) => {
  const db = getEngineDb()
  return db
    .prepare(
      `SELECT session_id, depth_level, hard_streak, last_question_id, last_difficulty, asked_count, updated_at
       FROM session_state
       WHERE session_id = @session_id`
    )
    .get({ session_id: sessionId })
}

export const updateSessionStateRow = ({
  sessionId,
  depth_level,
  hard_streak,
  last_question_id,
  last_difficulty,
  asked_count,
}) => {
  const db = getEngineDb()
  db.prepare(
    `UPDATE session_state
     SET updated_at = @updated_at,
         depth_level = COALESCE(@depth_level, depth_level),
         hard_streak = COALESCE(@hard_streak, hard_streak),
         last_question_id = COALESCE(@last_question_id, last_question_id),
         last_difficulty = COALESCE(@last_difficulty, last_difficulty),
         asked_count = COALESCE(@asked_count, asked_count)
     WHERE session_id = @session_id`
  ).run({
    session_id: sessionId,
    updated_at: nowMs(),
    depth_level,
    hard_streak,
    last_question_id,
    last_difficulty,
    asked_count,
  })
}

export const incrementAskedCount = (sessionId) => {
  const db = getEngineDb()
  db.prepare(
    `UPDATE session_state
     SET asked_count = asked_count + 1,
         updated_at = @updated_at
     WHERE session_id = @session_id`
  ).run({ session_id: sessionId, updated_at: nowMs() })
}

const ensureSessionAnswersColumns = () => {
  const db = getEngineDb()
  const columns = db.prepare(`PRAGMA table_info(session_answers)`).all().map((row) => row.name)
  const missing = []
  if (!columns.includes('matrix_row')) missing.push('matrix_row')
  if (!columns.includes('matrix_col')) missing.push('matrix_col')
  missing.forEach((col) => {
    db.prepare(`ALTER TABLE session_answers ADD COLUMN ${col} TEXT`).run()
  })
}

export const recordSessionAnswer = ({ sessionId, questionId, answer, answer_signal, matrix_row, matrix_col }) => {
  const db = getEngineDb()
  ensureSessionAnswersColumns()
  db.prepare(
    `INSERT INTO session_answers (session_id, question_id, answer, answer_signal, matrix_row, matrix_col, created_at)
     VALUES (@session_id, @question_id, @answer, @answer_signal, @matrix_row, @matrix_col, @created_at)`
  ).run({
    session_id: sessionId,
    question_id: questionId,
    answer,
    answer_signal,
    matrix_row,
    matrix_col,
    created_at: nowMs(),
  })
}

export const getLastSessionAnswer = (sessionId) => {
  const db = getEngineDb()
  return db
    .prepare(
      `SELECT question_id, answer, answer_signal, created_at
       FROM session_answers
       WHERE session_id = @session_id
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get({ session_id: sessionId })
}








export const ensureSession = (sessionId) => {
  const db = getEngineDb()
  const timestamp = nowMs()

  db.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter)
     VALUES (@id, @created_at, @updated_at, NULL, NULL, NULL, 0)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
  ).run({ id: sessionId, created_at: timestamp, updated_at: timestamp })

  return getSession(sessionId)
}

export const listAskedQuestionIds = (sessionId) => {
  const db = getEngineDb()
  return db
    .prepare(
      `SELECT question_id
       FROM asked_questions
       WHERE session_id = @session_id`
    )
    .all({ session_id: sessionId })
    .map((r) => r.question_id)
}
