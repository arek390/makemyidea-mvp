import { chromium } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { handleEngine2Public } from '../src/lib/server/handlers/engine2Public.js'

const projectRoot = resolve(import.meta.dirname, '..')
const distRoot = resolve(projectRoot, 'dist')
const envPath = resolve(projectRoot, '.env.local')

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
}

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the live eval')
if (!existsSync(resolve(distRoot, 'index.html'))) throw new Error('Run npm run build before the live eval')

const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const callHandler = async (body, headers) => {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
  }
  await handleEngine2Public({
    method: 'POST',
    body,
    headers: { ...headers, host: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  }, response)
  return response
}

const seedExactTraceConversation = () => {
  const question = {
    id: 'gap-lamp-light-places-live',
    semanticKey: 'light-placement-control',
    intent: 'control the place illuminated by the lamp',
    question: 'Jakie konkretne miejsca na biurku chcesz oświetlać?',
    status: 'open',
    presentation: 'ask_now',
    createdFromMessageId: 'live-user-1',
    askedCount: 1,
    lastAskedAt: new Date().toISOString(),
  }
  const readiness = {
    score: 25,
    materialScore: 25,
    reportScore: 25,
    criticalMissing: ['konkretne zastosowania lampy'],
    reportAvailable: false,
  }
  return {
    schemaVersion: 'engine2.session.v5',
    trialId: `engine2-live-exact-${Date.now()}`,
    language: 'pl',
    messages: [
      {
        id: 'live-user-1',
        role: 'user',
        content: 'Chcę zaprojektować nową lampę na biurko. Obecne lampy nie dają światła tam, gdzie go potrzebuję.',
      },
      { id: 'live-assistant-1', role: 'assistant', content: question.question },
    ],
    conversation: [
      {
        id: 'live-user-1',
        role: 'user',
        content: 'Chcę zaprojektować nową lampę na biurko. Obecne lampy nie dają światła tam, gdzie go potrzebuję.',
      },
      { id: 'live-assistant-1', role: 'assistant', content: question.question },
    ],
    findings: [
      {
        id: 'live-finding-goal',
        category: 'goal',
        categoryLabel: 'Ustalenie',
        content: 'Użytkownik chce zaprojektować nową lampę na biurko.',
        status: 'confirmed',
        subject: 'product',
        perspective: 'desired',
        source: 'ai_interpretation',
        sourceMessageIds: ['live-user-1'],
        proposedOperation: 'add',
        targetFindingId: null,
      },
      {
        id: 'live-finding-problem',
        category: 'constraint',
        categoryLabel: 'Ustalenie',
        content: 'Obecne lampy nie kierują światła tam, gdzie jest potrzebne.',
        status: 'confirmed',
        subject: 'product',
        perspective: 'not_working',
        source: 'ai_interpretation',
        sourceMessageIds: ['live-user-1'],
        proposedOperation: 'add',
        targetFindingId: null,
      },
    ],
    openQuestions: [question],
    questions: [question],
    questionHistory: [question],
    findingEvents: [],
    contradictions: [],
    questionEvents: [],
    activeQuestionId: question.id,
    questionBacklog: [],
    questionLedgerMigrationVersion: 'engine2.questions.single-active.v1',
    pendingQuestionTransition: null,
    guideNotice: null,
    rejectedFingerprints: [],
    pendingPackageId: null,
    pendingDecisionPackageId: null,
    pendingPackageExpectedCount: 0,
    remindedPackageIds: [],
    readiness,
    materialReadiness: readiness,
    reportReadiness: readiness,
    successfulTrialTurns: 1,
    successfulTurnMessageIds: ['live-user-1'],
    providerCalls: 1,
    reportAvailable: false,
    trialEnded: false,
    adminUsage: null,
  }
}

const runBrowserTurn = async ({
  browser,
  seedState = null,
  userText,
  selectFirstPanel = false,
  selectPanelId = null,
  forceFirstAnalysisFailure = false,
  autoRetry = false,
  autoConfirm = false,
}) => {
  const context = await browser.newContext({ locale: 'pl-PL' })
  if (seedState) {
    await context.addInitScript((state) => {
      sessionStorage.setItem('engine2-public-trial-v5:pl', JSON.stringify(state))
    }, seedState)
  }
  const page = await context.newPage()
  const requests = []
  const responses = []
  let shouldForceFailure = forceFirstAnalysisFailure
  await page.route('http://127.0.0.1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/engine_2') {
      const body = request.postDataJSON()
      requests.push(body)
      const savedApiKey = process.env.OPENAI_API_KEY
      if (shouldForceFailure && body.action === 'analyze_message') {
        shouldForceFailure = false
        delete process.env.OPENAI_API_KEY
      }
      let response
      try {
        response = await callHandler(body, request.headers())
      } finally {
        if (savedApiKey) process.env.OPENAI_API_KEY = savedApiKey
      }
      responses.push(response.payload)
      await route.fulfill({ status: response.statusCode, json: response.payload })
      return
    }
    const relativePath = url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : 'index.html'
    const filePath = resolve(distRoot, relativePath)
    if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
      await route.abort()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: mimeTypes[extname(filePath)] || 'application/octet-stream',
      body: readFileSync(filePath),
    })
  })

  await page.goto('http://127.0.0.1/engine_2?engine2debug=1')
  let selectedPanelId = null
  if (selectFirstPanel || selectPanelId) {
    const panelQuestion = selectPanelId
      ? page.locator(`.engine2-map-list--questions [data-engine2-open-question-id="${selectPanelId}"]`)
      : page.locator('.engine2-map-list--questions [data-engine2-open-question-id]').first()
    if (await panelQuestion.count()) {
      selectedPanelId = await panelQuestion.getAttribute('data-engine2-open-question-id')
      await panelQuestion.locator('xpath=..').locator('button').click()
    }
  }
  await page.locator('.engine2-composer-input').fill(userText)
  const replyTargetShown = await page.locator('[data-engine2-reply-target-id]').getAttribute('data-engine2-reply-target-id').catch(() => null)
  await page.locator('.engine2-send-button').click()
  const analyzingIndicatorShown = await page.locator('.engine2-message--loading').isVisible().catch(() => false)
  await page.locator('.engine2-message--loading').waitFor({ state: 'detached', timeout: 70_000 })
  if (autoRetry && await page.locator('.engine2-retry-button').isVisible().catch(() => false)) {
    await page.locator('.engine2-retry-button').click()
    await page.locator('.engine2-message--loading').waitFor({ state: 'detached', timeout: 70_000 })
  }
  if (autoConfirm && await page.locator('.engine2-findings-bulk-button--primary').isVisible().catch(() => false)) {
    await page.locator('.engine2-findings-bulk-button--primary').click()
    await page.waitForFunction(() => {
      const raw = sessionStorage.getItem('engine2-public-trial-v5:pl')
      if (!raw) return false
      try {
        const state = JSON.parse(raw)
        return !state.pendingPackageId && !state.findings?.some((finding) => finding.status === 'pending')
      } catch { return false }
    }, { timeout: 70_000 })
  }
  await page.waitForFunction(() => {
    const raw = sessionStorage.getItem('engine2-public-diagnostics-v1')
    if (!raw) return false
    try { return JSON.parse(raw).length > 0 } catch { return false }
  }, { timeout: 10_000 }).catch(() => {})

  const apiResponse = responses.filter((entry) => entry?.action === 'analyze_message').at(-1) || null
  const request = requests.filter((entry) => entry?.action === 'analyze_message').at(-1) || null
  const dom = await page.evaluate(() => ({
    traceId: document.querySelector('[data-engine2-rendered-trace-id]')?.getAttribute('data-engine2-rendered-trace-id') || null,
    chatText: [...document.querySelectorAll('[data-engine2-chat-message="assistant"]')].at(-1)?.textContent?.trim() || null,
    replyTargetId: document.querySelector('[data-engine2-reply-target-id]')?.getAttribute('data-engine2-reply-target-id') || null,
    panelQuestions: [...document.querySelectorAll('.engine2-map-list--questions [data-engine2-open-question-id]')]
      .map((entry) => ({ id: entry.getAttribute('data-engine2-open-question-id'), text: entry.textContent?.trim() || '' })),
    allQuestionTexts: [...document.querySelectorAll('[data-engine2-open-question-id]')]
      .map((entry) => entry.textContent?.trim() || ''),
  }))
  const persistedState = await page.evaluate(() => {
    const raw = sessionStorage.getItem('engine2-public-trial-v5:pl')
    return raw ? JSON.parse(raw) : null
  })
  await context.close()
  return {
    request,
    requests,
    apiResponse,
    responses,
    dom,
    persistedState,
    replyTargetShown,
    analyzingIndicatorShown,
    selectedPanelId,
  }
}

const bundledChrome = chromium.executablePath()
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browserExecutable = existsSync(bundledChrome) ? bundledChrome : systemChrome
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(browserExecutable) ? { executablePath: browserExecutable } : {}),
})
const runFullAcceptance = process.argv.includes('--full')
try {
  liveRun: {
  const firstText = 'Chcę zaprojektować nową lampę na biurko. Obecne lampy nie dają światła tam, gdzie go potrzebuję.'
  const first = await runBrowserTurn({ browser, userText: firstText })
  const exactSeed = seedExactTraceConversation()
  const secondText = 'Ta lampa nie jest tylko dla mnie. Chodzi mi o to, żeby łatwo można było dopasować miejsce, w które lampa świeci, i żeby można było zmienić średnicę stożka światła od szerokiego ogólnego do punktowego dla precyzyjnych prac.'
  const second = await runBrowserTurn({ browser, seedState: exactSeed, userText: secondText })

  const evidence = (turn) => ({
    request: {
      turnId: turn.request?.turnId || null,
      replyToGapId: turn.request?.replyToGapId || null,
      activeQuestionGapId: turn.request?.activeQuestionGapId || null,
      historyCount: turn.request?.history?.length || 0,
    },
    rawOutputs: turn.apiResponse?.engine2Trace?.attemptDetails?.map((attempt) => ({
      attempt: attempt.attempt,
      kind: attempt.kind,
      rawOutput: attempt.rawOutput,
      validation: attempt.validation,
    })) || [],
    finalPlan: turn.apiResponse?.engine2Trace?.validatedPlan || null,
    apiResponse: turn.apiResponse,
    simulatedRenderedState: turn.dom,
    trialCounters: turn.apiResponse?.trialCounters || null,
  })

  const secondFindings = (second.apiResponse?.findingProposals || []).map((entry) => entry.content)
  const oldQuestion = exactSeed.openQuestions[0].question
  const secondAskNow = (second.apiResponse?.openQuestions || []).find((entry) => entry.presentation === 'ask_now')
  const secondPanels = (second.apiResponse?.openQuestions || []).filter((entry) => entry.presentation === 'panel')
  const secondProviderCallDelta = Number(second.apiResponse?.trialCounters?.providerCalls) - Number(exactSeed.providerCalls)
  const smokeChecks = {
    firstProviderWasCalled: (first.apiResponse?.engine2Trace?.attemptDetails || []).length >= 1,
    firstValidPlanWasApplied: ['new_llm_call', 'repair_retry'].includes(first.apiResponse?.responseOrigin),
    firstNotCacheOrFallback: first.apiResponse?.cacheStatus === 'miss' && !first.apiResponse?.engine2Trace?.telemetry?.generationFallbackUsed,
    firstCapturedFindings: (first.apiResponse?.findingProposals || []).length > 0,
    firstHasOneAskNow: (first.apiResponse?.openQuestions || []).filter((entry) => entry.presentation === 'ask_now').length === 1,
    firstHasPanel: (first.apiResponse?.openQuestions || []).some((entry) => entry.presentation === 'panel'),
    secondProviderWasCalled: (second.apiResponse?.engine2Trace?.attemptDetails || []).length >= 1,
    secondValidPlanWasApplied: ['new_llm_call', 'repair_retry'].includes(second.apiResponse?.responseOrigin),
    secondNotCacheOrFallback: second.apiResponse?.cacheStatus === 'miss' && !second.apiResponse?.engine2Trace?.telemetry?.generationFallbackUsed,
    twoIndependentFindingsCaptured: secondFindings.length >= 2,
    beamDirectionCaptured: secondFindings.some((text) => /kier|dopas|wybran|miejsce/i.test(text)),
    beamWidthCaptured: secondFindings.some((text) => /stoż|wiązk|szerok|punkt|średnic/i.test(text)),
    oldQuestionResolvedOrRetired: (second.apiResponse?.questionHistory || []).some((entry) =>
      entry.id === exactSeed.activeQuestionId && ['answered', 'superseded'].includes(entry.status)
    ),
    oldQuestionAbsentFromPanels: secondPanels.every((entry) => entry.id !== exactSeed.activeQuestionId && entry.question !== oldQuestion),
    oldQuestionNotRepeated: (second.apiResponse?.openQuestions || []).every((entry) => entry.question !== oldQuestion) &&
      !String(second.dom.chatText || '').includes(oldQuestion),
    nextQuestionChanged: Boolean(secondAskNow?.question && secondAskNow.question !== oldQuestion),
    replyToGapIdPresent: second.request?.replyToGapId === exactSeed.activeQuestionId,
    replyTargetWasVisibleAndExact: second.replyTargetShown === exactSeed.activeQuestionId,
    replyTargetReplaced: second.dom.replyTargetId === second.apiResponse?.nextQuestionId,
    readinessIncreased: Number(second.apiResponse?.materialReadiness?.score || 0) > Number(exactSeed.materialReadiness.score),
    secondHasOneAskNow: (second.apiResponse?.openQuestions || []).filter((entry) => entry.presentation === 'ask_now').length === 1,
    secondHasPanelInApi: secondPanels.length > 0,
    secondHasPanelInDom: second.dom.panelQuestions.length > 0,
    noFormulaicThanks: !/dziękuję|dzięki|thanks/i.test(String(second.dom.chatText || '')),
    chatQuestionComesFromLedger: secondAskNow?.id === second.apiResponse?.nextQuestionId && second.dom.chatText === secondAskNow?.question,
    activeSemanticKeysUnique: new Set((second.apiResponse?.openQuestions || []).map((entry) => entry.semanticKey)).size === (second.apiResponse?.openQuestions || []).length,
    analyzingIndicatorShown: first.analyzingIndicatorShown && second.analyzingIndicatorShown,
    renderedTraceMatches: second.dom.traceId === second.apiResponse?.engine2Trace?.traceId,
    successfulTrialTurnsIncreasedOnce: Number(second.apiResponse?.trialCounters?.successfulTrialTurns) === Number(exactSeed.successfulTrialTurns) + 1,
    providerCallsIncreasedOnceOrTwice: [1, 2].includes(secondProviderCallDelta),
    noInvalidOutputDiagnostic: second.apiResponse?.diagnosticCode !== 'ENGINE2_TURN_INVALID_OUTPUT',
    thirtyTurnLimitStillOpen: Number(second.apiResponse?.limits?.remainingSuccessfulTurns) >= 28 && !second.apiResponse?.trialEnded,
  }
  const smokeFailed = Object.values(smokeChecks).some((value) => value !== true)
  if (!runFullAcceptance || smokeFailed) {
    console.log(JSON.stringify({
      liveEval: true,
      mode: 'two-turn-smoke',
      checks: smokeChecks,
      firstTurn: evidence(first),
      exactTraceTurn: evidence(second),
    }, null, 2))
    if (smokeFailed) process.exitCode = 1
    break liveRun
  }

  const thirdSeed = {
    ...exactSeed,
    trialId: `engine2-live-panel-${Date.now()}`,
    messages: [
      ...exactSeed.messages,
      { id: 'live-user-2', role: 'user', content: secondText },
      second.apiResponse?.assistantMessage,
    ].filter(Boolean),
    conversation: [
      ...exactSeed.conversation,
      { id: 'live-user-2', role: 'user', content: secondText },
      second.apiResponse?.assistantMessage,
    ].filter(Boolean),
    findings: (second.apiResponse?.findingUpdates || []).map((entry) => ({
      ...entry,
      status: entry.status === 'pending' ? 'confirmed' : entry.status,
    })),
    openQuestions: second.apiResponse?.openQuestions || [],
    questions: second.apiResponse?.questions || second.apiResponse?.questionHistory || [],
    questionHistory: second.apiResponse?.questionHistory || [],
    findingEvents: second.apiResponse?.findingEvents || [],
    contradictions: second.apiResponse?.contradictions || [],
    questionEvents: second.apiResponse?.questionEvents || [],
    activeQuestionId: second.apiResponse?.nextQuestionId || null,
    pendingPackageId: null,
    pendingDecisionPackageId: null,
    pendingPackageExpectedCount: 0,
    readiness: second.apiResponse?.readiness || exactSeed.readiness,
    materialReadiness: second.apiResponse?.materialReadiness || exactSeed.materialReadiness,
    reportReadiness: second.apiResponse?.reportReadiness || exactSeed.reportReadiness,
    successfulTrialTurns: Number(second.apiResponse?.trialCounters?.successfulTrialTurns || 1),
    successfulTurnMessageIds: second.apiResponse?.trialCounters?.successfulTurnMessageIds || ['live-user-1'],
    providerCalls: Number(second.apiResponse?.trialCounters?.providerCalls || 1),
  }
  const third = await runBrowserTurn({
    browser,
    seedState: thirdSeed,
    selectFirstPanel: true,
    userText: 'Najważniejsze jest dla mnie, żeby ten element dało się łatwo regulować podczas pracy.',
  })

  const fifteenTurnMessages = [
    secondText,
    'W odpowiedzi na wybrany wątek: lampa może być mocowana do blatu solidnym zaciskiem.',
    'W odpowiedzi na drugi wybrany wątek: najszersze światło powinno obejmować około 80 na 50 centymetrów.',
    'Kierunek światła powinien dać się zmieniać zarówno ramieniem, jak i obracaną głowicą.',
    'Źródło światła powinno sięgać mniej więcej 70 centymetrów od punktu mocowania.',
    'Przy precyzyjnych pracach ważne jest bardzo dobre oddawanie kolorów, co najmniej CRI 90.',
    'Barwa światła powinna być regulowana mniej więcej od 3000 do 5000 kelwinów.',
    'Sterowanie powinno być bezpośrednio na lampie, najlepiej pokrętłem; aplikacja nie jest potrzebna.',
    'Przewód może wychodzić z zacisku, ale nie powinien przechodzić przez środek blatu.',
    'Światło nie może razić użytkownika ani odbijać się wyraźnie w monitorze.',
    'Z lampy będą korzystać różne osoby, więc regulacja musi być szybka i intuicyjna.',
    'Docelowy koszt zakupu powinien pozostać w okolicy 500 złotych.',
    'Ramię może być metalowe, jeśli zachowa płynny ruch i nie będzie opadało.',
    'Elementy regulacyjne powinny dać się wymienić bez rozbierania całej lampy.',
    'Po ustawieniu lampa musi utrzymywać pozycję także przy przypadkowym lekkim dotknięciu biurka.',
  ]
  const chainSeed = {
    ...seedExactTraceConversation(),
    trialId: `engine2-live-15-turns-${Date.now()}`,
  }
  const fifteenTurns = []
  let persistedChainState = chainSeed
  let firstPanelIds = []
  let idempotencyReplay = null
  for (const [index, userText] of fifteenTurnMessages.entries()) {
    const selectedPanelId = index === 1 ? firstPanelIds[0] : index === 2 ? firstPanelIds[1] : null
    const turn = await runBrowserTurn({
      browser,
      seedState: persistedChainState,
      userText,
      selectPanelId: selectedPanelId,
      autoConfirm: true,
    })
    if (index === 0) {
      firstPanelIds = (turn.apiResponse?.openQuestions || [])
        .filter((question) => question.presentation === 'panel')
        .map((question) => question.id)
      const replay = await callHandler(turn.request, { 'x-ai-support': 'on', host: '127.0.0.1' })
      idempotencyReplay = replay.payload
    }
    persistedChainState = turn.persistedState
    fifteenTurns.push(turn)
    if (turn.apiResponse?.responseOrigin === 'repair_retry_failed') break
  }

  const repairRetryCount = fifteenTurns.reduce(
    (sum, turn) => sum + Number((turn.apiResponse?.engine2Trace?.attemptDetails || []).length > 1),
    0
  )
  const unexpectedRepairRetryFailure = fifteenTurns.findIndex(
    (turn) => turn.apiResponse?.responseOrigin === 'repair_retry_failed'
  )
  const finalCounters = fifteenTurns.at(-1)?.apiResponse?.trialCounters || null
  const fifteenTurnChecks = {
    fifteenSuccessfulMessagesCompleted:
      Number(finalCounters?.successfulTrialTurns) === Number(chainSeed.successfulTrialTurns) + 15,
    providerCallsTrackedSeparately:
      Number(finalCounters?.providerCalls) >= Number(finalCounters?.successfulTrialTurns),
    trialStillOpenAfterFifteen: !fifteenTurns.at(-1)?.apiResponse?.trialEnded,
    stoppedAtFirstUnexpectedRepairFailure: unexpectedRepairRetryFailure < 0 || fifteenTurns.length === unexpectedRepairRetryFailure + 1,
    noUnexpectedRepairRetryFailure: unexpectedRepairRetryFailure < 0,
    sameTurnReplayDidNotConsumeCounters:
      idempotencyReplay?.responseOrigin === 'idempotency_replay' &&
      JSON.stringify(idempotencyReplay?.trialCounters) === JSON.stringify(fifteenTurns[0]?.apiResponse?.trialCounters),
    firstPanelWasSelected: Boolean(firstPanelIds[0]) && fifteenTurns[1]?.request?.replyToGapId === firstPanelIds[0],
    secondPanelWasSelected: Boolean(firstPanelIds[1]) && fifteenTurns[2]?.request?.replyToGapId === firstPanelIds[1],
    everySuccessfulTurnUsedModel: fifteenTurns.every((turn) =>
      ['new_llm_call', 'repair_retry'].includes(turn.apiResponse?.responseOrigin)
    ),
    refreshRestoredSameTrial: fifteenTurns.every((turn) => turn.persistedState?.trialId === chainSeed.trialId),
  }

  let forcedFailureTurn = null
  if (fifteenTurns.length === fifteenTurnMessages.length && unexpectedRepairRetryFailure < 0) {
    forcedFailureTurn = await runBrowserTurn({
      browser,
      seedState: { ...seedExactTraceConversation(), trialId: `engine2-live-forced-failure-${Date.now()}` },
      userText: secondText,
      forceFirstAnalysisFailure: true,
      autoRetry: true,
      autoConfirm: true,
    })
  }
  const forcedFailureChecks = {
    controlledFailureWasObservedSeparately: Boolean(forcedFailureTurn?.responses.some(
      (response) => response?.retryable && response?.diagnosticCode
    )),
    controlledFailureDidNotAffectFifteenTurnState:
      forcedFailureTurn?.persistedState?.trialId !== chainSeed.trialId,
  }

  const checks = {
    ...smokeChecks,
    panelClickSentExactReplyToGapId: Boolean(third.selectedPanelId) && third.request?.replyToGapId === third.selectedPanelId,
    modelUsedSelectedPanelContext: third.apiResponse?.answer?.questionId === third.selectedPanelId,
    panelTurnUsedRealPlanner: ['new_llm_call', 'repair_retry'].includes(third.apiResponse?.responseOrigin),
  }

  console.log(JSON.stringify({
    liveEval: true,
    checks,
    firstTurn: evidence(first),
    exactTraceTurn: evidence(second),
    selectedPanelTurn: evidence(third),
    fifteenTurnAcceptance: {
      checks: fifteenTurnChecks,
      successfulTrialTurns: finalCounters?.successfulTrialTurns ?? null,
      providerCalls: finalCounters?.providerCalls ?? null,
      repairRetryCount,
      unexpectedRepairRetryFailureTurn: unexpectedRepairRetryFailure >= 0 ? unexpectedRepairRetryFailure + 1 : null,
      remainingSuccessfulTurns: fifteenTurns.at(-1)?.apiResponse?.limits?.remainingSuccessfulTurns ?? null,
      idempotencyReplay: {
        responseOrigin: idempotencyReplay?.responseOrigin || null,
        trialCounters: idempotencyReplay?.trialCounters || null,
      },
      turns: fifteenTurns.map((turn, index) => ({
        turn: index + 1,
        request: {
          turnId: turn.request?.turnId || null,
          messageId: turn.request?.message?.id || null,
          replyToGapId: turn.request?.replyToGapId || null,
        },
        responseOrigin: turn.apiResponse?.responseOrigin || null,
        trialCounters: turn.apiResponse?.trialCounters || null,
        rawAttempts: turn.apiResponse?.engine2Trace?.attemptDetails?.map((attempt) => ({
          kind: attempt.kind,
          rawOutput: attempt.rawOutput,
          validation: attempt.validation,
        })) || [],
        askNow: (turn.apiResponse?.openQuestions || []).filter((question) => question.presentation === 'ask_now'),
        panels: (turn.apiResponse?.openQuestions || []).filter((question) => question.presentation === 'panel'),
        resolved: (turn.apiResponse?.questionHistory || []).filter((question) => ['answered', 'superseded'].includes(question.status)),
        simulatedRenderedState: turn.dom,
      })),
    },
    controlledForcedFailure: {
      checks: forcedFailureChecks,
      turn: forcedFailureTurn ? evidence(forcedFailureTurn) : null,
    },
  }, null, 2))

  if (
    Object.values(checks).some((value) => value !== true) ||
    Object.values(fifteenTurnChecks).some((value) => value !== true) ||
    Object.values(forcedFailureChecks).some((value) => value !== true)
  ) process.exitCode = 1
  }
} finally {
  await browser.close()
}
