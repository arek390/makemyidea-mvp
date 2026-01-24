const MAX_SUMMARY_CHARS = 240

const normalizeString = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeList = (value, max) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, max)
}

const normalizeProductType = (value) => {
  const normalized = normalizeString(value).toLowerCase()
  if (normalized === 'product') return 'product'
  if (normalized === 'service') return 'service'
  return 'unknown'
}

const extractLabeledName = (text) => {
  const match = text.match(/(?:nazwa|produkt|usługa|usluga|project|projekt)\s*[:\-]\s*(.{3,80})/i)
  if (!match) return null
  const candidate = normalizeString(match[1])
  return candidate ? candidate.split(/[.,;()\n]/)[0].trim() : null
}

const extractQuotedNames = (text) => {
  const matches = []
  const regex = /["“”„'‘’]([^"“”„'‘’]{3,80})["“”„'‘’]/g
  let match = regex.exec(text)
  while (match) {
    const candidate = normalizeString(match[1])
    if (candidate) matches.push(candidate)
    match = regex.exec(text)
  }
  return matches
}

export const inferProductName = (boardItems, sessionTitle) => {
  const items = (boardItems || []).map((item) => normalizeString(item)).filter(Boolean)
  const title = normalizeString(sessionTitle)
  if (title) {
    const inBoard = items.some((item) => item.toLowerCase().includes(title.toLowerCase()))
    if (inBoard) return title
  }

  const labeled = items.map(extractLabeledName).filter(Boolean)
  if (labeled.length) return labeled[0]

  const quoted = items.flatMap(extractQuotedNames)
  const candidates = [...new Set(quoted)]
  for (const candidate of candidates) {
    const occurrences = items.filter((item) =>
      item.toLowerCase().includes(candidate.toLowerCase())
    ).length
    if (occurrences >= 2) return candidate
  }

  return null
}

export const buildContextPrompt = ({ boardItems, sessionTitle, matrixContext }) => {
  const items = (boardItems || []).map((item) => `- ${normalizeString(item)}`).join('\n')
  const title = normalizeString(sessionTitle)
  const matrix = matrixContext && typeof matrixContext === 'object'
    ? JSON.stringify(matrixContext)
    : ''
  return [
    title ? `Session title: ${title}` : 'Session title: (none)',
    matrix ? `Matrix context: ${matrix}` : 'Matrix context: (none)',
    'Board items:',
    items || '- (none)',
  ].join('\n')
}

export const buildQuestionPrompt = ({ context, matrixContext, count, spaceDef, timeDef }) => {
  const contextJson = context ? JSON.stringify(context) : ''
  const matrixJson = matrixContext && typeof matrixContext === 'object'
    ? JSON.stringify(matrixContext)
    : ''
  const inputParts = [
    `Product name: ${context?.productName || 'null'}`,
    `Product type: ${context?.productType || 'unknown'}`,
    `Summary: ${context?.summary || ''}`,
    `Key terms: ${(context?.keyTerms || []).join(', ')}`,
    `Assumptions: ${(context?.assumptions || []).join('; ')}`,
    `Open threads: ${(context?.openThreads || []).join('; ')}`,
    matrixJson ? `Matrix context: ${matrixJson}` : 'Matrix context: (none)',
    spaceDef ? `Space definition: ${spaceDef}` : 'Space definition: (none)',
    timeDef ? `Time definition: ${timeDef}` : 'Time definition: (none)',
    contextJson ? `Context JSON: ${contextJson}` : 'Context JSON: (none)',
  ]
  return {
    input: inputParts.join('\n'),
    instructions: [
      `Generate ${count} facilitation-grade questions based strictly on the board context.`,
      'Use only information implied by the summary/key terms/open threads.',
      'Do not invent new topics. Do not propose solutions.',
      'One question = one decision or reflection.',
      'Use human facilitator language (not survey, not MBA).',
      'If productName is null, never invent or use a name.',
      'Align each question with the matrix perspective.',
      'Return ONLY a JSON array of strings.',
    ].join(' '),
  }
}

export const normalizeContextPayload = (value) => {
  if (!value || typeof value !== 'object') return null
  const summary = normalizeString(value.summary).slice(0, MAX_SUMMARY_CHARS)
  return {
    productName: normalizeString(value.productName) || null,
    productType: normalizeProductType(value.productType),
    summary,
    keyTerms: normalizeList(value.keyTerms, 8),
    assumptions: normalizeList(value.assumptions, 5),
    openThreads: normalizeList(value.openThreads, 5),
  }
}
