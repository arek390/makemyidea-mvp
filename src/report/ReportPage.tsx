import { useEffect, useMemo, useRef, useState } from 'react'
import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'
import {
  ENGINE_ENTRY_LABELS,
  ENGINE_ENTRY_LABEL_COLORS,
  getEntryLabelText,
  getNoLabelText,
} from '../engine/entryLabels'
import type {
  ReportRecommendations,
  ReportTrizSection,
  ReportTrizSolution,
  ReportTrizSolutionImage,
} from '../storage/sessionStore'
import { UsageBadge } from '../components/UsageBadge'
import { buildSessionGoalText, extractProductNameFromSessionName } from './sessionGoal'
import { fetchReportBySessionId } from '../lib/cloudReports'
import { supabase as client } from '../lib/supabase/client'
import { AiCostButton } from '../components/AiCostButton'
 
const TOPUP_RETURN_TO_KEY = 'topup-return-to'

const withAlpha = (hexColor: string, alphaHex = '66') => {
  const value = String(hexColor || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(value) ? `${value}${alphaHex}` : value
}

type ReportPageProps = {
  snapshot: ReportSnapshot
  language: ReportLang
  onBack: () => void
  onLogout: () => void
  onSaveSession?: () => void
  saveSessionLabel?: string
  userId?: string | null
  aiSupportEnabled: boolean
  diagnosticsEnabled: boolean
  canToggleDiagnostics?: boolean
  diagnosticsToggleLabel?: string
  onToggleDiagnostics?: () => void
  diagnosticsAuthLabel?: string | null
  canToggleAiSupport?: boolean
  aiSupportToggleLabel?: string
  onToggleAiSupport?: () => void
  llmUsageIndicatorLabel?: string
  llmUsageValue?: string | null
  llmUsageClassName?: string
  llmCostLines?: string[]
  llmCostBreakdownLabel?: string
  llmCostBreakdownRows?: string[]
  naFillStatus?: 'idle' | 'running' | 'done' | 'error'
  onAiUsage?: (meta: unknown) => void
  onReportMetaChange?: (meta: {
    summary?: AiSummary | null
    lastSummaryTextHash?: string | null
    createdAt?: number | null
    updatedAt?: number | null
    ideas?: ReportSnapshot['ideas'] | null
    recommendations?: ReportRecommendations | null
    triz?: ReportTrizSection | null
  }) => void
  onUpdateLabel?: (itemId: string, label: string | null) => Promise<boolean>
  onBillingInsufficient?: () => void
  onBillingRefresh?: () => void
  billingCurrency?: 'PLN' | 'USD'
  balanceMinor?: number
  billingLoading?: boolean
  billingError?: string | null
  showInsufficientBalance?: boolean
  insufficientBalanceNotice?: string
}

type AiSummary = { today: string; change: string; product: string }

const sanitizeReportText = (input: string) => {
  let value = String(input ?? '')
  const matrixCodeGroup = String.raw`(?:[ABC][123]\s*(?:,\s*[ABC][123]\s*)*)`
  value = value.replace(new RegExp(String.raw`\s*\(\s*${matrixCodeGroup}\)\s*[.;:!?]`, 'g'), '')
  value = value.replace(new RegExp(String.raw`\s*\(\s*${matrixCodeGroup}\)\s*`, 'g'), ' ')
  value = value.replace(
    /(^|[\s\u00A0])([ABC][123])(?=([\s\u00A0]*[.,;:!?)]|[\s\u00A0]*$))/g,
    '$1'
  )
  value = value.replace(/\(\s*\)/g, '')
  value = value.replace(/\s+/g, ' ').replace(/\s+([.,;:!?\)])/g, '$1').trim()
  return value
}

const sanitizeReportPayload = <T,>(payload: T): T => {
  if (payload == null) return payload
  if (typeof payload === 'string') return sanitizeReportText(payload) as T
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeReportPayload(item)) as T
  }
  if (typeof payload === 'object') {
    const next: Record<string, unknown> = {}
    Object.entries(payload as Record<string, unknown>).forEach(([key, value]) => {
      next[key] = sanitizeReportPayload(value)
    })
    return next as T
  }
  return payload
}

const sanitizeFilenamePart = (value: string) => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\/\\:\*\?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'report'
}

const formatDate = (value?: number | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10)
    }
  }
  return new Date().toISOString().slice(0, 10)
}

const validateAndNormalizeReport = (payload: unknown) => {
  const empty = {
    summary: { today: '', change: '', product: '' },
    ideas: [] as ReportSnapshot['ideas'],
    recommendations: {
      based_on_user_ideas: [],
      morphological: [],
      market_trends: [],
    } as ReportRecommendations,
    triz: {
      section_title: '',
      section_intro: '',
      contradictions: [],
    } as ReportTrizSection,
    source_snapshot: null as unknown,
  }
  if (!payload || typeof payload !== 'object') {
    return { ...empty }
  }
  const value = payload as {
    summary?: unknown
    ideas?: unknown
    recommendations?: unknown
    triz?: unknown
    source_snapshot?: unknown
    today?: unknown
    change?: unknown
    product?: unknown
  }
  let summary = empty.summary
  if (value.summary && typeof value.summary === 'object') {
    const s = value.summary as { today?: unknown; change?: unknown; product?: unknown }
    summary = {
      today: typeof s.today === 'string' ? s.today : '',
      change: typeof s.change === 'string' ? s.change : '',
      product: typeof s.product === 'string' ? s.product : '',
    }
  } else if (
    typeof value.today === 'string' ||
    typeof value.change === 'string' ||
    typeof value.product === 'string'
  ) {
    summary = {
      today: typeof value.today === 'string' ? value.today : '',
      change: typeof value.change === 'string' ? value.change : '',
      product: typeof value.product === 'string' ? value.product : '',
    }
  }
  const ideas = Array.isArray(value.ideas) ? (value.ideas as ReportSnapshot['ideas']) : []
  const recommendations = normalizeRecommendations(value.recommendations)
  const triz = normalizeTriz(value.triz)
  return {
    summary,
    ideas,
    recommendations,
    triz,
    source_snapshot: value.source_snapshot ?? null,
  }
}

const isRecommendationItem = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const item = value as {
    title?: unknown
    rationale?: unknown
    how_to_test?: unknown
    methods?: unknown
    confidence?: unknown
  }
  if (typeof item.title !== 'string') return false
  if (typeof item.rationale !== 'string') return false
  if (typeof item.how_to_test !== 'string') return false
  if (item.methods && !Array.isArray(item.methods)) return false
  if (
    item.confidence &&
    item.confidence !== 'low' &&
    item.confidence !== 'med' &&
    item.confidence !== 'high'
  ) {
    return false
  }
  return true
}

const normalizeRecommendations = (value: unknown): ReportRecommendations => {
  const empty: ReportRecommendations = {
    based_on_user_ideas: [],
    morphological: [],
    market_trends: [],
  }
  if (!value || typeof value !== 'object') return { ...empty }
  const rec = value as {
    based_on_user_ideas?: unknown
    morphological?: unknown
    market_trends?: unknown
  }
  const based = Array.isArray(rec.based_on_user_ideas)
    ? rec.based_on_user_ideas.filter(isRecommendationItem)
    : []
  const morph = Array.isArray(rec.morphological)
    ? rec.morphological.filter(isRecommendationItem)
    : []
  const trends = Array.isArray(rec.market_trends)
    ? rec.market_trends.filter(isRecommendationItem)
    : []
  return {
    based_on_user_ideas: based,
    morphological: morph,
    market_trends: trends,
  }
}

const isTrizPrinciple = (
  value: unknown
): value is NonNullable<ReportTrizSection['contradictions'][number]>['principles'][number] => {
  if (!value || typeof value !== 'object') return false
  const item = value as {
    id?: unknown
    name?: unknown
    rationale?: unknown
    how_to_apply?: unknown
  }
  if (typeof item.name !== 'string' || item.name.trim().length === 0) return false
  if (item.id != null && !Number.isFinite(Number(item.id))) return false
  if (item.rationale != null && typeof item.rationale !== 'string') return false
  if (item.how_to_apply != null && typeof item.how_to_apply !== 'string') return false
  return true
}

const normalizeTrizSolutionImage = (value: unknown): ReportTrizSolutionImage | null => {
  if (!value || typeof value !== 'object') return null
  const image = value as {
    status?: unknown
    storage_path?: unknown
    public_url?: unknown
    mime_type?: unknown
    file_name?: unknown
    generated_at?: unknown
    prompt?: unknown
    error_message?: unknown
  }
  const status =
    image.status === 'idle' || image.status === 'ready' || image.status === 'failed'
      ? image.status
      : undefined
  const storagePath =
    typeof image.storage_path === 'string' && image.storage_path.trim()
      ? image.storage_path.trim()
      : undefined
  const publicUrl =
    typeof image.public_url === 'string' && image.public_url.trim()
      ? image.public_url.trim()
      : undefined
  const mimeType =
    typeof image.mime_type === 'string' && image.mime_type.trim()
      ? image.mime_type.trim()
      : undefined
  const fileName =
    typeof image.file_name === 'string' && image.file_name.trim()
      ? image.file_name.trim()
      : undefined
  const generatedAt =
    typeof image.generated_at === 'string' && image.generated_at.trim()
      ? image.generated_at.trim()
      : undefined
  const prompt =
    typeof image.prompt === 'string' && image.prompt.trim() ? image.prompt.trim() : undefined
  const errorMessage =
    typeof image.error_message === 'string' && image.error_message.trim()
      ? image.error_message.trim()
      : undefined
  if (
    !status &&
    !storagePath &&
    !publicUrl &&
    !mimeType &&
    !fileName &&
    !generatedAt &&
    !prompt &&
    !errorMessage
  ) {
    return null
  }
  return {
    ...(status ? { status } : {}),
    ...(storagePath ? { storage_path: storagePath } : {}),
    ...(publicUrl ? { public_url: publicUrl } : {}),
    ...(mimeType ? { mime_type: mimeType } : {}),
    ...(fileName ? { file_name: fileName } : {}),
    ...(generatedAt ? { generated_at: generatedAt } : {}),
    ...(prompt ? { prompt } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {}),
  }
}

const normalizeTrizSolutionImages = (value: unknown): ReportTrizSolutionImage[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeTrizSolutionImage(item))
    .filter((item): item is ReportTrizSolutionImage => Boolean(item))
}

const normalizeTrizSolution = (value: unknown): ReportTrizSolution | null => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    return {
      title: text,
      description: '',
    }
  }
  if (!value || typeof value !== 'object') return null
  const solution = value as {
    title?: unknown
    description?: unknown
    sketch_prompt?: unknown
    image?: unknown
  }
  const title = typeof solution.title === 'string' ? solution.title.trim() : ''
  const description = typeof solution.description === 'string' ? solution.description.trim() : ''
  const sketchPrompt =
    typeof solution.sketch_prompt === 'string' && solution.sketch_prompt.trim()
      ? solution.sketch_prompt.trim()
      : undefined
  const image = normalizeTrizSolutionImage(solution.image)
  const images = normalizeTrizSolutionImages((solution as { images?: unknown }).images)
  const mergedImages = (() => {
    if (image && images.some((item) => item.storage_path && item.storage_path === image.storage_path)) {
      return images
    }
    if (image) return [image, ...images]
    return images
  })()
  if (!title && !description) return null
  return {
    title: title || description,
    description,
    ...(sketchPrompt ? { sketch_prompt: sketchPrompt } : {}),
    ...(image ? { image } : {}),
    ...(mergedImages.length ? { images: mergedImages } : {}),
  }
}

const normalizeTriz = (value: unknown): ReportTrizSection => {
  const empty: ReportTrizSection = {
    section_title: '',
    section_intro: '',
    contradictions: [],
  }
  if (!value || typeof value !== 'object') return { ...empty }
  const section = value as {
    section_title?: unknown
    section_intro?: unknown
    contradictions?: unknown
  }
  const contradictions = Array.isArray(section.contradictions)
    ? section.contradictions
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const contradiction = item as {
            title?: unknown
            description?: unknown
            improving?: unknown
            worsening?: unknown
            principles?: unknown
            solutions?: unknown
          }
          const title = typeof contradiction.title === 'string' ? contradiction.title.trim() : ''
          const description =
            typeof contradiction.description === 'string' ? contradiction.description.trim() : ''
          const improving =
            typeof contradiction.improving === 'string' ? contradiction.improving.trim() : ''
          const worsening =
            typeof contradiction.worsening === 'string' ? contradiction.worsening.trim() : ''
          if (!title || !description || !improving || !worsening) return null
          const principles = Array.isArray(contradiction.principles)
            ? contradiction.principles
                .filter(isTrizPrinciple)
                .map((principle) => ({
                  ...(principle.id != null ? { id: Number(principle.id) } : {}),
                  name: principle.name.trim(),
                  ...(typeof principle.rationale === 'string' && principle.rationale.trim()
                    ? { rationale: principle.rationale.trim() }
                    : {}),
                  ...(typeof principle.how_to_apply === 'string' && principle.how_to_apply.trim()
                    ? { how_to_apply: principle.how_to_apply.trim() }
                    : {}),
                }))
            : []
          const solutions = Array.isArray(contradiction.solutions)
            ? contradiction.solutions
                .map((solution) => normalizeTrizSolution(solution))
                .filter((solution): solution is ReportTrizSolution => Boolean(solution))
            : []
          return {
            title,
            description,
            improving,
            worsening,
            principles,
            solutions,
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 3)
    : []
  return {
    section_title: typeof section.section_title === 'string' ? section.section_title.trim() : '',
    section_intro: typeof section.section_intro === 'string' ? section.section_intro.trim() : '',
    contradictions,
  }
}
type SummaryUsage = {
  model: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  fxUsdPln: number
  costPln: number
}

export const ReportPage = ({
  snapshot,
  language,
  onBack,
  aiSupportEnabled,
  diagnosticsEnabled,
  canToggleDiagnostics = false,
  diagnosticsToggleLabel,
  onToggleDiagnostics,
  diagnosticsAuthLabel = null,
  canToggleAiSupport = false,
  aiSupportToggleLabel,
  onToggleAiSupport,
  llmUsageIndicatorLabel,
  llmUsageValue = null,
  llmUsageClassName = '',
  llmCostLines = [],
  llmCostBreakdownLabel,
  llmCostBreakdownRows = [],
  naFillStatus,
  onAiUsage,
  onUpdateLabel,
  onReportMetaChange,
  onBillingInsufficient,
  onBillingRefresh,
  onSaveSession,
  saveSessionLabel,
  billingCurrency = 'PLN',
  balanceMinor = 0,
  billingLoading = false,
  billingError = null,
  showInsufficientBalance = false,
  insufficientBalanceNotice = 'Insufficient funds. Top up your account.',
}: ReportPageProps) => {
  const t = reportCopy[language]
  const reportLogoUrl = new URL('../../logo/logo_makemyideawork.png', import.meta.url).href
  const initialReport = validateAndNormalizeReport({
    summary: snapshot.reportMeta?.summary ?? null,
    ideas: snapshot.ideas ?? null,
    recommendations: snapshot.reportMeta?.recommendations ?? null,
    triz: snapshot.reportMeta?.triz ?? null,
  })
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(
    sanitizeReportPayload(initialReport.summary)
  )
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [lastSummaryTextHash, setLastSummaryTextHash] = useState<string | null>(
    snapshot.reportMeta?.lastSummaryTextHash ?? null
  )
  // IMPORTANT: "Zebrane pomysły i obserwacje" is live data, not report snapshot.
  const [summaryItems, setSummaryItems] = useState<ReportSnapshot['ideas']>(
    sanitizeReportPayload(snapshot.ideas)
  )
  const [reportRecommendations, setReportRecommendations] = useState<ReportRecommendations>(
    normalizeRecommendations(sanitizeReportPayload(initialReport.recommendations))
  )
  const [reportTriz, setReportTriz] = useState<ReportTrizSection | null>(
    snapshot.reportMeta?.triz ? normalizeTriz(sanitizeReportPayload(snapshot.reportMeta.triz)) : null
  )
  const lastBoardChangeAt = Number(snapshot.sourceUpdatedAt || 0) || null
  const lastReportUpdateAt =
    snapshot.reportMeta?.updatedAt ?? snapshot.reportMeta?.createdAt ?? null
  const reportIsOutdated =
    Boolean(lastBoardChangeAt && lastReportUpdateAt && lastBoardChangeAt > lastReportUpdateAt)
  const [priceMinor, setPriceMinor] = useState<number | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [trizImagePrices, setTrizImagePrices] = useState<{
    generate: number | null
    regenerate: number | null
  }>({ generate: null, regenerate: null })
  const [trizImagePriceLoading, setTrizImagePriceLoading] = useState(false)
  const [trizImageLoading, setTrizImageLoading] = useState<Record<string, boolean>>({})
  const [trizImageDeleting, setTrizImageDeleting] = useState<Record<string, boolean>>({})
  const [trizImageErrors, setTrizImageErrors] = useState<Record<string, string | null>>({})
  const balanceCurrency: 'PLN' | 'USD' = billingCurrency
  const formatBalanceMinor = (currency: 'PLN' | 'USD', minor: number) => {
    const locale = currency === 'PLN' ? 'pl-PL' : 'en-US'
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.max(0, minor || 0) / 100)
  }

  useEffect(() => {
    const supabaseClient = client
    if (!supabaseClient) return
    let cancelled = false
    const loadPrice = async () => {
      setPriceLoading(true)
      try {
        const { data, error } = await supabaseClient
          .from('pricing_rules_public')
          .select('price_grosze,price_cents')
          .eq('action_key', 'report_update')
          .maybeSingle()
        if (!cancelled) {
          if (error) {
            setPriceMinor(null)
          } else {
            const row = data as {
              price_grosze?: number | string | null
              price_cents?: number | string | null
            } | null
            const raw =
              billingCurrency === 'USD' ? row?.price_cents : row?.price_grosze
            const value = Number(raw)
            setPriceMinor(Number.isFinite(value) ? value : null)
          }
        }
      } catch {
        if (!cancelled) setPriceMinor(null)
      } finally {
        if (!cancelled) setPriceLoading(false)
      }
    }
    void loadPrice()
    return () => {
      cancelled = true
    }
  }, [billingCurrency])

  useEffect(() => {
    const supabaseClient = client
    if (!supabaseClient) return
    let cancelled = false
    const loadTrizImagePrices = async () => {
      setTrizImagePriceLoading(true)
      try {
        const { data, error } = await supabaseClient
          .from('pricing_rules_public')
          .select('action_key,price_grosze,price_cents')
          .in('action_key', ['image_generate', 'image_regenerate'])
        if (cancelled) return
        if (error || !Array.isArray(data)) {
          setTrizImagePrices({ generate: null, regenerate: null })
          return
        }
        const next = { generate: null as number | null, regenerate: null as number | null }
        data.forEach((row) => {
          const typedRow = row as
            | {
                action_key?: string | null
                price_grosze?: number | string | null
                price_cents?: number | string | null
              }
            | null
          const raw =
            billingCurrency === 'USD'
              ? Number(typedRow?.price_cents ?? NaN)
              : Number(typedRow?.price_grosze ?? NaN)
          const value = Number.isFinite(raw) ? raw : null
          if (typedRow?.action_key === 'image_generate') next.generate = value
          if (typedRow?.action_key === 'image_regenerate') next.regenerate = value
        })
        setTrizImagePrices(next)
      } catch {
        if (!cancelled) setTrizImagePrices({ generate: null, regenerate: null })
      } finally {
        if (!cancelled) setTrizImagePriceLoading(false)
      }
    }
    void loadTrizImagePrices()
    return () => {
      cancelled = true
    }
  }, [billingCurrency])
  const [isReportUpdating, setIsReportUpdating] = useState(false)
  const [labelUpdating, setLabelUpdating] = useState<Record<string, boolean>>({})
  const [summaryUsage] = useState<SummaryUsage | null>(null)
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const summaryAutoAttempted = useRef(false)
  const reportSessionId = snapshot.sessionId || null
  const [reportMetaLoaded, setReportMetaLoaded] = useState(!client || !reportSessionId)
  const labelErrorText = t.labelSaveError

  const isEmptySummaryText = (text: string | null | undefined, lang: 'pl' | 'en') => {
    const value = String(text || '').trim()
    if (!value) return true
    const lower = value.toLowerCase()
    if (lang === 'pl') {
      const phrases = [
        'brak wystarczających danych',
        'brak bezpośrednich informacji',
        'nie generuję podsumowania',
        'brak wpisów',
        'brak informacji',
        'zbyt mało informacji',
      ]
      if (phrases.some((phrase) => lower.includes(phrase))) return true
      if (/brak.*(danych|informacji|wpis(ów|ow)).*/i.test(value)) return true
      if (/nie generuj[eę].*podsumowania/i.test(value)) return true
      if (/\([A-C][1-3]\)/.test(value) && /brak/i.test(value)) return true
      return false
    }
    const phrases = [
      'not enough data',
      'insufficient data',
      'no direct information',
      'no entries',
      'cannot generate',
    ]
    if (phrases.some((phrase) => lower.includes(phrase))) return true
    if (/not enough|insufficient|no (direct )?information|no entries|cannot generate/i.test(value)) {
      return true
    }
    return false
  }
  const productNameCandidate = useMemo(
    () =>
      extractProductNameFromSessionName(
        snapshot.sessionName || '',
        language === 'pl' ? 'pl' : 'en'
      ),
    [snapshot.sessionName, language]
  )
  const sessionGoalText = useMemo(
    () =>
      buildSessionGoalText({
        lang: language === 'pl' ? 'pl' : 'en',
        productName: productNameCandidate,
      }),
    [language, productNameCandidate]
  )

  useEffect(() => {
    return undefined
  }, [])

  useEffect(() => {
    setSummaryItems(sanitizeReportPayload(snapshot.ideas))
  }, [snapshot.ideas])

  useEffect(() => {
    if (!client || !reportSessionId) {
      setReportMetaLoaded(true)
      return
    }
    setReportMetaLoaded(false)
    let cancelled = false
    ;(async () => {
      try {
        const record = await fetchReportBySessionId(reportSessionId)
        if (cancelled || !record) return
        setReportRecommendations(
          normalizeRecommendations(sanitizeReportPayload(record.recommendations))
        )
        setReportTriz(record.triz ? normalizeTriz(sanitizeReportPayload(record.triz)) : null)
        if (!aiSummary && record.summary) {
          setAiSummary(sanitizeReportPayload(record.summary))
        }
        if (!lastSummaryTextHash && record.lastSummaryTextHash) {
          setLastSummaryTextHash(record.lastSummaryTextHash)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setReportMetaLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reportSessionId])

  useEffect(() => {
    summaryAutoAttempted.current = false
    setSummaryStatus('idle')
  }, [language])

  useEffect(() => {
    if (!updateNotice) return
    const timer = window.setTimeout(() => setUpdateNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [updateNotice])

  useEffect(() => {
    setUpdateNotice(null)
  }, [language])

  const showUpdate = (() => {
    if (typeof window === 'undefined') return true
    return !(window.history.state && window.history.state.newlyCreated === true)
  })()

    if (import.meta.env.DEV) {
      if (snapshot.reportMeta?.ideas?.length) {
        console.warn('Items section must not use summary_json as source')
      }
      console.assert(
        sanitizeReportText('Rynek ... (A1).') === 'Rynek ...',
        'sanitizeReportText should remove (A1)'
      )
    console.assert(
      sanitizeReportText('..., (B1, C1) oraz ...') === '..., oraz ...',
      'sanitizeReportText should remove (B1, C1)'
    )
    console.assert(
      sanitizeReportText('Funkcje B2.') === 'Funkcje.',
      'sanitizeReportText should remove trailing B2'
    )
    console.assert(
      sanitizeReportText('Model A1 Pro') === 'Model A1 Pro',
      'sanitizeReportText should keep A1 in names'
    )
  }

  const handleUpdateReport = async () => {
    if (typeof window === 'undefined') return
    const sessionId =
      snapshot.sessionId || window.sessionStorage.getItem('reportReturnSessionId') || ''
    const sourceUpdatedAt = Number(snapshot.sourceUpdatedAt || 0)
    if (!sessionId) {
      setUpdateNotice(t.labelSaveError)
      return
    }
    setIsReportUpdating(true)
    try {
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const payload = { sessionId: reportSessionId || sessionId, lang: language }
      const response = await fetch('/api/report?action=update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const responsePayload = await response.json().catch(() => null)
      if (!response.ok || !responsePayload?.ok) {
        if (responsePayload?.error === 'INSUFFICIENT_BALANCE') {
          onBillingInsufficient?.()
          return
        }
        setUpdateNotice(t.labelSaveError)
        return
      }
      if (response.ok && responsePayload?.ok) {
        onBillingRefresh?.()
      }
    } catch (error) {
      setUpdateNotice(t.labelSaveError)
      return
    } finally {
      setIsReportUpdating(false)
    }
    if (reportSessionId) {
      try {
        const record = await fetchReportBySessionId(reportSessionId)
        if (record) {
          applyReportRecord(record)
          setSummaryStatus('done')
        }
      } catch {
        // ignore
      }
    }
    const storedRaw = window.sessionStorage.getItem(
      `report_source_updated_at::${sessionId}`
    )
    const stored = Number(storedRaw || 0)
    if (!sourceUpdatedAt || sourceUpdatedAt <= stored) {
      setUpdateNotice(t.reportNoChanges)
      return
    }
    window.sessionStorage.setItem(
      `report_source_updated_at::${sessionId}`,
      String(sourceUpdatedAt)
    )
    setUpdateNotice(t.reportUpdated)
  }

  const formatActionPrice = (minor: number | null) => {
    if (!Number.isFinite(minor ?? NaN)) return null
    return formatBalanceMinor(balanceCurrency, minor || 0)
  }

  const applyReportRecord = (record: Awaited<ReturnType<typeof fetchReportBySessionId>>) => {
    if (!record) return
    const normalized = validateAndNormalizeReport({
      summary: record.summary,
      ideas: record.ideas,
      recommendations: record.recommendations,
      triz: record.triz,
    })
    const sanitized = sanitizeReportPayload(normalized)
    setReportRecommendations(sanitized.recommendations)
    setReportTriz(record.triz ? normalizeTriz(sanitizeReportPayload(record.triz)) : null)
    setAiSummary(sanitized.summary)
    setLastSummaryTextHash(record.lastSummaryTextHash ?? null)
    onReportMetaChange?.({
      summary: sanitized.summary,
      ideas: sanitized.ideas,
      recommendations: sanitized.recommendations,
      triz: sanitized.triz,
      lastSummaryTextHash: record.lastSummaryTextHash ?? null,
      createdAt: record.createdAt ?? null,
      updatedAt: record.updatedAt ?? null,
    })
  }

  const handleGenerateTrizImage = async (contradictionIndex: number, solutionIndex: number) => {
    if (!reportSessionId || typeof window === 'undefined') return
    const requestKey = `${contradictionIndex}:${solutionIndex}`
    setTrizImageLoading((prev) => ({ ...prev, [requestKey]: true }))
    setTrizImageErrors((prev) => ({ ...prev, [requestKey]: null }))
    try {
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const response = await fetch('/api/report?action=generate-triz-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: reportSessionId,
          contradictionIndex,
          solutionIndex,
          lang: language,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (payload?.meta) {
        onAiUsage?.(payload.meta)
      }
      if (!response.ok || !payload?.ok) {
        const errorCode =
          typeof payload?.code === 'string'
            ? payload.code
            : typeof payload?.error === 'string'
              ? payload.error
              : ''
        const errorMessage =
          typeof payload?.message === 'string' && payload.message
            ? payload.message
            : errorCode || t.trizImageFailed
        if (errorCode === 'INSUFFICIENT_BALANCE') {
          onBillingInsufficient?.()
          return
        }
        setTrizImageErrors((prev) => ({
          ...prev,
          [requestKey]: errorMessage,
        }))
        return
      }
      onBillingRefresh?.()
      if (payload?.report) {
        const refreshed = await fetchReportBySessionId(reportSessionId)
        if (refreshed) {
          applyReportRecord(refreshed)
        }
      } else {
        const refreshed = await fetchReportBySessionId(reportSessionId)
        if (refreshed) {
          applyReportRecord(refreshed)
        }
      }
    } catch (error) {
      console.error('[triz-image][ui] request_failed', {
        requestKey,
        message: error instanceof Error ? error.message : String(error),
        error,
      })
      setTrizImageErrors((prev) => ({ ...prev, [requestKey]: t.trizImageFailed }))
    } finally {
      setTrizImageLoading((prev) => ({ ...prev, [requestKey]: false }))
    }
  }

  const handleDeleteTrizImage = async (
    contradictionIndex: number,
    solutionIndex: number,
    image: ReportTrizSolutionImage,
    galleryIndex: number
  ) => {
    if (!reportSessionId || typeof window === 'undefined') return
    const deleteKey = `${contradictionIndex}:${solutionIndex}:${
      image.storage_path || image.public_url || galleryIndex
    }`
    const requestKey = `${contradictionIndex}:${solutionIndex}`
    setTrizImageDeleting((prev) => ({ ...prev, [deleteKey]: true }))
    setTrizImageErrors((prev) => ({ ...prev, [requestKey]: null }))
    try {
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const response = await fetch('/api/report?action=delete-triz-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: reportSessionId,
          contradictionIndex,
          solutionIndex,
          storagePath: image.storage_path || null,
          publicUrl: image.public_url || null,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const errorMessage =
          typeof payload?.message === 'string' && payload.message
            ? payload.message
            : typeof payload?.code === 'string' && payload.code
              ? payload.code
              : t.trizImageDeleteFailed
        setTrizImageErrors((prev) => ({
          ...prev,
          [requestKey]: errorMessage,
        }))
        return
      }
      const refreshed = await fetchReportBySessionId(reportSessionId)
      if (refreshed) {
        applyReportRecord(refreshed)
      }
    } catch {
      setTrizImageErrors((prev) => ({ ...prev, [requestKey]: t.trizImageDeleteFailed }))
    } finally {
      setTrizImageDeleting((prev) => ({ ...prev, [deleteKey]: false }))
    }
  }

  const handleDownloadTrizImage = async (
    image: ReportTrizSolutionImage,
    solution: ReportTrizSolution,
    galleryIndex: number
  ) => {
    if (typeof window === 'undefined' || !image.public_url) return
    const fallbackName = `${sanitizeFilenamePart(solution.title || 'triz-sketch')}-${galleryIndex + 1}.png`
    const fileName = image.file_name || fallbackName
    try {
      const response = await fetch(image.public_url)
      if (!response.ok) throw new Error('DOWNLOAD_FAILED')
      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(image.public_url, '_blank', 'noopener,noreferrer')
    }
  }

  const handlePrintReport = () => {
    if (typeof document === 'undefined') return
    const originalTitle = document.title
    const fileName = `${sanitizeFilenamePart(snapshot.sessionName)}_${formatDate(
      snapshot.reportMeta?.createdAt ?? null
    )}.pdf`
    document.title = fileName
    window.print()
    window.setTimeout(() => {
      document.title = originalTitle
    }, 0)
  }

  const handleLabelChange = async (idea: ReportSnapshot['ideas'][number], nextValue: string) => {
    if (!idea?.id) return
    const nextLabel = nextValue || null
    const previousLabel = idea.label ?? null
    setSummaryItems((prev) =>
      prev.map((item) => (item.id === idea.id ? { ...item, label: nextLabel } : item))
    )
    setLabelUpdating((prev) => ({ ...prev, [idea.id]: true }))
    let ok = false
    try {
      if (onUpdateLabel) {
        ok = await onUpdateLabel(idea.id, nextLabel)
      }
    } catch {
      ok = false
    }
    if (!ok) {
      setSummaryItems((prev) =>
        prev.map((item) => (item.id === idea.id ? { ...item, label: previousLabel } : item))
      )
      setUpdateNotice(labelErrorText)
    }
    setLabelUpdating((prev) => {
      const next = { ...prev }
      delete next[idea.id]
      return next
    })
  }

  const generateSummaryIfNeeded = async () => {
    if (summaryStatus === 'running') return
    if (summaryAutoAttempted.current) return
    summaryAutoAttempted.current = true
    setSummaryStatus('done')
  }

  useEffect(() => {
    if (!reportMetaLoaded) return
    void generateSummaryIfNeeded()
  }, [reportMetaLoaded, aiSummary, lastSummaryTextHash])

  const cleanedSummary = useMemo(() => {
    const lang = language === 'pl' ? 'pl' : 'en'
    return {
      today: isEmptySummaryText(aiSummary?.today, lang)
        ? null
        : sanitizeReportText(aiSummary?.today || ''),
      change: isEmptySummaryText(aiSummary?.change, lang)
        ? null
        : sanitizeReportText(aiSummary?.change || ''),
      product: isEmptySummaryText(aiSummary?.product, lang)
        ? null
        : sanitizeReportText(aiSummary?.product || ''),
    }
  }, [aiSummary, language])
  const normalizedTriz = useMemo(
    () => (reportTriz ? normalizeTriz(sanitizeReportPayload(reportTriz)) : null),
    [reportTriz]
  )
  const hasTrizSection = Boolean(normalizedTriz)
  const hasTriz = Boolean(normalizedTriz?.contradictions.length)
  const resolveQuestionText = (idea: (typeof summaryItems)[number] | null | undefined) => {
    if (!idea) return ''
    const primary =
      language === 'pl'
        ? (idea as { questionTextPl?: string | null }).questionTextPl ??
          (idea as { question_text_pl?: string | null }).question_text_pl ??
          null
        : (idea as { questionTextEn?: string | null }).questionTextEn ??
          (idea as { question_text_en?: string | null }).question_text_en ??
          null
    const secondary =
      language === 'pl'
        ? (idea as { questionTextEn?: string | null }).questionTextEn ??
          (idea as { question_text_en?: string | null }).question_text_en ??
          null
        : (idea as { questionTextPl?: string | null }).questionTextPl ??
          (idea as { question_text_pl?: string | null }).question_text_pl ??
          null
    return sanitizeReportText(primary || secondary || '')
  }
  const recommendations = reportRecommendations as
    | {
        based_on_user_ideas: Array<{
          title: string
          rationale: string
          how_to_test: string
          methods?: string[]
          confidence?: 'low' | 'med' | 'high'
        }>
        morphological: Array<{
          title: string
          rationale: string
          how_to_test: string
          methods?: string[]
          confidence?: 'low' | 'med' | 'high'
        }>
        market_trends: Array<{
          title: string
          rationale: string
          how_to_test: string
          methods?: string[]
          confidence?: 'low' | 'med' | 'high'
        }>
      }
  const hasRecommendations =
    recommendations.based_on_user_ideas.length ||
    recommendations.morphological.length ||
    recommendations.market_trends.length
  const perspectiveLabels =
    language === 'pl'
      ? {
          asIs: 'Jak jest?',
          notWorking: 'Co nie działa?',
          toBe: 'Jak powinno być?',
          empty: 'Brak danych do analizy perspektyw',
          description:
            'Mapa perspektyw pokazuje, na czym skupiłeś się podczas pracy nad pomysłem. Każdy kolor to inna perspektywa – stan obecny, to co nie działa oraz to, jak powinno być. Dzięki temu szybko zobaczysz, które obszary są już dobrze opisane, a które warto jeszcze uzupełnić, żeby obraz pomysłu był pełniejszy. Jeśli któraś perspektywa ma mniej wpisów, możesz do niej wrócić i dopisać kilka myśli, żeby lepiej zbalansować całość.',
        }
      : {
          asIs: 'As is',
          notWorking: 'What doesn’t work',
          toBe: 'How it should be',
          empty: 'No data to analyze perspectives',
          description:
            'The perspective map shows where your attention went while working on the idea. Each color represents a different viewpoint — the current state, what isn’t working, and how it should be. This helps you quickly spot which areas are well covered and which ones may need more input to get a more complete picture. If one perspective has fewer entries, you can return to it and add a few thoughts to balance things out.',
        }
  const perspectiveData = useMemo(() => {
    const rows = ['world', 'product', 'elements']
    const counts = { asIs: 0, notWorking: 0, toBe: 0 }
    summaryItems.forEach((item) => {
      if (!rows.includes(String(item.matrixRow || '').toLowerCase())) return
      const col = String(item.matrixCol || '').toLowerCase()
      if (col === 'as_is') counts.asIs += 1
      else if (col === 'not_working') counts.notWorking += 1
      else if (col === 'should_be') counts.toBe += 1
    })
    const total = counts.asIs + counts.notWorking + counts.toBe
    const pct = (value: number) =>
      total ? Math.round((value / total) * 100) : 0
    return {
      total,
      counts,
      percents: {
        asIs: pct(counts.asIs),
        notWorking: pct(counts.notWorking),
        toBe: pct(counts.toBe),
      },
    }
  }, [summaryItems])
  return (
    <div className="report-page">
      <header className="engine-header report-engine-header">
        <div>
          <div className="engine-header-logo">
            <img src={reportLogoUrl} alt="MakeMyIdea.work" />
          </div>
        </div>
        <div className="engine-header-balance" aria-live="polite">
          <div className="engine-balance-row">
            <div
              className={`engine-balance${
                billingLoading || billingError ? ' engine-balance--loading' : ''
              }`}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  const returnTo =
                    window.location.hash?.startsWith('#/')
                      ? window.location.hash.slice(1)
                      : window.location.pathname || '/'
                  window.sessionStorage.setItem(TOPUP_RETURN_TO_KEY, returnTo)
                  window.location.hash = '#/topup'
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (typeof window !== 'undefined') {
                    const returnTo =
                      window.location.hash?.startsWith('#/')
                        ? window.location.hash.slice(1)
                        : window.location.pathname || '/'
                    window.sessionStorage.setItem(TOPUP_RETURN_TO_KEY, returnTo)
                    window.location.hash = '#/topup'
                  }
                }
              }}
            >
              <button
                type="button"
                className="engine-balance-icon"
                aria-label="Top up"
              >
                💰
              </button>
              <span className="engine-balance-value">
                {billingLoading || billingError
                  ? '—'
                  : formatBalanceMinor(balanceCurrency, balanceMinor)}
              </span>
            </div>
            {showInsufficientBalance && (
              <span className="engine-balance-warning">
                {insufficientBalanceNotice}
              </span>
            )}
          </div>
        </div>
        <div className="engine-header-actions">
          <button type="button" className="primary" onClick={onBack}>
            {t.back}
          </button>
          {diagnosticsEnabled && diagnosticsAuthLabel && (
            <span className="muted">{diagnosticsAuthLabel}</span>
          )}
          {canToggleDiagnostics && onToggleDiagnostics && diagnosticsToggleLabel && (
            <button
              className={`ai-support-toggle diagnostics-toggle ${diagnosticsEnabled ? 'on' : 'off'}`}
              type="button"
              onClick={onToggleDiagnostics}
            >
              {diagnosticsToggleLabel}
            </button>
          )}
          {diagnosticsEnabled && canToggleAiSupport && onToggleAiSupport && aiSupportToggleLabel && (
            <button
              className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
              type="button"
              onClick={onToggleAiSupport}
            >
              {aiSupportToggleLabel}
            </button>
          )}
          {diagnosticsEnabled && llmUsageValue && llmUsageIndicatorLabel && (
            <button
              className={`ai-support-toggle llm-usage-indicator ${llmUsageClassName}`}
              type="button"
              aria-label={llmUsageIndicatorLabel}
              title={llmUsageIndicatorLabel}
              disabled
            >
              {llmUsageValue}
            </button>
          )}
          {diagnosticsEnabled && (llmCostLines.length > 0 || llmCostBreakdownRows.length > 0) && (
            <div className="llm-cost-panel" aria-live="polite">
              {llmCostLines.map((line, index) => (
                <div key={`report-llm-cost-line-${index}`} className="llm-cost-line">
                  {line}
                </div>
              ))}
              {llmCostBreakdownLabel && llmCostBreakdownRows.length > 0 && (
                <details className="llm-cost-details">
                  <summary>{llmCostBreakdownLabel}</summary>
                  <div className="llm-cost-breakdown">
                    {llmCostBreakdownRows.map((row, index) => (
                      <div key={`report-llm-cost-row-${index}`} className="llm-cost-row">
                        {row}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          {onSaveSession && (
            <button
              className="secondary"
              type="button"
              onClick={onSaveSession}
            >
              {saveSessionLabel || 'Save session'}
            </button>
          )}
        </div>
      </header>
      <header className="report-header">
        <div>
          <div className="report-title-row">
            <h1>{t.title}</h1>
            <span className="report-updating-slot" aria-hidden={!isReportUpdating}>
              {isReportUpdating && (
                <span
                  className="report-updating-indicator"
                  role="status"
                  aria-label={t.updatingAria}
                  title={t.updatingAria}
                />
              )}
            </span>
          </div>
        </div>
        <div className="report-outdated-slot">
          {reportIsOutdated && (
            <div className="report-outdated report-outdated--ui" role="status">
              {t.reportOutdatedNotice}
            </div>
          )}
        </div>
        <div className="report-actions">
          {showUpdate && (
            <AiCostButton
              label={t.reportUpdate}
              lang={language}
              priceMinor={priceMinor}
              currency={billingCurrency}
              priceLoading={priceLoading}
              onClick={handleUpdateReport}
            />
          )}
          {naFillStatus === 'error' && <span className="muted">{t.naAssigningError}</span>}
        </div>
      </header>
      {reportIsOutdated && (
        <div className="report-outdated report-outdated--print" role="note">
          {t.reportOutdatedPrint}
        </div>
      )}

      <main className="report-body">
        <section id="cover" className="report-section">
          <h2>{t.cover}</h2>
          <div className="report-cover">
            <div className="report-cover-content">
              <p>
                <strong>{t.sessionName}:</strong> {snapshot.sessionName || '—'}
              </p>
              <p>
                <strong>{t.date}:</strong> {snapshot.date || '—'}
              </p>
              <p>
                <strong>{t.userName}:</strong> {snapshot.userName || '—'}
              </p>
            </div>
            <div className="report-cover-logo">
              <img src={reportLogoUrl} alt="MakeMyIdea.Work" />
            </div>
          </div>
        </section>

        <section id="toc" className="report-section">
          <h2>{t.toc}</h2>
          <ol className="report-toc">
            <li>
              <a href="#goal">{t.sessionGoal}</a>
            </li>
            <li>
              <a href="#summary">{t.executiveSummary}</a>
            </li>
            {hasTrizSection && (
              <li>
                <a href="#triz">{t.trizTitle}</a>
              </li>
            )}
            <li>
              <a href="#map">{t.perspectiveMap}</a>
            </li>
            <li>
              <a href="#responses">{t.collectedIdeas}</a>
            </li>
            <li>
              <a href="#next">{t.nextSteps}</a>
            </li>
            <li>
              <a href="#appendix">{t.appendices}</a>
            </li>
          </ol>
        </section>

        <section id="goal" className="report-section">
          <h2>{t.sessionGoal}</h2>
          <p>{sessionGoalText}</p>
        </section>

        <section id="summary" className="report-section">
          <h2>{t.executiveSummary}</h2>
          <div className="report-summary-actions">
            {diagnosticsEnabled && summaryUsage && (
              <UsageBadge
                totalTokens={summaryUsage.totalTokens}
                costPln={summaryUsage.costPln}
                model={summaryUsage.model}
                locale={language === 'pl' ? 'pl-PL' : 'en-US'}
              />
            )}
          {summaryStatus === 'running' && <span className="muted">{t.summaryGenerating}</span>}
          {diagnosticsEnabled && !aiSupportEnabled && <span className="muted">{t.aiDisabled}</span>}
          {updateNotice && <span className="muted">{updateNotice}</span>}
        </div>
          {Boolean(cleanedSummary.today) && (
            <div className="report-summary-block">
              <h3>{t.summaryToday}</h3>
              <p>{cleanedSummary.today}</p>
            </div>
          )}
          {Boolean(cleanedSummary.change) && (
            <div className="report-summary-block">
              <h3>{t.summaryChange}</h3>
              <p>{cleanedSummary.change}</p>
            </div>
          )}
          {Boolean(cleanedSummary.product) && (
            <div className="report-summary-block">
              <h3>{t.summaryProduct}</h3>
              <p>{cleanedSummary.product}</p>
            </div>
          )}
          {summaryStatus === 'done' &&
            !cleanedSummary.today &&
            !cleanedSummary.change &&
            !cleanedSummary.product && (
              <div className="report-summary-block">
                <h3>{t.summaryEmptyTitle}</h3>
                <p>{t.summaryEmptyBody}</p>
              </div>
            )}
        </section>

        {hasTrizSection && (
          <section id="triz" className="report-section">
            <h2>{normalizedTriz?.section_title || t.trizTitle}</h2>
            <p>{normalizedTriz?.section_intro || t.trizIntro}</p>
            {!hasTriz ? (
              <p className="muted">{t.trizEmpty}</p>
            ) : (
              normalizedTriz!.contradictions.map((item, index) => (
              <div key={`triz-${index}`} className="report-summary-block">
                <h3>{sanitizeReportText(item.title)}</h3>
                <p>{sanitizeReportText(item.description)}</p>
                <p>
                  <strong>{t.trizImproving}:</strong> {sanitizeReportText(item.improving)}
                </p>
                <p>
                  <strong>{t.trizWorsening}:</strong> {sanitizeReportText(item.worsening)}
                </p>
                {item.principles.length ? (
                  <>
                    <h3>{t.trizPrinciples}</h3>
                    <ul>
                      {item.principles.map((principle, principleIndex) => (
                        <li key={`triz-principle-${index}-${principleIndex}`}>
                          <strong>
                            {principle.id != null
                              ? `${principle.id}. ${sanitizeReportText(principle.name)}`
                              : sanitizeReportText(principle.name)}
                          </strong>
                          {principle.rationale ? (
                            <div>{sanitizeReportText(principle.rationale)}</div>
                          ) : null}
                          {principle.how_to_apply ? (
                            <div>{sanitizeReportText(principle.how_to_apply)}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {item.solutions.length ? (
                  <>
                    <h3>{t.trizSolutions}</h3>
                    <ul className="triz-solutions-list">
                      {item.solutions.map((solution, solutionIndex) => {
                        const requestKey = `${index}:${solutionIndex}`
                        const image = solution.image || null
                        const readyImages = Array.isArray(solution.images)
                          ? solution.images.filter(
                              (entry) => entry?.status === 'ready' && Boolean(entry.public_url)
                            )
                          : image?.status === 'ready' && image.public_url
                            ? [image]
                            : []
                        const imageReady = readyImages.length > 0
                        const isGenerating = Boolean(trizImageLoading[requestKey])
                        const errorText = trizImageErrors[requestKey] || image?.error_message || null
                        const hasRichDescription = Boolean(solution.description.trim())
                        const priceLabel = formatActionPrice(
                          imageReady ? trizImagePrices.regenerate : trizImagePrices.generate
                        )
                        const actionLabel = imageReady
                          ? t.trizRegenerateSketch
                          : t.trizGenerateSketch
                        return (
                          <li
                            key={`triz-solution-${index}-${solutionIndex}`}
                            className="triz-solution-item"
                          >
                            <div className="triz-solution-copy">
                              <div className="triz-solution-title">
                                {sanitizeReportText(solution.title)}
                              </div>
                              {hasRichDescription && (
                                <p className="triz-solution-description">
                                  {sanitizeReportText(solution.description)}
                                </p>
                              )}
                              <div className="triz-solution-actions">
                                <span className="triz-image-button-wrap">
                                  <button
                                    type="button"
                                    className="secondary triz-image-button"
                                    onClick={() => void handleGenerateTrizImage(index, solutionIndex)}
                                    disabled={isGenerating || trizImagePriceLoading}
                                  >
                                    {isGenerating
                                      ? t.trizGeneratingImage
                                      : `${actionLabel}${priceLabel ? ` — ${priceLabel}` : ''}`}
                                  </button>
                                  {isGenerating && (
                                    <span
                                      className="report-updating-indicator triz-image-spinner"
                                      role="status"
                                      aria-label={t.trizGeneratingImage}
                                      title={t.trizGeneratingImage}
                                    />
                                  )}
                                </span>
                              </div>
                                {errorText ? (
                                <p className="report-error">{sanitizeReportText(errorText)}</p>
                              ) : imageReady ? (
                                <p className="muted">{t.trizImageIncluded}</p>
                              ) : (
                                <p className="muted">{t.trizNoImageYet}</p>
                              )}
                            </div>
                            {imageReady && (
                              <div className="triz-solution-gallery">
                                {readyImages.map((galleryImage, galleryIndex) => {
                                  const deleteKey = `${index}:${solutionIndex}:${
                                    galleryImage.storage_path || galleryImage.public_url || galleryIndex
                                  }`
                                  const isDeleting = Boolean(trizImageDeleting[deleteKey])
                                  return (
                                    <div
                                      key={`triz-solution-image-${index}-${solutionIndex}-${galleryIndex}`}
                                      className="triz-solution-image-card"
                                    >
                                      <div className="triz-solution-image-wrap">
                                        <img
                                          className="triz-solution-image"
                                          src={galleryImage.public_url}
                                          alt={sanitizeReportText(solution.title)}
                                          loading="lazy"
                                        />
                                        <div className="triz-solution-image-overlay">
                                          <button
                                            type="button"
                                            className="icon-button triz-image-overlay-action triz-image-overlay-action--danger"
                                            onClick={() =>
                                              void handleDeleteTrizImage(
                                                index,
                                                solutionIndex,
                                                galleryImage,
                                                galleryIndex
                                              )
                                            }
                                            disabled={isDeleting}
                                            aria-label={t.trizDeleteImage}
                                            title={t.trizDeleteImage}
                                          >
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                              <path
                                                fill="currentColor"
                                                d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 1 0 0 2H6v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9zm1 2h4v1h-4V5zm-1 4a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1zm6 1a1 1 0 1 0-2 0v7a1 1 0 1 0 2 0v-7z"
                                              />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            className="icon-button triz-image-overlay-action"
                                            onClick={() =>
                                              void handleDownloadTrizImage(
                                                galleryImage,
                                                solution,
                                                galleryIndex
                                              )
                                            }
                                            disabled={isDeleting}
                                            aria-label={t.trizSaveImage}
                                            title={t.trizSaveImage}
                                          >
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                              <path
                                                fill="currentColor"
                                                d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.41l-4 3.99a1 1 0 0 1-1.4 0l-4-3.99a1 1 0 1 1 1.4-1.41L11 12.59V4a1 1 0 0 1 1-1zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z"
                                              />
                                            </svg>
                                          </button>
                                          {isDeleting && (
                                            <span
                                              className="report-updating-indicator triz-image-spinner"
                                              role="status"
                                              aria-label={t.trizDeleteImage}
                                              title={t.trizDeleteImage}
                                            />
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </>
                ) : null}
              </div>
              ))
            )}
          </section>
        )}

        <section id="map" className="report-section">
          <h2>{t.perspectiveMap}</h2>
          {perspectiveData.total === 0 ? (
            <p className="muted">{perspectiveLabels.empty}</p>
          ) : (
            <>
              <p>{perspectiveLabels.description}</p>
              <div
                className="perspective-bar"
                aria-label={`Mapa perspektyw: ${perspectiveLabels.asIs} ${
                  perspectiveData.percents.asIs
                }%, ${perspectiveLabels.notWorking} ${
                  perspectiveData.percents.notWorking
                }%, ${perspectiveLabels.toBe} ${perspectiveData.percents.toBe}%`}
              >
                <div
                  className="perspective-segment as-is"
                  style={{ width: `${perspectiveData.percents.asIs}%` }}
                  title={`${perspectiveLabels.asIs}: ${perspectiveData.counts.asIs} (${perspectiveData.percents.asIs}%)`}
                >
                </div>
                <div
                  className="perspective-segment not-working"
                  style={{ width: `${perspectiveData.percents.notWorking}%` }}
                  title={`${perspectiveLabels.notWorking}: ${perspectiveData.counts.notWorking} (${perspectiveData.percents.notWorking}%)`}
                >
                </div>
                <div
                  className="perspective-segment to-be"
                  style={{ width: `${perspectiveData.percents.toBe}%` }}
                  title={`${perspectiveLabels.toBe}: ${perspectiveData.counts.toBe} (${perspectiveData.percents.toBe}%)`}
                >
                </div>
              </div>
              <div className="perspective-legend">
                <span className="legend-item as-is">{perspectiveLabels.asIs}</span>
                <span className="legend-item not-working">
                  {perspectiveLabels.notWorking}
                </span>
                <span className="legend-item to-be">{perspectiveLabels.toBe}</span>
              </div>
            </>
          )}
        </section>

        <section id="responses" className="report-section">
          <h2>{t.collectedIdeas}</h2>
          <div className="report-table-wrapper report-table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>{t.tableQuestion}</th>
                  <th>{t.tableEntry}</th>
                  <th>{t.tableLabel}</th>
                </tr>
              </thead>
              <tbody>
                {summaryItems.length === 0 ? (
                  <tr>
                    <td colSpan={3}>{t.noEntries}</td>
                  </tr>
                ) : (
                  summaryItems.filter(Boolean).map((idea) => {
                    const questionText = resolveQuestionText(idea)
                    const isUpdating = Boolean(labelUpdating[idea.id])
                    const labelValue = idea.label ?? ''
                    const hasLabel = Boolean(labelValue)
                    const labelBg = hasLabel
                      ? withAlpha(ENGINE_ENTRY_LABEL_COLORS[labelValue])
                      : '#ffffff'
                    return (
                      <tr key={idea.id}>
                        <td>{questionText}</td>
                        <td>{idea.text || '—'}</td>
                        <td>
                          <label className="engine-entry-label-field">
                            <span className="sr-only">Etykieta wpisu</span>
                            <select
                              data-testid={`report-label-select-${idea.id}`}
                              value={labelValue}
                              disabled={isUpdating}
                              style={{
                                backgroundColor: labelBg,
                                color: '#000000',
                              }}
                              onChange={(event) => {
                                void handleLabelChange(idea, event.target.value)
                              }}
                            >
                              <option value="">{getNoLabelText(language)}</option>
                              {ENGINE_ENTRY_LABELS.map((label) => (
                                <option key={label} value={label}>
                                  {getEntryLabelText(label, language)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {isUpdating && <span className="muted">…</span>}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="next" className="report-section">
          <h2>{t.nextSteps}</h2>
          {!hasRecommendations ? (
            <p>{t.recommendationsEmpty}</p>
          ) : (
            <div className="report-recommendations">
              {recommendations?.based_on_user_ideas.length ? (
                <>
                  <h3>{t.recommendationsIdeasTitle}</h3>
                  <ul>
                    {recommendations.based_on_user_ideas.map((item, idx) => (
                      <li key={`rec-ideas-${idx}`}>
                        <strong>{sanitizeReportText(item.title)}</strong>
                        <div>{sanitizeReportText(item.rationale)}</div>
                        <div>{sanitizeReportText(item.how_to_test)}</div>
                        {item.methods?.length ? (
                          <div>
                            {item.methods.map((m) => sanitizeReportText(m)).join(', ')}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {recommendations?.morphological.length ? (
                <>
                  <h3>{t.recommendationsMorphTitle}</h3>
                  <ul>
                    {recommendations.morphological.map((item, idx) => (
                      <li key={`rec-morph-${idx}`}>
                        <strong>{sanitizeReportText(item.title)}</strong>
                        <div>{sanitizeReportText(item.rationale)}</div>
                        <div>{sanitizeReportText(item.how_to_test)}</div>
                        {item.methods?.length ? (
                          <div>
                            {item.methods.map((m) => sanitizeReportText(m)).join(', ')}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {recommendations?.market_trends.length ? (
                <>
                  <h3>{t.recommendationsTrendsTitle}</h3>
                  <ul>
                    {recommendations.market_trends.map((item, idx) => (
                      <li key={`rec-trends-${idx}`}>
                        <strong>{sanitizeReportText(item.title)}</strong>
                        <div>{sanitizeReportText(item.rationale)}</div>
                        <div>{sanitizeReportText(item.how_to_test)}</div>
                        {item.methods?.length ? (
                          <div>
                            {item.methods.map((m) => sanitizeReportText(m)).join(', ')}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}
        </section>

        <section id="appendix" className="report-section">
          <h2>{t.appendices}</h2>
          <div className="report-actions">
            <button type="button" className="primary" onClick={handlePrintReport}>
              {t.pdfPrint}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => downloadReportCsv(snapshot, summaryItems, language)}
            >
              {t.exportCsv}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
