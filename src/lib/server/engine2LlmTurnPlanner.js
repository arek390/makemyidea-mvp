import { createHash } from 'node:crypto'
import { runLlmTask } from '../../../llm/llmRouter.mjs'
import {
  isEngine2FormalContradictionChangeEligible,
  normalizeEngine2ContradictionEvidence,
} from './engine2ContradictionEvidence.js'
import {
  directPolishDisplayText,
  ENGINE2_CONTRADICTION_STATUSES,
  validatePolishUserFacingText,
} from './engine2UserFacingText.js'

export const ENGINE2_TURN_SCHEMA_VERSION = 'engine2.turn.v3'
export const ENGINE2_QUESTION_MIGRATION_VERSION = 'engine2.questions.panel-candidates.v2'

export const ENGINE2_TURN_LIMITS = Object.freeze({
  maxFindingChanges: 6,
  maxContradictionChanges: 6,
  maxAssistantReplyChars: 600,
  maxFindingChars: 500,
  maxQuestionChars: 320,
  maxOutputTokens: 2200,
  maxInputChars: 500_000,
})

const nullableText = { type: ['string', 'null'] }
const stringArray = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 160 } }
const assistantReplySchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object', additionalProperties: false, required: ['type', 'text'],
      properties: {
        type: { type: 'string', enum: ['silent', 'acknowledgement', 'explanation', 'conversational_response'] },
        text: { type: 'string', maxLength: ENGINE2_TURN_LIMITS.maxAssistantReplyChars },
      },
    },
  ],
}
const questionDraftProperties = {
  text: { type: 'string', minLength: 1, maxLength: ENGINE2_TURN_LIMITS.maxQuestionChars },
  semanticKey: { type: 'string', minLength: 1, maxLength: 120 },
  intent: nullableText,
  reason: { type: 'string', minLength: 1, maxLength: 400 },
  sourceMessageId: { type: 'string', minLength: 1, maxLength: 160 },
}

export const ENGINE2_TURN_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  description: 'One Engine 2 v3 turn. Proposal-producing turns must not create a question; their next question is selected after decisions.',
  required: [
    'schemaVersion', 'turnKind', 'assistantReply', 'activeQuestionPresentation',
    'findingChanges', 'contradictionChanges', 'questionTransition',
  ],
  properties: {
    schemaVersion: { type: 'string', const: ENGINE2_TURN_SCHEMA_VERSION },
  turnKind: { type: 'string', enum: ['substantive_information', 'unsolicited_substantive_information', 'clarification_request', 'correction', 'conversational', 'navigation'] },
    assistantReply: assistantReplySchema,
    activeQuestionPresentation: {
      description: 'A rephrasing of the existing active question, used only for clarification_request; otherwise null.',
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false,
          required: ['text', 'reason', 'sourceMessageId'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: ENGINE2_TURN_LIMITS.maxQuestionChars },
            reason: { type: 'string', minLength: 1, maxLength: 400 },
            sourceMessageId: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      ],
    },
    findingChanges: {
      type: 'array', maxItems: ENGINE2_TURN_LIMITS.maxFindingChanges,
      items: {
        anyOf: [
          {
            type: 'object', additionalProperties: false,
            required: ['operation', 'clientRef', 'semanticKey', 'text', 'subject', 'perspective'],
            properties: {
              operation: { type: 'string', const: 'add' }, clientRef: { type: 'string', minLength: 1, maxLength: 120 },
              semanticKey: { type: 'string', minLength: 1, maxLength: 120 },
              text: { type: 'string', minLength: 1, maxLength: ENGINE2_TURN_LIMITS.maxFindingChars },
              subject: { type: 'string', enum: ['world', 'product', 'elements'] },
              perspective: { type: 'string', enum: ['current', 'not_working', 'desired'] },
            },
          },
          {
            type: 'object', additionalProperties: false,
            required: ['operation', 'findingId', 'text', 'subject', 'perspective'],
            properties: {
              operation: { type: 'string', const: 'revise' }, findingId: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1, maxLength: ENGINE2_TURN_LIMITS.maxFindingChars },
              subject: { type: ['string', 'null'], enum: ['world', 'product', 'elements', null] },
              perspective: { type: ['string', 'null'], enum: ['current', 'not_working', 'desired', null] },
            },
          },
          {
            type: 'object', additionalProperties: false, required: ['operation', 'findingId'],
            properties: { operation: { type: 'string', const: 'withdraw' }, findingId: { type: 'string', minLength: 1 } },
          },
        ],
      },
    },
    contradictionChanges: {
      type: 'array', maxItems: ENGINE2_TURN_LIMITS.maxContradictionChanges,
      items: {
        type: 'object', additionalProperties: false,
        required: [
          'operation', 'contradictionId', 'semanticKey', 'description', 'sideA', 'sideB',
          'sourceFindingIds', 'sourceMessageIds', 'sideASourceFindingIds',
          'sideBSourceFindingIds', 'sideASourceMessageIds', 'sideBSourceMessageIds',
          'status', 'reportBlocking', 'verificationQuestionId', 'resolutionFindingIds',
          'evidenceStatus', 'origin', 'formalEligible', 'rejectionReason',
        ],
        properties: {
          operation: { type: 'string', enum: ['create', 'update', 'resolve', 'dismiss', 'supersede'] },
          contradictionId: { type: ['string', 'null'] }, semanticKey: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', minLength: 1, maxLength: 400 },
          sideA: { type: 'string', minLength: 1, maxLength: 240 },
          sideB: { type: 'string', minLength: 1, maxLength: 240 },
          sourceFindingIds: stringArray,
          sourceMessageIds: stringArray,
          sideASourceFindingIds: stringArray,
          sideBSourceFindingIds: stringArray,
          sideASourceMessageIds: stringArray,
          sideBSourceMessageIds: stringArray,
          status: { type: 'string', enum: ENGINE2_CONTRADICTION_STATUSES },
          reportBlocking: { type: 'boolean' },
          verificationQuestionId: { type: ['string', 'null'] },
          resolutionFindingIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 160 } },
          evidenceStatus: { type: 'string', enum: ['confirmed_requirement_tension', 'exploration_hypothesis', 'alternative_or_mode'] },
          origin: { type: 'string', enum: ['user_requirements', 'matrix_hypothesis', 'heuristic'] },
          formalEligible: { type: 'boolean' },
          rejectionReason: { type: ['string', 'null'], maxLength: 300 },
        },
      },
    },
    questionTransition: {
      description: 'Question-ledger mutation. Must be null when findings or contradictions are proposed, except for a supported close of the current question.',
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false,
          required: ['type', 'questionId', 'outcome', 'reason', 'sourceMessageId', 'evidenceFindingRefs'],
          properties: {
            type: { type: 'string', const: 'close' }, questionId: { type: 'string', minLength: 1, maxLength: 120 },
            outcome: { type: 'string', enum: ['answered', 'skipped'] }, reason: questionDraftProperties.reason,
            sourceMessageId: questionDraftProperties.sourceMessageId, evidenceFindingRefs: stringArray,
          },
        },
      ],
    },
  },
}

export const ENGINE2_TURN_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'engine2_turn_v3', strict: true, schema: ENGINE2_TURN_JSON_SCHEMA },
}

export const ENGINE2_TURN_SYSTEM_PROMPT = `You are the semantic turn interpreter for Engine 2.
Return exactly one engine2.turn.v3 object. First classify the user's conversational act as exactly one turnKind.

substantive_information contains concrete domain facts, needs, constraints, criteria or requirements that answer an explicit replyToQuestionId. Preserve every valuable fact as pending finding changes.
unsolicited_substantive_information contains concrete domain facts, needs, constraints, criteria or requirements when the user did not choose a question. Preserve every valuable fact as pending finding changes and do not close any question.
clarification_request asks what the current question means, asks for an example, or asks for simpler wording. It is not an answer. Return no finding or contradiction changes, no questionTransition, and provide activeQuestionPresentation with a clearer presentation of the same active question. Do not create a fact saying that the user did not understand.
correction revises or withdraws an earlier finding. Return the corresponding finding changes; they remain proposals until the user decides.
conversational is social or non-substantive conversation. It changes no ledger state.
navigation skips the active question or changes topic. Use close(skipped) for an existing selected question, or null; do not invent a finding and do not create a replacement question.

assistantReply is prose only: silent, acknowledgement, explanation, or conversational_response. For substantive_information and unsolicited_substantive_information prefer assistantReply=null or {type:"silent",text:""}; do not thank or paraphrase the answer. It is never the source of a question the user must answer. Questions are selected by the readiness evaluator and shown in the right panel after decisions, not by this planner.
There is no automatic active chat question. Omission means no change; there is no keep operation. New panel questions are created only by generate_panel_questions, never by this planner.
activeQuestionPresentation is allowed only for clarification_request and only when an active question already exists. It presents that same question ID; never copy a newly proposed question into both activeQuestionPresentation and questionTransition.
When substantive information supports answering the active question, close it with evidenceFindingRefs pointing to same-turn finding clientRefs or existing finding IDs. The backend stages that closure with pending proposals.
During every substantive analysis, compare current state, not-working facts, desired results, usage contexts, constraints, success criteria and existing contradictions. Return contradictionChanges when the new answer detects, confirms, dismisses or resolves a real tension. Use status=suspected for a potential tension inferred from findings that still needs checking, open for a user-confirmed unresolved tension, resolved when a resolution/decision is captured, and dismissed when the tension does not apply.
Do not create formal contradictions from model assumptions, matrix-inspired parameters, or a single user requirement plus an inferred missing side. A formal contradiction requires two user-provided or confirmed requirements with sideA/sideB evidence.
Treat switchable/regulatable modes or ranges requested by the user as alternative_or_mode, not as a contradiction.
If the user's answer contains an internally ambiguous alternative or tension, do not turn it into a single definite desired finding. Keep any finding cautious and add contradictionChanges for the ambiguity/tension.
Example: for "jedna strefa na raz / jednocześnie", do not write only "Użytkownik chce regulować jedną strefę na raz lub jednocześnie." Instead add a suspected reportBlocking tension: description "Niejasne, czy użytkownik chce sterować jedną strefą, kilkoma strefami niezależnie, czy kilkoma strefami jednocześnie."; sideA "Sterowanie jedną strefą naraz"; sideB "Sterowanie wieloma strefami jednocześnie lub jednym ustawieniem".
When language=Polish, every user-facing field must be Polish and must address the user directly. Use "Chcesz...", "Potrzebujesz..." or "Warto ustalić..." wording. Do not write user-facing text like "Użytkownik chce...". Internal finding text may describe the fact, but any question, assistant reply, presentation or visible reason must be direct Polish.
Never return a question-creating transition. The application first shows the decision package; after the decisions, generate_panel_questions chooses three panel questions. A proposal turn may return only a supported close(answered) for the explicit replyToQuestionId or questionTransition=null. If there is no replyToQuestionId, return unsolicited_substantive_information and questionTransition=null.
On the first substantive message, return the findings without a new question. Do not try to fill an empty active-question state; the readiness evaluator does that after decisions.
Do not return answerCoverage, keep, supersede, reopen, parentQuestionId, nextQuestionId, materialScore, reportScore, reportAvailable, candidate_report_ready, conversationStatus, criticalMissing or readiness.
Use the complete conversation for interpretation. Output only strict JSON.`

const toText = (value, max = 0) => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return max ? normalized.slice(0, max) : normalized
}
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const stableId = (prefix, value) => `${prefix}-${createHash('sha256').update(String(value)).digest('hex').slice(0, 20)}`
const CLOSED = new Set(['answered', 'covered', 'obsolete', 'dismissed', 'superseded', 'resolved', 'retired', 'skipped', 'replaced'])
const CONTRADICTION_STATUSES = new Set(ENGINE2_CONTRADICTION_STATUSES)
const AMBIGUOUS_ALTERNATIVE_RE = /(\s\/\s|\/|jedn(ą|a|ej)\s+[^.!?]{0,80}\b(jednocze[sś]nie|naraz)|jednocze[sś]nie\s+(i|oraz|albo|lub)\s+[^.!?]{0,80}\b(osobno|oddzielnie|niezale[zż]nie)|\b(proste|tanie|sztywne)\b[^.!?]{0,80}\bale\b[^.!?]{0,80}\b(precyzyjne|premium|elastyczne)\b)/i
const DEFINITE_ALTERNATIVE_FINDING_RE = /\b(chce|potrzebuje|ma|musi|będzie)\b[^.!?]{0,160}\b(lub|albo|jednocze[sś]nie|naraz)\b/i
const normalizeSemanticKey = (value) => toText(value, 120).replace(/^\/+/, '')
const assignedFindingId = ({ trialId, messageId, semanticKey }) => stableId('engine2-finding', `${trialId}:${messageId}:${semanticKey}`)
const assignedProposalId = ({ trialId, messageId, semanticKey }) => stableId('engine2-finding', `${trialId}:${messageId}:${semanticKey}:proposal`)
export const assignedEngine2QuestionId = ({ trialId, sourceMessageId, semanticKey }) =>
  stableId('engine2-question', `${trialId}:${sourceMessageId}:${semanticKey}`)

const normalizeQuestion = (question) => ({
  ...question,
  id: toText(question?.id ?? question?.questionId, 120),
  // Compatibility input: old question objects may only have gapKey.
  semanticKey: normalizeSemanticKey(question?.semanticKey || question?.gapKey || question?.id),
  question: toText(question?.question || question?.text, ENGINE2_TURN_LIMITS.maxQuestionChars),
  text: toText(question?.question || question?.text, ENGINE2_TURN_LIMITS.maxQuestionChars),
  intent: toText(question?.intent || question?.semanticKey || question?.question || question?.text, ENGINE2_TURN_LIMITS.maxQuestionChars),
  status: question?.status === 'resolved' ? 'answered' : question?.status === 'retired' ? 'superseded' : question?.status || 'open',
  presentation: ['ask_now', 'ask_later', 'panel'].includes(question?.presentation)
    ? 'panel'
    : question?.presentation || 'hidden',
  answeredByMessageIds: Array.isArray(question?.answeredByMessageIds) ? question.answeredByMessageIds : [],
  coveredByFindingIds: Array.isArray(question?.coveredByFindingIds) ? question.coveredByFindingIds : [],
})

export const migrateEngine2QuestionLedger = ({ questions = [], activeQuestionId = null, questionBacklog = [] } = {}) => {
  const byId = new Map()
  // Compatibility input: old payloads may still send panel questions in questionBacklog.
  for (const raw of [...questions, ...questionBacklog]) {
    const question = normalizeQuestion(raw)
    if (question.id && question.question) byId.set(question.id, { ...(byId.get(question.id) || {}), ...question })
  }
  const ordered = [...byId.values()]
  const open = ordered.filter((question) => question.status === 'open' || question.status === 'backlog')
  const selected = null
  let panelCount = 0
  const migratedQuestions = ordered.map((question) => {
    const isOpen = question.status === 'open' || question.status === 'backlog'
    if (!isOpen) return { ...question, presentation: 'hidden' }
    if (panelCount < 3) {
      panelCount += 1
      return { ...question, status: 'open', presentation: 'panel' }
    }
    return { ...question, status: 'open', presentation: 'hidden' }
  })
  return {
    questions: migratedQuestions,
    activeQuestion: selected ? migratedQuestions.find((question) => question.id === selected.id) || null : null,
    activeQuestionId: selected?.id || null,
    migrationVersion: ENGINE2_QUESTION_MIGRATION_VERSION,
  }
}

const canonicalFindingChanges = (rawChanges) => (Array.isArray(rawChanges) ? rawChanges : []).map((change, index) => {
  if (!isObject(change)) return change
  if (change.operation === 'add') return {
    operation: 'add', clientRef: normalizeSemanticKey(change.clientRef) || `finding_${index + 1}`,
    semanticKey: normalizeSemanticKey(change.semanticKey), text: toText(change.text, ENGINE2_TURN_LIMITS.maxFindingChars),
    subject: change.subject, perspective: change.perspective,
  }
  if (change.operation === 'revise') return {
    operation: 'revise', findingId: toText(change.findingId, 120), text: toText(change.text, ENGINE2_TURN_LIMITS.maxFindingChars),
    subject: change.subject ?? null, perspective: change.perspective ?? null,
  }
  if (change.operation === 'withdraw') return { operation: 'withdraw', findingId: toText(change.findingId, 120) }
  return change
})

const normalizeIdArray = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((entry) => toText(entry, 160))
  .filter(Boolean))]

const canonicalContradictionChanges = (rawChanges) => (Array.isArray(rawChanges) ? rawChanges : []).map((change) => {
  if (!isObject(change)) return change
  const sourceFindingIds = normalizeIdArray(change.sourceFindingIds ?? change.findingIds)
  const sourceMessageIds = normalizeIdArray(change.sourceMessageIds ?? change.messageIds)
  const resolutionFindingIds = normalizeIdArray(change.resolutionFindingIds)
  return normalizeEngine2ContradictionEvidence({
    operation: change.operation,
    contradictionId: change.contradictionId === undefined || change.contradictionId === null ? null : toText(change.contradictionId, 120),
    semanticKey: normalizeSemanticKey(change.semanticKey),
    description: toText(change.description, 400),
    sideA: toText(change.sideA, 240),
    sideB: toText(change.sideB, 240),
    sourceFindingIds,
    sourceMessageIds,
    sideASourceFindingIds: normalizeIdArray(change.sideASourceFindingIds ?? change.sideAFindingIds),
    sideBSourceFindingIds: normalizeIdArray(change.sideBSourceFindingIds ?? change.sideBFindingIds),
    sideASourceMessageIds: normalizeIdArray(change.sideASourceMessageIds ?? change.sideAMessageIds),
    sideBSourceMessageIds: normalizeIdArray(change.sideBSourceMessageIds ?? change.sideBMessageIds),
    findingIds: sourceFindingIds,
    messageIds: sourceMessageIds,
    status: CONTRADICTION_STATUSES.has(change.status) ? change.status : 'suspected',
    reportBlocking: Boolean(change.reportBlocking),
    verificationQuestionId: toText(change.verificationQuestionId ?? change.resolutionQuestionId, 120) || null,
    resolutionQuestionId: toText(change.verificationQuestionId ?? change.resolutionQuestionId, 120) || null,
    resolutionFindingIds,
    evidenceStatus: toText(change.evidenceStatus, 80),
    origin: toText(change.origin, 80),
    formalEligible: change.formalEligible === true,
    rejectionReason: toText(change.rejectionReason, 300) || null,
  })
})

export const canonicalizeEngine2TurnDelta = (raw, context = {}) => {
  if (!isObject(raw)) return { delta: raw, changes: [] }
  const changes = []
  const rawReplyTargetId = toText(context.effectiveReplyToGapId || context.replyToGapId, 120) || null
  const turnKind = raw.turnKind === 'substantive_information' && !rawReplyTargetId
    ? 'unsolicited_substantive_information'
    : raw.turnKind
  if (turnKind !== raw.turnKind) changes.push('substantive_information reclassified as unsolicited_substantive_information without replyToQuestionId')
  const findingChanges = canonicalFindingChanges(raw.findingChanges)
  const addRefByKey = new Map(findingChanges.filter((c) => c?.operation === 'add').map((c) => [c.semanticKey, c.clientRef]))
  const normalizeRefs = (refs) => [...new Set((Array.isArray(refs) ? refs : []).map((ref) => {
    const value = normalizeSemanticKey(ref)
    return addRefByKey.get(value) || value
  }).filter(Boolean))]
  let transition = isObject(raw.questionTransition) ? {
    ...raw.questionTransition,
    questionId: raw.questionTransition.questionId === undefined ? undefined : toText(raw.questionTransition.questionId, 120),
    text: raw.questionTransition.text === undefined ? undefined : toText(raw.questionTransition.text, ENGINE2_TURN_LIMITS.maxQuestionChars),
    semanticKey: raw.questionTransition.semanticKey === undefined ? undefined : normalizeSemanticKey(raw.questionTransition.semanticKey),
    intent: raw.questionTransition.intent === undefined ? undefined : toText(raw.questionTransition.intent, ENGINE2_TURN_LIMITS.maxQuestionChars) || null,
    reason: toText(raw.questionTransition.reason, 400), sourceMessageId: toText(raw.questionTransition.sourceMessageId, 160),
    ...(raw.questionTransition.evidenceFindingRefs !== undefined ? { evidenceFindingRefs: normalizeRefs(raw.questionTransition.evidenceFindingRefs) } : {}),
  } : raw.questionTransition
  const contradictionChanges = Array.isArray(raw.contradictionChanges)
    ? canonicalContradictionChanges(raw.contradictionChanges).map((change, index) => {
        if (!isObject(change) || change.operation !== 'create' || change.contradictionId === null) return change
        changes.push(`contradictionChanges[${index}].contradictionId cleared for backend assignment`)
        return { ...change, contradictionId: null }
      })
    : raw.contradictionChanges
  let activeQuestionPresentation = isObject(raw.activeQuestionPresentation) ? {
    text: toText(raw.activeQuestionPresentation.text, ENGINE2_TURN_LIMITS.maxQuestionChars),
    reason: toText(raw.activeQuestionPresentation.reason, 400), sourceMessageId: toText(raw.activeQuestionPresentation.sourceMessageId, 160),
  } : raw.activeQuestionPresentation
  if (turnKind !== 'clarification_request' && activeQuestionPresentation !== null && activeQuestionPresentation !== undefined) {
    activeQuestionPresentation = null
    changes.push('activeQuestionPresentation removed outside clarification_request')
  }
  if (turnKind === 'clarification_request' && transition !== null && transition !== undefined) {
    transition = null
    changes.push('questionTransition removed from clarification_request')
  }
  return {
    delta: {
      schemaVersion: raw.schemaVersion,
      turnKind,
      assistantReply: isObject(raw.assistantReply) ? { type: raw.assistantReply.type, text: toText(raw.assistantReply.text, ENGINE2_TURN_LIMITS.maxAssistantReplyChars) } : raw.assistantReply,
      activeQuestionPresentation,
      findingChanges,
      contradictionChanges,
      questionTransition: transition,
    },
    changes,
  }
}

export const validateEngine2TurnDelta = (delta, context = {}) => {
  const errors = []
  if (!isObject(delta)) return { ok: false, errors: ['response must be an object'] }
  if (delta.schemaVersion !== ENGINE2_TURN_SCHEMA_VERSION) errors.push(`schemaVersion must equal ${ENGINE2_TURN_SCHEMA_VERSION}`)
  const kinds = ['substantive_information', 'unsolicited_substantive_information', 'clarification_request', 'correction', 'conversational', 'navigation']
  if (!kinds.includes(delta.turnKind)) errors.push('turnKind is invalid')
  if (delta.assistantReply !== null && (!isObject(delta.assistantReply) || !['silent', 'acknowledgement', 'explanation', 'conversational_response'].includes(delta.assistantReply.type) || (delta.assistantReply.type !== 'silent' && !toText(delta.assistantReply.text)))) {
    errors.push('assistantReply is invalid')
  }
  if (isObject(delta.assistantReply) && delta.assistantReply.type !== 'silent') {
    validatePolishUserFacingText({ value: delta.assistantReply.text, path: 'assistantReply.text', errors, language: context.language })
  }
  const findings = Array.isArray(context.findings) ? context.findings : []
  const findingById = new Map(findings.map((finding) => [finding.id, finding]))
  const contradictionById = new Map((Array.isArray(context.contradictions) ? context.contradictions : []).map((contradiction) => [contradiction.id, contradiction]))
  const messages = new Set((context.conversation || []).map((message) => message.id))
  const migrated = migrateEngine2QuestionLedger({ questions: context.questions, activeQuestionId: context.activeQuestionId, questionBacklog: context.questionBacklog })
  const active = migrated.activeQuestion
  const replyTargetId = toText(context.effectiveReplyToGapId || context.replyToGapId, 120) || null
  const replyTarget = replyTargetId
    ? migrated.questions.find((question) => question.id === replyTargetId && question.status === 'open') || null
    : null
  const transitionTarget = replyTarget || active
  const clientRefs = new Set()
  if (!Array.isArray(delta.findingChanges) || delta.findingChanges.length > ENGINE2_TURN_LIMITS.maxFindingChanges) errors.push('findingChanges is invalid')
  for (const [index, change] of (delta.findingChanges || []).entries()) {
    if (!isObject(change) || !['add', 'revise', 'withdraw'].includes(change.operation)) { errors.push(`findingChanges[${index}] operation is invalid`); continue }
    if (change.operation === 'add') {
      if (!toText(change.clientRef) || clientRefs.has(change.clientRef)) errors.push(`findingChanges[${index}] clientRef must be unique`)
      if (!toText(change.semanticKey) || !toText(change.text)) errors.push(`findingChanges[${index}] requires semanticKey and text`)
      validatePolishUserFacingText({ value: change.text, path: `findingChanges[${index}].text`, errors, language: context.language, allowThirdPerson: true })
      clientRefs.add(change.clientRef)
    } else {
      if (!findingById.has(change.findingId)) errors.push(`findingChanges[${index}] targets unknown finding: ${change.findingId}`)
      else if (findingById.get(change.findingId)?.status === 'rejected') errors.push(`findingChanges[${index}] targets a rejected finding`)
      if (change.operation === 'revise') validatePolishUserFacingText({ value: change.text, path: `findingChanges[${index}].text`, errors, language: context.language, allowThirdPerson: true })
    }
  }
  if (!Array.isArray(delta.contradictionChanges) || delta.contradictionChanges.length > ENGINE2_TURN_LIMITS.maxContradictionChanges) errors.push('contradictionChanges is invalid')
  for (const [index, change] of (delta.contradictionChanges || []).entries()) {
    if (!isObject(change) || !['create', 'update', 'resolve', 'dismiss', 'supersede'].includes(change.operation)) {
      errors.push(`contradictionChanges[${index}] operation is invalid`)
      continue
    }
    if (change?.operation === 'create' && change.contradictionId !== null) errors.push(`contradictionChanges[${index}] create ID must be assigned by backend`)
    if (change?.operation !== 'create' && !contradictionById.has(change?.contradictionId)) errors.push(`contradictionChanges[${index}] targets unknown contradiction`)
    if (!toText(change.semanticKey, 120) || !toText(change.description, 400)) errors.push(`contradictionChanges[${index}] requires semanticKey and description`)
    if (!toText(change.sideA, 240) || !toText(change.sideB, 240)) errors.push(`contradictionChanges[${index}] requires sideA and sideB`)
    validatePolishUserFacingText({ value: change.description, path: `contradictionChanges[${index}].description`, errors, language: context.language })
    validatePolishUserFacingText({ value: change.sideA, path: `contradictionChanges[${index}].sideA`, errors, language: context.language })
    validatePolishUserFacingText({ value: change.sideB, path: `contradictionChanges[${index}].sideB`, errors, language: context.language })
    if (!CONTRADICTION_STATUSES.has(change.status)) errors.push(`contradictionChanges[${index}] status is invalid`)
    if (typeof change.reportBlocking !== 'boolean') errors.push(`contradictionChanges[${index}] reportBlocking is required`)
    const sourceFindingIds = change.sourceFindingIds || change.findingIds || []
    const sourceMessageIds = change.sourceMessageIds || change.messageIds || []
    if (!Array.isArray(sourceFindingIds) || sourceFindingIds.length === 0) errors.push(`contradictionChanges[${index}] requires sourceFindingIds`)
    if (!Array.isArray(sourceMessageIds) || sourceMessageIds.length === 0) errors.push(`contradictionChanges[${index}] requires sourceMessageIds`)
    for (const id of sourceFindingIds) if (!findingById.has(id) && !clientRefs.has(id)) errors.push(`contradictionChanges[${index}] references unknown finding: ${id}`)
    for (const id of sourceMessageIds) if (!messages.has(id)) errors.push(`contradictionChanges[${index}] references unknown message: ${id}`)
    for (const id of change.resolutionFindingIds || []) if (!findingById.has(id)) errors.push(`contradictionChanges[${index}] references unknown resolution finding: ${id}`)
    if (change?.verificationQuestionId && !migrated.questions.some((question) => question.id === change.verificationQuestionId)) errors.push(`contradictionChanges[${index}] references unknown verification question`)
  }
  const sourceMessageId = context.messageId || context.lastUserMessageId
  const presentation = delta.activeQuestionPresentation
  if (presentation !== null) {
    if (!isObject(presentation) || !toText(presentation.text) || presentation.sourceMessageId !== sourceMessageId) errors.push('activeQuestionPresentation is invalid')
    validatePolishUserFacingText({ value: presentation.text, path: 'activeQuestionPresentation.text', errors, language: context.language, question: true })
    validatePolishUserFacingText({ value: presentation.reason, path: 'activeQuestionPresentation.reason', errors, language: context.language })
    if (!active) errors.push('activeQuestionPresentation requires an active question')
  }
  const transition = delta.questionTransition
  if (transition !== null) {
    if (!isObject(transition) || !['close'].includes(transition.type)) errors.push('questionTransition is invalid')
    else {
      if (transition.sourceMessageId !== sourceMessageId || !messages.has(transition.sourceMessageId)) errors.push('questionTransition sourceMessageId is invalid')
      if (!transitionTarget || transition.questionId !== transitionTarget.id) errors.push('questionTransition must target the effective reply question')
      if (!['answered', 'skipped'].includes(transition.outcome)) errors.push('close outcome is invalid')
      for (const ref of transition.evidenceFindingRefs || []) if (!findingById.has(ref) && !clientRefs.has(ref)) errors.push(`questionTransition references unknown finding: ${ref}`)
      if (transition.outcome === 'answered' && (transition.evidenceFindingRefs || []).length === 0) errors.push('answered close requires finding evidence')
    }
  }
  if (delta.turnKind === 'clarification_request') {
    if ((delta.findingChanges || []).length || (delta.contradictionChanges || []).length || transition !== null) errors.push('clarification_request cannot mutate ledgers')
    if (!presentation) errors.push('clarification_request requires activeQuestionPresentation')
  } else if (presentation !== null) errors.push('activeQuestionPresentation is only allowed for clarification_request')
  if (['substantive_information', 'unsolicited_substantive_information'].includes(delta.turnKind) && (delta.findingChanges || []).length === 0) errors.push(`${delta.turnKind} requires finding changes`)
  const latestUserMessage = (context.conversation || []).find((message) => message?.id === sourceMessageId && message?.role === 'user')
  const hasAmbiguousAlternative = AMBIGUOUS_ALTERNATIVE_RE.test(toText(latestUserMessage?.content || ''))
  const hasActiveTensionChange = (delta.contradictionChanges || []).some((change) => ['create', 'update'].includes(change?.operation) && ['suspected', 'open', 'confirmed', 'active'].includes(change?.status))
  const hasDefiniteAlternativeFinding = (delta.findingChanges || []).some((change) => change?.operation === 'add' && DEFINITE_ALTERNATIVE_FINDING_RE.test(toText(change.text)))
  if (hasAmbiguousAlternative && hasDefiniteAlternativeFinding && !hasActiveTensionChange) {
    errors.push('ambiguous alternative answer requires a contradiction/tension change or a cautious non-definitive finding')
  }
  if (delta.turnKind === 'substantive_information' && replyTarget && (delta.findingChanges || []).length > 0) {
    if (transition?.type !== 'close' || transition.questionId !== replyTarget.id || transition.outcome !== 'answered') {
      errors.push('substantive_information answering a question requires staged close(answered) for the effective reply question')
    }
  }
  if (['substantive_information', 'unsolicited_substantive_information'].includes(delta.turnKind) && !replyTarget && transition?.type === 'close') {
    errors.push('unsolicited substantive information cannot close a question without replyToQuestionId')
  }
  if (delta.turnKind === 'unsolicited_substantive_information' && transition !== null) errors.push('unsolicited_substantive_information cannot change question state')
  if (delta.turnKind === 'correction' && !(delta.findingChanges || []).some((change) => ['revise', 'withdraw'].includes(change.operation))) errors.push('correction requires revise or withdraw')
  if (['conversational', 'navigation'].includes(delta.turnKind) && ((delta.findingChanges || []).length || (delta.contradictionChanges || []).length)) errors.push(`${delta.turnKind} cannot mutate findings or contradictions`)
  if (delta.turnKind === 'conversational' && transition !== null) errors.push('conversational cannot change the active question')
  if (delta.turnKind === 'conversational' && !delta.assistantReply) errors.push('conversational requires an assistantReply')
  if (delta.turnKind === 'navigation' && transition?.type === 'close' && transition.outcome !== 'skipped') errors.push('navigation close must be skipped')
  if (delta.turnKind === 'navigation' && !transition && !delta.assistantReply) errors.push('navigation without a question close requires an assistantReply')
  return { ok: errors.length === 0, errors, migratedQuestions: migrated }
}

const findingCategory = (perspective) => perspective === 'desired' ? 'goal' : perspective === 'not_working' ? 'constraint' : 'fact'
const matrixColumn = (perspective) => perspective === 'desired' ? 'should_be' : perspective === 'not_working' ? 'not_working' : 'as_is'
const matrixCell = (subject, perspective) => `${{ world: 'A', product: 'B', elements: 'C' }[subject]}${{ current: '1', not_working: '2', desired: '3' }[perspective]}`

const applyImmediateQuestionTransition = ({ questions, transition, trialId, messageId, now, evidenceFindingIds = [] }) => {
  const next = questions.map((question) => ({ ...question }))
  const events = []
  if (!transition) return { questions: next, events }
  if (transition.type === 'close') {
    const index = next.findIndex((question) => question.id === transition.questionId && question.status === 'open')
    if (index >= 0) {
      next[index] = {
        ...next[index], status: transition.outcome, presentation: 'hidden', closedReason: transition.reason,
        answeredByMessageIds: [...new Set([...(next[index].answeredByMessageIds || []), transition.sourceMessageId])],
        coveredByFindingIds: [...new Set([...(next[index].coveredByFindingIds || []), ...evidenceFindingIds])], updatedAt: now,
      }
      events.push({ id: stableId('engine2-question-event', `${messageId}:${transition.outcome}:${transition.questionId}`), entityId: transition.questionId, operation: transition.outcome, messageId, createdAt: now })
    }
  }
  return { questions: migrateEngine2QuestionLedger({ questions: next }).questions, events }
}

export const applyStagedEngine2QuestionTransition = ({ questions = [], questionEvents = [], transition = null, findings = [], trialId, messageId, now = new Date().toISOString() }) => {
  if (!transition) return { questions, questionEvents, applied: false }
  const confirmed = new Set(findings.filter((finding) => finding.status === 'confirmed').map((finding) => finding.id))
  const evidence = (transition.evidenceFindingIds || []).filter((id) => confirmed.has(id))
  if (transition.outcome === 'answered' && evidence.length === 0) return { questions, questionEvents, applied: false }
  const applied = applyImmediateQuestionTransition({ questions, transition: { ...transition, evidenceFindingRefs: evidence }, trialId, messageId, now, evidenceFindingIds: evidence })
  return { questions: applied.questions, questionEvents: [...questionEvents, ...applied.events], applied: applied.events.length > 0 }
}

export const applyEngine2TurnDelta = ({ delta, findings = [], contradictions = [], questions = [], findingEvents = [], questionEvents = [], trialId, messageId, activeQuestionId = null, questionBacklog = [], previousReadiness = null, language = 'pl', now = new Date().toISOString() }) => {
  const nextFindings = findings.map((finding) => ({ ...finding }))
  const nextContradictions = contradictions.map((entry) => ({ ...entry }))
  const nextFindingEvents = [...findingEvents]
  const appliedFindingChanges = []
  const appliedContradictionChanges = []
  const evidenceMap = new Map()
  for (const [index, change] of delta.findingChanges.entries()) {
    if (change.operation === 'add') {
      const id = assignedFindingId({ trialId, messageId, semanticKey: change.semanticKey })
      evidenceMap.set(change.clientRef, id)
      if (!nextFindings.some((finding) => finding.id === id)) nextFindings.push({
        id, semanticKey: change.semanticKey, category: findingCategory(change.perspective), categoryLabel: 'Ustalenie', content: change.text, text: change.text,
        displayText: directPolishDisplayText(change.text, { language, max: ENGINE2_TURN_LIMITS.maxFindingChars }),
        status: 'pending', subject: change.subject, perspective: change.perspective, source: 'ai_interpretation', sourceMessageIds: [messageId],
        internal: { matrixRow: change.subject, matrixCol: matrixColumn(change.perspective), matrixCell: matrixCell(change.subject, change.perspective), confidence: null },
        proposedOperation: 'add', targetFindingId: null, updatedAt: now,
      })
      appliedFindingChanges.push({ ...change, assignedFindingId: id })
      nextFindingEvents.push({ id: stableId('engine2-finding-event', `${messageId}:${index}`), entityId: id, operation: 'add', messageId, createdAt: now })
      continue
    }
    const target = nextFindings.find((finding) => finding.id === change.findingId)
    if (!target) continue
    const id = assignedProposalId({ trialId, messageId, semanticKey: target.semanticKey || target.id })
    evidenceMap.set(change.findingId, id)
    const proposalContent = change.operation === 'revise' ? change.text : target.content
    if (!nextFindings.some((finding) => finding.id === id)) nextFindings.push({
      ...target, id, content: proposalContent, text: proposalContent,
      displayText: directPolishDisplayText(proposalContent, { language, max: ENGINE2_TURN_LIMITS.maxFindingChars }),
      status: 'pending', source: 'ai_interpretation', originalContent: target.content,
      sourceMessageIds: [...new Set([...(target.sourceMessageIds || []), messageId])], proposedOperation: change.operation, targetFindingId: target.id, updatedAt: now,
    })
    appliedFindingChanges.push({ ...change, assignedFindingId: id, protectedConfirmedFinding: target.status === 'confirmed' })
    nextFindingEvents.push({ id: stableId('engine2-finding-event', `${messageId}:${index}`), entityId: id, operation: change.operation, messageId, createdAt: now })
  }
  for (const change of delta.contradictionChanges) {
    const resolvedSourceFindingIds = (change.sourceFindingIds || change.findingIds || []).map((id) => evidenceMap.get(id) || id)
    const resolvedSideASourceFindingIds = (change.sideASourceFindingIds || []).map((id) => evidenceMap.get(id) || id)
    const resolvedSideBSourceFindingIds = (change.sideBSourceFindingIds || []).map((id) => evidenceMap.get(id) || id)
    const normalizedChange = {
      ...change,
      sourceFindingIds: resolvedSourceFindingIds,
      findingIds: resolvedSourceFindingIds,
      sideASourceFindingIds: resolvedSideASourceFindingIds,
      sideBSourceFindingIds: resolvedSideBSourceFindingIds,
    }
    const evidenceCheckedChange = normalizeEngine2ContradictionEvidence(normalizedChange, { findings: nextFindings })
    if (!isEngine2FormalContradictionChangeEligible(evidenceCheckedChange)) {
      appliedContradictionChanges.push({
        ...evidenceCheckedChange,
        skipped: true,
        skipReason: evidenceCheckedChange.rejectionReason || 'missing_two_sided_user_evidence',
      })
      continue
    }
    const assignedContradictionId = change.operation === 'create'
      ? stableId('engine2-contradiction', `${trialId}:${normalizedChange.semanticKey}`)
      : evidenceCheckedChange.contradictionId
    const index = nextContradictions.findIndex((entry) => (
      entry.id === assignedContradictionId || (normalizedChange.operation === 'create' && entry.semanticKey === normalizedChange.semanticKey)
    ))
    if (normalizedChange.operation === 'create' && index < 0) {
      const contradiction = Object.fromEntries(Object.entries(evidenceCheckedChange).filter(([key]) => !['operation', 'contradictionId'].includes(key)))
      nextContradictions.push({
        ...contradiction, id: assignedContradictionId,
        status: evidenceCheckedChange.status || 'suspected', firstDetectedAt: now, updatedAt: now,
      })
    }
    else if (index >= 0) {
      const mergedFindingIds = [...new Set([...(nextContradictions[index].sourceFindingIds || nextContradictions[index].findingIds || []), ...(evidenceCheckedChange.sourceFindingIds || evidenceCheckedChange.findingIds || [])])]
      const mergedMessageIds = [...new Set([...(nextContradictions[index].sourceMessageIds || nextContradictions[index].messageIds || []), ...(evidenceCheckedChange.sourceMessageIds || evidenceCheckedChange.messageIds || [])])]
      nextContradictions[index] = {
        ...nextContradictions[index],
        ...evidenceCheckedChange,
        id: nextContradictions[index].id,
        sourceFindingIds: mergedFindingIds,
        findingIds: mergedFindingIds,
        sourceMessageIds: mergedMessageIds,
        messageIds: mergedMessageIds,
        updatedAt: now,
        resolvedAt: evidenceCheckedChange.status === 'resolved' ? now : nextContradictions[index].resolvedAt || null,
      }
    }
    appliedContradictionChanges.push({ ...evidenceCheckedChange, assignedContradictionId: index >= 0 ? nextContradictions[index].id : assignedContradictionId })
  }
  const migrated = migrateEngine2QuestionLedger({ questions, activeQuestionId, questionBacklog })
  const evidenceFindingIds = (delta.questionTransition?.evidenceFindingRefs || []).map((ref) => evidenceMap.get(ref) || ref)
  const shouldStage = delta.findingChanges.length > 0 && delta.questionTransition?.type === 'close' && delta.questionTransition.outcome === 'answered'
  const stagedQuestionTransition = shouldStage ? { ...delta.questionTransition, evidenceFindingIds } : null
  const immediate = shouldStage
    ? { questions: migrated.questions, events: [] }
    : applyImmediateQuestionTransition({ questions: migrated.questions, transition: delta.questionTransition, trialId, messageId, now, evidenceFindingIds })
  const finalLedger = migrateEngine2QuestionLedger({ questions: immediate.questions })
  return {
    ok: true, findings: nextFindings, findingEvents: nextFindingEvents, contradictions: nextContradictions,
    questions: finalLedger.questions, questionEvents: [...questionEvents, ...immediate.events], activeQuestion: finalLedger.activeQuestion,
    activeQuestionId: finalLedger.activeQuestionId,
    openQuestions: finalLedger.questions.filter((question) => question.status === 'open' && question.presentation === 'panel').slice(0, 3),
    stagedQuestionTransition, assistantReply: delta.assistantReply,
    activeQuestionPresentation: delta.activeQuestionPresentation && finalLedger.activeQuestion ? { ...delta.activeQuestionPresentation, questionId: finalLedger.activeQuestion.id } : null,
    readiness: {
      materialScore: Number(previousReadiness?.materialScore ?? 0) || 0,
      reportScore: Number(previousReadiness?.reportScore ?? previousReadiness?.score ?? 0) || 0,
      criticalMissing: previousReadiness?.criticalMissing || [],
      reportAvailable: false,
    },
    reportAvailable: false, appliedFindingChanges, appliedContradictionChanges, appliedQuestionChanges: delta.questionTransition ? [delta.questionTransition] : [],
  }
}

const parseObject = (raw) => { try { const parsed = JSON.parse(raw); return isObject(parsed) ? parsed : null } catch { return null } }
const buildPlannerInput = (input, repair = null) => JSON.stringify({
  action: 'analyze_message', language: input.language,
  sessionSnapshot: {
    schemaVersion: 'engine2.session.v5', conversation: input.conversation, findings: input.findings, contradictions: input.contradictions,
    questions: input.questions, activeQuestionId: input.activeQuestionId,
  },
  lastUserMessageId: input.lastUserMessageId, replyToQuestionId: input.replyToGapId,
  ...(repair ? { repair } : {}),
})

const runAttempt = async ({ input, apiKey, aiSupportEnabled, rateLimiter, rateLimitKey, repair, runTask }) => {
  let rawOutput = null
  const modelInput = buildPlannerInput(input, repair)
  const llmStartedAt = new Date().toISOString()
  if (modelInput.length > ENGINE2_TURN_LIMITS.maxInputChars) return { ok: false, data: null, rawOutput: null, modelInput, meta: { errorCategory: 'INPUT_TOO_LARGE', providerCalled: false, tokens: { input: 0, output: 0, total: 0 } }, timing: { llmStartedAt, rawResponseReceivedAt: null, parseCompletedAt: new Date().toISOString(), llmLatencyMs: 0 } }
  let rawResponseReceivedAt = null
  const result = await runTask({
    apiKey, aiSupportEnabled, task: repair ? 'engine2-turn-v3-structural-repair' : 'engine2-turn-v3', input: modelInput,
    language: input.language === 'pl' ? 'Polish' : 'English',
    taskInstructions: repair
      ? 'Repair only the listed JSON, required-field, reference-ID, language/tone or structurally forbidden-operation errors. Preserve the chosen turnKind and all valid user information. For language/tone errors, translate user-facing strings to Polish direct-address form only; do not change meaning or IDs. Do not invent semantic coverage, child questions or readiness fields.'
      : 'Classify the conversational act and return one engine2.turn.v3 object.',
    parseResponse: parseObject, fallbackData: null, skipPreprocess: true, useDefaultModelWhenSkippingPreprocess: true,
    maxOutputTokens: ENGINE2_TURN_LIMITS.maxOutputTokens, maxInputChars: ENGINE2_TURN_LIMITS.maxInputChars, temperature: 0.2,
    responseFormat: ENGINE2_TURN_RESPONSE_FORMAT, systemPrompt: ENGINE2_TURN_SYSTEM_PROMPT, rateLimiter, rateLimitKey,
    onRawResponse: ({ content }) => { rawOutput = content; rawResponseReceivedAt = new Date().toISOString() },
  })
  const providerCalled = result?.meta?.providerCalled !== false && Boolean(
    result?.meta?.providerRequestId ||
    result?.meta?.providerCallStartedAt ||
    result?.meta?.providerDiagnostics?.providerCallStartedAt ||
    rawResponseReceivedAt
  )
  return { ...result, meta: { ...result.meta, providerCalled }, rawOutput, modelInput, timing: { llmStartedAt, rawResponseReceivedAt, parseCompletedAt: new Date().toISOString(), llmLatencyMs: Number(result?.meta?.llmLatencyMs || 0) } }
}

const mergedMeta = (attempts) => {
  const last = attempts.at(-1)?.meta || {}
  return {
    ...last, attempts: attempts.length, providerCalls: attempts.filter((attempt) => attempt?.meta?.providerCalled !== false).length,
    repairRetry: attempts.length > 1, providerRequestIds: attempts.map((attempt) => attempt?.meta?.providerRequestId).filter(Boolean),
    tokens: attempts.reduce((sum, attempt) => ({ input: sum.input + Number(attempt?.meta?.tokens?.input || 0), output: sum.output + Number(attempt?.meta?.tokens?.output || 0), total: sum.total + Number(attempt?.meta?.tokens?.total || 0) }), { input: 0, output: 0, total: 0 }),
  }
}

export const planEngine2LlmTurn = async ({ input, apiKey, aiSupportEnabled, rateLimiter = null, rateLimitKey = null, runTask = runLlmTask }) => {
  if (input.action && input.action !== 'analyze_message') return { ok: false, delta: null, validation: { ok: false, errors: ['turn planner only supports analyze_message'] }, attempts: [], meta: { providerCalls: 0, attempts: 0 }, errorCategory: 'INVALID_ACTION' }
  const context = { ...input, messageId: input.lastUserMessageId, conversation: input.conversation }
  const attempts = []
  const validate = (attempt) => {
    if (!attempt.ok) {
      const category = attempt.meta?.errorCategory || 'LLM_ERROR'
      const detail = attempt.meta?.errorInfo?.message || attempt.meta?.errorInfo?.type || attempt.error || null
      return {
        ok: false,
        errors: [
          category === 'PARSE_ERROR'
            ? 'response is not valid structured JSON'
            : detail ? `${category}: ${detail}` : category,
        ],
      }
    }
    attempt.canonicalization = canonicalizeEngine2TurnDelta(attempt.data, context)
    return validateEngine2TurnDelta(attempt.canonicalization.delta, context)
  }
  const first = await runAttempt({ input, apiKey, aiSupportEnabled, rateLimiter, rateLimitKey, repair: null, runTask })
  attempts.push(first); first.validation = validate(first)
  if (!first.validation.ok && (first.ok || first.meta?.errorCategory === 'PARSE_ERROR')) {
    const second = await runAttempt({ input, apiKey, aiSupportEnabled, rateLimiter, rateLimitKey, repair: { errors: first.validation.errors, invalidOutput: first.rawOutput || first.data || null }, runTask })
    attempts.push(second); second.validation = validate(second)
  }
  const final = attempts.at(-1)
  const validation = final?.validation || { ok: false, errors: [] }
  return {
    ok: Boolean(final?.ok && validation.ok), delta: final?.ok && validation.ok ? final.canonicalization.delta : null,
    rawOutput: final?.rawOutput || null, validation, canonicalizationChanges: final?.canonicalization?.changes || [],
    attempts: attempts.map((attempt) => ({ ok: attempt.ok, modelInput: attempt.modelInput, rawOutput: attempt.rawOutput, parsedOutput: attempt.data ?? null, canonicalizedOutput: attempt.canonicalization?.delta ?? null, canonicalizationChanges: attempt.canonicalization?.changes || [], validation: attempt.validation, timing: attempt.timing, meta: attempt.meta })),
    meta: mergedMeta(attempts), errorCategory: final?.ok ? 'INVARIANT_VIOLATION' : final?.meta?.errorCategory || 'LLM_ERROR',
  }
}
