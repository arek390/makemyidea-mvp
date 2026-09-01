import { describe, expect, it, vi } from 'vitest'
import { buildKnowledgeSummary } from '../../src/engine2/conversationGuide.js'
import { createEngine2FindingState, engine2FindingReducer, type Engine2Finding } from '../../src/engine2/findingState.js'
import { resolveEngine2ContinueGate } from '../../src/engine2/packageState.js'
import {
  captureEngine2DomSnapshot,
  clearEngine2Diagnostics,
  createFrontendTraceFromApi,
  updateFrontendTraceState,
  writeEngine2Diagnostics,
} from '../../src/engine2/diagnostics.js'
import {
  resolveEngine2ResponseDecision,
  resolveEngine2ResponseFindingState,
  resolveEngine2ResponseQuestionState,
  resolveEngine2ActiveQuestionPresentation,
  resolveEngine2RenderableAssistantMessage,
  resolveEngine2PanelQuestionDisplayState,
} from '../../src/engine2/responseState.js'
import { createEmptyState } from '../../src/engine2/sessionState.js'

const proposal = (id: string): Engine2Finding => ({
  id,
  category: 'constraint',
  categoryLabel: 'Proponowane ograniczenie',
  content: `Propozycja ${id}`,
  status: 'pending',
  source: 'ai_interpretation',
  fingerprint: `fp-${id}`,
  packageId: 'package-1',
  internal: {
    matrixRow: 'product',
    matrixCol: 'not_working',
    matrixCell: 'B2',
    confidence: 0.9,
  },
})

describe('engine2 response state', () => {
  it('pending_notice_clears_immediately_after_decision_click', () => {
    const questions = [
      { id: 'q1', question: 'Czy lampa ma świecić szeroko czy punktowo?' },
      { id: 'q2', question: 'Czy podstawa może być cięższa dla stabilności?' },
      { id: 'q3', question: 'Czy akumulator może świecić słabiej przy pełnej pracy?' },
    ]
    expect(resolveEngine2PanelQuestionDisplayState({
      hasPendingFindings: true,
      decisionGateActive: true,
      loading: false,
      continuing: false,
      retrying: false,
      openQuestions: [],
      guideNotice: null,
    })).toBe('pending_notice')

    expect(resolveEngine2PanelQuestionDisplayState({
      hasPendingFindings: false,
      decisionGateActive: true,
      loading: false,
      continuing: false,
      retrying: false,
      openQuestions: [],
      guideNotice: null,
    })).toBe('loading')

    expect(resolveEngine2PanelQuestionDisplayState({
      hasPendingFindings: false,
      decisionGateActive: false,
      loading: false,
      continuing: false,
      retrying: false,
      openQuestions: questions,
      guideNotice: null,
    })).toBe('questions')
  })

  it('renders prose independently and never renders panel questions as active chat prompts', () => {
    const q2 = {
      id: 'q2', question: 'Jakie ograniczenia należy uwzględnić?',
      status: 'open' as const, presentation: 'panel' as const,
    }
    expect(resolveEngine2RenderableAssistantMessage({
      assistantMessage: { content: 'Czy potrzebujesz również regulacji natężenia światła?', questionId: null },
      nextQuestionId: null, openQuestions: [],
    })).toMatchObject({ questionId: null })
    expect(resolveEngine2RenderableAssistantMessage({
      assistantMessage: { content: q2.question, questionId: q2.id },
      nextQuestionId: q2.id, openQuestions: [q2],
      pendingDecisionPackageId: 'package-1',
    })).toBeNull()
    expect(resolveEngine2ActiveQuestionPresentation({
      activeQuestionPresentation: { questionId: q2.id, text: q2.question },
      nextQuestionId: q2.id, openQuestions: [q2], pendingDecisionPackageId: null,
    })).toBeNull()
    expect(resolveEngine2ActiveQuestionPresentation({
      activeQuestionPresentation: { questionId: q2.id, text: q2.question },
      nextQuestionId: q2.id, openQuestions: [q2], pendingDecisionPackageId: 'package-1',
    })).toBeNull()
  })

  it('does not read panel questions as active chat questions', () => {
    const node = (attributes: Record<string, string>, innerText: string) => ({
      innerText,
      getAttribute: (name: string) => attributes[name] || null,
    })
    const q3 = node({ 'data-engine2-open-question-id': 'q3' }, 'Jakie ograniczenia uwzględnić?')
    const replyTarget = node({ 'data-engine2-reply-target-id': 'q5' }, 'Odpowiedź na q5')
    const root = {
      querySelectorAll: (selector: string) => selector === '[data-engine2-open-question-id]' ? [q3] : [],
      querySelector: (selector: string) => selector === '[data-engine2-reply-target-id]' ? replyTarget : null,
    }

    expect(captureEngine2DomSnapshot(root as unknown as ParentNode).activeQuestionId).toBeNull()
  })

  it('ignores stale API responses even when diagnostics are disabled', () => {
    expect(resolveEngine2ResponseDecision({
      stateVersionReturned: 6,
      latestAppliedResponseVersion: 7,
    })).toBe('ignored_as_stale')
    expect(resolveEngine2ResponseDecision({
      stateVersionReturned: 7,
      latestAppliedResponseVersion: 7,
    })).toBe('applied')
    expect(resolveEngine2ResponseDecision({
      stateVersionReturned: 8,
      latestAppliedResponseVersion: 7,
      requestSequence: 1,
      latestAppliedRequestSequence: 2,
    })).toBe('ignored_as_stale')
  })

  it('keeps analyze_message proposals instead of clearing them with empty findingUpdates', () => {
    const payload = {
      action: 'analyze_message' as const,
      findingProposals: [proposal('1'), proposal('2'), proposal('3')],
      findingUpdates: [],
    }

    const update = resolveEngine2ResponseFindingState(payload)

    expect(update.proposals).toHaveLength(3)
    expect(update.shouldReplaceAllFindings).toBe(true)

    const withProposals = engine2FindingReducer(createEngine2FindingState(), {
      type: 'addProposedBatch',
      findings: update.proposals,
    })

    expect(withProposals.findings).toHaveLength(3)
    expect(withProposals.findings.every((finding) => finding.status === 'pending')).toBe(true)

    const gateAfterAnalyze = resolveEngine2ContinueGate({
      findings: withProposals.findings,
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: 3,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gateAfterAnalyze.allowed).toBe(false)
    expect(gateAfterAnalyze.reason).toBe('PACKAGE_STILL_PENDING')

    const afterTwoDecisions = {
      ...withProposals,
      findings: withProposals.findings.map((finding) =>
        finding.id === '1' || finding.id === '2'
          ? { ...finding, status: 'confirmed' as const, decisionSource: 'user_accept' as const, decisionAt: '2026-08-22T15:00:00.000Z' }
          : finding
      ),
    }

    const gateAfterTwoDecisions = resolveEngine2ContinueGate({
      findings: afterTwoDecisions.findings,
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: 3,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gateAfterTwoDecisions.allowed).toBe(false)
    expect(gateAfterTwoDecisions.stats.packageResolvedCount).toBe(2)
    expect(gateAfterTwoDecisions.reason).toBe('PACKAGE_STILL_PENDING')

    const afterAllDecisions = {
      ...afterTwoDecisions,
      findings: afterTwoDecisions.findings.map((finding) =>
        finding.id === '3'
          ? { ...finding, status: 'confirmed' as const, decisionSource: 'user_accept' as const, decisionAt: '2026-08-22T15:00:01.000Z' }
          : finding
      ),
    }
    const gateAfterAllDecisions = resolveEngine2ContinueGate({
      findings: afterAllDecisions.findings,
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: 3,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gateAfterAllDecisions.allowed).toBe(true)
    expect(gateAfterAllDecisions.reason).toBe('READY')
    expect(buildKnowledgeSummary(afterAllDecisions.findings, 10).map((entry) => entry.text).sort()).toEqual([
      'Propozycja 1',
      'Propozycja 2',
      'Propozycja 3',
    ])
  })

  it('replaces findings only for generate_panel_questions responses', () => {
    const update = resolveEngine2ResponseFindingState({
      action: 'generate_panel_questions',
      findingProposals: [],
      findingUpdates: [
        {
          ...proposal('1'),
          status: 'confirmed',
          content: 'Potwierdzone ustalenie',
        },
      ],
    })

    expect(update.shouldReplaceAllFindings).toBe(true)
    expect(update.findingUpdates).toHaveLength(1)
  })

  it('records API question application and rendered state in chronological diagnostics', () => {
    const nextQuestion = {
      id: 'gap-next',
      question: 'Czy lampa ma stać na biurku, czy być przypięta do blatu?',
    }
    const payload = {
      action: 'analyze_message' as const,
      requestId: 'request-lamp-both',
      turnId: 'turn-lamp-both',
      stateVersionReturned: 7,
      assistantMessage: { content: nextQuestion.question },
      openQuestions: [nextQuestion],
      nextQuestionId: nextQuestion.id,
      findingProposals: [],
    }
    const questionState = resolveEngine2ResponseQuestionState({
      currentOpenQuestions: [],
      currentActiveQuestionId: null,
      payload,
    })
    const sessionState = {
      ...createEmptyState('pl'),
      messages: [{ id: 'assistant-next', role: 'assistant' as const, content: nextQuestion.question }],
      openQuestions: questionState.openQuestions,
      activeQuestionId: questionState.activeQuestionId,
    }
    const trace = createFrontendTraceFromApi({
      payload,
      backendTrace: {
        traceId: 'trace-lamp-both',
        requestId: payload.requestId,
        turnId: payload.turnId,
        stateVersionSent: 7,
        stages: [],
      },
      isDryRun: false,
    })
    const applied = updateFrontendTraceState({
      trace,
      findings: [],
      pendingFindings: [],
      pendingPackageId: null,
      pendingPackageExpectedCount: 0,
      pendingPackageProposalCount: 0,
      pendingPackageDecisionCount: 0,
      continueGateReason: 'NO_PACKAGE',
      knowledge: [],
      openQuestions: questionState.openQuestions,
      sessionState,
      domSnapshot: {
        traceId: 'trace-lamp-both',
        chatText: nextQuestion.question,
        activeQuestionId: nextQuestion.id,
        openQuestions: [{ id: nextQuestion.id, text: nextQuestion.question }],
      },
      applySnapshot: {
        stateVersionBeforeApply: 8,
        responseDecision: 'applied',
        gapsBeforeApply: [],
        nextQuestionBeforeApply: null,
        activeQuestionBeforeApply: null,
        stateApplyMode: 'replaced',
        replyTargetGapId: 'gap-light-positioning',
      },
    })

    expect(applied.frontend.responseDecision).toBe('applied')
    expect(applied.frontend.replyTargetCleared).toBe(true)
    expect(applied.frontend.nextQuestionAfterApply).toBe(nextQuestion.question)
    expect(applied.frontend.alarms).toEqual([])
    expect(applied.stages.map((stage) => stage.name)).toEqual(['CLIENT STATE', 'RENDERED DOM'])
    expect(applied.stages[1].data.renderedQuestion).toBe(nextQuestion.question)
    expect(applied.frontend.renderedChatText).toBe(nextQuestion.question)
  })

  it('never promotes the first returned question when nextQuestionId is absent or null', () => {
    const current = [{ id: 'old', question: 'Stare pytanie?' }]
    const returned = [{ id: 'panel-only', question: 'Pytanie tylko w panelu?' }]

    expect(resolveEngine2ResponseQuestionState({
      currentOpenQuestions: current,
      currentActiveQuestionId: 'old',
      payload: { action: 'analyze_message', openQuestions: returned, nextQuestionId: null },
    }).activeQuestionId).toBeNull()

    expect(resolveEngine2ResponseQuestionState({
      currentOpenQuestions: current,
      currentActiveQuestionId: 'old',
      payload: { action: 'analyze_message', openQuestions: returned },
    }).activeQuestionId).toBeNull()
  })

  it('prefers panelQuestions for panel refreshes and diagnostics render displayText', () => {
    const panelQuestions = [
      { id: 'panel-1', question: 'Czy ważniejsza jest mała podstawa, czy stabilność lampy?' },
      { id: 'panel-2', question: 'Czy lampa ma świecić szeroko do pracy, czy punktowo do napraw?' },
      { id: 'panel-3', question: 'Czy akumulator ma działać godzinę przy pełnej jasności?' },
    ]
    const questionState = resolveEngine2ResponseQuestionState({
      currentOpenQuestions: [{ id: 'old', question: 'Stare pytanie?' }],
      currentActiveQuestionId: 'old',
      payload: {
        action: 'generate_panel_questions',
        openQuestions: [],
        panelQuestions,
        nextQuestionId: null,
      },
    })
    expect(questionState.openQuestions).toEqual(panelQuestions)
    expect(questionState.activeQuestionId).toBeNull()

    const finding = {
      ...proposal('direct-display'),
      content: 'Użytkownik chce zaprojektować nową lampę.',
      displayText: 'Chcesz zaprojektować nową lampę.',
    }
    const trace = createFrontendTraceFromApi({
      payload: {
        action: 'analyze_message',
        requestId: 'request-display',
        turnId: 'turn-display',
        stateVersionReturned: 1,
        findingProposals: [finding],
      },
      backendTrace: null,
      isDryRun: false,
    })
    const applied = updateFrontendTraceState({
      trace,
      findings: [finding],
      pendingFindings: [finding],
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: 1,
      pendingPackageProposalCount: 1,
      pendingPackageDecisionCount: 0,
      continueGateReason: 'PACKAGE_STILL_PENDING',
      knowledge: [],
      openQuestions: [],
      sessionState: createEmptyState('pl'),
      domSnapshot: { traceId: null, chatText: null, activeQuestionId: null, openQuestions: [] },
      applySnapshot: null,
    })

    expect(applied.frontend.renderedPendingFindings).toEqual(['Chcesz zaprojektować nową lampę.'])
    expect(applied.stages[1].data.renderedPendingFindings).toEqual(['Chcesz zaprojektować nową lampę.'])
  })

  it('adds next-action and contradiction counters to diagnostics', () => {
    const pending = proposal('pending-diagnostic')
    const payload = {
      action: 'analyze_message',
      requestId: 'request-diagnostics',
      turnId: 'turn-diagnostics',
      stateVersionReturned: 4,
      pendingDecisionPackageId: 'package-1',
      findingProposals: [pending],
      findingUpdates: [pending],
      findingEvents: [],
      contradictions: [
        {
          id: 'c1',
          semanticKey: 'broad_vs_focused_light',
          status: 'suspected',
          reportBlocking: true,
        },
      ],
      detectedContradictionCandidates: [{ semanticKey: 'broad_vs_focused_light' }],
      questionCandidates: [],
      panelQuestions: [],
      reportAvailable: false,
      trialEnded: false,
      retryable: false,
      readinessDecisionSource: 'not_evaluated_during_user_turn',
    }
    const trace = createFrontendTraceFromApi({
      payload,
      backendTrace: {
        traceId: 'trace-diagnostics',
        action: 'analyze_message',
        requestId: payload.requestId,
        turnId: payload.turnId,
        questionCandidatesRaw: [],
      },
      isDryRun: false,
    })
    const sessionState = {
      ...createEmptyState('pl'),
      findings: [pending],
      contradictions: payload.contradictions as never[],
      pendingDecisionPackageId: 'package-1',
    }
    const applied = updateFrontendTraceState({
      trace,
      findings: [pending],
      pendingFindings: [pending],
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: 1,
      pendingPackageProposalCount: 1,
      pendingPackageDecisionCount: 0,
      continueGateReason: 'PACKAGE_STILL_PENDING',
      knowledge: [],
      openQuestions: [],
      sessionState,
      domSnapshot: { traceId: 'trace-diagnostics', chatText: null, activeQuestionId: null, openQuestions: [] },
    })

    expect(applied.frontend.findingDiagnostics).toMatchObject({
      visiblePendingProposalsCount: 1,
      pendingPackageStatus: 'visible_pending',
    })
    expect(applied.frontend.contradictionDiagnostics).toMatchObject({
      detectedCandidatesCount: 1,
      openContradictionsCount: 1,
      skipReason: 'contradiction_detection_not_evaluated',
      contradictionExtractionStatus: 'not_evaluated',
    })
    expect(applied.frontend.questionDiagnostics).toMatchObject({
      questionGenerationAttempted: false,
      panelQuestionCount: 0,
    })
    expect(applied.frontend.nextActionDiagnosis).toMatchObject({
      expectedNextAction: 'wait_for_user_decision',
      blockingReason: 'visible_pending',
      hasVisiblePendingProposal: true,
    })
    expect(applied.stages[0].data.nextActionDiagnosis).toMatchObject({
      expectedNextAction: 'wait_for_user_decision',
    })
  })

  it('does not throw when oversized diagnostics cannot be written to sessionStorage', () => {
    const originalWindow = globalThis.window
    const stored: Record<string, string> = {
      'engine2-public-trial-v5:pl': JSON.stringify({ preserved: true }),
    }
    const storage = {
      get length() { return Object.keys(stored).length },
      key: (index: number) => Object.keys(stored)[index] || null,
      getItem: (key: string) => stored[key] || null,
      setItem: vi.fn(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') }),
      removeItem: vi.fn((key: string) => { delete stored[key] }),
    }
    vi.stubGlobal('window', {
      sessionStorage: storage,
      localStorage: storage,
      location: { hostname: 'localhost', search: '', pathname: '/engine_2', hash: '' },
    })
    const trace = createFrontendTraceFromApi({
      payload: {
        action: 'generate_panel_questions',
        requestId: 'oversized',
        turnId: 'oversized-turn',
        stateVersionReturned: 1,
        apiResponse: 'x'.repeat(500_000),
        sessionSnapshot: { findings: Array.from({ length: 200 }, (_, index) => ({ id: `f-${index}`, content: 'x'.repeat(2000) })) },
        panelQuestions: [],
      },
      backendTrace: {
        traceId: 'trace-oversized',
        action: 'generate_panel_questions',
        apiResponse: { sessionSnapshot: { huge: 'x'.repeat(500_000) } },
        attempts: [{ rawOutput: 'x'.repeat(500_000) }],
      },
      isDryRun: false,
    })
    const result = writeEngine2Diagnostics(Array.from({ length: 25 }, (_, index) => ({
      ...trace,
      traceId: `trace-oversized-${index}`,
    })))
    expect(result).toMatchObject({
      ok: false,
      diagnosticsStorageWriteFailed: true,
      diagnosticsPrunedTraceCount: 5,
    })
    expect(result.diagnosticsBytesBeforeWrite).toBeGreaterThan(result.diagnosticsBytesAfterPrune)
    expect(stored['engine2-public-trial-v5:pl']).toBe(JSON.stringify({ preserved: true }))
    vi.unstubAllGlobals()
    if (originalWindow) vi.stubGlobal('window', originalWindow)
  })

  it('clears only Engine 2 diagnostic storage keys', () => {
    const stored: Record<string, string> = {
      'engine2-public-diagnostics-v1': '[]',
      'engine2-public-diagnostics-extra': '{}',
      'engine2-public-trial-v5:pl': JSON.stringify({ preserved: true }),
    }
    const storage = {
      get length() { return Object.keys(stored).length },
      key: (index: number) => Object.keys(stored)[index] || null,
      getItem: (key: string) => stored[key] || null,
      setItem: vi.fn((key: string, value: string) => { stored[key] = value }),
      removeItem: vi.fn((key: string) => { delete stored[key] }),
    }
    vi.stubGlobal('window', {
      sessionStorage: storage,
      localStorage: storage,
      location: { hostname: 'localhost', search: '', pathname: '/engine_2', hash: '' },
    })
    clearEngine2Diagnostics()
    expect(stored['engine2-public-diagnostics-v1']).toBeUndefined()
    expect(stored['engine2-public-diagnostics-extra']).toBeUndefined()
    expect(stored['engine2-public-trial-v5:pl']).toBe(JSON.stringify({ preserved: true }))
    vi.unstubAllGlobals()
  })
})
