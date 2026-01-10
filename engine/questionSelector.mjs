import { getQuestionById, listQuestionsWithTags } from './questionRepository.mjs'
import {
  ensureSession,
  ensureSessionState,
  getLastSessionAnswer,
  getSessionState,
  listAskedQuestionIds,
  recordAskedQuestion,
  updateSessionState,
  updateSessionStateRow,
} from './sessionRepository.mjs'
import {
  computeAnswerSignal,
  computeTargetDifficulty,
  filterByCellExhaustion,
  normalizeAction,
  selectBestQuestion,
} from './questionSelection.mjs'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const normalizeSelectionAction = (action) => {
  const normalized = String(action || '').toUpperCase()
  if (['AUTO', 'NEXT', 'DEEPEN', 'PERSPECTIVE'].includes(normalized)) return normalized
  return 'AUTO'
}

const toGroupIndex = (group) => {
  if (group === 'A') return 0
  if (group === 'B') return 1
  if (group === 'C') return 2
  return null
}

const toGroupCode = (index) => {
  if (index === 0) return 'A'
  if (index === 1) return 'B'
  if (index === 2) return 'C'
  return null
}

const sortById = (items) => [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)))

const pickFirstById = (items) => {
  if (!items.length) return null
  return sortById(items)[0]
}

const pickRandom = (items) => {
  if (!items.length) return null
  const index = Math.floor(Math.random() * items.length)
  return items[index]
}

const resolveCurrentCell = ({ sessionState, groupCode, modeCode, lookupQuestionById }) => {
  if (groupCode && modeCode) {
    return { group: groupCode, mode: modeCode }
  }
  const lastQuestionId = sessionState?.last_question_id
  if (lastQuestionId) {
    const lastQuestion = lookupQuestionById
      ? lookupQuestionById(lastQuestionId)
      : getQuestionById(lastQuestionId)
    if (lastQuestion?.group_code && lastQuestion?.mode_code) {
      return { group: lastQuestion.group_code, mode: lastQuestion.mode_code }
    }
  }
  return null
}

const filterCandidates = ({
  all,
  tags,
  categoryCode,
  intentCode,
  modeCode,
  groupCode,
}) => {
  return all.filter((question) => {
    if (categoryCode && question.category_code !== categoryCode) return false
    if (intentCode && question.intent_code !== intentCode) return false
    if (modeCode && question.mode_code !== modeCode) return false
    if (groupCode && question.group_code !== groupCode) return false
    if (tags && tags.length) {
      if (!question.tags || !question.tags.some((tag) => tags.includes(tag))) return false
    }
    return true
  })
}

const applyDifficultyGuards = ({ candidates, sessionState, minDifficulty, maxDifficulty }) => {
  const depthMax = clamp(sessionState?.depth_level ?? 3, 1, 5)
  const maxDifficultyLimit =
    maxDifficulty != null ? Math.min(Number(maxDifficulty), depthMax) : depthMax
  const minDifficultyLimit = minDifficulty != null ? Number(minDifficulty) : 1
  const lastDifficulty = sessionState?.last_difficulty ?? null
  return candidates.filter((question) => {
    if (question.difficulty < minDifficultyLimit || question.difficulty > maxDifficultyLimit) {
      return false
    }
    if (lastDifficulty != null && lastDifficulty >= 4 && question.difficulty >= 4) return false
    return true
  })
}

const buildDefaultPick = ({ candidates, sessionState, lastAnswer, action }) => {
  const lastSignal = lastAnswer?.answer_signal || computeAnswerSignal(lastAnswer?.answer)
  const normalizedAction = normalizeAction(action)
  const targetDifficulty = computeTargetDifficulty({
    depthLevel: sessionState?.depth_level ?? 3,
    lastDifficulty: sessionState?.last_difficulty ?? null,
    lastSignal,
    action: normalizedAction,
  })
  const lastDifficulty = sessionState?.last_difficulty ?? null

  const chosen =
    selectBestQuestion(candidates, {
      targetDifficulty,
      askedCount: sessionState?.asked_count ?? 0,
      hardStreak: sessionState?.hard_streak ?? 0,
      action: normalizedAction,
      lastDifficulty,
    }) || pickFirstById(candidates)

  return { chosen, targetDifficulty, normalizedAction, lastDifficulty }
}

const chooseDeepen = ({ candidates, askedSet, currentCell }) => {
  if (!currentCell) return { chosen: null, exhausted: null, candidatesInCell: 0, askedInCell: 0 }
  const candidatesInCell = candidates.filter(
    (q) => q.group_code === currentCell.group && q.mode_code === currentCell.mode
  )
  if (!candidatesInCell.length) {
    return { chosen: null, exhausted: null, candidatesInCell: 0, askedInCell: 0 }
  }
  const unasked = candidatesInCell.filter((q) => !askedSet.has(q.id))
  const askedInCell = candidatesInCell.length - unasked.length
  const exhausted = unasked.length === 0
  const chosen = exhausted ? pickFirstById(candidatesInCell) : pickFirstById(unasked)
  return { chosen, exhausted, candidatesInCell: candidatesInCell.length, askedInCell }
}

const listNeighborCells = ({ group, mode }) => {
  const groupIndex = toGroupIndex(group)
  if (groupIndex == null) return []
  const neighbors = []
  for (let groupDelta = -1; groupDelta <= 1; groupDelta += 1) {
    for (let modeDelta = -1; modeDelta <= 1; modeDelta += 1) {
      if (groupDelta === 0 && modeDelta === 0) continue
      const nextGroupIndex = groupIndex + groupDelta
      const nextMode = mode + modeDelta
      if (nextGroupIndex < 0 || nextGroupIndex > 2) continue
      if (nextMode < 1 || nextMode > 3) continue
      const nextGroup = toGroupCode(nextGroupIndex)
      if (!nextGroup) continue
      neighbors.push({ group: nextGroup, mode: nextMode })
    }
  }
  return neighbors
}

const choosePerspective = ({ candidates, askedSet, currentCell }) => {
  if (!currentCell) {
    return { chosen: null, exhausted: null, candidatesInCell: 0, askedInCell: 0, cellKey: null }
  }
  const neighbors = listNeighborCells(currentCell)
  const cellsWithCandidates = neighbors.map((cell) => {
    const inCell = candidates.filter(
      (q) => q.group_code === cell.group && q.mode_code === cell.mode
    )
    const unasked = inCell.filter((q) => !askedSet.has(q.id))
    return {
      cell,
      candidates: inCell,
      unasked,
    }
  })

  const firstWithUnasked = cellsWithCandidates.find((entry) => entry.unasked.length > 0)
  if (firstWithUnasked) {
    return {
      chosen: pickFirstById(firstWithUnasked.unasked),
      exhausted: false,
      candidatesInCell: firstWithUnasked.candidates.length,
      askedInCell: firstWithUnasked.candidates.length - firstWithUnasked.unasked.length,
      cellKey: `${firstWithUnasked.cell.group}:${firstWithUnasked.cell.mode}`,
    }
  }

  const firstWithCandidates = cellsWithCandidates.find((entry) => entry.candidates.length > 0)
  if (firstWithCandidates) {
    return {
      chosen: pickFirstById(firstWithCandidates.candidates),
      exhausted: true,
      candidatesInCell: firstWithCandidates.candidates.length,
      askedInCell: firstWithCandidates.candidates.length,
      cellKey: `${firstWithCandidates.cell.group}:${firstWithCandidates.cell.mode}`,
    }
  }

  return { chosen: null, exhausted: null, candidatesInCell: 0, askedInCell: 0, cellKey: null }
}

const selectQuestionWithList = ({
  sessionId,
  lang,
  action = 'AUTO',
  groupCode,
  modeCode,
  categoryCode,
  intentCode,
  tags,
  minDifficulty,
  maxDifficulty,
  all,
  lookupQuestionById,
}) => {
  ensureSession(sessionId)
  ensureSessionState(sessionId)

  const sessionState = getSessionState(sessionId)
  const lastAnswer = getLastSessionAnswer(sessionId)
  const askedIds = listAskedQuestionIds(sessionId)
  const askedSet = new Set(askedIds)

  const normalizedAction = normalizeSelectionAction(action)

  const allCandidates = all || listQuestionsWithTags({ lang })
  const difficultyMax =
    maxDifficulty != null ? Number(maxDifficulty) : clamp(sessionState?.depth_level ?? 3, 1, 5)
  const difficultyMin = minDifficulty != null ? Number(minDifficulty) : 1

  const candidatesBase = filterCandidates({
    all: allCandidates,
    tags,
    categoryCode,
    intentCode,
    modeCode: normalizedAction === 'PERSPECTIVE' ? null : modeCode,
    groupCode: normalizedAction === 'PERSPECTIVE' ? null : groupCode,
  })

  const candidates = applyDifficultyGuards({
    candidates: candidatesBase,
    sessionState,
    minDifficulty: difficultyMin,
    maxDifficulty: difficultyMax,
  })

  const baseMeta = {
    action: normalizedAction,
    lang,
    totalCandidates: allCandidates.length,
    candidatesAfterFilters: candidates.length,
    askedIdsCount: askedIds.length,
  }

  if (!candidates.length) {
    return { question: null, meta: baseMeta }
  }

  const currentCell = resolveCurrentCell({
    sessionState,
    groupCode,
    modeCode,
    lookupQuestionById,
  })

  if (normalizedAction === 'DEEPEN') {
    if (!currentCell) {
      const { chosen } = buildDefaultPick({
        candidates,
        sessionState,
        lastAnswer,
        action: 'AUTO',
      })
      if (process.env.DEBUG_LANG === '1') {
        console.log(
          JSON.stringify({
            event: 'lang_selection',
            lang,
            questionId: chosen?.id ?? null,
            hasLangText: Boolean(chosen?.lang_text),
          })
        )
      }
      return { question: chosen, meta: { ...baseMeta, fallback: true } }
    }
    const result = chooseDeepen({ candidates, askedSet, currentCell })
    if (process.env.DEBUG_LANG === '1') {
      console.log(
        JSON.stringify({
          event: 'lang_selection',
          lang,
          questionId: result.chosen?.id ?? null,
          hasLangText: Boolean(result.chosen?.lang_text),
        })
      )
    }
    return {
      question: result.chosen,
      meta: {
        ...baseMeta,
        cellKey: `${currentCell.group}:${currentCell.mode}`,
        candidatesInCell: result.candidatesInCell,
        askedInCell: result.askedInCell,
        exhausted: result.exhausted,
      },
    }
  }

  if (normalizedAction === 'PERSPECTIVE') {
    if (!currentCell) {
      const { chosen } = buildDefaultPick({
        candidates,
        sessionState,
        lastAnswer,
        action: 'AUTO',
      })
      if (process.env.DEBUG_LANG === '1') {
        console.log(
          JSON.stringify({
            event: 'lang_selection',
            lang,
            questionId: chosen?.id ?? null,
            hasLangText: Boolean(chosen?.lang_text),
          })
        )
      }
      return { question: chosen, meta: { ...baseMeta, fallback: true } }
    }
    const result = choosePerspective({ candidates, askedSet, currentCell })
    if (result.chosen) {
      if (process.env.DEBUG_LANG === '1') {
        console.log(
          JSON.stringify({
            event: 'lang_selection',
            lang,
            questionId: result.chosen?.id ?? null,
            hasLangText: Boolean(result.chosen?.lang_text),
          })
        )
      }
      return {
        question: result.chosen,
        meta: {
          ...baseMeta,
          cellKey: result.cellKey,
          candidatesInCell: result.candidatesInCell,
          askedInCell: result.askedInCell,
          exhausted: result.exhausted,
        },
      }
    }
    const fallback = pickRandom(candidates.filter((q) => !askedSet.has(q.id))) || pickRandom(candidates)
    if (process.env.DEBUG_LANG === '1') {
      console.log(
        JSON.stringify({
          event: 'lang_selection',
          lang,
          questionId: fallback?.id ?? null,
          hasLangText: Boolean(fallback?.lang_text),
        })
      )
    }
    return { question: fallback, meta: { ...baseMeta, fallback: true } }
  }

  if (normalizedAction === 'NEXT') {
    const unasked = candidates.filter((q) => !askedSet.has(q.id))
    const chosen = pickRandom(unasked.length ? unasked : candidates)
    if (process.env.DEBUG_LANG === '1') {
      console.log(
        JSON.stringify({
          event: 'lang_selection',
          lang,
          questionId: chosen?.id ?? null,
          hasLangText: Boolean(chosen?.lang_text),
        })
      )
    }
    return {
      question: chosen,
      meta: {
        ...baseMeta,
        candidatesInCell: candidates.length,
        askedInCell: candidates.length - unasked.length,
        exhausted: unasked.length === 0,
      },
    }
  }

  const withoutAsked = candidates.filter((q) => !askedSet.has(q.id))
  if (!withoutAsked.length) {
    return { question: null, meta: { action: normalizedAction } }
  }

  const cellFiltered = filterByCellExhaustion(withoutAsked, askedSet, groupCode, modeCode)
  const eligible = cellFiltered.eligible.length ? cellFiltered.eligible : withoutAsked
  const { chosen, targetDifficulty, normalizedAction: scoreAction, lastDifficulty } =
    buildDefaultPick({ candidates: eligible, sessionState, lastAnswer, action: normalizedAction })
  if (process.env.DEBUG_LANG === '1') {
    console.log(
      JSON.stringify({
        event: 'lang_selection',
        lang,
        questionId: chosen?.id ?? null,
        hasLangText: Boolean(chosen?.lang_text),
      })
    )
  }

  return {
    question: chosen,
    meta: {
      ...baseMeta,
      cellKey: cellFiltered.cellKey,
      candidatesInCell: cellFiltered.candidatesInCellCount,
      askedInCell: cellFiltered.askedInCellCount,
      exhausted: cellFiltered.exhausted,
      targetDifficulty,
      scoreAction,
      lastDifficulty,
    },
  }
}

export const selectQuestion = (params) =>
  selectQuestionWithList({
    ...params,
    all: listQuestionsWithTags({ lang: params.lang }),
    lookupQuestionById: getQuestionById,
  })

export const selectQuestionFromList = (params) => selectQuestionWithList(params)

export const finalizeSelection = ({ sessionId, question }) => {
  if (!question) return
  recordAskedQuestion({ sessionId, questionId: question.id })
  updateSessionState({
    sessionId,
    last_group_code: question.group_code,
    last_mode_code: question.mode_code,
    last_category_code: question.category_code,
  })
  updateSessionStateRow({
    sessionId,
    last_question_id: question.id,
    last_difficulty: question.difficulty,
  })
}
