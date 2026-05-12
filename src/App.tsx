import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
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
import type { ReportExecutionReport, ReportMeta, ReportSummary } from './storage/sessionStore'
import type { ReportRecommendations } from './storage/sessionStore'
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
import { useBillingAccount } from './lib/useBillingAccount'
import {
  cleanFinalSpeechTranscriptSegment,
  toSpeechCleanupLocale,
} from './lib/speechTranscript'
import { interpretSpeechTranscript } from './lib/speechTranscriptInterpret'
import {
  clearGuestMode,
  clearGuestSessions,
  isGuestMode,
  readGuestSessions,
} from './lib/guest'
import { DIAGNOSTICS_STORAGE_KEY } from './lib/diagnostics'
import { ReportPage } from './report/ReportPage'
import { apiFetch } from './lib/apiFetch'
import type { ReportSnapshot } from './report/exportCsv'
import { AdminPage } from './admin/AdminPage'
import { useAuthState } from './lib/authState'
import { AiCostButton } from './components/AiCostButton'
import { ActionPlanReadinessGauge } from './components/ActionPlanReadinessGauge'
import { MobileLanding, type MobileLandingLanguage } from './mobile/MobileLanding'

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

const PHONE_VIEWPORT_MAX_WIDTH = 767

const isPhoneViewportWidth = () =>
  typeof window !== 'undefined' && window.innerWidth <= PHONE_VIEWPORT_MAX_WIDTH

const useIsPhoneViewport = () => {
  const [isPhone, setIsPhone] = useState(isPhoneViewportWidth)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setIsPhone(isPhoneViewportWidth())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return isPhone
}

type LlmUsageModel = 'gpt-4.1-mini' | 'gpt-5-nano' | 'gpt-5-mini' | 'gpt-image-1'
type LlmUsageTokens = { input?: number; output?: number; total?: number }
type LlmUsageMeta = {
  modelUsed?: string | null
  aiSupportEnabled?: boolean
  tokens?: LlmUsageTokens
  source?: 'llm' | 'fallback'
  errorCategory?: string | null
}

type ModelUsage = { inputTokens: number; outputTokens: number; totalUSD: number; eventsCount: number }
type SessionUsage = {
  perModel: Record<string, ModelUsage>
  totalUSD: number
  totalPLN: number | null
  totalTokens: number
}
type SessionUsageSummaryRow = {
  session_id: string
  user_id: string | null
  total_tokens_input: number | null
  total_tokens_output: number | null
  total_usage_cost_usd: number | string | null
  total_usage_cost_pln: number | string | null
}
type SessionUsageEventRow = {
  model: string | null
  model_used?: string | null
  tokens_input: number | null
  tokens_output: number | null
  usage_cost_usd: number | string | null
}

type ActionPlanReadinessLlmResult = {
  summary: string
  howToBoost: string
  biggestBoostRightNow: string
  qualityLevel: 'low' | 'medium' | 'high'
  // Legacy / optional (kept for compatibility while the endpoint migrates).
  insights?: string[]
  improvements?: string[]
  nextBestAction?: string
}

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
type SpeechRecognitionAlternativeLike = { transcript: string }
type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}
type SpeechRecognitionResultListLike = {
  length: number
  [index: number]: SpeechRecognitionResultLike
}
type SpeechRecognitionEventLike = Event & {
  resultIndex?: number
  results: SpeechRecognitionResultListLike
}
type SpeechRecognitionErrorEventLike = Event & {
  error?: string
}
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  abort: () => void
  start: () => void
  stop: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike
type EnginePerspectiveKey = 'as_is' | 'not_working' | 'should_be'
type FacilitationPerspective = EnginePerspectiveKey

const FACILITATION_PERSPECTIVE_MODE: Record<FacilitationPerspective, 1 | 2 | 3> = {
  as_is: 1,
  not_working: 2,
  should_be: 3,
}

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

const WORD_LIMIT = 100
const INITIAL_BRIEF_WORD_LIMIT = 1000
const INITIAL_BRIEF_RECOMMENDED_WORD_TARGET = 200
const INITIAL_BRIEF_MIN_MEANINGFUL_WORDS = 25
const INITIAL_BRIEF_MIN_DISTINCT_MEANINGFUL_WORDS = 3
const SHORT_ENTRY_WORDS = 12
const DEFAULT_IDLE_THRESHOLD_MS = 15000
const ERASE_EMPTY_SECONDS_STRONG = 10
const MAX_AUTO_CLASSIFY = 25
const UI_LANGUAGE_STORAGE_KEY = 'ui-language'
const AUTH_LOGIN_ORIGIN_KEY = 'auth-login-origin'
const AUTH_LOGIN_REDIRECT_KEY = 'auth-login-redirect'
const AUTH_OAUTH_ORIGIN_KEY = 'auth_oauth_origin'
const AUTH_FLOW_IN_PROGRESS_KEY = 'mmi_auth_flow_in_progress'
const POST_AUTH_NEXT_KEY = 'post-auth-next'
const POST_AUTH_LANG_KEY = 'post-auth-lang'
const TOPUP_RETURN_TO_KEY = 'topup-return-to'
const FX_FALLBACK_RATE = 3.55

const saveAuthDiag = (event: string, data: Record<string, unknown> = {}) => {
  try {
    if (typeof window === 'undefined') return
    const key = 'auth_redirect_diag_v1'
    const rows = JSON.parse(window.localStorage.getItem(key) || '[]')
    const next = Array.isArray(rows) ? rows : []
    next.push({
      event,
      at: new Date().toISOString(),
      origin: window.location.origin,
      href: window.location.href,
      ...data,
    })
    window.localStorage.setItem(key, JSON.stringify(next.slice(-20)))
    console.info('[auth diag]', event, data)
  } catch (e) {
    console.warn('[auth diag] failed', e)
  }
}

let authCodeExchangeInProgress = false
const exchangedAuthCodes = new Set<string>()

const isPreviewHost = () => {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname || ''
  return host.includes('.vercel.app') && host.includes('makemyidea-mvp-git-')
}

const safeNavigate = (target: unknown) => {
  if (typeof window === 'undefined') return
  const targetString = String(target || '')
  if (
    isPreviewHost() &&
    targetString.startsWith('https://makemyidea.work')
  ) {
    console.error('[preview guard] blocked production redirect', {
      href: window.location.href,
      origin: window.location.origin,
      target: targetString,
    })
    saveAuthDiag('preview_guard_blocked', { target: targetString })
    window.location.replace(`${window.location.origin}/engine`)
    return
  }
  saveAuthDiag('safe_navigate', { target: targetString })
  window.location.assign(targetString)
}

const saveAuthCallbackDiag = (data: Record<string, unknown>) => {
  try {
    if (typeof window === 'undefined') return
    const key = 'auth_callback_diag_v1'
    const rows = JSON.parse(window.localStorage.getItem(key) || '[]')
    const next = Array.isArray(rows) ? rows : []
    next.push({
      at: new Date().toISOString(),
      origin: window.location.origin,
      href: window.location.href,
      ...data,
    })
    window.localStorage.setItem(key, JSON.stringify(next.slice(-20)))
  } catch {
    // ignore
  }
}

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

const normalizeEngineEntryTypeForLlm = (value: EngineBoardItem['entry_type'] | string | null | undefined) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'facilitated_input') return 'facilitated_input'
  if (raw === 'seed_from_brief') return 'seed_from_brief'
  if (raw === 'manual_input' || raw === 'free_input') return 'manual_input'
  return 'other'
}

const normalizeEngineAreaForLlm = (value: string | null | undefined) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'as_is' || raw === 'not_working' || raw === 'should_be') return raw
  return null
}

const clipLlmContextText = (value: unknown, maxLen: number) => {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

const normalizeEngineBoardEntryForLlm = (
  item: EngineBoardItem,
  uiLanguage: Language,
  options: { maxAnswerLen?: number; maxQuestionLen?: number } = {}
) => {
  const answer = clipLlmContextText(item.text, options.maxAnswerLen ?? 280)
  if (!answer) return null
  const primaryQuestion =
    uiLanguage === 'English'
      ? item.question_text_en ?? item.question_text_pl ?? null
      : item.question_text_pl ?? item.question_text_en ?? null
  const question = clipLlmContextText(primaryQuestion, options.maxQuestionLen ?? 260) || null
  const matrix_row = item.matrix_row ?? null
  const matrix_col = item.matrix_col ?? null
  const entryType = normalizeEngineEntryTypeForLlm(item.entry_type)
  return {
    id: item.id,
    area: normalizeEngineAreaForLlm(matrix_col),
    matrix_cell: getEntryCellId(item),
    matrix_row,
    matrix_col,
    entry_type: entryType === 'other' && question ? 'facilitated_input' : entryType,
    question,
    answer,
    text: answer,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    tags: item.label ? [item.label] : undefined,
  }
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

const perspectiveToAllowedCellIds = (perspective: FacilitationPerspective | null) => {
  if (perspective === 'as_is') return ['A1', 'B1', 'C1'] as const
  if (perspective === 'not_working') return ['A2', 'B2', 'C2'] as const
  if (perspective === 'should_be') return ['A3', 'B3', 'C3'] as const
  return null
}

const modeToFacilitationPerspective = (modeCode?: number | null): FacilitationPerspective | null => {
  if (modeCode === 1) return 'as_is'
  if (modeCode === 2) return 'not_working'
  if (modeCode === 3) return 'should_be'
  return null
}

const sanitizeInlineHelperText = (value: string | null | undefined) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const withAlpha = (hexColor: string, alphaHex = '66') => {
  const value = String(hexColor || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(value) ? `${value}${alphaHex}` : value
}

const ENGINE_PERSPECTIVE_KEYS: EnginePerspectiveKey[] = ['as_is', 'not_working', 'should_be']
const ENGINE_SORT_GAP = 1024

const createEmptySessionUsage = (): SessionUsage => ({
  perModel: {},
  totalUSD: 0,
  totalPLN: null,
  totalTokens: 0,
})

const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null
  const speechWindow = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

import { fetchFxUsdPlnRate, getFreshFxRate } from './lib/fx'

type Translations = {
  stepLabel: string
  appTitle: string
  landingHeroTitle: string
  landingHeroSubtitle: string
  landingHeroBullets: string[]
  landingIntroTitleLines: string[]
  landingIntroSubtextLines: [string, string, string, string]
  landingIntroSubtextEmphasis: string
  landingCta: string
  landingLoginCta: string
  landingCtaNote: string
  landingThreeStepsCta: string
  landingThreeStepsTitle: string
  landingBackToFull: string
  landingBeforeLead: string
  landingBeforeList: string[]
  landingBeforeEmphasis: { strong: string; medium: string; rest: string }
  landingAfterLead: string
  landingAfterList: string[]
  landingWhyLead: string
  landingWhyLines: string[]
  landingHowTitle: string
  landingHowSteps: { title: string; lines: string[] }[]
  landingHowLines: string[]
  landingWhoTitle: string
  landingWhoList: string[]
  landingFinalLines: [string, string]
  landingPrivacyTitle: string
  landingPrivacyBody: string
  landingPrivacyLink: string
  workInProgressLink: string
  impulseButtonLabel: string
  impulseTitle: string
  impulseEmpty: string
  impulseClose: string
  impulseSourceFallback: string
  impulseSourceAi: string
  impulseSourceAiGenerated: string
  impulseSourceDeterministic: string
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
  topupTitle: string
  topupSubtitle: string
  topupConfig: {
    amounts: [string, string, string]
    currency: string
    captions: [[string, string], [string, string], [string, string]]
    footer: string
  }
  topupReturnLabel: string
  loginContinue: string
  loginGoogleLabel: string
  loginGoogleCta: string
  loginGoogleLoading: string
  loginEmailLabel: string
  loginEmailPlaceholder: string
  loginEmailCta: string
  loginEmailSending: string
  loginEmailCooldown: (seconds: number) => string
  loginPasswordToggleLabel: string
  loginPasswordPlaceholder: string
  loginPasswordSignIn: string
  loginPasswordSignUp: string
  loginGuestLabel: string
  loginGuestCta: string
  loginGuestActive: string
  loginNoticeSent: string
  loginNoticeSignup: string
  loginEmailError: string
  loginCallbackTitle: string
  loginGuestMergePrompt: string
  loginGuestMergeYes: string
  loginGuestMergeNo: string
  loginGuestMergeLoading: string
  loginDevSmtpNotice: string
  loginDevResetAuth: string
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
  engineEntryEditHint: string
  engineEntryDeleteHint: string
  engineEntryLabelActionHint: string
  engineEntryQuestionHint: string
  engineEntryQuestionFallback: string
  engineSectionAddEntryHint: string
  engineSectionAddEntryAria: (sectionTitle: string) => string
  engineDraftRemoveEntry: string
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
  engineFacilitationAsIs: string
  engineFacilitationProblem: string
  engineFacilitationDesired: string
  engineFacilitationLoadingLabel: string
  engineFacilitationRetryMessage: string
  engineFacilitationRetryCta: string
  engineFacilitationLoadingPerspective: string
  engineFacilitationLoadingDeepen: string
  engineNamePrompt: string
  engineNameLabel: string
  engineNamePlaceholder: string
  engineNameSave: string
  engineInitialBriefTitle: string
  engineInitialBriefDescription: string
  engineInitialBriefPlaceholder: string
  engineInitialBriefSubmit: string
  engineInitialBriefSubmitting: string
  engineInitialBriefNeedsMoreInfo: string
  engineInitialBriefWordCountRemaining: (count: number) => string
  engineInitialBriefWordLimitReached: string
  engineInitialBriefLengthIntro: string
  engineInitialBriefLengthTarget: string
  engineInitialBriefLengthCount: (count: number, target: number) => string
  engineInitialBriefLengthLow: string
  engineInitialBriefLengthUseful: string
  engineInitialBriefLengthStrong: string
  engineInitialBriefLengthEnough: string
  engineInitialBriefLengthContinue: string
  engineInitialBriefEmpty: string
  engineInitialBriefTooLong: string
  engineInitialBriefFailed: string
  engineInitialBriefSuggestFailed: string
  engineInitialBriefSaveFailed: string
  engineInitialBriefPartialSaveFailed: (savedCount: number, failedCount: number) => string
  engineInitialBriefVoiceInputLabel: string
  engineInitialBriefVoiceInputListening: string
  engineInitialBriefVoiceInputUnavailable: string
  engineInitialBriefVoiceInputError: string
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
  debugMatrixUnavailable: string
  debugMatrixMissingSession: string
  debugMatrixLoadError: string
  llmSettingsTitle: string
  llmSettingsIntro: string
  llmApiBaseLabel: string
  llmApiBasePlaceholder: string
  llmSettingsSave: string
  llmSettingsSaved: string
  llmSettingsCostNote: string
  llmUsageIndicatorLabel: string
  llmCostLabel: (usd: string) => string
  llmCostPlnLabel: (pln: string) => string
  llmCostPlnFallback: string
  llmCostBreakdown: string
  llmCostTotalTokens: (tokens: string) => string
  llmCostTotalUsd: (usd: string) => string
  llmCostTotalPln: (pln: string) => string
  llmCostTotalPlnFallback: string
  llmCostModelRow: (model: string, input: string, output: string, usd: string) => string
  diagnosticsAuthLabel: string
  adminNavLabel: string
  insufficientBalanceNotice: string
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
    landingHeroTitle: 'You have an idea.\nBut do you know what to do next?',
    landingHeroSubtitle: 'Instead of another brainstorming session — move from idea to decisions and an action plan.',
    landingHeroBullets: [
      '🎤 Describe the idea (text or voice)',
      '🧠 See what really doesn’t work',
      '⚖️ Make the key decisions',
      '📍 Leave with a ready plan',
    ],
    landingIntroTitleLines: [
      CANONICAL_DISPLAY_HOST,
      'takes you from the first thought',
      'to a concrete plan',
      'step by step.',
    ],
    landingIntroSubtextLines: [
      '',
      '',
      '',
      '',
    ],
    landingIntroSubtextEmphasis: 'you',
    landingCta: '▶ Start for free',
    landingLoginCta: 'Log in',
    landingCtaNote: 'Sign up in 30 seconds • No credit card required',
    landingThreeStepsCta: 'Start in 3 steps',
    landingThreeStepsTitle: '3 steps',
    landingBackToFull: '← Back to full page',
    landingBeforeLead: 'Ideas are rarely bad.\nThe problem is a lack of clarity.',
    landingBeforeList: [
      'They fail because:',
      '• conversations are chaotic',
      '• problems aren’t clearly named',
      '• decisions get postponed “for later”',
      '',
      '❌ Chaos.',
      '❌ Unnamed problems.',
      '❌ Delayed decisions.',
      '',
      'Sound familiar?',
    ],
    landingBeforeEmphasis: {
      strong: '',
      medium: '',
      rest: '',
    },
    landingAfterLead:
      'It’s not an idea problem.\nIt’s simply hard to turn it into concrete decisions without the right structure.',
    landingAfterList: [
      'Instead of a blank board — you get a process that guides you:',
      '✅ Your description becomes concrete observations.\nYou see what works — and what doesn’t.',
      '✅ Contradictions reveal new directions.\nDecisions stop being postponed.',
      '✅ In the end, you have a coherent action plan.',
      '',
      'No guessing. No chaos.',
    ],
    landingWhyLead: 'We don’t replace thinking. We remove friction.',
    landingWhyLines: [
      CANONICAL_DISPLAY_HOST,
      'structures the conversation',
      'keeps the process logical',
      'organizes knowledge in real time',
      'leaves people what matters most: decisions and creativity',
      'AI helps. Humans decide.',
    ],
    landingHowTitle: 'How it works in practice:',
    landingHowSteps: [],
    landingHowLines: [
      'You start with an idea — you type or speak.',
      'You see the real state, without guessing.',
      'The app organizes the problems',
      'and asks questions that push you forward.',
      'You see when you have enough data to decide.',
      'Contradictions reveal new directions.',
      'From chaos, a plan emerges.',
    ],
    landingWhoTitle: 'Who is it for?',
    landingWhoList: [
      '🚀 You have an idea, but don’t know how to define it well',
      '🛠️ You are a dev / PM and want real analysis, not brainstorming “for sport”',
      '🤝 You work with a distributed or hybrid team',
      '⏱️ You want results in one session',
    ],
    landingFinalLines: ['You don’t need a perfect idea.', 'You need a process that gets you to a decision.'],
    landingPrivacyTitle: 'Privacy Policy',
    landingPrivacyBody:
      'We process account, session, board, report and AI usage data only to operate the product, paid features and admin diagnostics.',
    landingPrivacyLink: 'Read the full privacy policy',
    workInProgressLink: 'Work in progress',
    impulseButtonLabel: 'Give me an impulse',
    impulseTitle: 'Suggested question',
    impulseEmpty: 'No question available yet.',
    impulseClose: 'Close',
    impulseSourceFallback: 'Offline mode (fallback)',
    impulseSourceAi: 'AI',
    impulseSourceAiGenerated: 'AI generated',
    impulseSourceDeterministic: 'Deterministic fallback',
    report: 'Action plan',
    llmSettings: 'LLM settings',
    languageLabel: 'LANGUAGE',
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
    topupTitle: 'Top up your account',
    topupSubtitle: '',
    topupConfig: {
      amounts: ['20', '50', '100'],
      currency: 'PLN',
      captions: [
        ['1 report', '+ iterations'],
        ['full session on', 'a single product'],
        ['multiple concepts', 'or team work'],
      ],
      footer: 'Credits are used flexibly — you only pay for report generation and updates.',
    },
    topupReturnLabel: 'Return to the previous page',
    loginContinue: 'Continue',
    loginGoogleLabel: 'Google',
    loginGoogleCta: 'Continue with Google',
    loginGoogleLoading: 'Connecting...',
    loginEmailLabel: 'Email',
    loginEmailPlaceholder: 'you@company.com',
    loginEmailCta: 'Email me a login link',
    loginEmailSending: 'Sending...',
    loginEmailCooldown: (seconds) => `Wait ${seconds}s`,
    loginPasswordToggleLabel: 'Email + password (dev)',
    loginPasswordPlaceholder: 'password',
    loginPasswordSignIn: 'Sign in',
    loginPasswordSignUp: 'Sign up',
    loginGuestLabel: 'Guest',
    loginGuestCta: 'Try as guest',
    loginGuestActive: 'In guest mode — data is stored locally.',
    loginNoticeSent: 'Check your email for the login link.',
    loginNoticeSignup:
      'Account created. If email confirmation is required, check your inbox.',
    loginEmailError: 'Enter a valid email.',
    loginCallbackTitle: 'Signing you in...',
    loginGuestMergePrompt: 'We found work from your guest session. Import it?',
    loginGuestMergeYes: 'Yes, import',
    loginGuestMergeNo: 'No, discard',
    loginGuestMergeLoading: 'Importing...',
    loginDevSmtpNotice:
      "Can't find the email? Check spam, try again, or use Google.",
    loginDevResetAuth: 'Reset auth (dev)',
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
    axisFuture: 'How should it be?',
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
      'Report language follows the app language selected on the landing page.',
    enginePreviewOpenReport: 'Go to action plan',
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
    enginePreviewCreateReport: 'Analyze entries and build an action plan',
    enginePreviewBoardItemsTitle: 'Idea Studio',
    engineEntryLabelHint: 'Click to add or change label',
    engineEntryEditHint: 'Edit',
    engineEntryDeleteHint: 'Delete',
    engineEntryLabelActionHint: 'Label',
    engineEntryQuestionHint: 'Show source question',
    engineEntryQuestionFallback: 'This entry was created without a facilitation question.',
    engineSectionAddEntryHint: 'Add item to this section',
    engineSectionAddEntryAria: (sectionTitle) => `Add item to ${sectionTitle}`,
    engineDraftRemoveEntry: 'Remove item',
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
    engineSessionDetailsBoardTitle: 'Idea Studio',
    engineSessionDetailsBoardEmpty: 'No items.',
    engineFacilitationNote: 'Answer a focused question to move forward',
    engineFacilitationNext: 'Next question',
    engineFacilitationAsIs: 'How is it now?',
    engineFacilitationProblem: "What doesn't work?",
    engineFacilitationDesired: 'How should it be?',
    engineFacilitationLoadingLabel: 'Generating question…',
    engineFacilitationRetryMessage: 'Couldn’t generate the question. Please retry.',
    engineFacilitationRetryCta: 'Retry',
    engineFacilitationLoadingPerspective: 'Choosing a question for this perspective',
    engineFacilitationLoadingDeepen: 'Choosing a question for your board',
    engineNamePrompt: 'Give this session a name so it’s easier to return to.',
    engineNameLabel: 'Session name',
    engineNamePlaceholder: 'Session name',
    engineNameSave: 'Save and continue',
    engineInitialBriefTitle: 'Describe your idea to get started',
    engineInitialBriefDescription:
      'Write freely about your idea, context, problems, needs, observations, and open questions. I will split it into first board entries for this session.',
    engineInitialBriefPlaceholder:
      'Example: Who is this for, what does not work today, what should change, what assumptions do you have, what questions are still open?',
    engineInitialBriefSubmit: 'Create first entries',
    engineInitialBriefSubmitting: 'Creating entries…',
    engineInitialBriefNeedsMoreInfo: 'We need a little more information to create the first entries.',
    engineInitialBriefWordCountRemaining: (count) => `Remaining ${count} words`,
    engineInitialBriefWordLimitReached: 'Word limit reached (1000).',
    engineInitialBriefLengthIntro: 'Context is starting to form',
    engineInitialBriefLengthTarget: 'Good start: about 200 words',
    engineInitialBriefLengthCount: (count, target) => `${count} / ~${target} words`,
    engineInitialBriefLengthLow: '',
    engineInitialBriefLengthUseful: 'The situation is becoming clearer',
    engineInitialBriefLengthStrong: 'Important dependencies are emerging',
    engineInitialBriefLengthEnough: 'This is a good moment for analysis',
    engineInitialBriefLengthContinue: 'You can continue or move on',
    engineInitialBriefEmpty: 'Please enter a short description first.',
    engineInitialBriefTooLong: 'The description exceeds the 1000-word limit.',
    engineInitialBriefFailed: 'Unable to create initial entries. Please try again.',
    engineInitialBriefSuggestFailed: 'Unable to analyze the brief into first entries. Please try again.',
    engineInitialBriefSaveFailed: 'The brief was analyzed, but the first entries could not be saved.',
    engineInitialBriefPartialSaveFailed: (savedCount, failedCount) =>
      `The brief was analyzed. Saved ${savedCount} entries, but ${failedCount} could not be saved.`,
    engineInitialBriefVoiceInputLabel: 'Use voice input',
    engineInitialBriefVoiceInputListening: 'Listening…',
    engineInitialBriefVoiceInputUnavailable: 'Voice input is not available in this browser.',
    engineInitialBriefVoiceInputError: 'Voice input is currently unavailable.',
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
    debugMatrixUnavailable: 'Not available.',
    debugMatrixMissingSession: 'Missing sessionId.',
    debugMatrixLoadError: 'Unable to load matrix data.',
    llmSettingsTitle: 'OpenAI server settings',
    llmSettingsIntro:
      'Connect your server to OpenAI by setting OPENAI_API_KEY and provide the API base URL.',
    llmApiBaseLabel: 'API base URL',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Save',
    llmSettingsSaved: 'Saved.',
    llmSettingsCostNote:
      'Using your API key will bill usage to your OpenAI account per their pricing.',
    llmUsageIndicatorLabel: 'LLM usage indicator',
    llmCostLabel: (usd) => `Cost: $${usd}`,
    llmCostPlnLabel: (pln) => `Cost (PLN): ${pln} zł`,
    llmCostPlnFallback: 'PLN: …',
    llmCostBreakdown: 'Breakdown',
    llmCostTotalTokens: (tokens) => `Total tokens: ${tokens}`,
    llmCostTotalUsd: (usd) => `Total USD: $${usd}`,
    llmCostTotalPln: (pln) => `Total PLN: ${pln} zł`,
    llmCostTotalPlnFallback: 'Total PLN: …',
    llmCostModelRow: (model, input, output, usd) =>
      `${model}: ${input} in / ${output} out · $${usd}`,
    diagnosticsAuthLabel: 'auth',
    adminNavLabel: 'Admin',
    insufficientBalanceNotice: 'Your balance is too low. Top up to continue.',
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
    landingHeroTitle: 'Masz pomysł.\nAle czy wiesz, co z nim zrobić dalej?',
    landingHeroSubtitle: 'Zamiast kolejnej burzy mózgów — przejdź od pomysłu do decyzji i planu działania.',
    landingHeroBullets: [
      '🎤 Opisz pomysł (tekstem lub głosem)',
      '🧠 Zobacz, co naprawdę w nim nie działa',
      '⚖️ Podejmij kluczowe decyzje',
      '📍 Wyjdź z gotowym planem',
    ],
    landingIntroTitleLines: [
      CANONICAL_DISPLAY_HOST,
      'prowadzi Cię od pierwszej myśli',
      'do konkretnego planu',
      'krok po kroku.',
    ],
    landingIntroSubtextLines: [
      '',
      '',
      '',
      '',
    ],
    landingIntroSubtextEmphasis: 'Ciebie',
    landingCta: '▶ Zacznij za darmo',
    landingLoginCta: 'Zaloguj',
    landingCtaNote: 'rejestracja w 30 s • bez karty',
    landingThreeStepsCta: 'Zacznij w 3 krokach',
    landingThreeStepsTitle: '3 kroki',
    landingBackToFull: '← Wróć do pełnej strony',
    landingBeforeLead: 'Pomysły rzadko są złe.\nProblem to brak konkretu.',
    landingBeforeList: [
      'Upadają, bo:',
      '• rozmowy są chaotyczne',
      '• problemy nie są dobrze nazwane',
      '• decyzje odkładane są „na później”',
      '',
      '❌ Chaos.',
      '❌ Brak nazwanych problemów.',
      '❌ Odkładane decyzje.',
      '',
      'Brzmi znajomo?',
    ],
    landingBeforeEmphasis: {
      strong: '',
      medium: '',
      rest: '',
    },
    landingAfterLead:
      'To nie jest problem pomysłu.\nPo prostu trudno przełożyć go na konkretne decyzje bez odpowiedniej struktury.',
    landingAfterList: [
      'Zamiast pustej tablicy - masz proces, który prowadzi:',
      '✅ Z Twojego opisu powstają konkretne obserwacje.\nWidzisz, co działa — i co nie.',
      '✅ Sprzeczności pokazują nowe kierunki.\nDecyzje przestają się odkładać.',
      '✅ Na końcu masz spójny plan działania.',
      '',
      'Bez zgadywania. Bez chaosu.',
    ],
    landingWhyLead: 'Nie zastępujemy myślenia. Usuwamy tarcie.',
    landingWhyLines: [
      CANONICAL_DISPLAY_HOST,
      'pilnuje logiki procesu',
      'utrzymuje fokus',
      'porządkuje wiedzę w czasie rzeczywistym',
      'nie pozwala ominąć trudnych decyzji',
      'AI pomaga.',
      'Człowiek decyduje.',
    ],
    landingHowTitle: 'Jak to działa w praktyce:',
    landingHowSteps: [],
    landingHowLines: [
      'Zaczynasz od pomysłu — piszesz lub mówisz.',
      'Widzisz realny stan, bez zgadywania.',
      'Aplikacja porządkuje problemy',
      'i zadaje pytania, które pchają Cię dalej.',
      'Widzisz, kiedy masz już dość danych na decyzje.',
      'Sprzeczności pokazują nowe kierunki.',
      'Z chaosu powstaje plan.',
    ],
    landingWhoTitle: 'Dla kogo?',
    landingWhoList: [
      '🚀 Masz pomysł, ale nie wiesz jak go dobrze zdefiniować',
      '🛠️ Jesteś devem / PM-em i chcesz sensownej analizy, nie burzy mózgów „dla sportu”',
      '🤝 Pracujesz z zespołem rozproszonym lub hybrydowym',
      '⏱️ Chcesz efektów w jednej sesji',
    ],
    landingFinalLines: ['Nie potrzebujesz idealnego pomysłu.', 'Potrzebujesz procesu, który doprowadzi Cię do decyzji.'],
    landingPrivacyTitle: 'Polityka prywatności',
    landingPrivacyBody:
      'Aplikacja MakeMyIdea.work zbiera podstawowe dane użytkownika, takie jak adres email oraz identyfikator konta Google, wyłącznie w celu umożliwienia logowania i korzystania z aplikacji.',
    landingPrivacyLink: 'Przeczytaj pełną politykę prywatności',
    workInProgressLink: 'W toku',
    impulseButtonLabel: 'Daj mi impuls',
    impulseTitle: 'Sugerowane pytanie',
    impulseEmpty: 'Brak pytania na ten moment.',
    impulseClose: 'Zamknij',
    impulseSourceFallback: 'Tryb offline (wersja zapasowa)',
    impulseSourceAi: 'AI',
    impulseSourceAiGenerated: 'Wygenerowane przez AI',
    impulseSourceDeterministic: 'Deterministyczna wersja zapasowa',
    report: 'Plan działania',
    llmSettings: 'Ustawienia LLM',
    languageLabel: 'JĘZYK',
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
    topupTitle: 'Doładuj konto',
    topupSubtitle: '',
    topupConfig: {
      amounts: ['20', '50', '100'],
      currency: 'PLN',
      captions: [
        ['1 raport', '+ iteracje'],
        ['pełna sesja nad', 'jednym produktem'],
        ['kilka koncepcji lub', 'praca zespołowa'],
      ],
      footer:
        'Środki wykorzystujesz elastycznie — płacisz tylko za generowanie i aktualizacje raportu.',
    },
    topupReturnLabel: 'Wróć na poprzednią stronę',
    loginContinue: 'Kontynuuj',
    loginGoogleLabel: 'Google',
    loginGoogleCta: 'Kontynuuj z Google',
    loginGoogleLoading: 'Łączenie...',
    loginEmailLabel: 'E-mail',
    loginEmailPlaceholder: 'you@company.com',
    loginEmailCta: 'Wyślij link do logowania',
    loginEmailSending: 'Wysyłanie...',
    loginEmailCooldown: (seconds) => `Poczekaj ${seconds}s`,
    loginPasswordToggleLabel: 'E-mail + hasło (dev)',
    loginPasswordPlaceholder: 'hasło',
    loginPasswordSignIn: 'Zaloguj się',
    loginPasswordSignUp: 'Zarejestruj się',
    loginGuestLabel: 'Gość',
    loginGuestCta: 'Wypróbuj jako gość',
    loginGuestActive: 'W trybie gościa — dane są zapisywane lokalnie.',
    loginNoticeSent: 'Sprawdź e-mail — wysłaliśmy link do logowania.',
    loginNoticeSignup:
      'Konto utworzone. Jeśli wymagane jest potwierdzenie email, sprawdź skrzynkę.',
    loginEmailError: 'Wpisz poprawny adres e-mail.',
    loginCallbackTitle: 'Logowanie...',
    loginGuestMergePrompt: 'Znaleźliśmy pracę z sesji gościa. Zaimportować?',
    loginGuestMergeYes: 'Tak, importuj',
    loginGuestMergeNo: 'Nie, odrzuć',
    loginGuestMergeLoading: 'Importowanie...',
    loginDevSmtpNotice:
      'Nie widzisz maila? Sprawdź spam lub spróbuj jeszcze raz albo przez Google.',
    loginDevResetAuth: 'Zresetuj auth (dev)',
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
    axisFuture: 'Jak powinno być?',
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
      'Język raportu jest zgodny z językiem wybranym na landing page.',
    enginePreviewOpenReport: 'Przejdź do planu działania',
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
    nextQuestionsLabel: 'Następne 10 pytań naprowadzających',
    prevQuestionsLabel: 'Poprzednie 10 pytań naprowadzających',
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
    debugMatrixUnavailable: 'Niedostępne.',
    debugMatrixMissingSession: 'Brak sessionId.',
    debugMatrixLoadError: 'Nie udało się wczytać danych matrycy.',
    enginePreviewTitle: 'Podgląd silnika pytań',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: 'Podgląd silnika',
    enginePreviewSessionTitle: 'Sesja',
    enginePreviewSessionIdLabel: 'ID sesji',
    enginePreviewSessionEmpty: 'Jeszcze nie utworzono',
    enginePreviewCreateSession: 'Utwórz sesję',
    enginePreviewReset: 'Zapisz i zamknij sesję',
    enginePreviewCreateReport: 'Przeanalizuj wpisy i ułóż plan działania',
    enginePreviewBoardItemsTitle: 'Pracownia pomysłu',
    engineEntryLabelHint: 'Kliknij żeby dodać lub zmienić etykietę',
    engineEntryEditHint: 'Edytuj',
    engineEntryDeleteHint: 'Usuń',
    engineEntryLabelActionHint: 'Etykieta',
    engineEntryQuestionHint: 'Pokaż pytanie źródłowe',
    engineEntryQuestionFallback: 'Wpis powstał bez pytania facylitującego.',
    engineSectionAddEntryHint: 'Dodaj wpis do tej sekcji',
    engineSectionAddEntryAria: (sectionTitle) => `Dodaj wpis do sekcji ${sectionTitle}`,
    engineDraftRemoveEntry: 'Usuń wpis',
    feedbackButtonLabel: 'Opinia',
    feedbackTitle: 'Opinia',
    feedbackMessageLabel: 'Twoja wiadomość / opinia',
    feedbackMessagePlaceholder: 'Napisz, co działało, co było trudne, co poprawić…',
    feedbackSend: 'Wyślij opinię e-mailem',
    feedbackSent: 'Dzięki! Opinia została wysłana.',
    feedbackPrivacyNote: 'Nie dodawaj danych wrażliwych.',
    feedbackReminderText:
      'Jeśli masz chwilę, wyślij nam opinię z tej sesji — bardzo pomoże w dalszym rozwoju.',
    feedbackReminderSend: 'Wyślij opinię e-mailem',
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
    engineSessionDetailsBoardTitle: 'Pracownia pomysłu',
    engineSessionDetailsBoardEmpty: 'Brak elementów.',
    engineFacilitationNote: 'Odpowiedz na konkretne pytanie, żeby iść dalej',
    engineFacilitationNext: 'Następne pytanie',
    engineFacilitationAsIs: 'Jak jest?',
    engineFacilitationProblem: 'Co nie działa?',
    engineFacilitationDesired: 'Jak powinno być?',
    engineFacilitationLoadingLabel: 'Generuję pytanie…',
    engineFacilitationRetryMessage: 'Nie udało się wygenerować pytania. Spróbuj ponownie.',
    engineFacilitationRetryCta: 'Spróbuj ponownie',
    engineFacilitationLoadingPerspective: 'Dobieram pytanie do tej perspektywy',
    engineFacilitationLoadingDeepen: 'Dobieram pytanie do Twojej tablicy',
    engineNamePrompt: 'Nadaj nazwę tej sesji, żeby łatwiej do niej wrócić.',
    engineNameLabel: 'Nazwa sesji',
    engineNamePlaceholder: 'Nazwa sesji',
    engineNameSave: 'Zapisz i kontynuuj',
    engineInitialBriefTitle: 'Opisz swój pomysł, żeby dobrze wystartować',
    engineInitialBriefDescription:
      'Napisz swobodnie o pomyśle, kontekście, problemach, potrzebach, obserwacjach i pytaniach. Podzielę to na pierwsze wpisy na tablicy tej sesji.',
    engineInitialBriefPlaceholder:
      'Przykład: Dla kogo to jest, co dziś nie działa, co chcesz zmienić, jakie masz założenia, jakie pytania pozostają otwarte?',
    engineInitialBriefSubmit: 'Utwórz pierwsze wpisy',
    engineInitialBriefSubmitting: 'Tworzę wpisy…',
    engineInitialBriefNeedsMoreInfo: 'Potrzebujemy trochę więcej informacji, żeby utworzyć pierwsze wpisy.',
    engineInitialBriefWordCountRemaining: (count) => `Pozostało ${count} słów`,
    engineInitialBriefWordLimitReached: 'Osiągnięto limit słów (1000).',
    engineInitialBriefLengthIntro: 'Początek kontekstu',
    engineInitialBriefLengthTarget: 'Dobry start: około 200 słów',
    engineInitialBriefLengthCount: (count, target) => `${count} / ~${target} słów`,
    engineInitialBriefLengthLow: '',
    engineInitialBriefLengthUseful: 'Obraz sytuacji staje się wyraźniejszy',
    engineInitialBriefLengthStrong: 'Pojawiają się istotne zależności',
    engineInitialBriefLengthEnough: 'To dobry moment na analizę',
    engineInitialBriefLengthContinue: 'Możesz kontynuować albo przejść dalej',
    engineInitialBriefEmpty: 'Najpierw wpisz krótki opis.',
    engineInitialBriefTooLong: 'Opis przekracza limit 1000 słów.',
    engineInitialBriefFailed: 'Nie udało się utworzyć pierwszych wpisów. Spróbuj ponownie.',
    engineInitialBriefSuggestFailed: 'Nie udało się przeanalizować opisu na pierwsze wpisy. Spróbuj ponownie.',
    engineInitialBriefSaveFailed: 'Opis został przeanalizowany, ale nie udało się zapisać pierwszych wpisów.',
    engineInitialBriefPartialSaveFailed: (savedCount, failedCount) =>
      `Opis został przeanalizowany. Zapisano ${savedCount} wpisów, ale ${failedCount} nie udało się zapisać.`,
    engineInitialBriefVoiceInputLabel: 'Użyj wprowadzania głosowego',
    engineInitialBriefVoiceInputListening: 'Nasłuchiwanie…',
    engineInitialBriefVoiceInputUnavailable: 'Wprowadzanie głosowe nie jest dostępne w tej przeglądarce.',
    engineInitialBriefVoiceInputError: 'Wprowadzanie głosowe jest chwilowo niedostępne.',
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
    llmUsageIndicatorLabel: 'Wskaźnik użycia LLM',
    llmCostLabel: (usd) => `Koszt: $${usd}`,
    llmCostPlnLabel: (pln) => `Koszt (PLN): ${pln} zł`,
    llmCostPlnFallback: 'PLN: …',
    llmCostBreakdown: 'Szczegóły',
    llmCostTotalTokens: (tokens) => `Łącznie tokenów: ${tokens}`,
    llmCostTotalUsd: (usd) => `Suma USD: $${usd}`,
    llmCostTotalPln: (pln) => `Suma PLN: ${pln} zł`,
    llmCostTotalPlnFallback: 'Suma PLN: …',
    llmCostModelRow: (model, input, output, usd) =>
      `${model}: ${input} wej. / ${output} wyj. · $${usd}`,
    diagnosticsAuthLabel: 'auth',
    adminNavLabel: 'Panel admina',
    insufficientBalanceNotice: 'Saldo jest zbyt niskie. Doładuj konto, aby kontynuować.',
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

function DebugMatrixPage({
  llmApiBase,
  uiLanguage,
}: {
  llmApiBase: string
  uiLanguage: Language
}) {
  const copy = getTranslations(uiLanguage)
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
          `${llmApiBase}/api/dev?action=matrix&sessionId=${sessionId}`
        )
        if (!response.ok) {
          const msg = await response.text()
          throw new Error(msg || 'Request failed')
        }
        const data = await response.json()
        setMatrixData(data)
      } catch {
        setMatrixError(copy.debugMatrixLoadError)
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

  useEffect(() => {
    setMatrixError(null)
  }, [uiLanguage])

  const isPl = uiLanguage === 'Polish'
  if (!debugEnabled) {
    return <div className="debug-matrix">{copy.debugMatrixUnavailable}</div>
  }

  if (!sessionId) {
    return <div className="debug-matrix">{copy.debugMatrixMissingSession}</div>
  }

  const rows = ['WORLD', 'PRODUCT', 'ELEMENTS']
  const cols = ['AS_IS', 'NOT_WORKING', 'SHOULD_BE']
  const recent = matrixData?.timeline?.[0]
  const formatMatrixLabel = (row: string, col: string) => {
    const rowLabel = isPl
      ? row === 'WORLD'
        ? 'Świat / Środowisko'
        : row === 'PRODUCT'
          ? 'Produkt'
          : 'Elementy'
      : row === 'WORLD'
        ? 'World / Environment'
        : row === 'PRODUCT'
          ? 'Product'
          : 'Elements'
    const colLabel = isPl
      ? col === 'AS_IS'
        ? 'Jak jest?'
        : col === 'NOT_WORKING'
          ? 'Co nie działa?'
          : 'Jak powinno być?'
      : col === 'AS_IS'
        ? 'As is'
        : col === 'NOT_WORKING'
          ? 'Not working'
          : 'Should be'
    const cell = `${row === 'WORLD' ? 'A' : row === 'PRODUCT' ? 'B' : 'C'}${
      col === 'AS_IS' ? '1' : col === 'NOT_WORKING' ? '2' : '3'
    }`
    return `${cell} – ${rowLabel} / ${colLabel}`
  }

  const recentKey = recent ? `${recent.matrix_row}-${recent.matrix_col}` : null
  const rowLabel = (row: string) =>
    isPl
      ? row === 'WORLD'
        ? 'Świat / Środowisko'
        : row === 'PRODUCT'
          ? 'Produkt'
          : 'Elementy'
      : row === 'WORLD'
        ? 'World / Environment'
        : row === 'PRODUCT'
          ? 'Product'
          : 'Elements'
  const colLabel = (col: string) =>
    isPl
      ? col === 'AS_IS'
        ? 'Jak jest?'
        : col === 'NOT_WORKING'
          ? 'Co nie działa?'
          : 'Jak powinno być?'
      : col === 'AS_IS'
        ? 'As is'
        : col === 'NOT_WORKING'
          ? 'Not working'
          : 'Should be'

  return (
    <div className="debug-matrix">
      <header>
        <h1>{isPl ? 'Debug matrycy' : 'Debug Matrix'}</h1>
        <div className="debug-meta">
          <span>{isPl ? 'Sesja' : 'Session'}: {sessionId}</span>
          {matrixData && (
            <span>
              {isPl ? 'Pokrycie analizy' : 'Coverage'}: {matrixData.coverage.filledCells} /{' '}
              {matrixData.coverage.totalCells}
            </span>
          )}
        </div>
      </header>
      {matrixError && <div className="engine-error">{matrixError}</div>}
      {matrixLoading && <div className="engine-empty">{isPl ? 'Ładowanie…' : 'Loading…'}</div>}
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
                    <div className="debug-count">
                      {answers.length} {isPl ? 'wpisów' : 'entries'}
                    </div>
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
          <h2>{isPl ? 'Ostatnie wpisy' : 'Recent entries'}</h2>
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
  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__printAuthDiag = () => {
      try {
        return JSON.parse(window.localStorage.getItem('auth_redirect_diag_v1') || '[]')
      } catch {
        return []
      }
    }
  }, [])
  const [activeStep, setActiveStep] = useState<StepId>(1)
  const [showLanding, setShowLanding] = useState(true)
  const [landingView, setLandingView] = useState<'main' | 'threeSteps'>('main')
  const { session: authSession, authReady } = useAuthState()
  const authLoading = !authReady
  const [authError, setAuthError] = useState<string | null>(null)
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null)
  const [authCallbackLoading, setAuthCallbackLoading] = useState(false)
  const [authCallbackHint, setAuthCallbackHint] = useState<string | null>(null)
  const [authCallbackErrorVisible, setAuthCallbackErrorVisible] = useState(false)
  const authResolved = authReady
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
  const [enginePreviewSessionId, setEnginePreviewSessionId] = useState<string | null>(null)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const [llmApiBase, setLlmApiBase] = useState(DEFAULT_LLM_API_BASE)
  const [aiSupportEnabled, setAiSupportEnabled] = useState(true)
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false)
  const [llmStatus, setLlmStatus] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [llmSaved, setLlmSaved] = useState(false)
  const [llmUsageModel, setLlmUsageModel] = useState<LlmUsageModel | null>(null)
  const [sessionUsage, setSessionUsage] = useState<SessionUsage>(() => createEmptySessionUsage())
  const [sessionUsageDiagnostics, setSessionUsageDiagnostics] = useState<{
    sessionId: string | null
    summaryQueryStatus: 'idle' | 'running' | 'ok' | 'error'
    eventsQueryStatus: 'idle' | 'running' | 'ok' | 'error'
    realtimeStatus: string | null
    summaryError: { code: string | null; message: string; details: string | null; hint: string | null } | null
    eventsError: { code: string | null; message: string; details: string | null; hint: string | null } | null
    lastCheckedAt: number | null
  }>(() => ({
    sessionId: null,
    summaryQueryStatus: 'idle',
    eventsQueryStatus: 'idle',
    realtimeStatus: null,
    summaryError: null,
    eventsError: null,
    lastCheckedAt: null,
  }))
  const [usdPlnRate, setUsdPlnRate] = useState<number | null>(() => {
    return getFreshFxRate()
  })
  const [lastLlmSource, setLastLlmSource] = useState<'llm' | 'fallback' | null>(null)
  const [lastLlmWhy, setLastLlmWhy] = useState<string | null>(null)
  const [llmPingResult, setLlmPingResult] = useState<{
    model?: string | null
    tokensIn?: number
    tokensOut?: number
    message?: string | null
    error?: string | null
  } | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const diagnosticsEnabledForUser = isAdmin && diagnosticsEnabled
  const [sessionCreatePriceMinor, setSessionCreatePriceMinor] = useState<number | null>(null)
  const [sessionCreatePriceLoading, setSessionCreatePriceLoading] = useState(false)
  const [reportCreatePriceMinor, setReportCreatePriceMinor] = useState<number | null>(null)
  const [reportCreatePriceLoading, setReportCreatePriceLoading] = useState(false)
  const [reportNavigationLoading, setReportNavigationLoading] = useState(false)
  const [engineBoardLayoutVersion, setEngineBoardLayoutVersion] = useState(0)
  const wasTopupOpenRef = useRef(false)
  const [topupLoadingTier, setTopupLoadingTier] = useState<'S' | 'M' | 'L' | null>(null)

  const suggestDiagEnabled =
    import.meta.env.VITE_SUGGEST_DIAG === '1' || diagnosticsEnabledForUser
  const showDiagnostics = diagnosticsEnabledForUser
  const seedClassificationMode =
    String(import.meta.env.VITE_SEED_CLASSIFICATION_MODE || '').trim() || 'full_3x3 (default)'
  const useColumnFirstSeedMode = seedClassificationMode === 'column_first'
  // This section is part of the standard Engine view (not diagnostics-only).
  const isEnvEnabled = (value: unknown) => value === '1' || value === 'true'
  const actionPlanReadinessEnabled = isEnvEnabled(import.meta.env.VITE_ACTION_PLAN_READINESS_ENABLED)
  const actionPlanReadinessLlmEnabled =
    actionPlanReadinessEnabled && isEnvEnabled(import.meta.env.VITE_ACTION_PLAN_READINESS_LLM_ENABLED)
  const [actionPlanReadinessLlmCache, setActionPlanReadinessLlmCache] = useState<{
    lastEvaluatedCount: number
    lastEvaluatedCoverage: number | null
    lastAttemptedAt: number | null
    lastAttemptedCount: number
    lastAttemptedCoverage: number | null
    lastLLMResult: ActionPlanReadinessLlmResult | null
    loading: boolean
    pending: boolean
  }>(() => ({
    lastEvaluatedCount: 0,
    lastEvaluatedCoverage: null,
    lastAttemptedAt: null,
    lastAttemptedCount: 0,
    lastAttemptedCoverage: null,
    lastLLMResult: null,
    loading: false,
    pending: false,
  }))
  const actionPlanReadinessLlmCacheRef = useRef(actionPlanReadinessLlmCache)
  useEffect(() => {
    actionPlanReadinessLlmCacheRef.current = actionPlanReadinessLlmCache
  }, [actionPlanReadinessLlmCache])
  const actionPlanReadinessLlmSeqRef = useRef(0)
  const actionPlanReadinessLlmInFlightRef = useRef(false)
  const actionPlanReadinessLlmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionPlanReadinessLastTotalCountRef = useRef(0)
  const readinessLastScheduledKeyRef = useRef<string | null>(null)
  const logActionPlanReadinessLlm = useEffectEvent((_event: unknown) => {})

  useEffect(() => {
    if (!actionPlanReadinessEnabled) return
    if (!enginePreviewSessionId) return
    // Reset per-session so existing sessions can bootstrap a first LLM insight.
    readinessLastScheduledKeyRef.current = null
    setActionPlanReadinessLlmCache({
      lastEvaluatedCount: 0,
      lastEvaluatedCoverage: null,
      lastAttemptedAt: null,
      lastAttemptedCount: 0,
      lastAttemptedCoverage: null,
      lastLLMResult: null,
      loading: false,
      pending: false,
    })
    actionPlanReadinessLlmSeqRef.current += 1
    actionPlanReadinessLlmInFlightRef.current = false
    actionPlanReadinessLastTotalCountRef.current = 0
    if (actionPlanReadinessLlmDebounceRef.current) {
      clearTimeout(actionPlanReadinessLlmDebounceRef.current as unknown as number)
      actionPlanReadinessLlmDebounceRef.current = null
    }
  }, [actionPlanReadinessEnabled, enginePreviewSessionId])
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

  const waitForActionPlanReadinessLlmSettled = useEffectEvent(async (timeoutMs: number) => {
    if (!actionPlanReadinessLlmEnabled) return
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const cache = actionPlanReadinessLlmCacheRef.current
      // If we have any LLM result, we're done.
      if (cache.lastLLMResult) return
      // If an attempt was made and we're no longer loading, consider it "settled" (even if it failed/fell back).
      if (cache.lastAttemptedAt && !cache.loading) return
      await new Promise((r) => window.setTimeout(r, 120))
    }
  })
  const triggerInsufficientBalance = () => {
    const currentBalance = billingBalanceOverrideMinor ?? billingAccount.balanceMinor
    setInsufficientBalanceState({
      active: true,
      atBalance: Number.isFinite(currentBalance) ? currentBalance : null,
    })
  }
  const resolveUsageModel = (meta?: LlmUsageMeta): LlmUsageModel | null => {
    if (!meta || meta.aiSupportEnabled === false || !meta.modelUsed) return null
    if (meta.modelUsed === 'gpt-4.1-mini') return 'gpt-4.1-mini'
    if (meta.modelUsed === 'gpt-5-nano') return 'gpt-5-nano'
    if (meta.modelUsed === 'gpt-5-mini') return 'gpt-5-mini'
    if (meta.modelUsed === 'gpt-image-1') return 'gpt-image-1'
    return null
  }
  const applyUsageModel = (meta?: LlmUsageMeta) => {
    if (!meta) return
    setLlmUsageModel(resolveUsageModel(meta))
  }
  const normalizeSupabaseError = (value: unknown) => {
    if (!value) return null
    if (value instanceof Error) {
      const anyErr = value as unknown as { code?: unknown; details?: unknown; hint?: unknown }
      return {
        code: typeof anyErr.code === 'string' ? anyErr.code : null,
        message: value.message || 'UNKNOWN_ERROR',
        details: typeof anyErr.details === 'string' ? anyErr.details : null,
        hint: typeof anyErr.hint === 'string' ? anyErr.hint : null,
      }
    }
    if (typeof value === 'object') {
      const anyErr = value as Record<string, unknown>
      return {
        code: typeof anyErr.code === 'string' ? anyErr.code : null,
        message: typeof anyErr.message === 'string' ? anyErr.message : 'UNKNOWN_ERROR',
        details: typeof anyErr.details === 'string' ? anyErr.details : null,
        hint: typeof anyErr.hint === 'string' ? anyErr.hint : null,
      }
    }
    return { code: null, message: String(value), details: null, hint: null }
  }
  const sessionAiCostEventsHasModelUsedRef = useRef<boolean | null>(null)
  const sessionUsageRefreshInFlightRef = useRef(false)
  const sessionUsageRefreshPendingSessionRef = useRef<string | null>(null)
  const refreshSessionUsage = useEffectEvent(async (sessionId: string | null | undefined) => {
    const normalizedSessionId = String(sessionId || '').trim()
    const userId = authSession?.user?.id ?? null
    if (sessionUsageRefreshInFlightRef.current) {
      sessionUsageRefreshPendingSessionRef.current = normalizedSessionId || null
      return
    }
    if (!normalizedSessionId || !client || !userId) {
      // Avoid transient resets in admin diagnostics (e.g. auth/session still resolving).
      if (!diagnosticsEnabledForUser) {
        setSessionUsage(createEmptySessionUsage())
      }
      if (diagnosticsEnabledForUser) {
        setSessionUsageDiagnostics((prev) => ({
          ...prev,
          sessionId: normalizedSessionId || null,
          summaryQueryStatus: 'idle',
          eventsQueryStatus: 'idle',
          summaryError: null,
          eventsError: null,
          lastCheckedAt: Date.now(),
        }))
      }
      return
    }

    const sb = client
    sessionUsageRefreshInFlightRef.current = true
    sessionUsageRefreshPendingSessionRef.current = null
    try {
      if (diagnosticsEnabledForUser) {
        console.log('[session usage] refresh start', { sessionId: normalizedSessionId, userId, at: Date.now() })
        setSessionUsageDiagnostics((prev) => ({
          ...prev,
          sessionId: normalizedSessionId,
          summaryQueryStatus: 'running',
          eventsQueryStatus: 'running',
          summaryError: null,
          eventsError: null,
          lastCheckedAt: Date.now(),
        }))
      }

      const [summaryRes, eventsRes] = await Promise.all([
        ((sb
          .from('session_ai_cost_summary' as never)
          .select(
            'session_id,user_id,total_tokens_input,total_tokens_output,total_usage_cost_usd,total_usage_cost_pln'
          )
          .eq('session_id', normalizedSessionId)
          .eq('user_id', userId)
          .maybeSingle() as unknown) as Promise<{ data: SessionUsageSummaryRow | null; error: unknown }>),
        (async () => {
          const runSelect = async (columns: string) => {
            return (await (sb
              .from('session_ai_cost_events' as never)
              .select(columns)
              .eq('session_id', normalizedSessionId)
              .eq('user_id', userId) as unknown)) as {
              data: SessionUsageEventRow[] | null
              error: unknown
            }
          }

          // Avoid noisy 400s from PostgREST schema cache when `model_used` is missing.
          // We treat `model` as the canonical field in UI diagnostics.
          sessionAiCostEventsHasModelUsedRef.current = false
          return runSelect('model,tokens_input,tokens_output,usage_cost_usd')
        })(),
      ])

      const summaryError = normalizeSupabaseError(summaryRes.error)
      const eventsError = normalizeSupabaseError(eventsRes.error)
      const summaryRow = summaryRes.data
      const eventsRows = Array.isArray(eventsRes.data) ? eventsRes.data : []

      if (diagnosticsEnabledForUser) {
        console.log('[session usage] summary select result', {
          sessionId: normalizedSessionId,
          ok: !summaryError,
          row: summaryRow,
          error: summaryError,
          at: Date.now(),
        })
        console.log('[session usage] events select result', {
          sessionId: normalizedSessionId,
          ok: !eventsError,
          rowsCount: eventsRows.length,
          rows: eventsRows,
          error: eventsError,
          at: Date.now(),
        })
      }

      if (summaryRes.error || eventsRes.error) {
        if (diagnosticsEnabledForUser) {
          console.error('[session usage] fetch failed', {
            sessionId: normalizedSessionId,
            summaryError,
            eventsError,
            at: Date.now(),
          })
          setSessionUsageDiagnostics((prev) => ({
            ...prev,
            sessionId: normalizedSessionId,
            summaryQueryStatus: summaryError ? 'error' : 'ok',
            eventsQueryStatus: eventsError ? 'error' : 'ok',
            summaryError,
            eventsError,
            lastCheckedAt: Date.now(),
          }))
        }
        // Don't mask errors as "0 tokens" in admin diagnostics; preserve last known values.
        if (!diagnosticsEnabledForUser) {
          setSessionUsage(createEmptySessionUsage())
        }
        return
      }

      if (diagnosticsEnabledForUser) {
        setSessionUsageDiagnostics((prev) => ({
          ...prev,
          sessionId: normalizedSessionId,
          summaryQueryStatus: 'ok',
          eventsQueryStatus: 'ok',
          summaryError: null,
          eventsError: null,
          lastCheckedAt: Date.now(),
        }))
        console.log('[session usage] refresh finish', { sessionId: normalizedSessionId, at: Date.now() })
      }

      const perModel = eventsRows.reduce<Record<string, ModelUsage>>((acc, row) => {
        const model = String(row.model || row.model_used || '').trim()
        if (!model) return acc
        const inputTokens = Number(row.tokens_input ?? 0) || 0
        const outputTokens = Number(row.tokens_output ?? 0) || 0
        const totalUSD = Number(row.usage_cost_usd ?? 0) || 0
        const previous = acc[model] ?? { inputTokens: 0, outputTokens: 0, totalUSD: 0, eventsCount: 0 }
        acc[model] = {
          inputTokens: previous.inputTokens + inputTokens,
          outputTokens: previous.outputTokens + outputTokens,
          totalUSD: previous.totalUSD + totalUSD,
          eventsCount: previous.eventsCount + 1,
        }
        return acc
      }, {})

      const totalInput = Number(summaryRow?.total_tokens_input ?? 0) || 0
      const totalOutput = Number(summaryRow?.total_tokens_output ?? 0) || 0
      const totalUSD = Number(summaryRow?.total_usage_cost_usd ?? 0) || 0
      const totalPLNRaw = Number(summaryRow?.total_usage_cost_pln ?? NaN)
      setSessionUsage({
        perModel,
        totalUSD,
        totalPLN: Number.isFinite(totalPLNRaw) ? totalPLNRaw : null,
        totalTokens: totalInput + totalOutput,
      })
    } catch (error) {
      const normalizedError = normalizeSupabaseError(error)
      if (diagnosticsEnabledForUser) {
        console.error('[session usage] refresh exception', {
          sessionId: normalizedSessionId,
          error: normalizedError,
          at: Date.now(),
        })
        setSessionUsageDiagnostics((prev) => ({
          ...prev,
          sessionId: normalizedSessionId,
          summaryQueryStatus: 'error',
          eventsQueryStatus: 'error',
          summaryError: normalizedError,
          eventsError: normalizedError,
          lastCheckedAt: Date.now(),
        }))
      } else {
        setSessionUsage(createEmptySessionUsage())
      }
    } finally {
      sessionUsageRefreshInFlightRef.current = false
      const pending = sessionUsageRefreshPendingSessionRef.current
      sessionUsageRefreshPendingSessionRef.current = null
      if (pending) {
        void refreshSessionUsage(pending)
      }
    }
  })

  const refreshSessionUsageRef = useRef(refreshSessionUsage)
  useEffect(() => {
    refreshSessionUsageRef.current = refreshSessionUsage
  }, [refreshSessionUsage])
  const applyUsageToSession = async (
    meta?: LlmUsageMeta,
    sessionIdOverride?: string | null
  ) => {
    const input = Number(meta?.tokens?.input ?? 0)
    const output = Number(meta?.tokens?.output ?? 0)
    if (!input && !output) {
      if (import.meta.env.DEV) {
        console.log('[ai] no usage (fallback)')
      }
      setLastLlmSource('fallback')
      return
    }
    setLastLlmSource('llm')
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
    await refreshSessionUsage(sessionId)
  }

  useEffect(() => {
    if (!aiSupportEnabled || llmStatus !== 'online') {
      setLlmUsageModel(null)
    }
  }, [aiSupportEnabled, llmStatus])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem('llm_tokens_total')
    window.sessionStorage.removeItem('engine_usage_v1')
  }, [])
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
  const isPhoneViewport = useIsPhoneViewport()
  const reportLanguage = uiLanguage
  const [postAuthLanguageApplied, setPostAuthLanguageApplied] = useState(false)
  const [enginePreviewSessionName, setEnginePreviewSessionName] = useState('')
  const [engineSessionPersisted, setEngineSessionPersisted] = useState(false)
  const [engineNamePromptOpen, setEngineNamePromptOpen] = useState(false)
  const [engineNameDraft, setEngineNameDraft] = useState('')
  const [engineNameError, setEngineNameError] = useState<string | null>(null)
  const [engineNameSaving, setEngineNameSaving] = useState(false)
  const [engineInitialBriefOpen, setEngineInitialBriefOpen] = useState(false)
  const [engineInitialBriefText, setEngineInitialBriefText] = useState('')
  const [engineInitialBriefError, setEngineInitialBriefError] = useState<string | null>(null)
  const [engineInitialBriefSubmitting, setEngineInitialBriefSubmitting] = useState(false)
  const [engineInitialBriefVoicePreview, setEngineInitialBriefVoicePreview] = useState('')
  const [engineInitialBriefVoiceState, setEngineInitialBriefVoiceState] = useState<
    'idle' | 'listening' | 'unavailable'
  >(() => (getSpeechRecognitionCtor() ? 'idle' : 'unavailable'))
  const [resumeNamePromptAfterList, setResumeNamePromptAfterList] = useState(false)
  const [enginePreviewItems, setEnginePreviewItems] = useState<EngineBoardItem[]>([])
  const [engineBoardItemsLoadedBySession, setEngineBoardItemsLoadedBySession] = useState<
    Record<string, boolean>
  >({})
  const [engineSessionEmptyOnLoadById, setEngineSessionEmptyOnLoadById] = useState<
    Record<string, boolean>
  >({})
  const [enginePreviewInput, setEnginePreviewInput] = useState('')
  const [engineDraftTargetSection, setEngineDraftTargetSection] = useState<EnginePerspectiveKey | null>(
    null
  )
  const [enginePreviewVoiceState, setEnginePreviewVoiceState] = useState<
    'idle' | 'listening' | 'unavailable'
  >(() => (getSpeechRecognitionCtor() ? 'idle' : 'unavailable'))
  const [enginePreviewVoiceError, setEnginePreviewVoiceError] = useState<string | null>(null)
  const [engineAddEntryLoading, setEngineAddEntryLoading] = useState(false)
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
  const [engineActiveFacilitationPerspective, setEngineActiveFacilitationPerspective] =
    useState<FacilitationPerspective | null>(null)
  const [lastFacilitationPerspective, setLastFacilitationPerspective] =
    useState<FacilitationPerspective | null>(null)
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
  const paymentReturnHandledRef = useRef(false)
  const authCallbackErrorTimerRef = useRef<number | null>(null)
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
  const [engineSessionsError, setEngineSessionsError] = useState<string | null>(null)
  const [cloudSessionPayloads, setCloudSessionPayloads] = useState<
    Record<string, CloudSessionPayload>
  >({})
  const [reportRecords, setReportRecords] = useState<Record<string, ReportRecord | null>>({})
  const [engineNotice, setEngineNotice] = useState<{
    message: string
    variant: 'success' | 'error'
  } | null>(null)
  const [logoutInProgress, setLogoutInProgress] = useState(false)
  const [engineDeleteLoadingId, setEngineDeleteLoadingId] = useState<string | null>(null)
  const [engineSessionDetail, setEngineSessionDetail] = useState<EngineSessionDetail | null>(null)
  const [engineEditItemId, setEngineEditItemId] = useState<string | null>(null)
  const [engineEditText, setEngineEditText] = useState('')
  const [engineEditLoading, setEngineEditLoading] = useState(false)
  const [enginePreviewEditId, setEnginePreviewEditId] = useState<string | null>(null)
  const [enginePreviewEditText, setEnginePreviewEditText] = useState('')
  const [engineAssignLoading, setEngineAssignLoading] = useState(false)
  const [engineEntryDeleteId, setEngineEntryDeleteId] = useState<string | null>(null)
  const [, setEngineApiDebug] = useState<{
    endpoint: string
    status: number
    response: unknown
    rawText: string
  } | null>(null)
  const [, setEngineFacilitationDiagnostics] = useState<{
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
  const [engineEntryRowSpans, setEngineEntryRowSpans] = useState<Record<string, number>>({})
  const [engineDraggingEntryId, setEngineDraggingEntryId] = useState<string | null>(null)
  const [engineDragOverSection, setEngineDragOverSection] = useState<EnginePerspectiveKey | null>(null)
  const [engineDragTargetIndex, setEngineDragTargetIndex] = useState<number | null>(null)
  const [engineMovingEntryId, setEngineMovingEntryId] = useState<string | null>(null)
  const [engineMatrixVisible] = useState(false)
  const [engineLabelEditorId, setEngineLabelEditorId] = useState<string | null>(null)
  const engineLabelEditorRef = useRef<HTMLDivElement | null>(null)
  const engineLabelSelectRef = useRef<HTMLSelectElement | null>(null)
  const engineDragHoverTimerRef = useRef<number | null>(null)
  const enginePendingDragTargetRef = useRef<{
    section: EnginePerspectiveKey
    index: number
  } | null>(null)
  const engineEntryNodesRef = useRef<Record<string, HTMLLIElement | null>>({})
  const wasPhoneViewportRef = useRef(false)
  const engineLabelCache = useRef<Record<string, string | null>>({})
  const openSessionDebugOnceRef = useRef(false)
  const engineInputRef = useRef<HTMLTextAreaElement | null>(null)
  const enginePreviewRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const enginePreviewVoiceBaseTextRef = useRef('')
  const enginePreviewVoiceSessionBaseTextRef = useRef('')
  const enginePreviewVoiceCommittedTextRef = useRef('')
  const enginePreviewVoiceTranscriptRef = useRef('')
  const enginePreviewVoiceAbortRef = useRef(false)
  const enginePreviewVoiceCorrectionSeqRef = useRef(0)
  const engineInitialBriefInputRef = useRef<HTMLTextAreaElement | null>(null)
  const engineInitialBriefRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const engineInitialBriefTextRef = useRef('')
  const engineInitialBriefTranscriptDraftRef = useRef('')
  const engineInitialBriefVoiceAbortRef = useRef(false)
  const engineInitialBriefVoiceBaseTextRef = useRef('')
  const engineInitialBriefVoiceSessionBaseTextRef = useRef('')
  const engineInitialBriefVoiceCommittedTextRef = useRef('')
  const engineInitialBriefVoiceCorrectionSeqRef = useRef(0)
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
  const hasEngineBoardEntries = enginePreviewItems.length > 0

  const languageOptions: Language[] = ['English', 'Polish']

  const uiLanguageOptions: Language[] = ['Polish', 'English']

  const hasSupabaseEnv = supabaseEnvDiag.hasUrl && supabaseEnvDiag.hasAnon
  const authDisabled = !hasSupabaseEnv
  const isAuthed = Boolean(authSession?.user?.id)
  const activeUsageSessionId = enginePreviewSessionId || engineSessionDetail?.session?.id || null
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

  useEffect(() => {
    void refreshSessionUsage(activeUsageSessionId)
  }, [activeUsageSessionId, authSession?.user?.id, client, isAuthed])

  useEffect(() => {
    const supabaseClient = client
    if (!supabaseClient || !isAuthed || !activeUsageSessionId) return
    if (showDiagnostics) {
      console.log('[session usage][realtime] subscribe start', { sessionId: activeUsageSessionId, at: Date.now() })
      setSessionUsageDiagnostics((prev) => ({
        ...prev,
        sessionId: String(activeUsageSessionId || '').trim() || null,
        realtimeStatus: 'SUBSCRIBING',
      }))
    }
    let subscribeStatusTimeout: number | null = null
    if (showDiagnostics) {
      subscribeStatusTimeout = window.setTimeout(() => {
        setSessionUsageDiagnostics((prev) => {
          if (prev.realtimeStatus && prev.realtimeStatus !== 'SUBSCRIBING') return prev
          console.warn('[session usage][realtime] subscribe timeout', {
            sessionId: activeUsageSessionId,
            at: Date.now(),
          })
          return { ...prev, realtimeStatus: 'SUBSCRIBE_TIMEOUT' }
        })
      }, 6000)
    }
    let delayedRefreshTimer: number | null = null
    const scheduleRefresh = () => {
      void refreshSessionUsageRef.current(activeUsageSessionId)
      if (delayedRefreshTimer) {
        window.clearTimeout(delayedRefreshTimer)
      }
      // Refresh once more shortly after the event so the summary view can catch up.
      delayedRefreshTimer = window.setTimeout(() => {
        void refreshSessionUsageRef.current(activeUsageSessionId)
      }, 250)
    }

    const channel = supabaseClient
      .channel(`session-usage-${activeUsageSessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_ai_cost_events',
          filter: `session_id=eq.${activeUsageSessionId}`,
        },
        (payload) => {
          if (showDiagnostics) {
            console.log('[session usage][realtime] event', {
              sessionId: activeUsageSessionId,
              payload,
              at: Date.now(),
            })
          }
          scheduleRefresh()
        }
      )
      .subscribe((status) => {
        if (showDiagnostics) {
          console.log('[session usage][realtime] status', { sessionId: activeUsageSessionId, status, at: Date.now() })
        }
        if (subscribeStatusTimeout) {
          window.clearTimeout(subscribeStatusTimeout)
          subscribeStatusTimeout = null
        }
        setSessionUsageDiagnostics((prev) => {
          const nextSessionId = String(activeUsageSessionId || '').trim() || null
          if (prev.realtimeStatus === status && prev.sessionId === nextSessionId) return prev
          return { ...prev, sessionId: nextSessionId, realtimeStatus: status }
        })
      })

    return () => {
      if (delayedRefreshTimer) {
        window.clearTimeout(delayedRefreshTimer)
      }
      if (subscribeStatusTimeout) {
        window.clearTimeout(subscribeStatusTimeout)
      }
      if (showDiagnostics) {
        console.log('[session usage][realtime] unsubscribe', { sessionId: activeUsageSessionId, at: Date.now() })
      }
      void supabaseClient.removeChannel(channel)
    }
  }, [activeUsageSessionId, client, isAuthed, showDiagnostics])

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
    const trimmed = String(value).trim()
    if (!trimmed) return null
    // Accept absolute URLs only if they match the current origin; then downgrade to a relative path.
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed)
        if (typeof window === 'undefined') return null
        if (parsed.origin !== window.location.origin) return null
        const next = `${parsed.pathname || ''}${parsed.search || ''}${parsed.hash || ''}`
        return next.startsWith('/') && !next.startsWith('//') ? next : null
      } catch {
        return null
      }
    }
    if (!trimmed.startsWith('/')) return null
    if (trimmed.startsWith('//')) return null
    return trimmed
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
    }, 5000)
  }

  const resetAuthDev = async () => {
    if (!import.meta.env.DEV) return
    if (client) {
      await client.auth.signOut()
    }
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
      window.sessionStorage.clear()
      safeNavigate('/')
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

  const resolveFacilitationRequestType = (
    perspective: FacilitationPerspective
  ): FacilitationType => {
    const requestedMode = FACILITATION_PERSPECTIVE_MODE[perspective]
    const isContinuation =
      engineActiveFacilitationPerspective === perspective &&
      engineLastQuestionMeta?.mode_code === requestedMode
    return isContinuation ? 'DEEPEN' : 'PERSPECTIVE'
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
  const getAppPath = () => {
    if (typeof window === 'undefined') return ''
    if (window.location.hash?.startsWith('#/')) {
      return window.location.hash.slice(1)
    }
    return window.location.pathname || ''
  }
  const storeTopupReturnTo = () => {
    if (typeof window === 'undefined') return
    const returnTo = getAppPath() || window.location.pathname || '/'
    window.sessionStorage.setItem(TOPUP_RETURN_TO_KEY, returnTo)
  }
  const handleTopupReturn = () => {
    if (typeof window === 'undefined') return
    const stored = window.sessionStorage.getItem(TOPUP_RETURN_TO_KEY)
    if (stored) {
        window.sessionStorage.removeItem(TOPUP_RETURN_TO_KEY)
        const normalized = stored.startsWith('#') ? stored.slice(1) : stored
      if (normalized.startsWith('/')) {
        const currentPath = window.location.pathname.replace(/\/+$/, '')
        if (currentPath === '/topup') {
          safeNavigate(normalized)
          return
        }
        window.location.hash = `#${normalized}`
        setHashPath(normalized)
        return
      }
    }
    if (window.history.length > 1) {
      window.history.back()
    }
  }
  const [hashPath, setHashPath] = useState(() => getAppPath())
  const idleThresholdMs = isE2EEnabled()
    ? 800
    : isDebugEnabled()
      ? 5000
      : DEFAULT_IDLE_THRESHOLD_MS
  const postAddGraceMs = isE2EEnabled() ? 200 : 7000
  // Routing is handled manually using window.location.pathname (no router library).
  const rawPath = typeof window !== 'undefined' ? window.location.pathname : ''
  const normalizedPath = rawPath.replace(/\/+$/, '')
  const appPath = hashPath
  const isEnginePreview = normalizedPath === '/engine'
  const isReportPath = normalizedPath === '/report' || normalizedPath.endsWith('/report')
  const isReport = isReportPath || reportViewOpen
  const isWorkInProgress = normalizedPath === '/wip'
  const isIdeaGrid = normalizedPath === '/grid'
  const isLogin = normalizedPath === '/login'
  const isPrivacy = normalizedPath === '/privacy'
  const isTopup =
    normalizedPath === '/topup' ||
    appPath === '/topup' ||
    (typeof window !== 'undefined' && window.location.hash.startsWith('#/topup'))
  const isAuthCallback = normalizedPath === '/auth/callback'
  const isAdminRoute = appPath === '/admin' || appPath.startsWith('/admin/')
  const isProtectedRoute = normalizedPath.startsWith('/app')
  const supabaseInitError = getSupabaseInitError()
  const showSupabaseConfigError = Boolean(supabaseInitError)
  const billingAccount = useBillingAccount(authSession?.user?.id ?? null, {
    enabled: isEnginePreview || isReport,
    uiLanguage,
  })
  const balanceCurrency: 'PLN' = billingAccount.currency
  const [billingBalanceOverrideMinor, setBillingBalanceOverrideMinor] = useState<number | null>(
    null
  )
  const refreshBillingBalance = async (): Promise<number | null> => {
    if (!authSession?.user?.id) return null
    try {
      void uiLanguage
      const response = await apiFetch('/api/billing?action=balance', {
        method: 'GET',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) return null
      const balance = Number(payload?.balanceMinor ?? 0)
      if (Number.isFinite(balance)) {
        setBillingBalanceOverrideMinor(balance)
        return balance
      }
    } catch {
      // ignore refresh failures
    }
    return null
  }
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isEnginePreview) return
    if (paymentReturnHandledRef.current) return

    const params = new URLSearchParams(window.location.search || '')
    if (params.get('payment') !== 'success') return

    // Wait until we have a user id so refreshBillingBalance can run.
    if (!authSession?.user?.id) return

    paymentReturnHandledRef.current = true
    showEngineNotice(
      uiLanguage === 'Polish'
        ? 'Płatność została przyjęta. Saldo może odświeżyć się za chwilę.'
        : 'Payment was accepted. Your balance may refresh in a moment.',
      'success'
    )

    void refreshBillingBalance()

    // Optional cleanup: remove the query param after handling it.
    params.delete('payment')
    const search = params.toString()
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash || ''}`
    window.history.replaceState({}, '', nextUrl)
  }, [
    authSession?.user?.id,
    isEnginePreview,
    uiLanguage,
  ])
  const formatTopupAmountValue = (amountMinor: number) => {
    const amount = amountMinor / 100
    const locale = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  }
  const resolveAutopayTopupMinor = (tier: 'S' | 'M' | 'L') => ({
    currency: 'PLN' as const,
    amountMinor: tier === 'S' ? 2000 : tier === 'M' ? 5000 : 10000,
  })

  const handleAutopayTopup = async (tier: 'S' | 'M' | 'L') => {
    if (topupLoadingTier) return
    if (!authSession?.user?.id) {
      showEngineNotice(notices.topupUnauthorized, 'error')
      return
    }
    if (typeof window !== 'undefined') {
      console.log('[TOPUP AUTOPAY] start', { tier })
    }
    const topup = resolveAutopayTopupMinor(tier)
    setTopupLoadingTier(tier)
    try {
      const amountPln = (topup.amountMinor / 100).toFixed(2)
      const supabaseClient = client
      const { data: sessionData } = supabaseClient
        ? await supabaseClient.auth.getSession()
        : { data: { session: null } as { session: null } }
      const accessToken = sessionData?.session?.access_token
      console.log('[TOPUP AUTOPAY] auth header', { hasAccessToken: Boolean(accessToken) })
      const headers = {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      }
      const response = await fetch('/api/billing?action=create_payment', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ amountPln }),
      })
      if (typeof window !== 'undefined') {
        console.log('[TOPUP AUTOPAY] response status', response.status)
        console.log('[TOPUP AUTOPAY] content-type', response.headers.get('content-type'))
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || 'Payment initialization failed')
      }
      const html = await response.text()
      if (typeof document !== 'undefined') {
        document.open()
        document.write(html)
        document.close()
      }
    } catch {
      showEngineNotice(notices.topupTestFailed, 'error')
      setTopupLoadingTier(null)
    }
  }

  const handleTopupClick = async (tier: 'S' | 'M' | 'L') => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const isDiagMode = params.get('diag') === '1'
      console.log('[TOPUP CLICK]', {
        tier,
        isDiagMode,
        location: window.location.href,
      })
      console.log('[TOPUP PATH]', isDiagMode ? 'TEST_TOPUP' : 'AUTOPAY')
    }
    await handleAutopayTopup(tier)
  }
  const [insufficientBalanceState, setInsufficientBalanceState] = useState<{
    active: boolean
    atBalance: number | null
  }>({ active: false, atBalance: null })
  const clearInsufficientBalance = () => {
    setInsufficientBalanceState({ active: false, atBalance: null })
  }

  useEffect(() => {
    if (billingBalanceOverrideMinor == null) return
    if (billingAccount.balanceMinor === billingBalanceOverrideMinor) {
      setBillingBalanceOverrideMinor(null)
    }
  }, [billingAccount.balanceMinor, billingBalanceOverrideMinor])

  useEffect(() => {
    if (!insufficientBalanceState.active) return
    const currentBalance = billingBalanceOverrideMinor ?? billingAccount.balanceMinor
    const baseline = insufficientBalanceState.atBalance
    if (baseline != null && currentBalance > baseline) {
      setInsufficientBalanceState({ active: false, atBalance: null })
    }
  }, [
    billingAccount.balanceMinor,
    billingBalanceOverrideMinor,
    insufficientBalanceState.active,
    insufficientBalanceState.atBalance,
  ])

  useEffect(() => {
    if (!insufficientBalanceState.active) return
    clearInsufficientBalance()
  }, [normalizedPath, appPath])

  useEffect(() => {
    const supabaseClient = client
    if (!supabaseClient || !isEnginePreview) return
    let cancelled = false
    const loadPrice = async () => {
      setSessionCreatePriceLoading(true)
      try {
        const { data, error } = await supabaseClient
          .from('pricing_rules_public')
          .select('price_grosze')
          .eq('action_key', 'session_create')
          .maybeSingle()
        if (!cancelled) {
          if (error) {
            setSessionCreatePriceMinor(null)
          } else {
            const row = data as {
              price_grosze?: number | string | null
            } | null
            const value = Number(row?.price_grosze)
            setSessionCreatePriceMinor(Number.isFinite(value) ? value : null)
          }
        }
      } catch {
        if (!cancelled) setSessionCreatePriceMinor(null)
      } finally {
        if (!cancelled) setSessionCreatePriceLoading(false)
      }
    }
    void loadPrice()
    return () => {
      cancelled = true
    }
  }, [client, isEnginePreview])

  useEffect(() => {
    const supabaseClient = client
    if (!supabaseClient || !isEnginePreview) return
    let cancelled = false
    const loadPrice = async () => {
      setReportCreatePriceLoading(true)
      try {
        const { data, error } = await supabaseClient
          .from('pricing_rules_public')
          .select('price_grosze')
          .eq('action_key', 'report_generate')
          .maybeSingle()
        if (!cancelled) {
          if (error) {
            setReportCreatePriceMinor(null)
          } else {
            const row = data as {
              price_grosze?: number | string | null
            } | null
            const value = Number(row?.price_grosze)
            setReportCreatePriceMinor(Number.isFinite(value) ? value : null)
          }
        }
      } catch {
        if (!cancelled) setReportCreatePriceMinor(null)
      } finally {
        if (!cancelled) setReportCreatePriceLoading(false)
      }
    }
    void loadPrice()
    return () => {
      cancelled = true
    }
  }, [client, isEnginePreview])

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
    const handleHashChange = () => {
      setHashPath(getAppPath())
    }
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handleHashChange)
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
      try {
        const rate = await fetchFxUsdPlnRate()
        if (!cancelled) {
          if (Number.isFinite(rate) && (rate || 0) > 0) {
            setUsdPlnRate(rate as number)
          } else {
            setUsdPlnRate(FX_FALLBACK_RATE)
          }
        }
      } catch {
        if (!cancelled) {
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
    if (!client) {
      setAuthError(missingSupabaseEnvMessage)
      return
    }
    if (!authResolved) return
    if (!authSession?.user) return
    if (authRedirectedRef.current) return
    if (typeof window === 'undefined') return
    if (isAuthCallback) return
    if (isAdminRoute) return
    const nextRaw = readPostAuthNext()
    const next = nextRaw && nextRaw !== '/' ? nextRaw : '/engine'
    const lang = readPostAuthLang()
    if (lang) {
      setUiLanguage(lang)
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, lang)
      clearPostAuthLang()
    }
    clearPostAuthNext()
    setAuthFlowInProgress(false)
    console.info('[auth] session resolved', { hasSession: true, next, lang })
    console.info('[auth] redirecting', { redirectTo: next })
    authRedirectedRef.current = true
    if (window.location.pathname !== next) {
      const target = next.startsWith('/') ? `${window.location.origin}${next}` : next
      saveAuthCallbackDiag({ event: 'session_resolved_nav', next, target })
      safeNavigate(target)
    }
  }, [authResolved, authSession?.user?.id])

  useEffect(() => {
    if (!isProtectedRoute || authLoading || authDisabled) return
    if (!authSession) {
      const next = window.location.pathname + window.location.search
      safeNavigate(`/login?next=${encodeURIComponent(next)}`)
    }
  }, [isProtectedRoute, authLoading, authSession, authDisabled])

  useEffect(() => {
    if (!isEnginePreview) return
    if (!authResolved) return
    if (isAuthed || guestEntryAllowed) return
    if (typeof window === 'undefined') return
    const next = window.location.pathname + window.location.search
    safeNavigate(`/login?next=${encodeURIComponent(next)}`)
  }, [isEnginePreview, authResolved, isAuthed, guestEntryAllowed])

  useEffect(() => {
    if (initialRouteResolvedRef.current) return
    if (!authResolved) return
    if (typeof window === 'undefined') return
    if (isAdminRoute) return
    if (isAuthCallback || isAuthFlowInProgress()) return
    if (authSession?.user) return
    const path = window.location.pathname
    let target = path
    const isReportPath = path.replace(/\/+$/, '') === '/report' || path.endsWith('/report')
    const isPrivacyPath = path.replace(/\/+$/, '') === '/privacy'

    if (!canEnterApp && !isReportPath && !isPrivacyPath) {
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

    if (target !== path) {
      safeNavigate(target)
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
      let callbackSucceeded = false
      setAuthError(null)
      setAuthCallbackError(null)
      setAuthCallbackLoading(true)
      setAuthCallbackHint(null)
      const href = typeof window !== 'undefined' ? window.location.href : ''
      console.info('[auth][callback]', {
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        href,
      })
      saveAuthDiag('auth_callback_start', {})
      const authDiagLoginOrigin =
        typeof window !== 'undefined' ? window.localStorage.getItem('auth_diag_login_origin') : null
      const authDiagLoginHref =
        typeof window !== 'undefined' ? window.localStorage.getItem('auth_diag_login_href') : null
      const authDiagRedirectTo =
        typeof window !== 'undefined' ? window.localStorage.getItem('auth_diag_redirect_to') : null
      const authDiagStartedAt =
        typeof window !== 'undefined' ? window.localStorage.getItem('auth_diag_started_at') : null
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const errorParam = params.get('error')
      const errorDescription = params.get('error_description')
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
      const originMatches = Boolean(authDiagLoginOrigin && currentOrigin && authDiagLoginOrigin === currentOrigin)
      const authStorageKeys =
        typeof window !== 'undefined'
          ? Object.keys(window.localStorage || {}).filter((key) => {
              const lower = key.toLowerCase()
              return (
                lower.includes('supabase') ||
                lower.includes('sb-') ||
                lower.includes('auth') ||
                lower.includes('pkce') ||
                lower.includes('code-verifier')
              )
            })
          : []
      saveAuthDiag('auth_callback_pkce_diag', {
        currentOrigin,
        currentHref: href,
        auth_diag_login_origin: authDiagLoginOrigin,
        auth_diag_login_href: authDiagLoginHref,
        auth_diag_redirect_to: authDiagRedirectTo,
        auth_diag_started_at: authDiagStartedAt,
        originMatches,
        hasCode: Boolean(code),
        error: errorParam,
        error_description: errorDescription,
        authStorageKeys,
      })
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
          description: errorDescription,
          href,
        })
        setAuthCallbackError(copy.authCallback.signInFailed)
        setAuthCallbackHint(errorDescription || null)
        setAuthCallbackLoading(false)
        return
      }
      try {
        const callbackCode = code || ''
        if (!callbackCode) {
          setAuthCallbackError(copy.authCallback.signInFailed)
          setAuthCallbackHint(copy.authCallback.missingCode)
          setAuthCallbackLoading(false)
          return
        }
        if (authCodeExchangeInProgress || exchangedAuthCodes.has(callbackCode)) {
          console.warn('[auth callback] duplicate exchange blocked', { code: callbackCode })
          saveAuthDiag('auth_callback_duplicate_exchange_blocked_module', { code: callbackCode })
          setAuthCallbackLoading(false)
          return
        }
        authCodeExchangeInProgress = true
        exchangedAuthCodes.add(callbackCode)
        console.info('[auth exchange START]', { code: callbackCode, time: Date.now() })
        // (Legacy sessionStorage/ref guards removed; module-level guard above is the source of truth.)
        const startedAt = new Date().toISOString()
        const exchangeStartPayload = {
          ts: startedAt,
          callbackCode,
        }
        saveAuthDiag('auth_callback_exchange_start', exchangeStartPayload as any)
        const { data, error } = await auth.exchangeCodeForSession(callbackCode)
        console.info('[auth exchange END]', {
          success: Boolean(!error && data?.session),
          errorCode: (error as any)?.code ?? null,
          errorMessage: (error as any)?.message ?? null,
        })
        if (cancelled) return
        if (error || !data?.session) {
          const codeValue = (error as { code?: string })?.code ?? null
          const statusValue = (error as { status?: number })?.status ?? null
          const nameValue = (error as any)?.name ?? null
          const messageValue = (error as any)?.message ?? null
          const errPayload = {
            name: nameValue,
            message: messageValue,
            code: codeValue,
            status: statusValue,
          }
          console.error('[auth][callback] exchangeCodeForSession_failed', errPayload)
          saveAuthDiag('auth_callback_exchange_failed', {
            success: false,
            error: errPayload,
          })
          const debugValue = messageValue
            ? `${messageValue}${codeValue ? ` (${codeValue})` : ''}`
            : null
          setAuthCallbackError(copy.authCallback.signInFailed)
          setAuthCallbackHint(debugValue)
          setAuthCallbackLoading(false)
          return
        }
        console.info('[auth][callback] exchangeCodeForSession:ok', { hasSession: true })
        saveAuthDiag('auth_callback_exchange_ok', {
          success: true,
          hasSession: true,
        })
        clearAuthRedirect()
        const nextParam = normalizeNextPath(
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('next')
            : null
        )
        const savedReturnTo = typeof window !== 'undefined' ? readPostAuthNext() : null
        const nextRaw = nextParam || savedReturnTo
        const nextPath = nextRaw && nextRaw !== '/' ? nextRaw : '/engine'
        const target = typeof window !== 'undefined' ? `${window.location.origin}${nextPath}` : nextPath
        console.info('[auth][callback]', {
          origin: typeof window !== 'undefined' ? window.location.origin : '',
          href: typeof window !== 'undefined' ? window.location.href : '',
        })
        saveAuthDiag('auth_callback_success', { nextTarget: target })
        const lang = readPostAuthLang()
        if (lang) {
          setUiLanguage(lang)
          window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, lang)
          clearPostAuthLang()
        }
        clearPostAuthNext()
        setAuthCallbackLoading(false)
        callbackSucceeded = true
        if (typeof window !== 'undefined') {
          window.location.replace(`${window.location.origin}/engine`)
        }
      } finally {
        authCodeExchangeInProgress = false
        if (!callbackSucceeded) {
          setAuthFlowInProgress(false)
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [isAuthCallback])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (authCallbackErrorTimerRef.current) {
      window.clearTimeout(authCallbackErrorTimerRef.current)
      authCallbackErrorTimerRef.current = null
    }
    setAuthCallbackErrorVisible(false)
    if (!isAuthCallback) return
    if (authCallbackLoading) return
    if (!authCallbackError) return
    // Prevent brief "flash" of transient callback errors during OAuth/PKCE flows.
    authCallbackErrorTimerRef.current = window.setTimeout(() => {
      setAuthCallbackErrorVisible(true)
    }, 800)
    return () => {
      if (authCallbackErrorTimerRef.current) {
        window.clearTimeout(authCallbackErrorTimerRef.current)
        authCallbackErrorTimerRef.current = null
      }
    }
  }, [isAuthCallback, authCallbackLoading, authCallbackError])

  useEffect(() => {
    // Intentionally disabled: auto-sign-out on pagehide/beforeunload.
    // These events can fire during normal navigations/redirects (incl. OAuth),
    // causing sessions to be cleared and forcing "login twice" behavior.
    return
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
      setAuthError(missingSupabaseEnvMessage)
      return
    }
	    setAuthError(null)
	    setLoginNotice(null)
	    setLoginOauthLoading(true)
	    const redirectTo = new URL('/auth/callback', window.location.origin).toString()
    console.info('[auth][start]', {
      origin: window.location.origin,
      href: window.location.href,
      redirectTo,
    })
    saveAuthDiag('auth_start', { redirectTo })
    try {
      window.localStorage.setItem('auth_diag_login_origin', window.location.origin)
      window.localStorage.setItem('auth_diag_login_href', window.location.href)
      window.localStorage.setItem('auth_diag_redirect_to', redirectTo)
      window.localStorage.setItem('auth_diag_started_at', new Date().toISOString())
    } catch {
      // ignore
    }
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
      options: {
        redirectTo,
        queryParams: {
          prompt: 'select_account',
        },
      },
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
      setAuthError(missingSupabaseEnvMessage)
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
    const redirectTo = new URL('/auth/callback', window.location.origin).toString()
    console.info('[auth][start]', {
      origin: window.location.origin,
      href: window.location.href,
      redirectTo,
    })
    saveAuthDiag('auth_start', { redirectTo })
    try {
      window.localStorage.setItem('auth_diag_login_origin', window.location.origin)
      window.localStorage.setItem('auth_diag_login_href', window.location.href)
      window.localStorage.setItem('auth_diag_redirect_to', redirectTo)
      window.localStorage.setItem('auth_diag_started_at', new Date().toISOString())
    } catch {
      // ignore
    }
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
        const baseMessage = notices.authRateLimit
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
      setAuthError(missingSupabaseEnvMessage)
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
      const redirectTo = `${window.location.origin}/auth/callback`
      console.info('[auth][start]', {
        origin: window.location.origin,
        href: window.location.href,
        redirectTo,
      })
      saveAuthDiag('auth_start', { redirectTo })
      const { data, error } = await client.auth.signUp({
        email: loginEmail.trim(),
        password: loginPassword,
        options: { emailRedirectTo: redirectTo },
      })
      if (import.meta.env.DEV) {
        console.log('[auth email] signUp', { ok: !error, error })
      }
      if (error) {
        const codeValue = (error as { code?: string }).code
        const detail = import.meta.env.DEV && codeValue ? ` (${codeValue})` : ''
        setAuthError(`${error.message}${detail}`)
      } else if (!data?.session) {
        setLoginNotice(copy.loginNoticeSignup)
      }
    }
    setLoginSending(false)
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
    const boardEntries = (enginePreviewItems || [])
      .map((item) => normalizeEngineBoardEntryForLlm(item, uiLanguage, { maxAnswerLen: 280, maxQuestionLen: 260 }))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
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
      safeNavigate(target)
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
    setEngineDraftTargetSection(null)
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
    // Avoid showing facilitation immediately after session creation due to a stale idle baseline
    // (e.g. when user interaction happened on the landing screen and session creation took longer than the idle threshold).
    if (sessionKey !== 'new' && transferInteraction) {
      setEngineLastInputActivityAt(Date.now())
    }
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

  useEffect(() => {
    if (!engineLabelEditorId || typeof window === 'undefined') return
    const select = engineLabelSelectRef.current
    if (!select) return

    const frame = window.requestAnimationFrame(() => {
      const currentSelect = engineLabelSelectRef.current
      if (!currentSelect) return
      currentSelect.focus()
      const pickerSelect = currentSelect as HTMLSelectElement & {
        showPicker?: () => void
      }
      if (typeof pickerSelect.showPicker === 'function') {
        pickerSelect.showPicker()
        return
      }
      currentSelect.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      currentSelect.click()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [engineLabelEditorId])


  const isDebugMatrix =
    typeof window !== 'undefined' && window.location.pathname === '/debug/matrix'

  const checkLlmStatus = async (base: string) => {
    if (!aiSupportEnabled || !base) {
      setLlmStatus('offline')
      return
    }
    try {
      const response = await fetch(`${base}/api/core?action=health`, { method: 'GET' })
      setLlmStatus(response.ok ? 'online' : 'offline')
    } catch {
      setLlmStatus('offline')
    }
  }

  const handleLlmPing = async () => {
    try {
      setLlmPingResult(null)
      const response = await fetch(`${llmApiBase}/api/core?action=health&scope=llm`, {
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
    if (!authResolved) return
    const sbClient = client
    if (!sbClient) {
      setIsAdmin(false)
      return
    }
    let cancelled = false
    const run = async () => {
      try {
        const { data } = await sbClient.auth.getSession()
        const token = data.session?.access_token || ''
        if (!token) {
          if (!cancelled) setIsAdmin(false)
          return
        }
        const res = await fetch('/api/admin?action=admin.check', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.ok) {
          if (!cancelled) setIsAdmin(false)
          return
        }
        if (!cancelled) setIsAdmin(Boolean(payload.isAdmin))
      } catch {
        if (!cancelled) setIsAdmin(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [authResolved, authSession?.user?.id])

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
    if (engineNoticeTimer.current) {
      window.clearTimeout(engineNoticeTimer.current)
      engineNoticeTimer.current = null
    }
    setEngineNotice(null)
    setEnginePreviewError(null)
    setEngineFacilitationInlineError(null)
    setEngineNameError(null)
    setEngineSessionsError(null)
    setAuthError(null)
    setAuthCallbackError(null)
    setAuthCallbackHint(null)
    setLoginNotice(null)
    setFeedbackNotice(null)
  }, [uiLanguage])

  useEffect(() => {
    return () => {
      if (engineDragHoverTimerRef.current) {
        window.clearTimeout(engineDragHoverTimerRef.current)
        engineDragHoverTimerRef.current = null
      }
    }
  }, [])

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
    const sessionId =
      enginePreviewSessionId ||
      engineSessionDetail?.session?.id ||
      (typeof window !== 'undefined'
        ? window.sessionStorage.getItem('reportReturnSessionId')
        : null) ||
      null
    const reportMeta = getReportMetaForSession(sessionId)
    const reportIdeas =
      engineSessionDetail?.boardItems?.length
        ? engineSessionDetail.boardItems
        : enginePreviewItems.length
          ? enginePreviewItems
          : reportMeta?.ideas || []
    const ideas = reportIdeas.map((item, index) => {
      const current = item as Record<string, unknown>
      const questionId =
        typeof current.question_id === 'string'
          ? current.question_id
          : typeof current.questionId === 'string'
            ? current.questionId
            : null
      const questionTextPl =
        typeof current.question_text_pl === 'string'
          ? current.question_text_pl
          : typeof current.questionTextPl === 'string'
            ? current.questionTextPl
            : null
      const questionTextEn =
        typeof current.question_text_en === 'string'
          ? current.question_text_en
          : typeof current.questionTextEn === 'string'
            ? current.questionTextEn
            : null
      const matrixRow =
        typeof current.matrix_row === 'string'
          ? current.matrix_row
          : typeof current.matrixRow === 'string'
            ? current.matrixRow
            : null
      const matrixCol =
        typeof current.matrix_col === 'string'
          ? current.matrix_col
          : typeof current.matrixCol === 'string'
            ? current.matrixCol
            : null
      return {
        id: (item as { id?: string }).id || `idea-${index + 1}`,
        text: (item as { text: string }).text,
        label: (item as { label?: string | null }).label ?? null,
        questionId,
        questionTextPl,
        questionTextEn,
        matrixRow,
        matrixCol,
      }
    })
    const questions = Object.entries(engineAskedQuestionTextById).map(([id, text]) => ({
      id,
      text,
    }))
    const sourceUpdatedAt = reportIdeas.reduce((max, item) => {
      const current = item as Record<string, unknown>
      const updatedAtRaw =
        typeof current.updated_at === 'number'
          ? current.updated_at
          : typeof current.updatedAt === 'number'
            ? current.updatedAt
            : typeof current.created_at === 'number'
              ? current.created_at
              : typeof current.createdAt === 'number'
                ? current.createdAt
                : 0
      const updatedAt = Number(updatedAtRaw || 0)
      return Math.max(max, updatedAt)
    }, 0)
    const reportSnapshotMeta = reportMeta
      ? {
          createdAt: reportMeta.created_at ?? null,
          updatedAt: reportMeta.updated_at ?? null,
          sourceUpdatedAt: reportMeta.sourceUpdatedAt ?? null,
          lastSummaryTextHash: reportMeta.lastSummaryTextHash ?? null,
          summary: reportMeta.summary ?? null,
          ideas: reportMeta.ideas ?? null,
          recommendations: reportMeta.recommendations ?? null,
          triz: reportMeta.triz ?? null,
          execution_report: reportMeta.execution_report ?? null,
          lang: reportMeta.lang ?? null,
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
        message: notices.feedbackMinChars,
        variant: 'error',
      })
      return
    }
    if (feedbackCooldown > 0) {
      setFeedbackCooldown(0)
    }
    setFeedbackNotice(null)
    const to = 'makemyideawork@aremai.tech'
    const subject = uiLanguage === 'Polish' ? 'Opinia – makemyidea.work' : 'Feedback – makemyidea.work'
    const sessionName =
      enginePreviewSessionName || sessionId || feedbackContext.sessionId || ''
    const body = [
      uiLanguage === 'Polish'
        ? 'Opinia z aplikacji makemyidea.work'
        : 'Feedback from makemyidea.work',
      '',
      uiLanguage === 'Polish' ? 'Sesja:' : 'Session:',
      sessionName || '—',
      '',
      uiLanguage === 'Polish' ? 'Treść opinii:' : 'Feedback message:',
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
  const notices = useMemo(() => {
    const isPl = uiLanguage === 'Polish'
    return {
      createSessionFirst: isPl ? 'Najpierw utwórz sesję.' : 'Create a session first.',
      noActiveSession: isPl ? 'Brak aktywnej sesji.' : 'No active session.',
      sessionNameRequired: isPl ? 'Podaj nazwę sesji.' : 'Please enter a session name.',
      authSessionExpired: isPl
        ? 'Sesja logowania wygasła. Zaloguj się ponownie.'
        : 'Your login session has expired. Please sign in again.',
      sessionNameCheckFailed: (message: string) =>
        isPl
          ? `Nie udało się sprawdzić nazwy sesji. ${message}`
          : `Unable to check the session name. ${message}`,
      sessionIdGenerateFailed: isPl
        ? 'Nie udało się wygenerować ID sesji.'
        : 'Unable to generate a session ID.',
      createSessionFailed: (message: string) =>
        isPl
          ? `Nie udało się utworzyć sesji. ${message}`
          : `Unable to create the session. ${message}`,
      createSessionFailedGeneric: isPl
        ? 'Nie udało się utworzyć sesji. Spróbuj ponownie.'
        : 'Unable to create the session. Please try again.',
      createEngineSessionFailed: isPl
        ? 'Nie udało się utworzyć sesji silnika.'
        : 'Unable to create an engine session.',
      addEntryFailed: isPl ? 'Nie udało się dodać wpisu.' : 'Unable to add the entry.',
      addEntryFailedDetail: (status: string, code: string, message: string | null) =>
        isPl
          ? `Nie udało się dodać wpisu. (status: ${status}, code: ${code})${message ? ` ${message}` : ''}`
          : `Unable to add the entry. (status: ${status}, code: ${code})${message ? ` ${message}` : ''}`,
      noNaEntries: isPl ? 'Brak wpisów N/A.' : 'No N/A entries.',
      aiDisabled: isPl ? 'AI jest wyłączony.' : 'AI is disabled.',
      assignFailed: isPl ? 'Nie udało się przypisać wpisów.' : 'Unable to assign entries.',
      assignRetryFailed: isPl
        ? 'Nie udało się uzupełnić przyporządkowań. Spróbuj ponownie.'
        : 'Unable to complete assignments. Please try again.',
      assignNaAction: isPl ? 'Uzupełnij N/A (AI)' : 'Fill N/A (AI)',
      assignNaLoading: isPl ? 'Uzupełniam…' : 'Filling…',
      noAssignments: isPl ? 'Brak przypisań z AI.' : 'No assignments from AI.',
      naFilled: isPl ? 'Uzupełniono wpisy N/A.' : 'N/A entries filled.',
      topupTestSuccess: (amount: string) =>
        isPl
          ? `Saldo +${amount} dodane do konta (tryb testowy).`
          : `Balance +${amount} added to your account (test mode).`,
      topupTestFailed: isPl
        ? 'Nie udało się doładować konta. Spróbuj ponownie.'
        : 'Unable to top up the account. Please try again.',
      topupUnauthorized: isPl ? 'Zaloguj się, aby doładować konto.' : 'Sign in to top up.',
      topupInvalidTier: isPl ? 'Nieprawidłowy pakiet doładowania.' : 'Invalid top up tier.',
      saveToCloudRequiresAuth: isPl
        ? 'Zaloguj się, aby zapisać w chmurze'
        : 'Sign in to save to the cloud.',
      saveToCloudFailed: (status: string | null | undefined) =>
        isPl
          ? `Nie udało się zapisać (${status ?? 'err'})`
          : `Save failed (${status ?? 'err'})`,
      saveToCloudSuccess: isPl
        ? 'Sesja zapisana w chmurze'
        : 'Session saved to the cloud.',
      supabaseConnectionMissing: isPl
        ? 'Brak połączenia z Supabase.'
        : 'No connection to Supabase.',
      sessionsListFailed: (message: string) =>
        isPl
          ? `Nie udało się pobrać listy sesji. ${message}`
          : `Unable to fetch session list. ${message}`,
      sessionsMetadataFailed: (message: string) =>
        isPl
          ? `Nie udało się pobrać metadanych sesji. ${message}`
          : `Unable to fetch session metadata. ${message}`,
      sessionDeleteFailed: (message: string) =>
        isPl
          ? `Nie udało się usunąć sesji. ${message}`
          : `Unable to delete the session. ${message}`,
      sessionDeleteForbidden: isPl
        ? 'Nie udało się usunąć sesji (brak uprawnień).'
        : 'Unable to delete the session (insufficient permissions).',
      labelSaveFailed: (message: string) =>
        isPl
          ? `Nie udało się zapisać etykiety. ${message}`
          : `Unable to save the label. ${message}`,
      sessionDetailsFailed: (message: string) =>
        isPl
          ? `Nie udało się pobrać szczegółów sesji. ${message}`
          : `Unable to fetch session details. ${message}`,
      saveChangesFailed: (message: string) =>
        isPl
          ? `Nie udało się zapisać zmian. ${message}`
          : `Unable to save changes. ${message}`,
      deleteItemFailed: (message: string) =>
        isPl
          ? `Nie udało się usunąć elementu. ${message}`
          : `Unable to delete the item. ${message}`,
      sessionAccessDenied: isPl
        ? 'Nie masz dostępu do tej sesji (brak powiązania).'
        : 'You do not have access to this session (no link).',
      sessionAccessCheckFailed: (message: string) =>
        isPl
          ? `Nie udało się potwierdzić dostępu. ${message}`
          : `Unable to confirm access. ${message}`,
      openSessionFailed: (status: string | number | null | undefined, code: string | null | undefined) =>
        isPl
          ? `Nie udało się otworzyć sesji: ${status ?? 'n/a'}/${code ?? 'n/a'}.`
          : `Open session failed: ${status ?? 'n/a'}/${code ?? 'n/a'}.`,
      legacySessionMissingMeta: isPl
        ? 'Ta sesja jest w trybie legacy i wymaga naprawy (brak metadanych w chmurze).'
        : 'This session is in legacy mode and needs repair (missing cloud metadata).',
      reportOpenFailed: isPl
        ? 'Nie udało się utworzyć/otworzyć raportu. Sprawdź połączenie lub uprawnienia.'
        : 'Unable to create/open the report. Check your connection or permissions.',
      invalidImportFile: isPl ? 'Nieprawidłowy format pliku.' : 'Invalid file format.',
      exportFailed: (message: string) =>
        isPl
          ? `Nie udało się wyeksportować sesji. ${message}`
          : `Unable to export the session. ${message}`,
      importFailed: (message: string) =>
        isPl
          ? `Nie udało się zaimportować sesji. ${message}`
          : `Unable to import the session. ${message}`,
      sessionNameCollision: isPl
        ? 'Taka nazwa już istnieje — zmień nazwę.'
        : 'That name already exists — please choose another.',
      feedbackMinChars: isPl
        ? 'Wpisz co najmniej 10 znaków.'
        : 'Please enter at least 10 characters.',
      feedbackCooldown: (seconds: number) =>
        isPl
          ? `Możesz wysłać kolejną wiadomość za ${seconds}s.`
          : `You can send another message in ${seconds}s.`,
      authRateLimit: isPl
        ? 'Limit maili przekroczony — odczekaj lub użyj Google/hasła'
        : 'Email limit reached — please wait or use Google/password.',
      sessionNameSaveFailed: isPl
        ? 'Nie udało się utworzyć sesji. Spróbuj ponownie.'
        : 'Unable to create the session. Please try again.',
      editAction: isPl ? 'Edytuj' : 'Edit',
      deleteAction: isPl ? 'Usuń' : 'Delete',
      supabaseConfigTitle: isPl
        ? 'Supabase nie jest poprawnie skonfigurowany.'
        : 'Supabase is not configured correctly.',
      supabaseConfigBody: isPl
        ? 'Sprawdź VITE_SUPABASE_URL oraz VITE_SUPABASE_ANON_KEY w środowisku produkcyjnym Vercel.'
        : 'Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Production env.',
      loading: isPl ? 'Ładowanie...' : 'Loading...',
      redirectingToLogin: isPl
        ? 'Przekierowanie do logowania...'
        : 'Redirecting to login...',
      sessionLabelPrefix: isPl ? 'Sesja' : 'Session',
      honeypotLabel: isPl ? 'Strona' : 'Website',
    }
  }, [uiLanguage])
  const missingSupabaseEnvMessage =
    uiLanguage === 'Polish'
      ? 'Autoryzacja wyłączona w tym środowisku (brak VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'
      : 'Auth disabled in this environment (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'
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
          <span>{notices.honeypotLabel}</span>
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
            {notices.feedbackCooldown(feedbackCooldown)}
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
  const createdAtRaw = item.created_at ?? null
  const updatedAtRaw = (item as { updated_at?: unknown }).updated_at ?? null
  const createdAt =
    typeof createdAtRaw === 'number'
      ? createdAtRaw
      : typeof createdAtRaw === 'string' && !Number.isNaN(Date.parse(createdAtRaw))
        ? Date.parse(createdAtRaw)
        : undefined
  const updatedAt =
    typeof updatedAtRaw === 'number'
      ? updatedAtRaw
      : typeof updatedAtRaw === 'string' && !Number.isNaN(Date.parse(updatedAtRaw))
        ? Date.parse(updatedAtRaw)
        : undefined
  const sortOrderRaw = (item as { sort_order?: unknown }).sort_order ?? null
  const sortOrder =
    typeof sortOrderRaw === 'number'
      ? sortOrderRaw
      : typeof sortOrderRaw === 'string'
        ? Number(sortOrderRaw)
        : undefined
  return {
    ...item,
    label: item.label ?? null,
    matrix_row: matrixRow ?? null,
    matrix_col: matrixCol ?? null,
    sort_order: Number.isFinite(sortOrder ?? NaN) ? sortOrder : item.sort_order ?? null,
    created_at: createdAt ?? item.created_at,
    updated_at: updatedAt ?? item.updated_at,
  }
}

const normalizeBoardItems = (items: EngineBoardItem[]) => {
  const normalized = items.map(normalizeBoardItem)
  return normalized.map((item, index) => ({
    ...item,
    sort_order:
      typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
        ? item.sort_order
        : (index + 1) * ENGINE_SORT_GAP,
  }))
}

const safeLower = (value: unknown) => String(value ?? '').toLowerCase()

const toTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber)) return asNumber
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
    const matches = value.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)
    return matches?.length ?? 0
  }

  const getMeaningfulWords = (value: string) =>
    (value.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? [])
      .map((word) => word.trim().toLocaleLowerCase())
      .filter((word) => word.length > 2)

  const applyEngineInitialBriefTextChange = (next: string, previous = engineInitialBriefText) => {
    const nextWords = countWords(next)
    const isDeletion = next.length < previous.length
    if (nextWords > INITIAL_BRIEF_WORD_LIMIT && !isDeletion) {
      setEngineInitialBriefError(copy.engineInitialBriefTooLong)
      return false
    }
    setEngineInitialBriefText(next)
    if (engineInitialBriefError) setEngineInitialBriefError(null)
    return true
  }

  const appendEngineInitialBriefTranscript = (transcript: string) => {
    const cleanTranscript = cleanFinalSpeechTranscriptSegment(
      transcript,
      toSpeechCleanupLocale(uiLanguage)
    )
    if (!cleanTranscript) return null
    const base = engineInitialBriefTextRef.current
    const separator = base.trim() ? (/\s$/.test(base) ? '' : ' ') : ''
    if (!applyEngineInitialBriefTextChange(`${base}${separator}${cleanTranscript}`, base)) {
      return null
    }
    return cleanTranscript
  }

  const composeEngineInitialBriefVoiceText = (base: string, transcript: string) => {
    const cleanTranscript = transcript.trim()
    if (!cleanTranscript) return base
    const separator = base.trim() ? (/\s$/.test(base) ? '' : ' ') : ''
    return `${base}${separator}${cleanTranscript}`
  }

  const getEngineInitialBriefDisplayedText = () =>
    engineInitialBriefVoiceState === 'listening' && engineInitialBriefVoicePreview
      ? engineInitialBriefVoicePreview
      : engineInitialBriefText

  const syncEngineInitialBriefSubmitText = () => {
    const visibleText = getEngineInitialBriefDisplayedText()
    const draft = engineInitialBriefTranscriptDraftRef.current.trim()
    if (draft) {
      const base = engineInitialBriefVoiceBaseTextRef.current
      const cleanedDraft = cleanFinalSpeechTranscriptSegment(draft, toSpeechCleanupLocale(uiLanguage))
      const committed = cleanedDraft ? composeEngineInitialBriefVoiceText(base, cleanedDraft) : base
      if (!applyEngineInitialBriefTextChange(committed, engineInitialBriefTextRef.current)) {
        return null
      }
      engineInitialBriefTranscriptDraftRef.current = ''
      setEngineInitialBriefVoicePreview('')
      return committed
    }
    if (visibleText !== engineInitialBriefTextRef.current) {
      if (!applyEngineInitialBriefTextChange(visibleText, engineInitialBriefTextRef.current)) {
        return null
      }
    }
    return visibleText
  }

  const stopEngineInitialBriefRecognition = (mode: 'stop' | 'abort' = 'stop') => {
    const recognition = engineInitialBriefRecognitionRef.current
    if (!recognition) return
    engineInitialBriefVoiceAbortRef.current = mode === 'abort'
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    engineInitialBriefRecognitionRef.current = null
    if (mode === 'abort') {
      recognition.abort()
      return
    }
    recognition.stop()
  }

  const flushEngineInitialBriefTranscriptDraft = () => {
    const draft = engineInitialBriefTranscriptDraftRef.current.trim()
    setEngineInitialBriefVoicePreview('')
    if (!draft) return true
    const appendedTranscript = appendEngineInitialBriefTranscript(draft)
    if (appendedTranscript) {
      engineInitialBriefVoiceCommittedTextRef.current = composeEngineInitialBriefVoiceText(
        engineInitialBriefVoiceCommittedTextRef.current,
        appendedTranscript
      )
      engineInitialBriefTranscriptDraftRef.current = ''
      engineInitialBriefInputRef.current?.focus()
    }
    return Boolean(appendedTranscript)
  }

  const toggleEngineInitialBriefVoiceInput = () => {
    const SpeechRecognition = getSpeechRecognitionCtor()
    if (!SpeechRecognition) {
      setEngineInitialBriefVoiceState('unavailable')
      setEngineInitialBriefError(copy.engineInitialBriefVoiceInputUnavailable)
      return
    }
    if (engineInitialBriefRecognitionRef.current || engineInitialBriefVoiceState === 'listening') {
      stopEngineInitialBriefRecognition('abort')
      setEngineInitialBriefVoiceState('idle')
      return
    }
    setEngineInitialBriefError(null)
    engineInitialBriefVoiceAbortRef.current = false
    engineInitialBriefTranscriptDraftRef.current = ''
    engineInitialBriefVoiceCorrectionSeqRef.current += 1
    engineInitialBriefVoiceCommittedTextRef.current = ''
    engineInitialBriefVoiceSessionBaseTextRef.current = engineInitialBriefTextRef.current
    engineInitialBriefVoiceBaseTextRef.current = engineInitialBriefTextRef.current
    setEngineInitialBriefVoicePreview('')
    const recognition = new SpeechRecognition()
    engineInitialBriefRecognitionRef.current = recognition
    recognition.lang = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.onresult = (event) => {
      const results = event.results
      const startIndex = event.resultIndex ?? 0
      let finalTranscript = ''
      let interimTranscript = ''
      for (let index = startIndex; index < results.length; index += 1) {
        const result = results[index]
        const chunk = result[0]?.transcript ?? ''
        if (!chunk.trim()) continue
        if (result?.isFinal) {
          finalTranscript += chunk
        } else {
          interimTranscript += chunk
        }
      }
      const previewTranscript = `${finalTranscript}${interimTranscript}`.trim()
      engineInitialBriefTranscriptDraftRef.current = previewTranscript
      setEngineInitialBriefVoicePreview(
        composeEngineInitialBriefVoiceText(
          engineInitialBriefVoiceBaseTextRef.current,
          previewTranscript
        )
      )
      if (!finalTranscript.trim()) return
      const appendedTranscript = appendEngineInitialBriefTranscript(finalTranscript)
      if (!appendedTranscript) {
        engineInitialBriefTranscriptDraftRef.current = ''
        setEngineInitialBriefVoicePreview('')
        recognition.abort()
        setEngineInitialBriefVoiceState('idle')
        engineInitialBriefRecognitionRef.current = null
        return
      }
      engineInitialBriefVoiceCommittedTextRef.current = composeEngineInitialBriefVoiceText(
        engineInitialBriefVoiceCommittedTextRef.current,
        appendedTranscript
      )
      engineInitialBriefVoiceBaseTextRef.current = engineInitialBriefTextRef.current
      engineInitialBriefTranscriptDraftRef.current = ''
      setEngineInitialBriefVoicePreview('')
      engineInitialBriefInputRef.current?.focus()
    }
    recognition.onerror = (event) => {
      engineInitialBriefRecognitionRef.current = null
      setEngineInitialBriefVoicePreview('')
      if (engineInitialBriefVoiceAbortRef.current || event.error === 'aborted') {
        engineInitialBriefVoiceAbortRef.current = false
        setEngineInitialBriefVoiceState('idle')
        return
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setEngineInitialBriefVoiceState('unavailable')
        setEngineInitialBriefError(copy.engineInitialBriefVoiceInputError)
        return
      }
      if (event.error === 'language-not-supported') {
        setEngineInitialBriefVoiceState('unavailable')
        setEngineInitialBriefError(copy.engineInitialBriefVoiceInputUnavailable)
        return
      }
      setEngineInitialBriefVoiceState('idle')
      if (event.error === 'no-speech') {
        return
      }
      setEngineInitialBriefError(
        copy.engineInitialBriefVoiceInputError
      )
    }
    recognition.onend = () => {
      engineInitialBriefRecognitionRef.current = null
      engineInitialBriefVoiceAbortRef.current = false
      const didFlush = flushEngineInitialBriefTranscriptDraft()
      const spokenText = engineInitialBriefVoiceCommittedTextRef.current.trim()
      if (didFlush && spokenText) {
        queueEngineInitialBriefSpeechCorrection(
          engineInitialBriefVoiceSessionBaseTextRef.current,
          spokenText
        )
      }
      setEngineInitialBriefVoiceState((prev) => (prev === 'unavailable' ? prev : 'idle'))
    }
    try {
      recognition.start()
      setEngineInitialBriefVoiceState('listening')
    } catch {
      engineInitialBriefRecognitionRef.current = null
      setEngineInitialBriefVoiceState('unavailable')
      setEngineInitialBriefError(copy.engineInitialBriefVoiceInputError)
    }
  }

  useEffect(() => {
    engineInitialBriefTextRef.current = engineInitialBriefText
  }, [engineInitialBriefText])

  useEffect(() => {
    if (enginePreviewVoiceState === 'listening') return
    enginePreviewVoiceBaseTextRef.current = enginePreviewInput
  }, [enginePreviewInput, enginePreviewVoiceState])

  useEffect(() => {
    if (engineInitialBriefVoiceState === 'listening') return
    engineInitialBriefVoiceBaseTextRef.current = engineInitialBriefText
  }, [engineInitialBriefText, engineInitialBriefVoiceState])

  useEffect(() => {
    setEngineInitialBriefVoiceState(getSpeechRecognitionCtor() ? 'idle' : 'unavailable')
  }, [])

  useEffect(() => {
    setEnginePreviewVoiceState(getSpeechRecognitionCtor() ? 'idle' : 'unavailable')
  }, [])

  useEffect(() => {
    if (engineInitialBriefOpen) return
    stopEngineInitialBriefRecognition('abort')
    setEngineInitialBriefVoicePreview('')
    setEngineInitialBriefVoiceState(getSpeechRecognitionCtor() ? 'idle' : 'unavailable')
  }, [engineInitialBriefOpen])

  useEffect(() => () => {
    stopEnginePreviewRecognition('abort')
    stopEngineInitialBriefRecognition('abort')
  }, [])

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
          fetch(`${llmApiBase}/api/coach?action=space-options`, {
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
          fetch(`${llmApiBase}/api/coach?action=time-options`, {
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
      const response = await fetch(`${llmApiBase}/api/coach?action=names`, {
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
      const response = await fetch(`${llmApiBase}/api/coach?action=ideas`, {
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
      showEngineNotice(notices.createSessionFirst, 'error')
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
    const endpoint = '/api/coach?action=suggest'
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
      if (normalized.questions.length) {
        setLastLlmWhy(normalized.questions[0]?.why_this_question ?? null)
      } else if (normalized.questionObj) {
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

  const classifyFacilitatedEntryWithinPerspective = async (
    sessionId: string,
    answerText: string,
    perspective: FacilitationPerspective
  ) => {
    const allowedCellIds = perspectiveToAllowedCellIds(perspective)
    if (!allowedCellIds) return null
    const fallbackCellId = allowedCellIds[1]
    const result = await fetchJsonWithDiagnostics('/api/coach?action=suggest', {
      method: 'POST',
      headers: llmHeaders,
      body: JSON.stringify({
        currentUserId: authSession?.user?.id ?? null,
        sessionId,
        action: 'reclassify_entries',
        locale: uiLanguage === 'Polish' ? 'pl' : 'en',
        sessionName: enginePreviewSessionName,
        allowedCellIds,
        entries: [
          {
            id: 'facilitation-answer',
            text: answerText,
            currentCellId: fallbackCellId,
          },
        ],
      }),
    })
    const payload = result.json as
      | {
          ok?: boolean
          classifications?: Array<{
            id?: string
            suggestedCellId?: string
            confidence?: number
            shouldMove?: boolean
          }>
          meta?: LlmUsageMeta
        }
      | null
    if (!result.ok || !payload?.ok || !Array.isArray(payload.classifications)) {
      return null
    }
    applyUsageModel(payload.meta)
    void applyUsageToSession(payload.meta, sessionId)
    const allowedSet = new Set<string>(allowedCellIds)
    const suggestedCellId = String(payload.classifications[0]?.suggestedCellId || '').toUpperCase()
    if (!allowedSet.has(suggestedCellId)) {
      return cellCodeToMatrix(fallbackCellId)
    }
    return cellCodeToMatrix(suggestedCellId)
  }

  const classifyFreeEntryWithSeedMechanism = async (sessionId: string, text: string) => {
    const result = await fetchJsonWithDiagnostics('/api/coach?action=suggest', {
      method: 'POST',
      headers: llmHeaders,
      body: JSON.stringify({
        currentUserId: authSession?.user?.id ?? null,
        sessionId,
        action: 'seed_from_brief',
        text,
        locale: uiLanguage === 'Polish' ? 'pl' : 'en',
      }),
    })
    const payload = result.json as
      | {
          ok?: boolean
          entries?: Array<{
            text?: string
            cellCode?: string | null
          }>
          meta?: LlmUsageMeta
        }
      | null
    if (!result.ok || !payload?.ok || !Array.isArray(payload.entries)) {
      return null
    }
    applyUsageModel(payload.meta)
    void applyUsageToSession(payload.meta, sessionId)
    const normalizedInput = String(text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
    const matchedEntry =
      payload.entries.find((entry) => {
        const candidate = String(entry?.text || '')
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase()
        return candidate === normalizedInput
      }) ??
      payload.entries.find((entry) => Boolean(entry?.cellCode)) ??
      payload.entries[0]
    const cellCode = String(matchedEntry?.cellCode || '')
      .trim()
      .toUpperCase()
    return cellCode ? cellCodeToMatrix(cellCode) : null
  }

  const activateFacilitationPrompt = async (
    type: FacilitationType,
    perspective: FacilitationPerspective,
    retryCount = 0
  ) => {
    if (!engineSessionPersisted || !enginePreviewSessionId) {
      setEngineFacilitationInlineError(notices.createSessionFirst)
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
    setEngineFacilitationInlineError(null)
    setEngineFacilitationLoading(true)
    setEngineFacilitationLoadingType(type)
    setLastFacilitationType(type)
    setLastFacilitationPerspective(perspective)
    setShowEngineFacilitationLoadingUI(false)
    setEngineActivePrompt(null)
    setEnginePromptSource(null)
    if (engineFacilitationLoadingTimerRef.current) {
      window.clearTimeout(engineFacilitationLoadingTimerRef.current)
    }
    engineFacilitationLoadingTimerRef.current = window.setTimeout(() => {
      setShowEngineFacilitationLoadingUI(true)
    }, 1000)
    setEnginePreviewError(null)
    setEngineFacilitationDiagnostics(null)
    const endpoint = '/api/coach?action=suggest'
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
          requestedPerspective: perspective,
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
      const contextualQuestionId = normalized.questions.length
        ? normalized.questions[0]?.id
        : normalized.questionObj?.id
      console.log('[facilitation] contextual_question', {
        question_id: contextualQuestionId ?? null,
        llm_called: normalized.labelType !== 'fallback',
        raw_question_shown: false,
        model_used: data.meta?.modelUsed ?? null,
        items_count: boardEntries.length,
      })
      logFacilitationEvent('facilitation_contextual_question', {
        question_id: contextualQuestionId ?? null,
        llm_called: normalized.labelType !== 'fallback',
        raw_question_shown: false,
        model_used: data.meta?.modelUsed ?? null,
        items_count: boardEntries.length,
      })
      if (normalized.labelType !== 'ai' && !normalized.questionText) {
        setEnginePromptSource(null)
        setEngineActivePrompt(null)
        setEngineUiState('FREE_FLOW')
        setEngineOfferReason(null)
        setEnginePreviewError(copy.engineFacilitationRetryMessage)
        return
      }
      setEnginePromptSource(normalized.labelType === 'fallback' ? 'fallback' : 'llm')
      if (normalized.questions.length) {
        setLastLlmWhy(normalized.questions[0]?.why_this_question ?? null)
      } else if (normalized.questionObj) {
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
          void activateFacilitationPrompt(type, perspective, retryCount + 1)
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
      setEngineActiveFacilitationPerspective(perspective)
      logFacilitationEvent('facilitation_used', {
        sessionId: enginePreviewSessionId || 'unknown',
        action: type,
        perspective,
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

  const applyEnginePreviewInputText = (rawNext: string, previous = enginePreviewInput) => {
    const prev = previous
    const nextWordCount = countWords(rawNext)
    const isDeletion = rawNext.length < prev.length
    if (nextWordCount > WORD_LIMIT && !isDeletion) {
      return false
    }
    const next = limitWords(rawNext, WORD_LIMIT)
    setEnginePreviewInput(next)
    setEnginePreviewVoiceError(null)
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
    return true
  }

  const requestSpeechTranscriptInterpretation = async (rawText: string, sessionId: string | null) => {
    const text = String(rawText || '').trim()
    if (!text) return ''
    const boardContext = getSessionContext(sessionId).boardEntries
      .map((entry) => String(entry.text || '').trim())
      .filter(Boolean)
    const result = await interpretSpeechTranscript({
      text,
      locale: toSpeechCleanupLocale(uiLanguage),
      aiSupportEnabled,
      sessionId,
      boardContext,
    })
    const meta = result.meta as LlmUsageMeta | undefined
    if (meta) {
      applyUsageModel(meta)
      if (sessionId) {
        void applyUsageToSession(meta, sessionId)
      }
    }
    return String(result.text || '').trim() || text
  }

  const queueEngineInitialBriefSpeechCorrection = (baseText: string, spokenText: string) => {
    const normalizedSpokenText = spokenText.trim()
    if (!normalizedSpokenText) return
    const expectedText = composeEngineInitialBriefVoiceText(baseText, normalizedSpokenText)
    const requestSeq = ++engineInitialBriefVoiceCorrectionSeqRef.current
    void requestSpeechTranscriptInterpretation(normalizedSpokenText, enginePreviewSessionId).then(
      (correctedText) => {
        const normalizedCorrectedText = correctedText.trim()
        if (!normalizedCorrectedText || normalizedCorrectedText === normalizedSpokenText) return
        if (engineInitialBriefVoiceCorrectionSeqRef.current !== requestSeq) return
        if (engineInitialBriefTextRef.current !== expectedText) return
        void applyEngineInitialBriefTextChange(
          composeEngineInitialBriefVoiceText(baseText, normalizedCorrectedText),
          engineInitialBriefTextRef.current
        )
      }
    )
  }

  const handleEnginePreviewInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    enginePreviewVoiceCorrectionSeqRef.current += 1
    applyEnginePreviewInputText(event.target.value)
  }

  const activateEngineDraftTarget = (section: EnginePerspectiveKey) => {
    setEngineDraftTargetSection(section)
    setEnginePreviewVoiceError(null)
    markUserInitiatedInteraction('pointer')
    setEngineLastInputActivityAt(Date.now())
    setEngineInputFocused(true)
    setEngineUiState('FREE_FLOW')
    setEngineActivePrompt(null)
    setEngineOfferReason(null)
    window.setTimeout(() => {
      engineInputRef.current?.focus()
    }, 0)
  }

  const clearEngineDraftTarget = () => {
    if (enginePreviewVoiceState === 'listening') {
      stopEnginePreviewRecognition('abort')
      setEnginePreviewVoiceState('idle')
    }
    setEnginePreviewInput('')
    setEngineDraftTargetSection(null)
    setEnginePreviewVoiceError(null)
    enginePreviousInput.current = ''
    enginePreviewVoiceBaseTextRef.current = ''
    enginePreviewVoiceSessionBaseTextRef.current = ''
    enginePreviewVoiceCommittedTextRef.current = ''
    enginePreviewVoiceTranscriptRef.current = ''
  }

  const composeEnginePreviewVoiceText = (base: string, transcript: string) => {
    const cleanTranscript = transcript.trim()
    if (!cleanTranscript) return base
    const separator = base.trim() ? (/\s$/.test(base) ? '' : ' ') : ''
    return `${base}${separator}${cleanTranscript}`
  }

  const queueEnginePreviewSpeechCorrection = (baseText: string, spokenText: string) => {
    const normalizedSpokenText = spokenText.trim()
    if (!normalizedSpokenText) return
    const expectedText = composeEnginePreviewVoiceText(baseText, normalizedSpokenText)
    const requestSeq = ++enginePreviewVoiceCorrectionSeqRef.current
    void requestSpeechTranscriptInterpretation(normalizedSpokenText, enginePreviewSessionId).then(
      (correctedText) => {
        const normalizedCorrectedText = correctedText.trim()
        if (!normalizedCorrectedText || normalizedCorrectedText === normalizedSpokenText) return
        if (enginePreviewVoiceCorrectionSeqRef.current !== requestSeq) return
        if (enginePreviousInput.current !== expectedText) return
        void applyEnginePreviewInputText(
          composeEnginePreviewVoiceText(baseText, normalizedCorrectedText),
          enginePreviousInput.current
        )
      }
    )
  }

  const stopEnginePreviewRecognition = (mode: 'stop' | 'abort' = 'stop') => {
    const recognition = enginePreviewRecognitionRef.current
    if (!recognition) return
    enginePreviewVoiceAbortRef.current = mode === 'abort'
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    enginePreviewRecognitionRef.current = null
    if (mode === 'abort') {
      recognition.abort()
      return
    }
    recognition.stop()
  }

  const syncEnginePreviewVoiceTranscript = () => {
    const rawDraft = enginePreviewVoiceTranscriptRef.current
    const draft = cleanFinalSpeechTranscriptSegment(rawDraft, toSpeechCleanupLocale(uiLanguage))
    if (!draft) {
      if (rawDraft.trim()) {
        void applyEnginePreviewInputText(
          enginePreviewVoiceBaseTextRef.current,
          enginePreviousInput.current || enginePreviewInput
        )
      }
      enginePreviewVoiceTranscriptRef.current = ''
      return enginePreviewVoiceBaseTextRef.current
    }
    const committed = composeEnginePreviewVoiceText(enginePreviewVoiceBaseTextRef.current, draft)
    if (!applyEnginePreviewInputText(committed, enginePreviousInput.current || enginePreviewInput)) {
      return null
    }
    enginePreviewVoiceBaseTextRef.current = committed
    enginePreviewVoiceCommittedTextRef.current = composeEnginePreviewVoiceText(
      enginePreviewVoiceCommittedTextRef.current,
      draft
    )
    enginePreviewVoiceTranscriptRef.current = ''
    return committed
  }

  const toggleEnginePreviewVoiceInput = () => {
    const SpeechRecognition = getSpeechRecognitionCtor()
    if (!SpeechRecognition) {
      setEnginePreviewVoiceState('unavailable')
      setEnginePreviewVoiceError(copy.engineInitialBriefVoiceInputUnavailable)
      return
    }
    if (enginePreviewRecognitionRef.current || enginePreviewVoiceState === 'listening') {
      stopEnginePreviewRecognition('abort')
      setEnginePreviewVoiceState('idle')
      return
    }
    setEnginePreviewVoiceError(null)
    enginePreviewVoiceAbortRef.current = false
    enginePreviewVoiceCorrectionSeqRef.current += 1
    enginePreviewVoiceCommittedTextRef.current = ''
    enginePreviewVoiceTranscriptRef.current = ''
    enginePreviewVoiceSessionBaseTextRef.current = enginePreviewInput
    enginePreviewVoiceBaseTextRef.current = enginePreviewInput
    const recognition = new SpeechRecognition()
    enginePreviewRecognitionRef.current = recognition
    recognition.lang = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.onresult = (event) => {
      const results = event.results
      const startIndex = event.resultIndex ?? 0
      let finalTranscript = ''
      let interimTranscript = ''
      for (let index = startIndex; index < results.length; index += 1) {
        const result = results[index]
        const chunk = result[0]?.transcript ?? ''
        if (!chunk.trim()) continue
        if (result?.isFinal) {
          finalTranscript += chunk
        } else {
          interimTranscript += chunk
        }
      }
      const cleanedFinalTranscript = cleanFinalSpeechTranscriptSegment(
        finalTranscript,
        toSpeechCleanupLocale(uiLanguage)
      )
      if (cleanedFinalTranscript) {
        enginePreviewVoiceBaseTextRef.current = composeEnginePreviewVoiceText(
          enginePreviewVoiceBaseTextRef.current,
          cleanedFinalTranscript
        )
        enginePreviewVoiceCommittedTextRef.current = composeEnginePreviewVoiceText(
          enginePreviewVoiceCommittedTextRef.current,
          cleanedFinalTranscript
        )
      }
      const previewTranscript = interimTranscript.trim()
      enginePreviewVoiceTranscriptRef.current = previewTranscript
      const nextVisible = composeEnginePreviewVoiceText(
        enginePreviewVoiceBaseTextRef.current,
        previewTranscript
      )
      if (!applyEnginePreviewInputText(nextVisible, enginePreviousInput.current || enginePreviewInput)) {
        recognition.abort()
        setEnginePreviewVoiceState('idle')
        enginePreviewRecognitionRef.current = null
        enginePreviewVoiceTranscriptRef.current = ''
        return
      }
      engineInputRef.current?.focus()
    }
    recognition.onerror = (event) => {
      enginePreviewRecognitionRef.current = null
      if (enginePreviewVoiceAbortRef.current || event.error === 'aborted') {
        enginePreviewVoiceAbortRef.current = false
        setEnginePreviewVoiceState('idle')
        return
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setEnginePreviewVoiceState('unavailable')
        setEnginePreviewVoiceError(copy.engineInitialBriefVoiceInputError)
        return
      }
      if (event.error === 'language-not-supported') {
        setEnginePreviewVoiceState('unavailable')
        setEnginePreviewVoiceError(copy.engineInitialBriefVoiceInputUnavailable)
        return
      }
      setEnginePreviewVoiceState('idle')
      if (event.error === 'no-speech') return
      setEnginePreviewVoiceError(copy.engineInitialBriefVoiceInputError)
    }
    recognition.onend = () => {
      enginePreviewRecognitionRef.current = null
      enginePreviewVoiceAbortRef.current = false
      const syncedText = syncEnginePreviewVoiceTranscript()
      const spokenText = enginePreviewVoiceCommittedTextRef.current.trim()
      if (syncedText && spokenText) {
        queueEnginePreviewSpeechCorrection(enginePreviewVoiceSessionBaseTextRef.current, spokenText)
      }
      setEnginePreviewVoiceState((prev) => (prev === 'unavailable' ? prev : 'idle'))
    }
    try {
      recognition.start()
      setEnginePreviewVoiceState('listening')
    } catch {
      enginePreviewRecognitionRef.current = null
      setEnginePreviewVoiceState('unavailable')
      setEnginePreviewVoiceError(copy.engineInitialBriefVoiceInputError)
    }
  }

  const ensureEnginePreviewSession = async (
    nameOverride?: string,
    options?: { onNameCollision?: () => void; onInsertError?: () => void }
  ) => {
    if (enginePreviewSessionId) return enginePreviewSessionId
    const name = (nameOverride ?? enginePreviewSessionName)?.trim()
    if (!name) {
      showEngineNotice(notices.sessionNameRequired, 'error')
      return null
    }
    try {
      if (authSession?.user?.id && client) {
        const response = await apiFetch('/api/session?action=create', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          const errorCode = String(payload?.error || '')
          console.error('[createSession] backend create failed', {
            status: response.status,
            error: errorCode || null,
          })
          if (response.status === 401 || errorCode === 'AUTH_REQUIRED') {
            showEngineNotice(notices.authSessionExpired, 'error')
            return null
          }
          if (response.status === 402 || errorCode === 'INSUFFICIENT_BALANCE') {
            triggerInsufficientBalance()
            return null
          }
          if (response.status === 409 || errorCode === 'SESSION_NAME_COLLISION') {
            options?.onNameCollision?.()
            return null
          }
          options?.onInsertError?.()
          showEngineNotice(notices.createSessionFailed(errorCode || 'Request failed'), 'error')
          return null
        }
        clearInsufficientBalance()
        const balanceAfter = Number(payload?.balance_after_minor ?? payload?.billing?.balanceAfterMinor ?? NaN)
        if (Number.isFinite(balanceAfter)) {
          setBillingBalanceOverrideMinor(balanceAfter)
        } else {
          void refreshBillingBalance()
        }
        const sessionId = String(payload?.session?.id || '').trim()
        if (!sessionId) {
          options?.onInsertError?.()
          return null
        }
        const sessionDetail = await createSession({
          id: sessionId,
          name: String(payload?.session?.name || name),
        })
        const createdSession = sessionDetail.session
        if (createdSession?.id) {
          setReportRecords((prev) => ({ ...prev, [createdSession.id]: null }))
          setEnginePreviewSessionId(createdSession.id)
          setEnginePreviewSessionName(createdSession.name ?? '')
          setEngineSessionPersisted(true)
          setEnginePreviewItems([])
          setEngineBoardItemsLoadedBySession((prev) => ({
            ...prev,
            [createdSession.id]: true,
          }))
          setEngineSessionEmptyOnLoadById((prev) => ({
            ...prev,
            [createdSession.id]: true,
          }))
          setEngineSessionDetail(sessionDetail)
          setEngineSessions(await listSessions())
          setFeedbackReminder(null)
          return createdSession.id
        }
        return null
      }
      const sessionDetail = await createSession({
        name,
      })
      const createdSession = sessionDetail.session
      if (createdSession?.id) {
        setReportRecords((prev) => ({ ...prev, [createdSession.id]: null }))
        setEnginePreviewSessionId(createdSession.id)
        setEnginePreviewSessionName(createdSession.name ?? '')
        setEngineSessionPersisted(false)
        setEnginePreviewItems([])
        setEngineBoardItemsLoadedBySession((prev) => ({
          ...prev,
          [createdSession.id]: true,
        }))
        setEngineSessionEmptyOnLoadById((prev) => ({
          ...prev,
          [createdSession.id]: true,
        }))
        setEngineSessionDetail(sessionDetail)
        setEngineSessions(await listSessions())
        setFeedbackReminder(null)
        return createdSession.id
      }
    } catch {
      setEnginePreviewError(notices.createEngineSessionFailed)
      logSessionStore('engine_preview_create_failed', {})
    }
    return null
  }

  const handleEnginePreviewAdd = async (
    nameOverride?: string,
    textOverride?: string,
    targetSectionOverride?: EnginePerspectiveKey | null
  ) => {
    if (engineAddEntryLoading) return
    enginePreviewVoiceCorrectionSeqRef.current += 1
    const text = (textOverride ?? enginePreviewInput).trim()
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
    const nextSortOrder =
      enginePreviewItems.reduce((max, item) => {
        const current =
          typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
            ? item.sort_order
            : 0
        return Math.max(max, current)
      }, 0) + ENGINE_SORT_GAP
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
    setEngineAddEntryLoading(true)
    try {
      if (!client) {
        showEngineNotice(notices.authSessionExpired, 'error')
        return
      }
      const { data: sessionData } = await client.auth.getSession()
      const accessToken = sessionData.session?.access_token || ''
      const authedUserId = sessionData.session?.user?.id ?? null
      console.log('[board_items] authed user', {
        authedUserId,
        hasAuthSession: Boolean(authSession?.user),
      })
      if (!accessToken || !authedUserId) {
        showEngineNotice(notices.authSessionExpired, 'error')
        return
      }
      const itemId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const facilitationPerspective =
        entryType === 'facilitated_input'
          ? engineActiveFacilitationPerspective ??
            lastFacilitationPerspective ??
            modeToFacilitationPerspective(engineLastQuestionMeta?.mode_code ?? null)
          : null
      const facilitationModeCode =
        facilitationPerspective
          ? FACILITATION_PERSPECTIVE_MODE[facilitationPerspective]
          : engineLastQuestionMeta?.mode_code ?? null
      const classifiedFacilitationCell =
        entryType === 'facilitated_input' && facilitationPerspective
          ? await classifyFacilitatedEntryWithinPerspective(sessionId, text, facilitationPerspective)
          : null
      const classifiedTargetedFreeInputCell =
        entryType === 'free_input' && targetSectionOverride
          ? await classifyFacilitatedEntryWithinPerspective(sessionId, text, targetSectionOverride)
          : null
      const classifiedGenericFreeInputCell =
        entryType === 'free_input' && !targetSectionOverride
          ? await classifyFreeEntryWithSeedMechanism(sessionId, text)
          : null
      // Source of truth for report cell mapping: EngineBoardItem.matrix_row/matrix_col.
      // For facilitation answers, the active perspective locks the column and LLM picks only the row.
      const mappedRow =
        entryType === 'facilitated_input'
          ? classifiedFacilitationCell?.matrix_row ?? toMatrixRowKey('B')
          : classifiedTargetedFreeInputCell?.matrix_row ??
            classifiedGenericFreeInputCell?.matrix_row ??
            null
      const forcedRow = useColumnFirstSeedMode ? toMatrixRowKey('B') : null
      const finalMappedRow = forcedRow ?? mappedRow
      const mappedCol =
        entryType === 'facilitated_input'
          ? classifiedFacilitationCell?.matrix_col ?? toMatrixColKey(facilitationModeCode)
          : classifiedTargetedFreeInputCell?.matrix_col ??
            classifiedGenericFreeInputCell?.matrix_col ??
            targetSectionOverride ??
            null
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
        updated_at: now,
        entry_type: entryType,
        prompt_type: engineActivePrompt?.type || null,
        matrix_row: finalMappedRow,
        matrix_col: mappedCol,
        sort_order: nextSortOrder,
        lastClassifiedText: finalMappedRow && mappedCol ? text : null,
        classificationDirty: finalMappedRow && mappedCol ? false : true,
      }
      let persistedItem = newItem
      const payload = {
        sessionId,
        text: text.trim(),
        label: null,
        matrixRow: finalMappedRow ?? null,
        matrixCol: mappedCol ?? null,
        sortOrder: nextSortOrder,
        questionId: newItem.question_id ?? null,
        questionTextPl: isPolish ? questionText : null,
        questionTextEn: !isPolish ? questionText : null,
        entryType,
        promptType: engineActivePrompt?.type || null,
        createdAt: now,
      }
      const response = await fetch('/api/board-items?action=upsert', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const apiPayload = await response.json().catch(() => null)
      if (!response.ok || !apiPayload?.ok) {
        const statusLabel = response.status || 'n/a'
        const codeLabel = apiPayload?.error || 'n/a'
        const message = String(apiPayload?.message || '').slice(0, 120)
        if (codeLabel === 'INSUFFICIENT_BALANCE') {
          triggerInsufficientBalance()
          if (showDiagnostics) {
            showEngineNotice(
              notices.addEntryFailedDetail(String(statusLabel), String(codeLabel), message || null),
              'error'
            )
          }
          return
        }
        showEngineNotice(
          notices.addEntryFailedDetail(String(statusLabel), String(codeLabel), message || null),
          'error'
        )
        return
      }
      clearInsufficientBalance()
      const insertedRow = apiPayload.item as Database['public']['Tables']['board_items']['Row']
      console.log('[board_items] inserted', {
        id: insertedRow.id,
        sessionId,
        hasQuestion: Boolean(insertedRow.question_text_pl || insertedRow.question_text_en),
        questionId: insertedRow.question_id ?? null,
      })
      const balanceAfter = Number(apiPayload?.balance_after_minor ?? NaN)
      if (Number.isFinite(balanceAfter)) {
        setBillingBalanceOverrideMinor(balanceAfter)
      }
      const insertedCreatedAt =
        typeof insertedRow.created_at === 'number'
          ? insertedRow.created_at
          : Number.isNaN(Date.parse(String(insertedRow.created_at)))
            ? (newItem.created_at ?? now)
            : Date.parse(String(insertedRow.created_at))
      const insertedUpdatedAt =
        typeof insertedRow.updated_at === 'number'
          ? insertedRow.updated_at
          : Number.isNaN(Date.parse(String(insertedRow.updated_at)))
            ? insertedCreatedAt ?? now
            : Date.parse(String(insertedRow.updated_at))
      persistedItem = normalizeBoardItem({
        ...newItem,
        id: insertedRow.id,
        text: insertedRow.text ?? newItem.text,
        label: insertedRow.label ?? null,
        question_id: insertedRow.question_id ?? null,
        question_text_pl: insertedRow.question_text_pl ?? null,
        question_text_en: insertedRow.question_text_en ?? null,
        created_at: insertedCreatedAt,
        updated_at: insertedUpdatedAt,
        entry_type: (insertedRow.entry_type as EngineBoardItem['entry_type']) ?? newItem.entry_type ?? undefined,
        prompt_type: (insertedRow.prompt_type as EngineBoardItem['prompt_type']) ?? newItem.prompt_type ?? null,
        matrix_row: insertedRow.matrix_row ?? newItem.matrix_row ?? null,
        matrix_col: insertedRow.matrix_col ?? newItem.matrix_col ?? null,
        sort_order: insertedRow.sort_order ?? newItem.sort_order ?? null,
        lastClassifiedText: insertedRow.last_classified_text ?? newItem.lastClassifiedText ?? null,
        classificationDirty:
          insertedRow.classification_dirty ?? newItem.classificationDirty ?? null,
      })
      setEnginePreviewItems((prev) => [persistedItem, ...prev])
      setEnginePreviewInput('')
      setEngineDraftTargetSection(null)
      setEnginePreviewVoiceError(null)
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
      enginePreviewVoiceBaseTextRef.current = ''
      enginePreviewVoiceSessionBaseTextRef.current = ''
      enginePreviewVoiceCommittedTextRef.current = ''
      enginePreviewVoiceTranscriptRef.current = ''
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
      setEnginePreviewError(notices.addEntryFailed)
      logSessionStore('engine_preview_add_failed', { sessionId })
    } finally {
      setEngineAddEntryLoading(false)
    }
  }

  const persistInitialBriefToUserSessionPayload = async (
    userId: string,
    sessionId: string,
    rawText: string
  ) => {
    if (!client) return
    const { data: current, error: readError } = await client
      .from('user_sessions')
      .select('payload')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (readError) return
    const previousPayload =
      current?.payload && typeof current.payload === 'object' && !Array.isArray(current.payload)
        ? (current.payload as Record<string, unknown>)
        : {}
    const nextPayload = {
      ...previousPayload,
      initialBriefRaw: rawText,
      initialBriefLocale: uiLanguage === 'Polish' ? 'pl' : 'en',
      initialBriefParsedAt: new Date().toISOString(),
    }
    await client
      .from('user_sessions')
      .update({ payload: nextPayload, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('session_id', sessionId)
  }

  const submitEngineInitialBrief = async () => {
    if (engineInitialBriefSubmitting) return
    const sessionId = enginePreviewSessionId
    if (!sessionId) return
    engineInitialBriefVoiceCorrectionSeqRef.current += 1
    const syncedText = syncEngineInitialBriefSubmitText()
    if (syncedText === null) return
    if (engineInitialBriefVoiceState === 'listening') {
      stopEngineInitialBriefRecognition('stop')
      setEngineInitialBriefVoiceState('idle')
    }
    const text = syncedText.trim()
    const words = countWords(text)
    if (!text) {
      setEngineInitialBriefError(copy.engineInitialBriefEmpty)
      return
    }
    if (words > INITIAL_BRIEF_WORD_LIMIT) {
      setEngineInitialBriefError(copy.engineInitialBriefTooLong)
      return
    }
    const meaningfulWords = getMeaningfulWords(text)
    const distinctMeaningfulWords = new Set(meaningfulWords).size
    if (
      meaningfulWords.length < INITIAL_BRIEF_MIN_MEANINGFUL_WORDS ||
      distinctMeaningfulWords < INITIAL_BRIEF_MIN_DISTINCT_MEANINGFUL_WORDS
    ) {
      setEngineInitialBriefError(null)
      return
    }
    if (!client || !authSession?.user?.id) {
      setEngineInitialBriefError(notices.authSessionExpired)
      return
    }
    setEngineInitialBriefSubmitting(true)
    setEngineInitialBriefError(null)
    const locale = uiLanguage === 'Polish' ? 'pl' : 'en'
    try {
      const { data: sessionData } = await client.auth.getSession()
      const accessToken = sessionData.session?.access_token || ''
      const userId = sessionData.session?.user?.id || authSession.user.id
      if (!accessToken || !userId) {
        setEngineInitialBriefError(notices.authSessionExpired)
        setEngineInitialBriefSubmitting(false)
        return
      }

      const requestPayload = {
        currentUserId: userId,
        sessionId,
        action: 'seed_from_brief',
        text,
        locale,
      }
      const response = await fetch('/api/coach?action=suggest', {
        method: 'POST',
        headers: llmHeaders,
        body: JSON.stringify(requestPayload),
      })
      const payload = await response.json().catch(() => null)
      const entries = Array.isArray(payload?.entries) ? payload.entries : []
      if (!response.ok || !payload?.ok) {
        setEngineInitialBriefError(copy.engineInitialBriefSuggestFailed)
        setEngineInitialBriefSubmitting(false)
        return
      }
      applyUsageModel(payload?.meta as LlmUsageMeta)
      void applyUsageToSession(payload?.meta as LlmUsageMeta, sessionId)
      const inserted: EngineBoardItem[] = []
      let firstUpsertErrorMessage: string | null = null
      let firstUpsertErrorStatus: number | null = null
      let upsertSuccessCount = 0
      let upsertFailureCount = 0
      let nextSortOrderBase =
        enginePreviewItems.reduce((max, item) => {
          const current =
            typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
              ? item.sort_order
              : 0
          return Math.max(max, current)
        }, 0) + ENGINE_SORT_GAP
      let fetchBoardItemsFailedMessage: string | null = null
      let firstNormalizedEntry: {
        text: string
        matrixRow: string | null
        matrixCol: string | null
      } | null = null
      const shouldChargeSessionCreateWithFirstEntry =
        Boolean(authSession?.user?.id && client) && enginePreviewItems.length === 0
      for (const entry of entries) {
        const entryText = String(entry?.text || '').trim()
        const mapped = entry?.cellCode ? cellCodeToMatrix(String(entry.cellCode)) : null
        const forcedSeedRow = useColumnFirstSeedMode ? toMatrixRowKey('B') : null
        if (!entryText) continue
        if (!firstNormalizedEntry) {
          firstNormalizedEntry = {
            text: entryText.slice(0, 160),
            matrixRow: forcedSeedRow ?? mapped?.matrix_row ?? null,
            matrixCol: mapped?.matrix_col ?? null,
          }
        }
        const upsertResponse = await fetch('/api/board-items?action=upsert', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
            text: entryText,
            label: null,
            matrixRow: forcedSeedRow ?? mapped?.matrix_row ?? null,
            matrixCol: mapped?.matrix_col ?? null,
            sortOrder: nextSortOrderBase,
            entryType: 'free_input',
            promptType: null,
            chargeSessionCreate: shouldChargeSessionCreateWithFirstEntry && inserted.length === 0,
          }),
        })
        const upsertPayload = await upsertResponse.json().catch(() => null)
        if (!upsertResponse.ok || !upsertPayload?.ok || !upsertPayload?.item) {
          upsertFailureCount += 1
          if (!firstUpsertErrorMessage) {
            const code = String(upsertPayload?.error || '').trim()
            firstUpsertErrorMessage = code || `HTTP_${upsertResponse.status || 'n/a'}`
            firstUpsertErrorStatus = upsertResponse.status || null
          }
          if (upsertResponse.status === 402 || upsertPayload?.error === 'INSUFFICIENT_BALANCE') {
            triggerInsufficientBalance()
            break
          }
          continue
        }
        const balanceAfter = Number(upsertPayload?.balance_after_minor ?? NaN)
        if (Number.isFinite(balanceAfter)) {
          setBillingBalanceOverrideMinor(balanceAfter)
        }
        upsertSuccessCount += 1
        const insertedRow = upsertPayload.item as Database['public']['Tables']['board_items']['Row']
        const insertedCreatedAt =
          typeof insertedRow.created_at === 'number'
            ? insertedRow.created_at
            : Number.isNaN(Date.parse(String(insertedRow.created_at)))
              ? Date.now()
              : Date.parse(String(insertedRow.created_at))
        const insertedUpdatedAt =
          typeof insertedRow.updated_at === 'number'
            ? insertedRow.updated_at
            : Number.isNaN(Date.parse(String(insertedRow.updated_at)))
              ? insertedCreatedAt
              : Date.parse(String(insertedRow.updated_at))
        inserted.push(
          normalizeBoardItem({
            id: insertedRow.id,
            type: (insertedRow.type as EngineBoardItem['type']) ?? 'idea',
            text: insertedRow.text ?? entryText,
            label: insertedRow.label ?? null,
            question_id: insertedRow.question_id ?? null,
            question_text_pl: insertedRow.question_text_pl ?? null,
            question_text_en: insertedRow.question_text_en ?? null,
            created_at: insertedCreatedAt,
            updated_at: insertedUpdatedAt,
            entry_type: (insertedRow.entry_type as EngineBoardItem['entry_type']) ?? 'free_input',
            prompt_type: (insertedRow.prompt_type as EngineBoardItem['prompt_type']) ?? null,
            matrix_row: insertedRow.matrix_row ?? null,
            matrix_col: insertedRow.matrix_col ?? null,
            sort_order: insertedRow.sort_order ?? nextSortOrderBase,
            lastClassifiedText: insertedRow.last_classified_text ?? null,
            classificationDirty: insertedRow.classification_dirty ?? null,
          })
        )
        nextSortOrderBase += ENGINE_SORT_GAP
      }
      let sourceItems = inserted
      if (authSession?.user?.id && client) {
        try {
          sourceItems = await fetchBoardItems(sessionId, userId)
        } catch (error) {
          fetchBoardItemsFailedMessage =
            error instanceof Error ? error.message : String(error)
          sourceItems = inserted
        }
      }
      if (sourceItems.length === 0 && inserted.length > 0) {
        sourceItems = inserted
      }
      const normalizedItems = normalizeBoardItems(sourceItems)
      const detail = await getSession(sessionId)
      const now = Date.now()
      const nextDetail: EngineSessionDetail = {
        session: detail?.session || {
          id: sessionId,
          name: enginePreviewSessionName || null,
          created_at: now,
          updated_at: now,
          last_group_code: null,
          last_mode_code: null,
          last_category_code: null,
          stuck_counter: 0,
          tokensInTotal: 0,
          tokensOutTotal: 0,
        },
        boardItems: normalizedItems,
        askedQuestionIds: detail?.askedQuestionIds || [],
        report: detail?.report || null,
      }
      await updateSession(nextDetail)
      await persistInitialBriefToUserSessionPayload(userId, sessionId, text)
      if (upsertFailureCount > 0 && upsertSuccessCount > 0) {
        const partialSaveMessage = `${copy.engineInitialBriefPartialSaveFailed(
          upsertSuccessCount,
          upsertFailureCount
        )}${firstUpsertErrorMessage ? ` (${firstUpsertErrorMessage})` : ''}`
        showEngineNotice(partialSaveMessage, 'error')
      } else if (normalizedItems.length === 0) {
        console.warn('[initialBrief] no items after save', {
          sessionId,
          upsertSuccessCount,
          upsertFailureCount,
          firstUpsertErrorStatus,
          firstUpsertErrorMessage,
          fetchBoardItemsFailedMessage,
        })
        const saveFailedMessage = firstUpsertErrorMessage
          ? `${copy.engineInitialBriefSaveFailed} (${firstUpsertErrorMessage})`
          : fetchBoardItemsFailedMessage
            ? `${copy.engineInitialBriefSaveFailed} (${fetchBoardItemsFailedMessage})`
            : copy.engineInitialBriefSaveFailed
        showEngineNotice(saveFailedMessage, 'error')
      }
      await openEngineSession(sessionId)
      // Keep the "Creating entries…" screen visible until the readiness LLM finishes its first pass,
      // to avoid layout "jumping" while the section hydrates.
      await waitForActionPlanReadinessLlmSettled(10_000)
      setEngineInitialBriefOpen(false)
      setEngineInitialBriefText('')
      setEngineInitialBriefVoicePreview('')
      setEngineInitialBriefError(null)
      setEngineUiState('FREE_FLOW')
      setEngineInputFocused(true)
      engineInputRef.current?.focus()
    } catch (error) {
      setEngineInitialBriefError(copy.engineInitialBriefFailed)
    } finally {
      setEngineInitialBriefSubmitting(false)
    }
  }


  const resetEnginePreview = () => {
    engineResetOnSessionChange.current = true
    engineInteractionBySession.current = {}
    engineIdleArmedRef.current = false
    setEnginePreviewSessionId(null)
    setEngineSessionPersisted(false)
    setEnginePreviewItems([])
    setEngineBoardItemsLoadedBySession({})
    setEngineSessionEmptyOnLoadById({})
    setEnginePreviewError(null)
    setEngineSessionDetail(null)
    setEngineSessionsError(null)
    setEngineUiState('INIT')
    setEngineNamePromptOpen(false)
    setEngineNameDraft('')
    setEngineInitialBriefOpen(false)
    setEngineInitialBriefText('')
    setEngineInitialBriefError(null)
    setEngineInitialBriefSubmitting(false)
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

  const orderedEnginePreviewItems = useMemo(() => {
    return [...enginePreviewItems]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aOrder =
          typeof a.item.sort_order === 'number' && Number.isFinite(a.item.sort_order)
            ? a.item.sort_order
            : (a.index + 1) * ENGINE_SORT_GAP
        const bOrder =
          typeof b.item.sort_order === 'number' && Number.isFinite(b.item.sort_order)
            ? b.item.sort_order
            : (b.index + 1) * ENGINE_SORT_GAP
        return aOrder - bOrder || a.index - b.index
      })
      .map(({ item }) => item)
  }, [enginePreviewItems])

  const resolveEngineEntryLayoutClass = (item: EngineBoardItem) => {
    const wordCount = countWords(item.text)
    const textLength = String(item.text || '').trim().length
    if (wordCount > 45 || textLength > 280) return 'is-hero'
    if (wordCount > 30 || textLength > 180) return 'is-wide'
    return 'is-medium'
  }

  const normalizeRecommendations = (value: unknown): ReportRecommendations | null => {
    if (!value || typeof value !== 'object') return null
    const current = value as Record<string, unknown>
    const based_on_user_ideas = Array.isArray(current.based_on_user_ideas) ? current.based_on_user_ideas : null
    const morphological = Array.isArray(current.morphological) ? current.morphological : null
    const market_trends = Array.isArray(current.market_trends) ? current.market_trends : null
    if (!based_on_user_ideas || !morphological || !market_trends) return null
    return {
      based_on_user_ideas: based_on_user_ideas as ReportRecommendations['based_on_user_ideas'],
      morphological: morphological as ReportRecommendations['morphological'],
      market_trends: market_trends as ReportRecommendations['market_trends'],
    }
  }

  const enginePerspectiveSections = useMemo(() => {
    const sections = [
      { key: 'as_is', title: copy.axisPast, toneClass: 'is-as-is' },
      { key: 'not_working', title: copy.axisNow, toneClass: 'is-not-working' },
      { key: 'should_be', title: copy.axisFuture, toneClass: 'is-should-be' },
    ] as const
    const grouped: Record<'as_is' | 'not_working' | 'should_be', EngineBoardItem[]> = {
      as_is: [],
      not_working: [],
      should_be: [],
    }
    orderedEnginePreviewItems.forEach((item) => {
      const key =
        item.matrix_col === 'as_is' || item.matrix_col === 'not_working' || item.matrix_col === 'should_be'
          ? item.matrix_col
          : 'not_working'
      grouped[key].push(item)
    })
    return sections.map((section) => ({
      ...section,
      items: grouped[section.key].map((item) => ({
        item,
        layoutClass: resolveEngineEntryLayoutClass(item),
      })),
    }))
  }, [copy.axisFuture, copy.axisNow, copy.axisPast, orderedEnginePreviewItems])

  const getSortOrderForPlacement = (
    items: EngineBoardItem[],
    movingItemId: string,
    targetSection: EnginePerspectiveKey,
    targetIndex: number
  ) => {
    const sectionItems = items
      .filter((item) => item.id !== movingItemId)
      .filter((item) => {
        const key =
          item.matrix_col === 'as_is' || item.matrix_col === 'not_working' || item.matrix_col === 'should_be'
            ? item.matrix_col
            : 'not_working'
        return key === targetSection
      })
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    const boundedIndex = Math.max(0, Math.min(targetIndex, sectionItems.length))
    const previous = sectionItems[boundedIndex - 1] ?? null
    const next = sectionItems[boundedIndex] ?? null
    const previousOrder =
      typeof previous?.sort_order === 'number' && Number.isFinite(previous.sort_order)
        ? previous.sort_order
        : null
    const nextOrder =
      typeof next?.sort_order === 'number' && Number.isFinite(next.sort_order)
        ? next.sort_order
        : null

    if (previousOrder === null && nextOrder === null) return ENGINE_SORT_GAP
    if (previousOrder === null && nextOrder !== null) return nextOrder - ENGINE_SORT_GAP
    if (previousOrder !== null && nextOrder === null) return previousOrder + ENGINE_SORT_GAP
    if (previousOrder !== null && nextOrder !== null) {
      const midpoint = previousOrder + (nextOrder - previousOrder) / 2
      if (Number.isFinite(midpoint) && Math.abs(nextOrder - previousOrder) > 0.0001) {
        return midpoint
      }
    }

    return (previousOrder ?? ENGINE_SORT_GAP) + ENGINE_SORT_GAP / 2
  }

  const moveEngineEntryToSection = async (
    itemId: string,
    targetSection: EnginePerspectiveKey,
    targetIndex: number
  ) => {
    const sessionId = enginePreviewSessionId || engineSessionDetail?.session?.id
    if (!sessionId) {
      showEngineNotice(notices.createSessionFirst, 'error')
      return
    }

    const currentItem = enginePreviewItems.find((item) => item.id === itemId) ?? null
    if (!currentItem?.matrix_row) return
    const currentSection =
      currentItem.matrix_col && ENGINE_PERSPECTIVE_KEYS.includes(currentItem.matrix_col as EnginePerspectiveKey)
        ? (currentItem.matrix_col as EnginePerspectiveKey)
        : 'not_working'
    const previousItems = enginePreviewItems
    const previousDetailBoardItems = engineSessionDetail?.boardItems ?? null
    const currentSectionItems = previousItems.filter((item) => {
      const key =
        item.matrix_col === 'as_is' || item.matrix_col === 'not_working' || item.matrix_col === 'should_be'
          ? item.matrix_col
          : 'not_working'
      return key === currentSection
    })
    const currentIndex = currentSectionItems.findIndex((item) => item.id === itemId)
    const effectiveTargetIndex =
      currentSection === targetSection && currentIndex >= 0 && targetIndex > currentIndex
        ? targetIndex - 1
        : targetIndex
    const nextSortOrder = getSortOrderForPlacement(
      previousItems,
      itemId,
      targetSection,
      effectiveTargetIndex
    )
    if (
      currentSection === targetSection &&
      typeof currentItem.sort_order === 'number' &&
      Math.abs(currentItem.sort_order - nextSortOrder) < 0.0001
    ) {
      return
    }
    const nextMatrixCol = targetSection

    setEngineSessionsError(null)
    setEngineMovingEntryId(itemId)
    setEnginePreviewItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              matrix_col: nextMatrixCol,
              sort_order: nextSortOrder,
              updated_at: Date.now(),
            }
          : item
      )
    )
    if (engineSessionDetail?.session) {
      setEngineSessionDetail((prev) =>
        prev
          ? {
              ...prev,
              boardItems: prev.boardItems.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      matrix_col: nextMatrixCol,
                      sort_order: nextSortOrder,
                      updated_at: Date.now(),
                    }
                  : item
              ),
            }
          : prev
      )
    }

    try {
      if (authSession?.user?.id && client) {
        await updateBoardItemMatrix(
          sessionId,
          itemId,
          currentItem.matrix_row ?? null,
          nextMatrixCol,
          nextSortOrder
        )
      }
      const detail = await getSession(sessionId)
      if (detail?.session) {
        const updatedDetail: EngineSessionDetail = {
          ...detail,
          boardItems: detail.boardItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  matrix_row: currentItem.matrix_row ?? null,
                  matrix_col: nextMatrixCol,
                  sort_order: nextSortOrder,
                }
              : item
          ),
          session: { ...detail.session, updated_at: Date.now() },
        }
        await updateSession(updatedDetail)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEnginePreviewItems(previousItems)
      if (previousDetailBoardItems && engineSessionDetail?.session) {
        setEngineSessionDetail((prev) =>
          prev
            ? {
                ...prev,
                boardItems: previousDetailBoardItems,
              }
            : prev
        )
      }
      setEngineSessionsError(notices.saveChangesFailed(message))
      showEngineNotice(notices.saveChangesFailed(message), 'error')
    } finally {
      setEngineMovingEntryId(null)
    }
  }

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    if (isPhoneViewport) {
      setEngineEntryRowSpans({})
      return
    }

    const calculateRowSpan = (id: string, node: HTMLLIElement) => {
      const list = node.closest('.engine-entry-list')
      if (!(list instanceof HTMLElement)) return
      if (node.offsetWidth === 0 || list.offsetWidth === 0) return
      const styles = window.getComputedStyle(list)
      const rowHeight = parseFloat(styles.gridAutoRows || '') || 4
      const rowGap =
        parseFloat(styles.rowGap || '') || parseFloat(styles.getPropertyValue('grid-row-gap')) || 12
      const content = node.querySelector('.engine-entry-main')
      const contentHeight =
        content instanceof HTMLElement ? content.scrollHeight : node.scrollHeight
      const nodeStyles = window.getComputedStyle(node)
      const verticalPadding =
        (parseFloat(nodeStyles.paddingTop || '') || 0) +
        (parseFloat(nodeStyles.paddingBottom || '') || 0)
      const borderWidth =
        (parseFloat(nodeStyles.borderTopWidth || '') || 0) +
        (parseFloat(nodeStyles.borderBottomWidth || '') || 0)
      const measuredHeight = contentHeight + verticalPadding + borderWidth
      const span = Math.max(1, Math.ceil((measuredHeight + rowGap) / (rowHeight + rowGap)))
      setEngineEntryRowSpans((prev) => (prev[id] === span ? prev : { ...prev, [id]: span }))
    }

    const nodes = Object.entries(engineEntryNodesRef.current).filter(
      (entry): entry is [string, HTMLLIElement] => entry[1] instanceof HTMLLIElement
    )
    if (!nodes.length) return

    nodes.forEach(([id, node]) => calculateRowSpan(id, node))

    const frame = window.requestAnimationFrame(() => {
      nodes.forEach(([id, node]) => calculateRowSpan(id, node))
    })
    const settleFrame = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        nodes.forEach(([id, node]) => calculateRowSpan(id, node))
      })
    }, 80)
    const lateSettleFrame = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        nodes.forEach(([id, node]) => calculateRowSpan(id, node))
      })
    }, 280)

    let cancelled = false
    if (typeof document !== 'undefined' && 'fonts' in document && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (cancelled) return
        window.requestAnimationFrame(() => {
          nodes.forEach(([id, node]) => calculateRowSpan(id, node))
        })
      })
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            entries.forEach((entry) => {
              const node = entry.target
              if (!(node instanceof HTMLLIElement)) return
              const id = node.dataset.entryId
              if (!id) return
              calculateRowSpan(id, node)
            })
          })

    nodes.forEach(([, node]) => resizeObserver?.observe(node))

    const handleResize = () => {
      nodes.forEach(([id, node]) => calculateRowSpan(id, node))
    }

    window.addEventListener('resize', handleResize)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settleFrame)
      window.clearTimeout(lateSettleFrame)
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
    }
  }, [
    enginePerspectiveSections,
    engineEntryDeleteId,
    engineLabelEditorId,
    enginePreviewEditId,
    enginePreviewEditText,
    isReport,
    isPhoneViewport,
  ])

  useEffect(() => {
    if (isReport) return
    setEngineEntryRowSpans({})
  }, [isReport, enginePreviewSessionId])

  useEffect(() => {
    if (isPhoneViewport) {
      wasPhoneViewportRef.current = true
      setEngineEntryRowSpans({})
      return
    }
    if (!wasPhoneViewportRef.current) return
    wasPhoneViewportRef.current = false
    engineEntryNodesRef.current = {}
    setEngineEntryRowSpans({})
    setEngineBoardLayoutVersion((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 120)
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 320)
    }
  }, [isPhoneViewport])

  useEffect(() => {
    if (isTopup) {
      wasTopupOpenRef.current = true
      return
    }
    if (!wasTopupOpenRef.current) return
    wasTopupOpenRef.current = false
    engineEntryNodesRef.current = {}
    setEngineEntryRowSpans({})
    setEngineBoardLayoutVersion((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 120)
    }
  }, [isTopup])

  const handleEngineEntryDragStart = (
    event: ReactDragEvent<HTMLLIElement>,
    item: EngineBoardItem
  ) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('button, select, textarea, option')) {
      event.preventDefault()
      return
    }
    if (enginePreviewEditId === item.id || engineMovingEntryId === item.id) {
      event.preventDefault()
      return
    }
    setEngineDraggingEntryId(item.id)
    setEngineDragOverSection(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }

  const handleEngineEntryDragEnd = () => {
    if (engineDragHoverTimerRef.current) {
      window.clearTimeout(engineDragHoverTimerRef.current)
      engineDragHoverTimerRef.current = null
    }
    enginePendingDragTargetRef.current = null
    setEngineDraggingEntryId(null)
    setEngineDragOverSection(null)
    setEngineDragTargetIndex(null)
  }

  const scheduleEngineDragTarget = (
    sectionKey: EnginePerspectiveKey,
    targetIndex: number
  ) => {
    const currentSection = engineDragOverSection
    const currentIndex = engineDragTargetIndex
    const pending = enginePendingDragTargetRef.current

    if (currentSection !== sectionKey || currentIndex === null) {
      if (engineDragHoverTimerRef.current) {
        window.clearTimeout(engineDragHoverTimerRef.current)
        engineDragHoverTimerRef.current = null
      }
      enginePendingDragTargetRef.current = null
      setEngineDragOverSection(sectionKey)
      setEngineDragTargetIndex(targetIndex)
      return
    }

    if (currentIndex === targetIndex) return
    if (pending?.section === sectionKey && pending.index === targetIndex) return

    if (engineDragHoverTimerRef.current) {
      window.clearTimeout(engineDragHoverTimerRef.current)
    }
    enginePendingDragTargetRef.current = { section: sectionKey, index: targetIndex }
    engineDragHoverTimerRef.current = window.setTimeout(() => {
      const next = enginePendingDragTargetRef.current
      if (!next) return
      setEngineDragOverSection(next.section)
      setEngineDragTargetIndex(next.index)
      enginePendingDragTargetRef.current = null
      engineDragHoverTimerRef.current = null
    }, 100)
  }

  const handleEngineSectionDragOver = (
    event: ReactDragEvent<HTMLElement>,
    sectionKey: EnginePerspectiveKey,
    targetIndex: number
  ) => {
    if (!engineDraggingEntryId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    scheduleEngineDragTarget(sectionKey, targetIndex)
  }

  const handleEngineEntryDragOver = (
    event: ReactDragEvent<HTMLLIElement>,
    sectionKey: EnginePerspectiveKey,
    itemIndex: number
  ) => {
    if (!engineDraggingEntryId) return
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    const targetIndex = event.clientY < midpoint ? itemIndex : itemIndex + 1
    handleEngineSectionDragOver(event, sectionKey, targetIndex)
  }

  const handleEngineSectionDrop = async (
    event: ReactDragEvent<HTMLElement>,
    sectionKey: EnginePerspectiveKey
  ) => {
    event.preventDefault()
    const draggedId = engineDraggingEntryId || event.dataTransfer.getData('text/plain')
    const pendingTarget = enginePendingDragTargetRef.current
    const targetIndex =
      pendingTarget && pendingTarget.section === sectionKey
        ? pendingTarget.index
        : engineDragTargetIndex ?? 0
    if (engineDragHoverTimerRef.current) {
      window.clearTimeout(engineDragHoverTimerRef.current)
      engineDragHoverTimerRef.current = null
    }
    enginePendingDragTargetRef.current = null
    setEngineDragOverSection(null)
    setEngineDragTargetIndex(null)
    setEngineDraggingEntryId(null)
    if (!draggedId) return
    await moveEngineEntryToSection(draggedId, sectionKey, targetIndex)
  }

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

  const activeEngineSessionId = enginePreviewSessionId
  const engineBoardItemsLoaded = Boolean(
    activeEngineSessionId && engineBoardItemsLoadedBySession[activeEngineSessionId]
  )
  const engineSessionEmptyOnOpen = Boolean(
    activeEngineSessionId && engineSessionEmptyOnLoadById[activeEngineSessionId]
  )
  // Facilitation wrapper should only show for the first question in a session that opened with no items.
  const showFirstQuestionWrapper =
    Boolean(activeEngineSessionId) &&
    engineBoardItemsLoaded &&
    engineSessionEmptyOnOpen &&
    engineAskedQuestionTexts.length === 1

  useEffect(() => {
    if (!showFirstQuestionWrapper) {
      facilitationIntroRef.current = null
      return
    }
    if (!facilitationIntroRef.current) {
      const pick = facilitationIntros[Math.floor(Math.random() * facilitationIntros.length)]
      facilitationIntroRef.current = pick || facilitationIntros[0] || null
    }
  }, [showFirstQuestionWrapper, facilitationIntros])

  useEffect(() => {
    setEngineActiveFacilitationPerspective(null)
    setLastFacilitationPerspective(null)
  }, [enginePreviewSessionId])

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

  const actionPlanReadinessMeaningfulItems = useMemo(() => {
    const items = Array.isArray(enginePreviewItems) ? enginePreviewItems : []
    return items.filter((item) => {
      const text = typeof item?.text === 'string' ? item.text.trim() : ''
      if (!text) return false
      // Readiness should react to real material even before the matrix assignment is complete.
      // We still use matrix_col for coverage, but "meaningful" is primarily "has text".
      return true
    })
  }, [enginePreviewItems])
  const actionPlanReadinessMeaningfulCount = actionPlanReadinessMeaningfulItems.length
	  const actionPlanReadinessHeuristic = useMemo(() => {
	    const isPl = uiLanguage === 'Polish'
	    const cols = new Map<string, number>()
	    actionPlanReadinessMeaningfulItems.forEach((item) => {
      const col = String(item.matrix_col || '').trim().toLowerCase()
      if (!col) return
      cols.set(col, (cols.get(col) || 0) + 1)
    })
	    const hasAsIs = (cols.get('as_is') || 0) > 0
	    const notWorkingMeaningfulCount = cols.get('not_working') || 0
	    const hasNotWorking = notWorkingMeaningfulCount > 0
	    const hasToBe = (cols.get('should_be') || 0) > 0
	    const coverage = [hasAsIs, hasNotWorking, hasToBe].filter(Boolean).length
	    const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
	    const uniqueStrings = (values: string[]) => {
	      const seen = new Set<string>()
	      const out: string[] = []
	      for (const value of values) {
	        const normalized = normalizeKey(String(value || ''))
	        if (!normalized || seen.has(normalized)) continue
	        seen.add(normalized)
	        out.push(value)
	      }
	      return out
	    }

	    const positives: string[] = []
	    if (actionPlanReadinessMeaningfulCount >= 3) {
	      positives.push(
        isPl
          ? 'Wystarczająco wpisów z przypisaną perspektywą, aby zacząć syntezę.'
          : 'Enough categorized entries to start synthesis.'
      )
    }
    if (coverage >= 2) {
      positives.push(
        isPl
          ? 'Masz materiał z więcej niż jednej perspektywy (stan obecny / problemy / cel).'
          : 'Multiple perspectives are present (current / constraints / desired).'
      )
    }
    if (coverage === 3) {
      positives.push(
        isPl
          ? 'Materiał jest zbalansowany między perspektywami: Jak jest? / Co nie działa? / Jak powinno być?'
          : 'Balanced material across As‑is / Not working / Should be.'
      )
	    }

	    const improvementCandidates: string[] = []
	    // Priority 1: Not working coverage (most important).
	    if (!hasNotWorking || notWorkingMeaningfulCount < 3) {
	      improvementCandidates.push(
	        isPl
	          ? 'Dodaj kilka wpisów „Co nie działa?” (ograniczenia, problemy, ryzyka).'
	          : 'Add a few “Not working” entries (what is not working: constraints, pain points, risks).'
	      )
	    } else if (notWorkingMeaningfulCount < 5) {
	      improvementCandidates.push(
	        isPl
	          ? 'Dodaj jeszcze 1–2 wpisy „Co nie działa?”, aby lepiej ugruntować decyzje.'
	          : 'Add 1–2 more “Not working” entries to better ground decisions.'
	      )
	    }
	    // Priority 2: As-is coverage.
	    if (!hasAsIs) {
	      improvementCandidates.push(
	        isPl
	          ? 'Dodaj kilka wpisów „Jak jest?” (stan obecny, co istnieje dziś).'
	          : 'Add a few “As‑is” entries (current state, what exists today).'
	      )
	    }
	    // Priority 3: Diversity / Should-be presence.
	    if (!hasToBe) {
	      improvementCandidates.push(
	        isPl
	          ? 'Dodaj kilka wpisów „Jak powinno być?” (oczekiwany efekt, kryteria sukcesu).'
	          : 'Add a few “Should be” entries (desired outcomes, success criteria).'
	      )
	    } else if (coverage < 2) {
	      improvementCandidates.push(
	        isPl
	          ? 'Dodaj wpisy z innej perspektywy (Jak jest? / Co nie działa?), aby zbalansować materiał.'
	          : 'Add entries from another perspective (As‑is / Not working) to balance the material.'
	      )
	    }

	    const improvements = uniqueStrings(improvementCandidates).slice(0, 3)
	    const nextBestAction =
	      improvements[0] ||
	      (actionPlanReadinessMeaningfulCount < 3
	        ? isPl
	          ? 'Dodaj 2–3 wpisy z perspektywą (Jak jest? / Co nie działa? / Jak powinno być?), żeby ugruntować plan działania.'
	          : 'Add 2–3 categorized entries so the action plan can be grounded.'
	        : '')
    const baseScore = Math.min(
      100,
      Math.max(0, actionPlanReadinessMeaningfulCount * 12 + coverage * 18)
    )
    let score = baseScore
    if (notWorkingMeaningfulCount < 3) {
      score = Math.min(baseScore, 49)
    } else if (notWorkingMeaningfulCount < 5) {
      score = Math.min(baseScore, 74)
    }
    const level = score >= 75 ? 'strong' : score >= 50 ? 'ok' : 'weak'
	    return {
	      score,
	      level,
	      positives,
	      improvements,
      nextBestAction,
      coverage,
      notWorkingMeaningfulCount,
    }
  }, [actionPlanReadinessMeaningfulCount, actionPlanReadinessMeaningfulItems, uiLanguage])

  const pickReadinessLlmItems = useEffectEvent(() => {
    const items = Array.isArray(enginePreviewItems) ? enginePreviewItems : []
    const normalized = items
      .map((item) => {
        const llmEntry = normalizeEngineBoardEntryForLlm(item, uiLanguage, { maxAnswerLen: 280, maxQuestionLen: 260 })
        if (!llmEntry) return null
        const row = typeof item.matrix_row === 'string' ? item.matrix_row.trim() : ''
        const col = typeof item.matrix_col === 'string' ? item.matrix_col.trim() : ''
        const ts = Number(item.updated_at || item.created_at || 0) || 0
        return { ...llmEntry, matrix_row: row, matrix_col: col, ts }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (!normalized.length) return []
    const newest = [...normalized].sort((a, b) => b.ts - a.ts).slice(0, 10)
    const first = normalized.slice(0, 5)
    const merged = [...newest, ...first]
    const seen = new Set<string>()
    return merged
      .filter((item) => {
        const key = `${item.matrix_row}|${item.matrix_col}|${item.text}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 15)
      .map(({ area, matrix_cell, entry_type, question, answer, text, matrix_row, matrix_col }) => ({
        area,
        matrix_cell,
        entry_type,
        question,
        answer,
        text,
        matrix_row,
        matrix_col,
      }))
  })

  const toShortText = useEffectEvent((value: unknown, maxLen: number) => {
    const raw = typeof value === 'string' ? value : String(value ?? '')
    const trimmed = raw.replace(/\s+/g, ' ').trim()
    if (!trimmed) return ''
    return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed
  })

  const normalizeReadinessLlmResult = useEffectEvent(
    (payload: any): ActionPlanReadinessLlmResult | null => {
      if (!payload || typeof payload !== 'object') return null
      const summary = toShortText(payload.summary, 220)
      const howToBoost = toShortText(payload.howToBoost, 220)
      const biggestBoostRightNow = toShortText(payload.biggestBoostRightNow, 220)
      const qualityLevel =
        payload.qualityLevel === 'low' || payload.qualityLevel === 'medium' || payload.qualityLevel === 'high'
          ? payload.qualityLevel
          : 'medium'

      // Keep legacy fields if the backend still returns them.
      const improvements = Array.isArray(payload.improvements)
        ? payload.improvements.map((x: any) => toShortText(x, 140)).filter(Boolean).slice(0, 3)
        : undefined
      const insights = Array.isArray(payload.insights)
        ? payload.insights.map((x: any) => toShortText(x, 140)).filter(Boolean).slice(0, 3)
        : undefined
      const nextBestAction = typeof payload.nextBestAction === 'string' ? toShortText(payload.nextBestAction, 220) : undefined

      // Require at least one of the three UX fields; UI will apply partial fallback per-field.
      if (!summary && !howToBoost && !biggestBoostRightNow) return null
      return { summary, howToBoost, biggestBoostRightNow, qualityLevel, insights, improvements, nextBestAction }
    }
  )

	  const fetchActionPlanReadinessLlm = useEffectEvent(async (meaningfulCount: number) => {
		    if (!actionPlanReadinessLlmEnabled) return
		    if (!enginePreviewSessionId) return
	    // Run LLM after the first meaningful inputs appear (>=3 required for stable signal),
      // and then after every +2 meaningful items thereafter.
      // Always clear "pending" when the debounce fires (even if we return early).
      setActionPlanReadinessLlmCache((prev) => ({ ...prev, pending: false }))
	    if (meaningfulCount < 3) return
	    if (actionPlanReadinessLlmInFlightRef.current) return
	    const lastEvaluated = actionPlanReadinessLlmCache.lastEvaluatedCount || 0
      const lastCoverage = actionPlanReadinessLlmCache.lastEvaluatedCoverage
      const lastAttemptedAt = actionPlanReadinessLlmCache.lastAttemptedAt
      const lastAttemptedCount = actionPlanReadinessLlmCache.lastAttemptedCount || 0
      const lastAttemptedCoverage = actionPlanReadinessLlmCache.lastAttemptedCoverage
      const currentCoverage = actionPlanReadinessHeuristic.coverage
	    // Bootstrap for existing sessions (and the moment we cross the >=3 meaningful threshold)
	    // without spamming on repeated failures.
	    const bootstrap = actionPlanReadinessLlmCache.lastLLMResult == null && lastEvaluated < 3
	      const retryWindowMs = 15_000
		      const lastAttemptedAtNum = typeof lastAttemptedAt === 'number' ? lastAttemptedAt : undefined
			      const recentlyAttemptedSameInput = (() => {
			        if (actionPlanReadinessLlmCache.lastLLMResult != null) return false
			        const attemptedAt = lastAttemptedAtNum
			        if (attemptedAt == null) return false
              const attemptedAtMs = attemptedAt as number
			        if (Date.now() - attemptedAtMs >= retryWindowMs) return false
			        if (lastAttemptedCount !== meaningfulCount) return false
			        if (typeof lastAttemptedCoverage === 'number' && lastAttemptedCoverage !== currentCoverage) return false
			        return true
			      })()
      if (recentlyAttemptedSameInput) {
        logActionPlanReadinessLlm({
          triggered: false,
          reason: 'skip_recent_failed_attempt_same_input',
          meaningfulItemsCount: meaningfulCount,
          lastEvaluatedCount: lastEvaluated,
          usedFallback: true,
        })
        return
      }
      const coverageChanged =
        typeof lastCoverage === 'number' && Number.isFinite(lastCoverage) ? currentCoverage !== lastCoverage : false
      // Optional quality improvement: re-evaluate when we gain a new perspective (coverage changes),
      // even if meaningfulCount increased by only 1.
      const allowByCoverageChange = !bootstrap && coverageChanged
	    if (!bootstrap && !allowByCoverageChange && meaningfulCount < lastEvaluated + 2) {
	      logActionPlanReadinessLlm({
	        triggered: false,
	        reason: 'skip_not_enough_new_meaningful_items',
	        meaningfulItemsCount: meaningfulCount,
        lastEvaluatedCount: lastEvaluated,
        usedFallback: false,
      })
      return
    }
    // Only retrigger after new items are added (prevents loops from background reclassification/metadata updates).
    if (!bootstrap && enginePreviewItems.length <= actionPlanReadinessLastTotalCountRef.current) {
      logActionPlanReadinessLlm({
        triggered: false,
        reason: 'skip_no_new_items_added',
        meaningfulItemsCount: meaningfulCount,
        lastEvaluatedCount: lastEvaluated,
        usedFallback: false,
      })
      return
    }

    const items = pickReadinessLlmItems()
    if (items.length < 3) {
      logActionPlanReadinessLlm({
        triggered: true,
        reason: 'fallback_insufficient_items_after_pick',
        meaningfulItemsCount: meaningfulCount,
        lastEvaluatedCount: lastEvaluated,
        usedFallback: true,
      })
      setActionPlanReadinessLlmCache((prev) => ({
        ...prev,
        lastEvaluatedCount: meaningfulCount,
        lastEvaluatedCoverage: currentCoverage,
        lastLLMResult: null,
        loading: false,
      }))
      return
    }

		    actionPlanReadinessLlmInFlightRef.current = true
			    const seq = (actionPlanReadinessLlmSeqRef.current += 1)
			    const requestId = `apr_ui_${Date.now()}_${seq}`
		      logActionPlanReadinessLlm({
		        triggered: true,
		        reason: bootstrap ? 'trigger_bootstrap' : 'trigger_increment',
		        meaningfulItemsCount: meaningfulCount,
	        lastEvaluatedCount: lastEvaluated,
	        usedFallback: false,
	      })
	    // Mark attempted at request start to avoid tight retry loops when LLM is down.
	    setActionPlanReadinessLlmCache((prev) => ({
	      ...prev,
      lastAttemptedAt: Date.now(),
      lastAttemptedCount: meaningfulCount,
      lastAttemptedCoverage: currentCoverage,
      loading: true,
    }))
    actionPlanReadinessLastTotalCountRef.current = enginePreviewItems.length
    try {
      const sbClient = client
      if (sbClient == null) throw new Error('SUPABASE_CLIENT_MISSING')
      const sessionRes = await sbClient!.auth.getSession()
	      const token = sessionRes?.data?.session?.access_token || ''
	      if (!token) throw new Error('AUTH_REQUIRED')
		      const response = await fetch('/api/coach?action=action_plan_readiness', {
		        method: 'POST',
		        headers: {
	          'Content-Type': 'application/json',
	          Authorization: `Bearer ${token}`,
	          'x-request-id': requestId,
	        },
	        body: JSON.stringify({
	          sessionId: enginePreviewSessionId,
	          language: uiLanguage === 'Polish' ? 'pl' : 'en',
          items,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (seq !== actionPlanReadinessLlmSeqRef.current) return
      logActionPlanReadinessLlm({
        triggered: true,
        reason: 'response_received',
        meaningfulItemsCount: meaningfulCount,
        lastEvaluatedCount: lastEvaluated,
        usedFallback: !response.ok || !payload || payload.ok !== true,
      })
	      if (!response.ok || !payload || payload.ok !== true) {
	        setActionPlanReadinessLlmCache((prev) => ({
	          ...prev,
	          lastLLMResult: null,
	          loading: false,
	        }))
	        return
	      }
      const normalized = normalizeReadinessLlmResult(payload)
	      if (!normalized) {
	        setActionPlanReadinessLlmCache((prev) => ({
	          ...prev,
	          lastLLMResult: null,
	          loading: false,
	        }))
	        return
	      }
	      setActionPlanReadinessLlmCache((prev) => ({
	        ...prev,
	        lastEvaluatedCount: meaningfulCount,
	        lastEvaluatedCoverage: currentCoverage,
	        lastLLMResult: normalized,
	        loading: false,
	      }))
	    } catch {
	      if (seq !== actionPlanReadinessLlmSeqRef.current) return
	      logActionPlanReadinessLlm({
        triggered: true,
        reason: 'fallback_exception',
        meaningfulItemsCount: meaningfulCount,
        lastEvaluatedCount: lastEvaluated,
        usedFallback: true,
      })
	      setActionPlanReadinessLlmCache((prev) => ({
	        ...prev,
	        lastLLMResult: null,
	        loading: false,
	      }))
	    } finally {
	      actionPlanReadinessLlmInFlightRef.current = false
	    }
	  })

		  useEffect(() => {
		    if (!actionPlanReadinessEnabled) return
		    if (!actionPlanReadinessLlmEnabled) return
	    const cache = actionPlanReadinessLlmCacheRef.current
	    if (cache.loading) {
	      logActionPlanReadinessLlm({
	        triggered: false,
        reason: 'skip_loading',
        meaningfulItemsCount: actionPlanReadinessMeaningfulCount,
        lastEvaluatedCount: cache.lastEvaluatedCount || 0,
        usedFallback: false,
      })
      return
    }
    if (actionPlanReadinessLlmInFlightRef.current) {
      logActionPlanReadinessLlm({
        triggered: false,
        reason: 'skip_in_flight',
        meaningfulItemsCount: actionPlanReadinessMeaningfulCount,
        lastEvaluatedCount: cache.lastEvaluatedCount || 0,
        usedFallback: false,
      })
      return
    }
	    if (actionPlanReadinessMeaningfulCount < 3) {
      logActionPlanReadinessLlm({
        triggered: false,
        reason: 'skip_meaningful_lt_3',
        meaningfulItemsCount: actionPlanReadinessMeaningfulCount,
        lastEvaluatedCount: cache.lastEvaluatedCount || 0,
        usedFallback: false,
      })
      return
	    }
	    const last = cache.lastEvaluatedCount || 0
      const lastCoverage = cache.lastEvaluatedCoverage
      const currentCoverage = actionPlanReadinessHeuristic.coverage
      const lastAttemptedAt = cache.lastAttemptedAt
      const lastAttemptedCount = cache.lastAttemptedCount || 0
      const lastAttemptedCoverage = cache.lastAttemptedCoverage
	    const bootstrap = cache.lastLLMResult == null && last < 3
      const coverageChanged =
        typeof lastCoverage === 'number' && Number.isFinite(lastCoverage) ? currentCoverage !== lastCoverage : false
      const allowByCoverageChange = !bootstrap && coverageChanged
	      const retryWindowMs = 15_000
		      const lastAttemptedAtNum = typeof lastAttemptedAt === 'number' ? lastAttemptedAt : undefined
			      const recentlyAttemptedSameInput = (() => {
			        if (actionPlanReadinessLlmCache.lastLLMResult != null) return false
			        const attemptedAt = lastAttemptedAtNum
			        if (attemptedAt == null) return false
              const attemptedAtMs = attemptedAt as number
			        if (Date.now() - attemptedAtMs >= retryWindowMs) return false
			        if (lastAttemptedCount !== actionPlanReadinessMeaningfulCount) return false
			        if (typeof lastAttemptedCoverage === 'number' && lastAttemptedCoverage !== currentCoverage) return false
			        return true
			      })()
      if (recentlyAttemptedSameInput) {
        logActionPlanReadinessLlm({
          triggered: false,
          reason: 'skip_recent_failed_attempt_same_input',
          meaningfulItemsCount: actionPlanReadinessMeaningfulCount,
          lastEvaluatedCount: last,
          usedFallback: true,
        })
        return
      }
	    if (!bootstrap && !allowByCoverageChange && actionPlanReadinessMeaningfulCount < last + 2) {
	      logActionPlanReadinessLlm({
	        triggered: false,
	        reason: 'skip_trigger_condition_not_met',
        meaningfulItemsCount: actionPlanReadinessMeaningfulCount,
        lastEvaluatedCount: last,
        usedFallback: false,
      })
      return
    }
    if (!bootstrap && enginePreviewItems.length <= actionPlanReadinessLastTotalCountRef.current) {
      logActionPlanReadinessLlm({
        triggered: false,
        reason: 'skip_no_new_items_added',
        meaningfulItemsCount: actionPlanReadinessMeaningfulCount,
        lastEvaluatedCount: last,
        usedFallback: false,
      })
      return
    }

    const readinessKey = `${enginePreviewSessionId}|${actionPlanReadinessMeaningfulCount}|${currentCoverage}|${actionPlanReadinessHeuristic.notWorkingMeaningfulCount}`
	    if (readinessKey === readinessLastScheduledKeyRef.current) {
	      return
	    }
	    readinessLastScheduledKeyRef.current = readinessKey

		    {
		      const timer = actionPlanReadinessLlmDebounceRef.current
		      if (timer != null) clearTimeout(timer)
			    }
    actionPlanReadinessLlmDebounceRef.current = setTimeout(() => {
      setActionPlanReadinessLlmCache((prev) => ({ ...prev, pending: false }))
      void fetchActionPlanReadinessLlm(actionPlanReadinessMeaningfulCount)
    }, 650)
    setActionPlanReadinessLlmCache((prev) => ({ ...prev, pending: true }))
	    logActionPlanReadinessLlm({
	      triggered: true,
	      reason: `debounce_scheduled_${bootstrap ? 'bootstrap' : allowByCoverageChange ? 'coverage' : 'increment'}`,
	      meaningfulItemsCount: actionPlanReadinessMeaningfulCount,
	      lastEvaluatedCount: last,
	      usedFallback: false,
	    })
    return () => {
      if (actionPlanReadinessLlmDebounceRef.current) {
        const timer = actionPlanReadinessLlmDebounceRef.current
        if (timer != null) {
          clearTimeout(timer)
        }
        actionPlanReadinessLlmDebounceRef.current = null
      }
      setActionPlanReadinessLlmCache((prev) => ({ ...prev, pending: false }))
    }
  }, [
    actionPlanReadinessEnabled,
    actionPlanReadinessLlmEnabled,
    actionPlanReadinessMeaningfulCount,
    actionPlanReadinessHeuristic.coverage,
    actionPlanReadinessHeuristic.notWorkingMeaningfulCount,
    enginePreviewItems.length,
    enginePreviewSessionId,
    fetchActionPlanReadinessLlm,
  ])

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
                void handleReportNavigation()
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

  // Generates (or rebuilds) the report via backend flow and then opens `/report`.
  const generateActionPlan = async () => {
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
            enginePreviewItems.reduce((max, item) => {
              const updatedAt = Number(item.updated_at || item.created_at || 0)
              return Math.max(max, updatedAt)
            }, 0) || 0
          const reportLang: 'pl' | 'en' = uiLanguage === 'Polish' ? 'pl' : 'en'
          const ensured = await ensureReportExists(sessionId, sourceUpdatedAt, reportLang)
          setReportRecords((prev) => ({ ...prev, [sessionId]: ensured }))
          await markReportCreated(sessionId)
          if (!hasDbReport && ensured?.id) {
            void refreshBillingBalance()
          }
          clearInsufficientBalance()
          const existedAfterEnsure = Boolean(hasDbReport || ensured?.id)
          window.history.pushState({ newlyCreated: !existedAfterEnsure }, '', '/report')
          setReportViewOpen(true)
          return
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown'
          console.error('[report] ensure failed', { sessionId, message })
          try {
            const retryRecord = await fetchReportBySessionId(sessionId)
            if (retryRecord?.id) {
              setReportRecords((prev) => ({ ...prev, [sessionId]: retryRecord }))
              window.history.pushState({ newlyCreated: false }, '', '/report')
              setReportViewOpen(true)
              return
            }
          } catch {
            // Ignore retry lookup errors and fall through to the regular notice path.
          }
          if (message === 'INSUFFICIENT_BALANCE') {
            triggerInsufficientBalance()
          } else {
            showEngineNotice(notices.reportOpenFailed, 'error')
          }
          return
        }
      } else if (isGuestMode()) {
        window.sessionStorage.setItem(`report_exists::${sessionId}`, 'true')
        const sourceUpdatedAt =
          enginePreviewItems.reduce((max, item) => {
            const updatedAt = Number(item.updated_at || item.created_at || 0)
            return Math.max(max, updatedAt)
          }, 0) || 0
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

  // Navigates to `/report` for an already existing report.
  // Must NOT trigger any generate/update flow.
  const goToActionPlan = () => {
    if (typeof window === 'undefined') return
    const sessionId = enginePreviewSessionId || ''
    if (!sessionId) return
    const returnPath = window.location.pathname + window.location.search
    window.sessionStorage.setItem('reportReturnPath', returnPath)
    window.sessionStorage.setItem('reportReturnSessionId', sessionId)
    window.history.pushState({ newlyCreated: false }, '', '/report')
    setReportViewOpen(true)
  }

  const handleReportNavigation = async () => {
    if (reportNavigationLoading) return
    setReportNavigationLoading(true)
    try {
      await generateActionPlan()
    } finally {
      setReportNavigationLoading(false)
    }
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

  const persistBoardItemsToCloud = async (sessionId: string, userId: string) => {
    const supabaseClient = client
    if (!supabaseClient) return { inserts: 0, updates: 0, deletes: 0 }
    const { data: existing, error } = await supabaseClient
      .from('board_items')
      .select(
        'id,session_id,user_id,text,label,matrix_row,matrix_col,sort_order,question_id,question_text_pl,question_text_en,entry_type,prompt_type'
      )
      .eq('session_id', sessionId)
      .eq('user_id', userId)
    if (error) throw error
    const current = normalizeBoardItems(enginePreviewItems)
    const byId = new Map((existing || []).map((row) => [String(row.id), row]))
    const currentIds = new Set(current.map((item) => String(item.id)))
    const deletes = (existing || []).filter((row) => !currentIds.has(String(row.id)))
    const inserts = current.filter((item) => !byId.has(String(item.id)))
    const updates = current.filter((item) => {
      const row = byId.get(String(item.id))
      if (!row) return false
      return (
        String(row.text || '') !== String(item.text || '') ||
        (row.label ?? null) !== (item.label ?? null) ||
        (row.matrix_row ?? null) !== (item.matrix_row ?? null) ||
        (row.matrix_col ?? null) !== (item.matrix_col ?? null) ||
        (row.question_id ?? null) !== (item.question_id ?? null) ||
        (row.question_text_pl ?? null) !== (item.question_text_pl ?? null) ||
        (row.question_text_en ?? null) !== (item.question_text_en ?? null) ||
        (row.entry_type ?? null) !== (item.entry_type ?? null) ||
        (row.prompt_type ?? null) !== (item.prompt_type ?? null)
      )
    })

    if (deletes.length) {
      const ids = deletes.map((row) => String(row.id))
      const { error: delError } = await supabaseClient
        .from('board_items')
        .delete()
        .in('id', ids)
        .eq('session_id', sessionId)
        .eq('user_id', userId)
      if (delError) throw delError
    }

    if (updates.length) {
      await Promise.all(
        updates.map((item) =>
          supabaseClient
            .from('board_items')
            .update({
              text: item.text,
              label: item.label ?? null,
              matrix_row: item.matrix_row ?? null,
              matrix_col: item.matrix_col ?? null,
              question_id: item.question_id ?? null,
              question_text_pl: item.question_text_pl ?? null,
              question_text_en: item.question_text_en ?? null,
              entry_type: item.entry_type ?? null,
              prompt_type: item.prompt_type ?? null,
            })
            .eq('id', item.id)
            .eq('session_id', sessionId)
            .eq('user_id', userId)
        )
      )
    }

    if (inserts.length) {
      const payload = inserts.map((item) => ({
        id: item.id,
        user_id: userId,
        session_id: sessionId,
        text: item.text,
        label: item.label ?? null,
        matrix_row: item.matrix_row ?? null,
        matrix_col: item.matrix_col ?? null,
        question_id: item.question_id ?? null,
        question_text_pl: item.question_text_pl ?? null,
        question_text_en: item.question_text_en ?? null,
        entry_type: item.entry_type ?? null,
        prompt_type: item.prompt_type ?? null,
      }))
      const { error: insError } = await supabaseClient.from('board_items').insert(payload)
      if (insError) throw insError
    }

    return { inserts: inserts.length, updates: updates.length, deletes: deletes.length }
  }

  const fillNaAssignments = async (source: 'manual' | 'auto') => {
    if (engineAssignLoading || naFillStatus === 'running') return
    if (!enginePreviewSessionId) {
      if (source === 'manual') showEngineNotice(notices.noActiveSession, 'error')
      return
    }
    if (!engineSessionPersisted) {
      if (source === 'manual') {
        showEngineNotice(notices.createSessionFirst, 'error')
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
      if (source === 'manual') showEngineNotice(notices.noNaEntries, 'success')
      return
    }
    if (source === 'manual' && !aiSupportEnabled) {
      showEngineNotice(notices.aiDisabled, 'error')
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
      const response = await fetch('/api/coach?action=suggest', {
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
          showEngineNotice(notices.assignFailed, 'error')
        } else {
          showEngineNotice(notices.assignRetryFailed, 'error')
        }
        setNaFillStatus('error')
        return
      }
      const assignments = Array.isArray(data.assignments) ? data.assignments : []
      if (!assignments.length) {
        if (source === 'manual') {
          showEngineNotice(notices.noAssignments, 'success')
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
      if (updates.length && (!authSession?.user?.id || !client)) {
        console.error('[matrix_assign] persist_skipped_no_auth', {
          count: updates.length,
        })
      }
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
      } else if (updates.length) {
        console.error('[matrix_assign] persisted_assignments_count', 0)
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
        showEngineNotice(notices.naFilled, 'success')
      }
    } catch {
      setNaFillStatus('error')
      if (source === 'manual') {
        showEngineNotice(notices.assignFailed, 'error')
      } else {
        showEngineNotice(notices.assignRetryFailed, 'error')
      }
    } finally {
      setEngineAssignLoading(false)
    }
  }

  const assignNaItems = async () => {
    await fillNaAssignments('manual')
  }

  const persistSessionChanges = async (
    silentSuccess = false,
    reason: 'save' | 'logout' = 'save'
  ) => {
    const shouldShowSaveNotice = reason !== 'logout'
    if (!enginePreviewSessionId) {
      if (shouldShowSaveNotice) showEngineNotice(copy.engine.saveMissingSession, 'error')
      return false
    }
    const detail = await buildSessionDetailForSave()
    if (!detail?.session) {
      if (shouldShowSaveNotice) showEngineNotice(copy.engine.saveMissingSession, 'error')
      return false
    }
    try {
      if (!client) {
        if (shouldShowSaveNotice) showEngineNotice(copy.engine.saveRequiresAuth, 'error')
        return false
      }
      const { data } = await client.auth.getSession()
      const session = data.session
      if (!session?.user?.id) {
        if (shouldShowSaveNotice) showEngineNotice(notices.saveToCloudRequiresAuth, 'error')
        return false
      }
      try {
        try {
          const sync = await persistBoardItemsToCloud(
            enginePreviewSessionId,
            session.user.id
          )
          if (import.meta.env.DEV) {
            console.log('[board_items] sync', { reason, ...sync })
          }
        } catch (error) {
          const status = (error as { status?: number }).status
          console.error('[board_items] sync failed', { status, error })
          if (shouldShowSaveNotice) {
            showEngineNotice(notices.saveToCloudFailed(String(status ?? 'err')), 'error')
          }
          return false
        }
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
        if (shouldShowSaveNotice) {
          showEngineNotice(notices.saveToCloudFailed(String(status ?? 'err')), 'error')
        }
        return false
      }
      if (!silentSuccess && shouldShowSaveNotice) {
        showEngineNotice(notices.saveToCloudSuccess, 'success')
      }
      if (engineSessionsOpen) {
        void fetchEngineSessions()
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      logSessionStore('engine_session_cloud_save_failed', { message })
      if (shouldShowSaveNotice) showEngineNotice(copy.engine.saveFailed, 'error')
      return false
    }
  }

  const saveCurrentSessionToCloud = async (silentSuccess = false) =>
    persistSessionChanges(silentSuccess, 'save')

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
    setLogoutInProgress(true)
    setEngineNotice(null)
    if (engineNoticeTimer.current) {
      window.clearTimeout(engineNoticeTimer.current)
      engineNoticeTimer.current = null
    }
    const persistPromise = persistSessionChanges(true, 'logout')
    const timeoutMs = 2500
    const timeout = new Promise((resolve) =>
      window.setTimeout(() => resolve(false), timeoutMs)
    )
    const persisted = await Promise.race([persistPromise, timeout])
    if (persisted === false && import.meta.env.DEV) {
      console.warn('[logout] persist timed out', { timeoutMs })
    }
    const { error } = await client.auth.signOut()
    if (error) {
      setLogoutInProgress(false)
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
    safeNavigate('/')
  }

  const fetchEngineSessions = async () => {
    setEngineSessionsError(null)
    try {
      const localSessions = await listSessions()
      if (authSession?.user?.id) {
        if (!client) {
          setEngineSessionsError(notices.supabaseConnectionMissing)
          return
        }
        const { data: u } = await client.auth.getUser()
        const userId = u?.user?.id ?? null
        if (!userId) {
          setEngineSessionsError(notices.authSessionExpired)
          return
        }
        const { data: us, error: use } = await client
          .from('user_sessions')
          .select('session_id,payload')
          .eq('user_id', userId)
        if (use) {
          const message = (use as { message?: string | null })?.message ?? 'Request failed'
          setEngineSessionsError(notices.sessionsListFailed(message))
          return
        }
        const sessionRows = (us || []) as Array<{
          session_id?: string | null
          payload?: CloudSessionPayload | null
        }>
        const sessionIds = sessionRows
          .map((row) => String(row.session_id || '').trim())
          .filter(Boolean)
        const uniqueIds = Array.from(new Set(sessionIds))
        const nextCloudPayloads = sessionRows.reduce<Record<string, CloudSessionPayload>>((acc, row) => {
          const sessionId = String(row.session_id || '').trim()
          if (!sessionId || !row.payload) return acc
          acc[sessionId] = row.payload
          return acc
        }, {})
        let sessionsFound: EngineSessionSummary[] = []
        if (uniqueIds.length) {
          const { data: sessionsData, error: se } = await client
            .from('sessions')
            .select('*')
            .in('id', uniqueIds)
          if (se) {
            const message = (se as { message?: string | null })?.message ?? 'Request failed'
            setEngineSessionsError(notices.sessionsMetadataFailed(message))
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
        setCloudSessionPayloads(nextCloudPayloads)
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
      setEngineSessionsError(notices.sessionsListFailed(message))
      logSessionStore('engine_sessions_list_failed', { message })
    } finally {
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

  const mergeExecutionReportSelections = (
    primary: ReportExecutionReport | null | undefined,
    fallback: ReportExecutionReport | null | undefined
  ): ReportExecutionReport | null => {
    if (!primary) return fallback ?? null
    if (!fallback?.decisions?.length) return primary
    const fallbackByTradeoff = new Map(
      fallback.decisions.map((item, index) => [String(item.tradeoff || '').trim() || `idx:${index}`, item])
    )
    return {
      ...primary,
      decisions: primary.decisions.map((item, index) => {
        if (item.selected_option === 'a' || item.selected_option === 'b') return item
        const fallbackItem =
          fallbackByTradeoff.get(String(item.tradeoff || '').trim() || `idx:${index}`) ||
          fallback.decisions[index] ||
          null
        return fallbackItem?.selected_option
          ? { ...item, selected_option: fallbackItem.selected_option }
          : item
      }),
    }
  }

  const mergeReportMeta = (
    primary: ReportMeta | null | undefined,
    fallback: ReportMeta | null | undefined
  ): ReportMeta | null => {
    if (!primary) return fallback ?? null
    if (!fallback) return primary
    return {
      ...fallback,
      ...primary,
      execution_report: mergeExecutionReportSelections(
        primary.execution_report ?? null,
        fallback.execution_report ?? null
      ),
    }
  }

  const getReportMetaForSession = (sessionId: string | null) => {
    if (!sessionId) return null
    const localMeta =
      engineSessionDetail?.session?.id === sessionId && engineSessionDetail?.report
        ? engineSessionDetail.report
        : null
    const cloudMeta = cloudSessionPayloads[sessionId]?.report || null
    if (authSession?.user?.id) {
      const dbReport = reportRecords[sessionId]
      const dbMeta = dbReport
        ? {
            id: dbReport.id,
            created_at: dbReport.createdAt,
            updated_at: dbReport.updatedAt,
            sourceUpdatedAt: dbReport.sourceUpdatedAt,
            lang: dbReport.lang ?? null,
            lastSummaryTextHash: dbReport.lastSummaryTextHash ?? null,
            summary: dbReport.summary ?? null,
            ideas: dbReport.ideas ?? null,
            recommendations: dbReport.recommendations ?? null,
            triz: dbReport.triz ?? null,
            execution_report: dbReport.executionReport ?? null,
          }
        : null
      const mergedMeta = mergeReportMeta(mergeReportMeta(localMeta, cloudMeta), dbMeta)
      if (!dbMeta) return mergedMeta
      // Keep the local/cloud report body, but trust Supabase for report freshness metadata.
      // A stale stored session can otherwise make the top report update CTA active after re-login.
      return {
        ...mergedMeta,
        id: dbMeta.id ?? mergedMeta?.id ?? null,
        created_at: dbMeta.created_at ?? mergedMeta?.created_at ?? null,
        updated_at: dbMeta.updated_at ?? mergedMeta?.updated_at ?? null,
        sourceUpdatedAt: dbMeta.sourceUpdatedAt ?? mergedMeta?.sourceUpdatedAt ?? null,
        lastSummaryTextHash: dbMeta.lastSummaryTextHash ?? mergedMeta?.lastSummaryTextHash ?? null,
      }
    }
    return mergeReportMeta(localMeta, cloudMeta)
  }

  const markReportCreated = async (
    sessionId: string,
    options?: { ensureRemote?: boolean }
  ) => {
    const now = Date.now()
    const reportLang: 'pl' | 'en' = uiLanguage === 'Polish' ? 'pl' : 'en'
    const detail = await getSession(sessionId)
    if (!detail?.session) return
    if (options?.ensureRemote && authSession?.user?.id && client) {
      const sourceUpdatedAt =
        (detail.boardItems || []).reduce((max, item) => {
          const updatedAt = Number(item.updated_at || item.created_at || 0)
          return Math.max(max, updatedAt)
        }, 0) || 0
      try {
        const ensured = await ensureReportExists(sessionId, sourceUpdatedAt, reportLang)
        setReportRecords((prev) => ({ ...prev, [sessionId]: ensured }))
        clearInsufficientBalance()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown'
        console.error('[report] ensure failed', { sessionId, message })
        if (message === 'INSUFFICIENT_BALANCE') {
          triggerInsufficientBalance()
        }
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
        lang: existing?.lang ?? reportLang,
        lastSummaryTextHash: existing?.lastSummaryTextHash ?? null,
        summary: existing?.summary ?? null,
        execution_report: existing?.execution_report ?? null,
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
      if (authSession?.user?.id) {
        const response = await apiFetch('/api/session?action=delete', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          const apiError = String(payload?.error || 'SESSION_DELETE_FAILED')
          if (import.meta.env.DEV) {
            console.error('[engine session delete][api] failed', {
              status: response.status,
              error: apiError,
              sessionId,
            })
          }
          if (response.status === 401) {
            throw new Error('AUTH_REQUIRED')
          }
          if (response.status === 403 || response.status === 404) {
            throw new Error('FORBIDDEN')
          }
          throw new Error(apiError)
        }
      }
      await deleteSession(sessionId)
      const nextSessions = engineSessions.filter((session) => session.id !== sessionId)
      setEngineSessions(nextSessions)
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
      if (nextSessions.length === 0) {
        setEngineSessionsOpen(false)
        setResumeNamePromptAfterList(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(notices.sessionDeleteFailed(message))
      logSessionStore('engine_session_delete_failed', { sessionId, message })
      if (message === 'FORBIDDEN') {
        showEngineNotice(notices.sessionDeleteForbidden, 'error')
      } else if (message === 'AUTH_REQUIRED') {
        showEngineNotice(notices.authSessionExpired, 'error')
      } else {
        showEngineNotice(notices.sessionDeleteFailed('Request failed'), 'error')
      }
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
        const balanceAfter = await updateBoardItemLabel(sessionId, entryId, label ?? null)
        if (typeof balanceAfter === 'number' && Number.isFinite(balanceAfter)) {
          setBillingBalanceOverrideMinor(balanceAfter)
        }
      }
      clearInsufficientBalance()
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
      if (message.includes('INSUFFICIENT_BALANCE')) {
        triggerInsufficientBalance()
        if (showDiagnostics) {
          setEngineSessionsError(notices.labelSaveFailed(message))
          logSessionStore('engine_entry_label_failed', { entryId, message })
        }
      } else {
        setEngineSessionsError(notices.labelSaveFailed(message))
        logSessionStore('engine_entry_label_failed', { entryId, message })
      }
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
      setEngineSessionDetail({
        ...data,
        boardItems: normalizedItems,
        report: data.report ?? cloudPayload?.report ?? null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(notices.saveChangesFailed(message))
      logSessionStore('engine_session_detail_failed', { sessionId, message })
    }
  }

  const openEngineSession = async (sessionId: string) => {
    setEngineSessionsError(null)
    setEngineEditItemId(null)
    setEngineEditText('')
    setEngineInitialBriefOpen(false)
    setEngineInitialBriefError(null)
    setEngineInitialBriefSubmitting(false)
    setEngineBoardItemsLoadedBySession((prev) => ({ ...prev, [sessionId]: false }))
    setEngineSessionEmptyOnLoadById((prev) => ({ ...prev, [sessionId]: false }))
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
            .map((item, index) => {
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
                sort_order: (index + 1) * ENGINE_SORT_GAP,
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
          showEngineNotice(notices.authSessionExpired, 'error')
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
            notices.openSessionFailed(
              (usRes.error as { status?: number | null })?.status ?? 'n/a',
              (usRes.error as { code?: string | null })?.code ?? 'n/a'
            ),
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
                showEngineNotice(notices.sessionAccessDenied, 'error')
                return
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Request failed'
              showEngineNotice(notices.sessionAccessCheckFailed(message), 'error')
              return
            }
          } else {
            showEngineNotice(notices.sessionAccessDenied, 'error')
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
        type SessionReportRow = {
          id?: string | null
          session_id?: string | null
          created_at?: string | number | null
          updated_at?: string | number | null
          source_updated_at?: string | number | null
          last_summary_text_hash?: string | null
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
            notices.openSessionFailed(
              (sRes.error as { status?: number | null })?.status ?? 'n/a',
              (sRes.error as { code?: string | null })?.code ?? 'n/a'
            ),
            'error'
          )
        }
        if (!sRes.data) {
          showEngineNotice(notices.legacySessionMissingMeta, 'error')
          return
        }
        const biRes = await client
          .from('board_items')
          .select('id,session_id,user_id,text,label,matrix_row,matrix_col,sort_order,question_id,question_text_pl,question_text_en,created_at,updated_at')
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
            notices.openSessionFailed(
              (biRes.error as { status?: number | null })?.status ?? 'n/a',
              (biRes.error as { code?: string | null })?.code ?? 'n/a'
            ),
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
          .select('id,session_id,created_at,updated_at,source_updated_at,last_summary_text_hash')
          .eq('session_id', sessionId)
          .maybeSingle() as { data: SessionReportRow | null; error: unknown }
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
            notices.openSessionFailed(
              (rRes.error as { status?: number | null })?.status ?? 'n/a',
              (rRes.error as { code?: string | null })?.code ?? 'n/a'
            ),
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
        if (!rRes.error) {
          setReportRecords((prev) => {
            if (!rRes.data) return { ...prev, [sessionSummary.id]: null }
            const existing = prev[sessionSummary.id]
            const openedReportRecord = {
              id: String(rRes.data.id || sessionSummary.id),
              sessionId: sessionSummary.id,
              createdAt: toTimestamp(rRes.data.created_at, now),
              updatedAt: toTimestamp(rRes.data.updated_at, now),
              sourceUpdatedAt: toTimestamp(rRes.data.source_updated_at, 0),
              lastSummaryTextHash: rRes.data.last_summary_text_hash ?? existing?.lastSummaryTextHash ?? null,
              summary: existing?.summary ?? null,
              ideas: existing?.ideas ?? null,
              recommendations: existing?.recommendations ?? null,
              triz: existing?.triz ?? null,
              executionReport: existing?.executionReport ?? null,
              lang: existing?.lang ?? null,
            }
            return { ...prev, [sessionSummary.id]: openedReportRecord }
          })
        }
        setEngineSessionDetail({
          session: sessionSummary,
          boardItems: normalizedItems,
          askedQuestionIds: [],
          report: rRes.data
            ? {
                id: rRes.data.id ?? null,
                created_at: toTimestamp(rRes.data.created_at, now),
                updated_at: toTimestamp(rRes.data.updated_at, now),
                sourceUpdatedAt: toTimestamp(rRes.data.source_updated_at, 0),
                lastSummaryTextHash: rRes.data.last_summary_text_hash ?? null,
                summary: reportSummary,
              }
            : null,
        })
        setEnginePreviewSessionId(sessionSummary.id)
        setEnginePreviewSessionName(sessionSummary.name ?? '')
        setEngineSessionPersisted(true)
        setEnginePreviewItems(normalizedItems)
        setEngineBoardItemsLoadedBySession((prev) => ({
          ...prev,
          [sessionSummary.id]: true,
        }))
        setEngineSessionEmptyOnLoadById((prev) => ({
          ...prev,
          [sessionSummary.id]: normalizedItems.length === 0,
        }))
        syncEngineLabelCache(normalizedItems)
        setEnginePreviewInput('')
        setEnginePreviewError(null)
        setEngineNamePromptOpen(false)
        setEngineNameDraft('')
        setFeedbackReminder(null)
        const shouldResumeInitialBrief = Boolean(authSession?.user?.id && normalizedItems.length === 0)
        setEngineInitialBriefOpen(shouldResumeInitialBrief)
        if (shouldResumeInitialBrief) {
          setEngineInitialBriefText('')
          setEngineInitialBriefError(null)
        }
        setEngineUiState(shouldResumeInitialBrief ? 'INIT' : 'FREE_FLOW')
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
                  sourceUpdatedAt: toTimestamp(rRes.data.source_updated_at, 0),
                  lastSummaryTextHash: rRes.data.last_summary_text_hash ?? null,
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
      if (data.session?.id) {
        setEngineBoardItemsLoadedBySession((prev) => ({
          ...prev,
          [data.session!.id]: true,
        }))
        setEngineSessionEmptyOnLoadById((prev) => ({
          ...prev,
          [data.session!.id]: normalizedItems.length === 0,
        }))
      }
      syncEngineLabelCache(normalizedItems)
      setEnginePreviewInput('')
      setEnginePreviewError(null)
      setEngineNamePromptOpen(false)
      setEngineNameDraft('')
      setFeedbackReminder(null)
      const shouldResumeInitialBrief = Boolean(authSession?.user?.id && normalizedItems.length === 0)
      setEngineInitialBriefOpen(shouldResumeInitialBrief)
      if (shouldResumeInitialBrief) {
        setEngineInitialBriefText('')
        setEngineInitialBriefError(null)
      }
      setEngineUiState(shouldResumeInitialBrief ? 'INIT' : 'FREE_FLOW')
      setEngineActivePrompt(null)
      setEngineOfferReason(null)
      if (data.session) {
        void updateSession({ ...data, boardItems: normalizedItems })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(notices.saveChangesFailed(message))
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
      setEngineSessionsError(notices.deleteItemFailed(message))
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
      setEngineSessionsError(notices.deleteItemFailed(message))
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
      setEngineSessionsError(notices.deleteItemFailed(message))
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
      setEngineSessionsError(notices.sessionDetailsFailed(message))
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
      setEngineSessionsError(notices.exportFailed(message))
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
        throw new Error(notices.invalidImportFile)
      }
      const result = await importSessions(sessions as Parameters<typeof importSessions>[0])
      setEngineSessionsError(null)
      setEngineSessions(await listSessions())
      logSessionStore('engine_import_done', { imported: result.imported })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(notices.importFailed(message))
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
  const landingLogoUrl = new URL('../logo/logo_makemyideawork.png', import.meta.url).href

  useEffect(() => {
    if (!isDevUi) return
    if (typeof window === 'undefined') return
    const handleError = (event: ErrorEvent) => {
      console.error('[dev error]', event)
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      console.error('[dev unhandledrejection]', reason)
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [isDevUi])

  const devAuthPanel = null

  const withDevOverlay = (node: React.ReactNode) => (
    <>
      {devAuthPanel}
      {node}
    </>
  )

  const reportHydrationAttemptedRef = useRef(false)

  useEffect(() => {
    if (!isReport) {
      reportHydrationAttemptedRef.current = false
      return
    }
    if (reportHydrationAttemptedRef.current) return
    if (typeof window === 'undefined') return
    if (enginePreviewSessionId) return
    const storedSessionId = window.sessionStorage.getItem('reportReturnSessionId')
    const sessionId = String(storedSessionId || '').trim()
    if (!sessionId) return
    reportHydrationAttemptedRef.current = true
    void openEngineSession(sessionId)
  }, [isReport, enginePreviewSessionId])

  if (isDebugMatrix) {
    return withDevOverlay(<DebugMatrixPage llmApiBase={llmApiBase} uiLanguage={uiLanguage} />)
  }

  if (isAuthCallback) {
    return withDevOverlay(
      <div className="app auth-screen">
        <section className="panel auth-panel">
          <h1>{copy.loginCallbackTitle}</h1>
          {!authCallbackLoading && authCallbackErrorVisible && authCallbackError && (
            <p className="engine-error">{authCallbackError}</p>
          )}
          {!authCallbackLoading && authCallbackErrorVisible && authCallbackError && authCallbackHint && (
            <p className="muted">DIAG: {authCallbackHint}</p>
          )}
          {/* PKCE diagnostics removed after stabilizing preview auth. */}
          {!authCallbackLoading && authCallbackErrorVisible && authCallbackError && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  safeNavigate('/')
                }}
              >
                {copy.authCallback.tryAgainCta}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  safeNavigate('/')
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

  const llmUsageClass = llmUsageModel
    ? `llm-model-${llmUsageModel.replace(/\./g, '-')}`
    : 'llm-model-none'
  const currentTokensTotal = sessionUsage.totalTokens
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
  const totalCostUsd = sessionUsage.totalUSD
  const totalCostPln = sessionUsage.totalPLN ?? (usdPlnRate ? totalCostUsd * usdPlnRate : null)
  const modelUsageEntries = Object.entries(sessionUsage.perModel)
    .filter(([, usage]) => (usage?.inputTokens || 0) + (usage?.outputTokens || 0) > 0)
    .sort((a, b) => (b[1]?.totalUSD || 0) - (a[1]?.totalUSD || 0))
  const activeUsageSessionIdNormalized = String(activeUsageSessionId || '').trim() || null
  const sessionUsageHasReadError =
    showDiagnostics &&
    Boolean(activeUsageSessionIdNormalized) &&
    sessionUsageDiagnostics.sessionId === activeUsageSessionIdNormalized &&
    (sessionUsageDiagnostics.summaryQueryStatus === 'error' ||
      sessionUsageDiagnostics.eventsQueryStatus === 'error')
  const showSessionUsage =
    showDiagnostics && Boolean(activeUsageSessionId) && isAuthed && !sessionUsageHasReadError

  // Mobile gate: phones render a lightweight landing page only.
  // Keep this after all hooks so resizing across the phone breakpoint does not change hook order.
  if (isPhoneViewport) {
    return withDevOverlay(
      <MobileLanding
        language={uiLanguage as MobileLandingLanguage}
        logoUrl={landingLogoUrl}
        onLanguageChange={(nextLanguage) => setUiLanguage(nextLanguage)}
        feedbackLabel={copy.feedbackButtonLabel}
        onFeedbackOpen={() => setFeedbackOpen(true)}
        feedbackPanel={feedbackPanel}
      />
    )
  }

  if (isReport && !isTopup) {
    const snapshot = getReportSessionSnapshot()
    const reportLanguage =
      snapshot.reportMeta?.lang === 'pl' || snapshot.reportMeta?.lang === 'en'
        ? snapshot.reportMeta.lang
        : uiLanguage === 'Polish'
          ? 'pl'
          : 'en'
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
        canToggleDiagnostics={isAdmin}
        diagnosticsToggleLabel={showDiagnostics ? copy.diagnosticsOn : copy.diagnosticsOff}
        onToggleDiagnostics={() => {
          const nextEnabled = !showDiagnostics
          setDiagnosticsEnabled(nextEnabled)
          localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, nextEnabled ? 'true' : 'false')
        }}
        diagnosticsAuthLabel={
          isDiagEnabled() ? `${copy.diagnosticsAuthLabel}: ${authSession?.user?.email ?? '—'}` : null
        }
        canToggleAiSupport={showDiagnostics}
        aiSupportToggleLabel={aiSupportEnabled ? copy.aiSupportOn : copy.aiSupportOff}
        onToggleAiSupport={() => {
          const nextEnabled = !aiSupportEnabled
          setAiSupportEnabled(nextEnabled)
          localStorage.setItem('aiSupportEnabled', nextEnabled ? 'true' : 'false')
          if (nextEnabled) {
            void checkLlmStatus(normalizeApiBase(llmApiBase))
          } else {
            setLlmStatus('offline')
          }
        }}
        llmUsageIndicatorLabel={copy.llmUsageIndicatorLabel}
        llmUsageValue={showSessionUsage ? `${formatTokenTotal(currentTokensTotal)} tok` : null}
        llmUsageClassName={llmUsageClass}
        sessionUsageDiagnostics={showDiagnostics ? sessionUsageDiagnostics : null}
        llmCostLines={
          showSessionUsage
            ? [
                copy.llmCostLabel(formatUsd(totalCostUsd)),
                totalCostPln != null
                  ? copy.llmCostPlnLabel(formatPln(totalCostPln || 0))
                  : copy.llmCostPlnFallback,
              ]
            : []
        }
        llmCostBreakdownLabel={showSessionUsage ? copy.llmCostBreakdown : undefined}
        llmCostBreakdownRows={
          showSessionUsage
            ? [
                copy.llmCostTotalTokens(formatTokenTotal(sessionUsage.totalTokens)),
                copy.llmCostTotalUsd(formatUsd(totalCostUsd)),
                totalCostPln != null
                  ? copy.llmCostTotalPln(formatPln(totalCostPln || 0))
                  : copy.llmCostTotalPlnFallback,
                ...modelUsageEntries.map(([model, usage]) =>
                  copy.llmCostModelRow(
                    model,
                    formatTokenTotal(usage.inputTokens),
                    formatTokenTotal(usage.outputTokens),
                    formatUsd(usage.totalUSD)
                  )
                ),
              ]
            : []
        }
        naFillStatus={naFillStatus}
        onUpdateLabel={updateEngineEntryLabel}
        onBillingInsufficient={triggerInsufficientBalance}
        onBillingRefresh={() => {
          void refreshBillingBalance()
          clearInsufficientBalance()
        }}
        onSaveSession={() => {
          void saveCurrentSessionToCloud()
        }}
        saveSessionLabel={copy.engine.saveSession}
        showInsufficientBalance={insufficientBalanceState.active}
        insufficientBalanceNotice={copy.insufficientBalanceNotice}
        billingCurrency={balanceCurrency}
        balanceMinor={billingBalanceOverrideMinor ?? billingAccount.balanceMinor}
        billingLoading={billingAccount.loading}
        billingError={billingAccount.error}
        onReportMetaChange={async (meta) => {
          const sessionId = snapshot.sessionId || enginePreviewSessionId
          if (!sessionId) return
          const now = Date.now()
          setReportRecords((prev) => {
            const existingRecord = prev[sessionId]
            const snapshotRecordId =
              typeof snapshot.reportMeta === 'object' && snapshot.reportMeta && 'id' in snapshot.reportMeta
                ? String(snapshot.reportMeta.id || '')
                : ''
            return {
              ...prev,
              [sessionId]: {
                id: existingRecord?.id || snapshotRecordId || sessionId,
                sessionId,
                createdAt:
                  meta.createdAt ??
                  existingRecord?.createdAt ??
                  snapshot.reportMeta?.createdAt ??
                  now,
                updatedAt:
                  meta.updatedAt ??
                  existingRecord?.updatedAt ??
                  snapshot.reportMeta?.updatedAt ??
                  snapshot.reportMeta?.createdAt ??
                  now,
                sourceUpdatedAt:
                  meta.sourceUpdatedAt ??
                  existingRecord?.sourceUpdatedAt ??
                  snapshot.reportMeta?.sourceUpdatedAt ??
                  0,
                summary:
                  meta.summary ??
                  existingRecord?.summary ??
                  snapshot.reportMeta?.summary ??
                  null,
                ideas:
                  meta.ideas ??
                  existingRecord?.ideas ??
                  snapshot.reportMeta?.ideas ??
                  null,
                recommendations:
                  normalizeRecommendations(
                    meta.recommendations ??
                      existingRecord?.recommendations ??
                      snapshot.reportMeta?.recommendations ??
                      null
                  ),
                triz:
                  meta.triz ??
                  existingRecord?.triz ??
                  snapshot.reportMeta?.triz ??
                  null,
                executionReport:
                  meta.execution_report ??
                  existingRecord?.executionReport ??
                  snapshot.reportMeta?.execution_report ??
                  null,
                lang:
                  existingRecord?.lang ??
                  snapshot.reportMeta?.lang ??
                  reportLanguage,
                lastSummaryTextHash:
                  meta.lastSummaryTextHash ??
                  existingRecord?.lastSummaryTextHash ??
                  snapshot.reportMeta?.lastSummaryTextHash ??
                  null,
              },
            }
          })
          const detail = await getSession(sessionId)
          if (!detail?.session) return
          const existing = detail.report || null
          const nextReport = {
            ...(existing || {}),
            id: existing?.id ?? sessionId,
            lang: existing?.lang ?? reportLanguage,
            summary: meta.summary ?? existing?.summary ?? null,
            lastSummaryTextHash:
              meta.lastSummaryTextHash ?? existing?.lastSummaryTextHash ?? null,
            created_at: meta.createdAt ?? existing?.created_at ?? Date.now(),
            updated_at:
              meta.updatedAt ??
              existing?.updated_at ??
              snapshot.reportMeta?.updatedAt ??
              snapshot.reportMeta?.createdAt ??
              Date.now(),
            sourceUpdatedAt:
              meta.sourceUpdatedAt ??
              existing?.sourceUpdatedAt ??
              snapshot.reportMeta?.sourceUpdatedAt ??
              null,
            ideas: meta.ideas ?? existing?.ideas ?? null,
            recommendations: normalizeRecommendations(meta.recommendations ?? existing?.recommendations ?? null),
            triz: meta.triz ?? existing?.triz ?? null,
            execution_report: meta.execution_report ?? existing?.execution_report ?? null,
          }
          const updatedDetail: EngineSessionDetail = {
            ...detail,
            report: nextReport,
            session: { ...detail.session, updated_at: now },
          }
          if (engineSessionDetail?.session?.id === sessionId) {
            setEngineSessionDetail(updatedDetail)
          }
          await updateSession(updatedDetail)
          if (authSession?.user?.id) {
            await saveSessionToCloud(authSession.user.id, updatedDetail, uiLanguage)
          }
        }}
        onAiUsage={(meta) => {
          applyUsageModel(meta as LlmUsageMeta)
          void applyUsageToSession(meta as LlmUsageMeta, enginePreviewSessionId)
        }}
      />
    )
  }

  if (isTopup) {
    if (showSupabaseConfigError) {
      return withDevOverlay(
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <h1>{notices.supabaseConfigTitle}</h1>
            <p className="muted">{notices.supabaseConfigBody}</p>
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
    const topupCopy = copy.topupConfig
    const topupCurrency: 'PLN' = 'PLN'
    const topupAmountS = resolveAutopayTopupMinor('S').amountMinor
    const topupAmountM = resolveAutopayTopupMinor('M').amountMinor
    const topupAmountL = resolveAutopayTopupMinor('L').amountMinor
    const isTopupBusy = topupLoadingTier !== null
    if (typeof window !== 'undefined') {
      console.log('[TOPUP REAL COMPONENT LOADED]')
    }
    return withDevOverlay(
      <div className="app auth-screen">
        <div className="topup-stack">
          <button
            type="button"
            className="topup-return-button"
            onClick={handleTopupReturn}
          >
            {copy.topupReturnLabel}
          </button>
          <img
            className="topup-logo"
            src={new URL('/logo/logo_makemyideawork_transp.png', import.meta.url).href}
            alt="MakeMyIdea.work"
          />
          <h1 className="topup-title">{copy.topupTitle}</h1>
          <div className="topup-row">
            <section
              className={`panel auth-panel auth-panel--topup topup-panel${
                isTopupBusy ? ' topup-panel--disabled' : ''
              }${topupLoadingTier === 'S' ? ' topup-panel--loading' : ''}`}
              style={{ width: '240px', height: '480px', maxWidth: '90vw', maxHeight: '90vh' }}
              role="button"
              tabIndex={0}
              aria-disabled={isTopupBusy}
              aria-busy={topupLoadingTier === 'S'}
              onClick={() => {
                console.log('[TOPUP REAL CLICK] S')
                console.log('[TOPUP RAW CLICK] S')
                void handleTopupClick('S')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  console.log('[TOPUP REAL CLICK] S')
                  console.log('[TOPUP RAW CLICK] S')
                  void handleTopupClick('S')
                }
              }}
            >
              <div className="topup-inner">
                <div className="topup-amount">
	                  <span className="topup-amount-value">
	                    {topupLoadingTier === 'S'
	                      ? '...'
	                      : formatTopupAmountValue(topupAmountS)}
	                  </span>
	                  <span className="topup-amount-currency">{topupCurrency}</span>
	                </div>
                <p className="topup-caption">
                  {topupCopy.captions[0][0]}
                  <br />
                  {topupCopy.captions[0][1]}
                </p>
                <div className="topup-letter-wrap">
                  <div className="topup-letter">S</div>
                </div>
                {copy.topupSubtitle ? (
                  <p className="muted auth-subtitle">{copy.topupSubtitle}</p>
                ) : null}
              </div>
            </section>
            <section
              className={`panel auth-panel auth-panel--topup auth-panel--topup-m topup-panel${
                isTopupBusy ? ' topup-panel--disabled' : ''
              }${topupLoadingTier === 'M' ? ' topup-panel--loading' : ''}`}
              style={{ width: '240px', height: '480px', maxWidth: '90vw', maxHeight: '90vh' }}
              role="button"
              tabIndex={0}
              aria-disabled={isTopupBusy}
              aria-busy={topupLoadingTier === 'M'}
              onClick={() => {
                console.log('[TOPUP REAL CLICK] M')
                void handleTopupClick('M')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  console.log('[TOPUP REAL CLICK] M')
                  void handleTopupClick('M')
                }
              }}
            >
              <div className="topup-inner">
                <div className="topup-amount">
	                  <span className="topup-amount-value">
	                    {topupLoadingTier === 'M'
	                      ? '...'
	                      : formatTopupAmountValue(topupAmountM)}
	                  </span>
	                  <span className="topup-amount-currency">{topupCurrency}</span>
	                </div>
                <p className="topup-caption">
                  {topupCopy.captions[1][0]}
                  <br />
                  {topupCopy.captions[1][1]}
                </p>
                <div className="topup-letter-wrap">
                  <div className="topup-letter">M</div>
                </div>
                {copy.topupSubtitle ? (
                  <p className="muted auth-subtitle">{copy.topupSubtitle}</p>
                ) : null}
              </div>
            </section>
            <section
              className={`panel auth-panel auth-panel--topup topup-panel${
                isTopupBusy ? ' topup-panel--disabled' : ''
              }${topupLoadingTier === 'L' ? ' topup-panel--loading' : ''}`}
              style={{ width: '240px', height: '480px', maxWidth: '90vw', maxHeight: '90vh' }}
              role="button"
              tabIndex={0}
              aria-disabled={isTopupBusy}
              aria-busy={topupLoadingTier === 'L'}
              onClick={() => {
                console.log('[TOPUP REAL CLICK] L')
                void handleTopupClick('L')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  console.log('[TOPUP REAL CLICK] L')
                  void handleTopupClick('L')
                }
              }}
            >
              <div className="topup-inner">
                <div className="topup-amount">
	                  <span className="topup-amount-value">
	                    {topupLoadingTier === 'L'
	                      ? '...'
	                      : formatTopupAmountValue(topupAmountL)}
	                  </span>
	                  <span className="topup-amount-currency">{topupCurrency}</span>
	                </div>
                <p className="topup-caption">
                  {topupCopy.captions[2][0]}
                  <br />
                  {topupCopy.captions[2][1]}
                </p>
                <div className="topup-letter-wrap">
                  <div className="topup-letter">L</div>
                </div>
                {copy.topupSubtitle ? (
                  <p className="muted auth-subtitle">{copy.topupSubtitle}</p>
                ) : null}
              </div>
            </section>
          </div>
	          <p className="topup-footer">
	            {topupCopy.footer}
	          </p>
	          {uiLanguage === 'English' && (
	            <p className="muted topup-footer">All payments and account balances are processed in PLN.</p>
	          )}
	        </div>
	      </div>
	    )
	  }

  if (isPrivacy) {
    const privacyCopy =
      uiLanguage === 'Polish'
        ? {
            title: 'Polityka prywatności',
            body: [
              'Aplikacja MakeMyIdea.work zbiera podstawowe dane użytkownika, takie jak adres email oraz identyfikator konta Google, wyłącznie w celu umożliwienia logowania i korzystania z aplikacji.',
              'Dane mogą być przetwarzane przez zewnętrznych dostawców usług, takich jak Supabase (baza danych) oraz OpenAI (przetwarzanie AI).',
              'Dane nie są sprzedawane ani udostępniane osobom trzecim w celach marketingowych.',
              'Kontakt: makemyideawork@aremai.tech',
            ],
            back: 'Wróć',
          }
        : {
            title: 'Privacy Policy',
            body: [
              'The MakeMyIdea.work application collects basic user data, such as email address and Google account identifier, solely to enable login and use of the application.',
              'Data may be processed by external service providers such as Supabase (database) and OpenAI (AI processing).',
              'Data is not sold or shared with third parties for marketing purposes.',
              'Contact: makemyideawork@aremai.tech',
            ],
            back: 'Back',
          }

    return withDevOverlay(
      <div className="app privacy-page">
        <section className="privacy-panel">
          <div className="privacy-header">
            <img className="privacy-logo" src={landingLogoUrl} alt="MakeMyIdea.work" />
          </div>
          <h1>{privacyCopy.title}</h1>
          <div className="privacy-sections">
            {privacyCopy.body.map((paragraph) => (
              <p key={paragraph} className="privacy-paragraph">
                {paragraph}
              </p>
            ))}
          </div>
          <div className="privacy-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (typeof window === 'undefined') return
                if (window.history.length > 1) {
                  window.history.back()
                } else {
                  safeNavigate('/')
                }
              }}
            >
              {privacyCopy.back}
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (isLogin) {
    if (showSupabaseConfigError) {
      return withDevOverlay(
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <h1>{notices.supabaseConfigTitle}</h1>
            <p className="muted">{notices.supabaseConfigBody}</p>
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
          <button
            type="button"
            className="auth-logo"
            onClick={() => {
              if (typeof window !== 'undefined') {
                safeNavigate('/')
              }
            }}
          >
            <img src={landingLogoUrl} alt="MakeMyIdea.work" />
          </button>
          <h1>{copy.loginTitle}</h1>
          {import.meta.env.DEV && (
            <div className="actions">
              <button type="button" className="ghost" onClick={() => void resetAuthDev()}>
                {copy.loginDevResetAuth}
              </button>
            </div>
          )}
          {!hasSupabaseEnv && (
            <p className="engine-error">{missingSupabaseEnvMessage}</p>
          )}
          <p className="muted auth-subtitle">{copy.loginSubtitle}</p>
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
                  <span>{copy.loginPasswordToggleLabel}</span>
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
                      placeholder={copy.loginPasswordPlaceholder}
                    />
                  </div>
                  <div className="actions">
                  <button
                    type="button"
                    className={loginAuthMode === 'signin' ? 'primary' : 'ghost'}
                    onClick={() => setLoginAuthMode('signin')}
                    disabled={authDisabled}
                  >
                      {copy.loginPasswordSignIn}
                    </button>
                  <button
                    type="button"
                    className={loginAuthMode === 'signup' ? 'primary' : 'ghost'}
                    onClick={() => setLoginAuthMode('signup')}
                    disabled={authDisabled}
                  >
                      {copy.loginPasswordSignUp}
                    </button>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={handlePasswordAuth}
                      disabled={loginSending || authDisabled}
                    >
                      {loginSending
                        ? '...'
                        : loginAuthMode === 'signin'
                          ? copy.loginPasswordSignIn
                          : copy.loginPasswordSignUp}
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
                        ? copy.loginEmailCooldown(loginCooldownSeconds)
                        : copy.loginEmailCta}
                  </button>
                </div>
              )}
              {import.meta.env.DEV && !loginUsePassword && (
                <p className="muted">
                  {copy.loginDevSmtpNotice}
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

  if (isAdminRoute) {
    return withDevOverlay(
      <AdminPage authLoading={authLoading} uiLanguage={uiLanguage} />
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
            <h1>{notices.supabaseConfigTitle}</h1>
            <p className="muted">{notices.supabaseConfigBody}</p>
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
            {isAuthFlowInProgress() ? (
              <h1>{copy.loginCallbackTitle}</h1>
            ) : (
              <p className="muted">{notices.loading}</p>
            )}
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
              {notices.redirectingToLogin}
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
      return `${notices.sessionLabelPrefix} ${shortId}`
    }

  const engineRemainingWords = Math.max(0, WORD_LIMIT - countWords(enginePreviewInput))
  const isEngineWordLimitReached =
    enginePreviewInput.trim().length > 0 && countWords(enginePreviewInput) >= WORD_LIMIT
  const hasEngineDraftContent =
    Boolean(enginePreviewInput.trim()) || enginePreviewVoiceState === 'listening'
  const showEngineDraftRemove = Boolean(engineDraftTargetSection) && hasEngineDraftContent
  const engineDraftToneClass =
    engineDraftTargetSection === 'as_is'
      ? 'is-as-is'
      : engineDraftTargetSection === 'not_working'
        ? 'is-not-working'
        : engineDraftTargetSection === 'should_be'
          ? 'is-should-be'
          : ''
  const engineInitialBriefDisplayedText = getEngineInitialBriefDisplayedText()
  const engineInitialBriefWords = countWords(engineInitialBriefDisplayedText)
  const engineInitialBriefMeaningfulWords = getMeaningfulWords(engineInitialBriefDisplayedText)
  const hasEnoughEngineInitialBriefContent =
    engineInitialBriefMeaningfulWords.length >= INITIAL_BRIEF_MIN_MEANINGFUL_WORDS &&
    new Set(engineInitialBriefMeaningfulWords).size >= INITIAL_BRIEF_MIN_DISTINCT_MEANINGFUL_WORDS
  const engineInitialBriefRemainingWords = Math.max(
    0,
    INITIAL_BRIEF_WORD_LIMIT - engineInitialBriefWords
  )
  const engineInitialBriefRecommendedProgress = Math.min(
    engineInitialBriefWords / INITIAL_BRIEF_RECOMMENDED_WORD_TARGET,
    1
  )
  const engineInitialBriefRecommendedPercent = Math.round(
    engineInitialBriefRecommendedProgress * 100
  )
  const engineInitialBriefLengthState =
    engineInitialBriefWords >= INITIAL_BRIEF_RECOMMENDED_WORD_TARGET
      ? 'enough'
      : engineInitialBriefWords >= 120
        ? 'strong'
        : engineInitialBriefWords >= 40
          ? 'useful'
          : 'low'
  const engineInitialBriefLengthStatus =
    engineInitialBriefLengthState === 'enough'
      ? copy.engineInitialBriefLengthEnough
      : engineInitialBriefLengthState === 'strong'
        ? copy.engineInitialBriefLengthStrong
        : engineInitialBriefLengthState === 'useful'
          ? copy.engineInitialBriefLengthUseful
          : copy.engineInitialBriefLengthLow
  const engineInitialBriefLengthMessage =
    engineInitialBriefLengthState === 'low'
      ? copy.engineInitialBriefLengthIntro
      : engineInitialBriefLengthStatus
  const isEngineInitialBriefLimitReached =
    engineInitialBriefDisplayedText.trim().length > 0 &&
    engineInitialBriefWords >= INITIAL_BRIEF_WORD_LIMIT
  const showEngineInputCaret = !engineInputFocused && !enginePreviewInput.trim()
  const showFacilitationOffer =
    engineUiState === 'FACILITATION_OFFER' ||
    engineOfferReason === 'idle' ||
    engineOfferReason === 'manual'
  const showHelpButton = !showFacilitationOffer
  const facilitationDisabled = !engineSessionPersisted || !enginePreviewSessionId
  const facilitationPerspectiveActions: Array<{
    key: FacilitationPerspective
    label: string
    toneClass: 'is-as-is' | 'is-not-working' | 'is-should-be'
    testId: string
  }> = [
    {
      key: 'as_is',
      label: copy.engineFacilitationAsIs,
      toneClass: 'is-as-is',
      testId: 'facilitation-as-is',
    },
    {
      key: 'not_working',
      label: copy.engineFacilitationProblem,
      toneClass: 'is-not-working',
      testId: 'facilitation-not-working',
    },
    {
      key: 'should_be',
      label: copy.engineFacilitationDesired,
      toneClass: 'is-should-be',
      testId: 'facilitation-should-be',
    },
  ]
  const resolveEntryQuestionHelperText = (item: EngineBoardItem) => {
    const primary =
      uiLanguage === 'Polish'
        ? item.question_text_pl ?? item.question_text_en ?? null
        : item.question_text_en ?? item.question_text_pl ?? null
    const questionText = sanitizeInlineHelperText(primary)
    return questionText || copy.engineEntryQuestionFallback
  }
  const formatBalanceMinor = (minor: number) => {
    const locale = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.max(0, minor || 0) / 100)
    return `${formatted} PLN`
  }
  const formatSessionCreatePrice = (minor: number | null) => {
    if (minor == null || !Number.isFinite(minor)) return '—'
    const amount = Math.max(0, minor) / 100
    const locale = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
    return uiLanguage === 'Polish' ? `${formatted} zł` : `PLN ${formatted}`
  }
  const engineInitialBriefSubmitLabel =
    !hasEnoughEngineInitialBriefContent
      ? copy.engineInitialBriefNeedsMoreInfo
      : authSession?.user?.id && client
      ? `${copy.engineInitialBriefSubmit} (${formatSessionCreatePrice(sessionCreatePriceMinor)})`
      : copy.engineInitialBriefSubmit

    return withDevOverlay(
      <div className="app engine-preview" data-testid="active-session">
        <header className="engine-header">
          <div>
            <div className="engine-header-logo">
              <img src={landingLogoUrl} alt="MakeMyIdea.Work" />
            </div>
          </div>
          {isAuthed && !logoutInProgress && (
            <div className="engine-header-balance" aria-live="polite">
              <div className="engine-balance-row">
                <div
                  className={`engine-balance${
                    billingAccount.loading || billingAccount.error ? ' engine-balance--loading' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      storeTopupReturnTo()
                      window.location.hash = '#/topup'
                      setHashPath('/topup')
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (typeof window !== 'undefined') {
                        storeTopupReturnTo()
                        window.location.hash = '#/topup'
                        setHashPath('/topup')
                      }
                    }
                  }}
                >
                  <button
                    type="button"
                    className="engine-balance-icon"
                    aria-label={uiLanguage === 'Polish' ? 'Doładuj konto' : 'Top up'}
                  >
                    💰
                  </button>
	                  <span className="engine-balance-value">
	                    {billingAccount.loading || billingAccount.error
	                      ? '—'
	                      : formatBalanceMinor(
	                          billingBalanceOverrideMinor ?? billingAccount.balanceMinor
	                        )}
	                  </span>
	                </div>
                {insufficientBalanceState.active && (
                  <span className="engine-balance-warning">
                    {copy.insufficientBalanceNotice}
                  </span>
                )}
                {engineNotice && !logoutInProgress && (
                  <span className={`engine-notice engine-notice--${engineNotice.variant} engine-notice--inline`}>
                    {engineNotice.message}
                  </span>
                )}
              </div>
            </div>
          )}
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
            {isAdmin && (
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.hash = '#/admin'
                  }
                }}
              >
                {copy.adminNavLabel}
              </button>
            )}
            <button className="ghost" type="button" onClick={handleLogout}>
              {copy.auth.logout}
            </button>
            {isDiagEnabled() && (
              <span className="muted">
                {copy.diagnosticsAuthLabel}: {authSession?.user?.email ?? '—'}
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
                {showSessionUsage && (
                  <>
                    <button
                      className={`ai-support-toggle llm-usage-indicator ${llmUsageClass}`}
                      type="button"
                      aria-label={copy.llmUsageIndicatorLabel}
                      title={copy.llmUsageIndicatorLabel}
                      disabled
                    >
                      {`${formatTokenTotal(currentTokensTotal)} tok`}
                    </button>
                    <div className="llm-cost-panel" aria-live="polite">
                      <div className="llm-cost-line">
                        {copy.llmCostLabel(formatUsd(totalCostUsd))}
                      </div>
                      <div className="llm-cost-line">
                        {totalCostPln != null
                          ? copy.llmCostPlnLabel(formatPln(totalCostPln || 0))
                          : copy.llmCostPlnFallback}
                      </div>
                      <details className="llm-cost-details">
                        <summary>{copy.llmCostBreakdown}</summary>
                        <div className="llm-cost-breakdown">
                          <div className="llm-cost-row">
                            {copy.llmCostTotalTokens(formatTokenTotal(sessionUsage.totalTokens))}
                          </div>
                          <div className="llm-cost-row">
                            {copy.llmCostTotalUsd(formatUsd(totalCostUsd))}
                          </div>
                          <div className="llm-cost-row">
                            {totalCostPln != null
                              ? copy.llmCostTotalPln(formatPln(totalCostPln || 0))
                              : copy.llmCostTotalPlnFallback}
                          </div>
                          {modelUsageEntries.map(([model, usage]) => (
                            <div key={model} className="llm-cost-row">
                              {copy.llmCostModelRow(
                                model,
                                formatTokenTotal(usage.inputTokens),
                                formatTokenTotal(usage.outputTokens),
                                formatUsd(usage.totalUSD)
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </header>
        {authDisabled && (
          <div className="engine-error" role="status">
            {missingSupabaseEnvMessage}
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
                {enginePreviewSessionId && hasEngineBoardEntries && (
                  <div className="engine-actions-group">
                    {(() => {
                      const currentSessionId = enginePreviewSessionId
                      const reportMeta = getReportMetaForSession(currentSessionId)
                      const reportLookupResolved =
                        !authSession?.user?.id ||
                        Object.prototype.hasOwnProperty.call(reportRecords, currentSessionId) ||
                        Boolean(reportMeta?.id)
                      const hasReport = Boolean(
                        currentSessionId && (reportRecords[currentSessionId]?.id || reportMeta?.id)
                      )
                      if (!reportLookupResolved) return null
                      if (hasReport) {
                        return (
                          <button
                            type="button"
                            className="primary"
                            data-testid="session-report"
                            onClick={() => {
                              markUserInitiatedInteraction('pointer')
                              setEngineLastInputActivityAt(Date.now())
                              goToActionPlan()
                            }}
                          >
                            {copy.enginePreviewOpenReport}
                          </button>
                        )
                      }
                      return (
                        <AiCostButton
                          label={copy.enginePreviewCreateReport}
                          lang={uiLanguage === 'Polish' ? 'pl' : 'en'}
                          priceMinor={reportCreatePriceMinor}
                          currency={balanceCurrency}
                          priceLoading={reportCreatePriceLoading}
                          loading={reportNavigationLoading}
                          disabled={reportNavigationLoading}
                          className="engine-create-report-btn"
                          metaLayout="below"
                          onClick={() => {
                            markUserInitiatedInteraction('pointer')
                            setEngineLastInputActivityAt(Date.now())
                            void handleReportNavigation()
                          }}
                        />
                      )
                    })()}
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
                                      {notices.editAction}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost danger"
                                      onClick={() => deleteEngineItem(item.id)}
                                      disabled={engineEditLoading}
                                    >
                                      {notices.deleteAction}
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

        {engineSessionsOpen && showDiagnostics && (
          <section className="engine-panel">
            <div className="engine-panel-header">
              <h2>
                {uiLanguage === 'Polish'
                  ? 'Narzędzia diagnostyczne administracyjne'
                  : 'Administrative diagnostics tools'}
              </h2>
              <div className="engine-actions">
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
            <div className="engine-helper">
              <strong>Session usage diagnostics</strong>
              <div className="engine-meta">
                <span>sessionId:</span>
                <span className="engine-meta-value">{activeUsageSessionIdNormalized || '—'}</span>
              </div>
              <div className="engine-meta">
                <span>summary query:</span>
                <span className="engine-meta-value">{sessionUsageDiagnostics.summaryQueryStatus}</span>
              </div>
              <div className="engine-meta">
                <span>events query:</span>
                <span className="engine-meta-value">{sessionUsageDiagnostics.eventsQueryStatus}</span>
              </div>
              <div className="engine-meta">
                <span>realtime:</span>
                <span className="engine-meta-value">{sessionUsageDiagnostics.realtimeStatus || '—'}</span>
              </div>
              <div className="engine-meta">
                <span>last checked:</span>
                <span className="engine-meta-value">
                  {sessionUsageDiagnostics.lastCheckedAt
                    ? new Date(sessionUsageDiagnostics.lastCheckedAt).toLocaleString()
                    : '—'}
                </span>
              </div>
              <div className="engine-meta">
                <span>gpt-image-1:</span>
                <span className="engine-meta-value">
                  {sessionUsage.perModel['gpt-image-1']
                    ? `${sessionUsage.perModel['gpt-image-1'].eventsCount} ev, ${formatTokenTotal(
                        sessionUsage.perModel['gpt-image-1'].inputTokens
                      )} in / ${formatTokenTotal(
                        sessionUsage.perModel['gpt-image-1'].outputTokens
                      )} out, $${formatUsd(sessionUsage.perModel['gpt-image-1'].totalUSD)}`
                    : '—'}
                </span>
              </div>
              {(sessionUsageDiagnostics.summaryError || sessionUsageDiagnostics.eventsError) && (
                <div className="engine-meta">
                  <span>error:</span>
                  <span className="engine-meta-value">
                    {sessionUsageDiagnostics.summaryError
                      ? `summary ${sessionUsageDiagnostics.summaryError.code || '—'}: ${sessionUsageDiagnostics.summaryError.message}`
                      : ''}
                    {sessionUsageDiagnostics.summaryError && sessionUsageDiagnostics.eventsError ? ' | ' : ''}
                    {sessionUsageDiagnostics.eventsError
                      ? `events ${sessionUsageDiagnostics.eventsError.code || '—'}: ${sessionUsageDiagnostics.eventsError.message}`
                      : ''}
                  </span>
                </div>
              )}
            </div>
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
                        setEngineNameError(notices.sessionNameRequired)
                        return
                      }
                      setEngineNameSaving(true)
                      setEngineNameError(null)
                      if (authSession?.user?.id && client) {
                        const { data: u } = await client.auth.getUser()
                        const userId = u?.user?.id ?? null
                        if (!userId) {
                          showEngineNotice(
                            notices.authSessionExpired,
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
                          setEngineNameError(notices.sessionNameCollision)
                          setEngineNameSaving(false)
                          return
                        }
                      }
                      armIdleWatch('save_and_continue')
                      engineInteractionBySession.current['new'] = true
                      setEngineInputFocused(false)
                      setEngineUiState('INIT')
                      enginePendingArmingRef.current = false
                      enginePendingFocusRef.current = false
                      const sessionId = await ensureEnginePreviewSession(name, {
                        onNameCollision: () =>
                          setEngineNameError(notices.sessionNameCollision),
                        onInsertError: () =>
                          setEngineNameError(notices.sessionNameSaveFailed),
                      })
                      if (!sessionId) {
                        setEngineNameSaving(false)
                        return
                      }
                      setEnginePreviewSessionName(name)
                      setEngineNamePromptOpen(false)
                      const shouldShowInitialBrief = Boolean(authSession?.user?.id && client)
                      setEngineInitialBriefOpen(shouldShowInitialBrief)
                      if (shouldShowInitialBrief) {
                        setEngineInitialBriefText('')
                        setEngineInitialBriefError(null)
                      } else {
                        setEngineUiState('FREE_FLOW')
                        setEngineInputFocused(true)
                        engineInputRef.current?.focus()
                      }
                      setEngineNameSaving(false)
                      if (sessionId) {
                        engineInteractionBySession.current[sessionId] = true
                        setEngineLastInputActivityAt(Date.now())
                      }
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

          {enginePreviewSessionId && engineInitialBriefOpen && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{copy.engineInitialBriefTitle}</h2>
              </div>
              <div className="engine-helper">{copy.engineInitialBriefDescription}</div>
              <div className="engine-board-input">
                <div className="engine-input-field engine-input-field-with-action">
                  <textarea
                    ref={engineInitialBriefInputRef}
                    data-testid="engine-initial-brief-input"
                    value={getEngineInitialBriefDisplayedText()}
                    onChange={(event) => {
                      if (engineInitialBriefVoiceState === 'listening') {
                        stopEngineInitialBriefRecognition('abort')
                        setEngineInitialBriefVoiceState('idle')
                        setEngineInitialBriefVoicePreview('')
                      }
                      engineInitialBriefVoiceCorrectionSeqRef.current += 1
                      applyEngineInitialBriefTextChange(event.target.value)
                    }}
                    placeholder={copy.engineInitialBriefPlaceholder}
                    rows={6}
                  />
                  <button
                    type="button"
                    className={`ghost engine-input-action engine-input-action--voice is-${engineInitialBriefVoiceState}`}
                    aria-label={
                      engineInitialBriefVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel
                    }
                    title={
                      engineInitialBriefVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : engineInitialBriefVoiceState === 'unavailable'
                          ? copy.engineInitialBriefVoiceInputUnavailable
                          : copy.engineInitialBriefVoiceInputLabel
                    }
                    onClick={toggleEngineInitialBriefVoiceInput}
                    data-testid="engine-initial-brief-voice-input"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path
                        d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
                        fill="currentColor"
                      />
                    </svg>
                    <span>
                      {engineInitialBriefVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel}
                    </span>
                  </button>
                </div>
                {engineInitialBriefError && (
                  <div className="engine-error">{engineInitialBriefError}</div>
                )}
                <div className={`engine-brief-length-guide is-${engineInitialBriefLengthState}`}>
                  <div className="engine-brief-length-guide__header">
                    <span>{copy.engineInitialBriefLengthTarget}</span>
                    <span>
                      {copy.engineInitialBriefLengthCount(
                        engineInitialBriefWords,
                        INITIAL_BRIEF_RECOMMENDED_WORD_TARGET
                      )}
                    </span>
                  </div>
                  <div
                    className="engine-brief-length-guide__bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={INITIAL_BRIEF_RECOMMENDED_WORD_TARGET}
                    aria-valuenow={Math.min(
                      engineInitialBriefWords,
                      INITIAL_BRIEF_RECOMMENDED_WORD_TARGET
                    )}
                    aria-label={copy.engineInitialBriefLengthTarget}
                  >
                    <span
                      className="engine-brief-length-guide__fill"
                      style={{ width: `${engineInitialBriefRecommendedPercent}%` }}
                    />
                  </div>
                  <div className="engine-brief-length-guide__footer">
                    <span>{engineInitialBriefLengthMessage}</span>
                  </div>
                </div>
                <div className="engine-input-footer">
                  <span className="engine-word-count">
                    {isEngineInitialBriefLimitReached
                      ? copy.engineInitialBriefWordLimitReached
                      : copy.engineInitialBriefWordCountRemaining(engineInitialBriefRemainingWords)}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    data-testid="engine-initial-brief-submit"
                    onClick={() => {
                      void submitEngineInitialBrief()
                    }}
                    disabled={
                      !hasEnoughEngineInitialBriefContent ||
                      engineInitialBriefSubmitting ||
                      engineInitialBriefWords > INITIAL_BRIEF_WORD_LIMIT ||
                      Boolean(authSession?.user?.id && client && sessionCreatePriceLoading)
                    }
                  >
                    {engineInitialBriefSubmitting && (
                      <span className="button-spinner" aria-hidden="true" />
                    )}
                    {engineInitialBriefSubmitting
                      ? copy.engineInitialBriefSubmitting
                      : engineInitialBriefSubmitLabel}
                  </button>
                </div>
              </div>
            </section>
          )}

          {enginePreviewSessionId && !engineInitialBriefOpen && (
            <>
              {actionPlanReadinessEnabled && (
                <section className="engine-panel">
                  <div className="engine-panel-header">
                    <div className="action-plan-readiness-title-row">
                      <h2>
                        {uiLanguage === 'Polish'
                          ? 'Jak zwiększyć gotowość planu działania'
                          : 'Action plan readiness guide'}
                      </h2>
                      {actionPlanReadinessLlmCache.loading && (
                        <span
                          className="button-spinner button-spinner--dark action-plan-readiness-title-spinner"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                  <div className="engine-helper">
                    {(() => {
                      if (!enginePreviewItems.length) {
                        return (
                          <div className="action-plan-readiness-layout">
                            <div className="action-plan-readiness-layout__content" />
                            <div className="action-plan-readiness-layout__gauge">
                              <ActionPlanReadinessGauge
                                score={0}
                                level="not_ready"
                                language={uiLanguage === 'Polish' ? 'pl' : 'en'}
                              />
                            </div>
                          </div>
                        )
                      }

                      // Only block content while the request is actually in-flight.
                      // `pending` is a debounce marker and can stay true while items keep changing.
                      const readinessLlmLoading = actionPlanReadinessLlmCache.loading
                      const finalScore = actionPlanReadinessHeuristic.score
                      if (readinessLlmLoading) {
                        return (
                          <div className="action-plan-readiness-layout">
                            <div className="action-plan-readiness-layout__content" />
                            <div className="action-plan-readiness-layout__gauge">
                              <ActionPlanReadinessGauge
                                score={finalScore}
                                level={
                                  actionPlanReadinessHeuristic.level === 'weak'
                                    ? 'not_ready'
                                    : actionPlanReadinessHeuristic.level === 'strong'
                                      ? 'strong_material'
                                      : 'can_proceed'
                                }
                                language={uiLanguage === 'Polish' ? 'pl' : 'en'}
                              />
                            </div>
                          </div>
                        )
                      }

                      const description = (() => {
                        if (uiLanguage === 'Polish') {
                          if (actionPlanReadinessMeaningfulCount < 3) {
                            return 'Masz jeszcze za mało wpisów, żeby plan działania był konkretny.'
                          }
                          if (
                            actionPlanReadinessMeaningfulCount >= 3 &&
                            actionPlanReadinessHeuristic.notWorkingMeaningfulCount < 3
                          ) {
                            return 'Twój materiał jest jeszcze jednostronny — skupia się na tym, jak powinno być, ale brakuje tego, co nie działa.'
                          }
                          if (actionPlanReadinessHeuristic.coverage < 2) {
                            return 'Materiał jest jeszcze wąski (brakuje perspektyw). Uzupełnij go, aby decyzje były lepiej ugruntowane.'
                          }
                          if (actionPlanReadinessHeuristic.coverage === 3) {
                            return 'Materiał jest zbalansowany i powinien dać sensowne priorytety, decyzje i kolejne kroki.'
                          }
                          return 'Materiał wygląda wystarczająco, ale można go jeszcze wzmocnić, żeby plan działania był bardziej trafny.'
                        }
                        if (actionPlanReadinessMeaningfulCount < 3) {
                          return 'There are not enough entries yet for a concrete action plan.'
                        }
                        if (
                          actionPlanReadinessMeaningfulCount >= 3 &&
                          actionPlanReadinessHeuristic.notWorkingMeaningfulCount < 3
                        ) {
                          return 'The material is still one-sided — it focuses on what should be, but misses what is not working.'
                        }
                        if (actionPlanReadinessHeuristic.coverage < 2) {
                          return 'The material is still narrow (missing perspectives). Add more for better grounded decisions.'
                        }
                        if (actionPlanReadinessHeuristic.coverage === 3) {
                          return 'The material is balanced and should yield clearer priorities, decisions, and next steps.'
                        }
                        return 'The material looks sufficient, but you can still strengthen it to make the action plan more grounded.'
                      })()

                      const llmSummary = actionPlanReadinessLlmCache.lastLLMResult?.summary || ''
                      const llmHowToBoost = actionPlanReadinessLlmCache.lastLLMResult?.howToBoost || ''
                      const llmBiggestBoostRightNow =
                        actionPlanReadinessLlmCache.lastLLMResult?.biggestBoostRightNow || ''

                      const summaryText = llmSummary || description
                      const howToBoostText =
                        llmHowToBoost ||
                        actionPlanReadinessHeuristic.improvements.slice(0, 3).join(' · ')
                      const biggestBoostRightNowText =
                        llmBiggestBoostRightNow || actionPlanReadinessHeuristic.nextBestAction || ''
                      const normalizeReadinessLine = (value: string) =>
                        String(value || '').replace(/\s+/g, ' ').trim()
                      const shouldShowHowToBoost = Boolean(
                        normalizeReadinessLine(howToBoostText) &&
                          normalizeReadinessLine(howToBoostText) !==
                            normalizeReadinessLine(biggestBoostRightNowText)
                      )
                      return (
                        <div className="action-plan-readiness-layout">
                          <div className="action-plan-readiness-layout__content">
                            <div className="action-plan-readiness-field">
                              <div className="engine-meta">
                                <span>{uiLanguage === 'Polish' ? 'Opis' : 'Summary'}</span>
                                <span className="engine-meta-value">{summaryText}</span>
                              </div>
                            </div>
                            {shouldShowHowToBoost && (
                              <div className="action-plan-readiness-field">
                                <div className="engine-meta">
                                  <span>
                                    {uiLanguage === 'Polish' ? 'Jak podnieść wynik' : 'How to boost'}
                                  </span>
                                  <span className="engine-meta-value">{howToBoostText}</span>
                                </div>
                              </div>
                            )}
                            {biggestBoostRightNowText && (
                              <div className="action-plan-readiness-field is-boost-now">
                                <div className="engine-meta">
                                  <span>
                                    {uiLanguage === 'Polish'
                                      ? 'Najbardziej pomoże teraz'
                                      : 'Biggest boost right now'}
                                  </span>
                                  <span className="engine-meta-value">{biggestBoostRightNowText}</span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="action-plan-readiness-layout__gauge">
                            <ActionPlanReadinessGauge
                              score={finalScore}
                              level={
                                actionPlanReadinessHeuristic.level === 'weak'
                                  ? 'not_ready'
                                  : actionPlanReadinessHeuristic.level === 'strong'
                                    ? 'strong_material'
                                    : 'can_proceed'
                              }
                              language={uiLanguage === 'Polish' ? 'pl' : 'en'}
                            />
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </section>
              )}

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
                        ? notices.aiDisabled
                        : !engineSessionPersisted
                          ? notices.createSessionFirst
                          : engineUnassignedItems.length === 0
                          ? notices.noNaEntries
                          : notices.assignNaAction
                    }
                  >
                    {engineAssignLoading ? notices.assignNaLoading : notices.assignNaAction}
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
              </div>
              {uiLanguage === 'English' && copy.engineQuestionsWipNote && (
                <div className="engine-helper">{copy.engineQuestionsWipNote}</div>
              )}
              <div
                className={`engine-facilitation-offer engine-facilitation-actions--fade ${
                  showFacilitationOffer ? 'is-visible' : 'is-hidden'
                }`}
                aria-hidden={!showFacilitationOffer}
              >
                <div
                  className="engine-helper engine-facilitation-note"
                  style={
                    uiLanguage === 'English'
                      ? { transform: 'translate(-75px, -5px)' }
                      : undefined
                  }
                >
                  {copy.engineFacilitationNote}
                </div>
                <div
                  className="engine-facilitation-actions"
                  data-testid="facilitation-buttons"
                >
                  {engineFacilitationInlineError && (
                    <span className="text-sm text-red-600">{engineFacilitationInlineError}</span>
                  )}
                  {facilitationPerspectiveActions.map((action) => {
                    const isActive = engineActiveFacilitationPerspective === action.key
                    return (
                      <button
                        key={action.key}
                        type="button"
                        className={`ghost engine-facilitation-perspective-button ${action.toneClass} ${
                          isActive ? 'is-active' : ''
                        }`}
                        data-testid={action.testId}
                        onClick={() => {
                          if (facilitationDisabled) {
                            setEngineFacilitationInlineError(notices.createSessionFirst)
                            return
                          }
                          const nextType = resolveFacilitationRequestType(action.key)
                          setFacilitationCooldown(`${nextType}:${action.key}`)
                          armIdleWatch(
                            nextType === 'DEEPEN'
                              ? `facilitation_continue_${action.key}`
                              : `facilitation_switch_${action.key}`
                          )
                          void activateFacilitationPrompt(nextType, action.key)
                        }}
                        disabled={
                          !showFacilitationOffer || engineFacilitationLoading || facilitationDisabled
                        }
                      >
                        {action.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {enginePreviewError && (
                <div className="engine-error">
                  <span>{enginePreviewError}</span>
                  {lastFacilitationType && lastFacilitationPerspective && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        void activateFacilitationPrompt(
                          lastFacilitationType,
                          lastFacilitationPerspective
                        )
                      }}
                    >
                      {copy.engineFacilitationRetryCta}
                    </button>
                  )}
                </div>
              )}
              <div className="engine-board-input">
                {(engineFacilitationLoading && showEngineFacilitationLoadingUI
                  ? copy.engineFacilitationLoadingPerspective
                  : engineActivePrompt?.text) && (
                  <div
                    className={`engine-helper engine-facilitation-prompt ${
                      lastFacilitationPerspective === 'as_is'
                        ? 'is-as-is'
                        : lastFacilitationPerspective === 'not_working'
                          ? 'is-not-working'
                          : lastFacilitationPerspective === 'should_be'
                            ? 'is-should-be'
                            : ''
                    }`}
                  >
                    <div className="engine-facilitation-question">
                      {engineFacilitationLoading && showEngineFacilitationLoadingUI ? (
                        <span className="engine-facilitation-loading-row">
                          <span className="button-spinner" aria-hidden="true" />
                          <span className="engine-facilitation-loading-text">
                            {engineFacilitationLoadingType === 'DEEPEN'
                              ? copy.engineFacilitationLoadingDeepen
                              : copy.engineFacilitationLoadingPerspective}
                          </span>
                        </span>
                      ) : (
                        <>
                          {showFirstQuestionWrapper && facilitationIntroRef.current ? (
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
                            ? copy.impulseSourceFallback
                            : copy.impulseSourceAi}
                        </span>
                        {import.meta.env.DEV && (
                          <span className="impulse-source-note">
                            {lastLlmSource === 'llm'
                              ? copy.impulseSourceAiGenerated
                              : copy.impulseSourceDeterministic}
                            {lastLlmWhy ? ` · ${lastLlmWhy}` : ''}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`engine-input-field engine-input-field-with-action ${
                    engineDraftToneClass ? `is-targeted ${engineDraftToneClass}` : ''
                  }`}
                >
                  {showEngineInputCaret && <span className="engine-input-caret" aria-hidden="true" />}
                  <textarea
                    data-testid="engine-input"
                    ref={engineInputRef}
                    value={enginePreviewInput}
                    onChange={(event) => {
                      if (enginePreviewVoiceState === 'listening') {
                        stopEnginePreviewRecognition('abort')
                        setEnginePreviewVoiceState('idle')
                      }
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
                  <button
                    type="button"
                    className={`ghost engine-input-action engine-input-action--voice is-${enginePreviewVoiceState}`}
                    aria-label={
                      enginePreviewVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel
                    }
                    title={
                      enginePreviewVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : enginePreviewVoiceState === 'unavailable'
                          ? copy.engineInitialBriefVoiceInputUnavailable
                          : copy.engineInitialBriefVoiceInputLabel
                    }
                    onClick={toggleEnginePreviewVoiceInput}
                    data-testid="engine-input-voice"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path
                        d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
                        fill="currentColor"
                      />
                    </svg>
                    <span>
                      {enginePreviewVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel}
                    </span>
                  </button>
                </div>
                {enginePreviewVoiceError && (
                  <div className="engine-helper">{enginePreviewVoiceError}</div>
                )}
                <div className="engine-input-footer">
                  <span className="engine-word-count">
                    {isEngineWordLimitReached
                      ? copy.engineWordLimitReached
                      : copy.engineWordCountRemaining(engineRemainingWords)}
                  </span>
                  <div className="engine-input-footer-actions">
                    {showEngineDraftRemove && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={clearEngineDraftTarget}
                      >
                        {copy.engineDraftRemoveEntry}
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary"
                      data-testid="add-entry"
                      onClick={() => {
                        if (engineAddEntryLoading) return
                        const syncedText = syncEnginePreviewVoiceTranscript()
                        if (syncedText === null) return
                        if (enginePreviewVoiceState === 'listening') {
                          stopEnginePreviewRecognition('stop')
                          setEnginePreviewVoiceState('idle')
                        }
                        markUserInitiatedInteraction('pointer')
                        setEngineLastInputActivityAt(Date.now())
                        setEngineInputFocused(true)
                        engineAllowIdleWithoutFocusRef.current = true
                        armIdleWatch('add_item')
                        engineInputRef.current?.focus()
                        void handleEnginePreviewAdd(undefined, syncedText, engineDraftTargetSection)
                      }}
                      disabled={!enginePreviewInput.trim() || engineAddEntryLoading}
                    >
                      {engineAddEntryLoading && <span className="button-spinner" aria-hidden="true" />}
                      {copy.enginePreviewAddItem}
                    </button>
                  </div>
                </div>
              </div>
              {enginePreviewItems.length === 0 ? (
                <div className="engine-empty">{copy.enginePreviewBoardItemsEmpty}</div>
              ) : (
                <div className="engine-perspective-board" key={`engine-board-${engineBoardLayoutVersion}`}>
                  {enginePerspectiveSections.map((section) => (
                    <section
                      key={section.key}
                      className={`engine-perspective-section ${section.toneClass} ${
                        engineDragOverSection === section.key ? 'is-drop-target' : ''
                      } ${engineDraggingEntryId ? 'is-drag-active' : ''}`}
                      onDragOver={(event) =>
                        handleEngineSectionDragOver(
                          event,
                          section.key as EnginePerspectiveKey,
                          section.items.length
                        )
                      }
                      onDrop={(event) =>
                        void handleEngineSectionDrop(event, section.key as EnginePerspectiveKey)
                      }
                      onDragLeave={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                        if (engineDragHoverTimerRef.current) {
                          window.clearTimeout(engineDragHoverTimerRef.current)
                          engineDragHoverTimerRef.current = null
                        }
                        enginePendingDragTargetRef.current = null
                        setEngineDragOverSection((prev) => (prev === section.key ? null : prev))
                        setEngineDragTargetIndex(null)
                      }}
                    >
                      <div className="engine-perspective-header">
                        <h3>{section.title}</h3>
                        <div className="engine-perspective-header-actions">
                          <button
                            type="button"
                            className={`engine-perspective-add-button ${
                              engineDraftTargetSection === section.key ? 'is-active' : ''
                            }`}
                            aria-label={copy.engineSectionAddEntryAria(section.title)}
                            title={copy.engineSectionAddEntryHint}
                            onClick={() => activateEngineDraftTarget(section.key as EnginePerspectiveKey)}
                          >
                            <span aria-hidden="true">+</span>
                          </button>
                          <span className="engine-perspective-count">{section.items.length}</span>
                        </div>
                      </div>
                      <ul className="engine-entry-list">
                        {(() => {
                          const renderedItems: Array<
                            | { kind: 'item'; item: EngineBoardItem; layoutClass: string; itemIndex: number }
                            | { kind: 'placeholder'; key: string; layoutClass: string }
                          > = []
                          section.items.forEach(({ item, layoutClass }, itemIndex) => {
                            if (
                              engineDraggingEntryId &&
                              engineDragOverSection === section.key &&
                              engineDragTargetIndex === itemIndex
                            ) {
                              const dragged = enginePreviewItems.find((entry) => entry.id === engineDraggingEntryId)
                              renderedItems.push({
                                kind: 'placeholder',
                                key: `placeholder-${section.key}-${itemIndex}`,
                                layoutClass: dragged ? resolveEngineEntryLayoutClass(dragged) : 'is-medium',
                              })
                            }
                            renderedItems.push({ kind: 'item', item, layoutClass, itemIndex })
                          })
                          if (
                            engineDraggingEntryId &&
                            engineDragOverSection === section.key &&
                            engineDragTargetIndex === section.items.length
                          ) {
                            const dragged = enginePreviewItems.find((entry) => entry.id === engineDraggingEntryId)
                            renderedItems.push({
                              kind: 'placeholder',
                              key: `placeholder-${section.key}-end`,
                              layoutClass: dragged ? resolveEngineEntryLayoutClass(dragged) : 'is-medium',
                            })
                          }

                          return renderedItems.map((rendered) => {
                            if (rendered.kind === 'placeholder') {
                              return (
                                <li
                                  key={rendered.key}
                                  className={`engine-entry engine-entry-placeholder ${rendered.layoutClass}`}
                                  aria-hidden="true"
                                />
                              )
                            }

                            const { item, layoutClass, itemIndex } = rendered
                            return (
                              <li
                                key={item.id}
                                ref={(node) => {
                                  if (node) {
                                    engineEntryNodesRef.current[item.id] = node
                                  } else {
                                    delete engineEntryNodesRef.current[item.id]
                                  }
                                }}
                                style={
                                  engineEntryRowSpans[item.id]
                                    ? { gridRowEnd: `span ${engineEntryRowSpans[item.id]}` }
                                    : undefined
                                }
                                className={`engine-entry ${layoutClass} ${
                                  engineDraggingEntryId === item.id ? 'is-dragging' : ''
                                } ${engineMovingEntryId === item.id ? 'is-moving' : ''} ${
                                  highlightMissingLabels && isMissingLabel(item) ? 'missing-label' : ''
                                }`}
                                data-testid={`entry-row-${item.id}`}
                                data-entry-id={item.id}
                                draggable={enginePreviewEditId !== item.id && engineMovingEntryId !== item.id}
                                onDragStart={(event) => handleEngineEntryDragStart(event, item)}
                                onDragEnd={handleEngineEntryDragEnd}
                                onDragOver={(event) =>
                                  handleEngineEntryDragOver(
                                    event,
                                    section.key as EnginePerspectiveKey,
                                    itemIndex
                                  )
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
                              {enginePreviewEditId !== item.id &&
                                engineEntryDeleteId !== item.id &&
                                engineLabelEditorId !== item.id && (
                                <div className="engine-entry-actions">
                                  <div className="engine-entry-question-help">
                                    <button
                                      type="button"
                                      className="engine-entry-question-button engine-entry-action"
                                      aria-label={copy.engineEntryQuestionHint}
                                      title={copy.engineEntryQuestionHint}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                      }}
                                    >
                                      ?
                                    </button>
                                    <div className="engine-entry-question-tooltip" role="note">
                                      {resolveEntryQuestionHelperText(item)}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="engine-entry-edit-button engine-entry-action"
                                    aria-label={copy.engineEntryEditHint}
                                    title={copy.engineEntryEditHint}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      startEnginePreviewEdit(item)
                                    }}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="engine-entry-delete-button engine-entry-action"
                                    aria-label={copy.engineEntryDeleteHint}
                                    title={copy.engineEntryDeleteHint}
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
                                    className="engine-entry-label-button engine-entry-action"
                                    aria-label={copy.engineEntryLabelActionHint}
                                    title={copy.engineEntryLabelActionHint}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setEngineLabelEditorId((prev) => (prev === item.id ? null : item.id))
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
                                        d="M10.59 13.41a1 1 0 0 1 0-1.41l6.3-6.3a3 3 0 1 1 4.24 4.24l-6.3 6.3a1 1 0 0 1-1.41 0l-2.83-2.83ZM18.3 7.1l-5.6 5.6 1.41 1.41 5.6-5.6a1 1 0 0 0-1.41-1.41ZM3 6a3 3 0 0 1 3-3h6a1 1 0 1 1 0 2H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3a1 1 0 1 1 2 0v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Z"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              )}
                              <div className="engine-entry-label-group">
                                {highlightMissingLabels && isMissingLabel(item) && (
                                  <span className="engine-entry-missing-badge">
                                    {copy.missingLabelBadge}
                                  </span>
                                )}
                                {item.label && (
                                  <span
                                    className="engine-entry-label"
                                    data-testid={`entry-label-${item.id}`}
                                    style={{
                                      backgroundColor:
                                        withAlpha(ENGINE_ENTRY_LABEL_COLORS[item.label] || '#e7ebf0'),
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
                                    ref={engineLabelSelectRef}
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
                            )
                          })
                        })()}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
              </section>
            </>
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
        {showLanding && (
          <div className="landing-logo">
            <img src={landingLogoUrl} alt="MakeMyIdea.Work" />
          </div>
        )}
        {!showLanding && (
          <div className="engine-brand">
            <div className="engine-logo">
              <img src={landingLogoUrl} alt="MakeMyIdea.Work" />
            </div>
          </div>
        )}
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
        <div className="topbar-links">
          {showLanding && (
            <a className="primary topbar-link landing-login-link" href="/login" onClick={handleLandingCtaClick}>
              {copy.landingLoginCta}
            </a>
          )}
        </div>
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
                {copy.landingHeroBullets.length > 0 && (
                  <ul className="landing-hero-bullets">
                    {copy.landingHeroBullets.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {uiLanguage === 'Polish' && (
                  <a
                    className="primary landing-cta landing-cta-video"
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
                  {copy.landingIntroTitleLines.slice(1).map((line) => (
                    <span key={line} className="title-line">
                      {line}
                    </span>
                  ))}
                </div>
                <p className="intro-subtext">
                  {copy.landingIntroSubtextLines
                    .filter((line) => line.trim().length > 0)
                    .map((line, index) => (
                      <span key={`intro-subtext-${index}`}>
                        {line.includes('{emphasis}')
                          ? line.split('{emphasis}').map((part, partIndex) =>
                              partIndex === 0 ? (
                                part
                              ) : (
                                <span key={`emphasis-${index}-${partIndex}`}>
                                  <strong>{copy.landingIntroSubtextEmphasis}</strong>
                                  {part}
                                </span>
                              )
                            )
                          : line}
                      </span>
                    ))}
                </p>
                <div className="intro-cta">
                  <a
                    className="primary landing-cta"
                    href="/login"
                    onClick={handleLandingCtaClick}
                  >
                    {copy.landingCta}
                  </a>
                  <div className="landing-microcopy">{copy.landingCtaNote}</div>
                </div>
              </div>
            </div>

            <div className="landing-section before">
              <div className="landing-inner">
                <p className="before-lead">
                  {copy.landingBeforeLead.split('\n').map((line, index) =>
                    index === 0 ? (
                      <span key="before-lead-primary">{line}</span>
                    ) : (
                      <span key={`before-lead-${index}`} className="before-lead-secondary">
                        {line}
                      </span>
                    )
                  )}
                </p>
                <ul className="icon-list negative">
                  {copy.landingBeforeList.map((item, index) =>
                    item.trim().length === 0 ? (
                      <li key={`spacer-${index}`} className="icon-list-spacer" aria-hidden="true" />
                    ) : (
                      <li
                        key={`${item}-${index}`}
                        className={item.trim().endsWith('?') ? 'before-final' : undefined}
                      >
                        {item}
                      </li>
                    )
                  )}
                </ul>
                {(copy.landingBeforeEmphasis.strong ||
                  copy.landingBeforeEmphasis.medium ||
                  copy.landingBeforeEmphasis.rest) && (
                  <div className="landing-emphasis">
                    <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                    <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                    {copy.landingBeforeEmphasis.rest}
                  </div>
                )}
              </div>
            </div>

            <div className="landing-section after">
              <div className="landing-inner">
                <p className="before-lead">
                  {copy.landingAfterLead.split('\n').map((line, index) =>
                    index === 0 ? (
                      <span key="after-lead-primary">{line}</span>
                    ) : (
                      <span key={`after-lead-${index}`} className="after-lead-secondary">
                        {line}
                      </span>
                    )
                  )}
                </p>
                <ul className="icon-list positive">
                  {copy.landingAfterList.map((item, index) =>
                    item.trim().length === 0 ? (
                      <li key={`after-spacer-${index}`} className="icon-list-spacer" aria-hidden="true" />
                    ) : (
                      <li
                        key={`${item}-${index}`}
                        className={
                          index === copy.landingAfterList.length - 1
                            ? 'after-final'
                            : item.trim().endsWith(':') || item.trim().startsWith('✅')
                              ? 'after-muted'
                              : undefined
                        }
                      >
                        {item}
                      </li>
                    )
                  )}
                </ul>
              </div>
            </div>

            <div className="landing-section how">
              <div className="landing-inner">
                <h3>{copy.landingHowTitle}</h3>
                {copy.landingHowSteps.length > 0 ? (
                  <ol className="how-steps">
                    {copy.landingHowSteps.map((step) => (
                      <li key={step.title} className="how-step">
                        <div className="how-step-title">{step.title}</div>
                        <div className="how-step-body">
                          {step.lines.map((line) => (
                            <div key={`${step.title}-${line}`}>{line}</div>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="how-lines">
                    {copy.landingHowLines.map((line, index) => (
                      <div key={`${line}-${index}`}>{line}</div>
                    ))}
                  </div>
                )}
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
                  <div className="landing-microcopy">{copy.landingCtaNote}</div>
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
                  {copy.landingBackToFull}
                </button>
              </div>
            </div>

            <div className="landing-section intro">
              <div className="landing-inner">
                <div className="intro-title">
                  <span className="title-brand">{copy.landingIntroTitleLines[0]}</span>
                  {copy.landingIntroTitleLines.slice(1).map((line) => (
                    <span key={line} className="title-line">
                      {line}
                    </span>
                  ))}
                </div>
                <p className="intro-subtext">
                  {copy.landingIntroSubtextLines
                    .filter((line) => line.trim().length > 0)
                    .map((line, index) => (
                      <span key={`intro-subtext-three-${index}`}>
                        {line.includes('{emphasis}')
                          ? line.split('{emphasis}').map((part, partIndex) =>
                              partIndex === 0 ? (
                                part
                              ) : (
                                <span key={`emphasis-three-${index}-${partIndex}`}>
                                  <strong>{copy.landingIntroSubtextEmphasis}</strong>
                                  {part}
                                </span>
                              )
                            )
                          : line}
                      </span>
                    ))}
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
                <p className="before-lead">
                  {copy.landingBeforeLead.split('\n').map((line, index) =>
                    index === 0 ? (
                      <span key="before-lead-primary">{line}</span>
                    ) : (
                      <span key={`before-lead-${index}`} className="before-lead-secondary">
                        {line}
                      </span>
                    )
                  )}
                </p>
                <ul className="icon-list negative">
                  {copy.landingBeforeList.map((item, index) =>
                    item.trim().length === 0 ? (
                      <li key={`spacer-${index}`} className="icon-list-spacer" aria-hidden="true" />
                    ) : (
                      <li
                        key={`${item}-${index}`}
                        className={item.trim().endsWith('?') ? 'before-final' : undefined}
                      >
                        {item}
                      </li>
                    )
                  )}
                </ul>
                {(copy.landingBeforeEmphasis.strong ||
                  copy.landingBeforeEmphasis.medium ||
                  copy.landingBeforeEmphasis.rest) && (
                  <div className="landing-emphasis">
                    <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                    <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                    {copy.landingBeforeEmphasis.rest}
                  </div>
                )}
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
                  <div className="landing-microcopy">{copy.landingCtaNote}</div>
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
                  {showSuggestLoadingUI ? copy.engineFacilitationLoadingLabel : copy.impulseButtonLabel}
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
                  style={{ backgroundColor: withAlpha(label.color) }}
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
                disabled
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
      {showLanding && (
        <footer className="landing-bottom-bar">
          <a className="ghost landing-bottom-link" href="/privacy">
            {copy.landingPrivacyTitle}
          </a>
          <a
            className="landing-bottom-logo-link"
            href="https://www.aremai.tech"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="AremAI website"
          >
            <img
              className="landing-bottom-logo"
              src={new URL('/logo/aremai_logo.png.webp', import.meta.url).href}
              alt="AremAI"
              loading="lazy"
            />
          </a>
        </footer>
      )}
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
                        ? { backgroundColor: withAlpha(color), borderColor: color }
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
                      backgroundColor: withAlpha(label.color),
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
                    <p className="muted">{copy.engineFacilitationLoadingPerspective}</p>
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
                    {impulseSource === 'fallback'
                      ? copy.impulseSourceFallback
                      : copy.impulseSourceAi}
                  </span>
                  {import.meta.env.DEV && (
                    <span className="impulse-source-note">
                      {lastLlmSource === 'llm'
                        ? copy.impulseSourceAiGenerated
                        : copy.impulseSourceDeterministic}
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
                  disabled
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
                      style={{ backgroundColor: withAlpha(label.color) }}
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
                        ? { backgroundColor: withAlpha(color), borderColor: color }
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
                      backgroundColor: withAlpha(label.color),
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
