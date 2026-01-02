import { listQuestionsWithTags } from './questionRepository.mjs'
import {
  ensureSession,
  ensureSessionState,
  getLastSessionAnswer,
  getSessionState,
  listAskedQuestionIds,
  updateSessionStateRow,
} from './sessionRepository.mjs'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const countWords = (text) =>
  (text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

export const computeAnswerSignal = (answer) => {
  const raw = (answer || '').trim().toLowerCase()
  if (!raw) return 'EMPTY'
  if (raw.includes('nie wiem') || raw.includes('trudno powiedzieć')) return 'LOW'
  const words = countWords(raw)
  if (words < 10) return 'LOW'
  if (words < 35) return 'MEDIUM'
  return 'HIGH'
}

const computeTargetDifficulty = ({
  depthLevel,
  lastDifficulty,
  lastSignal,
  action,
}) => {
  const base = clamp(depthLevel ?? 3, 1, 5)
  let target = lastDifficulty ? lastDifficulty : Math.min(3, base)

  if (lastDifficulty) {
    if (lastSignal === 'LOW' || lastSignal === 'EMPTY') target = lastDifficulty - 1
    if (lastSignal === 'MEDIUM') target = lastDifficulty
    if (lastSignal === 'HIGH') target = lastDifficulty + 1
  }

  if (action === 'SIMPLIFY') target -= 1
  if (action === 'DEEPEN') target += 1

  return clamp(target, 1, base)
}

const scoreQuestion = ({
  question,
  targetDifficulty,
  askedCount,
  hardStreak,
  action,
  lastDifficulty,
}) => {
  let score = question.priority ?? 50
  score -= 12 * Math.abs(question.difficulty - targetDifficulty)

  if ((askedCount ?? 0) === 0) {
    score += question.difficulty <= 2 ? 25 : -10
  }

  if ((hardStreak ?? 0) >= 1 && question.difficulty >= 4) {
    score -= 60
  }

  if (action === 'SWAP' && lastDifficulty != null) {
    score -= 6 * Math.abs(question.difficulty - lastDifficulty)
  }

  return score
}

const normalizeAction = (action) => {
  const normalized = String(action || '').toUpperCase()
  if (['AUTO', 'NEXT', 'SWAP', 'SIMPLIFY', 'DEEPEN'].includes(normalized)) return normalized
  return 'AUTO'
}

export const suggestNextQuestion = ({
  sessionId,
  lang,
  boardItems = [],
  action = 'AUTO',
  modeCode,
  categoryCode,
  intentCode,
}) => {
  ensureSession(sessionId)
  ensureSessionState(sessionId)

  const sessionState = getSessionState(sessionId)
  const askedIds = new Set(listAskedQuestionIds(sessionId))

  const lastAnswer = getLastSessionAnswer(sessionId)
  const lastSignal = lastAnswer?.answer_signal || computeAnswerSignal(lastAnswer?.answer)

  const normalizedAction = normalizeAction(action)
  const targetDifficulty = computeTargetDifficulty({
    depthLevel: sessionState?.depth_level ?? 3,
    lastDifficulty: sessionState?.last_difficulty ?? null,
    lastSignal,
    action: normalizedAction,
  })

  const maxDifficulty = clamp(sessionState?.depth_level ?? 3, 1, 5)
  const lastDifficulty = sessionState?.last_difficulty ?? null

  const all = listQuestionsWithTags({ lang })

  const candidates = all.filter((question) => {
    if (askedIds.has(question.id)) return false
    if (question.difficulty < 1 || question.difficulty > maxDifficulty) return false
    if (lastDifficulty != null && lastDifficulty >= 4 && question.difficulty >= 4) return false
    if (modeCode && question.mode_code !== modeCode) return false
    if (categoryCode && question.category_code !== categoryCode) return false
    if (intentCode && question.intent_code !== intentCode) return false
    return true
  })

  if (!candidates.length) return null

  let best = null
  let bestScore = -Infinity

  for (const question of candidates) {
    const score = scoreQuestion({
      question,
      targetDifficulty,
      askedCount: sessionState?.asked_count ?? 0,
      hardStreak: sessionState?.hard_streak ?? 0,
      action: normalizedAction,
      lastDifficulty,
    })

    if (score > bestScore) {
      bestScore = score
      best = question
      continue
    }

    if (score == bestScore && best && question.id < best.id) {
      best = question
    }
  }

  const chosen = best || candidates.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50))[0]

  if (!chosen) return null

  updateSessionStateRow({
    sessionId,
    last_question_id: chosen.id,
    last_difficulty: chosen.difficulty,
  })

  return chosen
}
