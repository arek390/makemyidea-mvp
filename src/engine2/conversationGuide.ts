import type { Engine2Finding } from './findingState'
import { toDirectPolishDisplayText } from './userFacingText'

export const ENGINE2_KNOWLEDGE_SUMMARY_LIMIT = 3

export type Engine2KnowledgeSummaryItem = {
  sourceFindingId: string
  text: string
}

export type Engine2OpenQuestion = {
  id: string
  semanticKey?: string
  question: string
  text?: string
  intent?: string
  status?: 'open' | 'answered' | 'covered' | 'obsolete' | 'dismissed' | 'superseded' | 'resolved' | 'retired' | 'skipped' | 'replaced' | 'backlog'
  presentation?: 'ask_now' | 'ask_later' | 'panel' | 'hidden'
  createdFromMessageId?: string | null
  askedCount?: number
  lastAskedAt?: string | null
  answeredByMessageIds?: string[]
  coveredByFindingIds?: string[]
  groundedInFindingIds?: string[]
  concreteAnchorText?: string | null
  uncertaintyToResolve?: string | null
  userCanAnswerFromExperience?: boolean
  forbiddenGenericCategoryQuestion?: boolean
  targetType?: 'contradiction_probe' | 'observation' | 'priority' | 'boundary' | 'usage_example' | 'success_test' | null
  targetContradictionId?: string | null
  explorationArea?: string | null
  semanticExplorationKey?: string | null
  contradictionHypothesis?: string | null
  matrixInspiration?: string | null
  matrixInspirationIsHypothesis?: boolean
  noveltyReason?: string | null
  diversityReason?: string | null
  whyNotDuplicate?: string | null
  questionPurpose?: string | null
  priorityReason?: string | null
}

const normalizeComparableText = (value: string) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')

const sortFindingsByFreshness = (left: Engine2Finding, right: Engine2Finding) => {
  const leftTime = Date.parse(String(left.updatedAt || ''))
  const rightTime = Date.parse(String(right.updatedAt || ''))
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime
  }
  if (Number.isFinite(rightTime) && !Number.isFinite(leftTime)) return 1
  if (!Number.isFinite(rightTime) && Number.isFinite(leftTime)) return -1
  return 0
}

export const buildKnowledgeSummary = (
  findings: Engine2Finding[],
  maxItems = ENGINE2_KNOWLEDGE_SUMMARY_LIMIT,
): Engine2KnowledgeSummaryItem[] => {
  const confirmed = [...(Array.isArray(findings) ? findings : [])]
    .filter((finding) => finding?.status === 'confirmed' && String(finding.displayText || finding.content || '').trim())
    .sort(sortFindingsByFreshness)
  const seen = new Set<string>()
  const items: Engine2KnowledgeSummaryItem[] = []

  for (const finding of confirmed) {
    const text = toDirectPolishDisplayText(finding.displayText || finding.content)
    const key = normalizeComparableText(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push({
      sourceFindingId: finding.id,
      text,
    })
    if (items.length >= maxItems) break
  }

  return items
}

export const resolveOpenQuestionById = (
  openQuestions: Engine2OpenQuestion[],
  questionId: string | null,
): Engine2OpenQuestion | null => {
  if (!questionId) return null
  return (
    (Array.isArray(openQuestions) ? openQuestions : []).find((entry) => entry.id === questionId) ||
    null
  )
}
