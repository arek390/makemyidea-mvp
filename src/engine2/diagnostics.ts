/* TEMP_ENGINE2_DIAGNOSTICS */

import type { Engine2Finding } from './findingState'
import type { Engine2PersistedState } from './sessionState'
import type { Engine2OpenQuestion } from './conversationGuide'

export const ENGINE2_DIAGNOSTICS_STORAGE_KEY = 'engine2-public-diagnostics-v1'
export const ENGINE2_DIAGNOSTICS_MAX_STORED_TRACES = 20
const ENGINE2_DIAGNOSTICS_STORAGE_PREFIX = 'engine2-public-diagnostics-'
const ENGINE2_DIAGNOSTICS_PREVIEW_CHARS = 1200
const ENGINE2_DIAGNOSTICS_TEXT_CHARS = 4000

export type Engine2DiagnosticsWriteResult = {
  ok: boolean
  diagnosticsBytesBeforeWrite: number
  diagnosticsBytesAfterPrune: number
  diagnosticsStorageWriteFailed: boolean
  diagnosticsPrunedTraceCount: number
  error: string | null
}

type Engine2CompactDiagnosticCall = {
  action: string
  model: string
  llmCalls: number
  llmLatencyMs: number
  totalBackendMs: number
}

type Engine2CompactDiagnosticQuestion = {
  text: string
  semanticKey?: string | null
  targetType?: string | null
  targetContradictionId?: string | null
}

export type Engine2CompactDiagnostics = {
  exportedAt: string
  compactDiagnosticsBytes: number
  fullDiagnosticsBytes: number
  sessionSummary: {
    successfulTrialTurns: number
    providerCalls: number
  }
  timing: {
    acceptToQuestionsRenderedMs: number | null
    criticalPathLlmCalls: number | null
  }
  calls: Engine2CompactDiagnosticCall[]
  questions: {
    panelQuestionCount: number
    generationAttemptCount: number
    raw: Engine2CompactDiagnosticQuestion[]
    applied: Engine2CompactDiagnosticQuestion[]
  }
  contradictions: {
    triggered: boolean
    completed: boolean
    count: number
  }
  readiness: {
    evaluated: boolean
    score: number | null
    reportAvailable: boolean
  }
  warnings: string[]
}

export type Engine2BackendTrace = Record<string, unknown> & {
  traceId?: string
  messageId?: string
  action?: string
}

export type Engine2DiagnosticStage = {
  name: string
  status: 'green' | 'yellow' | 'red'
  data: Record<string, unknown>
  alarms: string[]
}

export type Engine2DomSnapshot = {
  traceId: string | null
  chatText: string | null
  activeQuestionId: string | null
  openQuestions: Array<{ id: string; text: string }>
}

export type Engine2FrontendTrace = {
  traceId: string
  messageId: string | null
  action: string | null
  createdAt: string
  isDryRun: boolean
  backendTrace: Engine2BackendTrace | null
  apiResponse: Record<string, unknown> | null
  stages: Engine2DiagnosticStage[]
  frontend: {
    requestId: string | null
    turnId: string | null
    stateVersionReturned: number
    stateVersionBeforeApply: number
    responseDecision: 'applied' | 'ignored_as_stale' | 'not_applied' | 'partial_applied' | 'decision_applied_continue_failed' | null
    responseStartedAt: string | null
    responseFinishedAt: string | null
    requestStatus: 'pending' | 'success' | 'error' | 'ignored_as_stale' | null
    responseOrigin: string | null
    frontendAppliedAt: string | null
    domCapturedAt: string | null
    alarms: string[]
    gapsBeforeApply: Engine2OpenQuestion[]
    gapsAfterApply: Engine2OpenQuestion[]
    nextQuestionBeforeApply: string | null
    nextQuestionAfterApply: string | null
    activeQuestionBeforeApply: string | null
    activeQuestionAfterApply: string | null
    stateApplyMode: 'replaced' | 'merged' | 'unchanged' | null
    replyTargetCleared: boolean | null
    composerReplyTargetBeforeSubmit: string | null
    composerReplyTargetAfterSubmit: string | null
    inFlightReplyToQuestionId: string | null
    retryReplyToQuestionId: string | null
    rawReplyToGapId: string | null
    effectiveReplyToGapId: string | null
    replyTargetSource: 'explicit_composer' | 'active_ask_now' | 'none' | null
    turnApplied: boolean | null
    analysisStatus: string | null
    isAnalyzingFalseAt: string | null
    pendingPackageId: string | null
    pendingPackageExpectedCount: number
    pendingPackageProposalCount: number
    pendingPackageDecisionCount: number
    continueGateReason: string | null
    decisionPackageBefore: Record<string, unknown> | null
    decisionPackageAfter: Record<string, unknown> | null
    allPackageItemsDecided: boolean | null
    shouldTriggerContinueAfterDecisions: boolean | null
    continueAfterDecisionsTriggered: boolean
    continueAfterDecisionsTraceId: string | null
    generatePanelQuestionsTriggered: boolean
    generatePanelQuestionsTraceId: string | null
    generatePanelQuestionsStartedAt: string | null
    generatePanelQuestionsFinishedAt: string | null
    generatePanelQuestionsDurationMs: number
    generatePanelQuestionsInputBytes: number
    generatePanelQuestionsOutputBytes: number
    generatePanelQuestionsAttemptCount: number
    generatePanelQuestionsTimeoutMs: number
    generatePanelQuestionsInputHash: string | null
    generatePanelQuestionsInputPreview: string | null
    providerCallStartedAt: string | null
    providerCallResolvedAt: string | null
    providerCallAbortedAt: string | null
    abortReason: string | null
    timeoutSource: string | null
    model: string | null
    responseFormatName: string | null
    skippedReadinessBecause: string | null
    skippedContradictionsBecause: string | null
    questionsRenderedBeforeReadiness: boolean
    questionCandidatesRaw: unknown[]
    questionCandidatesApplied: unknown[]
    panelQuestionCount: number
    findingDecisionSubmitStarted: boolean
    findingDecisionSubmitFinished: boolean
    findingDecisionSubmitFailed: boolean
    acceptClickedAt: string | null
    panelQuestionsRenderedAt: string | null
    acceptToQuestionsRenderedMs: number | null
    criticalPathLlmCalls: number | null
    decisionSubmissionInFlight: boolean
    decisionSubmissionStartedAt: string | null
    decisionSubmissionDurationMs: number | null
    decisionSubmitPackageId: string | null
    decisionSubmitFindingIds: string[]
    decisionSubmitRequestId: string | null
    decisionSubmitError: string | null
    findingDiagnostics: Record<string, unknown>
    contradictionDiagnostics: Record<string, unknown>
    questionDiagnostics: Record<string, unknown>
    nextActionDiagnosis: Record<string, unknown>
    stateConsistencyWarnings: string[]
    deadEndInvariantResult: Record<string, unknown> | null
    receivedFindingProposals: Engine2Finding[]
    reactFindingProposals: Engine2Finding[]
    reactAllFindings: Engine2Finding[]
    sessionStorageState: Engine2PersistedState | null
    sessionStorageReloadedState: Engine2PersistedState | null
    renderedPendingFindings: string[]
    renderedKnowledge: string[]
    renderedOpenQuestions: string[]
    renderedChatText: string | null
    renderedDomTraceId: string | null
    diagnosticsBytesBeforeWrite?: number
    diagnosticsBytesAfterPrune?: number
    diagnosticsStorageWriteFailed?: boolean
    diagnosticsPrunedTraceCount?: number
    readinessEvaluationTriggered?: boolean
    readinessEvaluationCompleted?: boolean
    readinessEvaluationSkippedReason?: string | null
    readinessIsDefaultValue?: boolean
    contradictionDetectionTriggered?: boolean
    contradictionDetectionTraceId?: string | null
    contradictionDetectionCompleted?: boolean
    contradictionDetectionSkippedReason?: string | null
    contradictionChangesRaw?: unknown[]
    contradictionChangesApplied?: unknown[]
    contradictionExtractionStatus?: 'not_evaluated' | 'evaluated' | 'failed'
    contradictionPipelineStatus?: 'none_detected' | 'formal_detected' | 'soft_detected_only' | 'detected_not_registered' | 'failed'
    softTensionSignals?: unknown[]
    softTensionSignalsCount?: number
    hasTradeoffsOrContradictions?: boolean
    formalExtractedContradictionCount?: number | null
    formalActiveContradictionCount?: number | null
    extractedContradictionCount?: number | null
    activeContradictionCount?: number | null
    resolvedContradictionCount?: number | null
    dismissedContradictionCount?: number | null
    lastContradictionEvaluationTraceId?: string | null
    lastContradictionEvaluationAt?: string | null
  }
}

const safeWindow = () => (typeof window !== 'undefined' ? window : null)
const findingDisplayText = (finding: Engine2Finding) =>
  String(finding.displayText || finding.content || '').replace(/\s+/g, ' ').trim()
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const byteLength = (value: string) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length
  return value.length
}

const countByStatus = (entries: unknown[], knownStatuses: string[] = []) => {
  const counts: Record<string, number> = Object.fromEntries(knownStatuses.map((status) => [status, 0]))
  for (const entry of entries) {
    const status = String(objectValue(entry).status || 'unknown')
    counts[status] = (counts[status] || 0) + 1
  }
  counts.total = entries.length
  return counts
}

const findingDiagnostics = ({
  findings,
  findingEvents,
  findingProposals,
  pendingDecisionPackageId,
}: {
  findings: unknown[]
  findingEvents: unknown[]
  findingProposals: unknown[]
  pendingDecisionPackageId: string | null
}) => {
  const visiblePendingProposals = findingProposals.filter((entry) => objectValue(entry).status === 'pending')
  const packageFindings = pendingDecisionPackageId
    ? findings.filter((entry) => objectValue(entry).packageId === pendingDecisionPackageId)
    : []
  const decisionEvents = findingEvents.filter((event) => Boolean(objectValue(event).decisionSource))
  const missingDecisionSource = findings
    .filter((entry) => ['confirmed', 'rejected'].includes(String(objectValue(entry).status || '')))
    .filter((entry) => !objectValue(entry).decisionSource)
    .map((entry) => objectValue(entry).id)
    .filter(Boolean)
  const packagePendingCount = packageFindings.filter((entry) => objectValue(entry).status === 'pending').length
  const packageStatus = !pendingDecisionPackageId
    ? 'none'
    : visiblePendingProposals.length > 0 || packagePendingCount > 0
      ? 'visible_pending'
      : packageFindings.length > 0 && packageFindings.every((entry) => ['confirmed', 'rejected'].includes(String(objectValue(entry).status || '')))
        ? 'decided_waiting_continue'
        : 'inconsistent'
  return {
    statusCounts: countByStatus(findings, ['pending', 'confirmed', 'rejected']),
    visiblePendingProposalsCount: visiblePendingProposals.length,
    decisionEventsCount: decisionEvents.length,
    lastDecisionEvent: decisionEvents.at(-1) || null,
    pendingPackageStatus: packageStatus,
    pendingPackageFindingCount: packageFindings.length,
    pendingPackagePendingCount: packagePendingCount,
    confirmedOrRejectedWithoutDecisionSourceIds: missingDecisionSource,
  }
}

const contradictionDiagnostics = ({
  contradictions,
  detectedCandidates,
  appliedChanges,
  findings,
  detectionEvaluated,
  detectionFailed,
  detectionMeta = {},
  softTensionSignals = [],
  pipelineStatus = null,
}: {
  contradictions: unknown[]
  detectedCandidates: unknown[]
  appliedChanges: unknown[]
  findings: unknown[]
  detectionEvaluated: boolean
  detectionFailed: boolean
  detectionMeta?: Record<string, unknown>
  softTensionSignals?: unknown[]
  pipelineStatus?: string | null
}) => ({
  inputConfirmedFindingsCount: findings.filter((entry) => objectValue(entry).status === 'confirmed').length,
  detectedRawContradictionCount: Number(detectionMeta.detectedRawContradictionCount ?? detectedCandidates.length),
  rejectedContradictionCandidateCount: Number(detectionMeta.rejectedContradictionCandidateCount ?? 0),
  appliedContradictionCount: appliedChanges.length,
  detectedCandidatesCount: Number(detectionMeta.detectedRawContradictionCount ?? detectedCandidates.length),
  appliedCount: appliedChanges.length,
  byStatus: countByStatus(contradictions, ['suspected', 'open', 'confirmed', 'active', 'resolved', 'dismissed', 'superseded']),
  openContradictionsCount: contradictions.filter((entry) =>
    ['suspected', 'open', 'confirmed', 'active'].includes(String(objectValue(entry).status || ''))
  ).length,
  contradictionExtractionStatus: detectionFailed ? 'failed' : detectionEvaluated ? 'evaluated' : 'not_evaluated',
  extractedContradictionCount: detectionEvaluated
    ? contradictions.filter((entry) => ['suspected', 'open', 'confirmed', 'active'].includes(String(objectValue(entry).status || ''))).length + softTensionSignals.length
    : null,
  activeContradictionCount: detectionEvaluated
    ? contradictions.filter((entry) => ['suspected', 'open', 'confirmed', 'active'].includes(String(objectValue(entry).status || ''))).length + softTensionSignals.length
    : null,
  contradictionPipelineStatus: pipelineStatus,
  softTensionSignals,
  softTensionSignalsCount: softTensionSignals.length,
  hasTradeoffsOrContradictions: softTensionSignals.length > 0 ||
    contradictions.some((entry) => ['suspected', 'open', 'confirmed', 'active'].includes(String(objectValue(entry).status || ''))),
  formalExtractedContradictionCount: contradictions.filter((entry) => ['suspected', 'open', 'confirmed', 'active', 'resolved'].includes(String(objectValue(entry).status || ''))).length,
  formalActiveContradictionCount: contradictions.filter((entry) => ['suspected', 'open', 'confirmed', 'active'].includes(String(objectValue(entry).status || ''))).length,
  resolvedContradictionCount: detectionEvaluated
    ? contradictions.filter((entry) => objectValue(entry).status === 'resolved').length
    : null,
  dismissedContradictionCount: detectionEvaluated
    ? contradictions.filter((entry) => objectValue(entry).status === 'dismissed').length
    : null,
  acceptedContradictionCandidateCount: Number(detectionMeta.acceptedContradictionCandidateCount ?? 0),
  repairedContradictionCandidates: arrayValue(detectionMeta.repairedContradictionCandidates),
  weakGroundingContradictionCandidateCount: Number(detectionMeta.weakGroundingContradictionCandidateCount ?? 0),
  skipReason: detectionEvaluated || detectionFailed ? null : 'contradiction_detection_not_evaluated',
})

const questionDiagnostics = ({
  rawCandidates,
  appliedCandidates,
  readinessValidation,
  readinessEvaluated,
  questionGenerationAttempted,
  questionGenerationFailed,
  questionGenerationError,
  retryableQuestionGeneration,
}: {
  rawCandidates: unknown[]
  appliedCandidates: unknown[]
  readinessValidation: Record<string, unknown>
  readinessEvaluated: boolean
  questionGenerationAttempted: boolean
  questionGenerationFailed: boolean
  questionGenerationError: unknown
  retryableQuestionGeneration: boolean
}) => {
  const validationErrors = arrayValue(readinessValidation.errors).map((entry) => String(entry))
  return {
    questionGenerationAttempted,
    questionGenerationFailed,
    questionGenerationError,
    retryableQuestionGeneration,
    questionCandidatesRawCount: rawCandidates.length,
    questionCandidatesAppliedCount: appliedCandidates.length,
    questionCandidatesRejectedCount: Math.max(0, rawCandidates.length - appliedCandidates.length),
    questionCandidateRejectReasons: validationErrors,
    panelQuestionCount: appliedCandidates.length,
    readinessEvaluated,
    readinessSkipReason: readinessEvaluated ? null : 'readiness_not_evaluated',
  }
}

const buildStateConsistencyWarnings = ({
  payload,
  findings,
  findingDiag,
  panelQuestionCount,
}: {
  payload: Record<string, unknown> | null
  findings: unknown[]
  findingDiag: Record<string, unknown>
  panelQuestionCount: number
}) => {
  const warnings: string[] = []
  const pendingDecisionPackageId = String(payload?.pendingDecisionPackageId || '') || null
  if (
    pendingDecisionPackageId &&
    findingDiag.pendingPackageStatus !== 'visible_pending' &&
    Number(findingDiag.visiblePendingProposalsCount || 0) === 0
  ) warnings.push('pending_package_without_visible_pending_proposals')
  if (arrayValue(findingDiag.confirmedOrRejectedWithoutDecisionSourceIds).length > 0) {
    warnings.push('confirmed_or_rejected_finding_without_decision_source')
  }
  if (
    payload &&
    !payload.reportAvailable &&
    !payload.trialEnded &&
    !payload.retryable &&
    !payload.pendingDecisionPackageId &&
    panelQuestionCount !== 3
  ) warnings.push('no_next_action_without_three_panel_questions')
  if (findings.length !== countByStatus(findings).total) warnings.push('finding_count_mismatch')
  return warnings
}

const buildDiagnosticSummary = ({
  payload,
  backendTrace = null,
  sessionState = null,
}: {
  payload: Record<string, unknown> | null
  backendTrace?: Engine2BackendTrace | null
  sessionState?: Engine2PersistedState | null
}) => {
  const snapshot = objectValue(payload?.sessionSnapshot)
  const findings = arrayValue(sessionState?.findings ?? snapshot.findings ?? payload?.findingUpdates)
  const findingEvents = arrayValue(sessionState?.findingEvents ?? snapshot.findingEvents ?? payload?.findingEvents)
  const findingProposals = arrayValue(payload?.findingProposals)
  const contradictions = arrayValue(sessionState?.contradictions ?? snapshot.contradictions ?? payload?.contradictions)
  const rawCandidates = arrayValue(payload?.questionCandidates ?? backendTrace?.questionCandidatesRaw ?? backendTrace?.questionCandidates)
  const appliedCandidates = arrayValue(payload?.panelQuestions ?? payload?.openQuestions ?? backendTrace?.questionCandidatesApplied)
  const detectedCandidates = arrayValue(payload?.detectedContradictionCandidates ?? backendTrace?.detectedContradictionCandidates)
  const appliedContradictionChanges = arrayValue(payload?.appliedContradictionChanges ?? backendTrace?.appliedContradictionChanges)
  const contradictionDetectorMeta = objectValue(backendTrace?.contradictionDetectorDiagnostics)
  const softTensionSignals = arrayValue(
    payload?.softTensionSignals ??
    snapshot.softTensionSignals ??
    sessionState?.softTensionSignals ??
    contradictionDetectorMeta.softTensionSignals
  )
  const pipelineStatus = String(
    payload?.contradictionPipelineStatus ??
    snapshot.contradictionPipelineStatus ??
    sessionState?.contradictionPipelineStatus ??
    ''
  ) || null
  const readinessEvaluated = Boolean(
    backendTrace?.readinessEvaluation ||
    (payload?.readinessDecisionSource && payload.readinessDecisionSource !== 'not_evaluated_during_user_turn') ||
    objectValue(payload?.readiness).status === 'evaluated'
  )
  const readinessStatus = String(objectValue(payload?.readiness).status || objectValue(snapshot.readiness).status || '')
  const readinessEvaluationTriggered = Boolean(payload?.readinessEvaluationTriggered || backendTrace?.readinessEvaluationTriggered || payload?.action === 'evaluate_readiness')
  const readinessEvaluationCompleted = Boolean(payload?.readinessEvaluationCompleted || backendTrace?.readinessEvaluationCompleted || readinessEvaluated)
  const readinessEvaluationSkippedReason = String(payload?.readinessEvaluationSkippedReason || backendTrace?.readinessEvaluationSkippedReason || '') ||
    (readinessEvaluationTriggered ? null : 'readiness_not_evaluated')
  const readinessIsDefaultValue = !readinessEvaluated && readinessStatus !== 'failed'
  const actionName = String(payload?.action || backendTrace?.action || '')
  const sessionContradictionStatus = sessionState?.contradictionExtractionStatus
  const contradictionDetectionTriggered = Boolean(
    payload?.contradictionDetectionTriggered ||
    backendTrace?.contradictionDetectionTriggered ||
    actionName === 'detect_contradictions'
  )
  const contradictionDetectionCompleted = Boolean(
    payload?.contradictionDetectionCompleted ||
    backendTrace?.contradictionDetectionCompleted ||
    sessionContradictionStatus === 'evaluated'
  )
  const contradictionDetectionFailed = Boolean(
    payload?.retryableContradictionDetectionError ||
    sessionContradictionStatus === 'failed' ||
    (actionName === 'detect_contradictions' && !contradictionDetectionCompleted)
  )
  const readinessValidation = objectValue(objectValue(backendTrace?.readinessEvaluation).validation)
  const questionGenerationAttempted = Boolean(
    payload?.questionGenerationAttempted ||
    backendTrace?.questionGenerationAttempted ||
    backendTrace?.questionGeneration
  )
  const questionGenerationFailed = Boolean(payload?.questionGenerationFailed || backendTrace?.questionGenerationFailed)
  const pendingDecisionPackageId = String(payload?.pendingDecisionPackageId || sessionState?.pendingDecisionPackageId || '') || null
  const findingDiag = findingDiagnostics({ findings, findingEvents, findingProposals, pendingDecisionPackageId })
  const contradictionDiag = contradictionDiagnostics({
    contradictions,
    detectedCandidates,
    appliedChanges: appliedContradictionChanges,
    findings,
	    detectionEvaluated: contradictionDetectionCompleted,
	    detectionFailed: contradictionDetectionFailed,
	    detectionMeta: contradictionDetectorMeta,
	    softTensionSignals,
	    pipelineStatus,
	  })
  const questionDiag = questionDiagnostics({
    rawCandidates,
    appliedCandidates,
    readinessValidation,
    readinessEvaluated,
    questionGenerationAttempted,
    questionGenerationFailed,
    questionGenerationError: payload?.questionGenerationError || backendTrace?.questionGenerationError || null,
    retryableQuestionGeneration: Boolean(payload?.retryableQuestionGeneration || backendTrace?.retryableQuestionGeneration),
  })
  const stateWarnings = buildStateConsistencyWarnings({
    payload,
    findings,
    findingDiag,
    panelQuestionCount: appliedCandidates.length,
  })
  const expectedNextAction = payload?.retryable
    ? 'show_retry_error'
    : payload?.reportAvailable
      ? 'show_report'
      : payload?.trialEnded
        ? 'trial_ended'
        : pendingDecisionPackageId
          ? 'wait_for_user_decision'
          : appliedCandidates.length === 3
            ? 'show_3_panel_questions'
            : readinessEvaluated
              ? 'show_retry_error'
              : 'run_generate_panel_questions'
  const blockingReason = String(payload?.diagnosticCode || '') ||
    (pendingDecisionPackageId ? String(findingDiag.pendingPackageStatus || 'PACKAGE_STILL_PENDING') : '') ||
    arrayValue(payload?.reportBlockedReasons)[0] ||
    (stateWarnings[0] || null)
  const nextActionDiag = {
    expectedNextAction,
    blockingReason,
    hasVisiblePendingProposal: Number(findingDiag.visiblePendingProposalsCount || 0) > 0,
    allPackageItemsDecided: findingDiag.pendingPackageStatus === 'decided_waiting_continue',
    continueAfterDecisionsTriggered: String(payload?.action || backendTrace?.action || '') === 'generate_panel_questions',
    generatePanelQuestionsTriggered: String(payload?.action || backendTrace?.action || '') === 'generate_panel_questions',
    readinessEvaluated,
    panelQuestionCount: appliedCandidates.length,
    openContradictionsCount: contradictionDiag.openContradictionsCount,
    stateConsistent: stateWarnings.length === 0,
  }
  return {
    findingDiagnostics: findingDiag,
    contradictionDiagnostics: {
      ...contradictionDiag,
      contradictionDetectionTriggered,
      contradictionDetectionTraceId: String(payload?.contradictionDetectionTraceId || backendTrace?.contradictionDetectionTraceId || '') || null,
      contradictionDetectionCompleted,
      contradictionDetectionSkippedReason: String(payload?.contradictionDetectionSkippedReason || backendTrace?.contradictionDetectionSkippedReason || '') || null,
    },
    questionDiagnostics: questionDiag,
    nextActionDiagnosis: nextActionDiag,
    stateConsistencyWarnings: stateWarnings,
    readinessDiagnostics: {
      readinessStatus: readinessStatus || (readinessEvaluated ? 'evaluated' : 'not_evaluated'),
      readinessEvaluationTriggered,
      readinessEvaluationCompleted,
      readinessEvaluationSkippedReason,
      readinessIsDefaultValue,
    },
  }
}
const decisionPackageSnapshot = ({
  packageId,
  expectedProposalCount,
  packageProposalCount,
  packageDecisionCount,
}: {
  packageId: string | null
  expectedProposalCount: number
  packageProposalCount: number
  packageDecisionCount: number
}) => {
  const pendingCount = Math.max(0, packageProposalCount - packageDecisionCount)
  const allDecided = Boolean(packageId) &&
    packageProposalCount > 0 &&
    packageDecisionCount >= Math.max(expectedProposalCount, packageProposalCount)
  return {
    packageId,
    expectedProposalCount,
    packageProposalCount,
    packageDecisionCount,
    packagePendingCount: pendingCount,
    allPackageItemsDecided: allDecided,
  }
}
const deadEndInvariantResult = (payload: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!payload) return null
  const backendResults = arrayValue(payload.backendInvariantResults)
  const explicit = backendResults.find((entry) =>
    entry &&
    typeof entry === 'object' &&
    String((entry as { invariant?: unknown }).invariant || '') === 'dead_end_next_action'
  )
  if (explicit && typeof explicit === 'object') return explicit as Record<string, unknown>
  if (payload.diagnosticCode === 'DEAD_END_NO_NEXT_ACTION') {
    return { invariant: 'dead_end_next_action', passed: false, diagnosticCode: 'DEAD_END_NO_NEXT_ACTION' }
  }
  return null
}

export const canUseEngine2Diagnostics = (adminEnabled: boolean) => {
  const win = safeWindow()
  if (!win) return adminEnabled
  const localHost = ['localhost', '127.0.0.1'].includes(win.location.hostname)
  return adminEnabled || import.meta.env.DEV || localHost
}

export const isEngine2DiagnosticsRequested = () => {
  const win = safeWindow()
  if (!win) return false
  return new URLSearchParams(win.location.search).get('engine2debug') === '1'
}

export const readEngine2Diagnostics = (): Engine2FrontendTrace[] => {
  const win = safeWindow()
  if (!win) return []
  try {
    const raw = win.sessionStorage.getItem(ENGINE2_DIAGNOSTICS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Engine2FrontendTrace[]) : []
  } catch {
    return []
  }
}

const truncatedText = (value: string, max = ENGINE2_DIAGNOSTICS_TEXT_CHARS) =>
  value.length > max
    ? `${value.slice(0, max)}...[truncated ${value.length - max} chars]`
    : value

const compactLargeDiagnosticValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncatedText(value, depth > 2 ? ENGINE2_DIAGNOSTICS_PREVIEW_CHARS : ENGINE2_DIAGNOSTICS_TEXT_CHARS)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const limit = depth > 2 ? 12 : 40
    const items = value.slice(0, limit).map((entry) => compactLargeDiagnosticValue(entry, depth + 1))
    return value.length > limit
      ? [...items, { truncatedItems: value.length - limit }]
      : items
  }
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(input)) {
    if (['sessionSnapshot', 'sessionStorageState', 'sessionStorageReloadedState'].includes(key)) {
      output[key] = null
      output[`${key}Pruned`] = true
      continue
    }
    if (key === 'apiResponse') {
      const response = objectValue(entry)
      output[key] = {
        action: response.action ?? null,
        requestId: response.requestId ?? null,
        turnId: response.turnId ?? null,
        responseOrigin: response.responseOrigin ?? null,
        analysisStatus: response.analysisStatus ?? null,
        turnApplied: response.turnApplied ?? null,
        retryable: response.retryable ?? null,
        pendingDecisionPackageId: response.pendingDecisionPackageId ?? null,
        reportAvailable: response.reportAvailable ?? null,
        panelQuestionCount: arrayValue(response.panelQuestions ?? response.openQuestions).length,
        findingProposalsCount: arrayValue(response.findingProposals).length,
        findingUpdatesCount: arrayValue(response.findingUpdates).length,
        apiResponsePruned: true,
      }
      continue
    }
    if (key === 'rawOutput') {
      output[key] = typeof entry === 'string'
        ? truncatedText(entry, ENGINE2_DIAGNOSTICS_PREVIEW_CHARS)
        : null
      output.rawOutputPruned = true
      continue
    }
    output[key] = compactLargeDiagnosticValue(entry, depth + 1)
  }
  return output
}

export const pruneEngine2DiagnosticsForStorage = (traces: Engine2FrontendTrace[]) => {
  const source = Array.isArray(traces) ? traces : []
  const kept = source.slice(0, ENGINE2_DIAGNOSTICS_MAX_STORED_TRACES)
  const diagnosticsPrunedTraceCount = Math.max(0, source.length - kept.length)
  const pruned = kept.map((trace) => {
    const compact = compactLargeDiagnosticValue(trace) as Engine2FrontendTrace
    return {
      ...compact,
      apiResponse: compactLargeDiagnosticValue(trace.apiResponse) as Record<string, unknown> | null,
      backendTrace: compactLargeDiagnosticValue(trace.backendTrace) as Engine2BackendTrace | null,
      frontend: {
        ...compact.frontend,
        sessionStorageState: null,
        sessionStorageReloadedState: null,
        diagnosticsPrunedTraceCount,
      },
    } satisfies Engine2FrontendTrace
  })
  return { traces: pruned, diagnosticsPrunedTraceCount }
}

export const writeEngine2Diagnostics = (traces: Engine2FrontendTrace[]): Engine2DiagnosticsWriteResult => {
  const win = safeWindow()
  const raw = JSON.stringify(Array.isArray(traces) ? traces : [])
  const diagnosticsBytesBeforeWrite = byteLength(raw)
  const pruned = pruneEngine2DiagnosticsForStorage(traces)
  let serialized = JSON.stringify(pruned.traces)
  let diagnosticsBytesAfterPrune = byteLength(serialized)
  const baseResult = {
    diagnosticsBytesBeforeWrite,
    diagnosticsBytesAfterPrune,
    diagnosticsPrunedTraceCount: pruned.diagnosticsPrunedTraceCount,
  }
  if (!win) {
    return { ...baseResult, ok: false, diagnosticsStorageWriteFailed: true, error: 'window_unavailable' }
  }
  try {
    win.sessionStorage.setItem(ENGINE2_DIAGNOSTICS_STORAGE_KEY, serialized)
    return { ...baseResult, ok: true, diagnosticsStorageWriteFailed: false, error: null }
  } catch (error) {
    try {
      const fallbackTraces = pruned.traces.slice(0, 3)
      serialized = JSON.stringify(fallbackTraces)
      diagnosticsBytesAfterPrune = byteLength(serialized)
      win.sessionStorage.setItem(ENGINE2_DIAGNOSTICS_STORAGE_KEY, serialized)
      return {
        ok: true,
        diagnosticsBytesBeforeWrite,
        diagnosticsBytesAfterPrune,
        diagnosticsStorageWriteFailed: true,
        diagnosticsPrunedTraceCount: Math.max(pruned.diagnosticsPrunedTraceCount, traces.length - fallbackTraces.length),
        error: error instanceof Error ? error.message : String(error),
      }
    } catch (fallbackError) {
      return {
        ok: false,
        diagnosticsBytesBeforeWrite,
        diagnosticsBytesAfterPrune,
        diagnosticsStorageWriteFailed: true,
        diagnosticsPrunedTraceCount: pruned.diagnosticsPrunedTraceCount,
        error: fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export const clearEngine2Diagnostics = () => {
  const win = safeWindow()
  if (!win) return
  for (const storage of [win.sessionStorage, win.localStorage]) {
    try {
      const keys: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key && (key === ENGINE2_DIAGNOSTICS_STORAGE_KEY || key.startsWith(ENGINE2_DIAGNOSTICS_STORAGE_PREFIX))) keys.push(key)
      }
      keys.forEach((key) => storage.removeItem(key))
    } catch {
      // Diagnostics cleanup must never interrupt the Engine 2 session.
    }
  }
}

export const clonePayloadForDiagnostics = (payload: Record<string, unknown> | null) => {
  if (!payload) return null
  try {
    return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
  } catch {
    return payload
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const latestTraceWithValue = <T>(
  traces: Engine2FrontendTrace[],
  selector: (trace: Engine2FrontendTrace) => T | null | undefined
) => {
  for (const trace of [...traces].reverse()) {
    const value = selector(trace)
    if (value !== null && value !== undefined) return value
  }
  return null
}

const compactQuestion = (value: unknown): Engine2CompactDiagnosticQuestion | null => {
  const question = asRecord(value)
  if (!question) return null
  const text = String(question.question || question.text || '').trim()
  if (!text) return null
  return {
    text,
    semanticKey: question.semanticKey ? String(question.semanticKey) : null,
    targetType: question.targetType ? String(question.targetType) : null,
    targetContradictionId: question.targetContradictionId ? String(question.targetContradictionId) : null,
  }
}

const compactQuestionList = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map(compactQuestion)
    .filter((question): question is Engine2CompactDiagnosticQuestion => Boolean(question))
    .slice(0, 12)

export const buildCompactEngine2Diagnostics = ({
  traces,
  sessionState,
}: {
  traces: Engine2FrontendTrace[]
  sessionState: Engine2PersistedState | Record<string, unknown> | null
}): Engine2CompactDiagnostics => {
  const safeTraces = Array.isArray(traces) ? traces : []
  const session = asRecord(sessionState)
  const latestGenerateTrace = latestTraceWithValue(safeTraces, (trace) =>
    trace.action === 'generate_panel_questions' ? trace : null
  )
  const latestFrontend = asRecord(latestGenerateTrace?.frontend) || null
  const latestQuestionBackend = asRecord(latestGenerateTrace?.backendTrace) || null
  const latestQuestionApi = asRecord(latestGenerateTrace?.apiResponse) || null
  const latestReadiness = latestTraceWithValue(safeTraces, (trace) => {
    const frontend = asRecord(trace.frontend)
    const api = asRecord(trace.apiResponse)
    const readiness = asRecord(api?.readiness) || asRecord(api?.reportReadiness)
    if (frontend?.readinessEvaluationCompleted || readiness) return { frontend, readiness, api }
    return null
  })
  const latestContradictions = latestTraceWithValue(safeTraces, (trace) => {
    const frontend = asRecord(trace.frontend)
    const api = asRecord(trace.apiResponse)
    const triggered = Boolean(frontend?.contradictionDetectionTriggered || api?.contradictionDetectionTriggered)
    const completed = Boolean(frontend?.contradictionDetectionCompleted || api?.contradictionDetectionCompleted)
    const contradictions = Array.isArray(api?.contradictions) ? api.contradictions : []
    return triggered || completed || contradictions.length ? { frontend, api, contradictions } : null
  })
  const calls = safeTraces.map((trace) => {
    const backend = asRecord(trace.backendTrace)
    const telemetry = asRecord(backend?.telemetry)
    const api = asRecord(trace.apiResponse)
    const action = String(trace.action || backend?.action || api?.action || '')
    const repairCalls = numberValue(telemetry?.repairCalls, 0)
    const providerRequestIds = Array.isArray(telemetry?.providerRequestIds) ? telemetry.providerRequestIds : []
    const questionGeneration = asRecord(backend?.questionGeneration)
    const nestedAttempts = Array.isArray(questionGeneration?.attempts) ? questionGeneration.attempts.length : undefined
    const attemptCount = numberValue(backend?.generatePanelQuestionsAttemptCount ?? backend?.attempts ?? nestedAttempts, 0)
    const hasModel = Boolean(telemetry?.model || backend?.model)
    const llmCalls = Math.max(
      providerRequestIds.length,
      attemptCount,
      hasModel ? 1 + repairCalls : 0,
      Number.isFinite(Number(backend?.reconcileAfterAcceptDurationMs)) ? 1 : 0
    )
    return {
      action,
      model: String(telemetry?.model || backend?.model || ''),
      llmCalls,
      llmLatencyMs: numberValue(telemetry?.llmLatencyMs, 0),
      totalBackendMs: numberValue(telemetry?.totalBackendMs, 0),
    }
  })
  const fullDiagnostics = {
    exportedAt: new Date().toISOString(),
    sessionState,
    traces: safeTraces,
  }
  const compactBase = {
    exportedAt: new Date().toISOString(),
    fullDiagnosticsBytes: byteLength(JSON.stringify(fullDiagnostics)),
    sessionSummary: {
      successfulTrialTurns: numberValue(session?.successfulTrialTurns ?? latestFrontend?.successfulTrialTurns, 0),
      providerCalls: numberValue(session?.providerCalls ?? latestFrontend?.providerCalls, 0),
    },
    timing: {
      acceptToQuestionsRenderedMs: latestFrontend
        ? numberValue(latestFrontend.acceptToQuestionsRenderedMs, 0)
        : null,
      criticalPathLlmCalls: latestFrontend
        ? numberValue(latestFrontend.criticalPathLlmCalls, 0)
        : null,
    },
    calls,
    questions: {
      panelQuestionCount: numberValue(latestFrontend?.panelQuestionCount ?? latestQuestionBackend?.panelQuestionCount, 0),
      generationAttemptCount: numberValue(latestQuestionBackend?.generatePanelQuestionsAttemptCount, 0),
      raw: compactQuestionList(latestQuestionBackend?.questionCandidatesRaw ?? latestQuestionApi?.questionCandidates),
      applied: compactQuestionList(latestQuestionBackend?.questionCandidatesApplied ?? latestQuestionApi?.panelQuestions ?? latestQuestionApi?.openQuestions),
    },
    contradictions: {
      triggered: Boolean(latestContradictions?.frontend?.contradictionDetectionTriggered || latestContradictions?.api?.contradictionDetectionTriggered),
      completed: Boolean(latestContradictions?.frontend?.contradictionDetectionCompleted || latestContradictions?.api?.contradictionDetectionCompleted),
      count: Array.isArray(latestContradictions?.contradictions) ? latestContradictions.contradictions.length : 0,
    },
    readiness: {
      evaluated: Boolean(latestReadiness?.frontend?.readinessEvaluationCompleted),
      score: latestReadiness?.readiness ? numberValue(latestReadiness.readiness.score ?? latestReadiness.readiness.reportScore, 0) : null,
      reportAvailable: Boolean(latestReadiness?.readiness?.reportAvailable || latestReadiness?.api?.reportAvailable),
    },
    warnings: safeTraces.flatMap((trace) => [
      ...(Array.isArray(trace.frontend?.stateConsistencyWarnings) ? trace.frontend.stateConsistencyWarnings : []),
      ...(Array.isArray(trace.frontend?.alarms) ? trace.frontend.alarms : []),
    ]).map((warning) => String(warning)).filter(Boolean).slice(0, 20),
  } satisfies Omit<Engine2CompactDiagnostics, 'compactDiagnosticsBytes'>
  const withSize = {
    ...compactBase,
    compactDiagnosticsBytes: byteLength(JSON.stringify({ ...compactBase, compactDiagnosticsBytes: 0 })),
  }
  return {
    ...withSize,
    compactDiagnosticsBytes: byteLength(JSON.stringify(withSize)),
  }
}

export const createFrontendTraceFromApi = ({
  payload,
  backendTrace,
  isDryRun,
}: {
  payload: Record<string, unknown>
  backendTrace: Engine2BackendTrace | null
  isDryRun: boolean
}): Engine2FrontendTrace => {
  const diagnosticSummary = buildDiagnosticSummary({ payload, backendTrace })
  const actionName = String(payload.action || backendTrace?.action || '')
  return {
    traceId:
      String(backendTrace?.traceId || payload.traceId || `engine2-frontend-trace-${Date.now()}`),
    messageId: backendTrace?.messageId ? String(backendTrace.messageId) : null,
    action: backendTrace?.action ? String(backendTrace.action) : null,
    createdAt: new Date().toISOString(),
    isDryRun,
    backendTrace,
    apiResponse: clonePayloadForDiagnostics(payload),
    stages: Array.isArray(backendTrace?.stages)
      ? (backendTrace.stages as Engine2DiagnosticStage[])
      : [],
    frontend: {
    requestId: String(payload.requestId || backendTrace?.requestId || '') || null,
    turnId: String(payload.turnId || backendTrace?.turnId || '') || null,
    stateVersionReturned: Number(payload.stateVersionReturned ?? backendTrace?.stateVersionSent ?? 0) || 0,
    stateVersionBeforeApply: 0,
    responseDecision: null,
    responseStartedAt: null,
    responseFinishedAt: null,
    requestStatus: payload.turnApplied === false ? 'error' : 'success',
    responseOrigin: String(payload.responseOrigin || backendTrace?.responseOrigin || '') || null,
    frontendAppliedAt: null,
    domCapturedAt: null,
    alarms: [],
    gapsBeforeApply: [],
    gapsAfterApply: [],
    nextQuestionBeforeApply: null,
    nextQuestionAfterApply: null,
    activeQuestionBeforeApply: null,
    activeQuestionAfterApply: null,
    stateApplyMode: null,
    replyTargetCleared: null,
    composerReplyTargetBeforeSubmit: null,
    composerReplyTargetAfterSubmit: null,
    inFlightReplyToQuestionId: null,
    retryReplyToQuestionId: null,
    rawReplyToGapId: String(payload.rawReplyToGapId ?? backendTrace?.rawReplyToGapId ?? '') || null,
    effectiveReplyToGapId: String(payload.effectiveReplyToGapId ?? backendTrace?.effectiveReplyToGapId ?? '') || null,
    replyTargetSource: ['explicit_composer', 'active_ask_now', 'none'].includes(String(payload.replyTargetSource ?? backendTrace?.replyTargetSource))
      ? String(payload.replyTargetSource ?? backendTrace?.replyTargetSource) as 'explicit_composer' | 'active_ask_now' | 'none'
      : null,
    turnApplied: typeof payload.turnApplied === 'boolean' ? payload.turnApplied : null,
    analysisStatus: String(payload.analysisStatus || '') || null,
    isAnalyzingFalseAt: null,
    pendingPackageId: null,
    pendingPackageExpectedCount: 0,
    pendingPackageProposalCount: 0,
    pendingPackageDecisionCount: 0,
    continueGateReason: null,
    decisionPackageBefore: null,
    decisionPackageAfter: null,
    allPackageItemsDecided: null,
    shouldTriggerContinueAfterDecisions: null,
    continueAfterDecisionsTriggered: actionName === 'generate_panel_questions',
    continueAfterDecisionsTraceId: actionName === 'generate_panel_questions'
      ? String(backendTrace?.traceId || payload.traceId || '') || null
      : null,
    generatePanelQuestionsTriggered: actionName === 'generate_panel_questions',
    generatePanelQuestionsTraceId: actionName === 'generate_panel_questions'
      ? String(backendTrace?.traceId || payload.traceId || '') || null
      : null,
    generatePanelQuestionsStartedAt: String(payload.generatePanelQuestionsStartedAt || backendTrace?.generatePanelQuestionsStartedAt || '') || null,
    generatePanelQuestionsFinishedAt: String(payload.generatePanelQuestionsFinishedAt || backendTrace?.generatePanelQuestionsFinishedAt || '') || null,
    generatePanelQuestionsDurationMs: Number(payload.generatePanelQuestionsDurationMs ?? backendTrace?.generatePanelQuestionsDurationMs ?? 0) || 0,
    generatePanelQuestionsInputBytes: Number(payload.generatePanelQuestionsInputBytes ?? backendTrace?.generatePanelQuestionsInputBytes ?? 0) || 0,
    generatePanelQuestionsOutputBytes: Number(payload.generatePanelQuestionsOutputBytes ?? backendTrace?.generatePanelQuestionsOutputBytes ?? 0) || 0,
    generatePanelQuestionsAttemptCount: Number(payload.generatePanelQuestionsAttemptCount ?? backendTrace?.generatePanelQuestionsAttemptCount ?? 0) || 0,
    generatePanelQuestionsTimeoutMs: Number(payload.generatePanelQuestionsTimeoutMs ?? backendTrace?.generatePanelQuestionsTimeoutMs ?? 0) || 0,
    generatePanelQuestionsInputHash: String(payload.generatePanelQuestionsInputHash || backendTrace?.generatePanelQuestionsInputHash || '') || null,
    generatePanelQuestionsInputPreview: String(payload.generatePanelQuestionsInputPreview || backendTrace?.generatePanelQuestionsInputPreview || '') || null,
    providerCallStartedAt: String(payload.providerCallStartedAt || backendTrace?.providerCallStartedAt || '') || null,
    providerCallResolvedAt: String(payload.providerCallResolvedAt || backendTrace?.providerCallResolvedAt || '') || null,
    providerCallAbortedAt: String(payload.providerCallAbortedAt || backendTrace?.providerCallAbortedAt || '') || null,
    abortReason: String(payload.abortReason || backendTrace?.abortReason || '') || null,
    timeoutSource: String(payload.timeoutSource || backendTrace?.timeoutSource || '') || null,
    model: String(payload.model || backendTrace?.model || '') || null,
    responseFormatName: String(payload.responseFormatName || backendTrace?.responseFormatName || '') || null,
    skippedReadinessBecause: String(payload.skippedReadinessBecause || backendTrace?.skippedReadinessBecause || '') || null,
    skippedContradictionsBecause: String(payload.skippedContradictionsBecause || backendTrace?.skippedContradictionsBecause || '') || null,
    questionsRenderedBeforeReadiness: Boolean(payload.questionsRenderedBeforeReadiness ?? backendTrace?.questionsRenderedBeforeReadiness),
    questionCandidatesRaw: arrayValue(payload.questionCandidates ?? backendTrace?.questionCandidates),
    questionCandidatesApplied: arrayValue(payload.panelQuestions ?? payload.openQuestions),
    panelQuestionCount: arrayValue(payload.panelQuestions ?? payload.openQuestions).length,
    findingDecisionSubmitStarted: false,
    findingDecisionSubmitFinished: false,
    findingDecisionSubmitFailed: false,
    acceptClickedAt: null,
    panelQuestionsRenderedAt: null,
    acceptToQuestionsRenderedMs: null,
    criticalPathLlmCalls: null,
    decisionSubmissionInFlight: false,
    decisionSubmissionStartedAt: null,
    decisionSubmissionDurationMs: null,
    decisionSubmitPackageId: null,
    decisionSubmitFindingIds: [],
    decisionSubmitRequestId: null,
    decisionSubmitError: null,
    findingDiagnostics: diagnosticSummary.findingDiagnostics,
    contradictionDiagnostics: diagnosticSummary.contradictionDiagnostics,
    questionDiagnostics: diagnosticSummary.questionDiagnostics,
    nextActionDiagnosis: diagnosticSummary.nextActionDiagnosis,
    stateConsistencyWarnings: diagnosticSummary.stateConsistencyWarnings,
    deadEndInvariantResult: deadEndInvariantResult(payload),
    receivedFindingProposals: Array.isArray(payload.findingProposals)
      ? (payload.findingProposals as Engine2Finding[])
      : [],
    reactFindingProposals: [],
    reactAllFindings: [],
    sessionStorageState: null,
    sessionStorageReloadedState: null,
    renderedPendingFindings: [],
    renderedKnowledge: [],
    renderedOpenQuestions: [],
    renderedChatText: null,
    renderedDomTraceId: null,
    readinessEvaluationTriggered: diagnosticSummary.readinessDiagnostics.readinessEvaluationTriggered,
    readinessEvaluationCompleted: diagnosticSummary.readinessDiagnostics.readinessEvaluationCompleted,
    readinessEvaluationSkippedReason: diagnosticSummary.readinessDiagnostics.readinessEvaluationSkippedReason,
    readinessIsDefaultValue: diagnosticSummary.readinessDiagnostics.readinessIsDefaultValue,
    contradictionDetectionTriggered: Boolean(diagnosticSummary.contradictionDiagnostics.contradictionDetectionTriggered),
    contradictionDetectionTraceId: diagnosticSummary.contradictionDiagnostics.contradictionDetectionTraceId as string | null,
    contradictionDetectionCompleted: Boolean(diagnosticSummary.contradictionDiagnostics.contradictionDetectionCompleted),
    contradictionDetectionSkippedReason: diagnosticSummary.contradictionDiagnostics.contradictionDetectionSkippedReason as string | null,
    contradictionChangesRaw: arrayValue(payload.contradictionChangesRaw ?? backendTrace?.contradictionChangesRaw),
    contradictionChangesApplied: arrayValue(payload.contradictionChangesApplied ?? backendTrace?.contradictionChangesApplied),
    contradictionExtractionStatus: diagnosticSummary.contradictionDiagnostics.contradictionExtractionStatus as 'not_evaluated' | 'evaluated' | 'failed',
    contradictionPipelineStatus: diagnosticSummary.contradictionDiagnostics.contradictionPipelineStatus as 'none_detected' | 'formal_detected' | 'soft_detected_only' | 'detected_not_registered' | 'failed',
    softTensionSignals: arrayValue(diagnosticSummary.contradictionDiagnostics.softTensionSignals),
    softTensionSignalsCount: Number(diagnosticSummary.contradictionDiagnostics.softTensionSignalsCount || 0),
    hasTradeoffsOrContradictions: Boolean(diagnosticSummary.contradictionDiagnostics.hasTradeoffsOrContradictions),
    formalExtractedContradictionCount: diagnosticSummary.contradictionDiagnostics.formalExtractedContradictionCount as number,
    formalActiveContradictionCount: diagnosticSummary.contradictionDiagnostics.formalActiveContradictionCount as number,
    extractedContradictionCount: diagnosticSummary.contradictionDiagnostics.extractedContradictionCount as number,
    activeContradictionCount: diagnosticSummary.contradictionDiagnostics.activeContradictionCount as number,
    resolvedContradictionCount: diagnosticSummary.contradictionDiagnostics.resolvedContradictionCount as number,
    dismissedContradictionCount: diagnosticSummary.contradictionDiagnostics.dismissedContradictionCount as number,
    lastContradictionEvaluationTraceId: null,
    lastContradictionEvaluationAt: null,
    },
  }
}

export const captureEngine2DomSnapshot = (root: ParentNode | null): Engine2DomSnapshot => {
  if (!root) return { traceId: null, chatText: null, activeQuestionId: null, openQuestions: [] }
  const main = typeof Element !== 'undefined' && root instanceof Element ? root : null
  const assistantMessages = [...root.querySelectorAll<HTMLElement>('[data-engine2-chat-message="assistant"]')]
  const activeQuestion = root.querySelector<HTMLElement>('[data-engine2-question-presentation="ask_now"]')
  const questionNodes = [...root.querySelectorAll<HTMLElement>('[data-engine2-open-question-id]')]
  return {
    traceId: main?.getAttribute('data-engine2-rendered-trace-id') || null,
    chatText: assistantMessages.at(-1)?.innerText.trim() || null,
    activeQuestionId: activeQuestion?.getAttribute('data-engine2-open-question-id') || null,
    openQuestions: questionNodes.flatMap((node) => {
      const id = node.getAttribute('data-engine2-open-question-id') || ''
      const text = node.innerText.trim()
      return id && text ? [{ id, text }] : []
    }),
  }
}

const buildFrontendApplyAlarms = ({
  trace,
  sessionState,
  applySnapshot,
  domSnapshot,
  knowledge = [],
}: {
  trace: Engine2FrontendTrace
  sessionState: Engine2PersistedState | null
  applySnapshot: {
    responseDecision: 'applied' | 'ignored_as_stale' | 'not_applied' | 'partial_applied' | 'decision_applied_continue_failed'
    gapsBeforeApply: Engine2OpenQuestion[]
    activeQuestionBeforeApply: string | null
    replyTargetGapId?: string | null
  } | null
  domSnapshot: Engine2DomSnapshot
  knowledge?: string[]
}) => {
  const alarms: string[] = []
  const apiGaps = Array.isArray(trace.apiResponse?.openQuestions)
    ? (trace.apiResponse.openQuestions as Engine2OpenQuestion[])
    : null
  const apiQuestionId = String(trace.apiResponse?.nextQuestionId || '')
  const apiChatText = String((trace.apiResponse?.assistantMessage as { content?: unknown } | null)?.content || '')
  const renderedQuestionId = String(domSnapshot.activeQuestionId || '')
  const renderedChatText = domSnapshot.chatText || ''
  if (applySnapshot?.responseDecision === 'not_applied') return alarms
  if (apiGaps) {
    const returnedIds = new Set(apiGaps.map((entry) => entry.id))
    const removedIds = applySnapshot?.gapsBeforeApply.filter((entry) => !returnedIds.has(entry.id)).map((entry) => entry.id) || []
    if (domSnapshot.openQuestions.some((entry) => removedIds.includes(entry.id))) alarms.push('frontend_kept_removed_gap')
  }
  if (
    applySnapshot?.activeQuestionBeforeApply &&
    sessionState?.activeQuestionId === applySnapshot.activeQuestionBeforeApply &&
    apiQuestionId &&
    renderedQuestionId !== apiQuestionId
  ) alarms.push('frontend_kept_previous_question')
  if (
    applySnapshot?.responseDecision === 'applied' &&
    applySnapshot.replyTargetGapId &&
    domSnapshot.activeQuestionId === applySnapshot.replyTargetGapId
  ) {
    alarms.push('reply_target_not_cleared_after_success')
  }
  if (apiChatText && apiQuestionId && apiQuestionId !== renderedQuestionId) {
    alarms.push('api_question_differs_from_rendered_question')
  }
  if (apiChatText && apiChatText !== renderedChatText) alarms.push('api_chat_text_differs_from_rendered_chat')
  if (knowledge.some((entry) => /\bUżytkownik\b/.test(String(entry || '')))) {
    alarms.push('rendered_knowledge_contains_third_person_user')
  }
  return alarms
}

export const updateFrontendTraceState = ({
  trace,
  findings,
  pendingFindings,
  pendingPackageId,
  pendingPackageExpectedCount,
  pendingPackageProposalCount,
  pendingPackageDecisionCount,
  continueGateReason,
  knowledge,
  openQuestions,
  sessionState,
  domSnapshot,
  applySnapshot = null,
}: {
  trace: Engine2FrontendTrace
  findings: Engine2Finding[]
  pendingFindings: Engine2Finding[]
  pendingPackageId: string | null
  pendingPackageExpectedCount: number
  pendingPackageProposalCount: number
  pendingPackageDecisionCount: number
  continueGateReason: string | null
  knowledge: string[]
  openQuestions: Engine2OpenQuestion[]
  sessionState: Engine2PersistedState | null
  domSnapshot: Engine2DomSnapshot
  applySnapshot?: {
    stateVersionBeforeApply: number
    responseDecision: 'applied' | 'ignored_as_stale' | 'not_applied' | 'partial_applied' | 'decision_applied_continue_failed'
    responseStartedAt?: string | null
    responseFinishedAt?: string | null
    frontendAppliedAt?: string | null
    gapsBeforeApply: Engine2OpenQuestion[]
    nextQuestionBeforeApply: string | null
    activeQuestionBeforeApply: string | null
    stateApplyMode: 'replaced' | 'merged' | 'unchanged'
    replyTargetGapId?: string | null
    composerReplyTargetBeforeSubmit?: string | null
    composerReplyTargetAfterSubmit?: string | null
    inFlightReplyToQuestionId?: string | null
    retryReplyToQuestionId?: string | null
    replyTargetSource?: 'explicit_composer' | 'active_ask_now' | 'none'
    isAnalyzingFalseAt?: string | null
    decisionPackageBefore?: Record<string, unknown> | null
    acceptClickedAt?: string | null
    criticalPathProviderCallsBefore?: number | null
  } | null
}): Engine2FrontendTrace => {
  const frontendAppliedAt = applySnapshot?.frontendAppliedAt || new Date().toISOString()
  const domCapturedAt = new Date().toISOString()
  const frontendAlarms = buildFrontendApplyAlarms({ trace, sessionState, applySnapshot, domSnapshot, knowledge })
  const renderedQuestion = domSnapshot.openQuestions.find((entry) => entry.id === domSnapshot.activeQuestionId)?.text ?? null
  const renderedChatText = domSnapshot.chatText
  const decisionPackageBefore = applySnapshot?.decisionPackageBefore ?? trace.frontend.decisionPackageBefore
  const decisionPackageAfter = decisionPackageSnapshot({
    packageId: pendingPackageId,
    expectedProposalCount: pendingPackageExpectedCount,
    packageProposalCount: pendingPackageProposalCount,
    packageDecisionCount: pendingPackageDecisionCount,
  })
  const allPackageItemsDecided = decisionPackageAfter.allPackageItemsDecided
  const shouldTriggerContinueAfterDecisions = Boolean(
    decisionPackageAfter.packageId &&
    allPackageItemsDecided &&
    trace.frontend.continueAfterDecisionsTriggered === false
  )
  const questionCandidatesRaw = arrayValue(trace.apiResponse?.questionCandidates ?? trace.backendTrace?.questionCandidates)
  const questionCandidatesApplied = arrayValue(trace.apiResponse?.panelQuestions ?? trace.apiResponse?.openQuestions)
  const panelQuestionCount = questionCandidatesApplied.length
  const acceptClickedAt = applySnapshot?.acceptClickedAt ?? trace.frontend.acceptClickedAt ?? null
  const panelQuestionsRenderedAt = acceptClickedAt && domSnapshot.openQuestions.length === 3
    ? domCapturedAt
    : trace.frontend.panelQuestionsRenderedAt
  const acceptToQuestionsRenderedMs = acceptClickedAt && panelQuestionsRenderedAt
    ? Math.max(0, Date.parse(panelQuestionsRenderedAt) - Date.parse(acceptClickedAt))
    : trace.frontend.acceptToQuestionsRenderedMs
  const providerCallsAfter = Number(
    trace.apiResponse?.trialCounters && typeof trace.apiResponse.trialCounters === 'object'
      ? (trace.apiResponse.trialCounters as Record<string, unknown>).providerCalls
      : trace.apiResponse?.limits && typeof trace.apiResponse.limits === 'object'
        ? (trace.apiResponse.limits as Record<string, unknown>).providerCalls
        : 0
  ) || 0
  const providerCallsBefore = Number(applySnapshot?.criticalPathProviderCallsBefore ?? 0) || 0
  const criticalPathLlmCalls = acceptClickedAt && panelQuestionsRenderedAt
    ? Math.max(0, providerCallsAfter - providerCallsBefore)
    : trace.frontend.criticalPathLlmCalls
  const deadEndResult = deadEndInvariantResult(trace.apiResponse)
  const diagnosticSummary = buildDiagnosticSummary({
    payload: trace.apiResponse,
    backendTrace: trace.backendTrace,
    sessionState,
  })
  return {
    ...trace,
    stages: [
      ...trace.stages.filter((entry) => ![
        'FRONTEND APPLY',
        'RENDERED STATE',
        'CLIENT STATE',
        'RENDERED DOM',
      ].includes(entry.name)),
      {
        name: 'CLIENT STATE',
        status: frontendAlarms.length
          ? 'red'
          : ['ignored_as_stale', 'not_applied', 'partial_applied', 'decision_applied_continue_failed'].includes(String(applySnapshot?.responseDecision)) ? 'yellow' : 'green',
        alarms: frontendAlarms,
        data: {
          requestId: trace.frontend.requestId,
          stateVersionReturned: trace.frontend.stateVersionReturned,
          stateVersionBeforeApply: applySnapshot?.stateVersionBeforeApply ?? 0,
          decision: applySnapshot?.responseDecision ?? 'applied',
          gapsBefore: applySnapshot?.gapsBeforeApply ?? [],
          gapsAfter: openQuestions,
          nextQuestionBefore: applySnapshot?.nextQuestionBeforeApply ?? null,
          nextQuestionAfter: renderedQuestion,
          activeQuestionBefore: applySnapshot?.activeQuestionBeforeApply ?? null,
          activeQuestionAfter: sessionState?.activeQuestionId ?? null,
          stateApplyMode: applySnapshot?.stateApplyMode ?? 'merged',
          replyTargetCleared: applySnapshot?.replyTargetGapId
            ? applySnapshot.composerReplyTargetAfterSubmit !== applySnapshot.replyTargetGapId
            : true,
          composerReplyTargetBeforeSubmit: applySnapshot?.composerReplyTargetBeforeSubmit ?? null,
          composerReplyTargetAfterSubmit: applySnapshot?.composerReplyTargetAfterSubmit ?? null,
          inFlightReplyToQuestionId: applySnapshot?.inFlightReplyToQuestionId ?? null,
          retryReplyToQuestionId: applySnapshot?.retryReplyToQuestionId ?? null,
          rawReplyToGapId: trace.frontend.rawReplyToGapId,
          effectiveReplyToGapId: trace.frontend.effectiveReplyToGapId,
          replyTargetSource: applySnapshot?.replyTargetSource ?? trace.frontend.replyTargetSource,
          turnApplied: trace.apiResponse?.turnApplied ?? null,
          analysisStatus: trace.apiResponse?.analysisStatus ?? null,
          isAnalyzingFalseAt: applySnapshot?.isAnalyzingFalseAt ?? null,
          decisionPackageBefore,
          decisionPackageAfter,
          allPackageItemsDecided,
          shouldTriggerContinueAfterDecisions,
          continueAfterDecisionsTriggered: trace.frontend.continueAfterDecisionsTriggered,
          continueAfterDecisionsTraceId: trace.frontend.continueAfterDecisionsTraceId,
          questionCandidatesRaw,
          questionCandidatesApplied,
          panelQuestionCount,
          acceptClickedAt,
          panelQuestionsRenderedAt,
          acceptToQuestionsRenderedMs,
          criticalPathLlmCalls,
          findingDiagnostics: diagnosticSummary.findingDiagnostics,
          contradictionDiagnostics: diagnosticSummary.contradictionDiagnostics,
          questionDiagnostics: diagnosticSummary.questionDiagnostics,
          nextActionDiagnosis: diagnosticSummary.nextActionDiagnosis,
          stateConsistencyWarnings: diagnosticSummary.stateConsistencyWarnings,
          deadEndInvariantResult: deadEndResult,
          readinessDiagnostics: diagnosticSummary.readinessDiagnostics,
          contradictionDetectionTriggered: diagnosticSummary.contradictionDiagnostics.contradictionDetectionTriggered,
          contradictionDetectionTraceId: diagnosticSummary.contradictionDiagnostics.contradictionDetectionTraceId,
          contradictionDetectionCompleted: diagnosticSummary.contradictionDiagnostics.contradictionDetectionCompleted,
          contradictionDetectionSkippedReason: diagnosticSummary.contradictionDiagnostics.contradictionDetectionSkippedReason,
          contradictionChangesRaw: arrayValue(trace.apiResponse?.contradictionChangesRaw ?? trace.backendTrace?.contradictionChangesRaw),
          contradictionChangesApplied: arrayValue(trace.apiResponse?.contradictionChangesApplied ?? trace.backendTrace?.contradictionChangesApplied),
          contradictionExtractionStatus: diagnosticSummary.contradictionDiagnostics.contradictionExtractionStatus,
          extractedContradictionCount: diagnosticSummary.contradictionDiagnostics.extractedContradictionCount,
          frontendAppliedAt,
        },
      },
      {
        name: 'RENDERED DOM',
        status: frontendAlarms.some((alarm) => [
          'api_question_differs_from_rendered_question',
          'api_chat_text_differs_from_rendered_chat',
        ].includes(alarm)) ? 'red' : 'green',
        alarms: frontendAlarms.filter((alarm) => [
          'api_question_differs_from_rendered_question',
          'api_chat_text_differs_from_rendered_chat',
        ].includes(alarm)),
        data: {
          renderedPendingFindings: pendingFindings.map(findingDisplayText),
          renderedKnowledge: knowledge,
          renderedOpenQuestions: domSnapshot.openQuestions,
          renderedQuestion,
          renderedChatText,
          renderedTraceId: domSnapshot.traceId,
          domCapturedAt,
        },
      },
    ],
    frontend: {
      ...trace.frontend,
      alarms: frontendAlarms,
      stateVersionBeforeApply: applySnapshot?.stateVersionBeforeApply ?? trace.frontend.stateVersionBeforeApply,
      responseDecision: applySnapshot?.responseDecision ?? trace.frontend.responseDecision,
      responseStartedAt: applySnapshot?.responseStartedAt ?? trace.frontend.responseStartedAt,
      responseFinishedAt: applySnapshot?.responseFinishedAt ?? trace.frontend.responseFinishedAt,
      requestStatus: applySnapshot?.responseDecision === 'ignored_as_stale'
        ? 'ignored_as_stale'
        : applySnapshot?.responseDecision === 'not_applied' ? 'error' : 'success',
      frontendAppliedAt,
      domCapturedAt,
      gapsBeforeApply: applySnapshot?.gapsBeforeApply ?? trace.frontend.gapsBeforeApply,
      gapsAfterApply: openQuestions,
      nextQuestionBeforeApply: applySnapshot?.nextQuestionBeforeApply ?? trace.frontend.nextQuestionBeforeApply,
      nextQuestionAfterApply: renderedQuestion,
      activeQuestionBeforeApply: applySnapshot?.activeQuestionBeforeApply ?? trace.frontend.activeQuestionBeforeApply,
      activeQuestionAfterApply: sessionState?.activeQuestionId ?? null,
      stateApplyMode: applySnapshot?.stateApplyMode ?? trace.frontend.stateApplyMode,
      replyTargetCleared: applySnapshot?.replyTargetGapId
        ? applySnapshot.composerReplyTargetAfterSubmit !== applySnapshot.replyTargetGapId
        : true,
      composerReplyTargetBeforeSubmit:
        applySnapshot?.composerReplyTargetBeforeSubmit ?? trace.frontend.composerReplyTargetBeforeSubmit,
      composerReplyTargetAfterSubmit:
        applySnapshot?.composerReplyTargetAfterSubmit ?? trace.frontend.composerReplyTargetAfterSubmit,
      inFlightReplyToQuestionId:
        applySnapshot?.inFlightReplyToQuestionId ?? trace.frontend.inFlightReplyToQuestionId,
      retryReplyToQuestionId:
        applySnapshot?.retryReplyToQuestionId ?? trace.frontend.retryReplyToQuestionId,
      rawReplyToGapId: trace.frontend.rawReplyToGapId,
      effectiveReplyToGapId: trace.frontend.effectiveReplyToGapId,
      replyTargetSource: applySnapshot?.replyTargetSource ?? trace.frontend.replyTargetSource,
      turnApplied: typeof trace.apiResponse?.turnApplied === 'boolean'
        ? trace.apiResponse.turnApplied
        : trace.frontend.turnApplied,
      analysisStatus: String(trace.apiResponse?.analysisStatus || '') || trace.frontend.analysisStatus,
      isAnalyzingFalseAt: applySnapshot?.isAnalyzingFalseAt ?? trace.frontend.isAnalyzingFalseAt,
      pendingPackageId,
      pendingPackageExpectedCount,
      pendingPackageProposalCount,
      pendingPackageDecisionCount,
      continueGateReason,
      decisionPackageBefore,
      decisionPackageAfter,
      allPackageItemsDecided,
      shouldTriggerContinueAfterDecisions,
      continueAfterDecisionsTriggered: trace.frontend.continueAfterDecisionsTriggered,
      continueAfterDecisionsTraceId: trace.frontend.continueAfterDecisionsTraceId,
      questionCandidatesRaw,
      questionCandidatesApplied,
      panelQuestionCount,
      acceptClickedAt,
      panelQuestionsRenderedAt,
      acceptToQuestionsRenderedMs,
      criticalPathLlmCalls,
      findingDecisionSubmitStarted: trace.frontend.findingDecisionSubmitStarted,
      findingDecisionSubmitFinished: trace.frontend.findingDecisionSubmitFinished,
      findingDecisionSubmitFailed: trace.frontend.findingDecisionSubmitFailed,
      decisionSubmissionInFlight: trace.frontend.decisionSubmissionInFlight,
      decisionSubmissionStartedAt: trace.frontend.decisionSubmissionStartedAt,
      decisionSubmissionDurationMs: trace.frontend.decisionSubmissionDurationMs,
      decisionSubmitPackageId: trace.frontend.decisionSubmitPackageId,
      decisionSubmitFindingIds: trace.frontend.decisionSubmitFindingIds,
      decisionSubmitRequestId: trace.frontend.decisionSubmitRequestId,
      decisionSubmitError: trace.frontend.decisionSubmitError,
      findingDiagnostics: diagnosticSummary.findingDiagnostics,
      contradictionDiagnostics: diagnosticSummary.contradictionDiagnostics,
      questionDiagnostics: diagnosticSummary.questionDiagnostics,
      nextActionDiagnosis: diagnosticSummary.nextActionDiagnosis,
      stateConsistencyWarnings: diagnosticSummary.stateConsistencyWarnings,
      deadEndInvariantResult: deadEndResult,
      reactFindingProposals: pendingFindings,
      reactAllFindings: findings,
      sessionStorageState: sessionState,
      sessionStorageReloadedState: sessionState,
      renderedPendingFindings: pendingFindings.map(findingDisplayText),
      renderedKnowledge: knowledge,
      renderedOpenQuestions: domSnapshot.openQuestions.map((entry) => entry.text),
      renderedChatText,
      renderedDomTraceId: domSnapshot.traceId,
      readinessEvaluationTriggered: diagnosticSummary.readinessDiagnostics.readinessEvaluationTriggered,
      readinessEvaluationCompleted: diagnosticSummary.readinessDiagnostics.readinessEvaluationCompleted,
      readinessEvaluationSkippedReason: diagnosticSummary.readinessDiagnostics.readinessEvaluationSkippedReason,
      readinessIsDefaultValue: diagnosticSummary.readinessDiagnostics.readinessIsDefaultValue,
      contradictionDetectionTriggered: Boolean(diagnosticSummary.contradictionDiagnostics.contradictionDetectionTriggered),
      contradictionDetectionTraceId: diagnosticSummary.contradictionDiagnostics.contradictionDetectionTraceId as string | null,
      contradictionDetectionCompleted: Boolean(diagnosticSummary.contradictionDiagnostics.contradictionDetectionCompleted),
      contradictionDetectionSkippedReason: diagnosticSummary.contradictionDiagnostics.contradictionDetectionSkippedReason as string | null,
      contradictionChangesRaw: arrayValue(trace.apiResponse?.contradictionChangesRaw ?? trace.backendTrace?.contradictionChangesRaw),
      contradictionChangesApplied: arrayValue(trace.apiResponse?.contradictionChangesApplied ?? trace.backendTrace?.contradictionChangesApplied),
      contradictionExtractionStatus: diagnosticSummary.contradictionDiagnostics.contradictionExtractionStatus as 'not_evaluated' | 'evaluated' | 'failed',
      contradictionPipelineStatus: diagnosticSummary.contradictionDiagnostics.contradictionPipelineStatus as 'none_detected' | 'formal_detected' | 'soft_detected_only' | 'detected_not_registered' | 'failed',
      softTensionSignals: arrayValue(diagnosticSummary.contradictionDiagnostics.softTensionSignals),
      softTensionSignalsCount: Number(diagnosticSummary.contradictionDiagnostics.softTensionSignalsCount || 0),
      hasTradeoffsOrContradictions: Boolean(diagnosticSummary.contradictionDiagnostics.hasTradeoffsOrContradictions),
      formalExtractedContradictionCount: diagnosticSummary.contradictionDiagnostics.formalExtractedContradictionCount as number,
      formalActiveContradictionCount: diagnosticSummary.contradictionDiagnostics.formalActiveContradictionCount as number,
      extractedContradictionCount: diagnosticSummary.contradictionDiagnostics.extractedContradictionCount as number,
      activeContradictionCount: diagnosticSummary.contradictionDiagnostics.activeContradictionCount as number,
      resolvedContradictionCount: diagnosticSummary.contradictionDiagnostics.resolvedContradictionCount as number,
      dismissedContradictionCount: diagnosticSummary.contradictionDiagnostics.dismissedContradictionCount as number,
      lastContradictionEvaluationTraceId: trace.backendTrace?.traceId ? String(trace.backendTrace.traceId) : trace.frontend.lastContradictionEvaluationTraceId ?? null,
      lastContradictionEvaluationAt: frontendAppliedAt,
    },
  }
}
