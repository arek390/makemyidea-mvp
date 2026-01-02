import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makemyidea-'))
process.env.DATA_DIR = tmpDir
process.env.SQLITE_PATH = path.join(tmpDir, 'test.sqlite')
process.env.SQLITE_SCHEMA = path.join(process.cwd(), 'db', 'schema.sql')

const { initEngineDb } = await import('../engine/db.mjs')
const { insertQuestions } = await import('../engine/questionRepository.mjs')
const { createSession, updateSessionState, recordAskedQuestion } = await import('../engine/sessionRepository.mjs')
const { suggestNextQuestion } = await import('../engine/suggester.mjs')

initEngineDb()

const baseQuestion = (overrides) => ({
  id: overrides.id,
  text: overrides.text,
  group_code: overrides.group_code ?? 'A',
  mode_code: overrides.mode_code ?? 1,
  category_code: overrides.category_code ?? 'GENERAL',
  intent_code: overrides.intent_code ?? 'prompt',
  difficulty: overrides.difficulty ?? 3,
  priority: overrides.priority ?? 50,
  is_active: overrides.is_active ?? 1,
  lang: overrides.lang ?? 't1',
  tags: overrides.tags ?? [],
})

// Test 1: keyword/tag overlap wins
insertQuestions([
  baseQuestion({
    id: 't1_q1',
    text: 'How does battery life impact usage?',
    lang: 't1',
    tags: ['battery'],
  }),
  baseQuestion({
    id: 't1_q2',
    text: 'How is the product stored?',
    lang: 't1',
    tags: [],
  }),
])

{
  const { sessionId } = createSession()
  const result = suggestNextQuestion({
    sessionId,
    lang: 't1',
    boardItems: [{ text: 'Battery performance is weak.' }],
  })
  assert.equal(result.id, 't1_q1')
}

// Test 2: rhythm penalty prefers matching group/mode/category
insertQuestions([
  baseQuestion({
    id: 't2_q1',
    text: 'Match group question',
    lang: 't2',
    group_code: 'A',
    mode_code: 1,
    category_code: 'GENERAL',
  }),
  baseQuestion({
    id: 't2_q2',
    text: 'Different group question',
    lang: 't2',
    group_code: 'B',
    mode_code: 2,
    category_code: 'PRICING',
  }),
])

{
  const { sessionId } = createSession()
  updateSessionState({
    sessionId,
    last_group_code: 'A',
    last_mode_code: 1,
    last_category_code: 'GENERAL',
  })
  const result = suggestNextQuestion({ sessionId, lang: 't2', boardItems: [] })
  assert.equal(result.id, 't2_q1')
}

// Test 3: stuck_counter favors easier questions
insertQuestions([
  baseQuestion({
    id: 't3_q1',
    text: 'Hard question',
    lang: 't3',
    difficulty: 5,
  }),
  baseQuestion({
    id: 't3_q2',
    text: 'Easy question',
    lang: 't3',
    difficulty: 1,
  }),
])

{
  const { sessionId } = createSession()
  updateSessionState({
    sessionId,
    stuck_counter: 2,
  })
  const result = suggestNextQuestion({ sessionId, lang: 't3', boardItems: [] })
  assert.equal(result.id, 't3_q2')
}


// Test 4: asked_questions prevents repeats
insertQuestions([
  baseQuestion({
    id: 't4_q1',
    text: 'First question',
    lang: 't4',
  }),
  baseQuestion({
    id: 't4_q2',
    text: 'Second question',
    lang: 't4',
  }),
])

{
  const { sessionId } = createSession()
  recordAskedQuestion({ sessionId, questionId: 't4_q1' })
  const result = suggestNextQuestion({ sessionId, lang: 't4', boardItems: [] })
  assert.equal(result.id, 't4_q2')
}

console.log('suggester tests: ok')
