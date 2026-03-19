import { apiFetch } from './apiFetch'
import {
  cleanFinalSpeechTranscriptSegment,
  correctTranscriptWithDomainVocabulary,
  type SpeechCleanupLocale,
} from './speechTranscript'

export type SpeechTranscriptInterpretResult = {
  text: string
  meta?: unknown
}

const BASIC_WORDS: Record<SpeechCleanupLocale, Set<string>> = {
  pl: new Set([
    'a', 'aby', 'albo', 'ale', 'analiza', 'analizy', 'aplikacja', 'bardzo', 'bedzie', 'będzie',
    'bo', 'by', 'byc', 'być', 'dla', 'do', 'duzo', 'dużo', 'faza', 'generowanie', 'gdzie',
    'i', 'ich', 'idea', 'informacje', 'jest', 'jego', 'jej', 'jako', 'kontekst', 'klient',
    'ma', 'mam', 'mamy', 'mnie', 'montaz', 'montaż', 'na', 'nad', 'nie', 'nowego', 'nowy',
    'o', 'od', 'opis', 'perspektywa', 'perspektywy', 'pomysl', 'pomysł', 'pomyslu', 'pomysłu',
    'problem', 'problemu', 'proces', 'produkt', 'projekt', 'przez', 'raport', 'rekomendacje',
    'rozwiazanie', 'rozwiązanie', 'rynek', 'sesja', 'system', 'tablica', 'tekst', 'to', 'tworzenie',
    'uzytkownik', 'użytkownik', 'usluga', 'usługa', 'uslugi', 'usługi', 'w', 'we', 'wpis', 'wpisy',
    'z', 'za', 'ze'
  ]),
  en: new Set([
    'a', 'an', 'and', 'analysis', 'app', 'application', 'as', 'be', 'board', 'context', 'customer',
    'development', 'entry', 'for', 'from', 'idea', 'ideas', 'in', 'into', 'is', 'it', 'market',
    'modern', 'note', 'notes', 'of', 'on', 'or', 'problem', 'process', 'product', 'recommendation',
    'report', 'service', 'session', 'should', 'solution', 'text', 'that', 'the', 'this', 'to',
    'too', 'user', 'very', 'with'
  ]),
}

const normalizeText = (value: string) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s])/g, '$1 ')
    .trim()

const hasPunctuation = (value: string) => /[.!?,;:]/.test(value)

const looksLikeSingleLongRun = (value: string) => {
  const words = value.split(/\s+/).filter(Boolean)
  return words.length >= 10 && !/[.!?]/.test(value)
}

const hasSuspiciousWords = (value: string, locale: SpeechCleanupLocale) => {
  const dictionary = BASIC_WORDS[locale]
  const words = value
    .toLowerCase()
    .match(/\p{L}+/gu)
    ?.filter(Boolean) ?? []
  return words.some((word) => word.length >= 8 && !dictionary.has(word))
}

const shouldInterpretWithLlm = (value: string, locale: SpeechCleanupLocale) => {
  if (value.length > 25) return true
  if (!hasPunctuation(value) && value.split(/\s+/).length >= 5) return true
  if (looksLikeSingleLongRun(value)) return true
  if (hasSuspiciousWords(value, locale)) return true
  return false
}

export const interpretSpeechTranscript = async ({
  text,
  locale,
  aiSupportEnabled,
  sessionId,
  boardContext = [],
}: {
  text: string
  locale: SpeechCleanupLocale
  aiSupportEnabled: boolean
  sessionId?: string | null
  boardContext?: string[]
}): Promise<SpeechTranscriptInterpretResult> => {
  const cleanedText = cleanFinalSpeechTranscriptSegment(text, locale)
  if (!cleanedText) return { text: '' }
  const fuzziedText = correctTranscriptWithDomainVocabulary(cleanedText, locale)
  const normalizedText = normalizeText(fuzziedText || cleanedText)
  if (!shouldInterpretWithLlm(normalizedText, locale)) {
    return { text: normalizedText }
  }

  try {
    const response = await apiFetch('/api/coach?action=suggest', {
      method: 'POST',
      headers: {
        'x-ai-support': aiSupportEnabled ? 'on' : 'off',
      },
      body: JSON.stringify({
        sessionId: sessionId || null,
        action: 'interpret_transcript',
        text: normalizedText,
        locale,
        boardContext: boardContext
          .map((entry) => normalizeText(entry))
          .filter(Boolean)
          .slice(0, 8),
      }),
    })
    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean
          text?: string | null
          meta?: unknown
        }
      | null
    if (!response.ok || !payload?.ok) return { text: normalizedText }
    const interpretedText = String(payload?.text || '').trim()
    return {
      text: interpretedText || normalizedText,
      meta: payload?.meta,
    }
  } catch {
    return { text: normalizedText }
  }
}
