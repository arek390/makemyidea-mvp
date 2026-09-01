import type { Engine2Finding } from './findingState'
import type { Engine2OpenQuestion } from './conversationGuide'

export type Engine2ResponseFindingState = {
  proposals: Engine2Finding[]
  shouldReplaceAllFindings: boolean
  findingUpdates: Engine2Finding[]
}

type Engine2AssistantMessage = {
  id?: string
  content?: string
  questionId?: string | null
}

export type Engine2ActiveQuestionPresentation = {
  messageId?: string
  questionId?: string | null
  text?: string
  reason?: string
}

export const resolveEngine2RenderableAssistantMessage = (payload: {
  assistantMessage?: Engine2AssistantMessage | null
  nextQuestionId?: string | null
  pendingDecisionPackageId?: string | null
  findingProposals?: Engine2Finding[]
  openQuestions?: Engine2OpenQuestion[]
  panelQuestions?: Engine2OpenQuestion[]
}): Engine2AssistantMessage | null => {
  const message = payload.assistantMessage
  const content = String(message?.content || '').trim()
  if (!message || !content) return null
  // assistantMessage is prose only in v3. Questions are rendered exclusively
  // from activeQuestionPresentation; its text is never inspected heuristically.
  if (message.questionId) return null
  return { ...message, content, questionId: null }
}

export const resolveEngine2ActiveQuestionPresentation = (payload: {
  activeQuestionPresentation?: Engine2ActiveQuestionPresentation | null
  nextQuestionId?: string | null
  pendingDecisionPackageId?: string | null
  findingProposals?: Engine2Finding[]
  openQuestions?: Engine2OpenQuestion[]
  panelQuestions?: Engine2OpenQuestion[]
}): { messageId?: string; questionId: string; text: string; reason?: string } | null => {
  void payload
  return null
}

export const resolveEngine2ResponseDecision = ({
  stateVersionReturned,
  latestAppliedResponseVersion,
  requestSequence = 0,
  latestAppliedRequestSequence = 0,
}: {
  stateVersionReturned: number
  latestAppliedResponseVersion: number
  requestSequence?: number
  latestAppliedRequestSequence?: number
}): 'applied' | 'ignored_as_stale' =>
  (requestSequence > 0 && requestSequence < latestAppliedRequestSequence) ||
  stateVersionReturned < latestAppliedResponseVersion
    ? 'ignored_as_stale'
    : 'applied'

export const resolveEngine2ResponseFindingState = (payload: {
  action?: 'analyze_message' | 'commit_finding_decisions' | 'generate_panel_questions' | 'detect_contradictions' | 'evaluate_readiness'
  findingProposals?: Engine2Finding[]
  findingUpdates?: Engine2Finding[]
}): Engine2ResponseFindingState => {
  const proposals = Array.isArray(payload.findingProposals) ? payload.findingProposals : []
  const findingUpdates = Array.isArray(payload.findingUpdates) ? payload.findingUpdates : []

  return {
    proposals,
    shouldReplaceAllFindings: Array.isArray(payload.findingUpdates),
    findingUpdates,
  }
}

export const resolveEngine2ResponseQuestionState = ({
  currentOpenQuestions,
  currentActiveQuestionId,
  payload,
}: {
  currentOpenQuestions: Engine2OpenQuestion[]
    currentActiveQuestionId: string | null
  payload: {
    action?: 'analyze_message' | 'commit_finding_decisions' | 'generate_panel_questions' | 'detect_contradictions' | 'evaluate_readiness'
    assistantMessage?: { content?: string } | null
    openQuestions?: Engine2OpenQuestion[]
    panelQuestions?: Engine2OpenQuestion[]
    nextQuestionId?: string | null
    guideNotice?: string | null
  }
}) => {
  const hasPanelQuestionsPayload = Array.isArray(payload.panelQuestions)
  const hasOpenQuestionsPayload = Array.isArray(payload.openQuestions)
  const hasGuideNoticePayload = Object.prototype.hasOwnProperty.call(payload, 'guideNotice')
  const hasNextQuestionIdPayload = Object.prototype.hasOwnProperty.call(payload, 'nextQuestionId')
  const nextOpenQuestions = hasPanelQuestionsPayload
    ? payload.panelQuestions || []
    : hasOpenQuestionsPayload ? payload.openQuestions || [] : null
  const shouldRefreshGuide =
    payload.action === 'generate_panel_questions' || payload.action === 'commit_finding_decisions' || hasPanelQuestionsPayload || hasOpenQuestionsPayload || hasGuideNoticePayload
  return {
    openQuestions: shouldRefreshGuide && nextOpenQuestions ? nextOpenQuestions : currentOpenQuestions,
    activeQuestionId: hasNextQuestionIdPayload
      ? payload.nextQuestionId || null
      : shouldRefreshGuide
        ? null
        : currentActiveQuestionId,
    guideNoticeProvided: shouldRefreshGuide && hasGuideNoticePayload,
  }
}

export const resolveEngine2PanelQuestionDisplayState = ({
  hasPendingFindings,
  decisionGateActive,
  loading,
  continuing,
  retrying,
  openQuestions,
  guideNotice,
}: {
  hasPendingFindings: boolean
  decisionGateActive: boolean
  loading: boolean
  continuing: boolean
  retrying: boolean
  openQuestions: Engine2OpenQuestion[]
  guideNotice?: string | null
}): 'pending_notice' | 'loading' | 'questions' | 'guide_notice' | 'empty' => {
  if (hasPendingFindings) return 'pending_notice'
  if (loading || continuing || retrying || decisionGateActive) return 'loading'
  if (openQuestions.length > 0) return 'questions'
  if (guideNotice) return 'guide_notice'
  return 'empty'
}
