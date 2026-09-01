import { describe, expect, it } from 'vitest'
import {
  calculateEngine2ReadinessDecision,
  ENGINE2_READINESS_COMPONENTS,
  ENGINE2_READINESS_SCHEMA_VERSION,
  validateEngine2ReadinessEvaluation,
} from '../../src/lib/server/engine2ReadinessEvaluator.js'

const findings = ENGINE2_READINESS_COMPONENTS.map((key, index) => ({
  id: `f${index + 1}`, semanticKey: key, content: key, status: 'confirmed',
}))
const component = (key: string, status = 'covered', evidenceFindingIds: string[] = [], critical = false) => ({
  key, status, evidenceFindingIds, reason: `Ocena ${key}.`, critical,
})
const candidate = (overrides: Record<string, any>) => ({
  concreteAnchorText: 'Obecne lampy nie świecą w potrzebnym miejscu.',
  uncertaintyToResolve: 'Trzeba ustalić jedną konkretną granicę projektu.',
  userCanAnswerFromExperience: true,
  forbiddenGenericCategoryQuestion: false,
  ...overrides,
})
const complete = () => ({
  schemaVersion: ENGINE2_READINESS_SCHEMA_VERSION,
  overallReason: 'Krótka, ale kompletna sesja.',
  materialScore: 100,
  materialScoreReason: 'Materiał jest kompletny.',
  components: ENGINE2_READINESS_COMPONENTS.map((key, index) => component(key, 'covered', [`f${index + 1}`])),
  criticalMissing: [], contradictionChanges: [], questionCandidates: [],
})
const incomplete = () => ({
  ...complete(), overallReason: 'Brakuje ograniczeń.',
  components: ENGINE2_READINESS_COMPONENTS.map((key, index) => key === 'constraints'
    ? component(key, 'missing', [], true)
    : component(key, 'covered', [`f${index + 1}`])),
  criticalMissing: [{ component: 'constraints', missing: 'Ograniczenia', reason: 'Wpływają na wykonalność.' }],
  questionCandidates: [
    candidate({ clientRef: 'constraints_follow_up', semanticKey: 'constraints_follow_up', question: 'Czy limit 200 zł jest twardy, czy możesz go zwiększyć dla stabilniejszej podstawy?', intent: 'Ustalić konkretną granicę budżetu.', presentation: 'panel', reason: 'Najważniejszy brak.', groundedInFindingIds: ['f1'], targetType: 'boundary', targetContradictionId: null }),
    candidate({ clientRef: 'budget_follow_up', semanticKey: 'budget_follow_up', question: 'Czy ważniejszy jest niski koszt, czy stabilniejsza konstrukcja lampy?', intent: 'Ustalić priorytet budżetu.', presentation: 'panel', reason: 'Wpływa na rozwiązanie.', groundedInFindingIds: ['f1'], targetType: 'priority', targetContradictionId: null }),
    candidate({ clientRef: 'desk_space_follow_up', semanticKey: 'desk_space_follow_up', question: 'Czy lampa może zająć więcej miejsca na biurku, jeśli będzie dzięki temu stabilniejsza?', intent: 'Ustalić ograniczenie miejsca.', presentation: 'panel', reason: 'Wpływa na podstawę lampy.', groundedInFindingIds: ['f1'], targetType: 'boundary', targetContradictionId: null }),
  ],
})

describe('Engine 2 readiness v2', () => {
  it('accepts an ordered panel candidate set without model-supplied question IDs', () => {
    const checked = validateEngine2ReadinessEvaluation(incomplete(), { allFindings: findings, activeContradictions: [], questions: [] })
    expect(checked.ok).toBe(true)
    expect(incomplete().questionCandidates).toHaveLength(3)
    expect(incomplete().questionCandidates[0]).not.toHaveProperty('questionId')
  })

  it('rejects unknown, pending and rejected evidence', () => {
    for (const [id, allFindings] of [
      ['missing', findings],
      ['pending', [...findings, { id: 'pending', semanticKey: 'x', status: 'pending' }]],
      ['rejected', [...findings, { id: 'rejected', semanticKey: 'x', status: 'rejected' }]],
    ] as const) {
      const evaluation = complete()
      evaluation.components[0].evidenceFindingIds = [id]
      const errors = validateEngine2ReadinessEvaluation(evaluation, { allFindings, activeContradictions: [], questions: [] }).errors
      expect(errors.some((error: string) => error.includes(id))).toBe(true)
    }
  })

  it('blocks report readiness for critical missing and report-blocking contradictions', () => {
    const evaluation = incomplete()
    const missingDecision = calculateEngine2ReadinessDecision({ evaluation, allFindings: findings, activeContradictions: [] })
    expect(missingDecision.reportAvailable).toBe(false)
    expect(missingDecision.reportBlockedReasons).toContain('critical_missing')

    const contradictionDecision = calculateEngine2ReadinessDecision({
      evaluation: complete(), allFindings: findings,
      activeContradictions: [{ id: 'c1', status: 'active', reportBlocking: true }],
    })
    expect(contradictionDecision.reportAvailable).toBe(false)
    expect(contradictionDecision.reportBlockedReasons).toContain('active_report_blocking_contradiction')
  })

  it('allows a short genuinely complete session and only backend calculates 100', () => {
    const evaluation = complete()
    expect(validateEngine2ReadinessEvaluation(evaluation, { allFindings: findings, activeContradictions: [], questions: [] }))
      .toMatchObject({ ok: true, provisionalScore: 100 })
    const decision = calculateEngine2ReadinessDecision({ evaluation, allFindings: findings, activeContradictions: [] })
    expect(decision).toMatchObject({ reportAvailable: true, finalScore: 100, readinessDecisionSource: 'backend_readiness_evaluator' })
  })

  it('counts soft tension signals as visible tradeoffs without requiring formal contradiction objects', () => {
    const evaluation = complete()
    const decision = calculateEngine2ReadinessDecision({
      evaluation,
      allFindings: findings,
      activeContradictions: [],
      softTensionSignals: [{
        semanticKey: 'soft_lightweight_vs_stable',
        description: 'Lampa ma być lekka, ale stabilna.',
        sideA: 'Lekka i przenośna',
        sideB: 'Stabilna i odporna na przewracanie',
        sourceFindingIds: ['f1'],
        sourceMessageIds: ['u1'],
        confidence: 0.86,
      }],
    })
    expect(decision.reportAvailable).toBe(true)
    expect(decision.hasTradeoffsOrContradictions).toBe(true)
    expect(decision.softTensionSignalsCount).toBe(1)
    expect(decision.contradictionReadinessImpact.hasSoftTensionSignals).toBe(true)
    expect(decision.reportBlockedReasons).not.toContain('active_report_blocking_contradiction')
  })

  it('keeps formal report-blocking contradictions as hard blockers even when soft tensions exist', () => {
    const decision = calculateEngine2ReadinessDecision({
      evaluation: complete(),
      allFindings: findings,
      activeContradictions: [{ id: 'c1', semanticKey: 'formal_blocker', status: 'open', reportBlocking: true }],
      softTensionSignals: [{ semanticKey: 'soft_interface_options', description: 'Prosty interface z wieloma opcjami.' }],
    })
    expect(decision.reportAvailable).toBe(false)
    expect(decision.hasTradeoffsOrContradictions).toBe(true)
    expect(decision.reportBlockedReasons).toContain('active_report_blocking_contradiction')
  })

  it('does not hard-reject a candidate solely because a terminal question has the same semantic key', () => {
    const evaluation = incomplete()
    evaluation.questionCandidates[0].semanticKey = 'constraints'
    const checked = validateEngine2ReadinessEvaluation(evaluation, {
      allFindings: findings, activeContradictions: [], questions: [{ id: 'q-old', semanticKey: 'constraints', status: 'answered' }],
    })
    expect(checked.ok).toBe(true)
    expect(checked.errors).not.toContain('question candidate repeats terminal question: constraints')
  })

  it('rejects English user-facing question text in a Polish session', () => {
    const english = incomplete()
    english.questionCandidates[0].question = 'What features should the lamp have?'
    const englishErrors = validateEngine2ReadinessEvaluation(english, { allFindings: findings, activeContradictions: [], questions: [], language: 'pl' }).errors
    expect(englishErrors.some((error: string) => error.includes('must be Polish user-facing text'))).toBe(true)
  })

  it('allows structurally valid panel metadata even when quality signals are imperfect', () => {
    const missingAnchor = incomplete()
    missingAnchor.questionCandidates[0] = {
      ...missingAnchor.questionCandidates[0],
      question: 'Chcesz podać więcej szczegółów dotyczących oczekiwanych cech i funkcji nowej lampy?',
      uncertaintyToResolve: 'Cechy i funkcje lampy.',
      forbiddenGenericCategoryQuestion: true,
      reason: 'Użytkownik chce doprecyzować lampę.',
      targetType: 'less_ideal_metadata',
    }
    const result = validateEngine2ReadinessEvaluation(missingAnchor, { allFindings: findings, activeContradictions: [], questions: [], language: 'pl' })
    expect(result.errors.some((error: string) => error.includes('generic'))).toBe(false)
    expect(result.errors.some((error: string) => error.includes('forbiddenGenericCategoryQuestion'))).toBe(false)
    expect(result.errors.some((error: string) => error.includes('targetType is invalid'))).toBe(false)
    expect(result.errors.some((error: string) => error.includes('must address the user directly'))).toBe(false)
  })

  it('allows panel questions grounded in older confirmed findings when timestamps are available', () => {
    const latestFindings = [
      { ...findings[0], updatedAt: '2026-08-22T10:00:00.000Z' },
      { ...findings[1], updatedAt: '2026-08-22T11:00:00.000Z' },
    ]
    const evaluation = incomplete()
    evaluation.questionCandidates = evaluation.questionCandidates.map((entry: any) => ({ ...entry, groundedInFindingIds: ['f1'] }))
    const result = validateEngine2ReadinessEvaluation(evaluation, {
      allFindings: latestFindings,
      activeContradictions: [],
      questions: [],
      language: 'pl',
    })
    expect(result.errors).not.toContain('questionCandidates[0] must be tied to the latest confirmed findings')
    expect(result.errors.some((error: string) => error.includes('must be tied to the latest confirmed findings'))).toBe(false)
  })

  it('panel_questions_after_usage_context_are_concrete', () => {
    const lampFindings = [
      {
        id: 'f-lamp',
        semanticKey: 'need_better_desk_lamp_light',
        content: 'Chcesz nową lampę, bo obecne lampy nie świecą w potrzebnym miejscu.',
        status: 'confirmed',
        updatedAt: '2026-08-22T10:00:00.000Z',
      },
      {
        id: 'f-usage',
        semanticKey: 'usage_context_detail',
        content: 'Lampa będzie używana przy komputerze i przy naprawach wymagających dobrego światła w konkretnym miejscu.',
        status: 'confirmed',
        updatedAt: '2026-08-22T11:00:00.000Z',
      },
    ]
    const evaluation = incomplete()
    evaluation.components = ENGINE2_READINESS_COMPONENTS.map((key) => key === 'constraints'
      ? component(key, 'missing', [], true)
      : component(key, 'partial', ['f-usage']))
    evaluation.questionCandidates = [
      candidate({
        clientRef: 'computer_vs_repairs',
        semanticKey: 'computer_vs_repairs',
        question: 'Czy podczas pracy przy komputerze lampa ma świecić łagodniej niż podczas napraw w konkretnym miejscu biurka?',
        intent: 'Sprawdzić napięcie między pracą przy komputerze i naprawami.',
        presentation: 'panel',
        reason: 'Kontekst użycia wskazuje dwa różne tryby pracy.',
        groundedInFindingIds: ['f-usage'],
        concreteAnchorText: 'Praca przy komputerze oraz naprawy przy biurku.',
        uncertaintyToResolve: 'Czy te dwa użycia wymagają różnych trybów świecenia.',
        targetType: 'contradiction_probe',
        targetContradictionId: null,
      }),
      candidate({
        clientRef: 'broad_vs_focused',
        semanticKey: 'broad_vs_focused',
        question: 'Czy przy naprawach ważniejsze jest szerokie oświetlenie całego biurka, czy skupiony stożek światła w jednym miejscu?',
        intent: 'Ustalić kompromis szerokości światła.',
        presentation: 'panel',
        reason: 'Naprawy wymagają dobrego światła w konkretnym miejscu.',
        groundedInFindingIds: ['f-usage'],
        concreteAnchorText: 'Naprawy wymagające światła w konkretnym miejscu.',
        uncertaintyToResolve: 'Czy światło ma być szerokie, czy skupione.',
        targetType: 'priority',
        targetContradictionId: null,
      }),
      candidate({
        clientRef: 'moving_vs_stability',
        semanticKey: 'moving_vs_stability',
        question: 'Czy podczas napraw lampa będzie często przesuwana po biurku, czy ma stać stabilnie w jednym miejscu?',
        intent: 'Ustalić zachowanie lampy podczas pracy.',
        presentation: 'panel',
        reason: 'Konkretne miejsce świecenia może wymagać regulacji albo stabilności.',
        groundedInFindingIds: ['f-usage'],
        concreteAnchorText: 'Potrzebujesz światła w konkretnym miejscu biurka.',
        uncertaintyToResolve: 'Czy ważniejsze jest przesuwanie lampy, czy stabilność.',
        targetType: 'usage_example',
        targetContradictionId: null,
      }),
    ]
    const checked = validateEngine2ReadinessEvaluation(evaluation, {
      allFindings: lampFindings,
      activeContradictions: [],
      questions: [],
      language: 'pl',
    })
    expect(checked.ok).toBe(true)
    expect(evaluation.questionCandidates).toHaveLength(3)
    const text = evaluation.questionCandidates.map((entry: any) => entry.question).join(' ').toLowerCase()
    expect(text).not.toMatch(/cechy|funkcje|ryzyka|decyzje|kryteria sukcesu|co jeszcze/)
    expect(text).toMatch(/komputerze/)
    expect(text).toMatch(/napraw/)
    expect(text).toMatch(/szerokie|skupiony|stabilnie|przesuwana/)
    expect(evaluation.questionCandidates.every((entry: any) => entry.concreteAnchorText && entry.uncertaintyToResolve)).toBe(true)
  })
})
