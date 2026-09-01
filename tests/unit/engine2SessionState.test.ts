import { afterEach, describe, expect, it } from 'vitest'
import { safeParseState, storageKey } from '../../src/engine2/sessionState.js'

const originalWindow = globalThis.window

const createSessionStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('engine2 session state helpers', () => {
  it('keeps panel reply context in the transcript after hydration', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(storageKey('pl'), JSON.stringify({
      schemaVersion: 'engine2.session.v4', trialId: 'trial-reply-context', language: 'pl',
      conversation: [{
        id: 'u-q5', role: 'user', content: 'Komputer i precyzyjne naprawy.',
        replyToQuestionId: 'q5', replyToQuestionText: 'W jakich scenariuszach lampa będzie używana?',
        replyTargetSource: 'explicit_composer',
      }],
      findings: [], findingEvents: [], contradictions: [], questions: [], questionEvents: [],
      rejectedFingerprints: [], pendingPackageId: null, remindedPackageIds: [], readiness: null,
      successfulTrialTurns: 1, successfulTurnMessageIds: ['u-q5'], providerCalls: 1,
      reportAvailable: false, trialEnded: false, adminUsage: null,
    }))

    expect(safeParseState('pl')?.messages[0]).toMatchObject({
      replyToQuestionId: 'q5',
      replyToQuestionText: 'W jakich scenariuszach lampa będzie używana?',
      replyTargetSource: 'explicit_composer',
    })
  })

  it('adds safe defaults when an older saved session has no guide fields yet', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(
      storageKey('pl'),
      JSON.stringify({
        schemaVersion: 3,
        trialId: 'trial-old',
        language: 'pl',
        messages: [],
        findings: [],
        rejectedFingerprints: [],
        pendingPackageId: null,
        remindedPackageIds: [],
        readiness: null,
        successfulTrialTurns: 0,
        successfulTurnMessageIds: [],
        providerCalls: 0,
        reportAvailable: false,
        trialEnded: false,
        adminUsage: null,
      }),
    )

    const parsed = safeParseState('pl')

    expect(parsed).not.toBeNull()
    expect(parsed?.openQuestions).toEqual([])
    expect(parsed?.activeQuestionId).toBeNull()
    expect(parsed?.guideNotice).toBeNull()
  })

  it('restores the saved selected question only when it still exists in the saved guide list', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(
      storageKey('pl'),
      JSON.stringify({
        schemaVersion: 3,
        trialId: 'trial-guide',
        language: 'pl',
        messages: [],
        findings: [],
        openQuestions: [{ id: 'gap-1', question: 'Jaką potrzebę klienta ma rozwiązać ten produkt?' }],
        activeQuestionId: 'gap-1',
        guideNotice: null,
        rejectedFingerprints: [],
        pendingPackageId: null,
        remindedPackageIds: [],
        readiness: null,
        successfulTrialTurns: 0,
        successfulTurnMessageIds: [],
        providerCalls: 0,
        reportAvailable: false,
        trialEnded: false,
        adminUsage: null,
      }),
    )

    const parsed = safeParseState('pl')

    expect(parsed?.openQuestions).toHaveLength(1)
    expect(parsed?.openQuestions?.[0]).toMatchObject({
      id: 'gap-1',
      question: 'Jaką potrzebę klienta ma rozwiązać ten produkt?',
    })
    expect(parsed?.activeQuestionId).toBeNull()
  })

  it('restores confirmed findings, pending proposals and open questions after a refresh', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(
      storageKey('pl'),
      JSON.stringify({
        schemaVersion: 3,
        trialId: 'trial-refresh',
        language: 'pl',
        messages: [
          { id: 'user-1', role: 'user', content: 'Pierwsza wiadomość.' },
          { id: 'assistant-1', role: 'assistant', content: 'Jaką funkcję ma mieć produkt?' },
        ],
        findings: [
          {
            id: 'confirmed-1',
            category: 'constraint',
            categoryLabel: 'Ustalenie',
            content: 'Obecna oferta nie ma takiego produktu.',
            status: 'confirmed',
            source: 'ai_interpretation',
            fingerprint: 'fp-confirmed-1',
            internal: { matrixRow: 'product', matrixCol: 'not_working', matrixCell: 'B2', confidence: 0.9 },
          },
          {
            id: 'proposed-1',
            category: 'goal',
            categoryLabel: 'Ustalenie',
            content: 'Rozważany jest druk 3D.',
            status: 'pending',
            source: 'ai_interpretation',
            fingerprint: 'fp-proposed-1',
            packageId: 'pkg-1',
            internal: { matrixRow: 'elements', matrixCol: 'should_be', matrixCell: 'C3', confidence: 0.7 },
          },
        ],
        openQuestions: [
          { id: 'gap-1', question: 'Jaką funkcję ma mieć produkt?', presentation: 'panel', askedCount: 0 },
          { id: 'gap-2', question: 'Dlaczego obecna oferta tego nie daje?', presentation: 'panel', askedCount: 1, lastAskedAt: '2026-08-01T10:00:00.000Z' },
        ],
        activeQuestionId: 'gap-2',
        guideNotice: null,
        rejectedFingerprints: [],
        pendingPackageId: 'pkg-1',
        remindedPackageIds: [],
        readiness: {
          score: 36,
          level: 'weak',
          reportAvailable: false,
          meaningfulCount: 1,
          coverage: { as_is: 0, not_working: 1, should_be: 0 },
        },
        successfulTrialTurns: 1,
        successfulTurnMessageIds: ['user-1'],
        providerCalls: 3,
        reportAvailable: false,
        trialEnded: false,
        adminUsage: null,
      }),
    )

    const parsed = safeParseState('pl')

    expect(parsed?.findings).toHaveLength(2)
    expect(parsed?.findings.some((finding) => finding.status === 'pending')).toBe(true)
    expect(parsed?.openQuestions).toHaveLength(2)
    expect(parsed?.activeQuestionId).toBeNull()
    expect(parsed?.openQuestions).toEqual([
      expect.objectContaining({ id: 'gap-1', presentation: 'panel' }),
      expect.objectContaining({ id: 'gap-2', presentation: 'panel', askedCount: 1 }),
    ])
    expect(parsed?.pendingPackageId).toBe('pkg-1')
  })

  it('keeps a fully decided package active after hydration so generate_panel_questions can run', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(storageKey('pl'), JSON.stringify({
      schemaVersion: 'engine2.session.v5',
      trialId: 'trial-decided-package',
      language: 'pl',
      conversation: [{ id: 'u-lamp', role: 'user', content: 'Chcę zaprojektować lampę na biurko.' }],
      findings: [{
        id: 'f-lamp',
        category: 'goal',
        categoryLabel: 'Cel',
        content: 'Użytkownik chce zaprojektować lampę na biurko.',
        displayText: 'Chcesz zaprojektować lampę na biurko.',
        status: 'confirmed',
        source: 'ai_interpretation',
        fingerprint: 'fp-lamp',
        packageId: 'pkg-lamp',
        internal: { matrixRow: 'product', matrixCol: 'should_be', matrixCell: 'C2', confidence: 0.9 },
      }],
      findingEvents: [],
      contradictions: [],
      questions: [],
      questionEvents: [],
      rejectedFingerprints: [],
      pendingPackageId: 'pkg-lamp',
      pendingDecisionPackageId: 'pkg-lamp',
      pendingPackageExpectedCount: 1,
      pendingQuestionTransition: null,
      readiness: { score: 0, reportAvailable: false },
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['u-lamp'],
      providerCalls: 1,
      reportAvailable: false,
      trialEnded: false,
    }))

    const parsed = safeParseState('pl')

    expect(parsed?.pendingPackageId).toBe('pkg-lamp')
    expect(parsed?.pendingDecisionPackageId).toBe('pkg-lamp')
    expect(parsed?.pendingPackageExpectedCount).toBe(1)
    expect(parsed?.findings[0]).toMatchObject({ id: 'f-lamp', status: 'confirmed', packageId: 'pkg-lamp' })
  })

  it('does not restore a v1 session that may contain stale planner questions', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(
      'engine2-public-trial-v1:pl',
      JSON.stringify({
        schemaVersion: 1,
        trialId: 'trial-stale-v1',
        language: 'pl',
        messages: [],
        findings: [],
        openQuestions: [{ id: 'stale-question', question: 'Stare pytanie planera?' }],
        activeQuestionId: 'stale-question',
      }),
    )

    expect(storageKey('pl')).toBe('engine2-public-trial-v5:pl')
    expect(safeParseState('pl')).toBeNull()
  })

  it('repairs answer followed by keep to answered/hidden during hydration', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(storageKey('pl'), JSON.stringify({
      schemaVersion: 'engine2.session.v4', trialId: 'trial-corrupt-ledger', language: 'pl',
      conversation: [], findings: [],
      questions: [{
        id: 'q2', semanticKey: 'light-parameters', question: 'Jakie parametry światła są potrzebne?',
        status: 'open', presentation: 'panel', answeredByMessageIds: ['u2'], coveredByFindingIds: ['f-direction'],
      }],
      openQuestions: [{ id: 'q2', question: 'Jakie parametry światła są potrzebne?', status: 'open', presentation: 'panel' }],
      questionEvents: [
        { id: 'e-answer', entityId: 'q2', operation: 'answer', messageId: 'u2', createdAt: '2026-08-01T10:00:00.000Z' },
        { id: 'e-keep', entityId: 'q2', operation: 'keep', messageId: null, createdAt: '2026-08-01T10:01:00.000Z' },
      ],
      activeQuestionId: 'q2', rejectedFingerprints: [], pendingPackageId: null,
      successfulTrialTurns: 1, successfulTurnMessageIds: ['u2'], providerCalls: 2,
      reportAvailable: false, trialEnded: false,
    }))

    const repaired = safeParseState('pl')
    expect(repaired?.questions).toEqual([
      expect.objectContaining({
        id: 'q2', status: 'answered', presentation: 'hidden',
        answeredByMessageIds: ['u2'], coveredByFindingIds: ['f-direction'],
      }),
    ])
    expect(repaired?.openQuestions).toEqual([])
    expect(repaired?.activeQuestionId).toBeNull()
    expect(JSON.parse(sessionStorage.getItem(storageKey('pl'))!).questions[0]).toMatchObject({
      id: 'q2', status: 'answered', presentation: 'hidden',
    })
  })

  it('preserves contradiction status and links after hydration', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(storageKey('pl'), JSON.stringify({
      schemaVersion: 'engine2.session.v5',
      trialId: 'trial-contradiction-reload',
      language: 'pl',
      conversation: [],
      findings: [],
      findingEvents: [],
      contradictions: [{
        id: 'c-small-stable',
        semanticKey: 'small_size_vs_stability',
        description: 'Mały rozmiar może utrudnić stabilność.',
        sideA: 'Mały rozmiar.',
        sideB: 'Stabilność.',
        findingIds: ['f-small', 'f-stable'],
        messageIds: ['u-small', 'u-stable'],
        sourceFindingIds: ['f-small', 'f-stable'],
        sourceMessageIds: ['u-small', 'u-stable'],
        status: 'suspected',
        reportBlocking: true,
        firstDetectedAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        verificationQuestionId: 'q-probe',
        resolutionFindingIds: [],
      }],
      questions: [],
      questionEvents: [],
      activeQuestionId: null,
      rejectedFingerprints: [],
      pendingPackageId: null,
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['u-small'],
      providerCalls: 2,
      reportAvailable: false,
      trialEnded: false,
    }))

    expect(safeParseState('pl')?.contradictions).toEqual([
      expect.objectContaining({
        id: 'c-small-stable',
        status: 'suspected',
        sideA: 'Mały rozmiar.',
        sideB: 'Stabilność.',
        sourceFindingIds: ['f-small', 'f-stable'],
        sourceMessageIds: ['u-small', 'u-stable'],
        verificationQuestionId: 'q-probe',
      }),
    ])
  })

  it('migrates v2 calls into provider diagnostics and reopens a session ended only by the old ten-call limit', () => {
    const sessionStorage = createSessionStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    })
    sessionStorage.setItem(
      'engine2-public-trial-v2:pl',
      JSON.stringify({
        schemaVersion: 2,
        trialId: 'trial-old-limit',
        language: 'pl',
        messages: [
          { id: 'user-1', role: 'user', content: 'Pierwsza wiadomość.' },
          { id: 'assistant-1', role: 'assistant', content: 'Pierwsza odpowiedź.' },
          { id: 'user-failed', role: 'user', content: 'Nieudana wiadomość.' },
        ],
        findings: [],
        openQuestions: [],
        questionHistory: [],
        rejectedFingerprints: [],
        pendingPackageId: null,
        remindedPackageIds: [],
        readiness: null,
        aiCallsUsed: 10,
        reportAvailable: false,
        trialEnded: true,
        adminUsage: null,
      }),
    )

    const parsed = safeParseState('pl')

    expect(parsed).toMatchObject({
      providerCalls: 10,
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['user-1'],
      trialEnded: false,
    })
    expect(sessionStorage.getItem(storageKey('pl'))).not.toBeNull()
  })
})
