import { runLlmTask } from '../../../llm/llmRouter.mjs'

const isValidCellId = (value) => /^[ABC][123]$/.test(String(value || '').trim())

export const coerceCellId = (value) => {
  const raw = String(value || '').trim().toUpperCase()
  return isValidCellId(raw) ? raw : null
}

const clampConfidence = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric < 0) return 0
  if (numeric > 1) return 1
  return numeric
}

export const normalizeSeedKind = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'note'
  if (raw === 'idea') return 'idea'
  if (raw === 'observation') return 'observation'
  if (raw === 'problem') return 'problem'
  if (raw === 'need') return 'need'
  if (raw === 'conclusion') return 'conclusion'
  if (raw === 'question') return 'question'
  if (raw === 'note') return 'note'
  return 'note'
}

export const normalizeSeedText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

export const seedDedupKey = (value) =>
  normalizeSeedText(value)
    .toLowerCase()
    .replace(/[^A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export const resolveSeedMaxEntries = () => {
  const raw = Number(process.env.SEED_MAX_ENTRIES ?? 64)
  if (!Number.isFinite(raw) || raw <= 0) return 64
  return Math.min(256, Math.floor(raw))
}

export const resolveSeedClassificationMode = () => {
  const raw = String(process.env.SEED_CLASSIFICATION_MODE || '').trim()
  if (raw === 'column_first') return 'column_first'
  return 'full_3x3'
}

const SEED_ENTRY_TEXT_FIELDS = ['text', 'content', 'statement', 'finding', 'entry', 'note', 'summary']

const resolveSeedEntryText = (item) => {
  if (typeof item === 'string') {
    return {
      text: normalizeSeedText(item),
      sourceField: 'string',
    }
  }
  if (!item || typeof item !== 'object') {
    return {
      text: '',
      sourceField: null,
    }
  }
  for (const field of SEED_ENTRY_TEXT_FIELDS) {
    const text = normalizeSeedText(item?.[field])
    if (text) {
      return {
        text,
        sourceField: field,
      }
    }
  }
  return {
    text: '',
    sourceField: null,
  }
}

const coerceSeedMatrixRowCode = (value) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (['a', '1', 'world', 'context', 'market', 'environment', 'process', 'workflow', 'usage'].includes(raw)) {
    return 'A'
  }
  if (
    ['b', '2', 'product', 'system', 'offer', 'portfolio', 'service', 'solution', 'tool'].includes(raw)
  ) {
    return 'B'
  }
  if (
    ['c', '3', 'element', 'elements', 'component', 'components', 'part', 'feature', 'module'].includes(raw)
  ) {
    return 'C'
  }
  return null
}

const coerceSeedMatrixColCode = (value) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (['1', 'a', 'as_is', 'asis', 'as-is', 'current', 'current_state', 'existing', 'present'].includes(raw)) {
    return '1'
  }
  if (
    ['2', 'b', 'not_working', 'not-working', 'problem', 'pain', 'constraint', 'issue', 'issues'].includes(raw)
  ) {
    return '2'
  }
  if (
    ['3', 'c', 'should_be', 'should-be', 'desired', 'goal', 'idea', 'proposal', 'requirement'].includes(raw)
  ) {
    return '3'
  }
  return null
}

const resolveSeedEntryCellCode = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return {
      cellCode: null,
      source: null,
    }
  }

  const explicitCell =
    coerceCellId(item?.cellCode) ||
    coerceCellId(item?.cell_code) ||
    coerceCellId(item?.matrixCell) ||
    coerceCellId(item?.matrix_cell) ||
    coerceCellId(item?.cell) ||
    coerceCellId(item?.column) ||
    coerceCellId(item?.col)
  if (explicitCell) {
    return {
      cellCode: explicitCell,
      source: 'cellCode',
    }
  }

  const rowField =
    item?.row ?? item?.matrixRow ?? item?.matrix_row ?? item?.level ?? item?.matrixLevel ?? item?.matrix_level
  const colField =
    item?.column ?? item?.col ?? item?.matrixCol ?? item?.matrix_col ?? item?.columnCode ?? item?.column_code

  const directRow = coerceSeedMatrixRowCode(rowField)
  const directCol = coerceSeedMatrixColCode(colField)
  if (directRow && directCol) {
    return {
      cellCode: `${directRow}${directCol}`,
      source: 'row+column',
    }
  }

  const swappedRow = coerceSeedMatrixRowCode(colField)
  const swappedCol = coerceSeedMatrixColCode(rowField)
  if (swappedRow && swappedCol) {
    return {
      cellCode: `${swappedRow}${swappedCol}`,
      source: 'column+level_swapped',
    }
  }

  return {
    cellCode: null,
    source: null,
  }
}

const SEED_ENTRY_LIST_PATHS = [
  ['root', (payload) => (Array.isArray(payload) ? payload : null)],
  ['entries', (payload) => (Array.isArray(payload?.entries) ? payload.entries : null)],
  ['items', (payload) => (Array.isArray(payload?.items) ? payload.items : null)],
  ['seeds', (payload) => (Array.isArray(payload?.seeds) ? payload.seeds : null)],
  ['ideas', (payload) => (Array.isArray(payload?.ideas) ? payload.ideas : null)],
  ['data.entries', (payload) => (Array.isArray(payload?.data?.entries) ? payload.data.entries : null)],
  ['data.items', (payload) => (Array.isArray(payload?.data?.items) ? payload.data.items : null)],
  ['data.seeds', (payload) => (Array.isArray(payload?.data?.seeds) ? payload.data.seeds : null)],
  ['result.entries', (payload) => (Array.isArray(payload?.result?.entries) ? payload.result.entries : null)],
  ['result.items', (payload) => (Array.isArray(payload?.result?.items) ? payload.result.items : null)],
  ['result.seeds', (payload) => (Array.isArray(payload?.result?.seeds) ? payload.result.seeds : null)],
]

const resolveSeedEntryList = (payload) => {
  for (const [path, getter] of SEED_ENTRY_LIST_PATHS) {
    const items = getter(payload)
    if (Array.isArray(items)) {
      return {
        path,
        items,
      }
    }
  }
  return {
    path: null,
    items: null,
  }
}

const normalizeSeedEntriesWithDiagnostics = (items, maxEntries = resolveSeedMaxEntries()) => {
  if (!Array.isArray(items)) {
    return {
      entries: [],
      diagnostics: {
        rawEntriesCount: 0,
        normalizedEntriesCount: 0,
        dedupedEntriesCount: 0,
        droppedEntries: [],
      },
    }
  }

  const seen = new Set()
  const normalized = []
  let normalizedEntriesCount = 0
  const droppedEntries = []

  items.forEach((item, index) => {
    if (normalized.length >= maxEntries) {
      droppedEntries.push({ index, code: 'MAX_ENTRIES_LIMIT' })
      return
    }

    if (typeof item !== 'string' && (!item || typeof item !== 'object' || Array.isArray(item))) {
      droppedEntries.push({ index, code: 'UNSUPPORTED_ENTRY_TYPE' })
      return
    }

    const { text, sourceField } = resolveSeedEntryText(item)
    if (!text) {
      droppedEntries.push({
        index,
        code: typeof item === 'string' ? 'EMPTY_TEXT' : 'MISSING_TEXT_FIELD',
      })
      return
    }

    normalizedEntriesCount += 1
    const dedupKey = seedDedupKey(text)
    if (!dedupKey) {
      droppedEntries.push({ index, code: 'EMPTY_DEDUP_KEY' })
      return
    }
    if (seen.has(dedupKey)) {
      droppedEntries.push({ index, code: 'DUPLICATE_TEXT' })
      return
    }

    seen.add(dedupKey)
    const cell = typeof item === 'string' ? { cellCode: null, source: null } : resolveSeedEntryCellCode(item)
    normalized.push({
      text,
      cellCode: cell.cellCode,
      confidence: typeof item === 'string' ? null : clampConfidence(item?.confidence),
      kind: typeof item === 'string' ? null : normalizeSeedKind(item?.kind),
      _diagnostic: sourceField || cell.source ? { textField: sourceField, cellSource: cell.source } : undefined,
    })
  })

  return {
    entries: normalized.map((entry) => {
      if (!entry._diagnostic) return entry
      const { _diagnostic, ...cleanEntry } = entry
      return cleanEntry
    }),
    diagnostics: {
      rawEntriesCount: items.length,
      normalizedEntriesCount,
      dedupedEntriesCount: normalized.length,
      droppedEntries,
    },
  }
}

export const parseSeedEntriesPayloadDetailed = (payload, maxEntries = resolveSeedMaxEntries()) => {
  if (!payload) {
    return {
      entries: null,
      diagnostics: {
        sourcePath: null,
        rawEntriesCount: 0,
        normalizedEntriesCount: 0,
        dedupedEntriesCount: 0,
        droppedEntries: [],
        status: 'missing_payload',
      },
    }
  }

  const source = resolveSeedEntryList(payload)
  if (!Array.isArray(source.items)) {
    return {
      entries: null,
      diagnostics: {
        sourcePath: null,
        rawEntriesCount: 0,
        normalizedEntriesCount: 0,
        dedupedEntriesCount: 0,
        droppedEntries: [],
        status: 'missing_entries_array',
      },
    }
  }

  const parsed = normalizeSeedEntriesWithDiagnostics(source.items, maxEntries)
  const status =
    source.items.length === 0
      ? 'empty_entries'
      : parsed.entries.length > 0
        ? 'ok'
        : parsed.diagnostics.normalizedEntriesCount > 0
          ? 'all_duplicates'
          : 'schema_rejected'

  return {
    entries: parsed.entries.length ? parsed.entries : null,
    diagnostics: {
      sourcePath: source.path,
      rawEntriesCount: parsed.diagnostics.rawEntriesCount,
      normalizedEntriesCount: parsed.diagnostics.normalizedEntriesCount,
      dedupedEntriesCount: parsed.diagnostics.dedupedEntriesCount,
      droppedEntries: parsed.diagnostics.droppedEntries,
      status,
    },
  }
}

export const normalizeSeedEntries = (items, maxEntries = resolveSeedMaxEntries()) =>
  normalizeSeedEntriesWithDiagnostics(items, maxEntries).entries

export const parseSeedEntriesPayload = (payload, maxEntries = resolveSeedMaxEntries()) =>
  parseSeedEntriesPayloadDetailed(payload, maxEntries).entries

const coerceSeedColumnCode = (value) => {
  const raw = String(value ?? '').trim().toUpperCase()
  if (raw === '1' || raw === '2' || raw === '3') return raw
  if (raw === 'B1') return '1'
  if (raw === 'B2') return '2'
  if (raw === 'B3') return '3'
  return null
}

const coerceSeedColumnCodeLoose = (value) => {
  const raw = String(value ?? '').trim().toUpperCase()
  const direct = coerceSeedColumnCode(raw)
  if (direct) return direct
  const bMatch = raw.match(/B\s*([123])\b/)
  if (bMatch) return bMatch[1]
  const digitMatch = raw.match(/\b([123])\b/)
  if (digitMatch) return digitMatch[1]
  const fallbackDigit = raw.match(/([123])/)
  if (fallbackDigit) return fallbackDigit[1]
  return null
}

function mapColumnToLegacyCellCode(column) {
  switch (String(column || '').trim()) {
    case '1':
      return 'B1'
    case '2':
      return 'B2'
    case '3':
      return 'B3'
    default:
      return null
  }
}

const normalizeColumnFirstComparableText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')

const columnFirstMatchKey = (value) =>
  normalizeColumnFirstComparableText(value)
    .toLowerCase()
    .replace(/[^A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export const buildColumnFirstClassificationFromLlm = ({ inputEntries, llmPayload }) => {
  const raw =
    llmPayload?.entries ||
    llmPayload?.items ||
    llmPayload?.data?.entries ||
    llmPayload?.result?.entries ||
    null
  const safeList = Array.isArray(raw) ? raw : []
  const byId = new Map()
  const byKey = new Map()
  for (const item of safeList) {
    const safeId = String(item?.id ?? '').trim()
    if (safeId && !byId.has(safeId)) {
      byId.set(safeId, {
        llmRawColumn: item?.column ?? item?.col ?? item?.cellCode ?? null,
        column: coerceSeedColumnCodeLoose(item?.column ?? item?.col ?? item?.cellCode),
        confidence: item?.confidence ?? null,
        kind: item?.kind ?? null,
      })
    }
    const key = columnFirstMatchKey(resolveSeedEntryText(item).text)
    if (!key) continue
    if (byKey.has(key)) continue
    byKey.set(key, {
      llmRawColumn: item?.column ?? item?.col ?? item?.cellCode ?? null,
      column: coerceSeedColumnCodeLoose(item?.column ?? item?.col ?? item?.cellCode),
      confidence: item?.confidence ?? null,
      kind: item?.kind ?? null,
    })
  }

  const mapped = (Array.isArray(inputEntries) ? inputEntries : []).map((entry) => {
    const safeId = String(entry?.id ?? '').trim()
    const text = normalizeColumnFirstComparableText(entry?.text)
    const picked = (safeId ? byId.get(safeId) : null) || byKey.get(columnFirstMatchKey(text)) || null
    const column = picked?.column ?? null
    return {
      text,
      column,
      cellCode: mapColumnToLegacyCellCode(column),
      confidence: clampConfidence(picked?.confidence),
      kind: normalizeSeedKind(picked?.kind),
    }
  })

  const total = mapped.length
  const classified = mapped.filter((entry) => entry.cellCode != null).length
  const c1 = mapped.filter((entry) => entry.cellCode === 'B1').length
  const c2 = mapped.filter((entry) => entry.cellCode === 'B2').length
  const c3 = mapped.filter((entry) => entry.cellCode === 'B3').length
  const nullCount = total - classified
  return {
    entries: normalizeSeedEntries(mapped, resolveSeedMaxEntries()),
    stats: { total, classified, nullCount, byColumn: { 1: c1, 2: c2, 3: c3 } },
  }
}

const inferCellMeaning = (cellCode) => {
  const safe = coerceCellId(cellCode)
  if (!safe) return { row: null, col: null }
  const rowMap = { A: 'world', B: 'product', C: 'elements' }
  const colMap = { 1: 'as_is', 2: 'not_working', 3: 'should_be' }
  return {
    row: rowMap[safe[0]] || null,
    col: colMap[safe[1]] || null,
  }
}

const detectCellSignals = (text) => {
  const value = normalizeSeedText(text).toLowerCase()
  return {
    hasShouldSignal: /\b(?:powin(?:ien|na|no|ny|nna|nny|nnyś|ny by|na by|no by)|musi|mógłby|moglby|pozwoli(?:ć|lby)|warto,? żeby|should|must|could|would help|needs to|has to|required|requirement)\b/.test(value),
    hasProblemSignal: /\b(?:problem|trudno|musz(?:i|ą)|dodatkow(?:a|y)|ryzyk|uszkod|zgniec|tarci|niepotrzebn|błąd|blad|awari|opóźn|opozn|koszt|pain|risk|damage|extra step|friction|inefficien|fail|failure|harm)\b/.test(value),
    hasAsIsSignal: /\b(?:obecne|obecny|obecna|dziś|dzis|aktualn|istniej|są|jest|currently|existing|today|current|are|is)\b/.test(value),
    looksLikeMarketStatement: /\b(?:klient|użytkownik|uzytkownik|rynek|market|customer|user|store|shop|checkout)\b/.test(value),
  }
}

const shouldNullConflictingSeedCellCode = (entry) => {
  const inferred = inferCellMeaning(entry?.cellCode)
  if (!inferred.col) return false
  const text = normalizeSeedText(entry?.text)
  if (!text) return false
  const confidence = clampConfidence(entry?.confidence)
  const flags = detectCellSignals(text)
  if (flags.hasProblemSignal && flags.hasShouldSignal) {
    return confidence == null || confidence < 0.995
  }
  if (flags.hasShouldSignal && inferred.col && inferred.col !== 'should_be') {
    return confidence == null || confidence < 0.995
  }
  if (flags.hasProblemSignal && inferred.col && inferred.col !== 'not_working') {
    return confidence == null || confidence < 0.995
  }
  if (
    flags.hasAsIsSignal &&
    inferred.col &&
    inferred.col !== 'as_is' &&
    !flags.hasProblemSignal &&
    !flags.looksLikeMarketStatement
  ) {
    return confidence == null || confidence < 0.995
  }
  return false
}

export const applySeedClassificationSafetyCheck = (entries) => {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => {
    if (!shouldNullConflictingSeedCellCode(entry)) return entry
    return {
      ...entry,
      cellCode: null,
    }
  })
}

export const normalizeSeedEntriesForClassification = (entries) => {
  if (!Array.isArray(entries)) return []
  const seen = new Set()
  const out = []
  const normalize = (value) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—•*]+/, '')
      .replace(/[\s\-–—•*]+$/, '')
      .replace(/^[\s"'“”‘’]+/, '')
      .replace(/[\s"'“”‘’]+$/, '')
      .trim()
  const dedupKey = (value) =>
    normalize(value)
      .toLowerCase()
      .replace(/[^A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const safeShorten = (value, maxLen = 160) => {
    const trimmed = normalize(value)
    if (trimmed.length <= maxLen) return trimmed
    const slice = trimmed.slice(0, maxLen + 1)
    const cutAt =
      Math.max(
        slice.lastIndexOf('.'),
        slice.lastIndexOf(';'),
        slice.lastIndexOf(','),
        slice.lastIndexOf('—'),
        slice.lastIndexOf('-')
      ) || 0
    const candidate = cutAt >= Math.floor(maxLen * 0.7) ? slice.slice(0, cutAt) : slice.slice(0, maxLen)
    return candidate.trim().replace(/[,\-–—;:.]+$/, '').trim()
  }

  for (const item of entries) {
    if (typeof item !== 'string') continue
    let text = normalize(item)
    if (text.length < 3) continue
    if (text.length > 220) continue
    if (text.length > 180) text = safeShorten(text, 160)
    const key = dedupKey(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

export const buildSeedFallbackEntries = (text, maxEntries = 8) => {
  const chunks = String(text || '')
    .split(/[\n\r]+|[.!?]\s+/)
    .map((item) => normalizeSeedText(item))
    .filter(Boolean)
  return normalizeSeedEntries(
    chunks.map((chunk) => ({ text: chunk, cellCode: null, confidence: null, kind: 'note' })),
    maxEntries
  )
}

export const seedCellCodeToMatrix = (cellCode) => {
  const safe = coerceCellId(cellCode)
  if (!safe) return { matrixRow: null, matrixCol: null, matrixCell: null }
  const rowMap = { A: 'world', B: 'product', C: 'elements' }
  const colMap = { 1: 'as_is', 2: 'not_working', 3: 'should_be' }
  return {
    matrixRow: rowMap[safe[0]] || null,
    matrixCol: colMap[safe[1]] || null,
    matrixCell: safe,
  }
}

const buildSharedExtractionInstructions = () => `
Extract ALL distinct atomic ideas from the user's brief.

Goal:
- HIGH RECALL: capture all important ideas.
- HIGH PRECISION OF ATOMS: each entry must express exactly ONE idea.

Semantic purity rules:
- Do NOT combine current state, problem, desired state, solution concept, or requirement in one entry.
- Split mixed sentences into separate entries whenever they contain more than one of these:
  1. observation about the current situation,
  2. user pain / problem / friction / damage / inefficiency,
  3. proposed solution or feature idea,
  4. requirement or constraint for the solution.
- Keep the user's meaning, but rewrite into short, explicit, single-idea statements when needed.
- Do not summarize multiple ideas into one sentence.
- Do not invent facts that are not present in the brief.

Semantic distinctions:
- CURRENT STATE = what exists today, what is observed now.
- PROBLEM = what causes harm, friction, inefficiency, confusion, damage, risk, or extra effort.
- DESIRED / SOLUTION = what could help, what should exist, what feature is proposed.
- REQUIREMENT / CONSTRAINT = what the proposed solution must satisfy.

Length rule:
- Prefer short entries.
- Each entry should usually stay under 160 characters unless a longer phrasing is necessary for clarity.

Good examples:
- "Obecne koszyki ciągnięte za uchwyt są głębokie."
- "Delikatne produkty na dole mogą zostać zgniecione przez cięższe produkty."
- "Klient musi przekładać delikatne produkty na górę."
- "To dodaje niepotrzebną czynność podczas zakupów."
- "Koszyk mógłby mieć pionową przegrodę."
- "Przegroda powinna być łatwa do przestawienia."
- "The current pull-behind baskets are deep."
- "Fragile products at the bottom can be crushed by heavier items."
- "Customers must move fragile items to the top."
- "This adds an unnecessary action during shopping."
- "The basket could include a vertical divider."
- "The divider should be easy to reposition."

Bad examples:
- "Deep baskets crush fragile items, so a divider would help."
- "Customers move fragile items because baskets are deep and should have a divider."
- "A stable movable divider would solve the problem."

Return STRICT JSON ONLY:
{"entries":[{"text":"..."}]}

Write entries in Polish when locale is "pl". Write entries in English when locale is "en".
`.trim()

const buildConversationTurnAppendix = () => `
Additional rules for conversation analysis:
- Extract information only from the latest user message.
- Use the extra context only to avoid duplicates, avoid rejected interpretations, and keep wording consistent.
- If selected_open_question is present, use it only to interpret what the latest short answer refers to.
- Never copy selected_open_question into an extracted entry.
- Do not convert missing information into an entry.
- Do not create entries about the conversation itself.
- If the user expresses uncertainty, preserve that uncertainty in the entry text.
- If an existing confirmed entry already states the same thing, do not return it again.
- If a rejected entry matches the same information and the latest message adds no new evidence, do not return it again.
`.trim()

export const buildSeedExtractionInstructions = ({ mode = 'brief' } = {}) =>
  mode === 'conversation_turn'
    ? `${buildSharedExtractionInstructions()}\n\n${buildConversationTurnAppendix()}`
    : buildSharedExtractionInstructions()

export const buildSeedClassificationInstructions = () => `
Classify each entry into a 3x3 matrix cell A1..C3 or null.

Columns:
- A = AS_IS: current reality, existing state, observed facts, comparisons describing how things work today.
- B = NOT_WORKING: pain, friction, failure, inefficiency, risk, damage, unnecessary effort, negative consequence.
- C = SHOULD_BE: desired future state, proposal, feature idea, design requirement, expected property.

Rows:
- 1 = WORLD / CONTEXT: shopping context, store process, customer behavior, checkout flow, general usage situation.
- 2 = PRODUCT / SYSTEM: the basket as a whole, basket type, overall product structure or form.
- 3 = ELEMENT / COMPONENT: divider, handle, wheel, compartment, specific part or internal feature.

Hard rules:
- Do not rewrite text.
- Do not drop entries.
- If an entry expresses pain, risk, damage, friction, or unnecessary effort, prefer column B.
- If an entry expresses a proposal, desired capability, requirement, or expected property, prefer column C.
- If an entry only describes what exists today, prefer column A.
- If an entry describes another existing product variant that works better today, classify it as A unless it explicitly proposes adopting that variant.
- Requirements and constraints for a proposed solution belong to column C, not B.
- If an entry mixes multiple semantic roles and cannot be classified safely, return null.

Return STRICT JSON ONLY:
{"entries":[{"text":"...","cellCode":"A1","confidence":0.92,"kind":"idea"}]}
`.trim()

export const buildSeedClassificationInstructionsColumnFirst = () => `
Classify each entry into a semantic column 1..3.

Columns:
- 1 = AS_IS: current reality, existing state, neutral observations, comparisons describing how things work today.
- 2 = NOT_WORKING: pain, friction, failure, inefficiency, risk, damage, unnecessary effort, negative consequence.
- 3 = SHOULD_BE: desired future state, proposal, feature idea, requirement, expected property.

Core principle:
Choose the MOST LIKELY dominant intent of the entry.

Very important rules:

1. ALWAYS assign 1, 2, or 3.
Do NOT return null unless the text is completely unreadable.

2. Real user statements often mix:
- observation + problem
- problem + solution
- context + consequence

This is NORMAL.
Your job is NOT to reject them.
Your job is to choose the dominant meaning.

3. If unsure:
- make your best guess
- lower the confidence instead of returning null

4. Confidence scale:
- 0.9–1.0 → very clear
- 0.7–0.9 → quite confident
- 0.5–0.7 → uncertain but best guess
- <0.5 → only if truly ambiguous

5. Strong signals:

SHOULD_BE (3):
- "powinien", "musi", "mógłby", "pozwoliłby"
- "should", "must", "could", "would help"
- requirements like "must be stable", "easy to move"

NOT_WORKING (2):
- "problem", "trudno", "muszą", "dodatkowa czynność"
- "problem", "must", "extra step", "risk", "damage"

AS_IS (1):
- "obecne", "dzisiaj", "są", "currently", "existing"
- descriptions of how things work now

6. Benchmark rule:
If describing an existing alternative that already works better → 1 (NOT 3)

7. Requirements rule:
Constraints like:
- "must be stable"
- "should be easy to reposition"
→ ALWAYS 3

Hard rules:
- Do not rewrite text.
- Do not drop entries.
- Pain / damage / friction / unnecessary effort -> 2
- Proposal / idea / requirement / expected property -> 3
- Pure observation / neutral fact / benchmark about an existing alternative -> 1

Return STRICT JSON ONLY:
{"entries":[{"id":"1","text":"...","column":"1","confidence":0.82}]}

Output requirements:
- Return exactly one output item per input item.
- Preserve every input id (do not reorder ids).
- Do not rewrite input text (copy it verbatim).

Write entries exactly in the same language as the input entries.
`.trim()

export const buildConversationTurnAnalysisInstructions = () => `
Analyze the latest user message and return ALL distinct atomic entries already classified into the 3x3 matrix.

Source rules:
- Use only latest_user_message as the source of facts.
- Use recent_user_messages, recent_conversation, confirmed_entries, rejected_entries, active_proposals, current_gaps, and asked_questions_history only to avoid duplicates, avoid previously rejected interpretations, and keep wording consistent.
- If selected_open_question, last_assistant_question, active_question_gap_id, or active_question_semantic_key is present, use them only to understand what the latest short answer is answering.
- Never turn selected_open_question itself into an entry.
- Never turn any question, gap, or proposal text itself into an entry unless the user confirms or changes that information in latest_user_message.
- Do not create entries about the conversation itself.
- Do not invent facts that are not present in the latest user message.
- If the user expresses uncertainty, preserve that uncertainty in the entry text.
- If a confirmed entry already states the same thing, do not return it again.
- If a rejected entry matches the same information and the latest message adds no new evidence, do not return it again.
- If the latest_user_message is short, elliptical, or fragmentary, interpret it together with the latest relevant assistant question and active gap context before deciding whether it contains usable information.
- Treat direct short answers such as option picks, comparisons, or "both" answers as meaningful if their meaning becomes clear from the active question context.

Atomicity rules:
- Return one entry per idea.
- Do not merge current state, problem, desired state, solution, and requirement into one entry.
- Rewrite only when needed to make the idea short, explicit, and atomic.
- Keep the user's meaning.

Matrix columns:
- 1 / A = AS_IS: current reality, existing state, observed fact, comparison describing how things work today.
- 2 / B = NOT_WORKING: pain, mismatch, failure, inefficiency, damage, extra effort, missing fit, negative consequence.
- 3 / C = SHOULD_BE: desired future state, proposal, feature idea, requirement, expected property.

Matrix rows:
- A / 1 = WORLD / CONTEXT: customer situation, market context, process, behavior, general usage situation.
- B / 2 = PRODUCT / SYSTEM: the whole product, offer, service, portfolio, overall structure.
- C / 3 = ELEMENT / COMPONENT: specific part, subfeature, module, component, internal element.

Kind:
- Use one of: observation, problem, need, idea, conclusion, question, note.

Hard rules:
- Do not drop important ideas from the latest user message.
- Do not rewrite the same idea into multiple near-duplicates.
- If classification is not safe, set cellCode to null.
- If no reliable entries can be extracted, return {"entries":[]}.

Return STRICT JSON ONLY:
{"entries":[{"text":"...","cellCode":"B2","confidence":0.88,"kind":"problem"}]}

Write entries exactly in the same language as latest_user_message.
`.trim()

const buildSeedModelsDefault = () => ({
  default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
  preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
  escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
})

const buildSeedModelsEscalate1 = () => ({
  default: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
  preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
  escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
})

const buildSeedModelsEscalate2 = () => ({
  default:
    process.env.OPENAI_MODEL_ESCALATION_2 ||
    process.env.OPENAI_MODEL_ESCALATION ||
    'gpt-5',
  preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
  escalation:
    process.env.OPENAI_MODEL_ESCALATION_2 ||
    process.env.OPENAI_MODEL_ESCALATION ||
    'gpt-5',
})

const parseJson = (value) => {
  try {
    const parsed = JSON.parse(value)
    return parsed ?? null
  } catch {
    return null
  }
}

const buildSeedExtractionInput = ({ text, locale, context, mode }) => {
  if (mode !== 'conversation_turn') return text
  return JSON.stringify({
    locale,
    latest_user_message: text,
    recent_user_messages: Array.isArray(context?.recentUserMessages) ? context.recentUserMessages.slice(-6) : [],
    recent_conversation: Array.isArray(context?.recentConversation)
      ? context.recentConversation.slice(-12).map((entry) => ({
          role: normalizeSeedText(entry?.role || ''),
          content: normalizeSeedText(entry?.content || ''),
          gap_id: normalizeSeedText(entry?.gapId || ''),
          semantic_key: normalizeSeedText(entry?.semanticKey || ''),
        }))
      : [],
    confirmed_entries: Array.isArray(context?.confirmedEntries) ? context.confirmedEntries.slice(0, 40) : [],
    rejected_entries: Array.isArray(context?.rejectedEntries) ? context.rejectedEntries.slice(0, 40) : [],
    active_proposals: Array.isArray(context?.activeProposals) ? context.activeProposals.slice(0, 20) : [],
    current_gaps: Array.isArray(context?.currentGaps)
      ? context.currentGaps.slice(0, 12).map((entry) => ({
          id: normalizeSeedText(entry?.id || ''),
          semantic_key: normalizeSeedText(entry?.semanticKey || ''),
          gap_type: normalizeSeedText(entry?.gapType || ''),
          gap_status: normalizeSeedText(entry?.gapStatus || ''),
          matrix_row: normalizeSeedText(entry?.matrixRow || ''),
          matrix_col: normalizeSeedText(entry?.matrixCol || ''),
          question: normalizeSeedText(entry?.question || ''),
          description: normalizeSeedText(entry?.description || ''),
        }))
      : [],
    asked_questions_history: Array.isArray(context?.askedQuestionsHistory)
      ? context.askedQuestionsHistory.slice(-12).map((entry) => ({
          content: normalizeSeedText(entry?.content || ''),
          gap_id: normalizeSeedText(entry?.gapId || ''),
          semantic_key: normalizeSeedText(entry?.semanticKey || ''),
        }))
      : [],
    selected_open_question: normalizeSeedText(context?.selectedOpenQuestion || ''),
    last_assistant_question: normalizeSeedText(context?.lastAssistantQuestion || ''),
    active_question_gap_id: normalizeSeedText(context?.activeQuestionGapId || ''),
    active_question_semantic_key: normalizeSeedText(context?.activeQuestionSemanticKey || ''),
  })
}

const buildSeedErrorMeta = (errorCategory, overrides = {}) => ({
  aiSupportEnabled: errorCategory !== 'AI_DISABLED',
  modelUsed: null,
  attemptedModel: null,
  escalated: false,
  errorCategory,
  tokens: { input: 0, output: 0, total: 0 },
  ...overrides,
})

const withSeedErrorCategory = (meta, errorCategory) => ({
  ...(meta || buildSeedErrorMeta(errorCategory)),
  errorCategory,
})

const withSeedDiagnostics = (meta, diagnostics) => {
  if (!diagnostics) return meta
  return {
    ...(meta || buildSeedErrorMeta(null)),
    errorInfo: diagnostics,
  }
}

const buildSeedParseFailureMeta = ({ meta, diagnostics }) => {
  const status = diagnostics?.status || null
  const errorCategory =
    status === 'empty_entries' || status === 'all_duplicates' ? 'NO_FINDINGS' : 'PARSE_ERROR'
  return withSeedDiagnostics(withSeedErrorCategory(meta, errorCategory), diagnostics)
}

export const analyzeSeedLikeText = async ({
  text,
  locale = 'pl',
  apiKey,
  aiSupportEnabled,
  sessionId = null,
  rateLimiter = null,
  rateLimitKey = null,
  context = null,
  mode = 'brief',
  allowTextFallback = true,
}) => {
  const safeText = String(text || '').trim()
  const fallbackEntries = allowTextFallback ? buildSeedFallbackEntries(safeText, 8) : []
  if (!safeText) {
    return {
      ok: false,
      source: 'empty',
      entries: [],
      fallbackEntries: [],
      meta: buildSeedErrorMeta('EMPTY_INPUT', { aiSupportEnabled: false }),
    }
  }
  if (!aiSupportEnabled) {
    return {
      ok: false,
      source: 'disabled',
      entries: [],
      fallbackEntries,
      meta: buildSeedErrorMeta('AI_DISABLED', { aiSupportEnabled: false }),
    }
  }
  if (!apiKey) {
    return {
      ok: false,
      source: 'missing_key',
      entries: [],
      fallbackEntries,
      meta: buildSeedErrorMeta('MISSING_API_KEY'),
    }
  }

  const seedModelsDefault = buildSeedModelsDefault()
  const seedModelsEscalate1 = buildSeedModelsEscalate1()
  const seedModelsEscalate2 = buildSeedModelsEscalate2()
  const shouldSkipPreprocess = safeText.length > 800
  const forceEscalation = safeText.length > 800
  const extractionInput = buildSeedExtractionInput({ text: safeText, locale, context, mode })

  if (mode === 'conversation_turn') {
    const analysisResult = await runLlmTask({
      apiKey,
      aiSupportEnabled: true,
      task: 'seed-analysis-turn',
      input: extractionInput,
      sessionId,
      language: locale === 'pl' ? 'Polish' : 'English',
      taskInstructions: buildConversationTurnAnalysisInstructions(),
      parseResponse: parseJson,
      fallbackData: null,
      models: seedModelsDefault,
      maxOutputTokens: 1600,
      temperature: 0.2,
      skipPreprocess: true,
      useDefaultModelWhenSkippingPreprocess: true,
      forceEscalation: false,
      rateLimiter,
      rateLimitKey,
    })
    const parsedEntries = analysisResult.ok
      ? parseSeedEntriesPayloadDetailed(analysisResult.data, resolveSeedMaxEntries())
      : { entries: null, diagnostics: null }
    const entries = parsedEntries.entries

    if (analysisResult.ok && entries && entries.length) {
      return {
        ok: true,
        source: 'llm',
        entries: applySeedClassificationSafetyCheck(entries),
        fallbackEntries,
        meta: withSeedDiagnostics(analysisResult.meta || buildSeedErrorMeta(null), parsedEntries.diagnostics),
      }
    }

    return {
      ok: false,
      source: 'fallback',
      entries: [],
      fallbackEntries,
      meta: analysisResult.ok
        ? buildSeedParseFailureMeta({
            meta: analysisResult?.meta,
            diagnostics: parsedEntries.diagnostics,
          })
        : analysisResult?.meta || buildSeedErrorMeta('LLM_FAILED'),
    }
  }

  const runExtractionPass = async (modelSet) =>
    runLlmTask({
      apiKey,
      aiSupportEnabled: true,
      task: 'seed-extraction',
      input: extractionInput,
      sessionId,
      language: locale === 'pl' ? 'Polish' : 'English',
      taskInstructions: buildSeedExtractionInstructions({ mode }),
      parseResponse: parseJson,
      fallbackData: null,
      models: modelSet,
      maxOutputTokens: 1600,
      temperature: 0.2,
      skipPreprocess: shouldSkipPreprocess,
      forceEscalation,
      rateLimiter,
      rateLimitKey,
    })

  const seedClassificationMode = resolveSeedClassificationMode()

  const runClassificationPass = async (extracted, modelSet) =>
    runLlmTask({
      apiKey,
      aiSupportEnabled: true,
      task: 'seed-classification',
      input: JSON.stringify(extracted ?? {}),
      sessionId,
      language: locale === 'pl' ? 'Polish' : 'English',
      taskInstructions:
        seedClassificationMode === 'column_first'
          ? buildSeedClassificationInstructionsColumnFirst()
          : buildSeedClassificationInstructions(),
      parseResponse: parseJson,
      fallbackData: null,
      models: modelSet,
      maxOutputTokens: 1600,
      temperature: seedClassificationMode === 'column_first' ? 0.3 : 0.1,
      skipPreprocess: shouldSkipPreprocess,
      forceEscalation,
      rateLimiter,
      rateLimitKey,
    })

  const shouldRetryColumnFirst = (stats) => {
    const total = Number(stats?.total) || 0
    const classified = Number(stats?.classified) || 0
    if (classified < 2) return true
    if (total >= 2 && classified / total < 0.5) return true
    return false
  }

  let extractionResult = await runExtractionPass(seedModelsDefault)
  let extractedParsed = extractionResult.ok
    ? parseSeedEntriesPayloadDetailed(extractionResult.data, resolveSeedMaxEntries())
    : { entries: null, diagnostics: null }
  let extractedEntries = extractedParsed.entries
  if (!extractedEntries || extractedEntries.length < 2) {
    const retryExtraction = await runExtractionPass(seedModelsEscalate1)
    if (retryExtraction.ok) {
      extractionResult = retryExtraction
      extractedParsed = parseSeedEntriesPayloadDetailed(retryExtraction.data, resolveSeedMaxEntries())
      extractedEntries = extractedParsed.entries
    }
  }

  const normalizedExtractedTexts = normalizeSeedEntriesForClassification(
    (extractedEntries || []).map((entry) => entry?.text).filter((value) => typeof value === 'string')
  )
  const extractedPayload =
    seedClassificationMode === 'column_first'
      ? { entries: normalizedExtractedTexts.map((entryText, index) => ({ id: String(index + 1), text: entryText })) }
      : { entries: normalizedExtractedTexts.map((entryText) => ({ text: entryText })) }

  if (!normalizedExtractedTexts.length) {
    return {
      ok: false,
      source: 'fallback',
      entries: [],
      fallbackEntries,
      meta: extractionResult?.ok
        ? buildSeedParseFailureMeta({
            meta: extractionResult?.meta,
            diagnostics: extractedParsed.diagnostics,
          })
        : extractionResult?.meta || buildSeedErrorMeta('LLM_FAILED'),
    }
  }

  let classificationResult = null
  let entries = null
  let classificationParsed = { entries: null, diagnostics: null }

  if (seedClassificationMode === 'column_first') {
    const attempts = [
      { modelSet: seedModelsDefault },
      { modelSet: seedModelsEscalate1 },
      { modelSet: seedModelsEscalate2 },
    ]

    for (const { modelSet } of attempts) {
      classificationResult = await runClassificationPass(extractedPayload, modelSet)
      if (!classificationResult.ok) continue
      const parsed = buildColumnFirstClassificationFromLlm({
        inputEntries: extractedPayload.entries,
        llmPayload: classificationResult.data,
      })
      entries = parsed.entries
      if (!shouldRetryColumnFirst(parsed.stats)) break
    }

    if (!entries || !entries.length) {
      entries = normalizeSeedEntries(
        normalizedExtractedTexts.map((entryText) => ({
          text: entryText,
          cellCode: null,
          confidence: null,
          kind: 'note',
        })),
        resolveSeedMaxEntries()
      )
    }
  } else {
    classificationResult = await runClassificationPass(extractedPayload, seedModelsDefault)
    if (classificationResult.ok) {
      classificationParsed = parseSeedEntriesPayloadDetailed(classificationResult.data, resolveSeedMaxEntries())
      entries = classificationParsed.entries
      entries = entries ? applySeedClassificationSafetyCheck(entries) : null
    }

    if (!entries || entries.length < 2) {
      const retryClassify = await runClassificationPass(extractedPayload, seedModelsEscalate1)
      if (retryClassify.ok) {
        classificationResult = retryClassify
        classificationParsed = parseSeedEntriesPayloadDetailed(retryClassify.data, resolveSeedMaxEntries())
        entries = classificationParsed.entries
        entries = entries ? applySeedClassificationSafetyCheck(entries) : null
      }
    }
  }

  if (classificationResult?.ok && entries && entries.length) {
    return {
      ok: true,
      source: 'llm',
      entries,
      fallbackEntries,
      meta: withSeedDiagnostics(classificationResult.meta || buildSeedErrorMeta(null), classificationParsed.diagnostics),
    }
  }

  const failedMeta =
    classificationResult?.meta ||
    extractionResult?.meta ||
    buildSeedErrorMeta(
      extractionResult?.meta?.errorCategory || classificationResult?.meta?.errorCategory || 'LLM_FAILED'
    )
  return {
    ok: false,
    source: 'fallback',
    entries: [],
    fallbackEntries,
    meta:
      classificationResult?.ok && classificationParsed?.diagnostics
        ? buildSeedParseFailureMeta({
            meta: failedMeta,
            diagnostics: classificationParsed.diagnostics,
          })
        : failedMeta?.errorCategory || !(classificationResult?.ok || extractionResult?.ok)
          ? failedMeta
          : withSeedErrorCategory(failedMeta, 'NO_FINDINGS'),
  }
}
