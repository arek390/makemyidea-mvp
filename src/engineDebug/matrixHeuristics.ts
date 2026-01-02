export type MatrixRowKey = 'world' | 'product' | 'elements'
export type MatrixColKey = 'as_is' | 'not_working' | 'should_be'

export type MatrixCell = { row: MatrixRowKey; col: MatrixColKey }
export type MatrixCounts = Record<string, number>

export const MATRIX_ROWS: { key: MatrixRowKey; label: string }[] = [
  { key: 'world', label: 'Świat/Środowisko' },
  { key: 'product', label: 'Produkt' },
  { key: 'elements', label: 'Elementy' },
]

export const MATRIX_COLS: { key: MatrixColKey; label: string }[] = [
  { key: 'as_is', label: 'Jak jest' },
  { key: 'not_working', label: 'Co nie działa' },
  { key: 'should_be', label: 'Jak powinno być' },
]

const MATRIX_COL_RULES = [
  {
    key: 'not_working' as MatrixColKey,
    weight: 3,
    keywords: [
      'nie dzial',
      'problem',
      'blad',
      'ryzyk',
      'blokad',
      'utrudni',
      'przeszkadz',
      'brakuj',
      'nie moz',
      'nie da sie',
      'zbyt',
      'za malo',
      'za duzo',
    ],
  },
  {
    key: 'should_be' as MatrixColKey,
    weight: 4,
    keywords: [
      'powinn',
      'musial',
      'musi',
      'chcem',
      'chcialb',
      'docelow',
      'ma byc',
      'idealn',
      'wolalb',
      'zeby',
      'nalezy',
    ],
  },
  {
    key: 'as_is' as MatrixColKey,
    weight: 2,
    keywords: ['obecn', 'teraz', 'dzis', 'jest', 'mam', 'uzywam', 'dziala tak', 'proces', 'stan'],
  },
]

const MATRIX_ROW_RULES = [
  {
    key: 'product' as MatrixRowKey,
    weight: 3,
    keywords: [
      'produkt',
      'funkcj',
      'feature',
      'wymagan',
      'uzytkown',
      'mvp',
      'wartos',
      'use case',
      'scenariusz',
      'pricing',
      'onboarding',
    ],
  },
  {
    key: 'elements' as MatrixRowKey,
    weight: 3,
    keywords: [
      'element',
      'czesc',
      'komponent',
      'modul',
      'ui',
      'ekran',
      'formularz',
      'przycisk',
      'api',
      'endpoint',
      'baza',
      'db',
      'timer',
      'logik',
      'sesj',
    ],
  },
  {
    key: 'world' as MatrixRowKey,
    weight: 2,
    keywords: [
      'rynek',
      'klient',
      'konkurencj',
      'prawo',
      'regulacj',
      'proces u klienta',
      'dostawc',
      'partner',
      'wdrozen',
      'kontekst',
      'srodowisk',
    ],
  },
]

const fuzzyTokens = new Set([
  'powinn',
  'problem',
  'ryzyk',
  'funkcj',
  'ui',
  'nie dzial',
])

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')

const levenshtein = (a: string, b: string) => {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  return matrix[a.length][b.length]
}

const fuzzyIncludes = (haystack: string, needle: string) => {
  if (haystack.includes(needle)) return true
  if (!fuzzyTokens.has(needle)) return false
  if (needle.length < 5) return false
  const words = haystack.split(' ')
  return words.some((word) => {
    const distance = levenshtein(word, needle)
    if (needle.length >= 8) return distance <= 2
    return distance <= 1
  })
}

const scoreWithRules = <T extends string>(
  normalized: string,
  rules: { key: T; weight: number; keywords: string[] }[],
  base: Record<T, number>
) =>
  rules.reduce<{ scores: Record<T, number>; matches: Record<T, string[]> }>(
    (acc, rule) => {
      const matched = rule.keywords.filter((keyword) => fuzzyIncludes(normalized, keyword))
      acc.scores[rule.key] = matched.length * rule.weight
      acc.matches[rule.key] = matched
      return acc
    },
    { scores: { ...base }, matches: { ...base } as Record<T, string[]> }
  )

const pickWithTieBreak = <T extends string>(
  scores: Record<T, number>,
  priority: T[],
  fallback: T
) => {
  const maxScore = Math.max(...Object.values(scores))
  if (maxScore === 0) return fallback
  return priority.find((key) => scores[key] === maxScore) ?? fallback
}

export type MappingDetails = {
  row: MatrixRowKey
  col: MatrixColKey
  normalized: string
  rowScores: Record<MatrixRowKey, number>
  colScores: Record<MatrixColKey, number>
  rowMatches: Record<MatrixRowKey, string[]>
  colMatches: Record<MatrixColKey, string[]>
}

export const computeMappingDetails = (text: string): MappingDetails => {
  const normalized = normalizeText(text)

  const colResult = scoreWithRules<MatrixColKey>(normalized, MATRIX_COL_RULES, {
    as_is: 0,
    not_working: 0,
    should_be: 0,
  })
  const rowResult = scoreWithRules<MatrixRowKey>(normalized, MATRIX_ROW_RULES, {
    world: 0,
    product: 0,
    elements: 0,
  })

  const colPriority: MatrixColKey[] = ['should_be', 'not_working', 'as_is']
  const rowPriority: MatrixRowKey[] = ['elements', 'product', 'world']

  const col = pickWithTieBreak(colResult.scores, colPriority, 'as_is')
  const row = pickWithTieBreak(rowResult.scores, rowPriority, 'world')

  return {
    row,
    col,
    normalized,
    rowScores: rowResult.scores,
    colScores: colResult.scores,
    rowMatches: rowResult.matches,
    colMatches: colResult.matches,
  }
}

export const mapEntryToCell = (text: string) => {
  const details = computeMappingDetails(text)
  return {
    row: details.row,
    col: details.col,
    rowScores: details.rowScores,
    colScores: details.colScores,
  }
}

export const cellKey = (row: MatrixRowKey, col: MatrixColKey) => `${row}:${col}`

export const pickGravityTarget = (
  currentCell: MatrixCell,
  counts: MatrixCounts
): { targetCell: MatrixCell; reason: 'empty' | 'lowest_count' } => {
  const rowIndex = MATRIX_ROWS.findIndex((row) => row.key === currentCell.row)
  const colIndex = MATRIX_COLS.findIndex((col) => col.key === currentCell.col)
  const neighbors: MatrixCell[] = []
  if (rowIndex > 0) neighbors.push({ row: MATRIX_ROWS[rowIndex - 1].key, col: currentCell.col })
  if (rowIndex < MATRIX_ROWS.length - 1)
    neighbors.push({ row: MATRIX_ROWS[rowIndex + 1].key, col: currentCell.col })
  if (colIndex > 0) neighbors.push({ row: currentCell.row, col: MATRIX_COLS[colIndex - 1].key })
  if (colIndex < MATRIX_COLS.length - 1)
    neighbors.push({ row: currentCell.row, col: MATRIX_COLS[colIndex + 1].key })

  let target = neighbors[0] || currentCell
  let targetCount = Number.MAX_SAFE_INTEGER
  let targetReason: 'empty' | 'lowest_count' = 'lowest_count'
  neighbors.forEach((neighbor) => {
    const count = counts[cellKey(neighbor.row, neighbor.col)] ?? 0
    if (count === 0 && targetCount !== 0) {
      target = neighbor
      targetCount = 0
      targetReason = 'empty'
    } else if (targetCount !== 0 && count < targetCount) {
      target = neighbor
      targetCount = count
      targetReason = 'lowest_count'
    }
  })

  return { targetCell: target, reason: targetReason }
}
