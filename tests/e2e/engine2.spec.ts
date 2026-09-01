import { expect, test } from '@playwright/test'

/* eslint-disable @typescript-eslint/no-explicit-any */

const activeQuestion = {
  id: 'q-active', semanticKey: 'light_intensity', intent: 'required intensity control',
  question: 'Czy potrzebujesz regulacji natężenia światła?',
  status: 'open', presentation: 'ask_now', askedCount: 1,
}

const legacyPanelQuestion = {
  id: 'q-legacy-panel', semanticKey: 'mounting', intent: 'mounting constraints',
  question: 'Jak lampa ma być mocowana?',
  status: 'open', presentation: 'panel', askedCount: 0,
}

const baseState = (overrides: Record<string, unknown> = {}) => {
  const conversation = [
    { id: 'u1', role: 'user', content: 'Projektuję lampę.' },
    { id: 'a1', role: 'assistant', content: activeQuestion.question, questionId: activeQuestion.id },
  ]
  const readiness = { score: 0, reportScore: 0, criticalMissing: [], reportAvailable: false }
  return {
    schemaVersion: 'engine2.session.v5', trialId: 'e2e-engine2-v3', language: 'pl',
    messages: conversation, conversation, findings: [], findingEvents: [], contradictions: [],
    openQuestions: [activeQuestion], questions: [activeQuestion], questionHistory: [activeQuestion],
    questionEvents: [], questionBacklog: [], activeQuestionId: activeQuestion.id,
    questionLedgerMigrationVersion: 'engine2.questions.single-active.v1',
    guideNotice: null, rejectedFingerprints: [], pendingPackageId: null,
    pendingDecisionPackageId: null, pendingQuestionTransition: null,
    pendingPackageExpectedCount: 0, remindedPackageIds: [],
    readiness, materialReadiness: readiness, reportReadiness: readiness,
    successfulTrialTurns: 1, successfulTurnMessageIds: ['u1'], providerCalls: 1,
    reportAvailable: false, trialEnded: false, adminUsage: null,
    ...overrides,
  }
}

test.describe('Engine 2 simplified conversation', () => {
  test('accepting the first pending finding records decision diagnostics and refreshes panel questions', async ({ page }) => {
    const trialId = 'e2e-engine2-decision-lamp'
    const finding = {
      id: 'finding-lamp-1',
      semanticKey: 'need_better_desk_lamp_light_direction',
      category: 'goal',
      categoryLabel: 'Ustalenie',
      content: 'Użytkownik chce zaprojektować nową lampę na biurko, ponieważ obecne lampy nie dają światła tam, gdzie go potrzebuje.',
      text: 'Użytkownik chce zaprojektować nową lampę na biurko, ponieważ obecne lampy nie dają światła tam, gdzie go potrzebuje.',
      displayText: 'Chcesz zaprojektować nową lampę na biurko, ponieważ obecne lampy nie dają światła tam, gdzie ich potrzebujesz.',
      status: 'pending',
      source: 'ai_interpretation',
      sourceMessageIds: ['user-lamp-1'],
      packageId: 'package-lamp-1',
    }
    const decisionEvent = {
      id: 'event-decision-lamp-1',
      entityId: finding.id,
      findingId: finding.id,
      packageId: finding.packageId,
      operation: 'decision',
      decisionType: 'accept',
      decisionSource: 'user_accept',
      decisionAt: '2026-08-22T15:40:00.000Z',
      createdAt: '2026-08-22T15:40:00.000Z',
      messageId: null,
    }
    const confirmedFinding = {
      ...finding,
      status: 'confirmed',
      decisionSource: 'user_accept',
      decisionAt: decisionEvent.decisionAt,
    }
    const panelQuestions = [
      {
        id: 'q-lamp-light-mode',
        semanticKey: 'lamp_light_mode',
        question: 'Czy lampa ma przełączać się między szerokim światłem do pracy przy komputerze a skupionym światłem do napraw?',
        intent: 'Ustalić konkretny tryb światła.',
        reason: 'Wynika z problemu z kierunkiem światła.',
        priorityReason: 'Wynika z problemu z kierunkiem światła.',
        status: 'open',
        presentation: 'panel',
        groundedInFindingIds: [finding.id],
        targetType: 'priority',
        concreteAnchorText: 'obecne lampy nie dają światła tam, gdzie ich potrzebujesz',
        uncertaintyToResolve: 'szerokie światło do pracy albo skupione światło do napraw',
      },
      {
        id: 'q-lamp-stability',
        semanticKey: 'lamp_stability',
        question: 'Czy ważniejsze jest małe miejsce na biurku, czy cięższa podstawa dająca stabilność?',
        intent: 'Ustalić kompromis miejsca i stabilności.',
        reason: 'Wpływa na konstrukcję podstawy.',
        priorityReason: 'Wpływa na konstrukcję podstawy.',
        status: 'open',
        presentation: 'panel',
        groundedInFindingIds: [finding.id],
        targetType: 'priority',
        concreteAnchorText: 'lampa ma stać na biurku',
        uncertaintyToResolve: 'mały footprint albo stabilna podstawa',
      },
      {
        id: 'q-lamp-battery',
        semanticKey: 'lamp_battery',
        question: 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?',
        intent: 'Ustalić granicę pracy na akumulatorze.',
        reason: 'Wpływa na zasilanie i jasność.',
        priorityReason: 'Wpływa na zasilanie i jasność.',
        status: 'open',
        presentation: 'panel',
        groundedInFindingIds: [finding.id],
        targetType: 'boundary',
        concreteAnchorText: 'nowa lampa ma świecić tam, gdzie jej potrzebujesz',
        uncertaintyToResolve: 'czas działania albo pełna jasność',
      },
    ]
    const requests: Array<Record<string, any>> = []
    let detectContradictionsCompleted = false
    let releaseDetectContradictions: (() => void) | null = null
    const detectContradictionsGate = new Promise<void>((resolve) => {
      releaseDetectContradictions = resolve
    })

    await page.addInitScript(() => {
      localStorage.setItem('ui-language', 'Polish')
      sessionStorage.clear()
    })
    await page.route('**/api/engine_2', async (route) => {
      const request = route.request().postDataJSON()
      requests.push(request)
      if (request.action === 'analyze_message') {
        await route.fulfill({
          status: 200,
          json: {
            ok: true,
            version: 1,
            action: 'analyze_message',
            trialId,
            turnId: request.turnId,
            requestId: request.requestId,
            stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
            assistantMessage: null,
            findingProposals: [finding],
            findingUpdates: [finding],
            findingEvents: [{ id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: request.message?.id || null, createdAt: '2026-08-22T15:39:00.000Z' }],
            packageId: finding.packageId,
            pendingDecisionPackageId: finding.packageId,
            pendingQuestionTransition: null,
            openQuestions: [],
            panelQuestions: [],
            questions: [],
            questionHistory: [],
            questionEvents: [],
            nextQuestionId: null,
            activeQuestionId: null,
            chatQuestion: null,
            readiness: { score: 0, materialScore: 0, reportScore: 0, criticalMissing: [], reportAvailable: false },
            reportAvailable: false,
            retryable: false,
            turnApplied: true,
            analysisStatus: 'applied',
            responseOrigin: 'new_llm_call',
            trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: [request.message?.id], providerCalls: 1 },
            sessionSnapshot: {
              ...baseState({ trialId }),
              conversation: request.history,
              messages: request.history,
              findings: [finding],
              findingEvents: [{ id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: request.message?.id || null, createdAt: '2026-08-22T15:39:00.000Z' }],
              openQuestions: [],
              questions: [],
              questionBacklog: [],
              activeQuestionId: null,
              pendingDecisionPackageId: finding.packageId,
              pendingQuestionTransition: null,
            },
            engine2Trace: {
              traceId: 'trace-analyze-lamp',
              action: 'analyze_message',
              requestId: request.requestId,
              turnId: request.turnId,
              messageId: request.message?.id,
              chatQuestion: null,
              questionCandidatesRaw: [],
              questionCandidatesApplied: [],
              panelQuestionCount: 0,
              backendInvariantResults: [{ invariant: 'dead_end_next_action', passed: true }],
              timings: { requestReceivedAt: new Date().toISOString() },
              telemetry: { totalBackendMs: 1 },
            },
          },
        })
        return
      }
      if (request.action === 'commit_finding_decisions') {
        expect(request.decisions).toEqual([{ findingId: finding.id, type: 'confirm' }])
        await route.fulfill({
          status: 200,
          json: {
            ok: true,
            version: 1,
            action: 'commit_finding_decisions',
            trialId,
            turnId: request.turnId,
            requestId: request.requestId,
            stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
            findingProposals: [],
            findingUpdates: [confirmedFinding],
            findingEvents: [
              { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
              decisionEvent,
            ],
            decisionApplied: true,
            decisionEvents: [decisionEvent],
            decisionState: { packageId: finding.packageId, allPackageItemsDecided: true, decisionEventsCount: 1, pendingDecisionPackageId: null },
            continueApplied: false,
            awaitingContinueAfterDecision: true,
            pendingDecisionPackageId: null,
            pendingQuestionTransition: null,
            openQuestions: [],
            panelQuestions: [],
            questions: [],
            questionHistory: [],
            questionEvents: [],
            nextQuestionId: null,
            activeQuestionId: null,
            chatQuestion: null,
            readiness: { score: 0, materialScore: 0, reportScore: 0, criticalMissing: [], reportAvailable: false },
            reportAvailable: false,
            retryable: false,
            turnApplied: true,
            analysisStatus: 'applied',
            responseOrigin: 'finding_decision_commit',
            backendInvariantResults: [{ invariant: 'dead_end_next_action', passed: true, awaitingContinueAfterDecision: true }],
            trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['user-lamp-1'], providerCalls: 1 },
            sessionSnapshot: {
              ...baseState({ trialId }),
              conversation: request.history,
              messages: request.history,
              findings: [confirmedFinding],
              findingEvents: [
                { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
                decisionEvent,
              ],
              openQuestions: [],
              questions: [],
              questionBacklog: [],
              activeQuestionId: null,
              pendingDecisionPackageId: null,
              pendingQuestionTransition: null,
            },
            engine2Trace: {
              traceId: 'trace-commit-lamp',
              action: 'commit_finding_decisions',
              requestId: request.requestId,
              turnId: request.turnId,
              decisionEvents: [decisionEvent],
              chatQuestion: null,
              questionCandidatesRaw: [],
              questionCandidatesApplied: [],
              panelQuestionCount: 0,
              backendInvariantResults: [{ invariant: 'dead_end_next_action', passed: true, awaitingContinueAfterDecision: true }],
              timings: { requestReceivedAt: new Date().toISOString() },
              telemetry: { totalBackendMs: 1 },
            },
          },
        })
        return
      }
      if (request.action === 'detect_contradictions') {
        await detectContradictionsGate
        detectContradictionsCompleted = true
        await route.fulfill({
          status: 200,
          json: {
            ok: true,
            version: 1,
            action: 'detect_contradictions',
            trialId,
            turnId: request.turnId,
            requestId: request.requestId,
            stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
            findingUpdates: [confirmedFinding],
            findingEvents: [
              { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
              decisionEvent,
            ],
            contradictions: [],
            openQuestions: panelQuestions,
            panelQuestions,
            questions: panelQuestions,
            questionHistory: panelQuestions,
            questionEvents: [],
            readiness: { score: 35, materialScore: 35, reportScore: 20, criticalMissing: ['tryb światła'], reportAvailable: false },
            reportAvailable: false,
            retryable: false,
            turnApplied: true,
            analysisStatus: 'applied',
            contradictionDetectionTriggered: true,
            contradictionDetectionCompleted: true,
            contradictionExtractionStatus: 'evaluated',
            trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['user-lamp-1'], providerCalls: 3 },
            sessionSnapshot: {
              ...baseState({ trialId }),
              conversation: request.history,
              findings: [confirmedFinding],
              findingEvents: [
                { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
                decisionEvent,
              ],
              contradictions: [],
              openQuestions: panelQuestions,
              questions: panelQuestions,
              questionBacklog: panelQuestions,
              contradictionExtractionStatus: 'evaluated',
            },
            engine2Trace: {
              traceId: 'trace-detect-lamp',
              action: 'detect_contradictions',
              requestId: request.requestId,
              turnId: request.turnId,
              contradictionDetectionTriggered: true,
              contradictionDetectionCompleted: true,
              questionCandidatesApplied: panelQuestions,
              panelQuestionCount: 3,
              timings: { requestReceivedAt: new Date().toISOString() },
              telemetry: { totalBackendMs: 1, llmLatencyMs: 1 },
            },
          },
        })
        return
      }
      if (request.action === 'evaluate_readiness') {
        await route.fulfill({
          status: 200,
          json: {
            ok: true,
            version: 1,
            action: 'evaluate_readiness',
            trialId,
            turnId: request.turnId,
            requestId: request.requestId,
            stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
            findingUpdates: [confirmedFinding],
            findingEvents: [
              { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
              decisionEvent,
            ],
            contradictions: [],
            openQuestions: panelQuestions,
            panelQuestions,
            questions: panelQuestions,
            questionHistory: panelQuestions,
            questionEvents: [],
            readiness: { status: 'evaluated', score: 35, materialScore: 35, reportScore: 20, criticalMissing: ['tryb światła'], reportAvailable: false },
            reportAvailable: false,
            retryable: false,
            turnApplied: true,
            analysisStatus: 'applied',
            readinessEvaluationTriggered: true,
            readinessEvaluationCompleted: true,
            trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['user-lamp-1'], providerCalls: 4 },
            sessionSnapshot: {
              ...baseState({ trialId }),
              conversation: request.history,
              findings: [confirmedFinding],
              findingEvents: [
                { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
                decisionEvent,
              ],
              openQuestions: panelQuestions,
              questions: panelQuestions,
              questionBacklog: panelQuestions,
              readiness: { status: 'evaluated', score: 35, materialScore: 35, reportScore: 20, criticalMissing: ['tryb światła'], reportAvailable: false },
            },
            engine2Trace: {
              traceId: 'trace-readiness-lamp',
              action: 'evaluate_readiness',
              requestId: request.requestId,
              turnId: request.turnId,
              readinessEvaluationTriggered: true,
              readinessEvaluationCompleted: true,
              questionCandidatesApplied: panelQuestions,
              panelQuestionCount: 3,
              timings: { requestReceivedAt: new Date().toISOString() },
              telemetry: { totalBackendMs: 1, llmLatencyMs: 1 },
            },
          },
        })
        return
      }
      expect(request.action).toBe('generate_panel_questions')
      expect(request.decisions).toEqual([])
      await route.fulfill({
        status: 200,
        json: {
          ok: true,
          version: 1,
          action: 'generate_panel_questions',
          trialId,
          turnId: request.turnId,
          requestId: request.requestId,
          stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
          findingProposals: [],
          findingUpdates: [confirmedFinding],
          findingEvents: [
            { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
            decisionEvent,
          ],
          pendingDecisionPackageId: null,
          pendingQuestionTransition: null,
          openQuestions: panelQuestions,
          panelQuestions,
          questions: panelQuestions,
          questionHistory: panelQuestions,
          questionEvents: [],
          questionCandidates: panelQuestions,
          nextQuestionId: null,
          activeQuestionId: null,
          chatQuestion: null,
          readiness: { score: 35, materialScore: 35, reportScore: 20, criticalMissing: ['tryb światła'], reportAvailable: false },
          reportAvailable: false,
          retryable: false,
          turnApplied: true,
          analysisStatus: 'applied',
          responseOrigin: 'panel_question_generator',
          backendInvariantResults: [{ invariant: 'dead_end_next_action', passed: true, panelQuestionCount: 3 }],
          trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['user-lamp-1'], providerCalls: 2 },
          sessionSnapshot: {
            ...baseState({ trialId }),
            conversation: request.history,
            messages: request.history,
            findings: [confirmedFinding],
            findingEvents: [
              { id: 'event-add-lamp-1', entityId: finding.id, operation: 'add', messageId: 'user-lamp-1', createdAt: '2026-08-22T15:39:00.000Z' },
              decisionEvent,
            ],
            openQuestions: panelQuestions,
            questions: panelQuestions,
            questionBacklog: panelQuestions,
            activeQuestionId: null,
            pendingDecisionPackageId: null,
            pendingQuestionTransition: null,
          },
          engine2Trace: {
              traceId: 'trace-generate-lamp',
              action: 'generate_panel_questions',
            requestId: request.requestId,
            turnId: request.turnId,
            decisionEvents: [decisionEvent],
            chatQuestion: null,
            questionCandidatesRaw: panelQuestions,
            questionCandidatesApplied: panelQuestions,
            panelQuestionCount: 3,
            backendInvariantResults: [{ invariant: 'dead_end_next_action', passed: true, panelQuestionCount: 3 }],
            timings: { requestReceivedAt: new Date().toISOString() },
            telemetry: { totalBackendMs: 1 },
          },
        },
      })
    })

    await page.goto('/engine_2?engine2debug=1')
    await page.locator('.engine2-composer-input').fill('Chcę zaprojektować nową lampę na biurko, bo obecne lampy nie świecą tam, gdzie potrzebuję.')
    await page.locator('.engine2-send-button').click()
    await expect(page.getByText(finding.displayText)).toBeVisible()

    await page.getByRole('button', { name: 'Zgadza się' }).click()

    await expect.poll(() => requests.map((request) => request.action).slice(0, 3)).toEqual([
      'analyze_message',
      'commit_finding_decisions',
      'generate_panel_questions',
    ])
    await expect(page.getByText('Analizuję odpowiedź…')).toHaveCount(0)
    await expect(page.locator('.engine2-map-list--questions [data-engine2-open-question-id]')).toHaveCount(3)
    expect(detectContradictionsCompleted).toBe(false)

    await expect.poll(async () => page.evaluate(() => {
      const raw = sessionStorage.getItem('engine2-public-diagnostics-v1')
      return raw ? JSON.parse(raw) : []
    })).toSatisfy((traces: any[]) => {
      const submitStarted = traces.some((trace) => trace.frontend?.findingDecisionSubmitStarted)
      const committed = traces.find((trace) => trace.action === 'commit_finding_decisions' && trace.backendTrace?.traceId === 'trace-commit-lamp')
      const continued = traces.find((trace) => trace.action === 'generate_panel_questions' && trace.backendTrace?.traceId === 'trace-generate-lamp')
      return submitStarted &&
        committed?.frontend?.findingDiagnostics?.decisionEventsCount >= 1 &&
        continued?.frontend?.findingDiagnostics?.decisionEventsCount >= 1 &&
        continued?.frontend?.findingDiagnostics?.visiblePendingProposalsCount === 0 &&
        continued?.frontend?.panelQuestionCount === 3 &&
        continued?.frontend?.acceptClickedAt &&
        continued?.frontend?.panelQuestionsRenderedAt &&
        typeof continued?.frontend?.acceptToQuestionsRenderedMs === 'number' &&
        continued?.frontend?.criticalPathLlmCalls === 1 &&
        continued?.frontend?.renderedPendingFindings?.length === 0 &&
        continued?.frontend?.renderedOpenQuestions?.length === 3
    })
    releaseDetectContradictions?.()
    await expect.poll(() => requests.map((request) => request.action)).toContain('detect_contradictions')
    await expect.poll(() => requests.map((request) => request.action)).toContain('evaluate_readiness')
    const storedState = await page.evaluate(() => JSON.parse(sessionStorage.getItem('engine2-public-trial-v5:pl') || '{}'))
    expect(storedState.pendingDecisionPackageId).toBeNull()
    expect(storedState.findings[0].decisionSource).toBe('user_accept')
    expect(storedState.findingEvents.some((event: any) => event.decisionSource === 'user_accept')).toBe(true)
  })

  test('playwright_accept_does_not_hang_when_question_generation_fails', async ({ page }) => {
    const trialId = 'e2e-engine2-decision-continue-fail'
    const pendingFinding = {
      id: 'finding-lamp-fail',
      semanticKey: 'need_better_desk_lamp_light_direction',
      category: 'goal',
      categoryLabel: 'Ustalenie',
      content: 'Użytkownik chce zaprojektować nową lampę na biurko.',
      text: 'Użytkownik chce zaprojektować nową lampę na biurko.',
      displayText: 'Chcesz zaprojektować nową lampę na biurko.',
      status: 'pending',
      source: 'ai_interpretation',
      packageId: 'package-lamp-fail',
    }
    const confirmedFinding = {
      ...pendingFinding,
      status: 'confirmed',
      decisionSource: 'user_accept',
      decisionAt: '2026-08-22T15:50:00.000Z',
    }
    const decisionEvent = {
      id: 'event-decision-lamp-fail',
      entityId: pendingFinding.id,
      findingId: pendingFinding.id,
      packageId: pendingFinding.packageId,
      operation: 'decision',
      decisionType: 'accept',
      decisionSource: 'user_accept',
      decisionAt: confirmedFinding.decisionAt,
      createdAt: confirmedFinding.decisionAt,
      messageId: null,
    }
    const requests: Array<Record<string, any>> = []

    await page.addInitScript(() => {
      localStorage.setItem('ui-language', 'Polish')
      sessionStorage.clear()
    })
    await page.route('**/api/engine_2', async (route) => {
      const request = route.request().postDataJSON()
      requests.push(request)
      if (request.action === 'analyze_message') {
        await route.fulfill({
          status: 200,
          json: {
            ok: true,
            version: 1,
            action: 'analyze_message',
            trialId,
            turnId: request.turnId,
            requestId: request.requestId,
            stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
            assistantMessage: null,
            findingProposals: [pendingFinding],
            findingUpdates: [pendingFinding],
            findingEvents: [{ id: 'event-add-lamp-fail', entityId: pendingFinding.id, findingId: pendingFinding.id, packageId: pendingFinding.packageId, operation: 'add', createdAt: '2026-08-22T15:49:00.000Z' }],
            packageId: pendingFinding.packageId,
            pendingDecisionPackageId: pendingFinding.packageId,
            openQuestions: [],
            panelQuestions: [],
            questions: [],
            questionEvents: [],
            nextQuestionId: null,
            activeQuestionId: null,
            chatQuestion: null,
            readiness: { score: 0, materialScore: 0, reportScore: 0, criticalMissing: [], reportAvailable: false },
            reportAvailable: false,
            retryable: false,
            turnApplied: true,
            analysisStatus: 'applied',
            trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: [request.message?.id], providerCalls: 1 },
            sessionSnapshot: {
              ...baseState({ trialId }),
              conversation: request.history,
              findings: [pendingFinding],
              findingEvents: [{ id: 'event-add-lamp-fail', entityId: pendingFinding.id, findingId: pendingFinding.id, packageId: pendingFinding.packageId, operation: 'add', createdAt: '2026-08-22T15:49:00.000Z' }],
              questions: [],
              questionBacklog: [],
              pendingDecisionPackageId: pendingFinding.packageId,
            },
          },
        })
        return
      }
      if (request.action === 'commit_finding_decisions') {
        await route.fulfill({
          status: 200,
          json: {
            ok: true,
            version: 1,
            action: 'commit_finding_decisions',
            trialId,
            turnId: request.turnId,
            requestId: request.requestId,
            stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
            findingProposals: [],
            findingUpdates: [confirmedFinding],
            findingEvents: [
              { id: 'event-add-lamp-fail', entityId: pendingFinding.id, findingId: pendingFinding.id, packageId: pendingFinding.packageId, operation: 'add', createdAt: '2026-08-22T15:49:00.000Z' },
              decisionEvent,
            ],
            decisionApplied: true,
            decisionEvents: [decisionEvent],
            continueApplied: false,
            awaitingContinueAfterDecision: true,
            pendingDecisionPackageId: null,
            openQuestions: [],
            panelQuestions: [],
            questions: [],
            questionEvents: [],
            nextQuestionId: null,
            activeQuestionId: null,
            chatQuestion: null,
            readiness: { score: 0, materialScore: 0, reportScore: 0, criticalMissing: [], reportAvailable: false },
            reportAvailable: false,
            retryable: false,
            turnApplied: true,
            analysisStatus: 'applied',
            trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['user-lamp-fail'], providerCalls: 1 },
            sessionSnapshot: {
              ...baseState({ trialId }),
              conversation: request.history,
              findings: [confirmedFinding],
              findingEvents: [
                { id: 'event-add-lamp-fail', entityId: pendingFinding.id, findingId: pendingFinding.id, packageId: pendingFinding.packageId, operation: 'add', createdAt: '2026-08-22T15:49:00.000Z' },
                decisionEvent,
              ],
              questions: [],
              questionBacklog: [],
              pendingDecisionPackageId: null,
            },
          },
        })
        return
      }
      expect(request.action).toBe('generate_panel_questions')
      await route.fulfill({
        status: 200,
        json: {
          ok: true,
          version: 1,
          action: 'generate_panel_questions',
          trialId,
          turnId: request.turnId,
          requestId: request.requestId,
          stateVersionReturned: Number(request.stateVersionSent || 0) + 1,
          findingProposals: [],
          findingUpdates: [confirmedFinding],
          findingEvents: [
            { id: 'event-add-lamp-fail', entityId: pendingFinding.id, findingId: pendingFinding.id, packageId: pendingFinding.packageId, operation: 'add', createdAt: '2026-08-22T15:49:00.000Z' },
            decisionEvent,
          ],
          decisionApplied: false,
          continueApplied: false,
          retryableContinueError: true,
          continueError: { diagnosticCode: 'ENGINE2_READINESS_INVALID_OUTPUT', message: 'Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.', retryable: true },
          pendingDecisionPackageId: null,
          guideNotice: 'Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.',
          notice: 'Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.',
          openQuestions: [],
          panelQuestions: [],
          questions: [],
          questionEvents: [],
          nextQuestionId: null,
          activeQuestionId: null,
          chatQuestion: null,
          readiness: { score: 0, materialScore: 0, reportScore: 0, criticalMissing: [], reportAvailable: false },
          reportAvailable: false,
          retryable: true,
          turnApplied: false,
          analysisStatus: 'retryable_error',
          trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['user-lamp-fail'], providerCalls: 2 },
          sessionSnapshot: {
            ...baseState({ trialId }),
            conversation: request.history,
            findings: [confirmedFinding],
            findingEvents: [
              { id: 'event-add-lamp-fail', entityId: pendingFinding.id, findingId: pendingFinding.id, packageId: pendingFinding.packageId, operation: 'add', createdAt: '2026-08-22T15:49:00.000Z' },
              decisionEvent,
            ],
            questions: [],
            questionBacklog: [],
            pendingDecisionPackageId: null,
            guideNotice: 'Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.',
          },
        },
      })
    })

    await page.goto('/engine_2')
    await page.locator('.engine2-composer-input').fill('Chcę nową lampę na biurko.')
    await page.locator('.engine2-send-button').click()
    await expect(page.getByText(pendingFinding.displayText)).toBeVisible()
    await page.getByRole('button', { name: 'Zgadza się' }).click()

    await expect.poll(() => requests.map((request) => request.action)).toEqual([
      'analyze_message',
      'commit_finding_decisions',
      'generate_panel_questions',
    ])
    await expect(page.getByText('Analizuję odpowiedź…')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Zgadza się' })).toHaveCount(0)
    await expect(page.getByText(confirmedFinding.displayText)).toBeVisible()
    await expect(page.getByText('Nie udało się przygotować kolejnych pytań. Spróbuj ponownie.')).toBeVisible()
    await expect(page.getByRole('button', { name: /ponów analizę/i })).toBeEnabled()
  })

  test('migrates v4 to one active question and renders clarification under the same backend ID', async ({ page }) => {
    await page.addInitScript(({ active, panel, state }) => {
      localStorage.setItem('ui-language', 'Polish')
      sessionStorage.setItem('engine2-public-trial-v4:pl', JSON.stringify({
        ...state,
        schemaVersion: 'engine2.session.v4',
        questions: [active, panel], questionHistory: [active, panel], openQuestions: [active, panel],
        questionBacklog: [], questionLedgerMigrationVersion: null,
      }))
    }, { active: activeQuestion, panel: legacyPanelQuestion, state: baseState() })

    let requestBody: Record<string, any> | null = null
    await page.route('**/api/engine_2', async (route) => {
      requestBody = route.request().postDataJSON()
      const rephrased = 'Czy chcesz móc rozjaśniać i przyciemniać lampę?'
      await route.fulfill({
        status: 200,
        json: {
          ok: true, version: 1, action: 'analyze_message', turnApplied: true, analysisStatus: 'applied',
          trialId: requestBody?.trialId, turnId: requestBody?.turnId,
          requestId: requestBody?.requestId, stateVersionReturned: Number(requestBody?.stateVersionSent || 0) + 1,
          turnKind: 'clarification_request',
          assistantReply: { type: 'explanation', text: 'Chodzi o możliwość zmiany jasności lampy.' },
          assistantMessage: { id: 'a-explanation', role: 'assistant', content: 'Chodzi o możliwość zmiany jasności lampy.' },
          activeQuestionPresentation: {
            messageId: 'a-rephrased-q-active', questionId: activeQuestion.id, text: rephrased,
            reason: 'Prostsze sformułowanie.',
          },
          findingProposals: [], findingUpdates: [], packageId: null,
          openQuestions: [activeQuestion], questions: [activeQuestion], questionHistory: [activeQuestion],
          nextQuestionId: activeQuestion.id, activeQuestionId: activeQuestion.id,
          pendingDecisionPackageId: null, pendingQuestionTransition: null,
          readiness: { score: 0, reportScore: 0, criticalMissing: [], reportAvailable: false },
          reportAvailable: false, retryable: false,
          trialCounters: { successfulTrialTurns: 2, successfulTurnMessageIds: ['u1', requestBody?.message?.id], providerCalls: 2 },
          responseOrigin: 'new_llm_call',
          sessionSnapshot: {
            ...baseState(),
            conversation: [...requestBody!.history, { id: 'a-explanation', role: 'assistant', content: 'Chodzi o możliwość zmiany jasności lampy.' }, { id: 'a-rephrased-q-active', role: 'assistant', content: rephrased, questionId: activeQuestion.id }],
          },
        },
      })
    })

    await page.goto('/engine_2')
    await expect(page.locator('.engine2-map-list--questions [data-engine2-open-question-id]')).toHaveCount(1)
    await expect(page.locator(`[data-engine2-open-question-id="${legacyPanelQuestion.id}"]`)).toHaveCount(0)
    await page.locator('.engine2-composer-input').fill('Co dokładnie masz na myśli?')
    await page.locator('.engine2-send-button').click()

    await expect.poll(() => requestBody?.replyToGapId).toBe(activeQuestion.id)
    expect(requestBody?.openQuestions).toHaveLength(1)
    expect(requestBody?.sessionSnapshot.questionBacklog.map((question: any) => question.id)).toEqual([legacyPanelQuestion.id])
    await expect(page.locator('[data-engine2-chat-message="assistant"]', { hasText: 'Czy chcesz móc rozjaśniać i przyciemniać lampę?' })).toHaveCount(1)
    await expect(page.locator('.engine2-map-list--questions [data-engine2-open-question-id]')).toHaveCount(1)
  })

  test('keeps the immutable user message and active question through retryable failures', async ({ page }) => {
    await page.addInitScript((state) => {
      localStorage.setItem('ui-language', 'Polish')
      sessionStorage.setItem('engine2-public-trial-v5:pl', JSON.stringify(state))
    }, baseState({ trialId: 'e2e-engine2-retry' }))

    const requests: Array<Record<string, any>> = []
    await page.route('**/api/engine_2', async (route) => {
      const request = route.request().postDataJSON()
      requests.push(request)
      await route.fulfill({
        status: 200,
        json: {
          ok: false, version: 1, action: 'analyze_message', trialId: request.trialId,
          turnId: request.turnId, requestId: request.requestId,
          stateVersionReturned: Number(request.stateVersionSent || 0),
          diagnosticCode: 'ENGINE2_TURN_INVALID_OUTPUT', notice: 'Nie udało się przeanalizować tej wiadomości.',
          retryable: true, retryMessageId: request.message.id, replyToGapId: request.replyToGapId,
          turnApplied: false, analysisStatus: 'retryable_error', responseOrigin: 'repair_retry_failed',
          trialCounters: { successfulTrialTurns: 1, successfulTurnMessageIds: ['u1'], providerCalls: 2 + requests.length },
          sessionSnapshot: baseState({ trialId: 'e2e-engine2-retry' }),
        },
      })
    })

    const reply = 'Tak, chcę regulować jasność.'
    await page.goto('/engine_2')
    await page.locator('.engine2-composer-input').fill(reply)
    await page.locator('.engine2-send-button').click()

    await expect.poll(() => requests.length).toBe(1)
    const originalMessageId = requests[0].message.id
    expect(requests[0].replyToGapId).toBe(activeQuestion.id)
    await expect(page.locator('[data-engine2-chat-message="user"]', { hasText: reply })).toHaveCount(1)
    await expect(page.locator('.engine2-map-list--questions [data-engine2-open-question-id]')).toHaveCount(1)

    const retryButton = page.getByRole('button', { name: /ponów analizę/i })
    await expect(retryButton).toBeEnabled()
    await retryButton.click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1].message.id).toBe(originalMessageId)
    expect(requests[1].replyToGapId).toBe(activeQuestion.id)
    await expect(page.locator('[data-engine2-chat-message="user"]', { hasText: reply })).toHaveCount(1)
    await expect(page.locator('.engine2-map-list--questions [data-engine2-open-question-id]')).toHaveCount(1)
  })
})
