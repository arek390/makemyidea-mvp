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
const { createSession, ensureSessionState, getSession } = await import('../engine/sessionRepository.mjs')
const { finalizeSelection, selectQuestion } = await import('../engine/questionSelector.mjs')

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

// Test 1: deepen returns sequential ids within a cell and restarts after exhaustion
insertQuestions([
  baseQuestion({ id: 'a1_001', text: 'A1 first', lang: 't1', group_code: 'A', mode_code: 1 }),
  baseQuestion({ id: 'a1_002', text: 'A1 second', lang: 't1', group_code: 'A', mode_code: 1 }),
  baseQuestion({ id: 'a1_003', text: 'A1 third', lang: 't1', group_code: 'A', mode_code: 1 }),
])

{
  const { sessionId } = createSession()
  const picks = []
  for (let i = 0; i < 4; i += 1) {
    const { question } = selectQuestion({
      sessionId,
      lang: 't1',
      action: 'DEEPEN',
      groupCode: 'A',
      modeCode: 1,
    })
    finalizeSelection({ sessionId, question })
    picks.push(question?.id)
  }
  assert.deepEqual(picks, ['a1_001', 'a1_002', 'a1_003', 'a1_001'])
}

// Test 2: next returns non-repeating ids until exhaustion, then repeats allowed
insertQuestions([
  baseQuestion({ id: 't2_q1', text: 'Q1', lang: 't2', group_code: 'A', mode_code: 1 }),
  baseQuestion({ id: 't2_q2', text: 'Q2', lang: 't2', group_code: 'A', mode_code: 2 }),
  baseQuestion({ id: 't2_q3', text: 'Q3', lang: 't2', group_code: 'B', mode_code: 1 }),
])

{
  const { sessionId } = createSession()
  const seen = new Set()
  for (let i = 0; i < 3; i += 1) {
    const { question } = selectQuestion({ sessionId, lang: 't2', action: 'NEXT' })
    finalizeSelection({ sessionId, question })
    assert.ok(question)
    assert.ok(!seen.has(question.id))
    seen.add(question.id)
  }
  const { question: repeat } = selectQuestion({ sessionId, lang: 't2', action: 'NEXT' })
  finalizeSelection({ sessionId, question: repeat })
  assert.ok(repeat)
}

// Test 3: perspective moves to a neighbor cell (no A<->C or 1<->3 jumps)
insertQuestions([
  baseQuestion({ id: 'p_a1_001', text: 'A1 base', lang: 't3', group_code: 'A', mode_code: 1 }),
  baseQuestion({ id: 'p_a2_001', text: 'A2 neighbor', lang: 't3', group_code: 'A', mode_code: 2 }),
  baseQuestion({ id: 'p_b1_001', text: 'B1 neighbor', lang: 't3', group_code: 'B', mode_code: 1 }),
])

{
  const { sessionId } = createSession()
  const { question } = selectQuestion({
    sessionId,
    lang: 't3',
    action: 'PERSPECTIVE',
    groupCode: 'A',
    modeCode: 1,
  })
  finalizeSelection({ sessionId, question })
  assert.ok(question)
  assert.ok(
    (question.group_code === 'A' && question.mode_code === 2) ||
      (question.group_code === 'B' && question.mode_code === 1) ||
      (question.group_code === 'B' && question.mode_code === 2)
  )
  assert.notEqual(question.group_code, 'C')
  assert.notEqual(question.mode_code, 3)
}

// Test 4: language-specific text is returned when available
insertQuestions([
  baseQuestion({ id: 'lang_q1', text: 'Polskie pytanie', lang: 'pl' }),
  baseQuestion({ id: 'lang_q1', text: 'English question', lang: 'en' }),
])

{
  const { sessionId } = createSession()
  const { question } = selectQuestion({ sessionId, lang: 'en', action: 'NEXT' })
  finalizeSelection({ sessionId, question })
  assert.equal(question.text, 'English question')
}

console.log('suggester tests: ok')

{
  const sessionId = `auto-${Date.now()}`
  const state = ensureSessionState(sessionId)
  assert.ok(state)
  assert.ok(getSession(sessionId))
}

console.log('session ensure tests: ok')
