const BASE_TEXT = {
  pl: 'Celem sesji jest uporządkowanie surowego pomysłu w spójną koncepcję produktu lub usługi poprzez zadawanie właściwych pytań, zmianę perspektywy i świadome decyzje — zanim pojawią się kosztowne rozwiązania.',
  en: 'The goal of this session is to turn a raw idea into a coherent product or service concept by asking the right questions, shifting perspectives, and making deliberate decisions — before costly solutions appear.',
}

const STOPWORDS = {
  pl: new Set([
    'sesja',
    'warsztat',
    'warsztaty',
    'spotkanie',
    'spotkanie',
    'test',
    'demo',
    'sprint',
    'mvp',
    'przegląd',
    'retrospektywa',
    'retrospekcja',
    'planowanie',
    'kickoff',
    'kick-off',
  ]),
  en: new Set([
    'session',
    'workshop',
    'meeting',
    'test',
    'demo',
    'sprint',
    'mvp',
    'review',
    'retro',
    'retrospective',
    'planning',
    'kickoff',
    'kick-off',
  ]),
}

const hasLetter = (value: string) => /[a-zA-ZąćęłńóśżźĄĆĘŁŃÓŚŻŹ]/.test(value)

const isDateLike = (value: string) =>
  /^(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4}|\d{4})$/.test(value)

const isVersionLike = (value: string) => /^v\d+(\.\d+)*$/i.test(value)

const isUrlOrEmail = (value: string) => /https?:\/\/|www\.|@/.test(value)

const normalizeToken = (token: string) => token.replace(/^['"“”()\[\]{}]+|['"“”()\[\]{}]+$/g, '')

export const extractProductNameFromSessionName = (
  sessionName: string,
  lang: 'pl' | 'en'
): string | null => {
  const raw = String(sessionName || '').trim()
  if (!raw) return null

  if (isUrlOrEmail(raw)) return null

  const cleaned = raw
    .replace(/[:|/\\]+/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = cleaned
    .split(' ')
    .map((token) => normalizeToken(token))
    .filter(Boolean)
    .filter((token) => !isDateLike(token))
    .filter((token) => !isVersionLike(token))
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOPWORDS[lang].has(token.toLowerCase()))

  if (!tokens.length) return null

  const candidate = tokens.join(' ').trim()
  if (!candidate) return null
  if (candidate.length > 40) return null
  if (!hasLetter(candidate)) return null
  if (isUrlOrEmail(candidate)) return null

  return candidate
}

export const buildSessionGoalText = ({
  lang,
  productName,
}: {
  lang: 'pl' | 'en'
  productName?: string | null
}): string => {
  const base = BASE_TEXT[lang]
  if (!productName) return base

  const injected =
    lang === 'pl'
      ? base.replace(
          'surowego pomysłu',
          `surowego pomysłu dotyczącego produktu „${productName}”`
        )
      : base.replace('a raw idea', `the raw idea for “${productName}”`)

  if (injected.length > (lang === 'pl' ? 280 : 260)) return base

  return injected
}
