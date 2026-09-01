/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import {
  applyEngine2TurnDelta,
  applyStagedEngine2QuestionTransition,
  canonicalizeEngine2TurnDelta,
  ENGINE2_QUESTION_MIGRATION_VERSION,
  ENGINE2_TURN_JSON_SCHEMA,
  ENGINE2_TURN_SCHEMA_VERSION,
  ENGINE2_TURN_SYSTEM_PROMPT,
  migrateEngine2QuestionLedger,
  planEngine2LlmTurn,
  validateEngine2TurnDelta,
} from '../../src/lib/server/engine2LlmTurnPlanner.js'

const q2 = {
  id: 'q2', semanticKey: 'light_intensity',
  question: 'Czy potrzebna jest regulacja natężenia światła?', text: 'Czy potrzebna jest regulacja natężenia światła?',
  intent: 'Ustalić regulację natężenia.', status: 'open', presentation: 'panel',
  answeredByMessageIds: [], coveredByFindingIds: [], askedCount: 1,
}
const conversation = [
  { id: 'a1', role: 'assistant', content: q2.question, questionId: q2.id },
  { id: 'u2', role: 'user', content: 'nie rozumiem, sprecyzuj pytanie' },
]
const base = (overrides: Record<string, any> = {}) => ({
  schemaVersion: ENGINE2_TURN_SCHEMA_VERSION,
  turnKind: 'conversational',
  assistantReply: { type: 'conversational_response', text: 'Jasne.' },
  activeQuestionPresentation: null,
  findingChanges: [], contradictionChanges: [], questionTransition: null,
  ...overrides,
})
const context = (overrides: Record<string, any> = {}) => ({
  action: 'analyze_message', trialId: 'trial', language: 'pl', conversation,
  lastUserMessageId: 'u2', messageId: 'u2', replyToGapId: q2.id,
  activeQuestionId: q2.id, questions: [q2], questionBacklog: [], findings: [], contradictions: [],
  ...overrides,
})
const runner = (...outputs: any[]) => {
  const mock = vi.fn()
  for (const output of outputs) mock.mockImplementationOnce(async (options) => {
    options.onRawResponse?.({ content: typeof output === 'string' ? output : JSON.stringify(output) })
    return typeof output === 'string'
      ? { ok: false, data: null, meta: { errorCategory: 'PARSE_ERROR', providerCalled: true, tokens: {} } }
      : { ok: true, data: output, meta: { modelUsed: 'test', providerCalled: true, tokens: { input: 10, output: 10, total: 20 } } }
  })
  return mock
}

describe('Engine 2 turn v3', () => {
  it('contains only the simplified planner fields', () => {
    expect(ENGINE2_TURN_JSON_SCHEMA.required).toEqual([
      'schemaVersion', 'turnKind', 'assistantReply', 'activeQuestionPresentation',
      'findingChanges', 'contradictionChanges', 'questionTransition',
    ])
    for (const removed of ['answerCoverage', 'questionChanges', 'nextQuestionId', 'readiness', 'conversationStatus']) {
      expect(ENGINE2_TURN_JSON_SCHEMA.properties).not.toHaveProperty(removed)
    }
    expect(ENGINE2_TURN_SYSTEM_PROMPT).toContain('clarification_request')
    expect(ENGINE2_TURN_SYSTEM_PROMPT).toContain('there is no keep operation')
  })

  it.each([
    'Nie rozumiem, możesz to wyjaśnić prościej?',
    'Co dokładnie masz na myśli?',
    'Podaj proszę przykład, bo pytanie jest dla mnie niejasne.',
  ])('clarification without explicit active chat question is rejected: %s', (message) => {
    const delta = base({
      turnKind: 'clarification_request', assistantReply: { type: 'explanation', text: 'Chodzi o możliwość zmiany jasności lampy.' },
      activeQuestionPresentation: { text: 'Czy chcesz móc rozjaśniać i przyciemniać lampę?', reason: 'Prostsze sformułowanie.', sourceMessageId: 'u2' },
    })
    const checked = validateEngine2TurnDelta(delta, context({ conversation: [conversation[0], { id: 'u2', role: 'user', content: message }] }))
    expect(checked.ok).toBe(false)
    expect(checked.errors).toContain('activeQuestionPresentation requires an active question')
  })

  it('does not render a clarification as an active chat question after apply', () => {
    const delta = base({
      turnKind: 'clarification_request', assistantReply: { type: 'explanation', text: 'Chodzi o możliwość zmiany jasności lampy.' },
      activeQuestionPresentation: { text: 'Czy chcesz móc rozjaśniać i przyciemniać lampę?', reason: 'Prostsze sformułowanie.', sourceMessageId: 'u2' },
    })
    const applied = applyEngine2TurnDelta({ delta, findings: [], questions: [q2], activeQuestionId: q2.id, trialId: 'trial', messageId: 'u2' })
    expect(applied.findings).toEqual([])
    expect(applied.activeQuestionId).toBeNull()
    expect(applied.questions[0]).toMatchObject({ id: q2.id, status: 'open' })
    expect(applied.activeQuestionPresentation).toBeNull()
  })

  it('does not accept clarification planning without an active chat question', async () => {
    const clarification = base({
      turnKind: 'clarification_request', assistantReply: null,
      activeQuestionPresentation: { text: 'Czy jasność lampy ma być regulowana?', reason: 'Doprecyzowanie.', sourceMessageId: 'u2' },
    })
    const runTask = runner(clarification, clarification)
    const planned = await planEngine2LlmTurn({
      input: context({ conversation: [{ id: 'u2', role: 'user', content: 'Wyjaśnij proszę.' }] }),
      apiKey: 'x', aiSupportEnabled: true, runTask,
    })
    expect(planned.ok).toBe(false)
    expect(planned.validation.errors).toContain('activeQuestionPresentation requires an active question')
  })

  it('surfaces provider failure categories instead of empty validation errors', async () => {
    const runTask = vi.fn().mockImplementationOnce(async () => ({
      ok: false,
      data: null,
      error: 'OpenAI returned no content.',
      meta: {
        errorCategory: 'EMPTY_RESPONSE',
        errorInfo: { message: 'OpenAI returned no content.' },
        providerCalled: true,
        providerRequestId: 'req-empty',
        tokens: { input: 0, output: 0, total: 0 },
      },
    }))

    const planned = await planEngine2LlmTurn({
      input: context({ conversation: [{ id: 'u-first', role: 'user', content: 'Chcę zaprojektować lampę.' }], questions: [], activeQuestionId: null, replyToGapId: null }),
      apiKey: 'x',
      aiSupportEnabled: true,
      runTask,
    })

    expect(planned.ok).toBe(false)
    expect(planned.errorCategory).toBe('EMPTY_RESPONSE')
    expect(planned.validation.errors[0]).toContain('EMPTY_RESPONSE')
    expect(planned.meta.providerCalls).toBe(1)
  })

  it.each([1, 2])('canonicalizes the live-shaped first turn with %i finding(s) without repair', async (findingCount) => {
    const firstMessage = { id: 'u2', role: 'user', content: 'Chcę zaprojektować nową lampę na biurko, obecne lampy nie dają światła tam, gdzie go potrzebuję.' }
    const findingChanges = [
      { operation: 'add', clientRef: 'lamp-project', semanticKey: 'lamp_project', text: 'Użytkownik chce zaprojektować nową lampę na biurko.', subject: 'product', perspective: 'desired' },
      { operation: 'add', clientRef: 'light-placement-problem', semanticKey: 'light_placement_problem', text: 'Obecne lampy nie oświetlają miejsca, w którym światło jest potrzebne.', subject: 'product', perspective: 'not_working' },
    ].slice(0, findingCount)
    const raw = base({
      turnKind: 'substantive_information', assistantReply: { type: 'acknowledgement', text: 'Rozumiem, zapisuję punkt wyjścia.' },
      findingChanges,
    })
    const runTask = runner(raw)
    const planned = await planEngine2LlmTurn({
      input: context({ conversation: [firstMessage], questions: [], questionBacklog: [], activeQuestionId: null, replyToGapId: null }),
      apiKey: 'x', aiSupportEnabled: true, runTask,
    })
    expect(planned.ok).toBe(true)
    expect(planned.attempts).toHaveLength(1)
    expect(planned.meta).toMatchObject({ providerCalls: 1, repairRetry: false })
    expect(planned.delta.findingChanges).toHaveLength(findingCount)
    expect(planned.delta.activeQuestionPresentation).toBeNull()
    expect(planned.delta.questionTransition).toBeNull()
    expect(planned.canonicalizationChanges).toEqual([
      'substantive_information reclassified as unsolicited_substantive_information without replyToQuestionId',
    ])
  })

  it('stages an answered close with the pending proposal and commits it only after confirmation', () => {
    const delta = base({
      turnKind: 'substantive_information', assistantReply: { type: 'acknowledgement', text: 'Rozumiem.' },
      findingChanges: [{ operation: 'add', clientRef: 'f-new', semanticKey: 'light_intensity_control', text: 'Lampa ma mieć regulację jasności.', subject: 'product', perspective: 'desired' }],
      questionTransition: { type: 'close', questionId: q2.id, outcome: 'answered', reason: 'Użytkownik potwierdził wymaganie.', sourceMessageId: 'u2', evidenceFindingRefs: ['f-new'] },
    })
    expect(validateEngine2TurnDelta(delta, context()).ok).toBe(true)
    const applied = applyEngine2TurnDelta({ delta, questions: [q2], activeQuestionId: q2.id, trialId: 'trial', messageId: 'u2' })
    expect(applied.findings[0].status).toBe('pending')
    expect(applied.questions[0].status).toBe('open')
    expect(applied.stagedQuestionTransition).toMatchObject({ questionId: q2.id, outcome: 'answered' })

    const rejected = applyStagedEngine2QuestionTransition({
      questions: applied.questions, transition: applied.stagedQuestionTransition,
      findings: applied.findings.map((finding: any) => ({ ...finding, status: 'rejected' })), trialId: 'trial', messageId: 'u2',
    })
    expect(rejected.applied).toBe(false)
    expect(rejected.questions[0].status).toBe('open')

    const acceptedFindings = applied.findings.map((finding: any) => ({ ...finding, status: 'confirmed' }))
    const accepted = applyStagedEngine2QuestionTransition({
      questions: applied.questions, transition: applied.stagedQuestionTransition,
      findings: acceptedFindings, trialId: 'trial', messageId: 'u2',
    })
    expect(accepted.applied).toBe(true)
    expect(accepted.questions.find((question: any) => question.id === q2.id)).toMatchObject({ status: 'answered', presentation: 'hidden' })

    const changed = applyStagedEngine2QuestionTransition({
      questions: applied.questions, transition: applied.stagedQuestionTransition,
      findings: applied.findings.map((finding: any) => ({ ...finding, status: 'confirmed', content: 'Lampa ma mieć płynną regulację jasności.' })),
      trialId: 'trial', messageId: 'u2',
    })
    expect(changed.applied).toBe(true)
    expect(changed.questions.find((question: any) => question.id === q2.id)).toMatchObject({
      status: 'answered', coveredByFindingIds: [applied.findings[0].id],
    })
  })

  it('answers the selected panel question even when another question is active', () => {
    const panelQuestion = {
      ...q2,
      id: 'q-panel',
      semanticKey: 'battery_runtime',
      question: 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?',
      text: 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?',
      presentation: 'panel',
    }
    const delta = base({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [{ operation: 'add', clientRef: 'battery-runtime', semanticKey: 'battery_runtime_choice', text: 'Akumulator może świecić słabiej, jeśli dzięki temu działa około godziny.', subject: 'product', perspective: 'desired' }],
      questionTransition: { type: 'close', questionId: panelQuestion.id, outcome: 'answered', reason: 'Odpowiedź wybiera konkretny kompromis akumulatora.', sourceMessageId: 'u2', evidenceFindingRefs: ['battery-runtime'] },
    })
    const checked = validateEngine2TurnDelta(delta, context({
      questions: [q2, panelQuestion],
      activeQuestionId: q2.id,
      replyToGapId: panelQuestion.id,
    }))
    expect(checked.ok).toBe(true)
    const applied = applyEngine2TurnDelta({
      delta,
      questions: [q2, panelQuestion],
      activeQuestionId: q2.id,
      trialId: 'trial',
      messageId: 'u2',
    })
    const accepted = applyStagedEngine2QuestionTransition({
      questions: applied.questions,
      transition: applied.stagedQuestionTransition,
      findings: applied.findings.map((finding: any) => ({ ...finding, status: 'confirmed' })),
      trialId: 'trial',
      messageId: 'u2',
    })
    expect(accepted.questions.find((question: any) => question.id === panelQuestion.id)).toMatchObject({ status: 'answered', presentation: 'hidden' })
    expect(accepted.questions.find((question: any) => question.id === q2.id)).toMatchObject({ status: 'open', presentation: 'panel' })
  })

  it('stores direct Polish display text for third-person internal finding text', () => {
    const delta = base({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [{ operation: 'add', clientRef: 'lamp-project', semanticKey: 'lamp_project', text: 'Użytkownik chce zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie go potrzebuje.', subject: 'product', perspective: 'desired' }],
    })
    const applied = applyEngine2TurnDelta({ delta, questions: [], activeQuestionId: null, trialId: 'trial', messageId: 'u2', language: 'pl' })
    expect(applied.findings[0]).toMatchObject({
      content: 'Użytkownik chce zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie go potrzebuje.',
      displayText: 'Chcesz zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie ich potrzebujesz.',
    })
  })

  it('accepts correction proposals without changing a confirmed finding immediately', () => {
    const finding = { id: 'f1', semanticKey: 'mount', content: 'Mocowanie na klips.', status: 'confirmed', subject: 'elements', perspective: 'desired' }
    const delta = base({
      turnKind: 'correction', assistantReply: { type: 'acknowledgement', text: 'Zapisuję korektę do potwierdzenia.' },
      findingChanges: [{ operation: 'revise', findingId: 'f1', text: 'Mocowanie na ciężkiej podstawie.', subject: 'elements', perspective: 'desired' }],
    })
    expect(validateEngine2TurnDelta(delta, context({ findings: [finding] })).ok).toBe(true)
    const applied = applyEngine2TurnDelta({ delta, findings: [finding], questions: [q2], activeQuestionId: q2.id, trialId: 'trial', messageId: 'u2' })
    expect(applied.findings.find((entry: any) => entry.id === 'f1')).toMatchObject({ content: 'Mocowanie na klips.', status: 'confirmed' })
    expect(applied.findings.some((entry: any) => entry.targetFindingId === 'f1' && entry.status === 'pending')).toBe(true)
  })

  it('stages withdrawal as a correction instead of deleting the confirmed finding', () => {
    const finding = { id: 'f1', semanticKey: 'mount', content: 'Mocowanie na klips.', status: 'confirmed', subject: 'elements', perspective: 'desired' }
    const delta = base({
      turnKind: 'correction', assistantReply: { type: 'acknowledgement', text: 'Zapisuję wycofanie do potwierdzenia.' },
      findingChanges: [{ operation: 'withdraw', findingId: finding.id }],
    })
    expect(validateEngine2TurnDelta(delta, context({ findings: [finding] })).ok).toBe(true)
    const applied = applyEngine2TurnDelta({ delta, findings: [finding], questions: [q2], activeQuestionId: q2.id, trialId: 'trial', messageId: 'u2' })
    expect(applied.findings.find((entry: any) => entry.id === finding.id)).toMatchObject({ status: 'confirmed' })
    expect(applied.findings.some((entry: any) => entry.targetFindingId === finding.id && entry.proposedOperation === 'withdraw' && entry.status === 'pending')).toBe(true)
  })

  it('assigns a durable contradiction ID in the backend', () => {
    const finding = { id: 'f1', semanticKey: 'mount', content: 'Mocowanie na klips.', status: 'confirmed' }
    const raw = base({
      turnKind: 'substantive_information', assistantReply: null,
      findingChanges: [{ operation: 'add', clientRef: 'f2', semanticKey: 'mount_base', text: 'Mocowanie na podstawie.', subject: 'elements', perspective: 'desired' }],
      contradictionChanges: [{
        operation: 'create', contradictionId: 'model-owned-id', semanticKey: 'mount_conflict',
        description: 'Dwie metody mocowania.',
        sideA: 'Mocowanie na klips.',
        sideB: 'Mocowanie na podstawie.',
        sourceFindingIds: [finding.id, 'f2'],
        sourceMessageIds: ['u2'],
        status: 'suspected',
        reportBlocking: true,
        verificationQuestionId: null,
        resolutionFindingIds: [],
      }],
    })
    const canonicalized = canonicalizeEngine2TurnDelta(raw, context({ findings: [finding], replyToGapId: null }))
    expect(canonicalized.delta.contradictionChanges[0].contradictionId).toBeNull()
    expect(canonicalized.changes).toEqual(expect.arrayContaining(['contradictionChanges[0].contradictionId cleared for backend assignment']))
    expect(validateEngine2TurnDelta(canonicalized.delta, context({ findings: [finding], replyToGapId: null })).ok).toBe(true)
    const applied = applyEngine2TurnDelta({
      delta: canonicalized.delta, findings: [finding], questions: [q2], activeQuestionId: q2.id,
      trialId: 'trial', messageId: 'u2',
    })
    expect(applied.contradictions[0].id).toMatch(/^engine2-contradiction-/)
    expect(applied.contradictions[0].id).not.toBe('model-owned-id')
    expect(applied.contradictions[0]).toMatchObject({ status: 'suspected', sourceFindingIds: expect.arrayContaining([finding.id]) })
  })

  it('rejects a definite finding when the user answer contains an unresolved mode ambiguity', () => {
    const ambiguousMessage = {
      id: 'u-zone',
      role: 'user',
      content: 'chce oświetlać jedna strefę na raz / jednocześnie i moc regulować jej intensywnosc',
    }
    const pureFinding = base({
      turnKind: 'substantive_information',
      assistantReply: null,
      findingChanges: [{
        operation: 'add',
        clientRef: 'zone-mode',
        semanticKey: 'lamp_light_intensity_zone_mode',
        text: 'Użytkownik chce regulować intensywność światła w jednej strefie na raz lub jednocześnie.',
        subject: 'product',
        perspective: 'desired',
      }],
      questionTransition: {
        type: 'close',
        questionId: q2.id,
        outcome: 'answered',
        reason: 'Odpowiedź dotyczy regulacji światła.',
        sourceMessageId: ambiguousMessage.id,
        evidenceFindingRefs: ['zone-mode'],
      },
    })

    const checked = validateEngine2TurnDelta(pureFinding, context({
      conversation: [conversation[0], ambiguousMessage],
      lastUserMessageId: ambiguousMessage.id,
      messageId: ambiguousMessage.id,
      replyToGapId: q2.id,
    }))

    expect(checked.ok).toBe(false)
    expect(checked.errors).toContain('ambiguous alternative answer requires a contradiction/tension change or a cautious non-definitive finding')
  })

  it('closes a skipped question without creating a fake finding', () => {
    const delta = base({
      turnKind: 'navigation', assistantReply: { type: 'conversational_response', text: 'Pomijam to pytanie.' },
      questionTransition: { type: 'close', questionId: q2.id, outcome: 'skipped', reason: 'Użytkownik chce pominąć temat.', sourceMessageId: 'u2', evidenceFindingRefs: [] },
    })
    expect(validateEngine2TurnDelta(delta, context()).ok).toBe(true)
    const applied = applyEngine2TurnDelta({ delta, questions: [q2], activeQuestionId: q2.id, trialId: 'trial', messageId: 'u2' })
    expect(applied.findings).toEqual([])
    expect(applied.questions[0].status).toBe('skipped')
  })

  it('repairs only structural errors once and keeps the previous state when repair is invalid', async () => {
    const invalidId = base({
      turnKind: 'navigation',
      questionTransition: { type: 'close', questionId: 'missing', outcome: 'skipped', reason: 'Pominięcie.', sourceMessageId: 'u2', evidenceFindingRefs: [] },
    })
    const runTask = runner(invalidId, invalidId)
    const planned = await planEngine2LlmTurn({ input: context(), apiKey: 'x', aiSupportEnabled: true, runTask })
    expect(planned.ok).toBe(false)
    expect(planned.attempts).toHaveLength(2)
    expect(planned.validation.errors).toContain('questionTransition must target the effective reply question')
    expect(q2.status).toBe('open')
  })

  it('migrates several open questions deterministically and idempotently', () => {
    const q3 = { ...q2, id: 'q3', semanticKey: 'mounting', presentation: 'panel' }
    const first = migrateEngine2QuestionLedger({ questions: [q3, q2], activeQuestionId: q2.id })
    const second = migrateEngine2QuestionLedger({ questions: first.questions, activeQuestionId: first.activeQuestionId, questionBacklog: first.questionBacklog })
    expect(first.activeQuestionId).toBeNull()
    expect(first.questions.filter((question: any) => question.status === 'open' && question.presentation === 'panel').map((question: any) => question.id)).toEqual([q3.id, q2.id])
    expect(second).toEqual(first)
    expect(first.migrationVersion).toBe(ENGINE2_QUESTION_MIGRATION_VERSION)
  })
})
