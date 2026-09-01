import { runLlmTask } from '../../../llm/llmRouter.mjs'
import {
  isEngine2FormalContradictionChangeEligible,
  normalizeEngine2ContradictionEvidence,
} from './engine2ContradictionEvidence.js'
import {
  ENGINE2_CONTRADICTION_STATUSES,
  ENGINE2_OPEN_CONTRADICTION_STATUSES,
  validatePolishUserFacingText,
} from './engine2UserFacingText.js'

export const ENGINE2_READINESS_SCHEMA_VERSION = 'engine2.readiness.v2'
export const ENGINE2_READINESS_COMPONENTS = Object.freeze([
  'problem_or_need',
  'desired_outcome',
  'usage_context',
  'constraints',
  'success_criteria',
  'risks_and_decisions',
])

const componentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'status', 'evidenceFindingIds', 'reason', 'critical'],
  properties: {
    key: { type: 'string', enum: ENGINE2_READINESS_COMPONENTS },
    status: { type: 'string', enum: ['covered', 'partial', 'missing', 'not_applicable'] },
    evidenceFindingIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    critical: { type: 'boolean' },
  },
}

const questionCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'clientRef', 'semanticKey', 'question', 'intent', 'presentation', 'reason',
    'groundedInFindingIds', 'concreteAnchorText', 'uncertaintyToResolve',
    'userCanAnswerFromExperience', 'forbiddenGenericCategoryQuestion',
    'targetType', 'targetContradictionId',
  ],
  properties: {
    clientRef: { type: 'string', minLength: 1, maxLength: 120 },
    semanticKey: { type: 'string', minLength: 1, maxLength: 120 },
    question: { type: 'string', minLength: 1, maxLength: 320 },
    intent: { type: 'string', minLength: 1, maxLength: 320 },
    presentation: { type: 'string', enum: ['panel'] },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    groundedInFindingIds: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 120 } },
    concreteAnchorText: { type: 'string', minLength: 1, maxLength: 240 },
    uncertaintyToResolve: { type: 'string', minLength: 1, maxLength: 240 },
    userCanAnswerFromExperience: { type: 'boolean' },
    forbiddenGenericCategoryQuestion: { type: 'boolean' },
    targetType: { type: 'string', minLength: 1, maxLength: 80 },
    targetContradictionId: { type: ['string', 'null'] },
  },
}

const contradictionChangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'operation', 'contradictionId', 'semanticKey', 'description', 'sideA', 'sideB',
    'sourceFindingIds', 'sourceMessageIds', 'sideASourceFindingIds',
    'sideBSourceFindingIds', 'sideASourceMessageIds', 'sideBSourceMessageIds',
    'status', 'reportBlocking', 'verificationQuestionId', 'resolutionFindingIds',
    'evidenceStatus', 'origin', 'formalEligible', 'rejectionReason',
  ],
  properties: {
    operation: { type: 'string', enum: ['create', 'update', 'resolve', 'dismiss', 'supersede'] },
    contradictionId: { type: ['string', 'null'] },
    semanticKey: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', minLength: 1, maxLength: 400 },
    sideA: { type: 'string', minLength: 1, maxLength: 240 },
    sideB: { type: 'string', minLength: 1, maxLength: 240 },
    sourceFindingIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sourceMessageIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideASourceFindingIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideBSourceFindingIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideASourceMessageIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideBSourceMessageIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    status: { type: 'string', enum: ENGINE2_CONTRADICTION_STATUSES },
    reportBlocking: { type: 'boolean' },
    verificationQuestionId: { type: ['string', 'null'] },
    resolutionFindingIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    evidenceStatus: { type: 'string', enum: ['confirmed_requirement_tension', 'exploration_hypothesis', 'alternative_or_mode'] },
    origin: { type: 'string', enum: ['user_requirements', 'matrix_hypothesis', 'heuristic'] },
    formalEligible: { type: 'boolean' },
    rejectionReason: { type: ['string', 'null'], maxLength: 300 },
  },
}

export const ENGINE2_READINESS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'overallReason', 'materialScore', 'materialScoreReason', 'components', 'criticalMissing', 'contradictionChanges', 'questionCandidates'],
  properties: {
    schemaVersion: { type: 'string', const: ENGINE2_READINESS_SCHEMA_VERSION },
    overallReason: { type: 'string', minLength: 1, maxLength: 700 },
    materialScore: { type: 'integer', minimum: 0, maximum: 100 },
    materialScoreReason: { type: 'string', minLength: 1, maxLength: 500 },
    components: { type: 'array', minItems: 6, maxItems: 6, items: componentSchema },
    criticalMissing: {
      type: 'array', maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['component', 'missing', 'reason'],
        properties: {
          component: { type: 'string', enum: ENGINE2_READINESS_COMPONENTS },
          missing: { type: 'string', minLength: 1, maxLength: 200 },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    contradictionChanges: { type: 'array', maxItems: 6, items: contradictionChangeSchema },
    questionCandidates: { type: 'array', maxItems: 3, items: questionCandidateSchema },
  },
}

export const ENGINE2_READINESS_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'engine2_readiness_evaluation', strict: true, schema: ENGINE2_READINESS_JSON_SCHEMA },
}

export const ENGINE2_READINESS_SYSTEM_PROMPT = `You are an independent report-readiness evaluator for Engine 2.
You do not plan the turn and you never return reportAvailable or conversationStatus. You do return materialScore because it is your evidence-based estimate of collected material quality.
Evaluate only the supplied confirmed findings as evidence. Pending and rejected findings are not evidence.
Assess exactly these six components: problem_or_need, desired_outcome, usage_context, constraints, success_criteria, risks_and_decisions.
For each component return covered, partial, missing or not_applicable, evidenceFindingIds, a concise reason, and whether the gap is critical for a useful report.
covered and partial require direct confirmed finding evidence. missing and not_applicable use no evidence IDs.
not_applicable is allowed and does not count against readiness, but it requires a concrete reason grounded in the product context. Do not mark a component not_applicable merely because the conversation did not discuss it.
Return at most three criticalMissing items describing the most important information still needed.
On every evaluation, actively look for contradictions and trade-offs across current state, not-working facts, desired results, usage contexts, constraints, success criteria and existing contradictions. Return contradictionChanges only for tensions between two user-provided or confirmed requirements with evidence on both sides. Do not turn a suspected contradiction into an open tension unless the user confirmed both sides.
Do not create requirements from matrix-inspired axes, model assumptions or softTensionSignals. If a possible axis is missing one side of user evidence, use questionCandidates/guidance only, not contradictionChanges.
Treat switchable or regulatable modes requested by the user, such as wide-to-spot light adjustment, as alternative_or_mode rather than contradictionChanges.
Look especially for opposing needs, goals conflicting with constraints, usage contexts requiring different behavior, goals without measurable tests, statements conflicting with earlier findings, and trade-offs among cost, size, performance, time, convenience or safety.
The input may include softTensionSignals. Treat them as weak but real evidence that trade-offs or contradictions are visible in the material, even when activeContradictions is empty. Do not report "no trade-offs" solely because no formal contradiction object exists.
If any applicable component is partial or missing, an unresolved contradiction exists, or an active report-blocking contradiction exists, return exactly three concrete, non-duplicate questionCandidates, all with presentation=panel. Each candidate needs clientRef, semanticKey, question, intent, presentation, reason, groundedInFindingIds, targetType and targetContradictionId.
Prioritize questions in this order: suspected contradiction from confirmed findings, open contradiction clarification, priority between contradiction sides, concrete observation/boundary needed for resolution, ordinary information gap.
Every candidate must be grounded in at least one confirmed finding ID, ask about one concrete situation/choice/boundary/test, and must not ask the user to list all features, risks, decisions, expectations, or what else to include. Do not return a questionId; the backend assigns it.
When language=Polish, every user-facing field must be Polish and direct-address. Ask "Chcesz...", "Potrzebujesz..." or "Warto ustalić..." style questions. Do not write visible text like "Użytkownik chce..." or English text. If repairing a language issue, translate only the user-facing strings; preserve IDs and meaning.
If all applicable components are covered and there is no critical missing information, return questionCandidates=[].
Unverified high-impact suspected contradictions lower readiness. Confirmed unresolved report-blocking contradictions block report readiness unless explicitly represented as a key decision.
Absence of open questions is neutral evidence. A short session may be ready when its confirmed evidence is genuinely complete and key tensions are checked or intentionally non-applicable.
Return only the strict JSON object.`

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value, max = 0) => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return max ? normalized.slice(0, max) : normalized
}
const parseObject = (raw) => { try { const parsed = JSON.parse(raw); return isObject(parsed) ? parsed : null } catch { return null } }
const componentValue = (status) => status === 'covered' ? 1 : status === 'partial' ? 0.5 : 0
const idArray = (value) => [...new Set((Array.isArray(value) ? value : []).map((entry) => text(entry, 120)).filter(Boolean))]
const normalizeQuestionCandidate = (candidate, index = 0) => ({
  clientRef: text(candidate?.clientRef, 120) || text(candidate?.semanticKey, 120) || `question_${index + 1}`,
  semanticKey: text(candidate?.semanticKey, 120),
  question: text(candidate?.question ?? candidate?.text, 320),
  intent: text(candidate?.intent, 320),
  presentation: 'panel',
  reason: text(candidate?.reason, 500),
  groundedInFindingIds: idArray(candidate?.groundedInFindingIds),
  concreteAnchorText: text(candidate?.concreteAnchorText, 240),
  uncertaintyToResolve: text(candidate?.uncertaintyToResolve, 240),
  userCanAnswerFromExperience: typeof candidate?.userCanAnswerFromExperience === 'boolean' ? candidate.userCanAnswerFromExperience : false,
  forbiddenGenericCategoryQuestion: typeof candidate?.forbiddenGenericCategoryQuestion === 'boolean' ? candidate.forbiddenGenericCategoryQuestion : false,
  targetType: text(candidate?.targetType, 80) || 'observation',
  targetContradictionId: text(candidate?.targetContradictionId ?? candidate?.targetContradictionRef, 120) || null,
})

const normalizeContradictionChange = (change) => normalizeEngine2ContradictionEvidence({
  operation: change?.operation,
  contradictionId: text(change?.contradictionId, 120) || null,
  semanticKey: text(change?.semanticKey, 120),
  description: text(change?.description, 400),
  sideA: text(change?.sideA, 240),
  sideB: text(change?.sideB, 240),
  sourceFindingIds: idArray(change?.sourceFindingIds ?? change?.findingIds),
  sourceMessageIds: idArray(change?.sourceMessageIds ?? change?.messageIds),
  sideASourceFindingIds: idArray(change?.sideASourceFindingIds ?? change?.sideAFindingIds),
  sideBSourceFindingIds: idArray(change?.sideBSourceFindingIds ?? change?.sideBFindingIds),
  sideASourceMessageIds: idArray(change?.sideASourceMessageIds ?? change?.sideAMessageIds),
  sideBSourceMessageIds: idArray(change?.sideBSourceMessageIds ?? change?.sideBMessageIds),
  status: ENGINE2_CONTRADICTION_STATUSES.includes(change?.status)
    ? change.status
    : 'suspected',
  reportBlocking: Boolean(change?.reportBlocking),
  verificationQuestionId: text(change?.verificationQuestionId ?? change?.resolutionQuestionId, 120) || null,
  resolutionFindingIds: idArray(change?.resolutionFindingIds),
  evidenceStatus: text(change?.evidenceStatus, 80),
  origin: text(change?.origin, 80),
  formalEligible: change?.formalEligible === true,
  rejectionReason: text(change?.rejectionReason, 300) || null,
})

export const canonicalizeEngine2ReadinessEvaluation = (evaluation) => {
  if (!isObject(evaluation)) return evaluation
  const base = {
    ...evaluation,
    materialScore: Number.isFinite(Number(evaluation.materialScore)) ? Math.max(0, Math.min(100, Math.round(Number(evaluation.materialScore)))) : 0,
    materialScoreReason: text(evaluation.materialScoreReason || evaluation.overallReason, 500),
    contradictionChanges: (Array.isArray(evaluation.contradictionChanges) ? evaluation.contradictionChanges : []).map(normalizeContradictionChange),
  }
  if (Array.isArray(evaluation.questionCandidates)) {
    return {
      ...base,
      questionCandidates: evaluation.questionCandidates.map(normalizeQuestionCandidate),
    }
  }
  if (isObject(evaluation.followUpQuestion)) {
    const { followUpQuestion: _legacy, ...rest } = base
    return {
      ...rest,
      questionCandidates: [normalizeQuestionCandidate({ ...evaluation.followUpQuestion, clientRef: evaluation.followUpQuestion.semanticKey, presentation: 'panel' })],
    }
  }
  const { followUpQuestion: _legacy, ...rest } = base
  return { ...rest, questionCandidates: [] }
}

export const validateEngine2ReadinessEvaluation = (evaluation, context = {}) => {
  const errors = []
  evaluation = canonicalizeEngine2ReadinessEvaluation(evaluation)
  if (!isObject(evaluation)) return { ok: false, errors: ['readiness evaluation must be an object'] }
  if (evaluation.schemaVersion !== ENGINE2_READINESS_SCHEMA_VERSION) errors.push(`schemaVersion must equal ${ENGINE2_READINESS_SCHEMA_VERSION}`)
  if (!text(evaluation.overallReason, 700)) errors.push('overallReason is required')
  if (!Number.isInteger(evaluation.materialScore) || evaluation.materialScore < 0 || evaluation.materialScore > 100) errors.push('materialScore must be an integer from 0 to 100')
  if (!text(evaluation.materialScoreReason, 500)) errors.push('materialScoreReason is required')
  validatePolishUserFacingText({ value: evaluation.overallReason, path: 'overallReason', errors, language: context.language })
  validatePolishUserFacingText({ value: evaluation.materialScoreReason, path: 'materialScoreReason', errors, language: context.language })
  const components = Array.isArray(evaluation.components) ? evaluation.components : []
  if (components.length !== ENGINE2_READINESS_COMPONENTS.length) errors.push('evaluation requires exactly six score components')
  const componentKeys = components.map((entry) => entry?.key)
  for (const key of ENGINE2_READINESS_COMPONENTS) {
    if (componentKeys.filter((value) => value === key).length !== 1) errors.push(`component must appear exactly once: ${key}`)
  }

  const allFindings = Array.isArray(context.allFindings) ? context.allFindings : []
  const findingById = new Map(allFindings.map((finding) => [finding.id, finding]))
  for (const component of components) {
    if (!ENGINE2_READINESS_COMPONENTS.includes(component?.key)) continue
    if (!['covered', 'partial', 'missing', 'not_applicable'].includes(component.status)) errors.push(`invalid status for component: ${component.key}`)
    if (!text(component.reason, 500)) errors.push(`component reason is required: ${component.key}`)
    validatePolishUserFacingText({ value: component.reason, path: `components[${component.key}].reason`, errors, language: context.language })
    if (typeof component.critical !== 'boolean') errors.push(`component critical flag is required: ${component.key}`)
    const evidenceIds = Array.isArray(component.evidenceFindingIds) ? [...new Set(component.evidenceFindingIds)] : []
    if (!Array.isArray(component.evidenceFindingIds)) errors.push(`evidenceFindingIds must be an array: ${component.key}`)
    if (['covered', 'partial'].includes(component.status) && evidenceIds.length === 0) errors.push(`covered or partial component requires evidence: ${component.key}`)
    if (['missing', 'not_applicable'].includes(component.status) && evidenceIds.length > 0) errors.push(`missing or not_applicable component cannot cite evidence: ${component.key}`)
    for (const id of evidenceIds) {
      const finding = findingById.get(id)
      if (!finding) errors.push(`unknown evidenceFindingId: ${id}`)
      else if (finding.status !== 'confirmed') errors.push(`evidenceFindingId is not confirmed: ${id}`)
    }
  }

  const criticalMissing = Array.isArray(evaluation.criticalMissing) ? evaluation.criticalMissing : []
  if (!Array.isArray(evaluation.criticalMissing) || criticalMissing.length > 3) errors.push('criticalMissing must contain at most three items')
  for (const missing of criticalMissing) {
    if (!ENGINE2_READINESS_COMPONENTS.includes(missing?.component)) errors.push('criticalMissing references an invalid component')
    if (!text(missing?.missing, 200) || !text(missing?.reason, 500)) errors.push('criticalMissing requires missing and reason')
    validatePolishUserFacingText({ value: missing?.missing, path: `criticalMissing[${missing?.component || 'unknown'}].missing`, errors, language: context.language })
    validatePolishUserFacingText({ value: missing?.reason, path: `criticalMissing[${missing?.component || 'unknown'}].reason`, errors, language: context.language })
    const component = components.find((entry) => entry?.key === missing?.component)
    if (component && !['partial', 'missing'].includes(component.status)) errors.push(`criticalMissing must reference partial or missing component: ${missing.component}`)
  }
  for (const component of components.filter((entry) => entry?.critical && entry?.status === 'missing')) {
    if (!criticalMissing.some((entry) => entry?.component === component.key)) errors.push(`critical missing component requires criticalMissing entry: ${component.key}`)
  }

  const applicable = components.filter((entry) => entry?.status !== 'not_applicable')
  const provisionalScore = applicable.length
    ? Math.round(100 * applicable.reduce((sum, entry) => sum + componentValue(entry.status), 0) / applicable.length)
    : 0
  const contradictionById = new Map((context.activeContradictions || []).map((entry) => [entry.id, entry]))
  const messageIds = new Set((context.conversationContext || []).map((message) => message?.id).filter(Boolean))
  const contradictionChanges = Array.isArray(evaluation.contradictionChanges) ? evaluation.contradictionChanges : []
  if (!Array.isArray(evaluation.contradictionChanges) || contradictionChanges.length > 6) errors.push('contradictionChanges must contain at most six items')
  for (const [index, change] of contradictionChanges.entries()) {
    if (!['create', 'update', 'resolve', 'dismiss', 'supersede'].includes(change?.operation)) errors.push(`contradictionChanges[${index}] operation is invalid`)
    if (change?.operation === 'create' && change.contradictionId !== null) errors.push(`contradictionChanges[${index}] create ID must be assigned by backend`)
    if (change?.operation !== 'create' && !contradictionById.has(change?.contradictionId)) errors.push(`contradictionChanges[${index}] targets unknown contradiction`)
    if (!text(change?.semanticKey, 120) || !text(change?.description, 400)) errors.push(`contradictionChanges[${index}] requires semanticKey and description`)
    if (!text(change?.sideA, 240) || !text(change?.sideB, 240)) errors.push(`contradictionChanges[${index}] requires sideA and sideB`)
    validatePolishUserFacingText({ value: change?.description, path: `contradictionChanges[${index}].description`, errors, language: context.language })
    validatePolishUserFacingText({ value: change?.sideA, path: `contradictionChanges[${index}].sideA`, errors, language: context.language })
    validatePolishUserFacingText({ value: change?.sideB, path: `contradictionChanges[${index}].sideB`, errors, language: context.language })
    if (!ENGINE2_CONTRADICTION_STATUSES.includes(change?.status)) errors.push(`contradictionChanges[${index}] status is invalid`)
    if (!Array.isArray(change?.sourceFindingIds) || change.sourceFindingIds.length === 0) errors.push(`contradictionChanges[${index}] requires sourceFindingIds`)
    if (!Array.isArray(change?.sourceMessageIds) || change.sourceMessageIds.length === 0) errors.push(`contradictionChanges[${index}] requires sourceMessageIds`)
    for (const id of change?.sourceFindingIds || []) if (!findingById.has(id)) errors.push(`contradictionChanges[${index}] references unknown finding: ${id}`)
    for (const id of change?.sourceMessageIds || []) if (messageIds.size > 0 && !messageIds.has(id)) errors.push(`contradictionChanges[${index}] references unknown message: ${id}`)
    for (const id of change?.resolutionFindingIds || []) if (!findingById.has(id)) errors.push(`contradictionChanges[${index}] references unknown resolution finding: ${id}`)
  }
  const formalContradictionChanges = contradictionChanges.filter(isEngine2FormalContradictionChangeEligible)
  const terminalContradictionRefs = new Set(formalContradictionChanges
    .filter((change) => ['resolved', 'dismissed', 'superseded'].includes(change.status))
    .flatMap((change) => [change.contradictionId, change.semanticKey])
    .filter(Boolean))
  const hasBlockingContradiction = (context.activeContradictions || [])
    .some((entry) => entry.reportBlocking && !terminalContradictionRefs.has(entry.id) && !terminalContradictionRefs.has(entry.semanticKey))
  const hasDetectedUnresolvedContradiction = formalContradictionChanges.some((change) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(change.status))
  const needsFollowUp = provisionalScore < 100 || criticalMissing.length > 0 || hasBlockingContradiction || hasDetectedUnresolvedContradiction
  const candidates = Array.isArray(evaluation.questionCandidates) ? evaluation.questionCandidates : []
  if (!Array.isArray(evaluation.questionCandidates) || candidates.length > 3) errors.push('questionCandidates must contain at most three items')
  if (needsFollowUp && candidates.length !== 3) errors.push('incomplete readiness requires exactly three panel question candidates')
  if (!needsFollowUp && candidates.length > 0) errors.push('ready evaluation requires questionCandidates=[]')
  const existingQuestionKeys = new Set((context.questions || []).map((entry) => entry.semanticKey || entry.gapKey).filter(Boolean))
  const candidateKeys = new Set()
  for (const [index, candidate] of candidates.entries()) {
    if (!text(candidate?.clientRef, 120)) errors.push(`questionCandidates[${index}] requires clientRef`)
    if (!text(candidate?.semanticKey, 120)) errors.push(`questionCandidates[${index}] requires semanticKey`)
    if (!text(candidate?.question, 320) || !text(candidate?.intent, 320) || !text(candidate?.reason, 500)) errors.push(`questionCandidates[${index}] requires question, intent and reason`)
    validatePolishUserFacingText({ value: candidate?.question, path: `questionCandidates[${index}].question`, errors, language: context.language })
    if (candidate?.presentation !== 'panel') errors.push(`questionCandidates[${index}] presentation must be panel`)
    if (!text(candidate?.targetType, 80)) errors.push(`questionCandidates[${index}] requires targetType`)
    if (!text(candidate?.concreteAnchorText, 240)) errors.push(`questionCandidates[${index}] requires concreteAnchorText`)
    if (!text(candidate?.uncertaintyToResolve, 240)) errors.push(`questionCandidates[${index}] requires uncertaintyToResolve`)
    if (typeof candidate?.userCanAnswerFromExperience !== 'boolean') errors.push(`questionCandidates[${index}] requires userCanAnswerFromExperience`)
    if (typeof candidate?.forbiddenGenericCategoryQuestion !== 'boolean') errors.push(`questionCandidates[${index}] requires forbiddenGenericCategoryQuestion`)
    if (!Array.isArray(candidate?.groundedInFindingIds) || candidate.groundedInFindingIds.length === 0) errors.push(`questionCandidates[${index}] requires groundedInFindingIds`)
    for (const id of candidate?.groundedInFindingIds || []) {
      const finding = findingById.get(id)
      if (!finding) errors.push(`questionCandidates[${index}] references unknown grounded finding: ${id}`)
      else if (finding.status !== 'confirmed') errors.push(`questionCandidates[${index}] grounded finding is not confirmed: ${id}`)
    }
    if (candidate?.targetContradictionId && !contradictionById.has(candidate.targetContradictionId) && !formalContradictionChanges.some((change) => change.semanticKey === candidate.targetContradictionId || change.contradictionId === candidate.targetContradictionId)) {
      errors.push(`questionCandidates[${index}] references unknown targetContradictionId: ${candidate.targetContradictionId}`)
    }
    if (candidateKeys.has(candidate?.semanticKey)) errors.push(`duplicate question candidate semanticKey: ${candidate.semanticKey}`)
    candidateKeys.add(candidate?.semanticKey)
    if (existingQuestionKeys.has(candidate?.semanticKey)) {
      // Existing open-question keys are diagnostic only; the backend will reuse or skip them.
    }
  }
  return { ok: errors.length === 0, errors, provisionalScore }
}

export const calculateEngine2ReadinessDecision = ({
  evaluation,
  allFindings = [],
  activeContradictions = [],
  softTensionSignals = [],
  softTensionSignalsCount = null,
}) => {
  const confirmedIds = new Set(allFindings.filter((finding) => finding.status === 'confirmed').map((finding) => finding.id))
  const scoreComponents = evaluation.components.map((component) => {
    const requestedEvidenceFindingIds = [...new Set(component.evidenceFindingIds || [])]
    const validEvidenceFindingIds = requestedEvidenceFindingIds.filter((id) => confirmedIds.has(id))
    const requiresEvidence = ['covered', 'partial'].includes(component.status)
    const forbidsEvidence = ['missing', 'not_applicable'].includes(component.status)
    const evidenceValid = requestedEvidenceFindingIds.length === validEvidenceFindingIds.length &&
      (!requiresEvidence || validEvidenceFindingIds.length > 0) &&
      (!forbidsEvidence || requestedEvidenceFindingIds.length === 0)
    return {
      key: component.key,
      status: component.status,
      critical: component.critical,
      reason: component.reason,
      evidenceFindingIds: validEvidenceFindingIds,
      evidenceValid,
      value: component.status === 'not_applicable' ? null : evidenceValid ? componentValue(component.status) : 0,
    }
  })
  const applicable = scoreComponents.filter((component) => component.value !== null)
  const componentScore = applicable.length
    ? Math.round(100 * applicable.reduce((sum, component) => sum + component.value, 0) / applicable.length)
    : 0
  const unresolvedContradictions = activeContradictions.filter((entry) => ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(entry.status))
  const softCount = softTensionSignalsCount !== null && softTensionSignalsCount !== undefined && Number.isFinite(Number(softTensionSignalsCount))
    ? Math.max(0, Math.trunc(Number(softTensionSignalsCount)))
    : (Array.isArray(softTensionSignals) ? softTensionSignals.length : 0)
  const hasSoftTensionSignals = softCount > 0
  const hasTradeoffsOrContradictions = unresolvedContradictions.length > 0 || hasSoftTensionSignals
  const hasUnverifiedHighImpactContradiction = unresolvedContradictions.some((entry) => entry.status === 'suspected' && entry.reportBlocking)
  const hasConfirmedBlockingContradiction = unresolvedContradictions.some((entry) => ['open', 'confirmed', 'active'].includes(entry.status) && entry.reportBlocking)
  const finalScore = hasUnverifiedHighImpactContradiction
    ? Math.min(componentScore, 75)
    : componentScore
  const reportBlockedReasons = []
  if (applicable.length === 0) reportBlockedReasons.push('no_applicable_score_components')
  if (scoreComponents.some((component) => !component.evidenceValid)) reportBlockedReasons.push('invalid_component_evidence')
  if (finalScore < 100) reportBlockedReasons.push('incomplete_score_components')
  if ((evaluation.criticalMissing || []).length > 0) reportBlockedReasons.push('critical_missing')
  if (scoreComponents.some((component) => component.critical && component.status === 'missing')) reportBlockedReasons.push('critical_component_missing')
  if (hasUnverifiedHighImpactContradiction) reportBlockedReasons.push('unverified_high_impact_contradiction')
  if (hasConfirmedBlockingContradiction) reportBlockedReasons.push('active_report_blocking_contradiction')
  const backendInvariantResults = [
    { invariant: 'has_applicable_components', passed: applicable.length > 0 },
    { invariant: 'all_component_evidence_is_confirmed', passed: !scoreComponents.some((component) => !component.evidenceValid) },
    { invariant: 'all_applicable_components_covered', passed: componentScore === 100 },
    { invariant: 'no_critical_missing', passed: (evaluation.criticalMissing || []).length === 0 },
    { invariant: 'no_critical_component_missing', passed: !scoreComponents.some((component) => component.critical && component.status === 'missing') },
    { invariant: 'no_active_report_blocking_contradiction', passed: !hasConfirmedBlockingContradiction },
    { invariant: 'no_unverified_high_impact_contradiction', passed: !hasUnverifiedHighImpactContradiction },
    { invariant: 'absence_of_open_questions_is_neutral', passed: true, contributedScore: 0 },
  ]
  return {
    readinessDecisionSource: 'backend_readiness_evaluator',
    scoreComponents,
    evidenceFindingIds: [...new Set(scoreComponents.flatMap((component) => component.evidenceFindingIds))],
    backendInvariantResults,
    finalScore,
    materialScore: evaluation.materialScore,
    materialScoreReason: evaluation.materialScoreReason,
    hasTradeoffsOrContradictions,
    softTensionSignalsCount: softCount,
    softTensionSignals: Array.isArray(softTensionSignals) ? softTensionSignals : [],
    unresolvedContradictions: unresolvedContradictions.map(({ id, semanticKey, status, reportBlocking }) => ({ id, semanticKey, status, reportBlocking })),
    contradictionReadinessImpact: {
      hasUnverifiedHighImpactContradiction,
      hasConfirmedBlockingContradiction,
      hasSoftTensionSignals,
      scoreCapApplied: hasUnverifiedHighImpactContradiction ? 75 : null,
    },
    reportBlockedReasons,
    reportAvailable: reportBlockedReasons.length === 0,
    criticalMissing: (evaluation.criticalMissing || []).map((entry) => entry.missing),
    criticalMissingDetails: evaluation.criticalMissing || [],
  }
}

const modelInput = (input, repair = null) => JSON.stringify({
  confirmedFindings: input.confirmedFindings,
  allFindings: input.allFindings,
  activeContradictions: input.activeContradictions,
  reportBlockingContradictions: input.reportBlockingContradictions,
  softTensionSignals: input.softTensionSignals,
  softTensionSignalsCount: input.softTensionSignalsCount,
  hasTradeoffsOrContradictions: input.hasTradeoffsOrContradictions,
  questions: input.questions,
  questionHistory: input.questions,
  conversationContext: input.conversationContext,
  ...(repair ? { repair } : {}),
})

const runAttempt = async ({ input, repair, apiKey, aiSupportEnabled, rateLimiter, rateLimitKey, runTask }) => {
  let rawOutput = null
  const result = await runTask({
    apiKey,
    aiSupportEnabled,
    task: repair ? 'engine2-readiness-v2-repair' : 'engine2-readiness-v2',
    input: modelInput(input, repair),
    language: input.language === 'pl' ? 'Polish' : 'English',
    taskInstructions: repair
      ? 'Repair every listed readiness invariant in one complete replacement evaluation. For language/tone errors, translate user-facing strings to Polish direct-address form only; do not change meaning or IDs. Use only confirmed finding IDs supplied in the input and return questionCandidates, not followUpQuestion.'
      : 'Return one independent readiness evaluation. Do not return a score, final report decision or followUpQuestion.',
    parseResponse: parseObject,
    fallbackData: null,
    skipPreprocess: true,
    useDefaultModelWhenSkippingPreprocess: true,
    maxOutputTokens: 3400,
    maxInputChars: 500_000,
    temperature: 0.1,
    responseFormat: ENGINE2_READINESS_RESPONSE_FORMAT,
    systemPrompt: ENGINE2_READINESS_SYSTEM_PROMPT,
    rateLimiter,
    rateLimitKey,
    onRawResponse: ({ content }) => { rawOutput = content },
  })
  return { ...result, rawOutput }
}

export const evaluateEngine2ReportReadiness = async ({
  input, apiKey, aiSupportEnabled, rateLimiter = null, rateLimitKey = null, runTask = runLlmTask,
}) => {
  const attempts = []
  const validate = (attempt) => attempt.ok
    ? validateEngine2ReadinessEvaluation(canonicalizeEngine2ReadinessEvaluation(attempt.data), {
        allFindings: input.allFindings,
        activeContradictions: input.activeContradictions,
        questions: input.questions,
        conversationContext: input.conversationContext,
        language: input.language,
      })
    : { ok: false, errors: attempt.meta?.errorCategory === 'PARSE_ERROR' ? ['response is not valid structured JSON'] : [] }
  const first = await runAttempt({ input, repair: null, apiKey, aiSupportEnabled, rateLimiter, rateLimitKey, runTask })
  first.validation = validate(first)
  attempts.push(first)
  if (!first.validation.ok && (first.ok || first.meta?.errorCategory === 'PARSE_ERROR')) {
    const second = await runAttempt({
      input,
      repair: { errors: first.validation.errors, invalidOutput: first.rawOutput || first.data || null },
      apiKey, aiSupportEnabled, rateLimiter, rateLimitKey, runTask,
    })
    second.validation = validate(second)
    attempts.push(second)
  }
  const final = attempts.at(-1)
  const ok = Boolean(final.ok && final.validation.ok)
  const finalEvaluation = ok ? canonicalizeEngine2ReadinessEvaluation(final.data) : null
  return {
    ok,
    evaluation: finalEvaluation,
    validation: final.validation,
    attempts: attempts.map((attempt) => ({
      ok: attempt.ok,
      rawOutput: attempt.rawOutput,
      parsedOutput: attempt.data || null,
      validation: attempt.validation,
      meta: attempt.meta,
    })),
    meta: {
      providerCalls: attempts.filter((attempt) => attempt?.meta?.providerCalled !== false).length,
      tokens: attempts.reduce((sum, attempt) => ({
        input: sum.input + Number(attempt?.meta?.tokens?.input || 0),
        output: sum.output + Number(attempt?.meta?.tokens?.output || 0),
        total: sum.total + Number(attempt?.meta?.tokens?.total || 0),
      }), { input: 0, output: 0, total: 0 }),
      modelUsed: final?.meta?.modelUsed || final?.meta?.attemptedModel || null,
      providerRequestIds: attempts.map((attempt) => attempt?.meta?.providerRequestId).filter(Boolean),
      repairRetry: attempts.length > 1,
    },
  }
}
