import { createHash } from 'node:crypto'
import { runLlmTask } from '../../../llm/llmRouter.mjs'
import {
  isEngine2FormalContradictionChangeEligible,
  normalizeEngine2ContradictionEvidence,
} from './engine2ContradictionEvidence.js'
import { buildEngine2ContradictionMatrixReference } from './engine2ContradictionMatrix.js'
import {
  ENGINE2_CONTRADICTION_STATUSES,
  validatePolishUserFacingText,
} from './engine2UserFacingText.js'

export const ENGINE2_CONTRADICTION_DETECTION_SCHEMA_VERSION = 'engine2.contradiction_detection.v1'
export const ENGINE2_CONTRADICTION_DETECTION_TIMEOUT_MS = 15_000

const text = (value, max = 0) => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return max ? normalized.slice(0, max) : normalized
}
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const parseObject = (raw) => { try { const parsed = JSON.parse(raw); return isObject(parsed) ? parsed : null } catch { return null } }
const idArray = (value) => [...new Set((Array.isArray(value) ? value : []).map((entry) => text(entry, 120)).filter(Boolean))]
const hash = (value) => createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24)
const normalizeKey = (value) => text(value, 120)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120)

const sourceMessageIdsFromFinding = (finding) => idArray([
  finding?.sourceMessageId,
  ...(Array.isArray(finding?.sourceMessageIds) ? finding.sourceMessageIds : []),
  ...(Array.isArray(finding?.messageIds) ? finding.messageIds : []),
])

const normalizeSignalSide = (value, fallback) => text(value, 180) || fallback

const splitSoftTensionSides = (value) => {
  const source = text(value, 600)
  const patterns = [
    /\bz\s+jednej\s+strony\b([\s\S]{2,220}?)\bz\s+drugiej(?:\s+strony)?\b([\s\S]{2,260})/i,
    /\bzar[oó]wno\b([\s\S]{2,220}?)\bjak\s+i\b([\s\S]{2,260})/i,
    /([\s\S]{2,240}?)\bale\b([\s\S]{2,260})/i,
    /([\s\S]{2,240}?)\bjednocze[sś]nie\b([\s\S]{2,260})/i,
  ]
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (!match) continue
    return {
      sideA: normalizeSignalSide(match[1], 'Pierwsza strona napięcia'),
      sideB: normalizeSignalSide(match[2], 'Druga strona napięcia'),
    }
  }
  return {
    sideA: 'Pierwsza strona napięcia w materiale',
    sideB: 'Druga strona napięcia w materiale',
  }
}

const tensionPatterns = [
  {
    key: 'portability_vs_stability',
    re: /(sta[cć]|biurku|przen(?:ie|os)|mobiln|lekk[aiąo]?).{0,220}(ale|jednocze[sś]nie|zar[oó]wno|r[oó]wnie[zż]).{0,180}(stabiln|nie\s+przewrac|przewraca[cć]|podstaw)|(lekk[aiąo]?|przen(?:ie|os)|mobiln).{0,220}(stabiln|nie\s+przewrac|przewraca[cć])/is,
    description: 'Projekt musi pogodzić lekkość i możliwość przenoszenia lampy ze stabilnością na biurku i odpornością na przewracanie.',
    sideA: 'Lekka i łatwa do przeniesienia lampa',
    sideB: 'Stabilna lampa, która nie przewraca się na biurku',
  },
  {
    key: 'simple_interface_vs_many_options',
    re: /(prost(?:y|a|e|ego)?|intuicyjn|oczywist).{0,180}(interfejs|interface|obs[lł]ug|sterowan).{0,180}(du[zż][aąe]?\s+ilo[sś][cć]|wiele|du[zż]o|liczne).{0,120}(opcj|funkcj|ustawie[nń])|(prost(?:y|a|e|ego)?).{0,140}(du[zż][aąe]?\s+ilo[sś][cć]|wiele|du[zż]o).{0,120}(opcj|funkcj|ustawie[nń])/is,
    description: 'Interfejs ma pozostać prosty i oczywisty, ale jednocześnie obsługiwać dużą liczbę opcji lub funkcji.',
    sideA: 'Prosta i szybka obsługa',
    sideB: 'Duża liczba opcji sterowania',
  },
  {
    key: 'mains_power_vs_battery_mobility',
    re: /(gniazd(?:ka|ko)|sieci|230\s?v|zasilan(?:ie|a)?\s+sieciow|kabel).{0,180}(bateri|akumulator|bezprzewod|mobiln|przeno[sś])|(bateri|akumulator|bezprzewod|mobiln|przeno[sś]).{0,180}(gniazd(?:ka|ko)|sieci|230\s?v|kabel)/is,
    description: 'Zasilanie z gniazdka daje stałą pracę, ale zasilanie bateryjne zwiększa mobilność kosztem masy, ceny lub czasu działania.',
    sideA: 'Stałe zasilanie z gniazdka',
    sideB: 'Mobilność dzięki baterii lub akumulatorowi',
  },
  {
    key: 'light_color_temperature_modes',
    re: /\b(ciep(?:l|ł)e|ciep(?:l|ł)y|ciep(?:l|ł)a)\b[\s\S]{0,120}\b(komputer|ekran|pracy przy komputerze)\b[\s\S]{0,160}\b(zimne|zimny|zimna|ch(?:l|ł)odne|ch(?:l|ł)odny)\b[\s\S]{0,160}\b(precyzyjn|dok(?:l|ł)adn|napraw|prac)\b/i,
    description: 'Niejasne, czy lampa ma mieć osobne tryby barwy światła dla pracy przy komputerze i precyzyjnych prac, czy płynną regulację między nimi.',
    sideA: 'Ciepłe światło do pracy przy komputerze',
    sideB: 'Zimne światło do precyzyjnych prac',
  },
  {
    key: 'light_distribution_modes',
    re: /(szerok(?:i|ie|iego)?|og[oó]lny|rozproszon).{0,180}(strumie[nń]|[sś]wiat(?:l|ł)o|o[sś]wietlen|sto[zż]ka?).{0,180}(punktow|skupion|precyzyjn)|(sto[zż]ka?\s+[sś]wiat(?:l|ł)a|[sś]wiat(?:l|ł)o).{0,140}(szerok(?:i|ie|iego)?|og[oó]lny|rozproszon).{0,160}(punktow|skupion|precyzyjn)/is,
    description: 'Niejasne, czy lampa ma przełączać się między szerokim światłem ogólnym i punktowym światłem do precyzyjnej pracy, czy regulować ten zakres płynnie.',
    sideA: 'Szeroki ogólny strumień światła',
    sideB: 'Punktowe światło do precyzyjnych prac',
  },
  {
    key: 'energy_efficiency_vs_bright_light',
    re: /(ma[lł]o\s+energ|nisk(?:ie|i|a)?\s+zu[zż]yc(?:ie|ia)?\s+energ|energooszcz[eę]dn).{0,220}(jasn|mocn|dobr(?:e|ego)?\s+[sś]wiat(?:l|ł)o|wysok(?:a|ie)?\s+nat[eę][zż]en)|(jasn|mocn|dobr(?:e|ego)?\s+[sś]wiat(?:l|ł)o|wysok(?:a|ie)?\s+nat[eę][zż]en).{0,220}(ma[lł]o\s+energ|nisk(?:ie|i|a)?\s+zu[zż]yc(?:ie|ia)?\s+energ|energooszcz[eę]dn)/is,
    description: 'Lampa ma zużywać mało energii i jednocześnie dawać dobre, jasne światło.',
    sideA: 'Niskie zużycie energii',
    sideB: 'Dobre, jasne światło',
    formalSemanticKey: 'lamp_energy_efficiency_vs_bright_light',
  },
  {
    key: 'visible_controls_vs_discreet_controls',
    re: /(widoczn|oczywist|r[aą]czk|d[zź]wigni|uchwyt).{0,220}(dyskret|ukryt|subteln|apka|aplikacj)|(dyskret|ukryt|subteln|apka|aplikacj).{0,220}(widoczn|oczywist|r[aą]czk|d[zź]wigni|uchwyt)/is,
    description: 'Część sterowania ma być widoczna i oczywista, a część bardziej dyskretna lub przeniesiona do aplikacji.',
    sideA: 'Widoczne i oczywiste sterowanie fizyczne',
    sideB: 'Dyskretne sterowanie dodatkowymi opcjami',
  },
  {
    key: 'cheap_vs_premium',
    re: /(tani|tanio|niski koszt|bud[zż]et|niedrog).{0,180}(premium|jako[sś][cć]|solidn|wytrzyma[lł]|precyzyjn)|(premium|jako[sś][cć]|solidn|wytrzyma[lł]|precyzyjn).{0,180}(tani|tanio|niski koszt|bud[zż]et|niedrog)/is,
    description: 'Projekt próbuje utrzymać niski koszt, ale jednocześnie oczekuje jakości, solidności lub efektu premium.',
    sideA: 'Niski koszt lub budżetowe wykonanie',
    sideB: 'Wyższa jakość, solidność albo efekt premium',
  },
  {
    key: 'flexible_vs_rigid',
    re: /(elastyczn|regulowan|gi[eę]tk|ruchom).{0,180}(sztywn|stabiln|blokad|trzyma[cć])|(sztywn|stabiln|blokad|trzyma[cć]).{0,180}(elastyczn|regulowan|gi[eę]tk|ruchom)/is,
    description: 'Element ma być elastyczny lub regulowany, ale po ustawieniu musi pozostać sztywny i stabilny.',
    sideA: 'Elastyczna regulacja ustawienia',
    sideB: 'Sztywne i stabilne utrzymanie pozycji',
  },
  {
    key: 'brightness_required_but_unspecified',
    re: /\b(regulacj[aeę]|regulowa[cć]|jasno[sś][cć]|nat[eę][zż]en)\b[\s\S]{0,120}\b(konieczna|potrzebna|musi|trzeba)\b[\s\S]{0,160}\b(nie wiem|nie potrafi[eę]|trudno|jak okre[sś]li[cć]|ile lumen[oó]w)\b/i,
    description: 'Regulacja jasności jest potrzebna, ale niejasne jest, według jakiego zakresu lub sytuacji pracy określić wymaganą jasność.',
    sideA: 'Regulacja jasności jest konieczna',
    sideB: 'Zakres jasności nie jest jeszcze określony',
  },
  {
    key: 'zone_control_mode_ambiguity',
    re: /(\s\/\s|\/|jedn(ą|a|ej)\s+stref[aeęy][\s\S]{0,80}\b(jednocze[sś]nie|naraz)|jednocze[sś]nie[\s\S]{0,80}\b(osobno|oddzielnie|niezale[zż]nie|jedn(ą|a|ej)\s+stref))/i,
    description: 'Niejasne, czy użytkownik chce sterować jedną strefą, kilkoma strefami niezależnie, czy kilkoma strefami jednocześnie.',
    sideA: 'Sterowanie jedną strefą naraz',
    sideB: 'Sterowanie wieloma strefami jednocześnie lub jednym ustawieniem',
  },
]

const genericSoftTensionPatterns = [
  {
    key: 'explicit_but_tension',
    re: /\b(ale|jednocze[sś]nie)\b/i,
    description: 'W materiale jest jawnie zestawione napięcie lub kompromis, który może wpływać na decyzję projektową.',
    confidence: 0.58,
  },
  {
    key: 'both_and_tension',
    re: /\bzar[oó]wno\b[\s\S]{2,260}\bjak\s+i\b/i,
    description: 'Materiał łączy dwa oczekiwania w formule zarówno/jak i, co może wymagać priorytetu lub trybu działania.',
    confidence: 0.62,
  },
  {
    key: 'one_hand_other_hand_tension',
    re: /\bz\s+jednej\s+strony\b[\s\S]{2,260}\bz\s+drugiej(?:\s+strony)?\b/i,
    description: 'Materiał wskazuje dwie strony decyzji projektowej, które trzeba pogodzić lub rozstrzygnąć.',
    confidence: 0.68,
  },
]

const contradictionChangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'operation', 'contradictionId', 'semanticKey', 'description', 'sideA', 'sideB',
    'sourceFindingIds', 'sourceMessageIds', 'status', 'reportBlocking',
    'verificationQuestionId', 'resolutionFindingIds', 'sideASourceFindingIds',
    'sideBSourceFindingIds', 'sideASourceMessageIds', 'sideBSourceMessageIds',
    'evidenceStatus', 'origin', 'formalEligible', 'rejectionReason',
  ],
  properties: {
    operation: { type: 'string', enum: ['create', 'update', 'resolve', 'dismiss', 'supersede'] },
    contradictionId: { type: ['string', 'null'] },
    semanticKey: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', minLength: 1, maxLength: 500 },
    sideA: { type: 'string', minLength: 1, maxLength: 260 },
    sideB: { type: 'string', minLength: 1, maxLength: 260 },
    sourceFindingIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sourceMessageIds: { type: 'array', minItems: 0, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideASourceFindingIds: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideBSourceFindingIds: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideASourceMessageIds: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
    sideBSourceMessageIds: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
    status: { type: 'string', enum: ENGINE2_CONTRADICTION_STATUSES },
    reportBlocking: { type: 'boolean' },
    verificationQuestionId: { type: ['string', 'null'] },
    resolutionFindingIds: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
    evidenceStatus: { type: 'string', enum: ['confirmed_requirement_tension', 'exploration_hypothesis', 'alternative_or_mode'] },
    origin: { type: 'string', enum: ['user_requirements', 'matrix_hypothesis', 'heuristic'] },
    formalEligible: { type: 'boolean' },
    rejectionReason: { type: ['string', 'null'], maxLength: 300 },
  },
}

export const ENGINE2_CONTRADICTION_DETECTION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'engine2_contradiction_detection',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'contradictionChanges'],
      properties: {
        schemaVersion: { type: 'string', const: ENGINE2_CONTRADICTION_DETECTION_SCHEMA_VERSION },
        contradictionChanges: { type: 'array', maxItems: 8, items: contradictionChangeSchema },
      },
    },
  },
}

export const ENGINE2_CONTRADICTION_DETECTION_SYSTEM_PROMPT = `You detect Engine 2 contradictions and tensions after confirmed findings changed.
Return only strict JSON.
Do not generate questions. Do not evaluate readiness. Do not propose findings.
Use LLM semantic judgment to create, update, resolve, dismiss or supersede contradictions grounded in confirmed findings.
Heuristic soft-tension patterns are diagnostics only. Never create, update, resolve, dismiss or supersede contradictions because a phrase matches a simple pattern.
Use contradictionMatrixReference only as internal inspiration for possible improving/worsening axes. It is not a checklist, not a source of canned contradictions, and not user-facing language.
Never turn a contradictionMatrixReference parameter into a user requirement. If the user did not state or confirm a side, return no formal contradiction for it.
If there is no real tension, return contradictionChanges=[].
Detect not only hard logical contradictions, but also ambiguous alternatives, design tensions, requirements that may imply two different operating modes, and compressed phrases such as "A / B", "simultaneously and separately", "simple but very precise", "cheap but premium", or "rigid but flexible".
Do not treat a plain alternative ("battery or USB", "A albo B") as a contradiction unless the wider context requires both sides simultaneously or shows a real trade-off.
Treat switchable/regulatable ranges or modes requested by the user, such as wide-to-spot light adjustment, quiet/high-performance modes, folded/unfolded states or manual/automatic control, as evidenceStatus=alternative_or_mode, not as formal contradictions.
For every returned candidate include sideASourceFindingIds/sideBSourceFindingIds and sideASourceMessageIds/sideBSourceMessageIds. Formal contradictions require evidence for both sides from user-provided or confirmed material.
Set evidenceStatus=confirmed_requirement_tension, origin=user_requirements and formalEligible=true only when both sides come from user requirements and simultaneous fulfillment may be difficult or impossible.
Set evidenceStatus=exploration_hypothesis and formalEligible=false for matrix-inspired possibilities missing one side of user evidence. Set evidenceStatus=alternative_or_mode and formalEligible=false for modes/options the user wants to switch or regulate.
For ambiguous alternatives or mode conflicts, use status=suspected or status=open. Set reportBlocking=true when a useful report could go in the wrong direction without clarifying the ambiguity or tension.
Use status=suspected for plausible tensions inferred from confirmed findings, open/confirmed/active only when the user has clearly confirmed both sides, resolved when resolved, dismissed when not applicable.
When language=Polish, user-facing contradiction fields must be Polish.`

const recentConversation = (history) => (Array.isArray(history) ? history : [])
  .slice(-6)
  .map((message) => ({
    id: text(message?.id, 120),
    role: ['user', 'assistant'].includes(message?.role) ? message.role : null,
    content: text(message?.content || message?.text, 1200),
    questionId: text(message?.questionId, 120) || null,
    replyToQuestionId: text(message?.replyToQuestionId || message?.questionId, 120) || null,
    replyToQuestionText: text(message?.replyToQuestionText, 500) || null,
  }))
  .filter((message) => message.id && message.role && message.content)

const latestUserAnswer = (input) => {
  const history = recentConversation(input.history)
  const latest = [...history].reverse().find((message) => message.role === 'user') || null
  if (!latest) return null
  const latestIndex = history.findIndex((message) => message.id === latest.id)
  const previousAssistantQuestion = latestIndex > 0
    ? [...history.slice(0, latestIndex)].reverse().find((message) => message.role === 'assistant' && (message.questionId || message.content)) || null
    : null
  const activeQuestionId = text(
    latest.replyToQuestionId ||
    input.activeQuestionId ||
    input.replyToQuestionId ||
    input.replyToGapId ||
    previousAssistantQuestion?.questionId,
    120
  ) || null
  const question = activeQuestionId
    ? (Array.isArray(input.questions) ? input.questions : []).find((entry) => entry?.id === activeQuestionId) || null
    : null
  return {
    id: latest.id,
    content: latest.content,
    replyToQuestionId: latest.replyToQuestionId || activeQuestionId,
    replyToQuestionText: latest.replyToQuestionText || text(question?.question || question?.text, 500) || previousAssistantQuestion?.content || null,
  }
}

export const inferEngine2SoftTensionSignals = (input = {}) => {
  const latest = latestUserAnswer(input)
  const latestMessageText = text(latest?.content || input.latestUserMessage || '', 2000)
  const confirmed = Array.isArray(input.confirmedFindings) ? input.confirmedFindings : []
  const pendingFindingChanges = Array.isArray(input.findingChanges) ? input.findingChanges : []
  const existingRefs = new Set((Array.isArray(input.contradictions) ? input.contradictions : [])
    .flatMap((contradiction) => [contradiction?.id, contradiction?.semanticKey])
    .filter(Boolean))

  const evidenceItems = [
    ...pendingFindingChanges.map((finding, index) => ({
      kind: 'pending_finding',
      id: text(finding?.clientRef || finding?.id || `pending-${index}`, 120),
      content: text(finding?.text || finding?.content || finding?.displayText, 1200),
      findingIds: idArray([finding?.clientRef || finding?.id]),
      messageIds: idArray([latest?.id || input.lastUserMessageId || input.messageId]),
    })),
    ...confirmed.map((finding) => ({
      kind: 'confirmed_finding',
      id: text(finding?.id || finding?.semanticKey, 120),
      content: text(finding?.displayText || finding?.text || finding?.content, 1200),
      findingIds: idArray([finding?.id]),
      messageIds: sourceMessageIdsFromFinding(finding),
    })),
    ...recentConversation(input.history)
      .filter((message) => message.role === 'user')
      .map((message) => ({
        kind: 'recent_user_message',
        id: message.id,
        content: text(message.content, 1200),
        findingIds: [],
        messageIds: idArray([message.id]),
      })),
  ].filter((item) => item.id && item.content)

  if (latestMessageText) {
    evidenceItems.unshift({
      kind: 'latest_user_message',
      id: text(latest?.id || input.lastUserMessageId || input.messageId || 'latest', 120),
      content: latestMessageText,
      findingIds: [],
      messageIds: idArray([latest?.id || input.lastUserMessageId || input.messageId]),
    })
  }

  const signals = []
  const seen = new Set()
  const pushSignal = ({ pattern, item, sideA, sideB, confidence }) => {
    const signature = normalizeKey(`${pattern.key}_${item.content}`)
    if (!signature || seen.has(signature)) return
    const semanticKey = normalizeKey(`${pattern.key}_${hash(`${item.id}:${item.content}`).slice(0, 10)}`)
    if (!semanticKey || seen.has(semanticKey) || existingRefs.has(semanticKey) || existingRefs.has(normalizeKey(`lamp_${pattern.key}`))) return
    seen.add(signature)
    seen.add(semanticKey)
      signals.push({
        semanticKey,
        formalSemanticKey: pattern.formalSemanticKey || null,
        patternKey: pattern.key,
        description: pattern.description,
      sideA,
      sideB,
      sourceFindingIds: item.findingIds,
      sourceMessageIds: item.messageIds,
      sideASourceFindingIds: [],
      sideBSourceFindingIds: [],
      sideASourceMessageIds: [],
      sideBSourceMessageIds: [],
      evidenceStatus: 'exploration_hypothesis',
      origin: 'heuristic',
      formalEligible: false,
      rejectionReason: 'heuristic_signal_diagnostics_only',
      confidence,
      source: item.kind,
      detector: pattern.detector || 'backend_soft_tension_heuristic',
    })
  }

  for (const pattern of tensionPatterns) {
    for (const item of evidenceItems) {
      if (!pattern.re.test(item.content)) continue
      pushSignal({
        pattern: { ...pattern, key: `lamp_${pattern.key}`, detector: 'backend_domain_tension_heuristic' },
        item,
        sideA: pattern.sideA,
        sideB: pattern.sideB,
        confidence: 0.86,
      })
    }
  }
  for (const pattern of genericSoftTensionPatterns) {
    for (const item of evidenceItems) {
      if (!pattern.re.test(item.content)) continue
      const sides = splitSoftTensionSides(item.content)
      pushSignal({ pattern, item, ...sides, confidence: pattern.confidence })
    }
  }

  return signals
}

export const inferEngine2TensionContradictionChanges = (input = {}) => {
  const existingRefs = new Set((Array.isArray(input.contradictions) ? input.contradictions : [])
    .flatMap((contradiction) => [contradiction?.id, contradiction?.semanticKey])
    .map(normalizeKey)
    .filter(Boolean))
  const findingBySourceMessage = new Map()
  for (const finding of (Array.isArray(input.allFindings) ? input.allFindings : input.confirmedFindings || [])) {
    for (const messageId of sourceMessageIdsFromFinding(finding)) {
      if (!findingBySourceMessage.has(messageId)) findingBySourceMessage.set(messageId, [])
      findingBySourceMessage.get(messageId).push(finding.id)
    }
  }
  return inferEngine2SoftTensionSignals(input)
    .flatMap((signal) => {
      const sourceMessageIds = idArray(signal.sourceMessageIds)
      const sourceFindingIds = idArray([
        ...(signal.sourceFindingIds || []),
        ...sourceMessageIds.flatMap((messageId) => findingBySourceMessage.get(messageId) || []),
      ])
      if (
        !signal.formalSemanticKey ||
        existingRefs.has(normalizeKey(signal.formalSemanticKey)) ||
        sourceFindingIds.length === 0 ||
        sourceMessageIds.length === 0
      ) return []
      return [normalizeEngine2ContradictionEvidence({
      operation: 'create',
      contradictionId: null,
      semanticKey: signal.formalSemanticKey,
      description: signal.description,
      sideA: signal.sideA,
      sideB: signal.sideB,
      sourceFindingIds,
      sourceMessageIds,
      sideASourceFindingIds: sourceFindingIds,
      sideBSourceFindingIds: sourceFindingIds,
      sideASourceMessageIds: sourceMessageIds,
      sideBSourceMessageIds: sourceMessageIds,
      status: 'suspected',
      reportBlocking: true,
      verificationQuestionId: null,
      resolutionFindingIds: [],
      evidenceStatus: 'confirmed_requirement_tension',
      origin: 'user_requirements',
      formalEligible: true,
      rejectionReason: null,
      }, { findings: input.allFindings || input.confirmedFindings || [] })]
    })
}

export const buildEngine2ContradictionDetectionInput = (input) => ({
  language: input.language,
  contradictionMatrixReference: input.contradictionMatrixReference || buildEngine2ContradictionMatrixReference(),
  recentConversation: recentConversation(input.history),
  recentUserMessages: recentConversation(input.history)
    .filter((message) => message.role === 'user')
    .map(({ id, content, replyToQuestionId, replyToQuestionText }) => ({ id, content, replyToQuestionId, replyToQuestionText })),
  latestUserAnswer: latestUserAnswer(input),
  activeQuestion: (() => {
    const activeQuestionId = text(input.activeQuestionId || input.replyToQuestionId || input.replyToGapId, 120)
    const question = activeQuestionId
      ? (Array.isArray(input.questions) ? input.questions : []).find((entry) => entry?.id === activeQuestionId)
      : null
    return question ? {
      id: text(question.id, 120),
      semanticKey: text(question.semanticKey || question.gapKey, 120),
      question: text(question.question || question.text, 500),
    } : null
  })(),
  confirmedFindings: (Array.isArray(input.confirmedFindings) ? input.confirmedFindings : [])
    .map((finding) => ({
      id: text(finding?.id, 120),
      semanticKey: text(finding?.semanticKey, 120),
      displayText: text(finding?.displayText || finding?.text || finding?.content, 1200),
      content: text(finding?.content || finding?.text || finding?.displayText, 1200),
      subject: text(finding?.subject, 80) || null,
      perspective: text(finding?.perspective, 80) || null,
      sourceMessageIds: idArray(finding?.sourceMessageIds),
    }))
    .filter((finding) => finding.id && (finding.displayText || finding.content)),
  existingContradictions: (Array.isArray(input.contradictions) ? input.contradictions : [])
    .map((contradiction) => ({
      id: text(contradiction?.id, 120),
      semanticKey: text(contradiction?.semanticKey, 120),
      status: text(contradiction?.status, 80),
      description: text(contradiction?.description, 500),
      sideA: text(contradiction?.sideA, 260),
      sideB: text(contradiction?.sideB, 260),
      sourceFindingIds: idArray(contradiction?.sourceFindingIds || contradiction?.findingIds),
      sourceMessageIds: idArray(contradiction?.sourceMessageIds || contradiction?.messageIds),
    }))
    .filter((contradiction) => contradiction.id || contradiction.semanticKey || contradiction.description),
  openPanelQuestions: (Array.isArray(input.questions) ? input.questions : [])
    .filter((question) => question?.status === 'open' && question?.presentation === 'panel')
    .map((question) => ({
      id: text(question?.id, 120),
      semanticKey: text(question?.semanticKey || question?.gapKey, 120),
      question: text(question?.question || question?.text, 500),
      targetContradictionId: text(question?.targetContradictionId, 120) || null,
    })),
})

export const canonicalizeEngine2ContradictionDetectionOutput = (value) => ({
  schemaVersion: text(value?.schemaVersion, 80) || ENGINE2_CONTRADICTION_DETECTION_SCHEMA_VERSION,
  contradictionChanges: (Array.isArray(value?.contradictionChanges) ? value.contradictionChanges : []).map((change) => normalizeEngine2ContradictionEvidence({
    operation: ['create', 'update', 'resolve', 'dismiss', 'supersede'].includes(change?.operation) ? change.operation : 'create',
    contradictionId: text(change?.contradictionId, 120) || null,
    semanticKey: text(change?.semanticKey, 120),
    description: text(change?.description, 500),
    sideA: text(change?.sideA, 260),
    sideB: text(change?.sideB, 260),
    sourceFindingIds: idArray(change?.sourceFindingIds || change?.findingIds),
    sourceMessageIds: idArray(change?.sourceMessageIds),
    sideASourceFindingIds: idArray(change?.sideASourceFindingIds || change?.sideAFindingIds),
    sideBSourceFindingIds: idArray(change?.sideBSourceFindingIds || change?.sideBFindingIds),
    sideASourceMessageIds: idArray(change?.sideASourceMessageIds || change?.sideAMessageIds),
    sideBSourceMessageIds: idArray(change?.sideBSourceMessageIds || change?.sideBMessageIds),
    status: ENGINE2_CONTRADICTION_STATUSES.includes(change?.status) ? change.status : 'suspected',
    reportBlocking: change?.reportBlocking === true,
    verificationQuestionId: text(change?.verificationQuestionId, 120) || null,
    resolutionFindingIds: idArray(change?.resolutionFindingIds),
    evidenceStatus: text(change?.evidenceStatus, 80),
    origin: text(change?.origin, 80),
    formalEligible: change?.formalEligible === true,
    rejectionReason: text(change?.rejectionReason, 300) || null,
  })),
})

const latestUserMessageFromHistory = (history) => [...(Array.isArray(history) ? history : [])]
  .reverse()
  .find((message) => message?.role === 'user') || null

const repairEngine2ContradictionDetectionOutput = (output, context = {}) => {
  const findings = Array.isArray(context.findings) ? context.findings : []
  const confirmedFindings = findings.filter((finding) => finding?.status === 'confirmed')
  const findingIds = new Set(confirmedFindings.map((finding) => finding.id).filter(Boolean))
  const history = Array.isArray(context.history) ? context.history : []
  const messageIds = new Set(history.map((message) => message?.id).filter(Boolean))
  const latestMessageId = text(context.latestUserAnswer?.id || latestUserMessageFromHistory(history)?.id, 120) || null
  const latestMessageText = text(context.latestUserAnswer?.content || latestUserMessageFromHistory(history)?.content || latestUserMessageFromHistory(history)?.text, 2000)
  const findingBySourceMessage = new Map()
  for (const finding of confirmedFindings) {
    for (const messageId of idArray(finding?.sourceMessageIds)) {
      if (!findingBySourceMessage.has(messageId)) findingBySourceMessage.set(messageId, [])
      findingBySourceMessage.get(messageId).push(finding.id)
    }
  }
  const diagnostics = []
  const repairedChanges = output.contradictionChanges.map((change, index) => {
    const candidateDiagnostics = []
    let next = { ...change }
    if (next.operation === 'create' && next.contradictionId !== null) {
      candidateDiagnostics.push({
        reason: 'create_contradiction_id_ignored',
        detail: `model supplied ${next.contradictionId}; backend assigns create IDs`,
      })
      next = { ...next, contradictionId: null }
    }
    const requestedMessageIds = idArray(next.sourceMessageIds)
    let validSourceMessageIds = requestedMessageIds.filter((id) => messageIds.size === 0 || messageIds.has(id))
    const unknownMessageIds = requestedMessageIds.filter((id) => messageIds.size > 0 && !messageIds.has(id))
    if (unknownMessageIds.length) {
      candidateDiagnostics.push({ reason: 'unknown_source_message_ids_removed', ids: unknownMessageIds })
    }
    if (validSourceMessageIds.length === 0 && latestMessageId) {
      validSourceMessageIds = [latestMessageId]
      candidateDiagnostics.push({ reason: 'source_message_ids_fallback_latest_user_message', ids: validSourceMessageIds })
    }
    const requestedFindingIds = idArray(next.sourceFindingIds)
    const validSourceFindingIds = requestedFindingIds.filter((id) => findingIds.has(id))
    const unknownFindingIds = requestedFindingIds.filter((id) => !findingIds.has(id))
    if (unknownFindingIds.length) {
      candidateDiagnostics.push({ reason: 'unknown_source_finding_ids_removed', ids: unknownFindingIds })
    }
    const messageMappedFindingIds = validSourceMessageIds.flatMap((id) => findingBySourceMessage.get(id) || [])
    const repairedFindingIds = [...new Set([...validSourceFindingIds, ...messageMappedFindingIds])]
    const textGrounded = Boolean(
      text(next.semanticKey, 120) &&
      text(next.description, 500) &&
      text(next.sideA, 260) &&
      text(next.sideB, 260) &&
      latestMessageText
    )
    const weakGrounding = repairedFindingIds.length === 0 && (validSourceMessageIds.length > 0 || textGrounded)
    if (messageMappedFindingIds.length && unknownFindingIds.length) {
      candidateDiagnostics.push({ reason: 'source_finding_ids_recovered_from_source_messages', ids: [...new Set(messageMappedFindingIds)] })
    } else if (weakGrounding) {
      candidateDiagnostics.push({
        reason: 'weak_grounding',
        detail: 'kept candidate because sourceMessageIds/recent message and contradiction text ground the tension',
      })
      next = { ...next, status: 'suspected' }
    }
    next = {
      ...next,
      sourceMessageIds: validSourceMessageIds,
      sourceFindingIds: repairedFindingIds,
      findingIds: repairedFindingIds,
      ...(candidateDiagnostics.length ? { groundingDiagnostics: candidateDiagnostics } : {}),
    }
    next = normalizeEngine2ContradictionEvidence(next, { findings: confirmedFindings })
    if (candidateDiagnostics.length) diagnostics.push({ index, semanticKey: next.semanticKey || null, diagnostics: candidateDiagnostics })
    return next
  })
  return {
    output: { ...output, contradictionChanges: repairedChanges },
    diagnostics,
    weakGroundingCount: diagnostics.filter((entry) =>
      entry.diagnostics.some((item) => item.reason === 'weak_grounding')
    ).length,
  }
}

export const validateEngine2ContradictionDetectionOutput = (value, context = {}) => {
  const canonicalOutput = canonicalizeEngine2ContradictionDetectionOutput(value)
  const repair = repairEngine2ContradictionDetectionOutput(canonicalOutput, context)
  const output = repair.output
  const errors = []
  if (output.schemaVersion !== ENGINE2_CONTRADICTION_DETECTION_SCHEMA_VERSION && !Array.isArray(value?.contradictionChanges)) {
    errors.push(`schemaVersion must equal ${ENGINE2_CONTRADICTION_DETECTION_SCHEMA_VERSION}`)
  }
  const findingIds = new Set((context.findings || [])
    .filter((finding) => finding?.status === 'confirmed')
    .map((finding) => finding.id)
    .filter(Boolean))
  const messageIds = new Set((context.history || []).map((message) => message?.id).filter(Boolean))
  const contradictionIds = new Set((context.contradictions || [])
    .flatMap((contradiction) => [contradiction.id, contradiction.semanticKey])
    .filter(Boolean))
  for (const [index, change] of output.contradictionChanges.entries()) {
    if (!['create', 'update', 'resolve', 'dismiss', 'supersede'].includes(change.operation)) errors.push(`contradictionChanges[${index}] operation is invalid`)
    if (change.operation !== 'create' && !contradictionIds.has(change.contradictionId)) errors.push(`contradictionChanges[${index}] targets unknown contradiction`)
    if (!text(change.semanticKey, 120) || !text(change.description, 500)) errors.push(`contradictionChanges[${index}] requires semanticKey and description`)
    if (!text(change.sideA, 260) || !text(change.sideB, 260)) errors.push(`contradictionChanges[${index}] requires sideA and sideB`)
    validatePolishUserFacingText({ value: change.description, path: `contradictionChanges[${index}].description`, errors, language: context.language })
    validatePolishUserFacingText({ value: change.sideA, path: `contradictionChanges[${index}].sideA`, errors, language: context.language })
    validatePolishUserFacingText({ value: change.sideB, path: `contradictionChanges[${index}].sideB`, errors, language: context.language })
    if (!ENGINE2_CONTRADICTION_STATUSES.includes(change.status)) errors.push(`contradictionChanges[${index}] status is invalid`)
    const weakGrounding = (change.groundingDiagnostics || []).some((entry) => entry?.reason === 'weak_grounding')
    if ((!Array.isArray(change.sourceFindingIds) || change.sourceFindingIds.length === 0) && !weakGrounding) errors.push(`contradictionChanges[${index}] requires sourceFindingIds`)
    for (const id of change.sourceFindingIds || []) if (id && !findingIds.has(id)) errors.push(`contradictionChanges[${index}] references unknown confirmed finding: ${id}`)
    for (const id of change.sourceMessageIds || []) if (messageIds.size > 0 && !messageIds.has(id)) errors.push(`contradictionChanges[${index}] references unknown message: ${id}`)
    for (const id of change.resolutionFindingIds || []) if (!findingIds.has(id)) errors.push(`contradictionChanges[${index}] references unknown resolution finding: ${id}`)
  }
  return { ok: errors.length === 0, errors, output, repairs: repair.diagnostics, weakGroundingCount: repair.weakGroundingCount }
}

const modelInput = (input) => JSON.stringify(buildEngine2ContradictionDetectionInput(input))
const inputHash = (value) => createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24)

export const detectEngine2Contradictions = async ({
  input, apiKey, aiSupportEnabled, rateLimiter = null, rateLimitKey = null, runTask = runLlmTask,
}) => {
  const startedAt = Date.now()
  const builtInput = buildEngine2ContradictionDetectionInput(input)
  const serializedInput = JSON.stringify(builtInput)
  let rawOutput = null
  const result = await runTask({
    apiKey,
    aiSupportEnabled,
    task: 'engine2-detect-contradictions',
    input: serializedInput,
    language: input.language === 'pl' ? 'Polish' : 'English',
    taskInstructions: 'Return only contradictionChanges. Do not return questions, readiness or findings.',
    parseResponse: parseObject,
    fallbackData: null,
    skipPreprocess: true,
    useDefaultModelWhenSkippingPreprocess: true,
    maxOutputTokens: 1200,
    maxInputChars: 40_000,
    temperature: 0.1,
    timeoutMs: ENGINE2_CONTRADICTION_DETECTION_TIMEOUT_MS,
    responseFormat: ENGINE2_CONTRADICTION_DETECTION_RESPONSE_FORMAT,
    systemPrompt: ENGINE2_CONTRADICTION_DETECTION_SYSTEM_PROMPT,
    rateLimiter,
    rateLimitKey,
    onRawResponse: ({ content }) => { rawOutput = content },
  })
  const validation = result.ok
    ? validateEngine2ContradictionDetectionOutput(result.data, {
        findings: input.allFindings,
        contradictions: input.contradictions,
        history: input.history,
        latestUserAnswer: builtInput.latestUserAnswer,
        language: input.language,
      })
    : { ok: false, errors: [result.meta?.errorCategory || 'contradiction detection failed'] }
  const output = validation.output || canonicalizeEngine2ContradictionDetectionOutput(result.data)
  const allModelChanges = result.ok ? (output.contradictionChanges || []) : []
  const validModelChanges = result.ok && validation.ok
    ? allModelChanges.filter(isEngine2FormalContradictionChangeEligible)
    : []
  const heuristicSignals = inferEngine2SoftTensionSignals({
    ...input,
    confirmedFindings: input.confirmedFindings,
  })
  const heuristicContradictionChanges = inferEngine2TensionContradictionChanges({
    ...input,
    confirmedFindings: input.confirmedFindings,
  })
  const mergedChanges = [...validModelChanges, ...heuristicContradictionChanges.filter((change) =>
    !validModelChanges.some((modelChange) => normalizeKey(modelChange.semanticKey) === normalizeKey(change.semanticKey))
  )]
  const rejectedContradictionCandidates = result.ok
    ? allModelChanges.flatMap((candidate, index) => (
        isEngine2FormalContradictionChangeEligible(candidate)
          ? []
          : [{
        index,
        semanticKey: candidate.semanticKey || null,
        evidenceStatus: candidate.evidenceStatus || null,
        origin: candidate.origin || null,
        formalEligible: Boolean(candidate.formalEligible),
        rejectionReason: candidate.rejectionReason || 'missing_two_sided_user_evidence',
        reasons: validation.ok ? [candidate.rejectionReason || 'missing_two_sided_user_evidence'] : validation.errors || [],
      }]
      ))
    : []
  const ok = Boolean(result.ok && validation.ok)
  return {
    ok,
    output: { ...output, contradictionChanges: allModelChanges },
    contradictionChanges: ok ? mergedChanges : [],
    validation,
    rejectedContradictionCandidates,
    heuristicContradictionChanges,
    attempts: [{
      ok: result.ok,
      rawOutput,
      parsedOutput: result.data || null,
      validation,
      meta: result.meta,
    }],
    meta: {
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      inputBytes: Buffer.byteLength(serializedInput, 'utf8'),
      inputHash: inputHash(serializedInput),
      inputPreview: serializedInput.slice(0, 800),
      outputBytes: Buffer.byteLength(String(rawOutput || ''), 'utf8'),
      attemptCount: 1,
      timeoutMs: ENGINE2_CONTRADICTION_DETECTION_TIMEOUT_MS,
      providerCalls: result.meta?.providerCalled === false ? 0 : 1,
      tokens: result.meta?.tokens || { input: 0, output: 0, total: 0 },
      modelUsed: result.meta?.modelUsed || result.meta?.attemptedModel || null,
      providerRequestIds: [result.meta?.providerRequestId].filter(Boolean),
      providerDiagnostics: result.meta?.providerDiagnostics || null,
      providerCallStartedAt: result.meta?.providerCallStartedAt || null,
      providerCallResolvedAt: result.meta?.providerCallResolvedAt || null,
      providerCallAbortedAt: result.meta?.providerCallAbortedAt || null,
      abortReason: result.meta?.abortReason || null,
      timeoutSource: result.meta?.timeoutSource || null,
      responseFormatName: result.meta?.responseFormatName || ENGINE2_CONTRADICTION_DETECTION_RESPONSE_FORMAT.json_schema.name,
      errorCategory: ok ? null : result.meta?.errorCategory || validation.errors?.[0] || 'CONTRADICTION_DETECTION_FAILED',
      outputHash: hash(rawOutput || ''),
      inputIncludesRecentUserMessages: Array.isArray(builtInput.recentUserMessages) && builtInput.recentUserMessages.length > 0,
      recentMessageCount: Array.isArray(builtInput.recentConversation) ? builtInput.recentConversation.length : 0,
      recentUserMessageCount: Array.isArray(builtInput.recentUserMessages) ? builtInput.recentUserMessages.length : 0,
      latestQuestion: builtInput.latestUserAnswer?.replyToQuestionText || builtInput.activeQuestion?.question || null,
      latestAnswer: builtInput.latestUserAnswer?.content || null,
      rawModelOutput: rawOutput,
      detectedRawContradictionCount: (canonicalizeEngine2ContradictionDetectionOutput(result.data).contradictionChanges || []).length,
      acceptedContradictionCandidateCount: validModelChanges.length,
      rejectedContradictionCandidateCount: rejectedContradictionCandidates.length,
      rejectedContradictionCandidates,
      repairedContradictionCandidates: validation.repairs || [],
      weakGroundingContradictionCandidateCount: validation.weakGroundingCount || 0,
      heuristicContradictionCandidateCount: heuristicSignals.length,
      heuristicContradictionDecisionSource: heuristicContradictionChanges.length ? 'confirmed_pattern_formalized' : 'diagnostics_only',
    },
  }
}
