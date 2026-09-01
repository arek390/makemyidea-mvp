const GENERIC_CATEGORY_RE = /\b(cechy|funkcje|ryzyka|decyzje|kryteria\s+sukcesu|co\s+jeszcze)\b/i
const CONCRETE_QUESTION_RE = /\b(czy|które|która|który|ile|jak długo|w jakich sytuacjach|między|versus|vs\.?|czy ważniejsze|czy ma|czy może|granica|limit|próg|przełączać|szerok|skupion|punktow|stabiln|akumulator|jasnoś|napraw|komputer)\b/i
const PANEL_MODE = true

const asArray = (value) => Array.isArray(value) ? value : []
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const latest = (entries) => asArray(entries).at(-1) || null
const traceId = (trace) => text(trace?.traceId || trace?.backendTrace?.traceId)
const requestId = (trace) => text(trace?.frontend?.requestId || trace?.apiResponse?.requestId || trace?.backendTrace?.requestId)
const traceAction = (trace) => text(trace?.action || trace?.apiResponse?.action || trace?.backendTrace?.action)
const traceTurnKind = (trace) => text(trace?.apiResponse?.turnKind || trace?.backendTrace?.parsedOutput?.turnKind)

const latestPayload = (trace) => asObject(trace?.apiResponse)
const latestTracePanelQuestions = (trace) => {
  const payload = latestPayload(trace)
  const frontend = asObject(trace?.frontend)
  const fromPayload = asArray(payload.panelQuestions).length ? asArray(payload.panelQuestions) : asArray(payload.openQuestions)
  if (fromPayload.length) return fromPayload
  return asArray(frontend.questionCandidatesApplied)
}

const countPanelQuestions = (trace, state) => {
  const frontend = asObject(trace?.frontend)
  const diagnostics = asObject(frontend.questionDiagnostics)
  const value = Number(
    diagnostics.panelQuestionCount ??
    frontend.panelQuestionCount ??
    latestTracePanelQuestions(trace).length ??
    asArray(state?.openQuestions).length
  )
  return Number.isFinite(value) ? value : 0
}

const addFailure = (failures, trace, check, diagnosis, extra = {}) => {
  failures.push({
    check,
    traceId: traceId(trace) || null,
    requestId: requestId(trace) || null,
    diagnosis,
    ...extra,
  })
}

const addWarning = (warnings, trace, check, diagnosis, extra = {}) => {
  warnings.push({
    check,
    traceId: traceId(trace) || null,
    requestId: requestId(trace) || null,
    diagnosis,
    ...extra,
  })
}

const eventDecisionSource = (event) => text(event?.decisionSource)
const eventFindingId = (event) => text(event?.findingId || event?.entityId)
const isExplicitDecisionSource = (value) => ['user_accept', 'user_change', 'user_reject'].includes(text(value))
const isAcceptOrChange = (value) => ['user_accept', 'user_change'].includes(text(value))

const allFindingEvents = (diagnostics) => {
  const stateEvents = asArray(diagnostics.sessionState?.findingEvents)
  const traceEvents = asArray(diagnostics.traces).flatMap((trace) => {
    const payload = latestPayload(trace)
    const backendDecisionEvents = asArray(trace?.backendTrace?.decisionEvents)
    return [...asArray(payload.findingEvents), ...backendDecisionEvents]
  })
  const byKey = new Map()
  for (const event of [...stateEvents, ...traceEvents]) {
    const key = text(event?.id) || `${eventFindingId(event)}:${eventDecisionSource(event)}:${text(event?.createdAt)}`
    if (key) byKey.set(key, event)
  }
  return [...byKey.values()]
}

const findingTimeline = (diagnostics) => {
  const entries = []
  for (const trace of asArray(diagnostics.traces)) {
    const payload = latestPayload(trace)
    const sources = [
      ...asArray(payload.findingProposals),
      ...asArray(payload.findingUpdates),
      ...asArray(payload.sessionSnapshot?.findings),
      ...asArray(trace?.frontend?.reactAllFindings),
      ...asArray(trace?.frontend?.sessionStorageState?.findings),
    ]
    for (const finding of sources) {
      const id = text(finding?.id)
      if (!id) continue
      entries.push({ trace, finding, id, status: text(finding?.status) })
    }
  }
  for (const finding of asArray(diagnostics.sessionState?.findings)) {
    const id = text(finding?.id)
    if (!id) continue
    entries.push({ trace: latest(diagnostics.traces), finding, id, status: text(finding?.status), final: true })
  }
  return entries
}

const questionText = (question) => text(question?.question || question?.text)
const messageText = (message) => text(message?.content || message?.text)
const questionId = (question) => text(question?.id || question?.questionId)

const hasPanelQuestionInConversation = (state, panelQuestions) => {
  const messages = [...asArray(state?.messages), ...asArray(state?.conversation)]
  const panelIds = new Set(panelQuestions.map(questionId).filter(Boolean))
  const panelTexts = new Set(panelQuestions.map(questionText).filter(Boolean))
  return messages.some((message) => {
    if (text(message?.role) !== 'assistant') return false
    if (panelIds.has(text(message?.questionId))) return true
    return panelTexts.has(messageText(message))
  })
}

const isConcreteGenericException = (question) => {
  const value = questionText(question)
  return CONCRETE_QUESTION_RE.test(value) && /[?？]\s*$/.test(value)
}

const validateRoot = (diagnostics, failures) => {
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
    addFailure(failures, null, 'diagnostics_json_shape', 'Diagnostics JSON must be an object.')
    return false
  }
  if (!diagnostics.exportedAt) addFailure(failures, null, 'diagnostics_exported_at', 'Diagnostics JSON is missing exportedAt.')
  if (!diagnostics.sessionState) addFailure(failures, null, 'diagnostics_session_state', 'Diagnostics JSON is missing sessionState.')
  if (!Array.isArray(diagnostics.traces)) addFailure(failures, null, 'diagnostics_traces', 'Diagnostics JSON is missing traces array.')
  return Boolean(diagnostics.sessionState && Array.isArray(diagnostics.traces))
}

const validateGeneralState = (diagnostics, failures) => {
  const state = asObject(diagnostics.sessionState)
  const lastTrace = latest(diagnostics.traces)
  if (text(state.language) !== 'pl') {
    addFailure(failures, lastTrace, 'latest_state_language_pl', `Latest session language must be pl, got "${text(state.language) || 'missing'}".`)
  }
  for (const trace of asArray(diagnostics.traces)) {
    for (const warning of asArray(trace?.frontend?.stateConsistencyWarnings)) {
      const severity = typeof warning === 'string' ? 'error' : text(warning?.severity)
      if (severity === 'error') addFailure(failures, trace, 'state_consistency_warning', `Trace has error-level stateConsistencyWarning: ${text(warning?.code || warning)}.`)
    }
    for (const warning of asArray(trace?.backendTrace?.stateConsistencyWarnings)) {
      const severity = typeof warning === 'string' ? 'error' : text(warning?.severity)
      if (severity === 'error') addFailure(failures, trace, 'backend_state_consistency_warning', `Backend trace has error-level stateConsistencyWarning: ${text(warning?.code || warning)}.`)
    }
  }
  const activeQuestionId = text(state.activeQuestionId)
  if (activeQuestionId) {
    const explicitlySelected = asArray(state.messages).some((message) => text(message?.replyToQuestionId) === activeQuestionId) ||
      asArray(diagnostics.traces).some((trace) =>
        text(trace?.frontend?.composerReplyTargetAfterSubmit) === activeQuestionId ||
        text(trace?.frontend?.inFlightReplyToQuestionId) === activeQuestionId
      )
    if (!explicitlySelected) {
      addFailure(failures, lastTrace, 'active_question_requires_explicit_selection', `activeQuestionId "${activeQuestionId}" exists without evidence of explicit panel-question selection.`)
    }
  }
  if (PANEL_MODE) {
    for (const trace of asArray(diagnostics.traces)) {
      const chatQuestion = latestPayload(trace).chatQuestion ?? trace?.backendTrace?.chatQuestion
      if (chatQuestion != null && text(chatQuestion)) {
        addFailure(failures, trace, 'chat_question_null_panel_mode', 'chatQuestion must be null in panel-driven mode.')
      }
    }
  }
}

const validateFindingConfirmation = (diagnostics, failures) => {
  const events = allFindingEvents(diagnostics)
  const decisionsByFinding = new Map()
  for (const event of events) {
    const id = eventFindingId(event)
    const source = eventDecisionSource(event)
    if (!id || !isExplicitDecisionSource(source)) continue
    if (text(event?.operation) !== 'decision') {
      addFailure(failures, latest(diagnostics.traces), 'decision_event_operation_must_be_decision', `Decision event for finding "${id}" must use operation="decision".`)
    }
    if (!decisionsByFinding.has(id)) decisionsByFinding.set(id, [])
    decisionsByFinding.get(id).push(event)
  }
  const lastTrace = latest(diagnostics.traces)
  for (const finding of asArray(diagnostics.sessionState?.findings)) {
    const status = text(finding?.status)
    if (!['confirmed', 'rejected'].includes(status)) continue
    const id = text(finding?.id)
    const source = text(finding?.decisionSource)
    const matching = asArray(decisionsByFinding.get(id)).some((event) =>
      status === 'confirmed' ? isAcceptOrChange(eventDecisionSource(event)) : eventDecisionSource(event) === 'user_reject'
    )
    if (!matching && !isExplicitDecisionSource(source)) {
      addFailure(failures, lastTrace, 'confirmed_or_rejected_requires_user_decision_event', `Finding "${id}" is ${status} without matching explicit user decision event.`)
    }
  }
  const timeline = findingTimeline(diagnostics)
  const byFinding = new Map()
  for (const entry of timeline) {
    if (!byFinding.has(entry.id)) byFinding.set(entry.id, [])
    byFinding.get(entry.id).push(entry)
  }
  for (const [id, entries] of byFinding.entries()) {
    const sawPending = entries.some((entry) => entry.status === 'pending')
    const sawConfirmed = entries.some((entry) => entry.status === 'confirmed')
    if (sawPending && sawConfirmed) {
      const hasAcceptOrChange = asArray(decisionsByFinding.get(id)).some((event) => isAcceptOrChange(eventDecisionSource(event))) ||
        entries.some((entry) => isAcceptOrChange(entry.finding?.decisionSource))
      if (!hasAcceptOrChange) {
        addFailure(failures, latest(entries).trace, 'pending_to_confirmed_requires_accept_or_change', `Finding "${id}" moved from pending to confirmed without user_accept/user_change evidence.`)
      }
    }
  }
  for (const trace of asArray(diagnostics.traces)) {
    const payload = latestPayload(trace)
    const findingChanges = [
      ...asArray(payload.parsedOutput?.findingChanges),
      ...asArray(trace?.backendTrace?.parsedOutput?.findingChanges),
      ...asArray(trace?.backendTrace?.appliedFindingChanges),
    ]
    const hasSubstantiveFindings = traceTurnKind(trace) === 'unsolicited_substantive_information' && findingChanges.length > 0
    if (!hasSubstantiveFindings) continue
    const proposals = asArray(payload.findingProposals)
    const rendered = asArray(trace?.frontend?.renderedPendingFindings)
    if (!proposals.some((finding) => text(finding?.status) === 'pending') && rendered.length === 0) {
      addFailure(failures, trace, 'substantive_information_requires_visible_pending_proposal', 'Substantive findingChanges did not produce a visible pending proposal before confirmation.')
    }
  }
}

const validatePanelQuestions = (diagnostics, failures) => {
  const state = asObject(diagnostics.sessionState)
  const lastTrace = latest(diagnostics.traces)
  const pendingPackageId = text(state.pendingDecisionPackageId || state.pendingPackageId)
  const reportAvailable = Boolean(state.reportAvailable)
  const latestResponse = latestPayload(lastTrace)
  const hasRetryOrContinueError = Boolean(
    latestResponse.retryable ||
    latestResponse.retryableContinueError ||
    latestResponse.awaitingContinueAfterDecision
  )
  if (!reportAvailable && !pendingPackageId && !hasRetryOrContinueError) {
    const panelQuestionCount = countPanelQuestions(lastTrace, state)
    if (panelQuestionCount !== 3) {
      addFailure(failures, lastTrace, 'panel_question_count_three_without_pending_package', `Expected exactly 3 panel questions, got ${panelQuestionCount}.`)
    }
    if (asArray(lastTrace?.frontend?.questionCandidatesApplied).length && asArray(lastTrace?.frontend?.questionCandidatesApplied).length !== 3) {
      addFailure(failures, lastTrace, 'question_candidates_applied_count_three', `Expected questionCandidatesApplied.length === 3, got ${asArray(lastTrace?.frontend?.questionCandidatesApplied).length}.`)
    }
    if (asArray(state.openQuestions).length !== 3) {
      addFailure(failures, lastTrace, 'session_open_questions_count_three', `Expected sessionState.openQuestions.length === 3, got ${asArray(state.openQuestions).length}.`)
    }
  }
  const panelQuestions = asArray(state.openQuestions).length ? asArray(state.openQuestions) : latestTracePanelQuestions(lastTrace)
  for (const question of panelQuestions) {
    if (text(question?.presentation || 'panel') !== 'panel') {
      addFailure(failures, lastTrace, 'panel_question_presentation_panel', `Question "${questionId(question)}" is not presentation="panel".`)
    }
  }
  if (hasPanelQuestionInConversation(state, panelQuestions)) {
    addFailure(failures, lastTrace, 'panel_question_not_auto_appended_to_conversation', 'A panel question appears as an assistant message in messages/conversation.')
  }
}

const validateQuestionQuality = (diagnostics, failures, warnings) => {
  const state = asObject(diagnostics.sessionState)
  const lastTrace = latest(diagnostics.traces)
  const panelQuestions = asArray(state.openQuestions).length ? asArray(state.openQuestions) : latestTracePanelQuestions(lastTrace)
  for (const question of panelQuestions) {
    const id = questionId(question)
    const value = questionText(question)
    if (GENERIC_CATEGORY_RE.test(value) && !isConcreteGenericException(question)) {
      addWarning(warnings, lastTrace, 'panel_question_generic_category_prompt', `Panel question "${id}" contains a generic category prompt: "${value}".`, { questionId: id })
    }
    if (asArray(question?.groundedInFindingIds).length === 0) {
      addFailure(failures, lastTrace, 'panel_question_grounded_in_findings', `Panel question "${id}" is missing groundedInFindingIds.`, { questionId: id })
    }
    if (!text(question?.targetType)) {
      addFailure(failures, lastTrace, 'panel_question_target_type', `Panel question "${id}" is missing targetType.`, { questionId: id })
    }
    if (!text(question?.priorityReason || question?.reason)) {
      addWarning(warnings, lastTrace, 'panel_question_priority_reason', `Panel question "${id}" is missing priorityReason/reason.`, { questionId: id })
    }
    if ('concreteAnchorText' in asObject(question) && !text(question?.concreteAnchorText)) {
      addWarning(warnings, lastTrace, 'panel_question_concrete_anchor_text', `Panel question "${id}" has empty concreteAnchorText.`, { questionId: id })
    }
    if ('uncertaintyToResolve' in asObject(question) && !text(question?.uncertaintyToResolve)) {
      addWarning(warnings, lastTrace, 'panel_question_uncertainty_to_resolve', `Panel question "${id}" has empty uncertaintyToResolve.`, { questionId: id })
    }
  }
}

const validateReplyTarget = (diagnostics, failures) => {
  const state = asObject(diagnostics.sessionState)
  const allQuestions = [...asArray(state.questions), ...asArray(state.openQuestions)]
  const questionById = new Map(allQuestions.map((question) => [questionId(question), question]).filter(([id]) => id))
  const answeredQuestions = allQuestions.filter((question) => text(question?.status) === 'answered')
  for (const question of answeredQuestions) {
    const id = questionId(question)
    const answerMessages = asArray(state.messages).filter((message) => text(message?.replyToQuestionId) === id)
    if (answerMessages.length === 0) {
      addFailure(failures, latest(diagnostics.traces), 'answered_question_requires_reply_to_question_id', `Question "${id}" is answered but no user message has replyToQuestionId.`)
    }
    if (asArray(state.openQuestions).some((openQuestion) => questionId(openQuestion) === id)) {
      addFailure(failures, latest(diagnostics.traces), 'answered_question_removed_from_open_questions', `Answered question "${id}" still remains in openQuestions.`)
    }
  }
  for (const message of asArray(state.messages)) {
    const replyToQuestionId = text(message?.replyToQuestionId)
    if (!replyToQuestionId) continue
    if (!questionById.has(replyToQuestionId)) {
      addFailure(failures, latest(diagnostics.traces), 'reply_to_question_id_must_reference_question', `User message replies to unknown question "${replyToQuestionId}".`)
    }
  }
  const decisionEvents = allFindingEvents(diagnostics).filter((event) => isAcceptOrChange(eventDecisionSource(event)))
  for (const question of answeredQuestions) {
    if (decisionEvents.length === 0) {
      addFailure(failures, latest(diagnostics.traces), 'answered_question_requires_accepted_or_changed_finding', `Question "${questionId(question)}" is answered without any accepted/changed finding decision event.`)
    }
  }
}

const validatePendingNotice = (diagnostics, failures) => {
  for (const trace of asArray(diagnostics.traces)) {
    const payload = latestPayload(trace)
    const pendingProposals = asArray(payload.findingProposals).filter((finding) => text(finding?.status) === 'pending')
    const renderedPending = asArray(trace?.frontend?.renderedPendingFindings)
    if (pendingProposals.length > 0 && renderedPending.length === 0) {
      addFailure(failures, trace, 'pending_proposals_render_pending_findings', 'Pending proposals exist but renderedPendingFindings is empty.')
    }
    const inFlightAfterDecision = text(trace?.frontend?.requestStatus) === 'pending' &&
      Number(trace?.frontend?.pendingPackageDecisionCount || 0) > 0
    if (inFlightAfterDecision && renderedPending.length > 0) {
      addFailure(failures, trace, 'pending_notice_clears_during_in_flight_decision', 'Pending notice/rendered pending findings remained visible during in-flight analysis after a decision.')
    }
    if (traceAction(trace) === 'generate_panel_questions' && !payload.pendingDecisionPackageId && !payload.reportAvailable && !payload.retryable) {
      const renderedOpenQuestions = asArray(trace?.frontend?.renderedOpenQuestions)
      if (renderedOpenQuestions.length !== 3) {
        addFailure(failures, trace, 'continue_renders_three_open_questions', `After ${traceAction(trace)} expected renderedOpenQuestions.length === 3, got ${renderedOpenQuestions.length}.`)
      }
      if (renderedPending.length !== 0) {
        addFailure(failures, trace, 'continue_clears_rendered_pending_findings', `After ${traceAction(trace)} renderedPendingFindings must be empty.`)
      }
    }
  }
}

const validateDeadEnd = (diagnostics, failures) => {
  const lastTrace = latest(diagnostics.traces)
  for (const trace of asArray(diagnostics.traces)) {
    const result = trace?.frontend?.deadEndInvariantResult || trace?.backendTrace?.deadEndInvariantResult ||
      asArray(trace?.apiResponse?.backendInvariantResults).find((entry) => text(entry?.invariant) === 'dead_end_next_action')
    if (result && result.passed !== true) {
      addFailure(failures, trace, 'dead_end_invariant_passed', 'deadEndInvariantResult.passed must be true.')
    }
  }
  const state = asObject(diagnostics.sessionState)
  const finalPanelQuestionCount = countPanelQuestions(lastTrace, state)
  const finalPayload = latestPayload(lastTrace)
  const finalChatQuestion = finalPayload.chatQuestion ?? lastTrace?.backendTrace?.chatQuestion ?? null
  const finalRetryable = Boolean(finalPayload.retryable || finalPayload.retryableContinueError || finalPayload.awaitingContinueAfterDecision)
  if (
    !state.reportAvailable &&
    !state.pendingDecisionPackageId &&
    finalPanelQuestionCount === 0 &&
    finalChatQuestion == null &&
    !finalRetryable
  ) {
    addFailure(failures, lastTrace, 'no_final_dead_end_state', 'Final state has no report, no pending package, zero panel questions, null chatQuestion and retryable=false.')
  }
}

export const validateEngine2Diagnostics = (diagnostics, { scenario = 'lamp' } = {}) => {
  const failures = []
  const warnings = []
  if (!validateRoot(diagnostics, failures)) {
    return {
      ok: false,
      scenario,
      failures,
      warnings,
      summary: {
        diagnosis: 'Diagnostics JSON is incomplete or malformed.',
      },
    }
  }
  validateGeneralState(diagnostics, failures)
  validateFindingConfirmation(diagnostics, failures)
  validatePanelQuestions(diagnostics, failures)
  validateQuestionQuality(diagnostics, failures, warnings)
  validateReplyTarget(diagnostics, failures)
  validatePendingNotice(diagnostics, failures)
  validateDeadEnd(diagnostics, failures)
  return {
    ok: failures.length === 0,
    scenario,
    failures,
    warnings,
    summary: {
      exportedAt: diagnostics.exportedAt || null,
      traceCount: asArray(diagnostics.traces).length,
      findingCount: asArray(diagnostics.sessionState?.findings).length,
      openQuestionCount: asArray(diagnostics.sessionState?.openQuestions).length,
      reportAvailable: Boolean(diagnostics.sessionState?.reportAvailable),
      pendingDecisionPackageId: diagnostics.sessionState?.pendingDecisionPackageId || null,
      diagnosis: failures.length === 0
        ? 'Engine 2 lamp diagnostics satisfy the panel-driven acceptance checks.'
        : `${failures.length} Engine 2 diagnostic check(s) failed.`,
    },
  }
}
