export type SpeechCleanupLocale = 'pl' | 'en'

const DOMAIN_VOCABULARY: Record<SpeechCleanupLocale, string[]> = {
  pl: [
    'pomysł',
    'pomysły',
    'użytkownik',
    'użytkownika',
    'produkt',
    'produkty',
    'usługa',
    'usługi',
    'rynek',
    'analiza',
    'analizować',
    'kontekst',
    'rekomendacje',
    'rekomendacja',
    'sesja',
    'sesji',
    'tablica',
    'wpis',
    'wpisy',
    'raport',
    'perspektywa',
    'perspektywy',
    'obserwacja',
    'obserwacje',
    'problem',
    'problemy',
    'rozwiązanie',
    'rozwiązania',
    'facylitować',
    'facylitowane',
    'facylitowanie',
    'formalizować',
    'kategoryzować',
    'zadanie',
    'zadania',
  ],
  en: [
    'idea',
    'ideas',
    'user',
    'users',
    'product',
    'products',
    'service',
    'services',
    'market',
    'analysis',
    'analyze',
    'context',
    'recommendation',
    'recommendations',
    'session',
    'sessions',
    'board',
    'board entry',
    'board entries',
    'entry',
    'entries',
    'report',
    'perspective',
    'perspectives',
    'observation',
    'observations',
    'problem',
    'problems',
    'solution',
    'solutions',
    'facilitate',
    'facilitated',
    'facilitation',
    'formalize',
    'categorize',
    'task',
    'tasks',
  ],
}

const COMMON_WORDS: Record<SpeechCleanupLocale, Set<string>> = {
  pl: new Set([
    'a', 'aby', 'ale', 'bardzo', 'bez', 'bo', 'by', 'być', 'co', 'czy', 'dla', 'do', 'dużo',
    'gdzie', 'go', 'i', 'ich', 'jak', 'jako', 'jest', 'klient', 'ma', 'mam', 'mamy', 'na', 'nie',
    'o', 'od', 'oraz', 'po', 'praca', 'problemu', 'proces', 'przez', 'się', 'to', 'tworzenie',
    'użyć', 'w', 'we', 'z', 'za', 'że'
  ]),
  en: new Set([
    'a', 'an', 'and', 'app', 'as', 'be', 'because', 'build', 'create', 'customer', 'for', 'from',
    'idea', 'in', 'is', 'it', 'long', 'make', 'market', 'of', 'on', 'or', 'process', 'project',
    'should', 'text', 'that', 'the', 'their', 'there', 'they', 'this', 'to', 'too', 'use', 'very',
    'wait', 'with'
  ]),
}

const STANDALONE_FILLERS: Record<SpeechCleanupLocale, string[]> = {
  pl: ['eee', 'ee', 'yyy', 'yy', 'hmm', 'mhm'],
  en: ['um', 'uh', 'uhh', 'hmm'],
}

const EDGE_FILLERS: Record<SpeechCleanupLocale, string[]> = {
  pl: ['no więc', 'jakby', 'znaczy', 'w sensie', 'nooo', 'no'],
  en: ['you know', 'basically', 'i mean', 'like'],
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const stripDiacritics = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const normalizeVocabularyToken = (value: string) =>
  stripDiacritics(String(value || '').toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()

const simplifyPhoneticish = (value: string, locale: SpeechCleanupLocale) => {
  let next = normalizeVocabularyToken(value)
  next = next.replace(/(.)\1+/g, '$1')
  if (locale === 'pl') {
    next = next
      .replace(/ou/g, 'u')
      .replace(/ph/g, 'f')
      .replace(/qu/g, 'ku')
      .replace(/x/g, 'ks')
      .replace(/oo/g, 'u')
  } else {
    next = next.replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/x/g, 'ks')
  }
  return next
}

const levenshteinDistance = (left: string, right: string) => {
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = new Array(right.length + 1).fill(0)
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row
    for (let col = 1; col <= right.length; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      current[col] = Math.min(
        current[col - 1] + 1,
        previous[col] + 1,
        previous[col - 1] + cost
      )
    }
    for (let col = 0; col <= right.length; col += 1) {
      previous[col] = current[col]
    }
  }
  return previous[right.length]
}

const normalizedEditSimilarity = (left: string, right: string) => {
  const maxLength = Math.max(left.length, right.length)
  if (!maxLength) return 1
  return 1 - levenshteinDistance(left, right) / maxLength
}

const diceSimilarity = (left: string, right: string) => {
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const grams = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2)
    grams.set(gram, (grams.get(gram) || 0) + 1)
  }
  let overlap = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2)
    const count = grams.get(gram) || 0
    if (count > 0) {
      overlap += 1
      grams.set(gram, count - 1)
    }
  }
  return (2 * overlap) / (left.length + right.length - 2)
}

const tokenizeTranscript = (value: string) =>
  value.match(/\p{L}+(?:['’-]\p{L}+)*|\d+|\s+|[^\s\p{L}\d]+/gu) || [value]

const isWordToken = (value: string) => /\p{L}/u.test(value)

const preserveTokenCase = (source: string, candidate: string) => {
  if (!source) return candidate
  if (source === source.toUpperCase()) return candidate.toUpperCase()
  if (source[0] === source[0]?.toUpperCase()) {
    return candidate.charAt(0).toUpperCase() + candidate.slice(1)
  }
  return candidate
}

const shouldConsiderSingleTokenCorrection = (token: string, locale: SpeechCleanupLocale) => {
  const normalized = normalizeVocabularyToken(token)
  if (normalized.length < 5) return false
  if (/^\d+$/u.test(normalized)) return false
  if (COMMON_WORDS[locale].has(normalized)) return false
  return !DOMAIN_VOCABULARY[locale].some((entry) => normalizeVocabularyToken(entry) === normalized)
}

const findBestDomainMatch = (
  value: string,
  locale: SpeechCleanupLocale,
  mode: 'single' | 'pair'
) => {
  const normalized = normalizeVocabularyToken(value)
  if (!normalized) return null
  const simplified = simplifyPhoneticish(value, locale)
  let best: { candidate: string; score: number } | null = null
  let secondBest = 0
  for (const candidate of DOMAIN_VOCABULARY[locale]) {
    const normalizedCandidate = normalizeVocabularyToken(candidate)
    if (!normalizedCandidate) continue
    const candidateSimplified = simplifyPhoneticish(candidate, locale)
    const score = Math.max(
      normalizedEditSimilarity(normalized, normalizedCandidate),
      normalizedEditSimilarity(simplified, candidateSimplified),
      diceSimilarity(normalized, normalizedCandidate),
      diceSimilarity(simplified, candidateSimplified)
    )
    if (!best || score > best.score) {
      secondBest = best?.score || secondBest
      best = { candidate, score }
    } else if (score > secondBest) {
      secondBest = score
    }
  }
  if (!best) return null
  const threshold = mode === 'pair' ? 0.74 : 0.84
  const margin = mode === 'pair' ? 0.08 : 0.06
  if (best.score < threshold) return null
  if (best.score - secondBest < margin) return null
  return best.candidate
}

const normalizeWhitespace = (value: string) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s])/g, '$1 ')
    .trim()

const stripEdgeFillers = (value: string, locale: SpeechCleanupLocale) => {
  let next = value
  for (const filler of EDGE_FILLERS[locale]) {
    const pattern = escapeRegex(filler).replace(/\s+/g, '\\s+')
    const leading = new RegExp(`^(?:${pattern})(?:[\\s,.;:!?-]+|$)`, 'i')
    const trailing = new RegExp(`(?:^|[\\s,.;:!?-]+)(?:${pattern})$`, 'i')
    let changed = true
    while (changed) {
      changed = false
      const strippedLeading = next.replace(leading, '')
      if (strippedLeading !== next) {
        next = strippedLeading.trim()
        changed = true
      }
      const strippedTrailing = next.replace(trailing, '')
      if (strippedTrailing !== next) {
        next = strippedTrailing.trim()
        changed = true
      }
    }
  }
  return next
}

const stripStandaloneFillers = (value: string, locale: SpeechCleanupLocale) => {
  let next = value
  for (const filler of STANDALONE_FILLERS[locale]) {
    const pattern = new RegExp(`(^|[\\s,.;:!?-])${escapeRegex(filler)}(?=$|[\\s,.;:!?-])`, 'gi')
    next = next.replace(pattern, '$1')
  }
  return next
}

const isFillerOnly = (value: string, locale: SpeechCleanupLocale) => {
  const normalized = normalizeWhitespace(value).toLowerCase()
  if (!normalized) return true
  let stripped = stripEdgeFillers(normalized, locale)
  stripped = stripStandaloneFillers(stripped, locale)
  stripped = normalizeWhitespace(stripped).replace(/[.,;:!?-]/g, '').trim()
  return stripped.length === 0
}

export const toSpeechCleanupLocale = (uiLanguage: string): SpeechCleanupLocale =>
  uiLanguage === 'Polish' ? 'pl' : 'en'

export const cleanFinalSpeechTranscriptSegment = (
  transcript: string,
  locale: SpeechCleanupLocale
) => {
  const normalizedRaw = normalizeWhitespace(transcript)
  if (!normalizedRaw) return ''
  if (isFillerOnly(normalizedRaw, locale)) return ''

  let cleaned = stripEdgeFillers(normalizedRaw, locale)
  cleaned = stripStandaloneFillers(cleaned, locale)
  cleaned = normalizeWhitespace(cleaned)
  cleaned = cleaned.replace(/^[,.;:!?-]+\s*/, '').replace(/\s*[,.;:!?-]+$/, '').trim()

  if (!cleaned) {
    return normalizedRaw
  }

  const alnumCount = cleaned.replace(/[^\p{L}\p{N}]+/gu, '').length
  if (alnumCount < 2) {
    return normalizedRaw
  }

  return cleaned
}

export const correctTranscriptWithDomainVocabulary = (
  transcript: string,
  locale: SpeechCleanupLocale
) => {
  const normalized = normalizeWhitespace(transcript)
  if (!normalized) return ''
  const tokens = tokenizeTranscript(normalized)
  const nextTokens: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!isWordToken(token)) {
      nextTokens.push(token)
      continue
    }

    const spaceToken = tokens[index + 1]
    const nextWordToken = tokens[index + 2]
    if (
      typeof spaceToken === 'string' &&
      /^\s+$/u.test(spaceToken) &&
      typeof nextWordToken === 'string' &&
      isWordToken(nextWordToken)
    ) {
      const pairSource = `${token}${nextWordToken}`
      const pairCandidate = findBestDomainMatch(pairSource, locale, 'pair')
      if (pairCandidate) {
        nextTokens.push(preserveTokenCase(token, pairCandidate))
        index += 2
        continue
      }
    }

    if (!shouldConsiderSingleTokenCorrection(token, locale)) {
      nextTokens.push(token)
      continue
    }

    const singleCandidate = findBestDomainMatch(token, locale, 'single')
    nextTokens.push(singleCandidate ? preserveTokenCase(token, singleCandidate) : token)
  }

  return normalizeWhitespace(nextTokens.join(''))
}
