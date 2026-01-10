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

export const computeTargetDifficulty = ({
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

export const scoreQuestion = ({
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

export const normalizeAction = (action) => {
  const normalized = String(action || '').toUpperCase()
  if (['AUTO', 'NEXT', 'SWAP', 'SIMPLIFY', 'DEEPEN'].includes(normalized)) return normalized
  return 'AUTO'
}

export const selectBestQuestion = (candidates, params) => {
  let best = null
  let bestScore = -Infinity

  for (const question of candidates) {
    const score = scoreQuestion({ question, ...params })

    if (score > bestScore) {
      bestScore = score
      best = question
      continue
    }

    if (score === bestScore && best && question.id < best.id) {
      best = question
    }
  }

  return best || null
}

export const filterByCellExhaustion = (candidates, askedIds, targetGroup, targetMode) => {
  const askedSet = new Set(askedIds)

  if (targetGroup && targetMode) {
    const candidatesInCell = candidates.filter(
      (q) => q.group_code === targetGroup && q.mode_code === targetMode
    )
    if (!candidatesInCell.length) {
      return {
        eligible: candidates,
        exhausted: false,
        candidatesInCellCount: 0,
        askedInCellCount: 0,
        cellKey: `${targetGroup}:${targetMode}`,
      }
    }

    const askedInCellCount = candidatesInCell.filter((q) => askedSet.has(q.id)).length
    const exhausted = askedInCellCount >= candidatesInCell.length
    const eligible = exhausted
      ? candidatesInCell
      : candidatesInCell.filter((q) => !askedSet.has(q.id))

    return {
      eligible,
      exhausted,
      candidatesInCellCount: candidatesInCell.length,
      askedInCellCount,
      cellKey: `${targetGroup}:${targetMode}`,
    }
  }

  const cellCounts = new Map()
  candidates.forEach((q) => {
    const key = `${q.group_code}:${q.mode_code}`
    const entry = cellCounts.get(key) || { total: 0, asked: 0 }
    entry.total += 1
    if (askedSet.has(q.id)) entry.asked += 1
    cellCounts.set(key, entry)
  })

  const eligible = candidates.filter((q) => {
    if (!askedSet.has(q.id)) return true
    const key = `${q.group_code}:${q.mode_code}`
    const entry = cellCounts.get(key)
    if (!entry) return true
    return entry.asked >= entry.total
  })

  return {
    eligible,
    exhausted: null,
    candidatesInCellCount: candidates.length,
    askedInCellCount: candidates.filter((q) => askedSet.has(q.id)).length,
    cellKey: 'ALL',
  }
}
