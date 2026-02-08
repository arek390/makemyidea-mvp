import { useEffect, useMemo, useRef, useState } from 'react'
import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'
import {
  ENGINE_ENTRY_LABELS,
  ENGINE_ENTRY_LABEL_COLORS,
  getEntryLabelText,
  getNoLabelText,
} from '../engine/entryLabels'
import type { ReportRecommendations } from '../storage/sessionStore'
import { UsageBadge } from '../components/UsageBadge'
import { buildSessionGoalText, extractProductNameFromSessionName } from './sessionGoal'
import { fetchReportBySessionId } from '../lib/cloudReports'
import { supabase as client } from '../lib/supabase/client'
import { AiCostButton } from '../components/AiCostButton'
 
const TOPUP_RETURN_TO_KEY = 'topup-return-to'

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
  naFillStatus?: 'idle' | 'running' | 'done' | 'error'
  onAiUsage?: (meta: unknown) => void
  onReportMetaChange?: (meta: {
    summary?: AiSummary | null
    lastSummaryTextHash?: string | null
    createdAt?: number | null
    ideas?: ReportSnapshot['ideas'] | null
    recommendations?: ReportRecommendations | null
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
  value = value.replace(/\(\s*(?:[ABC][123]\s*(?:,\s*[ABC][123]\s*)*)\)/g, '')
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
    source_snapshot: null as unknown,
  }
  if (!payload || typeof payload !== 'object') {
    return { ...empty }
  }
  const value = payload as {
    summary?: unknown
    ideas?: unknown
    recommendations?: unknown
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
  return {
    summary,
    ideas,
    recommendations,
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
  naFillStatus,
  onUpdateLabel,
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
  const [priceMinor, setPriceMinor] = useState<number | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
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
          .from('pricing_rules')
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
    const sessionId = window.sessionStorage.getItem('reportReturnSessionId') || ''
    const sourceUpdatedAt = Number(snapshot.sourceUpdatedAt || 0)
    if (!sessionId) {
      setUpdateNotice(t.reportUpdated)
      return
    }
    console.log('[report:update] no-llm step1')
    setIsReportUpdating(true)
    try {
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const response = await fetch('/api/report?action=update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId: reportSessionId, lang: language }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        if (payload?.error === 'INSUFFICIENT_BALANCE') {
          onBillingInsufficient?.()
          if (diagnosticsEnabled) {
            console.warn('[report:update] insufficient balance', payload)
          }
          return
        }
      }
      if (response.ok && payload?.ok) {
        onBillingRefresh?.()
      }
    } catch {
      // ignore
    } finally {
      setIsReportUpdating(false)
    }
    if (reportSessionId) {
      try {
        const record = await fetchReportBySessionId(reportSessionId)
        if (record) {
          const normalized = validateAndNormalizeReport({
            summary: record.summary,
            ideas: record.ideas,
            recommendations: record.recommendations,
          })
          const sanitized = sanitizeReportPayload(normalized)
          setReportRecommendations(sanitized.recommendations)
          setAiSummary(sanitized.summary)
          setLastSummaryTextHash(record.lastSummaryTextHash ?? null)
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
                    const labelBg = hasLabel ? ENGINE_ENTRY_LABEL_COLORS[labelValue] : '#ffffff'
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
