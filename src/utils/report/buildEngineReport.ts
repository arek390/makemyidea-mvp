import type { EngineBoardItem, EngineSessionSummary } from '../../storage/sessionStore'

type QuestionMeta = { group_code?: string; mode_code?: number }

type ReportSessionMeta = {
  sessionId: string
  name: string | null
  createdAt: number | null
  updatedAt: number | null
  author: string | null
  participants: string[]
}

type ReportPerspectiveCell = {
  cellId: string
  visitedCount: number
  questionsCount: number
}

type ReportQuestion = {
  id: string
  cellId: string | null
  finalText: string
  source: 'llm' | 'fallback' | 'unknown'
  timestamp: number | null
}

type ReportIdea = {
  id: string
  text: string
  createdAt: number | null
  tags: string[]
  category: string | null
}

type ReportResponse = {
  questionId: string
  answerText: string
  linkedIdeaIds: string[]
  timestamp: number | null
}

type ReportStats = {
  totals: {
    ideas: number
    questions: number
    cellsVisited: number
    duplicates: number
  }
  perCellCounts: Record<string, number>
}

type ReportInsights = {
  topKeywords: string[]
  duplicates: number
}

type ReportRecommendations = Array<'expand_ideas' | 'explore_perspectives' | 'deduplicate' | 'prioritize'>

type EngineReportModel = {
  sessionMeta: ReportSessionMeta
  goal: string | null
  perspectives: ReportPerspectiveCell[]
  questionsAsked: ReportQuestion[]
  responses: ReportResponse[]
  ideas: ReportIdea[]
  stats: ReportStats
  insights: ReportInsights
  recommendations: ReportRecommendations
}

const STOPWORDS_PL = new Set([
  'oraz',
  'które',
  'ktore',
  'jest',
  'są',
  'sie',
  'się',
  'or',
  'ale',
  'dla',
  'ten',
  'tego',
  'też',
  'tak',
  'nie',
  'jak',
  'czy',
  'jestem',
  'być',
  'będzie',
  'bylo',
  'było',
])

const STOPWORDS_EN = new Set([
  'the',
  'and',
  'with',
  'this',
  'that',
  'from',
  'into',
  'your',
  'you',
  'are',
  'for',
  'not',
  'but',
  'can',
  'our',
  'what',
  'how',
])

const normalizeToken = (value: string) => value.trim().toLowerCase()

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9ąćęłńóśżź]+/i)
    .map((token) => token.trim())
    .filter(Boolean)

const getTopKeywords = (items: string[], language: 'Polish' | 'English') => {
  const stopwords = language === 'Polish' ? STOPWORDS_PL : STOPWORDS_EN
  const counts = new Map<string, number>()
  items
    .flatMap((item) => tokenize(item))
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 4 && !stopwords.has(token))
    .forEach((token) => {
      counts.set(token, (counts.get(token) || 0) + 1)
    })
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([token]) => token)
}

const countDuplicates = (items: string[]) => {
  const seen = new Set<string>()
  let duplicates = 0
  items.forEach((item) => {
    const key = item.trim().toLowerCase()
    if (!key) return
    if (seen.has(key)) {
      duplicates += 1
    } else {
      seen.add(key)
    }
  })
  return duplicates
}

const buildRecommendations = (stats: ReportStats): ReportRecommendations => {
  const recommendations: ReportRecommendations = []
  if (stats.totals.questions > stats.totals.ideas) {
    recommendations.push('expand_ideas')
  }
  if (stats.totals.cellsVisited < 4) {
    recommendations.push('explore_perspectives')
  }
  if (stats.totals.duplicates > 0) {
    recommendations.push('deduplicate')
  }
  if (!recommendations.length) {
    recommendations.push('prioritize')
  }
  return recommendations
}

export const buildEngineReportModel = (input: {
  sessionId: string
  sessionName: string | null
  sessionSummary: EngineSessionSummary | null
  ideas: EngineBoardItem[]
  askedQuestionTexts: string[]
  askedQuestionIds: string[]
  askedQuestionMeta: Record<string, QuestionMeta>
  perCellCounts: Record<string, number>
  language: 'Polish' | 'English'
  lastQuestionSource?: 'llm' | 'fallback' | null
}): EngineReportModel => {
  const sessionMeta: ReportSessionMeta = {
    sessionId: input.sessionId,
    name: input.sessionName || input.sessionSummary?.name || null,
    createdAt: input.sessionSummary?.created_at ?? null,
    updatedAt: input.sessionSummary?.updated_at ?? null,
    author: null,
    participants: [],
  }

  const questionsAsked: ReportQuestion[] = input.askedQuestionTexts.map((text, index) => {
    const id = input.askedQuestionIds[index] || `q-${index + 1}`
    const meta = input.askedQuestionMeta[id]
    const cellId = meta?.group_code && meta?.mode_code ? `${meta.group_code}${meta.mode_code}` : null
    const source =
      index === input.askedQuestionTexts.length - 1 && input.lastQuestionSource
        ? input.lastQuestionSource
        : 'unknown'
    return {
      id,
      cellId,
      finalText: text,
      source,
      timestamp: null,
    }
  })

  const ideas: ReportIdea[] = input.ideas.map((item) => ({
    id: item.id,
    text: item.text,
    createdAt: item.created_at ?? null,
    tags: item.label ? [item.label] : [],
    category: item.label ?? null,
  }))

  const cellsVisited = Object.values(input.perCellCounts).filter((count) => count > 0).length
  const duplicates = countDuplicates(ideas.map((idea) => idea.text))

  const stats: ReportStats = {
    totals: {
      ideas: ideas.length,
      questions: questionsAsked.length,
      cellsVisited,
      duplicates,
    },
    perCellCounts: input.perCellCounts,
  }

  const allText = [...ideas.map((idea) => idea.text), ...questionsAsked.map((q) => q.finalText)]
  const insights: ReportInsights = {
    topKeywords: getTopKeywords(allText, input.language),
    duplicates,
  }

  const recommendations = buildRecommendations(stats)

  const perspectives: ReportPerspectiveCell[] = Object.entries(input.perCellCounts).map(
    ([cellId, count]) => ({
      cellId,
      visitedCount: count > 0 ? 1 : 0,
      questionsCount: count,
    })
  )

  return {
    sessionMeta,
    goal: null,
    perspectives,
    questionsAsked,
    responses: [],
    ideas,
    stats,
    insights,
    recommendations,
  }
}

export type { EngineReportModel, ReportQuestion, ReportIdea, ReportResponse }
