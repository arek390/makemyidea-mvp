import { describe, expect, it } from 'vitest'
import { validateEngine2Diagnostics } from '../../src/lib/server/engine2DiagnosticValidator.js'

const finding = {
  id: 'f-lamp-goal',
  semanticKey: 'need_better_desk_lamp_light_direction',
  content: 'Chcesz zaprojektować nową lampę na biurko.',
  displayText: 'Chcesz zaprojektować nową lampę na biurko.',
  status: 'confirmed',
  packageId: 'pkg-1',
  decisionSource: 'user_accept',
}

const panelQuestion = (id: string, semanticKey: string, question: string) => ({
  id,
  semanticKey,
  question,
  status: 'open',
  presentation: 'panel',
  intent: 'Ustalić konkretny kompromis dla projektu lampy.',
  reason: 'Wynika z potwierdzonego problemu z kierunkiem światła.',
  priorityReason: 'Wynika z potwierdzonego problemu z kierunkiem światła.',
  groundedInFindingIds: [finding.id],
  targetType: 'priority',
  concreteAnchorText: 'obecne lampy nie świecą tam, gdzie ich potrzebujesz',
  uncertaintyToResolve: 'czy ważniejsze jest szerokie światło do pracy, czy skupione światło do napraw',
})

const q1Answered = {
  ...panelQuestion('q-answered', 'lamp_usage_context', 'Czy lampa ma przełączać się między szerokim światłem do pracy przy komputerze a skupionym światłem do napraw?'),
  status: 'answered',
  answeredByMessageIds: ['user-reply-1'],
}

const openQuestions = [
  panelQuestion('q-2', 'lamp_stability_vs_space', 'Czy ważniejsze jest małe miejsce na biurku, czy cięższa podstawa dająca stabilność?'),
  panelQuestion('q-3', 'lamp_battery_brightness', 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?'),
  panelQuestion('q-4', 'lamp_shadow_control', 'Czy przy naprawach lampa ma ograniczać cienie od dłoni w konkretnym miejscu pracy?'),
]

const validDiagnostics = () => ({
  exportedAt: '2026-08-22T15:30:00.000Z',
  sessionState: {
    language: 'pl',
    reportAvailable: false,
    trialEnded: false,
    pendingDecisionPackageId: null,
    pendingPackageId: null,
    activeQuestionId: null,
    findings: [finding],
    findingEvents: [{
      id: 'event-accept-f-lamp-goal',
      entityId: finding.id,
      findingId: finding.id,
      packageId: 'pkg-1',
      operation: 'decision',
      decisionType: 'accept',
      decisionSource: 'user_accept',
      createdAt: '2026-08-22T15:30:01.000Z',
    }],
    contradictions: [{
      id: 'c-light-mode',
      semanticKey: 'broad_vs_focused_light',
      status: 'suspected',
      reportBlocking: true,
    }],
    messages: [
      { id: 'user-1', role: 'user', content: 'Chcę zaprojektować lampę na biurko.' },
      {
        id: 'user-reply-1',
        role: 'user',
        content: 'Będzie używana do komputera i napraw.',
        replyToQuestionId: q1Answered.id,
      },
    ],
    conversation: [
      { id: 'user-1', role: 'user', content: 'Chcę zaprojektować lampę na biurko.' },
      {
        id: 'user-reply-1',
        role: 'user',
        content: 'Będzie używana do komputera i napraw.',
        replyToQuestionId: q1Answered.id,
      },
    ],
    questions: [q1Answered, ...openQuestions],
    openQuestions,
    questionBacklog: openQuestions,
  },
  traces: [
    {
      traceId: 'trace-analyze-1',
      action: 'analyze_message',
      apiResponse: {
        requestId: 'request-analyze-1',
        action: 'analyze_message',
        turnKind: 'unsolicited_substantive_information',
        pendingDecisionPackageId: 'pkg-1',
        findingProposals: [{ ...finding, status: 'pending', decisionSource: null }],
        parsedOutput: { findingChanges: [{ operation: 'add', semanticKey: finding.semanticKey }] },
        chatQuestion: null,
      },
      backendTrace: {
        parsedOutput: { findingChanges: [{ operation: 'add', semanticKey: finding.semanticKey }] },
      },
      frontend: {
        renderedPendingFindings: [finding.displayText],
        renderedOpenQuestions: [],
        stateConsistencyWarnings: [],
        deadEndInvariantResult: { invariant: 'dead_end_next_action', passed: true },
      },
    },
    {
      traceId: 'trace-continue-1',
      action: 'generate_panel_questions',
      apiResponse: {
        requestId: 'request-continue-1',
        action: 'generate_panel_questions',
        pendingDecisionPackageId: null,
        reportAvailable: false,
        retryable: false,
        panelQuestions: openQuestions,
        openQuestions,
        questionCandidates: openQuestions,
        chatQuestion: null,
        findingEvents: [{
          id: 'event-accept-f-lamp-goal',
          entityId: finding.id,
          findingId: finding.id,
          operation: 'decision',
          decisionType: 'accept',
          decisionSource: 'user_accept',
        }],
        sessionSnapshot: {
          findings: [finding],
          findingEvents: [{
            id: 'event-accept-f-lamp-goal',
            entityId: finding.id,
            findingId: finding.id,
            operation: 'decision',
            decisionType: 'accept',
            decisionSource: 'user_accept',
          }],
          contradictions: [{
            id: 'c-light-mode',
            semanticKey: 'broad_vs_focused_light',
            status: 'suspected',
          }],
        },
        backendInvariantResults: [{ invariant: 'dead_end_next_action', passed: true }],
        readinessDecisionSource: 'readiness_evaluator',
      },
      frontend: {
        questionCandidatesApplied: openQuestions,
        renderedOpenQuestions: openQuestions.map((question) => question.question),
        renderedPendingFindings: [],
        stateConsistencyWarnings: [],
        deadEndInvariantResult: { invariant: 'dead_end_next_action', passed: true },
      },
    },
  ],
})

describe('Engine 2 diagnostic validator', () => {
  it('passes a valid lamp panel-driven diagnostic export', () => {
    const result = validateEngine2Diagnostics(validDiagnostics(), { scenario: 'lamp' })

    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.summary).toMatchObject({
      traceCount: 2,
      openQuestionCount: 3,
      reportAvailable: false,
    })
  })

  it('fails an export with auto-confirmed finding and dead empty panel state', () => {
    const broken = validDiagnostics()
    broken.sessionState.findingEvents = []
    broken.sessionState.findings = [{ ...finding, decisionSource: null }]
    broken.sessionState.openQuestions = []
    broken.sessionState.questionBacklog = []
    broken.sessionState.questions = []
    broken.traces = [{
      traceId: 'trace-broken',
      action: 'generate_panel_questions',
      apiResponse: {
        requestId: 'request-broken',
        action: 'generate_panel_questions',
        pendingDecisionPackageId: null,
        reportAvailable: false,
        retryable: false,
        panelQuestions: [],
        openQuestions: [],
        chatQuestion: null,
        backendInvariantResults: [{ invariant: 'dead_end_next_action', passed: false }],
      },
      frontend: {
        questionCandidatesApplied: [],
        renderedOpenQuestions: [],
        renderedPendingFindings: [],
        stateConsistencyWarnings: ['no_next_action_without_three_panel_questions'],
        deadEndInvariantResult: { invariant: 'dead_end_next_action', passed: false },
      },
    }]

    const result = validateEngine2Diagnostics(broken, { scenario: 'lamp' })

    expect(result.ok).toBe(false)
    expect(result.failures.map((failure) => failure.check)).toEqual(expect.arrayContaining([
      'confirmed_or_rejected_requires_user_decision_event',
      'panel_question_count_three_without_pending_package',
      'session_open_questions_count_three',
      'dead_end_invariant_passed',
      'no_final_dead_end_state',
    ]))
    expect(result.failures.every((failure) => failure.traceId || failure.requestId)).toBe(true)
  })
})
