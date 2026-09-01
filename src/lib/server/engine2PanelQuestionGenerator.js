import { createHash } from 'node:crypto'
import { runLlmTask } from '../../../llm/llmRouter.mjs'
import { buildEngine2ContradictionMatrixReference } from './engine2ContradictionMatrix.js'
import { validatePolishUserFacingText } from './engine2UserFacingText.js'

export const ENGINE2_PANEL_QUESTION_SCHEMA_VERSION = 'engine2.panel_questions.v1'
export const ENGINE2_PANEL_QUESTION_TIMEOUT_MS = 35_000

const targetTypes = ['contradiction_probe', 'observation', 'priority', 'boundary', 'usage_example', 'success_test']
const text = (value, max = 0) => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return max ? normalized.slice(0, max) : normalized
}
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const parseObject = (raw) => { try { const parsed = JSON.parse(raw); return isObject(parsed) ? parsed : null } catch { return null } }
const idArray = (value) => [...new Set((Array.isArray(value) ? value : []).map((entry) => text(entry, 120)).filter(Boolean))]
export const normalizeEngine2QuestionTargetType = (value, candidate = {}) => {
  const normalized = text(value, 80).toLowerCase()
  if (targetTypes.includes(normalized)) return normalized
  if (text(candidate?.targetContradictionId ?? candidate?.targetContradictionRef, 120)) return 'contradiction_probe'
  if (/\b(contradiction|tension|ambiguity|ambiguous|tradeoff|trade-off|conflict|sprzecz|napi[eę]c|niejednoznacz|kompromis)\b/i.test(normalized)) return 'contradiction_probe'
  if (/\b(priority|prefer|choice|wyb[oó]r|priorytet|ważniejsz)\b/i.test(normalized)) return 'priority'
  if (/\b(boundary|constraint|limit|granica|ograniczen)\b/i.test(normalized)) return 'boundary'
  if (/\b(usage|context|scenario|sytuac|uży|uzy|ergonom)\b/i.test(normalized)) return 'usage_example'
  if (/\b(success|test|measure|criteria|kryteri|mier)\b/i.test(normalized)) return 'success_test'
  return normalized ? 'observation' : null
}
const openContradictionStatuses = new Set(['suspected', 'open', 'confirmed', 'active'])
const semanticKeySuffixes = new Set([
  'count', 'range', 'preference', 'preferences', 'detail', 'details', 'boundary', 'probe',
  'example', 'examples', 'question', 'questions', 'choice', 'choices', 'option', 'options',
  'size', 'zone', 'zones', 'control', 'controls', 'next', 'follow', 'up',
])

export const engine2QuestionSemanticCluster = (value) => {
  const parts = text(value, 120).toLowerCase().split(/[_\W]+/).filter(Boolean)
  const joined = parts.join('_')
  if (parts[0] === 'lamp' && /(light|brightness|intensity|jasnosc|nat[eę]zenie|adjustability|distribution)/.test(joined)) {
    return 'lamp_light_intensity'
  }
  while (parts.length > 2 && semanticKeySuffixes.has(parts.at(-1))) parts.pop()
  return parts.length >= 3 ? parts.slice(0, 3).join('_') : parts.join('_')
}

const targetRef = (candidate) => text(candidate?.targetContradictionId ?? candidate?.targetContradictionRef, 120) || null
const normalizeExplorationKey = (value) => text(value, 160)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120)
export const engine2QuestionExplorationKey = (candidate) =>
  normalizeExplorationKey(
    candidate?.semanticExplorationKey ||
    candidate?.explorationArea ||
    candidate?.contradictionHypothesis ||
    candidate?.semanticKey ||
    candidate?.gapKey
  )
const legacyExplorationMetadataFallback = 'not_supplied_by_legacy_candidate'
const hasExplicitExplorationMetadata = (candidate) => Boolean(
  text(candidate?.matrixInspiration, 220) &&
  text(candidate?.matrixInspiration, 220) !== legacyExplorationMetadataFallback &&
  (
    text(candidate?.semanticExplorationKey, 120) ||
    text(candidate?.explorationArea, 160) ||
    text(candidate?.contradictionHypothesis, 360)
  )
)
const matrixLeakPattern = /\b(TRIZ|Contradiction\s+Matrix|matryc[ay]\s+sprzeczno[sś]ci|macierz\s+sprzeczno[sś]ci|matrix\s+parameter|principle\s+\d+|ease\s+of\s+(manufacture|operation|repair)|device\s+complexity|manufacturing\s+precision|object-generated\s+harmful\s+factors|object\s+affected\s+harmful\s+factors|extent\s+of\s+automation|productivity)\b/i
const contradictionRefs = (contradictions) => new Set((Array.isArray(contradictions) ? contradictions : [])
  .filter((contradiction) => openContradictionStatuses.has(contradiction?.status))
  .flatMap((contradiction) => [contradiction.id, contradiction.semanticKey])
  .filter(Boolean))

export const diversifyEngine2PanelQuestionCandidates = (candidates, context = {}) => {
  const refs = contradictionRefs(context.activeContradictions || context.contradictions)
  const questionHistory = Array.isArray(context.questions) ? context.questions : []
  const openTargetRefs = new Set(questionHistory
    .filter((question) => question?.status === 'open')
    .map((question) => text(question?.targetContradictionId, 120))
    .filter(Boolean))
  const needsContradictionQuestion = [...refs].some((ref) => !openTargetRefs.has(ref))
  const historyClusterCounts = new Map()
  for (const question of questionHistory) {
    const cluster = engine2QuestionSemanticCluster(question?.semanticKey || question?.gapKey)
    if (cluster) historyClusterCounts.set(cluster, (historyClusterCounts.get(cluster) || 0) + 1)
  }
  const ordered = [...(Array.isArray(candidates) ? candidates : [])].sort((left, right) => {
    const leftTargets = refs.has(targetRef(left))
    const rightTargets = refs.has(targetRef(right))
    return Number(rightTargets) - Number(leftTargets)
  })
  const selected = []
  const skipped = []
  const packageClusterCounts = new Map()
  const packageExplorationKeys = new Set()
  for (const candidate of ordered) {
    const ref = targetRef(candidate)
    const targetsContradiction = refs.has(ref)
    const cluster = engine2QuestionSemanticCluster(candidate?.semanticKey)
    const explorationKey = engine2QuestionExplorationKey(candidate)
    const hasExplorationMetadata = hasExplicitExplorationMetadata(candidate)
    const inPackage = packageClusterCounts.get(cluster) || 0
    const inHistory = historyClusterCounts.get(cluster) || 0
    if (explorationKey && packageExplorationKeys.has(explorationKey)) {
      skipped.push({ candidate, reason: 'semantic_exploration_package_duplicate', cluster: explorationKey })
      continue
    }
    if (cluster && inPackage >= 2 && !hasExplorationMetadata) {
      skipped.push({ candidate, reason: 'semantic_cluster_package_limit', cluster })
      continue
    }
    if (cluster && inHistory >= 2 && !targetsContradiction && !hasExplorationMetadata) {
      skipped.push({ candidate, reason: 'semantic_cluster_history_limit', cluster })
      continue
    }
    selected.push(candidate)
    if (cluster) packageClusterCounts.set(cluster, inPackage + 1)
    if (explorationKey) packageExplorationKeys.add(explorationKey)
  }
  return {
    candidates: selected,
    skipped,
    needsContradictionQuestion,
    hasContradictionQuestion: ordered.some((candidate) => refs.has(targetRef(candidate))),
  }
}

const questionCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'clientRef', 'semanticKey', 'question', 'intent', 'presentation', 'reason',
    'groundedInFindingIds', 'concreteAnchorText', 'uncertaintyToResolve',
    'userCanAnswerFromExperience', 'forbiddenGenericCategoryQuestion',
    'targetType', 'targetContradictionId', 'explorationArea',
    'semanticExplorationKey', 'contradictionHypothesis', 'matrixInspiration',
    'matrixInspirationIsHypothesis', 'noveltyReason', 'diversityReason',
    'whyNotDuplicate', 'questionPurpose',
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
    explorationArea: { type: 'string', minLength: 1, maxLength: 160 },
    semanticExplorationKey: { type: 'string', minLength: 1, maxLength: 120 },
    contradictionHypothesis: { type: ['string', 'null'], maxLength: 360 },
    matrixInspiration: { type: ['string', 'null'], maxLength: 220 },
    matrixInspirationIsHypothesis: { type: 'boolean' },
    noveltyReason: { type: 'string', minLength: 1, maxLength: 500 },
    diversityReason: { type: 'string', minLength: 1, maxLength: 500 },
    whyNotDuplicate: { type: 'string', minLength: 1, maxLength: 500 },
    questionPurpose: { type: 'string', minLength: 1, maxLength: 500 },
  },
}

export const ENGINE2_PANEL_QUESTION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'engine2_panel_questions',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'questionCandidates'],
      properties: {
        schemaVersion: { type: 'string', const: ENGINE2_PANEL_QUESTION_SCHEMA_VERSION },
        questionCandidates: { type: 'array', minItems: 3, maxItems: 3, items: questionCandidateSchema },
      },
    },
  },
}

export const ENGINE2_PANEL_QUESTION_SYSTEM_PROMPT = `You generate only the next three Engine 2 panel questions.
Return exactly one JSON object with schemaVersion and questionCandidates.
Do not evaluate readiness. Do not score. Do not generate chatQuestion or assistant messages.
Return exactly 3 different panel questions.
Primary goal: discover valuable contradictions and tensions in the idea before action planning, without inventing requirements.
Start from established confirmed requirements. Use contradictionMatrixReference only as internal inspiration for possible improving/worsening axes. Filter those axes through the whole conversation, form grounded contradiction hypotheses, then write natural questions.
If there is no formal confirmed/open contradiction yet, prefer fact-discovery questions over forced "will you accept X at the cost of Y" trade-off questions. Ask what currently happens, when the problem occurs, what must remain unchanged, what is truly mandatory, and what boundary conditions matter.
Use matrix-inspired axes that are not user requirements only as exploration hypotheses. Ask whether the area matters; do not phrase the hypothesis as if it was already required.
Default strategy is two contradiction probes plus one critical information question only when the context already contains real user-backed tensions. Otherwise use fact-discovery questions across three different dimensions.
Each question must be grounded in confirmed findings, ask about one concrete choice, observation, boundary, tradeoff or success test, and be answerable from the user's experience.
Avoid category prompts asking for features, functions, risks, decisions, success criteria, or what else.
Use the confirmed findings, question history, contradictions and guidanceForNextQuestions to avoid asking about uncertainties already covered by accepted findings.
If there is a suspected/open/confirmed/active contradiction without a current open panel question targeting it, the first question must target that contradiction with targetContradictionId.
If any active tension exists, at least one of the three questions must probe a contradiction or trade-off. Phrase it as a design decision that would resolve the tension, not as a generic preference survey.
Each candidate must include internal metadata: explorationArea, semanticExplorationKey, contradictionHypothesis, matrixInspiration, matrixInspirationIsHypothesis, noveltyReason, diversityReason, whyNotDuplicate and questionPurpose. The three semanticExplorationKey values must be meaningfully different exploration areas, not three variants of mobility, cost, size, light level, or another single axis.
Before returning, self-check: will answers to the three questions provide three different kinds of information? If not, replace one.
Do not return questions from the same semantic area. Treat semanticKey prefixes such as lamp_light_intensity_zone_count, lamp_light_intensity_range_preference and lamp_light_intensity_zone_size_preference as one cluster: lamp_light_intensity.
If the recent question history already contains two questions from one cluster, move to another area unless the new question directly targets an active contradiction. Cover usage context, constraints, ergonomics, success tests, risks or trade-offs instead of only tuning the same feature parameter.
Treat confirmed findings as settled. Do not ask whether, when or how often the user wants a confirmed feature just because it is present. Ask about a confirmed feature only when guidanceForNextQuestions or a stored contradiction points to a concrete unresolved boundary, feasibility test, risk, measurable limit or tension.
If the user already confirmed a range or mode, do not ask which endpoint they prefer. Explore implementation facts, usage context, limits, failure modes or stability instead.
Do not expose TRIZ, Contradiction Matrix, matrix parameter names, principle numbers, or matrix terminology in user-facing questions unless the user used those terms first.
When language=Polish, every user-facing field must be Polish and direct-address. Use "Chcesz...", "Potrzebujesz..." or "Warto ustalić..." style where natural. Do not write "Użytkownik chce...".
Output only strict JSON.`

export const canonicalizeEngine2PanelQuestions = (value) => {
  const rawCandidates = Array.isArray(value?.questionCandidates) ? value.questionCandidates : []
  return {
    schemaVersion: text(value?.schemaVersion, 80) || ENGINE2_PANEL_QUESTION_SCHEMA_VERSION,
    questionCandidates: rawCandidates.map((candidate, index) => ({
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
	      targetType: normalizeEngine2QuestionTargetType(candidate?.targetType, candidate) || 'observation',
      targetContradictionId: text(candidate?.targetContradictionId ?? candidate?.targetContradictionRef, 120) || null,
      explorationArea: text(candidate?.explorationArea, 160) || text(candidate?.semanticKey || candidate?.gapKey, 160),
      semanticExplorationKey: engine2QuestionExplorationKey(candidate),
      contradictionHypothesis: text(candidate?.contradictionHypothesis, 360) || null,
      matrixInspiration: text(candidate?.matrixInspiration, 220) || legacyExplorationMetadataFallback,
      matrixInspirationIsHypothesis: candidate?.matrixInspirationIsHypothesis === true,
      noveltyReason: text(candidate?.noveltyReason, 500) || 'Kandydat sprawdza niewiadomą niewynikającą z istniejących pytań.',
      diversityReason: text(candidate?.diversityReason, 500) || 'Kandydat ma osobny semanticExplorationKey.',
      whyNotDuplicate: text(candidate?.whyNotDuplicate, 500) || 'Brak identycznego semanticKey w bieżącym zestawie.',
      questionPurpose: text(candidate?.questionPurpose, 500) || text(candidate?.intent, 500),
    })),
  }
}

export const validateEngine2PanelQuestions = (value, context = {}) => {
  const errors = []
  const output = canonicalizeEngine2PanelQuestions(value)
  if (output.schemaVersion !== ENGINE2_PANEL_QUESTION_SCHEMA_VERSION && !Array.isArray(value?.questionCandidates)) {
    errors.push(`schemaVersion must equal ${ENGINE2_PANEL_QUESTION_SCHEMA_VERSION}`)
  }
  const candidates = output.questionCandidates
  if (candidates.length !== 3) errors.push('questionCandidates must contain exactly three items')
  const allFindings = Array.isArray(context.allFindings) ? context.allFindings : []
  const findingById = new Map(allFindings.map((finding) => [finding.id, finding]))
  const activeContradictionRefs = contradictionRefs(context.activeContradictions || context.contradictions)
  const openTargetRefs = new Set((Array.isArray(context.questions) ? context.questions : [])
    .filter((question) => question?.status === 'open')
    .map((question) => text(question?.targetContradictionId, 120))
    .filter(Boolean))
  const needsContradictionQuestion = [...activeContradictionRefs].some((ref) => !openTargetRefs.has(ref))
  const seenKeys = new Set()
  const clusterCounts = new Map()
  const explorationKeys = new Set()
  let explicitExplorationMetadataCount = 0
  for (const [index, candidate] of candidates.entries()) {
    if (!text(candidate.clientRef, 120)) errors.push(`questionCandidates[${index}] requires clientRef`)
    if (!text(candidate.semanticKey, 120)) errors.push(`questionCandidates[${index}] requires semanticKey`)
    if (seenKeys.has(candidate.semanticKey)) errors.push(`duplicate question candidate semanticKey: ${candidate.semanticKey}`)
    seenKeys.add(candidate.semanticKey)
    if (!text(candidate.question, 320) || !text(candidate.intent, 320) || !text(candidate.reason, 500)) errors.push(`questionCandidates[${index}] requires question, intent and reason`)
    validatePolishUserFacingText({ value: candidate.question, path: `questionCandidates[${index}].question`, errors, language: context.language })
    if (matrixLeakPattern.test(candidate.question)) errors.push(`questionCandidates[${index}] leaks internal matrix terminology`)
    if (candidate.presentation !== 'panel') errors.push(`questionCandidates[${index}] presentation must be panel`)
    if (!text(candidate.targetType, 80)) errors.push(`questionCandidates[${index}] requires targetType`)
    if (activeContradictionRefs.size > 0 && candidate.targetContradictionId && !activeContradictionRefs.has(candidate.targetContradictionId)) errors.push(`questionCandidates[${index}] references unknown targetContradictionId: ${candidate.targetContradictionId}`)
    if (!text(candidate.concreteAnchorText, 240)) errors.push(`questionCandidates[${index}] requires concreteAnchorText`)
    if (!text(candidate.uncertaintyToResolve, 240)) errors.push(`questionCandidates[${index}] requires uncertaintyToResolve`)
    if (typeof candidate.userCanAnswerFromExperience !== 'boolean') errors.push(`questionCandidates[${index}] requires userCanAnswerFromExperience`)
    if (typeof candidate.forbiddenGenericCategoryQuestion !== 'boolean') errors.push(`questionCandidates[${index}] requires forbiddenGenericCategoryQuestion`)
    if (!text(candidate.explorationArea, 160)) errors.push(`questionCandidates[${index}] requires explorationArea`)
    if (hasExplicitExplorationMetadata(candidate)) explicitExplorationMetadataCount += 1
    const explorationKey = engine2QuestionExplorationKey(candidate)
    if (!explorationKey) errors.push(`questionCandidates[${index}] requires semanticExplorationKey`)
    else if (explorationKeys.has(explorationKey)) errors.push(`duplicate semantic exploration area: ${explorationKey}`)
    else explorationKeys.add(explorationKey)
    if (!text(candidate.matrixInspiration, 220)) errors.push(`questionCandidates[${index}] requires matrixInspiration`)
    if (typeof candidate.matrixInspirationIsHypothesis !== 'boolean') errors.push(`questionCandidates[${index}] requires matrixInspirationIsHypothesis`)
    if (!text(candidate.noveltyReason, 500)) errors.push(`questionCandidates[${index}] requires noveltyReason`)
    if (!text(candidate.diversityReason, 500)) errors.push(`questionCandidates[${index}] requires diversityReason`)
    if (!text(candidate.whyNotDuplicate, 500)) errors.push(`questionCandidates[${index}] requires whyNotDuplicate`)
    if (!text(candidate.questionPurpose, 500)) errors.push(`questionCandidates[${index}] requires questionPurpose`)
    if (!Array.isArray(candidate.groundedInFindingIds) || candidate.groundedInFindingIds.length === 0) errors.push(`questionCandidates[${index}] requires groundedInFindingIds`)
    for (const id of candidate.groundedInFindingIds || []) {
      const finding = findingById.get(id)
      if (!finding) errors.push(`questionCandidates[${index}] references unknown grounded finding: ${id}`)
      else if (finding.status !== 'confirmed') errors.push(`questionCandidates[${index}] grounded finding is not confirmed: ${id}`)
    }
    const cluster = engine2QuestionSemanticCluster(candidate.semanticKey)
    if (cluster) clusterCounts.set(cluster, (clusterCounts.get(cluster) || 0) + 1)
  }
  if (needsContradictionQuestion && !candidates.some((candidate) => activeContradictionRefs.has(candidate.targetContradictionId))) {
    errors.push('active contradiction requires a targeted panel question')
  }
  for (const [cluster, count] of clusterCounts.entries()) {
    if (count > 2 && explicitExplorationMetadataCount < candidates.length) errors.push(`too many question candidates in semantic cluster: ${cluster}`)
  }
  if (candidates.length === 3 && explorationKeys.size < 3) errors.push('questionCandidates must cover three distinct semantic exploration areas')
  return { ok: errors.length === 0, errors, output }
}

export const buildEngine2QuestionSetDiversityCheck = (candidates) => {
  const entries = Array.isArray(candidates) ? candidates : []
  const explorationKeys = entries.map(engine2QuestionExplorationKey).filter(Boolean)
  const distinctExplorationAreaCount = new Set(explorationKeys).size
  const duplicateKeys = [...new Set(explorationKeys.filter((key, index) => explorationKeys.indexOf(key) !== index))]
  return {
    questionSetDiversityCheck: entries.map((candidate) => ({
      semanticKey: candidate.semanticKey || null,
      explorationArea: candidate.explorationArea || null,
      semanticExplorationKey: engine2QuestionExplorationKey(candidate) || null,
      diversityReason: candidate.diversityReason || null,
      whyNotDuplicate: candidate.whyNotDuplicate || null,
    })),
    distinctExplorationAreaCount,
    duplicateSemanticRisk: duplicateKeys.length > 0 ? duplicateKeys : null,
    setDiversityAccepted: entries.length === 3 && distinctExplorationAreaCount === 3,
  }
}

export const selectValidEngine2PanelQuestionCandidates = (value, context = {}) => {
  const output = canonicalizeEngine2PanelQuestions(value)
  const valid = []
  const invalid = []
  const seen = new Set()
  for (const [index, candidate] of output.questionCandidates.entries()) {
    const errors = []
    const duplicate = seen.has(candidate.semanticKey)
    const validation = validateEngine2PanelQuestions({
      schemaVersion: ENGINE2_PANEL_QUESTION_SCHEMA_VERSION,
      questionCandidates: [
        candidate,
        { ...candidate, clientRef: `${candidate.clientRef}_shadow_1`, semanticKey: `${candidate.semanticKey}_shadow_1` },
        { ...candidate, clientRef: `${candidate.clientRef}_shadow_2`, semanticKey: `${candidate.semanticKey}_shadow_2` },
      ],
    }, context)
    const candidateErrors = validation.errors
      .filter((error) => !/^questionCandidates must contain exactly three items$/.test(error))
	      .filter((error) => !/shadow_[12]/.test(error))
      .filter((error) => !/^duplicate question candidate semanticKey:/.test(error))
	      .filter((error) => !/^duplicate semantic exploration area:/.test(error))
	      .filter((error) => !/^questionCandidates must cover three distinct semantic exploration areas$/.test(error))
	      .filter((error) => !/^too many question candidates in semantic cluster:/.test(error))
	      .filter((error) => !/^active contradiction requires a targeted panel question$/.test(error))
	      .filter((error) => !/^questionCandidates\[[12]\]/.test(error))
      .map((error) => error.replace(/^questionCandidates\[0\]/, `questionCandidates[${index}]`))
    if (duplicate) candidateErrors.push(`duplicate question candidate semanticKey: ${candidate.semanticKey}`)
    if (candidateErrors.length > 0) {
      invalid.push({ index, candidate, errors: candidateErrors })
    } else {
      valid.push(candidate)
      seen.add(candidate.semanticKey)
    }
  }
  const diversified = diversifyEngine2PanelQuestionCandidates(valid, context)
  const diversifiedSkipped = diversified.skipped.map(({ candidate, reason, cluster }) => ({
    index: output.questionCandidates.indexOf(candidate),
    candidate,
    errors: [`${reason}: ${cluster}`],
  }))
  return { valid: diversified.candidates, invalid, skipped: diversifiedSkipped, output, diversification: diversified }
}

export const buildEngine2PanelQuestionInput = (input) => ({
  language: input.language,
  contradictionMatrixReference: input.contradictionMatrixReference || buildEngine2ContradictionMatrixReference(),
  guidanceForNextQuestions: text(input.guidanceForNextQuestions, 1200) || null,
  readinessGuidance: input.readinessGuidance && typeof input.readinessGuidance === 'object' ? {
    criticalMissing: (Array.isArray(input.readinessGuidance.criticalMissing) ? input.readinessGuidance.criticalMissing : [])
      .map((entry) => text(entry, 200))
      .filter(Boolean)
      .slice(0, 3),
    incompleteComponents: (Array.isArray(input.readinessGuidance.incompleteComponents) ? input.readinessGuidance.incompleteComponents : [])
      .map((entry) => text(entry, 80))
      .filter(Boolean)
      .slice(0, 6),
    preferredQuestionCandidates: (Array.isArray(input.readinessGuidance.preferredQuestionCandidates) ? input.readinessGuidance.preferredQuestionCandidates : [])
      .slice(0, 3)
      .map((candidate) => ({
        semanticKey: text(candidate?.semanticKey, 120),
        question: text(candidate?.question || candidate?.text, 320),
        targetType: text(candidate?.targetType, 80) || null,
        targetContradictionId: text(candidate?.targetContradictionId, 120) || null,
      }))
      .filter((candidate) => candidate.semanticKey && candidate.question),
  } : null,
  confirmedFindings: (Array.isArray(input.confirmedFindings) ? input.confirmedFindings : []).map((finding) => ({
    id: text(finding?.id, 120),
    semanticKey: text(finding?.semanticKey, 120),
    displayText: text(finding?.displayText || finding?.text || finding?.content, 800),
    text: text(finding?.text || finding?.content || finding?.displayText, 800),
    subject: text(finding?.subject, 80) || null,
    perspective: text(finding?.perspective, 80) || null,
    sourceMessageIds: idArray(finding?.sourceMessageIds),
    decisionAt: text(finding?.decisionAt, 80) || null,
    updatedAt: text(finding?.updatedAt, 80) || null,
  })).filter((finding) => finding.id && finding.text),
  openQuestionLedger: (Array.isArray(input.questions) ? input.questions : [])
    .filter((question) => question?.status === 'open')
    .map(questionLedgerEntry),
  answeredCoveredObsoleteQuestionHistory: (Array.isArray(input.questions) ? input.questions : [])
    .filter((question) => ['answered', 'covered', 'obsolete', 'resolved', 'dismissed', 'superseded', 'replaced', 'skipped', 'retired'].includes(question?.status))
    .map(questionLedgerEntry),
  questionHistory: (Array.isArray(input.questions) ? input.questions : []).map(questionLedgerEntry),
  conversationContext: (Array.isArray(input.conversationContext || input.history) ? (input.conversationContext || input.history) : [])
    .slice(-12)
    .map((message) => ({
      id: text(message?.id, 120),
      role: ['user', 'assistant'].includes(message?.role) ? message.role : null,
      content: text(message?.content || message?.text, 1000),
    }))
    .filter((message) => message.id && message.role && message.content),
  knownContradictions: (Array.isArray(input.contradictions || input.activeContradictions) ? (input.contradictions || input.activeContradictions) : []).map((contradiction) => ({
    id: text(contradiction?.id, 120),
    semanticKey: text(contradiction?.semanticKey, 120),
    status: text(contradiction?.status, 80),
    summary: text(contradiction?.description || `${contradiction?.sideA || ''} / ${contradiction?.sideB || ''}`, 280),
    sideA: text(contradiction?.sideA, 260) || null,
    sideB: text(contradiction?.sideB, 260) || null,
    sourceFindingIds: idArray(contradiction?.sourceFindingIds || contradiction?.findingIds),
  })).filter((contradiction) => contradiction.id || contradiction.semanticKey || contradiction.summary),
})

const questionLedgerEntry = (question) => ({
  id: text(question?.id, 120),
  semanticKey: text(question?.semanticKey || question?.gapKey, 120),
  question: text(question?.question || question?.text, 500),
  intent: text(question?.intent, 500),
  reason: text(question?.reason || question?.priorityReason, 500),
  status: text(question?.status, 80) || 'open',
  presentation: text(question?.presentation, 80) || 'hidden',
  groundedInFindingIds: idArray(question?.groundedInFindingIds),
  coveredByFindingIds: idArray(question?.coveredByFindingIds),
  answeredByMessageIds: idArray(question?.answeredByMessageIds),
  targetType: text(question?.targetType, 80) || null,
  targetContradictionId: text(question?.targetContradictionId, 120) || null,
  concreteAnchorText: text(question?.concreteAnchorText, 240) || null,
  uncertaintyToResolve: text(question?.uncertaintyToResolve, 240) || null,
  explorationArea: text(question?.explorationArea, 160) || null,
  semanticExplorationKey: engine2QuestionExplorationKey(question) || null,
  contradictionHypothesis: text(question?.contradictionHypothesis, 360) || null,
})

const modelInput = (input) => JSON.stringify(buildEngine2PanelQuestionInput(input))
const inputHash = (value) => createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24)
const ENGINE2_PANEL_QUESTION_INITIAL_OUTPUT_TOKENS = 1800
const ENGINE2_PANEL_QUESTION_RETRY_OUTPUT_TOKENS = 2800

const isLikelyOutputTokenLimit = (attempt, maxOutputTokens) => {
  const outputTokens = Number(attempt?.meta?.tokens?.output || 0)
  return outputTokens > 0 && outputTokens >= maxOutputTokens
}

const runAttempt = async ({ input, apiKey, aiSupportEnabled, rateLimiter, rateLimitKey, runTask, maxOutputTokens }) => {
  let rawOutput = null
  const result = await runTask({
    apiKey,
    aiSupportEnabled,
    task: 'engine2-panel-questions',
    input: modelInput(input),
    language: input.language === 'pl' ? 'Polish' : 'English',
    taskInstructions: 'Return exactly three concrete panel questionCandidates. Do not return readiness, scoring, contradiction analysis, assistant messages, or a chat question.',
    parseResponse: parseObject,
    fallbackData: null,
    skipPreprocess: true,
    useDefaultModelWhenSkippingPreprocess: true,
    maxOutputTokens,
    maxInputChars: 30_000,
    temperature: 0.15,
    timeoutMs: ENGINE2_PANEL_QUESTION_TIMEOUT_MS,
    responseFormat: ENGINE2_PANEL_QUESTION_RESPONSE_FORMAT,
    systemPrompt: ENGINE2_PANEL_QUESTION_SYSTEM_PROMPT,
    rateLimiter,
    rateLimitKey,
    onRawResponse: ({ content }) => { rawOutput = content },
  })
  return { ...result, rawOutput, maxOutputTokens }
}

export const generateEngine2PanelQuestions = async ({
  input, apiKey, aiSupportEnabled, rateLimiter = null, rateLimitKey = null, runTask = runLlmTask,
}) => {
  const startedAt = Date.now()
  const serializedInput = modelInput(input)
  const attempts = []
  const context = {
    allFindings: input.allFindings,
    questions: input.questions,
    activeContradictions: input.activeContradictions,
    contradictions: input.contradictions,
    language: input.language,
  }
  const validate = (attempt) => {
    if (attempt.ok) {
      return validateEngine2PanelQuestions(attempt.data, {
        allFindings: input.allFindings,
        questions: input.questions,
        activeContradictions: input.activeContradictions,
        contradictions: input.contradictions,
        language: input.language,
      })
    }
    if (attempt.meta?.errorCategory === 'PARSE_ERROR') {
      return {
        ok: false,
        errors: isLikelyOutputTokenLimit(attempt, attempt.maxOutputTokens)
          ? [`response was truncated at maxOutputTokens=${attempt.maxOutputTokens}`]
          : ['response is not valid structured JSON'],
      }
    }
    return { ok: false, errors: [attempt.meta?.errorCategory || 'question generation failed'] }
  }
  const first = await runAttempt({
    input,
    apiKey,
    aiSupportEnabled,
    rateLimiter,
    rateLimitKey,
    runTask,
    maxOutputTokens: ENGINE2_PANEL_QUESTION_INITIAL_OUTPUT_TOKENS,
  })
  first.validation = validate(first)
  first.partialSelection = first.ok ? selectValidEngine2PanelQuestionCandidates(first.data, context) : { valid: [], invalid: [], output: null }
  attempts.push(first)
  if (!first.ok && first.meta?.errorCategory === 'PARSE_ERROR' && isLikelyOutputTokenLimit(first, first.maxOutputTokens)) {
    const retry = await runAttempt({
      input,
      apiKey,
      aiSupportEnabled,
      rateLimiter,
      rateLimitKey,
      runTask,
      maxOutputTokens: ENGINE2_PANEL_QUESTION_RETRY_OUTPUT_TOKENS,
    })
    retry.validation = validate(retry)
    retry.partialSelection = retry.ok ? selectValidEngine2PanelQuestionCandidates(retry.data, context) : { valid: [], invalid: [], output: null }
    attempts.push(retry)
  }
  const final = attempts.at(-1)
  const partialSelection = final.partialSelection || { valid: [], invalid: [], output: null }
  const ok = Boolean(final.ok && (final.validation.ok || partialSelection.valid.length > 0))
  const canonicalCandidates = final.ok ? canonicalizeEngine2PanelQuestions(final.data).questionCandidates : []
  const diversified = final.validation.ok
    ? diversifyEngine2PanelQuestionCandidates(canonicalCandidates, context)
    : partialSelection.diversification || { candidates: partialSelection.valid, skipped: [], needsContradictionQuestion: false, hasContradictionQuestion: false }
  const questionSetDiversity = buildEngine2QuestionSetDiversityCheck(diversified.candidates)
  return {
    ok,
    questionCandidates: ok
      ? diversified.candidates
      : [],
    validation: final.validation,
    partialValidation: {
      validCandidateCount: partialSelection.valid.length,
      invalidCandidateCount: partialSelection.invalid.length,
      invalidCandidates: partialSelection.invalid,
      skippedCandidateCount: (partialSelection.skipped || []).length,
      skippedCandidates: partialSelection.skipped || [],
      semanticDiversification: diversified,
      questionSetDiversityCheck: questionSetDiversity.questionSetDiversityCheck,
      distinctExplorationAreaCount: questionSetDiversity.distinctExplorationAreaCount,
      duplicateSemanticRisk: questionSetDiversity.duplicateSemanticRisk,
      setDiversityAccepted: questionSetDiversity.setDiversityAccepted,
    },
    attempts: attempts.map((attempt) => ({
      ok: attempt.ok,
      rawOutput: attempt.rawOutput,
      parsedOutput: attempt.data || null,
      validation: attempt.validation,
      meta: attempt.meta,
    })),
    meta: {
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      inputBytes: Buffer.byteLength(serializedInput, 'utf8'),
      inputHash: inputHash(serializedInput),
      inputPreview: serializedInput.slice(0, 800),
      outputBytes: Buffer.byteLength(String(final?.rawOutput || ''), 'utf8'),
      attemptCount: attempts.length,
      timeoutMs: ENGINE2_PANEL_QUESTION_TIMEOUT_MS,
      providerCalls: attempts.filter((attempt) => attempt?.meta?.providerCalled !== false).length,
      tokens: attempts.reduce((sum, attempt) => ({
        input: sum.input + Number(attempt?.meta?.tokens?.input || 0),
        output: sum.output + Number(attempt?.meta?.tokens?.output || 0),
        total: sum.total + Number(attempt?.meta?.tokens?.total || 0),
      }), { input: 0, output: 0, total: 0 }),
      modelUsed: final?.meta?.modelUsed || final?.meta?.attemptedModel || null,
      providerRequestIds: attempts.map((attempt) => attempt?.meta?.providerRequestId).filter(Boolean),
      providerDiagnostics: final?.meta?.providerDiagnostics || null,
      providerCallStartedAt: final?.meta?.providerCallStartedAt || null,
      providerCallResolvedAt: final?.meta?.providerCallResolvedAt || null,
      providerCallAbortedAt: final?.meta?.providerCallAbortedAt || null,
      abortReason: final?.meta?.abortReason || null,
      timeoutSource: final?.meta?.timeoutSource || null,
      model: final?.meta?.modelUsed || final?.meta?.attemptedModel || final?.meta?.providerModel || null,
      responseFormatName: final?.meta?.responseFormatName || ENGINE2_PANEL_QUESTION_RESPONSE_FORMAT.json_schema.name,
      repairRetry: attempts.length > 1,
      errorCategory: ok ? null : final?.meta?.errorCategory || final?.validation?.errors?.[0] || 'QUESTION_GENERATION_FAILED',
      ...questionSetDiversity,
    },
  }
}
