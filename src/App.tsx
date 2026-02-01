import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import './App.css'
import {
  MATRIX_COLS,
  MATRIX_ROWS,
  cellKey,
  computeMappingDetails,
  mapEntryToCell,
  pickGravityTarget,
  type MatrixColKey,
  type MatrixRowKey,
} from './engineMatrix/matrixHeuristics'
import {
  createSession,
  deleteSession,
  exportSessions,
  getSession,
  importSessions,
  listSessions,
  updateSession,
  getStorageSessionCount,
  type EngineBoardItem,
  type EngineSessionDetail,
  type EngineSessionSummary,
} from './storage/sessionStore'
import type { ReportSummary } from './storage/sessionStore'
import { type CloudSessionPayload } from './lib/cloudSessions'
import {
  fetchBoardItems,
  insertBoardItem,
  updateBoardItemLabel,
  updateBoardItemMatrix,
} from './lib/cloudBoardItems'
import {
  ENGINE_ENTRY_LABELS,
  ENGINE_ENTRY_LABEL_COLORS,
  getEntryLabelText,
  getNoLabelText,
} from './engine/entryLabels'
import {
  ensureReportExists,
  fetchReportBySessionId,
  type ReportRecord,
} from './lib/cloudReports'
import type { Database } from './lib/supabase/types'
import { getSupabaseInitError, supabase as client, supabaseEnvDiag } from './lib/supabase/client'
import { saveSessionToCloud } from './lib/cloudSessions'
import {
  clearGuestMode,
  clearGuestSessions,
  enableGuestMode,
  isGuestMode,
  readGuestSessions,
} from './lib/guest'
import { DIAGNOSTICS_STORAGE_KEY, isAdminUser } from './lib/diagnostics'
import { ReportPage } from './report/ReportPage'
import type { ReportSnapshot } from './report/exportCsv'

type StepId = 1 | 2 | 3 | 4
type SpaceSlot = 'supersystem' | 'subsystem'
type TimeSlot = 'past' | 'now' | 'future'

type Scenario = {
  id: string
  spaceId: number
  timeId: number
  spaceDefs: {
    subsystem: string
    system: string
    supersystem: string
  }
  timeDefs: {
    past: string
    now: string
    future: string
  }
}

type Idea = {
  id: string
  text: string
  source: 'user' | 'llm'
}

type OptionItem = {
  id: number
  label: string
  kind: 'world' | 'element'
}

type TimeOptionItem = {
  id: number
  label: string
}

type LabelItem = {
  id: string
  text: string
  color: string
}


type Language = 'English' | 'Polish'

type LlmUsageModel = 'gpt-4.1-mini' | 'gpt-5-nano' | 'gpt-5-mini'
type LlmUsageTokens = { input?: number; output?: number; total?: number }
type LlmUsageMeta = {
  modelUsed?: string | null
  aiSupportEnabled?: boolean
  tokens?: LlmUsageTokens
  source?: 'llm' | 'fallback'
  errorCategory?: string | null
}

type ModelPricing = { input: number; output: number }
type ModelUsage = { inputTokens: number; outputTokens: number; totalUSD: number }
type EngineUsage = { perModel: Record<string, ModelUsage>; totalUSD: number; totalTokens: number }

type FacilitationType = 'NEXT' | 'DEEPEN' | 'PERSPECTIVE' | 'RESET'
type FacilitationPrompt = { type: FacilitationType; text: string }
type AiQuestion = {
  id?: string
  text?: string
  grounded_in?: string[]
  why_this_question?: string
  group_code?: string
  mode_code?: number
}

type SuggestLabelType = 'ai' | 'fallback'

const normalizeSuggestResponse = (payload: {
  ok?: boolean
  question?: string | AiQuestion | null
  data?: { question?: string | AiQuestion | null; questions?: AiQuestion[] }
  meta?: LlmUsageMeta
  source?: string | null
}) => {
  const questions = Array.isArray(payload?.data?.questions) ? payload.data.questions : []
  const primaryCandidate =
    (questions[0] as AiQuestion | undefined) ??
    (payload?.question as AiQuestion | string | null) ??
    (payload?.data?.question as AiQuestion | string | null)
  const mergeMetaCandidate =
    (payload?.question as AiQuestion | null) ??
    (payload?.data?.question as AiQuestion | null) ??
    null
  let questionObj: AiQuestion | null = null
  if (typeof primaryCandidate === 'string') {
    const text = primaryCandidate.trim()
    questionObj = text ? { text } : null
  } else if (primaryCandidate && typeof primaryCandidate === 'object') {
    const text = typeof primaryCandidate.text === 'string' ? primaryCandidate.text.trim() : ''
    if (text) {
      const merged = mergeMetaCandidate && typeof mergeMetaCandidate === 'object'
        ? { ...primaryCandidate, ...mergeMetaCandidate, text }
        : { ...primaryCandidate, text }
      questionObj = merged
    }
  }
  const questionText = questionObj?.text ?? null
  const sourceFromMeta = payload?.meta?.source ?? payload?.source ?? null
  const tokenInput = Number(payload?.meta?.tokens?.input ?? 0)
  const tokenOutput = Number(payload?.meta?.tokens?.output ?? 0)
  const labelType: SuggestLabelType =
    sourceFromMeta === 'fallback'
      ? 'fallback'
      : tokenInput || tokenOutput
        ? 'ai'
        : 'fallback'
  return {
    questionText,
    questionObj,
    labelType,
    questions,
  }
}

const WORD_LIMIT = 40
const SHORT_ENTRY_WORDS = 12
const DEFAULT_IDLE_THRESHOLD_MS = 15000
const ERASE_EMPTY_SECONDS_STRONG = 10
const MAX_AUTO_CLASSIFY = 25
const UI_LANGUAGE_STORAGE_KEY = 'ui-language'
const LLM_TOKENS_TOTAL_KEY = 'llm_tokens_total'
const ENGINE_USAGE_KEY = 'engine_usage_v1'
const ENGINE_FX_KEY = 'engine_fx_usdpln_v1'
const AUTH_LOGIN_ORIGIN_KEY = 'auth-login-origin'
const AUTH_LOGIN_REDIRECT_KEY = 'auth-login-redirect'
const AUTH_OAUTH_ORIGIN_KEY = 'auth_oauth_origin'
const AUTH_FLOW_IN_PROGRESS_KEY = 'mmi_auth_flow_in_progress'
const POST_AUTH_NEXT_KEY = 'post-auth-next'
const POST_AUTH_LANG_KEY = 'post-auth-lang'
const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const FX_FALLBACK_RATE = 3.55
const MODEL_PRICING_USD: Record<string, ModelPricing> = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
}

const getOAuthRedirectTo = () => {
  if (typeof window === 'undefined') return ''
  const storedOrigin =
    window.localStorage.getItem(AUTH_OAUTH_ORIGIN_KEY) ||
    window.localStorage.getItem(AUTH_LOGIN_ORIGIN_KEY)
  const origin = storedOrigin || window.location.origin
  return `${origin}/auth/callback`
}
const MISSING_SUPABASE_ENV_MESSAGE =
  'Auth disabled in this environment (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'
const CANONICAL_URL =
  import.meta.env.VITE_CANONICAL_URL || 'https://www.makemyidea.work'
const CANONICAL_HOST = (() => {
  try {
    return new URL(CANONICAL_URL).host
  } catch {
    return CANONICAL_URL.replace(/^https?:\/\//, '')
  }
})()
const CANONICAL_DISPLAY_HOST = CANONICAL_HOST.replace(/^www\./, '')

const toMatrixRowKey = (groupCode?: string | null) => {
  const group = String(groupCode || '').toUpperCase()
  if (group === 'A') return 'world'
  if (group === 'B') return 'product'
  if (group === 'C') return 'elements'
  return null
}

const toMatrixColKey = (modeCode?: number | null) => {
  if (modeCode === 1) return 'as_is'
  if (modeCode === 2) return 'not_working'
  if (modeCode === 3) return 'should_be'
  return null
}

const getEntryCellId = (item: EngineBoardItem) => {
  const row = String(item.matrix_row || '').toLowerCase()
  const col = String(item.matrix_col || '').toLowerCase()
  const group = row === 'world' ? 'A' : row === 'product' ? 'B' : row === 'elements' ? 'C' : null
  const mode = col === 'as_is' ? '1' : col === 'not_working' ? '2' : col === 'should_be' ? '3' : null
  return group && mode ? `${group}${mode}` : null
}

const cellCodeToMatrix = (cellCode: string) => {
  const code = String(cellCode || '').trim().toUpperCase()
  if (!/^[ABC][123]$/.test(code)) return null
  const group = code[0]
  const mode = Number(code[1])
  return {
    matrix_row: toMatrixRowKey(group) ?? null,
    matrix_col: toMatrixColKey(mode) ?? null,
  }
}

const createEmptyUsage = (): EngineUsage => ({
  perModel: {},
  totalUSD: 0,
  totalTokens: 0,
})

const loadEngineUsage = (): EngineUsage => {
  if (typeof window === 'undefined') return createEmptyUsage()
  try {
    const raw = window.sessionStorage.getItem(ENGINE_USAGE_KEY)
    if (!raw) return createEmptyUsage()
    const parsed = JSON.parse(raw) as EngineUsage
    if (!parsed || typeof parsed !== 'object') return createEmptyUsage()
    return {
      perModel: parsed.perModel ?? {},
      totalUSD: Number(parsed.totalUSD ?? 0),
      totalTokens: Number(parsed.totalTokens ?? 0),
    }
  } catch {
    return createEmptyUsage()
  }
}

const saveEngineUsage = (usage: EngineUsage) => {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(ENGINE_USAGE_KEY, JSON.stringify(usage))
}

const loadFxCache = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(ENGINE_FX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { rate: number; updatedAt: number } | null
    if (!parsed || !Number.isFinite(parsed.rate) || !Number.isFinite(parsed.updatedAt)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

type Translations = {
  stepLabel: string
  appTitle: string
  landingHeroTitle: string
  landingHeroSubtitle: string
  landingIntroTitleLines: [string, string, string]
  landingIntroSubtextLines: [string, string, string, string]
  landingIntroSubtextEmphasis: string
  landingCta: string
  landingThreeStepsCta: string
  landingThreeStepsTitle: string
  landingBeforeLead: string
  landingBeforeList: string[]
  landingBeforeEmphasis: { strong: string; medium: string; rest: string }
  landingAfterLead: string
  landingAfterList: string[]
  landingWhyLead: string
  landingWhyLines: string[]
  landingWhoTitle: string
  landingWhoList: string[]
  landingFinalLines: [string, string]
  workInProgressLink: string
  impulseButtonLabel: string
  impulseTitle: string
  impulseEmpty: string
  impulseClose: string
  report: string
  llmSettings: string
  languageLabel: string
  engine: {
  saveSession: string
  newSession: string
    saveSuccess: string
    saveRequiresAuth: string
    saveMissingSession: string
    saveFailed: string
  }
  auth: {
    logout: string
    logoutFailed: string
    loginStartFailed: string
  }
  authCallback: {
    invalidLink: string
    missingCode: string
    signInFailed: string
    backToApp: string
    redirectHint: string
    tryAgain: string
    tryAgainCta: string
    oauthOriginMismatch: string
    pkceMismatch: string
    pkceMissing: string
    expired: string
    redirectMismatch: string
    unknownError: string
    returnToLogin: string
    sendLinkAgain: string
    goHome: string
  }
  loginTitle: string
  loginSubtitle: string
  loginContinue: string
  loginGoogleLabel: string
  loginGoogleCta: string
  loginGoogleLoading: string
  loginEmailLabel: string
  loginEmailPlaceholder: string
  loginEmailCta: string
  loginEmailSending: string
  loginGuestLabel: string
  loginGuestCta: string
  loginGuestActive: string
  loginNoticeSent: string
  loginEmailError: string
  loginCallbackTitle: string
  loginGuestMergePrompt: string
  loginGuestMergeYes: string
  loginGuestMergeNo: string
  loginGuestMergeLoading: string
  steps: Record<StepId, string>
  step1Intro: string
  productDescriptionLabel: string
  productDescriptionPlaceholder: string
  productDescriptionDoneLabel: string
  productNameSuggestionsLabel: string
  productNameLabel: string
  productNamePlaceholder: string
  step1SpacesTitle: string
  step1TimeframesTitle: string
  step1DragHint: string
  step1DropHere: string
  step1SystemLabel: string
  step1SystemLocked: string
  spaceListTitle: string
  spaceListHint: string
  timeListTitle: string
  timeListHint: string
  finalSpacesList: string
  finalTimesList: string
  noSelectionYet: string
  warningMax5: string
  scenarioIntro: string
  chooseScenario: string
  spaceLabel: string
  timeLabel: string
  axisSpaceLabel: string
  axisTimeLabel: string
  axisSubsystem: string
  axisSystem: string
  axisSupersystem: string
  axisPast: string
  axisNow: string
  axisFuture: string
  workshopIntro: string
  legendQuestion: string
  legendIdea: string
  showIdeaLabel: string
  supportiveQuestionTooltip: string
  addIdeaTooltip: string
  editIdeaTooltip: string
  ideaPlaceholder: string
  wordCount: (count: number) => string
  cancel: string
  saveIdea: string
  ideaGenerator: string
  labelEditorLabel: string
  keepOnlyMyIdeasLabel: string
  confirmRemoveIdeasTitle: string
  confirmRemoveIdeasMessage: string
  confirmYes: string
  confirmNo: string
  nextStepPrefix: string
  previousStepPrefix: string
  previousStepNone: string
  nextStepCompleted: string
  finalReportIntro: string
  reportLanguageLabel: string
  reportLanguageHint: string
  enginePreviewOpenReport: string
  productLabel: string
  spacesLabel: string
  timeFramesLabel: string
  totalScenariosLabel: string
  chosenScenarioLabel: string
  spaceDefinitionsLabel: string
  timeDefinitionsLabel: string
  totalIdeasLabel: string
  cellsWithIdeasLabel: string
  ideasGeneratedLabel: string
  ideasUserLabel: string
  noIdeasLabel: string
  confirmProductLabel: string
  selectedLanguageLabel: string
  notSet: string
  notSelected: string
  noScenarioConfirmed: string
  enginePreviewTitle: string
  enginePreviewLandingLink: string
  enginePreviewLink: string
  enginePreviewSessionTitle: string
  enginePreviewSessionIdLabel: string
  enginePreviewSessionEmpty: string
  enginePreviewCreateSession: string
  enginePreviewReset: string
  enginePreviewCreateReport: string
  enginePreviewBoardItemsTitle: string
  engineEntryLabelHint: string
  feedbackButtonLabel: string
  feedbackTitle: string
  feedbackMessageLabel: string
  feedbackMessagePlaceholder: string
  feedbackSend: string
  feedbackSent: string
  feedbackPrivacyNote: string
  feedbackReminderText: string
  feedbackReminderSend: string
  feedbackReminderDismiss: string
  missingLabelModalTitle: string
  missingLabelModalBody: (count: number) => string
  missingLabelPrimary: string
  missingLabelSecondary: string
  missingLabelHint: string
  missingLabelBadge: string
  missingLabelComplete: string
  engineHelpButtonLabel: string
  enginePreviewBoardItemPlaceholder: string
  enginePreviewAddItem: string
  enginePreviewBoardItemsEmpty: string
  enginePreviewNextQuestionTitle: string
  enginePreviewSuggestQuestion: string
  enginePreviewQuestionEmpty: string
  enginePreviewNextAction: string
  enginePreviewSwapAction: string
  enginePreviewSimplifyAction: string
  enginePreviewDeepenAction: string
  enginePreviewAnswerPlaceholder: string
  enginePreviewSubmitAnswer: string
  enginePreviewNoMoreQuestions: string
  enginePreviewBackToApp: string
  enginePreviewMetaGroup: string
  enginePreviewMetaMode: string
  enginePreviewMetaCategory: string
  enginePreviewMetaDifficulty: string
  engineMatrixToggleLabel: string
  engineMatrixTitle: string
  engineSessionsToggle: string
  engineSessionsToggleOpen: string
  engineSessionsToggleClose: string
  engineSessionsTitle: string
  engineSessionsRefresh: string
  engineSessionsExport: string
  engineSessionsImport: string
  engineSessionsEmpty: string
  engineSessionsOpen: string
  engineSessionsDelete: string
  engineSessionsDeleting: string
  engineSessionDetailsTitle: string
  engineSessionDetailsIdLabel: string
  engineSessionDetailsNameLabel: string
  engineSessionDetailsUpdatedLabel: string
  engineSessionDetailsQuestionsLabel: string
  engineSessionDetailsBoardTitle: string
  engineSessionDetailsBoardEmpty: string
  engineFacilitationNote: string
  engineFacilitationNext: string
  engineFacilitationDeepen: string
  engineFacilitationPerspective: string
  engineFacilitationLoadingLabel: string
  engineFacilitationRetryMessage: string
  engineFacilitationRetryCta: string
  engineFacilitationLoadingPerspective: string
  engineFacilitationLoadingDeepen: string
  engineNamePrompt: string
  engineNameLabel: string
  engineNamePlaceholder: string
  engineNameSave: string
  engineWordCountRemaining: (count: number) => string
  engineQuestionsWipNote: string
  enginePlaceholderInitial: string
  enginePlaceholderContinue: string
  engineWordLimitReached: string
  openReportPanel: string
  reportSnapshotTitle: string
  reportTitle: string
  reportPrint: string
  reportDownloadPdf: string
  reportExportCsv: string
  reportCoverTitle: string
  reportTocTitle: string
  reportSessionGoalTitle: string
  reportExecutiveSummaryTitle: string
  reportPerspectiveMapTitle: string
  reportCollectedResponsesTitle: string
  reportQuestionsTableTitle: string
  reportIdeasTableTitle: string
  reportResponsesTableTitle: string
  reportInsightsTitle: string
  reportRecommendationsTitle: string
  reportAppendicesTitle: string
  reportNotProvided: string
  reportNoData: string
  reportSessionMetaTitle: string
  reportExportLinksTitle: string
  reportAuthorLabel: string
  reportParticipantsLabel: string
  reportDateRangeLabel: string
  reportSessionNameLabel: string
  reportQuestionsLabel: string
  reportIdeasLabel: string
  reportCellsVisitedLabel: string
  reportDuplicatesLabel: string
  reportKeywordsTitle: string
  reportPerspectiveVisited: string
  reportPerspectiveQuestions: string
  reportQuestionIdLabel: string
  reportQuestionTextLabel: string
  reportQuestionSourceLabel: string
  reportQuestionCellLabel: string
  reportIdeaIdLabel: string
  reportIdeaTextLabel: string
  reportIdeaTagsLabel: string
  reportIdeaCreatedLabel: string
  reportAnswerQuestionLabel: string
  reportAnswerTextLabel: string
  reportAnswerCreatedLabel: string
  reportRecommendationExpandIdeas: string
  reportRecommendationExplorePerspectives: string
  reportRecommendationDeduplicate: string
  reportRecommendationPrioritize: string
  close: string
  editIdeaTitle: string
  generatedIdeaTitle: string
  questionsTitle: string
  nextQuestionsLabel: string
  prevQuestionsLabel: string
  labelEditorTitle: string
  labelEditorSave: string
  labelEditorAdd: string
  removeLabelAriaLabel: string
  engineEntryDeleteLabel: string
  engineEntryDeleteConfirm: string
  engineEntryDeleteYes: string
  engineEntryDeleteCancel: string
  labelDropPlaceholder: string
  noLabelText: string
  save: string
  llmSettingsTitle: string
  llmSettingsIntro: string
  llmApiBaseLabel: string
  llmApiBasePlaceholder: string
  llmSettingsSave: string
  llmSettingsSaved: string
  llmSettingsCostNote: string
  llmStatusOnline: string
  llmStatusOffline: string
  llmStatusUnknown: string
  llmTestConnection: string
  llmEnableConnection: string
  llmDisableConnection: string
  aiSupportOn: string
  aiSupportOff: string
  diagnosticsOn: string
  diagnosticsOff: string
  questionTemplates: (productName: string, spaceDef: string, timeDef: string) => string[]
  questionTemplate: (spaceDef: string, timeDef: string) => string
  llmIdeaTemplate: (spaceDef: string, timeDef: string) => string
  subsystemFallback: string
  subsystemTemplate: (productName: string) => string
  timeDefs: {
    past: (timeFrame: string) => string
    now: (timeFrame: string) => string
    future: (timeFrame: string) => string
  }
  analyzedProduct: string
  leadSpaceSuggestions: (productName: string) => string[]
  leadTimeSuggestions: (productName: string) => string[]
  spaceSuggestions: string[]
  timeSuggestions: string[]
  cellLabel: (spaceLabel: string, timeLabel: string) => string
}

const translations: Partial<Record<Language, Partial<Translations>>> & { Polish: Translations } = {
  English: {
    stepLabel: 'Step',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: 'Turn idea chaos into a clear product.',
    landingHeroSubtitle: 'No moderator. No sticky notes. No wasted time.',
    landingIntroTitleLines: [
      CANONICAL_DISPLAY_HOST,
      'guides you step by step',
      'through product definition.',
    ],
    landingIntroSubtextLines: [
      'Online or on-site.',
      'Solo or with a team.',
      'AI support (if you want), but...',
      'always led by {emphasis}.',
    ],
    landingIntroSubtextEmphasis: 'you',
    landingCta: '▶ Start for free',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 steps',
    landingBeforeLead: 'If any of this sounds familiar — you are in the right place.',
    landingBeforeList: ['❌ Chaos', '❌ Lost notes', '❌ No decisions'],
    landingBeforeEmphasis: {
      strong: '',
      medium: '',
      rest: '',
    },
    landingAfterLead: 'Now the process works for you.',
    landingAfterList: ['✅ Process', '✅ Structured questions', '✅ Report'],
    landingWhyLead: 'We don’t replace thinking. We remove friction.',
    landingWhyLines: [
      CANONICAL_DISPLAY_HOST,
      'structures the conversation',
      'keeps the process logical',
      'organizes knowledge in real time',
      'leaves people what matters most: decisions and creativity',
      'AI helps. Humans decide.',
    ],
    landingWhoTitle: 'Who is it for?',
    landingWhoList: [
      '🚀 You have an idea, but can’t define it well',
      '🛠️ You are a dev / PM and want real analysis, not brainstorming for sport',
      '🤝 You work with a distributed or hybrid team',
      '⏱️ You want results now, not after three workshops',
    ],
    landingFinalLines: ['You don’t need a perfect idea.', 'You need a solid process.'],
    workInProgressLink: 'Work in progress',
    impulseButtonLabel: 'Give me an impulse',
    impulseTitle: 'Suggested question',
    impulseEmpty: 'No question available yet.',
    impulseClose: 'Close',
    report: 'Report',
    llmSettings: 'LLM settings',
    languageLabel: 'Language',
    engine: {
    saveSession: 'Save session',
    newSession: 'New session',
      saveSuccess: 'Saved',
      saveRequiresAuth: 'Log in to save sessions.',
      saveMissingSession: 'Start a session before saving.',
      saveFailed: 'Save failed.',
    },
    auth: {
      logout: 'Log out',
      logoutFailed: 'Log out failed.',
      loginStartFailed: 'Unable to start login. Please try again.',
    },
    authCallback: {
      invalidLink: 'Invalid or expired login link. Please request a new one.',
      missingCode: 'Sign-in failed. Please try again.',
      signInFailed: 'Sign-in did not complete. Please try again.',
      backToApp: 'Back to app',
      redirectHint:
        'Check Supabase Auth Redirect URLs + Google OAuth origins/redirect.',
      tryAgain: 'Try again.',
      tryAgainCta: 'Try again',
      oauthOriginMismatch:
        'Please complete sign-in on the same address (localhost vs 127.0.0.1).',
      pkceMismatch:
        'This login link was opened on a different site or browser. Please open it in the same browser and device where you started login.',
      pkceMissing: 'Invalid or expired login link. Please request a new one.',
      expired: 'This login link has expired. Please request a new one.',
      redirectMismatch: 'Login link redirect mismatch. Please request a new link.',
      unknownError: 'Unable to sign you in. Please try again.',
      returnToLogin: 'Return to login',
      sendLinkAgain: 'Send login link again',
      goHome: 'Go to homepage',
    },
    loginTitle: 'Login',
    loginSubtitle: 'Sign in to continue.',
    loginContinue: 'Continue',
    loginGoogleLabel: 'Google',
    loginGoogleCta: 'Continue with Google',
    loginGoogleLoading: 'Connecting...',
    loginEmailLabel: 'Email',
    loginEmailPlaceholder: 'you@company.com',
    loginEmailCta: 'Email me a login link',
    loginEmailSending: 'Sending...',
    loginGuestLabel: 'Guest',
    loginGuestCta: 'Try as guest',
    loginGuestActive: 'In guest mode — data is stored locally.',
    loginNoticeSent: 'Check your email for the login link.',
    loginEmailError: 'Enter a valid email.',
    loginCallbackTitle: 'Signing you in...',
    loginGuestMergePrompt: 'We found work from your guest session. Import it?',
    loginGuestMergeYes: 'Yes, import',
    loginGuestMergeNo: 'No, discard',
    loginGuestMergeLoading: 'Importing...',
    steps: {
      1: 'Tell us about your new product',
      2: 'Idea Clarity Grid scenario confirmation',
      3: 'Idea Clarity Grid workshop',
      4: 'Final report',
    },
  step1Intro: 'Define the product, spaces, and observation / thinking levels for the analysis.',
  productDescriptionLabel: 'Describe your new product/service',
  productDescriptionPlaceholder:
    'Who is it for, which age group, which market, what materials, main function, etc.',
  productDescriptionDoneLabel: 'Done',
    productNameSuggestionsLabel:
      'Name suggestions based on your description (drag a name into the product name field)',
  productNameLabel: 'Name your new product',
  productNamePlaceholder: 'e.g., modular battery pack',
    step1SpacesTitle: 'Where do we look?',
    step1TimeframesTitle: 'Observation / thinking level',
  step1DragHint: 'Drag options to the target fields below',
  step1DropHere: 'Drop here...',
    step1SystemLabel: 'Product',
  step1SystemLocked: 'Locked',
  spaceListTitle: 'Place / space list',
  spaceListHint: 'Select up to 5.',
    timeListTitle: 'Observation / thinking level list',
    timeListHint: 'Select up to 5.',
    finalSpacesList: 'Final spaces list',
    finalTimesList: 'Final observation / thinking level list',
  noSelectionYet: 'No selection yet.',
    warningMax5: 'Please keep space and time selections to 5 or fewer.',
    scenarioIntro:
      'Scenarios are generated for each space and time frame pairing. Select one and refine the axis definitions below.',
    chooseScenario: 'Choose this scenario',
    spaceLabel: 'Where do we look?',
    timeLabel: 'Observation / thinking level',
    axisSpaceLabel: 'Where do we look?',
    axisTimeLabel: 'Observation / thinking level',
    axisSubsystem: 'Elements',
    axisSystem: 'Product',
    axisSupersystem: 'World',
    axisPast: 'How is it?',
    axisNow: "What doesn't work?",
    axisFuture: 'How should it be',
    workshopIntro:
      'Use the question icon to prompt thinking. Use the idea icon to add your own post-it.',
    legendQuestion: 'Supportive question',
    legendIdea: 'New idea',
    showIdeaLabel: 'Show idea',
    supportiveQuestionTooltip: 'Supportive question',
    addIdeaTooltip: 'Add idea',
    editIdeaTooltip: 'Click to edit',
    ideaPlaceholder: 'Type your idea (max 50 words)',
    wordCount: (count) => `Remaining ${Math.max(0, 50 - count)} words`,
    cancel: 'Cancel',
    saveIdea: 'Save',
    ideaGenerator: 'Give me some ideas',
    labelEditorLabel: 'Label editor',
    keepOnlyMyIdeasLabel: 'Keep only my ideas',
    confirmRemoveIdeasTitle: 'Are you sure?',
    confirmRemoveIdeasMessage: 'This will remove all AI-generated ideas.',
    confirmYes: 'YES',
    confirmNo: 'NO',
    nextStepPrefix: 'Next step: ',
    previousStepPrefix: 'Previous step: ',
    previousStepNone: 'Previous step: none',
    nextStepCompleted: 'Next step: completed',
    finalReportIntro: 'Summary of the workshop data gathered so far.',
    reportLanguageLabel: 'Report language',
    reportLanguageHint:
      'Language selection will be used for report translation in a later version.',
    enginePreviewOpenReport: 'Open report',
    productLabel: 'Product',
    spacesLabel: 'Where do we look?',
    timeFramesLabel: 'Observation / thinking level',
    totalScenariosLabel: 'Total scenarios',
    chosenScenarioLabel: 'Chosen scenario',
    spaceDefinitionsLabel: 'Space definitions',
    timeDefinitionsLabel: 'Time definitions',
    totalIdeasLabel: 'Total ideas',
    cellsWithIdeasLabel: 'Cells with ideas',
    ideasGeneratedLabel: 'AI generated ideas',
    ideasUserLabel: 'User ideas',
    noIdeasLabel: 'No ideas yet.',
    confirmProductLabel: 'Confirm product name',
    selectedLanguageLabel: 'Selected language',
    notSet: 'Not set',
    notSelected: 'Not selected',
    noScenarioConfirmed: 'No scenario confirmed yet.',
    enginePreviewTitle: 'Question engine preview',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: 'Engine preview',
    enginePreviewSessionTitle: 'Session',
    enginePreviewSessionIdLabel: 'Session ID',
    enginePreviewSessionEmpty: 'Not created yet',
    enginePreviewCreateSession: 'Create session',
    enginePreviewReset: 'Save and close session',
    enginePreviewCreateReport: 'Create report',
    enginePreviewBoardItemsTitle: 'Board',
    engineEntryLabelHint: 'Click to add or change label',
    feedbackButtonLabel: 'Feedback',
    feedbackTitle: 'Feedback',
    feedbackMessageLabel: 'Your feedback',
    feedbackMessagePlaceholder: 'Tell us what worked, what was hard, what to improve…',
    feedbackSend: 'Send feedback by email',
    feedbackSent: 'Thanks! Your feedback has been sent.',
    feedbackPrivacyNote: 'Do not include sensitive data.',
    feedbackReminderText:
      'If you have a moment, please send feedback from this session — it really helps us improve.',
    feedbackReminderSend: 'Send feedback via email',
    feedbackReminderDismiss: 'Dismiss',
    missingLabelModalTitle: 'Some notes are missing labels',
    missingLabelModalBody: (count) =>
      `You have ${count} note(s) without a label (idea/risk/question, etc.). Add labels now? It will make your report clearer.`,
    missingLabelPrimary: "Yes, I’ll label them now",
    missingLabelSecondary: 'No, go to report',
    missingLabelHint: 'Click the label dropdown and choose a category.',
    missingLabelBadge: 'Missing label',
    missingLabelComplete: 'All set — you can go to the report.',
    engineHelpButtonLabel: 'Show helper actions',
    enginePreviewBoardItemPlaceholder: 'Describe a board item...',
    enginePreviewAddItem: 'Add item',
    enginePreviewBoardItemsEmpty: 'No board items yet.',
    enginePreviewNextQuestionTitle: 'Next question',
    enginePreviewSuggestQuestion: 'Next question',
    enginePreviewQuestionEmpty: 'No question yet.',
    enginePreviewNextAction: 'Next question',
    enginePreviewSwapAction: 'Swap',
    enginePreviewSimplifyAction: 'Simplify',
    enginePreviewDeepenAction: 'Deepen',
    enginePreviewAnswerPlaceholder: 'Type your answer...',
    enginePreviewSubmitAnswer: 'Submit answer',
    enginePreviewNoMoreQuestions: 'Step complete / no more questions.',
    enginePreviewBackToApp: 'Back to app',
    enginePreviewMetaGroup: 'Group',
    enginePreviewMetaMode: 'Mode',
    enginePreviewMetaCategory: 'Category',
    enginePreviewMetaDifficulty: 'Difficulty',
    engineMatrixToggleLabel: 'Diagnostic matrix',
    engineMatrixTitle: 'Matrix',
    engineSessionsToggle: 'Sessions',
    engineSessionsToggleOpen: 'Open session list',
    engineSessionsToggleClose: 'Close session list',
    engineSessionsTitle: 'Sessions',
    engineSessionsRefresh: 'Refresh',
    engineSessionsExport: 'Export sessions',
    engineSessionsImport: 'Import sessions',
    engineSessionsEmpty: 'No saved sessions.',
    engineSessionsOpen: 'Open session',
    engineSessionsDelete: 'Delete session',
    engineSessionsDeleting: 'Deleting...',
    engineSessionDetailsTitle: 'Session details',
    engineSessionDetailsIdLabel: 'ID',
    engineSessionDetailsNameLabel: 'Name',
    engineSessionDetailsUpdatedLabel: 'Last activity',
    engineSessionDetailsQuestionsLabel: 'Questions',
    engineSessionDetailsBoardTitle: 'Idea board',
    engineSessionDetailsBoardEmpty: 'No items.',
    engineFacilitationNote: 'If you want, I can help you look at this from another angle.',
    engineFacilitationNext: 'Next question',
    engineFacilitationDeepen: 'Deepen',
    engineFacilitationPerspective: 'Change perspective',
    engineFacilitationLoadingLabel: 'Generating question…',
    engineFacilitationRetryMessage: 'Couldn’t generate the question. Please retry.',
    engineFacilitationRetryCta: 'Retry',
    engineFacilitationLoadingPerspective: 'Choosing a perspective for your board',
    engineFacilitationLoadingDeepen: 'Choosing a question for your board',
    engineNamePrompt: 'Give this session a name so it’s easier to return to.',
    engineNameLabel: 'Session name',
    engineNamePlaceholder: 'Session name',
    engineNameSave: 'Save and continue',
    engineWordCountRemaining: (count) => `Remaining ${count} words`,
    engineQuestionsWipNote: '',
    enginePlaceholderInitial:
      'What do you know about your product, or what you don’t know yet — start however you like.',
    enginePlaceholderContinue:
      'Continue — you can clarify, add something new, or change the thread.',
    engineWordLimitReached: 'Word limit reached.',
    openReportPanel: 'Open report panel',
    reportSnapshotTitle: 'Workshop report snapshot',
    reportTitle: 'Session report',
    reportPrint: 'Print',
    reportDownloadPdf: 'Download PDF',
    reportExportCsv: 'Export data (CSV)',
    reportCoverTitle: 'Cover',
    reportTocTitle: 'Table of contents',
    reportSessionGoalTitle: 'Session goal',
    reportExecutiveSummaryTitle: 'Executive summary',
    reportPerspectiveMapTitle: 'Perspective / questions map',
    reportCollectedResponsesTitle: 'Collected responses',
    reportQuestionsTableTitle: 'Questions',
    reportIdeasTableTitle: 'Ideas',
    reportResponsesTableTitle: 'Responses',
    reportInsightsTitle: 'Insights & patterns',
    reportRecommendationsTitle: 'Recommendations / next steps',
    reportAppendicesTitle: 'Appendices',
    reportNotProvided: 'Not provided',
    reportNoData: 'No data available.',
    reportSessionMetaTitle: 'Session metadata',
    reportExportLinksTitle: 'Export links',
    reportAuthorLabel: 'Author',
    reportParticipantsLabel: 'Participants',
    reportDateRangeLabel: 'Date',
    reportSessionNameLabel: 'Session name',
    reportQuestionsLabel: 'Questions',
    reportIdeasLabel: 'Ideas',
    reportCellsVisitedLabel: 'Cells visited',
    reportDuplicatesLabel: 'Duplicates',
    reportKeywordsTitle: 'Top themes',
    reportPerspectiveVisited: 'Visited',
    reportPerspectiveQuestions: 'Questions',
    reportQuestionIdLabel: 'ID',
    reportQuestionTextLabel: 'Question',
    reportQuestionSourceLabel: 'Source',
    reportQuestionCellLabel: 'Cell',
    reportIdeaIdLabel: 'ID',
    reportIdeaTextLabel: 'Idea',
    reportIdeaTagsLabel: 'Tags',
    reportIdeaCreatedLabel: 'Created',
    reportAnswerQuestionLabel: 'Question',
    reportAnswerTextLabel: 'Answer',
    reportAnswerCreatedLabel: 'Created',
    reportRecommendationExpandIdeas: 'Expand ideas before moving to evaluation.',
    reportRecommendationExplorePerspectives: 'Explore additional perspectives in the 3×3 map.',
    reportRecommendationDeduplicate: 'Deduplicate similar ideas to reduce noise.',
    reportRecommendationPrioritize: 'Prioritize the strongest ideas and define next actions.',
    close: 'Close',
    editIdeaTitle: 'Edit idea',
    generatedIdeaTitle: 'Generated idea',
    questionsTitle: 'Supportive questions',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Label editor',
    labelEditorSave: 'Save',
    labelEditorAdd: 'Add label',
    removeLabelAriaLabel: 'Remove label',
    engineEntryDeleteLabel: 'Delete item',
    engineEntryDeleteConfirm: 'Delete this item?',
    engineEntryDeleteYes: 'Yes',
    engineEntryDeleteCancel: 'Cancel',
    labelDropPlaceholder: 'Place your label',
    noLabelText: 'No label',
    save: 'Save',
    llmSettingsTitle: 'OpenAI server settings',
    llmSettingsIntro:
      'Connect your server to OpenAI by setting OPENAI_API_KEY and provide the API base URL.',
    llmApiBaseLabel: 'API base URL',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Save',
    llmSettingsSaved: 'Saved.',
    llmSettingsCostNote:
      'Using your API key will bill usage to your OpenAI account per their pricing.',
    llmStatusOnline: 'Server status: online',
    llmStatusOffline: 'Server status: offline',
    llmStatusUnknown: 'Server status: unknown',
    llmTestConnection: 'Test connection',
    llmEnableConnection: 'Enable OpenAI',
    llmDisableConnection: 'Disable OpenAI',
    aiSupportOn: 'AI support ON',
    aiSupportOff: 'AI support OFF',
    diagnosticsOn: 'Diagnostics ON',
    diagnosticsOff: 'Diagnostics OFF',
    questionTemplate: (spaceDef, timeDef) =>
      `How could "${spaceDef}" respond to "${timeDef}" and reveal a new opportunity?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Which unmet user need around "${productName}" appears in "${spaceDef}" during "${timeDef}"?`,
      `What new user behavior or trend could reshape "${productName}" in "${spaceDef}" for "${timeDef}"?`,
      `Which standards, regulations, or safety expectations are emerging for "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `What state-of-the-art tech or materials could improve "${productName}" for "${spaceDef}" in "${timeDef}"?`,
      `Where is the biggest performance bottleneck for "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `What is the best price vs performance trade-off for "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `Which features would users pay more for in "${spaceDef}" during "${timeDef}"—and which are non‑negotiable?`,
      `How could service, software, or data layers enhance "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `How should "${productName}" connect with other products in "${spaceDef}" during "${timeDef}" and what user benefit would that unlock?`,
      `What competitive alternative could beat "${productName}" on price or performance in "${spaceDef}" during "${timeDef}"?`,
      `What durability, maintenance, or lifecycle expectations should "${productName}" meet in "${spaceDef}" for "${timeDef}"?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Consider how ${spaceDef} connects with ${timeDef} to unlock customer, designer, and system insights.`,
    subsystemFallback: 'Key components: structure, power source, control layer',
    subsystemTemplate: (productName) =>
      `Key components: ${productName} housing, core module, interface layer`,
    timeDefs: {
      past: (timeFrame) => `Earlier stage of ${timeFrame}`,
      now: (timeFrame) => `Current state of ${timeFrame}`,
      future: (timeFrame) => `Next evolution of ${timeFrame}`,
    },
    analyzedProduct: 'Analyzed product',
    leadSpaceSuggestions: (productName) => [
      `Integration of ${productName} in a user ecosystem`,
      `Where ${productName} is installed`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} early manufacturing`,
      `${productName} core assembly`,
    ],
    spaceSuggestions: [
      'Home environment',
      'Vehicle cabin',
      'Industrial line',
      'Outdoor use',
      'Cold storage',
      'High heat exposure',
      'Wet environment',
      'Healthcare setting',
      'Retail display',
      'Warehousing',
      'Office workspace',
      'Public infrastructure',
      'Marine environment',
      'Aerospace cabin',
      'Construction site',
      'Smart city grid',
      'Agriculture field',
      'Data center',
      'Classroom',
      'Sports facility',
    ],
    timeSuggestions: [
      'Supplier production process',
      'In-house assembly',
      'Quality inspection',
      'Final testing',
      'Packaging process',
      'Distribution handling',
      'Customer usage phase',
      'Maintenance cycle',
      'Repair workflow',
      'End-of-life handling',
      'Recycling process',
      'Component preparation',
      'Raw material sourcing',
      'Component fabrication',
      'Surface finishing',
      'Supplier logistics',
      'Installation & commissioning',
      'Warranty service',
      'Second-life reuse',
      'Disassembly planning',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
  Polish: {
    stepLabel: 'Krok',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: 'Zamień chaos pomysłów w klarowny produkt.',
    landingHeroSubtitle: 'Bez moderatora. Bez karteczek. Bez straty czasu.',
    landingIntroTitleLines: [
      CANONICAL_DISPLAY_HOST,
      'prowadzi Cię krok po kroku',
      'przez proces definiowania produktu.',
    ],
    landingIntroSubtextLines: [
      'On-line lub on-site.',
      'Solo lub z zespołem.',
      'Wspierane przez AI (jeżeli chcesz), ale...',
      'sterowane zawsze przez {emphasis}.',
    ],
    landingIntroSubtextEmphasis: 'Ciebie',
    landingCta: '▶ Zacznij za darmo',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 kroki',
    landingBeforeLead: 'Jeśli choć jedno brzmi znajomo — jesteś w dobrym miejscu.',
    landingBeforeList: ['❌ Chaos', '❌ Zgubione notatki', '❌ Brak decyzji'],
    landingBeforeEmphasis: {
      strong: '',
      medium: '',
      rest: '',
    },
    landingAfterLead: 'Teraz proces pracuje dla Ciebie.',
    landingAfterList: ['✅ Proces', '✅ Ustrukturyzowane pytania', '✅ Raport'],
    landingWhyLead: 'Nie zastępujemy myślenia. Usuwamy tarcie.',
    landingWhyLines: [
      CANONICAL_DISPLAY_HOST,
      'strukturyzuje rozmowę',
      'pilnuje logiki procesu',
      'porządkuje wiedzę w czasie rzeczywistym',
      'zostawia ludziom to, co najważniejsze: decyzje i kreatywność',
      'AI pomaga. Człowiek decyduje.',
    ],
    landingWhoTitle: 'Dla kogo?',
    landingWhoList: [
      '🚀 Masz pomysł, ale nie wiesz jak go dobrze zdefiniować',
      '🛠️ Jesteś devem / PM-em i chcesz sensownej analizy, nie burzy mózgów „dla sportu”',
      '🤝 Pracujesz z zespołem rozproszonym lub hybrydowym',
      '⏱️ Chcesz efektów teraz, a nie po 3 warsztatach',
    ],
    landingFinalLines: ['Nie potrzebujesz idealnego pomysłu.', 'Potrzebujesz dobrego procesu.'],
    workInProgressLink: 'Work in progress',
    impulseButtonLabel: 'Daj mi impuls',
    impulseTitle: 'Sugerowane pytanie',
    impulseEmpty: 'Brak pytania na ten moment.',
    impulseClose: 'Zamknij',
    report: 'Raport',
    llmSettings: 'Ustawienia LLM',
    languageLabel: 'Język',
    engine: {
    saveSession: 'Zapisz sesję',
    newSession: 'Nowa sesja',
      saveSuccess: 'Zapisano',
      saveRequiresAuth: 'Zaloguj się, aby zapisać sesje.',
      saveMissingSession: 'Rozpocznij sesję przed zapisem.',
      saveFailed: 'Nie udało się zapisać.',
    },
    auth: {
      logout: 'Wyloguj się',
      logoutFailed: 'Nie udało się wylogować.',
      loginStartFailed: 'Nie udało się rozpocząć logowania. Spróbuj ponownie.',
    },
    authCallback: {
      invalidLink: 'Nieprawidłowy lub wygasły link logowania. Wyślij nowy link.',
      missingCode: 'Logowanie nie powiodło się. Spróbuj ponownie.',
      signInFailed: 'Logowanie nie zakończyło się. Spróbuj ponownie.',
      backToApp: 'Wróć do aplikacji',
      redirectHint:
        'Sprawdź Supabase Auth Redirect URLs + Google OAuth origins/redirect.',
      tryAgain: 'Spróbuj ponownie.',
      tryAgainCta: 'Spróbuj ponownie',
      oauthOriginMismatch:
        'Dokończ logowanie na tym samym adresie (localhost vs 127.0.0.1).',
      pkceMismatch:
        'Ten link został otwarty w innej przeglądarce lub na innej stronie. Otwórz go w tej samej przeglądarce i na tym samym urządzeniu, na którym rozpocząłeś logowanie.',
      pkceMissing: 'Nieprawidłowy lub wygasły link logowania. Wyślij nowy link.',
      expired: 'Ten link logowania wygasł. Wyślij nowy link.',
      redirectMismatch: 'Niezgodny adres przekierowania. Wyślij nowy link.',
      unknownError: 'Nie udało się zalogować. Spróbuj ponownie.',
      returnToLogin: 'Wróć do logowania',
      sendLinkAgain: 'Wyślij link ponownie',
      goHome: 'Przejdź na stronę główną',
    },
    loginTitle: 'Logowanie',
    loginSubtitle: 'Zaloguj się, aby kontynuować.',
    loginContinue: 'Kontynuuj',
    loginGoogleLabel: 'Google',
    loginGoogleCta: 'Kontynuuj z Google',
    loginGoogleLoading: 'Łączenie...',
    loginEmailLabel: 'E-mail',
    loginEmailPlaceholder: 'you@company.com',
    loginEmailCta: 'Wyślij link do logowania',
    loginEmailSending: 'Wysyłanie...',
    loginGuestLabel: 'Gość',
    loginGuestCta: 'Wypróbuj jako gość',
    loginGuestActive: 'W trybie gościa — dane są zapisywane lokalnie.',
    loginNoticeSent: 'Sprawdź e-mail — wysłaliśmy link do logowania.',
    loginEmailError: 'Wpisz poprawny adres e-mail.',
    loginCallbackTitle: 'Logowanie...',
    loginGuestMergePrompt: 'Znaleźliśmy pracę z sesji gościa. Zaimportować?',
    loginGuestMergeYes: 'Tak, importuj',
    loginGuestMergeNo: 'Nie, odrzuć',
    loginGuestMergeLoading: 'Importowanie...',
    steps: {
      1: 'Opowiedz o swoim nowym produkcie',
      2: 'Potwierdzenie scenariusza Idea Clarity Grid',
      3: 'Warsztat Idea Clarity Grid',
      4: 'Raport końcowy',
    },
  step1Intro: 'Zdefiniuj produkt, przestrzenie oraz poziomy obserwacji / myślenia.',
  productDescriptionLabel: 'Opisz swój nowy produkt',
  productDescriptionPlaceholder:
    'Dla kogo, jaka grupa wiekowa, jaki rynek, z czego zrobiony, główna funkcja itd.',
  productDescriptionDoneLabel: 'Gotowe',
    productNameSuggestionsLabel:
      'Propozycje nazw na podstawie opisu (przeciągnij nazwę do pola nazwy produktu)',
  productNameLabel: 'Nazwij swój nowy produkt',
  productNamePlaceholder: 'np. modułowy pakiet baterii',
    step1SpacesTitle: 'Gdzie patrzymy?',
    step1TimeframesTitle: 'Poziom obserwacji / myślenia',
  step1DragHint: 'Przeciągnij opcje do pól docelowych poniżej',
  step1DropHere: 'Upuść tutaj...',
    step1SystemLabel: 'Produkt',
  step1SystemLocked: 'Zablokowane',
  spaceListTitle: 'Lista miejsc / przestrzeni',
  spaceListHint: 'Wybierz maksymalnie 5.',
  timeListTitle: 'Lista poziomów obserwacji / myślenia',
  timeListHint: 'Wybierz maksymalnie 5.',
  finalSpacesList: 'Końcowa lista przestrzeni',
  finalTimesList: 'Końcowa lista poziomów obserwacji / myślenia',
  noSelectionYet: 'Brak wyboru.',
  warningMax5:
    'Wybierz maksymalnie 5 pozycji dla przestrzeni i poziomów obserwacji / myślenia.',
    scenarioIntro:
      'Scenariusze są generowane dla każdej pary przestrzeń–czas. Wybierz jeden i doprecyzuj definicje osi.',
    chooseScenario: 'Wybierz ten scenariusz',
    spaceLabel: 'Gdzie patrzymy?',
    timeLabel: 'Poziom obserwacji / myślenia',
    axisSpaceLabel: 'Gdzie patrzymy?',
    axisTimeLabel: 'Poziom obserwacji / myślenia',
    axisSubsystem: 'Elementy',
    axisSystem: 'Produkt',
    axisSupersystem: 'Świat',
    axisPast: 'Jak jest?',
    axisNow: 'Co nie działa?',
    axisFuture: 'Jak powinno być',
    workshopIntro:
      'Użyj ikony pytania, aby uzyskać podpowiedź. Użyj ikony pomysłu, aby dodać własną karteczkę.',
    legendQuestion: 'Pytanie wspierające',
    legendIdea: 'Nowy pomysł',
    showIdeaLabel: 'Pokaż pomysł',
    supportiveQuestionTooltip: 'Pytanie wspierające',
    addIdeaTooltip: 'Wstaw pomysł',
    editIdeaTooltip: 'Kliknij, aby edytować',
    ideaPlaceholder: 'Wpisz pomysł (maks. 50 słów)',
    wordCount: (count) => `Pozostało ${Math.max(0, 50 - count)} słów`,
    cancel: 'Anuluj',
    saveIdea: 'Zapisz',
    ideaGenerator: 'Daj pomysły',
    labelEditorLabel: 'Edytor etykiet',
    keepOnlyMyIdeasLabel: 'Zostaw tylko moje pomysły',
    confirmRemoveIdeasTitle: 'Czy na pewno?',
    confirmRemoveIdeasMessage: 'To usunie wszystkie pomysły wygenerowane przez AI.',
    confirmYes: 'TAK',
    confirmNo: 'NIE',
    nextStepPrefix: 'Następny krok: ',
    previousStepPrefix: 'Poprzedni krok: ',
    previousStepNone: 'Poprzedni krok: brak',
    nextStepCompleted: 'Następny krok: zakończono',
    finalReportIntro: 'Podsumowanie danych zebranych podczas warsztatu.',
    reportLanguageLabel: 'Język raportu',
    reportLanguageHint:
      'Wybór języka będzie użyty do tłumaczenia raportu w późniejszej wersji.',
    enginePreviewOpenReport: 'Przejdź do raportu',
    productLabel: 'Produkt',
    spacesLabel: 'Gdzie patrzymy?',
    timeFramesLabel: 'Poziom obserwacji / myślenia',
    totalScenariosLabel: 'Liczba scenariuszy',
    chosenScenarioLabel: 'Wybrany scenariusz',
    spaceDefinitionsLabel: 'Definicje przestrzeni',
    timeDefinitionsLabel: 'Definicje czasu',
    totalIdeasLabel: 'Liczba pomysłów',
    cellsWithIdeasLabel: 'Pola z pomysłami',
    ideasGeneratedLabel: 'Pomysły wygenerowane przez AI',
    ideasUserLabel: 'Pomysły użytkownika',
    noIdeasLabel: 'Brak pomysłów.',
    confirmProductLabel: 'Zatwierdź nazwę produktu',
    selectedLanguageLabel: 'Wybrany język',
    notSet: 'Nie ustawiono',
    notSelected: 'Nie wybrano',
    noScenarioConfirmed: 'Brak potwierdzonego scenariusza.',
    openReportPanel: 'Otwórz panel raportu',
    reportSnapshotTitle: 'Podgląd raportu z warsztatu',
    reportTitle: 'Raport z sesji',
    reportPrint: 'Drukuj',
    reportDownloadPdf: 'Pobierz PDF',
    reportExportCsv: 'Eksport danych (CSV)',
    reportCoverTitle: 'Okładka',
    reportTocTitle: 'Spis treści',
    reportSessionGoalTitle: 'Cel sesji',
    reportExecutiveSummaryTitle: 'Streszczenie wykonawcze',
    reportPerspectiveMapTitle: 'Mapa perspektyw / pytań',
    reportCollectedResponsesTitle: 'Zebrane odpowiedzi',
    reportQuestionsTableTitle: 'Pytania',
    reportIdeasTableTitle: 'Pomysły',
    reportResponsesTableTitle: 'Odpowiedzi',
    reportInsightsTitle: 'Wnioski i wzorce',
    reportRecommendationsTitle: 'Rekomendacje / następne kroki',
    reportAppendicesTitle: 'Aneksy',
    reportNotProvided: 'Nie podano',
    reportNoData: 'Brak danych.',
    reportSessionMetaTitle: 'Metadane sesji',
    reportExportLinksTitle: 'Eksport',
    reportAuthorLabel: 'Autor',
    reportParticipantsLabel: 'Uczestnicy',
    reportDateRangeLabel: 'Data',
    reportSessionNameLabel: 'Nazwa sesji',
    reportQuestionsLabel: 'Pytania',
    reportIdeasLabel: 'Pomysły',
    reportCellsVisitedLabel: 'Odwiedzone komórki',
    reportDuplicatesLabel: 'Duplikaty',
    reportKeywordsTitle: 'Najczęstsze motywy',
    reportPerspectiveVisited: 'Odwiedzone',
    reportPerspectiveQuestions: 'Pytania',
    reportQuestionIdLabel: 'ID',
    reportQuestionTextLabel: 'Pytanie',
    reportQuestionSourceLabel: 'Źródło',
    reportQuestionCellLabel: 'Komórka',
    reportIdeaIdLabel: 'ID',
    reportIdeaTextLabel: 'Pomysł',
    reportIdeaTagsLabel: 'Tagi',
    reportIdeaCreatedLabel: 'Utworzono',
    reportAnswerQuestionLabel: 'Pytanie',
    reportAnswerTextLabel: 'Odpowiedź',
    reportAnswerCreatedLabel: 'Utworzono',
    reportRecommendationExpandIdeas: 'Rozwiń listę pomysłów przed oceną.',
    reportRecommendationExplorePerspectives: 'Sprawdź dodatkowe perspektywy w siatce 3×3.',
    reportRecommendationDeduplicate: 'Usuń duplikaty, aby zmniejszyć szum.',
    reportRecommendationPrioritize: 'Nadaj priorytety najlepszym pomysłom i ustal kolejne kroki.',
    close: 'Zamknij',
    editIdeaTitle: 'Edytuj pomysł',
    generatedIdeaTitle: 'Wygenerowany pomysł',
    questionsTitle: 'Pytania naprowadzające',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Edytor etykiet',
    labelEditorSave: 'Zapisz',
    labelEditorAdd: 'Dodaj etykietę',
    removeLabelAriaLabel: 'Usuń etykietę',
    engineEntryDeleteLabel: 'Usuń wpis',
    engineEntryDeleteConfirm: 'Usunąć ten wpis?',
    engineEntryDeleteYes: 'Tak',
    engineEntryDeleteCancel: 'Cofnij',
    labelDropPlaceholder: 'Upuść etykietę',
    noLabelText: 'Brak etykiety',
    save: 'Zapisz',
    enginePreviewTitle: 'Podgląd silnika pytań',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: 'Podgląd silnika',
    enginePreviewSessionTitle: 'Sesja',
    enginePreviewSessionIdLabel: 'ID sesji',
    enginePreviewSessionEmpty: 'Jeszcze nie utworzono',
    enginePreviewCreateSession: 'Utwórz sesję',
    enginePreviewReset: 'Zapisz i zamknij sesję',
    enginePreviewCreateReport: 'Utwórz raport',
    enginePreviewBoardItemsTitle: 'Tablica',
    engineEntryLabelHint: 'Kliknij żeby dodać lub zmienić etykietę',
    feedbackButtonLabel: 'Feedback',
    feedbackTitle: 'Feedback',
    feedbackMessageLabel: 'Twoja wiadomość / feedback',
    feedbackMessagePlaceholder: 'Napisz, co działało, co było trudne, co poprawić…',
    feedbackSend: 'Wyślij feedback emailem',
    feedbackSent: 'Dzięki! Feedback został wysłany.',
    feedbackPrivacyNote: 'Nie dodawaj danych wrażliwych.',
    feedbackReminderText:
      'Jeśli masz chwilę, wyślij nam feedback z tej sesji — bardzo pomoże w dalszym rozwoju.',
    feedbackReminderSend: 'Wyślij feedback e-mailem',
    feedbackReminderDismiss: 'Pomiń',
    missingLabelModalTitle: 'Brakuje etykiet dla części wpisów',
    missingLabelModalBody: (count) =>
      `Na tablicy masz ${count} wpis(ów) bez etykiety (np. pomysł/ryzyko/pytanie). Chcesz uzupełnić etykiety teraz? Dzięki temu raport będzie bardziej czytelny.`,
    missingLabelPrimary: 'Tak, uzupełnię teraz',
    missingLabelSecondary: 'Nie, przejdź do raportu',
    missingLabelHint: 'Kliknij dropdown etykiety i wybierz kategorię.',
    missingLabelBadge: 'Brak etykiety',
    missingLabelComplete: 'Gotowe — możesz przejść do raportu.',
    engineHelpButtonLabel: 'Pokaż działania pomocnicze',
    enginePreviewBoardItemPlaceholder: 'Opisz element tablicy...',
    enginePreviewAddItem: 'Dodaj',
    enginePreviewBoardItemsEmpty: 'Brak elementów.',
    enginePreviewNextQuestionTitle: 'Następne pytanie',
    enginePreviewSuggestQuestion: 'Następne pytanie',
    enginePreviewQuestionEmpty: 'Brak pytania.',
    enginePreviewNextAction: 'Następne pytanie',
    enginePreviewSwapAction: 'Zamień',
    enginePreviewSimplifyAction: 'Uprość',
    enginePreviewDeepenAction: 'Pogłęb',
    enginePreviewAnswerPlaceholder: 'Wpisz odpowiedź...',
    enginePreviewSubmitAnswer: 'Zapisz odpowiedź',
    enginePreviewNoMoreQuestions: 'Koniec kroku / brak dalszych pytań.',
    enginePreviewBackToApp: 'Wróć do aplikacji',
    enginePreviewMetaGroup: 'Grupa',
    enginePreviewMetaMode: 'Tryb',
    enginePreviewMetaCategory: 'Kategoria',
    enginePreviewMetaDifficulty: 'Trudność',
    engineMatrixToggleLabel: 'Matryca diagnostyczna',
    engineMatrixTitle: 'Matryca',
    engineSessionsToggle: 'Lista sesji',
    engineSessionsToggleOpen: 'Otwórz listę sesji',
    engineSessionsToggleClose: 'Zamknij listę sesji',
    engineSessionsTitle: 'Sesje',
    engineSessionsRefresh: 'Odśwież',
    engineSessionsExport: 'Eksportuj sesje',
    engineSessionsImport: 'Importuj sesje',
    engineSessionsEmpty: 'Brak zapisanych sesji.',
    engineSessionsOpen: 'Otwórz sesję',
    engineSessionsDelete: 'Usuń sesję',
    engineSessionsDeleting: 'Usuwanie...',
    engineSessionDetailsTitle: 'Szczegóły sesji',
    engineSessionDetailsIdLabel: 'ID',
    engineSessionDetailsNameLabel: 'Nazwa',
    engineSessionDetailsUpdatedLabel: 'Ostatnia aktywność',
    engineSessionDetailsQuestionsLabel: 'Zapytania',
    engineSessionDetailsBoardTitle: 'Tablica opisująca twój pomysł',
    engineSessionDetailsBoardEmpty: 'Brak elementów.',
    engineFacilitationNote: 'Jeśli chcesz, mogę pomóc spojrzeć na to z innej strony.',
    engineFacilitationNext: 'Następne pytanie',
    engineFacilitationDeepen: 'Pogłęb',
    engineFacilitationPerspective: 'Zmień perspektywę',
    engineFacilitationLoadingLabel: 'Generuję pytanie…',
    engineFacilitationRetryMessage: 'Nie udało się wygenerować pytania. Spróbuj ponownie.',
    engineFacilitationRetryCta: 'Spróbuj ponownie',
    engineFacilitationLoadingPerspective: 'Dobieram perspektywę do Twojej tablicy',
    engineFacilitationLoadingDeepen: 'Dobieram pytanie do Twojej tablicy',
    engineNamePrompt: 'Nadaj nazwę tej sesji, żeby łatwiej do niej wrócić.',
    engineNameLabel: 'Nazwa sesji',
    engineNamePlaceholder: 'Nazwa sesji',
    engineNameSave: 'Zapisz i kontynuuj',
    engineWordCountRemaining: (count) => `Pozostało ${count} słów`,
    engineQuestionsWipNote: '',
    engineWordLimitReached: 'Osiągnięto limit słów.',
    enginePlaceholderInitial:
      'Co wiesz o swoim produkcie albo czego nie wiesz — zacznij tak, jak wolisz.',
    enginePlaceholderContinue:
      'Kontynuuj — możesz doprecyzować, dodać coś nowego albo zmienić wątek.',
    llmSettingsTitle: 'Ustawienia serwera OpenAI',
    llmSettingsIntro:
      'Połącz swój serwer z OpenAI (OPENAI_API_KEY) i podaj adres API.',
    llmApiBaseLabel: 'Adres API',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Zapisz',
    llmSettingsSaved: 'Zapisano.',
    llmSettingsCostNote:
      'Użycie klucza API obciąża Twoje konto OpenAI zgodnie z ich cennikiem.',
    llmStatusOnline: 'Status serwera: online',
    llmStatusOffline: 'Status serwera: offline',
    llmStatusUnknown: 'Status serwera: nieznany',
    llmTestConnection: 'Testuj połączenie',
    llmEnableConnection: 'Włącz OpenAI',
    llmDisableConnection: 'Wyłącz OpenAI',
    aiSupportOn: 'AI support ON',
    aiSupportOff: 'AI support OFF',
    diagnosticsOn: 'Diagnostyka ON',
    diagnosticsOff: 'Diagnostyka OFF',
    questionTemplate: (spaceDef, timeDef) =>
      `Jak "${spaceDef}" może odpowiedzieć na "${timeDef}" i ujawnić nową szansę?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Jaki konkretny problem "${productName}" rozwiązuje w "${spaceDef}" podczas "${timeDef}" – i dla kogo?`,
      `Kim jest pierwszy realny klient "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jak klient radzi sobie dziś z tym problemem w "${spaceDef}" podczas "${timeDef}"?`,
      `Dlaczego rozwiązanie "${productName}" jest lepsze lub inne w "${spaceDef}" podczas "${timeDef}"?`,
      `Jaką wartość mierzalną daje "${productName}" w "${spaceDef}" podczas "${timeDef}" (czas, koszty, ryzyko, komfort)?`,
      `Co musi się wydarzyć, żeby klient powiedział „biorę” dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jak wygląda pierwsza wersja (MVP) "${productName}" dla "${spaceDef}" podczas "${timeDef}"?`,
      `Jak planujesz dotrzeć do klientów "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie są największe ryzyka "${productName}" w "${spaceDef}" podczas "${timeDef}" (techniczne, rynkowe, regulacyjne, kosztowe)?`,
      `Po czym poznasz sukces lub potrzebę zatrzymania "${productName}" w "${spaceDef}" podczas "${timeDef}" (KPI 6–12 mies.)?`,
      `Jakie nowe potrzeby użytkownika pojawiają się dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Które funkcje "${productName}" w "${spaceDef}" podczas "${timeDef}" są kluczowe, a które zbędne?`,
      `Jakie standardy, normy lub certyfikacje mogą być wymagane dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie trendy, mody lub zmiany stylu życia wpływają na "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jaki jest oczekiwany poziom jakości i niezawodności "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie kompromisy price vs performance są akceptowalne dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Czy użytkownik jest skłonny zapłacić więcej za lepszą wydajność "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie argumenty cenowe przekonają klienta do "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie nowe materiały lub technologie mogą poprawić "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie ograniczenia energetyczne wpływają na "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Czy "${productName}" powinien komunikować się z innymi produktami w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie korzyści dla użytkownika daje integracja "${productName}" z innymi produktami w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie dane z "${productName}" w "${spaceDef}" podczas "${timeDef}" byłyby wartościowe dla użytkownika?`,
      `Jakie bariery wdrożenia lub integracji "${productName}" istnieją w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie konkurencyjne rozwiązania dominują w "${spaceDef}" podczas "${timeDef}" i czym się wyróżniają?`,
      `Jakie ryzyka prawne lub regulacyjne mogą wpłynąć na "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie wymagania dotyczące bezpieczeństwa użytkownika są krytyczne dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie wymagania dotyczące serwisu i utrzymania powinien spełnić "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jak długo użytkownik oczekuje bezawaryjnej pracy "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie elementy "${productName}" mogą być zoptymalizowane kosztowo bez utraty wartości w "${spaceDef}" podczas "${timeDef}"?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Rozważ, jak ${spaceDef} łączy się z ${timeDef}, aby odkryć perspektywy klienta, projektanta i systemu.`,
    subsystemFallback: 'Kluczowe komponenty: struktura, źródło zasilania, warstwa sterowania',
    subsystemTemplate: (productName) =>
      `Kluczowe komponenty: obudowa ${productName}, moduł główny, warstwa interfejsu`,
    timeDefs: {
      past: (timeFrame) => `Wcześniejszy etap: ${timeFrame}`,
      now: (timeFrame) => `Aktualny stan: ${timeFrame}`,
      future: (timeFrame) => `Następna ewolucja: ${timeFrame}`,
    },
    analyzedProduct: 'Analizowany produkt',
    leadSpaceSuggestions: (productName) => [
      `Integracja ${productName} w ekosystemie użytkownika`,
      `Gdzie ${productName} jest instalowany`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} – wczesna produkcja`,
      `${productName} – montaż główny`,
    ],
    spaceSuggestions: [
      'Środowisko domowe',
      'Kabina pojazdu',
      'Linia przemysłowa',
      'Użytkowanie na zewnątrz',
      'Chłodnia',
      'Wysoka temperatura',
      'Wilgotne środowisko',
      'Środowisko medyczne',
      'Ekspozycja w sklepie',
      'Magazyn',
      'Biuro',
      'Infrastruktura publiczna',
      'Środowisko morskie',
      'Kabina lotnicza',
      'Plac budowy',
      'Sieć smart city',
      'Pole uprawne',
      'Centrum danych',
      'Sala lekcyjna',
      'Obiekt sportowy',
    ],
    timeSuggestions: [
      'Proces produkcyjny u dostawcy',
      'Montaż wewnętrzny',
      'Kontrola jakości',
      'Test końcowy',
      'Proces pakowania',
      'Obsługa dystrybucji',
      'Faza użytkowania',
      'Cykl konserwacji',
      'Proces naprawy',
      'Zakończenie życia produktu',
      'Proces recyklingu',
      'Przygotowanie komponentów',
      'Pozyskanie surowców',
      'Wytwarzanie komponentów',
      'Wykończenie powierzchni',
      'Logistyka dostawców',
      'Instalacja i uruchomienie',
      'Serwis gwarancyjny',
      'Drugie życie produktu',
      'Planowanie demontażu',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
}

const polishTranslations: Translations = translations.Polish
const languageFallbacks: Partial<Record<Language, Language>> = {}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const withFallback = <T extends Record<string, unknown>>(base: T, override?: Partial<T>): T => {
  if (!override) return base
  const result: T = { ...base }
  ;(Object.keys(override) as (keyof T)[]).forEach((key) => {
    const overrideValue = override[key]
    if (overrideValue === undefined) return
    const baseValue = base[key]
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = withFallback(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>
      ) as T[keyof T]
    } else {
      result[key] = overrideValue as T[keyof T]
    }
  })
  return result
}

const getTranslations = (language: Language): Translations => {
  const fallbackLanguage = languageFallbacks[language]
  const fallbackTranslations = fallbackLanguage ? translations[fallbackLanguage] : undefined
  const mergedFallback = withFallback(polishTranslations, fallbackTranslations)
  return withFallback(mergedFallback, translations[language])
}

const stepOrder: StepId[] = [1, 2, 3, 4]
const DEFAULT_LLM_API_BASE =
  typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? ''
    : 'http://localhost:8787'
const SPACE_KIND_FOR_SLOT: Record<SpaceSlot, OptionItem['kind']> = {
  supersystem: 'world',
  subsystem: 'element',
}

const elementSuggestionFallbacks: Record<Language, string[]> = {
  English: [
    'Housing',
    'Core module',
    'Interface layer',
    'Fasteners',
    'Surface finish',
    'Electronics',
    'Packaging',
    'Power unit',
    'Sensors',
    'Materials',
  ],
  Polish: [
    'Obudowa',
    'Moduł główny',
    'Warstwa interfejsu',
    'Mocowania',
    'Wykończenie',
    'Elektronika',
    'Opakowanie',
    'Zasilanie',
    'Czujniki',
    'Materiały',
  ],
}

const spaceSections = ['subsystem', 'system', 'supersystem'] as const
const timeSections = ['past', 'now', 'future'] as const

const buildWorldSuggestions = (productName: string, copy: Translations) => {
  if (!productName.trim()) return copy.spaceSuggestions
  const lead = copy.leadSpaceSuggestions(productName)
  return uniqueList([...lead, ...copy.spaceSuggestions]).slice(0, 20)
}

const buildElementSuggestions = (productName: string, copy: Translations, language: Language) => {
  const base = elementSuggestionFallbacks[language] || elementSuggestionFallbacks.English
  const template = productName
    ? copy.subsystemTemplate(productName).split(':').slice(1).join(':')
    : copy.subsystemFallback.split(':').slice(1).join(':')
  const derived = template
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return uniqueList([...derived, ...base]).slice(0, 20)
}

const buildTimeSuggestions = (productName: string, copy: Translations) => {
  if (!productName.trim()) return copy.timeSuggestions
  const lead = copy.leadTimeSuggestions(productName)
  return uniqueList([...lead, ...copy.timeSuggestions]).slice(0, 20)
}

const uniqueList = (items: string[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const looksEnglish = (items: string[]) => {
  const markers = [
    'home',
    'vehicle',
    'industrial',
    'outdoor',
    'supplier',
    'assembly',
    'quality',
    'testing',
    'packaging',
    'distribution',
    'maintenance',
    'repair',
    'recycling',
    'office',
    'public',
    'process',
    'final',
  ]
  return items.some((item) => {
    const lower = item.toLowerCase()
    return markers.some((marker) => lower.includes(marker))
  })
}

const looksPolish = (items: string[]) => {
  const markers = [
    'dom',
    'środowisko',
    'montaż',
    'produkcj',
    'użytkownik',
    'proces',
    'jakości',
    'kontrola',
    'dostaw',
    'podsystem',
    'element',
    'pojazd',
    'kabina',
    'linia',
  ]
  return items.some((item) => {
    const lower = item.toLowerCase()
    return markers.some((marker) => lower.includes(marker))
  })
}

const buildNameSuggestions = (description: string, fallback: string) => {
  const cleaned = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter((word) => word.length > 3)
  const primary = words[0] || fallback || 'Nova'
  const secondary = words[1] || 'Core'
  const picks = uniqueList([
    `${capitalize(primary)} ${capitalize(secondary)}`,
    `${capitalize(primary)} One`,
    `${capitalize(primary)} Flow`,
    `${capitalize(primary)} Studio`,
    `${capitalize(primary)} Pro`,
    `${capitalize(primary)} Hub`,
    `${capitalize(primary)} Link`,
  ])
  return picks.slice(0, 5)
}

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value

const IconReport = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M15 2v6h6M8 12h8M8 16h8M8 20h5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

const IconIdea = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M9 19h6M10 22h4M8 10a4 4 0 1 1 8 0c0 1.7-1 2.6-2 3.4-.6.5-1 1.1-1 2.1h-2c0-1-.4-1.6-1-2.1-1-.8-2-1.7-2-3.4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

const IconSearch = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle
      cx="11"
      cy="11"
      r="7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M16.5 16.5L21 21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

const IconWorld = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M3 12h18M12 3a12 12 0 0 1 0 18M12 3a12 12 0 0 0 0 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

const IconElement = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 8l8-4 8 4-8 4-8-4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M4 8v8l8 4 8-4V8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M12 12v8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

function DebugMatrixPage({ llmApiBase }: { llmApiBase: string }) {
  const params =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const sessionId = params ? params.get('sessionId') : null
  const debugEnabled =
    (params?.get('debug') === '1') || import.meta.env.VITE_DEBUG_UI === 'true'

  const [matrixData, setMatrixData] = useState(null as null | {
    matrix: Record<
      string,
      Record<string, { id: string; short_text: string; entry_type: string; promptType: string | null; created_at: number }[]>
    >
    coverage: { filledCells: number; totalCells: number }
    timeline: { id: string; short_text: string; created_at: number; matrix_row: string; matrix_col: string }[]
  })
  const [matrixError, setMatrixError] = useState<string | null>(null)
  const [matrixLoading, setMatrixLoading] = useState(false)

  useEffect(() => {
    if (!debugEnabled || !sessionId) return
    let timer: number | undefined
    const fetchMatrix = async () => {
      setMatrixLoading(true)
      setMatrixError(null)
      try {
        const response = await fetch(
          `${llmApiBase}/api/debug/matrix?sessionId=${sessionId}&debug=1`
        )
        if (!response.ok) {
          const msg = await response.text()
          throw new Error(msg || 'Request failed')
        }
        const data = await response.json()
        setMatrixData(data)
      } catch {
        setMatrixError('Unable to load matrix data.')
      } finally {
        setMatrixLoading(false)
      }
    }
    void fetchMatrix()
    timer = window.setInterval(fetchMatrix, 5000)
    return () => {
      if (timer) window.clearInterval(timer)
    }
  }, [debugEnabled, sessionId, llmApiBase])

  if (!debugEnabled) {
    return <div className="debug-matrix">Not available.</div>
  }

  if (!sessionId) {
    return <div className="debug-matrix">Missing sessionId.</div>
  }

  const rows = ['WORLD', 'PRODUCT', 'ELEMENTS']
  const cols = ['AS_IS', 'NOT_WORKING', 'SHOULD_BE']
  const recent = matrixData?.timeline?.[0]
  const formatMatrixLabel = (row: string, col: string) => {
    const rowLabel =
      row === 'WORLD' ? 'Świat / Środowisko' : row === 'PRODUCT' ? 'Produkt' : 'Elementy'
    const colLabel =
      col === 'AS_IS'
        ? 'Jak jest?'
        : col === 'NOT_WORKING'
          ? 'Co nie działa?'
          : 'Jak powinno być?'
    const cell = `${row === 'WORLD' ? 'A' : row === 'PRODUCT' ? 'B' : 'C'}${
      col === 'AS_IS' ? '1' : col === 'NOT_WORKING' ? '2' : '3'
    }`
    return `${cell} – ${rowLabel} / ${colLabel}`
  }

  const recentKey = recent ? `${recent.matrix_row}-${recent.matrix_col}` : null
  const rowLabel = (row: string) =>
    row === 'WORLD' ? 'Świat / Środowisko' : row === 'PRODUCT' ? 'Produkt' : 'Elementy'
  const colLabel = (col: string) =>
    col === 'AS_IS' ? 'Jak jest?' : col === 'NOT_WORKING' ? 'Co nie działa?' : 'Jak powinno być?'

  return (
    <div className="debug-matrix">
      <header>
        <h1>Debug Matrix</h1>
        <div className="debug-meta">
          <span>Session: {sessionId}</span>
          {matrixData && (
            <span>
              Pokrycie analizy: {matrixData.coverage.filledCells} /{' '}
              {matrixData.coverage.totalCells}
            </span>
          )}
        </div>
      </header>
      {matrixError && <div className="engine-error">{matrixError}</div>}
      {matrixLoading && <div className="engine-empty">Loading…</div>}
      {matrixData && (
        <div className="debug-grid">
          <div className="debug-corner" />
          {cols.map((col) => (
            <div key={col} className="debug-col-label">
              {colLabel(col)}
            </div>
          ))}
          {rows.map((row) => (
            <>
              <div key={`${row}-label`} className="debug-row-label">
                {rowLabel(row)}
              </div>
              {cols.map((col) => {
                const answers = matrixData.matrix[row][col] || []
                const isRecent = recentKey === `${row}-${col}`
                return (
                  <div key={`${row}-${col}`} className={`debug-cell ${isRecent ? 'recent' : ''}`}>
                    <div className="debug-count">{answers.length} wpisów</div>
                    <ul>
                      {answers.map((answer) => (
                        <li key={`${answer.id}-${answer.created_at}`}>{answer.short_text}</li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </>
          ))}
        </div>
      )}
      {matrixData && (
        <section className="debug-timeline">
          <h2>Ostatnie wpisy</h2>
          <ul>
            {matrixData.timeline.map((entry) => (
              <li key={`${entry.id}-${entry.created_at}`}>
                <span className="debug-pill">
                  {formatMatrixLabel(entry.matrix_row, entry.matrix_col)}
                </span>
                <span>{entry.short_text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function App() {
  const [activeStep, setActiveStep] = useState<StepId>(1)
  const [showLanding, setShowLanding] = useState(true)
  const [landingView, setLandingView] = useState<'main' | 'threeSteps'>('main')
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null)
  const [authCallbackLoading, setAuthCallbackLoading] = useState(false)
  const [authCallbackHint, setAuthCallbackHint] = useState<string | null>(null)
  const [devLastError, setDevLastError] = useState<string | null>(null)
  const [lastAuthEvent, setLastAuthEvent] = useState<string | null>(null)
  const [authResolved, setAuthResolved] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginSending, setLoginSending] = useState(false)
  const [loginOauthLoading, setLoginOauthLoading] = useState(false)
  const [loginCooldownSeconds, setLoginCooldownSeconds] = useState(0)
  const [loginPassword, setLoginPassword] = useState('')
  const [loginUsePassword, setLoginUsePassword] = useState(false)
  const [loginAuthMode, setLoginAuthMode] = useState<'signin' | 'signup'>('signin')
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const [guestPromptOpen, setGuestPromptOpen] = useState(false)
  const [guestMergeLoading, setGuestMergeLoading] = useState(false)
  const [productDescription, setProductDescription] = useState('')
  const [productDescriptionConfirmed, setProductDescriptionConfirmed] = useState(false)
  const [productName, setProductName] = useState('')
  const [productNameSuggestions, setProductNameSuggestions] = useState<string[]>([])
  const [productConfirmed, setProductConfirmed] = useState(false)
  const [spaceOptions, setSpaceOptions] = useState<OptionItem[]>(() => {
    const world = buildWorldSuggestions('', polishTranslations).slice(0, 10)
    const elements = buildElementSuggestions('', polishTranslations, 'Polish').slice(0, 10)
    return [
      ...world.map((label, index) => ({ id: index, label, kind: 'world' as const })),
      ...elements.map((label, index) => ({
        id: index + world.length,
        label,
        kind: 'element' as const,
      })),
    ]
  })
  const [timeOptions, setTimeOptions] = useState<TimeOptionItem[]>(
    polishTranslations.timeSuggestions.map((label, index) => ({ id: index, label }))
  )
  const [spaceAssignments, setSpaceAssignments] = useState<Record<SpaceSlot, number | null>>({
    supersystem: null,
    subsystem: null,
  })
  const [timeAssignments, setTimeAssignments] = useState<Record<TimeSlot, number | null>>({
    past: null,
    now: null,
    future: null,
  })
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null)
  const [workshopIdeas, setWorkshopIdeas] = useState<Record<string, Idea[]>>({})
  const [activeIdeaCell, setActiveIdeaCell] = useState<string | null>(null)
  const [ideaDraft, setIdeaDraft] = useState<string>('')
  const [hoveredCell, setHoveredCell] = useState<{ space: string; time: string } | null>(null)
  const [reportSnapshotOpen, setReportSnapshotOpen] = useState(false)
  const [labelEditorOpen, setLabelEditorOpen] = useState(false)
  const [ideaPreview, setIdeaPreview] = useState<Idea | null>(null)
  const [impulseQuestion, setImpulseQuestion] = useState<string | null>(null)
  const [impulseSource, setImpulseSource] = useState<'llm' | 'fallback' | null>(null)
  const [impulseOpen, setImpulseOpen] = useState(false)
  const [isSuggestLoading, setIsSuggestLoading] = useState(false)
  const [showSuggestLoadingUI, setShowSuggestLoadingUI] = useState(false)
  const [engineSessionId, setEngineSessionId] = useState<string | null>(null)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const [llmApiBase, setLlmApiBase] = useState(DEFAULT_LLM_API_BASE)
  const [aiSupportEnabled, setAiSupportEnabled] = useState(true)
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false)
  const [llmStatus, setLlmStatus] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [llmSaved, setLlmSaved] = useState(false)
  const [llmUsageModel, setLlmUsageModel] = useState<LlmUsageModel | null>(null)
  const [llmTokensTotal, setLlmTokensTotal] = useState(() => {
    if (typeof window === 'undefined') return 0
    const raw = window.localStorage.getItem(LLM_TOKENS_TOTAL_KEY)
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  })
  const [engineUsage, setEngineUsage] = useState<EngineUsage>(() => loadEngineUsage())
  const [usdPlnRate, setUsdPlnRate] = useState<number | null>(() => {
    const cached = loadFxCache()
    if (!cached) return null
    if (Date.now() - cached.updatedAt > FX_CACHE_TTL_MS) return null
    return cached.rate
  })
  const [lastLlmCallAt, setLastLlmCallAt] = useState<string | null>(null)
  const [lastLlmModel, setLastLlmModel] = useState<string | null>(null)
  const [lastLlmTokensDelta, setLastLlmTokensDelta] = useState<number | null>(null)
  const [lastLlmSource, setLastLlmSource] = useState<'llm' | 'fallback' | null>(null)
  const [lastLlmGroundedCount, setLastLlmGroundedCount] = useState<number | null>(null)
  const [lastLlmGroundedIn, setLastLlmGroundedIn] = useState<string[] | null>(null)
  const [lastLlmWhy, setLastLlmWhy] = useState<string | null>(null)
  const [llmPingResult, setLlmPingResult] = useState<{
    model?: string | null
    tokensIn?: number
    tokensOut?: number
    message?: string | null
    error?: string | null
  } | null>(null)
  const isAdmin = useMemo(() => isAdminUser(authSession), [authSession])
  const diagnosticsEnabledForUser = isAdmin && diagnosticsEnabled
  const suggestDiagEnabled =
    import.meta.env.VITE_SUGGEST_DIAG === '1' || diagnosticsEnabledForUser
  const showDiagnostics = diagnosticsEnabledForUser
  const llmHeaders = useMemo(
    () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-ai-support': aiSupportEnabled ? 'on' : 'off',
      }
      if (diagnosticsEnabledForUser) {
        headers['x-diagnostics'] = '1'
      }
      return headers
    },
    [aiSupportEnabled, diagnosticsEnabledForUser]
  )
  const resolveUsageModel = (meta?: LlmUsageMeta): LlmUsageModel | null => {
    if (!meta || meta.aiSupportEnabled === false || !meta.modelUsed) return null
    if (meta.modelUsed === 'gpt-4.1-mini') return 'gpt-4.1-mini'
    if (meta.modelUsed === 'gpt-5-nano') return 'gpt-5-nano'
    if (meta.modelUsed === 'gpt-5-mini') return 'gpt-5-mini'
    return null
  }
  const applyUsageModel = (meta?: LlmUsageMeta) => {
    if (!meta) return
    setLlmUsageModel(resolveUsageModel(meta))
  }
  const applyUsageToApp = (meta?: LlmUsageMeta) => {
    const input = Number(meta?.tokens?.input ?? 0)
    const output = Number(meta?.tokens?.output ?? 0)
    const delta = input + output
    if (!delta) {
      if (import.meta.env.DEV) {
        console.log('[ai] no usage (fallback)')
      }
      setLastLlmSource('fallback')
      return
    }
    const modelUsed = meta?.modelUsed ?? null
    if (modelUsed && MODEL_PRICING_USD[modelUsed]) {
      const pricing = MODEL_PRICING_USD[modelUsed]
      const costUSD =
        (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output
      setEngineUsage((prev) => {
        const prevModel = prev.perModel[modelUsed] || {
          inputTokens: 0,
          outputTokens: 0,
          totalUSD: 0,
        }
        const nextModel = {
          inputTokens: prevModel.inputTokens + input,
          outputTokens: prevModel.outputTokens + output,
          totalUSD: prevModel.totalUSD + costUSD,
        }
        const next: EngineUsage = {
          perModel: { ...prev.perModel, [modelUsed]: nextModel },
          totalUSD: prev.totalUSD + costUSD,
          totalTokens: prev.totalTokens + delta,
        }
        saveEngineUsage(next)
        return next
      })
    }
    setLlmTokensTotal((prev) => {
      const next = prev + delta
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LLM_TOKENS_TOTAL_KEY, String(next))
      }
      return next
    })
    setLastLlmCallAt(new Date().toISOString())
    setLastLlmTokensDelta(delta)
    setLastLlmModel(meta?.modelUsed ?? null)
    setLastLlmSource('llm')
  }
  const applyUsageToSession = async (
    meta?: LlmUsageMeta,
    sessionIdOverride?: string | null
  ) => {
    applyUsageToApp(meta)
    const input = Number(meta?.tokens?.input ?? 0)
    const output = Number(meta?.tokens?.output ?? 0)
    if (!input && !output) return
    const sessionId = sessionIdOverride ?? enginePreviewSessionId ?? null
    if (!sessionId) return
    // Token accumulation happens here so it persists with the session record.
    const detail = await getSession(sessionId)
    if (!detail?.session) return
    const nextSession = {
      ...detail.session,
      tokensInTotal: (detail.session.tokensInTotal ?? 0) + input,
      tokensOutTotal: (detail.session.tokensOutTotal ?? 0) + output,
      updated_at: Date.now(),
    }
    const updatedDetail: EngineSessionDetail = { ...detail, session: nextSession }
    await updateSession(updatedDetail)
    if (engineSessionDetail?.session?.id === sessionId) {
      setEngineSessionDetail(updatedDetail)
    }
    setEngineSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              tokensInTotal: nextSession.tokensInTotal,
              tokensOutTotal: nextSession.tokensOutTotal,
              updated_at: nextSession.updated_at,
            }
          : session
      )
    )
  }

  useEffect(() => {
    if (!aiSupportEnabled || llmStatus !== 'online') {
      setLlmUsageModel(null)
    }
  }, [aiSupportEnabled, llmStatus])
  const [ideaLabels, setIdeaLabels] = useState<LabelItem[]>([
    { id: 'label-1', text: 'Question to customer', color: '#f6b8a2' },
    { id: 'label-2', text: 'New functionality', color: '#f4d6a0' },
    { id: 'label-3', text: 'Testing', color: '#b9e3c6' },
    { id: 'label-4', text: 'Cost Saving', color: '#b7d9f4' },
  ])
  const [ideaLabelAssignments, setIdeaLabelAssignments] = useState<Record<string, string | null>>({})
  const [ideaLabelDraft, setIdeaLabelDraft] = useState<string | null>(null)
  const [postItLabelDraft, setPostItLabelDraft] = useState<string | null>(null)
  const [postItEditOriginalText, setPostItEditOriginalText] = useState('')
  const [postItEdit, setPostItEdit] = useState<Idea | null>(null)
  const [postItEditCell, setPostItEditCell] = useState<string | null>(null)
  const [reportLanguage, setReportLanguage] = useState<Language>('Polish')
  const [uiLanguage, setUiLanguage] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'Polish'
    const postAuthLang = window.sessionStorage.getItem(POST_AUTH_LANG_KEY)
    if (postAuthLang === 'English' || postAuthLang === 'Polish') return postAuthLang
    const saved = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)
    if (saved === 'English' || saved === 'Polish') return saved
    const languages = window.navigator?.languages ?? []
    const fallback = window.navigator?.language ? [window.navigator.language] : []
    const candidates = [...languages, ...fallback].filter(Boolean)
    const prefersPolish = candidates.some((lang) => lang.toLowerCase().startsWith('pl'))
    const defaultLanguage: Language = prefersPolish ? 'Polish' : 'English'
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, defaultLanguage)
    return defaultLanguage
  })
  const [postAuthLanguageApplied, setPostAuthLanguageApplied] = useState(false)
  const [enginePreviewSessionId, setEnginePreviewSessionId] = useState<string | null>(null)
  const [enginePreviewSessionName, setEnginePreviewSessionName] = useState('')
  const [engineSessionPersisted, setEngineSessionPersisted] = useState(false)
  const [engineNamePromptOpen, setEngineNamePromptOpen] = useState(false)
  const [engineNameDraft, setEngineNameDraft] = useState('')
  const [engineNameError, setEngineNameError] = useState<string | null>(null)
  const [engineNameSaving, setEngineNameSaving] = useState(false)
  const [resumeNamePromptAfterList, setResumeNamePromptAfterList] = useState(false)
  const [enginePreviewItems, setEnginePreviewItems] = useState<EngineBoardItem[]>([])
  const [enginePreviewInput, setEnginePreviewInput] = useState('')
  const [engineUiState, setEngineUiState] = useState<
    'INIT' | 'FREE_FLOW' | 'FACILITATION_OFFER' | 'FACILITATED_INPUT'
  >('INIT')
  const [engineActivePrompt, setEngineActivePrompt] = useState<FacilitationPrompt | null>(null)
  const [enginePromptSource, setEnginePromptSource] = useState<'llm' | 'fallback' | null>(null)
  const [engineFacilitationLoading, setEngineFacilitationLoading] = useState(false)
  const [engineFacilitationLoadingType, setEngineFacilitationLoadingType] =
    useState<FacilitationType | null>(null)
  const [lastFacilitationType, setLastFacilitationType] =
    useState<FacilitationType | null>(null)
  const [showEngineFacilitationLoadingUI, setShowEngineFacilitationLoadingUI] =
    useState(false)
  const [engineWeakSignals, setEngineWeakSignals] = useState(0)
  const [engineMediumSignals, setEngineMediumSignals] = useState(0)
  const [engineStrongSignals, setEngineStrongSignals] = useState(0)
  const [engineLastWeakKind, setEngineLastWeakKind] = useState<string | null>(null)
  const [engineLastMediumKind, setEngineLastMediumKind] = useState<string | null>(null)
  const [engineLastStrongKind, setEngineLastStrongKind] = useState<string | null>(null)
  const [engineOfferReason, setEngineOfferReason] = useState<string | null>(null)
  const [engineFreeEntryStreak, setEngineFreeEntryStreak] = useState(0)
  const [engineLastEntryAt, setEngineLastEntryAt] = useState<number | null>(null)
  const [engineLastEntryShort, setEngineLastEntryShort] = useState(false)
  const [engineInputFocused, setEngineInputFocused] = useState(false)
  const [engineLastInputActivityAt, setEngineLastInputActivityAt] = useState<number | null>(null)
  const engineEraseTimer = useRef<number | null>(null)
  const engineIdleTimer = useRef<number | null>(null)
  const engineNoticeTimer = useRef<number | null>(null)
  const oauthStartOnceRef = useRef(false)
  const authRedirectedRef = useRef(false)
  const initialRouteResolvedRef = useRef(false)
  const engineIdleTriggered = useRef(false)
  const enginePreviousInput = useRef('')
  const engineLatestInput = useRef('')
  const engineLatestUiState = useRef<'INIT' | 'FREE_FLOW' | 'FACILITATION_OFFER' | 'FACILITATED_INPUT'>(
    'INIT'
  )
  const engineLatestFocus = useRef(false)
  const engineCooldownUntil = useRef(0)
  const engineInteractionBySession = useRef<Record<string, boolean>>({})
  const engineLastAddAtBySession = useRef<Record<string, number>>({})
  const engineResetOnSessionChange = useRef(false)
  const [enginePreviewError, setEnginePreviewError] = useState<string | null>(null)
  const [engineSessionsOpen, setEngineSessionsOpen] = useState(false)
  const [engineSessions, setEngineSessions] = useState<EngineSessionSummary[]>([])
  const [engineSessionsLoading, setEngineSessionsLoading] = useState(false)
  const [engineSessionsError, setEngineSessionsError] = useState<string | null>(null)
  const [cloudSessionPayloads, setCloudSessionPayloads] = useState<
    Record<string, CloudSessionPayload>
  >({})
  const [reportRecords, setReportRecords] = useState<Record<string, ReportRecord | null>>({})
  const [engineNotice, setEngineNotice] = useState<{
    message: string
    variant: 'success' | 'error'
  } | null>(null)
  const [engineDeleteLoadingId, setEngineDeleteLoadingId] = useState<string | null>(null)
  const [engineSessionDetail, setEngineSessionDetail] = useState<EngineSessionDetail | null>(null)
  const [engineEditItemId, setEngineEditItemId] = useState<string | null>(null)
  const [engineEditText, setEngineEditText] = useState('')
  const [engineEditLoading, setEngineEditLoading] = useState(false)
  const [enginePreviewEditId, setEnginePreviewEditId] = useState<string | null>(null)
  const [enginePreviewEditText, setEnginePreviewEditText] = useState('')
  const [engineAssignLoading, setEngineAssignLoading] = useState(false)
  const [engineEntryDeleteId, setEngineEntryDeleteId] = useState<string | null>(null)
  const [engineApiDebug, setEngineApiDebug] = useState<{
    endpoint: string
    status: number
    response: unknown
    rawText: string
  } | null>(null)
  const [engineFacilitationDiagnostics, setEngineFacilitationDiagnostics] = useState<{
    url: string
    status: number
    contentType: string
    raw: string
    json: unknown
    parseError: string | null
  } | null>(null)
  const [engineFacilitationInlineError, setEngineFacilitationInlineError] = useState<string | null>(
    null
  )
  const [engineAskedQuestionIds, setEngineAskedQuestionIds] = useState<string[]>([])
  const [, setEngineAskedQuestionMeta] = useState<
    Record<string, { group_code?: string; mode_code?: number }>
  >({})
  const [engineAskedQuestionTexts, setEngineAskedQuestionTexts] = useState<string[]>([])
  const [engineAskedQuestionTextById, setEngineAskedQuestionTextById] = useState<
    Record<string, string>
  >({})
  const [enginePrevQuestionMeta, setEnginePrevQuestionMeta] = useState<{
    group_code?: string
    mode_code?: number
  } | null>(null)
  const [engineLastQuestionText, setEngineLastQuestionText] = useState<string | null>(null)
  const [engineRecentCells, setEngineRecentCells] = useState<string[]>([])
  const [engineLastQuestionMeta, setEngineLastQuestionMeta] = useState<{
    id: string
    group_code?: string
    mode_code?: number
  } | null>(null)
  const [missingLabelModalOpen, setMissingLabelModalOpen] = useState(false)
  const [highlightMissingLabels, setHighlightMissingLabels] = useState(false)
  const [naFillStatus, setNaFillStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackHoneypot, setFeedbackHoneypot] = useState('')
  const [feedbackSending] = useState(false)
  const facilitationIntroRef = useRef<string | null>(null)
  const [feedbackCooldown, setFeedbackCooldown] = useState(0)
  const [feedbackNotice, setFeedbackNotice] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)
  const [engineEntryHint, setEngineEntryHint] = useState<{
    x: number
    y: number
    visible: boolean
  }>({ x: 0, y: 0, visible: false })
  const [engineMatrixVisible] = useState(false)
  const [engineLabelEditorId, setEngineLabelEditorId] = useState<string | null>(null)
  const engineLabelEditorRef = useRef<HTMLDivElement | null>(null)
  const engineLabelCache = useRef<Record<string, string | null>>({})
  const openSessionDebugOnceRef = useRef(false)
  const engineInputRef = useRef<HTMLTextAreaElement | null>(null)
  const enginePendingFocusRef = useRef(false)
  const enginePendingArmingRef = useRef(false)
  const engineAllowIdleWithoutFocusRef = useRef(false)
  const engineIdleArmedRef = useRef(false)
  const engineIdleLastArmReasonRef = useRef<string | null>(null)
  const didLogMappingSelfTestRef = useRef(false)
  const lastGravitySuggestionRef = useRef<string | null>(null)
  const engineImportInputRef = useRef<HTMLInputElement | null>(null)
  const engineFacilitationLoadingTimerRef = useRef<number | null>(null)
  const suggestLoadingTimerRef = useRef<number | null>(null)
  const reportOpenHandledRef = useRef(false)
  const reportOpenPrevRef = useRef(false)
  const autoOpenedMissingLabelRef = useRef(false)
  const [feedbackReminder, setFeedbackReminder] = useState<{
    sessionId: string | null
    visible: boolean
  } | null>(null)
  const [reportViewOpen, setReportViewOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.location.pathname.replace(/\/+$/, '') === '/report'
  })

  const languageOptions: Language[] = ['English', 'Polish']

  const uiLanguageOptions: Language[] = ['Polish', 'English']

  const hasSupabaseEnv = supabaseEnvDiag.hasUrl && supabaseEnvDiag.hasAnon
  const authDisabled = !hasSupabaseEnv
  const isAuthed = Boolean(authSession?.user?.id)
  const isGuest = isGuestMode() === true
  const hasActiveGuestSession = isGuest ? getStorageSessionCount() > 0 : false
  const guestEntryAllowed =
    isGuest &&
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('guest') === '1')
  const canEnterApp = isAuthed || guestEntryAllowed || authDisabled

  const applySessionLanguage = (value?: string) => {
    if (!value) return
    const nextLanguage = value as Language
    if (!languageOptions.includes(nextLanguage)) return
    setUiLanguage(nextLanguage)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, nextLanguage)
    }
  }

  const isDebugEnabled = () => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('debug') === '1') return true
    }
    return import.meta.env.VITE_DEBUG_UI === 'true'
  }

  const isDiagEnabled = () => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.get('diag') === '1'
  }

  const isE2EEnabled = () => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('e2e') === '1') return true
    }
    return import.meta.env.VITE_E2E === '1'
  }

  const logFacilitationEvent = (event: string, payload: Record<string, unknown>) => {
    if (!isDebugEnabled()) return
    const ts = Date.now()
    console.log(JSON.stringify({ event, ts, ...payload }))
  }

  const logSessionStore = (event: string, payload: Record<string, unknown>) => {
    if (!import.meta.env.DEV) return
    console.log(JSON.stringify({ event, ...payload }))
  }

  const logAuthDiagnostics = (event: string, payload: Record<string, unknown>) => {
    if (!import.meta.env.DEV) return
    console.log(JSON.stringify({ event, ...payload }))
  }

  const normalizeNextPath = (value: string | null) => {
    if (!value) return null
    if (!value.startsWith('/')) return null
    if (value.startsWith('//')) return null
    return value
  }

  const readPostAuthNext = () => {
    if (typeof window === 'undefined') return null
    return normalizeNextPath(window.sessionStorage.getItem(POST_AUTH_NEXT_KEY))
  }

  const writePostAuthNext = (value: string | null) => {
    if (typeof window === 'undefined') return
    const normalized = normalizeNextPath(value)
    if (normalized) {
      window.sessionStorage.setItem(POST_AUTH_NEXT_KEY, normalized)
    }
  }

  const clearPostAuthNext = () => {
    if (typeof window === 'undefined') return
    window.sessionStorage.removeItem(POST_AUTH_NEXT_KEY)
  }

  const readPostAuthLang = () => {
    if (typeof window === 'undefined') return null
    const value = window.sessionStorage.getItem(POST_AUTH_LANG_KEY)
    return value === 'English' || value === 'Polish' ? value : null
  }

  const writePostAuthLang = (value: Language | null) => {
    if (typeof window === 'undefined') return
    if (!value) return
    window.sessionStorage.setItem(POST_AUTH_LANG_KEY, value)
  }

  const clearPostAuthLang = () => {
    if (typeof window === 'undefined') return
    window.sessionStorage.removeItem(POST_AUTH_LANG_KEY)
  }

  const findSupabasePkceVerifierKeys = () => {
    if (typeof window === 'undefined') return []
    return Object.keys(window.localStorage).filter(
      (key) =>
        key.includes('code-verifier') || key.includes('pkce') || key.includes('supabase')
    )
  }

const recordAuthRedirect = (redirectTo: string) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUTH_LOGIN_ORIGIN_KEY, window.location.origin)
  window.localStorage.setItem(AUTH_LOGIN_REDIRECT_KEY, redirectTo)
  logAuthDiagnostics('auth_redirect_set', {
    origin: window.location.origin,
    redirectTo,
  })
}

const clearAuthRedirect = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_LOGIN_ORIGIN_KEY)
  window.localStorage.removeItem(AUTH_LOGIN_REDIRECT_KEY)
}

const setAuthFlowInProgress = (value: boolean) => {
  if (typeof window === 'undefined') return
  if (value) {
    window.localStorage.setItem(AUTH_FLOW_IN_PROGRESS_KEY, 'true')
  } else {
    window.localStorage.removeItem(AUTH_FLOW_IN_PROGRESS_KEY)
  }
}

const isAuthFlowInProgress = () => {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(AUTH_FLOW_IN_PROGRESS_KEY) === 'true'
}

  const showEngineNotice = (message: string, variant: 'success' | 'error') => {
    setEngineNotice({ message, variant })
    if (engineNoticeTimer.current) {
      window.clearTimeout(engineNoticeTimer.current)
    }
    engineNoticeTimer.current = window.setTimeout(() => {
      setEngineNotice(null)
    }, 2400)
  }

  const resetAuthDev = async () => {
    if (!import.meta.env.DEV) return
    if (client) {
      await client.auth.signOut()
    }
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.location.replace('/')
    }
  }

  useEffect(() => {
    return () => {
      if (engineNoticeTimer.current) {
        window.clearTimeout(engineNoticeTimer.current)
      }
    }
  }, [])

  const getEngineSessionKey = () => enginePreviewSessionId ?? 'new'

  const clearEngineIdleTimer = (reason: string) => {
    if (engineIdleTimer.current) {
      window.clearTimeout(engineIdleTimer.current)
      engineIdleTimer.current = null
      logFacilitationEvent('idle_timer_cleared', { reason })
    }
  }

  const armIdleWatch = (reason: string) => {
    engineIdleArmedRef.current = true
    engineIdleLastArmReasonRef.current = reason
    engineAllowIdleWithoutFocusRef.current = true
    engineIdleTriggered.current = false
    setEngineLastInputActivityAt(Date.now())
    logFacilitationEvent('idle_watch_armed', { reason })
  }

  const markUserInitiatedInteraction = (source: 'pointer' | 'keystroke') => {
    const key = getEngineSessionKey()
    if (engineInteractionBySession.current[key]) return
    engineInteractionBySession.current[key] = true
    logFacilitationEvent('user_interaction_armed', { source, sessionId: key })
  }

  const syncEngineLabelCache = (items: EngineBoardItem[]) => {
    items.forEach((item) => {
      engineLabelCache.current[item.id] = item.label ?? null
    })
  }

  const setFacilitationCooldown = (reason: string) => {
    const until = Date.now() + 25000
    engineCooldownUntil.current = until
    logFacilitationEvent('facilitation_cooldown_set', { reason, until })
  }

  const canShowFacilitation = (reason: string) => {
    const now = Date.now()
    if (engineCooldownUntil.current > now) {
      logFacilitationEvent('facilitation_blocked_cooldown', {
        reason,
        until: engineCooldownUntil.current,
      })
      return false
    }
    return true
  }

  const resolveOfferReason = () => {
    let reason = 'short'
    if (engineStrongSignals > 0) {
      reason = 'erase'
    } else if (engineMediumSignals > 0) {
      if (engineLastMediumKind === 'idle') reason = 'idle'
      if (engineLastMediumKind === 'vague' || engineLastMediumKind === 'short_vague') {
        reason = 'vague'
      }
    } else if (engineWeakSignals > 0) {
      if (engineLastWeakKind == 'short_burst') reason = 'burst'
      else reason = 'short'
    }
    logFacilitationEvent('facilitation_reason_eval', {
      reason,
      words: countWords(engineLatestInput.current),
    })
    return reason
  }

  const normalizeApiBase = (value: string) => value.trim().replace(/\/+$/, '')
  const idleThresholdMs = isE2EEnabled()
    ? 800
    : isDebugEnabled()
      ? 5000
      : DEFAULT_IDLE_THRESHOLD_MS
  const postAddGraceMs = isE2EEnabled() ? 200 : 7000
  // Routing is handled manually using window.location.pathname (no router library).
  const rawPath = typeof window !== 'undefined' ? window.location.pathname : ''
  const normalizedPath = rawPath.replace(/\/+$/, '')
  const isEnginePreview = normalizedPath === '/engine'
  const isReportPath = normalizedPath === '/report' || normalizedPath.endsWith('/report')
  const isReport = isReportPath || reportViewOpen
  const isWorkInProgress = normalizedPath === '/wip'
  const isIdeaGrid = normalizedPath === '/grid'
  const isLogin = normalizedPath === '/login'
  const isAuthCallback = normalizedPath === '/auth/callback'
  const isProtectedRoute = normalizedPath.startsWith('/app')
  const supabaseInitError = getSupabaseInitError()
  const showSupabaseConfigError = Boolean(supabaseInitError)

  useEffect(() => {
    if (!isEnginePreview) return
    console.log('[engine] route mounted', window.location.href)
  }, [isEnginePreview])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      const nextPath = window.location.pathname.replace(/\/+$/, '')
      setReportViewOpen(nextPath === '/report' || nextPath.endsWith('/report'))
    }
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    if (isReport && showLanding) {
      setShowLanding(false)
    }
  }, [isReport, showLanding])

  useEffect(() => {
    const wasOpen = reportOpenPrevRef.current
    if (isReport && !wasOpen) {
      reportOpenHandledRef.current = false
      setNaFillStatus('idle')
    }
    reportOpenPrevRef.current = isReport
  }, [isReport])

  useEffect(() => {
    if (!isEnginePreview) return
    let cancelled = false
    const loadFx = async () => {
      const cached = loadFxCache()
      if (cached && Date.now() - cached.updatedAt < FX_CACHE_TTL_MS) {
        if (!cancelled) setUsdPlnRate(cached.rate)
        return
      }
      try {
        const response = await fetch('/api/fx?action=usdpln')
        const payload = (await response.json()) as {
          ok?: boolean
          usdpln?: number
          updatedAt?: number
        }
        const rate = Number(payload?.usdpln)
        if (response.ok && Number.isFinite(rate) && rate > 0) {
          if (!cancelled) setUsdPlnRate(rate)
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(
              ENGINE_FX_KEY,
              JSON.stringify({ rate, updatedAt: payload?.updatedAt ?? Date.now() })
            )
          }
        } else if (cached && !cancelled) {
          setUsdPlnRate(cached.rate)
        } else if (!cancelled) {
          setUsdPlnRate(FX_FALLBACK_RATE)
        }
      } catch {
        if (cached && !cancelled) {
          setUsdPlnRate(cached.rate)
        } else if (!cancelled) {
          setUsdPlnRate(FX_FALLBACK_RATE)
        }
      } finally {
        // no-op
      }
    }
    void loadFx()
    return () => {
      cancelled = true
    }
  }, [isEnginePreview])

  useEffect(() => {
    let cancelled = false
    if (!client) {
      setAuthLoading(false)
      setAuthResolved(true)
      setAuthError(MISSING_SUPABASE_ENV_MESSAGE)
      return () => {
        cancelled = true
      }
    }
    const auth = client.auth
    const init = async () => {
      const { data } = await auth.getSession()
      if (!cancelled) {
        setAuthSession(data.session ?? null)
        setAuthLoading(false)
        setAuthResolved(true)
      }
    }
    init()
    const { data } = auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        setLastAuthEvent(event)
        setAuthSession(session ?? null)
        if (!authResolved) setAuthResolved(true)
        if (typeof window !== 'undefined') {
          if (event === 'SIGNED_OUT') {
            if (window.location.pathname !== '/') {
              window.location.replace('/')
            }
          }
        }
      }
    )
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isProtectedRoute || authLoading || authDisabled) return
    if (!authSession) {
      const next = window.location.pathname + window.location.search
      window.location.href = `/login?next=${encodeURIComponent(next)}`
    }
  }, [isProtectedRoute, authLoading, authSession, authDisabled])

  useEffect(() => {
    if (!authResolved) return
    if (!authSession?.user) return
    if (authRedirectedRef.current) return
    if (typeof window === 'undefined') return
    const nextRaw = readPostAuthNext()
    const next = nextRaw && nextRaw !== '/' ? nextRaw : '/engine'
    const lang = readPostAuthLang()
    if (lang) {
      setUiLanguage(lang)
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, lang)
      clearPostAuthLang()
    }
    clearPostAuthNext()
    console.info('[auth] session resolved', { hasSession: true, next, lang })
    console.info('[auth] redirecting', { redirectTo: next })
    authRedirectedRef.current = true
    if (window.location.pathname !== next) {
      window.location.replace(next)
    }
  }, [authResolved, authSession?.user?.id])

  useEffect(() => {
    if (!isEnginePreview) return
    if (!authResolved) return
    if (isAuthed || guestEntryAllowed) return
    if (typeof window === 'undefined') return
    const next = window.location.pathname + window.location.search
    window.location.replace(`/login?next=${encodeURIComponent(next)}`)
  }, [isEnginePreview, authResolved, isAuthed, guestEntryAllowed])

  useEffect(() => {
    if (initialRouteResolvedRef.current) return
    if (!authResolved) return
    if (typeof window === 'undefined') return
    if (isAuthCallback || isAuthFlowInProgress()) return
    if (authSession?.user) return
    const path = window.location.pathname
    let target = path
    const isReportPath = path.replace(/\/+$/, '') === '/report' || path.endsWith('/report')

    if (!canEnterApp && !isReportPath) {
      if (
        path !== '/' &&
        !path.startsWith('/login') &&
        !path.startsWith('/auth/callback')
      ) {
        if (path === '/engine') {
          const next = `${path}${window.location.search}`
          target = `/login?next=${encodeURIComponent(next)}`
        } else {
          target = '/'
        }
      }
    }

    if (import.meta.env.DEV) {
      console.log('[route] start', {
        path,
        authResolved,
        isAuthed,
        isGuest,
        hasActiveGuestSession,
        canEnterApp,
        isReportPath,
        target,
      })
    }

    if (target !== path) {
      if (import.meta.env.DEV) {
        console.log('[route-force] redirect to', target)
        console.trace()
      }
      window.location.replace(target)
    }
    initialRouteResolvedRef.current = true
  }, [authResolved, canEnterApp, isAuthed, isGuest, hasActiveGuestSession])

  useEffect(() => {
    if (!isAuthCallback) return
    if (!client) {
      setAuthCallbackError(copy.authCallback.unknownError)
      return
    }
    const auth = client.auth
    let cancelled = false
    const run = async () => {
      setAuthError(null)
      setAuthCallbackError(null)
      setAuthCallbackLoading(true)
      setAuthCallbackHint(null)
      const href = typeof window !== 'undefined' ? window.location.href : ''
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const errorParam = params.get('error')
      console.log('[auth callback] location', {
        href,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        hasCode: Boolean(code),
      })
      if (import.meta.env.DEV) {
        console.log('[auth callback] start', { code, error: errorParam, href })
      }
      logAuthDiagnostics('auth_callback_location', {
        href,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        search: typeof window !== 'undefined' ? window.location.search : '',
        hash: typeof window !== 'undefined' ? window.location.hash : '',
        hasCode: Boolean(code),
        hasError: Boolean(errorParam),
      })
      if (!code && !errorParam) {
        setAuthCallbackError(copy.authCallback.signInFailed)
        setAuthCallbackLoading(false)
        return
      }
      if (errorParam) {
        console.error('[auth callback] oauth error', {
          error: errorParam,
          description: params.get('error_description'),
          href,
        })
        setAuthCallbackError(copy.authCallback.signInFailed)
        setAuthCallbackHint(params.get('error_description'))
        setAuthCallbackLoading(false)
        return
      }
      try {
        const start = Date.now()
        const timeoutMs = 5000
        const intervalMs = 200
        while (Date.now() - start < timeoutMs) {
          const { data, error } = await auth.getSession()
          if (cancelled) return
          if (error) {
            console.error(error)
            const codeValue = (error as { code?: string }).code
            setAuthCallbackError(
              `${error.message}${codeValue ? ` (${codeValue})` : ''}`
            )
            setAuthCallbackLoading(false)
            return
          }
          if (data.session) {
            clearAuthRedirect()
            setAuthCallbackLoading(false)
            return
          }
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
        }
        console.error('[auth callback] timeout, no session')
        setAuthCallbackError(copy.authCallback.signInFailed)
        setAuthCallbackLoading(false)
      } finally {
        setAuthFlowInProgress(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [isAuthCallback])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (import.meta.env.DEV) return
    if (isAuthCallback || authCallbackLoading) return
    if (window.location.pathname.startsWith('/auth/callback')) return
    if (isAuthFlowInProgress()) return
    if (!authSession?.user || !client) return
    const auth = client.auth
    const handlePageHide = () => {
      // Best-effort sign-out on tab/window close.
      void auth.signOut()
    }
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
    }
  }, [authSession?.user?.id])

  useEffect(() => {
    if (!authSession) return
    if (!isGuestMode()) return
    const guestSessions = readGuestSessions()
    if (guestSessions.length) {
      setGuestPromptOpen(true)
    } else {
      clearGuestMode()
      clearGuestSessions()
    }
  }, [authSession])

  const handleGoogleLogin = async () => {
    if (!client) {
      setAuthError(MISSING_SUPABASE_ENV_MESSAGE)
      return
    }
    setAuthError(null)
    setLoginNotice(null)
    setLoginOauthLoading(true)
    const redirectTo = getOAuthRedirectTo()
    const next =
      typeof window !== 'undefined'
        ? normalizeNextPath(new URLSearchParams(window.location.search).get('next'))
        : null
    const lang = uiLanguage || 'English'
    const normalizedNext = next || '/engine'
    if (oauthStartOnceRef.current) return
    oauthStartOnceRef.current = true
    setAuthFlowInProgress(true)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTH_OAUTH_ORIGIN_KEY, window.location.origin)
    }
    writePostAuthNext(normalizedNext)
    writePostAuthLang(lang)
    console.info('[auth] starting oauth', { next: normalizedNext, lang })
    recordAuthRedirect(redirectTo)
    logAuthDiagnostics('auth_oauth_start', {
      origin: window.location.origin,
      redirectTo,
    })
    console.info('[oauth start] initiating', {
      provider: 'google',
      origin: window.location.origin,
      redirectTo,
    })
    if (import.meta.env.DEV) {
      console.log('[oauth start] before', {
        origin: window.location.origin,
        keys: findSupabasePkceVerifierKeys(),
      })
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (import.meta.env.DEV) {
      window.setTimeout(() => {
        console.log('[oauth start] after', { keys: findSupabasePkceVerifierKeys() })
      }, 50)
    }
    logAuthDiagnostics('auth_oauth_initiated', {
      origin: window.location.origin,
      redirectTo,
    })
    if (error) setAuthError(copy.auth.loginStartFailed)
    setLoginOauthLoading(false)
  }

  const handleMagicLink = async () => {
    if (!client) {
      setAuthError(MISSING_SUPABASE_ENV_MESSAGE)
      return
    }
    if (!loginEmail.trim()) {
      setAuthError(copy.loginEmailError)
      return
    }
    if (loginSending || loginCooldownSeconds > 0) {
      return
    }
    setAuthError(null)
    setLoginNotice(null)
    setLoginSending(true)
    const redirectTo = getOAuthRedirectTo()
    setAuthFlowInProgress(true)
    recordAuthRedirect(redirectTo)
    logAuthDiagnostics('auth_magiclink_start', {
      origin: window.location.origin,
      redirectTo,
      hasEmail: Boolean(loginEmail.trim()),
    })
    if (import.meta.env.DEV) {
      console.log('[auth otp] start', { email: loginEmail.trim() })
    }
    const { error } = await client.auth.signInWithOtp({
      email: loginEmail.trim(),
      options: { emailRedirectTo: redirectTo },
    })
    if (import.meta.env.DEV) {
      console.log('[auth otp] result', { ok: !error, error })
      const { data } = await client.auth.getSession()
      console.log('[auth email] post-action session', { hasSession: !!data.session })
    }
    if (error) {
      const codeValue = (error as { code?: string }).code
      const statusValue = (error as { status?: number }).status
      const lower = error.message.toLowerCase()
      const isRateLimit =
        statusValue === 429 || lower.includes('rate limit') || lower.includes('too many')
      if (import.meta.env.DEV) {
        console.log('[auth otp] error', {
          status: statusValue,
          message: error.message,
          code: codeValue,
        })
      }
      if (isRateLimit) {
        const baseMessage =
          'Limit maili przekroczony — odczekaj lub użyj Google/hasła'
        const devDetail = import.meta.env.DEV
          ? ` (${codeValue ?? 'no_code'}: ${error.message})`
          : ''
        setAuthError(`${baseMessage}${devDetail}`)
        setLoginCooldownSeconds(60)
      } else {
        const detail = import.meta.env.DEV
          ? ` (${codeValue ?? 'no_code'}: ${error.message})`
          : ''
        setAuthError(`${error.message}${detail}`)
      }
    } else {
      setLoginNotice(copy.loginNoticeSent)
    }
    setLoginSending(false)
  }

  const handlePasswordAuth = async () => {
    if (!client) {
      setAuthError(MISSING_SUPABASE_ENV_MESSAGE)
      return
    }
    if (!loginEmail.trim() || !loginPassword) {
      setAuthError(copy.loginEmailError)
      return
    }
    if (loginSending) return
    setAuthError(null)
    setLoginNotice(null)
    setLoginSending(true)
    if (loginAuthMode === 'signin') {
      const { data, error } = await client.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      })
      if (import.meta.env.DEV) {
        console.log('[auth email] signInWithPassword', { ok: !error, error })
        const session = data?.session
        console.log('[auth email] post-action session', { hasSession: !!session })
      }
      if (error) {
        const codeValue = (error as { code?: string }).code
        const detail = import.meta.env.DEV && codeValue ? ` (${codeValue})` : ''
        setAuthError(`${error.message}${detail}`)
      }
    } else {
      const { data, error } = await client.auth.signUp({
        email: loginEmail.trim(),
        password: loginPassword,
      })
      if (import.meta.env.DEV) {
        console.log('[auth email] signUp', { ok: !error, error })
      }
      if (error) {
        const codeValue = (error as { code?: string }).code
        const detail = import.meta.env.DEV && codeValue ? ` (${codeValue})` : ''
        setAuthError(`${error.message}${detail}`)
      } else if (!data?.session) {
        setLoginNotice(
          'Konto utworzone. Jeśli wymagane jest potwierdzenie email, sprawdź skrzynkę.'
        )
      }
    }
    setLoginSending(false)
  }

  const handleGuestMode = () => {
    enableGuestMode()
    setEngineSessionPersisted(false)
    if (import.meta.env.DEV) {
      console.log('[route-force] redirect to /engine')
      console.trace()
    }
    window.location.replace('/engine?guest=1')
  }

  const handleGuestMerge = async () => {
    setGuestMergeLoading(true)
    try {
      const guestSessions = readGuestSessions()
      if (guestSessions.length) {
        await importSessions(guestSessions as Parameters<typeof importSessions>[0])
      }
      clearGuestSessions()
      clearGuestMode()
      setGuestPromptOpen(false)
    } finally {
      setGuestMergeLoading(false)
    }
  }

  const handleGuestSkip = () => {
    clearGuestSessions()
    clearGuestMode()
    setGuestPromptOpen(false)
  }

  const getSessionContext = (sessionId: string | null) => {
    const id = sessionId || enginePreviewSessionId || engineSessionDetail?.session?.id || null
    const sessionName =
      enginePreviewSessionName ||
      engineSessionDetail?.session?.name ||
      currentEngineSession?.name ||
      ''
    const boardEntries = (enginePreviewItems || []).map((item) => ({
      id: item.id,
      text: item.text,
      createdAt: item.created_at,
      tags: item.label ? [item.label] : undefined,
    }))
    const matrixContext =
      engineLastQuestionMeta?.group_code && engineLastQuestionMeta?.mode_code
        ? {
            group_code: engineLastQuestionMeta.group_code,
            mode_code: engineLastQuestionMeta.mode_code,
            action: engineLastQuestionMeta?.id ? 'NEXT' : undefined,
          }
        : null
    const source =
      id && cloudSessionPayloads[id] ? ('cloud' as const) : ('local' as const)
    return {
      sessionId: id,
      sessionName,
      language: uiLanguage === 'English' ? 'en' : 'pl',
      boardEntries,
      matrixContext,
      source,
    }
  }

  const handleLandingCtaClick = (event?: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event) event.preventDefault()
    const target = isAuthed ? '/engine' : '/login'
    console.info('[cta] start free clicked', {
      isAuthed,
      isGuestMode: isGuest,
      target,
    })
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage)
      writePostAuthLang(uiLanguage)
      window.location.href = target
    }
  }

  useEffect(() => {
    engineLatestInput.current = enginePreviewInput
  }, [enginePreviewInput])

  useEffect(() => {
    if (!authSession?.user?.id) {
      setEngineSessionPersisted(false)
    }
  }, [authSession?.user?.id])

  useEffect(() => {
    if (!enginePreviewSessionId) {
      setEngineSessionPersisted(false)
    }
  }, [enginePreviewSessionId])

  useEffect(() => {
    if (engineSessionPersisted) {
      setEngineFacilitationInlineError(null)
    }
  }, [engineSessionPersisted, enginePreviewSessionId])


  useEffect(() => {
    engineLatestUiState.current = engineUiState
  }, [engineUiState])

  useEffect(() => {
    engineLatestFocus.current = engineInputFocused
  }, [engineInputFocused])

  useEffect(() => {
    if (!isEnginePreview) return
    if (!enginePreviewSessionId) return
    if (enginePendingFocusRef.current && engineInputRef.current) {
      enginePendingFocusRef.current = false
      engineInputRef.current.focus()
      setEngineInputFocused(true)
      setEngineLastInputActivityAt(Date.now())
    }
    if (enginePendingArmingRef.current) {
      enginePendingArmingRef.current = false
      engineInteractionBySession.current[enginePreviewSessionId] = true
      setEngineLastInputActivityAt(Date.now())
    }
  }, [isEnginePreview, enginePreviewSessionId])

  useEffect(() => {
    if (!isEnginePreview) return
    console.info('[diag] engine header flags', {
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      normalizedPath,
      mode: import.meta.env.MODE,
      prod: import.meta.env.PROD,
      dev: import.meta.env.DEV,
      isAuthed,
      isGuestMode: isGuest,
      aiSupportEnabled,
    })
  }, [isEnginePreview, normalizedPath, isAuthed, isGuest, aiSupportEnabled])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!isEnginePreview) return
    console.log('[engine]', {
      authResolved,
      hasSession: Boolean(authSession?.user?.id),
      hasActiveSession: Boolean(enginePreviewSessionId),
    })
  }, [isEnginePreview, authResolved, authSession?.user?.id, enginePreviewSessionId])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (typeof window === 'undefined') return
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void resetAuthDev()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [])

  useEffect(() => {
    setEngineAskedQuestionIds([])
    setEngineLastQuestionMeta(null)
  }, [enginePreviewSessionId])

  useEffect(() => {
    const sessionKey = getEngineSessionKey()
    if (!engineResetOnSessionChange.current) {
      if (sessionKey !== 'new' && engineInteractionBySession.current['new']) {
        engineInteractionBySession.current[sessionKey] = true
        logFacilitationEvent('session_interaction_transferred', {
          from: 'new',
          to: sessionKey,
        })
      }
      logFacilitationEvent('session_switch_ignored', { sessionId: sessionKey })
      return
    }
    const transferInteraction =
      sessionKey !== 'new' &&
      engineInteractionBySession.current['new'] &&
      engineLastInputActivityAt !== null
    engineResetOnSessionChange.current = false
    clearEngineIdleTimer('session_switch')
    engineIdleTriggered.current = false
    engineInteractionBySession.current[sessionKey] = transferInteraction
    engineInteractionBySession.current['new'] = false
    if (!transferInteraction && !engineIdleArmedRef.current) {
      setEngineLastInputActivityAt(null)
    }
    setEngineOfferReason(null)
    setEngineUiState('FREE_FLOW')
    logFacilitationEvent('session_switched', { sessionId: sessionKey })
  }, [enginePreviewSessionId])

  useEffect(() => {
    const visible = engineUiState === 'FACILITATION_OFFER'
    logFacilitationEvent('facilitation_visibility', {
      visible,
      reason: engineOfferReason || 'none',
      words: countWords(engineLatestInput.current),
    })
  }, [engineUiState, engineOfferReason])

  useEffect(() => {
    if (!isDebugEnabled() || didLogMappingSelfTestRef.current) return
    didLogMappingSelfTestRef.current = true
    const examples = [
      'funkcja musialaby cos poprawic',
      'Funkcja musiałaby cos poprawic',
      'Powinna byc szybciej',
      'Powinny byc testy',
    ]
    examples.forEach((example) => {
      const details = computeMappingDetails(example, 'Polish')
      console.log(
        JSON.stringify({
          event: 'matrix_mapping_self_test',
          text: details.normalized,
          row: details.row,
          col: details.col,
          rowScores: details.rowScores,
          colScores: details.colScores,
        })
      )
    })
  }, [])

  useEffect(() => {
    if (!engineLabelEditorId) return
    const handleClick = (event: MouseEvent) => {
      if (!engineLabelEditorRef.current) return
      if (!engineLabelEditorRef.current.contains(event.target as Node)) {
        setEngineLabelEditorId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [engineLabelEditorId])


  const isDebugMatrix =
    typeof window !== 'undefined' && window.location.pathname === '/debug/matrix'

  const checkLlmStatus = async (base: string) => {
    if (!aiSupportEnabled || !base) {
      setLlmStatus('offline')
      return
    }
    try {
      const response = await fetch(`${base}/api/health`, { method: 'GET' })
      setLlmStatus(response.ok ? 'online' : 'offline')
    } catch {
      setLlmStatus('offline')
    }
  }

  const handleLlmPing = async () => {
    try {
      setLlmPingResult(null)
      const response = await fetch(`${llmApiBase}/api/health?scope=llm`, {
        method: 'GET',
      })
      const payload = (await response.json()) as {
        ok?: boolean
        hasOpenAIKey?: boolean
        aiSupportEnabled?: boolean
        error?: string
      }
      if (!response.ok || !payload?.ok) {
        setLlmPingResult({ error: payload?.error || 'Ping failed.' })
        return
      }
      setLlmPingResult({
        model: payload?.hasOpenAIKey ? 'configured' : 'missing-key',
        tokensIn: 0,
        tokensOut: 0,
        message: payload?.aiSupportEnabled ? 'ai-enabled' : 'ai-disabled',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ping failed.'
      setLlmPingResult({ error: message })
    }
  }

  useEffect(() => {
    const savedBase = localStorage.getItem('llm_api_base')
    const savedAiSupport = localStorage.getItem('aiSupportEnabled')
    const legacyEnabled = localStorage.getItem('llm_enabled')
    const savedEnabled = savedAiSupport ?? legacyEnabled
    const nextEnabled = savedEnabled !== 'false'
    const nextBase = normalizeApiBase(savedBase || DEFAULT_LLM_API_BASE)
    setAiSupportEnabled(nextEnabled)
    setLlmApiBase(nextBase)
    if (nextEnabled) {
      void checkLlmStatus(nextBase)
    } else {
      setLlmStatus('offline')
    }
  }, [])

  useEffect(() => {
    if (!authResolved) return
    if (!isAdmin) {
      setDiagnosticsEnabled(false)
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(DIAGNOSTICS_STORAGE_KEY)
      }
      return
    }
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(DIAGNOSTICS_STORAGE_KEY)
    setDiagnosticsEnabled(stored === 'true')
  }, [authResolved, isAdmin])

  useEffect(() => {
    if (!aiSupportEnabled) {
      setLlmStatus('offline')
      return
    }
    void checkLlmStatus(llmApiBase)
  }, [aiSupportEnabled, llmApiBase])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage)
  }, [uiLanguage])

  useEffect(() => {
    if (postAuthLanguageApplied) return
    const saved = readPostAuthLang()
    if (!saved) return
    setUiLanguage(saved)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, saved)
    }
    clearPostAuthLang()
    setPostAuthLanguageApplied(true)
  }, [postAuthLanguageApplied])

  useEffect(() => {
    if (!showLanding) return
    const updateProgress = () => {
      const scrollTop = window.scrollY
      const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight)
      const progress = Math.min(1, Math.max(0, scrollTop / maxScroll))
      document.documentElement.style.setProperty('--scroll-progress', `${progress}`)
    }
    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)
    return () => {
      window.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [showLanding])

  useEffect(() => {
    if (!isEnginePreview) return
    const handleActivity = () => {
      if (!engineIdleArmedRef.current) return
      engineIdleTriggered.current = false
      setEngineLastInputActivityAt(Date.now())
    }
    window.addEventListener('pointerdown', handleActivity, { passive: true })
    window.addEventListener('keydown', handleActivity)
    return () => {
      window.removeEventListener('pointerdown', handleActivity)
      window.removeEventListener('keydown', handleActivity)
    }
  }, [isEnginePreview])

  useEffect(() => {
    if (!isEnginePreview) return
    if (engineUiState !== 'FREE_FLOW') return
    const sessionKey = getEngineSessionKey()
    const lastAddAt = engineLastAddAtBySession.current[sessionKey] || 0
    if (!engineInteractionBySession.current[sessionKey]) {
      logFacilitationEvent('facilitation_disarmed', { reason: 'not_armed', sessionId: sessionKey })
      return
    }
    if (Date.now() - lastAddAt < postAddGraceMs) {
      logFacilitationEvent('facilitation_disarmed', { reason: 'post_add_grace', sessionId: sessionKey })
      return
    }
    if (!canShowFacilitation('stuck')) return
    if (engineStrongSignals >= 1 || engineMediumSignals >= 2 || engineWeakSignals >= 3) {
      const reason = resolveOfferReason()
      setEngineOfferReason(reason)
      setEngineUiState('FACILITATION_OFFER')
      logFacilitationEvent('facilitation_offered', {
        sessionId: enginePreviewSessionId || 'unknown',
        reason,
        uiState: engineUiState,
      })
    }
  }, [
    isEnginePreview,
    engineUiState,
    engineStrongSignals,
    engineMediumSignals,
    engineWeakSignals,
    engineLastWeakKind,
    engineLastMediumKind,
    engineLastStrongKind,
    enginePreviewSessionId,
    postAddGraceMs,
  ])

  useEffect(() => {
    if (!isEnginePreview) return
    if (!enginePreviewSessionId) {
      clearEngineIdleTimer('no_session')
      return
    }
    const sessionKey = getEngineSessionKey()
    if (!engineIdleArmedRef.current) {
      clearEngineIdleTimer('idle_not_armed')
      return
    }
    if (!engineLastInputActivityAt) {
      clearEngineIdleTimer('no_activity_baseline')
      return
    }
    if (engineUiState !== 'FREE_FLOW' && engineUiState !== 'FACILITATED_INPUT') {
      clearEngineIdleTimer('ui_state_blocked')
      return
    }

    const delta = Date.now() - engineLastInputActivityAt
    const remaining = Math.max(0, idleThresholdMs - delta)
    clearEngineIdleTimer('reset')
    logFacilitationEvent('idle_timer_set', {
      sessionId: sessionKey,
      remaining,
      baseline: engineLastInputActivityAt,
    })
    engineIdleTimer.current = window.setTimeout(() => {
      const latestSession = getEngineSessionKey()
      const now = Date.now()
      const idleFor = engineLastInputActivityAt ? now - engineLastInputActivityAt : 0
      logFacilitationEvent('idle_timer_fired', {
        sessionId: latestSession,
        idleFor,
      })
      if (!engineIdleArmedRef.current) return
      if (
        engineLatestUiState.current !== 'FREE_FLOW' &&
        engineLatestUiState.current !== 'FACILITATED_INPUT'
      ) {
        return
      }
      const armReason = engineIdleLastArmReasonRef.current
      const ignoreCooldown = Boolean(armReason && armReason.startsWith('facilitation_'))
      if (!ignoreCooldown && !canShowFacilitation('idle')) return
      if (engineIdleTriggered.current) return
      registerSignal('medium', 'idle')
      engineIdleTriggered.current = true
      engineIdleArmedRef.current = false
      engineIdleLastArmReasonRef.current = null
      setEngineOfferReason('idle')
      if (engineLatestUiState.current !== 'FACILITATED_INPUT') {
        setEngineUiState('FACILITATION_OFFER')
      }
      engineAllowIdleWithoutFocusRef.current = false
      logFacilitationEvent('facilitation_offered', {
        sessionId: latestSession,
        reason: 'idle',
        uiState: engineLatestUiState.current,
      })
    }, remaining)
    return () => clearEngineIdleTimer('cleanup')
  }, [
    isEnginePreview,
    engineInputFocused,
    engineLastInputActivityAt,
    engineUiState,
    enginePreviewSessionId,
    idleThresholdMs,
  ])

  useEffect(() => {
    return () => {
      if (engineEraseTimer.current) {
        window.clearTimeout(engineEraseTimer.current)
      }
    }
  }, [])

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) || null


  const debugMatrixData = useMemo(() => {
    const entries = enginePreviewItems.map((item) => {
      const mapped = mapEntryToCell(item.text, uiLanguage)
      return {
        id: item.id,
        text: item.text,
        created_at: item.created_at || 0,
        cell: { row: mapped.row, col: mapped.col },
      }
    })

    const cells = new Map<string, { count: number; entries: typeof entries }>()
    const counts: Record<string, number> = {}
    MATRIX_ROWS.forEach((row) =>
      MATRIX_COLS.forEach((col) => {
        const key = cellKey(row.key, col.key)
        cells.set(key, { count: 0, entries: [] })
        counts[key] = 0
      })
    )

    entries.forEach((entry) => {
      const key = cellKey(entry.cell.row, entry.cell.col)
      const cell = cells.get(key)
      if (!cell) return
      cell.count += 1
      counts[key] += 1
      if (cell.entries.length < 3) {
        cell.entries.push(entry)
      }
    })

    const coverage = Array.from(cells.values()).filter((cell) => cell.count > 0).length
    const latestEntry = entries[0]
    const currentCell = latestEntry?.cell ?? { row: 'world' as MatrixRowKey, col: 'as_is' as MatrixColKey }
    const gravity = pickGravityTarget(currentCell, counts)

    return {
      cells,
      coverage,
      currentCell,
      targetCell: gravity.targetCell,
      targetReason: gravity.reason,
      rows: MATRIX_ROWS,
      cols: MATRIX_COLS,
      cellKey,
    }
  }, [enginePreviewItems])

  const questionMatrix = useMemo(() => {
    const rows = [
      { key: 'A', labelPl: 'Świat / Środowisko', labelEn: 'World / Environment' },
      { key: 'B', labelPl: 'Produkt', labelEn: 'Product' },
      { key: 'C', labelPl: 'Elementy', labelEn: 'Elements' },
    ]
    const cols = [
      { key: 1, labelPl: 'Jak jest?', labelEn: 'As is' },
      { key: 2, labelPl: 'Co nie działa?', labelEn: 'Not working' },
      { key: 3, labelPl: 'Jak powinno być?', labelEn: 'Should be' },
    ]
    const counts: Record<string, number> = {}
    rows.forEach((row) => {
      cols.forEach((col) => {
        counts[`${row.key}${col.key}`] = 0
      })
    })
    enginePreviewItems.forEach((item) => {
      const cellId = getEntryCellId(item)
      if (!cellId) return
      counts[cellId] = (counts[cellId] || 0) + 1
    })
    const currentGroup = engineLastQuestionMeta?.group_code
      ? String(engineLastQuestionMeta.group_code).toUpperCase()
      : null
    const currentMode = Number(engineLastQuestionMeta?.mode_code ?? 0)
    const currentKey =
      currentGroup && ['A', 'B', 'C'].includes(currentGroup) && [1, 2, 3].includes(currentMode)
        ? `${currentGroup}${currentMode}`
        : null
    return { rows, cols, counts, currentKey }
  }, [enginePreviewItems, engineLastQuestionMeta])

  const getReportSessionSnapshot = (): ReportSnapshot => {
    const locale = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    const sessionNameCandidate =
      enginePreviewSessionName || engineSessionDetail?.session?.name || productName || ''
    const sessionName = sessionNameCandidate.trim() ? sessionNameCandidate.trim() : '—'
    const userNameCandidate =
      authSession?.user?.user_metadata?.full_name ||
      authSession?.user?.user_metadata?.name ||
      authSession?.user?.email ||
      ''
    const userName = String(userNameCandidate || '').trim() || '—'
    const reportIdeas = engineSessionDetail?.boardItems?.length
      ? engineSessionDetail.boardItems
      : enginePreviewItems
    const ideas = reportIdeas.map((item, index) => ({
      id: item.id || `idea-${index + 1}`,
      text: item.text,
      label: item.label ?? null,
      questionId: item.question_id ?? null,
      questionTextPl: item.question_text_pl ?? null,
      questionTextEn: item.question_text_en ?? null,
      matrixRow: item.matrix_row ?? null,
      matrixCol: item.matrix_col ?? null,
    }))
    const questions = Object.entries(engineAskedQuestionTextById).map(([id, text]) => ({
      id,
      text,
    }))
    const sourceUpdatedAt = reportIdeas.reduce(
      (max, item) => Math.max(max, Number(item.created_at || 0)),
      0
    )
    const sessionId = enginePreviewSessionId || engineSessionDetail?.session?.id || null
    const reportMeta = getReportMetaForSession(sessionId)
    const reportSnapshotMeta = reportMeta
      ? {
          createdAt: reportMeta.created_at ?? null,
          lastSummaryTextHash: reportMeta.lastSummaryTextHash ?? null,
          summary: reportMeta.summary ?? null,
          ideas: reportMeta.ideas ?? null,
          recommendations: reportMeta.recommendations ?? null,
        }
      : null
    return {
      sessionId,
      sessionName,
      date: new Date().toLocaleString(locale),
      userName,
      ideas,
      questions,
      sourceUpdatedAt,
      reportMeta: reportSnapshotMeta,
    }
  }


  const feedbackContext = useMemo(() => {
    const route = typeof window !== 'undefined' ? window.location.pathname : ''
    const sessionId = enginePreviewSessionId || undefined
    const matrixCell = isEnginePreview
      ? {
          row: debugMatrixData?.currentCell?.row ?? 'world',
          col: debugMatrixData?.currentCell?.col ?? 'as_is',
        }
      : undefined
    return { route, sessionId, matrixCell }
  }, [debugMatrixData, enginePreviewSessionId, isEnginePreview])

  const sendFeedbackEmail = async (sessionId: string | null) => {
    if (typeof window === 'undefined') return
    const trimmed = feedbackMessage.trim()
    if (trimmed.length < 10 || trimmed.length > 4000) {
      setFeedbackNotice({
        message:
          uiLanguage === 'English'
            ? 'Please enter at least 10 characters.'
            : 'Wpisz co najmniej 10 znaków.',
        variant: 'error',
      })
      return
    }
    if (feedbackCooldown > 0) {
      setFeedbackCooldown(0)
    }
    setFeedbackNotice(null)
    const to = 'arektest8@gmail.com'
    const subject = 'Feedback – makemyidea.work'
    const sessionName =
      enginePreviewSessionName || sessionId || feedbackContext.sessionId || ''
    const body = [
      'Feedback z aplikacji makemyidea.work',
      '',
      'Sesja:',
      sessionName || '—',
      '',
      'Treść feedbacku:',
      '--------------------------------',
      trimmed,
      '--------------------------------',
    ].join('\n')
    const mailtoUrl =
      `mailto:${to}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`
    window.location.href = mailtoUrl
  }

  useEffect(() => {
    if (!isDebugEnabled()) return
    if (!debugMatrixData) return
    const key = `${debugMatrixData.currentCell.row}:${debugMatrixData.currentCell.col}->${debugMatrixData.targetCell.row}:${debugMatrixData.targetCell.col}`
    if (lastGravitySuggestionRef.current === key) return
    lastGravitySuggestionRef.current = key
    console.log(
      JSON.stringify({
        event: 'gravity_suggestion_changed',
        currentCell: debugMatrixData.currentCell,
        targetCell: debugMatrixData.targetCell,
        reason: debugMatrixData.targetReason,
      })
    )
  }, [debugMatrixData])


  useEffect(() => {
    if (activeStep !== 3 || !selectedScenario || engineSessionId) return
    const createEngineSession = async () => {
      try {
        const response = await fetch(`${llmApiBase}/api/engine/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: productName.trim() || 'Workshop session' }),
        })
        if (!response.ok) {
        const msg = await response.text()
        throw new Error(msg || 'Request failed')
      }
        const data = (await response.json()) as { sessionId?: string }
        if (data.sessionId) setEngineSessionId(data.sessionId)
      } catch {
        setEngineSessionId(null)
      }
    }
    void createEngineSession()
  }, [activeStep, selectedScenario, engineSessionId, llmApiBase])

  useEffect(() => {
    if (loginCooldownSeconds <= 0) return
    const timer = window.setInterval(() => {
      setLoginCooldownSeconds((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [loginCooldownSeconds])

  useEffect(() => {
    if (feedbackCooldown <= 0) return
    const timer = window.setInterval(() => {
      setFeedbackCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [feedbackCooldown])

  useEffect(() => {
    if (!showLanding) return
    const sections = Array.from(document.querySelectorAll('.landing-section'))
    if (!sections.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
          }
        })
      },
      { threshold: 0.45 }
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [showLanding])

  useEffect(() => {
    if (!isIdeaGrid) return
    setShowLanding(false)
    setLandingView('main')
    setActiveStep(3)
  }, [isIdeaGrid])

  useEffect(() => {
    if (!showLanding) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'threeSteps') {
      setLandingView('threeSteps')
    }
  }, [showLanding])

  useEffect(() => {
    if (showLanding) return
    if (isEnginePreview) return
    console.info('[diag] top bar flags', {
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      normalizedPath,
      mode: import.meta.env.MODE,
      prod: import.meta.env.PROD,
      dev: import.meta.env.DEV,
      activeStep,
      isAuthed,
      isGuestMode: isGuest,
      aiSupportEnabled,
    })
  }, [showLanding, isEnginePreview, normalizedPath, activeStep, isAuthed, isGuest, aiSupportEnabled])


  const copy = useMemo(() => getTranslations(uiLanguage), [uiLanguage])
  const stepTitle = (stepId: StepId) => copy.steps[stepId]
  const stepHeading = (stepId: StepId) =>
    `${copy.stepLabel}${stepId} | ${stepTitle(stepId)}`
  const spaceLabelMap = {
    subsystem: copy.axisSubsystem,
    system: copy.axisSystem,
    supersystem: copy.axisSupersystem,
  }
  const timeLabelMap = {
    past: copy.axisPast,
    now: copy.axisNow,
    future: copy.axisFuture,
  }


  const feedbackReminderBanner =
    feedbackReminder?.visible && isEnginePreview ? (
      <div className="feedback-reminder" role="status">
        <span>{copy.feedbackReminderText}</span>
        <div className="feedback-reminder-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setFeedbackOpen(true)
              setFeedbackReminder((prev) => (prev ? { ...prev, visible: false } : prev))
            }}
          >
            {copy.feedbackReminderSend}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setFeedbackReminder((prev) => (prev ? { ...prev, visible: false } : prev))}
          >
            {copy.feedbackReminderDismiss}
          </button>
        </div>
      </div>
    ) : null

  const feedbackTrimmed = feedbackMessage.trim()
  const feedbackTooShort = feedbackTrimmed.length < 10
  const feedbackTooLong = feedbackTrimmed.length > 4000
  const feedbackDisabled =
    feedbackSending || feedbackCooldown > 0 || feedbackTooShort || feedbackTooLong

  const feedbackPanel = feedbackOpen ? (
    <div className="feedback-panel">
      <div className="feedback-panel-header">
        <h3>{copy.feedbackTitle}</h3>
        <button type="button" className="ghost" onClick={() => setFeedbackOpen(false)}>
          {copy.close}
        </button>
      </div>
      <div className="feedback-panel-body">
        <label>
          <span>{copy.feedbackMessageLabel}</span>
          <textarea
            value={feedbackMessage}
            onChange={(event) => setFeedbackMessage(event.target.value)}
            placeholder={copy.feedbackMessagePlaceholder}
            rows={5}
          />
        </label>
        <label className="sr-only" aria-hidden="true">
          <span>Website</span>
          <input
            type="text"
            value={feedbackHoneypot}
            onChange={(event) => setFeedbackHoneypot(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>
      <div className="feedback-panel-actions">
        <div className="feedback-panel-action-group">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void sendFeedbackEmail(null)
            }}
            disabled={feedbackDisabled}
          >
            {copy.feedbackSend}
          </button>
          <button type="button" className="ghost" onClick={() => setFeedbackOpen(false)}>
            {copy.close}
          </button>
        </div>
      </div>
      <div className="feedback-panel-body">
        {feedbackNotice && (
          <div className={`engine-notice engine-notice--${feedbackNotice.variant}`} role="status">
            {feedbackNotice.message}
          </div>
        )}
        {feedbackCooldown > 0 && (
          <div className="muted">
            {uiLanguage === 'English'
              ? `You can send another message in ${feedbackCooldown}s.`
              : `Możesz wysłać kolejną wiadomość za ${feedbackCooldown}s.`}
          </div>
        )}
        <div className="muted">{copy.feedbackPrivacyNote}</div>
      </div>
    </div>
  ) : null

  const feedbackFab = (
    <button type="button" className="feedback-fab" onClick={() => setFeedbackOpen(true)}>
      {copy.feedbackButtonLabel}
    </button>
  )


  const spaceSectionsStep2 = ['supersystem', 'system', 'subsystem'] as const
  const spaceSectionsStep3 = ['supersystem', 'system', 'subsystem'] as const

  const autosizeTextarea = (element: HTMLTextAreaElement | null) => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

const limitWords = (value: string, maxWords: number) => {
    const trimmed = value.trim()
    if (!trimmed) return value
    const words = trimmed.split(/\s+/)
    if (words.length <= maxWords) return value
    return words.slice(0, maxWords).join(' ')
  }

const applyTextEditClassification = (item: EngineBoardItem, nextText: string) => {
  const last = item.lastClassifiedText ?? null
  const dirty = !last || last !== nextText
  return { ...item, text: nextText, classificationDirty: dirty }
}

const normalizeBoardItem = (item: EngineBoardItem) => {
  const legacyRow = (item as { matrixRow?: string | null }).matrixRow ?? null
  const legacyCol = (item as { matrixCol?: string | null }).matrixCol ?? null
  const legacyCell = (item as { matrixCell?: string | null; cellCode?: string | null }).matrixCell ??
    (item as { cellCode?: string | null }).cellCode ??
    null
  let matrixRow = item.matrix_row ?? legacyRow ?? null
  let matrixCol = item.matrix_col ?? legacyCol ?? null
  if ((!matrixRow || !matrixCol) && legacyCell) {
    const mapped = cellCodeToMatrix(String(legacyCell))
    if (mapped?.matrix_row && mapped?.matrix_col) {
      matrixRow = mapped.matrix_row
      matrixCol = mapped.matrix_col
    }
  }
  return {
    ...item,
    label: item.label ?? null,
    matrix_row: matrixRow ?? null,
    matrix_col: matrixCol ?? null,
  }
}

const normalizeBoardItems = (items: EngineBoardItem[]) => items.map(normalizeBoardItem)

const safeLower = (value: unknown) => String(value ?? '').toLowerCase()

const toTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

const isMissingLabel = (item: EngineBoardItem) => {
  const label = String(item.label ?? '').trim()
  return !label || safeLower(label) === 'n/a'
}

  const countWords = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).length
  }

  const containsVaguePhrase = (value: string) => {
    const lowered = safeLower(value)
    return [
      'nie wiem',
      'trudno powiedzieć',
      'to zależy',
      'chyba',
      'w sumie',
    ].some((phrase) => lowered.includes(phrase))
  }

  const resetStuckSignals = () => {
    setEngineWeakSignals(0)
    setEngineMediumSignals(0)
    setEngineStrongSignals(0)
    setEngineLastWeakKind(null)
    setEngineLastMediumKind(null)
    setEngineLastStrongKind(null)
    engineIdleTriggered.current = false
  }

  const registerSignal = (level: 'weak' | 'medium' | 'strong', kind: string) => {
    if (level === 'weak') {
      setEngineWeakSignals((prev) => prev + 1)
      setEngineLastWeakKind(kind)
    } else if (level === 'medium') {
      setEngineMediumSignals((prev) => prev + 1)
      setEngineLastMediumKind(kind)
    } else {
      setEngineStrongSignals((prev) => prev + 1)
      setEngineLastStrongKind(kind)
    }
  }

  useEffect(() => {
    let cancelled = false

    const applyOptions = (worlds: string[], elements: string[], times: string[]) => {
      if (cancelled) return
      setSpaceOptions([
        ...worlds.map((label, index) => ({ id: index, label, kind: 'world' as const })),
        ...elements.map((label, index) => ({
          id: index + worlds.length,
          label,
          kind: 'element' as const,
        })),
      ])
      setTimeOptions(times.map((label, index) => ({ id: index, label })))
    }

    const fallbackWorlds = buildWorldSuggestions(productName, copy).slice(0, 10)
    const fallbackElements = buildElementSuggestions(productName, copy, reportLanguage).slice(0, 10)
    const fallbackTimes = buildTimeSuggestions(productName, copy)

    if (!productName.trim() || llmStatus !== 'online') {
      applyOptions(fallbackWorlds, fallbackElements, fallbackTimes)
      return () => {
        cancelled = true
      }
    }

    const requestOptions = async () => {
      try {
        const [spaceRes, timeRes] = await Promise.all([
          fetch(`${llmApiBase}/api/generate?action=space-options`, {
            method: 'POST',
            headers: llmHeaders,
            body: JSON.stringify({
              productName: productName.trim(),
              description: productDescription.trim(),
              worldCount: 10,
              elementCount: 10,
              language: reportLanguage,
              sessionId: enginePreviewSessionId || engineSessionId || undefined,
            }),
          }),
          fetch(`${llmApiBase}/api/generate?action=time-options`, {
            method: 'POST',
            headers: llmHeaders,
            body: JSON.stringify({
              productName: productName.trim(),
              count: 15,
              language: reportLanguage,
              sessionId: enginePreviewSessionId || engineSessionId || undefined,
            }),
          }),
        ])

        if (!spaceRes.ok || !timeRes.ok) throw new Error('Request failed')
        const spaceData = (await spaceRes.json()) as {
          ok?: boolean
          data?: { worldOptions?: string[]; elementOptions?: string[] }
          meta?: { modelUsed?: string | null; aiSupportEnabled?: boolean }
        }
        const timeData = (await timeRes.json()) as {
          ok?: boolean
          data?: { options?: string[] }
          meta?: { modelUsed?: string | null; aiSupportEnabled?: boolean }
        }
        const worldOptions = spaceData?.data?.worldOptions
        const elementOptions = spaceData?.data?.elementOptions
        const timeOptions = timeData?.data?.options
        if (!Array.isArray(worldOptions) || !Array.isArray(elementOptions) || !Array.isArray(timeOptions)) {
          throw new Error('Invalid response')
        }
        const meta = spaceData.meta || timeData.meta
        applyUsageModel(meta)
        void applyUsageToSession(meta, enginePreviewSessionId)
        const nextWorlds = uniqueList(worldOptions).slice(0, 10)
        const nextElements = uniqueList(elementOptions).slice(0, 10)
        const nextTimes = uniqueList(timeOptions).slice(0, 20)
        const needsPolishFallback = reportLanguage === 'Polish'
        const needsEnglishFallback = reportLanguage === 'English'
        const worldsOut =
          (needsPolishFallback && looksEnglish(nextWorlds)) ||
          (needsEnglishFallback && looksPolish(nextWorlds))
            ? fallbackWorlds
            : nextWorlds
        const elementsOut =
          (needsPolishFallback && looksEnglish(nextElements)) ||
          (needsEnglishFallback && looksPolish(nextElements))
            ? fallbackElements
            : nextElements
        const timesOut =
          (needsPolishFallback && looksEnglish(nextTimes)) ||
          (needsEnglishFallback && looksPolish(nextTimes))
            ? fallbackTimes
            : nextTimes
        applyOptions(
          worldsOut.length ? worldsOut : fallbackWorlds,
          elementsOut.length ? elementsOut : fallbackElements,
          timesOut.length ? timesOut : fallbackTimes
        )
      } catch {
        applyOptions(fallbackWorlds, fallbackElements, fallbackTimes)
      }
    }

    void requestOptions()

    return () => {
      cancelled = true
    }
  }, [productName, productDescription, copy, llmStatus, llmApiBase, reportLanguage, llmHeaders])

  useEffect(() => {
    setProductConfirmed(false)
  }, [productName])

  useEffect(() => {
    setProductDescriptionConfirmed(false)
    setProductNameSuggestions([])
  }, [productDescription])

  const requestNameSuggestions = async () => {
    const description = productDescription.trim()
    if (!description) return

    setProductDescriptionConfirmed(true)

    if (llmStatus !== 'online') {
      setProductNameSuggestions(buildNameSuggestions(description, productName))
      return
    }

    try {
      const response = await fetch(`${llmApiBase}/api/generate?action=names`, {
        method: 'POST',
        headers: llmHeaders,
        body: JSON.stringify({
          description,
          count: 5,
          sessionId: enginePreviewSessionId || engineSessionId || undefined,
        }),
      })
      if (!response.ok) {
        const msg = await response.text()
        throw new Error(msg || 'Request failed')
      }
      const data = (await response.json()) as {
        ok?: boolean
        data?: { names?: string[] }
        meta?: { modelUsed?: string | null; aiSupportEnabled?: boolean }
      }
      const names = data?.data?.names
      if (!Array.isArray(names) || names.length === 0) {
        throw new Error('Invalid response')
      }
      setProductNameSuggestions(names)
      applyUsageModel(data.meta)
      void applyUsageToSession(data.meta, enginePreviewSessionId)
    } catch {
      setProductNameSuggestions(buildNameSuggestions(description, productName))
    }
  }

  const spaceOptionMap = useMemo(
    () => new Map(spaceOptions.map((option) => [option.id, option])),
    [spaceOptions]
  )
  const timeOptionMap = useMemo(
    () => new Map(timeOptions.map((option) => [option.id, option.label])),
    [timeOptions]
  )

  const assignedSpaceIds = useMemo(
    () =>
      Object.values(spaceAssignments).filter((id): id is number => typeof id === 'number'),
    [spaceAssignments]
  )
  const assignedTimeIds = useMemo(
    () =>
      Object.values(timeAssignments).filter((id): id is number => typeof id === 'number'),
    [timeAssignments]
  )

  const areSpaceSlotsComplete = useMemo(
    () => Object.values(spaceAssignments).every((id) => typeof id === 'number'),
    [spaceAssignments]
  )
  const areTimeSlotsComplete = useMemo(
    () => Object.values(timeAssignments).every((id) => typeof id === 'number'),
    [timeAssignments]
  )

  const finalSpaces = useMemo(
    () =>
      assignedSpaceIds
        .map((id) => spaceOptionMap.get(id)?.label)
        .filter((value): value is string => Boolean(value)),
    [assignedSpaceIds, spaceOptionMap]
  )

  const finalTimes = useMemo(
    () =>
      assignedTimeIds
        .map((id) => timeOptionMap.get(id))
        .filter((value): value is string => Boolean(value)),
    [assignedTimeIds, timeOptionMap]
  )

  useEffect(() => {
    if (!productConfirmed || !areSpaceSlotsComplete || !areTimeSlotsComplete) {
      setScenarios([])
      setSelectedScenarioId(null)
      return
    }

    const supersystemId = spaceAssignments.supersystem as number
    const subsystemId = spaceAssignments.subsystem as number
    const pastId = timeAssignments.past as number
    const nowId = timeAssignments.now as number
    const futureId = timeAssignments.future as number

    const supersystemLabel = spaceOptionMap.get(supersystemId)?.label || copy.notSelected
    const subsystemLabel = spaceOptionMap.get(subsystemId)?.label || copy.notSelected

    const scenario: Scenario = {
      id: `scenario-${supersystemId}-${subsystemId}-${pastId}-${nowId}-${futureId}`,
      spaceId: supersystemId,
      timeId: nowId,
      spaceDefs: {
        subsystem: subsystemLabel,
        system: productName || copy.analyzedProduct,
        supersystem: supersystemLabel,
      },
      timeDefs: {
        past: timeOptionMap.get(pastId) || copy.notSelected,
        now: timeOptionMap.get(nowId) || copy.notSelected,
        future: timeOptionMap.get(futureId) || copy.notSelected,
      },
    }

    setScenarios([scenario])
    setSelectedScenarioId(scenario.id)
  }, [
    productName,
    areSpaceSlotsComplete,
    areTimeSlotsComplete,
    spaceAssignments,
    timeAssignments,
    copy,
    spaceOptionMap,
    timeOptionMap,
  ])



  const handleDragStart = (
    event: React.DragEvent<HTMLElement>,
    type: 'space' | 'time',
    id: number
  ) => {
    event.dataTransfer.setData('application/json', JSON.stringify({ type, id }))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleNameDragStart = (event: React.DragEvent<HTMLElement>, name: string) => {
    event.dataTransfer.setData('text/plain', name)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleLabelDragStart = (event: React.DragEvent<HTMLElement>, labelId: string | null) => {
    event.dataTransfer.setData('application/label', labelId ?? '')
    event.dataTransfer.effectAllowed = 'move'
  }

  const labelPalette = [
    '#f6b8a2',
    '#f4d6a0',
    '#b9e3c6',
    '#b7d9f4',
    '#c7b6f2',
    '#f2b7d6',
    '#cfe8a8',
    '#a8e1e8',
    '#f2c5e8',
    '#f2a7c2',
  ]

  const getNextLabelColor = (labels: LabelItem[]) => {
    const used = new Set(labels.map((label) => label.color))
    return labelPalette.find((color) => !used.has(color)) || '#e7ebf0'
  }

  const getLabelById = (labelId: string | null) =>
    labelId ? ideaLabels.find((label) => label.id === labelId) || null : null

  const getLabelForIdea = (ideaId: string) => {
    const labelId = ideaLabelAssignments[ideaId]
    return getLabelById(labelId)
  }

  const allowDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const readDragPayload = (event: React.DragEvent<HTMLElement>) => {
    const raw = event.dataTransfer.getData('application/json')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as { type?: string; id?: number }
      if ((parsed.type !== 'space' && parsed.type !== 'time') || typeof parsed.id !== 'number') {
        return null
      }
      return parsed as { type: 'space' | 'time'; id: number }
    } catch {
      return null
    }
  }

  const handleDropOnSpace = (slot: SpaceSlot) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const payload = readDragPayload(event)
    if (!payload || payload.type !== 'space') return
    const optionKind = spaceOptionMap.get(payload.id)?.kind
    if (optionKind && optionKind !== SPACE_KIND_FOR_SLOT[slot]) {
      return
    }
    setSpaceAssignments((prev) => {
      const next = { ...prev }
      ;(Object.keys(next) as SpaceSlot[]).forEach((key) => {
        if (next[key] === payload.id) next[key] = null
      })
      next[slot] = payload.id
      return next
    })
  }

  const handleDropOnTime = (slot: TimeSlot) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const payload = readDragPayload(event)
    if (!payload || payload.type !== 'time') return
    setTimeAssignments((prev) => {
      const next = { ...prev }
      ;(Object.keys(next) as TimeSlot[]).forEach((key) => {
        if (next[key] === payload.id) next[key] = null
      })
      next[slot] = payload.id
      return next
    })
  }

  const updateScenarioSpaceDef = (key: keyof Scenario['spaceDefs'], value: string) => {
    setScenarios((prev) =>
      prev.map((scenario) =>
        scenario.id === selectedScenarioId
          ? {
              ...scenario,
              spaceDefs: {
                ...scenario.spaceDefs,
                [key]: value,
              },
            }
          : scenario
      )
    )
  }

  const updateScenarioTimeDef = (key: keyof Scenario['timeDefs'], value: string) => {
    setScenarios((prev) =>
      prev.map((scenario) =>
        scenario.id === selectedScenarioId
          ? {
              ...scenario,
              timeDefs: {
                ...scenario.timeDefs,
                [key]: value,
              },
            }
          : scenario
      )
    )
  }

  const addLlmIdeas = async () => {
    if (!selectedScenario) return
    const fallback = () => {
      setWorkshopIdeas((prev) => {
        const next: Record<string, Idea[]> = {}
        spaceSections.forEach((spaceKey) => {
          timeSections.forEach((timeKey) => {
            const cellKey = `${spaceKey}-${timeKey}`
            const spaceDef = selectedScenario.spaceDefs[spaceKey]
            const timeDef = selectedScenario.timeDefs[timeKey]
            const ideas: Idea[] = []
            for (let i = 0; i < 3; i += 1) {
              ideas.push({
                id: `llm-${cellKey}-${Date.now()}-${i}`,
                text: copy.llmIdeaTemplate(spaceDef, timeDef),
                source: 'llm',
              })
            }
            next[cellKey] = [...(prev[cellKey] || []), ...ideas]
          })
        })
        return next
      })
    }

    if (llmStatus !== 'online') {
      fallback()
      return
    }

    try {
      const cells = spaceSections.flatMap((spaceKey) =>
        timeSections.map((timeKey) => ({
          id: `${spaceKey}-${timeKey}`,
          spaceDef: selectedScenario.spaceDefs[spaceKey],
          timeDef: selectedScenario.timeDefs[timeKey],
        }))
      )
      const response = await fetch(`${llmApiBase}/api/generate?action=ideas`, {
        method: 'POST',
        headers: llmHeaders,
        body: JSON.stringify({
          productName: productName || copy.analyzedProduct,
          ideasPerCell: 3,
          cells,
          sessionId: enginePreviewSessionId || engineSessionId || undefined,
        }),
      })
      if (!response.ok) {
        const msg = await response.text()
        throw new Error(msg || 'Request failed')
      }
      const data = (await response.json()) as {
        ok?: boolean
        data?: { ideas?: Record<string, string[]> }
        meta?: { modelUsed?: string | null; aiSupportEnabled?: boolean }
      }
      const ideas = data?.data?.ideas
      if (!ideas) throw new Error('Invalid response')
      applyUsageModel(data.meta)
      void applyUsageToSession(data.meta, enginePreviewSessionId)

      setWorkshopIdeas((prev) => {
        const next: Record<string, Idea[]> = { ...prev }
        Object.entries(ideas || {}).forEach(([cellKey, ideaList]) => {
          const mapped = (ideaList || []).map((text, index) => ({
            id: `llm-${cellKey}-${Date.now()}-${index}`,
            text,
            source: 'llm' as const,
          }))
          next[cellKey] = [...(prev[cellKey] || []), ...mapped]
        })
        return next
      })
    } catch {
      fallback()
    }
  }

  const requestImpulse = async () => {
    if (isSuggestLoading) return
    if (!engineSessionPersisted || !enginePreviewSessionId) {
      showEngineNotice('Najpierw utwórz sesję.', 'error')
      return
    }
    if (suggestDiagEnabled) {
      console.log('[suggest][client] preflight', {
        source: 'impulse',
        sessionId: enginePreviewSessionId,
        sessionPersisted: engineSessionPersisted,
      })
    }
    setIsSuggestLoading(true)
    setShowSuggestLoadingUI(false)
    setImpulseQuestion(null)
    setImpulseSource(null)
    setImpulseOpen(true)
    if (suggestLoadingTimerRef.current) {
      window.clearTimeout(suggestLoadingTimerRef.current)
    }
    suggestLoadingTimerRef.current = window.setTimeout(() => {
      setShowSuggestLoadingUI(true)
    }, 300)
    const boardItems = Object.values(workshopIdeas)
      .flat()
      .map((idea) => ({ type: 'idea', text: idea.text }))
    const endpoint = '/api/coach/suggest'
    const sessionName = enginePreviewSessionName || productName || ''
    const language = reportLanguage === 'English' ? 'en' : 'pl'
    const boardEntries = boardItems.map((item, index) => ({
      id: `idea-${index}`,
      text: item.text,
    }))
    console.log('[suggest] sessionId', { sessionId: enginePreviewSessionId })
    if (import.meta.env.DEV) {
      console.log('[ai] suggest request', {
        aiSupportEnabled,
        sessionName,
        entriesCount: boardEntries.length,
        matrixId: selectedScenarioId || null,
        lang: language,
      })
      console.log('[ai] suggest payload', {
        sessionId: enginePreviewSessionId,
        sessionName,
        entries: boardEntries.length,
        sample: boardEntries.slice(0, 3),
      })
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: llmHeaders,
        body: JSON.stringify({
          currentUserId: authSession?.user?.id ?? null,
          sessionId: enginePreviewSessionId,
          sessionName,
          boardEntries,
          language,
          matrix: selectedScenario
            ? {
                scenarioId: selectedScenarioId,
                spaceDefs: selectedScenario.spaceDefs,
                timeDefs: selectedScenario.timeDefs,
              }
            : null,
        }),
      })
      const rawText = await response.text()
      let data:
        | {
            ok?: boolean
            question?: AiQuestion | string | null
            data?: {
              question?: AiQuestion | string | null
              questions?: AiQuestion[]
            }
            meta?: LlmUsageMeta
            groundedCount?: number
          }
        | null = null
      try {
        data = JSON.parse(rawText)
      } catch {
        data = null
      }
      if (!response.ok || !data || data.ok === false) {
        setEngineApiDebug(
          import.meta.env.VITE_DEBUG_ENGINE === '1'
            ? { endpoint, status: response.status, response: data, rawText }
            : null
        )
        throw new Error('Request failed')
      }
      const normalized = normalizeSuggestResponse(data)
      if (import.meta.env.DEV) {
        console.log('[ai] suggest response', data)
        console.log('[ai] suggest normalized', normalized)
      }
      applyUsageModel(data.meta)
      void applyUsageToSession(data.meta, enginePreviewSessionId)
      setImpulseSource(normalized.labelType === 'fallback' ? 'fallback' : 'llm')
      if (typeof data?.groundedCount === 'number') {
        setLastLlmGroundedCount(data.groundedCount)
      }
      if (normalized.questions.length) {
        setLastLlmGroundedIn(normalized.questions[0]?.grounded_in ?? null)
        setLastLlmWhy(normalized.questions[0]?.why_this_question ?? null)
      } else if (normalized.questionObj) {
        setLastLlmGroundedIn(normalized.questionObj.grounded_in ?? null)
        setLastLlmWhy(normalized.questionObj.why_this_question ?? null)
      }
      if (normalized.questionText) {
        setImpulseQuestion(normalized.questionText)
        if (import.meta.env.DEV) {
          console.log('[ai] suggest state', {
            questionText: normalized.questionText,
            labelType: normalized.labelType,
          })
        }
      } else {
        setImpulseQuestion(null)
      }
    } catch {
      setImpulseQuestion(null)
    }
    if (suggestLoadingTimerRef.current) {
      window.clearTimeout(suggestLoadingTimerRef.current)
      suggestLoadingTimerRef.current = null
    }
    setShowSuggestLoadingUI(false)
    setIsSuggestLoading(false)
  }

  const keepOnlyUserIdeas = () => {
    setWorkshopIdeas((prev) => {
      const next: Record<string, Idea[]> = {}
      Object.entries(prev).forEach(([cellKey, ideas]) => {
        const filtered = ideas.filter((idea) => idea.source === 'user')
        if (filtered.length) next[cellKey] = filtered
      })
      return next
    })
    setIdeaLabelAssignments((prev) => {
      const next: Record<string, string | null> = {}
      Object.entries(prev).forEach(([ideaId, labelId]) => {
        if (ideaId.startsWith('user-')) {
          next[ideaId] = labelId
        }
      })
      return next
    })
  }

  const reportData = useMemo(() => {
    const step1 = {
      productName,
      spaces: finalSpaces,
      times: finalTimes,
    }

    const selectedScenarioLabel = selectedScenario
      ? copy.cellLabel(
          spaceOptionMap.get(selectedScenario.spaceId)?.label || copy.notSelected,
          timeOptionMap.get(selectedScenario.timeId) || copy.notSelected
        )
      : null

    const step2 = {
      totalScenarios: scenarios.length,
      selectedScenario: selectedScenarioLabel,
    }

    const step3 = selectedScenario
      ? {
          spaceDefs: selectedScenario.spaceDefs,
          timeDefs: selectedScenario.timeDefs,
        }
      : null

    const allIdeas = Object.values(workshopIdeas).flat()
    const totalIdeas = allIdeas.length
    const step4 = {
      totalIdeas,
      cellsWithIdeas: Object.values(workshopIdeas).filter((ideas) => ideas.length > 0).length,
      userIdeas: allIdeas.filter((idea) => idea.source === 'user').map((idea) => idea.text),
      llmIdeas: allIdeas.filter((idea) => idea.source === 'llm').map((idea) => idea.text),
    }

    const step4Report = {
      language: reportLanguage,
    }

    return { step1, step2, step3, step4, step4Report }
  }, [productName, finalSpaces, finalTimes, scenarios.length, selectedScenario, workshopIdeas, reportLanguage])

  const canProceedToStep2 =
    productConfirmed && areSpaceSlotsComplete && areTimeSlotsComplete

  const canProceedToStep3 = selectedScenarioId !== null
  const openMainLanding = () => {
    setLandingView('main')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const fetchJsonWithDiagnostics = async (url: string, options: RequestInit) => {
    const response = await fetch(url, options)
    const contentType = response.headers.get('content-type') || ''
    const raw = await response.text()
    let json: unknown = null
    let parseError: string | null = null
    try {
      json = JSON.parse(raw)
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error)
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      raw: raw.slice(0, 300),
      json,
      parseError,
      url,
    }
  }

  const activateFacilitationPrompt = async (type: FacilitationType, retryCount = 0) => {
    if (!engineSessionPersisted || !enginePreviewSessionId) {
      setEngineFacilitationInlineError('Najpierw utwórz sesję.')
      return
    }
    if (suggestDiagEnabled) {
      console.log('[suggest][client] preflight', {
        source: 'facilitation',
        sessionId: enginePreviewSessionId,
        sessionPersisted: engineSessionPersisted,
      })
    }
    if (!enginePreviewSessionId) return
    if (engineFacilitationLoading) return
    setEngineFacilitationLoading(true)
    setEngineFacilitationLoadingType(type)
    setLastFacilitationType(type)
    setShowEngineFacilitationLoadingUI(false)
    setEngineActivePrompt(null)
    setEnginePromptSource(null)
    if (engineFacilitationLoadingTimerRef.current) {
      window.clearTimeout(engineFacilitationLoadingTimerRef.current)
    }
    engineFacilitationLoadingTimerRef.current = window.setTimeout(() => {
      setShowEngineFacilitationLoadingUI(true)
    }, 300)
    setEnginePreviewError(null)
    setEngineFacilitationDiagnostics(null)
    const endpoint = '/api/coach/suggest'
    const context = getSessionContext(enginePreviewSessionId)
    console.log('[suggest] sessionId', { sessionId: context.sessionId })
    const boardEntries = context.boardEntries
    const sessionName = context.sessionName
    const language = context.language
    const matrixId =
      context.matrixContext?.group_code && context.matrixContext?.mode_code
        ? `${context.matrixContext.group_code}${context.matrixContext.mode_code}`
        : null
    if (import.meta.env.DEV) {
      console.log('[ai] suggest request', {
        aiSupportEnabled,
        sessionName,
        entriesCount: boardEntries.length,
        matrixId,
        lang: language,
      })
      console.log('[ai] suggest payload', {
        sessionId: context.sessionId,
        sessionName,
        entries: boardEntries.length,
        sample: boardEntries.slice(0, 3),
      })
    }
    if (!aiSupportEnabled && import.meta.env.DEV) {
      console.log('[ai] LLM skipped: aiSupport=off')
    }
    try {
      const result = await fetchJsonWithDiagnostics(endpoint, {
        method: 'POST',
        headers: llmHeaders,
        body: JSON.stringify({
          currentUserId: authSession?.user?.id ?? null,
          sessionId: context.sessionId,
          sessionName,
          language,
          action: type,
          askedIds: engineAskedQuestionIds,
          askedTexts: engineAskedQuestionTexts,
          lastQuestionText: engineLastQuestionText,
          recentCells: engineRecentCells,
          previousGroupCode: enginePrevQuestionMeta?.group_code ?? null,
          previousModeCode: enginePrevQuestionMeta?.mode_code ?? null,
          currentGroupCode: engineLastQuestionMeta?.group_code ?? null,
          currentModeCode: engineLastQuestionMeta?.mode_code ?? null,
          boardEntries,
          matrixContext: context.matrixContext,
          userRequest: { type: 'facilitation_question' },
        }),
      })
      const data = result.json as
        | {
            ok?: boolean
            question?: AiQuestion | string | null
            data?: {
              question?: AiQuestion | string | null
              questions?: AiQuestion[]
            }
            meta?: LlmUsageMeta
            groundedCount?: number
          }
        | null
      if (!result.ok || !data || data.ok === false) {
        setEngineFacilitationDiagnostics(result)
        throw new Error('Request failed')
      }
      const normalized = normalizeSuggestResponse(data)
      if (import.meta.env.DEV) {
        console.log('[ai] facilitation response', data)
        console.log('[ai] facilitation normalized', normalized)
      }
      applyUsageModel(data.meta)
      void applyUsageToSession(data.meta, enginePreviewSessionId)
      const baseQuestionId = normalized.questions.length
        ? normalized.questions[0]?.id
        : normalized.questionObj?.id
      console.log('[facilitation] rewrite', {
        base_question_id: baseQuestionId ?? null,
        llm_called: true,
        raw_question_shown: false,
        model_used: data.meta?.modelUsed ?? null,
        items_count: boardEntries.length,
      })
      logFacilitationEvent('facilitation_rewrite', {
        base_question_id: baseQuestionId ?? null,
        llm_called: true,
        raw_question_shown: false,
        model_used: data.meta?.modelUsed ?? null,
        items_count: boardEntries.length,
      })
      if (normalized.labelType !== 'ai') {
        setEnginePromptSource(null)
        setEngineActivePrompt(null)
        setEngineUiState('FREE_FLOW')
        setEngineOfferReason(null)
        setEnginePreviewError(copy.engineFacilitationRetryMessage)
        return
      }
      setEnginePromptSource('llm')
      if (typeof data?.groundedCount === 'number') {
        setLastLlmGroundedCount(data.groundedCount)
      }
      if (normalized.questions.length) {
        setLastLlmGroundedIn(normalized.questions[0]?.grounded_in ?? null)
        setLastLlmWhy(normalized.questions[0]?.why_this_question ?? null)
      } else if (normalized.questionObj) {
        setLastLlmGroundedIn(normalized.questionObj.grounded_in ?? null)
        setLastLlmWhy(normalized.questionObj.why_this_question ?? null)
      }
      if (!normalized.questionText) {
        setEngineFacilitationDiagnostics(result)
        setEngineActivePrompt(null)
        setEngineUiState('FREE_FLOW')
        setEngineOfferReason(null)
        setEnginePreviewError(copy.engineFacilitationRetryMessage)
        return
      }
      if (engineActivePrompt?.text && normalized.questionText === engineActivePrompt.text && retryCount < 1) {
        if (import.meta.env.DEV) {
          console.log('[ai] facilitation duplicate, retrying once', {
            text: normalized.questionText,
          })
        }
        setTimeout(() => {
          void activateFacilitationPrompt(type, retryCount + 1)
        }, 0)
        return
      }
      setEngineApiDebug(import.meta.env.VITE_DEBUG_ENGINE === '1' ? {
        endpoint,
        status: result.status,
        response: data,
        rawText: result.raw,
      } : null)
      const questionText = normalized.questionText
      if (!questionText) {
        if (import.meta.env.DEV) {
          console.warn('[ai] facilitation missing questionText')
        }
        setEngineActivePrompt(null)
        setEngineUiState('FREE_FLOW')
        setEngineOfferReason(null)
        setEnginePreviewError(copy.engineFacilitationRetryMessage)
        return
      }
      setEngineActivePrompt({ type, text: questionText })
      if (import.meta.env.DEV) {
        console.log('[ai] facilitation state', {
          questionText,
          labelType: normalized.labelType,
        })
      }
      setEngineLastQuestionText(questionText)
      setEngineAskedQuestionTexts((prev) => {
        if (prev.includes(questionText)) return prev
        return [...prev, questionText]
      })
      setEnginePreviewInput('')
      enginePreviousInput.current = ''
      setEngineUiState('FACILITATED_INPUT')
      setEngineOfferReason(null)
      logFacilitationEvent('facilitation_used', {
        sessionId: enginePreviewSessionId || 'unknown',
        action: type,
        promptText: normalized.questionText,
      })
      const questionId = normalized.questions.length
        ? normalized.questions[0]?.id
        : normalized.questionObj?.id
      if (questionId) {
        setEngineAskedQuestionTextById((prev) => ({
          ...prev,
          [questionId]: questionText,
        }))
        const questionMeta = normalized.questions.length
          ? normalized.questions[0]
          : normalized.questionObj
        const hasMatrixMeta = Boolean(questionMeta?.group_code || questionMeta?.mode_code)
        const inferredCell = !hasMatrixMeta && normalized.questionText
          ? mapEntryToCell(normalized.questionText, uiLanguage)
          : null
        const fallbackGroup: string | undefined = inferredCell
          ? inferredCell.row === 'world'
            ? 'A'
            : inferredCell.row === 'product'
              ? 'B'
              : 'C'
          : undefined
        const fallbackMode: number | undefined = inferredCell
          ? inferredCell.col === 'as_is'
            ? 1
            : inferredCell.col === 'not_working'
              ? 2
              : 3
          : undefined
        setEngineLastQuestionMeta({
          id: questionId,
          group_code: normalized.questions.length
            ? normalized.questions[0]?.group_code ?? fallbackGroup
            : normalized.questionObj?.group_code ?? fallbackGroup,
          mode_code: normalized.questions.length
            ? normalized.questions[0]?.mode_code ?? fallbackMode
            : normalized.questionObj?.mode_code ?? fallbackMode,
        })
        setEnginePrevQuestionMeta(engineLastQuestionMeta)
        const recentGroup =
          (normalized.questions.length
            ? normalized.questions[0]?.group_code ?? fallbackGroup
            : normalized.questionObj?.group_code ?? fallbackGroup) || undefined
        const recentMode =
          (normalized.questions.length
            ? normalized.questions[0]?.mode_code ?? fallbackMode
            : normalized.questionObj?.mode_code ?? fallbackMode) || undefined
        if (recentGroup && recentMode) {
          const key = `${recentGroup}:${recentMode}`
          setEngineRecentCells((prev) => {
            const next = [key, ...prev.filter((cell) => cell !== key)]
            return next.slice(0, 5)
          })
        }
        setEngineAskedQuestionIds((prev) =>
          prev.includes(questionId) ? prev : [...prev, questionId]
        )
        if (questionMeta?.group_code || questionMeta?.mode_code || inferredCell) {
          setEngineAskedQuestionMeta((prev) => ({
            ...prev,
            [questionId]: {
              group_code: questionMeta?.group_code ?? fallbackGroup ?? undefined,
              mode_code: questionMeta?.mode_code ?? fallbackMode ?? undefined,
            },
          }))
        }
      } else {
        const questionMeta = normalized.questions.length
          ? normalized.questions[0]
          : normalized.questionObj
        const hasMatrixMeta = Boolean(questionMeta?.group_code || questionMeta?.mode_code)
        const inferredCell = !hasMatrixMeta && normalized.questionText
          ? mapEntryToCell(normalized.questionText, uiLanguage)
          : null
        const fallbackGroup: string | undefined = inferredCell
          ? inferredCell.row === 'world'
            ? 'A'
            : inferredCell.row === 'product'
              ? 'B'
              : 'C'
          : undefined
        const fallbackMode: number | undefined = inferredCell
          ? inferredCell.col === 'as_is'
            ? 1
            : inferredCell.col === 'not_working'
              ? 2
              : 3
          : undefined
        if (questionMeta?.group_code || questionMeta?.mode_code || inferredCell) {
          const syntheticId = `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`
          setEngineAskedQuestionMeta((prev) => ({
            ...prev,
            [syntheticId]: {
              group_code: questionMeta?.group_code ?? fallbackGroup ?? undefined,
              mode_code: questionMeta?.mode_code ?? fallbackMode ?? undefined,
            },
          }))
        }
      }
      resetStuckSignals()
    } catch (error) {
      console.log('[facilitation] rewrite failed', {
        llm_called: true,
        raw_question_shown: false,
        items_count: context.boardEntries.length,
        error: error instanceof Error ? error.message : String(error),
      })
      logFacilitationEvent('facilitation_rewrite_failed', {
        llm_called: true,
        raw_question_shown: false,
        items_count: context.boardEntries.length,
        error: error instanceof Error ? error.message : String(error),
      })
      setEngineActivePrompt(null)
      setEngineUiState('FREE_FLOW')
      setEngineOfferReason(null)
      setEnginePreviewError(copy.engineFacilitationRetryMessage)
      setEnginePromptSource(null)
    } finally {
      if (engineFacilitationLoadingTimerRef.current) {
        window.clearTimeout(engineFacilitationLoadingTimerRef.current)
        engineFacilitationLoadingTimerRef.current = null
      }
      setShowEngineFacilitationLoadingUI(false)
      setEngineFacilitationLoading(false)
      setEngineFacilitationLoadingType(null)
    }
  }

  const handleEnginePreviewInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const rawNext = event.target.value
    const prev = enginePreviewInput
    const nextWordCount = countWords(rawNext)
    const isDeletion = rawNext.length < prev.length
    if (nextWordCount > WORD_LIMIT && !isDeletion) {
      return
    }
    const next = limitWords(rawNext, WORD_LIMIT)
    setEnginePreviewInput(next)
    setEngineLastInputActivityAt(Date.now())
    engineIdleTriggered.current = false

    if (engineOfferReason) {
      logFacilitationEvent('facilitation_ignored', {
        sessionId: enginePreviewSessionId || 'unknown',
        reason: engineOfferReason || resolveOfferReason(),
      })
      setEngineOfferReason(null)
      if (engineUiState === 'FACILITATION_OFFER') {
        setEngineUiState('FREE_FLOW')
      }
    }

    if (engineEraseTimer.current) {
      window.clearTimeout(engineEraseTimer.current)
      engineEraseTimer.current = null
    }

    const prevInput = enginePreviousInput.current
    enginePreviousInput.current = next

    if (prevInput.trim() && !next.trim()) {
      engineEraseTimer.current = window.setTimeout(() => {
        if (engineInputFocused && !enginePreviousInput.current.trim()) {
          registerSignal('strong', 'erase')
        }
      }, ERASE_EMPTY_SECONDS_STRONG * 1000)
    }
  }

  const ensureEnginePreviewSession = async (
    nameOverride?: string,
    options?: { onNameCollision?: () => void; onInsertError?: () => void }
  ) => {
    if (enginePreviewSessionId) return enginePreviewSessionId
    const name = (nameOverride ?? enginePreviewSessionName)?.trim()
    if (!name) {
      showEngineNotice('Podaj nazwę sesji.', 'error')
      return null
    }
    try {
      if (authSession?.user?.id && client) {
        const { data: u } = await client.auth.getUser()
        const userId = u?.user?.id ?? null
        if (!userId) {
          showEngineNotice('Sesja logowania wygasła. Zaloguj się ponownie.', 'error')
          return null
        }
        const normalizedName = name.trim().toLowerCase()
        const { data: existingByName, error: nameCheckError } = await client
          .from('sessions')
          .select('id,name')
          .eq('user_id', userId)
        if (nameCheckError) {
          const message =
            (nameCheckError as { message?: string | null })?.message ?? 'Request failed'
          showEngineNotice(`Nie udało się sprawdzić nazwy sesji. ${message}`, 'error')
          return null
        }
        const hasCollision = Boolean(
          (existingByName || []).some((row) => {
            const dbName = String((row as { name?: string | null }).name ?? '')
              .trim()
              .toLowerCase()
            return dbName === normalizedName
          })
        )
        console.log('[createSession] nameCollision', hasCollision)
        if (hasCollision) {
          options?.onNameCollision?.()
          return null
        }
        if (typeof crypto === 'undefined' || !('randomUUID' in crypto)) {
          showEngineNotice('Nie udało się wygenerować ID sesji.', 'error')
          return null
        }
        const sessionId = crypto.randomUUID()
        console.log('[createSession]', { sessionId, userId, nameToSave: name })
        const { error: insertSessionError } = await client
          .schema('public')
          .from('sessions')
          .insert({ id: sessionId, user_id: userId, name })
        if (insertSessionError) {
          console.error('[createSession] insert sessions failed', insertSessionError)
          const code = (insertSessionError as { code?: string | null })?.code ?? null
          if (code === '23505') {
            options?.onNameCollision?.()
          } else {
            const message =
              (insertSessionError as { message?: string | null })?.message ?? 'Request failed'
            showEngineNotice(`Nie udało się utworzyć sesji. ${message}`, 'error')
          }
          options?.onInsertError?.()
          return null
        }
        const { error: insertAclError } = await client
          .schema('public')
          .from('user_sessions')
          .insert({
            user_id: userId,
            session_id: sessionId,
            payload: {},
            updated_at: new Date().toISOString(),
          })
        if (insertAclError) {
          console.error('[createSession] insert user_sessions failed', insertAclError)
          options?.onInsertError?.()
          return null
        }
        const sessionDetail = await createSession({
          id: sessionId,
          name,
        })
        if (sessionDetail.session?.id) {
          setEnginePreviewSessionId(sessionDetail.session.id)
          setEnginePreviewSessionName(sessionDetail.session.name ?? '')
          setEngineSessionPersisted(true)
          setEnginePreviewItems([])
          setEngineSessionDetail(sessionDetail)
          setEngineSessions(await listSessions())
          setFeedbackReminder(null)
          return sessionDetail.session.id
        }
        return null
      }
      const sessionDetail = await createSession({
        name,
      })
      if (sessionDetail.session?.id) {
        setEnginePreviewSessionId(sessionDetail.session.id)
        setEnginePreviewSessionName(sessionDetail.session.name ?? '')
        setEngineSessionPersisted(false)
        setEnginePreviewItems([])
        setEngineSessionDetail(sessionDetail)
        setEngineSessions(await listSessions())
        setFeedbackReminder(null)
        return sessionDetail.session.id
      }
    } catch {
      setEnginePreviewError('Unable to create engine session.')
      logSessionStore('engine_preview_create_failed', {})
    }
    return null
  }

  const handleEnginePreviewAdd = async (nameOverride?: string) => {
    const text = enginePreviewInput.trim()
    if (!text) return
    if (isDebugEnabled()) {
      const details = computeMappingDetails(text, uiLanguage)
      console.log(
        JSON.stringify({
          event: 'matrix_mapping_entry',
          row: details.row,
          col: details.col,
          rowScores: details.rowScores,
          colScores: details.colScores,
          rowMatches: details.rowMatches,
          colMatches: details.colMatches,
        })
      )
    }
    const nameToUse = (nameOverride ?? enginePreviewSessionName).trim()
    if (!nameToUse && enginePreviewItems.length === 0) {
      setEngineNameDraft('')
      setEngineNamePromptOpen(true)
      return
    }
    const sessionId = await ensureEnginePreviewSession()
    if (!sessionId) return
    engineInteractionBySession.current[sessionId] = true

    const now = Date.now()
    const wordCount = countWords(text)
    const isShort = wordCount > 0 && wordCount < SHORT_ENTRY_WORDS
    const isVague = containsVaguePhrase(text)
    const entryType = engineUiState === 'FACILITATED_INPUT' ? 'facilitated_input' : 'free_input'

    if (entryType === 'free_input') {
      if (isShort) registerSignal('weak', 'short')
      if (isShort && engineLastEntryShort && engineLastEntryAt && now - engineLastEntryAt < 15000) {
        registerSignal('weak', 'short_burst')
      }
      if (isVague) registerSignal('medium', 'vague')
      if (isShort && isVague) registerSignal('medium', 'short_vague')

      let nextStreak = engineFreeEntryStreak + 1
      if (nextStreak >= 3) {
        registerSignal('weak', 'no_facilitation')
        nextStreak = 0
      }
      setEngineFreeEntryStreak(nextStreak)
    } else {
      setEngineFreeEntryStreak(0)
    }

    setEnginePreviewError(null)
    try {
      if (!client) {
        showEngineNotice('Sesja logowania wygasła. Zaloguj się ponownie.', 'error')
        return
      }
      const { data: userData, error: userErr } = await client.auth.getUser()
      const authedUserId = userData?.user?.id ?? null
      console.log('[board_items] authed user', {
        authedUserId,
        hasAuthSession: Boolean(authSession?.user),
      })
      if (userErr || !authedUserId) {
        showEngineNotice('Sesja logowania wygasła. Zaloguj się ponownie.', 'error')
        return
      }
      const itemId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      // Source of truth for report cell mapping: EngineBoardItem.matrix_row/matrix_col.
      // We attach them only for facilitated inputs based on the current question meta.
      const mappedRow =
        entryType === 'facilitated_input'
          ? toMatrixRowKey(engineLastQuestionMeta?.group_code ?? null)
          : null
      const mappedCol =
        entryType === 'facilitated_input'
          ? toMatrixColKey(engineLastQuestionMeta?.mode_code ?? null)
          : null
      const questionText =
        entryType === 'facilitated_input'
          ? engineLastQuestionText || engineActivePrompt?.text || null
          : null
      const isPolish = uiLanguage === 'Polish'
      const newItem: EngineBoardItem = {
        id: itemId,
        type: 'idea',
        text,
        label: null,
        question_id: entryType === 'facilitated_input' ? engineLastQuestionMeta?.id ?? null : null,
        question_text_pl: questionText && isPolish ? questionText : null,
        question_text_en: questionText && !isPolish ? questionText : null,
        created_at: now,
        entry_type: entryType,
        prompt_type: engineActivePrompt?.type || null,
        matrix_row: mappedRow,
        matrix_col: mappedCol,
        lastClassifiedText: mappedRow && mappedCol ? text : null,
        classificationDirty: mappedRow && mappedCol ? false : true,
      }
      let persistedItem = newItem
      const payload: Pick<
        Database['public']['Tables']['board_items']['Insert'],
        | 'user_id'
        | 'session_id'
        | 'text'
        | 'label'
        | 'matrix_row'
        | 'matrix_col'
        | 'question_id'
        | 'question_text_pl'
        | 'question_text_en'
      > = {
        user_id: authedUserId,
        session_id: sessionId,
        text: text.trim(),
        label: null,
        matrix_row: mappedRow ?? null,
        matrix_col: mappedCol ?? null,
        question_id: newItem.question_id ?? null,
        question_text_pl: isPolish ? questionText : null,
        question_text_en: !isPolish ? questionText : null,
      }
      const { data: inserted, error } = await client
        .from('board_items')
        .insert(payload)
        .select('*')
        .single()
      if (error) {
        console.error('[board_items] insert failed', {
          status: (error as { status?: number | null })?.status,
          code: (error as { code?: string | null })?.code,
          message: (error as { message?: string | null })?.message,
          details: (error as { details?: string | null })?.details,
          hint: (error as { hint?: string | null })?.hint,
          sessionId,
          payloadKeys: Object.keys(payload),
        })
        const statusLabel = (error as { status?: number | null })?.status ?? 'n/a'
        const codeLabel = (error as { code?: string | null })?.code ?? 'n/a'
        const message = ((error as { message?: string | null })?.message || '').slice(0, 120)
        showEngineNotice(
          `Nie udało się dodać wpisu. (status: ${statusLabel}, code: ${codeLabel})${message ? ` ${message}` : ''}`,
          'error'
        )
        return
      }
      if (!inserted) {
        showEngineNotice('Nie udało się dodać wpisu.', 'error')
        return
      }
      const insertedRow = inserted as Database['public']['Tables']['board_items']['Row']
      console.log('[board_items] inserted', {
        id: insertedRow.id,
        sessionId,
        hasQuestion: Boolean(insertedRow.question_text_pl || insertedRow.question_text_en),
        questionId: insertedRow.question_id ?? null,
      })
      const insertedCreatedAt =
        typeof insertedRow.created_at === 'number'
          ? insertedRow.created_at
          : Number.isNaN(Date.parse(String(insertedRow.created_at)))
            ? (newItem.created_at ?? now)
            : Date.parse(String(insertedRow.created_at))
      persistedItem = normalizeBoardItem({
        ...newItem,
        id: insertedRow.id,
        text: insertedRow.text ?? newItem.text,
        label: insertedRow.label ?? null,
        question_id: insertedRow.question_id ?? null,
        question_text_pl: insertedRow.question_text_pl ?? null,
        question_text_en: insertedRow.question_text_en ?? null,
        created_at: insertedCreatedAt,
        entry_type: (insertedRow.entry_type as EngineBoardItem['entry_type']) ?? newItem.entry_type ?? undefined,
        prompt_type: (insertedRow.prompt_type as EngineBoardItem['prompt_type']) ?? newItem.prompt_type ?? null,
        matrix_row: insertedRow.matrix_row ?? newItem.matrix_row ?? null,
        matrix_col: insertedRow.matrix_col ?? newItem.matrix_col ?? null,
        lastClassifiedText: insertedRow.last_classified_text ?? newItem.lastClassifiedText ?? null,
        classificationDirty:
          insertedRow.classification_dirty ?? newItem.classificationDirty ?? null,
      })
      setEnginePreviewItems((prev) => [persistedItem, ...prev])
      setEnginePreviewInput('')
      setEngineLastInputActivityAt(now)
      setEngineInputFocused(true)
      engineLastAddAtBySession.current[sessionId] = now
      engineIdleTriggered.current = false
      clearEngineIdleTimer('post_add')
      setEngineOfferReason(null)
      if (entryType !== 'facilitated_input') {
        setEngineUiState('FREE_FLOW')
      }
      logFacilitationEvent('post_add_grace_start', {
        sessionId,
        until: now + postAddGraceMs,
      })
      const currentDetail = await getSession(sessionId)
      const sessionDetail = currentDetail ?? {
        session: {
          id: sessionId,
          name: nameToUse || null,
          created_at: now,
          updated_at: now,
          last_group_code: null,
          last_mode_code: null,
          last_category_code: null,
          stuck_counter: 0,
          tokensInTotal: 0,
          tokensOutTotal: 0,
        },
        boardItems: [],
        askedQuestionIds: [],
      }
      const nextSessionName = sessionDetail.session?.name || nameToUse || null
      const updatedDetail: EngineSessionDetail = {
        ...sessionDetail,
        session: sessionDetail.session
          ? {
              ...sessionDetail.session,
              name: nextSessionName,
              updated_at: now,
            }
          : null,
        boardItems: [persistedItem, ...(sessionDetail.boardItems || [])],
      }
      await updateSession(updatedDetail)
      if (engineSessionDetail?.session?.id === sessionId) {
        setEngineSessionDetail(updatedDetail)
      }
      setEnginePreviewSessionName(nextSessionName ?? '')
      if (engineSessionsOpen) {
        setEngineSessions(await listSessions())
      }
      enginePreviousInput.current = ''
      if (entryType !== 'facilitated_input') {
        setEngineUiState('FREE_FLOW')
        setEngineActivePrompt(null)
      }
      setEngineOfferReason(null)
      if (engineUiState === 'FACILITATION_OFFER' || engineUiState === 'FACILITATED_INPUT') {
        resetStuckSignals()
      }
      logFacilitationEvent('entry_added', {
        sessionId: sessionId || 'unknown',
        entryType: entryType === 'facilitated_input' ? 'facilitated' : 'free',
        words: wordCount,
      })
      setEngineLastEntryAt(now)
      setEngineLastEntryShort(isShort)
      engineInputRef.current?.focus()
    } catch {
      setEnginePreviewError('Nie udało się dodać wpisu.')
      logSessionStore('engine_preview_add_failed', { sessionId })
    }
  }


  const resetEnginePreview = () => {
    engineResetOnSessionChange.current = true
    engineInteractionBySession.current = {}
    engineIdleArmedRef.current = false
    setEnginePreviewSessionId(null)
    setEngineSessionPersisted(false)
    setEnginePreviewItems([])
    setEnginePreviewError(null)
    setEngineSessionDetail(null)
    setEngineSessionsError(null)
    setEngineUiState('INIT')
    setEngineNamePromptOpen(false)
    setEngineNameDraft('')
    setEnginePreviewSessionName('')
    setEngineActivePrompt(null)
    setEnginePromptSource(null)
    setEngineOfferReason(null)
    setEngineFacilitationInlineError(null)
    setEngineAskedQuestionIds([])
    setEngineAskedQuestionMeta({})
    setEngineLastQuestionMeta(null)
    setEngineAskedQuestionTexts([])
    setEngineAskedQuestionTextById({})
    setEnginePrevQuestionMeta(null)
    setEngineLastQuestionText(null)
    setEngineRecentCells([])
    resetStuckSignals()
    setEngineFreeEntryStreak(0)
    setEngineLastEntryAt(null)
    setEngineLastEntryShort(false)
    setEngineLastInputActivityAt(null)
    setEngineInputFocused(false)
  }

  const currentEngineSession = useMemo(() => {
    if (!enginePreviewSessionId) return null
    if (engineSessionDetail?.session?.id === enginePreviewSessionId) {
      return engineSessionDetail.session
    }
    return engineSessions.find((session) => session.id === enginePreviewSessionId) || null
  }, [enginePreviewSessionId, engineSessionDetail, engineSessions])

  if (import.meta.env.DEV) {
    console.log('[hooks-check] reached memo block', {
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      isEnginePreview,
      authResolved,
      hasSession: Boolean(authSession?.user?.id),
      hasActiveSession: Boolean(enginePreviewSessionId),
    })
  }

  const orderedEnginePreviewItems = useMemo(() => {
    const estimateLines = (value: string) => {
      const length = String(value || '').trim().length
      const perLine = 55
      return Math.max(1, Math.ceil(length / perLine))
    }
    return enginePreviewItems
      .map((item, index) => ({ item, index, lines: estimateLines(item.text) }))
      .sort((a, b) => a.lines - b.lines || a.index - b.index)
      .map(({ item }) => item)
  }, [enginePreviewItems])

  const facilitationIntros = useMemo(
    () =>
      uiLanguage === 'Polish'
        ? [
            'Zatrzymajmy się na chwilę i spójrzmy na to z innej strony.',
            'Na początek spróbujmy dobrze ustawić problem.',
            'Wyobraź sobie, że ktoś z zewnątrz patrzy na Twój pomysł.',
            'Masz chwilę? Zróbmy krótki krok w bok i sprawdźmy inną perspektywę.',
          ]
        : [
            'Pause for a moment and look at this from a different angle.',
            'To start, let’s frame the problem clearly.',
            'Imagine an outsider looking at your idea.',
            'Take a brief step sideways and check another perspective.',
          ],
    [uiLanguage]
  )

  useEffect(() => {
    if (engineAskedQuestionTexts.length === 0) {
      facilitationIntroRef.current = null
      return
    }
    if (!facilitationIntroRef.current && engineAskedQuestionTexts.length === 1) {
      const pick = facilitationIntros[Math.floor(Math.random() * facilitationIntros.length)]
      facilitationIntroRef.current = pick || facilitationIntros[0] || null
    }
  }, [engineAskedQuestionTexts.length, facilitationIntros])

  const engineUnassignedItems = useMemo(
    () => enginePreviewItems.filter((item) => !item.matrix_row || !item.matrix_col),
    [enginePreviewItems]
  )

  const engineDirtyItems = useMemo(
    () =>
      enginePreviewItems.filter((item) => {
        if (!item.matrix_row || !item.matrix_col) return false
        if (item.classificationDirty) return true
        if (typeof item.lastClassifiedText === 'string') {
          return item.lastClassifiedText !== item.text
        }
        return false
      }),
    [enginePreviewItems]
  )

  const missingLabelEntries = useMemo(
    () => enginePreviewItems.filter((item) => isMissingLabel(item)),
    [enginePreviewItems]
  )
  const missingLabelCount = missingLabelEntries.length

  const missingLabelModal = missingLabelModalOpen ? (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal-content">
        <div className="modal-header">
          <h2>{copy.missingLabelModalTitle}</h2>
          <button type="button" className="ghost" onClick={() => setMissingLabelModalOpen(false)}>
            {copy.close}
          </button>
        </div>
        <div className="modal-body">
          <p>{copy.missingLabelModalBody(missingLabelCount)}</p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setMissingLabelModalOpen(false)
                setHighlightMissingLabels(true)
                const first = missingLabelEntries[0]
                if (first && typeof window !== 'undefined') {
                  if (!autoOpenedMissingLabelRef.current) {
                    setEngineLabelEditorId(first.id)
                    autoOpenedMissingLabelRef.current = true
                  }
                  window.setTimeout(() => {
                    const element = document.querySelector(
                      `[data-testid=\"entry-row-${first.id}\"]`
                    )
                    if (element && 'scrollIntoView' in element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  }, 50)
                }
              }}
            >
              {copy.missingLabelPrimary}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setMissingLabelModalOpen(false)
                openReportView()
              }}
            >
              {copy.missingLabelSecondary}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  useEffect(() => {
    if (!highlightMissingLabels) return
    if (missingLabelCount > 0) return
    showEngineNotice(copy.missingLabelComplete, 'success')
    setHighlightMissingLabels(false)
  }, [highlightMissingLabels, missingLabelCount])

  const openReportView = async () => {
    if (typeof window === 'undefined') return
    const returnPath = window.location.pathname + window.location.search
    const sessionId = enginePreviewSessionId || ''
    if (!sessionId) return
    window.sessionStorage.setItem('reportReturnPath', returnPath)
    window.sessionStorage.setItem('reportReturnSessionId', sessionId)
    const hasDbReport = Boolean(reportRecords[sessionId]?.id)
    const existed = authSession?.user?.id
      ? hasDbReport
      : (!authSession?.user?.id &&
          isGuestMode() &&
          sessionId &&
          window.sessionStorage.getItem(`report_exists::${sessionId}`) === 'true')
    if (sessionId) {
      if (authSession?.user?.id) {
        try {
          const sourceUpdatedAt =
            enginePreviewItems.reduce(
              (max, item) => Math.max(max, Number(item.created_at || 0)),
              0
            ) || 0
          const ensured = await ensureReportExists(sessionId, sourceUpdatedAt)
          setReportRecords((prev) => ({ ...prev, [sessionId]: ensured }))
          const existedAfterEnsure = Boolean(hasDbReport || ensured?.id)
          window.history.pushState({ newlyCreated: !existedAfterEnsure }, '', '/report')
          setReportViewOpen(true)
          return
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown'
          console.error('[report] ensure failed', { sessionId, message })
          showEngineNotice(
            'Nie udało się utworzyć/otworzyć raportu. Sprawdź połączenie lub uprawnienia.',
            'error'
          )
          return
        }
      } else if (isGuestMode()) {
        window.sessionStorage.setItem(`report_exists::${sessionId}`, 'true')
        const sourceUpdatedAt =
          enginePreviewItems.reduce(
            (max, item) => Math.max(max, Number(item.created_at || 0)),
            0
          ) || 0
        window.sessionStorage.setItem(
          `report_source_updated_at::${sessionId}`,
          String(sourceUpdatedAt)
        )
        if (!existed) {
          void markReportCreated(sessionId)
        }
      }
    }
    window.history.pushState({ newlyCreated: !existed }, '', '/report')
    setReportViewOpen(true)
  }

  const handleReportNavigation = async () => {
    await openReportView()
  }

  useEffect(() => {
    if (!isReport) return
    if (!enginePreviewSessionId) return
    if (reportOpenHandledRef.current) return
    if (engineAssignLoading || naFillStatus === 'running') return
    reportOpenHandledRef.current = true
    const pendingCount = engineUnassignedItems.length + engineDirtyItems.length
    if (pendingCount === 0) return
    void fillNaAssignments('auto')
  }, [
    isReport,
    enginePreviewSessionId,
    engineUnassignedItems.length,
    engineDirtyItems.length,
    engineAssignLoading,
    naFillStatus,
  ])

  const buildSessionDetailForSave = async (): Promise<EngineSessionDetail | null> => {
    if (!enginePreviewSessionId) return null
    const now = Date.now()
    const localDetail = await getSession(enginePreviewSessionId)
    const fallbackSession: EngineSessionSummary = {
      id: enginePreviewSessionId,
      name: enginePreviewSessionName || null,
      created_at: now,
      updated_at: now,
      last_group_code: null,
      last_mode_code: null,
      last_category_code: null,
      stuck_counter: 0,
      tokensInTotal: currentEngineSession?.tokensInTotal ?? 0,
      tokensOutTotal: currentEngineSession?.tokensOutTotal ?? 0,
    }
    const session = (localDetail?.session ?? currentEngineSession ?? fallbackSession)
    return {
      session: {
        ...session,
        updated_at: now,
      },
      boardItems: normalizeBoardItems(enginePreviewItems),
      askedQuestionIds: localDetail?.askedQuestionIds ?? engineAskedQuestionIds,
      report: localDetail?.report ?? engineSessionDetail?.report ?? null,
    }
  }

  const fillNaAssignments = async (source: 'manual' | 'auto') => {
    if (engineAssignLoading || naFillStatus === 'running') return
    if (!enginePreviewSessionId) {
      if (source === 'manual') showEngineNotice('Brak aktywnej sesji.', 'error')
      return
    }
    if (!engineSessionPersisted) {
      if (source === 'manual') {
        showEngineNotice('Najpierw utwórz sesję.', 'error')
      }
      return
    }
    if (suggestDiagEnabled) {
      console.log('[suggest][client] preflight', {
        source: 'assign_na',
        sessionId: enginePreviewSessionId,
        sessionPersisted: engineSessionPersisted,
      })
    }
    const candidates =
      source === 'auto'
        ? [...engineUnassignedItems, ...engineDirtyItems]
        : engineUnassignedItems
    if (candidates.length === 0) {
      if (source === 'manual') showEngineNotice('Brak wpisów N/A.', 'success')
      return
    }
    if (source === 'manual' && !aiSupportEnabled) {
      showEngineNotice('AI jest wyłączony.', 'error')
      return
    }
    setEngineAssignLoading(true)
    setNaFillStatus('running')
    const itemsToClassify =
      source === 'auto' ? candidates.slice(0, MAX_AUTO_CLASSIFY) : candidates
    try {
      const items = itemsToClassify.map((item) => ({
        id: item.id,
        text: item.text,
      }))
      const matrixDefinition = {
        rows: {
          A: 'world (otoczenie, rynek, kontekst, ograniczenia zewnętrzne)',
          B: 'product (produkt/system jako całość, architektura, jak działa)',
          C: 'elements (konstrukcja, budowa, podzespoły, elementy składowe)',
        },
        cols: {
          1: 'as_is (stan obecny)',
          2: 'not_working (problemy, tarcia, co zmienić)',
          3: 'should_be (pożądany stan / pomysł)',
        },
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-ai-support': source === 'auto' ? 'on' : aiSupportEnabled ? 'on' : 'off',
      }
      if (diagnosticsEnabledForUser) {
        headers['x-diagnostics'] = '1'
      }
      console.log('[suggest] sessionId', { sessionId: enginePreviewSessionId })
      const response = await fetch('/api/coach/suggest', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          currentUserId: authSession?.user?.id ?? null,
          sessionId: enginePreviewSessionId,
          action: 'assign_na',
          locale: uiLanguage === 'Polish' ? 'pl' : 'en',
          items,
          matrixDefinition,
        }),
      })
      const raw = await response.text()
      let data: {
        ok?: boolean
        assignments?: { id: string; cellCode: string; confidence?: number }[]
        usage?: {
          model: string | null
          inputTokens: number
          outputTokens: number
          totalTokens: number
        }
      } | null = null
      try {
        data = JSON.parse(raw)
      } catch {
        data = null
      }
      if (!response.ok || !data || data.ok === false) {
        if (source === 'manual') {
          showEngineNotice('Nie udało się przypisać wpisów.', 'error')
        } else {
          showEngineNotice('Nie udało się uzupełnić przyporządkowań. Spróbuj ponownie.', 'error')
        }
        setNaFillStatus('error')
        return
      }
      const assignments = Array.isArray(data.assignments) ? data.assignments : []
      if (!assignments.length) {
        if (source === 'manual') {
          showEngineNotice('Brak przypisań z AI.', 'success')
        }
        setNaFillStatus('done')
        return
      }
      const byId = new Map(assignments.map((entry) => [entry.id, entry.cellCode]))
      const updatedItems = enginePreviewItems.map((item) => {
        const cellCode = byId.get(item.id)
        if (!cellCode) return item
        const mapped = cellCodeToMatrix(cellCode)
        if (!mapped?.matrix_row || !mapped?.matrix_col) return item
        return {
          ...item,
          matrix_row: mapped.matrix_row,
          matrix_col: mapped.matrix_col,
          lastClassifiedText: item.text,
          classificationDirty: false,
        }
      })
      setEnginePreviewItems(updatedItems)
      const updates = enginePreviewItems
        .map((item) => {
          const cellCode = byId.get(item.id)
          if (!cellCode) return null
          const mapped = cellCodeToMatrix(cellCode)
          if (!mapped?.matrix_row || !mapped?.matrix_col) return null
          if (
            item.matrix_row &&
            item.matrix_col &&
            item.matrix_row !== 'N/A' &&
            item.matrix_col !== 'N/A'
          ) {
            return null
          }
          return { id: item.id, matrix_row: mapped.matrix_row, matrix_col: mapped.matrix_col }
        })
        .filter(
          (entry): entry is { id: string; matrix_row: string; matrix_col: string } =>
            Boolean(entry)
        )
      console.log('[matrix_assign] computed_assignments_count', updates.length)
      if (authSession?.user?.id && client && updates.length) {
        try {
          await Promise.all(
            updates.map((entry) =>
              updateBoardItemMatrix(
                enginePreviewSessionId,
                entry.id,
                entry.matrix_row,
                entry.matrix_col
              )
            )
          )
          console.log('[matrix_assign] persisted_assignments_count', updates.length)
        } catch (error) {
          console.error('[matrix_assign] persist_failed', {
            count: updates.length,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (engineSessionDetail?.session?.id === enginePreviewSessionId) {
        setEngineSessionDetail((prev) =>
          prev ? { ...prev, boardItems: updatedItems } : prev
        )
      }
      const detail = await getSession(enginePreviewSessionId)
      if (detail?.session) {
        const updatedDetail: EngineSessionDetail = {
          ...detail,
          boardItems: detail.boardItems.map((item) => {
            const cellCode = byId.get(item.id)
            if (!cellCode) return item
            const mapped = cellCodeToMatrix(cellCode)
            if (!mapped?.matrix_row || !mapped?.matrix_col) return item
            return {
              ...item,
              matrix_row: mapped.matrix_row,
              matrix_col: mapped.matrix_col,
              lastClassifiedText: item.text,
              classificationDirty: false,
            }
          }),
        }
        await updateSession(updatedDetail)
        if (engineSessionDetail?.session?.id === enginePreviewSessionId) {
          setEngineSessionDetail(updatedDetail)
        }
      }
      if (data.usage) {
        const meta: LlmUsageMeta = {
          aiSupportEnabled: true,
          modelUsed: data.usage.model ?? null,
          tokens: {
            input: data.usage.inputTokens,
            output: data.usage.outputTokens,
            total: data.usage.totalTokens,
          },
        }
        applyUsageModel(meta)
        void applyUsageToSession(meta, enginePreviewSessionId)
      }
      setNaFillStatus('done')
      if (source === 'manual') {
        showEngineNotice('Uzupełniono wpisy N/A.', 'success')
      }
    } catch {
      setNaFillStatus('error')
      if (source === 'manual') {
        showEngineNotice('Nie udało się przypisać wpisów.', 'error')
      } else {
        showEngineNotice('Nie udało się uzupełnić przyporządkowań. Spróbuj ponownie.', 'error')
      }
    } finally {
      setEngineAssignLoading(false)
    }
  }

  const assignNaItems = async () => {
    await fillNaAssignments('manual')
  }

  const saveCurrentSessionToCloud = async (silentSuccess = false) => {
    if (!enginePreviewSessionId) {
      showEngineNotice(copy.engine.saveMissingSession, 'error')
      return false
    }
    const detail = await buildSessionDetailForSave()
    if (!detail?.session) {
      showEngineNotice(copy.engine.saveMissingSession, 'error')
      return false
    }
    try {
      if (!client) {
        showEngineNotice(copy.engine.saveRequiresAuth, 'error')
        return false
      }
      const { data } = await client.auth.getSession()
      const session = data.session
      if (!session?.user?.id) {
        showEngineNotice('Zaloguj się, aby zapisać w chmurze', 'error')
        return false
      }
      try {
        await saveSessionToCloud(session.user.id, detail, uiLanguage)
        if (import.meta.env.DEV) {
          console.log('[cloud save]', { status: 200 })
        }
      } catch (error) {
        const status = (error as { status?: number }).status
        if (import.meta.env.DEV) {
          console.log('[cloud save]', { status, message: (error as Error).message })
        }
        console.error('[cloud save] failed', { status, error })
        showEngineNotice(`Nie udało się zapisać (${status ?? 'err'})`, 'error')
        return false
      }
      if (!silentSuccess) {
        showEngineNotice('Sesja zapisana w chmurze', 'success')
      }
      if (engineSessionsOpen) {
        void fetchEngineSessions()
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      logSessionStore('engine_session_cloud_save_failed', { message })
      showEngineNotice(copy.engine.saveFailed, 'error')
      return false
    }
  }

  const startNewSession = async () => {
    if (enginePreviewSessionId) {
      const saved = await saveCurrentSessionToCloud(true)
      if (!saved) return
    }
    resetEnginePreview()
    setEngineNameDraft('')
    setEngineNamePromptOpen(true)
  }

  const handleLogout = async () => {
    if (!client) {
      showEngineNotice(copy.auth.logoutFailed, 'error')
      return
    }
    const { error } = await client.auth.signOut()
    if (error) {
      showEngineNotice(copy.auth.logoutFailed, 'error')
      return
    }
    if (import.meta.env.DEV) {
      console.log('[auth] signed out')
    }
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(AUTH_LOGIN_ORIGIN_KEY)
      window.localStorage.removeItem(AUTH_LOGIN_REDIRECT_KEY)
      window.localStorage.removeItem(AUTH_OAUTH_ORIGIN_KEY)
      window.localStorage.removeItem(AUTH_FLOW_IN_PROGRESS_KEY)
      window.localStorage.removeItem(DIAGNOSTICS_STORAGE_KEY)
      window.sessionStorage.removeItem('last_oauth_code')
    }
    setDiagnosticsEnabled(false)
    window.location.href = '/'
  }

  const fetchEngineSessions = async () => {
    setEngineSessionsError(null)
    setEngineSessionsLoading(true)
    try {
      const localSessions = await listSessions()
      if (authSession?.user?.id) {
        if (!client) {
          setEngineSessionsError('Brak połączenia z Supabase.')
          return
        }
        const { data: u } = await client.auth.getUser()
        const userId = u?.user?.id ?? null
        if (!userId) {
          setEngineSessionsError('Sesja logowania wygasła. Zaloguj się ponownie.')
          return
        }
        const { data: us, error: use } = await client
          .from('user_sessions')
          .select('session_id')
          .eq('user_id', userId)
        if (use) {
          const message = (use as { message?: string | null })?.message ?? 'Request failed'
          setEngineSessionsError(`Nie udało się pobrać listy sesji. ${message}`)
          return
        }
        const sessionIds = (us || [])
          .map((row) => String((row as { session_id?: string | null }).session_id || '').trim())
          .filter(Boolean)
        const uniqueIds = Array.from(new Set(sessionIds))
        let sessionsFound: EngineSessionSummary[] = []
        if (uniqueIds.length) {
          const { data: sessionsData, error: se } = await client
            .from('sessions')
            .select('*')
            .in('id', uniqueIds)
          if (se) {
            const message = (se as { message?: string | null })?.message ?? 'Request failed'
            setEngineSessionsError(`Nie udało się pobrać metadanych sesji. ${message}`)
            return
          }
          const now = Date.now()
          sessionsFound = (sessionsData || []).map((row) => ({
            id: String((row as { id?: string | null }).id || ''),
            name: (row as { name?: string | null }).name ?? null,
            created_at: toTimestamp((row as { created_at?: string | number | null }).created_at, now),
            updated_at: toTimestamp((row as { updated_at?: string | number | null }).updated_at, now),
            last_group_code: (row as { last_group_code?: string | null }).last_group_code ?? null,
            last_mode_code: (row as { last_mode_code?: number | null }).last_mode_code ?? null,
            last_category_code:
              (row as { last_category_code?: string | null }).last_category_code ?? null,
            stuck_counter: (row as { stuck_counter?: number | null }).stuck_counter ?? 0,
            tokensInTotal: (row as { tokens_in_total?: number | null }).tokens_in_total ?? 0,
            tokensOutTotal: (row as { tokens_out_total?: number | null }).tokens_out_total ?? 0,
          }))
        }
        const missingSessionsCount = Math.max(uniqueIds.length - sessionsFound.length, 0)
        console.log('[sessionsList] userSessionsCount', uniqueIds.length)
        console.log('[sessionsList] sessionsFoundCount', sessionsFound.length)
        console.log('[sessionsList] missingSessionsCount', missingSessionsCount)
        console.log('[sessionsList] sessionsCount', sessionsFound.length)
        setCloudSessionPayloads({})
        setEngineSessions(sessionsFound)
      } else {
        setCloudSessionPayloads({})
        setEngineSessions(localSessions)
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[engine sessions] fetch failed', error)
      }
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error
            ? String((error as { message?: string }).message || 'Request failed')
            : 'Request failed'
      setEngineSessionsError(`Nie udało się pobrać listy sesji. ${message}`)
      logSessionStore('engine_sessions_list_failed', { message })
    } finally {
      setEngineSessionsLoading(false)
    }
  }

  useEffect(() => {
    if (!isEnginePreview && !isReport) return
    void fetchEngineSessions()
  }, [isEnginePreview, isReport, authSession?.user?.id])

  useEffect(() => {
    if (!enginePreviewSessionId) return
    if (!authSession?.user?.id) {
      setReportRecords((prev) => ({ ...prev, [enginePreviewSessionId]: null }))
      return
    }
    if (!client) return
    if (Object.prototype.hasOwnProperty.call(reportRecords, enginePreviewSessionId)) {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const record = await fetchReportBySessionId(enginePreviewSessionId)
        if (!cancelled) {
          setReportRecords((prev) => ({ ...prev, [enginePreviewSessionId]: record }))
        }
      } catch (error) {
        if (!cancelled) {
          setReportRecords((prev) => ({ ...prev, [enginePreviewSessionId]: null }))
        }
        const message = error instanceof Error ? error.message : 'unknown'
        console.error('[report] failed to fetch report', {
          sessionId: enginePreviewSessionId,
          message,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enginePreviewSessionId, authSession?.user?.id, reportRecords])

  const getReportMetaForSession = (sessionId: string | null) => {
    if (!sessionId) return null
    if (authSession?.user?.id) {
      const dbReport = reportRecords[sessionId]
      if (!dbReport) return null
      return {
        id: dbReport.id,
        created_at: dbReport.createdAt,
        updated_at: dbReport.updatedAt,
        lastSummaryTextHash: dbReport.lastSummaryTextHash ?? null,
        summary: dbReport.summary ?? null,
        ideas: dbReport.ideas ?? null,
        recommendations: dbReport.recommendations ?? null,
      }
    }
    if (engineSessionDetail?.session?.id === sessionId && engineSessionDetail?.report) {
      return engineSessionDetail.report
    }
    const cloudMeta = cloudSessionPayloads[sessionId]?.report
    if (cloudMeta) return cloudMeta
    return null
  }

  const reportSessionId = isReport
    ? enginePreviewSessionId || engineSessionDetail?.session?.id || null
    : null

  useEffect(() => {
    if (!isReport) return
    if (!reportSessionId) return
    if (getReportMetaForSession(reportSessionId)?.created_at) return
    void markReportCreated(reportSessionId)
  }, [isReport, reportSessionId, cloudSessionPayloads, engineSessionDetail])

  const markReportCreated = async (sessionId: string) => {
    const now = Date.now()
    const detail = await getSession(sessionId)
    if (!detail?.session) return
    if (authSession?.user?.id && client) {
      const sourceUpdatedAt =
        (detail.boardItems || []).reduce(
          (max, item) => Math.max(max, Number(item.created_at || 0)),
          0
        ) || 0
      try {
        const ensured = await ensureReportExists(sessionId, sourceUpdatedAt)
        setReportRecords((prev) => ({ ...prev, [sessionId]: ensured }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown'
        console.error('[report] ensure failed', { sessionId, message })
      }
    }
    const existing = detail.report || null
    if (existing?.created_at) return
    const updatedDetail: EngineSessionDetail = {
      ...detail,
      report: {
        ...(existing || {}),
        id: existing?.id ?? sessionId,
        created_at: now,
        updated_at: now,
        lastSummaryTextHash: existing?.lastSummaryTextHash ?? null,
        summary: existing?.summary ?? null,
      },
      session: { ...detail.session, updated_at: now },
    }
    await updateSession(updatedDetail)
    if (engineSessionDetail?.session?.id === sessionId) {
      setEngineSessionDetail(updatedDetail)
    }
    if (authSession?.user?.id) {
      await saveSessionToCloud(authSession.user.id, updatedDetail, uiLanguage)
      console.log('[REPORT_CREATE] saved report', {
        reportId: updatedDetail.report?.id ?? sessionId,
        sessionId,
        persisted: true,
      })
    }
  }

  const deleteEngineSession = async (sessionId: string) => {
    setEngineSessionsError(null)
    setEngineDeleteLoadingId(sessionId)
    try {
      const userId = authSession?.user?.id || null
      if (userId && client) {
        const { error } = await client
          .from('user_sessions')
          .delete()
          .eq('session_id', sessionId)
          .eq('user_id', userId)
        if (error) {
          if (import.meta.env.DEV) {
            console.error('[engine session delete] failed', {
              code: error.code,
              message: error.message,
              sessionId,
              userId,
            })
          }
          throw error
        }
      }
      await deleteSession(sessionId)
      setEngineSessions((prev) => prev.filter((session) => session.id !== sessionId))
      setCloudSessionPayloads((prev) => {
        if (!prev[sessionId]) return prev
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
      if (engineSessionDetail?.session?.id === sessionId) {
        setEngineSessionDetail(null)
      }
      if (enginePreviewSessionId === sessionId) {
        resetEnginePreview()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się usunąć sesji. ${message}`)
      logSessionStore('engine_session_delete_failed', { sessionId, message })
      showEngineNotice('Nie udało się usunąć sesji (brak uprawnień).', 'error')
    } finally {
      setEngineDeleteLoadingId(null)
    }
  }

  const updateEngineEntryLabel = async (entryId: string, label: string | null): Promise<boolean> => {
    setEngineSessionsError(null)
    const previousLabel =
      enginePreviewItems.find((item) => item.id === entryId)?.label ?? null
    setEnginePreviewItems((prev) =>
      prev.map((item) => (item.id === entryId ? { ...item, label } : item))
    )
    if (engineSessionDetail?.session) {
      setEngineSessionDetail((prev) =>
        prev
          ? {
              ...prev,
              boardItems: prev.boardItems.map((item) =>
                item.id === entryId ? { ...item, label } : item
              ),
            }
          : prev
      )
    }
    try {
      const sessionId = enginePreviewSessionId || engineSessionDetail?.session?.id
      if (!sessionId) return false
      if (authSession?.user?.id && client) {
        await updateBoardItemLabel(sessionId, entryId, label ?? null)
      }
      const detail = await getSession(sessionId)
      if (!detail?.session) return false
      const updated: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.map((item) =>
          item.id === entryId ? { ...item, label } : item
        ),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updated)
      engineLabelCache.current[entryId] = label ?? null
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zapisać etykiety. ${message}`)
      logSessionStore('engine_entry_label_failed', { entryId, message })
      setEnginePreviewItems((prev) =>
        prev.map((item) =>
          item.id === entryId ? { ...item, label: previousLabel } : item
        )
      )
      if (engineSessionDetail?.session) {
        setEngineSessionDetail((prev) =>
          prev
            ? {
                ...prev,
                boardItems: prev.boardItems.map((item) =>
                  item.id === entryId ? { ...item, label: previousLabel } : item
                ),
              }
            : prev
        )
      }
      engineLabelCache.current[entryId] = previousLabel
      return false
    }
  }

  const flushEngineEntryLabels = async () => {
    const pending = enginePreviewItems.filter(
      (item) => (engineLabelCache.current[item.id] ?? null) !== (item.label ?? null)
    )
    if (pending.length === 0) return
    await Promise.all(
      pending.map((item) => updateEngineEntryLabel(item.id, item.label ?? null))
    )
  }

  const fetchEngineSessionDetail = async (sessionId: string) => {
    setEngineSessionsError(null)
    setEngineEditItemId(null)
    setEngineEditText('')
    try {
      const data = await getSession(sessionId)
      if (!data) throw new Error('Missing session')
      const cloudPayload = cloudSessionPayloads[sessionId]
      let sourceItems = data.boardItems ?? []
      if (authSession?.user?.id && client) {
        sourceItems = await fetchBoardItems(sessionId, authSession.user.id)
      } else if (cloudPayload?.boardItems && cloudPayload.boardItems.length) {
        sourceItems = cloudPayload.boardItems
      }
      const normalizedItems = normalizeBoardItems(sourceItems)
      setEngineSessionDetail({ ...data, boardItems: normalizedItems })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się pobrać szczegółów sesji. ${message}`)
      logSessionStore('engine_session_detail_failed', { sessionId, message })
    }
  }

  const openEngineSession = async (sessionId: string) => {
    setEngineSessionsError(null)
    setEngineEditItemId(null)
    setEngineEditText('')
    try {
      if (authSession?.user?.id && client) {
        // IMPORTANT: boardItems in user_sessions.payload are legacy only.
        // After migration, board state MUST come from Supabase board_items.
        const maybeMigrateLegacyBoardItems = async (
          targetSessionId: string,
          userId: string,
          supabaseClient: NonNullable<typeof client>
        ) => {
          const { data: us, error } = await supabaseClient
            .from('user_sessions')
            .select('payload')
            .eq('user_id', userId)
            .eq('session_id', targetSessionId)
            .single()
          if (error || !us) return
          const payload = us.payload as { boardItems?: unknown[]; boardItemsMigrated?: boolean } | null
          if (!payload || payload.boardItemsMigrated) return
          const legacyItems = Array.isArray(payload.boardItems) ? payload.boardItems : []
          if (!legacyItems.length) return
          const rows = legacyItems
            .map((item) => {
              const entry = item as {
                text?: string | null
                label?: string | null
                matrixRow?: string | null
                matrixCol?: string | null
                questionId?: string | null
                questionTextPl?: string | null
                questionTextEn?: string | null
              }
              return {
                user_id: userId,
                session_id: targetSessionId,
                text: String(entry.text ?? '').trim(),
                label: entry.label ?? null,
                matrix_row: entry.matrixRow ?? null,
                matrix_col: entry.matrixCol ?? null,
                question_id: entry.questionId ?? null,
                question_text_pl: entry.questionTextPl ?? null,
                question_text_en: entry.questionTextEn ?? null,
              }
            })
            .filter((row) => row.text.length > 0)
          if (!rows.length) return
          for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50)
            const { error: insertError } = await supabaseClient
              .from('board_items')
              .insert(batch)
            if (insertError) {
              console.error('[migrateBoardItems] insert failed', insertError)
              return
            }
          }
          await supabaseClient
            .from('user_sessions')
            .update({
              payload: {
                ...(payload || {}),
                boardItemsMigrated: true,
              },
            })
            .eq('user_id', userId)
            .eq('session_id', targetSessionId)
          console.log('[migrateBoardItems] migrated', rows.length)
        }
        console.log('[openSession] click', { sessionId })
        const { data: u, error: ue } = await client.auth.getUser()
        const userId = u?.user?.id ?? null
        console.log('[openSession] auth', {
          hasUser: Boolean(userId),
          userIdPrefix: userId ? userId.slice(0, 8) : null,
          err: ue?.message ?? null,
        })
        if (ue || !userId) {
          showEngineNotice('Sesja logowania wygasła. Zaloguj się ponownie.', 'error')
          return
        }
        const usRes = await client
          .from('user_sessions')
          .select('session_id')
          .eq('user_id', userId)
          .eq('session_id', sessionId)
          .maybeSingle()
        console.log('[openSession] user_sessions', {
          found: Boolean(usRes.data),
          err: usRes.error
            ? {
                status: (usRes.error as { status?: number | null })?.status,
                code: (usRes.error as { code?: string | null })?.code,
                message: (usRes.error as { message?: string | null })?.message,
              }
            : null,
        })
        if (usRes.error) {
          showEngineNotice(
            `Open session failed: ${(usRes.error as { status?: number | null })?.status ?? 'n/a'}/${(usRes.error as { code?: string | null })?.code ?? 'n/a'}.`,
            'error'
          )
        }
        if (!usRes.data) {
          const localDetail = await getSession(sessionId)
          if (localDetail?.session) {
            try {
              await saveSessionToCloud(userId, localDetail, uiLanguage)
              const { data: usRetry } = await client
                .from('user_sessions')
                .select('session_id')
                .eq('user_id', userId)
                .eq('session_id', sessionId)
                .maybeSingle()
              console.log('[openSession] user_sessions retry', {
                found: Boolean(usRetry?.session_id),
              })
              if (!usRetry?.session_id) {
                showEngineNotice('Nie masz dostępu do tej sesji (brak powiązania).', 'error')
                return
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Request failed'
              showEngineNotice(`Nie udało się potwierdzić dostępu. ${message}`, 'error')
              return
            }
          } else {
            showEngineNotice('Nie masz dostępu do tej sesji (brak powiązania).', 'error')
            return
          }
        }
        type SessionRow = {
          id: string
          name?: string | null
          created_at?: string | number | null
          updated_at?: string | number | null
          last_group_code?: string | null
          last_mode_code?: number | null
          last_category_code?: string | null
          stuck_counter?: number | null
          tokens_in_total?: number | null
          tokens_out_total?: number | null
        }
        const sRes = (await client
          .from('sessions')
          .select('*')
          .eq('id', sessionId)
          .maybeSingle()) as { data: SessionRow | null; error: unknown }
        console.log('[openSession] sessions', {
          found: Boolean(sRes.data),
          err: sRes.error
            ? {
                status: (sRes.error as { status?: number | null })?.status,
                code: (sRes.error as { code?: string | null })?.code,
                message: (sRes.error as { message?: string | null })?.message,
              }
            : null,
        })
        if (sRes.error) {
          showEngineNotice(
            `Open session failed: ${(sRes.error as { status?: number | null })?.status ?? 'n/a'}/${(sRes.error as { code?: string | null })?.code ?? 'n/a'}.`,
            'error'
          )
        }
        if (!sRes.data) {
          showEngineNotice(
            'Ta sesja jest w trybie legacy i wymaga naprawy (brak metadanych w chmurze).',
            'error'
          )
          return
        }
        const biRes = await client
          .from('board_items')
          .select('id,session_id,user_id,text,label,matrix_row,matrix_col,question_id,question_text_pl,question_text_en,created_at')
          .eq('user_id', userId)
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true })
        console.log('[openSession] board_items', {
          count: biRes.data?.length ?? 0,
          err: biRes.error
            ? {
                status: (biRes.error as { status?: number | null })?.status,
                code: (biRes.error as { code?: string | null })?.code,
                message: (biRes.error as { message?: string | null })?.message,
              }
            : null,
        })
        if (biRes.error) {
          console.error('[board_items] query failed', {
            status: (biRes.error as { status?: number | null })?.status,
            code: (biRes.error as { code?: string | null })?.code,
            message: (biRes.error as { message?: string | null })?.message,
            details: (biRes.error as { details?: string | null })?.details,
            hint: (biRes.error as { hint?: string | null })?.hint,
          })
        }
        if (biRes.error) {
          showEngineNotice(
            `Open session failed: ${(biRes.error as { status?: number | null })?.status ?? 'n/a'}/${(biRes.error as { code?: string | null })?.code ?? 'n/a'}.`,
            'error'
          )
          return
        }
        console.log('[openSession] board_items sample keys', biRes.data?.[0] ? Object.keys(biRes.data[0]) : [])
        if ((biRes.data?.length ?? 0) === 0) {
          await maybeMigrateLegacyBoardItems(sessionId, userId, client)
        }
        const rRes = await client
          .from('reports')
          .select('id,session_id,created_at,updated_at')
          .eq('session_id', sessionId)
          .maybeSingle()
        console.log('[openSession] reports', {
          found: Boolean(rRes.data),
          err: rRes.error
            ? {
                status: (rRes.error as { status?: number | null })?.status,
                code: (rRes.error as { code?: string | null })?.code,
                message: (rRes.error as { message?: string | null })?.message,
              }
            : null,
        })
        if (rRes.error) {
          showEngineNotice(
            `Open session failed: ${(rRes.error as { status?: number | null })?.status ?? 'n/a'}/${(rRes.error as { code?: string | null })?.code ?? 'n/a'}.`,
            'error'
          )
        }
        const now = Date.now()
        const sessionRow = sRes.data as SessionRow
        const fullItems = await fetchBoardItems(sessionId, userId)
        if (!openSessionDebugOnceRef.current) {
          console.log('[openSession] sample item', normalizeBoardItem(fullItems?.[0]))
          openSessionDebugOnceRef.current = true
        }
        const sessionSummary: EngineSessionSummary = {
          id: String(sessionRow?.id || sessionId),
          name: sessionRow?.name ?? null,
          created_at: toTimestamp(sessionRow?.created_at, now),
          updated_at: toTimestamp(sessionRow?.updated_at, now),
          last_group_code: sessionRow?.last_group_code ?? null,
          last_mode_code: sessionRow?.last_mode_code ?? null,
          last_category_code: sessionRow?.last_category_code ?? null,
          stuck_counter: sessionRow?.stuck_counter ?? 0,
          tokensInTotal: sessionRow?.tokens_in_total ?? 0,
          tokensOutTotal: sessionRow?.tokens_out_total ?? 0,
          cloud_board_items_migrated: true,
        }
        const normalizedItems = normalizeBoardItems(fullItems)
        const reportSummary: ReportSummary | null = null
        const displayName =
          sessionSummary.name && sessionSummary.name.trim()
            ? sessionSummary.name.trim()
            : `Session ${sessionSummary.id.slice(0, 8)}`
        console.log('[openSession] sessionName', sessionSummary.name ?? null)
        console.log('[openSession] displayName', displayName)
        setEngineSessionDetail({
          session: sessionSummary,
          boardItems: normalizedItems,
          askedQuestionIds: [],
          report: rRes.data
            ? {
                id: rRes.data.id ?? null,
                created_at: toTimestamp(rRes.data.created_at, now),
                updated_at: toTimestamp(rRes.data.updated_at, now),
                lastSummaryTextHash: null,
                summary: reportSummary,
              }
            : null,
        })
        setEnginePreviewSessionId(sessionSummary.id)
        setEnginePreviewSessionName(sessionSummary.name ?? '')
        setEngineSessionPersisted(true)
        setEnginePreviewItems(normalizedItems)
        syncEngineLabelCache(normalizedItems)
        setEnginePreviewInput('')
        setEnginePreviewError(null)
        setEngineNamePromptOpen(false)
        setEngineNameDraft('')
        setFeedbackReminder(null)
        setEngineUiState('FREE_FLOW')
        setEngineActivePrompt(null)
        setEngineOfferReason(null)
        if (sessionSummary) {
          void updateSession({
            session: sessionSummary,
            boardItems: normalizedItems,
            askedQuestionIds: [],
            report: rRes.data
              ? {
                  id: rRes.data.id ?? null,
                  created_at: toTimestamp(rRes.data.created_at, now),
                  updated_at: toTimestamp(rRes.data.updated_at, now),
                  lastSummaryTextHash: null,
                  summary: reportSummary,
                }
              : null,
          })
        }
        return
      }
      if (authSession?.user?.id && !cloudSessionPayloads[sessionId]) {
        await fetchEngineSessions()
      }
      const data = await getSession(sessionId)
      if (!data) throw new Error('Missing session')
      engineResetOnSessionChange.current = true
      const cloudPayload = cloudSessionPayloads[sessionId]
      if (cloudPayload?.uiLanguage) {
        applySessionLanguage(cloudPayload.uiLanguage)
      }
      let sourceItems = data.boardItems ?? []
      if (authSession?.user?.id && client) {
        sourceItems = await fetchBoardItems(sessionId, authSession.user.id)
        if (
          sourceItems.length === 0 &&
          data.boardItems &&
          data.boardItems.length > 0 &&
          !data.session?.cloud_board_items_migrated
        ) {
          const userId = authSession?.user?.id
          if (userId) {
            const migrationPayload = data.boardItems.map((item) => ({
              user_id: userId,
              session_id: sessionId,
              text: item.text,
              label: item.label ?? null,
              matrix_row: item.matrix_row ?? null,
              matrix_col: item.matrix_col ?? null,
              question_id: item.question_id ?? null,
              question_text_pl: null,
              question_text_en: null,
            }))
            for (const item of migrationPayload) {
              try {
                await insertBoardItem(item)
              } catch {
                // ignore per-item errors to avoid blocking
              }
            }
          }
          if (data.session) {
            const updatedDetail: EngineSessionDetail = {
              ...data,
              session: {
                ...data.session,
                cloud_board_items_migrated: true,
                updated_at: Date.now(),
              },
            }
            await updateSession(updatedDetail)
          }
          sourceItems = await fetchBoardItems(sessionId, authSession.user.id)
        }
      } else if (cloudPayload?.boardItems && cloudPayload.boardItems.length) {
        sourceItems = cloudPayload.boardItems
      }
      const normalizedItems = normalizeBoardItems(sourceItems)
      setEngineSessionDetail({ ...data, boardItems: normalizedItems })
      setEnginePreviewSessionId(data.session?.id ?? null)
      setEnginePreviewSessionName(data.session?.name ?? '')
      setEngineSessionPersisted(false)
      setEnginePreviewItems(normalizedItems)
      syncEngineLabelCache(normalizedItems)
      setEnginePreviewInput('')
      setEnginePreviewError(null)
      setEngineNamePromptOpen(false)
      setEngineNameDraft('')
      setFeedbackReminder(null)
      setEngineUiState('FREE_FLOW')
      setEngineActivePrompt(null)
      setEngineOfferReason(null)
      if (data.session) {
        void updateSession({ ...data, boardItems: normalizedItems })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się pobrać szczegółów sesji. ${message}`)
      logSessionStore('engine_session_open_failed', { sessionId, message })
    }
  }

  const startEditEngineItem = (item: EngineBoardItem) => {
    setEngineEditItemId(item.id)
    setEngineEditText(item.text)
  }

  const cancelEditEngineItem = () => {
    setEngineEditItemId(null)
    setEngineEditText('')
  }

  const finishEditEngineItem = () => {
    setEngineEditItemId(null)
    setEngineEditText('')
  }

  const saveEngineItem = async () => {
    if (!engineEditItemId || !engineSessionDetail?.session) return
    const targetId = engineEditItemId
    const sessionId = engineSessionDetail.session.id
    const nextText = engineEditText.trim()
    setEngineEditLoading(true)
    setEngineSessionsError(null)
    try {
      const detail = await getSession(sessionId)
      if (!detail?.session) throw new Error('Missing session')
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.map((item) =>
          item.id === targetId ? applyTextEditClassification(item, nextText) : item
        ),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
      setEngineSessionDetail((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          boardItems: prev.boardItems.map((item) =>
            item.id === targetId ? applyTextEditClassification(item, nextText) : item
          ),
        }
      })
      finishEditEngineItem()
      await fetchEngineSessionDetail(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zapisać zmian. ${message}`)
      logSessionStore('engine_item_save_failed', { sessionId, message })
    } finally {
      setEngineEditLoading(false)
    }
  }

  const startEnginePreviewEdit = (item: EngineBoardItem) => {
    setEngineLabelEditorId(null)
    setEnginePreviewEditId(item.id)
    setEnginePreviewEditText(item.text)
  }

  const cancelEnginePreviewEdit = () => {
    setEnginePreviewEditId(null)
    setEnginePreviewEditText('')
  }

  const saveEnginePreviewEdit = async () => {
    if (!enginePreviewEditId || !enginePreviewSessionId) return
    const nextText = enginePreviewEditText.trim()
    if (!nextText) return
    const limited = limitWords(nextText, WORD_LIMIT)
    setEnginePreviewItems((prev) =>
      prev.map((item) =>
        item.id === enginePreviewEditId ? applyTextEditClassification(item, limited) : item
      )
    )
    if (engineSessionDetail?.session?.id === enginePreviewSessionId) {
      setEngineSessionDetail((prev) =>
        prev
          ? {
              ...prev,
              boardItems: prev.boardItems.map((item) =>
                item.id === enginePreviewEditId
                  ? applyTextEditClassification(item, limited)
                  : item
              ),
            }
          : prev
      )
    }
    try {
      const detail = await getSession(enginePreviewSessionId)
      if (!detail?.session) return
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.map((item) =>
          item.id === enginePreviewEditId
            ? applyTextEditClassification(item, limited)
            : item
        ),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zapisać zmian. ${message}`)
      logSessionStore('engine_preview_edit_failed', { message })
    } finally {
      cancelEnginePreviewEdit()
    }
  }

  const cancelEngineEntryDelete = () => {
    setEngineEntryDeleteId(null)
  }

  const confirmEngineEntryDelete = async (itemId: string) => {
    const sessionId = enginePreviewSessionId || engineSessionDetail?.session?.id
    if (!sessionId) return
    setEngineSessionsError(null)
    try {
      const detail = await getSession(sessionId)
      if (!detail?.session) return
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.filter((item) => item.id !== itemId),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
      setEnginePreviewItems((prev) => prev.filter((item) => item.id !== itemId))
      if (engineSessionDetail?.session) {
        setEngineSessionDetail((prev) =>
          prev
            ? {
                ...prev,
                boardItems: prev.boardItems.filter((item) => item.id !== itemId),
              }
            : prev
        )
      }
      if (enginePreviewEditId === itemId) cancelEnginePreviewEdit()
      if (engineLabelEditorId === itemId) setEngineLabelEditorId(null)
      delete engineLabelCache.current[itemId]
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się usunąć elementu. ${message}`)
      logSessionStore('engine_preview_item_delete_failed', { itemId, message })
    } finally {
      setEngineEntryDeleteId(null)
    }
  }

  const deleteEngineItem = async (itemId: string) => {
    if (!engineSessionDetail?.session) return
    setEngineEditLoading(true)
    setEngineSessionsError(null)
    try {
      const detail = await getSession(engineSessionDetail.session.id)
      if (!detail?.session) throw new Error('Missing session')
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.filter((item) => item.id !== itemId),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
      if (engineEditItemId === itemId) cancelEditEngineItem()
      await fetchEngineSessionDetail(engineSessionDetail.session.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się usunąć elementu. ${message}`)
      logSessionStore('engine_item_delete_failed', { itemId, message })
    } finally {
      setEngineEditLoading(false)
    }
  }

  const handleExportSessions = async () => {
    try {
      const sessions = await exportSessions()
      const payload = {
        exportedAt: Date.now(),
        sessions,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'engine-sessions.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się wyeksportować sesji. ${message}`)
      logSessionStore('engine_export_failed', { message })
    }
  }

  const handleImportSessions = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as { sessions?: unknown } | unknown[]
      const sessions = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { sessions?: unknown }).sessions)
          ? (parsed as { sessions: unknown[] }).sessions
          : null
      if (!sessions) {
        throw new Error('Nieprawidłowy format pliku.')
      }
      const result = await importSessions(sessions as Parameters<typeof importSessions>[0])
      setEngineSessionsError(null)
      setEngineSessions(await listSessions())
      logSessionStore('engine_import_done', { imported: result.imported })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zaimportować sesji. ${message}`)
      logSessionStore('engine_import_failed', { message })
    } finally {
      if (engineImportInputRef.current) {
        engineImportInputRef.current.value = ''
      }
    }
  }

  const isDevUi =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' && window.location.hostname === 'localhost')

  useEffect(() => {
    if (!isDevUi) return
    if (typeof window === 'undefined') return
    const handleError = (event: ErrorEvent) => {
      const message =
        event.message || (event.error instanceof Error ? event.error.message : 'Unknown error')
      setDevLastError(message)
      console.error('[dev error]', event)
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message =
        reason instanceof Error ? reason.message : reason ? String(reason) : 'Unknown rejection'
      setDevLastError(`Unhandled rejection: ${message}`)
      console.error('[dev unhandledrejection]', reason)
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [isDevUi])

  const devAuthPanel = isDevUi ? (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.92)',
        color: '#fff',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.4,
        maxWidth: 320,
      }}
    >
      <div>path: {typeof window !== 'undefined' ? window.location.pathname : ''}</div>
      <div>hostname: {typeof window !== 'undefined' ? window.location.hostname : ''}</div>
      <div>origin: {typeof window !== 'undefined' ? window.location.origin : ''}</div>
      <div>href: {typeof window !== 'undefined' ? window.location.href : ''}</div>
      <div>importMetaDev: {import.meta.env.DEV ? 'true' : 'false'}</div>
      <div>mode: {import.meta.env.MODE}</div>
      <div>
        build:{' '}
        {String(
          import.meta.env.VITE_BUILD_TIME ??
            import.meta.env.VITE_APP_VERSION ??
            'unknown'
        )}
      </div>
      <div>authResolved: {authResolved ? 'true' : 'false'}</div>
      <div>hasSession: {authSession ? 'true' : 'false'}</div>
      <div>email: {authSession?.user?.email ?? '—'}</div>
      <div>isGuest: {isGuestMode() ? 'true' : 'false'}</div>
      <div>
        hasActiveGuestSession:{' '}
        {isGuestMode() && readGuestSessions().length > 0 ? 'true' : 'false'}
      </div>
      <div>lastAuthEvent: {lastAuthEvent ?? '—'}</div>
      <div>lastLLMCallAt: {lastLlmCallAt ?? '—'}</div>
      <div>lastLLMModel: {lastLlmModel ?? '—'}</div>
      <div>
        lastTokensDelta: {lastLlmTokensDelta != null ? String(lastLlmTokensDelta) : '—'}
      </div>
      <div>lastLLMSource: {lastLlmSource ?? '—'}</div>
      <div>
        lastGroundedCount:{' '}
        {lastLlmGroundedCount != null ? String(lastLlmGroundedCount) : '—'}
      </div>
      <div>lastGroundedIn: {lastLlmGroundedIn ? lastLlmGroundedIn.join(', ') : '—'}</div>
      {devLastError && <div>lastError: {devLastError}</div>}
    </div>
  ) : null

  const withDevOverlay = (node: React.ReactNode) => (
    <>
      {devAuthPanel}
      {node}
    </>
  )

  if (isDebugMatrix) {
    return withDevOverlay(<DebugMatrixPage llmApiBase={llmApiBase} />)
  }

  if (isAuthCallback) {
    return withDevOverlay(
      <div className="app auth-screen">
        <section className="panel auth-panel">
          <h1>{copy.loginCallbackTitle}</h1>
          {authCallbackLoading && <p className="muted">{copy.loginCallbackTitle}</p>}
          {authCallbackError && <p className="engine-error">{authCallbackError}</p>}
          {authCallbackError && import.meta.env.DEV && (
            <p className="muted">DEV: {authCallbackError}</p>
          )}
          {authCallbackHint && <p className="muted">{authCallbackHint}</p>}
          {!authCallbackLoading && authCallbackError && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  window.location.href = '/'
                }}
              >
                {copy.authCallback.tryAgainCta}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  window.location.href = '/'
                }}
              >
                {copy.authCallback.goHome}
              </button>
            </div>
          )}
        </section>
      </div>
    )
  }

  if (isReport) {
    const reportLanguage = uiLanguage === 'Polish' ? 'pl' : 'en'
    const snapshot = getReportSessionSnapshot()
    const handleReportLogout = async () => {
      const sessionId = snapshot.sessionId || enginePreviewSessionId
      if (sessionId) {
        const detail = await getSession(sessionId)
        if (detail?.session) {
          const now = Date.now()
          const updatedDetail: EngineSessionDetail = {
            ...detail,
            session: { ...detail.session, updated_at: now },
          }
          await updateSession(updatedDetail)
          if (authSession?.user?.id) {
            await saveSessionToCloud(authSession.user.id, updatedDetail, uiLanguage)
          }
        }
      }
      await handleLogout()
    }
    const handleReportBack = () => {
      if (typeof window === 'undefined') return
      if (snapshot.sessionId) {
        void markReportCreated(snapshot.sessionId)
      }
      const storedPath = window.sessionStorage.getItem('reportReturnPath')
      if (storedPath) {
        window.history.pushState({}, '', storedPath)
        window.sessionStorage.removeItem('reportReturnPath')
        window.sessionStorage.removeItem('reportReturnSessionId')
      } else if (window.history.length > 1) {
        window.history.back()
      } else {
        window.history.pushState({}, '', '/engine')
      }
      setReportViewOpen(false)
    }
    return withDevOverlay(
      <ReportPage
        snapshot={snapshot}
        language={reportLanguage}
        userId={authSession?.user?.id ?? null}
        onBack={handleReportBack}
        onLogout={handleReportLogout}
        aiSupportEnabled={aiSupportEnabled}
        diagnosticsEnabled={showDiagnostics}
        naFillStatus={naFillStatus}
        onUpdateLabel={updateEngineEntryLabel}
        onReportMetaChange={async (meta) => {
          const sessionId = snapshot.sessionId || enginePreviewSessionId
          if (!sessionId) return
          const detail = await getSession(sessionId)
          if (!detail?.session) return
          const existing = detail.report || null
          const nextReport = {
            ...(existing || {}),
            id: existing?.id ?? sessionId,
            summary: meta.summary ?? existing?.summary ?? null,
            lastSummaryTextHash:
              meta.lastSummaryTextHash ?? existing?.lastSummaryTextHash ?? null,
            created_at: meta.createdAt ?? existing?.created_at ?? Date.now(),
            updated_at: Date.now(),
            ideas: meta.ideas ?? existing?.ideas ?? null,
            recommendations: meta.recommendations ?? existing?.recommendations ?? null,
          }
          const updatedDetail: EngineSessionDetail = {
            ...detail,
            report: nextReport,
            session: { ...detail.session, updated_at: Date.now() },
          }
          await updateSession(updatedDetail)
          if (engineSessionDetail?.session?.id === sessionId) {
            setEngineSessionDetail(updatedDetail)
          }
          if (authSession?.user?.id) {
            await saveSessionToCloud(authSession.user.id, updatedDetail, uiLanguage)
            setReportRecords((prev) => {
              const existingRecord = prev[sessionId]
              if (!existingRecord) return prev
              return {
                ...prev,
                [sessionId]: {
                  ...existingRecord,
                  summary: meta.summary ?? existingRecord.summary,
                  ideas: meta.ideas ?? existingRecord.ideas,
                  recommendations: meta.recommendations ?? existingRecord.recommendations,
                  lastSummaryTextHash:
                    meta.lastSummaryTextHash ?? existingRecord.lastSummaryTextHash,
                  updatedAt: Date.now(),
                },
              }
            })
          }
        }}
        onAiUsage={(meta) => {
          applyUsageModel(meta as LlmUsageMeta)
          void applyUsageToSession(meta as LlmUsageMeta, enginePreviewSessionId)
        }}
      />
    )
  }

  if (isLogin) {
    const isGuestActive = isGuestMode()
    if (showSupabaseConfigError) {
      return withDevOverlay(
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <h1>Supabase is not configured correctly.</h1>
            <p className="muted">
              Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Production env.
            </p>
            {isDiagEnabled() && (
              <div className="muted">
                <div>hasUrl: {supabaseEnvDiag.hasUrl ? 'true' : 'false'}</div>
                <div>hasAnon: {supabaseEnvDiag.hasAnon ? 'true' : 'false'}</div>
                <div>urlLen: {supabaseEnvDiag.urlLen}</div>
                <div>anonLen: {supabaseEnvDiag.anonLen}</div>
                <div>supabaseInitError: {supabaseInitError}</div>
              </div>
            )}
          </section>
        </div>
      )
    }
    return withDevOverlay(
      <div className="app auth-screen">
        <section className="panel auth-panel">
          <h1>{copy.loginTitle}</h1>
          {import.meta.env.DEV && (
            <div className="actions">
              <button type="button" className="ghost" onClick={() => void resetAuthDev()}>
                Reset auth (dev)
              </button>
            </div>
          )}
          {!hasSupabaseEnv && (
            <p className="engine-error">{MISSING_SUPABASE_ENV_MESSAGE}</p>
          )}
          <p className="muted">{copy.loginSubtitle}</p>
          <div className="auth-options auth-options--actions">
            <div className="auth-option auth-option--align-actions">
              <p className="auth-option-title">{copy.loginGoogleLabel}</p>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={handleGoogleLogin}
                  disabled={loginOauthLoading || authDisabled}
                >
                  {loginOauthLoading ? copy.loginGoogleLoading : copy.loginGoogleCta}
                </button>
              </div>
            </div>
            <div className="auth-option">
              <p className="auth-option-title">{copy.loginGuestLabel}</p>
              <div className="actions">
                <button type="button" className="primary" onClick={handleGuestMode}>
                  {copy.loginGuestCta}
                </button>
              </div>
              {isGuestActive && !authSession && (
                <p className="muted auth-guest-note">{copy.loginGuestActive}</p>
              )}
            </div>
            <div className="auth-option auth-option--align-actions">
              <label className="auth-option-title" htmlFor="login-email">
                {copy.loginEmailLabel}
              </label>
              <div className="field-group">
                <input
                  id="login-email"
                  type="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder={copy.loginEmailPlaceholder}
                />
              </div>
              {import.meta.env.DEV && (
                <label className="auth-option-toggle">
                  <input
                    type="checkbox"
                    checked={loginUsePassword}
                    onChange={(event) => setLoginUsePassword(event.target.checked)}
                  />
                  <span>Email + password (dev)</span>
                </label>
              )}
              {loginUsePassword && import.meta.env.DEV ? (
                <>
                  <div className="field-group">
                    <input
                      id="login-password"
                      type="password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      placeholder="password"
                    />
                  </div>
                  <div className="actions">
                  <button
                    type="button"
                    className={loginAuthMode === 'signin' ? 'primary' : 'ghost'}
                    onClick={() => setLoginAuthMode('signin')}
                    disabled={authDisabled}
                  >
                      Sign in
                    </button>
                  <button
                    type="button"
                    className={loginAuthMode === 'signup' ? 'primary' : 'ghost'}
                    onClick={() => setLoginAuthMode('signup')}
                    disabled={authDisabled}
                  >
                      Sign up
                    </button>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={handlePasswordAuth}
                      disabled={loginSending || authDisabled}
                    >
                      {loginSending ? '...' : loginAuthMode === 'signin' ? 'Sign in' : 'Sign up'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={handleMagicLink}
                    disabled={loginSending || loginCooldownSeconds > 0 || authDisabled}
                  >
                    {loginSending
                      ? copy.loginEmailSending
                      : loginCooldownSeconds > 0
                        ? `Poczekaj ${loginCooldownSeconds}s`
                        : copy.loginEmailCta}
                  </button>
                </div>
              )}
              {import.meta.env.DEV && !loginUsePassword && (
                <p className="muted">
                  Supabase default SMTP ma bardzo niski limit wysyłek. Jeśli widzisz 429,
                  użyj login hasłem lub Google.
                </p>
              )}
            </div>
          </div>
          {loginNotice && <p className="muted">{loginNotice}</p>}
          {authError && <p className="engine-error">{authError}</p>}
          {guestPromptOpen && (
            <div className="auth-guest-merge">
              <p>{copy.loginGuestMergePrompt}</p>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={handleGuestMerge}
                  disabled={guestMergeLoading}
                >
                  {guestMergeLoading ? copy.loginGuestMergeLoading : copy.loginGuestMergeYes}
                </button>
                <button type="button" className="ghost" onClick={handleGuestSkip}>
                  {copy.loginGuestMergeNo}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    )
  }

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const view = isReport ? 'report' : isEnginePreview ? 'engine' : showLanding ? 'landing' : 'app'
    console.log('[router] path=', rawPath, '-> view=', view)
  }

  if (isEnginePreview) {
    const hasSupabaseSession = Boolean(authSession?.user?.id)
    const guestAllowed = guestEntryAllowed
    if (showSupabaseConfigError) {
      return withDevOverlay(
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <h1>Supabase is not configured correctly.</h1>
            <p className="muted">
              Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Production env.
            </p>
            {isDiagEnabled() && (
              <div className="muted">
                <div>hasUrl: {supabaseEnvDiag.hasUrl ? 'true' : 'false'}</div>
                <div>hasAnon: {supabaseEnvDiag.hasAnon ? 'true' : 'false'}</div>
                <div>urlLen: {supabaseEnvDiag.urlLen}</div>
                <div>anonLen: {supabaseEnvDiag.anonLen}</div>
                <div>supabaseInitError: {supabaseInitError}</div>
              </div>
            )}
          </section>
        </div>
      )
    }
    if (!authResolved) {
      return withDevOverlay(
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <p className="muted">Loading...</p>
          </section>
        </div>
      )
    }
    if (!hasSupabaseSession && !guestAllowed && !authDisabled) {
      const next =
        typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/engine'
      return withDevOverlay(
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <p className="muted">
              {uiLanguage === 'Polish'
                ? 'Przekierowanie do logowania...'
                : 'Redirecting to login...'}
            </p>
            <div className="actions">
              <a
                className="primary"
                href={`/login?next=${encodeURIComponent(next)}`}
              >
                {copy.loginTitle}
              </a>
            </div>
          </section>
        </div>
      )
    }
    const enginePlaceholder =
      enginePreviewItems.length === 0
        ? copy.enginePlaceholderInitial
        : copy.enginePlaceholderContinue

    const formatSessionLabel = (name: string | null | undefined, id: string) => {
      if (name && name.trim()) {
        return <span className="engine-session-name">{name}</span>
      }
      const shortId = id.slice(0, 8)
      return `Session ${shortId}`
    }

  const engineRemainingWords = Math.max(0, WORD_LIMIT - countWords(enginePreviewInput))
  const isEngineWordLimitReached =
    enginePreviewInput.trim().length > 0 && countWords(enginePreviewInput) >= WORD_LIMIT
  const showEngineInputCaret = !engineInputFocused && !enginePreviewInput.trim()
  const showFacilitationOffer =
    engineUiState === 'FACILITATION_OFFER' ||
    engineOfferReason === 'idle' ||
    engineOfferReason === 'manual'
  const showHelpButton = !showFacilitationOffer
  const facilitationDisabled = !engineSessionPersisted || !enginePreviewSessionId
  const llmUsageClass = llmUsageModel
    ? `llm-model-${llmUsageModel.replace(/\./g, '-')}`
    : 'llm-model-none'
  const currentTokensTotal = llmTokensTotal
  const formatTokenTotal = (value: number) => {
    const locale = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    return new Intl.NumberFormat(locale).format(Math.max(0, Math.floor(value || 0)))
  }

  const formatUsd = (value: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(
      Math.max(0, value || 0)
    )
  const formatPln = (value: number) =>
    new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Math.max(0, value || 0)
    )
  const totalCostUsd = engineUsage.totalUSD
  const totalCostPln = usdPlnRate ? totalCostUsd * usdPlnRate : null
  const modelUsageEntries = Object.entries(engineUsage.perModel)
    .filter(([, usage]) => (usage?.inputTokens || 0) + (usage?.outputTokens || 0) > 0)
    .sort((a, b) => (b[1]?.totalUSD || 0) - (a[1]?.totalUSD || 0))

    return withDevOverlay(
      <div className="app engine-preview" data-testid="active-session">
        <header className="engine-header">
          <div>
            <a className="engine-kicker" href="/">
              {CANONICAL_DISPLAY_HOST}
            </a>
          </div>
          <div className="engine-header-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => {
                void saveCurrentSessionToCloud()
              }}
            >
              {copy.engine.saveSession}
            </button>
            {enginePreviewSessionId && !engineNamePromptOpen && (
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  void startNewSession()
                }}
              >
                {copy.engine.newSession}
              </button>
            )}
            <button className="ghost" type="button" onClick={handleLogout}>
              {copy.auth.logout}
            </button>
            {engineNotice && (
              <span className={`engine-notice engine-notice--${engineNotice.variant}`}>
                {engineNotice.message}
              </span>
            )}
            {isDiagEnabled() && (
              <span className="muted">
                auth: {authSession?.user?.email ?? '—'}
              </span>
            )}
            {isAdmin && (
              <button
                className={`ai-support-toggle diagnostics-toggle ${showDiagnostics ? 'on' : 'off'}`}
                type="button"
                onClick={() => {
                  const nextEnabled = !showDiagnostics
                  setDiagnosticsEnabled(nextEnabled)
                  localStorage.setItem(
                    DIAGNOSTICS_STORAGE_KEY,
                    nextEnabled ? 'true' : 'false'
                  )
                }}
              >
                {showDiagnostics ? copy.diagnosticsOn : copy.diagnosticsOff}
              </button>
            )}
            {showDiagnostics && (
              <>
                <button
                  className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
                  type="button"
                  onClick={() => {
                    const nextEnabled = !aiSupportEnabled
                    setAiSupportEnabled(nextEnabled)
                    localStorage.setItem('aiSupportEnabled', nextEnabled ? 'true' : 'false')
                    if (nextEnabled) {
                      void checkLlmStatus(normalizeApiBase(llmApiBase))
                    } else {
                      setLlmStatus('offline')
                    }
                  }}
                >
                  {aiSupportEnabled ? copy.aiSupportOn : copy.aiSupportOff}
                </button>
                <button
                  className={`ai-support-toggle llm-usage-indicator ${llmUsageClass}`}
                  type="button"
                  aria-label="LLM usage indicator"
                  title="LLM usage indicator"
                  disabled
                >
                  {`${formatTokenTotal(currentTokensTotal)} tok`}
                </button>
                <div className="llm-cost-panel" aria-live="polite">
                  <div className="llm-cost-line">{`Cost: $${formatUsd(totalCostUsd)}`}</div>
                  <div className="llm-cost-line">
                    {usdPlnRate ? `Cost (PLN): ${formatPln(totalCostPln || 0)} zł` : 'PLN: …'}
                  </div>
                  <details className="llm-cost-details">
                    <summary>Breakdown</summary>
                    <div className="llm-cost-breakdown">
                      <div className="llm-cost-row">
                        Total tokens: {formatTokenTotal(engineUsage.totalTokens)}
                      </div>
                      <div className="llm-cost-row">{`Total USD: $${formatUsd(totalCostUsd)}`}</div>
                      <div className="llm-cost-row">
                        {usdPlnRate ? `Total PLN: ${formatPln(totalCostPln || 0)} zł` : 'Total PLN: …'}
                      </div>
                      {modelUsageEntries.map(([model, usage]) => (
                        <div key={model} className="llm-cost-row">
                          {model}: {formatTokenTotal(usage.inputTokens)} in /{' '}
                          {formatTokenTotal(usage.outputTokens)} out · ${formatUsd(usage.totalUSD)}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </>
            )}
          </div>
        </header>
        {authDisabled && (
          <div className="engine-error" role="status">
            {MISSING_SUPABASE_ENV_MESSAGE}
          </div>
        )}
        <main className="engine-main">
          {feedbackReminderBanner}
          <section className="engine-panel engine-panel-session">
            <div className="engine-panel-header">
              <h1>{copy.enginePreviewSessionTitle}</h1>
              <div className="engine-actions engine-actions-session">
                {!enginePreviewSessionId && !engineSessionsOpen && !engineNamePromptOpen && (
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-create"
                    onClick={async () => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      armIdleWatch('create_session')
                      setEngineNameDraft('')
                      setEngineNamePromptOpen(true)
                    }}
                  >
                    {copy.enginePreviewCreateSession}
                  </button>
                )}
                {enginePreviewSessionId && (
                  <div className="engine-actions-group">
                    <button
                      type="button"
                      className="primary"
                      data-testid="session-report"
                      onClick={() => {
                        markUserInitiatedInteraction('pointer')
                        setEngineLastInputActivityAt(Date.now())
                        void handleReportNavigation()
                      }}
                    >
                      {enginePreviewSessionId &&
                      (authSession?.user?.id
                        ? Boolean(reportRecords[enginePreviewSessionId]?.id)
                        : typeof window !== 'undefined' &&
                          window.sessionStorage.getItem(
                            `report_exists::${enginePreviewSessionId}`
                          ) === 'true')
                        ? copy.enginePreviewOpenReport
                        : copy.enginePreviewCreateReport}
                    </button>
                  </div>
                )}
                {!enginePreviewSessionId &&
                  authSession?.user?.id &&
                  engineSessions.length > 0 && (
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-list-toggle"
                    onClick={() => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      const next = !engineSessionsOpen
                      const openList = async () => {
                        if (next) await flushEngineEntryLabels()
                        setEngineSessionsOpen(next)
                        if (next) {
                          if (engineNamePromptOpen) {
                            setResumeNamePromptAfterList(true)
                            setEngineNamePromptOpen(false)
                          }
                          if (engineNameError) setEngineNameError(null)
                        } else if (!enginePreviewSessionId && resumeNamePromptAfterList) {
                          setEngineNamePromptOpen(true)
                          setResumeNamePromptAfterList(false)
                        }
                        if (next) fetchEngineSessions()
                      }
                      void openList()
                    }}
                  >
                    {engineSessionsOpen
                      ? copy.engineSessionsToggleClose
                      : copy.engineSessionsToggleOpen}
                  </button>
                )}
              </div>
            </div>
          {(enginePreviewSessionId || engineSessionsOpen || engineSessionDetail?.session) && (
            <div className="engine-meta">
              <span>{copy.enginePreviewSessionIdLabel}:</span>
              <span className="engine-meta-value engine-meta-value--muted">
                {enginePreviewSessionId
                  ? formatSessionLabel(enginePreviewSessionName, enginePreviewSessionId)
                  : copy.enginePreviewSessionEmpty}
              </span>
            </div>
          )}
        </section>

        {engineSessionsOpen && (
          <section className="engine-panel engine-sessions">
            <div className="engine-panel-header">
              <h2>{copy.engineSessionsTitle}</h2>
                <div className="engine-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={fetchEngineSessions}
                    disabled={engineSessionsLoading}
                  >
                    {engineSessionsLoading ? '...' : copy.engineSessionsRefresh}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      handleExportSessions()
                    }}
                  >
                    {copy.engineSessionsExport}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => engineImportInputRef.current?.click()}
                  >
                    {copy.engineSessionsImport}
                  </button>
                  <input
                    ref={engineImportInputRef}
                    type="file"
                    accept="application/json"
                    className="sr-only"
                    onChange={handleImportSessions}
                  />
                </div>
              </div>
              {engineSessionsError && (
                <div className="engine-error">{engineSessionsError}</div>
              )}
              {!engineSessionsError && engineSessions.length === 0 && (
                <div className="engine-empty">{copy.engineSessionsEmpty}</div>
              )}
              <ul className="engine-list">
                {engineSessions.map((session) => (
                  <li
                    key={session.id}
                    className="engine-session-row"
                    data-testid={`session-item-${session.id}`}
                  >
                    <span className="engine-session-id">{formatSessionLabel(session.name, session.id)}</span>
                    <span className="engine-session-meta">
                      {new Date(session.updated_at).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      data-testid={`session-open-${session.id}`}
                      onClick={() => {
                        armIdleWatch('open_session')
                        openEngineSession(session.id)
                        setEngineSessionsOpen(false)
                      }}
                    >
                      {copy.engineSessionsOpen}
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => deleteEngineSession(session.id)}
                      disabled={engineDeleteLoadingId === session.id}
                    >
                      {engineDeleteLoadingId === session.id
                        ? copy.engineSessionsDeleting
                        : copy.engineSessionsDelete}
                    </button>
                  </li>
                ))}
              </ul>
              {engineSessionDetail?.session && (
                <div className="engine-session-detail">
                  <h3>{copy.engineSessionDetailsTitle}</h3>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsIdLabel}:</span>
                    <span className="engine-meta-value">{engineSessionDetail.session.id}</span>
                  </div>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsNameLabel}:</span>
                    <span className="engine-meta-value">{engineSessionDetail.session.name || '—'}</span>
                  </div>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsUpdatedLabel}:</span>
                    <span className="engine-meta-value">{new Date(engineSessionDetail.session.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsQuestionsLabel}:</span>
                    <span className="engine-meta-value">{engineSessionDetail.askedQuestionIds.length}</span>
                  </div>
                  <div className="engine-session-board">
                    <h4>{copy.engineSessionDetailsBoardTitle}</h4>
                    {engineSessionDetail.boardItems.length === 0 ? (
                      <div className="engine-empty">{copy.engineSessionDetailsBoardEmpty}</div>
                    ) : (
                      <ul className="engine-list">
                        {engineSessionDetail.boardItems.map((item) => {
                          const isEditing = engineEditItemId === item.id
                          return (
                            <li key={item.id} className="engine-item-row">
                              <span className="engine-badge">{item.type}</span>
                              {isEditing ? (
                                <textarea
                                  className="engine-item-input"
                                  rows={2}
                                  value={engineEditText}
                                  onChange={(event) => setEngineEditText(event.target.value)}
                                />
                              ) : (
                                <span className="engine-item-text">{item.text}</span>
                              )}
                              <div className="engine-item-actions">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      className="primary"
                                      onClick={saveEngineItem}
                                      disabled={engineEditLoading || !engineEditText.trim()}
                                    >
                                      Zapisz
                                    </button>
                                    <button type="button" className="ghost" onClick={cancelEditEngineItem}>
                                      Anuluj
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() => startEditEngineItem(item)}
                                      disabled={engineEditLoading}
                                    >
                                      Edytuj
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost danger"
                                      onClick={() => deleteEngineItem(item.id)}
                                      disabled={engineEditLoading}
                                    >
                                      Usuń
                                    </button>
                                  </>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {debugMatrixData && engineMatrixVisible && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{copy.engineMatrixTitle}</h2>
              </div>
              <div className="engine-debug-matrix" data-testid="debug-matrix">
                <input
                  type="checkbox"
                  className="sr-only"
                  data-testid="debug-matrix-toggle"
                  checked
                  readOnly
                />
                <div className="engine-debug-meta" data-testid="matrix-coverage">
                  Coverage: {debugMatrixData.coverage}/9
                </div>
                <div className="engine-debug-meta">
                  Gravity suggests next input toward:{' '}
                  {debugMatrixData.rows.find((row) => row.key === debugMatrixData.targetCell.row)
                    ?.label}{' '}
                  ×{' '}
                  {debugMatrixData.cols.find((col) => col.key === debugMatrixData.targetCell.col)
                    ?.label}
                </div>
                <div className="engine-debug-grid">
                  <div className="engine-debug-corner" />
                  {debugMatrixData.cols.map((col) => (
                    <div key={col.key} className="engine-debug-col-label">
                      {col.label}
                    </div>
                  ))}
                  {debugMatrixData.rows.map((row) => (
                    <div key={row.key} className="engine-debug-row">
                      <div className="engine-debug-row-label">{row.label}</div>
                      {debugMatrixData.cols.map((col) => {
                        const matrixKey = debugMatrixData.cellKey(row.key, col.key)
                        const cell = debugMatrixData.cells.get(matrixKey)
                        const isTarget =
                          debugMatrixData.targetCell.row === row.key &&
                          debugMatrixData.targetCell.col === col.key
                        return (
                          <div
                            key={matrixKey}
                            className={`engine-debug-cell ${isTarget ? 'target' : ''}`}
                            data-testid={`matrix-cell-${row.key}-${col.key}`}
                          >
                            <div className="engine-debug-count">{cell?.count ?? 0}</div>
                            <div className="engine-debug-items">
                              {(cell?.entries ?? []).map((entry) => (
                                <div key={entry.id} className="engine-debug-item" title={entry.text}>
                                  {entry.text}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {engineNamePromptOpen && !enginePreviewSessionId && (
            <section className="engine-panel">
              <div className="engine-name-prompt">
                <div className="engine-helper">{copy.engineNamePrompt}</div>
                <label>
                  <span>{copy.engineNameLabel}</span>
                  <input
                    data-testid="session-name-input"
                    value={engineNameDraft}
                    onChange={(event) => {
                      setEngineNameDraft(event.target.value.slice(0, 40))
                      if (engineNameError) setEngineNameError(null)
                    }}
                    placeholder={copy.engineNamePlaceholder}
                  />
                </label>
                <div className="engine-facilitation-actions">
                  {engineNameError && (
                    <span className="text-sm text-red-600">{engineNameError}</span>
                  )}
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-name-save"
                    disabled={engineNameSaving}
                    onClick={async () => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      if (engineNameSaving) return
                      const name = engineNameDraft.trim().replace(/\s+/g, ' ')
                      if (!name) {
                        setEngineNameError('Podaj nazwę sesji.')
                        return
                      }
                      setEngineNameSaving(true)
                      setEngineNameError(null)
                      if (authSession?.user?.id && client) {
                        const { data: u } = await client.auth.getUser()
                        const userId = u?.user?.id ?? null
                        if (!userId) {
                          showEngineNotice(
                            'Sesja logowania wygasła. Zaloguj się ponownie.',
                            'error'
                          )
                          setEngineNameSaving(false)
                          return
                        }
                        const { data: existingByName } = await client
                          .from('sessions')
                          .select('id,name')
                          .eq('user_id', userId)
                        const normalizedName = name.trim().toLowerCase()
                        const hasCollision = Boolean(
                          (existingByName || []).some((row) => {
                            const dbName = String(
                              (row as { name?: string | null }).name ?? ''
                            )
                              .trim()
                              .toLowerCase()
                            return dbName === normalizedName
                          })
                        )
                        console.log('[createSession] nameCollision', hasCollision)
                        if (hasCollision) {
                          setEngineNameError('Taka nazwa już istnieje — zmień nazwę.')
                          setEngineNameSaving(false)
                          return
                        }
                      }
                      armIdleWatch('save_and_continue')
                      engineInteractionBySession.current['new'] = true
                      setEngineInputFocused(true)
                      setEngineUiState('FREE_FLOW')
                      enginePendingArmingRef.current = true
                      enginePendingFocusRef.current = true
                      const sessionId = await ensureEnginePreviewSession(name, {
                        onNameCollision: () =>
                          setEngineNameError('Taka nazwa już istnieje — zmień nazwę.'),
                        onInsertError: () =>
                          setEngineNameError('Nie udało się utworzyć sesji. Spróbuj ponownie.'),
                      })
                      if (!sessionId) {
                        setEngineNameSaving(false)
                        return
                      }
                      setEnginePreviewSessionName(name)
                      setEngineNamePromptOpen(false)
                      setEngineNameSaving(false)
                      if (sessionId) {
                        engineInteractionBySession.current[sessionId] = true
                        setEngineLastInputActivityAt(Date.now())
                      }
                      engineInputRef.current?.focus()
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                    }}
                  >
                    {copy.engineNameSave}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setEngineNamePromptOpen(false)}
                  >
                    {copy.cancel}
                  </button>
                </div>
              </div>
            </section>
          )}

          {enginePreviewSessionId && showDiagnostics && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{uiLanguage === 'Polish' ? 'Matryca pytań' : 'Question matrix'}</h2>
                <div className="engine-helper">
                  {uiLanguage === 'Polish'
                    ? 'Liczba zadanych pytań w kategoriach + aktualna kategoria'
                    : 'Question counts by category + current question category'}
                </div>
              </div>
              <div className="engine-question-matrix">
                <div className="engine-question-matrix-corner" />
                {questionMatrix.cols.map((col) => (
                  <div key={col.key} className="engine-question-matrix-col">
                    {uiLanguage === 'Polish' ? col.labelPl : col.labelEn}
                  </div>
                ))}
                {questionMatrix.rows.map((row) => (
                  <div key={row.key} className="engine-question-matrix-row">
                    <div className="engine-question-matrix-row-label">
                      {uiLanguage === 'Polish' ? row.labelPl : row.labelEn}
                    </div>
                    {questionMatrix.cols.map((col) => {
                      const key = `${row.key}${col.key}`
                      const count = questionMatrix.counts[key] || 0
                      const isCurrent = questionMatrix.currentKey === key
                      return (
                        <div
                          key={key}
                          className={`engine-question-matrix-cell ${isCurrent ? 'is-current' : ''}`}
                        >
                          <span className="engine-question-matrix-count">{count}</span>
                          <span className="engine-question-matrix-code">{key}</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}

          {enginePreviewSessionId && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{copy.enginePreviewBoardItemsTitle}</h2>
                {showDiagnostics && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={assignNaItems}
                    disabled={
                      engineAssignLoading ||
                      engineUnassignedItems.length === 0 ||
                      !aiSupportEnabled ||
                      !engineSessionPersisted
                    }
                    title={
                      !aiSupportEnabled
                        ? 'AI jest wyłączony'
                        : !engineSessionPersisted
                          ? 'Najpierw utwórz sesję'
                          : engineUnassignedItems.length === 0
                          ? 'Brak wpisów N/A'
                          : 'Uzupełnij N/A (AI)'
                    }
                  >
                    {engineAssignLoading ? 'Uzupełniam…' : 'Uzupełnij N/A (AI)'}
                  </button>
                )}
                {highlightMissingLabels && missingLabelCount > 0 && (
                  <span className="engine-missing-label-hint">{copy.missingLabelHint}</span>
                )}
                <button
                  type="button"
                  className={`ghost engine-help-trigger engine-facilitation-actions--fade ${
                    showHelpButton ? 'is-visible' : 'is-hidden'
                  }`}
                  aria-label={copy.engineHelpButtonLabel}
                  onClick={() => {
                    clearEngineIdleTimer('manual_help')
                    engineIdleTriggered.current = false
                    engineIdleArmedRef.current = false
                    setEngineLastInputActivityAt(Date.now())
                    setEngineOfferReason('manual')
                    if (engineUiState !== 'FACILITATED_INPUT') {
                      setEngineUiState('FACILITATION_OFFER')
                    }
                  }}
                >
                  ?
                </button>
              <div
                className={`engine-helper engine-facilitation-note ${
                  showFacilitationOffer ? 'is-visible' : 'is-hidden'
                }`}
                aria-hidden={!showFacilitationOffer}
              >
                {copy.engineFacilitationNote}
              </div>
              {uiLanguage === 'English' && copy.engineQuestionsWipNote && (
                <div className="engine-helper">{copy.engineQuestionsWipNote}</div>
              )}
              <div
                className={`engine-facilitation-actions engine-facilitation-actions--fade ${
                  showFacilitationOffer ? 'is-visible' : 'is-hidden'
                }`}
                data-testid="facilitation-buttons"
                aria-hidden={!showFacilitationOffer}
              >
                {engineFacilitationInlineError && (
                  <span className="text-sm text-red-600">{engineFacilitationInlineError}</span>
                )}
                <button
                  type="button"
                  className="ghost"
                  data-testid="facilitation-deepen"
                  onClick={() => {
                    if (facilitationDisabled) {
                      setEngineFacilitationInlineError('Najpierw utwórz sesję.')
                      return
                    }
                    setFacilitationCooldown('DEEPEN')
                    armIdleWatch('facilitation_deepen')
                    void activateFacilitationPrompt('DEEPEN')
                  }}
                  disabled={
                    !showFacilitationOffer || engineFacilitationLoading || facilitationDisabled
                  }
                >
                  {showEngineFacilitationLoadingUI &&
                  engineFacilitationLoadingType === 'DEEPEN' ? (
                    <>
                      <span className="button-spinner" aria-hidden="true" />
                      {copy.engineFacilitationLoadingLabel}
                    </>
                  ) : (
                    copy.engineFacilitationDeepen
                  )}
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="facilitation-perspective"
                  onClick={() => {
                    if (facilitationDisabled) {
                      setEngineFacilitationInlineError('Najpierw utwórz sesję.')
                      return
                    }
                    setFacilitationCooldown('PERSPECTIVE')
                    armIdleWatch('facilitation_perspective')
                    void activateFacilitationPrompt('PERSPECTIVE')
                  }}
                  disabled={
                    !showFacilitationOffer || engineFacilitationLoading || facilitationDisabled
                  }
                >
                  {showEngineFacilitationLoadingUI &&
                  engineFacilitationLoadingType === 'PERSPECTIVE' ? (
                    <>
                      <span className="button-spinner" aria-hidden="true" />
                      {copy.engineFacilitationLoadingLabel}
                    </>
                  ) : (
                    copy.engineFacilitationPerspective
                  )}
                </button>
              </div>
              </div>
              {enginePreviewError && (
                <div className="engine-error">
                  <span>{enginePreviewError}</span>
                  {lastFacilitationType && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        void activateFacilitationPrompt(lastFacilitationType)
                      }}
                    >
                      {copy.engineFacilitationRetryCta}
                    </button>
                  )}
                </div>
              )}
              {enginePreviewError && engineFacilitationDiagnostics && (
                <div className="engine-debug-panel">
                  <div>URL: {engineFacilitationDiagnostics.url}</div>
                  <div>Status: {engineFacilitationDiagnostics.status}</div>
                  <div>Content-Type: {engineFacilitationDiagnostics.contentType}</div>
                  {engineFacilitationDiagnostics.json ? (
                    <pre>{JSON.stringify(engineFacilitationDiagnostics.json, null, 2)}</pre>
                  ) : (
                    <pre>
                      NON-JSON: {engineFacilitationDiagnostics.parseError || 'Unknown error'}
                      {'\n'}
                      {engineFacilitationDiagnostics.raw}
                    </pre>
                  )}
                </div>
              )}
              {import.meta.env.VITE_DEBUG_ENGINE === '1' && engineApiDebug && (
                <div className="engine-debug-panel">
                  <div>Endpoint: {engineApiDebug.endpoint}</div>
                  <div>Status: {engineApiDebug.status}</div>
                  <pre>{JSON.stringify(engineApiDebug.response, null, 2)}</pre>
                </div>
              )}
              <div className="engine-board-input">
                {(engineFacilitationLoading && showEngineFacilitationLoadingUI
                  ? copy.engineFacilitationLoadingPerspective
                  : engineActivePrompt?.text) && (
                  <div className="engine-helper engine-facilitation-prompt">
                    <div className="engine-facilitation-question">
                      {engineFacilitationLoading && showEngineFacilitationLoadingUI ? (
                        <span className="engine-facilitation-loading-row">
                          <span className="engine-facilitation-loading-text">
                            {engineFacilitationLoadingType === 'DEEPEN'
                              ? copy.engineFacilitationLoadingDeepen
                              : copy.engineFacilitationLoadingPerspective}
                          </span>
                          <span className="report-updating-slot" aria-hidden="true">
                            <span
                              className="report-updating-indicator"
                              role="status"
                              aria-label={uiLanguage === 'Polish' ? 'Aktualizowanie…' : 'Updating…'}
                              title={uiLanguage === 'Polish' ? 'Aktualizowanie…' : 'Updating…'}
                            />
                          </span>
                        </span>
                      ) : (
                        <>
                          {engineAskedQuestionTexts.length === 1 && facilitationIntroRef.current ? (
                            <div className="engine-facilitation-intro">
                              {facilitationIntroRef.current}
                            </div>
                          ) : null}
                          <div>{engineActivePrompt?.text}</div>
                        </>
                      )}
                    </div>
                    {!engineFacilitationLoading && showDiagnostics && enginePromptSource && (
                      <span className="impulse-source-row">
                        <span
                          className={`impulse-source-chip ${
                            enginePromptSource === 'fallback' ? 'fallback' : 'ai'
                          }`}
                        >
                          {enginePromptSource === 'fallback'
                            ? uiLanguage === 'Polish'
                              ? 'Tryb offline (fallback)'
                              : 'Offline mode (fallback)'
                            : 'AI'}
                        </span>
                        {import.meta.env.DEV && (
                          <span className="impulse-source-note">
                            {lastLlmSource === 'llm' ? 'AI generated' : 'Deterministic fallback'}
                            {lastLlmWhy ? ` · ${lastLlmWhy}` : ''}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                )}
                <div className="engine-input-field">
                  {showEngineInputCaret && <span className="engine-input-caret" aria-hidden="true" />}
                  <textarea
                    data-testid="engine-input"
                    ref={engineInputRef}
                    value={enginePreviewInput}
                    onChange={(event) => {
                      handleEnginePreviewInputChange(event)
                      engineIdleTriggered.current = false
                      clearEngineIdleTimer('input_change')
                      setEngineLastInputActivityAt(Date.now())
                      logFacilitationEvent('idle_timer_reset', { reason: 'input_change', at: Date.now() })
                    }}
                    onPointerDown={() => {
                      markUserInitiatedInteraction('pointer')
                      engineAllowIdleWithoutFocusRef.current = false
                      if (engineUiState === 'INIT') {
                        setEngineUiState('FREE_FLOW')
                      }
                      engineIdleTriggered.current = false
                      clearEngineIdleTimer('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      logFacilitationEvent('idle_timer_reset', { reason: 'pointer', at: Date.now() })
                    }}
                    onKeyDown={() => {
                      markUserInitiatedInteraction('keystroke')
                      engineAllowIdleWithoutFocusRef.current = false
                      if (engineOfferReason) {
                        setEngineOfferReason(null)
                        if (engineUiState === 'FACILITATION_OFFER') {
                          setEngineUiState('FREE_FLOW')
                        }
                      }
                      if (engineUiState === 'INIT') {
                        setEngineUiState('FREE_FLOW')
                      }
                      engineIdleTriggered.current = false
                      clearEngineIdleTimer('keystroke')
                      setEngineLastInputActivityAt(Date.now())
                      logFacilitationEvent('idle_timer_reset', { reason: 'keystroke', at: Date.now() })
                    }}
                    onFocus={() => {
                      setEngineInputFocused(true)
                      engineAllowIdleWithoutFocusRef.current = false
                      logFacilitationEvent('input_focus', { sessionId: getEngineSessionKey() })
                    }}
                    onBlur={() => {
                      setEngineInputFocused(false)
                      clearEngineIdleTimer('input_blur')
                      logFacilitationEvent('input_blur', { sessionId: getEngineSessionKey() })
                    }}
                    placeholder={enginePlaceholder}
                    rows={3}
                  />
                </div>
                <div className="engine-input-footer">
                <span className="engine-word-count">
                  {isEngineWordLimitReached
                    ? copy.engineWordLimitReached
                    : copy.engineWordCountRemaining(engineRemainingWords)}
                </span>
                <button
                  type="button"
                  className="primary"
                  data-testid="add-entry"
                  onClick={() => {
                    markUserInitiatedInteraction('pointer')
                    setEngineLastInputActivityAt(Date.now())
                    setEngineInputFocused(true)
                    engineAllowIdleWithoutFocusRef.current = true
                    armIdleWatch('add_item')
                    engineInputRef.current?.focus()
                    void handleEnginePreviewAdd()
                  }}
                  disabled={!enginePreviewInput.trim()}
                >
                  {copy.enginePreviewAddItem}
                </button>
                </div>
              </div>
              <ul className="engine-entry-list">
                {enginePreviewItems.length === 0 && (
                  <li className="engine-empty">{copy.enginePreviewBoardItemsEmpty}</li>
                )}
                {orderedEnginePreviewItems.map((item) => (
                  <li
                    key={item.id}
                    className={`engine-entry ${
                      highlightMissingLabels && isMissingLabel(item) ? 'missing-label' : ''
                    }`}
                    data-testid={`entry-row-${item.id}`}
                    onClick={() =>
                      setEngineLabelEditorId((prev) => (prev === item.id ? null : item.id))
                    }
                    onMouseMove={(event) => {
                      setEngineEntryHint({
                        x: event.clientX + 12,
                        y: event.clientY + 12,
                        visible: true,
                      })
                    }}
                    onMouseLeave={() =>
                      setEngineEntryHint((prev) => ({ ...prev, visible: false }))
                    }
                  >
                    {showDiagnostics &&
                      (() => {
                        const cellId = getEntryCellId(item)
                        return (
                          <button
                            type="button"
                            className={`engine-entry-cell ${cellId ? '' : 'is-na'}`}
                            title={cellId ? `Cell ${cellId}` : 'N/A'}
                            disabled
                          >
                            {cellId || 'N/A'}
                          </button>
                        )
                      })()}
                    <div className="engine-entry-main">
                      {enginePreviewEditId === item.id ? (
                        <div className="engine-entry-edit" onClick={(event) => event.stopPropagation()}>
                          <textarea
                            className="engine-entry-edit-input"
                            rows={3}
                            value={enginePreviewEditText}
                            onChange={(event) => {
                              const next = limitWords(event.target.value, WORD_LIMIT)
                              setEnginePreviewEditText(next)
                            }}
                          />
                          <div className="engine-entry-edit-actions">
                            <button
                              type="button"
                              className="primary"
                              onClick={saveEnginePreviewEdit}
                              disabled={!enginePreviewEditText.trim()}
                            >
                              {copy.save}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={cancelEnginePreviewEdit}
                            >
                              {copy.cancel}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="engine-entry-text">{item.text}</div>
                      )}
                      <div className="engine-entry-label-group">
                        {highlightMissingLabels && isMissingLabel(item) && (
                          <span className="engine-entry-missing-badge">
                            {copy.missingLabelBadge}
                          </span>
                        )}
                        <button
                          type="button"
                          className="engine-entry-delete-button engine-entry-action"
                          aria-label={copy.engineEntryDeleteLabel}
                          title={copy.engineEntryDeleteLabel}
                          onClick={(event) => {
                            event.stopPropagation()
                            setEngineEntryDeleteId(item.id)
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            aria-hidden="true"
                          >
                            <path
                              fill="currentColor"
                              d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 1 0 0 2H6v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9zm1 2h4v1h-4V5zm-1 4a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1zm6 1a1 1 0 1 0-2 0v7a1 1 0 1 0 2 0v-7z"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="engine-entry-edit-button engine-entry-action"
                          aria-label={copy.editIdeaTitle}
                          onClick={(event) => {
                            event.stopPropagation()
                            startEnginePreviewEdit(item)
                          }}
                        >
                          ✎
                        </button>
                        {item.label && (
                          <span
                            className="engine-entry-label"
                            data-testid={`entry-label-${item.id}`}
                            style={{
                              backgroundColor:
                                ENGINE_ENTRY_LABEL_COLORS[item.label] || '#e7ebf0',
                              color: '#000000',
                            }}
                          >
                            {uiLanguage === 'English'
                              ? getEntryLabelText(item.label, 'English')
                              : getEntryLabelText(item.label, 'Polish')}
                          </span>
                        )}
                      </div>
                    </div>
                    {engineEntryDeleteId === item.id && (
                      <div
                        className="engine-entry-delete-confirm"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span>{copy.engineEntryDeleteConfirm}</span>
                        <div className="engine-entry-delete-actions">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => confirmEngineEntryDelete(item.id)}
                          >
                            {copy.engineEntryDeleteYes}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={cancelEngineEntryDelete}
                          >
                            {copy.engineEntryDeleteCancel}
                          </button>
                        </div>
                      </div>
                    )}
                    {engineLabelEditorId === item.id && (
                      <div
                        ref={engineLabelEditorRef}
                        className="engine-entry-label-editor"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <label className="engine-entry-label-field">
                          <span className="sr-only">Etykieta wpisu</span>
                          <select
                            data-testid={`entry-label-select-${item.id}`}
                            value={item.label ?? ''}
                            onChange={(event) => {
                              const nextValue = event.target.value || null
                              armIdleWatch('label_change')
                              setEngineLastInputActivityAt(Date.now())
                              void updateEngineEntryLabel(item.id, nextValue)
                              setEngineLabelEditorId(null)
                            }}
                          >
                          <option value="">{getNoLabelText(uiLanguage)}</option>
                          {ENGINE_ENTRY_LABELS.map((label) => (
                            <option key={label} value={label}>
                              {getEntryLabelText(label, uiLanguage)}
                            </option>
                          ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div
                className={`engine-entry-hint ${engineEntryHint.visible ? 'is-visible' : ''}`}
                style={{ left: engineEntryHint.x, top: engineEntryHint.y }}
                aria-hidden={!engineEntryHint.visible}
              >
                {copy.engineEntryLabelHint}
              </div>
            </section>
          )}
        </main>
          {feedbackPanel}
          {feedbackFab}
          {missingLabelModal}
        </div>
      )
    }

  if (isWorkInProgress) {
    return withDevOverlay(
      <div className="app">
        <div className="topbar-links">
          <a className="ghost topbar-link" href="/">
            Home page
          </a>
        </div>
        <div className="landing-section hero in-view">
          <div className="landing-inner">
            <a className="primary landing-cta" href="/?view=threeSteps">
              {copy.landingThreeStepsCta}
            </a>
            <a className="primary landing-cta" href="/grid">
              Grid
            </a>
            <button type="button" className="primary landing-cta">
              Watch 60-second demo
            </button>
          </div>
        </div>
        {feedbackPanel}
        {feedbackFab}
      </div>
    )
  }

  return withDevOverlay(
    <div className="app">
      <header className={`top-bar ${showLanding ? 'landing-top' : ''}`}>
        {!showLanding && <div className="brand">{copy.appTitle}</div>}
        {!showLanding && (
          <div className="roadmap">
            {stepOrder.map((stepId) => (
              <button
                key={stepId}
                type="button"
                className={`roadmap-step ${stepId === activeStep ? 'active' : ''}`}
                onClick={() => {
                  if (stepId <= activeStep) setActiveStep(stepId)
                }}
              >
                <span className="step-index">
                  {copy.stepLabel} {stepId}
                </span>
                <span className="step-title">{stepTitle(stepId)}</span>
              </button>
            ))}
          </div>
        )}
        {(showLanding || activeStep === 1) && (
          <label className="topbar-language">
            <span>{copy.languageLabel}</span>
            <select
              value={uiLanguage}
              onChange={(event) => setUiLanguage(event.target.value as Language)}
            >
              {uiLanguageOptions.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>
        )}
        {!showLanding && isAdmin && (
          <button
            className={`ai-support-toggle diagnostics-toggle ${showDiagnostics ? 'on' : 'off'}`}
            type="button"
            onClick={() => {
              const nextEnabled = !showDiagnostics
              setDiagnosticsEnabled(nextEnabled)
              localStorage.setItem(
                DIAGNOSTICS_STORAGE_KEY,
                nextEnabled ? 'true' : 'false'
              )
            }}
          >
            {showDiagnostics ? copy.diagnosticsOn : copy.diagnosticsOff}
          </button>
        )}
        {!showLanding && showDiagnostics && (
          <button
            className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
            type="button"
            onClick={() => {
              const nextEnabled = !aiSupportEnabled
              setAiSupportEnabled(nextEnabled)
              localStorage.setItem('aiSupportEnabled', nextEnabled ? 'true' : 'false')
              if (nextEnabled) {
                void checkLlmStatus(normalizeApiBase(llmApiBase))
              } else {
                setLlmStatus('offline')
              }
            }}
          >
            {aiSupportEnabled ? copy.aiSupportOn : copy.aiSupportOff}
          </button>
        )}
        {!showLanding && (
          <button
            className="ghost llm-button"
            type="button"
            onClick={() => setLlmSettingsOpen(true)}
          >
            {copy.llmSettings}
          </button>
        )}
        <div className="topbar-links">
          {!showLanding && (
            <a className="ghost topbar-link" href="/">
              Landing page
            </a>
          )}
        </div>
        {!showLanding && activeStep !== 1 && (
          <button className="report-button" type="button" onClick={() => setReportSnapshotOpen(true)}>
            <IconReport />
            <span>{copy.report}</span>
          </button>
        )}
        {showLanding && (
          <div className="scroll-progress" aria-hidden="true">
            <span />
          </div>
        )}
      </header>

      <main className="content">
        {showLanding && landingView === 'main' && (
          <section className="landing">
            <div className="landing-section hero in-view">
              <div className="landing-inner">
                <h1>{copy.landingHeroTitle}</h1>
                <p>{copy.landingHeroSubtitle}</p>
                {uiLanguage === 'Polish' && (
                  <a
                    className="primary landing-cta"
                    href="https://youtu.be/2mLESqZKDj0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="landing-cta-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="36" height="36">
                        <path
                          fill="currentColor"
                          d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2.2l4.4 2.2a1 1 0 0 0 1.6-.8V8a1 1 0 0 0-1.6-.8L15 9.4V8a2 2 0 0 0-2-2H4z"
                        />
                      </svg>
                    </span>
                    Zobacz jak to działa (90 s)
                  </a>
                )}
                {uiLanguage === 'English' && (
                  <a
                    className="primary landing-cta"
                    href="https://youtu.be/0OBBZfOAltU"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="landing-cta-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="36" height="36">
                        <path
                          fill="currentColor"
                          d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2.2l4.4 2.2a1 1 0 0 0 1.6-.8V8a1 1 0 0 0-1.6-.8L15 9.4V8a2 2 0 0 0-2-2H4z"
                        />
                      </svg>
                    </span>
                    Watch how it works (90 sec)
                  </a>
                )}
              </div>
            </div>

            <div className="landing-section intro">
              <div className="landing-inner">
                <div className="intro-title">
                  <span className="title-brand">{copy.landingIntroTitleLines[0]}</span>
                  <span className="title-subline">
                    {copy.landingIntroTitleLines.slice(1).join(' ').trim()}
                  </span>
                </div>
                <p className="intro-subtext">
                  <span>{copy.landingIntroSubtextLines[0]}</span>
                  <span>{copy.landingIntroSubtextLines[1]}</span>
                  <span>{copy.landingIntroSubtextLines[2]}</span>
                  <span>
                    {copy.landingIntroSubtextLines[3]
                      .split('{emphasis}')
                      .map((part, index) =>
                        index === 0 ? (
                          part
                        ) : (
                          <span key={`emphasis-${index}`}>
                            <strong>{copy.landingIntroSubtextEmphasis}</strong>
                            {part}
                          </span>
                        )
                      )}
                  </span>
                </p>
                <div className="intro-cta">
                  <a
                    className="primary landing-cta"
                    href="/login"
                    onClick={handleLandingCtaClick}
                  >
                    {copy.landingCta}
                  </a>
                  {uiLanguage === 'English' && (
                    <div className="landing-microcopy">
                      Sign up in 30 seconds • No credit card required
                    </div>
                  )}
                  {uiLanguage === 'Polish' && (
                    <div className="landing-microcopy">rejestracja w 30 s • bez karty</div>
                  )}
                </div>
              </div>
            </div>

            <div className="landing-section before">
              <div className="landing-inner">
                <p className="before-lead">
                  {copy.landingBeforeLead}
                </p>
                <ul className="icon-list negative">
                  {copy.landingBeforeList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="landing-emphasis">
                  <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                  <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                  {copy.landingBeforeEmphasis.rest}
                </div>
              </div>
            </div>

            <div className="landing-section after">
              <div className="landing-inner">
                <p className="before-lead">{copy.landingAfterLead}</p>
                <ul className="icon-list positive">
                  {copy.landingAfterList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="landing-section why">
              <div className="landing-inner">
                <p className="before-lead why-lead">
                  <span>{copy.landingWhyLead.split('. ')[0]}.</span>
                  <span>{copy.landingWhyLead.split('. ')[1]}</span>
                </p>
                <div className="stacked-lines">
                  <span className="stacked-brand">{copy.landingWhyLines[0]}</span>
                  {copy.landingWhyLines.slice(1).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="landing-section who">
              <div className="landing-inner">
                <h2>{copy.landingWhoTitle}</h2>
                <ul className="icon-list neutral">
                  {copy.landingWhoList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="landing-final">
                  <p>{copy.landingFinalLines[0]}</p>
                  <p className="final-shift">{copy.landingFinalLines[1]}</p>
                  <a
                    className="primary landing-cta"
                    href="/login"
                    onClick={handleLandingCtaClick}
                  >
                    {copy.landingCta}
                  </a>
                  {uiLanguage === 'English' && (
                    <div className="landing-microcopy">
                      Sign up in 30 seconds • No credit card required
                    </div>
                  )}
                  {uiLanguage === 'Polish' && (
                    <div className="landing-microcopy">rejestracja w 30 s • bez karty</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
        {showLanding && landingView === 'threeSteps' && (
          <section className="landing">
            <div className="landing-section hero in-view">
              <div className="landing-inner">
                <div className="three-steps-title">{copy.landingThreeStepsTitle}</div>
                <h1>{copy.landingHeroTitle}</h1>
                <p>{copy.landingHeroSubtitle}</p>
                <button type="button" className="ghost landing-back" onClick={openMainLanding}>
                  ← Back to full page
                </button>
              </div>
            </div>

            <div className="landing-section intro">
              <div className="landing-inner">
                <div className="intro-title">
                  <span className="title-brand">{copy.landingIntroTitleLines[0]}</span>
                  <span className="title-subline">
                    {copy.landingIntroTitleLines.slice(1).join(' ').trim()}
                  </span>
                </div>
                <p className="intro-subtext">
                  <span>{copy.landingIntroSubtextLines[0]}</span>
                  <span>{copy.landingIntroSubtextLines[1]}</span>
                  <span>{copy.landingIntroSubtextLines[2]}</span>
                  <span>
                    {copy.landingIntroSubtextLines[3]
                      .split('{emphasis}')
                      .map((part, index) =>
                        index === 0 ? (
                          part
                        ) : (
                          <span key={`emphasis-three-${index}`}>
                            <strong>{copy.landingIntroSubtextEmphasis}</strong>
                            {part}
                          </span>
                        )
                      )}
                  </span>
                </p>
                <a
                  className="primary landing-cta"
                  href="/login"
                  onClick={handleLandingCtaClick}
                >
                  {copy.landingCta}
                </a>
              </div>
            </div>

            <div className="landing-section before">
              <div className="landing-inner">
                <p className="before-lead">{copy.landingBeforeLead}</p>
                <ul className="icon-list negative">
                  {copy.landingBeforeList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="landing-emphasis">
                  <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                  <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                  {copy.landingBeforeEmphasis.rest}
                </div>
              </div>
            </div>
          </section>
        )}
        {!showLanding && activeStep === 1 && (
          <section className="panel">
            <div className="step1-section">
              <div className="panel-header">
                <h1>{stepHeading(1)}</h1>
                <p>{copy.step1Intro}</p>
              </div>

              <div className="field-group">
                <label htmlFor="product-description">{copy.productDescriptionLabel}</label>
                <div className="product-description-row">
                  <textarea
                    id="product-description"
                    rows={4}
                    value={productDescription}
                    onChange={(event) => {
                      const next = limitWords(event.target.value, 500)
                      setProductDescription(next)
                    }}
                    placeholder={copy.productDescriptionPlaceholder}
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={!productDescription.trim()}
                    onClick={() => {
                      void requestNameSuggestions()
                    }}
                  >
                    {copy.productDescriptionDoneLabel}
                  </button>
                </div>
              </div>

              <div className="field-group">
                <label htmlFor="product-name">{copy.productNameLabel}</label>
                <div className="product-input">
                  <input
                    id="product-name"
                    type="text"
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                    placeholder={copy.productNamePlaceholder}
                    onDragOver={allowDrop}
                    onDrop={(event) => {
                      event.preventDefault()
                      const dropped = event.dataTransfer.getData('text/plain')
                      if (dropped) setProductName(dropped)
                    }}
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={!productName.trim()}
                    onClick={() => setProductConfirmed(true)}
                  >
                    {copy.confirmProductLabel}
                  </button>
                </div>
                {productDescriptionConfirmed && (
                  <div className="name-suggestions">
                    <span className="muted">{copy.productNameSuggestionsLabel}</span>
                    <div className="name-suggestion-row">
                      {productNameSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="name-suggestion"
                          draggable
                          onDragStart={(event) => handleNameDragStart(event, suggestion)}
                          onClick={() => setProductName(suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {productConfirmed && (
              <div className="step1-section">
                <div className="step1-panels">
                  <div className="step1-panel">
                    <h2>{copy.step1SpacesTitle}</h2>
                    <p className="muted">{copy.step1DragHint}</p>
                    <div className="dropzone-stack">
                      <div
                        className={`step1-dropzone space ${
                          spaceAssignments.supersystem !== null ? 'filled' : ''
                        }`}
                        onDragOver={allowDrop}
                        onDrop={handleDropOnSpace('supersystem')}
                      >
                        <div className="dropzone-header">
                          <span className="dropzone-title">{copy.axisSupersystem}</span>
                        </div>
                        <div className="dropzone-body">
                          {spaceAssignments.supersystem === null ? (
                            <span className="placeholder">{copy.step1DropHere}</span>
                          ) : (
                            <button
                              type="button"
                              className="dropzone-value"
                              draggable
                              onDragStart={(event) =>
                                handleDragStart(event, 'space', spaceAssignments.supersystem as number)
                              }
                            >
                              {spaceOptionMap.get(spaceAssignments.supersystem)?.label || copy.notSet}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="step1-dropzone locked">
                        <div className="dropzone-header">
                          <span className="dropzone-title">{copy.step1SystemLabel}</span>
                          <span className="lock-tag">{copy.step1SystemLocked}</span>
                        </div>
                        <div className="dropzone-body">
                          <span className="dropzone-value static">
                            {productName || copy.notSet}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`step1-dropzone space ${
                          spaceAssignments.subsystem !== null ? 'filled' : ''
                        }`}
                        onDragOver={allowDrop}
                        onDrop={handleDropOnSpace('subsystem')}
                      >
                        <div className="dropzone-header">
                          <span className="dropzone-title">{copy.axisSubsystem}</span>
                        </div>
                        <div className="dropzone-body">
                          {spaceAssignments.subsystem === null ? (
                            <span className="placeholder">{copy.step1DropHere}</span>
                          ) : (
                            <button
                              type="button"
                              className="dropzone-value"
                              draggable
                              onDragStart={(event) =>
                                handleDragStart(event, 'space', spaceAssignments.subsystem as number)
                              }
                            >
                              {spaceOptionMap.get(spaceAssignments.subsystem)?.label || copy.notSet}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="step1-options">
                      {spaceOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`step1-option ${
                            assignedSpaceIds.includes(option.id) ? 'assigned' : ''
                          }`}
                          draggable
                          onDragStart={(event) => handleDragStart(event, 'space', option.id)}
                        >
                          <span className="drag-handle" aria-hidden="true">
                            ⋮⋮
                          </span>
                          <span className="option-icon" aria-hidden="true">
                            {option.kind === 'world' ? <IconWorld /> : <IconElement />}
                          </span>
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="step1-panel">
                    <h2>{copy.step1TimeframesTitle}</h2>
                    <p className="muted">{copy.step1DragHint}</p>
                    <div className="dropzone-stack">
                      {(['past', 'now', 'future'] as const).map((slot) => (
                        <div
                          key={slot}
                          className={`step1-dropzone time ${
                            timeAssignments[slot] !== null ? 'filled' : ''
                          }`}
                          onDragOver={allowDrop}
                          onDrop={handleDropOnTime(slot)}
                        >
                          <div className="dropzone-header">
                            <span className="dropzone-title">{timeLabelMap[slot]}</span>
                          </div>
                          <div className="dropzone-body">
                            {timeAssignments[slot] === null ? (
                              <span className="placeholder">{copy.step1DropHere}</span>
                            ) : (
                              <button
                                type="button"
                                className="dropzone-value"
                                draggable
                                onDragStart={(event) =>
                                  handleDragStart(event, 'time', timeAssignments[slot] as number)
                                }
                              >
                                {timeOptionMap.get(timeAssignments[slot] as number) || copy.notSet}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="step1-options">
                      {timeOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`step1-option ${
                            assignedTimeIds.includes(option.id) ? 'assigned' : ''
                          }`}
                          draggable
                          onDragStart={(event) => handleDragStart(event, 'time', option.id)}
                        >
                          <span className="drag-handle" aria-hidden="true">
                            ⋮⋮
                          </span>
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="actions">
                  <button type="button" className="ghost" disabled>
                    {copy.previousStepNone}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!canProceedToStep2}
                    onClick={() => setActiveStep(2)}
                  >
                    {copy.nextStepPrefix}
                    {stepTitle(2)}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {!showLanding && activeStep === 2 && (
          <section className="panel step2">
            <div className="panel-header">
              <h1>{stepHeading(2)}</h1>
              <p>{copy.scenarioIntro}</p>
            </div>

            {selectedScenario && (
              <div className="step2-grid">
                {spaceSectionsStep2.map((section, rowIndex) => (
                  <div
                    key={section}
                    className="axis-definition step2-space"
                    style={{ gridRow: rowIndex + 1, gridColumn: 1 }}
                  >
                    <strong>{spaceLabelMap[section]}</strong>
                    {section === 'system' ? (
                      <input
                        type="text"
                        value={productName}
                        readOnly
                        className="read-only"
                      />
                    ) : (
                      <textarea
                        rows={1}
                        ref={autosizeTextarea}
                        value={selectedScenario.spaceDefs[section]}
                        onChange={(event) => {
                          updateScenarioSpaceDef(section, event.target.value)
                          autosizeTextarea(event.currentTarget)
                        }}
                      />
                    )}
                  </div>
                ))}

                {spaceSectionsStep2.map((spaceKey, rowIndex) =>
                  timeSections.map((timeKey, colIndex) => (
                    <div
                      key={`${spaceKey}-${timeKey}`}
                      className="matrix-cell"
                      style={{ gridRow: rowIndex + 1, gridColumn: colIndex + 2 }}
                    />
                  ))
                )}

                {timeSections.map((section, colIndex) => (
                  <div
                    key={section}
                    className="axis-definition step2-time"
                    style={{ gridRow: 4, gridColumn: colIndex + 2 }}
                  >
                    <strong>{timeLabelMap[section]}</strong>
                    <textarea
                      rows={1}
                      ref={autosizeTextarea}
                      value={selectedScenario.timeDefs[section]}
                      onChange={(event) => {
                        updateScenarioTimeDef(section, event.target.value)
                        autosizeTextarea(event.currentTarget)
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="actions">
              <button type="button" className="ghost" onClick={() => setActiveStep(1)}>
                {copy.previousStepPrefix}
                {stepTitle(1)}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!canProceedToStep3}
                onClick={() => setActiveStep(3)}
              >
                {copy.nextStepPrefix}
                {stepTitle(3)}
              </button>
            </div>
          </section>
        )}

        {!showLanding && activeStep === 3 && selectedScenario && (
          <section className="panel step3">
            <div className="step3-header">
              <div className="panel-header">
                <h1>{stepHeading(3)}</h1>
                <p>{copy.workshopIntro}</p>
              </div>
              <div className="action-stack">
                <button
                  type="button"
                  className="primary"
                  disabled={isSuggestLoading}
                  onClick={() => void requestImpulse()}
                  aria-busy={isSuggestLoading}
                >
                  {showSuggestLoadingUI && (
                    <span className="button-spinner" aria-hidden="true" />
                  )}
                  {showSuggestLoadingUI ? 'Generuję pytanie…' : copy.impulseButtonLabel}
                </button>
                <button type="button" className="primary" onClick={() => void addLlmIdeas()}>
                  {copy.ideaGenerator}
                </button>
                <button type="button" className="primary" onClick={() => setConfirmRemoveOpen(true)}>
                  {copy.keepOnlyMyIdeasLabel}
                </button>
                <button type="button" className="primary" onClick={() => setLabelEditorOpen(true)}>
                  {copy.labelEditorLabel}
                </button>
              </div>
            </div>

            <div className="legend">
              <div>
                <IconIdea />
                <span>{copy.legendIdea}</span>
              </div>
              <div>
                <IconSearch />
                <span>{copy.showIdeaLabel}</span>
              </div>
            </div>
            <div className="legend-labels">
              {ideaLabels.map((label) => (
                <span
                  key={label.id}
                  className="legend-chip"
                  style={{ backgroundColor: `${label.color}4D` }}
                >
                  {label.text}
                </span>
              ))}
            </div>

            <div className="step3-grid">
              {spaceSectionsStep3.map((section, rowIndex) => (
                <div
                  key={section}
                  className={`axis-definition step3-space ${
                    hoveredCell?.space === section ? 'highlight' : ''
                  }`}
                  style={{ gridRow: rowIndex + 1, gridColumn: 1 }}
                >
                  <strong>{spaceLabelMap[section]}</strong>
                  <span>{selectedScenario.spaceDefs[section]}</span>
                </div>
              ))}

              {spaceSectionsStep3.map((spaceKey, rowIndex) =>
                timeSections.map((timeKey, colIndex) => {
                  const cellKey = `${spaceKey}-${timeKey}`
                  const ideas = workshopIdeas[cellKey] || []
                  const isHovered =
                    hoveredCell?.space === spaceKey && hoveredCell?.time === timeKey
                  return (
                    <div
                      key={cellKey}
                      className={`matrix-cell ${isHovered ? 'highlight' : ''}`}
                      style={{ gridRow: rowIndex + 1, gridColumn: colIndex + 2 }}
                      onMouseEnter={() => setHoveredCell({ space: spaceKey, time: timeKey })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      <div className="cell-head">
                        <span className="cell-label">
                          {copy.cellLabel(spaceLabelMap[spaceKey], timeLabelMap[timeKey])}
                        </span>
                        <div className="cell-actions">
                          <button
                            type="button"
                            className="icon-button"
                            title={copy.addIdeaTooltip}
                            onClick={() => {
                              setActiveIdeaCell(cellKey)
                              setIdeaDraft('')
                              setIdeaLabelDraft(null)
                            }}
                          >
                            <IconIdea />
                          </button>
                        </div>
                      </div>
                      <div className="post-it-area">
                        {ideas.map((idea) => {
                          const labelInfo = getLabelForIdea(idea.id)
                          return (
                            <button
                              key={idea.id}
                              type="button"
                              className={`post-it ${idea.source}`}
                              title={copy.editIdeaTooltip}
                              onClick={() => {
                                setPostItEdit(idea)
                                setPostItEditCell(cellKey)
                                setPostItLabelDraft(ideaLabelAssignments[idea.id] ?? null)
                                setPostItEditOriginalText(idea.text)
                              }}
                            >
                              <span
                                className="post-it-zoom"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setIdeaPreview(idea)
                                }}
                              >
                                🔍
                              </span>
                              {labelInfo && (
                                <span
                                  className="label-dot"
                                  style={{ color: labelInfo.color }}
                                />
                              )}
                              {idea.text}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              )}

              {timeSections.map((section, colIndex) => (
                <div
                  key={section}
                  className={`axis-definition step3-time ${
                    hoveredCell?.time === section ? 'highlight' : ''
                  }`}
                  style={{ gridRow: 4, gridColumn: colIndex + 2 }}
                >
                  <strong>{timeLabelMap[section]}</strong>
                  <span>{selectedScenario.timeDefs[section]}</span>
                </div>
              ))}
            </div>

            <div className="actions">
              <button type="button" className="ghost" onClick={() => setActiveStep(2)}>
                {copy.previousStepPrefix}
                {stepTitle(2)}
              </button>
              <button type="button" className="primary" onClick={() => setActiveStep(4)}>
                {copy.nextStepPrefix}
                {stepTitle(4)}
              </button>
            </div>
          </section>
        )}

        {!showLanding && activeStep === 4 && (
          <section className="panel">
            <div className="panel-header">
              <h1>{stepHeading(4)}</h1>
              <p>{copy.finalReportIntro}</p>
            </div>

            <div className="field-group">
              <label htmlFor="report-language">{copy.reportLanguageLabel}</label>
              <select
                id="report-language"
                value={reportLanguage}
                onChange={(event) => setReportLanguage(event.target.value as Language)}
              >
                {languageOptions.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
              <p className="muted">{copy.reportLanguageHint}</p>
            </div>

            <div className="report">
              <div className="report-section">
                <h2>{stepHeading(1)}</h2>
                <p>
                  <strong>{copy.productLabel}:</strong>{' '}
                  {reportData.step1.productName || copy.notSet}
                </p>
                <p>
                  <strong>{copy.spacesLabel}:</strong>{' '}
                  {reportData.step1.spaces.length
                    ? reportData.step1.spaces.join(', ')
                    : copy.notSet}
                </p>
                <p>
                  <strong>{copy.timeFramesLabel}:</strong>{' '}
                  {reportData.step1.times.length ? reportData.step1.times.join(', ') : copy.notSet}
                </p>
              </div>

              <div className="report-section">
                <h2>{stepHeading(2)}</h2>
                <p>
                  <strong>{copy.totalScenariosLabel}:</strong>{' '}
                  {reportData.step2.totalScenarios}
                </p>
                <p>
                  <strong>{copy.chosenScenarioLabel}:</strong>{' '}
                  {reportData.step2.selectedScenario || copy.notSelected}
                </p>
                {reportData.step3 ? (
                  <>
                    <p>
                      <strong>{copy.spaceDefinitionsLabel}:</strong>{' '}
                      {`${reportData.step3.spaceDefs.subsystem} | ${reportData.step3.spaceDefs.system} | ${reportData.step3.spaceDefs.supersystem}`}
                    </p>
                    <p>
                      <strong>{copy.timeDefinitionsLabel}:</strong>{' '}
                      {`${reportData.step3.timeDefs.past} | ${reportData.step3.timeDefs.now} | ${reportData.step3.timeDefs.future}`}
                    </p>
                  </>
                ) : (
                  <p>{copy.noScenarioConfirmed}</p>
                )}
              </div>

              <div className="report-section">
                <h2>{stepHeading(3)}</h2>
                <p>
                  <strong>{copy.totalIdeasLabel}:</strong> {reportData.step4.totalIdeas}
                </p>
                <p>
                  <strong>{copy.cellsWithIdeasLabel}:</strong> {reportData.step4.cellsWithIdeas} /
                  9
                </p>
                <div className="idea-groups">
                  <div>
                    <strong>{copy.ideasUserLabel}:</strong>
                    {reportData.step4.userIdeas.length ? (
                      <ul className="idea-list">
                        {reportData.step4.userIdeas.map((idea, index) => (
                          <li key={`user-idea-${index}`}>{idea}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">{copy.noIdeasLabel}</p>
                    )}
                  </div>
                  <div>
                    <strong>{copy.ideasGeneratedLabel}:</strong>
                    {reportData.step4.llmIdeas.length ? (
                      <ul className="idea-list">
                        {reportData.step4.llmIdeas.map((idea, index) => (
                          <li key={`llm-idea-${index}`}>{idea}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">{copy.noIdeasLabel}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="report-section">
                <h2>{stepHeading(4)}</h2>
                <p>
                  <strong>{copy.selectedLanguageLabel}:</strong> {reportData.step4Report.language}
                </p>
              </div>
            </div>

            <div className="actions">
              <button type="button" className="ghost" onClick={() => setActiveStep(3)}>
                {copy.previousStepPrefix}
                {stepTitle(3)}
              </button>
              <button type="button" className="secondary" onClick={() => setReportSnapshotOpen(true)}>
                {copy.openReportPanel}
              </button>
              <button type="button" className="primary" disabled>
                {copy.nextStepCompleted}
              </button>
            </div>
          </section>
        )}
      </main>
      {activeIdeaCell && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.editIdeaTitle}</h2>
              {(() => {
                const labelItem = getLabelById(ideaLabelDraft)
                const isFilled = Boolean(labelItem)
                const color = labelItem?.color || null
                return (
                  <div
                    className={`label-drop-target ${isFilled ? 'filled' : 'placeholder'}`}
                    style={
                      isFilled && color
                        ? { backgroundColor: color, borderColor: color }
                        : undefined
                    }
                    onDragOver={allowDrop}
                    onDrop={(event) => {
                      event.preventDefault()
                      const dropped = event.dataTransfer.getData('application/label')
                      setIdeaLabelDraft(dropped || null)
                    }}
                  >
                    {isFilled ? labelItem?.text : copy.labelDropPlaceholder}
                  </div>
                )
              })()}
            </div>
            <div className="modal-body">
              <textarea
                className="modal-textarea"
                value={ideaDraft}
                onChange={(event) => setIdeaDraft(event.target.value)}
                placeholder={copy.ideaPlaceholder}
              />
              <div className="label-row">
                <button
                  type="button"
                  className="label-chip no-label"
                  draggable
                  onDragStart={(event) => handleLabelDragStart(event, null)}
                >
                  {copy.noLabelText}
                </button>
                {ideaLabels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    className="label-chip"
                    draggable
                    onDragStart={(event) => handleLabelDragStart(event, label.id)}
                    style={{
                      backgroundColor: `${label.color}4D`,
                    }}
                  >
                    {label.text}
                  </button>
                ))}
              </div>
              <div className="idea-editor-actions">
                <span>{copy.wordCount(countWords(ideaDraft))}</span>
                <div>
                  <button type="button" className="ghost" onClick={() => setActiveIdeaCell(null)}>
                    {copy.cancel}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!ideaDraft.trim() || countWords(ideaDraft) > 50}
                    onClick={() => {
                      const ideaId = `user-${Date.now()}`
                      setWorkshopIdeas((prev) => ({
                        ...prev,
                        [activeIdeaCell]: [...(prev[activeIdeaCell] || []), { id: ideaId, text: ideaDraft.trim(), source: 'user' }],
                      }))
                      if (ideaLabelDraft) {
                        setIdeaLabelAssignments((prev) => ({
                          ...prev,
                          [ideaId]: ideaLabelDraft,
                        }))
                      }
                      setActiveIdeaCell(null)
                    }}
                  >
                    {copy.saveIdea}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {impulseOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.impulseTitle}</h2>
              <button type="button" className="ghost" onClick={() => setImpulseOpen(false)}>
                {copy.impulseClose}
              </button>
            </div>
            <div className="modal-body">
              {isSuggestLoading ? (
                showSuggestLoadingUI ? (
                  <div className="impulse-placeholder" role="status" aria-live="polite">
                    <div className="impulse-placeholder-line" />
                    <div className="impulse-placeholder-line short" />
                    <p className="muted">Dobieram perspektywę do Twojej tablicy…</p>
                  </div>
                ) : (
                  <div className="impulse-placeholder" aria-hidden="true" />
                )
              ) : (
                <p>{impulseQuestion || copy.impulseEmpty}</p>
              )}
              {!isSuggestLoading && impulseQuestion && impulseSource && showDiagnostics && (
                <span className="impulse-source-row">
                  <span
                    className={`impulse-source-chip ${
                      impulseSource === 'fallback' ? 'fallback' : 'ai'
                    }`}
                  >
                    {impulseSource === 'fallback' ? 'Tryb offline (fallback)' : 'AI'}
                  </span>
                  {import.meta.env.DEV && (
                    <span className="impulse-source-note">
                      {lastLlmSource === 'llm' ? 'AI generated' : 'Deterministic fallback'}
                      {lastLlmWhy ? ` · ${lastLlmWhy}` : ''}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {reportSnapshotOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.reportSnapshotTitle}</h2>
              <button type="button" className="ghost" onClick={() => setReportSnapshotOpen(false)}>
                {copy.close}
              </button>
            </div>
            <div className="modal-body">
              <div className="field-group">
                <label htmlFor="report-language-modal">{copy.reportLanguageLabel}</label>
                <select
                  id="report-language-modal"
                  value={reportLanguage}
                  onChange={(event) => setReportLanguage(event.target.value as Language)}
                >
                  {languageOptions.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </div>
              <div className="report-section">
                <h3>{stepHeading(1)}</h3>
                <p>
                  <strong>{copy.productLabel}:</strong>{' '}
                  {reportData.step1.productName || copy.notSet}
                </p>
                <p>
                  <strong>{copy.spacesLabel}:</strong>{' '}
                  {reportData.step1.spaces.length
                    ? reportData.step1.spaces.join(', ')
                    : copy.notSet}
                </p>
                <p>
                  <strong>{copy.timeFramesLabel}:</strong>{' '}
                  {reportData.step1.times.length
                    ? reportData.step1.times.join(', ')
                    : copy.notSet}
                </p>
              </div>
              <div className="report-section">
                <h3>{stepHeading(2)}</h3>
                <p>
                  <strong>{copy.totalScenariosLabel}:</strong>{' '}
                  {reportData.step2.totalScenarios}
                </p>
                <p>
                  <strong>{copy.chosenScenarioLabel}:</strong>{' '}
                  {reportData.step2.selectedScenario || copy.notSelected}
                </p>
                {reportData.step3 ? (
                  <>
                    <p>
                      <strong>{copy.spaceDefinitionsLabel}:</strong>{' '}
                      {`${reportData.step3.spaceDefs.subsystem} | ${reportData.step3.spaceDefs.system} | ${reportData.step3.spaceDefs.supersystem}`}
                    </p>
                    <p>
                      <strong>{copy.timeDefinitionsLabel}:</strong>{' '}
                      {`${reportData.step3.timeDefs.past} | ${reportData.step3.timeDefs.now} | ${reportData.step3.timeDefs.future}`}
                    </p>
                  </>
                ) : (
                  <p>{copy.noScenarioConfirmed}</p>
                )}
              </div>
              <div className="report-section">
                <h3>{stepHeading(3)}</h3>
                <p>
                  <strong>{copy.totalIdeasLabel}:</strong> {reportData.step4.totalIdeas}
                </p>
                <p>
                  <strong>{copy.cellsWithIdeasLabel}:</strong> {reportData.step4.cellsWithIdeas} /
                  9
                </p>
                <div className="idea-groups">
                  <div>
                    <strong>{copy.ideasUserLabel}:</strong>
                    {reportData.step4.userIdeas.length ? (
                      <ul className="idea-list">
                        {reportData.step4.userIdeas.map((idea, index) => (
                          <li key={`user-idea-modal-${index}`}>{idea}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">{copy.noIdeasLabel}</p>
                    )}
                  </div>
                  <div>
                    <strong>{copy.ideasGeneratedLabel}:</strong>
                    {reportData.step4.llmIdeas.length ? (
                      <ul className="idea-list">
                        {reportData.step4.llmIdeas.map((idea, index) => (
                          <li key={`llm-idea-modal-${index}`}>{idea}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">{copy.noIdeasLabel}</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="report-section">
                <h3>{stepHeading(4)}</h3>
                <p>
                  <strong>{copy.selectedLanguageLabel}:</strong> {reportData.step4Report.language}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {labelEditorOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.labelEditorTitle}</h2>
              <button type="button" className="ghost" onClick={() => setLabelEditorOpen(false)}>
                {copy.close}
              </button>
            </div>
            <div className="modal-body">
              <div className="label-editor-list">
                {ideaLabels.map((label) => (
                  <div key={label.id} className="label-editor-row">
                    <input
                      type="text"
                      value={label.text}
                      onChange={(event) => {
                        const next = ideaLabels.map((item) =>
                          item.id === label.id ? { ...item, text: event.target.value } : item
                        )
                        setIdeaLabels(next)
                      }}
                      style={{ backgroundColor: `${label.color}4D` }}
                    />
                    <button
                      type="button"
                      className="label-delete"
                      aria-label={copy.removeLabelAriaLabel}
                      title={copy.removeLabelAriaLabel}
                      onClick={() => {
                        setIdeaLabels((prev) => prev.filter((item) => item.id !== label.id))
                        setIdeaLabelAssignments((prev) => {
                          const next: Record<string, string | null> = {}
                          Object.entries(prev).forEach(([ideaId, labelId]) => {
                            if (labelId !== label.id) next[ideaId] = labelId
                          })
                          return next
                        })
                        if (ideaLabelDraft === label.id) setIdeaLabelDraft(null)
                        if (postItLabelDraft === label.id) setPostItLabelDraft(null)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {ideaLabels.length < 10 && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      setIdeaLabels((prev) => [
                        ...prev,
                        {
                          id: `label-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                          text: '',
                          color: getNextLabelColor(prev),
                        },
                      ])
                    }
                  >
                    {copy.labelEditorAdd}
                  </button>
                )}
              </div>
              <div className="actions label-editor-actions">
                <button type="button" className="primary" onClick={() => setLabelEditorOpen(false)}>
                  {copy.labelEditorSave}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {postItEdit && postItEditCell && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.editIdeaTitle}</h2>
              {(() => {
                const labelItem = getLabelById(postItLabelDraft)
                const isFilled = Boolean(labelItem)
                const color = labelItem?.color || null
                return (
                  <div
                    className={`label-drop-target ${isFilled ? 'filled' : 'placeholder'}`}
                    style={
                      isFilled && color
                        ? { backgroundColor: color, borderColor: color }
                        : undefined
                    }
                    onDragOver={allowDrop}
                    onDrop={(event) => {
                      event.preventDefault()
                      const dropped = event.dataTransfer.getData('application/label')
                      setPostItLabelDraft(dropped || null)
                    }}
                  >
                    {isFilled ? labelItem?.text : copy.labelDropPlaceholder}
                  </div>
                )
              })()}
            </div>
            <div className="modal-body">
              <textarea
                className="modal-textarea"
                value={postItEdit.text}
                readOnly={postItEdit.source !== 'user'}
                onChange={(event) =>
                  setPostItEdit({ ...postItEdit, text: event.target.value })
                }
              />
              <div className="label-row">
                <button
                  type="button"
                  className="label-chip no-label"
                  draggable
                  onDragStart={(event) => handleLabelDragStart(event, null)}
                >
                  {copy.noLabelText}
                </button>
                {ideaLabels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    className="label-chip"
                    draggable
                    onDragStart={(event) => handleLabelDragStart(event, label.id)}
                    style={{
                      backgroundColor: `${label.color}4D`,
                    }}
                  >
                    {label.text}
                  </button>
                ))}
              </div>
              <div className="idea-editor-actions">
                <span>{copy.wordCount(countWords(postItEdit.text))}</span>
                <div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setPostItEdit(null)
                      setPostItEditCell(null)
                    }}
                  >
                    {copy.cancel}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      countWords(postItEdit.text) > 50 ||
                      (postItEdit.source !== 'user' &&
                        postItLabelDraft === (ideaLabelAssignments[postItEdit.id] ?? null)) ||
                      (postItEdit.source === 'user' &&
                        postItEdit.text === postItEditOriginalText &&
                        postItLabelDraft === (ideaLabelAssignments[postItEdit.id] ?? null))
                    }
                    onClick={() => {
                      if (postItEdit.source === 'user') {
                        setWorkshopIdeas((prev) => {
                          const current = prev[postItEditCell] || []
                          return {
                            ...prev,
                            [postItEditCell]: current.map((idea) =>
                              idea.id === postItEdit.id
                                ? { ...idea, text: postItEdit.text }
                                : idea
                            ),
                          }
                        })
                      }
                      setIdeaLabelAssignments((prev) => ({
                        ...prev,
                        [postItEdit.id]: postItLabelDraft ?? null,
                      }))
                      setPostItEdit(null)
                      setPostItEditCell(null)
                    }}
                  >
                    {copy.save}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {ideaPreview && (
        <div className="modal" role="dialog" aria-modal="true">
          <div
            className="idea-preview"
            style={{
              background:
                ideaPreview.source === 'user'
                  ? 'rgba(247, 215, 122, 1)'
                  : 'rgba(142, 192, 255, 1)',
            }}
          >
            <button
              type="button"
              className="idea-preview-close"
              onMouseEnter={() => setIdeaPreview(null)}
            >
              ×
            </button>
            <p>{ideaPreview.text}</p>
          </div>
        </div>
      )}

      {confirmRemoveOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.confirmRemoveIdeasTitle}</h2>
            </div>
            <div className="modal-body">
              <p>{copy.confirmRemoveIdeasMessage}</p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setConfirmRemoveOpen(false)}
                >
                  {copy.confirmNo}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    keepOnlyUserIdeas()
                    setConfirmRemoveOpen(false)
                  }}
                >
                  {copy.confirmYes}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {llmSettingsOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.llmSettingsTitle}</h2>
              <button type="button" className="ghost" onClick={() => setLlmSettingsOpen(false)}>
                {copy.close}
              </button>
            </div>
            <div className="modal-body">
              <p className="muted">{copy.llmSettingsIntro}</p>
              <div className="field-group">
                <label htmlFor="llm-api-base">{copy.llmApiBaseLabel}</label>
                <input
                  id="llm-api-base"
                  type="text"
                  value={llmApiBase}
                  onChange={(event) => {
                    setLlmApiBase(event.target.value)
                    setLlmSaved(false)
                    setLlmStatus('unknown')
                  }}
                  placeholder={copy.llmApiBasePlaceholder}
                />
              </div>
              <p className="muted">
                {llmStatus === 'online'
                  ? copy.llmStatusOnline
                  : llmStatus === 'offline'
                    ? copy.llmStatusOffline
                    : copy.llmStatusUnknown}
              </p>
              <p className="muted">{copy.llmSettingsCostNote}</p>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const normalized = normalizeApiBase(llmApiBase)
                    setLlmApiBase(normalized)
                    void checkLlmStatus(normalized)
                  }}
                  disabled={!aiSupportEnabled}
                >
                  {copy.llmTestConnection}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const normalized = normalizeApiBase(llmApiBase)
                    setLlmApiBase(normalized)
                    localStorage.setItem('llm_api_base', normalized)
                    void checkLlmStatus(normalized)
                    setLlmSaved(true)
                  }}
                  disabled={!aiSupportEnabled}
                >
                  {copy.llmSettingsSave}
                </button>
                {llmSaved && <span className="muted">{copy.llmSettingsSaved}</span>}
              </div>
              {showDiagnostics && (
                <div className="actions llm-toggle">
                  <button
                    type="button"
                    className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
                    onClick={() => {
                      const nextEnabled = !aiSupportEnabled
                      setAiSupportEnabled(nextEnabled)
                      localStorage.setItem('aiSupportEnabled', nextEnabled ? 'true' : 'false')
                      if (nextEnabled) {
                        void checkLlmStatus(normalizeApiBase(llmApiBase))
                      } else {
                        setLlmStatus('offline')
                      }
                    }}
                  >
                    {aiSupportEnabled ? copy.aiSupportOn : copy.aiSupportOff}
                  </button>
                  {import.meta.env.DEV && (
                    <button type="button" className="ghost" onClick={handleLlmPing}>
                      LLM ping
                    </button>
                  )}
                </div>
              )}
              {import.meta.env.DEV && llmPingResult && (
                <div className="engine-helper">
                  {llmPingResult.error
                    ? `Ping error: ${llmPingResult.error}`
                    : `Ping OK: ${llmPingResult.model ?? 'model?'} | in ${
                        llmPingResult.tokensIn ?? 0
                      } / out ${llmPingResult.tokensOut ?? 0}${
                        llmPingResult.message ? ` | ${llmPingResult.message}` : ''
                      }`}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {feedbackPanel}
      {feedbackFab}
      {missingLabelModal}
    </div>
  )
}

export default App
