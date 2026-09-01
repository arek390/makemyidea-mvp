import type { Engine2OpenQuestion } from './conversationGuide'
import type { Engine2Finding } from './findingState'

export const ENGINE2_STATE_SCHEMA_VERSION = 'engine2.session.v5' as const
export const ENGINE2_QUESTION_MIGRATION_VERSION = 'engine2.questions.panel-candidates.v2' as const
const LEGACY_ENGINE2_STATE_SCHEMA_VERSIONS = new Set<unknown>([2, 3, 'engine2.session.v3', 'engine2.session.v4'])
const LEGACY_COUNTER_SCHEMA_VERSIONS = new Set<unknown>([2, 3, 'engine2.session.v3'])

export type Engine2Language = 'pl' | 'en'

export type Engine2Readiness = {
  status?: 'not_evaluated' | 'evaluating' | 'evaluated' | 'failed'
  score: number
  materialScore?: number
  reportScore?: number
  criticalMissing?: string[]
  optionalDirections?: string[]
  noAdditionalDirectionsReason?: string | null
  level?: 'weak' | 'ok' | 'strong'
  reportAvailable: boolean
  meaningfulCount?: number
  coverage?: {
    as_is: number
    not_working: number
    should_be: number
  }
  nextTargetArea?: 'as_is' | 'not_working' | 'should_be'
  confirmedCount?: number
  proposalCount?: number
  duplicateCount?: number
  coveredMatrixAreas?: string[]
  missingMatrixAreas?: string[]
  lastEvaluatedAt?: string | null
  evaluationTraceId?: string | null
  error?: unknown
}

export type Engine2Contradiction = {
  id: string
  semanticKey: string
  description: string
  sideA?: string
  sideB?: string
  findingIds: string[]
  messageIds: string[]
  sourceFindingIds?: string[]
  sourceMessageIds?: string[]
  status: 'suspected' | 'open' | 'confirmed' | 'active' | 'resolved' | 'dismissed' | 'superseded'
  reportBlocking: boolean
  firstDetectedAt: string
  updatedAt: string
  resolvedAt?: string | null
  verificationQuestionId?: string | null
  resolutionQuestionId?: string | null
  resolutionFindingIds?: string[]
}

export type Engine2SoftTensionSignal = {
  semanticKey: string
  description: string
  sideA?: string
  sideB?: string
  sourceFindingIds?: string[]
  sourceMessageIds?: string[]
  confidence?: number
  source?: string
  detector?: string
}

export type Engine2LedgerEvent = {
  id: string
  entityId: string
  operation: string
  messageId: string | null
  createdAt: string
  decisionSource?: 'user_accept' | 'user_change' | 'user_reject'
  decisionType?: 'accept' | 'change' | 'reject'
  decisionAt?: string
  findingId?: string
  packageId?: string | null
}

export type Engine2TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  questionId?: string | null
  replyToQuestionId?: string | null
  replyToQuestionText?: string | null
  replyTargetSource?: 'explicit_composer' | 'active_ask_now' | 'none'
}

export type Engine2AdminUsage = {
  trialId: string
  lastCall: {
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    costPln: number
    pricingSource: string | null
  } | null
  totals: {
    successfulTrialTurns: number
    providerCalls: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    costPln: number
    modelUsage: Record<
      string,
      {
        inputTokens: number
        outputTokens: number
        totalTokens: number
        costUsd: number
        costPln: number
        calls: number
      }
    >
  }
}

export type Engine2PersistedState = {
  schemaVersion: typeof ENGINE2_STATE_SCHEMA_VERSION
  trialId: string
  language: Engine2Language
  messages: Engine2TranscriptMessage[]
  conversation: Engine2TranscriptMessage[]
  findings: Engine2Finding[]
  findingEvents: Engine2LedgerEvent[]
  contradictions: Engine2Contradiction[]
  openQuestions: Engine2OpenQuestion[]
  questions: Engine2OpenQuestion[]
  questionHistory: Engine2OpenQuestion[]
  questionEvents: Engine2LedgerEvent[]
  questionLedgerMigrationVersion: typeof ENGINE2_QUESTION_MIGRATION_VERSION
  activeQuestionId: string | null
  guideNotice: string | null
  rejectedFingerprints: string[]
  pendingPackageId: string | null
  pendingDecisionPackageId: string | null
  pendingQuestionTransition: Record<string, unknown> | null
  guidanceForNextQuestions: string | null
  pendingPackageExpectedCount: number
  remindedPackageIds: string[]
  readiness: Engine2Readiness | null
  materialReadiness: Engine2Readiness | null
  reportReadiness: Engine2Readiness | null
  successfulTrialTurns: number
  successfulTurnMessageIds: string[]
  providerCalls: number
  reportAvailable: boolean
  trialEnded: boolean
  contradictionExtractionStatus: 'not_evaluated' | 'evaluated' | 'failed'
  contradictionPipelineStatus: 'none_detected' | 'formal_detected' | 'soft_detected_only' | 'detected_not_registered' | 'failed'
  softTensionSignals: Engine2SoftTensionSignal[]
  softTensionSignalsCount: number
  formalExtractedContradictionCount: number | null
  formalActiveContradictionCount: number | null
  extractedContradictionCount: number | null
  activeContradictionCount: number | null
  resolvedContradictionCount: number | null
  dismissedContradictionCount: number | null
  detectedRawContradictionCount: number | null
  rejectedContradictionCandidateCount: number | null
  appliedContradictionCount: number | null
  lastContradictionEvaluationTraceId: string | null
  lastContradictionEvaluationAt: string | null
  adminUsage: Engine2AdminUsage | null
}

export const createTrialId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `engine2-trial-${crypto.randomUUID()}`
  }
  return `engine2-trial-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const storageKey = (language: Engine2Language) =>
  `engine2-public-trial-v5:${language}`

const legacyStorageKeys = (language: Engine2Language) => [
  `engine2-public-trial-v4:${language}`,
  `engine2-public-trial-v3:${language}`,
  `engine2-public-trial-v2:${language}`,
]

const inferSuccessfulTurnMessageIds = (messages: Engine2PersistedState['messages']) => {
  const successfulIds: string[] = []
  let pendingUserId: string | null = null
  for (const message of messages) {
    if (message?.role === 'user' && typeof message.id === 'string') pendingUserId = message.id
    if (message?.role === 'assistant' && pendingUserId) {
      successfulIds.push(pendingUserId)
      pendingUserId = null
    }
  }
  return [...new Set(successfulIds)]
}

const parseOpenQuestion = (entry: unknown): Engine2OpenQuestion | null => {
  if (!entry || typeof entry !== 'object') return null
  if (typeof (entry as { id?: unknown }).id !== 'string') {
    return null
  }
  const raw = entry as {
    id: string
    question?: unknown
    text?: unknown
    status?: unknown
    presentation?: unknown
    createdFromMessageId?: unknown
    askedCount?: unknown
    lastAskedAt?: unknown
    semanticKey?: unknown
    gapKey?: unknown
    intent?: unknown
    answeredByMessageIds?: unknown
    coveredByFindingIds?: unknown
    groundedInFindingIds?: unknown
    concreteAnchorText?: unknown
    uncertaintyToResolve?: unknown
    userCanAnswerFromExperience?: unknown
    forbiddenGenericCategoryQuestion?: unknown
    targetType?: unknown
    targetContradictionId?: unknown
    priorityReason?: unknown
  }
  const questionText = typeof raw.question === 'string' && raw.question.trim()
    ? raw.question
    : typeof raw.text === 'string' && raw.text.trim()
      ? raw.text
      : ''
  if (!questionText) return null
  const semanticKey = typeof raw.semanticKey === 'string'
    ? raw.semanticKey
    : typeof raw.gapKey === 'string' ? raw.gapKey : undefined
  return {
    id: raw.id,
    ...(semanticKey ? { semanticKey } : {}),
    question: questionText,
    text: questionText,
    ...(typeof raw.intent === 'string' ? { intent: raw.intent } : {}),
    status: ['open', 'answered', 'covered', 'obsolete', 'dismissed', 'superseded', 'resolved', 'retired', 'skipped', 'replaced', 'backlog'].includes(String(raw.status))
      ? raw.status as Engine2OpenQuestion['status']
      : 'open',
    presentation: raw.presentation === 'ask_now' || raw.presentation === 'ask_later' || raw.presentation === 'panel' || raw.presentation === 'hidden'
      ? raw.presentation === 'hidden' ? 'hidden' : 'panel'
      : 'panel',
    ...(typeof raw.createdFromMessageId === 'string' ? { createdFromMessageId: raw.createdFromMessageId } : {}),
    ...(Number.isFinite(Number(raw.askedCount)) && Number(raw.askedCount) > 0
      ? { askedCount: Math.trunc(Number(raw.askedCount)) }
      : {}),
    ...(typeof raw.lastAskedAt === 'string' ? { lastAskedAt: raw.lastAskedAt } : {}),
    ...(Array.isArray(raw.answeredByMessageIds)
      ? { answeredByMessageIds: raw.answeredByMessageIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    ...(Array.isArray(raw.coveredByFindingIds)
      ? { coveredByFindingIds: raw.coveredByFindingIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    ...(Array.isArray(raw.groundedInFindingIds)
      ? { groundedInFindingIds: raw.groundedInFindingIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    ...(typeof raw.concreteAnchorText === 'string' ? { concreteAnchorText: raw.concreteAnchorText } : {}),
    ...(typeof raw.uncertaintyToResolve === 'string' ? { uncertaintyToResolve: raw.uncertaintyToResolve } : {}),
    ...(typeof raw.userCanAnswerFromExperience === 'boolean' ? { userCanAnswerFromExperience: raw.userCanAnswerFromExperience } : {}),
    ...(typeof raw.forbiddenGenericCategoryQuestion === 'boolean' ? { forbiddenGenericCategoryQuestion: raw.forbiddenGenericCategoryQuestion } : {}),
    ...(['contradiction_probe', 'observation', 'priority', 'boundary', 'usage_example', 'success_test'].includes(String(raw.targetType))
      ? { targetType: raw.targetType as Engine2OpenQuestion['targetType'] }
      : {}),
    ...(typeof raw.targetContradictionId === 'string' ? { targetContradictionId: raw.targetContradictionId } : {}),
    ...(typeof raw.priorityReason === 'string' ? { priorityReason: raw.priorityReason } : {}),
  }
}

const QUESTION_EVENT_STATUS: Record<string, Engine2OpenQuestion['status']> = {
  answer: 'answered',
  answered: 'answered',
  dismiss: 'dismissed',
  skipped: 'skipped',
  replaced: 'replaced',
  supersede: 'superseded',
  reopen: 'open',
}

export const migrateEngine2QuestionState = ({
  questions,
  activeQuestionId,
  questionBacklog = [],
}: {
  questions: Engine2OpenQuestion[]
  activeQuestionId: string | null
  questionBacklog?: Engine2OpenQuestion[]
}) => {
  void activeQuestionId
  const ordered = [...new Map([...(questions || []), ...(questionBacklog || [])].map((question) => [question.id, question])).values()]
  let panelCount = 0
  const migrated = ordered.map((question) => {
    const isOpen = (question.status ?? 'open') === 'open' || question.status === 'backlog'
    if (!isOpen) return { ...question, presentation: 'hidden' as const }
    if (panelCount < 3) {
      panelCount += 1
      return { ...question, status: 'open' as const, presentation: 'panel' as const }
    }
    return { ...question, status: 'open' as const, presentation: 'hidden' as const }
  })
  const openQuestions = migrated.filter((question) => question.status === 'open' && question.presentation === 'panel').slice(0, 3)
  return {
    questions: migrated,
    activeQuestionId: null,
    openQuestions,
    questionLedgerMigrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
  }
}

export const reconcileEngine2QuestionsFromEvents = (
  questions: Engine2OpenQuestion[],
  questionEvents: Engine2LedgerEvent[],
): Engine2OpenQuestion[] => {
  const statusByQuestionId = new Map<string, Engine2OpenQuestion['status']>()
  const orderedEvents = (Array.isArray(questionEvents) ? questionEvents : [])
    .map((event, index) => ({ event, index, time: Date.parse(String(event?.createdAt || '')) }))
    .sort((left, right) => Number.isFinite(left.time) && Number.isFinite(right.time) && left.time !== right.time
      ? left.time - right.time
      : left.index - right.index)
  for (const { event } of orderedEvents) {
    const status = QUESTION_EVENT_STATUS[event?.operation]
    if (typeof event?.entityId === 'string' && status) statusByQuestionId.set(event.entityId, status)
  }
  return questions.map((question) => {
    const status = statusByQuestionId.get(question.id) || question.status || 'open'
    return {
      ...question,
      status,
      presentation: status === 'open' ? question.presentation || 'panel' : 'hidden',
    }
  })
}

export const safeParseState = (language: Engine2Language): Engine2PersistedState | null => {
  if (typeof window === 'undefined') return null
  try {
    const currentRaw = window.sessionStorage.getItem(storageKey(language))
    const legacyRaw = legacyStorageKeys(language)
      .map((key) => window.sessionStorage.getItem(key))
      .find((value) => value !== null)
    const raw = currentRaw ?? legacyRaw
    if (!raw) return null
    const parsed = JSON.parse(raw) as (Partial<Engine2PersistedState> & {
      aiCallsUsed?: number
      questionBacklog?: Engine2OpenQuestion[]
    }) | null
    const isLegacy = LEGACY_ENGINE2_STATE_SCHEMA_VERSIONS.has(parsed?.schemaVersion)
    const usesLegacyCounters = LEGACY_COUNTER_SCHEMA_VERSIONS.has(parsed?.schemaVersion)
    if (!parsed || (!isLegacy && parsed.schemaVersion !== ENGINE2_STATE_SCHEMA_VERSION) || parsed.language !== language) {
      return null
    }
    const messages = Array.isArray(parsed.conversation)
      ? parsed.conversation
      : Array.isArray(parsed.messages) ? parsed.messages : []
    const storedSuccessfulIds = Array.isArray(parsed.successfulTurnMessageIds)
      ? parsed.successfulTurnMessageIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : []
    const successfulTurnMessageIds = usesLegacyCounters
      ? inferSuccessfulTurnMessageIds(messages)
      : [...new Set(storedSuccessfulIds)]
    const successfulTrialTurns = usesLegacyCounters
      ? successfulTurnMessageIds.length
      : Math.max(
          successfulTurnMessageIds.length,
          Number.isFinite(Number(parsed.successfulTrialTurns)) ? Math.max(0, Number(parsed.successfulTrialTurns)) : 0
        )
    const providerCalls = usesLegacyCounters
      ? Math.max(0, Number(parsed.aiCallsUsed || 0))
      : Number.isFinite(Number(parsed.providerCalls)) ? Math.max(0, Number(parsed.providerCalls)) : 0
    const findings = Array.isArray(parsed.findings) ? parsed.findings : []
    const parsedPendingPackageId = typeof parsed.pendingPackageId === 'string' ? parsed.pendingPackageId : null
    const parsedPendingDecisionPackageId = typeof parsed.pendingDecisionPackageId === 'string' ? parsed.pendingDecisionPackageId : null
    const pendingPackageId = parsedPendingPackageId || parsedPendingDecisionPackageId
    const packageFindings = pendingPackageId
      ? findings.filter(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            entry.packageId === pendingPackageId
        )
      : []
    const hasPackageFindings = packageFindings.length > 0
    const rawQuestions = Array.isArray(parsed.questions)
      ? parsed.questions
      : [...(Array.isArray(parsed.questionHistory) ? parsed.questionHistory : []), ...(Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [])]
    const parsedQuestions = [...new Map(rawQuestions
      .map(parseOpenQuestion)
      .filter((entry): entry is Engine2OpenQuestion => entry !== null)
      .map((entry) => [entry.id, entry])).values()]
    const questionEvents = Array.isArray(parsed.questionEvents) ? parsed.questionEvents : []
    const reconciledQuestions = reconcileEngine2QuestionsFromEvents(parsedQuestions, questionEvents)
    const questionState = migrateEngine2QuestionState({
      questions: reconciledQuestions,
      activeQuestionId: typeof parsed.activeQuestionId === 'string' ? parsed.activeQuestionId : null,
      questionBacklog: Array.isArray(parsed.questionBacklog) ? parsed.questionBacklog : [],
    })
    const { questions, openQuestions, activeQuestionId } = questionState
    const parsedReadiness = parsed.reportReadiness ?? parsed.readiness ?? null
    const parsedMaterialReadiness = parsed.materialReadiness ?? (
      parsedReadiness && typeof parsedReadiness === 'object' && Number.isFinite(Number(parsedReadiness.materialScore))
        ? { ...parsedReadiness, score: Number(parsedReadiness.materialScore) }
        : null
    )
    const parsedReportReadiness = parsed.reportReadiness ?? (
      parsedReadiness && typeof parsedReadiness === 'object' && Number.isFinite(Number(parsedReadiness.reportScore ?? parsedReadiness.score))
        ? { ...parsedReadiness, score: Number(parsedReadiness.reportScore ?? parsedReadiness.score) }
        : parsedReadiness
    )
    const state: Engine2PersistedState = {
      schemaVersion: ENGINE2_STATE_SCHEMA_VERSION,
      trialId: typeof parsed.trialId === 'string' && parsed.trialId ? parsed.trialId : createTrialId(),
      language,
      messages,
      conversation: messages,
      findings,
      findingEvents: Array.isArray(parsed.findingEvents) ? parsed.findingEvents : [],
      contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
      openQuestions,
      questions,
      questionHistory: questions,
      questionEvents,
      questionLedgerMigrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
      activeQuestionId,
      guideNotice: typeof parsed.guideNotice === 'string' ? parsed.guideNotice : null,
      rejectedFingerprints: Array.isArray(parsed.rejectedFingerprints) ? parsed.rejectedFingerprints : [],
      pendingPackageId: hasPackageFindings ? pendingPackageId : null,
      pendingDecisionPackageId: hasPackageFindings ? pendingPackageId : null,
      pendingQuestionTransition: hasPackageFindings && parsed.pendingQuestionTransition && typeof parsed.pendingQuestionTransition === 'object'
        ? parsed.pendingQuestionTransition
        : null,
      guidanceForNextQuestions: typeof parsed.guidanceForNextQuestions === 'string' ? parsed.guidanceForNextQuestions : null,
      pendingPackageExpectedCount: Number.isFinite(Number(parsed.pendingPackageExpectedCount))
        ? hasPackageFindings
          ? Math.max(0, Math.trunc(Number(parsed.pendingPackageExpectedCount)))
          : 0
        : hasPackageFindings ? packageFindings.length : 0,
      remindedPackageIds: Array.isArray(parsed.remindedPackageIds) ? parsed.remindedPackageIds : [],
      readiness: parsedReadiness,
      materialReadiness: parsedMaterialReadiness,
      reportReadiness: parsedReportReadiness,
      successfulTrialTurns,
      successfulTurnMessageIds,
      providerCalls,
      reportAvailable: Boolean(parsed.reportAvailable),
      trialEnded: Boolean(parsed.trialEnded) && !(
        usesLegacyCounters && providerCalls >= 10 && successfulTrialTurns < 30 && !parsed.reportAvailable
      ),
      contradictionExtractionStatus: ['not_evaluated', 'evaluated', 'failed'].includes(String(parsed.contradictionExtractionStatus))
        ? parsed.contradictionExtractionStatus as Engine2PersistedState['contradictionExtractionStatus']
        : 'not_evaluated',
      contradictionPipelineStatus: ['none_detected', 'formal_detected', 'soft_detected_only', 'detected_not_registered', 'failed'].includes(String(parsed.contradictionPipelineStatus))
        ? parsed.contradictionPipelineStatus as Engine2PersistedState['contradictionPipelineStatus']
        : 'none_detected',
      softTensionSignals: Array.isArray(parsed.softTensionSignals) ? parsed.softTensionSignals as Engine2SoftTensionSignal[] : [],
      softTensionSignalsCount: Number.isFinite(Number(parsed.softTensionSignalsCount)) ? Number(parsed.softTensionSignalsCount) : 0,
      formalExtractedContradictionCount: Number.isFinite(Number(parsed.formalExtractedContradictionCount)) ? Number(parsed.formalExtractedContradictionCount) : null,
      formalActiveContradictionCount: Number.isFinite(Number(parsed.formalActiveContradictionCount)) ? Number(parsed.formalActiveContradictionCount) : null,
      extractedContradictionCount: Number.isFinite(Number(parsed.extractedContradictionCount)) ? Number(parsed.extractedContradictionCount) : null,
      activeContradictionCount: Number.isFinite(Number(parsed.activeContradictionCount)) ? Number(parsed.activeContradictionCount) : null,
      resolvedContradictionCount: Number.isFinite(Number(parsed.resolvedContradictionCount)) ? Number(parsed.resolvedContradictionCount) : null,
      dismissedContradictionCount: Number.isFinite(Number(parsed.dismissedContradictionCount)) ? Number(parsed.dismissedContradictionCount) : null,
      detectedRawContradictionCount: Number.isFinite(Number(parsed.detectedRawContradictionCount)) ? Number(parsed.detectedRawContradictionCount) : null,
      rejectedContradictionCandidateCount: Number.isFinite(Number(parsed.rejectedContradictionCandidateCount)) ? Number(parsed.rejectedContradictionCandidateCount) : null,
      appliedContradictionCount: Number.isFinite(Number(parsed.appliedContradictionCount)) ? Number(parsed.appliedContradictionCount) : null,
      lastContradictionEvaluationTraceId: typeof parsed.lastContradictionEvaluationTraceId === 'string' ? parsed.lastContradictionEvaluationTraceId : null,
      lastContradictionEvaluationAt: typeof parsed.lastContradictionEvaluationAt === 'string' ? parsed.lastContradictionEvaluationAt : null,
      adminUsage: parsed.adminUsage ?? null,
    }
    window.sessionStorage.setItem(storageKey(language), JSON.stringify(state))
    return state
  } catch {
    return null
  }
}

export const createInitialState = (language: Engine2Language): Engine2PersistedState =>
  safeParseState(language) ?? createEmptyState(language)

export const createEmptyState = (language: Engine2Language): Engine2PersistedState => ({
  schemaVersion: ENGINE2_STATE_SCHEMA_VERSION,
  trialId: createTrialId(),
  language,
  messages: [],
  conversation: [],
  findings: [],
  findingEvents: [],
  contradictions: [],
  openQuestions: [],
  questions: [],
  questionHistory: [],
  questionEvents: [],
  questionLedgerMigrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
  activeQuestionId: null,
  guideNotice: null,
  rejectedFingerprints: [],
  pendingPackageId: null,
  pendingDecisionPackageId: null,
  pendingQuestionTransition: null,
  guidanceForNextQuestions: null,
  pendingPackageExpectedCount: 0,
  remindedPackageIds: [],
  readiness: null,
  materialReadiness: null,
  reportReadiness: null,
  successfulTrialTurns: 0,
  successfulTurnMessageIds: [],
  providerCalls: 0,
  reportAvailable: false,
  trialEnded: false,
  contradictionExtractionStatus: 'not_evaluated',
  contradictionPipelineStatus: 'none_detected',
  softTensionSignals: [],
  softTensionSignalsCount: 0,
  formalExtractedContradictionCount: null,
  formalActiveContradictionCount: null,
  extractedContradictionCount: null,
  activeContradictionCount: null,
  resolvedContradictionCount: null,
  dismissedContradictionCount: null,
  detectedRawContradictionCount: null,
  rejectedContradictionCandidateCount: null,
  appliedContradictionCount: null,
  lastContradictionEvaluationTraceId: null,
  lastContradictionEvaluationAt: null,
  adminUsage: null,
})
