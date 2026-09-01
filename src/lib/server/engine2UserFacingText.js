export const ENGINE2_CONTRADICTION_STATUSES = Object.freeze([
  'suspected',
  'open',
  'confirmed',
  'active',
  'resolved',
  'dismissed',
  'superseded',
])

export const ENGINE2_OPEN_CONTRADICTION_STATUSES = Object.freeze([
  'suspected',
  'open',
  'confirmed',
  'active',
])

const normalizeText = (value, max = 0) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return max > 0 ? text.slice(0, max) : text
}

const ENGLISH_PHRASE_RE = /\b(user wants|user needs|user expects|what features|what risks|what decisions|what else|how will you measure|which is more important|do you want|does (it|the|this)|should (it|the|this)|need(s)? to)\b/i
const ENGLISH_WORD_RE = /\b(the|and|or|for|with|without|need|needs|want|wants|should|would|could|will|features?|constraints?|requirements?|risks?|decisions?|measure|important|priority|battery|brightness|computer|repair|desk)\b/gi
const THIRD_PERSON_USER_RE = /^\s*((użytkownik|klient|osoba)\s+(chce|potrzebuje|oczekuje|ma|musi|potwierdził|potwierdza|wskazał|wskazuje|wybrał|wybiera|preferuje|proponuje|nie\s+chce)|użytkownikowi\s+zależy)\b/i
const GENERIC_QUESTION_RE = /\b(jakie\s+(konkretne\s+)?(cechy|funkcje|oczekiwania|ograniczenia)|cech\s+i\s+funkcji|cechy\s+i\s+funkcje|ryzyka|decyzje|kryteria\s+sukcesu|co\s+jeszcze|jak\s+będziesz\s+mierzyć|jak\s+zmierzysz|what\s+(features|risks|decisions|constraints|else)|how\s+will\s+you\s+measure)\b/i

export const isLikelyEnglishUserFacingText = (value) => {
  const text = normalizeText(value)
  if (!text) return false
  if (ENGLISH_PHRASE_RE.test(text)) return true
  const matches = text.match(ENGLISH_WORD_RE) || []
  return new Set(matches.map((entry) => entry.toLowerCase())).size >= 2
}

export const isGenericEngine2QuestionText = (value) => GENERIC_QUESTION_RE.test(normalizeText(value))

export const validatePolishUserFacingText = ({
  value,
  path,
  errors,
  language = 'pl',
  allowThirdPerson = false,
  question = false,
}) => {
  const text = normalizeText(value)
  if (!text || language !== 'pl') return
  if (isLikelyEnglishUserFacingText(text)) {
    errors.push(`${path} must be Polish user-facing text; repair by translating this string only without changing IDs or meaning`)
  }
  if (!allowThirdPerson && THIRD_PERSON_USER_RE.test(text)) {
    errors.push(`${path} must address the user directly in Polish, for example "Chcesz..." or "Potrzebujesz...", not "Użytkownik chce..."`)
  }
  if (question && isGenericEngine2QuestionText(text)) {
    errors.push(`${path} is too generic; ask one concrete grounded decision, observation, constraint or tension`)
  }
}

export const directPolishDisplayText = (value, { language = 'pl', max = 1200 } = {}) => {
  const text = normalizeText(value, max)
  if (!text || language !== 'pl') return text
  const replacements = [
    [/^użytkownik\s+chce,?\s+aby\s+/i, 'Chcesz, aby '],
    [/^użytkownik\s+chce,?\s+żeby\s+/i, 'Chcesz, żeby '],
    [/^użytkownik\s+nie\s+chce,?\s+aby\s+/i, 'Nie chcesz, aby '],
    [/^użytkownik\s+nie\s+chce,?\s+żeby\s+/i, 'Nie chcesz, żeby '],
    [/^użytkownik\s+nie\s+chce\s+/i, 'Nie chcesz '],
    [/^użytkownik\s+chce\s+/i, 'Chcesz '],
    [/^użytkownik\s+chciałby\s+/i, 'Chcesz '],
    [/^użytkownik\s+chciałaby\s+/i, 'Chcesz '],
    [/^użytkownik\s+potrzebuje\s+/i, 'Potrzebujesz '],
    [/^użytkownik\s+oczekuje\s+/i, 'Oczekujesz '],
    [/^użytkownik\s+musi\s+/i, 'Musisz '],
    [/^użytkownik\s+ma\s+/i, 'Masz '],
    [/^użytkownikowi\s+zależy\s+na\s+/i, 'Zależy Ci na '],
    [/^użytkownik\s+preferuje\s+/i, 'Preferujesz '],
    [/^użytkownik\s+potwierdził,?\s+że\s+/i, 'Potwierdzasz, że '],
    [/^użytkownik\s+potwierdza,?\s+że\s+/i, 'Potwierdzasz, że '],
    [/^użytkownik\s+wskazał,?\s+że\s+/i, 'Wskazujesz, że '],
    [/^użytkownik\s+wskazuje,?\s+że\s+/i, 'Wskazujesz, że '],
    [/^użytkownik\s+wybrał\s+/i, 'Wybierasz '],
    [/^użytkownik\s+wybiera\s+/i, 'Wybierasz '],
    [/^użytkownik\s+proponuje\s+/i, 'Proponujesz '],
  ]
  let direct = text
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(direct)) {
      direct = direct.replace(pattern, replacement)
      break
    }
  }
  return direct
    .replace(/\bgdzie\s+go\s+potrzebuje\b/gi, 'gdzie ich potrzebujesz')
    .replace(/\bgdzie\s+go\s+potrzebujesz\b/gi, 'gdzie ich potrzebujesz')
    .replace(/\bgdzie\s+ich\s+potrzebuje\b/gi, 'gdzie ich potrzebujesz')
    .replace(/\bktórego\s+potrzebuje\b/gi, 'którego potrzebujesz')
}
