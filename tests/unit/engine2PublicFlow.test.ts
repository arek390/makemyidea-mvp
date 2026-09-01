/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runLlmTaskMock } = vi.hoisted(() => ({ runLlmTaskMock: vi.fn() }))
vi.mock('../../llm/llmRouter.mjs', () => ({
  runLlmTask: runLlmTaskMock,
  createRateLimiter: () => () => ({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 }),
}))
vi.mock('../../src/lib/server/openaiPricing.js', () => ({
  calculateOpenAIUsageCost: vi.fn(async () => ({ usage_cost_usd: 0, usage_cost_pln: 0, pricing_source: 'test' })),
  resolveFxUsdPln: () => 4,
}))
vi.mock('../../src/lib/server/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }))

import {
  buildReadinessEvaluationInput,
  enforceEngine2NextActionInvariant,
  handleEngine2Public,
  validateEngine2Request,
} from '../../src/lib/server/handlers/engine2Public.js'

const q2 = {
  id: 'q2', semanticKey: 'light_intensity',
  question: 'Czy potrzebna jest regulacja natężenia światła?', text: 'Czy potrzebna jest regulacja natężenia światła?',
  intent: 'Ustalić regulację natężenia.', status: 'open', presentation: 'panel', askedCount: 1,
  answeredByMessageIds: [], coveredByFindingIds: [],
}
const plan = (overrides: Record<string, any> = {}) => ({
  schemaVersion: 'engine2.turn.v3', turnKind: 'conversational',
  assistantReply: { type: 'conversational_response', text: 'Jasne.' }, activeQuestionPresentation: null,
  findingChanges: [], contradictionChanges: [], questionTransition: null, ...overrides,
})
const readinessKeys = ['problem_or_need', 'desired_outcome', 'usage_context', 'constraints', 'success_criteria', 'risks_and_decisions']
const incompleteReadiness = () => ({
  schemaVersion: 'engine2.readiness.v2', overallReason: 'Najważniejszym brakiem są ograniczenia.',
  materialScore: 55, materialScoreReason: 'Są już ustalenia, ale brakuje ograniczeń.',
  components: readinessKeys.map((key, index) => key === 'constraints'
    ? { key, status: 'missing', evidenceFindingIds: [], reason: 'Brak ograniczeń.', critical: true }
    : index === 0
      ? { key, status: 'covered', evidenceFindingIds: ['f-confirmed'], reason: 'Jest dowód.', critical: false }
      : { key, status: 'not_applicable', evidenceFindingIds: [], reason: 'Nie dotyczy tej krótkiej sesji.', critical: false }),
  criticalMissing: [{ component: 'constraints', missing: 'Ograniczenia projektu', reason: 'Wpływają na wykonalność.' }],
  contradictionChanges: [],
  questionCandidates: [
    { clientRef: 'project_constraints', semanticKey: 'project_constraints', question: 'Czy limit 200 zł jest twardy, czy możesz go zwiększyć dla stabilniejszej podstawy?', intent: 'Ustalić konkretną granicę budżetu.', presentation: 'panel', reason: 'Najważniejszy brak.', groundedInFindingIds: ['f-confirmed'], targetType: 'boundary', targetContradictionId: null },
    { clientRef: 'usage_context', semanticKey: 'usage_context', question: 'W jakich sytuacjach lampa będzie używana najczęściej?', intent: 'Ustalić kontekst użycia.', presentation: 'panel', reason: 'Pomaga dobrać rozwiązanie.', groundedInFindingIds: ['f-confirmed'], targetType: 'usage_example', targetContradictionId: null },
    { clientRef: 'success_test', semanticKey: 'success_test', question: 'Czy nowa lampa ma pozwalać pracować przy biurku przez 30 minut bez poprawiania jej położenia?', intent: 'Ustalić konkretny test wygody pracy.', presentation: 'panel', reason: 'Domyka oczekiwania.', groundedInFindingIds: ['f-confirmed'], targetType: 'success_test', targetContradictionId: null },
  ],
})
const completeReadiness = (findingIds: string[]) => ({
  schemaVersion: 'engine2.readiness.v2', overallReason: 'Materiał jest kompletny.',
  materialScore: 100, materialScoreReason: 'Materiał jest kompletny.',
  components: readinessKeys.map((key, index) => ({ key, status: 'covered', evidenceFindingIds: [findingIds[index]], reason: 'Jest bezpośredni dowód.', critical: false })),
  criticalMissing: [], contradictionChanges: [], questionCandidates: [],
})
const groundQuestions = (readiness: any, findingId: string) => {
  readiness.questionCandidates = readiness.questionCandidates.map((question: any) => ({
    ...question,
    groundedInFindingIds: [findingId],
  }))
  return readiness
}
const panelQuestionsOnly = (readiness: any) => ({
  schemaVersion: 'engine2.panel_questions.v1',
  questionCandidates: readiness.questionCandidates,
})
const enrichReadinessCandidates = (data: any) => {
  if (!data || typeof data !== 'object' || !Array.isArray(data.questionCandidates)) return data
  return {
    ...data,
    questionCandidates: data.questionCandidates.map((question: any) => ({
      concreteAnchorText: question.concreteAnchorText || 'Potwierdzone ustalenie z bieżącej rozmowy.',
      uncertaintyToResolve: question.uncertaintyToResolve || 'Trzeba rozstrzygnąć jeden konkretny wybór wynikający z ustalenia.',
      userCanAnswerFromExperience: true,
      forbiddenGenericCategoryQuestion: false,
      ...question,
    })),
  }
}
const queue = (data: unknown) => runLlmTaskMock.mockImplementationOnce(async (options) => {
  const finalData = enrichReadinessCandidates(data)
  options.onRawResponse?.({ content: JSON.stringify(finalData) })
  return { ok: true, data: finalData, meta: { providerCalled: true, modelUsed: 'test', tokens: { input: 20, output: 10, total: 30 } } }
})
const queueFailure = (errorCategory = 'TIMEOUT') => runLlmTaskMock.mockImplementationOnce(async () => ({
  ok: false,
  data: null,
  error: errorCategory === 'TIMEOUT' ? 'OPENAI_REQUEST_TIMEOUT' : 'LLM_ERROR',
  meta: { providerCalled: true, errorCategory, modelUsed: 'test', tokens: { input: 5, output: 0, total: 5 } },
}))
const response = () => ({
  statusCode: 200, payload: null as any,
  status(code: number) { this.statusCode = code; return this },
  json(payload: unknown) { this.payload = payload; return this },
})
const call = async (body: any, headers: Record<string, string> = {}) => {
  const res = response()
  await handleEngine2Public({ method: 'POST', body, headers: { 'x-ai-support': 'on', ...headers }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never)
  return res.payload
}
const commitThenGenerate = async (commitBody: any, headers: Record<string, string> = {}) => {
  const committed = await call({
    ...commitBody,
    action: 'commit_finding_decisions',
  }, headers)
  if (!committed?.turnApplied) return { committed, generated: committed }
  const generated = await call({
    ...commitBody,
    action: 'generate_panel_questions',
    turnId: String(commitBody.turnId || 'commit').replace(/^continue/, 'generate'),
    history: committed.sessionSnapshot?.conversation || commitBody.history,
    findings: committed.sessionSnapshot?.findings || commitBody.findings,
    decisions: [],
    rejectedFingerprints: committed.rejectedFingerprints || commitBody.rejectedFingerprints || [],
    pendingDecisionPackageId: null,
    sessionSnapshot: committed.sessionSnapshot,
    trialCounters: committed.trialCounters,
  }, headers)
  return { committed, generated }
}
const analyzeBody = ({ trialId, messageId, content, questions = [q2], activeQuestionId = null, replyToGapId = null, findings = [], conversation, snapshot = {} }: any) => ({
  version: 1, action: 'analyze_message', trialId, turnId: messageId, language: 'pl',
  message: { id: messageId, content },
  history: conversation || [{ id: 'a-q2', role: 'assistant', content: q2.question, questionId: q2.id }, { id: messageId, role: 'user', content }],
  findings, questionHistory: questions, openQuestions: questions.filter((question: any) => question.status === 'open'),
  replyToGapId, activeQuestionGapId: activeQuestionId,
  rejectedFingerprints: [], readiness: { reportScore: 0, criticalMissing: [], reportAvailable: false },
  trialCounters: { successfulTrialTurns: 0, successfulTurnMessageIds: [], providerCalls: 0 },
  sessionSnapshot: {
    schemaVersion: 'engine2.session.v5', conversation: conversation || [{ id: 'a-q2', role: 'assistant', content: q2.question, questionId: q2.id }, { id: messageId, role: 'user', content }],
    findings, findingEvents: [], contradictions: [], questions, questionEvents: [], activeQuestionId,
    questionBacklog: [], questionLedgerMigrationVersion: 'engine2.questions.single-active.v1',
    pendingDecisionPackageId: null, pendingQuestionTransition: null,
    readiness: { reportScore: 0, criticalMissing: [], reportAvailable: false },
    ...snapshot,
  },
})

describe('Engine 2 public v3 flow', () => {
  beforeEach(() => {
    runLlmTaskMock.mockReset()
    process.env.OPENAI_API_KEY = 'test-key'
  })

  it('adds soft tension signals to readiness input when formal contradictions are empty', () => {
    const finding = {
      id: 'f-light-stable',
      semanticKey: 'lamp_portability_stability',
      content: 'Ma stać na biurku, z możliwością przeniesienia więc powinna być relatywnie lekka, ale powinna być również bardzo stabilna i nie przewracać się.',
      displayText: 'Ma stać na biurku, z możliwością przeniesienia więc powinna być relatywnie lekka, ale powinna być również bardzo stabilna i nie przewracać się.',
      status: 'confirmed',
      sourceMessageIds: ['u-light-stable'],
    }
    const input = buildReadinessEvaluationInput({
      language: 'pl',
      history: [{ id: 'u-light-stable', role: 'user', content: finding.content }],
      latestUserMessage: finding.content,
      messageId: 'u-light-stable',
      findings: [finding],
      contradictions: [],
      questions: [],
    })
    expect(input.activeContradictions).toHaveLength(0)
    expect(input.softTensionSignalsCount).toBeGreaterThan(0)
    expect(input.hasTradeoffsOrContradictions).toBe(true)
    expect(input.softTensionSignals[0]).toMatchObject({
      sideA: 'Lekka i łatwa do przeniesienia lampa',
      sideB: 'Stabilna lampa, która nie przewraca się na biurku',
    })
  })

  it('detects a simple interface versus many options soft tension for readiness', () => {
    const finding = {
      id: 'f-interface',
      semanticKey: 'lamp_interface_options',
      content: 'Prosty interface z dużą ilością opcji.',
      status: 'confirmed',
      sourceMessageIds: ['u-interface'],
    }
    const input = buildReadinessEvaluationInput({
      language: 'pl',
      history: [{ id: 'u-interface', role: 'user', content: finding.content }],
      latestUserMessage: finding.content,
      messageId: 'u-interface',
      findings: [finding],
      contradictions: [],
      questions: [],
    })
    expect(input.softTensionSignalsCount).toBeGreaterThan(0)
    expect(input.hasTradeoffsOrContradictions).toBe(true)
    expect(input.softTensionSignals.some((signal: any) => signal.semanticKey.includes('simple_interface'))).toBe(true)
  })

  it('migrates several open questions to panel entries without selecting an active question', () => {
    const q3 = { ...q2, id: 'q3', semanticKey: 'mounting', presentation: 'panel' }
    const request = analyzeBody({ trialId: 'migration', messageId: 'u1', content: 'Test', questions: [q3, q2], activeQuestionId: q2.id })
    request.sessionSnapshot.schemaVersion = 'engine2.session.v4'
    const first = validateEngine2Request(request)
    const second = validateEngine2Request(request)
    expect(first).toMatchObject({ ok: true, data: { activeQuestionId: null } })
    expect(first.data.openQuestions.map((question: any) => question.id)).toEqual([q3.id, q2.id])
    expect(second.data.questions).toEqual(first.data.questions)
  })

  it('keeps a selected panel reply target separate from the active question', () => {
    const q3 = { ...q2, id: 'q3', semanticKey: 'battery_runtime', question: 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?', text: 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?', presentation: 'panel' }
    const request = analyzeBody({ trialId: 'panel-reply-target', messageId: 'u-panel-answer', content: 'Może świecić słabiej.', questions: [q2, q3], activeQuestionId: q2.id })
    request.replyToGapId = q3.id
    request.replyTargetSource = 'explicit_composer'
    request.message.replyToQuestionId = q3.id
    request.history.at(-1).replyToQuestionId = q3.id
    const checked = validateEngine2Request(request)
    expect(checked.ok).toBe(true)
    expect(checked.data.activeQuestionId).toBeNull()
    expect(checked.data.replyToGapId).toBe(q3.id)
    expect(checked.data.effectiveReplyToGapId).toBe(q3.id)
  })

  it('ignores a stale pending question transition when committing a later finding decision', async () => {
    const answeredQuestion = {
      ...q2,
      id: 'q-answered',
      status: 'answered',
      presentation: 'hidden',
      answeredByMessageIds: ['u-answer'],
      coveredByFindingIds: ['f-confirmed'],
    }
    const pendingFinding = {
      id: 'f-pending',
      semanticKey: 'lamp_light_spot_size_adjustability',
      content: 'Lampa ma regulować średnicę stożka światła.',
      text: 'Lampa ma regulować średnicę stożka światła.',
      status: 'pending',
      packageId: 'pkg-answer',
      subject: 'world',
      perspective: 'desired',
    }
    const request = {
      version: 1,
      action: 'commit_finding_decisions',
      trialId: 'stale-transition',
      turnId: 'commit-stale-transition',
      language: 'pl',
      history: [{ id: 'u-answer', role: 'user', content: 'Chcę regulować kierunek i średnicę światła.' }],
      findings: [pendingFinding],
      decisions: [{ findingId: pendingFinding.id, type: 'confirm' }],
      rejectedFingerprints: [],
      sessionSnapshot: {
        schemaVersion: 'engine2.session.v5',
        conversation: [{ id: 'u-answer', role: 'user', content: 'Chcę regulować kierunek i średnicę światła.' }],
        findings: [pendingFinding],
        findingEvents: [],
        contradictions: [],
        questions: [answeredQuestion],
        questionEvents: [],
        activeQuestionId: null,
        questionBacklog: [],
        pendingDecisionPackageId: pendingFinding.packageId,
        pendingQuestionTransition: {
          type: 'close',
          questionId: answeredQuestion.id,
          outcome: 'answered',
          reason: 'Pytanie zostało już zamknięte przez wcześniejszy etap.',
          sourceMessageId: 'u-answer',
          evidenceFindingIds: [pendingFinding.id],
        },
        readiness: { reportScore: 0, criticalMissing: [], reportAvailable: false },
      },
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u-answer'], providerCalls: 0 },
    }

    const checked = validateEngine2Request(request)
    expect(checked.ok).toBe(true)
    expect(checked.data.pendingQuestionTransition).toBeNull()
    const committed = await call(request)
    expect(committed).toMatchObject({
      turnApplied: true,
      decisionApplied: true,
      pendingDecisionPackageId: null,
      conversationStatus: 'decision_committed',
    })
    expect(committed.error).toBeUndefined()
  })

  it('accept_persists_even_when_readiness_invalid', async () => {
    const trialId = `decision-readiness-fail-${Date.now()}`
    const pendingFinding = {
      id: 'f-lamp-pending',
      semanticKey: 'need_better_desk_lamp_light_direction',
      content: 'Chcesz zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie ich potrzebujesz.',
      text: 'Chcesz zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie ich potrzebujesz.',
      displayText: 'Chcesz zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie ich potrzebujesz.',
      status: 'pending',
      source: 'ai_interpretation',
      packageId: 'package-lamp-pending',
      subject: 'product',
      perspective: 'desired',
    }
    const sessionSnapshot = {
      schemaVersion: 'engine2.session.v5',
      conversation: [{ id: 'u-lamp', role: 'user', content: 'Chcę nową lampę na biurko.' }],
      findings: [pendingFinding],
      findingEvents: [{ id: 'event-add-lamp', entityId: pendingFinding.id, findingId: pendingFinding.id, packageId: pendingFinding.packageId, operation: 'add', createdAt: '2026-08-22T15:00:00.000Z' }],
      contradictions: [],
      questions: [],
      questionEvents: [],
      activeQuestionId: null,
      questionBacklog: [],
      pendingDecisionPackageId: pendingFinding.packageId,
      pendingQuestionTransition: null,
      readiness: { reportScore: 0, criticalMissing: [], reportAvailable: false },
    }

    const committed = await call({
      version: 1,
      action: 'commit_finding_decisions',
      trialId,
      turnId: 'commit-accept',
      language: 'pl',
      history: sessionSnapshot.conversation,
      findings: [pendingFinding],
      decisions: [{ findingId: pendingFinding.id, type: 'confirm' }],
      rejectedFingerprints: [],
      sessionSnapshot,
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u-lamp'], providerCalls: 0 },
    })

    expect(committed).toMatchObject({
      turnApplied: true,
      analysisStatus: 'applied',
      decisionApplied: true,
      continueApplied: false,
      awaitingContinueAfterDecision: true,
      pendingDecisionPackageId: null,
      findingProposals: [],
    })
    expect(committed.findingUpdates.find((finding: any) => finding.id === pendingFinding.id)).toMatchObject({
      status: 'confirmed',
      decisionSource: 'user_accept',
      decisionAt: expect.any(String),
    })
    expect(committed.findingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        findingId: pendingFinding.id,
        operation: 'decision',
        decisionType: 'accept',
        decisionSource: 'user_accept',
      }),
    ]))
    expect(runLlmTaskMock).toHaveBeenCalledTimes(0)

    const invalidReadiness = incompleteReadiness()
    invalidReadiness.questionCandidates[0] = {
      ...invalidReadiness.questionCandidates[0],
      semanticKey: 'generic_features',
      question: 'Jakie cechy i funkcje powinna mieć lampa?',
      intent: 'Ustalić cechy i funkcje.',
      uncertaintyToResolve: 'cechy i funkcje',
      concreteAnchorText: 'lampa',
      groundedInFindingIds: [pendingFinding.id],
      targetType: 'usage_example',
      userCanAnswerFromExperience: true,
      forbiddenGenericCategoryQuestion: false,
    }
    const validQuestionGeneration = groundQuestions(incompleteReadiness(), pendingFinding.id)
    queue(panelQuestionsOnly(validQuestionGeneration))

    const continued = await call({
      version: 1,
      action: 'generate_panel_questions',
      trialId,
      turnId: 'continue-after-failed-readiness',
      language: 'pl',
      history: committed.sessionSnapshot.conversation,
      findings: committed.sessionSnapshot.findings,
      decisions: [],
      rejectedFingerprints: [],
      sessionSnapshot: { ...committed.sessionSnapshot, pendingDecisionPackageId: null, pendingQuestionTransition: null },
      trialCounters: committed.trialCounters,
    })

    expect(continued).toMatchObject({
      turnApplied: true,
      analysisStatus: 'applied',
      retryable: false,
      retryableContinueError: false,
      retryableReadinessError: false,
      continueApplied: true,
      pendingDecisionPackageId: null,
      guideNotice: null,
      notice: null,
    })
    expect(continued.panelQuestions).toHaveLength(3)
    expect(continued.findingProposals).toHaveLength(0)
    expect(continued.findingUpdates.find((finding: any) => finding.id === pendingFinding.id)).toMatchObject({
      status: 'confirmed',
      decisionSource: 'user_accept',
    })

    queue(invalidReadiness)
    const readiness = await call({
      version: 1,
      action: 'evaluate_readiness',
      trialId,
      turnId: 'readiness-after-invalid-output',
      language: 'pl',
      history: continued.sessionSnapshot.conversation,
      findings: continued.sessionSnapshot.findings,
      decisions: [],
      rejectedFingerprints: [],
      sessionSnapshot: continued.sessionSnapshot,
      trialCounters: continued.trialCounters,
    })
    expect(readiness).toMatchObject({
      turnApplied: true,
      retryableReadinessError: true,
      responseOrigin: 'readiness_evaluator_failed',
      panelQuestions: expect.any(Array),
    })
    expect(readiness.panelQuestions).toHaveLength(3)
  })

  it('full_readiness_timeout_does_not_block_questions', async () => {
    const trialId = `readiness-timeout-${Date.now()}`
    const finding = {
      id: 'f-lamp-timeout',
      semanticKey: 'lamp_goal',
      content: 'Chcesz zaprojektować lampę na biurko.',
      text: 'Chcesz zaprojektować lampę na biurko.',
      displayText: 'Chcesz zaprojektować lampę na biurko.',
      status: 'confirmed',
      decisionSource: 'user_accept',
      decisionAt: '2026-08-22T18:00:00.000Z',
      updatedAt: '2026-08-22T18:00:00.000Z',
      packageId: 'package-timeout',
    }
    const questions = groundQuestions(incompleteReadiness(), finding.id)
    queue(panelQuestionsOnly(questions))
    const payload = await call({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-readiness-timeout', language: 'pl',
      history: [{ id: 'u1', role: 'user', content: 'Chcę lampę.' }],
      findings: [finding], decisions: [], rejectedFingerprints: [],
      sessionSnapshot: { schemaVersion: 'engine2.session.v5', conversation: [{ id: 'u1', role: 'user', content: 'Chcę lampę.' }], findings: [finding], findingEvents: [], contradictions: [], questions: [], questionEvents: [], activeQuestionId: null, pendingDecisionPackageId: null, pendingQuestionTransition: null },
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u1'], providerCalls: 0 },
    })
    expect(payload).toMatchObject({
      turnApplied: true,
      conversationStatus: 'continue',
      pendingDecisionPackageId: null,
      retryableReadinessError: false,
      retryableQuestionGeneration: false,
      responseOrigin: 'panel_question_generator',
    })
    expect(payload.panelQuestions).toHaveLength(3)
    expect(payload.findingUpdates[0]).toMatchObject({ status: 'confirmed', decisionSource: 'user_accept' })

    queueFailure('TIMEOUT')
    const readiness = await call({
      version: 1, action: 'evaluate_readiness', trialId, turnId: 'evaluate-readiness-timeout', language: 'pl',
      history: payload.sessionSnapshot.conversation,
      findings: payload.sessionSnapshot.findings,
      decisions: [], rejectedFingerprints: [],
      sessionSnapshot: payload.sessionSnapshot,
      trialCounters: payload.trialCounters,
    })
    expect(readiness).toMatchObject({
      turnApplied: true,
      retryableReadinessError: true,
      responseOrigin: 'readiness_evaluator_failed',
    })
    expect(readiness.panelQuestions).toHaveLength(3)
  })

  it('question_generation_timeout_shows_retry', async () => {
    const trialId = `question-timeout-${Date.now()}`
    const finding = {
      id: 'f-lamp-question-timeout',
      semanticKey: 'lamp_goal',
      content: 'Chcesz zaprojektować lampę na biurko.',
      text: 'Chcesz zaprojektować lampę na biurko.',
      displayText: 'Chcesz zaprojektować lampę na biurko.',
      status: 'confirmed',
      decisionSource: 'user_accept',
      decisionAt: '2026-08-22T18:00:00.000Z',
      updatedAt: '2026-08-22T18:00:00.000Z',
      packageId: 'package-question-timeout',
    }
    queueFailure('TIMEOUT')
    const payload = await call({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-question-timeout', language: 'pl',
      history: [{ id: 'u1', role: 'user', content: 'Chcę lampę.' }],
      findings: [finding], decisions: [], rejectedFingerprints: [],
      sessionSnapshot: { schemaVersion: 'engine2.session.v5', conversation: [{ id: 'u1', role: 'user', content: 'Chcę lampę.' }], findings: [finding], findingEvents: [], contradictions: [], questions: [], questionEvents: [], activeQuestionId: null, pendingDecisionPackageId: null, pendingQuestionTransition: null },
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u1'], providerCalls: 0 },
    }, { 'x-engine2-debug': '1' })
    expect(payload).toMatchObject({
      turnApplied: false,
      analysisStatus: 'retryable_error',
      retryable: true,
      retryableContinueError: true,
      retryableQuestionGeneration: true,
      pendingDecisionPackageId: null,
      guideNotice: 'Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.',
    })
    expect(payload.panelQuestions).toHaveLength(0)
    expect(payload.findingUpdates[0]).toMatchObject({ status: 'confirmed', decisionSource: 'user_accept' })
    expect(payload.engine2Trace.questionDiagnostics).toMatchObject({
      questionGenerationAttempted: true,
      questionGenerationFailed: true,
      retryableQuestionGeneration: true,
    })
  })

  it('keeps panel usable on question timeout when a confirmed local tension can fill the missing question', async () => {
    const trialId = `question-timeout-local-tension-${Date.now()}`
    const findings = [
      {
        id: 'f-lamp',
        semanticKey: 'user_need_new_desk_lamp',
        content: 'Chcesz zaprojektować nową lampę na biurko.',
        text: 'Chcesz zaprojektować nową lampę na biurko.',
        displayText: 'Chcesz zaprojektować nową lampę na biurko.',
        status: 'confirmed',
        sourceMessageIds: ['u-lamp'],
        decisionSource: 'user_accept',
      },
      {
        id: 'f-energy-light',
        semanticKey: 'user_preference_energy_efficiency_vs_light_intensity',
        content: 'Preferujesz lampę, która zużywa mało energii i jednocześnie daje dobre, jasne światło.',
        text: 'Preferujesz lampę, która zużywa mało energii i jednocześnie daje dobre, jasne światło.',
        displayText: 'Preferujesz lampę, która zużywa mało energii i jednocześnie daje dobre, jasne światło.',
        status: 'confirmed',
        sourceMessageIds: ['u-energy-light'],
        decisionSource: 'user_accept',
      },
    ]
    const questions = [
      {
        id: 'q-distribution',
        semanticKey: 'lamp_light_distribution_preference',
        question: 'Jak obecnie rozmieszczone jest światło z Twojej lampy na biurku?',
        text: 'Jak obecnie rozmieszczone jest światło z Twojej lampy na biurku?',
        intent: 'Ustalić rozkład światła.',
        status: 'open',
        presentation: 'panel',
      },
      {
        id: 'q-size',
        semanticKey: 'lamp_design_constraints_size_and_position',
        question: 'Czy są ograniczenia dotyczące rozmiaru lub miejsca ustawienia lampy?',
        text: 'Czy są ograniczenia dotyczące rozmiaru lub miejsca ustawienia lampy?',
        intent: 'Ustalić ograniczenia przestrzenne.',
        status: 'open',
        presentation: 'panel',
      },
    ]
    const conversation = [
      { id: 'u-lamp', role: 'user', content: 'chce zaprojektować nowa lampę na biurko' },
      { id: 'u-energy-light', role: 'user', content: 'lampa ma zużywać mało Energi i dawać dobre jasne swiatlo' },
    ]
    queueFailure('TIMEOUT')

    const payload = await call({
      version: 1,
      action: 'generate_panel_questions',
      trialId,
      turnId: 'generate-after-energy-light',
      language: 'pl',
      history: conversation,
      findings,
      decisions: [],
      rejectedFingerprints: [],
      sessionSnapshot: {
        schemaVersion: 'engine2.session.v5',
        conversation,
        findings,
        findingEvents: [],
        contradictions: [],
        questions,
        questionEvents: [],
        questionBacklog: questions,
        activeQuestionId: null,
        pendingDecisionPackageId: null,
        pendingQuestionTransition: null,
      },
      trialCounters: { successfulTrialTurns: 2, successfulTurnMessageIds: ['u-lamp', 'u-energy-light'], providerCalls: 0 },
    }, { 'x-engine2-debug': '1' })

    expect(payload.turnApplied).toBe(true)
    expect(payload.responseOrigin).toBe('panel_question_generation_failed_kept_existing')
    expect(payload.panelQuestions).toHaveLength(3)
    expect(payload.sessionSnapshot.contradictions).toHaveLength(1)
    expect(payload.sessionSnapshot.contradictions[0]).toMatchObject({
      semanticKey: 'lamp_energy_efficiency_vs_bright_light',
      sideA: 'Niskie zużycie energii',
      sideB: 'Dobre, jasne światło',
      sourceFindingIds: ['f-energy-light'],
    })
    expect(payload.activeContradictionCount).toBe(1)
    expect(payload.panelQuestions.some((question: any) => question.targetContradictionId === payload.sessionSnapshot.contradictions[0].id)).toBe(true)
  })

  it('turns a no-next-action payload into a retryable dead-end diagnostic', () => {
    const usage = {
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['u1'],
      providerCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costPln: 0,
      modelUsage: {},
      lastCall: null,
    }
    const guarded = enforceEngine2NextActionInvariant({
      data: { trialId: 'dead-end', turnId: 'continue-dead', messageId: 'u1', language: 'pl' },
      usage,
      payload: {
        reportAvailable: false,
        trialEnded: false,
        retryable: false,
        pendingDecisionPackageId: null,
        nextQuestionId: null,
        activeQuestionId: null,
        questions: [],
        sessionSnapshot: { pendingDecisionPackageId: null, pendingQuestionTransition: null },
      },
    })

    expect(guarded).toMatchObject({
      diagnosticCode: 'DEAD_END_NO_NEXT_ACTION',
      retryable: true,
      turnApplied: false,
      analysisStatus: 'retryable_error',
    })
    expect(guarded.trialCounters.successfulTrialTurns).toBe(1)
  })

  it('treats an explicit empty panelQuestions response as a dead-end even when legacy questions exist', () => {
    const usage = {
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['u1'],
      providerCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costPln: 0,
      modelUsage: {},
      lastCall: null,
    }
    const openPanelQuestions = [
      { ...q2, id: 'q-panel-1', semanticKey: 'panel_1', presentation: 'panel' },
      { ...q2, id: 'q-panel-2', semanticKey: 'panel_2', presentation: 'panel' },
      { ...q2, id: 'q-panel-3', semanticKey: 'panel_3', presentation: 'panel' },
    ]
    const guarded = enforceEngine2NextActionInvariant({
      data: { trialId: 'dead-panel', turnId: 'continue-dead-panel', messageId: 'u1', language: 'pl' },
      usage,
      payload: {
        reportAvailable: false,
        trialEnded: false,
        retryable: false,
        pendingDecisionPackageId: null,
        nextQuestionId: null,
        activeQuestionId: null,
        questions: openPanelQuestions,
        openQuestions: openPanelQuestions,
        panelQuestions: [],
        sessionSnapshot: { pendingDecisionPackageId: null, pendingQuestionTransition: null },
      },
    })

    expect(guarded).toMatchObject({
      diagnosticCode: 'DEAD_END_NO_NEXT_ACTION',
      retryable: true,
      turnApplied: false,
      analysisStatus: 'retryable_error',
    })
  })

  it('finding_cannot_confirm_without_user_decision', async () => {
    const trialId = `missing-decision-${Date.now()}`
    const finding = {
      id: 'f-auto-confirmed',
      semanticKey: 'usage_context_detail',
      content: 'Lampa będzie używana przy komputerze i naprawach.',
      text: 'Lampa będzie używana przy komputerze i naprawach.',
      displayText: 'Lampa będzie używana przy komputerze i naprawach.',
      status: 'confirmed',
      subject: 'world',
      perspective: 'desired',
      packageId: 'pkg-auto',
    }
    const payload = await call({
      version: 1, action: 'commit_finding_decisions', trialId, turnId: 'continue-missing-decision', language: 'pl',
      history: [{ id: 'u1', role: 'user', content: 'Komputer i naprawy.' }],
      findings: [finding],
      decisions: [],
      rejectedFingerprints: [],
      sessionSnapshot: {
        schemaVersion: 'engine2.session.v5',
        conversation: [{ id: 'u1', role: 'user', content: 'Komputer i naprawy.' }],
        findings: [finding],
        findingEvents: [{ id: 'e-add', entityId: finding.id, operation: 'add', messageId: 'u1', createdAt: '2026-08-22T10:00:00.000Z' }],
        contradictions: [],
        questions: [],
        questionEvents: [],
        activeQuestionId: null,
        pendingDecisionPackageId: 'pkg-auto',
        pendingQuestionTransition: null,
      },
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u1'], providerCalls: 1 },
    })

    expect(payload).toMatchObject({
      turnApplied: false,
      retryable: true,
      diagnosticCode: 'ENGINE2_USER_DECISION_EVENT_REQUIRED',
      responseOrigin: 'decision_invariant_failed',
    })
    expect(payload.backendInvariantResults).toContainEqual(expect.objectContaining({
      invariant: 'confirmed_or_rejected_finding_requires_user_decision_event',
      passed: false,
      missingDecisionFindingIds: [finding.id],
    }))
  })

  it('applies the raw live-shaped first turn once, then refreshes exactly three panel questions after Accept', async () => {
    const trialId = `first-turn-${Date.now()}`
    const messageId = 'engine2-user-first-turn'
    const content = 'chce zaprojektować nowa lampę na biurko, obecne lampy nie dają światła tam gdzie go potrzebuje.'
    const plannerQuestion = 'Gdzie dokładnie na biurku potrzebujesz światła?'
    const rawPlan = plan({
      turnKind: 'substantive_information', assistantReply: { type: 'acknowledgement', text: 'Rozumiem, zapisuję punkt wyjścia do potwierdzenia.' },
      findingChanges: [
        { operation: 'add', clientRef: 'lamp-project', semanticKey: 'lamp_project', text: 'Użytkownik chce zaprojektować nową lampę na biurko.', subject: 'product', perspective: 'desired' },
        { operation: 'add', clientRef: 'light-placement-problem', semanticKey: 'light_placement_problem', text: 'Obecne lampy nie oświetlają miejsca, w którym światło jest potrzebne.', subject: 'product', perspective: 'not_working' },
      ],
    })
    const conversation = [{ id: messageId, role: 'user', content }]
    const request = analyzeBody({ trialId, messageId, content, questions: [], activeQuestionId: null, conversation })
    queue(rawPlan)
    const analyzed = await call(request)
    expect(analyzed).toMatchObject({
      turnApplied: true, conversationStatus: 'awaiting_decisions', activeQuestionId: null, nextQuestionId: null,
      repairCalls: 0, assistantMessage: null,
      trialCounters: { successfulTrialTurns: 1, providerCalls: 1 },
    })
    expect(analyzed.findingProposals).toHaveLength(2)
    expect(analyzed.activeQuestionPresentation).toBeNull()
    expect(analyzed.questionTransition).toBeNull()
    expect(analyzed.questions).toEqual([])
    expect(analyzed.pendingDecisionPackageId).toBe(analyzed.packageId)
    expect(analyzed.canonicalizationChanges).toEqual([
      'substantive_information reclassified as unsolicited_substantive_information without replyToQuestionId',
    ])
    expect(runLlmTaskMock).toHaveBeenCalledTimes(1)
    expect(analyzed.findingProposals[0]).toMatchObject({
      content: 'Użytkownik chce zaprojektować nową lampę na biurko.',
      displayText: 'Chcesz zaprojektować nową lampę na biurko.',
    })

    const replay = await call(request)
    expect(replay.responseOrigin).toBe('idempotency_replay')
    expect(replay.findingProposals.map((finding: any) => finding.id)).toEqual(analyzed.findingProposals.map((finding: any) => finding.id))
    expect(replay.sessionSnapshot.conversation.filter((message: any) => message.id === messageId)).toHaveLength(1)
    expect(runLlmTaskMock).toHaveBeenCalledTimes(1)

    const readiness = groundQuestions(incompleteReadiness(), analyzed.findingProposals[0].id)
    readiness.components[0].evidenceFindingIds = [analyzed.findingProposals[0].id]
    queue(panelQuestionsOnly(readiness))
    const { generated: continued } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-first-turn', language: 'pl',
      history: analyzed.sessionSnapshot.conversation, findings: analyzed.sessionSnapshot.findings,
      decisions: analyzed.findingProposals.map((finding: any) => ({ findingId: finding.id, type: 'confirm' })),
      rejectedFingerprints: [], sessionSnapshot: analyzed.sessionSnapshot, trialCounters: analyzed.trialCounters,
    }, { 'x-engine2-debug': '1' })
    expect(continued).toMatchObject({ turnApplied: true, conversationStatus: 'continue', pendingDecisionPackageId: null })
    expect(continued.openQuestions).toHaveLength(3)
    expect(continued.panelQuestions).toHaveLength(3)
    expect(continued.chatQuestion).toBeNull()
    expect(continued.nextQuestionId).toBeNull()
    expect(continued.activeQuestionId).toBeNull()
    expect(continued.openQuestions[0].id).toMatch(/^engine2-question-/)
    expect(continued.openQuestions[0].question).not.toBe(plannerQuestion)
    expect(continued.openQuestions.every((question: any) => question.presentation === 'panel')).toBe(true)
    expect(continued.sessionSnapshot.conversation.some((message: any) => message.questionId)).toBe(false)
    expect(continued.reportAvailable).toBe(false)
    expect(continued.materialReadiness.materialScore).toBe(0)
    expect(continued.reportReadiness.reportScore).toBe(0)
    expect(continued.backendInvariantResults).toContainEqual(expect.objectContaining({
      invariant: 'dead_end_next_action',
      passed: true,
      panelQuestionCount: 3,
    }))
    expect(continued.engine2Trace).toMatchObject({
      action: 'generate_panel_questions',
      questionCandidatesRaw: expect.arrayContaining([
        expect.objectContaining({ semanticKey: 'project_constraints' }),
      ]),
      questionCandidatesApplied: expect.arrayContaining([
        expect.objectContaining({ presentation: 'panel' }),
      ]),
      panelQuestionCount: 3,
      chatQuestion: null,
    })
    expect(continued.engine2Trace.apiResponse).toMatchObject({
      action: 'generate_panel_questions',
      panelQuestions: expect.arrayContaining([
        expect.objectContaining({ presentation: 'panel' }),
      ]),
      chatQuestion: null,
    })
    expect(runLlmTaskMock).toHaveBeenCalledTimes(2)
    expect(runLlmTaskMock.mock.calls[1][0].task).toBe('engine2-panel-questions')
  })

  it('handles a selected panel question answer and Accept sequence without semantic repair', async () => {
    const trialId = `sequence-${Date.now()}`
    const answerId = 'u-answer'
    const answerConversation = [
      { id: answerId, role: 'user', content: 'Tak, chcę regulować jasność.', replyToQuestionId: q2.id, replyToQuestionText: q2.question, replyTargetSource: 'explicit_composer' },
    ]
    queue(plan({
      turnKind: 'substantive_information', assistantReply: { type: 'acknowledgement', text: 'Zapisuję wymaganie do potwierdzenia.' },
      findingChanges: [{ operation: 'add', clientRef: 'light-control', semanticKey: 'light_intensity_control', text: 'Lampa ma mieć regulację natężenia światła.', subject: 'product', perspective: 'desired' }],
      questionTransition: { type: 'close', questionId: q2.id, outcome: 'answered', reason: 'Bezpośrednia odpowiedź.', sourceMessageId: answerId, evidenceFindingRefs: ['light-control'] },
    }))
    const analyzed = await call(analyzeBody({
      trialId, messageId: answerId, content: 'Tak, chcę regulować jasność.',
      conversation: answerConversation, questions: [q2], activeQuestionId: null,
      replyToGapId: q2.id,
      snapshot: { conversation: answerConversation, pendingDecisionPackageId: null },
    }))
    expect(analyzed).toMatchObject({
      turnApplied: true, conversationStatus: 'awaiting_decisions', nextQuestionId: null,
      pendingQuestionTransition: { questionId: q2.id, outcome: 'answered' },
    })
    expect(analyzed.findingProposals).toHaveLength(1)
    expect(analyzed.findingProposals[0]).toMatchObject({ status: 'pending' })
    expect(analyzed.findingUpdates.find((finding: any) => finding.id === analyzed.findingProposals[0].id)).toMatchObject({ status: 'pending' })
    expect(analyzed.pendingDecisionPackageId).toBe(analyzed.packageId)
    expect(analyzed.questions.find((question: any) => question.id === q2.id)).toMatchObject({ status: 'open' })
    expect(runLlmTaskMock).toHaveBeenCalledTimes(1)

    const proposal = analyzed.findingProposals[0]
    const findingsForReadiness = analyzed.sessionSnapshot.findings.map((finding: any) => finding.id === proposal.id ? finding : finding)
    const readiness = groundQuestions(incompleteReadiness(), proposal.id)
    readiness.components[0].evidenceFindingIds = [proposal.id]
    queue(panelQuestionsOnly(readiness))
    const continueRequest = {
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-accept', language: 'pl',
      history: analyzed.sessionSnapshot.conversation, findings: findingsForReadiness,
      decisions: [{ findingId: proposal.id, type: 'confirm' }], rejectedFingerprints: [],
      sessionSnapshot: { ...analyzed.sessionSnapshot, pendingDecisionPackageId: analyzed.packageId },
      trialCounters: analyzed.trialCounters,
    }
    const { generated: continued } = await commitThenGenerate(continueRequest)
    expect(continued).toMatchObject({
      turnApplied: true, conversationStatus: 'continue', pendingDecisionPackageId: null,
    })
    expect(continued.questions.find((question: any) => question.id === q2.id)).toMatchObject({ status: 'answered', presentation: 'hidden' })
    expect(continued.findingUpdates.find((finding: any) => finding.id === proposal.id)).toMatchObject({
      status: 'confirmed',
      decisionSource: 'user_accept',
    })
    expect(continued.findingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: proposal.id,
        findingId: proposal.id,
        packageId: analyzed.packageId,
        operation: 'decision',
        decisionType: 'accept',
        decisionSource: 'user_accept',
        decisionAt: expect.any(String),
      }),
    ]))
    expect(continued.backendInvariantResults).toContainEqual(expect.objectContaining({
      invariant: 'confirmed_or_rejected_requires_user_decision_event',
      passed: true,
    }))
    expect(continued.openQuestions).toHaveLength(3)
    expect(continued.openQuestions[0].id).toMatch(/^engine2-question-/)
    expect(continued.nextQuestionId).toBeNull()
    expect(continued.sessionSnapshot.conversation.some((message: any) => message.questionId)).toBe(false)
    expect(runLlmTaskMock).toHaveBeenCalledTimes(2)

  })

  it('treats a free message without a selected panel question as unsolicited information', async () => {
    const trialId = `unsolicited-panel-${Date.now()}`
    const firstMessageId = 'u-free-start'
    const firstContent = 'Chcę zaprojektować lampę na biurko, bo obecna świeci w złe miejsce.'
    queue(plan({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [
        { operation: 'add', clientRef: 'lamp-project', semanticKey: 'lamp_project', text: 'Użytkownik chce zaprojektować nową lampę na biurko, bo obecna świeci w złe miejsce.', subject: 'product', perspective: 'desired' },
      ],
    }))
    const first = await call(analyzeBody({
      trialId,
      messageId: firstMessageId,
      content: firstContent,
      questions: [],
      activeQuestionId: null,
      conversation: [{ id: firstMessageId, role: 'user', content: firstContent }],
    }))
    expect(first.pendingDecisionPackageId).toBe(first.packageId)

    const firstReadiness = incompleteReadiness()
    firstReadiness.components[0].evidenceFindingIds = [first.findingProposals[0].id]
    groundQuestions(firstReadiness, first.findingProposals[0].id)
    queue(panelQuestionsOnly(firstReadiness))
    const { generated: panel } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-unsolicited-first', language: 'pl',
      history: first.sessionSnapshot.conversation, findings: first.sessionSnapshot.findings,
      decisions: first.findingProposals.map((finding: any) => ({ findingId: finding.id, type: 'confirm' })),
      rejectedFingerprints: [], sessionSnapshot: first.sessionSnapshot, trialCounters: first.trialCounters,
    })
    expect(panel.openQuestions).toHaveLength(3)
    expect(panel.panelQuestions).toHaveLength(3)
    expect(panel.openQuestions.every((question: any) => question.presentation === 'panel')).toBe(true)
    expect(panel.activeQuestionId).toBeNull()
    expect(panel.nextQuestionId).toBeNull()
    expect(panel.sessionSnapshot.conversation.some((message: any) => message.questionId)).toBe(false)

    const openBeforeFreeMessage = panel.openQuestions.map((question: any) => question.id)
    const freeMessageId = 'u-free-followup'
    const freeText = 'Dopowiem, że często robię przy biurku drobne naprawy elektroniki.'
    const freeConversation = [...panel.sessionSnapshot.conversation, { id: freeMessageId, role: 'user', content: freeText }]
    queue(plan({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [
        { operation: 'add', clientRef: 'electronics-repairs', semanticKey: 'electronics_repairs_context', text: 'Użytkownik często wykonuje przy biurku drobne naprawy elektroniki.', subject: 'context', perspective: 'current' },
      ],
      questionTransition: null,
    }))
    const freeAnalyzed = await call(analyzeBody({
      trialId,
      messageId: freeMessageId,
      content: freeText,
      conversation: freeConversation,
      questions: panel.questions,
      activeQuestionId: null,
      replyToGapId: null,
      snapshot: { ...panel.sessionSnapshot, conversation: freeConversation, pendingDecisionPackageId: null },
    }))
    expect(freeAnalyzed).toMatchObject({
      turnKind: 'unsolicited_substantive_information',
      replyToGapId: null,
      effectiveReplyToGapId: null,
      pendingQuestionTransition: null,
    })
    expect(freeAnalyzed.canonicalizationChanges).toContain('substantive_information reclassified as unsolicited_substantive_information without replyToQuestionId')
    expect(freeAnalyzed.questions.filter((question: any) => openBeforeFreeMessage.includes(question.id)).every((question: any) => question.status === 'open')).toBe(true)

    const secondReadiness = incompleteReadiness()
    secondReadiness.questionCandidates = [
      { clientRef: 'lamp_direction_anchor', semanticKey: 'lamp_direction_anchor', question: 'Czy przy zwykłej pracy przy biurku ważniejsze jest szerokie światło, czy możliwość szybkiego skierowania lampy dokładnie w jedno miejsce?', intent: 'Ustalić konkretny kompromis kierunku światła.', presentation: 'panel', reason: 'Wynika z pierwotnego celu lampy.', groundedInFindingIds: [first.findingProposals[0].id], targetType: 'priority', targetContradictionId: null },
      { clientRef: 'generic_features_bad', semanticKey: 'generic_features_bad', question: 'Jakie cechy i funkcje powinna mieć lampa?', intent: 'Ustalić cechy i funkcje.', presentation: 'panel', reason: 'Zbyt ogólne pytanie testowe.', groundedInFindingIds: [freeAnalyzed.findingProposals[0].id], targetType: 'observation', targetContradictionId: null, concreteAnchorText: 'lampa', uncertaintyToResolve: 'cechy i funkcje', userCanAnswerFromExperience: true, forbiddenGenericCategoryQuestion: false },
      { clientRef: 'desk_space_repair_tools', semanticKey: 'desk_space_repair_tools', question: 'Czy na biurku musi zostać stałe miejsce na narzędzia naprawcze, nawet jeśli podstawa lampy będzie przez to mniejsza?', intent: 'Ustalić ograniczenie miejsca na biurku.', presentation: 'panel', reason: 'Kontekst napraw wpływa na rozmiar podstawy.', groundedInFindingIds: [freeAnalyzed.findingProposals[0].id], targetType: 'boundary', targetContradictionId: null },
    ]
    secondReadiness.components[0].evidenceFindingIds = [freeAnalyzed.findingProposals[0].id]
    queue(panelQuestionsOnly(secondReadiness))
    const { generated: refreshed } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-unsolicited-free', language: 'pl',
      history: freeAnalyzed.sessionSnapshot.conversation, findings: freeAnalyzed.sessionSnapshot.findings,
      decisions: freeAnalyzed.findingProposals.map((finding: any) => ({ findingId: finding.id, type: 'confirm' })),
      rejectedFingerprints: [], sessionSnapshot: { ...freeAnalyzed.sessionSnapshot, pendingDecisionPackageId: freeAnalyzed.packageId },
      trialCounters: freeAnalyzed.trialCounters,
    })
    expect(refreshed.openQuestions).toHaveLength(3)
    expect(refreshed.panelQuestions).toHaveLength(3)
    expect(refreshed.openQuestions.every((question: any) => question.presentation === 'panel')).toBe(true)
    expect(refreshed.activeQuestionId).toBeNull()
    expect(refreshed.nextQuestionId).toBeNull()
    expect(refreshed.sessionSnapshot.conversation.some((message: any) => message.questionId)).toBe(false)
    expect(refreshed.questions.filter((question: any) => openBeforeFreeMessage.includes(question.id)).every((question: any) => question.status === 'open')).toBe(true)
    expect(refreshed.questions.filter((question: any) => openBeforeFreeMessage.includes(question.id)).some((question: any) => question.status === 'answered')).toBe(false)
    expect(refreshed.retryable).toBe(false)
    expect(refreshed.retryableContinueError).toBe(false)
    expect(refreshed.invalidCandidateCount).toBe(0)
    expect(refreshed.latestFindingCoverageCount).toBe(2)
    expect(refreshed.panelFilledFromExistingCount).toBe(0)
    expect(refreshed.openQuestions.some((question: any) => question.semanticKey === 'lamp_direction_anchor')).toBe(true)
    expect(refreshed.openQuestions.some((question: any) => question.semanticKey === 'generic_features_bad')).toBe(true)
  })

  it('regresses the lamp desired_outcome reply through repair, staged closure and a three-question panel', async () => {
    const trialId = `lamp-regression-${Date.now()}`
    const firstMessageId = 'u-lamp-start'
    const firstContent = 'Mam problem z lampą na biurko i chcę zaprojektować nową.'
    queue(plan({
      turnKind: 'substantive_information',
      assistantReply: { type: 'acknowledgement', text: 'Zapisuję punkt wyjścia.' },
      findingChanges: [
        { operation: 'add', clientRef: 'lamp-project', semanticKey: 'lamp_project', text: 'Użytkownik chce zaprojektować nową lampę na biurko.', subject: 'product', perspective: 'desired' },
      ],
    }))
    const first = await call(analyzeBody({
      trialId,
      messageId: firstMessageId,
      content: firstContent,
      questions: [],
      activeQuestionId: null,
      conversation: [{ id: firstMessageId, role: 'user', content: firstContent }],
    }))
    expect(first.assistantMessage).toBeNull()
    expect(first.sessionSnapshot.conversation).toEqual([{ id: firstMessageId, role: 'user', content: firstContent }])
    const firstReadiness = incompleteReadiness()
    firstReadiness.questionCandidates = [
      { clientRef: 'desired_outcome', semanticKey: 'desired_outcome', question: 'Podczas pracy przy komputerze i przy naprawach lampa może potrzebować dwóch sposobów świecenia. Czy chcesz przełączać się między światłem spokojnym do komputera i mocnym skupionym do napraw?', intent: 'Sprawdzić napięcie między trybami pracy.', presentation: 'panel', reason: 'Najważniejszy brak.', groundedInFindingIds: [first.findingProposals[0].id], targetType: 'contradiction_probe', targetContradictionId: 'computer_work_vs_repairs_light' },
      { clientRef: 'usage_context', semanticKey: 'usage_context', question: 'Czy lampę będziesz często przesuwać po biurku, czy zwykle zostanie w jednym miejscu?', intent: 'Ustalić sposób używania.', presentation: 'panel', reason: 'Wpływa na stabilność i rozmiar.', groundedInFindingIds: [first.findingProposals[0].id], targetType: 'usage_example', targetContradictionId: null },
      { clientRef: 'constraints', semanticKey: 'constraints', question: 'Czy przy limicie 200 zł ważniejszy jest akumulator na godzinę, czy możliwie mocne światło podczas napraw?', intent: 'Ustalić priorytet ograniczenia.', presentation: 'panel', reason: 'Ogranicza warianty.', groundedInFindingIds: [first.findingProposals[0].id], targetType: 'priority', targetContradictionId: null },
    ]
    firstReadiness.contradictionChanges = [{
      operation: 'create',
      contradictionId: null,
      semanticKey: 'computer_work_vs_repairs_light',
      description: 'Praca przy komputerze może wymagać spokojniejszego światła, a precyzyjne naprawy mocnego skupionego światła.',
      sideA: 'Spokojne światło do pracy przy komputerze.',
      sideB: 'Mocne, skupione światło do precyzyjnych napraw.',
      sourceFindingIds: [first.findingProposals[0].id],
      sourceMessageIds: [firstMessageId],
      status: 'suspected',
      reportBlocking: true,
      verificationQuestionId: null,
      resolutionFindingIds: [],
    }]
    firstReadiness.components[0].evidenceFindingIds = [first.findingProposals[0].id]
    queue(panelQuestionsOnly(firstReadiness))
    const { generated: continuedFirst } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-lamp-first', language: 'pl',
      history: first.sessionSnapshot.conversation, findings: first.sessionSnapshot.findings,
      decisions: first.findingProposals.map((finding: any) => ({ findingId: finding.id, type: 'confirm' })),
      rejectedFingerprints: [], sessionSnapshot: first.sessionSnapshot, trialCounters: first.trialCounters,
    })
    expect(continuedFirst.openQuestions).toHaveLength(3)
    expect(continuedFirst.openQuestions.every((question: any) => question.presentation === 'panel')).toBe(true)
    const desiredQuestion = continuedFirst.openQuestions.find((question: any) => question.semanticKey === 'desired_outcome')
    expect(desiredQuestion).toMatchObject({ presentation: 'panel' })
    expect(continuedFirst.nextQuestionId).toBeNull()
    expect(continuedFirst.activeQuestionId).toBeNull()
    expect(continuedFirst.sessionSnapshot.conversation.some((message: any) => message.questionId)).toBe(false)
    expect(desiredQuestion).toMatchObject({
      targetType: 'contradiction_probe',
      groundedInFindingIds: [first.findingProposals[0].id],
      targetContradictionId: 'computer_work_vs_repairs_light',
    })

    const answerId = 'u-lamp-desired-outcome'
    const answerText = 'chodzi mi o to żeby łatwo można dopasować miejsce w które lampa świeci i żeby można było też zmienić średnicę stożka światła od szerokiego ogólnego do punktowego dla precyzyjnych prac'
    const answerConversation = [...continuedFirst.sessionSnapshot.conversation, {
      id: answerId,
      role: 'user',
      content: answerText,
      replyToQuestionId: desiredQuestion.id,
      replyToQuestionText: desiredQuestion.question,
      replyTargetSource: 'explicit_composer',
    }]
    const missingClosure = plan({
      turnKind: 'substantive_information',
      assistantReply: { type: 'acknowledgement', text: 'Zapisuję wymaganie dotyczące sterowania światłem.' },
      findingChanges: [
        { operation: 'add', clientRef: 'beam-control', semanticKey: 'desired_beam_control', text: 'Lampa ma umożliwiać łatwe dopasowanie miejsca świecenia oraz zmianę średnicy stożka światła od szerokiego do punktowego.', subject: 'product', perspective: 'desired' },
      ],
      questionTransition: null,
    })
    const repairedClosure = plan({
      ...missingClosure,
      questionTransition: { type: 'close', questionId: desiredQuestion.id, outcome: 'answered', reason: 'Odpowiedź bezpośrednio opisuje oczekiwany rezultat.', sourceMessageId: answerId, evidenceFindingRefs: ['beam-control'] },
    })
    queue(missingClosure)
    queue(repairedClosure)
    const analyzedAnswer = await call(analyzeBody({
      trialId,
      messageId: answerId,
      content: answerText,
      conversation: answerConversation,
      questions: continuedFirst.questions,
      activeQuestionId: null,
      replyToGapId: desiredQuestion.id,
      snapshot: { ...continuedFirst.sessionSnapshot, conversation: answerConversation, pendingDecisionPackageId: null },
    }))
    expect(analyzedAnswer.repairCalls).toBe(1)
    expect(analyzedAnswer.pendingQuestionTransition).toMatchObject({ questionId: desiredQuestion.id, outcome: 'answered' })
    expect(analyzedAnswer.assistantMessage).toBeNull()
    expect(analyzedAnswer.sessionSnapshot.conversation.some((message: any) => String(message.content || '').includes('Zapisuję wymaganie'))).toBe(false)
    const repairCall = runLlmTaskMock.mock.calls.find((call: any[]) => call[0].task === 'engine2-turn-v3-structural-repair')
    expect(repairCall?.[0].task).toBe('engine2-turn-v3-structural-repair')
    expect(JSON.parse(repairCall?.[0].input).repair.errors).toContain('substantive_information answering a question requires staged close(answered) for the effective reply question')

    const secondReadiness = incompleteReadiness()
    secondReadiness.questionCandidates = [
      { clientRef: 'usage_context_next', semanticKey: 'usage_context_next', question: 'Czy przy precyzyjnych naprawach regulacja stożka ma być zmieniana jedną ręką, gdy druga trzyma naprawiany element?', intent: 'Ustalić ograniczenie obsługi.', presentation: 'panel', reason: 'Następny brak.', groundedInFindingIds: [analyzedAnswer.findingProposals[0].id], targetType: 'usage_example', targetContradictionId: null },
      { clientRef: 'constraints_next', semanticKey: 'constraints_next', question: 'Jeśli lampa ma być mała, czy może mieć cięższą podstawę dla stabilności?', intent: 'Sprawdzić granicę stabilności.', presentation: 'panel', reason: 'Wpływa na projekt.', groundedInFindingIds: [analyzedAnswer.findingProposals[0].id], targetType: 'boundary', targetContradictionId: null },
      { clientRef: 'power_next', semanticKey: 'power_next', question: 'Czy akumulator ma dawać godzinę pracy przy pełnej jasności, czy tryb akumulatorowy może być słabszy?', intent: 'Ustalić kompromis zasilania.', presentation: 'panel', reason: 'Wpływa na konstrukcję.', groundedInFindingIds: [analyzedAnswer.findingProposals[0].id], targetType: 'priority', targetContradictionId: null },
    ]
    secondReadiness.contradictionChanges = [{
      operation: 'update',
      contradictionId: null,
      semanticKey: 'computer_work_vs_repairs_light',
      description: 'Potrzebujesz regulacji między ogólnym i skupionym światłem.',
      sideA: 'Szerokie ogólne światło.',
      sideB: 'Punktowe światło do precyzyjnych prac.',
      sourceFindingIds: [first.findingProposals[0].id, analyzedAnswer.findingProposals[0].id],
      sourceMessageIds: [firstMessageId, answerId],
      status: 'confirmed',
      reportBlocking: true,
      verificationQuestionId: desiredQuestion.id,
      resolutionFindingIds: [],
    }]
    secondReadiness.components[0].evidenceFindingIds = [first.findingProposals[0].id]
    const secondQuestionGeneration = groundQuestions(incompleteReadiness(), analyzedAnswer.findingProposals[0].id)
    queue(panelQuestionsOnly(secondQuestionGeneration))
    const { generated: accepted } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-lamp-answer', language: 'pl',
      history: analyzedAnswer.sessionSnapshot.conversation, findings: analyzedAnswer.sessionSnapshot.findings,
      decisions: analyzedAnswer.findingProposals.map((finding: any) => ({ findingId: finding.id, type: 'confirm' })),
      rejectedFingerprints: [], sessionSnapshot: { ...analyzedAnswer.sessionSnapshot, pendingDecisionPackageId: analyzedAnswer.packageId },
      trialCounters: analyzedAnswer.trialCounters,
    })
    const answeredQuestion = accepted.questions.find((question: any) => question.id === desiredQuestion.id)
    const confirmedFinding = accepted.findingUpdates.find((finding: any) => finding.semanticKey === 'desired_beam_control' && finding.status === 'confirmed')
    expect(answeredQuestion).toMatchObject({ status: 'answered', presentation: 'hidden' })
    expect(answeredQuestion.answeredByMessageIds).toContain(answerId)
    expect(answeredQuestion.coveredByFindingIds).toContain(confirmedFinding.id)
    expect(accepted.activeQuestionId).not.toBe(desiredQuestion.id)
    expect(accepted.openQuestions.every((question: any) => question.id !== desiredQuestion.id && question.semanticKey !== 'desired_outcome')).toBe(true)
    expect(accepted.sessionSnapshot.questions.every((question: any) => question.presentation !== 'panel' || question.id !== desiredQuestion.id)).toBe(true)
    expect(accepted.sessionSnapshot.conversation.filter((message: any) => message.questionId === desiredQuestion.id)).toHaveLength(0)
    expect(accepted.openQuestions).toHaveLength(3)
    expect(accepted.openQuestions.every((question: any) => question.presentation === 'panel')).toBe(true)
    expect(accepted.nextQuestionId).toBeNull()
    expect(accepted.sessionSnapshot.contradictions.some((entry: any) => entry.semanticKey === 'lamp_light_distribution_modes')).toBe(false)
    expect(accepted.activeContradictionCount ?? 0).toBe(0)
    expect(accepted.softTensionSignalsCount).toBeGreaterThan(0)
    expect(accepted.materialReadiness.materialScore).toBe(0)
    expect(accepted.reportReadiness.reportScore).toBe(0)
  })

  it('does not close the staged question when its only finding is rejected', async () => {
    const trialId = `reject-${Date.now()}`
    const messageId = 'u-answer-reject'
    const baseFinding = { id: 'f-confirmed', semanticKey: 'lamp_project', content: 'Chcesz zaprojektować lampę na biurko.', text: 'Chcesz zaprojektować lampę na biurko.', status: 'confirmed', subject: 'product', perspective: 'desired' }
    queue(plan({
      turnKind: 'substantive_information', assistantReply: null,
      findingChanges: [{ operation: 'add', clientRef: 'f1', semanticKey: 'light_control', text: 'Lampa ma regulację.', subject: 'product', perspective: 'desired' }],
      questionTransition: { type: 'close', questionId: q2.id, outcome: 'answered', reason: 'Odpowiedź.', sourceMessageId: messageId, evidenceFindingRefs: ['f1'] },
    }))
    const analyzed = await call(analyzeBody({ trialId, messageId, content: 'Tak.', findings: [baseFinding], replyToGapId: q2.id }))
    const proposal = analyzed.findingProposals[0]
    const readiness = groundQuestions(incompleteReadiness(), baseFinding.id)
    queue(panelQuestionsOnly(readiness))
    const { generated: continued } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-reject', language: 'pl',
      history: analyzed.sessionSnapshot.conversation, findings: analyzed.sessionSnapshot.findings,
      decisions: [{ findingId: proposal.id, type: 'reject' }], rejectedFingerprints: [],
      sessionSnapshot: { ...analyzed.sessionSnapshot, pendingDecisionPackageId: analyzed.packageId },
      trialCounters: analyzed.trialCounters,
    })
    expect(continued.questions.find((question: any) => question.id === q2.id)).toMatchObject({ status: 'open' })
    expect(continued.nextQuestionId).toBeNull()
    expect(continued.openQuestions).toHaveLength(3)
  })

  it('closes the staged question when the proposal is changed before confirmation', async () => {
    const trialId = `change-${Date.now()}`
    const messageId = 'u-answer-change'
    queue(plan({
      turnKind: 'substantive_information',
      assistantReply: { type: 'acknowledgement', text: 'Zapisuję odpowiedź do poprawienia.' },
      findingChanges: [{ operation: 'add', clientRef: 'f-change', semanticKey: 'light_control_change', text: 'Lampa ma sterowanie światłem.', subject: 'product', perspective: 'desired' }],
      questionTransition: { type: 'close', questionId: q2.id, outcome: 'answered', reason: 'Odpowiedź.', sourceMessageId: messageId, evidenceFindingRefs: ['f-change'] },
    }))
    const analyzed = await call(analyzeBody({ trialId, messageId, content: 'Tak, ale chodzi o precyzyjne sterowanie.', replyToGapId: q2.id }))
    const proposal = analyzed.findingProposals[0]
    const readiness = groundQuestions(incompleteReadiness(), proposal.id)
    readiness.components[0].evidenceFindingIds = [proposal.id]
    queue(panelQuestionsOnly(readiness))
    const { generated: continued } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-change', language: 'pl',
      history: analyzed.sessionSnapshot.conversation,
      findings: analyzed.sessionSnapshot.findings,
      decisions: [{ findingId: proposal.id, type: 'edit', content: 'Lampa ma umożliwiać precyzyjne sterowanie kierunkiem i średnicą stożka światła.' }],
      rejectedFingerprints: [],
      sessionSnapshot: { ...analyzed.sessionSnapshot, pendingDecisionPackageId: analyzed.packageId },
      trialCounters: analyzed.trialCounters,
    })
    const changedFinding = continued.findingUpdates.find((finding: any) => finding.id === proposal.id)
    expect(changedFinding).toMatchObject({
      status: 'confirmed',
      source: 'user_edit',
      content: 'Lampa ma umożliwiać precyzyjne sterowanie kierunkiem i średnicą stożka światła.',
    })
    expect(continued.questions.find((question: any) => question.id === q2.id)).toMatchObject({
      status: 'answered',
      presentation: 'hidden',
      answeredByMessageIds: [messageId],
      coveredByFindingIds: [proposal.id],
    })
    expect(continued.activeQuestionId).not.toBe(q2.id)
  })

  it('detects contradictions only through the LLM detect_contradictions action', async () => {
    const trialId = `contradiction-contract-${Date.now()}`
    const findings = readinessKeys.map((key, index) => ({
      id: `contract-f${index}`,
      semanticKey: key,
      content: index === 0
        ? 'Lampa ma być możliwie mała.'
        : index === 1
          ? 'Lampa musi być stabilna podczas pracy.'
          : key,
      text: key,
      status: 'confirmed',
      sourceMessageIds: [`u-contract-${index}`],
    }))
    const firstReadiness = completeReadiness(findings.map((finding) => finding.id))
    firstReadiness.questionCandidates = [
      {
        clientRef: 'small_size_vs_stability_probe',
        semanticKey: 'small_size_vs_stability_probe',
        question: 'Jeśli lampa ma być mała, czy może mieć cięższą podstawę, żeby pozostała stabilna?',
        intent: 'Sprawdzić napięcie między małym rozmiarem i stabilnością.',
        presentation: 'panel',
        reason: 'Wysokowpływowa potencencjalna sprzeczność.',
        groundedInFindingIds: [findings[0].id, findings[1].id],
        targetType: 'contradiction_probe',
        targetContradictionId: 'small_size_vs_stability',
      },
      {
        clientRef: 'desk_space_boundary',
        semanticKey: 'desk_space_boundary',
        question: 'Czy na biurku ważniejsze jest bardzo małe miejsce zajmowane przez lampę, czy stabilność podczas pracy?',
        intent: 'Ustalić priorytet miejsca i stabilności.',
        presentation: 'panel',
        reason: 'Pomaga rozstrzygnąć wariant podstawy.',
        groundedInFindingIds: [findings[0].id, findings[1].id],
        targetType: 'priority',
        targetContradictionId: 'small_size_vs_stability',
      },
      {
        clientRef: 'stability_usage_example',
        semanticKey: 'stability_usage_example',
        question: 'Czy podczas pracy będziesz dotykać lub przesuwać lampę na tyle często, że chwianie podstawy byłoby problemem?',
        intent: 'Ustalić scenariusz obciążający stabilność.',
        presentation: 'panel',
        reason: 'Konkretyzuje ryzyko niestabilności.',
        groundedInFindingIds: [findings[1].id],
        targetType: 'usage_example',
        targetContradictionId: 'small_size_vs_stability',
      },
    ]
    queue(panelQuestionsOnly(firstReadiness))
    const first = await call({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-contradiction-create', language: 'pl',
      history: findings.map((finding, index) => ({ id: `u-contract-${index}`, role: 'user', content: finding.content })),
      findings, decisions: [], rejectedFingerprints: [],
      sessionSnapshot: { schemaVersion: 'engine2.session.v5', conversation: findings.map((finding, index) => ({ id: `u-contract-${index}`, role: 'user', content: finding.content })), findings, contradictions: [], questions: [], questionEvents: [], activeQuestionId: null, pendingDecisionPackageId: null, pendingQuestionTransition: null },
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u-contract-0'], providerCalls: 0 },
    })
    expect(first.openQuestions).toHaveLength(3)
    expect(first.sessionSnapshot.contradictions).toEqual([])

    queue({
      schemaVersion: 'engine2.contradiction_detection.v1',
      contradictionChanges: [{
        operation: 'create',
        contradictionId: null,
        semanticKey: 'small_size_vs_stability',
        description: 'Mały rozmiar lampy i wymagana stabilność mogą tworzyć napięcie konstrukcyjne.',
        sideA: 'Mała lampa zajmuje mniej miejsca na biurku.',
        sideB: 'Stabilność podczas pracy wymaga pewnego podparcia.',
        sourceFindingIds: [findings[0].id, findings[1].id],
        sourceMessageIds: ['u-contract-0', 'u-contract-1'],
        status: 'suspected',
        reportBlocking: true,
        verificationQuestionId: null,
        resolutionFindingIds: [],
      }],
    })
    const detected = await call({
      version: 1, action: 'detect_contradictions', trialId, turnId: 'detect-small-stability', language: 'pl',
      history: first.sessionSnapshot.conversation,
      findings: first.sessionSnapshot.findings,
      decisions: [],
      rejectedFingerprints: [],
      sessionSnapshot: first.sessionSnapshot,
      trialCounters: first.trialCounters,
    }, { 'x-engine2-debug': '1' })
    const suspected = detected.sessionSnapshot.contradictions.find((entry: any) => entry.semanticKey === 'small_size_vs_stability')
    expect(suspected).toMatchObject({ status: 'suspected' })
    expect(detected.openQuestions).toHaveLength(3)
    expect(detected.responseOrigin).toBe('contradiction_detector')
    expect(detected.contradictionExtractionStatus).toBe('evaluated')
    expect(detected.extractedContradictionCount).toBe(1)
    expect(detected.engine2Trace.action).toBe('detect_contradictions')
    expect(detected.engine2Trace.contradictionDetectionCompleted).toBe(true)
    expect(runLlmTaskMock).toHaveBeenCalledTimes(2)
  })

  it('does not present detector failure as a certain zero when soft tensions are visible', async () => {
    const trialId = `contradiction-failed-soft-${Date.now()}`
    const finding = {
      id: 'f-soft-stability',
      semanticKey: 'lamp_soft_stability',
      content: 'Z jednej strony chcę dużo ustawień dla różnych sytuacji, z drugiej nie chcę komplikować codziennej obsługi.',
      status: 'confirmed',
      sourceMessageIds: ['u-soft-stability'],
    }
    const snapshot = {
      schemaVersion: 'engine2.session.v5',
      conversation: [{ id: 'u-soft-stability', role: 'user', content: finding.content }],
      findings: [finding],
      contradictions: [],
      questions: [],
      questionEvents: [],
      activeQuestionId: null,
      pendingDecisionPackageId: null,
      pendingQuestionTransition: null,
    }
    queueFailure('TIMEOUT')
    const payload = await call({
      version: 1,
      action: 'detect_contradictions',
      trialId,
      turnId: 'detect-soft-timeout',
      language: 'pl',
      history: snapshot.conversation,
      findings: [finding],
      decisions: [],
      rejectedFingerprints: [],
      sessionSnapshot: snapshot,
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u-soft-stability'], providerCalls: 0 },
    }, { 'x-engine2-debug': '1' })
    expect(payload.contradictionExtractionStatus).toBe('failed')
    expect(payload.contradictionPipelineStatus).toBe('failed')
    expect(payload.softTensionSignalsCount).toBeGreaterThan(0)
    expect(payload.activeContradictionCount).toBe(0)
    expect(payload.sessionSnapshot.softTensionSignalsCount).toBeGreaterThan(0)
  })

  it('keeps color temperature modes as mode guidance rather than a formal contradiction', async () => {
    const trialId = `color-temperature-tension-${Date.now()}`
    const messageId = 'u-color-temperature'
    queue(plan({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [{
        operation: 'add',
        clientRef: 'color-temperature-modes',
        semanticKey: 'lamp_light_color_temperature_modes',
        text: 'Użytkownik chce ciepłe światło do pracy przy komputerze i zimne do precyzyjnych prac.',
        subject: 'product',
        perspective: 'desired',
      }],
      contradictionChanges: [{
        operation: 'create',
        contradictionId: null,
        semanticKey: 'lamp_light_color_temperature_modes',
        description: 'Potrzebujesz ciepłego światła do pracy przy komputerze i zimnego światła do precyzyjnych prac.',
        sideA: 'Ciepłe światło do pracy przy komputerze.',
        sideB: 'Zimne światło do precyzyjnych prac.',
        sourceFindingIds: ['color-temperature-modes'],
        sourceMessageIds: [messageId],
        sideASourceFindingIds: ['color-temperature-modes'],
        sideBSourceFindingIds: ['color-temperature-modes'],
        sideASourceMessageIds: [messageId],
        sideBSourceMessageIds: [messageId],
        status: 'suspected',
        reportBlocking: true,
        verificationQuestionId: null,
        resolutionFindingIds: [],
        evidenceStatus: 'alternative_or_mode',
        origin: 'user_requirements',
        formalEligible: false,
        rejectionReason: 'requested_modes_are_not_contradiction',
      }],
      questionTransition: {
        type: 'close',
        questionId: q2.id,
        outcome: 'answered',
        reason: 'Odpowiedź dotyczy sposobu działania światła.',
        sourceMessageId: messageId,
        evidenceFindingRefs: ['color-temperature-modes'],
      },
    }))
    const analyzed = await call(analyzeBody({
      trialId,
      messageId,
      content: 'ciepłe do pracy przy komputerze i zimne do precyzyjnych prac',
      replyToGapId: q2.id,
    }), { 'x-engine2-debug': '1' })

    const tension = analyzed.sessionSnapshot.contradictions.find((entry: any) => entry.semanticKey === 'lamp_light_color_temperature_modes')
    expect(tension).toBeUndefined()
    expect(analyzed.activeContradictionCount ?? 0).toBe(0)
    expect(analyzed.extractedContradictionCount ?? 0).toBe(0)

    const proposal = analyzed.findingProposals[0]
    const panelOnly = {
      questionCandidates: [
        { clientRef: 'lamp_light_intensity_more', semanticKey: 'lamp_light_intensity_more', question: 'Czy jasność ma mieć trzy poziomy, czy płynną regulację?', intent: 'Doprecyzować jasność.', presentation: 'panel', reason: 'Dotyczy światła.', groundedInFindingIds: [proposal.id], targetType: 'boundary', targetContradictionId: null },
        { clientRef: 'usage_context_mode', semanticKey: 'usage_context_mode', question: 'Czy precyzyjne prace wykonujesz przy biurku codziennie, czy sporadycznie?', intent: 'Ustalić kontekst użycia.', presentation: 'panel', reason: 'Wpływa na tryby.', groundedInFindingIds: [proposal.id], targetType: 'usage_example', targetContradictionId: null },
        { clientRef: 'constraints_controls', semanticKey: 'constraints_controls', question: 'Czy sterowanie barwą może wymagać osobnego przycisku, czy ma być jednym pokrętłem?', intent: 'Ustalić ograniczenie sterowania.', presentation: 'panel', reason: 'Wpływa na ergonomię.', groundedInFindingIds: [proposal.id], targetType: 'boundary', targetContradictionId: null },
      ],
    }
    queue(panelQuestionsOnly(panelOnly))
    const readiness = groundQuestions(incompleteReadiness(), proposal.id)
    readiness.questionCandidates[0] = {
      ...readiness.questionCandidates[0],
      clientRef: 'color_temperature_modes_probe',
      semanticKey: 'color_temperature_modes_probe',
      question: 'Czy lampa ma mieć dwa tryby barwy światła: ciepły do komputera i zimny do precyzyjnej pracy, czy raczej płynną regulację między nimi?',
      intent: 'Rozstrzygnąć sposób sterowania barwą światła.',
      targetType: 'boundary',
      targetContradictionId: null,
      groundedInFindingIds: [proposal.id],
    }
    queue(readiness)

    const { generated: continued } = await commitThenGenerate({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-color-temperature', language: 'pl',
      history: analyzed.sessionSnapshot.conversation,
      findings: analyzed.sessionSnapshot.findings,
      decisions: [{ findingId: proposal.id, type: 'confirm' }],
      rejectedFingerprints: [],
      sessionSnapshot: { ...analyzed.sessionSnapshot, pendingDecisionPackageId: analyzed.packageId },
      trialCounters: analyzed.trialCounters,
    }, { 'x-engine2-debug': '1' })

    expect(continued.panelQuestions[0]).toMatchObject({
      targetContradictionId: null,
      targetType: 'boundary',
    })
    expect(continued.panelQuestions[0].question).toMatch(/ciepły|zimny|barwy|płynną regulację/i)
    expect(continued.openQuestions[0].targetType).toBe('boundary')
    expect(continued.openQuestions[0].targetContradictionId).toBeNull()
  })

  it('keeps a local portability/stability match as soft diagnostic without incrementing saved contradiction counters', async () => {
    const trialId = `portability-stability-${Date.now()}`
    const messageId = 'u-portability-stability'
    const content = 'ma stać na biurku, z możliwością przeniesienia więc powinna być relatywnie lekka, ale powinna być również bardzo stabilna i nie przewracać się'
    queue(plan({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [{
        operation: 'add',
        clientRef: 'portability-stability',
        semanticKey: 'lamp_portability_and_stability',
        text: 'Lampa ma stać na biurku i dać się przenosić, więc powinna być relatywnie lekka, ale też bardzo stabilna i odporna na przewracanie.',
        subject: 'product',
        perspective: 'desired',
      }],
      questionTransition: {
        type: 'close',
        questionId: q2.id,
        outcome: 'answered',
        reason: 'Odpowiedź opisuje wymagania konstrukcyjne.',
        sourceMessageId: messageId,
        evidenceFindingRefs: ['portability-stability'],
      },
    }))

    const analyzed = await call(analyzeBody({ trialId, messageId, content, replyToGapId: q2.id }), { 'x-engine2-debug': '1' })
    const tension = analyzed.sessionSnapshot.contradictions.find((entry: any) => entry.semanticKey === 'lamp_portability_vs_stability')

    expect(analyzed.findingProposals).toHaveLength(1)
    expect(tension).toBeUndefined()
    expect(analyzed.sessionSnapshot.contradictions).toHaveLength(0)
    expect(analyzed.contradictionExtractionStatus).toBe('not_evaluated')
    expect(analyzed.activeContradictionCount ?? 0).toBe(0)
    expect(analyzed.engine2Trace.contradictionDiagnostics.activeContradictionCount ?? 0).toBe(0)
    expect(analyzed.softTensionSignalsCount).toBeGreaterThan(0)
  })

  it('keeps a local simple-interface/many-options match out of saved contradiction counters', async () => {
    const trialId = `simple-options-${Date.now()}`
    const messageId = 'u-simple-options'
    queue(plan({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [{
        operation: 'add',
        clientRef: 'simple-many-options',
        semanticKey: 'lamp_simple_interface_many_options',
        text: 'Lampa ma mieć prosty interface z dużą ilością opcji.',
        subject: 'product',
        perspective: 'desired',
      }],
      questionTransition: null,
    }))

    const analyzed = await call(analyzeBody({
      trialId,
      messageId,
      content: 'prosty interface z dużą ilością opcji',
      questions: [],
      activeQuestionId: null,
      replyToGapId: null,
      conversation: [{ id: messageId, role: 'user', content: 'prosty interface z dużą ilością opcji' }],
    }), { 'x-engine2-debug': '1' })
    const tension = analyzed.sessionSnapshot.contradictions.find((entry: any) => entry.semanticKey === 'lamp_simple_interface_vs_many_options')

    expect(tension).toBeUndefined()
    expect(analyzed.contradictionExtractionStatus).toBe('not_evaluated')
    expect(analyzed.activeContradictionCount ?? 0).toBe(0)
    expect(analyzed.extractedContradictionCount ?? 0).toBe(0)
    expect(analyzed.softTensionSignalsCount).toBeGreaterThan(0)
  })

  it('creates a correction proposal and leaves the confirmed finding unchanged before decisions', async () => {
    const finding = { id: 'f-mount', semanticKey: 'mount', content: 'Mocowanie na klips.', text: 'Mocowanie na klips.', status: 'confirmed', subject: 'elements', perspective: 'desired' }
    const messageId = 'u-correction'
    queue(plan({
      turnKind: 'correction', assistantReply: { type: 'acknowledgement', text: 'Zapisuję korektę.' },
      findingChanges: [{ operation: 'revise', findingId: finding.id, text: 'Mocowanie na podstawie.', subject: 'elements', perspective: 'desired' }],
    }))
    const payload = await call(analyzeBody({ trialId: `correction-${Date.now()}`, messageId, content: 'Nie klips, tylko podstawa.', findings: [finding] }))
    expect(payload.turnKind).toBe('correction')
    expect(payload.findingProposals).toHaveLength(1)
    expect(payload.findingUpdates.find((entry: any) => entry.id === finding.id)).toMatchObject({ content: finding.content, status: 'confirmed' })
  })

  it('returns a retryable error for an invalid question ID without losing the message or active question', async () => {
    const messageId = 'u-invalid-id'
    const invalid = plan({
      turnKind: 'navigation', assistantReply: { type: 'conversational_response', text: 'Pomijam.' },
      questionTransition: { type: 'close', questionId: 'missing', outcome: 'skipped', reason: 'Pominięcie.', sourceMessageId: messageId, evidenceFindingRefs: [] },
    })
    queue(invalid); queue(invalid)
    const payload = await call(analyzeBody({ trialId: `invalid-${Date.now()}`, messageId, content: 'Pomińmy to.' }))
    expect(payload).toMatchObject({ turnApplied: false, analysisStatus: 'retryable_error', retryable: true, activeQuestionId: null })
    expect(payload.sessionSnapshot.conversation.some((message: any) => message.id === messageId)).toBe(true)
    expect(payload.questions.find((question: any) => question.id === q2.id)).toMatchObject({ status: 'open' })
  })

  it('replays the same analyzed message idempotently without another provider call or transcript copy', async () => {
    const messageId = 'u-idempotent'
    const request = analyzeBody({ trialId: `idempotent-${Date.now()}`, messageId, content: 'Dziękuję, na razie tyle.' })
    queue(plan({ assistantReply: { type: 'conversational_response', text: 'W porządku.' } }))
    const first = await call(request)
    const second = await call(request)
    expect(first).toMatchObject({ turnApplied: false, responseOrigin: 'dead_end_invariant', diagnosticCode: 'DEAD_END_NO_NEXT_ACTION' })
    expect(second).toMatchObject({ turnApplied: false, responseOrigin: 'idempotency_replay' })
    expect(runLlmTaskMock).toHaveBeenCalledTimes(1)
    expect(second.sessionSnapshot.conversation.filter((message: any) => message.id === messageId)).toHaveLength(1)
  })

  it('lets only backend readiness expose a short complete report and never calls the turn planner', async () => {
    const trialId = `ready-${Date.now()}`
    const findings = readinessKeys.map((key, index) => ({ id: `ready-f${index}`, semanticKey: key, content: key, text: key, status: 'confirmed' }))
    const readyEvaluation = completeReadiness(findings.map((finding) => finding.id))
    const readyQuestionGeneration = groundQuestions(incompleteReadiness(), findings[0].id)
    readyQuestionGeneration.questionCandidates = readyQuestionGeneration.questionCandidates.map((question: any) => ({
      ...question,
      semanticKey: `ready_probe_${question.semanticKey}`,
      clientRef: `ready_probe_${question.clientRef}`,
    }))
    queue(panelQuestionsOnly(readyQuestionGeneration))
    const panel = await call({
      version: 1, action: 'generate_panel_questions', trialId, turnId: 'continue-ready', language: 'pl',
      history: [{ id: 'u1', role: 'user', content: 'Kompletny opis.' }], findings, decisions: [], rejectedFingerprints: [],
      sessionSnapshot: { schemaVersion: 'engine2.session.v5', conversation: [{ id: 'u1', role: 'user', content: 'Kompletny opis.' }], findings, contradictions: [], questions: [], questionEvents: [], activeQuestionId: null, pendingDecisionPackageId: null, pendingQuestionTransition: null },
      trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u1'], providerCalls: 0 },
    })
    expect(panel).toMatchObject({ turnApplied: true, conversationStatus: 'continue', reportAvailable: false, nextQuestionId: null })
    expect(panel.panelQuestions).toHaveLength(3)

    queue(readyEvaluation)
    const payload = await call({
      version: 1, action: 'evaluate_readiness', trialId, turnId: 'evaluate-ready', language: 'pl',
      history: panel.sessionSnapshot.conversation, findings: panel.sessionSnapshot.findings, decisions: [], rejectedFingerprints: [],
      sessionSnapshot: panel.sessionSnapshot,
      trialCounters: panel.trialCounters,
    })
    expect(payload).toMatchObject({ turnApplied: true, conversationStatus: 'report_ready', reportAvailable: true, finalScore: 100, nextQuestionId: null })
    expect(runLlmTaskMock).toHaveBeenCalledTimes(2)
    expect(runLlmTaskMock.mock.calls[0][0].task).toBe('engine2-panel-questions')
    expect(runLlmTaskMock.mock.calls[1][0].task).toBe('engine2-readiness-v2')
  })
})
