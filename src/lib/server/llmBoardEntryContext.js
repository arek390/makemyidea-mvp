const MATRIX_ROW_TO_GROUP = {
  world: 'A',
  product: 'B',
  elements: 'C',
}

const MATRIX_COL_TO_MODE = {
  as_is: '1',
  not_working: '2',
  should_be: '3',
}

const toText = (value, maxLen = 0) => {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return maxLen > 0 && text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

export const normalizeLlmBoardArea = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'as_is' || raw === 'asis' || raw === 'as-is') return 'as_is'
  if (raw === 'not_working' || raw === 'not-working' || raw === 'notworking') return 'not_working'
  if (raw === 'should_be' || raw === 'should-be' || raw === 'shouldbe') return 'should_be'
  const numeric = Number(raw)
  if (numeric === 1) return 'as_is'
  if (numeric === 2) return 'not_working'
  if (numeric === 3) return 'should_be'
  return null
}

const normalizeEntryType = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'facilitated_input') return 'facilitated_input'
  if (raw === 'seed_from_brief') return 'seed_from_brief'
  if (raw === 'manual_input' || raw === 'free_input') return 'manual_input'
  return raw ? 'other' : 'other'
}

const pickQuestionText = (entry, language, maxLen) => {
  const primary =
    language === 'en'
      ? entry?.question_text_en ?? entry?.questionTextEn ?? entry?.question
      : entry?.question_text_pl ?? entry?.questionTextPl ?? entry?.question
  const fallback =
    language === 'en'
      ? entry?.question_text_pl ?? entry?.questionTextPl ?? entry?.question
      : entry?.question_text_en ?? entry?.questionTextEn ?? entry?.question
  return toText(primary, maxLen) || toText(fallback, maxLen) || null
}

const buildMatrixCell = (entry) => {
  const explicit = toText(entry?.matrix_cell ?? entry?.matrixCell, 8).toUpperCase()
  if (/^[ABC][123]$/.test(explicit)) return explicit
  const row = String(entry?.matrix_row ?? entry?.matrixRow ?? '').trim().toLowerCase()
  const col = String(entry?.matrix_col ?? entry?.matrixCol ?? '').trim().toLowerCase()
  const group = MATRIX_ROW_TO_GROUP[row] || null
  const mode = MATRIX_COL_TO_MODE[col] || null
  return group && mode ? `${group}${mode}` : null
}

export const normalizeBoardEntryForLlm = (entry, language = 'pl', options = {}) => {
  if (!entry || typeof entry !== 'object') {
    const text = toText(entry, options.maxAnswerLen ?? 280)
    return text ? { area: null, matrix_cell: null, entry_type: 'other', question: null, answer: text, text } : null
  }
  const answer = toText(entry.answer ?? entry.text ?? entry.label, options.maxAnswerLen ?? 280)
  if (!answer) return null
  const area = normalizeLlmBoardArea(entry.area ?? entry.target_area ?? entry.matrix_col ?? entry.matrixCol)
  const question = pickQuestionText(entry, language === 'en' ? 'en' : 'pl', options.maxQuestionLen ?? 260)
  const rawEntryType = normalizeEntryType(entry.entry_type ?? entry.entryType ?? entry.prompt_type ?? entry.promptType)
  const normalized = {
    area,
    matrix_cell: buildMatrixCell(entry),
    entry_type: rawEntryType === 'other' && question ? 'facilitated_input' : rawEntryType,
    question,
    answer,
    text: answer,
  }
  const matrixRow = toText(entry.matrix_row ?? entry.matrixRow, 32)
  const matrixCol = toText(entry.matrix_col ?? entry.matrixCol, 32)
  if (matrixRow) normalized.matrix_row = matrixRow
  if (matrixCol) normalized.matrix_col = matrixCol
  if (entry.id != null) normalized.id = String(entry.id)
  return normalized
}

export const normalizeBoardEntriesForLlm = (entries, language = 'pl', options = {}) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeBoardEntryForLlm(entry, language, options))
    .filter(Boolean)

export const getEntryContextStats = (entries) => {
  const total = Array.isArray(entries) ? entries.length : 0
  const withQuestion = Array.isArray(entries)
    ? entries.filter((entry) => Boolean(toText(entry?.question, 0))).length
    : 0
  return {
    total,
    withQuestion,
    withoutQuestion: Math.max(0, total - withQuestion),
  }
}
