import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Engine2FindingCard,
  type Engine2FindingCardCopy,
} from './Engine2FindingCard'
import {
  createEngine2FindingState,
  engine2FindingReducer,
  type Engine2Finding,
} from './findingState'
import {
  buildAnalyzeMessageRequestBody,
  buildRetryAnalyzeRequestBody,
  createEngine2UserMessage,
  ENGINE2_API_CONTRACT_VERSION,
  resolveEngine2EffectiveReplyTarget,
  toEngine2HistoryPayload,
  type Engine2ReplyTargetSource,
  type Engine2RequestMessage,
  type Engine2SelectedQuestion,
} from './requestPayload'
import {
  buildKnowledgeSummary,
  resolveOpenQuestionById,
  type Engine2OpenQuestion,
} from './conversationGuide'
import { resolveEngine2ContinueGate, resolveEngine2PackageStats } from './packageState'
import {
  createEmptyState,
  createInitialState,
  safeParseState,
  storageKey,
  type Engine2AdminUsage,
  type Engine2Language,
  type Engine2PersistedState,
  type Engine2Readiness,
  type Engine2Contradiction,
  type Engine2LedgerEvent,
} from './sessionState'
import {
  canUseEngine2Diagnostics,
  captureEngine2DomSnapshot,
  clearEngine2Diagnostics,
  buildCompactEngine2Diagnostics,
  createFrontendTraceFromApi,
  isEngine2DiagnosticsRequested,
  readEngine2Diagnostics,
  updateFrontendTraceState,
  writeEngine2Diagnostics,
  type Engine2BackendTrace,
  type Engine2FrontendTrace,
} from './diagnostics'
import './Engine2Page.css'
import {
  resolveEngine2ResponseDecision,
  resolveEngine2ResponseFindingState,
  resolveEngine2ResponseQuestionState,
  resolveEngine2ActiveQuestionPresentation,
  resolveEngine2RenderableAssistantMessage,
  resolveEngine2PanelQuestionDisplayState,
} from './responseState'
const ENGINE2_MAX_MESSAGE_CHARS = 2000
const ENGINE2_REQUEST_TIMEOUT_MS = 45_000
const ENGINE2_DECISION_SUBMIT_TIMEOUT_MS = 10_000

type Engine2Message = Engine2RequestMessage

type Engine2MetaState = Omit<Engine2PersistedState, 'messages' | 'findings'>

type Engine2VisibleTension = {
  id: string
  description: string
  sideA?: string
  sideB?: string
  source: 'formal' | 'soft'
}

type Engine2FindingDecision = {
  findingId: string
  type: 'confirm' | 'edit' | 'reject'
  content?: string
}

type Engine2ApiResponse = {
  ok?: boolean
  error?: string
  action?: 'analyze_message' | 'commit_finding_decisions' | 'generate_panel_questions' | 'detect_contradictions' | 'evaluate_readiness'
  turnId?: string | null
  turnKind?: string | null
  assistantMessage?: { id?: string; content?: string; questionId?: string | null }
  assistantAcknowledgement?: string | null
  assistantReply?: { type?: 'silent' | 'acknowledgement' | 'explanation' | 'conversational_response'; text?: string } | null
  activeQuestionPresentation?: { messageId?: string; questionId?: string | null; text?: string; reason?: string } | null
  packageId?: string | null
  findingProposals?: Engine2Finding[]
  findingUpdates?: Engine2Finding[]
  findingEvents?: Engine2LedgerEvent[]
  contradictions?: Engine2Contradiction[]
  rejectedFingerprints?: string[]
  openQuestions?: Engine2OpenQuestion[]
  panelQuestions?: Engine2OpenQuestion[]
  questionHistory?: Engine2OpenQuestion[]
  questions?: Engine2OpenQuestion[]
  questionEvents?: Engine2LedgerEvent[]
  nextQuestionId?: string | null
  guideNotice?: string | null
  readiness?: Engine2Readiness
  materialReadiness?: Engine2Readiness
  reportReadiness?: Engine2Readiness
  reportAvailable?: boolean
  trialEnded?: boolean
  contradictionExtractionStatus?: Engine2MetaState['contradictionExtractionStatus']
  contradictionPipelineStatus?: Engine2MetaState['contradictionPipelineStatus']
  softTensionSignals?: Engine2MetaState['softTensionSignals']
  softTensionSignalsCount?: number
  formalExtractedContradictionCount?: number | null
  formalActiveContradictionCount?: number | null
  extractedContradictionCount?: number | null
  activeContradictionCount?: number | null
  resolvedContradictionCount?: number | null
  dismissedContradictionCount?: number | null
  detectedRawContradictionCount?: number | null
  rejectedContradictionCandidateCount?: number | null
  appliedContradictionCount?: number | null
  lastContradictionEvaluationTraceId?: string | null
  lastContradictionEvaluationAt?: string | null
  contradictionDetectionTriggered?: boolean
  contradictionDetectionTraceId?: string | null
  contradictionDetectionCompleted?: boolean
  contradictionDetectionSkippedReason?: string | null
  contradictionChangesRaw?: unknown[]
  contradictionChangesApplied?: unknown[]
  retryableContradictionDetectionError?: boolean
  limits?: {
    successfulTrialTurns?: number
    successfulTurnLimit?: number
    remainingSuccessfulTurns?: number
    providerCalls?: number
  }
  trialCounters?: {
    successfulTrialTurns?: number
    successfulTurnMessageIds?: string[]
    providerCalls?: number
  }
  admin?: Engine2AdminUsage
  diagnosticCode?: string | null
  notice?: string | null
  retryable?: boolean
  retryMessageId?: string | null
  retryableQuestionGeneration?: boolean
  retryableReadinessError?: boolean
  rawReplyToGapId?: string | null
  effectiveReplyToGapId?: string | null
  replyTargetSource?: Engine2ReplyTargetSource
  engine2Trace?: Engine2BackendTrace
  requestId?: string | null
  stateVersionReturned?: number
  turnApplied?: boolean
  analysisStatus?: 'applied' | 'retryable_error' | 'fatal_error'
  decisionApplied?: boolean
  decisionEvents?: Engine2LedgerEvent[]
  decisionState?: Record<string, unknown> | null
  continueApplied?: boolean
  continueError?: { diagnosticCode?: string; message?: string; retryable?: boolean } | null
  retryableContinueError?: boolean
  awaitingContinueAfterDecision?: boolean
  questionTransition?: { type?: string; outcome?: string } | null
  pendingDecisionPackageId?: string | null
  pendingQuestionTransition?: Record<string, unknown> | null
  sessionSnapshot?: {
    conversation?: Engine2Message[]
    findings?: Engine2Finding[]
    findingEvents?: Engine2LedgerEvent[]
    contradictions?: Engine2Contradiction[]
    questions?: Engine2OpenQuestion[]
    questionEvents?: Engine2LedgerEvent[]
    readiness?: Engine2Readiness
    activeQuestionId?: string | null
    pendingDecisionPackageId?: string | null
    questionLedgerMigrationVersion?: 'engine2.questions.panel-candidates.v2'
    pendingQuestionTransition?: Record<string, unknown> | null
    guidanceForNextQuestions?: string | null
    contradictionExtractionStatus?: Engine2MetaState['contradictionExtractionStatus']
    contradictionPipelineStatus?: Engine2MetaState['contradictionPipelineStatus']
    softTensionSignals?: Engine2MetaState['softTensionSignals']
    softTensionSignalsCount?: number
    formalExtractedContradictionCount?: number | null
    formalActiveContradictionCount?: number | null
    extractedContradictionCount?: number | null
    activeContradictionCount?: number | null
    resolvedContradictionCount?: number | null
    dismissedContradictionCount?: number | null
    detectedRawContradictionCount?: number | null
    rejectedContradictionCandidateCount?: number | null
    appliedContradictionCount?: number | null
    lastContradictionEvaluationTraceId?: string | null
    lastContradictionEvaluationAt?: string | null
  }
}

type Engine2ApplySnapshot = {
  stateVersionBeforeApply: number
  responseDecision: 'applied' | 'ignored_as_stale' | 'not_applied' | 'partial_applied' | 'decision_applied_continue_failed'
  responseStartedAt: string | null
  responseFinishedAt: string | null
  frontendAppliedAt: string
  gapsBeforeApply: Engine2OpenQuestion[]
  nextQuestionBeforeApply: string | null
  activeQuestionBeforeApply: string | null
  stateApplyMode: 'replaced' | 'merged' | 'unchanged'
  replyTargetGapId: string | null
  composerReplyTargetBeforeSubmit: string | null
  composerReplyTargetAfterSubmit: string | null
  inFlightReplyToQuestionId: string | null
  retryReplyToQuestionId: string | null
  replyTargetSource: Engine2ReplyTargetSource
  isAnalyzingFalseAt: string | null
  acceptClickedAt?: string | null
  criticalPathProviderCallsBefore?: number | null
  decisionPackageBefore: {
    packageId: string | null
    expectedProposalCount: number
    packageProposalCount: number
    packagePendingCount: number
    packageResolvedCount: number
    isHydrated: boolean
  }
}

type Engine2RetryTarget = {
  messageId: string
  content: string
  selectedQuestion: Engine2SelectedQuestion | null
  replyToGapId: string | null
  activeQuestionGapId: string | null
  explicitComposerReplyTargetId: string | null
  replyTargetSource: Engine2ReplyTargetSource
  requestSequence: number
  turnId?: string
  requestId?: string
}

type Engine2InFlightTurn = Engine2RetryTarget & { turnId: string; requestId: string }

type Engine2AcceptCriticalPath = {
  acceptClickedAt: string
  providerCallsBefore: number
  packageId: string
  backgroundStarted: boolean
  sourcePayload: Engine2ApiResponse | null
}

export type Engine2Copy = {
  pageLabel: string
  conversationTitle: string
  resetConversationButton: string
  initialAssistantMessage: string
  initialAssistantHint: string
  inputPlaceholder: string
  inputAriaLabel: string
  sendButton: string
  sendingButton: string
  findingsTitle: string
  pendingFindingsTitle: string
  knowledgeTitle: string
  confirmedFindingsTitle: string
  knowledgeEmpty: string
  knowledgeShowMoreAction: string
  knowledgeShowLessAction: string
  openQuestionsTitle: string
  openQuestionsEmpty: string
  openQuestionsWaiting: string
  openQuestionsAnswerAction: string
  selectedQuestionPrefix: string
  answeredQuestionPrefix: string
  clearSelectedQuestionAction: string
  pendingReviewMessage: string
  pendingReviewBadge: string
  blockedSendMessage: string
  confirmAllAction: string
  rejectAllAction: string
  retryAnalysisAction: string
  retryQuestionGenerationAction: string
  progressLabel: string
  reportReadyTitle: string
  reportReadyBody: string
  reportCtaDisabled: string
  trialEndedTitle: string
  trialEndedBody: string
  errorMessage: string
  adminUsageTitle: string
  adminLastCall: string
  adminTotal: string
  adminModel: string
  adminTokens: string
  adminCost: string
  findingCard: Engine2FindingCardCopy
}

type Engine2PageProps = {
  copy: Engine2Copy
  language: Engine2Language
  aiSupportEnabled: boolean
  diagnosticsEnabled: boolean
  getAccessToken?: () => Promise<string>
}

const formatNumber = (value: number, language: Engine2Language, fractionDigits = 0) =>
  new Intl.NumberFormat(language === 'pl' ? 'pl-PL' : 'en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.max(0, Number(value) || 0))

const ENGINE2_ACTIVE_CONTRADICTION_STATUSES = new Set(['suspected', 'open', 'confirmed', 'active'])

const countEngine2Contradictions = (contradictions: Engine2Contradiction[]) => {
  return {
    extracted: contradictions.filter((entry) => !['dismissed', 'superseded'].includes(entry.status)).length,
    active: contradictions.filter((entry) => ENGINE2_ACTIVE_CONTRADICTION_STATUSES.has(entry.status)).length,
    resolved: contradictions.filter((entry) => entry.status === 'resolved').length,
    dismissed: contradictions.filter((entry) => entry.status === 'dismissed').length,
  }
}

const buildEngine2VisibleTensions = (
  contradictions: Engine2Contradiction[],
): Engine2VisibleTension[] => {
  const activeFormalContradictions = contradictions
    .filter((entry) => ENGINE2_ACTIVE_CONTRADICTION_STATUSES.has(entry.status))

  return activeFormalContradictions
    .map((entry) => ({
      id: entry.id,
      description: entry.description,
      sideA: entry.sideA,
      sideB: entry.sideB,
      source: 'formal' as const,
    }))
}

const resolveContradictionExtractionStatus = (
  payload: Engine2ApiResponse,
  current: Engine2MetaState,
): Engine2MetaState['contradictionExtractionStatus'] => {
  const snapshotStatus = payload.sessionSnapshot?.contradictionExtractionStatus
  if (snapshotStatus === 'not_evaluated' || snapshotStatus === 'evaluated' || snapshotStatus === 'failed') return snapshotStatus
  if (payload.contradictionExtractionStatus === 'not_evaluated' || payload.contradictionExtractionStatus === 'evaluated' || payload.contradictionExtractionStatus === 'failed') return payload.contradictionExtractionStatus
  if (payload.action === 'detect_contradictions') {
    if (payload.retryable || payload.retryableContradictionDetectionError) return 'failed'
    return payload.contradictionDetectionCompleted === false ? 'failed' : 'evaluated'
  }
  return current.contradictionExtractionStatus
}

export function Engine2Page({
  copy,
  language,
  aiSupportEnabled,
  diagnosticsEnabled,
  getAccessToken,
}: Engine2PageProps) {
  const initialStateRef = useRef<Engine2PersistedState | null>(null)
  if (!initialStateRef.current || initialStateRef.current.language !== language) {
    initialStateRef.current = createInitialState(language)
  }
  const initialState = initialStateRef.current
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Engine2Message[]>(initialState.messages)
  const [meta, setMeta] = useState<Engine2MetaState>({
    schemaVersion: initialState.schemaVersion,
    trialId: initialState.trialId,
    language,
    conversation: initialState.conversation,
    findingEvents: initialState.findingEvents,
    contradictions: initialState.contradictions,
    openQuestions: initialState.openQuestions,
    questions: initialState.questions,
    questionHistory: initialState.questionHistory,
    questionEvents: initialState.questionEvents,
    questionLedgerMigrationVersion: initialState.questionLedgerMigrationVersion,
    activeQuestionId: null,
    guideNotice: initialState.guideNotice,
    rejectedFingerprints: initialState.rejectedFingerprints,
    pendingPackageId: initialState.pendingPackageId,
    pendingDecisionPackageId: initialState.pendingDecisionPackageId,
    pendingQuestionTransition: initialState.pendingQuestionTransition,
    guidanceForNextQuestions: initialState.guidanceForNextQuestions,
    pendingPackageExpectedCount: initialState.pendingPackageExpectedCount,
    remindedPackageIds: initialState.remindedPackageIds,
    readiness: initialState.readiness,
    materialReadiness: initialState.materialReadiness,
    reportReadiness: initialState.reportReadiness,
    successfulTrialTurns: initialState.successfulTrialTurns,
    successfulTurnMessageIds: initialState.successfulTurnMessageIds,
    providerCalls: initialState.providerCalls,
    reportAvailable: initialState.reportAvailable,
    trialEnded: initialState.trialEnded,
    contradictionExtractionStatus: initialState.contradictionExtractionStatus,
    contradictionPipelineStatus: initialState.contradictionPipelineStatus,
    softTensionSignals: initialState.softTensionSignals,
    softTensionSignalsCount: initialState.softTensionSignalsCount,
    formalExtractedContradictionCount: initialState.formalExtractedContradictionCount,
    formalActiveContradictionCount: initialState.formalActiveContradictionCount,
    extractedContradictionCount: initialState.extractedContradictionCount,
    activeContradictionCount: initialState.activeContradictionCount,
    resolvedContradictionCount: initialState.resolvedContradictionCount,
    dismissedContradictionCount: initialState.dismissedContradictionCount,
    detectedRawContradictionCount: initialState.detectedRawContradictionCount,
    rejectedContradictionCandidateCount: initialState.rejectedContradictionCandidateCount,
    appliedContradictionCount: initialState.appliedContradictionCount,
    lastContradictionEvaluationTraceId: initialState.lastContradictionEvaluationTraceId,
    lastContradictionEvaluationAt: initialState.lastContradictionEvaluationAt,
    adminUsage: initialState.adminUsage,
  })
  const [findingState, dispatchFinding] = useReducer(
    engine2FindingReducer,
    initialState.findings,
    (findings) => createEngine2FindingState(findings),
  )
  const [loading, setLoading] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [showAllKnowledge, setShowAllKnowledge] = useState(false)
  const [gateNotice, setGateNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryTarget, setRetryTarget] = useState<Engine2RetryTarget | null>(null)
  const [continueRetryTarget, setContinueRetryTarget] = useState<{ requestId: string; reason: string | null } | null>(null)
  const [composerReplyTargetId, setComposerReplyTargetId] = useState<string | null>(null)
  const [inFlightTurn, setInFlightTurn] = useState<Engine2InFlightTurn | null>(null)
  const [diagEnabled, setDiagEnabled] = useState(() => canUseEngine2Diagnostics(diagnosticsEnabled) && isEngine2DiagnosticsRequested())
  const [diagTraces, setDiagTraces] = useState<Engine2FrontendTrace[]>(() => readEngine2Diagnostics())
  const [diagSessionState, setDiagSessionState] = useState<Engine2PersistedState | null>(null)
  const [diagStorageWarning, setDiagStorageWarning] = useState<string | null>(null)
  const diagStoragePersistenceDisabledRef = useRef(false)
  const [renderedTraceId, setRenderedTraceId] = useState<string | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const continuePackageRef = useRef<string | null>(null)
  const turnSeqRef = useRef(0)
  const stateVersionRef = useRef(0)
  const latestAppliedResponseVersionRef = useRef(-1)
  const requestSequenceRef = useRef(0)
  const latestAppliedRequestSequenceRef = useRef(0)
  const pendingTraceRef = useRef<{ trace: Engine2FrontendTrace; applySnapshot: Engine2ApplySnapshot } | null>(null)
  const pendingPackageHydrationRef = useRef<{ packageId: string; expectedCount: number } | null>(null)
  const acceptCriticalPathRef = useRef<Engine2AcceptCriticalPath | null>(null)
  const lastAnalyzeNavigationSkipRef = useRef(false)

  const visibleFindings = findingState.findings.filter((finding) => finding.status !== 'rejected')
  const pendingFindings = visibleFindings.filter((finding) => finding.status === 'pending')
  const knowledgeSummaryAll = buildKnowledgeSummary(findingState.findings, Number.MAX_SAFE_INTEGER)
  const knowledgeSummary = showAllKnowledge
    ? knowledgeSummaryAll
    : knowledgeSummaryAll.slice(0, 3)
  const activeOpenQuestion = resolveOpenQuestionById(meta.openQuestions, meta.activeQuestionId)
  const composerReplyQuestion = resolveOpenQuestionById(meta.openQuestions, composerReplyTargetId)
  const activePackageStats = resolveEngine2PackageStats({
    findings: findingState.findings,
    pendingPackageId: meta.pendingPackageId,
    pendingDecisionPackageId: meta.pendingDecisionPackageId,
    pendingPackageExpectedCount: meta.pendingPackageExpectedCount,
  })
  const activePendingCount = activePackageStats.packagePendingCount
  const hasPendingFindings = activePendingCount > 0
  const decisionGateActive = hasPendingFindings || Boolean(meta.pendingDecisionPackageId)
  const pendingActionIds = activePackageStats.packageFindings
    .filter((finding) => finding.status === 'pending')
    .map((finding) => finding.id)
  const continueGate = resolveEngine2ContinueGate({
    findings: findingState.findings,
    pendingPackageId: meta.pendingPackageId,
    pendingDecisionPackageId: meta.pendingDecisionPackageId,
    pendingPackageExpectedCount: meta.pendingPackageExpectedCount,
    continuing,
    loading,
    currentContinuationPackageId: continuePackageRef.current,
  })

  const diagnosticsAvailable = canUseEngine2Diagnostics(diagnosticsEnabled)

  useEffect(() => {
    const history = historyRef.current
    if (!history) return
    history.scrollTop = history.scrollHeight
  }, [messages])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const state: Engine2PersistedState = {
      ...meta,
      messages,
      conversation: messages,
      findings: findingState.findings,
    }
    window.sessionStorage.setItem(storageKey(language), JSON.stringify(state))
    stateVersionRef.current += 1
    setDiagSessionState(safeParseState(language))
  }, [findingState.findings, language, messages, meta])

  useEffect(() => {
    if (typeof window === 'undefined' || !diagnosticsAvailable) return
    const params = new URLSearchParams(window.location.search)
    if (diagEnabled) params.set('engine2debug', '1')
    else params.delete('engine2debug')
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`.replace(/\?$/, '')
    window.history.replaceState({}, '', next)
  }, [diagEnabled, diagnosticsAvailable])

  useEffect(() => {
    if (!diagnosticsAvailable || diagStoragePersistenceDisabledRef.current) return
    const result = writeEngine2Diagnostics(diagTraces)
    if (result.diagnosticsStorageWriteFailed) {
      diagStoragePersistenceDisabledRef.current = true
      setDiagStorageWarning(
        `Nie udało się zapisać diagnostyki lokalnie. Aplikacja działa dalej; pełną diagnostykę możesz skopiować przyciskiem. Rozmiar po przycięciu: ${result.diagnosticsBytesAfterPrune} B.`
      )
      setDiagTraces((current) => current.map((trace, index) => index === 0
        ? {
            ...trace,
            frontend: {
              ...trace.frontend,
              diagnosticsBytesBeforeWrite: result.diagnosticsBytesBeforeWrite,
              diagnosticsBytesAfterPrune: result.diagnosticsBytesAfterPrune,
              diagnosticsStorageWriteFailed: true,
              diagnosticsPrunedTraceCount: result.diagnosticsPrunedTraceCount,
            },
          }
        : trace))
    }
  }, [diagTraces, diagnosticsAvailable])

  useEffect(() => {
    if (!diagnosticsAvailable || !pendingTraceRef.current) return
    const pendingTrace = pendingTraceRef.current
    const renderedSessionState: Engine2PersistedState = {
      ...meta,
      messages,
      conversation: messages,
      findings: findingState.findings,
    }
    const updated = updateFrontendTraceState({
      trace: pendingTrace.trace,
      findings: findingState.findings,
      pendingFindings,
      pendingPackageId: meta.pendingPackageId,
      pendingPackageExpectedCount: meta.pendingPackageExpectedCount,
      pendingPackageProposalCount: activePackageStats.packageProposalCount,
      pendingPackageDecisionCount: activePackageStats.packageResolvedCount,
      continueGateReason: continueGate.reason,
      knowledge: knowledgeSummaryAll.map((entry) => entry.text),
      openQuestions: meta.openQuestions,
      sessionState: renderedSessionState,
      domSnapshot: captureEngine2DomSnapshot(mainRef.current),
      applySnapshot: pendingTrace.applySnapshot,
    })
    pendingTraceRef.current = null
    setDiagTraces((current) => [updated, ...current].slice(0, 30))
  }, [
    activePackageStats.packageProposalCount,
    activePackageStats.packageResolvedCount,
    continueGate.reason,
    diagnosticsAvailable,
    findingState.findings,
    knowledgeSummaryAll,
    meta,
    meta.openQuestions,
    meta.pendingPackageExpectedCount,
    meta.pendingPackageId,
    messages,
    pendingFindings,
    renderedTraceId,
  ])

  useEffect(() => {
    const hydration = pendingPackageHydrationRef.current
    if (!hydration) return
    const packageProposalCount = findingState.findings.filter((finding) => finding.packageId === hydration.packageId).length
    if (packageProposalCount < hydration.expectedCount) return
    pendingPackageHydrationRef.current = null
    setMeta((current) => ({
      ...current,
      pendingPackageId: hydration.packageId,
      pendingPackageExpectedCount: hydration.expectedCount,
    }))
  }, [findingState.findings])

  useEffect(() => {
    if (!meta.pendingPackageId || !hasPendingFindings) return
    if (meta.remindedPackageIds.includes(meta.pendingPackageId)) return
    const packageId = meta.pendingPackageId
    const timer = window.setTimeout(() => {
      setGateNotice(copy.pendingReviewMessage)
      setMeta((current) => ({
        ...current,
        remindedPackageIds: current.remindedPackageIds.includes(packageId)
          ? current.remindedPackageIds
          : [...current.remindedPackageIds, packageId],
      }))
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [copy.pendingReviewMessage, hasPendingFindings, meta.pendingPackageId, meta.remindedPackageIds])

  const buildHeaders = async (options: { dryRun?: boolean } = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-ai-support': aiSupportEnabled ? 'on' : 'off',
    }
    if (getAccessToken) {
      const token = await getAccessToken()
      if (token) headers.Authorization = `Bearer ${token}`
    }
    if (diagnosticsEnabled && headers.Authorization) {
      headers['x-diagnostics'] = '1'
    }
    if (diagEnabled && diagnosticsAvailable) {
      headers['x-engine2-debug'] = '1'
      if (options.dryRun) {
        headers['x-engine2-debug-dry-run'] = '1'
      }
    }
    return headers
  }

  const sendEngine2Request = async (
    body: Record<string, unknown>,
    options: { dryRun?: boolean; timeoutMs?: number } = {},
  ) => {
    const requestId = String(body.requestId || nextTurnId('engine2-request'))
    const requestStartedAt = new Date().toISOString()
    const stateVersionSent = stateVersionRef.current
    const abortController = new AbortController()
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs || ENGINE2_REQUEST_TIMEOUT_MS))
    const timeoutId = window.setTimeout(() => abortController.abort(), timeoutMs)
    let response: Response | null = null
    let payload: Engine2ApiResponse | null = null
    try {
      response = await fetch('/api/engine_2', {
        method: 'POST',
        headers: await buildHeaders(options),
        body: JSON.stringify({
          ...body,
          requestId,
          stateVersionSent,
          requestStartedAt,
        }),
        signal: abortController.signal,
      })
      payload = (await response.json().catch(() => null)) as Engine2ApiResponse | null
    } catch (error) {
      if (diagEnabled && diagnosticsAvailable) {
        const finishedAt = new Date().toISOString()
        const errorPayload = {
          requestId,
          turnId: String(body.turnId || ''),
          action: body.action,
          stateVersionReturned: stateVersionSent,
          retryable: true,
          turnApplied: false,
          analysisStatus: 'retryable_error',
          diagnosticCode: error instanceof DOMException && error.name === 'AbortError'
            ? 'ENGINE2_REQUEST_TIMEOUT'
            : 'ENGINE2_REQUEST_FAILED',
        }
        const baseTrace = createFrontendTraceFromApi({
          payload: errorPayload,
          backendTrace: null,
          isDryRun: Boolean(options.dryRun),
        })
        const errorTrace: Engine2FrontendTrace = {
          ...baseTrace,
          action: String(body.action || '') || null,
          stages: [{
            name: 'REQUEST',
            status: 'red',
            alarms: [],
            data: {
              requestId,
              turnId: String(body.turnId || ''),
              stateVersionSent,
              startedAt: requestStartedAt,
              finishedAt,
              status: 'error',
              timeoutMs,
              error: error instanceof Error ? error.message : String(error),
            },
          }],
          frontend: {
            ...baseTrace.frontend,
            requestStatus: 'error',
            responseStartedAt: requestStartedAt,
            responseFinishedAt: finishedAt,
          },
        }
        setDiagTraces((current) => [errorTrace, ...current].slice(0, 30))
      }
      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }
    if (!response.ok || !payload?.ok) {
      if (diagEnabled && diagnosticsAvailable) {
        const finishedAt = new Date().toISOString()
        const errorPayload = {
          ...(payload as unknown as Record<string, unknown> | null),
          requestId,
          turnId: String(body.turnId || ''),
          stateVersionReturned: stateVersionSent,
        }
        const baseTrace = createFrontendTraceFromApi({
          payload: errorPayload,
          backendTrace: null,
          isDryRun: Boolean(options.dryRun),
        })
        const errorTrace: Engine2FrontendTrace = {
          ...baseTrace,
          action: String(body.action || '') || null,
          stages: [{
            name: 'REQUEST',
            status: 'red',
            alarms: [],
            data: {
              requestId,
              turnId: String(body.turnId || ''),
              stateVersionSent,
              startedAt: requestStartedAt,
              finishedAt,
              status: 'error',
              error: String(payload?.error || `HTTP_${response.status}`),
            },
          }],
          frontend: {
            ...baseTrace.frontend,
            requestStatus: 'error',
            responseStartedAt: requestStartedAt,
            responseFinishedAt: finishedAt,
          },
        }
        setDiagTraces((current) => [errorTrace, ...current].slice(0, 30))
      }
      throw new Error(String(payload?.error || `HTTP_${response.status}`))
    }
    return {
      ...payload,
      requestId: payload.requestId || requestId,
      stateVersionReturned: Number(payload.stateVersionReturned ?? stateVersionSent),
      __frontendRequestStartedAt: requestStartedAt,
      __frontendRequestFinishedAt: new Date().toISOString(),
    } as Engine2ApiResponse & {
      __frontendRequestStartedAt: string
      __frontendRequestFinishedAt: string
    }
  }

  const recordFindingDecisionSubmitStarted = ({
    requestId,
    turnId,
    packageId,
    findingIds,
    startedAt,
  }: {
    requestId: string
    turnId: string
    packageId: string
    findingIds: string[]
    startedAt: string
  }) => {
    if (!diagEnabled || !diagnosticsAvailable) return
    const payload = {
      ok: true,
      action: 'commit_finding_decisions',
      requestId,
      turnId,
      stateVersionReturned: stateVersionRef.current,
      pendingDecisionPackageId: packageId,
      findingProposals: pendingFindings,
      findingUpdates: findingState.findings,
      findingEvents: meta.findingEvents,
      reportAvailable: meta.reportAvailable,
      retryable: false,
      panelQuestions: meta.openQuestions,
      openQuestions: meta.openQuestions,
      chatQuestion: null,
      sessionSnapshot: {
        ...meta,
        messages,
        conversation: messages,
        findings: findingState.findings,
      },
    }
    const trace = createFrontendTraceFromApi({
      payload: payload as unknown as Record<string, unknown>,
      backendTrace: null,
      isDryRun: false,
    })
    const decisionTrace: Engine2FrontendTrace = {
      ...trace,
      traceId: `engine2-decision-submit-${requestId}`,
      action: 'commit_finding_decisions',
      stages: [{
        name: 'FINDING DECISION SUBMIT',
        status: 'yellow',
        alarms: [],
        data: {
          findingDecisionSubmitStarted: true,
          decisionSubmissionInFlight: true,
          decisionSubmissionStartedAt: startedAt,
          decisionSubmitPackageId: packageId,
          decisionSubmitFindingIds: findingIds,
          decisionSubmitRequestId: requestId,
        },
      }],
      frontend: {
        ...trace.frontend,
        requestStatus: 'pending',
        responseStartedAt: startedAt,
        findingDecisionSubmitStarted: true,
        findingDecisionSubmitFinished: false,
        findingDecisionSubmitFailed: false,
        decisionSubmissionInFlight: true,
        decisionSubmissionStartedAt: startedAt,
        decisionSubmissionDurationMs: null,
        decisionSubmitPackageId: packageId,
        decisionSubmitFindingIds: findingIds,
        decisionSubmitRequestId: requestId,
        decisionSubmitError: null,
      },
    }
    setDiagTraces((current) => [decisionTrace, ...current].slice(0, 30))
  }

  const updateFindingDecisionSubmitTrace = ({
    requestId,
    startedAt,
    failed,
    error = null,
  }: {
    requestId: string
    startedAt: string
    failed: boolean
    error?: string | null
  }) => {
    if (!diagEnabled || !diagnosticsAvailable) return
    const finishedAt = new Date().toISOString()
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
    setDiagTraces((current) => current.map((trace) => {
      if (trace.frontend.decisionSubmitRequestId !== requestId) return trace
      return {
        ...trace,
        stages: trace.stages.map((stage) => stage.name === 'FINDING DECISION SUBMIT'
          ? {
              ...stage,
              status: failed ? 'red' : 'green',
              alarms: failed ? ['finding_decision_submit_failed'] : [],
              data: {
                ...stage.data,
                findingDecisionSubmitFinished: !failed,
                findingDecisionSubmitFailed: failed,
                decisionSubmissionInFlight: false,
                decisionSubmissionDurationMs: durationMs,
                decisionSubmitError: error,
                finishedAt,
              },
            }
          : stage),
        frontend: {
          ...trace.frontend,
          requestStatus: failed ? 'error' : 'success',
          responseFinishedAt: finishedAt,
          findingDecisionSubmitFinished: !failed,
          findingDecisionSubmitFailed: failed,
          decisionSubmissionInFlight: false,
          decisionSubmissionDurationMs: durationMs,
          decisionSubmitError: error,
        },
      }
    }))
  }

  const updateFromResponse = (
    payload: Engine2ApiResponse,
    requestMessage?: Engine2RetryTarget | null,
    options: { dryRun?: boolean; applyResult?: boolean; isAnalyzingFalseAt?: string | null } = {},
  ) => {
    const responseWithTiming = payload as Engine2ApiResponse & {
      __frontendRequestStartedAt?: string
      __frontendRequestFinishedAt?: string
    }
    const stateVersionReturned = Number(payload.stateVersionReturned ?? 0) || 0
    const staleDecision = resolveEngine2ResponseDecision({
        stateVersionReturned,
        latestAppliedResponseVersion: latestAppliedResponseVersionRef.current,
        requestSequence: requestMessage?.requestSequence || 0,
        latestAppliedRequestSequence: latestAppliedRequestSequenceRef.current,
      })
    const responseDecision = staleDecision === 'ignored_as_stale'
      ? staleDecision
      : payload.turnApplied === false && payload.decisionApplied
        ? 'decision_applied_continue_failed'
        : payload.turnApplied === false && payload.retryableContinueError
          ? 'partial_applied'
          : payload.turnApplied === false ? 'not_applied' : 'applied'
    const applySnapshot: Engine2ApplySnapshot = {
      stateVersionBeforeApply: stateVersionRef.current,
      responseDecision,
      responseStartedAt: responseWithTiming.__frontendRequestStartedAt || null,
      responseFinishedAt: responseWithTiming.__frontendRequestFinishedAt || null,
      frontendAppliedAt: new Date().toISOString(),
      gapsBeforeApply: meta.openQuestions,
      nextQuestionBeforeApply: activeOpenQuestion?.question || null,
      activeQuestionBeforeApply: meta.activeQuestionId,
      stateApplyMode: responseDecision === 'not_applied'
        ? 'unchanged'
        : Array.isArray(payload.panelQuestions) || Array.isArray(payload.openQuestions) ? 'replaced' : 'merged',
      replyTargetGapId: requestMessage?.replyToGapId || null,
      composerReplyTargetBeforeSubmit: requestMessage?.explicitComposerReplyTargetId || null,
      composerReplyTargetAfterSubmit: null,
      inFlightReplyToQuestionId: requestMessage?.replyToGapId || null,
      retryReplyToQuestionId: payload.retryable && requestMessage ? requestMessage.replyToGapId : null,
      replyTargetSource: requestMessage?.replyTargetSource || 'none',
      isAnalyzingFalseAt: options.isAnalyzingFalseAt || null,
      acceptClickedAt: payload.action === 'generate_panel_questions'
        ? acceptCriticalPathRef.current?.acceptClickedAt || null
        : null,
      criticalPathProviderCallsBefore: payload.action === 'generate_panel_questions'
        ? acceptCriticalPathRef.current?.providerCallsBefore ?? null
        : null,
      decisionPackageBefore: {
        packageId: activePackageStats.packageId,
        expectedProposalCount: activePackageStats.expectedProposalCount,
        packageProposalCount: activePackageStats.packageProposalCount,
        packagePendingCount: activePackageStats.packagePendingCount,
        packageResolvedCount: activePackageStats.packageResolvedCount,
        isHydrated: activePackageStats.isHydrated,
      },
    }
    if (diagEnabled && payload.engine2Trace) {
      const baseTrace = createFrontendTraceFromApi({
        payload: payload as unknown as Record<string, unknown>,
        backendTrace: payload.engine2Trace,
        isDryRun: Boolean(options.dryRun),
      })
      if (options.dryRun && !options.applyResult) {
        const trace = updateFrontendTraceState({
          trace: baseTrace,
          findings: findingState.findings,
          pendingFindings,
          pendingPackageId: meta.pendingPackageId,
          pendingPackageExpectedCount: meta.pendingPackageExpectedCount,
          pendingPackageProposalCount: activePackageStats.packageProposalCount,
          pendingPackageDecisionCount: activePackageStats.packageResolvedCount,
          continueGateReason: continueGate.reason,
          knowledge: knowledgeSummaryAll.map((entry) => entry.text),
          openQuestions: meta.openQuestions,
          sessionState: safeParseState(language),
          domSnapshot: captureEngine2DomSnapshot(mainRef.current),
          applySnapshot: { ...applySnapshot, responseDecision: 'ignored_as_stale', stateApplyMode: 'unchanged' },
        })
        setDiagTraces((current) => [trace, ...current].slice(0, 30))
        return
      }
      if (responseDecision === 'ignored_as_stale' || responseDecision === 'not_applied') {
        const trace = updateFrontendTraceState({
          trace: baseTrace,
          findings: findingState.findings,
          pendingFindings,
          pendingPackageId: meta.pendingPackageId,
          pendingPackageExpectedCount: meta.pendingPackageExpectedCount,
          pendingPackageProposalCount: activePackageStats.packageProposalCount,
          pendingPackageDecisionCount: activePackageStats.packageResolvedCount,
          continueGateReason: continueGate.reason,
          knowledge: knowledgeSummaryAll.map((entry) => entry.text),
          openQuestions: meta.openQuestions,
          sessionState: { ...meta, messages, conversation: messages, findings: findingState.findings },
          domSnapshot: captureEngine2DomSnapshot(mainRef.current),
          applySnapshot: { ...applySnapshot, stateApplyMode: 'unchanged' },
        })
        setDiagTraces((current) => [trace, ...current].slice(0, 30))
      }
      setRenderedTraceId(baseTrace.traceId)
      pendingTraceRef.current = { trace: baseTrace, applySnapshot }
    }
    if (responseDecision === 'ignored_as_stale') return
    if (responseDecision === 'not_applied') {
      if (payload.notice) setGateNotice(String(payload.notice))
      if (payload.retryable && requestMessage) {
        setRetryTarget({
          ...requestMessage,
          messageId: String(payload.retryMessageId || requestMessage.messageId),
        })
      } else if (payload.retryable === false) {
        setRetryTarget(null)
      }
      setMeta((current) => ({
        ...current,
        providerCalls: Math.max(
          current.providerCalls,
          Number(payload.trialCounters?.providerCalls ?? payload.limits?.providerCalls ?? 0),
        ),
        adminUsage: payload.admin ?? current.adminUsage,
        trialEnded: Boolean(payload.trialEnded ?? current.trialEnded),
      }))
      return
    }
    if (payload.retryableContinueError || payload.retryableQuestionGeneration) {
      setContinueRetryTarget({
        requestId: String(payload.requestId || payload.turnId || Date.now()),
        reason: String(payload.continueError?.diagnosticCode || payload.diagnosticCode || 'ENGINE2_CONTINUE_RETRYABLE_ERROR'),
      })
    } else if (payload.continueApplied || payload.reportAvailable || (Array.isArray(payload.panelQuestions) && payload.panelQuestions.length > 0)) {
      setContinueRetryTarget(null)
    }
    if (payload.action === 'analyze_message') {
      lastAnalyzeNavigationSkipRef.current = payload.turnKind === 'navigation' ||
        (payload.questionTransition?.type === 'close' && payload.questionTransition?.outcome === 'skipped')
    } else if (payload.action === 'generate_panel_questions') {
      lastAnalyzeNavigationSkipRef.current = false
    }
    latestAppliedResponseVersionRef.current = Math.max(latestAppliedResponseVersionRef.current, stateVersionReturned)
    latestAppliedRequestSequenceRef.current = Math.max(
      latestAppliedRequestSequenceRef.current,
      requestMessage?.requestSequence || 0,
    )
    const findingStateUpdate = resolveEngine2ResponseFindingState(payload)
    const proposals = findingStateUpdate.proposals
    if (proposals.length) {
      const packageId = String(payload.packageId || proposals[0]?.packageId || '').trim()
      if (packageId) {
        pendingPackageHydrationRef.current = {
          packageId,
          expectedCount: proposals.length,
        }
      }
      dispatchFinding({ type: 'addProposedBatch', findings: proposals })
    }
    if (findingStateUpdate.shouldReplaceAllFindings || Array.isArray(payload.sessionSnapshot?.findings)) {
      dispatchFinding({ type: 'replaceAll', findings: payload.sessionSnapshot?.findings || findingStateUpdate.findingUpdates })
    }
    const assistantMessage = resolveEngine2RenderableAssistantMessage(payload)
    const activeQuestionPresentation = resolveEngine2ActiveQuestionPresentation(payload)
    if (assistantMessage?.content) {
      setMessages((current) => [
        ...(current.some((message) => message.id === String(assistantMessage.id)) ? current : [
          ...current,
          {
            id: String(assistantMessage.id || `engine2-assistant-${Date.now()}`),
            role: 'assistant' as const,
            content: String(assistantMessage.content),
          },
        ]),
      ])
    }
    if (activeQuestionPresentation) {
      const presentationMessageId = activeQuestionPresentation.messageId || `engine2-question-presentation-${requestMessage?.messageId || payload.requestId || activeQuestionPresentation.questionId}`
      setMessages((current) => current.some((message) => message.id === presentationMessageId) ? current : [
        ...current,
        {
          id: presentationMessageId,
          role: 'assistant' as const,
          content: activeQuestionPresentation.text,
          questionId: activeQuestionPresentation.questionId,
        },
      ])
    }
    if (payload.notice) {
      setGateNotice(String(payload.notice))
    } else if (assistantMessage?.content || activeQuestionPresentation || proposals.length || Array.isArray(payload.findingUpdates)) {
      setGateNotice(null)
    }
    if (payload.retryable && requestMessage) {
      setRetryTarget({
          ...requestMessage,
        messageId: String(payload.retryMessageId || requestMessage.messageId),
      })
    } else if (requestMessage && (payload.diagnosticCode || payload.notice || payload.retryable === false)) {
      setRetryTarget(null)
    } else if (assistantMessage?.content || activeQuestionPresentation || proposals.length || Array.isArray(payload.findingUpdates)) {
      setRetryTarget(null)
    }
    setMeta((current) => {
      const questionState = resolveEngine2ResponseQuestionState({
        currentOpenQuestions: current.openQuestions,
        currentActiveQuestionId: current.activeQuestionId,
        payload,
      })
      const nextContradictions = payload.sessionSnapshot?.contradictions || payload.contradictions || current.contradictions
      const contradictionCounts = countEngine2Contradictions(nextContradictions)
      const contradictionExtractionStatus = resolveContradictionExtractionStatus(payload, current)
      const softTensionSignals = Array.isArray(payload.softTensionSignals)
        ? payload.softTensionSignals
        : Array.isArray(payload.sessionSnapshot?.softTensionSignals)
          ? payload.sessionSnapshot.softTensionSignals
          : current.softTensionSignals
      const softTensionSignalsCount = Number.isFinite(Number(payload.softTensionSignalsCount ?? payload.sessionSnapshot?.softTensionSignalsCount))
        ? Number(payload.softTensionSignalsCount ?? payload.sessionSnapshot?.softTensionSignalsCount)
        : softTensionSignals.length
      const contradictionPipelineStatus = payload.contradictionPipelineStatus ||
        payload.sessionSnapshot?.contradictionPipelineStatus ||
        current.contradictionPipelineStatus
      const detectedRawContradictionCount = Number.isFinite(Number(payload.detectedRawContradictionCount ?? payload.sessionSnapshot?.detectedRawContradictionCount))
        ? Number(payload.detectedRawContradictionCount ?? payload.sessionSnapshot?.detectedRawContradictionCount)
        : Array.isArray(payload.contradictionChangesRaw)
          ? payload.contradictionChangesRaw.length
          : current.detectedRawContradictionCount
      const rejectedContradictionCandidateCount = Number.isFinite(Number(payload.rejectedContradictionCandidateCount ?? payload.sessionSnapshot?.rejectedContradictionCandidateCount))
        ? Number(payload.rejectedContradictionCandidateCount ?? payload.sessionSnapshot?.rejectedContradictionCandidateCount)
        : current.rejectedContradictionCandidateCount
      const appliedContradictionCount = Number.isFinite(Number(payload.appliedContradictionCount ?? payload.sessionSnapshot?.appliedContradictionCount))
        ? Number(payload.appliedContradictionCount ?? payload.sessionSnapshot?.appliedContradictionCount)
        : Array.isArray(payload.contradictionChangesApplied)
          ? payload.contradictionChangesApplied.length
          : current.appliedContradictionCount
      return {
        ...current,
        conversation: payload.sessionSnapshot?.conversation || current.conversation,
        findingEvents: payload.sessionSnapshot?.findingEvents || payload.findingEvents || current.findingEvents,
        contradictions: nextContradictions,
        successfulTrialTurns: Math.max(
          current.successfulTrialTurns,
          Number(payload.trialCounters?.successfulTrialTurns ?? payload.limits?.successfulTrialTurns ?? 0)
        ),
        successfulTurnMessageIds: [...new Set([
          ...current.successfulTurnMessageIds,
          ...(Array.isArray(payload.trialCounters?.successfulTurnMessageIds)
            ? payload.trialCounters.successfulTurnMessageIds
            : []),
        ])],
        providerCalls: Math.max(
          current.providerCalls,
          Number(payload.trialCounters?.providerCalls ?? payload.limits?.providerCalls ?? 0)
        ),
        pendingPackageId:
          proposals.length
            ? current.pendingPackageId
            : payload.action === 'generate_panel_questions' || payload.action === 'commit_finding_decisions'
              ? null
              : current.pendingPackageId,
        pendingPackageExpectedCount:
          proposals.length
            ? current.pendingPackageExpectedCount
            : payload.action === 'generate_panel_questions' || payload.action === 'commit_finding_decisions'
              ? 0
              : current.pendingPackageExpectedCount,
        pendingDecisionPackageId: payload.pendingDecisionPackageId ?? payload.sessionSnapshot?.pendingDecisionPackageId ?? (
          payload.action === 'generate_panel_questions' || payload.action === 'commit_finding_decisions' ? null : current.pendingDecisionPackageId
        ),
        pendingQuestionTransition: payload.pendingQuestionTransition ?? payload.sessionSnapshot?.pendingQuestionTransition ?? (
          payload.action === 'generate_panel_questions' || payload.action === 'commit_finding_decisions' ? null : current.pendingQuestionTransition
        ),
        guidanceForNextQuestions: payload.sessionSnapshot?.guidanceForNextQuestions ?? current.guidanceForNextQuestions ?? null,
        openQuestions: questionState.openQuestions,
        questions: Array.isArray(payload.sessionSnapshot?.questions)
          ? payload.sessionSnapshot.questions
          : Array.isArray(payload.questions) ? payload.questions : current.questions,
        questionHistory: Array.isArray(payload.sessionSnapshot?.questions)
          ? payload.sessionSnapshot.questions
          : Array.isArray(payload.questionHistory)
            ? payload.questionHistory
          : current.questionHistory,
        questionEvents: payload.sessionSnapshot?.questionEvents || payload.questionEvents || current.questionEvents,
        questionLedgerMigrationVersion: payload.sessionSnapshot?.questionLedgerMigrationVersion || current.questionLedgerMigrationVersion,
        activeQuestionId: questionState.activeQuestionId,
        guideNotice:
          questionState.guideNoticeProvided ? payload.guideNotice ?? null : current.guideNotice,
        rejectedFingerprints: Array.isArray(payload.rejectedFingerprints)
          ? payload.rejectedFingerprints
          : current.rejectedFingerprints,
        readiness: payload.readiness ?? current.readiness,
        materialReadiness: payload.materialReadiness ?? current.materialReadiness,
        reportReadiness: payload.reportReadiness ?? payload.readiness ?? current.reportReadiness,
        reportAvailable: Boolean(payload.reportAvailable ?? current.reportAvailable),
        trialEnded: Boolean(payload.trialEnded ?? current.trialEnded),
        contradictionExtractionStatus,
        contradictionPipelineStatus,
        softTensionSignals,
        softTensionSignalsCount,
        formalExtractedContradictionCount: Number.isFinite(Number(payload.formalExtractedContradictionCount ?? payload.sessionSnapshot?.formalExtractedContradictionCount))
          ? Number(payload.formalExtractedContradictionCount ?? payload.sessionSnapshot?.formalExtractedContradictionCount)
          : contradictionCounts.extracted,
        formalActiveContradictionCount: Number.isFinite(Number(payload.formalActiveContradictionCount ?? payload.sessionSnapshot?.formalActiveContradictionCount))
          ? Number(payload.formalActiveContradictionCount ?? payload.sessionSnapshot?.formalActiveContradictionCount)
          : contradictionCounts.active,
        extractedContradictionCount: contradictionExtractionStatus === 'evaluated'
          ? Number(payload.extractedContradictionCount ?? payload.sessionSnapshot?.extractedContradictionCount ?? contradictionCounts.extracted)
          : current.extractedContradictionCount,
        activeContradictionCount: contradictionExtractionStatus === 'evaluated'
          ? Number(payload.activeContradictionCount ?? payload.sessionSnapshot?.activeContradictionCount ?? contradictionCounts.active)
          : current.activeContradictionCount,
        resolvedContradictionCount: contradictionExtractionStatus === 'evaluated'
          ? Number(payload.resolvedContradictionCount ?? payload.sessionSnapshot?.resolvedContradictionCount ?? contradictionCounts.resolved)
          : current.resolvedContradictionCount,
        dismissedContradictionCount: contradictionExtractionStatus === 'evaluated'
          ? Number(payload.dismissedContradictionCount ?? payload.sessionSnapshot?.dismissedContradictionCount ?? contradictionCounts.dismissed)
          : current.dismissedContradictionCount,
        detectedRawContradictionCount,
        rejectedContradictionCandidateCount,
        appliedContradictionCount,
        lastContradictionEvaluationTraceId: contradictionExtractionStatus === 'evaluated'
          ? String(payload.lastContradictionEvaluationTraceId || payload.sessionSnapshot?.lastContradictionEvaluationTraceId || payload.engine2Trace?.traceId || current.lastContradictionEvaluationTraceId || '') || null
          : current.lastContradictionEvaluationTraceId,
        lastContradictionEvaluationAt: contradictionExtractionStatus === 'evaluated'
          ? String(payload.lastContradictionEvaluationAt || payload.sessionSnapshot?.lastContradictionEvaluationAt || '') || new Date().toISOString()
          : current.lastContradictionEvaluationAt,
        adminUsage: payload.admin ?? current.adminUsage,
      }
    })
  }

  const nextTurnId = (prefix: string) => {
    turnSeqRef.current += 1
    return `${prefix}-${Date.now()}-${turnSeqRef.current}`
  }

  const resetConversation = () => {
    if (loading || continuing || retrying) return
    const emptyState = createEmptyState(language)
    initialStateRef.current = emptyState
    turnSeqRef.current = 0
    requestSequenceRef.current = 0
    latestAppliedRequestSequenceRef.current = 0
    latestAppliedResponseVersionRef.current = -1
    continuePackageRef.current = null
    pendingPackageHydrationRef.current = null
    setComposerReplyTargetId(null)
    setInFlightTurn(null)
    setDraft('')
    setGateNotice(null)
    setError(null)
    setRetryTarget(null)
    setContinueRetryTarget(null)
    setShowAllKnowledge(false)
    setRenderedTraceId(null)
    setMessages([])
    dispatchFinding({ type: 'replaceAll', findings: [] })
    setMeta({
      schemaVersion: emptyState.schemaVersion,
      trialId: emptyState.trialId,
      language: emptyState.language,
      conversation: emptyState.conversation,
      findingEvents: emptyState.findingEvents,
      contradictions: emptyState.contradictions,
      openQuestions: emptyState.openQuestions,
      questions: emptyState.questions,
      questionHistory: emptyState.questionHistory,
      questionEvents: emptyState.questionEvents,
      questionLedgerMigrationVersion: emptyState.questionLedgerMigrationVersion,
      activeQuestionId: emptyState.activeQuestionId,
      guideNotice: emptyState.guideNotice,
      rejectedFingerprints: emptyState.rejectedFingerprints,
      pendingPackageId: emptyState.pendingPackageId,
      pendingDecisionPackageId: emptyState.pendingDecisionPackageId,
      pendingQuestionTransition: emptyState.pendingQuestionTransition,
      guidanceForNextQuestions: emptyState.guidanceForNextQuestions,
      pendingPackageExpectedCount: emptyState.pendingPackageExpectedCount,
      remindedPackageIds: emptyState.remindedPackageIds,
      readiness: emptyState.readiness,
      materialReadiness: emptyState.materialReadiness,
      reportReadiness: emptyState.reportReadiness,
      successfulTrialTurns: emptyState.successfulTrialTurns,
      successfulTurnMessageIds: emptyState.successfulTurnMessageIds,
      providerCalls: emptyState.providerCalls,
	      reportAvailable: emptyState.reportAvailable,
	      trialEnded: emptyState.trialEnded,
	      contradictionExtractionStatus: emptyState.contradictionExtractionStatus,
	      contradictionPipelineStatus: emptyState.contradictionPipelineStatus,
	      softTensionSignals: emptyState.softTensionSignals,
	      softTensionSignalsCount: emptyState.softTensionSignalsCount,
	      formalExtractedContradictionCount: emptyState.formalExtractedContradictionCount,
	      formalActiveContradictionCount: emptyState.formalActiveContradictionCount,
	      extractedContradictionCount: emptyState.extractedContradictionCount,
      activeContradictionCount: emptyState.activeContradictionCount,
      resolvedContradictionCount: emptyState.resolvedContradictionCount,
      dismissedContradictionCount: emptyState.dismissedContradictionCount,
      detectedRawContradictionCount: emptyState.detectedRawContradictionCount,
      rejectedContradictionCandidateCount: emptyState.rejectedContradictionCandidateCount,
      appliedContradictionCount: emptyState.appliedContradictionCount,
      lastContradictionEvaluationTraceId: emptyState.lastContradictionEvaluationTraceId,
      lastContradictionEvaluationAt: emptyState.lastContradictionEvaluationAt,
      adminUsage: emptyState.adminUsage,
    })
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(storageKey(language), JSON.stringify(emptyState))
    }
  }

  const sendMessage = async () => {
    const text = draft.trim()
    if (!text || loading || continuing || retrying) return
    if (meta.pendingPackageId || meta.pendingDecisionPackageId) {
      setGateNotice(copy.blockedSendMessage)
      return
    }
    if (text.length > ENGINE2_MAX_MESSAGE_CHARS) {
      setError(copy.errorMessage)
      return
    }
    setError(null)
    setGateNotice(null)
    setRetryTarget(null)
    setShowAllKnowledge(false)
    const effectiveReplyTarget = resolveEngine2EffectiveReplyTarget({
      explicitComposerReplyTargetId: composerReplyTargetId,
      activeQuestionId: meta.activeQuestionId,
      openQuestions: meta.openQuestions,
    })
    const selectedQuestion = effectiveReplyTarget.question
        ? {
          id: effectiveReplyTarget.question.id,
          question: effectiveReplyTarget.question.question,
        }
      : null
    const replyToGapId = effectiveReplyTarget.question?.id || null
    const activeQuestionGapId = meta.activeQuestionId
    const userMessage = createEngine2UserMessage({
      id: nextTurnId('engine2-user'),
      content: text,
      replyToQuestionId: replyToGapId,
      replyToQuestionText: effectiveReplyTarget.question?.question || null,
      replyTargetSource: effectiveReplyTarget.source,
    })
    const turnContext: Engine2InFlightTurn = {
      messageId: userMessage.id,
      content: userMessage.content,
      selectedQuestion,
      replyToGapId,
      activeQuestionGapId,
      explicitComposerReplyTargetId: composerReplyTargetId,
      replyTargetSource: effectiveReplyTarget.source,
      requestSequence: ++requestSequenceRef.current,
      turnId: userMessage.id,
      requestId: userMessage.id,
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setDraft('')
    setInFlightTurn(turnContext)
    setComposerReplyTargetId(null)
    setLoading(true)
    try {
      const payload = await sendEngine2Request({
        ...buildAnalyzeMessageRequestBody({
        trialId: meta.trialId,
        turnId: turnContext.turnId,
        language,
        messageId: userMessage.id,
        messageContent: text,
        history: nextMessages,
        findings: findingState.findings,
        rejectedFingerprints: meta.rejectedFingerprints,
        successfulTrialTurns: meta.successfulTrialTurns,
        successfulTurnMessageIds: meta.successfulTurnMessageIds,
        providerCalls: meta.providerCalls,
        selectedQuestion,
        replyToGapId,
        replyTargetSource: effectiveReplyTarget.source,
        activeQuestionGapId,
        openQuestions: meta.openQuestions,
        questionHistory: meta.questionHistory,
        readiness: meta.readiness,
        materialReadiness: meta.materialReadiness,
        reportReadiness: meta.reportReadiness,
        reportAvailable: meta.reportAvailable,
        contradictions: meta.contradictions,
        findingEvents: meta.findingEvents,
        questionEvents: meta.questionEvents,
          pendingDecisionPackageId: meta.pendingDecisionPackageId,
          questionLedgerMigrationVersion: meta.questionLedgerMigrationVersion,
          pendingQuestionTransition: meta.pendingQuestionTransition,
          guidanceForNextQuestions: meta.guidanceForNextQuestions,
        }),
        requestId: turnContext.requestId,
      })
      const isAnalyzingFalseAt = new Date().toISOString()
      setLoading(false)
      setInFlightTurn(null)
      updateFromResponse(payload, turnContext, { isAnalyzingFalseAt })
    } catch {
      setError(copy.errorMessage)
      setRetryTarget(turnContext)
    } finally {
      setLoading(false)
      setInFlightTurn(null)
    }
  }

  const retryAnalysis = async () => {
    if (!retryTarget || loading || continuing || retrying) return
    setError(null)
    setGateNotice(null)
    setComposerReplyTargetId(null)
    const retryContext: Engine2InFlightTurn = {
      ...retryTarget,
      requestSequence: ++requestSequenceRef.current,
      turnId: nextTurnId(`engine2-retry-${retryTarget.messageId}`),
      requestId: nextTurnId(`engine2-retry-request-${retryTarget.messageId}`),
    }
    setInFlightTurn(retryContext)
    setRetrying(true)
    try {
      const payload = await sendEngine2Request({
        ...buildRetryAnalyzeRequestBody({
        trialId: meta.trialId,
        turnId: retryContext.turnId,
        language,
        retryMessageId: retryTarget.messageId,
        retryMessageContent: retryTarget.content,
        history: messages,
        findings: findingState.findings,
        rejectedFingerprints: meta.rejectedFingerprints,
        successfulTrialTurns: meta.successfulTrialTurns,
        successfulTurnMessageIds: meta.successfulTurnMessageIds,
        providerCalls: meta.providerCalls,
        selectedQuestion: retryTarget.selectedQuestion,
        replyToGapId: retryTarget.replyToGapId,
        replyTargetSource: retryTarget.replyTargetSource,
        activeQuestionGapId: retryTarget.activeQuestionGapId,
        openQuestions: meta.openQuestions,
        questionHistory: meta.questionHistory,
        readiness: meta.readiness,
        materialReadiness: meta.materialReadiness,
        reportReadiness: meta.reportReadiness,
        reportAvailable: meta.reportAvailable,
        contradictions: meta.contradictions,
        findingEvents: meta.findingEvents,
        questionEvents: meta.questionEvents,
        pendingDecisionPackageId: meta.pendingDecisionPackageId,
        questionLedgerMigrationVersion: meta.questionLedgerMigrationVersion,
        pendingQuestionTransition: meta.pendingQuestionTransition,
        guidanceForNextQuestions: meta.guidanceForNextQuestions,
        }),
        requestId: retryContext.requestId,
      })
      const isAnalyzingFalseAt = new Date().toISOString()
      setRetrying(false)
      setInFlightTurn(null)
      updateFromResponse(payload, retryContext, { isAnalyzingFalseAt })
    } catch {
      setError(copy.errorMessage)
      setRetryTarget(retryContext)
    } finally {
      setRetrying(false)
      setInFlightTurn(null)
    }
  }

  const submitFindingDecisions = useEffectEvent(async (decisions: Engine2FindingDecision[]) => {
    const cleanDecisions = decisions
      .map((decision) => ({
        ...decision,
        findingId: String(decision.findingId || '').trim(),
        content: typeof decision.content === 'string' ? decision.content.trim() : decision.content,
      }))
      .filter((decision) => decision.findingId && ['confirm', 'edit', 'reject'].includes(decision.type))
    if (!cleanDecisions.length || loading || continuing || retrying) return
    const packageId = activePackageStats.packageId || meta.pendingDecisionPackageId || meta.pendingPackageId
    if (!packageId) return
    const packageStats = resolveEngine2PackageStats({
      findings: findingState.findings,
      pendingPackageId: packageId,
      pendingDecisionPackageId: meta.pendingDecisionPackageId,
      pendingPackageExpectedCount: meta.pendingPackageExpectedCount,
    })
    if (!packageStats.isHydrated || packageStats.packageProposalCount === 0) {
      return
    }
    const turnId = nextTurnId(`engine2-continue-${packageId}`)
    const requestId = nextTurnId(`engine2-decision-submit-${packageId}`)
    const startedAt = new Date().toISOString()
    const findingIds = cleanDecisions.map((decision) => decision.findingId)
    const resolvedByThisSubmit = new Set(findingIds)
    const finalPackageDecision = packageStats.packageFindings
      .filter((finding) => finding.status === 'pending')
      .every((finding) => resolvedByThisSubmit.has(finding.id))
    if (finalPackageDecision) {
      acceptCriticalPathRef.current = {
        acceptClickedAt: startedAt,
        providerCallsBefore: meta.providerCalls,
        packageId,
        backgroundStarted: false,
        sourcePayload: null,
      }
    }
    recordFindingDecisionSubmitStarted({ requestId, turnId, packageId, findingIds, startedAt })
    continuePackageRef.current = packageId
    setContinuing(true)
    setGateNotice(null)
    try {
      const payload = await sendEngine2Request({
        version: ENGINE2_API_CONTRACT_VERSION,
        action: 'commit_finding_decisions',
        trialId: meta.trialId,
        turnId,
        language,
        history: toEngine2HistoryPayload(messages),
        findings: findingState.findings,
        pendingPackageId: packageId,
        pendingPackageExpectedCount: packageStats.expectedProposalCount,
        decisions: cleanDecisions,
        openQuestions: meta.openQuestions,
        questionHistory: meta.questionHistory,
        readiness: meta.readiness,
        materialReadiness: meta.materialReadiness,
        reportReadiness: meta.reportReadiness,
        reportAvailable: meta.reportAvailable,
        rejectedFingerprints: meta.rejectedFingerprints,
        sessionSnapshot: {
          schemaVersion: 'engine2.session.v5',
          conversation: toEngine2HistoryPayload(messages),
          findings: findingState.findings,
          findingEvents: meta.findingEvents,
          contradictions: meta.contradictions,
          questions: meta.questions,
          questionEvents: meta.questionEvents,
          rejectedFingerprints: meta.rejectedFingerprints,
          readiness: meta.reportReadiness ?? meta.readiness,
          activeQuestionId: meta.activeQuestionId,
          questionLedgerMigrationVersion: meta.questionLedgerMigrationVersion,
          pendingDecisionPackageId: packageId,
          pendingQuestionTransition: meta.pendingQuestionTransition,
          guidanceForNextQuestions: meta.guidanceForNextQuestions,
          trialCounters: {
            successfulTrialTurns: meta.successfulTrialTurns,
            successfulTurnMessageIds: meta.successfulTurnMessageIds,
            providerCalls: meta.providerCalls,
          },
        },
        trialCounters: {
          successfulTrialTurns: meta.successfulTrialTurns,
          successfulTurnMessageIds: meta.successfulTurnMessageIds,
          providerCalls: meta.providerCalls,
        },
        requestId,
      }, { timeoutMs: ENGINE2_DECISION_SUBMIT_TIMEOUT_MS })
      updateFindingDecisionSubmitTrace({ requestId, startedAt, failed: false })
      updateFromResponse(payload)
      if (payload.decisionApplied && payload.pendingDecisionPackageId === null && payload.awaitingContinueAfterDecision !== false) {
        await runContinueAfterDecisions(payload)
      }
    } catch (error) {
      updateFindingDecisionSubmitTrace({
        requestId,
        startedAt,
        failed: true,
        error: error instanceof Error ? error.message : String(error),
      })
      setError(copy.errorMessage)
    } finally {
      continuePackageRef.current = null
      setContinuing(false)
    }
  })

  const runEvaluateReadiness = useEffectEvent(async (sourcePayload: Engine2ApiResponse | null = null) => {
    const snapshot = sourcePayload?.sessionSnapshot
    const turnId = nextTurnId('engine2-evaluate-readiness')
    const requestId = nextTurnId('engine2-evaluate-readiness-request')
    const history = snapshot?.conversation || toEngine2HistoryPayload(messages)
    const findings = snapshot?.findings || findingState.findings
    const findingEvents = snapshot?.findingEvents || sourcePayload?.findingEvents || meta.findingEvents
    const questions = snapshot?.questions || sourcePayload?.questions || meta.questions
    const questionEvents = snapshot?.questionEvents || sourcePayload?.questionEvents || meta.questionEvents
    setMeta((current) => ({
      ...current,
      readiness: { ...(current.readiness || { score: 0, materialScore: 0, reportScore: 0, reportAvailable: false }), status: 'evaluating' },
      materialReadiness: { ...(current.materialReadiness || { score: 0, materialScore: 0, reportScore: 0, reportAvailable: false }), status: 'evaluating' },
      reportReadiness: { ...(current.reportReadiness || { score: 0, materialScore: 0, reportScore: 0, reportAvailable: false }), status: 'evaluating' },
    }))
    try {
      const payload = await sendEngine2Request({
        version: ENGINE2_API_CONTRACT_VERSION,
        action: 'evaluate_readiness',
        trialId: meta.trialId,
        turnId,
        language,
        history,
        findings,
        pendingPackageId: null,
        pendingPackageExpectedCount: 0,
        pendingDecisionPackageId: null,
        decisions: [],
        openQuestions: sourcePayload?.openQuestions || meta.openQuestions,
        questionHistory: questions,
        readiness: snapshot?.readiness || meta.readiness,
        materialReadiness: meta.materialReadiness,
        reportReadiness: meta.reportReadiness,
        reportAvailable: meta.reportAvailable,
        rejectedFingerprints: meta.rejectedFingerprints,
        sessionSnapshot: {
          schemaVersion: 'engine2.session.v5',
          conversation: history,
          findings,
          findingEvents,
          contradictions: snapshot?.contradictions || sourcePayload?.contradictions || meta.contradictions,
          questions,
          questionEvents,
          rejectedFingerprints: meta.rejectedFingerprints,
          readiness: snapshot?.readiness || meta.reportReadiness || meta.readiness,
          activeQuestionId: null,
          questionLedgerMigrationVersion: meta.questionLedgerMigrationVersion,
          pendingDecisionPackageId: null,
          pendingQuestionTransition: null,
          guidanceForNextQuestions: snapshot?.guidanceForNextQuestions ?? meta.guidanceForNextQuestions,
          trialCounters: {
            successfulTrialTurns: meta.successfulTrialTurns,
            successfulTurnMessageIds: meta.successfulTurnMessageIds,
            providerCalls: meta.providerCalls,
          },
        },
        trialCounters: {
          successfulTrialTurns: meta.successfulTrialTurns,
          successfulTurnMessageIds: meta.successfulTurnMessageIds,
          providerCalls: meta.providerCalls,
        },
        requestId,
      })
      updateFromResponse(payload)
    } catch (error) {
      setMeta((current) => ({
        ...current,
        readiness: {
          ...(current.readiness || { score: 0, materialScore: 0, reportScore: 0, reportAvailable: false }),
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  })

  const runDetectContradictions = useEffectEvent(async (sourcePayload: Engine2ApiResponse | null = null) => {
    const snapshot = sourcePayload?.sessionSnapshot
    const turnId = nextTurnId('engine2-detect-contradictions')
    const requestId = nextTurnId('engine2-detect-contradictions-request')
    const history = snapshot?.conversation || toEngine2HistoryPayload(messages)
    const findings = snapshot?.findings || findingState.findings
    const findingEvents = snapshot?.findingEvents || sourcePayload?.findingEvents || meta.findingEvents
    const questions = snapshot?.questions || sourcePayload?.questions || meta.questions
    const questionEvents = snapshot?.questionEvents || sourcePayload?.questionEvents || meta.questionEvents
    try {
      const payload = await sendEngine2Request({
        version: ENGINE2_API_CONTRACT_VERSION,
        action: 'detect_contradictions',
        trialId: meta.trialId,
        turnId,
        language,
        history,
        findings,
        pendingPackageId: null,
        pendingPackageExpectedCount: 0,
        pendingDecisionPackageId: null,
        decisions: [],
        openQuestions: sourcePayload?.openQuestions || meta.openQuestions,
        questionHistory: questions,
        readiness: snapshot?.readiness || meta.readiness,
        materialReadiness: meta.materialReadiness,
        reportReadiness: meta.reportReadiness,
        reportAvailable: meta.reportAvailable,
        rejectedFingerprints: meta.rejectedFingerprints,
        sessionSnapshot: {
          schemaVersion: 'engine2.session.v5',
          conversation: history,
          findings,
          findingEvents,
          contradictions: snapshot?.contradictions || sourcePayload?.contradictions || meta.contradictions,
          questions,
          questionEvents,
          rejectedFingerprints: meta.rejectedFingerprints,
          readiness: snapshot?.readiness || meta.reportReadiness || meta.readiness,
          activeQuestionId: null,
          questionLedgerMigrationVersion: meta.questionLedgerMigrationVersion,
          pendingDecisionPackageId: null,
          pendingQuestionTransition: null,
          guidanceForNextQuestions: snapshot?.guidanceForNextQuestions ?? meta.guidanceForNextQuestions,
          trialCounters: {
            successfulTrialTurns: meta.successfulTrialTurns,
            successfulTurnMessageIds: meta.successfulTurnMessageIds,
            providerCalls: meta.providerCalls,
          },
        },
        trialCounters: {
          successfulTrialTurns: meta.successfulTrialTurns,
          successfulTurnMessageIds: meta.successfulTurnMessageIds,
          providerCalls: meta.providerCalls,
        },
        requestId,
      })
      updateFromResponse(payload)
      return payload
    } catch {
      setMeta((current) => ({
        ...current,
        contradictionExtractionStatus: 'failed',
      }))
      return null
    }
  })

  useEffect(() => {
    if (!continueGate.allowed) return
    const packageId = continueGate.stats.packageId
    if (!packageId) return
    const packageFindings = continueGate.stats.packageFindings
    const decisions = packageFindings
      .filter((finding) => finding.status !== 'pending' && finding.decisionSource)
      .map((finding) => ({
        findingId: finding.id,
        type:
          finding.status === 'rejected'
            ? 'reject' as const
            : finding.source === 'user_edit'
              ? 'edit' as const
              : 'confirm' as const,
        content: finding.content,
      }))
    if (!decisions.length) return
    continuePackageRef.current = packageId
    void submitFindingDecisions(decisions)
  }, [continueGate])

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void sendMessage()
  }

  const handleConfirmAll = () => {
    if (!pendingActionIds.length || loading || continuing || retrying) return
    setGateNotice(null)
    void submitFindingDecisions(pendingActionIds.map((id) => ({ findingId: id, type: 'confirm' })))
  }

  const handleRejectAll = () => {
    if (!pendingActionIds.length || loading || continuing || retrying) return
    setGateNotice(null)
    void submitFindingDecisions(pendingActionIds.map((id) => ({ findingId: id, type: 'reject' })))
  }

  const handleSelectOpenQuestion = (questionId: string) => {
    if (loading || continuing || retrying || decisionGateActive || meta.trialEnded) return
    setComposerReplyTargetId(questionId)
    setError(null)
    setGateNotice(null)
    window.requestAnimationFrame(() => {
      composerRef.current?.focus()
    })
  }

  const handleClearSelectedQuestion = () => {
    setComposerReplyTargetId(null)
  }

  const handleClearDiagnostics = () => {
    pendingTraceRef.current = null
    diagStoragePersistenceDisabledRef.current = false
    setDiagStorageWarning(null)
    clearEngine2Diagnostics()
    setDiagTraces([])
  }

  const handleShowSessionState = () => {
    setDiagSessionState(safeParseState(language))
  }

  const handleCopyTrace = async (trace: Engine2FrontendTrace) => {
    const text = JSON.stringify(trace, null, 2)
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    console.log(text)
  }

  const handleCopyDiagnostics = async () => {
    const text = JSON.stringify({
      exportedAt: new Date().toISOString(),
      sessionState: safeParseState(language),
      traces: diagTraces,
    }, null, 2)
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    console.log(text)
  }

  const handleCopyCompactDiagnostics = async () => {
    const text = JSON.stringify(buildCompactEngine2Diagnostics({
      traces: diagTraces,
      sessionState: safeParseState(language),
    }), null, 2)
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    console.log(text)
  }

  const rerunTraceAnalysis = async (trace: Engine2FrontendTrace) => {
    if (!trace.messageId || loading || continuing || retrying) return
    const targetMessage = messages.find((entry) => entry.id === trace.messageId)
    const content = targetMessage?.content || String(trace.backendTrace?.text || '')
    if (!content) return
    setError(null)
    setGateNotice(null)
    setRetrying(true)
    try {
      const payload = await sendEngine2Request({
        ...buildAnalyzeMessageRequestBody({
          trialId: meta.trialId,
          turnId: nextTurnId(`engine2-dry-run-${trace.messageId}`),
          language,
          messageId: trace.messageId,
          messageContent: content,
          history: messages,
          findings: findingState.findings,
          rejectedFingerprints: meta.rejectedFingerprints,
          successfulTrialTurns: meta.successfulTrialTurns,
          successfulTurnMessageIds: meta.successfulTurnMessageIds,
          providerCalls: meta.providerCalls,
          selectedQuestion: null,
          openQuestions: meta.openQuestions,
          questionHistory: meta.questions,
          readiness: meta.readiness,
          materialReadiness: meta.materialReadiness,
          reportReadiness: meta.reportReadiness,
          reportAvailable: meta.reportAvailable,
          contradictions: meta.contradictions,
          findingEvents: meta.findingEvents,
          questionEvents: meta.questionEvents,
          pendingDecisionPackageId: meta.pendingDecisionPackageId,
          questionLedgerMigrationVersion: meta.questionLedgerMigrationVersion,
          pendingQuestionTransition: meta.pendingQuestionTransition,
          guidanceForNextQuestions: meta.guidanceForNextQuestions,
        }),
        diagnostics: { dryRun: true },
      }, { dryRun: true })
      updateFromResponse(payload, null, { dryRun: true })
    } catch {
      setError(copy.errorMessage)
    } finally {
      setRetrying(false)
    }
  }

  const runContinueAfterDecisions = useEffectEvent(async (sourcePayload: Engine2ApiResponse | null = null) => {
    const snapshot = sourcePayload?.sessionSnapshot
    const turnId = nextTurnId('engine2-continue-after-decisions')
    const requestId = nextTurnId('engine2-continue-after-decisions-request')
    const history = snapshot?.conversation || toEngine2HistoryPayload(messages)
    const findings = snapshot?.findings || findingState.findings
    const findingEvents = snapshot?.findingEvents || meta.findingEvents
    const questions = snapshot?.questions || meta.questions
    const questionEvents = snapshot?.questionEvents || meta.questionEvents
    const ownsContinuingState = !continuing
    if (ownsContinuingState) setContinuing(true)
    setGateNotice(null)
    setError(null)
    try {
      const payload = await sendEngine2Request({
        version: ENGINE2_API_CONTRACT_VERSION,
        action: 'generate_panel_questions',
        trialId: meta.trialId,
        turnId,
        language,
        history,
        findings,
        pendingPackageId: null,
        pendingPackageExpectedCount: 0,
        pendingDecisionPackageId: null,
        decisions: [],
        openQuestions: meta.openQuestions,
        questionHistory: questions,
        readiness: snapshot?.readiness || meta.readiness,
        materialReadiness: meta.materialReadiness,
        reportReadiness: meta.reportReadiness,
        reportAvailable: meta.reportAvailable,
        rejectedFingerprints: meta.rejectedFingerprints,
        sessionSnapshot: {
          schemaVersion: 'engine2.session.v5',
          conversation: history,
          findings,
          findingEvents,
          contradictions: snapshot?.contradictions || meta.contradictions,
          questions,
          questionEvents,
          rejectedFingerprints: meta.rejectedFingerprints,
          readiness: snapshot?.readiness || meta.reportReadiness || meta.readiness,
          activeQuestionId: null,
          questionLedgerMigrationVersion: meta.questionLedgerMigrationVersion,
          pendingDecisionPackageId: null,
          pendingQuestionTransition: null,
          guidanceForNextQuestions: snapshot?.guidanceForNextQuestions ?? meta.guidanceForNextQuestions,
          trialCounters: {
            successfulTrialTurns: meta.successfulTrialTurns,
            successfulTurnMessageIds: meta.successfulTurnMessageIds,
            providerCalls: meta.providerCalls,
          },
        },
        trialCounters: {
          successfulTrialTurns: meta.successfulTrialTurns,
          successfulTurnMessageIds: meta.successfulTurnMessageIds,
          providerCalls: meta.providerCalls,
        },
        requestId,
      })
      updateFromResponse(payload)
      if (payload.analysisStatus === 'applied' && payload.retryable !== true && Array.isArray(payload.panelQuestions) && payload.panelQuestions.length === 3) {
        if (acceptCriticalPathRef.current) {
          acceptCriticalPathRef.current = {
            ...acceptCriticalPathRef.current,
            sourcePayload: payload,
          }
        }
      }
    } catch (error) {
      setContinueRetryTarget({
        requestId,
        reason: error instanceof Error ? error.message : String(error),
      })
      setGateNotice('Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.')
    } finally {
      if (ownsContinuingState) setContinuing(false)
    }
  })

  useEffect(() => {
    const criticalPath = acceptCriticalPathRef.current
    if (!criticalPath || criticalPath.backgroundStarted) return
    if (meta.openQuestions.length !== 3) return
    if (loading || continuing || retrying || meta.pendingDecisionPackageId) return
    acceptCriticalPathRef.current = { ...criticalPath, backgroundStarted: true }
    void (async () => {
      const detectionPayload = await runDetectContradictions(criticalPath.sourcePayload)
      await runEvaluateReadiness(detectionPayload || criticalPath.sourcePayload)
      acceptCriticalPathRef.current = null
    })()
  }, [
    continuing,
    loading,
    meta.openQuestions.length,
    meta.pendingDecisionPackageId,
    retrying,
  ])

  const retryContinueAfterDecisions = () => {
    if (!continueRetryTarget || loading || continuing || retrying || meta.trialEnded) return
    setContinueRetryTarget(null)
    void runContinueAfterDecisions(null)
  }

  useEffect(() => {
    const confirmedCount = findingState.findings.filter((finding) => finding.status === 'confirmed').length
    if (lastAnalyzeNavigationSkipRef.current && meta.openQuestions.length >= 3) {
      lastAnalyzeNavigationSkipRef.current = false
    }
    const shouldRefillEmptyPanel = meta.openQuestions.length === 0
    const shouldRefillAfterNavigationSkip =
      lastAnalyzeNavigationSkipRef.current &&
      meta.openQuestions.length > 0 &&
      meta.openQuestions.length < 3
    if (
      confirmedCount > 0 &&
      (shouldRefillEmptyPanel || shouldRefillAfterNavigationSkip) &&
      !meta.pendingDecisionPackageId &&
      !meta.reportAvailable &&
      !meta.trialEnded &&
      !loading &&
      !continuing &&
      !retrying &&
      !continueRetryTarget
    ) {
      lastAnalyzeNavigationSkipRef.current = false
      void runContinueAfterDecisions(null)
    }
  }, [
    continueRetryTarget,
    continuing,
    findingState.findings,
    loading,
    meta.openQuestions.length,
    meta.pendingDecisionPackageId,
    meta.reportAvailable,
    meta.trialEnded,
    retrying,
    runContinueAfterDecisions,
  ])

  const readinessStatus = meta.reportReadiness?.status ?? meta.readiness?.status ?? 'not_evaluated'
  const readinessEvaluated = readinessStatus === 'evaluated'
  const reportReadinessPercent = readinessEvaluated ? meta.reportReadiness?.score ?? meta.readiness?.score ?? 0 : null
  const readinessLabel = readinessStatus === 'evaluating'
    ? 'Oceniam...'
    : readinessStatus === 'failed'
      ? 'Błąd oceny'
      : readinessEvaluated && reportReadinessPercent !== null
        ? `${formatNumber(reportReadinessPercent, language)}%`
        : 'Jeszcze nie oceniono'
  const contradictionHadUnsavedCandidates = Number(meta.detectedRawContradictionCount || 0) > 0 &&
    (meta.contradictionExtractionStatus === 'failed' || Number(meta.rejectedContradictionCandidateCount || 0) > 0) &&
    Number(meta.appliedContradictionCount || 0) === 0
  const visibleTensions = buildEngine2VisibleTensions(meta.contradictions)
  const savedTensionCount = Math.max(
    Number(meta.activeContradictionCount || 0),
    Number(meta.formalActiveContradictionCount || 0),
  )
  const contradictionCounterText = contradictionHadUnsavedCandidates
    ? (language === 'en' ? 'detected, not saved' : 'wykryto, nie zapisano')
    : meta.contradictionExtractionStatus === 'failed'
      ? (language === 'en' ? 'error' : 'błąd')
      : savedTensionCount > 0
        ? formatNumber(savedTensionCount, language)
        : meta.contradictionExtractionStatus === 'evaluated'
        ? formatNumber(meta.extractedContradictionCount ?? 0, language)
        : (language === 'en' ? 'not evaluated' : 'nie oceniono')
  const tensionEmptyText = contradictionHadUnsavedCandidates
    ? 'Wykryto kandydaty na napięcia, ale nie zostały jeszcze zapisane w mapie.'
    : meta.contradictionExtractionStatus === 'failed'
      ? 'Nie udało się teraz odczytać napięć z rozmowy.'
      : meta.contradictionExtractionStatus === 'evaluated'
        ? 'Brak zapisanych aktywnych napięć lub sprzeczności.'
        : 'Napięcia nie zostały jeszcze ocenione.'
  const canRetryAnalysis = Boolean(retryTarget) && !loading && !continuing && !retrying && !meta.trialEnded
  const canRetryContinue = Boolean(continueRetryTarget) && !loading && !continuing && !retrying && !meta.trialEnded
  const canSend =
    draft.trim().length > 0 &&
    !loading &&
    !continuing &&
    !retrying &&
    !meta.trialEnded &&
    !meta.pendingPackageId &&
    !meta.pendingDecisionPackageId
  const statusText = hasPendingFindings
    ? `${copy.pendingReviewBadge}: ${activePendingCount}`
    : meta.reportAvailable
      ? copy.reportReadyTitle
      : meta.trialEnded
        ? copy.trialEndedTitle
        : null
  const panelQuestionDisplayState = resolveEngine2PanelQuestionDisplayState({
    hasPendingFindings,
    decisionGateActive,
    loading,
    continuing,
    retrying,
    openQuestions: meta.openQuestions,
    guideNotice: meta.guideNotice,
  })
  const confirmFinding = (id: string) => {
    setGateNotice(null)
    void submitFindingDecisions([{ findingId: id, type: 'confirm' }])
  }
  const rejectFinding = (id: string) => {
    setGateNotice(null)
    void submitFindingDecisions([{ findingId: id, type: 'reject' }])
  }
  const saveFindingEdit = () => {
    setGateNotice(null)
    const findingId = findingState.editingFindingId
    const content = findingState.editingContent.trim()
    if (!findingId || !content) return
    void submitFindingDecisions([{ findingId, type: 'edit', content }])
  }

  return (
    <main
      ref={mainRef}
      className="engine2-main"
      aria-label={copy.pageLabel}
      data-engine2-rendered-trace-id={renderedTraceId || undefined}
      data-engine2-in-flight-reply-target-id={inFlightTurn?.replyToGapId || undefined}
      data-engine2-retry-reply-target-id={retryTarget?.replyToGapId || undefined}
    >
      <section className="engine2-panel engine2-chat-panel" aria-labelledby="engine2-chat-title">
        <header className="engine2-panel-header">
          <h1 id="engine2-chat-title">{copy.conversationTitle}</h1>
          <div className="engine2-header-actions">
            {statusText && <span className="engine2-status-pill">{statusText}</span>}
            {diagnosticsAvailable && (
              <button
                className="engine2-reset-button"
                type="button"
                onClick={() => setDiagEnabled((current) => !current)}
                disabled={loading || continuing || retrying}
              >
                {diagEnabled ? 'Diagnostyka ON' : 'Diagnostyka OFF'}
              </button>
            )}
            <button
              className="engine2-reset-button"
              type="button"
              onClick={resetConversation}
              disabled={loading || continuing || retrying}
            >
              {copy.resetConversationButton}
            </button>
          </div>
        </header>

        <div className="engine2-chat-history" ref={historyRef} aria-live="polite">
          <div className="engine2-message-row engine2-message-row--assistant">
            <div className="engine2-message engine2-message--assistant">
              <p>{copy.initialAssistantMessage}</p>
            </div>
          </div>
          <p className="engine2-chat-hint">{copy.initialAssistantHint}</p>

          {messages.map((message) => (
            <div className={`engine2-message-row engine2-message-row--${message.role}`} key={message.id}>
              <div
                className={`engine2-message engine2-message--${message.role}`}
                data-engine2-chat-message={message.role}
              >
                {message.role === 'user' && message.replyToQuestionId && message.replyToQuestionText && (
                  <p
                    className="engine2-message-reply-context"
                    data-engine2-message-reply-to={message.replyToQuestionId}
                  >
                    <span>{copy.answeredQuestionPrefix}</span>{' '}
                    <strong>{message.replyToQuestionText}</strong>
                  </p>
                )}
                <p>{message.content}</p>
              </div>
            </div>
          ))}
          {(loading || continuing || retrying) && (
            <div className="engine2-message-row engine2-message-row--assistant">
              <div className="engine2-message engine2-message--assistant engine2-message--loading">
                <p>{copy.sendingButton}</p>
              </div>
            </div>
          )}
        </div>

        <div className="engine2-composer">
          {(gateNotice || error) && (
            <div className={`engine2-composer-notice${error ? ' engine2-composer-notice--error' : ''}`} role="status">
              <p>{error || gateNotice}</p>
              {canRetryAnalysis && (
                <button
                  className="engine2-retry-button"
                  type="button"
                  onClick={() => void retryAnalysis()}
                  disabled={!canRetryAnalysis}
                >
                  {copy.retryAnalysisAction}
                </button>
              )}
              {canRetryContinue && (
                <button
                  className="engine2-retry-button"
                  type="button"
                  onClick={retryContinueAfterDecisions}
                  disabled={!canRetryContinue}
                >
                  {copy.retryQuestionGenerationAction}
                </button>
              )}
            </div>
          )}
          {pendingFindings.length > 0 && (
            <section className="engine2-composer-notice engine2-composer-review" aria-label={copy.pendingFindingsTitle}>
              <div className="engine2-composer-review-header">
                <h3>{copy.pendingFindingsTitle}</h3>
                <div className="engine2-findings-bulk-actions">
                  <button
                    className="engine2-findings-bulk-button engine2-findings-bulk-button--primary"
                    type="button"
                    onClick={handleConfirmAll}
                    disabled={loading || continuing || retrying || pendingActionIds.length === 0}
                  >
                    {copy.confirmAllAction}
                  </button>
                  <button
                    className="engine2-findings-bulk-button"
                    type="button"
                    onClick={handleRejectAll}
                    disabled={loading || continuing || retrying || pendingActionIds.length === 0}
                  >
                    {copy.rejectAllAction}
                  </button>
                </div>
              </div>
              <div className="engine2-findings-stack">
                {pendingFindings.map((finding) => (
                  <Engine2FindingCard
                    key={finding.id}
                    finding={finding}
                    copy={copy.findingCard}
                    isEditing={findingState.editingFindingId === finding.id}
                    editingContent={findingState.editingContent}
                    disabled={loading || continuing || retrying}
                    onConfirm={confirmFinding}
                    onReject={rejectFinding}
                    onStartEdit={(id) => dispatchFinding({ type: 'startEdit', id })}
                    onChangeEdit={(content) => dispatchFinding({ type: 'changeEdit', content })}
                    onSaveEdit={saveFindingEdit}
                    onCancelEdit={() => dispatchFinding({ type: 'cancelEdit' })}
                  />
                ))}
              </div>
            </section>
          )}
          {composerReplyQuestion && (
            <div
              className="engine2-selected-question"
              role="status"
              data-engine2-reply-target-id={composerReplyQuestion.id}
            >
              <p>
                {copy.selectedQuestionPrefix}{' '}
                <strong data-engine2-open-question-id={composerReplyQuestion.id}>{composerReplyQuestion.question}</strong>
              </p>
              <button className="engine2-selected-question-action" type="button" onClick={handleClearSelectedQuestion}>
                {copy.clearSelectedQuestionAction}
              </button>
            </div>
          )}
          <textarea
            ref={composerRef}
            className="engine2-composer-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={copy.inputPlaceholder}
            aria-label={copy.inputAriaLabel}
            rows={3}
            maxLength={ENGINE2_MAX_MESSAGE_CHARS}
            disabled={meta.trialEnded || retrying}
          />
          <button
            className="engine2-send-button"
            type="button"
            onClick={() => void sendMessage()}
            disabled={!canSend}
          >
            {loading ? copy.sendingButton : copy.sendButton}
          </button>
        </div>
      </section>

      <aside className="engine2-panel engine2-findings-panel" aria-labelledby="engine2-findings-title">
        <header className="engine2-panel-header">
          <h2 id="engine2-findings-title">{copy.findingsTitle}</h2>
          <div className="engine2-progress" aria-label={copy.progressLabel}>
            <span>{copy.progressLabel}</span>
            <strong>{readinessLabel}</strong>
          </div>
        </header>
        <section className="engine2-findings-section engine2-tensions-section" aria-label="Napięcia/sprzeczności">
          <div className="engine2-findings-section-header">
            <h3>Napięcia/sprzeczności</h3>
            <span className="engine2-counter-pill">{contradictionCounterText}</span>
          </div>
          {visibleTensions.length > 0 ? (
            <ul className="engine2-map-list">
              {visibleTensions.map((entry) => (
                <li className="engine2-map-list-item engine2-map-list-item--tension" key={entry.id}>
                  <p><strong>{entry.description}</strong></p>
                  {(entry.sideA || entry.sideB) && (
                    <p className="engine2-tension-sides">
                      {[entry.sideA, entry.sideB].filter(Boolean).join(' ↔ ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="engine2-findings-empty">{tensionEmptyText}</p>
          )}
        </section>
        <div className="engine2-findings-list" aria-label={copy.findingsTitle}>
          <section className="engine2-findings-section" aria-label={copy.knowledgeTitle}>
            <div className="engine2-findings-section-header">
              <h3>{copy.knowledgeTitle}</h3>
              {knowledgeSummaryAll.length > 3 && (
                <button
                  className="engine2-inline-action"
                  type="button"
                  onClick={() => setShowAllKnowledge((current) => !current)}
                >
                  {showAllKnowledge ? copy.knowledgeShowLessAction : copy.knowledgeShowMoreAction}
                </button>
              )}
            </div>
            {knowledgeSummary.length > 0 ? (
              <ul className="engine2-map-list">
                {knowledgeSummary.map((item) => (
                  <li className="engine2-map-list-item" key={item.sourceFindingId}>
                    <p>{item.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="engine2-findings-empty">{copy.knowledgeEmpty}</p>
            )}
          </section>

          <section className="engine2-findings-section" aria-label={copy.openQuestionsTitle}>
            <div className="engine2-findings-section-header">
              <h3>{copy.openQuestionsTitle}</h3>
            </div>
            {panelQuestionDisplayState === 'pending_notice' && (
              <p className="engine2-findings-empty">{copy.openQuestionsWaiting}</p>
            )}
            {panelQuestionDisplayState === 'loading' && (
              <p className="engine2-findings-empty" role="status">{copy.sendingButton}</p>
            )}
            {panelQuestionDisplayState === 'questions' ? (
              <ul className="engine2-map-list engine2-map-list--questions">
                {meta.openQuestions.map((entry) => (
                  <li className="engine2-map-list-item engine2-map-list-item--question" key={entry.id}>
                    <p
                      data-engine2-open-question-id={entry.id}
                      data-engine2-question-presentation={entry.presentation || 'panel'}
                    >
                      {entry.question}
                    </p>
                    <button
                      className="engine2-inline-action"
                      type="button"
                      onClick={() => handleSelectOpenQuestion(entry.id)}
                      disabled={loading || continuing || retrying || decisionGateActive || meta.trialEnded}
                    >
                      {copy.openQuestionsAnswerAction}
                    </button>
                  </li>
                ))}
              </ul>
            ) : panelQuestionDisplayState === 'guide_notice' ? (
              <div className="engine2-findings-empty">
                <p>{meta.guideNotice}</p>
                {canRetryContinue && (
                  <button
                    className="engine2-inline-action"
                    type="button"
                    onClick={retryContinueAfterDecisions}
                  >
                    {copy.retryQuestionGenerationAction}
                  </button>
                )}
              </div>
            ) : panelQuestionDisplayState === 'empty' ? (
              <p className="engine2-findings-empty">{copy.openQuestionsEmpty}</p>
            ) : null}
          </section>
        </div>
        {meta.reportAvailable && (
          <section className="engine2-result-note" aria-live="polite">
            <h3>{copy.reportReadyTitle}</h3>
            <p>{copy.reportReadyBody}</p>
            <button className="engine2-disabled-cta" type="button" disabled>
              {copy.reportCtaDisabled}
            </button>
          </section>
        )}
        {meta.trialEnded && (
          <section className="engine2-result-note" aria-live="polite">
            <h3>{copy.trialEndedTitle}</h3>
            <p>{copy.trialEndedBody}</p>
          </section>
        )}
        {diagnosticsEnabled && meta.adminUsage && (
          <section className="engine2-admin-usage" aria-label={copy.adminUsageTitle}>
            <h3>{copy.adminUsageTitle}</h3>
            <p>
              {copy.adminTotal}: {formatNumber(meta.adminUsage.totals.totalTokens, language)} tok · $
              {formatNumber(meta.adminUsage.totals.costUsd, language, 4)}
            </p>
            {meta.adminUsage.lastCall && (
              <p>
                {copy.adminLastCall}: {copy.adminModel} {meta.adminUsage.lastCall.model} · {copy.adminTokens}{' '}
                {formatNumber(meta.adminUsage.lastCall.inputTokens, language)}/
                {formatNumber(meta.adminUsage.lastCall.outputTokens, language)} · {copy.adminCost} $
                {formatNumber(meta.adminUsage.lastCall.costUsd, language, 4)}
              </p>
            )}
          </section>
        )}
        {diagEnabled && (
          <section className="engine2-admin-usage engine2-diagnostics-panel" aria-label="Engine 2 diagnostics">
            <div className="engine2-findings-section-header">
              <h3>Diagnostyka</h3>
              <div className="engine2-findings-bulk-actions">
                <button className="engine2-findings-bulk-button" type="button" onClick={handleShowSessionState}>
                  Pokaż stan sesji
                </button>
                <button className="engine2-findings-bulk-button" type="button" onClick={() => void handleCopyDiagnostics()}>
                  Kopiuj diagnostykę
                </button>
                <button className="engine2-findings-bulk-button" type="button" onClick={() => void handleCopyCompactDiagnostics()}>
                  Kopiuj diagnostykę skróconą
                </button>
                <button className="engine2-findings-bulk-button" type="button" onClick={handleClearDiagnostics}>
                  Wyczyść diagnostykę
                </button>
              </div>
            </div>
            {diagStorageWarning && (
              <p className="engine2-diagnostics-warning" role="status">
                {diagStorageWarning}
              </p>
            )}
            {diagSessionState && (
              <details className="engine2-diagnostics-trace">
                <summary>Stan sesji</summary>
                <pre>{JSON.stringify(diagSessionState, null, 2)}</pre>
              </details>
            )}
            {diagTraces.map((trace) => (
              <details className="engine2-diagnostics-trace" key={trace.traceId}>
                <summary>
                  {trace.traceId} · {trace.action ?? 'unknown'}{trace.isDryRun ? ' · dry run' : ''}
                </summary>
                <div className="engine2-findings-bulk-actions">
                  <button className="engine2-findings-bulk-button" type="button" onClick={() => void handleCopyTrace(trace)}>
                    Kopiuj trace jako JSON
                  </button>
                  <button className="engine2-findings-bulk-button" type="button" onClick={() => void rerunTraceAnalysis(trace)}>
                    Ponów analizę tej wiadomości
                  </button>
                </div>
                <div className="engine2-diagnostics-timeline">
                  {trace.stages.map((stage, index) => (
                    <details className={`engine2-diagnostics-stage engine2-diagnostics-stage--${stage.status}`} key={`${stage.name}-${index}`}>
                      <summary>
                        <span className="engine2-diagnostics-stage-dot" aria-hidden="true" />
                        {stage.name}
                        {stage.alarms.length > 0 ? ` · ${stage.alarms.join(', ')}` : ''}
                      </summary>
                      <pre>{JSON.stringify(stage.data, null, 2)}</pre>
                    </details>
                  ))}
                </div>
                <pre>{JSON.stringify(trace, null, 2)}</pre>
              </details>
            ))}
          </section>
        )}
      </aside>
    </main>
  )
}
