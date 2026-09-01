import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { handleEngine2Public } from '../src/lib/server/handlers/engine2Public.js'

const envPath = resolve(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required')

const call = async (body) => {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  await handleEngine2Public({
    method: 'POST', body,
    headers: { 'x-ai-support': 'on', 'x-engine2-debug': '1', host: 'localhost:5173' },
    socket: { remoteAddress: '127.0.0.1' },
  }, response)
  return response.payload
}

const initialText = 'Chcę zaprojektować nową lampę na biurko. Obecne lampy nie dają światła tam, gdzie go potrzebuję.'
const trialId = `live-model-v3-${Date.now()}`
const initialId = `live-initial-${Date.now()}`
const initialConversation = [{ id: initialId, role: 'user', content: initialText }]
const first = await call({
  version: 1, action: 'analyze_message', trialId, turnId: initialId, requestId: initialId, language: 'pl',
  message: { id: initialId, content: initialText }, history: initialConversation, findings: [],
  openQuestions: [], questionHistory: [], rejectedFingerprints: [],
  readiness: { reportScore: 0, criticalMissing: [], reportAvailable: false },
  sessionSnapshot: {
    schemaVersion: 'engine2.session.v5', conversation: initialConversation, findings: [], findingEvents: [],
    contradictions: [], questions: [], questionEvents: [], activeQuestionId: null, questionBacklog: [],
    questionLedgerMigrationVersion: 'engine2.questions.single-active.v1', pendingDecisionPackageId: null,
    pendingQuestionTransition: null, readiness: { reportScore: 0, criticalMissing: [], reportAvailable: false },
  },
  trialCounters: { successfulTrialTurns: 0, successfulTurnMessageIds: [], providerCalls: 0 }, stateVersionSent: 0,
})

const decisions = (first?.findingProposals || []).map((finding) => ({ findingId: finding.id, type: 'confirm' }))
const commitId = `live-commit-${Date.now()}`
const committed = first?.turnApplied && decisions.length > 0
  ? await call({
      version: 1, action: 'commit_finding_decisions', trialId, turnId: commitId, requestId: commitId, language: 'pl',
      history: first.sessionSnapshot.conversation, findings: first.sessionSnapshot.findings, decisions,
      rejectedFingerprints: first.rejectedFingerprints || [], pendingDecisionPackageId: first.packageId,
      sessionSnapshot: first.sessionSnapshot, trialCounters: first.trialCounters,
      stateVersionSent: Number(first.stateVersionReturned || 1),
    })
  : null
const questionsId = `live-panel-questions-${Date.now()}`
const continued = committed?.turnApplied
  ? await call({
      version: 1, action: 'generate_panel_questions', trialId, turnId: questionsId, requestId: questionsId, language: 'pl',
      history: committed.sessionSnapshot.conversation, findings: committed.sessionSnapshot.findings, decisions: [],
      rejectedFingerprints: committed.rejectedFingerprints || [], pendingDecisionPackageId: null,
      openQuestions: committed.sessionSnapshot.questionBacklog || committed.openQuestions || [],
      questionHistory: committed.sessionSnapshot.questions || committed.questions || [],
      sessionSnapshot: committed.sessionSnapshot, trialCounters: committed.trialCounters,
      stateVersionSent: Number(committed.stateVersionReturned || 2),
    })
  : null

const firstAttempts = first?.engine2Trace?.attemptDetails || []
const panelQuestions = (continued?.openQuestions || []).filter((question) => question.status === 'open' && question.presentation === 'panel')
const checks = {
  firstTurnApplied: first?.turnApplied === true,
  firstPlannerCallExactlyOnce: firstAttempts.length === 1 && Number(first?.trialCounters?.providerCalls) === 1,
  firstPassedWithoutRepair: first?.repairCalls === 0 && firstAttempts[0]?.kind === 'new_llm_call' && first?.responseOrigin === 'new_llm_call',
  firstAcknowledgementVisible: Boolean(first?.assistantMessage?.content),
  firstCreatedProposals: (first?.findingProposals || []).length >= 1,
  firstAwaitsDecisions: first?.conversationStatus === 'awaiting_decisions' && Boolean(first?.pendingDecisionPackageId),
  firstShowsNoQuestion: first?.nextQuestionId === null && first?.activeQuestionId === null && (first?.openQuestions || []).length === 0 && first?.activeQuestionPresentation === null,
  firstSuccessfulTurnIncreasedOnce: Number(first?.trialCounters?.successfulTrialTurns) === 1,
  commitApplied: committed?.turnApplied === true,
  commitClearedDecisionGate: committed?.pendingDecisionPackageId === null,
  continuationApplied: continued?.turnApplied === true,
  continuationUsedPanelQuestionGenerator: continued?.responseOrigin === 'panel_question_generator',
  continuationClearedDecisionGate: continued?.pendingDecisionPackageId === null,
  exactlyThreePanelQuestions: panelQuestions.length === 3 && panelQuestions.every((question) => /^engine2-question-/.test(String(question?.id || ''))),
  proposalsAndQuestionNeverShownTogether: (first?.openQuestions || []).length === 0 && (continued?.findingProposals || []).length === 0,
  noInvalidOutputDiagnostic: first?.diagnosticCode !== 'ENGINE2_TURN_INVALID_OUTPUT' && continued?.diagnosticCode !== 'ENGINE2_TURN_INVALID_OUTPUT',
}

const compact = (payload) => payload ? {
  turnApplied: payload.turnApplied,
  responseOrigin: payload.responseOrigin,
  conversationStatus: payload.conversationStatus,
  repairCalls: payload.repairCalls,
  providerCalls: payload.trialCounters?.providerCalls,
  successfulTrialTurns: payload.trialCounters?.successfulTrialTurns,
  assistantMessage: payload.assistantMessage,
  proposalCount: payload.findingProposals?.length || 0,
  pendingDecisionPackageId: payload.pendingDecisionPackageId,
  nextQuestionId: payload.nextQuestionId,
  activeQuestionId: payload.activeQuestionId,
  openQuestions: payload.openQuestions,
  canonicalizationChanges: payload.canonicalizationChanges,
  diagnosticCode: payload.diagnosticCode,
  attempts: payload.engine2Trace?.attemptDetails?.map((attempt) => ({
    attempt: attempt.attempt, kind: attempt.kind, model: attempt.model,
    validation: attempt.validation, canonicalizationChanges: attempt.canonicalizationChanges,
  })) || [],
} : null

console.log(JSON.stringify({ liveModelEval: true, checks, firstTurn: compact(first), continuation: compact(continued) }, null, 2))
if (Object.values(checks).some((value) => value !== true)) process.exitCode = 1
