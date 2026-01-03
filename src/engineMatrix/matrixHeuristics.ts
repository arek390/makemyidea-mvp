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

const MATRIX_COL_RULES_PL = [
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

const MATRIX_ROW_RULES_PL = [
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

const fuzzyTokensPL = new Set([
  'powinn',
  'problem',
  'ryzyk',
  'funkcj',
  'ui',
  'nie dzial',
])

const MATRIX_COL_RULES_EN = [
  {
    key: 'not_working' as MatrixColKey,
    weight: 3,
    keywords: [
      'not working',
      'problem',
      'issue',
      'bug',
      'risk',
      'blocker',
      'blocked',
      'obstacle',
      'hindrance',
      'missing',
      'cant',
      'cannot',
      'too much',
      'too little',
      'lack',
      'fails',
      'broken',
      'delay',
    ],
  },
  {
    key: 'should_be' as MatrixColKey,
    weight: 4,
    keywords: [
      'should',
      'should be',
      'must',
      'need',
      'want',
      'would',
      'ideally',
      'goal',
      'desired',
      'prefer',
      'ought',
    ],
  },
  {
    key: 'as_is' as MatrixColKey,
    weight: 2,
    keywords: [
      'currently',
      'now',
      'today',
      'is',
      'are',
      'we have',
      'we use',
      'works',
      'process',
      'state',
      'existing',
    ],
  },
]

const MATRIX_ROW_RULES_EN = [
  {
    key: 'product' as MatrixRowKey,
    weight: 3,
    keywords: [
      'product',
      'feature',
      'function',
      'requirement',
      'user',
      'customer',
      'mvp',
      'value',
      'use case',
      'pricing',
      'onboarding',
    ],
  },
  {
    key: 'elements' as MatrixRowKey,
    weight: 3,
    keywords: [
      'element',
      'part',
      'component',
      'module',
      'ui',
      'screen',
      'form',
      'button',
      'api',
      'endpoint',
      'database',
      'db',
      'timer',
      'logic',
      'session',
      'integration',
      'connection',
    ],
  },
  {
    key: 'world' as MatrixRowKey,
    weight: 2,
    keywords: [
      'market',
      'client',
      'customer',
      'competition',
      'law',
      'regulation',
      'supplier',
      'partner',
      'deployment',
      'context',
      'environment',
    ],
  },
]

const fuzzyTokensEN = new Set([
  'problem',
  'issue',
  'risk',
  'blocker',
  'should',
  'need',
  'want',
  'product',
  'feature',
  'component',
  'customer',
  'market',
])

const normalizeTextPL = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeTextEN = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
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

const stemEnglishWord = (word: string) => {
  if (word.length <= 3) return word
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1)
  return word
}

const normalizeEnglishToken = (value: string) => stemEnglishWord(value)

const fuzzyIncludes = (
  haystack: string,
  needle: string,
  tokens: string[],
  fuzzyTokens: Set<string>,
  normalizeToken: (value: string) => string
) => {
  if (haystack.includes(needle)) return true
  if (!fuzzyTokens.has(needle)) return false
  if (needle.length < 5) return false
  const normalizedNeedle = normalizeToken(needle)
  return tokens.some((word) => {
    const distance = levenshtein(word, normalizedNeedle)
    if (normalizedNeedle.length >= 8) return distance <= 2
    return distance <= 1
  })
}

const scoreWithRules = <T extends string>(
  normalized: string,
  tokens: string[],
  rules: { key: T; weight: number; keywords: string[] }[],
  base: Record<T, number>,
  fuzzyTokens: Set<string>,
  normalizeToken: (value: string) => string
) => {
  const scores: Record<T, number> = { ...base }
  const matches = Object.keys(base).reduce(
    (acc, key) => {
      acc[key as T] = []
      return acc
    },
    {} as Record<T, string[]>
  )

  rules.forEach((rule) => {
    const matched = rule.keywords.filter((keyword) =>
      fuzzyIncludes(normalized, keyword, tokens, fuzzyTokens, normalizeToken)
    )
    scores[rule.key] = matched.length * rule.weight
    matches[rule.key] = matched
  })

  return { scores, matches }
}

const pickWithTieBreak = <T extends string>(
  scores: Record<T, number>,
  priority: T[],
  fallback: T
) => {
  const maxScore = Object.keys(scores).reduce(
    (max, key) => Math.max(max, scores[key as T]),
    0
  )
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

const resolveLanguageCode = (language?: string) => {
  if (!language) return 'pl'
  const normalized = language.toLowerCase()
  if (normalized.startsWith('en')) return 'en'
  if (normalized.includes('english')) return 'en'
  return 'pl'
}

export const computeMappingDetails = (text: string, language?: string): MappingDetails => {
  const lang = resolveLanguageCode(language)
  const normalized = lang === 'en' ? normalizeTextEN(text) : normalizeTextPL(text)
  const tokens =
    lang === 'en'
      ? normalized
          .split(' ')
          .map((token) => normalizeEnglishToken(token))
          .filter(Boolean)
      : normalized.split(' ')

  const colResult = scoreWithRules<MatrixColKey>(
    normalized,
    tokens,
    lang === 'en' ? MATRIX_COL_RULES_EN : MATRIX_COL_RULES_PL,
    {
      as_is: 0,
      not_working: 0,
      should_be: 0,
    },
    lang === 'en' ? fuzzyTokensEN : fuzzyTokensPL,
    lang === 'en' ? normalizeEnglishToken : (value) => value
  )
  const rowResult = scoreWithRules<MatrixRowKey>(
    normalized,
    tokens,
    lang === 'en' ? MATRIX_ROW_RULES_EN : MATRIX_ROW_RULES_PL,
    {
      world: 0,
      product: 0,
      elements: 0,
    },
    lang === 'en' ? fuzzyTokensEN : fuzzyTokensPL,
    lang === 'en' ? normalizeEnglishToken : (value) => value
  )

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

export const mapEntryToCell = (text: string, language?: string) => {
  const details = computeMappingDetails(text, language)
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
