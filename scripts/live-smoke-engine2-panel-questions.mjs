import {
  generateEngine2PanelQuestions,
} from '../src/lib/server/engine2PanelQuestionGenerator.js'

const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  console.error(JSON.stringify({
    ok: false,
    skipped: true,
    reason: 'OPENAI_API_KEY is required for live/provider smoke test.',
  }, null, 2))
  process.exit(2)
}

const finding = {
  id: 'live-lamp-finding-1',
  semanticKey: 'need_better_desk_lamp_light_direction',
  displayText: 'Chcesz zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie ich potrzebujesz.',
  text: 'Chcesz zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie ich potrzebujesz.',
  content: 'Chcesz zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie ich potrzebujesz.',
  status: 'confirmed',
  subject: 'product',
  perspective: 'desired',
  decisionSource: 'user_accept',
  decisionAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sourceMessageIds: ['live-lamp-message-1'],
}

const result = await generateEngine2PanelQuestions({
  input: {
    language: 'pl',
    confirmedFindings: [finding],
    allFindings: [finding],
    activeContradictions: [],
    questions: [],
  },
  apiKey,
  aiSupportEnabled: true,
})

const summary = {
  ok: result.ok,
  questionCount: result.questionCandidates.length,
  questions: result.questionCandidates.map((question) => ({
    semanticKey: question.semanticKey,
    question: question.question,
    targetType: question.targetType,
    groundedInFindingIds: question.groundedInFindingIds,
  })),
  meta: {
    durationMs: result.meta.durationMs,
    timeoutMs: result.meta.timeoutMs,
    inputBytes: result.meta.inputBytes,
    outputBytes: result.meta.outputBytes,
    attemptCount: result.meta.attemptCount,
    model: result.meta.model,
    modelUsed: result.meta.modelUsed,
    providerRequestIds: result.meta.providerRequestIds,
    providerCallStartedAt: result.meta.providerCallStartedAt,
    providerCallResolvedAt: result.meta.providerCallResolvedAt,
    providerCallAbortedAt: result.meta.providerCallAbortedAt,
    abortReason: result.meta.abortReason,
    timeoutSource: result.meta.timeoutSource,
    responseFormatName: result.meta.responseFormatName,
    tokens: result.meta.tokens,
    errorCategory: result.meta.errorCategory,
  },
  validation: result.validation,
}

console.log(JSON.stringify(summary, null, 2))

if (!result.ok || result.questionCandidates.length !== 3) {
  process.exit(1)
}
