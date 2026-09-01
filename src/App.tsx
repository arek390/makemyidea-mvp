import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from 'react'
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
import { EngineHeader } from './components/EngineHeader'
import { TopupPage } from './billing/TopupPage'
import { termsAndConditionsEn, termsAndConditionsPl } from './legal/termsAndConditions'
import { MobileLanding, type MobileLandingLanguage } from './mobile/MobileLanding'
import { Engine1Container } from './engine1/Engine1Container'
import { Engine1LegacyRoute } from './engine1/Engine1LegacyRoute'
import { Engine2Route } from './engine2/Engine2Route'
import { createTranslationResolver } from './content/copy'
import { BlogPage } from './content/BlogPage'
import { resolveSite } from './sites/siteConfig'
import type { BlogId, Language, Translations } from './content/copy'
export type {
  BlogArticleContent,
  BlogArticleTextSegment,
  BlogId,
  Language,
  Translations,
} from './content/copy'
import {
  DEFAULT_IDLE_THRESHOLD_MS,
  ENGINE_PERSPECTIVE_KEYS,
  ENGINE_SORT_GAP,
  ERASE_EMPTY_SECONDS_STRONG,
  FACILITATION_PERSPECTIVE_MODE,
  INITIAL_BRIEF_MIN_DISTINCT_MEANINGFUL_WORDS,
  INITIAL_BRIEF_MIN_MEANINGFUL_WORDS,
  INITIAL_BRIEF_WORD_LIMIT,
  MAX_AUTO_CLASSIFY,
  SHORT_ENTRY_WORDS,
  WORD_LIMIT,
} from './engine1/constants'
import type {
  ActionPlanReadinessLlmResult,
  AiQuestion,
  EnginePerspectiveKey,
  FacilitationPerspective,
  FacilitationPrompt,
  FacilitationType,
  SpeechRecognitionLike,
} from './engine1/types'
import {
  applyTextEditClassification,
  cellCodeToMatrix,
  getEntryCellId,
  getMeaningfulWords,
  getSpeechRecognitionCtor,
  modeToFacilitationPerspective,
  normalizeBoardItem,
  normalizeBoardItems,
  normalizeEngineBoardEntryForLlm,
  normalizeSuggestResponse,
  perspectiveToAllowedCellIds,
  toMatrixColKey,
  toMatrixRowKey,
} from './engine1/utils'

export type StepId = 1 | 2 | 3 | 4
type ExampleId = 'example-1' | 'example-2' | 'example-3'
export type SpaceSlot = 'supersystem' | 'subsystem'
export type TimeSlot = 'past' | 'now' | 'future'

export type Scenario = {
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

export type Idea = {
  id: string
  text: string
  source: 'user' | 'llm'
}

export type OptionItem = {
  id: number
  label: string
  kind: 'world' | 'element'
}

export type TimeOptionItem = {
  id: number
  label: string
}

export type LabelItem = {
  id: string
  text: string
  color: string
}


type BlogRouteInfo = {
  id: BlogId
  language: Language
  slug: string
}

const blogArticleSlugs: Record<Language, Record<BlogId, string>> = {
  English: {
    'blog-1': 'you-dont-need-more-ideas-you-need-better-questions-en',
    'blog-2': 'from-sales-pitch-to-action-plan-in-15-minutes-en',
    'blog-3': 'can-ai-save-your-weekend-en',
  },
  Polish: {
    'blog-1': 'you-dont-need-more-ideas-you-need-better-questions-pl',
    'blog-2': 'from-sales-pitch-to-action-plan-in-15-minutes-pl',
    'blog-3': 'can-ai-save-your-weekend-pl',
  },
}

const getBlogRouteBySlug = (slug: string): BlogRouteInfo | null => {
  const normalizedSlug = slug.trim().toLowerCase()
  const languages: Language[] = ['English', 'Polish']
  for (const language of languages) {
    const entries = Object.entries(blogArticleSlugs[language]) as [BlogId, string][]
    const match = entries.find(([, itemSlug]) => itemSlug === normalizedSlug)
    if (match) return { id: match[0], language, slug: match[1] }
  }
  return null
}

const getBlogRouteFromPath = (path: string): BlogRouteInfo | null => {
  const normalizedPath = path.replace(/\/+$/, '')
  if (!normalizedPath.startsWith('/blog/')) return null
  let slug = ''
  try {
    slug = decodeURIComponent(normalizedPath.slice('/blog/'.length))
  } catch {
    return null
  }
  return getBlogRouteBySlug(slug)
}

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

export type ModelUsage = { inputTokens: number; outputTokens: number; totalUSD: number; eventsCount: number }
export type SessionUsage = {
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
    (targetString.startsWith(CANONICAL_URL) ||
      targetString.startsWith(`https://${CANONICAL_HOST}`))
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

const site = resolveSite(
  typeof window !== 'undefined'
    ? window.location.hostname
    : ''
)
const CANONICAL_URL = site.canonicalUrl
const CANONICAL_HOST = site.canonicalHost
const CANONICAL_DISPLAY_HOST = site.canonicalDisplayHost

const getTranslations = createTranslationResolver({
  canonicalDisplayHost: CANONICAL_DISPLAY_HOST,
  blogArticleSlugs,
})
const polishTranslations = getTranslations('Polish')

const withAlpha = (hexColor: string, alphaHex = '66') => {
  const value = String(hexColor || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(value) ? `${value}${alphaHex}` : value
}

const createEmptySessionUsage = (): SessionUsage => ({
  perModel: {},
  totalUSD: 0,
  totalPLN: null,
  totalTokens: 0,
})

import { fetchFxUsdPlnRate, getFreshFxRate } from './lib/fx'

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

const exampleIds: ExampleId[] = ['example-1', 'example-2', 'example-3']
const blogIds: BlogId[] = ['blog-1', 'blog-2', 'blog-3']

function ExamplesPage({
  copy,
  logoUrl,
  selectedExampleId,
  onSelectExample,
}: {
  copy: Translations
  logoUrl: string
  selectedExampleId: ExampleId | null
  onSelectExample: (exampleId: ExampleId) => void
}) {
  const selectedIndex = selectedExampleId ? exampleIds.indexOf(selectedExampleId) : -1
  const selectedItem = selectedIndex >= 0 ? copy.examplesItems[selectedIndex] : null
  const previewSections = [
    copy.examplesSectionInitialInput,
    copy.examplesSectionGeneratedReport,
    copy.examplesSectionActionPlan,
  ]

  return (
    <div className="app examples-page">
      <header className="top-bar examples-top">
        <a className="examples-logo" href="/">
          <img src={logoUrl} alt="MakeMyIdea.Work" />
        </a>
        <a className="ghost examples-home-link" href="/">
          {copy.examplesBackHome}
        </a>
      </header>

      <main className="examples-main">
        <section className="examples-hero">
          <div className="examples-inner">
            <h1>{copy.examplesTitle}</h1>
            <p>{copy.examplesDescription}</p>

            <div className="examples-grid" role="tablist" aria-label={copy.examplesTitle}>
              {copy.examplesItems.map((item, index) => {
                const exampleId = exampleIds[index] ?? 'example-1'
                const isActive = selectedExampleId === exampleId
                return (
                  <button
                    key={exampleId}
                    type="button"
                    className={`examples-card ${isActive ? 'active' : ''}`}
                    onClick={() => onSelectExample(exampleId)}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <span className="examples-card-title">{item.title}</span>
                    <span className="examples-card-description">{item.description}</span>
                  </button>
                )
              })}
            </div>

            {selectedItem && (
              <section className="examples-preview" aria-labelledby="examples-preview-title">
                <div className="examples-preview-header">
                  <h2 id="examples-preview-title">{selectedItem.title}</h2>
                  <p>{selectedItem.description}</p>
                </div>
                <div className="examples-preview-sections">
                  {previewSections.map((sectionTitle) => (
                    <article className="examples-preview-section" key={sectionTitle}>
                      <h3>{sectionTitle}</h3>
                      <p>{copy.examplesPlaceholder}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>
      </main>
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
  const [selectedExampleId, setSelectedExampleId] = useState<ExampleId | null>(null)
  const [selectedBlogId, setSelectedBlogId] = useState<BlogId | null>(null)
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
  const [topupLoadingTier, setTopupLoadingTier] = useState<'S' | 'M' | 'L' | null>(null)
  const [topupTermsAccepted, setTopupTermsAccepted] = useState(false)
  const [topupDigitalServicesAccepted, setTopupDigitalServicesAccepted] = useState(false)
  const [topupPaymentProvider, setTopupPaymentProvider] = useState<'autopay' | 'stripe'>('autopay')

  const suggestDiagEnabled =
    import.meta.env.VITE_SUGGEST_DIAG === '1' || diagnosticsEnabledForUser
  const showDiagnostics = diagnosticsEnabledForUser
  const seedClassificationMode =
    String(import.meta.env.VITE_SEED_CLASSIFICATION_MODE || '').trim() || 'full_3x3 (default)'
  const useColumnFirstSeedMode = seedClassificationMode === 'column_first'
  // This section is part of the standard Engine view (not diagnostics-only).
  const isEnvEnabled = (value: unknown) => {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized === '1' || normalized === 'true'
  }
  const stripeTopupEnabled = isEnvEnabled(import.meta.env.VITE_STRIPE_ENABLED)
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
  const [engineInitialBriefOpen, setEngineInitialBriefOpen] = useState(false)
  const [engineInitialBriefText, setEngineInitialBriefText] = useState('')
  const [engineInitialBriefError, setEngineInitialBriefError] = useState<string | null>(null)
  const [engineInitialBriefSubmitting, setEngineInitialBriefSubmitting] = useState(false)
  const [engineInitialBriefVoicePreview, setEngineInitialBriefVoicePreview] = useState('')
  const [engineInitialBriefVoiceState, setEngineInitialBriefVoiceState] = useState<
    'idle' | 'listening' | 'unavailable'
  >(() => (getSpeechRecognitionCtor() ? 'idle' : 'unavailable'))
  const [enginePreviewItems, setEnginePreviewItems] = useState<EngineBoardItem[]>([])
  const enginePreviewItemsRef = useRef<EngineBoardItem[]>([])
  useEffect(() => {
    enginePreviewItemsRef.current = enginePreviewItems
  }, [enginePreviewItems])
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
  const stripePaymentReturnHandledRef = useRef(false)
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
  const [engineEditResetSignal, setEngineEditResetSignal] = useState(0)
  const [engineEditLoading, setEngineEditLoading] = useState(false)
  const [engineAssignLoading, setEngineAssignLoading] = useState(false)
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
  const [engineMovingEntryId, setEngineMovingEntryId] = useState<string | null>(null)
  const [engineMatrixVisible] = useState(false)
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

  const readAuthDestinationFromSearch = () => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return normalizeNextPath(params.get('returnTo')) || normalizeNextPath(params.get('next'))
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
  const getTopupHashParams = () => {
    if (typeof window === 'undefined') return new URLSearchParams()
    const hash = window.location.hash || ''
    const queryIndex = hash.indexOf('?')
    if (queryIndex < 0) return new URLSearchParams()
    return new URLSearchParams(hash.slice(queryIndex + 1))
  }
  const getStripeReturnParams = () => {
    if (typeof window === 'undefined') return new URLSearchParams()
    const searchParams = new URLSearchParams(window.location.search || '')
    const payment = searchParams.get('payment')
    if (payment === 'stripe_success' || payment === 'stripe_cancelled') return searchParams
    return getTopupHashParams()
  }
  const clearStripeReturnParams = () => {
    if (typeof window === 'undefined') return
    const searchParams = new URLSearchParams(window.location.search || '')
    const searchPayment = searchParams.get('payment')
    if (searchPayment === 'stripe_success' || searchPayment === 'stripe_cancelled') {
      searchParams.delete('payment')
      searchParams.delete('session_id')
      const search = searchParams.toString()
      const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash || ''}`
      window.history.replaceState({}, '', nextUrl)
      return
    }

    const hash = window.location.hash || ''
    const queryIndex = hash.indexOf('?')
    if (queryIndex < 0) return
    const hashPathOnly = hash.slice(0, queryIndex)
    const hashParams = new URLSearchParams(hash.slice(queryIndex + 1))
    const hashPayment = hashParams.get('payment')
    if (hashPayment !== 'stripe_success' && hashPayment !== 'stripe_cancelled') return
    hashParams.delete('payment')
    hashParams.delete('session_id')
    const nextHashParams = hashParams.toString()
    const nextUrl = `${window.location.pathname}${window.location.search || ''}${hashPathOnly}${nextHashParams ? `?${nextHashParams}` : ''}`
    window.history.replaceState({}, '', nextUrl)
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
  const isEnginePublicPreview = normalizedPath === '/engine_2'
  const isReportPath = normalizedPath === '/report' || normalizedPath.endsWith('/report')
  const isReport = isReportPath || reportViewOpen
  const isWorkInProgress = normalizedPath === '/wip'
  const isIdeaGrid = normalizedPath === '/grid'
  const isExamples = normalizedPath === '/examples'
  const isBlog = normalizedPath === '/blog' || normalizedPath.startsWith('/blog/')
  const blogRoute = getBlogRouteFromPath(normalizedPath)
  const isLogin = normalizedPath === '/login'
  const isPrivacy = normalizedPath === '/privacy'
  const isTermsAndConditions = normalizedPath === '/termsandconditions'
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
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (stripePaymentReturnHandledRef.current) return
    const params = getStripeReturnParams()
    const payment = params.get('payment')
    if (payment !== 'stripe_success' && payment !== 'stripe_cancelled') return
    if (payment === 'stripe_success' && !authSession?.user?.id) return

    stripePaymentReturnHandledRef.current = true
    const isPl = uiLanguage === 'Polish'
    const stripePaymentCancelled = isPl
      ? 'Płatność anulowana. Saldo nie zostało zmienione.'
      : 'Payment cancelled. Your balance was not changed.'
    const stripePaymentConfirming = isPl
      ? 'Płatność zakończona. Potwierdzamy ją w Stripe. Saldo zaktualizuje się za chwilę.'
      : 'Payment completed. We are confirming it with Stripe. Your balance will update shortly.'
    const stripeBalanceUpdated = isPl ? 'Saldo zaktualizowane.' : 'Balance updated.'
    const stripeWaitingConfirmation = isPl ? 'Czekamy na potwierdzenie płatności.' : 'Waiting for confirmation.'
    clearStripeReturnParams()
    if (payment === 'stripe_cancelled') {
      showEngineNotice(stripePaymentCancelled, 'error')
      return
    }

    const sessionId = params.get('session_id')
    showEngineNotice(stripePaymentConfirming, 'success')
    if (!sessionId) return

    let cancelled = false
    const checkPaymentStatus = async (attempt = 0) => {
      try {
        const response = await apiFetch(
          `/api/billing?action=payment_status&provider=stripe&session_id=${encodeURIComponent(sessionId)}`,
          { method: 'GET' }
        )
        const payload = await response.json().catch(() => null)
        if (cancelled) return
        if (response.ok && payload?.status === 'paid') {
          showEngineNotice(stripeBalanceUpdated, 'success')
          void refreshBillingBalance()
          return
        }
        if (response.ok && payload?.status === 'pending' && attempt < 3) {
          showEngineNotice(stripeWaitingConfirmation, 'success')
          window.setTimeout(() => {
            void checkPaymentStatus(attempt + 1)
          }, 2000)
        }
      } catch {
        // The webhook may still be in flight; the next balance refresh will catch up.
      }
    }
    void checkPaymentStatus()
    return () => {
      cancelled = true
    }
  }, [
    appPath,
    authSession?.user?.id,
    normalizedPath,
    refreshBillingBalance,
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

  const handleStripeTopup = async (tier: 'S' | 'M' | 'L') => {
    if (topupLoadingTier) return
    if (!authSession?.user?.id) {
      showEngineNotice(notices.topupUnauthorized, 'error')
      return
    }
    const topup = resolveAutopayTopupMinor(tier)
    setTopupLoadingTier(tier)
    try {
      const amountPln = (topup.amountMinor / 100).toFixed(2)
      const returnTo =
        typeof window !== 'undefined'
          ? window.sessionStorage.getItem(TOPUP_RETURN_TO_KEY) || '/engine'
          : '/engine'
      const response = await apiFetch('/api/billing?action=create_stripe_checkout', {
        method: 'POST',
        body: JSON.stringify({ amountPln, returnTo }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Stripe checkout initialization failed')
      }
      if (typeof window !== 'undefined') {
        window.location.href = String(payload.url)
      }
    } catch {
      showEngineNotice(notices.topupTestFailed, 'error')
      setTopupLoadingTier(null)
    }
  }

  const handleTopupClick = async (tier: 'S' | 'M' | 'L') => {
    if (!topupTermsAccepted) {
      showEngineNotice(notices.topupTermsRequired, 'error')
      return
    }
    if (!topupDigitalServicesAccepted) {
      showEngineNotice(notices.topupDigitalServicesRequired, 'error')
      return
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const isDiagMode = params.get('diag') === '1'
      console.log('[TOPUP CLICK]', {
        tier,
        isDiagMode,
        location: window.location.href,
      })
      console.log('[TOPUP PATH]', topupPaymentProvider === 'stripe' ? 'STRIPE' : isDiagMode ? 'TEST_TOPUP' : 'AUTOPAY')
    }
    if (stripeTopupEnabled && topupPaymentProvider === 'stripe') {
      await handleStripeTopup(tier)
      return
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
      const nextBlogRoute = getBlogRouteFromPath(nextPath)
      if (nextBlogRoute) {
        setSelectedBlogId(nextBlogRoute.id)
        setUiLanguage(nextBlogRoute.language)
        window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, nextBlogRoute.language)
      } else if (nextPath === '/blog') {
        setSelectedBlogId(null)
      }
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
    if (typeof window === 'undefined') return
    if (!isBlog) return
    if (blogRoute) {
      if (selectedBlogId !== blogRoute.id) setSelectedBlogId(blogRoute.id)
      if (uiLanguage !== blogRoute.language) {
        setUiLanguage(blogRoute.language)
        window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, blogRoute.language)
      }
      return
    }
    if (normalizedPath === '/blog' && selectedBlogId) {
      setSelectedBlogId(null)
    }
  }, [blogRoute?.id, blogRoute?.language, isBlog, normalizedPath, selectedBlogId, uiLanguage])

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
    if (isExamples || isBlog || isEnginePublicPreview) return
    if (isPrivacy || isTermsAndConditions) return
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
  }, [authResolved, authSession?.user?.id, isAuthCallback, isAdminRoute, isExamples, isBlog, isEnginePublicPreview, isPrivacy, isTermsAndConditions])

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
    const normalizedAuthPath = path.replace(/\/+$/, '')
    const isPrivacyPath = normalizedAuthPath === '/privacy'
    const isTermsAndConditionsPath = normalizedAuthPath === '/termsandconditions'
    const isExamplesPath = normalizedAuthPath === '/examples'
    const isBlogPath = normalizedAuthPath === '/blog' || normalizedAuthPath.startsWith('/blog/')

    const isEnginePublicPath = normalizedAuthPath === '/engine_2'
    if (!canEnterApp && !isReportPath && !isPrivacyPath && !isTermsAndConditionsPath && !isExamplesPath && !isBlogPath && !isEnginePublicPath) {
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
        const nextParam = readAuthDestinationFromSearch()
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
          window.location.replace(target)
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
	    const next = readAuthDestinationFromSearch()
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
    const next = readAuthDestinationFromSearch()
    const normalizedNext = next || '/engine'
    writePostAuthNext(normalizedNext)
    writePostAuthLang(uiLanguage || 'English')
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
      } else {
        const next = readAuthDestinationFromSearch()
        writePostAuthNext(next || '/engine')
        writePostAuthLang(uiLanguage || 'English')
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
    setEngineSessionsError(null)
    setAuthError(null)
    setAuthCallbackError(null)
    setAuthCallbackHint(null)
    setLoginNotice(null)
    setFeedbackNotice(null)
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


  const routeLanguage = isBlog && blogRoute ? blogRoute.language : uiLanguage
  const copy = useMemo(() => getTranslations(routeLanguage), [routeLanguage])
  const handleSelectBlog = (blogId: BlogId) => {
    setSelectedBlogId(blogId)
    if (typeof window === 'undefined') return
    const blogIndex = blogIds.indexOf(blogId)
    const slug = copy.blogItems[blogIndex]?.slug
    if (!slug) return
    window.history.pushState({}, '', `/blog/${slug}`)
  }
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
        : 'Unable to top up the service balance. Please try again.',
      topupUnauthorized: isPl ? 'Zaloguj się, aby doładować konto.' : 'Sign in to top up your service balance.',
      topupInvalidTier: isPl ? 'Nieprawidłowy pakiet doładowania.' : 'Invalid top up tier.',
      topupTermsRequired: isPl ? 'zaakceptuj regulamin.' : 'Accept the terms and conditions.',
      topupDigitalServicesRequired: isPl
        ? 'zaakceptuj wymagane oświadczenie.'
        : 'Accept the required statement.',
      stripePaymentConfirming: isPl
        ? 'Płatność zakończona. Potwierdzamy ją w Stripe. Saldo zaktualizuje się za chwilę.'
        : 'Payment completed. We are confirming it with Stripe. Your balance will update shortly.',
      stripeBalanceUpdated: isPl ? 'Saldo zaktualizowane.' : 'Balance updated.',
      stripeWaitingConfirmation: isPl ? 'Czekamy na potwierdzenie płatności.' : 'Waiting for confirmation.',
      stripePaymentCancelled: isPl
        ? 'Płatność anulowana. Saldo nie zostało zmienione.'
        : 'Payment cancelled. Your balance was not changed.',
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
  const formatBalanceMinor = (minor: number) => {
    const locale = uiLanguage === 'Polish' ? 'pl-PL' : 'en-US'
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.max(0, minor || 0) / 100)
    return `${formatted} PLN`
  }
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
    if (!engineInitialBriefOpen) return
    autosizeTextarea(engineInitialBriefInputRef.current)
  }, [
    engineInitialBriefOpen,
    engineInitialBriefText,
    engineInitialBriefVoicePreview,
    engineInitialBriefVoiceState,
  ])

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

  const createNamedEngineSession = async ({
    name,
    shouldShowInitialBrief,
  }: {
    name: string
    shouldShowInitialBrief: boolean
  }): Promise<
    | { ok: true; sessionId: string }
    | { ok: false; error?: 'SESSION_NAME_COLLISION' | 'SESSION_NAME_SAVE_FAILED' }
  > => {
    let createError: 'SESSION_NAME_COLLISION' | 'SESSION_NAME_SAVE_FAILED' | undefined
    const sessionId = await ensureEnginePreviewSession(name, {
      onNameCollision: () => {
        createError = 'SESSION_NAME_COLLISION'
      },
      onInsertError: () => {
        createError = 'SESSION_NAME_SAVE_FAILED'
      },
    })
    if (!sessionId) return { ok: false, error: createError }
    setEnginePreviewSessionName(name)
    setEngineInitialBriefOpen(shouldShowInitialBrief)
    if (shouldShowInitialBrief) {
      setEngineInitialBriefText('')
      setEngineInitialBriefError(null)
    } else {
      setEngineUiState('FREE_FLOW')
      setEngineInputFocused(true)
      engineInputRef.current?.focus()
    }
    engineInteractionBySession.current[sessionId] = true
    setEngineLastInputActivityAt(Date.now())
    return { ok: true, sessionId }
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
      return 'needs_name'
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

  const moveEngineEntryToSection = async ({
    id: itemId,
    section: targetSection,
    index: targetIndex,
  }: {
    id: string
    section: EnginePerspectiveKey
    index: number
  }) => {
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

  const renderMissingLabelModal = (openEngineLabelEditor: (entryId: string) => void) => missingLabelModalOpen ? (
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
                    openEngineLabelEditor(first.id)
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
  const missingLabelModal = renderMissingLabelModal(() => {})

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
          await flushEngineEntryLabels()
          const needsClassification = enginePreviewItemsRef.current.some(
            (item) => !item.matrix_row || !item.matrix_col || item.classificationDirty
          )
          if (needsClassification) {
            await fillNaAssignments('auto')
          }
          const stillNeedsClassification = enginePreviewItemsRef.current.some(
            (item) => !item.matrix_row || !item.matrix_col || item.classificationDirty
          )
          if (stillNeedsClassification) {
            showEngineNotice(notices.assignRetryFailed, 'error')
            return
          }
          await persistBoardItemsToCloud(sessionId, authSession.user.id)
          const sourceUpdatedAt =
            enginePreviewItemsRef.current.reduce((max, item) => {
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
          if (message !== 'REPORT_CONTENT_NOT_GENERATED' && message !== 'REPORT_GENERATE_IN_PROGRESS') {
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
    const current = normalizeBoardItems(enginePreviewItemsRef.current)
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
      enginePreviewItemsRef.current = updatedItems
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
      if (!saved) return false
    }
    resetEnginePreview()
    return true
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
    setEngineEditResetSignal((prev) => prev + 1)
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
    setEngineEditResetSignal((prev) => prev + 1)
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

  const saveEngineItem = async ({ id, text }: { id: string; text: string }) => {
    if (!id || !engineSessionDetail?.session) return false
    const targetId = id
    const sessionId = engineSessionDetail.session.id
    const nextText = text.trim()
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
      await fetchEngineSessionDetail(sessionId)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(notices.deleteItemFailed(message))
      logSessionStore('engine_item_save_failed', { sessionId, message })
      return false
    } finally {
      setEngineEditLoading(false)
    }
  }

  const saveEnginePreviewEdit = async ({ id, text }: { id: string; text: string }) => {
    if (!id || !enginePreviewSessionId) return
    const nextText = text.trim()
    if (!nextText) return
    const limited = limitWords(nextText, WORD_LIMIT)
    setEnginePreviewItems((prev) =>
      prev.map((item) =>
        item.id === id ? applyTextEditClassification(item, limited) : item
      )
    )
    if (engineSessionDetail?.session?.id === enginePreviewSessionId) {
      setEngineSessionDetail((prev) =>
        prev
          ? {
              ...prev,
              boardItems: prev.boardItems.map((item) =>
                item.id === id ? applyTextEditClassification(item, limited) : item
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
          item.id === id ? applyTextEditClassification(item, limited) : item
        ),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(notices.deleteItemFailed(message))
      logSessionStore('engine_preview_edit_failed', { message })
    }
  }

  const deleteEngineEntry = async (itemId: string): Promise<boolean> => {
    const sessionId = enginePreviewSessionId || engineSessionDetail?.session?.id
    if (!sessionId) return false
    setEngineSessionsError(null)
    try {
      const detail = await getSession(sessionId)
      if (!detail?.session) return false
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
      delete engineLabelCache.current[itemId]
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(notices.deleteItemFailed(message))
      logSessionStore('engine_preview_item_delete_failed', { itemId, message })
      return false
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

  if (isExamples) {
    return withDevOverlay(
      <ExamplesPage
        copy={copy}
        logoUrl={landingLogoUrl}
        selectedExampleId={selectedExampleId}
        onSelectExample={setSelectedExampleId}
      />
    )
  }

  if (isBlog) {
    const activeBlogId = blogRoute?.id ?? selectedBlogId
    return withDevOverlay(
      <BlogPage
        copy={copy}
        logoUrl={landingLogoUrl}
        selectedBlogId={activeBlogId}
        onSelectBlog={handleSelectBlog}
        onStartClick={handleLandingCtaClick}
      />
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
    const topupAmountS = resolveAutopayTopupMinor('S').amountMinor
    const topupAmountM = resolveAutopayTopupMinor('M').amountMinor
    const topupAmountL = resolveAutopayTopupMinor('L').amountMinor
    return withDevOverlay(
      <TopupPage
        copy={copy}
        engineNotice={engineNotice}
        formatTopupAmountValue={formatTopupAmountValue}
        handleTopupClick={handleTopupClick}
        handleTopupReturn={handleTopupReturn}
        isDiagEnabled={isDiagEnabled()}
        logoutInProgress={logoutInProgress}
        setTopupDigitalServicesAccepted={setTopupDigitalServicesAccepted}
        setTopupPaymentProvider={setTopupPaymentProvider}
        setTopupTermsAccepted={setTopupTermsAccepted}
        showSupabaseConfigError={showSupabaseConfigError}
        stripeTopupEnabled={stripeTopupEnabled}
        supabaseConfigBody={notices.supabaseConfigBody}
        supabaseConfigTitle={notices.supabaseConfigTitle}
        supabaseEnvDiag={supabaseEnvDiag}
        supabaseInitError={supabaseInitError}
        topupAmountL={topupAmountL}
        topupAmountM={topupAmountM}
        topupAmountS={topupAmountS}
        topupDigitalServicesAccepted={topupDigitalServicesAccepted}
        topupLoadingTier={topupLoadingTier}
        topupPaymentProvider={topupPaymentProvider}
        topupTermsAccepted={topupTermsAccepted}
        uiLanguage={uiLanguage}
      />
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

  if (isTermsAndConditions) {
    const termsCopy =
      uiLanguage === 'Polish'
        ? {
            title: 'Regulamin serwisu',
            body: termsAndConditionsPl,
            back: 'Wróć',
          }
        : {
            title: 'Service Terms and Conditions',
            body: termsAndConditionsEn,
            back: 'Back',
          }

    return withDevOverlay(
      <div className="app privacy-page">
        <section className="privacy-panel">
          <div className="privacy-header">
            <img className="privacy-logo" src={landingLogoUrl} alt="MakeMyIdea.work" />
          </div>
          <h1>{termsCopy.title}</h1>
          <div className="terms-content">{termsCopy.body}</div>
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
              {termsCopy.back}
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
          <div className="auth-intro">
            <p className="muted auth-subtitle">{copy.loginSubtitle}</p>
            <p className="muted auth-session-helper">{copy.loginSessionHelper}</p>
          </div>
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
    const view = isExamples
      ? 'examples'
      : isBlog
        ? 'blog'
        : isReport
          ? 'report'
          : isEnginePreview
            ? 'engine'
            : isEnginePublicPreview
              ? 'engine_2'
              : showLanding
                ? 'landing'
                : 'app'
    console.log('[router] path=', rawPath, '-> view=', view)
  }

  if (isEnginePublicPreview) {
    return withDevOverlay(
      <Engine2Route
        EngineHeader={EngineHeader}
        logoUrl={landingLogoUrl}
        copy={copy}
        uiLanguage={uiLanguage}
        isAuthed={isAuthed}
        isAdmin={isAdmin}
        logoutInProgress={logoutInProgress}
        billingLoading={billingAccount.loading}
        billingError={billingAccount.error}
        billingBalanceMinor={billingAccount.balanceMinor}
        billingBalanceOverrideMinor={billingBalanceOverrideMinor}
        insufficientBalanceActive={insufficientBalanceState.active}
        engineNotice={engineNotice}
        showDiagnostics={showDiagnostics}
        aiSupportEnabled={aiSupportEnabled}
        showSessionUsage={showSessionUsage}
        llmUsageClass={llmUsageClass}
        currentTokensTotal={currentTokensTotal}
        totalCostUsd={totalCostUsd}
        totalCostPln={totalCostPln}
        sessionUsage={sessionUsage}
        modelUsageEntries={modelUsageEntries}
        diagnosticsAuthEmail={authSession?.user?.email ?? null}
        authDisabled={authDisabled}
        missingSupabaseEnvMessage={missingSupabaseEnvMessage}
        isDiagEnabled={isDiagEnabled()}
        publicLoginHref={`/login?returnTo=${encodeURIComponent('/engine_2')}`}
        adminEngineSwitcher="engine2"
        onAdminClick={() => {
          if (typeof window !== 'undefined') {
            window.location.hash = '#/admin'
          }
        }}
        onLogout={() => {
          void handleLogout()
        }}
        onToggleDiagnostics={() => {
          const nextEnabled = !showDiagnostics
          setDiagnosticsEnabled(nextEnabled)
          localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, nextEnabled ? 'true' : 'false')
        }}
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
        formatBalanceMinor={formatBalanceMinor}
        formatTokenTotal={formatTokenTotal}
        formatUsd={formatUsd}
        formatPln={formatPln}
        getAccessToken={async () => {
          if (!client) return ''
          const { data } = await client.auth.getSession()
          return data.session?.access_token || ''
        }}
      />
    )
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
  const engineInitialBriefDisplayedText = getEngineInitialBriefDisplayedText()
  const engineInitialBriefMeaningfulWords = getMeaningfulWords(engineInitialBriefDisplayedText)
  const hasEnoughEngineInitialBriefContent =
    engineInitialBriefMeaningfulWords.length >= INITIAL_BRIEF_MIN_MEANINGFUL_WORDS &&
    new Set(engineInitialBriefMeaningfulWords).size >= INITIAL_BRIEF_MIN_DISTINCT_MEANINGFUL_WORDS
  const showEngineInputCaret = !engineInputFocused && !enginePreviewInput.trim()
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
      <Engine1Container
        actionPlanReadinessEnabled={actionPlanReadinessEnabled}
        ActionPlanReadinessGauge={ActionPlanReadinessGauge}
        actionPlanReadinessHeuristic={actionPlanReadinessHeuristic}
        actionPlanReadinessLlmCache={actionPlanReadinessLlmCache}
        actionPlanReadinessMeaningfulCount={actionPlanReadinessMeaningfulCount}
        activateEngineDraftTarget={activateEngineDraftTarget}
        activateFacilitationPrompt={activateFacilitationPrompt}
        AiCostButton={AiCostButton}
        aiPlatform={{
          aiSupportEnabled,
          checkLlmStatus,
          currentTokensTotal,
          llmApiBase,
          llmUsageClass,
          modelUsageEntries,
          normalizeApiBase,
          sessionUsage,
          totalCostPln,
          totalCostUsd,
        }}
        applyEngineInitialBriefTextChange={applyEngineInitialBriefTextChange}
        armIdleWatch={armIdleWatch}
        assignNaItems={assignNaItems}
        authPlatform={{
          authDisabled,
          authSession,
          client,
          handleLogout,
          isAdmin,
          isAuthed,
          logoutInProgress,
          missingSupabaseEnvMessage,
        }}
        autosizeTextarea={autosizeTextarea}
        billingPlatform={{
          balanceCurrency,
          billingAccount,
          billingBalanceOverrideMinor,
          insufficientBalanceState,
          reportCreatePriceLoading,
          reportCreatePriceMinor,
          sessionCreatePriceLoading,
        }}
        clearEngineDraftTarget={clearEngineDraftTarget}
        clearEngineIdleTimer={clearEngineIdleTimer}
        copy={copy}
        debugMatrixData={debugMatrixData}
        deleteEngineEntry={deleteEngineEntry}
        deleteEngineItem={deleteEngineItem}
        deleteEngineSession={deleteEngineSession}
        createNamedEngineSession={createNamedEngineSession}
        diagnosticsPlatform={{
          activeUsageSessionIdNormalized,
          DIAGNOSTICS_STORAGE_KEY,
          isDiagEnabled,
          sessionUsageDiagnostics,
          setAiSupportEnabled,
          setDiagnosticsEnabled,
          setFacilitationCooldown,
          setLlmStatus,
          showDiagnostics,
          showSessionUsage,
        }}
        engineActiveFacilitationPerspective={engineActiveFacilitationPerspective}
        engineActivePrompt={engineActivePrompt}
        engineAddEntryLoading={engineAddEntryLoading}
        engineAllowIdleWithoutFocusRef={engineAllowIdleWithoutFocusRef}
        engineAssignLoading={engineAssignLoading}
        engineDeleteLoadingId={engineDeleteLoadingId}
        engineDraftTargetSection={engineDraftTargetSection}
        engineEditLoading={engineEditLoading}
        engineEditResetSignal={engineEditResetSignal}
        engineFacilitationInlineError={engineFacilitationInlineError}
        engineFacilitationLoading={engineFacilitationLoading}
        engineFacilitationLoadingType={engineFacilitationLoadingType}
        EngineHeader={EngineHeader}
        engineIdleArmedRef={engineIdleArmedRef}
        engineIdleTriggered={engineIdleTriggered}
        engineImportInputRef={engineImportInputRef}
        engineInitialBriefError={engineInitialBriefError}
        engineInitialBriefInputRef={engineInitialBriefInputRef}
        engineInitialBriefOpen={engineInitialBriefOpen}
        engineInitialBriefSubmitLabel={engineInitialBriefSubmitLabel}
        engineInitialBriefSubmitting={engineInitialBriefSubmitting}
        engineInitialBriefVoiceCorrectionSeqRef={engineInitialBriefVoiceCorrectionSeqRef}
        engineInitialBriefVoiceState={engineInitialBriefVoiceState}
        engineInputRef={engineInputRef}
        engineInteractionBySession={engineInteractionBySession}
        engineMatrixVisible={engineMatrixVisible}
        engineMovingEntryId={engineMovingEntryId}
        engineNotice={engineNotice}
        engineOfferReason={engineOfferReason}
        enginePendingArmingRef={enginePendingArmingRef}
        enginePendingFocusRef={enginePendingFocusRef}
        enginePreviewError={enginePreviewError}
        enginePreviewInput={enginePreviewInput}
        enginePreviewItems={enginePreviewItems}
        enginePreviewSessionId={enginePreviewSessionId}
        enginePreviewSessionName={enginePreviewSessionName}
        enginePreviewVoiceError={enginePreviewVoiceError}
        enginePreviewVoiceState={enginePreviewVoiceState}
        enginePromptSource={enginePromptSource}
        engineSessionDetail={engineSessionDetail}
        engineSessionPersisted={engineSessionPersisted}
        engineSessions={engineSessions}
        engineSessionsError={engineSessionsError}
        engineSessionsOpen={engineSessionsOpen}
        engineUiState={engineUiState}
        engineUnassignedItems={engineUnassignedItems}
        facilitationIntroRef={facilitationIntroRef}
        feedbackFab={feedbackFab}
        feedbackPanel={feedbackPanel}
        feedbackReminderBanner={feedbackReminderBanner}
        fetchEngineSessions={fetchEngineSessions}
        flushEngineEntryLabels={flushEngineEntryLabels}
        formatBalanceMinor={formatBalanceMinor}
        formatPln={formatPln}
        formatTokenTotal={formatTokenTotal}
        formatUsd={formatUsd}
        getEngineInitialBriefDisplayedText={getEngineInitialBriefDisplayedText}
        getEngineSessionKey={getEngineSessionKey}
        getReportMetaForSession={getReportMetaForSession}
        goToActionPlan={goToActionPlan}
        handleEnginePreviewAdd={handleEnginePreviewAdd}
        handleEnginePreviewInputChange={handleEnginePreviewInputChange}
        handleExportSessions={handleExportSessions}
        handleImportSessions={handleImportSessions}
        handleReportNavigation={handleReportNavigation}
        hasEnoughEngineInitialBriefContent={hasEnoughEngineInitialBriefContent}
        highlightMissingLabels={highlightMissingLabels}
        isPhoneViewport={isPhoneViewport}
        landingLogoUrl={landingLogoUrl}
        lastFacilitationPerspective={lastFacilitationPerspective}
        lastFacilitationType={lastFacilitationType}
        lastLlmSource={lastLlmSource}
        lastLlmWhy={lastLlmWhy}
        limitWords={limitWords}
        logFacilitationEvent={logFacilitationEvent}
        missingLabelCount={missingLabelCount}
        renderMissingLabelModal={renderMissingLabelModal}
        moveEngineEntryToSection={moveEngineEntryToSection}
        notices={notices}
        openEngineSession={openEngineSession}
        navigationPlatform={{
          reportNavigationLoading,
          setHashPath,
          storeTopupReturnTo,
        }}
        questionMatrix={questionMatrix}
        reportRecords={reportRecords}
        resolveFacilitationRequestType={resolveFacilitationRequestType}
        saveCurrentSessionToCloud={saveCurrentSessionToCloud}
        saveEngineItem={saveEngineItem}
        saveEnginePreviewEdit={saveEnginePreviewEdit}
        setEngineFacilitationInlineError={setEngineFacilitationInlineError}
        setEngineInitialBriefVoicePreview={setEngineInitialBriefVoicePreview}
        setEngineInitialBriefVoiceState={setEngineInitialBriefVoiceState}
        setEngineInputFocused={setEngineInputFocused}
        setEngineLastInputActivityAt={setEngineLastInputActivityAt}
        setEngineOfferReason={setEngineOfferReason}
        setEnginePreviewVoiceState={setEnginePreviewVoiceState}
        setEngineSessionsOpen={setEngineSessionsOpen}
        setEngineUiState={setEngineUiState}
        showEngineFacilitationLoadingUI={showEngineFacilitationLoadingUI}
        showEngineInputCaret={showEngineInputCaret}
        showFirstQuestionWrapper={showFirstQuestionWrapper}
        startNewSession={startNewSession}
        stopEngineInitialBriefRecognition={stopEngineInitialBriefRecognition}
        stopEnginePreviewRecognition={stopEnginePreviewRecognition}
        submitEngineInitialBrief={submitEngineInitialBrief}
        syncEnginePreviewVoiceTranscript={syncEnginePreviewVoiceTranscript}
        toggleEngineInitialBriefVoiceInput={toggleEngineInitialBriefVoiceInput}
        toggleEnginePreviewVoiceInput={toggleEnginePreviewVoiceInput}
        uiLanguage={uiLanguage}
        updateEngineEntryLabel={updateEngineEntryLabel}
        withAlpha={withAlpha}
      />
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
    <Engine1LegacyRoute
      activeIdeaCell={activeIdeaCell}
      activeStep={activeStep}
      addLlmIdeas={addLlmIdeas}
      aiSupportEnabled={aiSupportEnabled}
      allowDrop={allowDrop}
      assignedSpaceIds={assignedSpaceIds}
      assignedTimeIds={assignedTimeIds}
      autosizeTextarea={autosizeTextarea}
      canProceedToStep2={canProceedToStep2}
      canProceedToStep3={canProceedToStep3}
      checkLlmStatus={checkLlmStatus}
      confirmRemoveOpen={confirmRemoveOpen}
      copy={copy}
      countWords={countWords}
      DIAGNOSTICS_STORAGE_KEY={DIAGNOSTICS_STORAGE_KEY}
      feedbackFab={feedbackFab}
      feedbackPanel={feedbackPanel}
      getLabelById={getLabelById}
      getLabelForIdea={getLabelForIdea}
      getNextLabelColor={getNextLabelColor}
      handleDragStart={handleDragStart}
      handleDropOnSpace={handleDropOnSpace}
      handleDropOnTime={handleDropOnTime}
      handleLabelDragStart={handleLabelDragStart}
      handleLandingCtaClick={handleLandingCtaClick}
      handleLlmPing={handleLlmPing}
      handleNameDragStart={handleNameDragStart}
      hoveredCell={hoveredCell}
      IconElement={IconElement}
      IconIdea={IconIdea}
      IconReport={IconReport}
      IconSearch={IconSearch}
      IconWorld={IconWorld}
      ideaDraft={ideaDraft}
      ideaLabelAssignments={ideaLabelAssignments}
      ideaLabelDraft={ideaLabelDraft}
      ideaLabels={ideaLabels}
      ideaPreview={ideaPreview}
      impulseOpen={impulseOpen}
      impulseQuestion={impulseQuestion}
      impulseSource={impulseSource}
      isAdmin={isAdmin}
      isSuggestLoading={isSuggestLoading}
      keepOnlyUserIdeas={keepOnlyUserIdeas}
      labelEditorOpen={labelEditorOpen}
      landingLogoUrl={landingLogoUrl}
      landingView={landingView}
      languageOptions={languageOptions}
      lastLlmSource={lastLlmSource}
      lastLlmWhy={lastLlmWhy}
      limitWords={limitWords}
      llmApiBase={llmApiBase}
      llmPingResult={llmPingResult}
      llmSaved={llmSaved}
      llmSettingsOpen={llmSettingsOpen}
      llmStatus={llmStatus}
      missingLabelModal={missingLabelModal}
      normalizeApiBase={normalizeApiBase}
      openMainLanding={openMainLanding}
      postItEdit={postItEdit}
      postItEditCell={postItEditCell}
      postItEditOriginalText={postItEditOriginalText}
      postItLabelDraft={postItLabelDraft}
      productConfirmed={productConfirmed}
      productDescription={productDescription}
      productDescriptionConfirmed={productDescriptionConfirmed}
      productName={productName}
      productNameSuggestions={productNameSuggestions}
      reportData={reportData}
      reportLanguage={reportLanguage}
      reportSnapshotOpen={reportSnapshotOpen}
      requestImpulse={requestImpulse}
      requestNameSuggestions={requestNameSuggestions}
      selectedScenario={selectedScenario}
      setActiveIdeaCell={setActiveIdeaCell}
      setActiveStep={setActiveStep}
      setAiSupportEnabled={setAiSupportEnabled}
      setConfirmRemoveOpen={setConfirmRemoveOpen}
      setDiagnosticsEnabled={setDiagnosticsEnabled}
      setHoveredCell={setHoveredCell}
      setIdeaDraft={setIdeaDraft}
      setIdeaLabelAssignments={setIdeaLabelAssignments}
      setIdeaLabelDraft={setIdeaLabelDraft}
      setIdeaLabels={setIdeaLabels}
      setIdeaPreview={setIdeaPreview}
      setImpulseOpen={setImpulseOpen}
      setLabelEditorOpen={setLabelEditorOpen}
      setLlmApiBase={setLlmApiBase}
      setLlmSaved={setLlmSaved}
      setLlmSettingsOpen={setLlmSettingsOpen}
      setLlmStatus={setLlmStatus}
      setPostItEdit={setPostItEdit}
      setPostItEditCell={setPostItEditCell}
      setPostItEditOriginalText={setPostItEditOriginalText}
      setPostItLabelDraft={setPostItLabelDraft}
      setProductConfirmed={setProductConfirmed}
      setProductDescription={setProductDescription}
      setProductName={setProductName}
      setReportSnapshotOpen={setReportSnapshotOpen}
      setUiLanguage={setUiLanguage}
      setWorkshopIdeas={setWorkshopIdeas}
      showDiagnostics={showDiagnostics}
      showLanding={showLanding}
      showSuggestLoadingUI={showSuggestLoadingUI}
      spaceAssignments={spaceAssignments}
      spaceLabelMap={spaceLabelMap}
      spaceOptionMap={spaceOptionMap}
      spaceOptions={spaceOptions}
      spaceSectionsStep2={spaceSectionsStep2}
      spaceSectionsStep3={spaceSectionsStep3}
      stepHeading={stepHeading}
      stepOrder={stepOrder}
      stepTitle={stepTitle}
      timeAssignments={timeAssignments}
      timeLabelMap={timeLabelMap}
      timeOptionMap={timeOptionMap}
      timeOptions={timeOptions}
      timeSections={timeSections}
      uiLanguage={uiLanguage}
      uiLanguageOptions={uiLanguageOptions}
      updateScenarioSpaceDef={updateScenarioSpaceDef}
      updateScenarioTimeDef={updateScenarioTimeDef}
      withAlpha={withAlpha}
      workshopIdeas={workshopIdeas}
    />
  )
}

export default App
