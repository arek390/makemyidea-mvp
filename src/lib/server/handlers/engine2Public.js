import { createHash } from 'node:crypto'
import { createRateLimiter } from '../../../../llm/llmRouter.mjs'
import { sendJson, resolveAiSupportEnabled, resolveDiagnosticsEnabled } from '../http.js'
import { calculateOpenAIUsageCost, resolveFxUsdPln } from '../openaiPricing.js'
import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { resolveEngine2DiagnosticsRequest } from '../engine2Diagnostics.js'
import {
  applyEngine2TurnDelta,
  applyStagedEngine2QuestionTransition,
  assignedEngine2QuestionId,
  ENGINE2_QUESTION_MIGRATION_VERSION,
  ENGINE2_TURN_LIMITS,
  migrateEngine2QuestionLedger,
  planEngine2LlmTurn,
} from '../engine2LlmTurnPlanner.js'
import {
  calculateEngine2ReadinessDecision,
  evaluateEngine2ReportReadiness,
} from '../engine2ReadinessEvaluator.js'
import {
  buildEngine2QuestionSetDiversityCheck,
  engine2QuestionExplorationKey,
  engine2QuestionSemanticCluster,
  generateEngine2PanelQuestions,
  normalizeEngine2QuestionTargetType,
} from '../engine2PanelQuestionGenerator.js'
import {
  detectEngine2Contradictions,
  inferEngine2SoftTensionSignals,
  inferEngine2TensionContradictionChanges,
} from '../engine2ContradictionDetector.js'
import {
  directPolishDisplayText,
  ENGINE2_OPEN_CONTRADICTION_STATUSES,
} from '../engine2UserFacingText.js'

export const PUBLIC_TRIAL_SUCCESSFUL_TURN_LIMIT = 30

export const ENGINE2_LIMITS = Object.freeze({
  contractVersion: 1,
  maxMessageChars: 2000,
  maxHistoryMessages: 64,
  maxSuccessfulTrialTurns: PUBLIC_TRIAL_SUCCESSFUL_TURN_LIMIT,
  maxFindingsPerResponse: ENGINE2_TURN_LIMITS.maxFindingChanges,
  maxFindingsInRequest: 180,
  maxQuestionsInRequest: 240,
  maxRejectedFingerprints: 120,
  maxRequestChars: 1_200_000,
})

const limiterByIp = createRateLimiter({ windowMs: 60_000, max: 80 })
const limiterByTrial = createRateLimiter({ windowMs: 60_000, max: 40 })
const completedTurns = new Map()
const completedMessages = new Map()
const inFlightTurns = new Set()
const trialUsage = new Map()
const TURN_CACHE_TTL_MS = 5 * 60_000
const TRIAL_USAGE_TTL_MS = 6 * 60 * 60_000

const toText = (value, maxLength = 0) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return maxLength > 0 ? text.slice(0, maxLength) : text
}

const stableHash = (value) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 24)
const hasDuplicateIds = (entries) => {
  const ids = (Array.isArray(entries) ? entries : []).map((entry) => toText(entry?.id, 120)).filter(Boolean)
  return new Set(ids).size !== ids.length
}
const normalizeLanguage = (value) => String(value || '').toLowerCase().startsWith('en') ? 'en' : 'pl'
const normalizeStatus = (value) => ['pending', 'confirmed', 'rejected'].includes(value) ? value : 'pending'
const normalizeSubject = (finding) => {
  const value = finding?.subject
  return ['world', 'product', 'elements'].includes(value) ? value : null
}
const normalizePerspective = (finding) => {
  const value = finding?.perspective
  return ['current', 'not_working', 'desired'].includes(value) ? value : null
}

export const normalizeEngine2Findings = (value) => {
  if (!Array.isArray(value)) return []
  return value.slice(0, ENGINE2_LIMITS.maxFindingsInRequest).flatMap((finding) => {
    if (!finding || typeof finding !== 'object') return []
    const id = toText(finding.id, 120)
    const content = toText(finding.content ?? finding.text, 1200)
    if (!id || !content) return []
    const displayText = directPolishDisplayText(finding.displayText || content, { language: 'pl', max: 1200 })
    const subject = normalizeSubject(finding)
    const perspective = normalizePerspective(finding)
    return [{
      ...finding,
      id,
      semanticKey: toText(finding.semanticKey, 120) || id,
      content,
      text: content,
      displayText,
      status: normalizeStatus(finding.status),
      subject,
      perspective,
      sourceMessageIds: Array.isArray(finding.sourceMessageIds)
        ? finding.sourceMessageIds.map((idValue) => toText(idValue, 120)).filter(Boolean).slice(0, 10)
        : [],
      proposedOperation: ['add', 'revise', 'withdraw'].includes(finding.proposedOperation)
        ? finding.proposedOperation
        : 'add',
      targetFindingId: toText(finding.targetFindingId, 120) || null,
    }]
  })
}

const normalizeMessages = (value) => {
  if (!Array.isArray(value)) return []
  return value.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const role = ['user', 'assistant'].includes(message.role) ? message.role : null
    const content = toText(message.content ?? message.text, ENGINE2_LIMITS.maxMessageChars)
    const id = toText(message.id, 120)
    return role && content && id ? [{
      id, role, content,
      ...(toText(message.questionId, 120) ? { questionId: toText(message.questionId, 120) } : {}),
      ...(toText(message.replyToQuestionId, 120) ? { replyToQuestionId: toText(message.replyToQuestionId, 120) } : {}),
      ...(toText(message.replyToQuestionText, ENGINE2_TURN_LIMITS.maxQuestionChars) ? { replyToQuestionText: toText(message.replyToQuestionText, ENGINE2_TURN_LIMITS.maxQuestionChars) } : {}),
      ...(['explicit_composer', 'active_ask_now', 'none'].includes(message.replyTargetSource) ? { replyTargetSource: message.replyTargetSource } : {}),
    }] : []
  })
}

const normalizeQuestion = (question, defaults = {}) => {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return null
  const id = toText(question.id ?? question.questionId, 120)
  const text = toText(question.question ?? question.text, ENGINE2_TURN_LIMITS.maxQuestionChars)
  if (!id || !text) return null
  const legacyStatus = question.status === 'resolved' ? 'answered' : question.status === 'retired' ? 'superseded' : question.status
  const status = ['open', 'answered', 'covered', 'obsolete', 'dismissed', 'superseded', 'skipped', 'replaced', 'backlog'].includes(legacyStatus) ? legacyStatus : defaults.status || 'open'
  const presentation = ['ask_now', 'ask_later', 'panel', 'hidden'].includes(question.presentation)
    ? ['ask_now', 'ask_later'].includes(question.presentation) ? 'panel' : question.presentation
    : defaults.presentation || 'hidden'
  return {
    id,
    // Compatibility input: old payloads may only have gapKey; runtime uses semanticKey.
    semanticKey: toText(question.semanticKey ?? question.gapKey ?? id, 120),
    question: text,
    text,
    intent: toText(question.intent ?? question.semanticKey ?? question.gapKey ?? text, ENGINE2_TURN_LIMITS.maxQuestionChars),
    status,
    presentation,
    createdFromMessageId: toText(question.createdFromMessageId, 120) || null,
    ...(Number.isFinite(Number(question.askedCount))
      ? { askedCount: Math.max(0, Math.trunc(Number(question.askedCount))) }
      : {}),
    ...(toText(question.lastAskedAt, 80) ? { lastAskedAt: toText(question.lastAskedAt, 80) } : {}),
    answeredByMessageIds: Array.isArray(question.answeredByMessageIds)
      ? question.answeredByMessageIds.map((value) => toText(value, 120)).filter(Boolean)
      : [],
    coveredByFindingIds: Array.isArray(question.coveredByFindingIds)
      ? question.coveredByFindingIds.map((value) => toText(value, 120)).filter(Boolean)
      : [],
    groundedInFindingIds: Array.isArray(question.groundedInFindingIds)
      ? question.groundedInFindingIds.map((value) => toText(value, 120)).filter(Boolean)
      : [],
    concreteAnchorText: toText(question.concreteAnchorText, 240) || null,
    uncertaintyToResolve: toText(question.uncertaintyToResolve, 240) || null,
    userCanAnswerFromExperience: question.userCanAnswerFromExperience === true,
    forbiddenGenericCategoryQuestion: question.forbiddenGenericCategoryQuestion === true,
    targetType: ['contradiction_probe', 'observation', 'priority', 'boundary', 'usage_example', 'success_test'].includes(question.targetType)
      ? question.targetType
      : null,
    targetContradictionId: toText(question.targetContradictionId ?? question.targetContradictionRef, 120) || null,
    explorationArea: toText(question.explorationArea, 160) || null,
    semanticExplorationKey: toText(question.semanticExplorationKey, 120) || null,
    contradictionHypothesis: toText(question.contradictionHypothesis, 360) || null,
    matrixInspiration: toText(question.matrixInspiration, 220) || null,
    matrixInspirationIsHypothesis: question.matrixInspirationIsHypothesis === true,
    noveltyReason: toText(question.noveltyReason, 500) || null,
    diversityReason: toText(question.diversityReason, 500) || null,
    whyNotDuplicate: toText(question.whyNotDuplicate, 500) || null,
    questionPurpose: toText(question.questionPurpose, 500) || null,
    priorityReason: toText(question.priorityReason ?? question.reason, 500) || null,
  }
}

const panelOpenQuestions = (questions) => (Array.isArray(questions) ? questions : [])
  .filter((question) => question.status === 'open' && question.presentation === 'panel')
  .map((question) => {
    const visibleText = toText(question.question || question.text, ENGINE2_TURN_LIMITS.maxQuestionChars)
    return visibleText ? { ...question, question: visibleText, text: visibleText } : question
  })
  .filter((question) => toText(question.question || question.text, ENGINE2_TURN_LIMITS.maxQuestionChars))
  .slice(0, 3)

const normalizeQuestions = ({ questions, questionHistory, openQuestions, selectedQuestion }) => {
  const byId = new Map()
  const add = (question, defaults) => {
    const normalized = normalizeQuestion(question, defaults)
    if (normalized) {
      const merged = { ...(byId.get(normalized.id) || {}), ...normalized }
      byId.set(normalized.id, merged)
    }
  }
  ;(Array.isArray(questions) ? questions : Array.isArray(questionHistory) ? questionHistory : []).slice(0, ENGINE2_LIMITS.maxQuestionsInRequest).forEach((question) => add(question, {}))
  ;(Array.isArray(openQuestions) ? openQuestions : []).forEach((question) => add(question, {
    status: 'open',
    presentation: 'panel',
  }))
  if (selectedQuestion && !byId.has(selectedQuestion.id)) add(selectedQuestion, { status: 'open', presentation: 'panel' })
  return [...byId.values()]
    .map((question) => ({ ...question, semanticKey: question.semanticKey || question.id }))
    .slice(0, ENGINE2_LIMITS.maxQuestionsInRequest)
}

const QUESTION_EVENT_STATUS = Object.freeze({
  answer: 'answered',
  answered: 'answered',
  dismiss: 'dismissed',
  skipped: 'skipped',
  replaced: 'replaced',
  supersede: 'superseded',
  reopen: 'open',
})

export const reconcileEngine2QuestionsFromEvents = (questions, questionEvents) => {
  const statusByQuestionId = new Map()
  const orderedEvents = (Array.isArray(questionEvents) ? questionEvents : [])
    .map((event, index) => ({ event, index, time: Date.parse(String(event?.createdAt || '')) }))
    .sort((left, right) => Number.isFinite(left.time) && Number.isFinite(right.time) && left.time !== right.time
      ? left.time - right.time
      : left.index - right.index)
  for (const { event } of orderedEvents) {
    const entityId = toText(event?.entityId, 120)
    const status = QUESTION_EVENT_STATUS[event?.operation]
    if (entityId && status) statusByQuestionId.set(entityId, status)
  }
  return (Array.isArray(questions) ? questions : []).map((question) => {
    const eventStatus = statusByQuestionId.get(question.id)
    const status = eventStatus || question.status
    return {
      ...question,
      status,
      presentation: status === 'open' ? question.presentation : 'hidden',
    }
  })
}

const normalizeContradictions = (value) => {
  if (!Array.isArray(value)) return []
  return value.slice(0, 60).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const id = toText(entry.id, 120)
    const semanticKey = toText(entry.semanticKey, 120)
    const description = toText(entry.description, 400)
    if (!id || !semanticKey || !description) return []
    const sourceFindingIds = Array.isArray(entry.sourceFindingIds ?? entry.findingIds)
      ? (entry.sourceFindingIds ?? entry.findingIds).map((value) => toText(value, 120)).filter(Boolean)
      : []
    const sourceMessageIds = Array.isArray(entry.sourceMessageIds ?? entry.messageIds)
      ? (entry.sourceMessageIds ?? entry.messageIds).map((value) => toText(value, 120)).filter(Boolean)
      : []
    const status = ['suspected', 'open', 'confirmed', 'active', 'resolved', 'dismissed', 'superseded'].includes(entry.status)
      ? entry.status
      : 'suspected'
    return [{
      id, semanticKey, description,
      sideA: toText(entry.sideA, 240) || description,
      sideB: toText(entry.sideB, 240) || description,
      findingIds: sourceFindingIds,
      messageIds: sourceMessageIds,
      sourceFindingIds,
      sourceMessageIds,
      status,
      reportBlocking: Boolean(entry.reportBlocking),
      firstDetectedAt: toText(entry.firstDetectedAt, 80) || new Date(0).toISOString(),
      updatedAt: toText(entry.updatedAt, 80) || new Date(0).toISOString(),
      resolvedAt: toText(entry.resolvedAt, 80) || null,
      verificationQuestionId: toText(entry.verificationQuestionId ?? entry.resolutionQuestionId, 120) || null,
      resolutionQuestionId: toText(entry.verificationQuestionId ?? entry.resolutionQuestionId, 120) || null,
      resolutionFindingIds: Array.isArray(entry.resolutionFindingIds)
        ? entry.resolutionFindingIds.map((value) => toText(value, 120)).filter(Boolean)
        : [],
    }]
  })
}

const normalizeReadiness = (body) => {
  const snapshotReadiness = body?.sessionSnapshot?.readiness
  const rawStatus = toText(body?.readiness?.status ?? snapshotReadiness?.status, 40)
  const status = ['not_evaluated', 'evaluating', 'evaluated', 'failed'].includes(rawStatus)
    ? rawStatus
    : 'not_evaluated'
  const materialScore = Number(body?.materialReadiness?.materialScore ?? body?.materialReadiness?.score ?? snapshotReadiness?.materialScore ?? body?.readiness?.materialScore ?? 0)
  const reportScore = Number(body?.reportReadiness?.score ?? snapshotReadiness?.reportScore ?? body?.readiness?.reportScore ?? body?.readiness?.score ?? 0)
  return {
    status,
    materialScore: Number.isFinite(materialScore) ? Math.max(0, Math.min(100, Math.round(materialScore))) : 0,
    reportScore: Number.isFinite(reportScore) ? Math.max(0, Math.min(100, Math.round(reportScore))) : 0,
    criticalMissing: Array.isArray(snapshotReadiness?.criticalMissing ?? body?.readiness?.criticalMissing)
      ? (snapshotReadiness?.criticalMissing ?? body.readiness.criticalMissing).map((item) => toText(item, 160)).filter(Boolean).slice(0, 3)
      : [],
    reportAvailable: Boolean(snapshotReadiness?.reportAvailable ?? body?.reportAvailable),
    lastEvaluatedAt: toText(body?.readiness?.lastEvaluatedAt ?? snapshotReadiness?.lastEvaluatedAt, 80) || null,
    evaluationTraceId: toText(body?.readiness?.evaluationTraceId ?? snapshotReadiness?.evaluationTraceId, 160) || null,
    error: body?.readiness?.error ?? snapshotReadiness?.error ?? null,
  }
}

export const validateEngine2Request = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'INVALID_REQUEST' }
  if (JSON.stringify(body).length > ENGINE2_LIMITS.maxRequestChars) return { ok: false, status: 413, error: 'REQUEST_TOO_LARGE' }
  if (Number(body.version) !== ENGINE2_LIMITS.contractVersion) return { ok: false, status: 400, error: 'UNSUPPORTED_CONTRACT_VERSION' }
  const action = toText(body.action, 80)
  if (!['analyze_message', 'commit_finding_decisions', 'generate_panel_questions', 'detect_contradictions', 'evaluate_readiness'].includes(action)) return { ok: false, status: 400, error: 'INVALID_ACTION' }
  const trialId = toText(body.trialId, 120)
  const turnId = toText(body.turnId, 120)
  if (!trialId || !turnId) return { ok: false, status: 400, error: 'TRIAL_AND_TURN_REQUIRED' }
  const rawMessage = String(body.message?.content ?? body.message ?? '')
  const latestUserMessage = toText(rawMessage, ENGINE2_LIMITS.maxMessageChars)
  if (action === 'analyze_message' && !latestUserMessage) return { ok: false, status: 400, error: 'MESSAGE_REQUIRED' }
  if (rawMessage.length > ENGINE2_LIMITS.maxMessageChars) return { ok: false, status: 413, error: 'MESSAGE_TOO_LONG' }
  const snapshot = body.sessionSnapshot && typeof body.sessionSnapshot === 'object' ? body.sessionSnapshot : {}
  const rawHistory = Array.isArray(snapshot.conversation) ? snapshot.conversation : body.history
  const history = normalizeMessages(rawHistory)
  if ((Array.isArray(rawHistory) ? rawHistory : []).some(
    (message) => String(message?.content ?? message?.text ?? '').length > ENGINE2_LIMITS.maxMessageChars
  )) return { ok: false, status: 413, error: 'HISTORY_MESSAGE_TOO_LONG' }
  if (history.length > ENGINE2_LIMITS.maxHistoryMessages) return { ok: false, status: 413, error: 'HISTORY_TOO_LONG' }
  const messageId = toText(body.message?.id, 120) || turnId
  if (hasDuplicateIds(rawHistory)) return { ok: false, status: 400, error: 'DUPLICATE_CONVERSATION_MESSAGE_ID' }
  if (action === 'analyze_message' && !history.some((entry) => entry.id === messageId && entry.role === 'user' && entry.content === latestUserMessage)) {
    return { ok: false, status: 400, error: 'CURRENT_MESSAGE_MISSING_FROM_CONVERSATION' }
  }
  if (hasDuplicateIds(snapshot.findings ?? body.findings)) return { ok: false, status: 400, error: 'DUPLICATE_FINDING_ID' }
  if (hasDuplicateIds(snapshot.questions ?? body.questionHistory)) return { ok: false, status: 400, error: 'DUPLICATE_QUESTION_ID' }
  if (hasDuplicateIds(snapshot.contradictions)) return { ok: false, status: 400, error: 'DUPLICATE_CONTRADICTION_ID' }
  const snapshotActiveQuestionId = toText(snapshot.activeQuestionId, 120) || null
  const requestedActiveQuestionId = toText(body.activeQuestionGapId ?? body.activeQuestionId ?? snapshotActiveQuestionId, 120) || null
  const questionEvents = Array.isArray(snapshot.questionEvents) ? snapshot.questionEvents : []
  const reconciledQuestions = reconcileEngine2QuestionsFromEvents(normalizeQuestions({
    questions: snapshot.questions,
    questionHistory: body.questionHistory,
    openQuestions: body.openQuestions,
    // A selectedQuestion is metadata for an existing ledger entry, never a way to create one.
    selectedQuestion: null,
    activeQuestionId: requestedActiveQuestionId,
  }), questionEvents)
  const migratedQuestionLedger = migrateEngine2QuestionLedger({
    questions: reconciledQuestions,
    activeQuestionId: requestedActiveQuestionId,
    // Compatibility input: older clients persisted current panel questions here.
    questionBacklog: Array.isArray(snapshot.questionBacklog) ? snapshot.questionBacklog : [],
  })
  const questions = migratedQuestionLedger.questions
  const activeQuestionId = null
  const rawReplyToGapId = toText(body.replyToGapId, 120) || null
  const explicitReplyQuestion = rawReplyToGapId
    ? questions.find((question) => question.id === rawReplyToGapId && question.status === 'open')
    : null
  if (rawReplyToGapId && !explicitReplyQuestion) {
    return { ok: false, status: 400, error: 'REPLY_TO_OPEN_QUESTION_NOT_FOUND' }
  }
  const replyToGapId = explicitReplyQuestion?.id || null
  const replyTargetSource = explicitReplyQuestion
    ? 'explicit_composer'
    : 'none'
  const normalizedFindings = normalizeEngine2Findings(Array.isArray(snapshot.findings) ? snapshot.findings : body.findings)
  const rawPendingQuestionTransition = snapshot.pendingQuestionTransition && typeof snapshot.pendingQuestionTransition === 'object'
    ? snapshot.pendingQuestionTransition
    : null
  let pendingQuestionTransition = rawPendingQuestionTransition ? {
    type: rawPendingQuestionTransition.type,
    questionId: toText(rawPendingQuestionTransition.questionId, 120),
    outcome: rawPendingQuestionTransition.outcome,
    reason: toText(rawPendingQuestionTransition.reason, 400),
    sourceMessageId: toText(rawPendingQuestionTransition.sourceMessageId, 160),
    evidenceFindingIds: Array.isArray(rawPendingQuestionTransition.evidenceFindingIds)
      ? [...new Set(rawPendingQuestionTransition.evidenceFindingIds.map((id) => toText(id, 120)).filter(Boolean))]
      : [],
  } : null
  if (pendingQuestionTransition) {
    const targetQuestion = questions.find((question) => question.id === pendingQuestionTransition.questionId)
    const validEvidenceIds = new Set(normalizedFindings.map((finding) => finding.id))
    if (
      pendingQuestionTransition.type !== 'close' ||
      !targetQuestion ||
      targetQuestion.status !== 'open' ||
      pendingQuestionTransition.evidenceFindingIds.some((id) => !validEvidenceIds.has(id))
    ) {
      pendingQuestionTransition = null
    }
  }
  return {
    ok: true,
    data: {
      action,
      trialId,
      turnId,
      language: normalizeLanguage(body.language),
      messageId,
      latestUserMessage,
      history,
      findings: normalizedFindings,
      findingEvents: Array.isArray(snapshot.findingEvents) ? snapshot.findingEvents : [],
      contradictions: normalizeContradictions(snapshot.contradictions ?? body.contradictions),
      questionEvents,
      questions,
      openQuestions: panelOpenQuestions(questions),
      selectedQuestion: normalizeQuestion(body.selectedQuestion, { status: 'open', presentation: 'panel' }),
      rawReplyToGapId,
      effectiveReplyToGapId: replyToGapId,
      replyToGapId,
      replyTargetSource,
      activeQuestionId,
      questionLedgerMigrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
      decisions: Array.isArray(body.decisions) ? body.decisions : [],
      latestAcceptedFindingIds: Array.isArray(body.latestAcceptedFindingIds)
        ? [...new Set(body.latestAcceptedFindingIds.map((id) => toText(id, 120)).filter(Boolean))].slice(0, 20)
        : [],
      guidanceForNextQuestions: toText(snapshot.guidanceForNextQuestions ?? body.guidanceForNextQuestions, 1200),
      rejectedFingerprints: Array.isArray(body.rejectedFingerprints) ? body.rejectedFingerprints.slice(0, ENGINE2_LIMITS.maxRejectedFingerprints) : [],
      readiness: normalizeReadiness(body),
      reportAvailable: Boolean(body.reportAvailable ?? body?.reportReadiness?.reportAvailable),
      contradictionExtractionStatus: ['not_evaluated', 'evaluated', 'failed'].includes(String(snapshot.contradictionExtractionStatus || body.contradictionExtractionStatus || ''))
        ? String(snapshot.contradictionExtractionStatus || body.contradictionExtractionStatus)
        : 'not_evaluated',
      detectedRawContradictionCount: Number.isFinite(Number(snapshot.detectedRawContradictionCount ?? body.detectedRawContradictionCount))
        ? Math.max(0, Math.trunc(Number(snapshot.detectedRawContradictionCount ?? body.detectedRawContradictionCount)))
        : null,
      rejectedContradictionCandidateCount: Number.isFinite(Number(snapshot.rejectedContradictionCandidateCount ?? body.rejectedContradictionCandidateCount))
        ? Math.max(0, Math.trunc(Number(snapshot.rejectedContradictionCandidateCount ?? body.rejectedContradictionCandidateCount)))
        : null,
      appliedContradictionCount: Number.isFinite(Number(snapshot.appliedContradictionCount ?? body.appliedContradictionCount))
        ? Math.max(0, Math.trunc(Number(snapshot.appliedContradictionCount ?? body.appliedContradictionCount)))
        : null,
      pendingDecisionPackageId: toText(snapshot.pendingDecisionPackageId ?? body.pendingDecisionPackageId ?? body.pendingPackageId, 120) || null,
      pendingQuestionTransition,
      clientSuccessfulTrialTurns: Math.max(0, Math.trunc(Number(body.trialCounters?.successfulTrialTurns || 0))),
      clientProviderCalls: Math.max(0, Math.trunc(Number(body.trialCounters?.providerCalls || 0))),
      successfulTurnMessageIds: Array.isArray(body.trialCounters?.successfulTurnMessageIds)
        ? [...new Set(body.trialCounters.successfulTurnMessageIds
            .map((id) => toText(id, 120))
            .filter(Boolean))].slice(0, ENGINE2_LIMITS.maxHistoryMessages * 3)
        : [],
      requestId: toText(body.requestId, 160) || turnId,
      stateVersionSent: Math.max(0, Math.trunc(Number(body.stateVersionSent || 0))),
      diagnosticsDryRun: Boolean(body?.diagnostics?.dryRun),
    },
  }
}

export const applyEngine2Decisions = ({ findings, decisions, rejectedFingerprints = [], findingEvents = [] }) => {
  const normalized = normalizeEngine2Findings(findings)
  const nowIso = new Date().toISOString()
  const nextFindingEvents = [...(Array.isArray(findingEvents) ? findingEvents : [])]
  const byDecisionId = new Map((Array.isArray(decisions) ? decisions : []).flatMap((decision) => {
    const id = toText(decision?.findingId, 120)
    return id ? [[id, decision]] : []
  }))
  const rejected = new Set(Array.isArray(rejectedFingerprints) ? rejectedFingerprints : [])
  let result = normalized.map((finding) => {
    const decision = byDecisionId.get(finding.id)
    if (!decision) return finding
    if (!['confirm', 'edit', 'reject'].includes(decision.type)) return finding
    const decisionSource = decision.type === 'reject'
      ? 'user_reject'
      : decision.type === 'edit' ? 'user_change' : 'user_accept'
    nextFindingEvents.push({
      id: `engine2-finding-decision-${stableHash(`${finding.id}:${decision.type}:${toText(decision.content, 1200)}`)}`,
      entityId: finding.id,
      findingId: finding.id,
      packageId: finding.packageId || null,
      operation: 'decision',
      decisionType: decision.type === 'edit' ? 'change' : decision.type === 'reject' ? 'reject' : 'accept',
      decisionSource,
      messageId: null,
      decisionAt: nowIso,
      createdAt: nowIso,
    })
    if (decision.type === 'reject') {
      if (finding.fingerprint) rejected.add(finding.fingerprint)
      return { ...finding, status: 'rejected', decisionSource, decisionAt: nowIso, updatedAt: nowIso }
    }
    const content = decision.type === 'edit' ? toText(decision.content, 1200) || finding.content : finding.content
    return {
      ...finding,
      content,
      text: content,
      displayText: directPolishDisplayText(content, { language: 'pl', max: 1200 }),
      status: 'confirmed',
      decisionSource,
      decisionAt: nowIso,
      source: decision.type === 'edit' ? 'user_edit' : finding.source,
      originalContent: decision.type === 'edit' ? finding.originalContent || finding.content : finding.originalContent,
      updatedAt: nowIso,
    }
  })

  for (const finding of [...result]) {
    const decision = byDecisionId.get(finding.id)
    if (!decision || !['confirm', 'edit'].includes(decision.type) || !finding.targetFindingId) continue
    const targetIndex = result.findIndex((candidate) => candidate.id === finding.targetFindingId)
    if (targetIndex < 0 || result[targetIndex].status !== 'confirmed') continue
    if (finding.proposedOperation === 'withdraw') {
      result[targetIndex] = { ...result[targetIndex], status: 'rejected', decisionSource: 'user_accept', decisionAt: nowIso, updatedAt: nowIso }
      result = result.map((candidate) => candidate.id === finding.id ? { ...candidate, status: 'rejected' } : candidate)
    } else if (finding.proposedOperation === 'revise') {
      result[targetIndex] = { ...result[targetIndex], status: 'rejected', decisionSource: 'user_change', decisionAt: nowIso, updatedAt: nowIso }
    }
  }
  return { findings: result, findingEvents: nextFindingEvents, rejectedFingerprints: [...rejected] }
}

const validateEngine2DecisionPackage = ({ findings, decisions, pendingDecisionPackageId }) => {
  if (!pendingDecisionPackageId) return { ok: true, errors: [], invariant: { invariant: 'confirmed_or_rejected_finding_requires_user_decision_event', passed: true } }
  const decisionIds = new Set((Array.isArray(decisions) ? decisions : []).map((decision) => toText(decision?.findingId, 120)).filter(Boolean))
  const packageFindings = (Array.isArray(findings) ? findings : []).filter((finding) => finding?.packageId === pendingDecisionPackageId)
  const missing = packageFindings
    .filter((finding) => ['confirmed', 'rejected'].includes(finding.status) && !decisionIds.has(finding.id) && !finding.decisionSource)
    .map((finding) => finding.id)
  const errors = missing.map((id) => `finding ${id} is ${packageFindings.find((finding) => finding.id === id)?.status} without a user decision event`)
  return {
    ok: errors.length === 0,
    errors,
    invariant: {
      invariant: 'confirmed_or_rejected_finding_requires_user_decision_event',
      passed: errors.length === 0,
      packageId: pendingDecisionPackageId,
      missingDecisionFindingIds: missing,
    },
  }
}

const explicitDecisionEventsForPackage = ({ findingEvents = [], packageId = null }) => (Array.isArray(findingEvents) ? findingEvents : [])
  .filter((event) =>
    event?.packageId === packageId &&
    event?.findingId &&
    ['user_accept', 'user_change', 'user_reject'].includes(event?.decisionSource)
  )

const evaluateDecisionLifecycleInvariants = ({
  findings = [],
  findingEvents = [],
  packageId = null,
  finalDecision = false,
  nextQuestionGenerationRequired = false,
  nextQuestionGenerationTriggered = false,
  continueTriggered = false,
}) => {
  const packageFindings = packageId
    ? (Array.isArray(findings) ? findings : []).filter((finding) => finding?.packageId === packageId)
    : []
  const decisionEvents = explicitDecisionEventsForPackage({ findingEvents, packageId })
  const eventIds = new Set(decisionEvents.map((event) => event.findingId || event.entityId).filter(Boolean))
  const confirmedOrRejectedWithoutEvent = packageFindings
    .filter((finding) => ['confirmed', 'rejected'].includes(finding?.status))
    .filter((finding) => !finding?.decisionSource || !eventIds.has(finding.id))
    .map((finding) => finding.id)
  const pendingToConfirmedWithoutAcceptOrChange = packageFindings
    .filter((finding) => finding?.status === 'confirmed')
    .filter((finding) => !['user_accept', 'user_change'].includes(finding?.decisionSource) || !eventIds.has(finding.id))
    .map((finding) => finding.id)
  const allDecided = packageFindings.length > 0 &&
    packageFindings.every((finding) => ['confirmed', 'rejected'].includes(finding?.status) && eventIds.has(finding.id))
  const questionGenerationRequired = Boolean(nextQuestionGenerationRequired)
  const questionGenerationTriggered = Boolean(nextQuestionGenerationTriggered || continueTriggered)
  return [
    {
      invariant: 'confirmed_or_rejected_requires_user_decision_event',
      passed: confirmedOrRejectedWithoutEvent.length === 0,
      packageId,
      missingDecisionFindingIds: confirmedOrRejectedWithoutEvent,
    },
    {
      invariant: 'pending_to_confirmed_requires_accept_or_change',
      passed: pendingToConfirmedWithoutAcceptOrChange.length === 0,
      packageId,
      missingAcceptOrChangeFindingIds: pendingToConfirmedWithoutAcceptOrChange,
    },
    {
      invariant: 'package_resolved_requires_all_decision_events',
      passed: !allDecided || eventIds.size >= packageFindings.length,
      packageId,
      packageFindingCount: packageFindings.length,
      decisionEventsCount: eventIds.size,
      allPackageItemsDecided: allDecided,
    },
    {
      invariant: 'generate_panel_questions_required_after_final_package_decision',
      passed: !finalDecision || questionGenerationRequired || questionGenerationTriggered,
      packageId,
      finalDecision,
      nextQuestionGenerationRequired: questionGenerationRequired,
      nextQuestionGenerationTriggered: questionGenerationTriggered,
    },
    {
      invariant: 'no_local_confirm_without_decision_event',
      passed: confirmedOrRejectedWithoutEvent.length === 0,
      packageId,
      offendingFindingIds: confirmedOrRejectedWithoutEvent,
    },
  ]
}

const getIp = (req) => {
  const forwarded = req?.headers?.['x-forwarded-for']
  return String((Array.isArray(forwarded) ? forwarded[0] : forwarded) || req?.socket?.remoteAddress || 'unknown').split(',')[0].trim()
}
const now = () => Date.now()
const getCachedTurn = (key) => {
  const cached = completedTurns.get(key)
  if (!cached) return null
  if (now() - cached.createdAt > TURN_CACHE_TTL_MS) {
    completedTurns.delete(key)
    return null
  }
  return cached.payload
}
const getCachedMessage = (key) => {
  const cached = completedMessages.get(key)
  if (!cached) return null
  if (now() - cached.createdAt > TURN_CACHE_TTL_MS) {
    completedMessages.delete(key)
    return null
  }
  return cached.payload
}
const getTrialUsage = (key) => {
  const usage = trialUsage.get(key)
  if (!usage || now() - usage.updatedAt > TRIAL_USAGE_TTL_MS) {
    return {
      successfulTrialTurns: 0,
      successfulTurnMessageIds: [],
      providerCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costPln: 0,
      modelUsage: {},
      lastCall: null,
    }
  }
  return usage
}

const mergeClientTrialCounters = (usage, data) => {
  const successfulIds = new Set([
    ...(Array.isArray(usage.successfulTurnMessageIds) ? usage.successfulTurnMessageIds : []),
    ...data.successfulTurnMessageIds,
  ])
  return {
    ...usage,
    successfulTurnMessageIds: [...successfulIds],
    successfulTrialTurns: Math.min(
      ENGINE2_LIMITS.maxSuccessfulTrialTurns,
      Math.max(Number(usage.successfulTrialTurns || 0), data.clientSuccessfulTrialTurns, successfulIds.size)
    ),
    providerCalls: Math.max(Number(usage.providerCalls || 0), data.clientProviderCalls),
  }
}

const recordSuccessfulTrialTurn = (usage, messageId) => {
  const successfulIds = new Set(Array.isArray(usage.successfulTurnMessageIds) ? usage.successfulTurnMessageIds : [])
  if (successfulIds.has(messageId)) return usage
  successfulIds.add(messageId)
  return {
    ...usage,
    successfulTurnMessageIds: [...successfulIds],
    successfulTrialTurns: Math.min(
      ENGINE2_LIMITS.maxSuccessfulTrialTurns,
      Number(usage.successfulTrialTurns || 0) + 1
    ),
  }
}

const estimateCost = async (meta) => {
  const model = toText(meta?.modelUsed, 120)
  const tokensInput = Math.max(0, Number(meta?.tokens?.input || 0))
  const tokensOutput = Math.max(0, Number(meta?.tokens?.output || 0))
  if (!model || (!tokensInput && !tokensOutput)) return { usage_cost_usd: 0, usage_cost_pln: 0, pricing_source: 'no_usage' }
  try {
    return await calculateOpenAIUsageCost(getSupabaseAdmin(), { model, tokensInput, tokensOutput, fxUsdPln: resolveFxUsdPln() })
  } catch {
    return { usage_cost_usd: 0, usage_cost_pln: 0, pricing_source: 'pricing_unavailable' }
  }
}

const accumulateUsage = async (usage, meta) => {
  const attempts = Math.max(0, Number(meta?.providerCalls ?? meta?.attempts ?? 0))
  if (attempts === 0) return usage
  const cost = await estimateCost(meta)
  const model = toText(meta?.modelUsed, 120) || 'unknown'
  const inputTokens = Math.max(0, Number(meta?.tokens?.input || 0))
  const outputTokens = Math.max(0, Number(meta?.tokens?.output || 0))
  const totalTokens = Math.max(0, Number(meta?.tokens?.total || inputTokens + outputTokens))
  const costUsd = Number(cost.usage_cost_usd || 0)
  const costPln = Number(cost.usage_cost_pln || 0)
  const previous = usage.modelUsage[model] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, costPln: 0, calls: 0 }
  return {
    ...usage,
    providerCalls: usage.providerCalls + attempts,
    inputTokens: usage.inputTokens + inputTokens,
    outputTokens: usage.outputTokens + outputTokens,
    totalTokens: usage.totalTokens + totalTokens,
    costUsd: usage.costUsd + costUsd,
    costPln: usage.costPln + costPln,
    modelUsage: { ...usage.modelUsage, [model]: {
      inputTokens: previous.inputTokens + inputTokens,
      outputTokens: previous.outputTokens + outputTokens,
      totalTokens: previous.totalTokens + totalTokens,
      costUsd: previous.costUsd + costUsd,
      costPln: previous.costPln + costPln,
      calls: previous.calls + attempts,
    } },
    lastCall: { model, inputTokens, outputTokens, totalTokens, costUsd, costPln, pricingSource: cost.pricing_source || null },
  }
}

const readinessPayload = (readiness, reportAvailable = false) => ({
  status: readiness.status || 'not_evaluated',
  score: readiness.reportScore,
  materialScore: readiness.materialScore,
  reportScore: readiness.reportScore,
  criticalMissing: readiness.criticalMissing,
  reportAvailable,
  lastEvaluatedAt: readiness.lastEvaluatedAt || null,
  evaluationTraceId: readiness.evaluationTraceId || null,
  error: readiness.error || null,
})
const materialReadinessPayload = (readiness) => ({ ...readinessPayload(readiness), score: readiness.materialScore })

const buildAdmin = (enabled, usage, trialId) => enabled ? {
  trialId,
  lastCall: usage.lastCall,
  totals: {
    successfulTrialTurns: usage.successfulTrialTurns,
    providerCalls: usage.providerCalls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
    costPln: usage.costPln,
    modelUsage: usage.modelUsage,
  },
} : undefined

const syncUsagePayload = (payload, usage, adminEnabled = false, trialId = null) => {
  const limits = {
    ...(payload.limits || {}),
    successfulTrialTurns: usage.successfulTrialTurns,
    remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
    providerCalls: usage.providerCalls,
  }
  const trialCounters = {
    successfulTrialTurns: usage.successfulTrialTurns,
    successfulTurnMessageIds: usage.successfulTurnMessageIds,
    providerCalls: usage.providerCalls,
  }
  return {
    ...payload,
    limits,
    trialCounters,
    sessionSnapshot: payload.sessionSnapshot
      ? { ...payload.sessionSnapshot, trialCounters }
      : payload.sessionSnapshot,
    ...(adminEnabled && trialId ? { admin: buildAdmin(true, usage, trialId) } : {}),
  }
}

const buildResponse = ({
  data, usage, findings, findingEvents = data.findingEvents, contradictions = data.contradictions,
  questions, questionEvents = data.questionEvents, readiness, reportAvailable = data.reportAvailable, adminEnabled = false,
		}) => {
		  const panelQuestions = panelOpenQuestions(questions)
		  const contradictionStatus = data.contradictionExtractionStatus || 'not_evaluated'
		  const softTensionState = buildSoftTensionState(data, { findings, contradictions })
		  const formalCounts = contradictionExtractionCounts(contradictions)
		  const persistedContradictionCounts = contradictionStatus === 'evaluated' || softTensionState.softTensionSignalsCount > 0
		    ? {
		        ...formalCounts,
		        softTensionSignalsCount: softTensionState.softTensionSignalsCount,
		        hasTradeoffsOrContradictions: formalCounts.formalActiveContradictionCount > 0 || softTensionState.softTensionSignalsCount > 0,
		      }
		    : {
		        formalExtractedContradictionCount: formalCounts.formalExtractedContradictionCount,
		        formalActiveContradictionCount: formalCounts.formalActiveContradictionCount,
		        extractedContradictionCount: data.extractedContradictionCount ?? null,
		        activeContradictionCount: data.activeContradictionCount ?? null,
		        resolvedContradictionCount: data.resolvedContradictionCount ?? null,
		        dismissedContradictionCount: data.dismissedContradictionCount ?? null,
		        softTensionSignalsCount: softTensionState.softTensionSignalsCount,
		        hasTradeoffsOrContradictions: softTensionState.softTensionSignalsCount > 0,
		      }
		  const pipelineStatus = contradictionPipelineStatus({
		    contradictionExtractionStatus: contradictionStatus,
		    formalActiveContradictionCount: persistedContradictionCounts.formalActiveContradictionCount,
		    softTensionSignalsCount: softTensionState.softTensionSignalsCount,
		    detectedRawContradictionCount: data.detectedRawContradictionCount,
		    rejectedContradictionCandidateCount: data.rejectedContradictionCandidateCount,
		    appliedContradictionCount: data.appliedContradictionCount,
		  })
		  return ({
  ok: true,
  version: ENGINE2_LIMITS.contractVersion,
  action: data.action,
  trialId: data.trialId,
  turnId: data.turnId,
  requestId: data.requestId,
  stateVersionReturned: data.stateVersionSent + 1,
  assistantMessage: null,
  findingProposals: [],
  findingUpdates: findings,
  findingEvents,
  contradictions,
  questionHistory: questions,
  questions,
  questionEvents,
  openQuestions: panelQuestions,
  panelQuestions,
  nextQuestionId: null,
  chatQuestion: null,
  rejectedFingerprints: data.rejectedFingerprints,
  readiness: readinessPayload(readiness, reportAvailable),
  reportReadiness: readinessPayload(readiness, reportAvailable),
  materialReadiness: materialReadinessPayload(readiness),
  reportAvailable,
  turnApplied: false,
  analysisStatus: 'retryable_error',
  retryable: false,
  decisionApplied: false,
  decisionEvents: [],
  decisionState: null,
  continueApplied: false,
  continueError: null,
  retryableContinueError: false,
  awaitingContinueAfterDecision: false,
  retryMessageId: null,
  rawReplyToGapId: data.rawReplyToGapId,
  effectiveReplyToGapId: data.effectiveReplyToGapId,
  replyToGapId: data.replyToGapId,
  replyTargetSource: data.replyTargetSource,
	  activeQuestionId: null,
	  pendingDecisionPackageId: data.pendingDecisionPackageId,
			  contradictionExtractionStatus: contradictionStatus,
			  contradictionPipelineStatus: pipelineStatus,
			  softTensionSignals: softTensionState.softTensionSignals,
			  ...persistedContradictionCounts,
			  detectedRawContradictionCount: data.detectedRawContradictionCount,
	  rejectedContradictionCandidateCount: data.rejectedContradictionCandidateCount,
	  appliedContradictionCount: data.appliedContradictionCount,
	  diagnosticCode: null,
  notice: null,
  limits: {
    successfulTrialTurns: usage.successfulTrialTurns,
    successfulTurnLimit: ENGINE2_LIMITS.maxSuccessfulTrialTurns,
    remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
    providerCalls: usage.providerCalls,
    maxMessageChars: ENGINE2_LIMITS.maxMessageChars,
    maxHistoryMessages: ENGINE2_LIMITS.maxHistoryMessages,
    maxFindingsPerResponse: ENGINE2_LIMITS.maxFindingsPerResponse,
  },
  trialCounters: {
    successfulTrialTurns: usage.successfulTrialTurns,
    successfulTurnMessageIds: usage.successfulTurnMessageIds,
    providerCalls: usage.providerCalls,
  },
  sessionSnapshot: {
    schemaVersion: 'engine2.session.v5',
    conversation: data.history,
    findings,
    findingEvents,
    contradictions,
    questions,
    questionEvents,
    rejectedFingerprints: data.rejectedFingerprints,
    readiness: readinessPayload(readiness, reportAvailable),
    materialReadiness: materialReadinessPayload(readiness),
    reportReadiness: readinessPayload(readiness, reportAvailable),
    guidanceForNextQuestions: data.guidanceForNextQuestions || null,
    activeQuestionId: null,
    questionLedgerMigrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
	    pendingDecisionPackageId: data.pendingDecisionPackageId,
	    pendingQuestionTransition: data.pendingQuestionTransition || null,
			    contradictionExtractionStatus: contradictionStatus,
			    contradictionPipelineStatus: pipelineStatus,
			    softTensionSignals: softTensionState.softTensionSignals,
			    ...persistedContradictionCounts,
			    detectedRawContradictionCount: data.detectedRawContradictionCount,
	    rejectedContradictionCandidateCount: data.rejectedContradictionCandidateCount,
	    appliedContradictionCount: data.appliedContradictionCount,
	    trialCounters: {
      successfulTrialTurns: usage.successfulTrialTurns,
      successfulTurnMessageIds: usage.successfulTurnMessageIds,
      providerCalls: usage.providerCalls,
    },
  },
  ...(adminEnabled ? { admin: buildAdmin(true, usage, data.trialId) } : {}),
})
}

const errorNotice = (language) => language === 'en'
  ? 'We could not analyse this turn. Your message and reply target were preserved. Please retry the same turn.'
  : 'Nie udało się przeanalizować tego turnu. Wiadomość i wskazane pytanie zostały zachowane. Ponów analizę tego samego turnu.'

const continueErrorNotice = (language) => language === 'en'
  ? 'We could not prepare the next questions. Please try again.'
  : 'Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.'

const panelQuestionsForNextAction = (payload) => Array.isArray(payload.panelQuestions)
    ? payload.panelQuestions.filter((question) => question?.status === 'open' && question?.presentation === 'panel')
      .filter((question) => toText(question.question || question.text, ENGINE2_TURN_LIMITS.maxQuestionChars))
    : panelOpenQuestions(payload.questions)

const countByStatus = (entries, knownStatuses = []) => {
  const counts = Object.fromEntries(knownStatuses.map((status) => [status, 0]))
  for (const entry of Array.isArray(entries) ? entries : []) {
    const status = toText(entry?.status, 80) || 'unknown'
    counts[status] = (counts[status] || 0) + 1
  }
  counts.total = Array.isArray(entries) ? entries.length : 0
  return counts
}

const buildFindingDiagnostics = ({ findings = [], findingEvents = [], findingProposals = [], pendingDecisionPackageId = null }) => {
  const visiblePendingProposals = (Array.isArray(findingProposals) ? findingProposals : [])
    .filter((finding) => finding?.status === 'pending')
  const packageFindings = pendingDecisionPackageId
    ? (Array.isArray(findings) ? findings : []).filter((finding) => finding?.packageId === pendingDecisionPackageId)
    : []
  const decisionEvents = (Array.isArray(findingEvents) ? findingEvents : []).filter((event) => event?.decisionSource)
  const confirmedOrRejectedWithoutDecisionSourceIds = (Array.isArray(findings) ? findings : [])
    .filter((finding) => ['confirmed', 'rejected'].includes(finding?.status))
    .filter((finding) => !finding?.decisionSource)
    .map((finding) => finding.id)
    .filter(Boolean)
  const packagePendingCount = packageFindings.filter((finding) => finding?.status === 'pending').length
  const pendingPackageStatus = !pendingDecisionPackageId
    ? 'none'
    : visiblePendingProposals.length > 0 || packagePendingCount > 0
      ? 'visible_pending'
      : packageFindings.length > 0 && packageFindings.every((finding) => ['confirmed', 'rejected'].includes(finding?.status))
        ? 'decided_waiting_continue'
        : 'inconsistent'
  return {
    statusCounts: countByStatus(findings, ['pending', 'confirmed', 'rejected']),
    visiblePendingProposalsCount: visiblePendingProposals.length,
    decisionEventsCount: decisionEvents.length,
    lastDecisionEvent: decisionEvents.at(-1) || null,
    pendingPackageStatus,
    pendingPackageFindingCount: packageFindings.length,
    pendingPackagePendingCount: packagePendingCount,
    confirmedOrRejectedWithoutDecisionSourceIds,
  }
}

const buildContradictionDiagnostics = ({
  contradictions = [],
  detectedCandidates = [],
	  appliedChanges = [],
	  findings = [],
	  detectionEvaluated = false,
		  detectionFailed = false,
		  detectionMeta = null,
		  rejectedContradictionCandidates = [],
		  softTensionSignals = [],
			}) => ({
		  inputConfirmedFindingsCount: (Array.isArray(findings) ? findings : []).filter((finding) => finding?.status === 'confirmed').length,
	  detectedRawContradictionCount: Number(detectionMeta?.detectedRawContradictionCount ?? (Array.isArray(detectedCandidates) ? detectedCandidates : []).length),
	  appliedContradictionCount: (Array.isArray(appliedChanges) ? appliedChanges : []).length,
	  detectedCandidatesCount: Number(detectionMeta?.detectedRawContradictionCount ?? (Array.isArray(detectedCandidates) ? detectedCandidates : []).length),
	  appliedCount: (Array.isArray(appliedChanges) ? appliedChanges : []).length,
  byStatus: countByStatus(contradictions, ['suspected', 'open', 'confirmed', 'active', 'resolved', 'dismissed', 'superseded']),
  openContradictionsCount: (Array.isArray(contradictions) ? contradictions : [])
    .filter((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction?.status)).length,
  contradictionExtractionStatus: detectionFailed ? 'failed' : detectionEvaluated ? 'evaluated' : 'not_evaluated',
  extractedContradictionCount: detectionEvaluated
    ? (Array.isArray(contradictions) ? contradictions : []).filter((contradiction) => !['dismissed', 'superseded'].includes(contradiction?.status)).length
    : null,
	  activeContradictionCount: detectionEvaluated
	    ? (Array.isArray(contradictions) ? contradictions : []).filter((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction?.status)).length
	    : null,
  resolvedContradictionCount: detectionEvaluated
    ? (Array.isArray(contradictions) ? contradictions : []).filter((contradiction) => contradiction?.status === 'resolved').length
    : null,
	  dismissedContradictionCount: detectionEvaluated
	    ? (Array.isArray(contradictions) ? contradictions : []).filter((contradiction) => contradiction?.status === 'dismissed').length
	    : null,
	  inputIncludesRecentUserMessages: Boolean(detectionMeta?.inputIncludesRecentUserMessages),
	  recentMessageCount: Number(detectionMeta?.recentMessageCount || 0),
	  recentUserMessageCount: Number(detectionMeta?.recentUserMessageCount || 0),
	  latestQuestion: detectionMeta?.latestQuestion || null,
	  latestAnswer: detectionMeta?.latestAnswer || null,
	  rawModelOutput: detectionMeta?.rawModelOutput || null,
		  acceptedContradictionCandidateCount: Number(detectionMeta?.acceptedContradictionCandidateCount || 0),
		  rejectedContradictionCandidateCount: Number(detectionMeta?.rejectedContradictionCandidateCount ?? (Array.isArray(rejectedContradictionCandidates) ? rejectedContradictionCandidates : []).length),
			  rejectedContradictionCandidates: Array.isArray(rejectedContradictionCandidates) ? rejectedContradictionCandidates : [],
			  softTensionSignals: Array.isArray(softTensionSignals) ? softTensionSignals : [],
			  softTensionSignalsCount: Array.isArray(softTensionSignals) ? softTensionSignals.length : 0,
			  hasTradeoffsOrContradictions: (Array.isArray(softTensionSignals) && softTensionSignals.length > 0) ||
			    (Array.isArray(contradictions) ? contradictions : []).some((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction?.status)),
			  repairedContradictionCandidates: Array.isArray(detectionMeta?.repairedContradictionCandidates) ? detectionMeta.repairedContradictionCandidates : [],
		  weakGroundingContradictionCandidateCount: Number(detectionMeta?.weakGroundingContradictionCandidateCount || 0),
		  contradictions: (Array.isArray(contradictions) ? contradictions : []).map((contradiction) => ({
		    id: contradiction.id || null,
		    semanticKey: contradiction.semanticKey || null,
		    status: contradiction.status || null,
		    reportBlocking: contradiction.reportBlocking === true,
		    sideA: contradiction.sideA || null,
		    sideB: contradiction.sideB || null,
		    sideASourceFindingIds: Array.isArray(contradiction.sideASourceFindingIds) ? contradiction.sideASourceFindingIds : [],
		    sideBSourceFindingIds: Array.isArray(contradiction.sideBSourceFindingIds) ? contradiction.sideBSourceFindingIds : [],
		    sideASourceMessageIds: Array.isArray(contradiction.sideASourceMessageIds) ? contradiction.sideASourceMessageIds : [],
		    sideBSourceMessageIds: Array.isArray(contradiction.sideBSourceMessageIds) ? contradiction.sideBSourceMessageIds : [],
		    evidenceStatus: contradiction.evidenceStatus || null,
		    origin: contradiction.origin || null,
		    formalEligible: contradiction.formalEligible === true,
		    rejectionReason: contradiction.rejectionReason || null,
		  })),
		  rejectedOrNonFormalContradictionCandidates: (Array.isArray(rejectedContradictionCandidates) ? rejectedContradictionCandidates : []).map((candidate) => ({
		    semanticKey: candidate.semanticKey || null,
		    evidenceStatus: candidate.evidenceStatus || null,
		    origin: candidate.origin || null,
		    formalEligible: candidate.formalEligible === true,
		    rejectionReason: candidate.rejectionReason || null,
		    reasons: Array.isArray(candidate.reasons) ? candidate.reasons : [],
		  })),
		  skipReason: detectionEvaluated || detectionFailed ? null : 'contradiction_detection_not_evaluated',
		})

const contradictionExtractionCounts = (contradictions = []) => {
  const entries = Array.isArray(contradictions) ? contradictions : []
  const formalExtractedContradictionCount = entries.filter((entry) => !['dismissed', 'superseded'].includes(entry?.status)).length
  const formalActiveContradictionCount = entries.filter((entry) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(entry?.status)).length
  return {
    formalExtractedContradictionCount,
    formalActiveContradictionCount,
    extractedContradictionCount: formalExtractedContradictionCount,
    activeContradictionCount: formalActiveContradictionCount,
    resolvedContradictionCount: entries.filter((entry) => entry?.status === 'resolved').length,
    dismissedContradictionCount: entries.filter((entry) => entry?.status === 'dismissed').length,
  }
}

const withSoftTensionMetadata = ({ counts, softTensionSignalsCount = 0 }) => {
  const softCount = Math.max(0, Math.trunc(Number(softTensionSignalsCount) || 0))
  return {
    ...counts,
    softTensionSignalsCount: softCount,
    hasTradeoffsOrContradictions: Number(counts.formalActiveContradictionCount || 0) > 0 || softCount > 0,
  }
}

const buildSoftTensionState = (data, { findings = data.findings, contradictions = data.contradictions } = {}) => {
  const confirmedFindings = (Array.isArray(findings) ? findings : []).filter((finding) => finding?.status === 'confirmed')
  const softTensionSignals = inferEngine2SoftTensionSignals({
    language: data.language,
    history: data.history,
    latestUserMessage: data.latestUserMessage,
    lastUserMessageId: data.messageId,
    messageId: data.messageId,
    confirmedFindings,
    contradictions,
  }).slice(0, 12)
  return {
    softTensionSignals,
    softTensionSignalsCount: softTensionSignals.length,
  }
}

const applyLocalConfirmedTensionContradictions = ({
  data,
  findings = data.findings,
  contradictions = data.contradictions,
  questions = data.questions,
  questionEvents = data.questionEvents,
  messageId = data.turnId,
  activeQuestionId = null,
}) => {
  const confirmedFindings = (Array.isArray(findings) ? findings : []).filter((finding) => finding?.status === 'confirmed')
  const localChanges = inferEngine2TensionContradictionChanges({
    language: data.language,
    confirmedFindings,
    allFindings: findings,
    contradictions,
    questions,
    history: data.history,
  })
  if (!localChanges.length) {
    return {
      contradictions,
      questions,
      questionEvents,
      appliedContradictionChanges: [],
      detectedContradictionCandidates: [],
    }
  }
  const applied = applyEngine2TurnDelta({
    delta: {
      findingChanges: [],
      contradictionChanges: localChanges,
      questionTransition: null,
      assistantReply: null,
      activeQuestionPresentation: null,
    },
    findings,
    contradictions,
    questions,
    questionEvents,
    trialId: data.trialId,
    messageId,
    activeQuestionId,
    previousReadiness: data.readiness,
    language: data.language,
  })
  return {
    contradictions: applied.contradictions,
    questions: applied.questions,
    questionEvents: applied.questionEvents,
    appliedContradictionChanges: applied.appliedContradictionChanges || [],
    detectedContradictionCandidates: localChanges,
  }
}

const contradictionPipelineStatus = ({
  contradictionExtractionStatus,
  formalActiveContradictionCount,
  softTensionSignalsCount,
  detectedRawContradictionCount,
  rejectedContradictionCandidateCount,
  appliedContradictionCount,
}) => {
  if (contradictionExtractionStatus === 'failed') return 'failed'
  if (
    Number(detectedRawContradictionCount || 0) > 0 &&
    Number(appliedContradictionCount || 0) === 0 &&
    Number(rejectedContradictionCandidateCount || 0) > 0
  ) return 'detected_not_registered'
  if (Number(formalActiveContradictionCount || 0) > 0) return 'formal_detected'
  if (Number(softTensionSignalsCount || 0) > 0) return 'soft_detected_only'
  return 'none_detected'
}

const buildQuestionDiagnostics = ({
  rawCandidates = [],
  appliedCandidates = [],
  readinessValidation = null,
  readinessEvaluated = false,
  questionGenerationAttempted = false,
  questionGenerationFailed = false,
  questionGenerationError = null,
  retryableQuestionGeneration = false,
}) => {
  const validationErrors = Array.isArray(readinessValidation?.errors)
    ? readinessValidation.errors.map((entry) => toText(entry, 500)).filter(Boolean)
    : []
  const appliedEntries = Array.isArray(appliedCandidates) ? appliedCandidates : []
  const diversity = buildEngine2QuestionSetDiversityCheck(appliedEntries)
  const questions = appliedEntries.map((question) => ({
    id: question.id || null,
    semanticKey: question.semanticKey || null,
    explorationArea: question.explorationArea || null,
    semanticExplorationKey: question.semanticExplorationKey || engine2QuestionExplorationKey(question) || null,
    targetType: question.targetType || null,
    targetContradictionId: question.targetContradictionId || null,
    matrixInspiration: question.matrixInspiration || null,
    matrixInspirationIsHypothesis: question.matrixInspirationIsHypothesis === true,
    groundedInFindingIds: Array.isArray(question.groundedInFindingIds) ? question.groundedInFindingIds : [],
    noveltyReason: question.noveltyReason || null,
    diversityReason: question.diversityReason || null,
    whyNotDuplicate: question.whyNotDuplicate || null,
    questionPurpose: question.questionPurpose || question.intent || null,
  }))
  return {
    questionCandidatesRawCount: (Array.isArray(rawCandidates) ? rawCandidates : []).length,
    questionCandidatesAppliedCount: (Array.isArray(appliedCandidates) ? appliedCandidates : []).length,
    questionCandidatesRejectedCount: Math.max(0, (Array.isArray(rawCandidates) ? rawCandidates : []).length - (Array.isArray(appliedCandidates) ? appliedCandidates : []).length),
    questionCandidateRejectReasons: validationErrors,
    panelQuestionCount: (Array.isArray(appliedCandidates) ? appliedCandidates : []).length,
    questionGenerationAttempted,
    questionGenerationFailed,
    questionGenerationError,
    retryableQuestionGeneration,
    readinessEvaluated,
    readinessSkipReason: readinessEvaluated ? null : 'readiness_not_evaluated',
    questions,
    questionSetDiversityCheck: diversity.questionSetDiversityCheck,
    distinctExplorationAreaCount: diversity.distinctExplorationAreaCount,
    duplicateSemanticRisk: diversity.duplicateSemanticRisk,
    setDiversityAccepted: diversity.setDiversityAccepted,
  }
}

const buildEngine2DiagnosticSummary = ({ payload, trace = null }) => {
  const snapshot = payload?.sessionSnapshot || {}
  const findings = Array.isArray(snapshot.findings) ? snapshot.findings : Array.isArray(payload?.findingUpdates) ? payload.findingUpdates : []
  const findingEvents = Array.isArray(snapshot.findingEvents) ? snapshot.findingEvents : Array.isArray(payload?.findingEvents) ? payload.findingEvents : []
  const contradictions = Array.isArray(snapshot.contradictions) ? snapshot.contradictions : Array.isArray(payload?.contradictions) ? payload.contradictions : []
  const findingProposals = Array.isArray(payload?.findingProposals) ? payload.findingProposals : []
  const rawCandidates = Array.isArray(payload?.questionCandidates)
    ? payload.questionCandidates
    : Array.isArray(trace?.questionCandidatesRaw) ? trace.questionCandidatesRaw : []
  const appliedCandidates = panelQuestionsForNextAction(payload || {})
  const detectedCandidates = Array.isArray(payload?.detectedContradictionCandidates)
    ? payload.detectedContradictionCandidates
    : Array.isArray(trace?.detectedContradictionCandidates) ? trace.detectedContradictionCandidates : []
  const appliedContradictionChanges = Array.isArray(payload?.appliedContradictionChanges)
    ? payload.appliedContradictionChanges
    : Array.isArray(trace?.appliedContradictionChanges) ? trace.appliedContradictionChanges : []
  const readinessEvaluated = Boolean(
    trace?.readinessEvaluation ||
    (payload?.readinessDecisionSource && payload.readinessDecisionSource !== 'not_evaluated_during_user_turn')
  )
  const questionGenerationAttempted = Boolean(payload?.questionGenerationAttempted || trace?.questionGenerationAttempted || trace?.questionGeneration)
  const questionGenerationFailed = Boolean(payload?.questionGenerationFailed || trace?.questionGenerationFailed)
  const findingDiagnostics = buildFindingDiagnostics({
    findings,
    findingEvents,
    findingProposals,
    pendingDecisionPackageId: payload?.pendingDecisionPackageId || snapshot.pendingDecisionPackageId || null,
  })
  const detectionEvaluated = payload?.contradictionExtractionStatus === 'evaluated' || trace?.action === 'detect_contradictions' && trace?.contradictionDetectionCompleted === true
  const detectionFailed = payload?.contradictionExtractionStatus === 'failed' || trace?.action === 'detect_contradictions' && payload?.retryable
  const contradictionDiagnostics = buildContradictionDiagnostics({
    contradictions,
    detectedCandidates,
    appliedChanges: appliedContradictionChanges,
    findings,
	    detectionEvaluated,
	    detectionFailed,
	    detectionMeta: trace?.contradictionDetectorDiagnostics || null,
	    rejectedContradictionCandidates: trace?.contradictionDetectorDiagnostics?.rejectedContradictionCandidates || [],
	    softTensionSignals: Array.isArray(payload?.softTensionSignals)
	      ? payload.softTensionSignals
	      : Array.isArray(snapshot?.softTensionSignals)
	        ? snapshot.softTensionSignals
	        : [],
	  })
  const questionDiagnostics = buildQuestionDiagnostics({
    rawCandidates,
    appliedCandidates,
    readinessValidation: trace?.readinessEvaluation?.validation || null,
    readinessEvaluated,
    questionGenerationAttempted,
    questionGenerationFailed,
    questionGenerationError: payload?.questionGenerationError || trace?.questionGenerationError || null,
    retryableQuestionGeneration: Boolean(payload?.retryableQuestionGeneration || trace?.retryableQuestionGeneration),
  })
  const stateConsistencyWarnings = []
  if (
    payload?.pendingDecisionPackageId &&
    findingDiagnostics.pendingPackageStatus !== 'visible_pending' &&
    findingDiagnostics.visiblePendingProposalsCount === 0
  ) stateConsistencyWarnings.push('pending_package_without_visible_pending_proposals')
  if (findingDiagnostics.confirmedOrRejectedWithoutDecisionSourceIds.length > 0) {
    stateConsistencyWarnings.push('confirmed_or_rejected_finding_without_decision_source')
  }
  if (
    payload &&
    !payload.reportAvailable &&
    !payload.trialEnded &&
    !payload.retryable &&
    !payload.awaitingContinueAfterDecision &&
    !payload.pendingDecisionPackageId &&
    appliedCandidates.length !== 3
  ) stateConsistencyWarnings.push('no_next_action_without_three_panel_questions')
  const expectedNextAction = payload?.retryable
    ? 'show_retry_error'
    : payload?.reportAvailable
      ? 'show_report'
      : payload?.trialEnded
        ? 'trial_ended'
        : payload?.pendingDecisionPackageId
          ? 'wait_for_user_decision'
          : payload?.awaitingContinueAfterDecision
            ? 'run_generate_panel_questions'
            : appliedCandidates.length === 3
            ? 'show_3_panel_questions'
            : readinessEvaluated
              ? 'show_retry_error'
              : 'run_generate_panel_questions'
  const nextActionDiagnosis = {
    expectedNextAction,
    blockingReason: payload?.diagnosticCode ||
      (payload?.pendingDecisionPackageId ? findingDiagnostics.pendingPackageStatus : null) ||
      (Array.isArray(payload?.reportBlockedReasons) ? payload.reportBlockedReasons[0] : null) ||
      stateConsistencyWarnings[0] ||
      null,
    hasVisiblePendingProposal: findingDiagnostics.visiblePendingProposalsCount > 0,
    allPackageItemsDecided: findingDiagnostics.pendingPackageStatus === 'decided_waiting_continue',
    nextQuestionGenerationTriggered: String(payload?.action || '') === 'generate_panel_questions',
    continueAfterDecisionsTriggered: String(payload?.action || '') === 'generate_panel_questions',
    readinessEvaluated,
    panelQuestionCount: appliedCandidates.length,
    openContradictionsCount: contradictionDiagnostics.openContradictionsCount,
    contradictionDetectionTriggered: Boolean(payload?.contradictionDetectionTriggered || trace?.contradictionDetectionTriggered),
    contradictionDetectionCompleted: Boolean(payload?.contradictionDetectionCompleted || trace?.contradictionDetectionCompleted),
    stateConsistent: stateConsistencyWarnings.length === 0,
  }
  return {
    findingDiagnostics,
    contradictionDiagnostics,
    questionDiagnostics,
    nextActionDiagnosis,
    stateConsistencyWarnings,
  }
}

const deadEndInvariantResult = (payload) => {
  const panelQuestions = panelQuestionsForNextAction(payload)
  return {
    invariant: 'dead_end_next_action',
    passed: Boolean(payload.reportAvailable || payload.trialEnded || payload.retryable || payload.pendingDecisionPackageId || payload.awaitingContinueAfterDecision || panelQuestions.length === 3),
    panelQuestionCount: panelQuestions.length,
    reportAvailable: Boolean(payload.reportAvailable),
    pendingDecisionPackageId: payload.pendingDecisionPackageId || null,
    trialEnded: Boolean(payload.trialEnded),
    retryable: Boolean(payload.retryable),
    awaitingContinueAfterDecision: Boolean(payload.awaitingContinueAfterDecision),
  }
}

const attachDeadEndInvariantResult = (payload, result) => {
  const current = Array.isArray(payload.backendInvariantResults) ? payload.backendInvariantResults : []
  payload.backendInvariantResults = [
    ...current.filter((entry) => entry?.invariant !== 'dead_end_next_action'),
    result,
  ]
  return payload
}

const responseHasNextAction = (payload) => {
  const result = deadEndInvariantResult(payload)
  attachDeadEndInvariantResult(payload, result)
  return result.passed
}

export const enforceEngine2NextActionInvariant = ({ payload, data, usage, adminEnabled = false }) => {
  if (responseHasNextAction(payload)) return payload
  const failedPayload = syncUsagePayload({
    ...payload,
    diagnosticCode: 'DEAD_END_NO_NEXT_ACTION',
    notice: errorNotice(data.language),
    retryable: true,
    retryMessageId: data.messageId || data.turnId || null,
    turnApplied: false,
    analysisStatus: 'retryable_error',
    conversationStatus: 'retryable_error',
    responseOrigin: 'dead_end_invariant',
    cacheStatus: 'miss',
    pendingDecisionPackageId: null,
    pendingQuestionTransition: null,
    sessionSnapshot: payload.sessionSnapshot
      ? {
          ...payload.sessionSnapshot,
          pendingDecisionPackageId: null,
          pendingQuestionTransition: null,
        }
      : payload.sessionSnapshot,
  }, usage, adminEnabled, data.trialId)
  return attachDeadEndInvariantResult(failedPayload, { ...deadEndInvariantResult(failedPayload), passed: false })
}

const buildPlannerInput = (data, remainingTurns) => ({
  action: data.action,
  trialId: data.trialId,
  language: data.language,
  conversation: data.history,
  lastUserMessageId: data.messageId,
  replyToGapId: data.replyToGapId,
  activeQuestionId: data.activeQuestionId,
  findings: data.findings.map((finding) => ({
    id: finding.id,
    semanticKey: finding.semanticKey || finding.id,
    text: finding.content,
    status: finding.status,
    subject: finding.subject,
    perspective: finding.perspective,
    proposedOperation: finding.proposedOperation,
    targetFindingId: finding.targetFindingId,
    originalContent: finding.originalContent || null,
  })),
  findingEvents: data.findingEvents,
  contradictions: data.contradictions,
  questions: data.questions.map((question) => ({
    id: question.id,
    semanticKey: question.semanticKey,
    text: question.question,
    intent: question.intent,
    status: question.status,
    presentation: question.presentation,
    askedCount: question.askedCount || 0,
    lastAskedAt: question.lastAskedAt || null,
    answeredByMessageIds: question.answeredByMessageIds || [],
    coveredByFindingIds: question.coveredByFindingIds || [],
  })),
  questionEvents: data.questionEvents,
  rejectedFingerprints: data.rejectedFingerprints,
  pendingDecisionPackageId: data.pendingDecisionPackageId,
  trialCounters: {
    successfulTrialTurns: data.clientSuccessfulTrialTurns,
    providerCalls: data.clientProviderCalls,
  },
  userDecisions: [
    ...data.findings.map((finding) => ({
      findingId: finding.id,
      decision: finding.status === 'confirmed'
        ? finding.source === 'user_edit' ? 'change' : 'accept'
        : finding.status === 'rejected' ? 'reject' : 'pending',
      text: finding.content,
    })),
    ...data.decisions,
  ],
  remainingTurns,
})

const buildTrace = ({
  traceId,
  data,
  input,
  planner,
  applied,
  readiness,
  startedAt,
  requestReceivedAt,
  deltaAppliedAt = null,
  usage,
  responseOrigin,
  assistantMessage = null,
  readinessEvaluation = null,
  readinessDecision = null,
}) => ({
  traceId,
  action: data.action,
  requestId: data.requestId,
  turnId: data.turnId,
  messageId: data.messageId,
  inputActiveQuestionId: data.activeQuestionId,
  inputReplyToGapId: data.replyToGapId,
  rawReplyToGapId: data.rawReplyToGapId,
  effectiveReplyToGapId: data.effectiveReplyToGapId,
  replyTargetSource: data.replyTargetSource,
  plannerInput: input,
  modelInputRaw: planner.attempts.at(-1)?.modelInput ?? null,
  modelInput: planner.attempts.at(-1)?.modelInput
    ? JSON.parse(planner.attempts.at(-1).modelInput)
    : null,
  modelInputSummary: {
    language: input.language,
    conversationMessages: input.conversation.length,
    findings: input.findings.map(({ id, status }) => ({ id, status })),
    contradictions: input.contradictions.map(({ id, status, semanticKey }) => ({ id, status, semanticKey })),
    questions: input.questions.map(({ id, status, presentation }) => ({ id, status, presentation })),
    decisionsCount: input.userDecisions.length,
    remainingTurns: input.remainingTurns,
  },
  rawStructuredOutput: planner.rawOutput,
  attemptOutputs: planner.attempts.map((attempt) => attempt.rawOutput),
  attemptDetails: planner.attempts.map((attempt, index) => ({
    attempt: index + 1,
    kind: index === 0 ? 'new_llm_call' : 'repair_retry',
    modelInputRaw: attempt.modelInput,
    rawOutput: attempt.rawOutput,
    parsedOutput: attempt.parsedOutput,
    canonicalizedOutput: attempt.canonicalizedOutput,
    canonicalizationChanges: attempt.canonicalizationChanges,
    ephemeralFindingIdMap: attempt.ephemeralFindingIdMap,
    validation: attempt.validation,
    timing: attempt.timing,
    model: attempt.meta?.modelUsed || attempt.meta?.attemptedModel || null,
    providerRequestId: attempt.meta?.providerRequestId || null,
    inputTokens: Number(attempt.meta?.tokens?.input || 0),
    outputTokens: Number(attempt.meta?.tokens?.output || 0),
    llmLatencyMs: Number(attempt.meta?.llmLatencyMs || 0),
    generationFallbackUsed: Boolean(attempt.meta?.generationFallbackUsed),
  })),
  parsedOutput: planner.attempts.at(-1)?.parsedOutput ?? null,
  parsedContradictionChanges: planner.attempts.at(-1)?.canonicalizedOutput?.contradictionChanges || planner.attempts.at(-1)?.parsedOutput?.contradictionChanges || [],
  validatedPlan: planner.delta,
  canonicalizationChanges: planner.canonicalizationChanges || [],
  repairCalls: Math.max(0, planner.attempts.length - 1),
  ephemeralFindingIdMap: planner.ephemeralFindingIdMap || {},
  questionsClosedByMessage: planner.questionsClosedByMessage || [],
  validation: { ok: planner.validation.ok, errors: planner.validation.errors },
  invariantErrors: planner.validation.errors,
  readinessDecisionSource: readinessDecision?.readinessDecisionSource || 'not_evaluated_during_user_turn',
  scoreComponents: readinessDecision?.scoreComponents || [],
  evidenceFindingIds: readinessDecision?.evidenceFindingIds || [],
  backendInvariantResults: readinessDecision?.backendInvariantResults || [],
  finalScore: readinessDecision?.finalScore ?? applied?.readiness?.reportScore ?? readiness?.reportScore ?? 0,
  reportBlockedReasons: readinessDecision?.reportBlockedReasons || [],
  readinessEvaluation: readinessEvaluation ? {
    validation: readinessEvaluation.validation,
    evaluation: readinessEvaluation.evaluation,
    attempts: readinessEvaluation.attempts,
  } : null,
  detectedContradictionCandidates: readinessEvaluation?.evaluation?.contradictionChanges || planner.delta?.contradictionChanges || [],
  questionCandidates: readinessEvaluation?.evaluation?.questionCandidates || [],
  questionCandidatesRaw: readinessEvaluation?.evaluation?.questionCandidates || [],
  questionCandidatesApplied: applied?.openQuestions || [],
  panelQuestionCount: (applied?.openQuestions || []).length,
  deadEndInvariantResult: null,
  contradictionReadinessImpact: readinessDecision?.contradictionReadinessImpact || null,
  stateBefore: {
    conversation: data.history,
    findings: data.findings,
    findingEvents: data.findingEvents,
    contradictions: data.contradictions,
    questions: data.questions,
    questionEvents: data.questionEvents,
    decisions: data.decisions,
    readiness: data.readiness,
  },
  appliedChanges: {
    findings: applied?.appliedFindingChanges || [],
    contradictions: applied?.appliedContradictionChanges || [],
    questions: applied?.appliedQuestionChanges || [],
  },
  appliedFindingChanges: applied?.appliedFindingChanges || [],
  appliedContradictionChanges: applied?.appliedContradictionChanges || [],
  appliedQuestionChanges: applied?.appliedQuestionChanges || [],
  stateAfter: applied ? {
    findings: applied.findings,
    findingEvents: applied.findingEvents,
    contradictions: applied.contradictions,
    questions: applied.questions,
    questionEvents: applied.questionEvents,
    readiness: applied.readiness,
  } : null,
  readiness: applied?.readiness || readiness,
  nextQuestionId: applied?.activeQuestion?.id || null,
  chatQuestion: applied?.activeQuestion?.question || null,
  chatMessageAppended: assistantMessage?.content || null,
  panelQuestions: applied?.openQuestions || [],
  durationMs: now() - startedAt,
  responseOrigin,
  cacheStatus: 'miss',
  telemetry: {
    model: planner.meta?.modelUsed || planner.meta?.attemptedModel || null,
    providerRequestId: planner.meta?.providerRequestId || null,
    providerRequestIds: planner.meta?.providerRequestIds || [],
    inputTokens: Number(planner.meta?.tokens?.input || 0),
    outputTokens: Number(planner.meta?.tokens?.output || 0),
    llmLatencyMs: Number(planner.meta?.llmLatencyMs || 0),
    totalBackendMs: now() - requestReceivedAt.ms,
    generationFallbackUsed: Boolean(planner.meta?.generationFallbackUsed),
    successfulTrialTurns: usage.successfulTrialTurns,
    providerCalls: usage.providerCalls,
    repairCalls: Math.max(0, planner.attempts.length - 1),
    remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
  },
  timings: {
    requestReceivedAt: requestReceivedAt.iso,
    llmStartedAt: planner.attempts[0]?.timing?.llmStartedAt || null,
    llmResponseReceivedAt: planner.attempts.at(-1)?.timing?.rawResponseReceivedAt || null,
    parsingCompletedAt: planner.attempts.at(-1)?.timing?.parseCompletedAt || null,
    validationCompletedAt: planner.attempts.at(-1)?.timing?.validationCompletedAt || null,
    deltaAppliedAt,
    apiResponseSentAt: null,
  },
  usage: usage.lastCall,
  repairRetry: Boolean(planner.meta.repairRetry),
  attempts: planner.attempts.length,
})

const attachApiResponseToTrace = (payload) => {
  if (!payload?.engine2Trace) return payload
  const diagnosticSummary = buildEngine2DiagnosticSummary({ payload, trace: payload.engine2Trace })
  payload.engine2Trace.findingDiagnostics = diagnosticSummary.findingDiagnostics
  payload.engine2Trace.contradictionDiagnostics = diagnosticSummary.contradictionDiagnostics
  payload.engine2Trace.questionDiagnostics = diagnosticSummary.questionDiagnostics
  payload.engine2Trace.nextActionDiagnosis = diagnosticSummary.nextActionDiagnosis
  payload.engine2Trace.stateConsistencyWarnings = diagnosticSummary.stateConsistencyWarnings
  const { engine2Trace: _trace, admin: _admin, ...apiResponse } = payload
  payload.engine2Trace.apiResponse = apiResponse
  payload.engine2Trace.timings.apiResponseSentAt = new Date().toISOString()
  payload.engine2Trace.telemetry.totalBackendMs = now() - Date.parse(payload.engine2Trace.timings.requestReceivedAt)
  return payload
}

const cacheablePayload = (payload) => {
  const { engine2Trace: _trace, admin: _admin, ...safePayload } = payload
  return safePayload
}

const dataSafeContradictionQuestion = (contradiction) => {
  const description = toText(contradiction?.description, 220)
  const sideA = toText(contradiction?.sideA, 140)
  const sideB = toText(contradiction?.sideB, 140)
  if (/ciep/i.test(`${description} ${sideA}`) && /zimn|ch(?:l|ł)od/i.test(`${description} ${sideB}`)) {
    return 'Czy lampa ma mieć dwa tryby barwy światła: ciepły do komputera i zimny do precyzyjnej pracy, czy raczej płynną regulację między nimi?'
  }
  if (/stref/i.test(`${description} ${sideA} ${sideB}`)) {
    return 'Czy chodzi Ci o jedną regulowaną strefę, kilka stref regulowanych niezależnie, czy kilka stref zmienianych jednocześnie jednym ustawieniem?'
  }
  if (/szerok|punktow|skupion/i.test(`${description} ${sideA} ${sideB}`)) {
    return 'Czy lampa ma przełączać się między szerokim światłem ogólnym i punktowym światłem do precyzyjnej pracy, czy regulować płynnie zakres skupienia?'
  }
  if (/jasno|nat[eę][zż]en/i.test(`${description} ${sideA} ${sideB}`)) {
    return 'Czy jasność chcesz określać przez konkretne sytuacje pracy, czy przez techniczny zakres regulacji lampy?'
  }
  return sideA && sideB
    ? `Który kierunek ma prowadzić projekt: ${sideA}, ${sideB}, czy przełączanie między nimi zależnie od sytuacji?`
    : 'Które założenie ma prowadzić projekt w tym napięciu, a kiedy dopuszczasz drugi tryb działania?'
}

const applyQuestionCandidatesToLedger = ({
  questions,
  questionEvents,
  candidates,
  contradictions = [],
  coveredSemanticKeys = [],
  fillFromExisting = true,
  trialId,
  turnId,
  nowIso = new Date().toISOString(),
}) => {
  const migratedQuestions = migrateEngine2QuestionLedger({ questions }).questions
  const previousOpenQuestions = migratedQuestions.filter((question) => question.status === 'open')
  const previousPanelQuestions = previousOpenQuestions.filter((question) => question.presentation === 'panel')
  let finalQuestions = migratedQuestions
    .map((question) => question.status === 'open' ? { ...question, presentation: 'hidden' } : question)
  let finalQuestionEvents = [...(questionEvents || [])]
  let replacedQuestionCount = 0
  let addedQuestionCount = 0
  let skippedCandidateCount = 0
  void coveredSemanticKeys
	  const contradictionByIdOrKey = new Map((Array.isArray(contradictions) ? contradictions : []).flatMap((contradiction) => [
	    [contradiction.id, contradiction],
	    [contradiction.semanticKey, contradiction],
	  ].filter(([key]) => key)))
	  const activeContradictionRefs = new Set((Array.isArray(contradictions) ? contradictions : [])
	    .filter((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction?.status))
	    .flatMap((contradiction) => [contradiction.id, contradiction.semanticKey])
	    .filter(Boolean))
	  let normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
	    .filter((candidate) => candidate && typeof candidate === 'object')
    .map((candidate, index) => ({
      clientRef: toText(candidate.clientRef, 120) || `question_${index + 1}`,
      semanticKey: toText(candidate.semanticKey, 120),
      question: toText(candidate.question ?? candidate.text, ENGINE2_TURN_LIMITS.maxQuestionChars),
      intent: toText(candidate.intent, ENGINE2_TURN_LIMITS.maxQuestionChars),
      presentation: 'panel',
      reason: toText(candidate.reason, 500),
      groundedInFindingIds: Array.isArray(candidate.groundedInFindingIds)
        ? candidate.groundedInFindingIds.map((id) => toText(id, 120)).filter(Boolean)
        : [],
      concreteAnchorText: toText(candidate.concreteAnchorText, 240),
      uncertaintyToResolve: toText(candidate.uncertaintyToResolve, 240),
      userCanAnswerFromExperience: candidate.userCanAnswerFromExperience === true,
      forbiddenGenericCategoryQuestion: candidate.forbiddenGenericCategoryQuestion === false ? false : true,
      targetType: normalizeEngine2QuestionTargetType(candidate.targetType, candidate),
      targetContradictionId: toText(candidate.targetContradictionId ?? candidate.targetContradictionRef, 120) || null,
      explorationArea: toText(candidate.explorationArea, 160) || null,
      semanticExplorationKey: engine2QuestionExplorationKey(candidate) || null,
      contradictionHypothesis: toText(candidate.contradictionHypothesis, 360) || null,
      matrixInspiration: toText(candidate.matrixInspiration, 220) || null,
      matrixInspirationIsHypothesis: candidate.matrixInspirationIsHypothesis === true,
      noveltyReason: toText(candidate.noveltyReason, 500) || null,
      diversityReason: toText(candidate.diversityReason, 500) || null,
      whyNotDuplicate: toText(candidate.whyNotDuplicate, 500) || null,
      questionPurpose: toText(candidate.questionPurpose, 500) || null,
	    }))
	    .filter((candidate) => candidate.semanticKey && candidate.question && candidate.intent && candidate.reason)
	    .sort((left, right) => Number(activeContradictionRefs.has(right.targetContradictionId)) - Number(activeContradictionRefs.has(left.targetContradictionId)))
	  const openTargetRefs = new Set(previousOpenQuestions.map((question) => question.targetContradictionId).filter(Boolean))
	  const firstUntargetedContradiction = (Array.isArray(contradictions) ? contradictions : [])
	    .find((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction?.status) && !openTargetRefs.has(contradiction.id) && !openTargetRefs.has(contradiction.semanticKey))
	  if (firstUntargetedContradiction && !normalizedCandidates.some((candidate) => activeContradictionRefs.has(candidate.targetContradictionId))) {
	    normalizedCandidates = [{
	      clientRef: `${firstUntargetedContradiction.semanticKey || firstUntargetedContradiction.id}_clarification`,
	      semanticKey: `${firstUntargetedContradiction.semanticKey || firstUntargetedContradiction.id}_clarification`,
	      question: dataSafeContradictionQuestion(firstUntargetedContradiction),
	      intent: 'Rozstrzygnąć aktywne napięcie projektowe.',
	      presentation: 'panel',
	      reason: firstUntargetedContradiction.description || 'Aktywne napięcie wymaga doprecyzowania.',
	      groundedInFindingIds: firstUntargetedContradiction.sourceFindingIds || firstUntargetedContradiction.findingIds || [],
	      concreteAnchorText: firstUntargetedContradiction.description || firstUntargetedContradiction.sideA || firstUntargetedContradiction.sideB || 'napięcie projektowe',
	      uncertaintyToResolve: firstUntargetedContradiction.description || 'Który tryb działania ma prowadzić projekt.',
	      userCanAnswerFromExperience: true,
	      forbiddenGenericCategoryQuestion: false,
	      targetType: 'contradiction_probe',
	      targetContradictionId: firstUntargetedContradiction.id || firstUntargetedContradiction.semanticKey,
	      explorationArea: 'confirmed_contradiction_clarification',
	      semanticExplorationKey: `contradiction_${firstUntargetedContradiction.semanticKey || firstUntargetedContradiction.id}`,
	      contradictionHypothesis: firstUntargetedContradiction.description || null,
	      matrixInspiration: null,
	      matrixInspirationIsHypothesis: false,
	      noveltyReason: 'Aktywna formalna sprzeczność nie ma jeszcze pytania w panelu.',
	      diversityReason: 'Pytanie dotyczy zapisanej sprzeczności, więc ma pierwszeństwo nad zwykłymi brakami.',
	      whyNotDuplicate: 'Nie istnieje otwarte pytanie targetujące tę sprzeczność.',
	      questionPurpose: 'Potwierdzić lub rozstrzygnąć dwie zapisane strony napięcia.',
	    }, ...normalizedCandidates]
	  }
	  const seenCandidateKeys = new Set()
	  const seenExplorationKeys = new Set()
	  const packageClusterCounts = new Map()
	  const historyClusterCounts = new Map()
	  for (const question of migratedQuestions) {
	    const cluster = engine2QuestionSemanticCluster(question.semanticKey)
	    if (cluster) historyClusterCounts.set(cluster, (historyClusterCounts.get(cluster) || 0) + 1)
	  }
	  const visibleQuestionIds = []
	  for (const candidate of normalizedCandidates) {
	    if (seenCandidateKeys.has(candidate.semanticKey)) {
	      skippedCandidateCount += 1
	      continue
	    }
	    seenCandidateKeys.add(candidate.semanticKey)
	    const cluster = engine2QuestionSemanticCluster(candidate.semanticKey)
	    const explorationKey = engine2QuestionExplorationKey(candidate)
	    const hasExplorationMetadata = Boolean(candidate.matrixInspiration || candidate.explorationArea || candidate.semanticExplorationKey || candidate.contradictionHypothesis)
	    const hasTargetContradiction = Boolean(candidate.targetContradictionId)
	    if (explorationKey && seenExplorationKeys.has(explorationKey)) {
	      skippedCandidateCount += 1
	      continue
	    }
	    if (cluster && (packageClusterCounts.get(cluster) || 0) >= 2 && !hasTargetContradiction && !hasExplorationMetadata) {
	      skippedCandidateCount += 1
	      continue
	    }
	    if (cluster && (historyClusterCounts.get(cluster) || 0) >= 2 && !hasTargetContradiction && !hasExplorationMetadata) {
	      skippedCandidateCount += 1
	      continue
	    }
	    const existingIndex = finalQuestions.findIndex((question) => question.status === 'open' && question.semanticKey === candidate.semanticKey)
	    if (existingIndex >= 0) {
      const existing = finalQuestions[existingIndex]
      finalQuestions[existingIndex] = {
        ...existing,
        question: candidate.question,
        text: candidate.question,
        intent: candidate.intent,
        presentation: 'panel',
        reason: candidate.reason,
        groundedInFindingIds: candidate.groundedInFindingIds,
        concreteAnchorText: candidate.concreteAnchorText,
        uncertaintyToResolve: candidate.uncertaintyToResolve,
        userCanAnswerFromExperience: candidate.userCanAnswerFromExperience,
        forbiddenGenericCategoryQuestion: candidate.forbiddenGenericCategoryQuestion,
        targetType: candidate.targetType,
        targetContradictionId: contradictionByIdOrKey.get(candidate.targetContradictionId)?.id || candidate.targetContradictionId,
        explorationArea: candidate.explorationArea,
        semanticExplorationKey: candidate.semanticExplorationKey,
        contradictionHypothesis: candidate.contradictionHypothesis,
        matrixInspiration: candidate.matrixInspiration,
        matrixInspirationIsHypothesis: candidate.matrixInspirationIsHypothesis,
        noveltyReason: candidate.noveltyReason,
        diversityReason: candidate.diversityReason,
        whyNotDuplicate: candidate.whyNotDuplicate,
        questionPurpose: candidate.questionPurpose,
        priorityReason: candidate.reason,
        updatedAt: nowIso,
      }
	      visibleQuestionIds.push(existing.id)
	      if (cluster) packageClusterCounts.set(cluster, (packageClusterCounts.get(cluster) || 0) + 1)
	      if (explorationKey) seenExplorationKeys.add(explorationKey)
	      replacedQuestionCount += 1
	      continue
	    }
    const questionId = assignedEngine2QuestionId({ trialId, sourceMessageId: turnId, semanticKey: candidate.semanticKey })
    if (finalQuestions.some((question) => question.id === questionId)) {
      skippedCandidateCount += 1
      continue
    }
	    visibleQuestionIds.push(questionId)
	    if (cluster) packageClusterCounts.set(cluster, (packageClusterCounts.get(cluster) || 0) + 1)
	    if (explorationKey) seenExplorationKeys.add(explorationKey)
	    addedQuestionCount += 1
    finalQuestions.push({
      id: questionId,
      semanticKey: candidate.semanticKey,
      question: candidate.question,
      text: candidate.question,
      intent: candidate.intent,
      status: 'open',
      presentation: candidate.presentation,
      createdFromMessageId: turnId,
      askedCount: 0,
      lastAskedAt: null,
      answeredByMessageIds: [],
      coveredByFindingIds: [],
      reason: candidate.reason,
      groundedInFindingIds: candidate.groundedInFindingIds,
      concreteAnchorText: candidate.concreteAnchorText,
      uncertaintyToResolve: candidate.uncertaintyToResolve,
      userCanAnswerFromExperience: candidate.userCanAnswerFromExperience,
      forbiddenGenericCategoryQuestion: candidate.forbiddenGenericCategoryQuestion,
      targetType: candidate.targetType,
      targetContradictionId: contradictionByIdOrKey.get(candidate.targetContradictionId)?.id || candidate.targetContradictionId,
      explorationArea: candidate.explorationArea,
      semanticExplorationKey: candidate.semanticExplorationKey,
      contradictionHypothesis: candidate.contradictionHypothesis,
      matrixInspiration: candidate.matrixInspiration,
      matrixInspirationIsHypothesis: candidate.matrixInspirationIsHypothesis,
      noveltyReason: candidate.noveltyReason,
      diversityReason: candidate.diversityReason,
      whyNotDuplicate: candidate.whyNotDuplicate,
      questionPurpose: candidate.questionPurpose,
      priorityReason: candidate.reason,
      updatedAt: nowIso,
    })
    finalQuestionEvents.push({
      id: `engine2-question-event-${stableHash(`${turnId}:${questionId}:ask`)}`,
      entityId: questionId,
      operation: 'ask',
      messageId: null,
      createdAt: nowIso,
    })
  }
	  const existingFillIds = []
	  if (fillFromExisting && visibleQuestionIds.length < 3) {
	    const visibleSet = new Set(visibleQuestionIds)
	    const visibleClusterCounts = new Map()
	    for (const id of visibleQuestionIds) {
	      const question = finalQuestions.find((entry) => entry.id === id)
	      const cluster = engine2QuestionSemanticCluster(question?.semanticKey)
	      if (cluster) visibleClusterCounts.set(cluster, (visibleClusterCounts.get(cluster) || 0) + 1)
	    }
	    const existingCandidates = [
	      ...previousPanelQuestions,
	      ...previousOpenQuestions.filter((question) => !previousPanelQuestions.some((panelQuestion) => panelQuestion.id === question.id)),
	    ]
	    for (const question of existingCandidates) {
	      if (visibleQuestionIds.length >= 3) break
	      if (!question?.id || visibleSet.has(question.id)) continue
	      const cluster = engine2QuestionSemanticCluster(question.semanticKey)
	      if (cluster && (visibleClusterCounts.get(cluster) || 0) >= 2 && !question.targetContradictionId) {
	        skippedCandidateCount += 1
	        continue
	      }
	      visibleQuestionIds.push(question.id)
	      visibleSet.add(question.id)
	      if (cluster) visibleClusterCounts.set(cluster, (visibleClusterCounts.get(cluster) || 0) + 1)
	      existingFillIds.push(question.id)
	    }
	  }

  const visible = new Set(visibleQuestionIds.slice(0, 3))
  finalQuestions = finalQuestions.map((question) => {
    if (question.status !== 'open') return { ...question, presentation: 'hidden' }
    return visible.has(question.id)
      ? { ...question, presentation: 'panel' }
      : { ...question, presentation: 'hidden' }
  })
  const panelQuestions = finalQuestions.filter((question) => question.status === 'open' && question.presentation === 'panel').slice(0, 3)
  return {
    questions: finalQuestions,
    activeQuestion: null,
    activeQuestionId: null,
    openQuestions: panelQuestions,
    migrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
    questionEvents: finalQuestionEvents,
    diagnostics: {
      keptExistingQuestionCount: existingFillIds.length,
      replacedQuestionCount,
      addedQuestionCount,
      skippedCandidateCount,
      panelFilledFromExistingCount: existingFillIds.length,
    },
  }
}

export const buildReadinessEvaluationInput = (data, { findings = data.findings, contradictions = data.contradictions, questions = data.questions } = {}) => {
  const confirmedFindings = (Array.isArray(findings) ? findings : []).filter((finding) => finding.status === 'confirmed')
  const activeContradictions = (Array.isArray(contradictions) ? contradictions : [])
    .filter((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction.status))
  const softTensionState = buildSoftTensionState(data, { findings, contradictions })
  const formalCounts = contradictionExtractionCounts(contradictions)
  return {
    language: data.language,
    confirmedFindings: confirmedFindings.map((finding) => ({
      id: finding.id,
      semanticKey: finding.semanticKey,
      text: finding.displayText || finding.text || finding.content,
      subject: finding.subject,
      perspective: finding.perspective,
    })),
    allFindings: findings,
    activeContradictions,
    formalActiveContradictionCount: formalCounts.formalActiveContradictionCount,
    reportBlockingContradictions: activeContradictions.filter((contradiction) => contradiction.reportBlocking),
    softTensionSignals: softTensionState.softTensionSignals,
    softTensionSignalsCount: softTensionState.softTensionSignalsCount,
    hasTradeoffsOrContradictions: activeContradictions.length > 0 || softTensionState.softTensionSignalsCount > 0,
    questions: (Array.isArray(questions) ? questions : []).map((question) => ({
      id: question.id,
      semanticKey: question.semanticKey,
      text: question.question || question.text,
      intent: question.intent,
      status: question.status,
      coveredByFindingIds: question.coveredByFindingIds || [],
    })),
    conversationContext: data.history.slice(-12),
  }
}

const buildReadinessGuidanceForQuestions = (readinessEvaluation) => {
  const evaluation = readinessEvaluation?.evaluation || readinessEvaluation || null
  if (!evaluation || typeof evaluation !== 'object') return null
  const incompleteComponents = (Array.isArray(evaluation.components) ? evaluation.components : [])
    .filter((component) => ['partial', 'missing'].includes(component?.status))
    .map((component) => component.key)
    .filter(Boolean)
  const criticalMissing = Array.isArray(evaluation.criticalMissing)
    ? evaluation.criticalMissing.map((entry) => toText(entry?.missing || entry, 200)).filter(Boolean)
    : []
  const preferredQuestionCandidates = Array.isArray(evaluation.questionCandidates)
    ? evaluation.questionCandidates
    : []
  if (!incompleteComponents.length && !criticalMissing.length && !preferredQuestionCandidates.length) return null
  return { incompleteComponents, criticalMissing, preferredQuestionCandidates }
}

const mergePreferredQuestionCandidates = (...candidateSets) => {
  const byKey = new Map()
  for (const candidates of candidateSets) {
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const key = toText(candidate?.semanticKey, 120)
      if (key && !byKey.has(key)) byKey.set(key, candidate)
    }
  }
  return [...byKey.values()]
}

const latestConfirmedFindingIds = (findings = []) => {
  const timed = (Array.isArray(findings) ? findings : [])
    .filter((finding) => finding?.status === 'confirmed' && Number.isFinite(Date.parse(String(finding.updatedAt || finding.decisionAt || ''))))
    .map((finding) => ({ id: finding.id, time: Date.parse(String(finding.updatedAt || finding.decisionAt || '')) }))
    .sort((left, right) => right.time - left.time)
  const newestTime = timed[0]?.time ?? null
  return new Set(timed.filter((finding) => finding.time === newestTime).map((finding) => finding.id).filter(Boolean))
}

const latestAcceptedFindingIdsFromEvents = ({ requestedIds = [], findings = [], findingEvents = [] }) => {
  const requested = new Set((Array.isArray(requestedIds) ? requestedIds : []).map((id) => toText(id, 120)).filter(Boolean))
  if (requested.size > 0) return requested
  const explicit = (Array.isArray(findingEvents) ? findingEvents : [])
    .filter((event) => event?.operation === 'decision' && ['user_accept', 'user_change'].includes(event?.decisionSource))
    .map((event) => ({
      id: toText(event.findingId || event.entityId, 120),
      time: Date.parse(String(event.decisionAt || event.createdAt || '')),
    }))
    .filter((entry) => entry.id && Number.isFinite(entry.time))
    .sort((left, right) => right.time - left.time)
  const newest = explicit[0]?.time ?? null
  if (newest !== null) return new Set(explicit.filter((entry) => entry.time === newest).map((entry) => entry.id))
  return latestConfirmedFindingIds(findings)
}

const countLatestFindingCoverage = ({ candidates = [], findings = [] }) => {
  const latestIds = latestConfirmedFindingIds(findings)
  if (latestIds.size === 0) return 0
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) =>
    (candidate?.groundedInFindingIds || []).some((id) => latestIds.has(id))
  ).length
}

const evaluateQuestionInvariants = ({ questions, activeQuestionId, conversation = [], pendingQuestionTransition = null, turnKind = null, effectiveReplyToGapId = null }) => {
  const open = (Array.isArray(questions) ? questions : []).filter((question) => question.status === 'open')
  const panel = panelOpenQuestions(questions)
  const panelKeys = panel.map((question) => question.semanticKey || question.id).filter(Boolean)
  const openPanelWithoutText = (Array.isArray(questions) ? questions : [])
    .filter((question) => question.status === 'open' && question.presentation === 'panel')
    .filter((question) => !toText(question.question || question.text, ENGINE2_TURN_LIMITS.maxQuestionChars))
  const active = activeQuestionId ? open.find((question) => question.id === activeQuestionId) || null : null
  const closedVisible = (Array.isArray(questions) ? questions : []).filter((question) => question.status !== 'open' && ['ask_now', 'ask_later', 'panel'].includes(question.presentation))
  const chatQuestionMessages = (Array.isArray(conversation) ? conversation : []).filter((message) => message.role === 'assistant' && message.questionId)
  return [
    {
      invariant: 'substantive_reply_has_staged_closure',
      passed: turnKind !== 'substantive_information' || !effectiveReplyToGapId || pendingQuestionTransition?.type === 'close',
    },
    {
      invariant: 'clarification_request_does_not_close_question',
      passed: turnKind !== 'clarification_request' || !pendingQuestionTransition,
    },
    { invariant: 'closed_question_not_visible', passed: closedVisible.length === 0 },
    { invariant: 'active_question_not_auto_selected', passed: !activeQuestionId || Boolean(active) },
    { invariant: 'no_ask_now_questions', passed: open.every((question) => question.presentation !== 'ask_now') },
    { invariant: 'panel_contains_at_most_three_questions', passed: panel.length <= 3 },
    { invariant: 'open_panel_questions_have_text', passed: openPanelWithoutText.length === 0, questionIds: openPanelWithoutText.map((question) => question.id).filter(Boolean) },
    { invariant: 'panel_semantic_keys_unique', passed: new Set(panelKeys).size === panelKeys.length },
    {
      invariant: 'answered_question_not_selected_by_continue',
      passed: !activeQuestionId || !(Array.isArray(questions) ? questions : []).some((question) => question.id === activeQuestionId && question.status !== 'open'),
    },
    {
      invariant: 'panel_question_not_auto_added_to_chat',
      passed: chatQuestionMessages.every((message) => !panel.some((question) => question.id === message.questionId)),
    },
  ]
}

export const handleEngine2Public = async (req, res) => {
  const requestReceivedAt = { iso: new Date().toISOString(), ms: now() }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
  const validation = validateEngine2Request(req.body)
  if (!validation.ok) return sendJson(res, validation.status, { ok: false, error: validation.error })
  const data = validation.data
  const ip = getIp(req)
  const adminEnabled = await resolveDiagnosticsEnabled(req, res)
  const diagnostics = resolveEngine2DiagnosticsRequest({ req, ip, diagnosticsAdmin: adminEnabled })
  const turnKey = `${ip}:${data.trialId}:${data.action}:${data.turnId}`
  const messageKey = data.action === 'analyze_message' ? `${ip}:${data.trialId}:${data.messageId}` : null
  const cachedTurn = diagnostics.dryRun ? null : getCachedTurn(turnKey)
  const cachedMessage = diagnostics.dryRun || cachedTurn || !messageKey ? null : getCachedMessage(messageKey)
  const cached = cachedTurn || cachedMessage
  if (cached) {
    const responseOrigin = cachedTurn ? 'idempotency_replay' : 'message_idempotency_replay'
    const replayPayload = {
      ...cached,
      turnId: data.turnId,
      requestId: data.requestId,
      stateVersionReturned: data.stateVersionSent + 1,
      responseOrigin,
      cacheStatus: 'hit',
    }
    if (diagnostics.enabled) {
      replayPayload.engine2Trace = {
        traceId: `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:replay`)}`,
        action: data.action,
        requestId: data.requestId,
        turnId: data.turnId,
        messageId: data.messageId,
        responseOrigin,
        cacheStatus: 'hit',
        timings: {
          requestReceivedAt: requestReceivedAt.iso,
          llmStartedAt: null,
          llmResponseReceivedAt: null,
          parsingCompletedAt: null,
          validationCompletedAt: null,
          deltaAppliedAt: null,
          apiResponseSentAt: null,
        },
        telemetry: {
          model: null,
          providerRequestId: null,
          inputTokens: 0,
          outputTokens: 0,
          llmLatencyMs: 0,
          totalBackendMs: now() - requestReceivedAt.ms,
          generationFallbackUsed: false,
          successfulTrialTurns: Number(replayPayload.trialCounters?.successfulTrialTurns || 0),
          providerCalls: Number(replayPayload.trialCounters?.providerCalls || 0),
          remainingSuccessfulTurns: Number(replayPayload.limits?.remainingSuccessfulTurns || 0),
        },
      }
      attachApiResponseToTrace(replayPayload)
    }
    return sendJson(res, 200, replayPayload)
  }
  if (inFlightTurns.has(turnKey)) return sendJson(res, 409, { ok: false, error: 'DUPLICATE_TURN_IN_FLIGHT' })
  if (!limiterByIp(ip).allowed || !limiterByTrial(`${ip}:${data.trialId}`).allowed) return sendJson(res, 429, { ok: false, error: 'RATE_LIMIT' })

  const usageKey = `${ip}:${data.trialId}`
  let usage = mergeClientTrialCounters(getTrialUsage(usageKey), data)
  inFlightTurns.add(turnKey)
  try {
    let continuationDecisionState = null
    let decisionPackageInvariant = null
    if (data.action === 'commit_finding_decisions') {
      const decisionValidation = validateEngine2DecisionPackage({
        findings: data.findings,
        decisions: data.decisions,
        pendingDecisionPackageId: data.pendingDecisionPackageId,
      })
      decisionPackageInvariant = decisionValidation.invariant
      if (!decisionValidation.ok) {
        const payload = {
          ...buildResponse({ data, usage, findings: data.findings, questions: data.questions, readiness: data.readiness, adminEnabled }),
          diagnosticCode: 'ENGINE2_USER_DECISION_EVENT_REQUIRED',
          notice: errorNotice(data.language),
          retryable: true,
          retryMessageId: data.turnId,
          responseOrigin: 'decision_invariant_failed',
          cacheStatus: 'miss',
          turnApplied: false,
          analysisStatus: 'retryable_error',
          backendInvariantResults: [decisionValidation.invariant],
        }
        if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(payload) })
        return sendJson(res, 200, payload)
      }
      const appliedDecisions = applyEngine2Decisions(data)
      const staged = applyStagedEngine2QuestionTransition({
        questions: data.questions,
        questionEvents: data.questionEvents,
        transition: data.pendingQuestionTransition,
        findings: appliedDecisions.findings,
        trialId: data.trialId,
        messageId: data.pendingQuestionTransition?.sourceMessageId || data.messageId,
      })
      const migrated = migrateEngine2QuestionLedger({ questions: staged.questions })
      const packageId = data.pendingDecisionPackageId
      const packageFindings = packageId
        ? appliedDecisions.findings.filter((finding) => finding.packageId === packageId)
        : []
      const decisionEventIds = new Set(explicitDecisionEventsForPackage({
        findingEvents: appliedDecisions.findingEvents,
        packageId,
      }).map((event) => event.findingId || event.entityId).filter(Boolean))
      const allPackageItemsDecided = !packageId || (
        packageFindings.length > 0 &&
        packageFindings.every((finding) => ['confirmed', 'rejected'].includes(finding.status) && decisionEventIds.has(finding.id))
      )
      continuationDecisionState = {
        findings: appliedDecisions.findings,
        findingEvents: appliedDecisions.findingEvents,
        rejectedFingerprints: appliedDecisions.rejectedFingerprints,
        questions: migrated.questions,
        questionEvents: staged.questionEvents,
        activeQuestionId: migrated.activeQuestionId,
        stagedTransitionApplied: staged.applied,
        allPackageItemsDecided,
        packageId,
      }
    }

    if (data.action === 'commit_finding_decisions') {
      const continuation = continuationDecisionState
      const packageId = continuation.packageId || data.pendingDecisionPackageId
      const pendingDecisionPackageId = continuation.allPackageItemsDecided ? null : packageId
      const pendingProposals = pendingDecisionPackageId
        ? continuation.findings.filter((finding) => finding.packageId === pendingDecisionPackageId && finding.status === 'pending')
        : []
      const decisionEvents = explicitDecisionEventsForPackage({
        findingEvents: continuation.findingEvents,
        packageId,
      })
      const lifecycleInvariants = evaluateDecisionLifecycleInvariants({
        findings: continuation.findings,
        findingEvents: continuation.findingEvents,
        packageId,
        finalDecision: continuation.allPackageItemsDecided,
        nextQuestionGenerationRequired: continuation.allPackageItemsDecided,
      })
      data.findings = continuation.findings
      data.findingEvents = continuation.findingEvents
      data.rejectedFingerprints = continuation.rejectedFingerprints
      data.questions = continuation.questions
      data.questionEvents = continuation.questionEvents
      data.pendingDecisionPackageId = pendingDecisionPackageId
      data.pendingQuestionTransition = continuation.allPackageItemsDecided ? null : data.pendingQuestionTransition
      const payload = {
        ...buildResponse({
          data, usage, findings: data.findings, findingEvents: data.findingEvents,
          contradictions: data.contradictions, questions: data.questions, questionEvents: data.questionEvents,
          readiness: data.readiness, reportAvailable: false, adminEnabled,
        }),
        packageId,
        findingProposals: pendingProposals,
        pendingDecisionPackageId,
        pendingQuestionTransition: data.pendingQuestionTransition,
        conversationStatus: continuation.allPackageItemsDecided ? 'decision_committed' : 'awaiting_decisions',
        decisionApplied: true,
        decisionEvents,
        decisionState: {
          packageId,
          allPackageItemsDecided: continuation.allPackageItemsDecided,
          decisionEventsCount: decisionEvents.length,
          pendingDecisionPackageId,
          stagedTransitionApplied: continuation.stagedTransitionApplied,
        },
        continueApplied: false,
        continueError: null,
        retryableContinueError: false,
        awaitingContinueAfterDecision: continuation.allPackageItemsDecided,
        backendInvariantResults: [
          decisionPackageInvariant,
          ...lifecycleInvariants,
        ].filter(Boolean),
        reportBlockedReasons: continuation.allPackageItemsDecided
          ? ['awaiting_generate_panel_questions']
          : ['awaiting_user_decisions_or_continuation'],
        turnApplied: true,
        analysisStatus: 'applied',
        retryable: false,
        responseOrigin: 'finding_decision_commit',
        cacheStatus: 'miss',
      }
      payload.sessionSnapshot = {
        ...payload.sessionSnapshot,
        pendingDecisionPackageId,
        pendingQuestionTransition: data.pendingQuestionTransition || null,
      }
      const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage, adminEnabled })
      if (diagnostics.enabled) {
        guardedPayload.engine2Trace = {
          traceId: `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${now()}`)}`,
          action: data.action,
          requestId: data.requestId,
          turnId: data.turnId,
          messageId: data.messageId,
          responseOrigin: guardedPayload.responseOrigin,
          cacheStatus: 'miss',
          decisionEvents,
          questionCandidatesRaw: [],
          questionCandidatesApplied: guardedPayload.panelQuestions || guardedPayload.openQuestions || [],
          panelQuestionCount: (guardedPayload.panelQuestions || guardedPayload.openQuestions || []).length,
          deadEndInvariantResult: (guardedPayload.backendInvariantResults || []).find((entry) => entry?.invariant === 'dead_end_next_action') || null,
          chatQuestion: null,
          timings: {
            requestReceivedAt: requestReceivedAt.iso,
            llmStartedAt: null,
            llmResponseReceivedAt: null,
            parsingCompletedAt: new Date().toISOString(),
            validationCompletedAt: new Date().toISOString(),
            deltaAppliedAt: new Date().toISOString(),
            apiResponseSentAt: null,
          },
          telemetry: {
            model: null,
            providerRequestId: null,
            providerRequestIds: [],
            inputTokens: 0,
            outputTokens: 0,
            llmLatencyMs: 0,
            totalBackendMs: now() - requestReceivedAt.ms,
            generationFallbackUsed: false,
            successfulTrialTurns: usage.successfulTrialTurns,
            providerCalls: usage.providerCalls,
            repairCalls: 0,
            remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
          },
        }
        attachApiResponseToTrace(guardedPayload)
      }
      if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(guardedPayload) })
      return sendJson(res, 200, guardedPayload)
    }

    if (data.action === 'analyze_message' && usage.successfulTrialTurns >= ENGINE2_LIMITS.maxSuccessfulTrialTurns) {
      const payload = {
        ...buildResponse({ data, usage, findings: data.findings, questions: data.questions, readiness: data.readiness, adminEnabled }),
        analysisStatus: 'fatal_error',
        trialEnded: true,
        diagnosticCode: 'ENGINE2_TRIAL_LIMIT_REACHED',
        notice: data.language === 'en' ? 'The public trial limit has been reached.' : 'Limit publicznego triala został wyczerpany.',
      }
      payload.responseOrigin = 'trial_limit'
      payload.cacheStatus = 'miss'
      if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(payload) })
      return sendJson(res, 200, payload)
    }

    const aiSupportEnabled = resolveAiSupportEnabled(req, req.body)
    if (!aiSupportEnabled || !process.env.OPENAI_API_KEY) {
      const payload = {
        ...buildResponse({ data, usage, findings: data.findings, questions: data.questions, readiness: data.readiness, adminEnabled }),
        diagnosticCode: !aiSupportEnabled ? 'ENGINE2_AI_DISABLED' : 'ENGINE2_AI_UNAVAILABLE',
        notice: errorNotice(data.language),
        retryable: true,
        retryMessageId: data.messageId,
        replyToGapId: data.replyToGapId,
        activeQuestionId: data.activeQuestionId,
        turnApplied: false,
        analysisStatus: 'retryable_error',
      }
      payload.responseOrigin = !aiSupportEnabled ? 'ai_disabled' : 'ai_unavailable'
      payload.cacheStatus = 'miss'
      if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(payload) })
      return sendJson(res, 200, payload)
    }

    const startedAt = now()
    const remainingTurns = ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns
    if (data.action === 'detect_contradictions') {
      const traceId = `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${startedAt}`)}`
      const confirmedFindings = data.findings.filter((finding) => finding.status === 'confirmed')
      const detectionInput = {
        language: data.language,
        confirmedFindings,
        allFindings: data.findings,
	        contradictions: data.contradictions,
	        questions: data.questions,
	        history: data.history,
	        activeQuestionId: data.activeQuestionId,
	        replyToQuestionId: data.replyToGapId,
	      }
      const detection = await detectEngine2Contradictions({
        input: detectionInput,
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: true,
        rateLimiter: limiterByTrial,
        rateLimitKey: `${ip}:${data.trialId}:contradictions`,
      })
      usage = await accumulateUsage(usage, detection.meta)
      trialUsage.set(usageKey, { ...usage, updatedAt: now() })
      if (!detection.ok) {
	        const softTensionState = buildSoftTensionState(data)
	        const counts = withSoftTensionMetadata({
	          counts: contradictionExtractionCounts(data.contradictions),
	          softTensionSignalsCount: softTensionState.softTensionSignalsCount,
	        })
	        const failedCounts = {
	          formalExtractedContradictionCount: counts.formalExtractedContradictionCount,
	          formalActiveContradictionCount: counts.formalActiveContradictionCount,
	          extractedContradictionCount: softTensionState.softTensionSignalsCount > 0 ? counts.formalExtractedContradictionCount : null,
	          activeContradictionCount: softTensionState.softTensionSignalsCount > 0 ? counts.formalActiveContradictionCount : null,
	          resolvedContradictionCount: counts.resolvedContradictionCount,
	          dismissedContradictionCount: counts.dismissedContradictionCount,
	          softTensionSignals: softTensionState.softTensionSignals,
	          softTensionSignalsCount: softTensionState.softTensionSignalsCount,
	          hasTradeoffsOrContradictions: counts.hasTradeoffsOrContradictions,
	          contradictionPipelineStatus: contradictionPipelineStatus({
	            contradictionExtractionStatus: 'failed',
	            formalActiveContradictionCount: counts.formalActiveContradictionCount,
	            softTensionSignalsCount: softTensionState.softTensionSignalsCount,
	            detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
	            rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
	            appliedContradictionCount: 0,
	          }),
	        }
	        const payload = {
          ...buildResponse({
            data, usage, findings: data.findings, findingEvents: data.findingEvents,
            contradictions: data.contradictions, questions: data.questions, questionEvents: data.questionEvents,
            readiness: data.readiness, reportAvailable: data.reportAvailable, adminEnabled,
          }),
          pipelineStep: 'detect_contradictions',
	          detectedContradictionCandidates: detection.output?.contradictionChanges || [],
	          appliedContradictionChanges: [],
	          contradictionChangesRaw: detection.output?.contradictionChanges || [],
	          contradictionChangesApplied: [],
	          detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
	          rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
	          appliedContradictionCount: 0,
	          contradictionDetectionTriggered: true,
          contradictionDetectionTraceId: traceId,
          contradictionDetectionCompleted: false,
          contradictionDetectionSkippedReason: null,
	          contradictionExtractionStatus: 'failed',
	          lastContradictionEvaluationTraceId: traceId,
	          lastContradictionEvaluationAt: null,
	          ...failedCounts,
          retryableContradictionDetectionError: true,
          retryable: false,
          responseOrigin: 'contradiction_detection_failed',
          cacheStatus: 'miss',
          turnApplied: true,
          analysisStatus: 'applied',
        }
        payload.sessionSnapshot = {
          ...payload.sessionSnapshot,
	          contradictionExtractionStatus: 'failed',
	          lastContradictionEvaluationTraceId: traceId,
	          lastContradictionEvaluationAt: null,
	          detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
	          rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
	          appliedContradictionCount: 0,
	          ...failedCounts,
	        }
        const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage, adminEnabled })
        if (diagnostics.enabled) {
          guardedPayload.engine2Trace = {
            traceId,
            action: data.action,
            pipelineStep: 'detect_contradictions',
            requestId: data.requestId,
            turnId: data.turnId,
            messageId: data.messageId,
            responseOrigin: guardedPayload.responseOrigin,
            cacheStatus: 'miss',
            contradictionDetectionTriggered: true,
            contradictionDetectionTraceId: traceId,
	          contradictionDetectionCompleted: false,
	          contradictionDetectionSkippedReason: null,
		          contradictionDetectorDiagnostics: {
		            inputIncludesRecentUserMessages: detection.meta?.inputIncludesRecentUserMessages || false,
		            recentMessageCount: detection.meta?.recentMessageCount || 0,
		            recentUserMessageCount: detection.meta?.recentUserMessageCount || 0,
		            latestQuestion: detection.meta?.latestQuestion || null,
		            latestAnswer: detection.meta?.latestAnswer || null,
		            rawModelOutput: detection.meta?.rawModelOutput || null,
		            detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
		            acceptedContradictionCandidateCount: detection.meta?.acceptedContradictionCandidateCount || 0,
		            rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
		            rejectedContradictionCandidates: detection.meta?.rejectedContradictionCandidates || [],
		            repairedContradictionCandidates: detection.meta?.repairedContradictionCandidates || [],
		            weakGroundingContradictionCandidateCount: detection.meta?.weakGroundingContradictionCandidateCount || 0,
		            heuristicContradictionCandidateCount: detection.meta?.heuristicContradictionCandidateCount || 0,
		          },
	          contradictionChangesRaw: detection.output?.contradictionChanges || [],
            contradictionChangesApplied: [],
            contradictionDetection: {
              validation: detection.validation,
              attempts: detection.attempts,
              error: detection.meta?.errorCategory || detection.validation?.errors?.[0] || null,
            },
            questionCandidatesRaw: [],
            questionCandidatesApplied: guardedPayload.panelQuestions || guardedPayload.openQuestions || [],
            panelQuestionCount: (guardedPayload.panelQuestions || guardedPayload.openQuestions || []).length,
            chatQuestion: null,
            timings: {
              requestReceivedAt: requestReceivedAt.iso,
              llmStartedAt: new Date(detection.meta?.startedAt || startedAt).toISOString(),
              llmResponseReceivedAt: new Date(detection.meta?.finishedAt || now()).toISOString(),
              parsingCompletedAt: new Date().toISOString(),
              validationCompletedAt: new Date().toISOString(),
              deltaAppliedAt: null,
              apiResponseSentAt: null,
            },
            telemetry: {
              model: detection.meta?.modelUsed || null,
              providerRequestId: detection.meta?.providerRequestIds?.[0] || null,
              providerRequestIds: detection.meta?.providerRequestIds || [],
              inputTokens: Number(detection.meta?.tokens?.input || 0),
              outputTokens: Number(detection.meta?.tokens?.output || 0),
              llmLatencyMs: Number(detection.meta?.durationMs || 0),
              totalBackendMs: now() - requestReceivedAt.ms,
              generationFallbackUsed: false,
              successfulTrialTurns: usage.successfulTrialTurns,
              providerCalls: usage.providerCalls,
              repairCalls: 0,
              remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
            },
          }
          attachApiResponseToTrace(guardedPayload)
        }
        if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(guardedPayload) })
        return sendJson(res, 200, guardedPayload)
      }
      const applied = applyEngine2TurnDelta({
        delta: {
          findingChanges: [],
          contradictionChanges: detection.contradictionChanges || [],
          questionTransition: null,
          assistantReply: null,
          activeQuestionPresentation: null,
        },
        findings: data.findings,
        findingEvents: data.findingEvents,
        contradictions: data.contradictions,
        questions: data.questions,
        questionEvents: data.questionEvents,
        trialId: data.trialId,
        messageId: data.turnId,
        activeQuestionId: null,
        previousReadiness: data.readiness,
        language: data.language,
      })
      data.contradictions = applied.contradictions
      data.questions = applied.questions
      data.questionEvents = applied.questionEvents
      data.activeQuestionId = null
	      const softTensionState = buildSoftTensionState(data)
	      const counts = withSoftTensionMetadata({
	        counts: contradictionExtractionCounts(data.contradictions),
	        softTensionSignalsCount: softTensionState.softTensionSignalsCount,
	      })
      const payload = {
        ...buildResponse({
          data, usage, findings: data.findings, findingEvents: data.findingEvents,
          contradictions: data.contradictions, questions: data.questions, questionEvents: data.questionEvents,
          readiness: data.readiness, reportAvailable: data.readiness.reportAvailable, adminEnabled,
        }),
        pipelineStep: 'detect_contradictions',
	        detectedContradictionCandidates: detection.output?.contradictionChanges || [],
	        appliedContradictionChanges: applied.appliedContradictionChanges || [],
	        contradictionChangesRaw: detection.output?.contradictionChanges || [],
	        contradictionChangesApplied: applied.appliedContradictionChanges || [],
	        detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
	        rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
	        appliedContradictionCount: (applied.appliedContradictionChanges || []).length,
	        contradictionDetectionTriggered: true,
        contradictionDetectionTraceId: traceId,
        contradictionDetectionCompleted: true,
        contradictionDetectionSkippedReason: null,
        contradictionExtractionStatus: 'evaluated',
        lastContradictionEvaluationTraceId: traceId,
        lastContradictionEvaluationAt: new Date().toISOString(),
        ...counts,
        skippedReadinessBecause: 'separate_pipeline_step',
        skippedContradictionsBecause: null,
        questionsRenderedBeforeReadiness: panelOpenQuestions(data.questions).length === 3,
        responseOrigin: 'contradiction_detector',
        cacheStatus: 'miss',
        turnApplied: true,
        analysisStatus: 'applied',
        retryable: false,
      }
      payload.sessionSnapshot = {
        ...payload.sessionSnapshot,
        contradictions: data.contradictions,
	        contradictionExtractionStatus: 'evaluated',
	        contradictionPipelineStatus: contradictionPipelineStatus({
	          contradictionExtractionStatus: 'evaluated',
	          formalActiveContradictionCount: counts.formalActiveContradictionCount,
	          softTensionSignalsCount: softTensionState.softTensionSignalsCount,
	          detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
	          rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
	          appliedContradictionCount: (applied.appliedContradictionChanges || []).length,
	        }),
	        softTensionSignals: softTensionState.softTensionSignals,
	        lastContradictionEvaluationTraceId: traceId,
		        lastContradictionEvaluationAt: payload.lastContradictionEvaluationAt,
		        detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
		        rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
		        appliedContradictionCount: (applied.appliedContradictionChanges || []).length,
		        ...counts,
			        }
      const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage, adminEnabled })
      if (diagnostics.enabled) {
        guardedPayload.engine2Trace = {
          traceId,
          action: data.action,
          pipelineStep: 'detect_contradictions',
          requestId: data.requestId,
          turnId: data.turnId,
          messageId: data.messageId,
          responseOrigin: guardedPayload.responseOrigin,
          cacheStatus: 'miss',
          skippedReadinessBecause: 'separate_pipeline_step',
          skippedContradictionsBecause: null,
          questionsRenderedBeforeReadiness: panelOpenQuestions(data.questions).length === 3,
          contradictionDetectionTriggered: true,
          contradictionDetectionTraceId: traceId,
	          contradictionDetectionCompleted: true,
	          contradictionDetectionSkippedReason: null,
		          contradictionDetectorDiagnostics: {
		            inputIncludesRecentUserMessages: detection.meta?.inputIncludesRecentUserMessages || false,
		            recentMessageCount: detection.meta?.recentMessageCount || 0,
		            recentUserMessageCount: detection.meta?.recentUserMessageCount || 0,
		            latestQuestion: detection.meta?.latestQuestion || null,
		            latestAnswer: detection.meta?.latestAnswer || null,
		            rawModelOutput: detection.meta?.rawModelOutput || null,
		            detectedRawContradictionCount: detection.meta?.detectedRawContradictionCount || 0,
		            acceptedContradictionCandidateCount: detection.meta?.acceptedContradictionCandidateCount || 0,
		            rejectedContradictionCandidateCount: detection.meta?.rejectedContradictionCandidateCount || 0,
		            rejectedContradictionCandidates: detection.meta?.rejectedContradictionCandidates || [],
		            repairedContradictionCandidates: detection.meta?.repairedContradictionCandidates || [],
		            weakGroundingContradictionCandidateCount: detection.meta?.weakGroundingContradictionCandidateCount || 0,
		            heuristicContradictionCandidateCount: detection.meta?.heuristicContradictionCandidateCount || 0,
		          },
	          contradictionChangesRaw: detection.output?.contradictionChanges || [],
          contradictionChangesApplied: applied.appliedContradictionChanges || [],
          contradictionDetection: {
            validation: detection.validation,
            attempts: detection.attempts,
          },
          detectedContradictionCandidates: detection.output?.contradictionChanges || [],
          appliedContradictionChanges: applied.appliedContradictionChanges || [],
          questionCandidatesRaw: [],
          questionCandidatesApplied: guardedPayload.panelQuestions || guardedPayload.openQuestions || [],
          panelQuestionCount: (guardedPayload.panelQuestions || guardedPayload.openQuestions || []).length,
          chatQuestion: null,
          timings: {
            requestReceivedAt: requestReceivedAt.iso,
            llmStartedAt: new Date(detection.meta?.startedAt || startedAt).toISOString(),
            llmResponseReceivedAt: new Date(detection.meta?.finishedAt || now()).toISOString(),
            parsingCompletedAt: new Date().toISOString(),
            validationCompletedAt: new Date().toISOString(),
            deltaAppliedAt: new Date().toISOString(),
            apiResponseSentAt: null,
          },
          telemetry: {
            model: detection.meta?.modelUsed || null,
            providerRequestId: detection.meta?.providerRequestIds?.[0] || null,
            providerRequestIds: detection.meta?.providerRequestIds || [],
            inputTokens: Number(detection.meta?.tokens?.input || 0),
            outputTokens: Number(detection.meta?.tokens?.output || 0),
            llmLatencyMs: Number(detection.meta?.durationMs || 0),
            totalBackendMs: now() - requestReceivedAt.ms,
            generationFallbackUsed: false,
            successfulTrialTurns: usage.successfulTrialTurns,
            providerCalls: usage.providerCalls,
            repairCalls: 0,
            remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
          },
        }
        attachApiResponseToTrace(guardedPayload)
      }
      if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(guardedPayload) })
      return sendJson(res, 200, guardedPayload)
    }
    if (data.action === 'evaluate_readiness') {
      const readinessTraceId = `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${startedAt}`)}`
      const readinessInput = buildReadinessEvaluationInput(data)
      const readinessEvaluation = await evaluateEngine2ReportReadiness({
        input: readinessInput,
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: true,
        rateLimiter: limiterByTrial,
        rateLimitKey: `${ip}:${data.trialId}:readiness`,
      })
      usage = await accumulateUsage(usage, readinessEvaluation.meta)
      trialUsage.set(usageKey, { ...usage, updatedAt: now() })
      if (!readinessEvaluation.ok) {
        const notice = data.language === 'en'
          ? 'The questions are ready, but report readiness could not be recalculated. You can continue answering.'
          : 'Pytania są gotowe, ale nie udało się przeliczyć gotowości raportu. Możesz dalej odpowiadać.'
        const failedReadiness = {
          ...data.readiness,
          status: 'failed',
          error: {
            diagnosticCode: 'ENGINE2_READINESS_INVALID_OUTPUT',
            validation: readinessEvaluation.validation || null,
            errorCategory: readinessEvaluation.meta?.errorCategory || null,
          },
          evaluationTraceId: readinessTraceId,
        }
        data.readiness = failedReadiness
        const payload = {
          ...buildResponse({
            data, usage, findings: data.findings, findingEvents: data.findingEvents,
            contradictions: data.contradictions, questions: data.questions, questionEvents: data.questionEvents,
            readiness: failedReadiness, reportAvailable: failedReadiness.reportAvailable, adminEnabled,
          }),
          diagnosticCode: 'ENGINE2_READINESS_INVALID_OUTPUT',
          notice,
          guideNotice: null,
          retryable: false,
          retryableReadinessError: true,
          readinessEvaluationTriggered: true,
          readinessEvaluationCompleted: false,
          readinessEvaluationSkippedReason: null,
          readinessIsDefaultValue: false,
          continueApplied: false,
          continueError: { diagnosticCode: 'ENGINE2_READINESS_INVALID_OUTPUT', message: notice, retryable: true, validation: readinessEvaluation.validation || null },
          pipelineStep: 'evaluate_readiness',
          responseOrigin: 'readiness_evaluator_failed',
          cacheStatus: 'miss',
          turnApplied: true,
          analysisStatus: 'applied',
        }
        const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage, adminEnabled })
        if (diagnostics.enabled) {
          guardedPayload.engine2Trace = {
            traceId: readinessTraceId,
            action: data.action,
            pipelineStep: 'evaluate_readiness',
            requestId: data.requestId,
            turnId: data.turnId,
            messageId: data.messageId,
            responseOrigin: guardedPayload.responseOrigin,
            cacheStatus: 'miss',
            readinessInput,
            readinessEvaluation: {
              validation: readinessEvaluation.validation,
              evaluation: readinessEvaluation.evaluation,
              attempts: readinessEvaluation.attempts,
            },
            skippedContradictionsBecause: 'separate_pipeline_step',
            questionsRenderedBeforeReadiness: panelOpenQuestions(data.questions).length === 3,
            retryableReadinessError: true,
            readinessEvaluationTriggered: true,
            readinessEvaluationCompleted: false,
            readinessEvaluationSkippedReason: null,
            readinessIsDefaultValue: false,
            questionCandidatesRaw: [],
            questionCandidatesApplied: guardedPayload.panelQuestions || guardedPayload.openQuestions || [],
            panelQuestionCount: (guardedPayload.panelQuestions || guardedPayload.openQuestions || []).length,
            chatQuestion: null,
            timings: {
              requestReceivedAt: requestReceivedAt.iso,
              llmStartedAt: new Date(startedAt).toISOString(),
              llmResponseReceivedAt: new Date().toISOString(),
              parsingCompletedAt: new Date().toISOString(),
              validationCompletedAt: new Date().toISOString(),
              deltaAppliedAt: new Date().toISOString(),
              apiResponseSentAt: null,
            },
            telemetry: {
              model: readinessEvaluation.meta?.modelUsed || null,
              providerRequestId: readinessEvaluation.meta?.providerRequestIds?.[0] || null,
              providerRequestIds: readinessEvaluation.meta?.providerRequestIds || [],
              inputTokens: Number(readinessEvaluation.meta?.tokens?.input || 0),
              outputTokens: Number(readinessEvaluation.meta?.tokens?.output || 0),
              llmLatencyMs: 0,
              totalBackendMs: now() - requestReceivedAt.ms,
              generationFallbackUsed: false,
              successfulTrialTurns: usage.successfulTrialTurns,
              providerCalls: usage.providerCalls,
              repairCalls: Math.max(0, (readinessEvaluation.attempts || []).length - 1),
              remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
            },
          }
          attachApiResponseToTrace(guardedPayload)
        }
        if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(guardedPayload) })
        return sendJson(res, 200, guardedPayload)
      }
      const activeContradictions = data.contradictions.filter((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction.status))
      const readinessDecision = calculateEngine2ReadinessDecision({
        evaluation: readinessEvaluation.evaluation,
        allFindings: data.findings,
        activeContradictions,
        softTensionSignals: readinessInput.softTensionSignals,
        softTensionSignalsCount: readinessInput.softTensionSignalsCount,
      })
      const readiness = {
        status: 'evaluated',
        materialScore: readinessDecision.materialScore,
        reportScore: readinessDecision.finalScore,
        criticalMissing: readinessDecision.criticalMissing,
        reportAvailable: readinessDecision.reportAvailable,
        lastEvaluatedAt: new Date().toISOString(),
        evaluationTraceId: readinessTraceId,
        error: null,
      }
      data.readiness = readiness
      const payload = {
        ...buildResponse({
          data, usage, findings: data.findings, findingEvents: data.findingEvents,
          contradictions: data.contradictions, questions: data.questions, questionEvents: data.questionEvents,
          readiness, reportAvailable: readinessDecision.reportAvailable, adminEnabled,
        }),
        pipelineStep: 'evaluate_readiness',
        readinessDecisionSource: readinessDecision.readinessDecisionSource,
        scoreComponents: readinessDecision.scoreComponents,
        evidenceFindingIds: readinessDecision.evidenceFindingIds,
        finalScore: readinessDecision.finalScore,
        materialScore: readinessDecision.materialScore,
        materialScoreReason: readinessDecision.materialScoreReason,
        contradictionReadinessImpact: readinessDecision.contradictionReadinessImpact,
        reportBlockedReasons: readinessDecision.reportBlockedReasons,
        retryableReadinessError: false,
        readinessEvaluationTriggered: true,
        readinessEvaluationCompleted: true,
        readinessEvaluationSkippedReason: null,
        readinessIsDefaultValue: false,
        skippedContradictionsBecause: 'separate_pipeline_step',
        questionsRenderedBeforeReadiness: panelOpenQuestions(data.questions).length === 3,
        responseOrigin: 'readiness_evaluator',
        cacheStatus: 'miss',
        conversationStatus: readinessDecision.reportAvailable ? 'report_ready' : 'continue',
        turnApplied: true,
        analysisStatus: 'applied',
        retryable: false,
      }
      const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage, adminEnabled })
      if (diagnostics.enabled) {
        guardedPayload.engine2Trace = {
          traceId: readinessTraceId,
          action: data.action,
          pipelineStep: 'evaluate_readiness',
          requestId: data.requestId,
          turnId: data.turnId,
          messageId: data.messageId,
          responseOrigin: guardedPayload.responseOrigin,
          cacheStatus: 'miss',
          readinessInput,
          readinessEvaluation: {
            validation: readinessEvaluation.validation,
            evaluation: readinessEvaluation.evaluation,
            attempts: readinessEvaluation.attempts,
          },
          skippedContradictionsBecause: 'separate_pipeline_step',
          questionsRenderedBeforeReadiness: panelOpenQuestions(data.questions).length === 3,
          retryableReadinessError: false,
          readinessEvaluationTriggered: true,
          readinessEvaluationCompleted: true,
          readinessEvaluationSkippedReason: null,
          readinessIsDefaultValue: false,
          questionCandidatesRaw: [],
          questionCandidatesApplied: guardedPayload.panelQuestions || guardedPayload.openQuestions || [],
          panelQuestionCount: (guardedPayload.panelQuestions || guardedPayload.openQuestions || []).length,
          chatQuestion: null,
          timings: {
            requestReceivedAt: requestReceivedAt.iso,
            llmStartedAt: new Date(startedAt).toISOString(),
            llmResponseReceivedAt: new Date().toISOString(),
            parsingCompletedAt: new Date().toISOString(),
            validationCompletedAt: new Date().toISOString(),
            deltaAppliedAt: new Date().toISOString(),
            apiResponseSentAt: null,
          },
          telemetry: {
            model: readinessEvaluation.meta?.modelUsed || null,
            providerRequestId: readinessEvaluation.meta?.providerRequestIds?.[0] || null,
            providerRequestIds: readinessEvaluation.meta?.providerRequestIds || [],
            inputTokens: Number(readinessEvaluation.meta?.tokens?.input || 0),
            outputTokens: Number(readinessEvaluation.meta?.tokens?.output || 0),
            llmLatencyMs: 0,
            totalBackendMs: now() - requestReceivedAt.ms,
            generationFallbackUsed: false,
            successfulTrialTurns: usage.successfulTrialTurns,
            providerCalls: usage.providerCalls,
            repairCalls: Math.max(0, (readinessEvaluation.attempts || []).length - 1),
            remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
          },
        }
        attachApiResponseToTrace(guardedPayload)
      }
      if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(guardedPayload) })
      return sendJson(res, 200, guardedPayload)
    }
    if (data.action === 'generate_panel_questions') {
      const continuation = continuationDecisionState || {
        findings: data.findings,
        findingEvents: data.findingEvents,
        rejectedFingerprints: data.rejectedFingerprints,
        questions: data.questions,
        questionEvents: data.questionEvents,
        activeQuestionId: null,
        stagedTransitionApplied: false,
	        allPackageItemsDecided: true,
	        packageId: data.pendingDecisionPackageId,
	      }
	      const hasUnappliedRawContradiction = data.contradictionExtractionStatus === 'failed' &&
	        Number(data.detectedRawContradictionCount || 0) > 0 &&
	        Number(data.appliedContradictionCount || 0) === 0 &&
	        !data.contradictions.some((contradiction) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(contradiction.status))
	      if (hasUnappliedRawContradiction) {
	        const notice = data.language === 'en'
	          ? 'A design tension was detected but could not be saved. Retry contradiction detection before generating more questions.'
	          : 'Wykryto napięcie projektowe, ale nie zostało zapisane. Ponów detekcję sprzeczności przed generowaniem kolejnych pytań.'
	        const payload = {
	          ...buildResponse({
	            data, usage, findings: continuation.findings, findingEvents: continuation.findingEvents,
	            contradictions: data.contradictions, questions: continuation.questions, questionEvents: continuation.questionEvents,
	            readiness: data.readiness, reportAvailable: false, adminEnabled,
	          }),
	          diagnosticCode: 'ENGINE2_UNAPPLIED_RAW_CONTRADICTION',
	          notice,
	          retryable: true,
	          retryableContradictionDetectionError: true,
	          questionGenerationAttempted: false,
	          questionGenerationFailed: true,
	          retryableQuestionGeneration: true,
	          pipelineStep: 'generate_panel_questions',
	          responseOrigin: 'unapplied_raw_contradiction_guard',
	          cacheStatus: 'miss',
	          turnApplied: false,
	          analysisStatus: 'retryable_error',
	          detectedRawContradictionCount: data.detectedRawContradictionCount,
	          rejectedContradictionCandidateCount: data.rejectedContradictionCandidateCount,
	          appliedContradictionCount: data.appliedContradictionCount,
	        }
	        if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(payload) })
	        return sendJson(res, 200, payload)
	      }
		      const localTensionApplication = applyLocalConfirmedTensionContradictions({
		        data,
		        findings: continuation.findings,
		        contradictions: data.contradictions,
		        questions: continuation.questions,
		        questionEvents: continuation.questionEvents,
		        messageId: data.turnId,
		        activeQuestionId: null,
		      })
		      data.contradictions = localTensionApplication.contradictions
		      continuation.questions = localTensionApplication.questions
		      continuation.questionEvents = localTensionApplication.questionEvents
		      if (localTensionApplication.appliedContradictionChanges.length > 0) {
		        data.contradictionExtractionStatus = 'evaluated'
		        data.detectedRawContradictionCount = localTensionApplication.detectedContradictionCandidates.length
		        data.rejectedContradictionCandidateCount = 0
		        data.appliedContradictionCount = localTensionApplication.appliedContradictionChanges.length
		      }
		      const questionInput = {
	        ...buildReadinessEvaluationInput(data, {
	          findings: continuation.findings,
	          contradictions: data.contradictions,
	          questions: continuation.questions,
	        }),
	        contradictions: data.contradictions,
	        guidanceForNextQuestions: data.guidanceForNextQuestions || null,
	        readinessGuidance: buildReadinessGuidanceForQuestions(data.readiness),
	      }
      const questionGeneration = await generateEngine2PanelQuestions({
        input: questionInput,
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: true,
        rateLimiter: limiterByTrial,
        rateLimitKey: `${ip}:${data.trialId}:panel_questions`,
      })
      usage = await accumulateUsage(usage, questionGeneration.meta)
      trialUsage.set(usageKey, { ...usage, updatedAt: now() })
      const decisionEvents = explicitDecisionEventsForPackage({
        findingEvents: continuation.findingEvents,
        packageId: continuation.packageId || data.pendingDecisionPackageId,
      })
      const lifecycleInvariants = evaluateDecisionLifecycleInvariants({
        findings: continuation.findings,
        findingEvents: continuation.findingEvents,
        packageId: continuation.packageId || data.pendingDecisionPackageId,
        finalDecision: Boolean(continuationDecisionState?.allPackageItemsDecided),
        nextQuestionGenerationTriggered: true,
      })
      data.findings = continuation.findings
      data.findingEvents = continuation.findingEvents
      data.rejectedFingerprints = continuation.rejectedFingerprints
      data.pendingDecisionPackageId = null
      data.pendingQuestionTransition = null
      const candidateLedger = applyQuestionCandidatesToLedger({
        questions: continuation.questions,
        questionEvents: continuation.questionEvents,
        candidates: questionGeneration.questionCandidates || [],
        contradictions: data.contradictions,
        coveredSemanticKeys: [],
        fillFromExisting: true,
        trialId: data.trialId,
        turnId: data.turnId,
      })
      const questionRefreshDiagnostics = {
        latestFindingCoverageCount: countLatestFindingCoverage({
          candidates: questionGeneration.questionCandidates || [],
          findings: continuation.findings,
        }),
        keptExistingQuestionCount: Number(candidateLedger.diagnostics?.keptExistingQuestionCount || 0),
        replacedQuestionCount: Number(candidateLedger.diagnostics?.replacedQuestionCount || 0),
        invalidCandidateCount: Number(questionGeneration.partialValidation?.invalidCandidateCount || 0),
        panelFilledFromExistingCount: Number(candidateLedger.diagnostics?.panelFilledFromExistingCount || 0),
      }
      if (!questionGeneration.ok) {
        data.questions = candidateLedger.questions
        data.questionEvents = candidateLedger.questionEvents
        data.activeQuestionId = null
        const canKeepPanelOpen = candidateLedger.openQuestions.length === 3
        if (canKeepPanelOpen) {
          const notice = data.language === 'en'
            ? 'The previous questions remain visible. You can retry refreshing them.'
            : 'Poprzednie pytania zostają widoczne. Możesz ponowić ich odświeżenie.'
          const questionInvariantResults = evaluateQuestionInvariants({
            questions: candidateLedger.questions,
            activeQuestionId: null,
            conversation: data.history,
            pendingQuestionTransition: null,
            turnKind: null,
            effectiveReplyToGapId: null,
          })
          const payload = {
            ...buildResponse({
              data, usage, findings: continuation.findings, findingEvents: continuation.findingEvents,
              contradictions: data.contradictions, questions: candidateLedger.questions, questionEvents: candidateLedger.questionEvents,
              readiness: data.readiness, reportAvailable: false, adminEnabled,
            }),
            diagnosticCode: 'ENGINE2_PANEL_QUESTION_REFRESH_KEPT_EXISTING',
            notice,
            guideNotice: notice,
            retryable: false,
            retryMessageId: data.turnId,
            decisionApplied: Boolean(continuationDecisionState && Array.isArray(data.decisions) && data.decisions.length > 0),
            decisionEvents,
            decisionState: {
              packageId: continuation.packageId || data.pendingDecisionPackageId || null,
              allPackageItemsDecided: true,
              decisionEventsCount: decisionEvents.length,
              pendingDecisionPackageId: null,
              stagedTransitionApplied: continuation.stagedTransitionApplied,
            },
            continueApplied: true,
            continueError: {
              diagnosticCode: 'ENGINE2_PANEL_QUESTION_REFRESH_KEPT_EXISTING',
              message: notice,
              retryable: true,
              validation: questionGeneration.validation || null,
              errorCategory: questionGeneration.meta?.errorCategory || null,
            },
            retryableContinueError: false,
            retryableQuestionGeneration: true,
            retryableReadinessError: false,
            questionGenerationAttempted: true,
            questionGenerationFailed: true,
            questionGenerationError: {
              diagnosticCode: 'ENGINE2_PANEL_QUESTION_REFRESH_KEPT_EXISTING',
              errorCategory: questionGeneration.meta?.errorCategory || null,
              validation: questionGeneration.validation || null,
            },
            questionRefreshDiagnostics,
            ...questionRefreshDiagnostics,
            questionCandidates: questionGeneration.questionCandidates || [],
            skippedReadinessBecause: 'panel_questions_kept_after_generation_failure',
            skippedContradictionsBecause: 'panel_questions_kept_after_generation_failure',
            questionsRenderedBeforeReadiness: true,
            pipelineStep: 'generate_panel_questions',
            pendingDecisionPackageId: null,
            pendingQuestionTransition: null,
            backendInvariantResults: [...(decisionPackageInvariant ? [decisionPackageInvariant] : []), ...lifecycleInvariants, ...questionInvariantResults],
            responseOrigin: 'panel_question_generation_failed_kept_existing',
            cacheStatus: 'miss',
            turnApplied: true,
            analysisStatus: 'applied',
          }
          payload.sessionSnapshot = {
            ...payload.sessionSnapshot,
            pendingDecisionPackageId: null,
            pendingQuestionTransition: null,
          }
          const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage, adminEnabled })
          if (diagnostics.enabled) {
            guardedPayload.engine2Trace = {
              traceId: `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${startedAt}`)}`,
              action: data.action,
              pipelineStep: 'generate_panel_questions',
              requestId: data.requestId,
              turnId: data.turnId,
              messageId: data.messageId,
              responseOrigin: guardedPayload.responseOrigin,
              cacheStatus: 'miss',
              generatePanelQuestionsStartedAt: new Date(questionGeneration.meta?.startedAt || startedAt).toISOString(),
              generatePanelQuestionsFinishedAt: new Date(questionGeneration.meta?.finishedAt || now()).toISOString(),
              generatePanelQuestionsDurationMs: Number(questionGeneration.meta?.durationMs || 0),
              generatePanelQuestionsInputBytes: Number(questionGeneration.meta?.inputBytes || 0),
              generatePanelQuestionsOutputBytes: Number(questionGeneration.meta?.outputBytes || 0),
              generatePanelQuestionsAttemptCount: Number(questionGeneration.meta?.attemptCount || 1),
              generatePanelQuestionsTimeoutMs: Number(questionGeneration.meta?.timeoutMs || 0),
              generatePanelQuestionsInputHash: questionGeneration.meta?.inputHash || null,
              generatePanelQuestionsInputPreview: questionGeneration.meta?.inputPreview || null,
              providerCallStartedAt: questionGeneration.meta?.providerCallStartedAt || null,
              providerCallResolvedAt: questionGeneration.meta?.providerCallResolvedAt || null,
              providerCallAbortedAt: questionGeneration.meta?.providerCallAbortedAt || null,
              abortReason: questionGeneration.meta?.abortReason || null,
              timeoutSource: questionGeneration.meta?.timeoutSource || null,
              model: questionGeneration.meta?.model || questionGeneration.meta?.modelUsed || questionGeneration.meta?.attemptedModel || null,
              responseFormatName: questionGeneration.meta?.responseFormatName || null,
              skippedReadinessBecause: 'panel_questions_kept_after_generation_failure',
              skippedContradictionsBecause: 'panel_questions_kept_after_generation_failure',
              questionsRenderedBeforeReadiness: true,
              questionGeneration: {
                validation: questionGeneration.validation,
                partialValidation: questionGeneration.partialValidation,
                attempts: questionGeneration.attempts,
                error: guardedPayload.questionGenerationError,
              },
              questionRefreshDiagnostics,
              questionGenerationAttempted: true,
              questionGenerationFailed: true,
              questionGenerationError: guardedPayload.questionGenerationError,
              retryableQuestionGeneration: true,
              decisionEvents,
              questionCandidatesRaw: questionGeneration.attempts?.at(-1)?.parsedOutput?.questionCandidates || [],
              questionCandidatesApplied: guardedPayload.panelQuestions || guardedPayload.openQuestions || [],
              panelQuestionCount: (guardedPayload.panelQuestions || guardedPayload.openQuestions || []).length,
              deadEndInvariantResult: (guardedPayload.backendInvariantResults || []).find((entry) => entry?.invariant === 'dead_end_next_action') || null,
              chatQuestion: null,
              timings: {
                requestReceivedAt: requestReceivedAt.iso,
                llmStartedAt: new Date(startedAt).toISOString(),
                llmResponseReceivedAt: new Date().toISOString(),
                parsingCompletedAt: new Date().toISOString(),
                validationCompletedAt: new Date().toISOString(),
                deltaAppliedAt: new Date().toISOString(),
                apiResponseSentAt: null,
              },
              telemetry: {
                model: questionGeneration.meta?.modelUsed || null,
                providerRequestId: questionGeneration.meta?.providerRequestIds?.[0] || null,
                providerRequestIds: questionGeneration.meta?.providerRequestIds || [],
                inputTokens: Number(questionGeneration.meta?.tokens?.input || 0),
                outputTokens: Number(questionGeneration.meta?.tokens?.output || 0),
                llmLatencyMs: Number(questionGeneration.meta?.durationMs || 0),
                totalBackendMs: now() - requestReceivedAt.ms,
                generationFallbackUsed: false,
                successfulTrialTurns: usage.successfulTrialTurns,
                providerCalls: usage.providerCalls,
                repairCalls: 0,
                remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
              },
            }
            attachApiResponseToTrace(guardedPayload)
          }
          if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(guardedPayload) })
          return sendJson(res, 200, guardedPayload)
        }
        const payload = {
          ...buildResponse({
            data, usage, findings: continuation.findings, findingEvents: continuation.findingEvents,
            contradictions: data.contradictions, questions: candidateLedger.questions, questionEvents: candidateLedger.questionEvents,
            readiness: data.readiness, reportAvailable: false, adminEnabled,
          }),
          diagnosticCode: 'ENGINE2_PANEL_QUESTION_GENERATION_FAILED',
          notice: continueErrorNotice(data.language),
          guideNotice: continueErrorNotice(data.language),
          retryable: true,
          retryMessageId: data.turnId,
          decisionApplied: Boolean(continuationDecisionState && Array.isArray(data.decisions) && data.decisions.length > 0),
          decisionEvents,
          decisionState: {
            packageId: continuation.packageId || data.pendingDecisionPackageId || null,
            allPackageItemsDecided: true,
            decisionEventsCount: decisionEvents.length,
            pendingDecisionPackageId: null,
            stagedTransitionApplied: continuation.stagedTransitionApplied,
          },
          continueApplied: false,
          continueError: {
            diagnosticCode: 'ENGINE2_PANEL_QUESTION_GENERATION_FAILED',
            message: continueErrorNotice(data.language),
            retryable: true,
            validation: questionGeneration.validation || null,
            errorCategory: questionGeneration.meta?.errorCategory || null,
          },
          retryableContinueError: true,
          retryableQuestionGeneration: true,
          retryableReadinessError: false,
          questionGenerationAttempted: true,
          questionGenerationFailed: true,
          questionGenerationError: {
            diagnosticCode: 'ENGINE2_PANEL_QUESTION_GENERATION_FAILED',
            errorCategory: questionGeneration.meta?.errorCategory || null,
            validation: questionGeneration.validation || null,
          },
          questionRefreshDiagnostics,
          ...questionRefreshDiagnostics,
          skippedReadinessBecause: 'panel_question_generation_failed',
          skippedContradictionsBecause: 'panel_question_generation_failed',
          questionsRenderedBeforeReadiness: false,
          pipelineStep: 'generate_panel_questions',
          pendingDecisionPackageId: null,
          pendingQuestionTransition: null,
          backendInvariantResults: [...(decisionPackageInvariant ? [decisionPackageInvariant] : []), ...lifecycleInvariants],
          responseOrigin: 'panel_question_generation_failed',
          cacheStatus: 'miss',
          turnApplied: false,
          analysisStatus: 'retryable_error',
        }
        payload.sessionSnapshot = {
          ...payload.sessionSnapshot,
          pendingDecisionPackageId: null,
          pendingQuestionTransition: null,
        }
        if (diagnostics.enabled) {
          payload.engine2Trace = {
            traceId: `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${startedAt}`)}`,
            action: data.action,
            pipelineStep: 'generate_panel_questions',
            requestId: data.requestId,
            turnId: data.turnId,
            messageId: data.messageId,
            responseOrigin: payload.responseOrigin,
            cacheStatus: 'miss',
            generatePanelQuestionsStartedAt: new Date(questionGeneration.meta?.startedAt || startedAt).toISOString(),
            generatePanelQuestionsFinishedAt: new Date(questionGeneration.meta?.finishedAt || now()).toISOString(),
            generatePanelQuestionsDurationMs: Number(questionGeneration.meta?.durationMs || 0),
            generatePanelQuestionsInputBytes: Number(questionGeneration.meta?.inputBytes || 0),
            generatePanelQuestionsOutputBytes: Number(questionGeneration.meta?.outputBytes || 0),
            generatePanelQuestionsAttemptCount: Number(questionGeneration.meta?.attemptCount || 1),
            generatePanelQuestionsTimeoutMs: Number(questionGeneration.meta?.timeoutMs || 0),
            generatePanelQuestionsInputHash: questionGeneration.meta?.inputHash || null,
            generatePanelQuestionsInputPreview: questionGeneration.meta?.inputPreview || null,
            providerCallStartedAt: questionGeneration.meta?.providerCallStartedAt || null,
            providerCallResolvedAt: questionGeneration.meta?.providerCallResolvedAt || null,
            providerCallAbortedAt: questionGeneration.meta?.providerCallAbortedAt || null,
            abortReason: questionGeneration.meta?.abortReason || null,
            timeoutSource: questionGeneration.meta?.timeoutSource || null,
            model: questionGeneration.meta?.model || questionGeneration.meta?.modelUsed || questionGeneration.meta?.attemptedModel || null,
            responseFormatName: questionGeneration.meta?.responseFormatName || null,
            skippedReadinessBecause: 'panel_question_generation_failed',
            skippedContradictionsBecause: 'panel_question_generation_failed',
            questionsRenderedBeforeReadiness: false,
            questionGeneration: {
              validation: questionGeneration.validation,
              partialValidation: questionGeneration.partialValidation,
              attempts: questionGeneration.attempts,
              error: payload.questionGenerationError,
            },
            questionRefreshDiagnostics,
            questionGenerationAttempted: true,
            questionGenerationFailed: true,
            questionGenerationError: payload.questionGenerationError,
            retryableQuestionGeneration: true,
            decisionEvents,
            questionCandidatesRaw: questionGeneration.attempts?.at(-1)?.parsedOutput?.questionCandidates || [],
            questionCandidatesApplied: [],
            panelQuestionCount: 0,
            deadEndInvariantResult: (payload.backendInvariantResults || []).find((entry) => entry?.invariant === 'dead_end_next_action') || null,
            chatQuestion: null,
            timings: {
              requestReceivedAt: requestReceivedAt.iso,
              llmStartedAt: new Date(startedAt).toISOString(),
              llmResponseReceivedAt: new Date().toISOString(),
              parsingCompletedAt: new Date().toISOString(),
              validationCompletedAt: new Date().toISOString(),
              deltaAppliedAt: new Date().toISOString(),
              apiResponseSentAt: null,
            },
            telemetry: {
              model: questionGeneration.meta?.modelUsed || null,
              providerRequestId: questionGeneration.meta?.providerRequestIds?.[0] || null,
              providerRequestIds: questionGeneration.meta?.providerRequestIds || [],
              inputTokens: Number(questionGeneration.meta?.tokens?.input || 0),
              outputTokens: Number(questionGeneration.meta?.tokens?.output || 0),
              llmLatencyMs: Number(questionGeneration.meta?.durationMs || 0),
              totalBackendMs: now() - requestReceivedAt.ms,
              generationFallbackUsed: false,
              successfulTrialTurns: usage.successfulTrialTurns,
              providerCalls: usage.providerCalls,
              repairCalls: 0,
              remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
            },
          }
          attachApiResponseToTrace(payload)
        }
        if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(payload) })
        return sendJson(res, 200, payload)
      }
      const questionInvariantResults = evaluateQuestionInvariants({
        questions: candidateLedger.questions,
        activeQuestionId: null,
        conversation: data.history,
        pendingQuestionTransition: null,
        turnKind: null,
        effectiveReplyToGapId: null,
      })
      data.questions = candidateLedger.questions
      data.questionEvents = candidateLedger.questionEvents
      data.activeQuestionId = null
      const payload = {
        ...buildResponse({
          data, usage, findings: continuation.findings, findingEvents: continuation.findingEvents,
          contradictions: data.contradictions, questions: candidateLedger.questions, questionEvents: candidateLedger.questionEvents,
          readiness: data.readiness, reportAvailable: false, adminEnabled,
        }),
        conversationStatus: 'continue',
        diagnosticCode: null,
        notice: null,
        guideNotice: null,
        retryable: false,
        decisionApplied: Boolean(continuationDecisionState && Array.isArray(data.decisions) && data.decisions.length > 0),
        decisionEvents,
        decisionState: {
          packageId: continuation.packageId || data.pendingDecisionPackageId || null,
          allPackageItemsDecided: true,
          decisionEventsCount: decisionEvents.length,
          pendingDecisionPackageId: null,
          stagedTransitionApplied: continuation.stagedTransitionApplied,
        },
        continueApplied: true,
        continueError: null,
        retryableContinueError: false,
        retryableQuestionGeneration: false,
        retryableReadinessError: false,
        questionGenerationAttempted: true,
        questionGenerationFailed: false,
        questionGenerationError: null,
        questionCandidates: questionGeneration.questionCandidates || [],
        questionRefreshDiagnostics,
        ...questionRefreshDiagnostics,
        skippedReadinessBecause: 'panel_questions_returned_first',
        skippedContradictionsBecause: 'panel_questions_returned_first',
        questionsRenderedBeforeReadiness: true,
        pipelineStep: 'generate_panel_questions',
        pendingDecisionPackageId: null,
        pendingQuestionTransition: null,
        backendInvariantResults: [...(decisionPackageInvariant ? [decisionPackageInvariant] : []), ...lifecycleInvariants, ...questionInvariantResults],
        responseOrigin: 'panel_question_generator',
        cacheStatus: 'miss',
        turnApplied: true,
        analysisStatus: 'applied',
      }
      payload.sessionSnapshot = {
        ...payload.sessionSnapshot,
        pendingDecisionPackageId: null,
        pendingQuestionTransition: null,
      }
      const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage, adminEnabled })
      if (diagnostics.enabled) {
        guardedPayload.engine2Trace = {
          traceId: `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${startedAt}`)}`,
          action: data.action,
          pipelineStep: 'generate_panel_questions',
          requestId: data.requestId,
          turnId: data.turnId,
          messageId: data.messageId,
          responseOrigin: guardedPayload.responseOrigin,
          cacheStatus: 'miss',
          generatePanelQuestionsStartedAt: new Date(questionGeneration.meta?.startedAt || startedAt).toISOString(),
          generatePanelQuestionsFinishedAt: new Date(questionGeneration.meta?.finishedAt || now()).toISOString(),
          generatePanelQuestionsDurationMs: Number(questionGeneration.meta?.durationMs || 0),
          generatePanelQuestionsInputBytes: Number(questionGeneration.meta?.inputBytes || 0),
            generatePanelQuestionsOutputBytes: Number(questionGeneration.meta?.outputBytes || 0),
            generatePanelQuestionsAttemptCount: Number(questionGeneration.meta?.attemptCount || 1),
            generatePanelQuestionsTimeoutMs: Number(questionGeneration.meta?.timeoutMs || 0),
            generatePanelQuestionsInputHash: questionGeneration.meta?.inputHash || null,
            generatePanelQuestionsInputPreview: questionGeneration.meta?.inputPreview || null,
            providerCallStartedAt: questionGeneration.meta?.providerCallStartedAt || null,
            providerCallResolvedAt: questionGeneration.meta?.providerCallResolvedAt || null,
            providerCallAbortedAt: questionGeneration.meta?.providerCallAbortedAt || null,
            abortReason: questionGeneration.meta?.abortReason || null,
            timeoutSource: questionGeneration.meta?.timeoutSource || null,
            model: questionGeneration.meta?.model || questionGeneration.meta?.modelUsed || questionGeneration.meta?.attemptedModel || null,
            responseFormatName: questionGeneration.meta?.responseFormatName || null,
          skippedReadinessBecause: 'panel_questions_returned_first',
          skippedContradictionsBecause: 'panel_questions_returned_first',
          questionsRenderedBeforeReadiness: true,
          questionGeneration: {
            validation: questionGeneration.validation,
            partialValidation: questionGeneration.partialValidation,
            attempts: questionGeneration.attempts,
          },
          questionRefreshDiagnostics,
          questionGenerationAttempted: true,
          questionGenerationFailed: false,
          questionGenerationError: null,
          retryableQuestionGeneration: false,
          decisionEvents,
          questionCandidatesRaw: questionGeneration.questionCandidates || [],
          questionCandidatesApplied: guardedPayload.panelQuestions || guardedPayload.openQuestions || [],
          panelQuestionCount: (guardedPayload.panelQuestions || guardedPayload.openQuestions || []).length,
          deadEndInvariantResult: (guardedPayload.backendInvariantResults || []).find((entry) => entry?.invariant === 'dead_end_next_action') || null,
          chatQuestion: null,
          timings: {
            requestReceivedAt: requestReceivedAt.iso,
            llmStartedAt: new Date(startedAt).toISOString(),
            llmResponseReceivedAt: new Date().toISOString(),
            parsingCompletedAt: new Date().toISOString(),
            validationCompletedAt: new Date().toISOString(),
            deltaAppliedAt: new Date().toISOString(),
            apiResponseSentAt: null,
          },
          telemetry: {
            model: questionGeneration.meta?.modelUsed || null,
            providerRequestId: questionGeneration.meta?.providerRequestIds?.[0] || null,
            providerRequestIds: questionGeneration.meta?.providerRequestIds || [],
            inputTokens: Number(questionGeneration.meta?.tokens?.input || 0),
            outputTokens: Number(questionGeneration.meta?.tokens?.output || 0),
            llmLatencyMs: Number(questionGeneration.meta?.durationMs || 0),
            totalBackendMs: now() - requestReceivedAt.ms,
            generationFallbackUsed: false,
            successfulTrialTurns: usage.successfulTrialTurns,
            providerCalls: usage.providerCalls,
            repairCalls: 0,
            remainingSuccessfulTurns: Math.max(0, ENGINE2_LIMITS.maxSuccessfulTrialTurns - usage.successfulTrialTurns),
          },
        }
        attachApiResponseToTrace(guardedPayload)
      }
      if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(guardedPayload) })
      return sendJson(res, 200, guardedPayload)
    }
    const input = buildPlannerInput(data, remainingTurns)
    const planner = await planEngine2LlmTurn({
      input,
      apiKey: process.env.OPENAI_API_KEY,
      aiSupportEnabled: true,
      rateLimiter: limiterByTrial,
      rateLimitKey: `${ip}:${data.trialId}:llm`,
    })
    usage = await accumulateUsage(usage, planner.meta)
    trialUsage.set(usageKey, { ...usage, updatedAt: now() })

    if (!planner.ok) {
      const responseOrigin = planner.errorCategory === 'INPUT_TOO_LARGE'
        ? 'input_rejected'
        : planner.attempts.length > 1 ? 'repair_retry_failed' : 'new_llm_failed'
      const payload = {
        ...buildResponse({ data, usage, findings: data.findings, questions: data.questions, readiness: data.readiness, adminEnabled }),
        diagnosticCode: planner.errorCategory === 'INVARIANT_VIOLATION'
          ? 'ENGINE2_TURN_INVALID_OUTPUT'
          : planner.errorCategory === 'INPUT_TOO_LARGE'
            ? 'ENGINE2_SESSION_INPUT_TOO_LARGE'
            : 'ENGINE2_TURN_LLM_FAILED',
        notice: errorNotice(data.language),
        retryable: true,
        retryMessageId: data.messageId,
        replyToGapId: data.replyToGapId,
        activeQuestionId: data.activeQuestionId,
        responseOrigin,
        repairCalls: Math.max(0, planner.attempts.length - 1),
        cacheStatus: 'miss',
        turnApplied: false,
        analysisStatus: 'retryable_error',
      }
      if (diagnostics.enabled) {
        payload.engine2Trace = buildTrace({
          traceId: `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${startedAt}`)}`,
          data, input, planner, applied: null, readiness: data.readiness, startedAt,
          requestReceivedAt, usage, responseOrigin,
        })
        attachApiResponseToTrace(payload)
      }
      if (!diagnostics.dryRun) completedTurns.set(turnKey, { createdAt: now(), payload: cacheablePayload(payload) })
      return sendJson(res, 200, payload)
    }
	    const enrichedDelta = { ...planner.delta, contradictionChanges: [...(planner.delta.contradictionChanges || [])] }
	    const enrichedPlanner = { ...planner, delta: enrichedDelta }
	    const applied = applyEngine2TurnDelta({
	      delta: enrichedDelta,
      findings: data.findings,
      findingEvents: data.findingEvents,
      contradictions: data.contradictions,
      questions: data.questions,
      questionEvents: data.questionEvents,
      trialId: data.trialId,
      messageId: data.messageId,
      activeQuestionId: data.activeQuestionId,
      previousReadiness: data.readiness,
      language: data.language,
    })
    const readinessDecision = {
      readinessDecisionSource: 'not_evaluated_during_user_turn',
      scoreComponents: [],
      evidenceFindingIds: [],
      backendInvariantResults: [{ invariant: 'planner_cannot_enable_report', passed: true }],
      finalScore: applied.readiness.reportScore,
      reportBlockedReasons: ['awaiting_user_decisions_or_continuation'],
      reportAvailable: false,
      criticalMissing: applied.readiness.criticalMissing,
    }
    const finalConversationStatus = applied.appliedFindingChanges.length > 0 ? 'awaiting_decisions' : 'continue'
    const deltaAppliedAt = new Date().toISOString()
    const packageId = `engine2-package-${stableHash(`${data.trialId}:${data.messageId}`)}`
    const assignedIds = new Set(applied.appliedFindingChanges.map((change) => change.assignedFindingId).filter(Boolean))
    applied.findings = applied.findings.map((finding) => assignedIds.has(finding.id) ? { ...finding, packageId } : finding)
    const proposals = applied.findings.filter((finding) => assignedIds.has(finding.id) && finding.status === 'pending')
    const reportAvailable = false
    const responseOrigin = planner.attempts.length > 1 ? 'repair_retry' : 'new_llm_call'
    const usageBeforeSuccessfulTurn = usage
	    const hasDecisionProposals = (enrichedDelta.findingChanges || []).length > 0 || (enrichedDelta.contradictionChanges || []).length > 0
	    const assistantReplyText = hasDecisionProposals || enrichedDelta.assistantReply?.type === 'silent'
	      ? null
	      : toText(enrichedDelta.assistantReply?.text) || null
    const assistantMessage = assistantReplyText ? {
      id: `engine2-assistant-${data.messageId}`,
      role: 'assistant',
      content: assistantReplyText,
      questionId: null,
    } : null
    const rawStructuredPresentation = null
    const structuredPresentation = rawStructuredPresentation
      ? { ...rawStructuredPresentation, messageId: `engine2-assistant-question-${data.messageId}` }
      : null
    const questionMessage = structuredPresentation?.questionId && structuredPresentation?.text ? {
      id: `engine2-assistant-question-${data.messageId}`, role: 'assistant', content: structuredPresentation.text,
      questionId: structuredPresentation.questionId,
    } : null
	    const finalConversation = [assistantMessage, questionMessage].filter(Boolean).reduce((conversation, message) => (
	      conversation.some((entry) => entry.id === message.id) ? conversation : [...conversation, message]
	    ), data.history)
		    const analyzeSoftTensionState = buildSoftTensionState(data, { findings: applied.findings, contradictions: applied.contradictions })
			    const analyzeContradictionCounts = withSoftTensionMetadata({
			      counts: contradictionExtractionCounts(applied.contradictions),
			      softTensionSignalsCount: analyzeSoftTensionState.softTensionSignalsCount,
			    })
		    const analyzeContradictionsEvaluated = enrichedDelta.contradictionChanges.length > 0
		    const analyzePipelineStatus = contradictionPipelineStatus({
		      contradictionExtractionStatus: analyzeContradictionsEvaluated ? 'evaluated' : 'not_evaluated',
		      formalActiveContradictionCount: analyzeContradictionCounts.formalActiveContradictionCount,
		      softTensionSignalsCount: analyzeSoftTensionState.softTensionSignalsCount,
		      detectedRawContradictionCount: (enrichedDelta.contradictionChanges || []).length,
		      rejectedContradictionCandidateCount: 0,
		      appliedContradictionCount: (applied.appliedContradictionChanges || []).length,
		    })
    if (questionMessage?.questionId) {
      applied.questions = applied.questions.map((question) => question.id === questionMessage.questionId
        ? { ...question, askedCount: Number(question.askedCount || 0) + 1, lastAskedAt: new Date().toISOString() }
        : question)
    }
    const questionInvariantResults = evaluateQuestionInvariants({
      questions: applied.questions,
      activeQuestionId: applied.activeQuestion?.id || null,
      conversation: finalConversation,
      pendingQuestionTransition: proposals.length ? applied.stagedQuestionTransition : null,
	      turnKind: enrichedDelta.turnKind,
      effectiveReplyToGapId: data.effectiveReplyToGapId,
    })
    const payload = {
      ...buildResponse({
        data,
        usage,
        findings: applied.findings,
        findingEvents: applied.findingEvents,
        contradictions: applied.contradictions,
        questions: applied.questions,
        questionEvents: applied.questionEvents,
        readiness: applied.readiness,
        reportAvailable,
        adminEnabled,
      }),
      packageId: proposals.length ? packageId : null,
      findingProposals: proposals,
	      turnKind: enrichedDelta.turnKind,
	      assistantReply: enrichedDelta.assistantReply,
	      parsedContradictionChanges: enrichedDelta.contradictionChanges || [],
		      appliedContradictionChanges: applied.appliedContradictionChanges || [],
		      detectedContradictionCandidates: enrichedDelta.contradictionChanges || [],
		      detectedRawContradictionCount: (enrichedDelta.contradictionChanges || []).length,
		      rejectedContradictionCandidateCount: 0,
			      appliedContradictionCount: (applied.appliedContradictionChanges || []).length,
			      contradictionExtractionStatus: analyzeContradictionsEvaluated ? 'evaluated' : 'not_evaluated',
			      contradictionPipelineStatus: analyzePipelineStatus,
			      softTensionSignals: analyzeSoftTensionState.softTensionSignals,
		      ...(analyzeContradictionsEvaluated ? analyzeContradictionCounts : {}),
	      activeQuestionPresentation: structuredPresentation,
	      questionTransition: enrichedDelta.questionTransition,
      canonicalizationChanges: planner.canonicalizationChanges || [],
      conversationStatus: finalConversationStatus,
      nextQuestionId: null,
      activeQuestionId: null,
      readinessDecisionSource: readinessDecision.readinessDecisionSource,
      scoreComponents: readinessDecision.scoreComponents,
      evidenceFindingIds: readinessDecision.evidenceFindingIds,
      backendInvariantResults: [...readinessDecision.backendInvariantResults, ...questionInvariantResults],
      finalScore: readinessDecision.finalScore,
      reportBlockedReasons: readinessDecision.reportBlockedReasons,
      assistantMessage,
      repairCalls: Math.max(0, planner.attempts.length - 1),
      turnApplied: true,
      analysisStatus: 'applied',
      trialEnded: usage.successfulTrialTurns >= ENGINE2_LIMITS.maxSuccessfulTrialTurns,
      responseOrigin,
      cacheStatus: 'miss',
    }
    payload.pendingDecisionPackageId = proposals.length ? packageId : null
    payload.pendingQuestionTransition = proposals.length ? applied.stagedQuestionTransition : null
    payload.sessionSnapshot = {
      ...payload.sessionSnapshot,
	      conversation: finalConversation,
	      activeQuestionId: null,
		      questionLedgerMigrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
		      contradictionExtractionStatus: analyzeContradictionsEvaluated ? 'evaluated' : 'not_evaluated',
			      detectedRawContradictionCount: (enrichedDelta.contradictionChanges || []).length,
			      rejectedContradictionCandidateCount: 0,
			      appliedContradictionCount: (applied.appliedContradictionChanges || []).length,
			      ...(analyzeContradictionsEvaluated ? analyzeContradictionCounts : {}),
			      contradictionPipelineStatus: analyzePipelineStatus,
			      softTensionSignals: analyzeSoftTensionState.softTensionSignals,
	      pendingDecisionPackageId: proposals.length ? packageId : null,
      pendingQuestionTransition: proposals.length ? applied.stagedQuestionTransition : null,
    }
    const guardedPayload = enforceEngine2NextActionInvariant({ payload, data, usage: usageBeforeSuccessfulTurn, adminEnabled })
    if (guardedPayload === payload && !diagnostics.dryRun && data.action === 'analyze_message') {
      usage = recordSuccessfulTrialTurn(usage, data.messageId)
      trialUsage.set(usageKey, { ...usage, updatedAt: now() })
      Object.assign(payload, syncUsagePayload(payload, usage, adminEnabled, data.trialId))
    }
    const finalPayload = guardedPayload === payload ? payload : guardedPayload
    if (diagnostics.enabled) {
      finalPayload.engine2Trace = buildTrace({
        traceId: `engine2-trace-${stableHash(`${data.trialId}:${data.turnId}:${startedAt}`)}`,
	        data, input, planner: enrichedPlanner, applied, readiness: applied.readiness, startedAt,
        requestReceivedAt, deltaAppliedAt, usage, responseOrigin, assistantMessage,
        readinessEvaluation: null, readinessDecision,
      })
      attachApiResponseToTrace(finalPayload)
    }
    if (!diagnostics.dryRun) {
      const cachedPayload = cacheablePayload(finalPayload)
      completedTurns.set(turnKey, { createdAt: now(), payload: cachedPayload })
      if (messageKey) completedMessages.set(messageKey, { createdAt: now(), payload: cachedPayload })
    }
    return sendJson(res, 200, finalPayload)
  } finally {
    inFlightTurns.delete(turnKey)
  }
}
