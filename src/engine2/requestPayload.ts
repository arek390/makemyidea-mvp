export const ENGINE2_API_CONTRACT_VERSION = 1
export type Engine2RequestLanguage = 'pl' | 'en'

export type Engine2SelectedQuestion = {
  id: string
  question: string
}

export type Engine2ReplyTargetSource = 'explicit_composer' | 'active_ask_now' | 'none'

export const resolveEngine2EffectiveReplyTarget = ({
  explicitComposerReplyTargetId,
  activeQuestionId,
  openQuestions,
}: {
  explicitComposerReplyTargetId: string | null
  activeQuestionId: string | null
  openQuestions: Engine2OpenQuestionPayload[]
}): { question: Engine2OpenQuestionPayload | null; source: Engine2ReplyTargetSource } => {
  void activeQuestionId
  const explicit = explicitComposerReplyTargetId
    ? openQuestions.find((entry) => entry.id === explicitComposerReplyTargetId && (entry.status ?? 'open') === 'open')
    : null
  if (explicit) return { question: explicit, source: 'explicit_composer' }

  return { question: null, source: 'none' }
}

export type Engine2OpenQuestionPayload = {
  id: string
  semanticKey?: string
  question: string
  intent?: string
  status?: 'open' | 'answered' | 'covered' | 'obsolete' | 'dismissed' | 'superseded' | 'resolved' | 'retired' | 'skipped' | 'replaced' | 'backlog'
  presentation?: 'ask_now' | 'ask_later' | 'panel' | 'hidden'
  createdFromMessageId?: string | null
  askedCount?: number
  lastAskedAt?: string | null
  answeredByMessageIds?: string[]
  coveredByFindingIds?: string[]
  groundedInFindingIds?: string[]
  targetType?: 'contradiction_probe' | 'observation' | 'priority' | 'boundary' | 'usage_example' | 'success_test' | null
  targetContradictionId?: string | null
  priorityReason?: string | null
}

export type Engine2RequestMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  questionId?: string | null
  replyToQuestionId?: string | null
  replyToQuestionText?: string | null
  replyTargetSource?: Engine2ReplyTargetSource
}

type Engine2RequestFinding = Record<string, unknown>

type Engine2AnalyzeBodyParams = {
  trialId: string
  turnId: string
  language: Engine2RequestLanguage
  messageId: string
  messageContent: string
  history: Engine2RequestMessage[]
  findings: Engine2RequestFinding[]
  rejectedFingerprints: string[]
  successfulTrialTurns: number
  successfulTurnMessageIds: string[]
  providerCalls: number
  selectedQuestion?: Engine2SelectedQuestion | null
  replyToGapId?: string | null
  replyTargetSource?: Engine2ReplyTargetSource
  activeQuestionGapId?: string | null
  openQuestions?: Engine2OpenQuestionPayload[]
  questionHistory?: Engine2OpenQuestionPayload[]
  readiness?: Record<string, unknown> | null
  materialReadiness?: Record<string, unknown> | null
  reportReadiness?: Record<string, unknown> | null
  reportAvailable?: boolean
  contradictions?: Array<Record<string, unknown>>
  findingEvents?: Array<Record<string, unknown>>
  questionEvents?: Array<Record<string, unknown>>
  pendingDecisionPackageId?: string | null
  questionLedgerMigrationVersion?: string
  pendingQuestionTransition?: Record<string, unknown> | null
  guidanceForNextQuestions?: string | null
}

export const createEngine2UserMessage = ({
  id,
  content,
  replyToQuestionId = null,
  replyToQuestionText = null,
  replyTargetSource = 'none',
}: {
  id: string
  content: string
  replyToQuestionId?: string | null
  replyToQuestionText?: string | null
  replyTargetSource?: Engine2ReplyTargetSource
}): Engine2RequestMessage => ({
  id,
  role: 'user',
  content,
  ...(replyToQuestionId && replyToQuestionText
    ? { replyToQuestionId, replyToQuestionText, replyTargetSource }
    : {}),
})

export const toEngine2HistoryPayload = (messages: Engine2RequestMessage[]) =>
  messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.questionId ? { questionId: message.questionId } : {}),
    ...(message.replyToQuestionId ? { replyToQuestionId: message.replyToQuestionId } : {}),
    ...(message.replyToQuestionText ? { replyToQuestionText: message.replyToQuestionText } : {}),
    ...(message.replyTargetSource ? { replyTargetSource: message.replyTargetSource } : {}),
  }))

export const buildAnalyzeMessageRequestBody = ({
  trialId,
  turnId,
  language,
  messageId,
  messageContent,
  history,
  findings,
  rejectedFingerprints,
  successfulTrialTurns,
  successfulTurnMessageIds,
  providerCalls,
  selectedQuestion = null,
  replyToGapId = null,
  replyTargetSource = replyToGapId ? 'explicit_composer' : 'none',
  activeQuestionGapId = null,
  openQuestions = [],
  questionHistory = [],
  readiness = null,
  materialReadiness = null,
  reportReadiness = null,
  reportAvailable = false,
  contradictions = [],
  findingEvents = [],
  questionEvents = [],
  pendingDecisionPackageId = null,
  questionLedgerMigrationVersion = 'engine2.questions.panel-candidates.v2',
  pendingQuestionTransition = null,
  guidanceForNextQuestions = null,
}: Engine2AnalyzeBodyParams) => ({
  version: ENGINE2_API_CONTRACT_VERSION,
  action: 'analyze_message',
  trialId,
  turnId,
  language,
  message: { id: messageId, content: messageContent },
  history: toEngine2HistoryPayload(history),
  findings,
  rejectedFingerprints,
  ...(replyToGapId ? { replyToGapId } : {}),
  replyTargetSource,
  ...(activeQuestionGapId ? { activeQuestionGapId } : {}),
  ...(selectedQuestion
    ? {
        selectedQuestion: {
          id: selectedQuestion.id,
          question: selectedQuestion.question,
        },
      }
    : {}),
  openQuestions: Array.isArray(openQuestions)
    ? openQuestions.map((entry) => ({
        id: entry.id,
        ...(entry.semanticKey ? { semanticKey: entry.semanticKey } : {}),
        question: entry.question,
        ...(entry.intent ? { intent: entry.intent } : {}),
        ...(entry.status ? { status: entry.status } : {}),
        ...(entry.presentation ? { presentation: entry.presentation } : {}),
        ...(entry.createdFromMessageId ? { createdFromMessageId: entry.createdFromMessageId } : {}),
        ...(Number(entry.askedCount || 0) > 0 ? { askedCount: Number(entry.askedCount) } : {}),
        ...(entry.lastAskedAt ? { lastAskedAt: entry.lastAskedAt } : {}),
        ...(entry.answeredByMessageIds ? { answeredByMessageIds: entry.answeredByMessageIds } : {}),
        ...(entry.coveredByFindingIds ? { coveredByFindingIds: entry.coveredByFindingIds } : {}),
        ...(entry.groundedInFindingIds ? { groundedInFindingIds: entry.groundedInFindingIds } : {}),
        ...(entry.targetType ? { targetType: entry.targetType } : {}),
        ...(entry.targetContradictionId ? { targetContradictionId: entry.targetContradictionId } : {}),
        ...(entry.priorityReason ? { priorityReason: entry.priorityReason } : {}),
      }))
    : [],
  questionHistory,
  readiness,
  materialReadiness,
  reportReadiness,
  reportAvailable,
  sessionSnapshot: {
    schemaVersion: 'engine2.session.v5',
    conversation: toEngine2HistoryPayload(history),
    findings,
    findingEvents,
    contradictions,
    questions: questionHistory,
    questionEvents,
    rejectedFingerprints,
    readiness: reportReadiness ?? readiness,
    activeQuestionId: activeQuestionGapId,
    questionLedgerMigrationVersion,
    pendingDecisionPackageId,
    pendingQuestionTransition,
    guidanceForNextQuestions,
    trialCounters: { successfulTrialTurns, successfulTurnMessageIds, providerCalls },
  },
  trialCounters: { successfulTrialTurns, successfulTurnMessageIds, providerCalls },
})

export const buildRetryAnalyzeRequestBody = ({
  trialId,
  turnId,
  language,
  retryMessageId,
  retryMessageContent,
  history,
  findings,
  rejectedFingerprints,
  successfulTrialTurns,
  successfulTurnMessageIds,
  providerCalls,
  selectedQuestion = null,
  replyToGapId = null,
  replyTargetSource = replyToGapId ? 'explicit_composer' : 'none',
  activeQuestionGapId = null,
  openQuestions = [],
  questionHistory = [],
  readiness = null,
  materialReadiness = null,
  reportReadiness = null,
  reportAvailable = false,
  contradictions = [],
  findingEvents = [],
  questionEvents = [],
  pendingDecisionPackageId = null,
  questionLedgerMigrationVersion = 'engine2.questions.panel-candidates.v2',
  pendingQuestionTransition = null,
  guidanceForNextQuestions = null,
}: {
  trialId: string
  turnId: string
  language: Engine2RequestLanguage
  retryMessageId: string
  retryMessageContent: string
  history: Engine2RequestMessage[]
  findings: Engine2RequestFinding[]
  rejectedFingerprints: string[]
  successfulTrialTurns: number
  successfulTurnMessageIds: string[]
  providerCalls: number
  selectedQuestion?: Engine2SelectedQuestion | null
  replyToGapId?: string | null
  replyTargetSource?: Engine2ReplyTargetSource
  activeQuestionGapId?: string | null
  openQuestions?: Engine2OpenQuestionPayload[]
  questionHistory?: Engine2OpenQuestionPayload[]
  readiness?: Record<string, unknown> | null
  materialReadiness?: Record<string, unknown> | null
  reportReadiness?: Record<string, unknown> | null
  reportAvailable?: boolean
  contradictions?: Array<Record<string, unknown>>
  findingEvents?: Array<Record<string, unknown>>
  questionEvents?: Array<Record<string, unknown>>
  pendingDecisionPackageId?: string | null
  questionLedgerMigrationVersion?: string
  pendingQuestionTransition?: Record<string, unknown> | null
  guidanceForNextQuestions?: string | null
}) =>
  buildAnalyzeMessageRequestBody({
    trialId,
    turnId,
    language,
    messageId: retryMessageId,
    messageContent: retryMessageContent,
    history,
    findings,
    rejectedFingerprints,
    successfulTrialTurns,
    successfulTurnMessageIds,
    providerCalls,
    selectedQuestion,
    replyToGapId,
    replyTargetSource,
    activeQuestionGapId,
    openQuestions,
    questionHistory,
    readiness,
    materialReadiness,
    reportReadiness,
    reportAvailable,
  contradictions,
  findingEvents,
  questionEvents,
  pendingDecisionPackageId,
  questionLedgerMigrationVersion,
  pendingQuestionTransition,
  guidanceForNextQuestions,
  })
