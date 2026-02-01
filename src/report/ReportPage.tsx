import { useEffect, useMemo, useRef, useState } from 'react'
import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'
import type { ReportRecommendations } from '../storage/sessionStore'
import { groupItemsByCell } from './cellMapping'
import { UsageBadge } from '../components/UsageBadge'
import { buildSessionGoalText, extractProductNameFromSessionName } from './sessionGoal'
import {
  ensureReportExists,
  fetchReportBySessionId,
  updateReportBySessionId,
} from '../lib/cloudReports'
import { supabase as client } from '../lib/supabase/client'
import { fetchBoardItems } from '../lib/cloudBoardItems'

type ReportPageProps = {
  snapshot: ReportSnapshot
  language: ReportLang
  onBack: () => void
  onLogout: () => void
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
}

type AiSummary = { today: string; change: string; product: string }
type AiClassification = {
  id: string
  suggestedCellId: string
  confidence: number
  shouldMove: boolean
  reason?: string
}

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

const normalizeRecommendations = (value: unknown): ReportRecommendations | null => {
  if (!value || typeof value !== 'object') return null
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
  if (!based.length && !morph.length && !trends.length) return null
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

type SummaryCachePayload =
  | { summary: AiSummary; lastSummaryTextHash?: string }
  | AiSummary

export const ReportPage = ({
  snapshot,
  language,
  onBack,
  onLogout,
  userId,
  aiSupportEnabled,
  diagnosticsEnabled,
  naFillStatus,
  onAiUsage,
  onReportMetaChange,
}: ReportPageProps) => {
  const t = reportCopy[language]
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(
    sanitizeReportPayload(snapshot.reportMeta?.summary ?? null)
  )
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [lastSummaryTextHash, setLastSummaryTextHash] = useState<string | null>(
    snapshot.reportMeta?.lastSummaryTextHash ?? null
  )
  const [summaryItems, setSummaryItems] = useState(
    sanitizeReportPayload(snapshot.reportMeta?.ideas ?? [])
  )
  const [reportRecommendations, setReportRecommendations] = useState<ReportRecommendations | null>(
    normalizeRecommendations(sanitizeReportPayload(snapshot.reportMeta?.recommendations ?? null))
  )
  const [reportRefreshRequested, setReportRefreshRequested] = useState(false)
  const [summaryUsage, setSummaryUsage] = useState<SummaryUsage | null>(null)
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const summaryAutoAttempted = useRef(false)
  const reportSessionId = snapshot.sessionId || null
  const reportSourceUpdatedAt = Number(snapshot.sourceUpdatedAt || 0)
  const [reportMetaLoaded, setReportMetaLoaded] = useState(!client || !reportSessionId)

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
  const cacheBase = useMemo(() => {
    if (typeof window === 'undefined') return null
    const sessionId = window.sessionStorage.getItem('reportReturnSessionId') || ''
    return sessionId || snapshot.sessionName || 'unknown'
  }, [snapshot.sessionName])
  const summaryCacheKey = useMemo(() => {
    if (snapshot.sessionId) {
      return `report_ai_summary::${snapshot.sessionId}::${language}`
    }
    if (!cacheBase) return null
    return `report_ai_summary::${cacheBase}::${language}`
  }, [cacheBase, language, snapshot.sessionId])
  const reclassCacheKey = useMemo(() => {
    if (!cacheBase) return null
    return `report_reclass::${cacheBase}::${language}`
  }, [cacheBase, language])
  const computeSummaryTextFingerprint = useMemo(() => {
    const items = summaryItems
      .map((item) => ({
        id: String(item.id || '').trim(),
        text: String(item.text || '').trim(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const payload = items.map((item) => `${item.id}::${item.text}`).join('||')
    let hash = 0
    for (let i = 0; i < payload.length; i += 1) {
      hash = (hash << 5) - hash + payload.charCodeAt(i)
      hash |= 0
    }
    return String(hash)
  }, [summaryItems])

  const persistReportSummary = async (
    summary: AiSummary | null,
    textHash: string,
    items: (typeof summaryItems)[number][],
    recommendations: unknown
  ) => {
    if (!client) return
    if (!reportSessionId) return
    try {
      const ideas = items.map((item) => ({
        id: item.id,
        text: item.text,
        label: item.label ?? null,
        questionId:
          (Object.prototype.hasOwnProperty.call(item, 'questionId')
            ? (item as { questionId?: string | null }).questionId
            : null) ??
          (item as { question_id?: string | null }).question_id ??
          null,
        questionTextPl:
          (Object.prototype.hasOwnProperty.call(item, 'questionTextPl')
            ? (item as { questionTextPl?: string | null }).questionTextPl
            : null) ??
          (item as { question_text_pl?: string | null }).question_text_pl ??
          null,
        questionTextEn:
          (Object.prototype.hasOwnProperty.call(item, 'questionTextEn')
            ? (item as { questionTextEn?: string | null }).questionTextEn
            : null) ??
          (item as { question_text_en?: string | null }).question_text_en ??
          null,
        matrixRow:
          (Object.prototype.hasOwnProperty.call(item, 'matrixRow')
            ? (item as { matrixRow?: string | null }).matrixRow
            : null) ??
          (item as { matrix_row?: string | null }).matrix_row ??
          null,
        matrixCol:
          (Object.prototype.hasOwnProperty.call(item, 'matrixCol')
            ? (item as { matrixCol?: string | null }).matrixCol
            : null) ??
          (item as { matrix_col?: string | null }).matrix_col ??
          null,
      }))
      const sanitized = sanitizeReportPayload({ summary, ideas, recommendations })
      await ensureReportExists(reportSessionId, reportSourceUpdatedAt)
      await updateReportBySessionId(reportSessionId, {
        summary_json: sanitized,
        last_summary_text_hash: textHash,
        source_updated_at: reportSourceUpdatedAt,
        updated_at: new Date().toISOString(),
      })
    } catch {
      // ignore persistence errors to avoid blocking UI
    }
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

  const ensureAssignedCell = (item: (typeof snapshot.ideas)[number]) => {
    if (item.matrixRow && item.matrixCol) return item
    return { ...item, matrixRow: 'product', matrixCol: 'not_working' }
  }

  const cellIdFor = (item: (typeof snapshot.ideas)[number]) => {
    const row = String(item.matrixRow || '').toLowerCase()
    const col = String(item.matrixCol || '').toLowerCase()
    const group = row === 'world' ? 'A' : row === 'product' ? 'B' : row === 'elements' ? 'C' : null
    const mode = col === 'as_is' ? '1' : col === 'not_working' ? '2' : col === 'should_be' ? '3' : null
    return group && mode ? `${group}${mode}` : 'B2'
  }

  const applyClassification = (
    items: (typeof snapshot.ideas)[number][],
    classifications: AiClassification[]
  ) => {
    const byId = new Map(classifications.map((c) => [c.id, c]))
    return items.map((item) => {
      const entry = byId.get(item.id)
      if (!entry) return item
      if (!entry.shouldMove || entry.confidence < 0.75) return item
      const cell = entry.suggestedCellId
      if (!cell) return item
      const group = cell[0]
      const mode = cell[1]
      const matrixRow =
        group === 'A' ? 'world' : group === 'B' ? 'product' : group === 'C' ? 'elements' : item.matrixRow
      const matrixCol =
        mode === '1'
          ? 'as_is'
          : mode === '2'
            ? 'not_working'
            : mode === '3'
              ? 'should_be'
              : item.matrixCol
      return { ...item, matrixRow, matrixCol }
    })
  }

  useEffect(() => {
    if (!summaryCacheKey || typeof window === 'undefined') return
    const cached = window.sessionStorage.getItem(summaryCacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as SummaryCachePayload
        if (parsed && typeof parsed === 'object' && 'summary' in parsed) {
          const summary = (parsed as { summary?: AiSummary }).summary
          const hash =
            (parsed as { lastSummaryTextHash?: string }).lastSummaryTextHash || null
          if (summary && typeof summary === 'object') {
            setAiSummary(summary)
            setLastSummaryTextHash(hash)
            setSummaryStatus('done')
          }
        } else if (parsed && typeof parsed === 'object') {
          const summary = parsed as AiSummary
          if (summary && typeof summary === 'object') {
            setAiSummary(summary)
            setSummaryStatus('done')
          }
        }
      } catch {
        // ignore
      }
    }
    if (!reclassCacheKey) return
    const cachedReclass = window.sessionStorage.getItem(reclassCacheKey)
    if (!cachedReclass) return
    try {
      const parsed = JSON.parse(cachedReclass) as AiClassification[]
      if (Array.isArray(parsed) && parsed.length) {
        setSummaryItems((prev) => applyClassification(prev, parsed))
      }
    } catch {
      // ignore
    }
  }, [summaryCacheKey, reclassCacheKey])

  useEffect(() => {
    if (!reportSessionId) return
    if (!reportRefreshRequested) return
    if (userId && client) {
      let cancelled = false
      ;(async () => {
        try {
          const items = await fetchBoardItems(reportSessionId, userId)
          if (!cancelled) setSummaryItems(items)
        } catch {
          // ignore
        }
      })()
      return () => {
        cancelled = true
      }
    }
    setSummaryItems([])
  }, [reportSessionId, userId, reportRefreshRequested])

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
        if (record.ideas && record.ideas.length) {
          const sanitizedIdeas = sanitizeReportPayload(record.ideas)
          setSummaryItems(sanitizedIdeas)
        }
        if (record.recommendations) {
          setReportRecommendations(sanitizeReportPayload(record.recommendations))
        }
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

  const showUpdate = (() => {
    if (typeof window === 'undefined') return true
    return !(window.history.state && window.history.state.newlyCreated === true)
  })()

  if (import.meta.env.DEV) {
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
    setReportRefreshRequested(true)
    if (userId && reportSessionId) {
      try {
        const items = await fetchBoardItems(reportSessionId, userId)
        setSummaryItems(items)
      } catch {
        // ignore
      }
    }
    setAiSummary(null)
    setLastSummaryTextHash(null)
    setReportRecommendations(null)
    summaryAutoAttempted.current = false
    setSummaryStatus('idle')
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
    try {
      await runSummary()
    } finally {
      setReportRefreshRequested(false)
    }
  }

  const runSummary = async () => {
    setAiNotice(null)
    setSummaryUsage(null)
    if (!aiSupportEnabled) {
      setAiNotice(t.aiDisabled)
      setSummaryStatus('done')
      return
    }
    const ensuredItems = summaryItems.map(ensureAssignedCell)
    const groupedEnsured = groupItemsByCell(ensuredItems)
    const toTexts = (items: { text?: string | null }[]) =>
      items.map((item) => String(item.text || '').trim()).filter(Boolean)
    const ensuredCells = {
      A1: toTexts(groupedEnsured.cells.A1),
      B1: toTexts(groupedEnsured.cells.B1),
      C1: toTexts(groupedEnsured.cells.C1),
      A2: toTexts(groupedEnsured.cells.A2),
      B2: toTexts(groupedEnsured.cells.B2),
      C2: toTexts(groupedEnsured.cells.C2),
      A3: toTexts(groupedEnsured.cells.A3),
      B3: toTexts(groupedEnsured.cells.B3),
      C3: toTexts(groupedEnsured.cells.C3),
    }
    const ensuredEmptyToday =
      !ensuredCells.A1.length && !ensuredCells.B1.length && !ensuredCells.C1.length
    const ensuredEmptyChange =
      !ensuredCells.A2.length && !ensuredCells.B2.length && !ensuredCells.C2.length
    const ensuredEmptyProduct =
      !ensuredCells.A3.length && !ensuredCells.B3.length && !ensuredCells.C3.length

    setSummaryItems(ensuredItems)
    if (ensuredEmptyToday && ensuredEmptyChange && ensuredEmptyProduct) {
      const emptySummary = { today: '', change: '', product: '' }
      setAiSummary(emptySummary)
      if (summaryCacheKey && typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          summaryCacheKey,
          JSON.stringify({
            summary: emptySummary,
            lastSummaryTextHash: computeSummaryTextFingerprint,
          })
        )
        setLastSummaryTextHash(computeSummaryTextFingerprint)
      }
      onReportMetaChange?.({
        summary: emptySummary,
        lastSummaryTextHash: computeSummaryTextFingerprint,
        createdAt: snapshot.reportMeta?.createdAt ?? Date.now(),
        ideas: ensuredItems,
      })
      void persistReportSummary(
        emptySummary,
        computeSummaryTextFingerprint,
        ensuredItems,
        reportRecommendations
      )
      setSummaryStatus('done')
      return
    }
    setSummaryStatus('running')
    try {
      const entriesPayload = ensuredItems.map((item) => ({
        id: item.id,
        text: item.text,
        currentCellId: cellIdFor(item),
      }))
      if (!reportSessionId) {
        setAiNotice(t.aiUnavailable)
        setSummaryStatus('error')
        return
      }
      console.log('[suggest][client] preflight', {
        source: 'report_summary',
        sessionId: reportSessionId,
        sessionPersisted: true,
      })
      const response = await fetch('/api/coach/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ai-support': aiSupportEnabled ? 'on' : 'off',
        },
        body: JSON.stringify({
          currentUserId: userId ?? null,
          sessionId: reportSessionId,
          action: 'report_full',
          locale: language,
          sessionName: snapshot.sessionName || '',
          entries: entriesPayload,
          cells: ensuredCells,
        }),
      })
      const raw = await response.text()
      let data: {
        ok?: boolean
        source?: 'llm' | 'fallback'
        summary?: AiSummary
        recommendations?: unknown
        classifications?: AiClassification[]
        usage?: SummaryUsage
        meta?: { errorCategory?: string }
      } | null = null
      try {
        data = JSON.parse(raw)
      } catch {
        data = null
      }
      if (!response.ok || !data || data.ok === false || !data.summary) {
        setAiNotice(t.aiUnavailable)
        setSummaryStatus('error')
        return
      }
      const summary = {
        today: ensuredEmptyToday ? '' : data.summary.today,
        change: ensuredEmptyChange ? '' : data.summary.change,
        product: ensuredEmptyProduct ? '' : data.summary.product,
      }
      setAiSummary(summary)
      const nextRecommendations =
        normalizeRecommendations(data.recommendations) || reportRecommendations
      if (nextRecommendations) {
        setReportRecommendations(nextRecommendations)
      }
      if (data.classifications && data.classifications.length) {
        const updated = applyClassification(ensuredItems, data.classifications)
        setSummaryItems(updated)
        if (reclassCacheKey && typeof window !== 'undefined') {
          window.sessionStorage.setItem(reclassCacheKey, JSON.stringify(data.classifications))
        }
      }
      if (data.usage) {
        setSummaryUsage(data.usage)
      }
      if (data.source === 'fallback' || data.meta?.errorCategory) {
        setAiNotice(t.aiUnavailable)
      }
      if (summaryCacheKey && typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          summaryCacheKey,
          JSON.stringify({ summary, lastSummaryTextHash: computeSummaryTextFingerprint })
        )
        setLastSummaryTextHash(computeSummaryTextFingerprint)
      }
      onReportMetaChange?.({
        summary,
        lastSummaryTextHash: computeSummaryTextFingerprint,
        createdAt: snapshot.reportMeta?.createdAt ?? Date.now(),
        ideas: ensuredItems,
        recommendations: nextRecommendations,
      })
      void persistReportSummary(summary, computeSummaryTextFingerprint, ensuredItems, nextRecommendations)
      if (onAiUsage && data.meta) {
        onAiUsage(data.meta)
      }
    } catch {
      setAiNotice(t.aiUnavailable)
      setSummaryStatus('error')
    } finally {
      setSummaryStatus((prev) => (prev === 'error' ? 'error' : 'done'))
    }
  }

  const generateSummaryIfNeeded = async () => {
    if (summaryStatus === 'running') return
    if (summaryAutoAttempted.current) return
    if (!reportRefreshRequested) return
    const stored = lastSummaryTextHash
    const current = computeSummaryTextFingerprint
    const hasSummary = Boolean(
      aiSummary && (aiSummary.today || aiSummary.change || aiSummary.product)
    )
    if (stored && current === stored) return
    if (!stored && hasSummary) {
      if (summaryCacheKey && typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          summaryCacheKey,
          JSON.stringify({ summary: aiSummary, lastSummaryTextHash: current })
        )
      }
      if (aiSummary) {
        void persistReportSummary(aiSummary, current, summaryItems, reportRecommendations)
      }
      setLastSummaryTextHash(current)
      onReportMetaChange?.({
        summary: aiSummary,
        lastSummaryTextHash: current,
        createdAt: snapshot.reportMeta?.createdAt ?? Date.now(),
        ideas: summaryItems,
      })
      return
    }
    summaryAutoAttempted.current = true
    await runSummary()
    setReportRefreshRequested(false)
  }

  useEffect(() => {
    if (!reportMetaLoaded) return
    void generateSummaryIfNeeded()
  }, [
    computeSummaryTextFingerprint,
    lastSummaryTextHash,
    aiSummary,
    reportMetaLoaded,
    reportRefreshRequested,
  ])

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
  const resolveQuestionText = (idea: (typeof summaryItems)[number]) => {
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
    | null
  const hasRecommendations =
    recommendations &&
    (recommendations.based_on_user_ideas.length ||
      recommendations.morphological.length ||
      recommendations.market_trends.length)
  return (
    <div className="report-page">
      <header className="report-header">
        <h1>{t.title}</h1>
        <div className="report-actions">
          <button type="button" className="ghost" onClick={onBack}>
            {t.back}
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            {t.logout}
          </button>
          {showUpdate && (
            <button type="button" className="ghost" onClick={handleUpdateReport}>
              {t.reportUpdate}
            </button>
          )}
          <button type="button" className="ghost" onClick={() => window.print()}>
            {t.print}
          </button>
          <button type="button" className="ghost" onClick={() => window.print()}>
            {t.downloadPdf}
          </button>
          <button type="button" className="primary" onClick={() => downloadReportCsv(snapshot)}>
            {t.exportCsv}
          </button>
          {naFillStatus === 'running' && <span className="muted">{t.naAssigning}</span>}
          {naFillStatus === 'error' && <span className="muted">{t.naAssigningError}</span>}
        </div>
      </header>

      <main className="report-body">
        <section id="cover" className="report-section">
          <h2>{t.cover}</h2>
          <p>
            <strong>{t.sessionName}:</strong> {snapshot.sessionName || '—'}
          </p>
          <p>
            <strong>{t.date}:</strong> {snapshot.date || '—'}
          </p>
          <p>
            <strong>{t.userName}:</strong> {snapshot.userName || '—'}
          </p>
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
              <a href="#insights">{t.insights}</a>
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
          {diagnosticsEnabled && aiNotice && <span className="muted">{aiNotice}</span>}
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
          <p>{t.placeholder}</p>
        </section>

        <section id="responses" className="report-section">
          <h2>{t.collectedIdeas}</h2>
          <div className="report-table-wrapper">
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
                  summaryItems.map((idea) => {
                    const label = idea.label?.trim() ? idea.label.trim() : t.labelMissing
                    const questionText = resolveQuestionText(idea)
                    return (
                      <tr key={idea.id}>
                        <td>{questionText}</td>
                        <td>{idea.text || '—'}</td>
                        <td>{label}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="insights" className="report-section">
          <h2>{t.insights}</h2>
          <p>{t.placeholder}</p>
        </section>

        <section id="next" className="report-section">
          <h2>{t.nextSteps}</h2>
          {!hasRecommendations ? (
            <p>Brak rekomendacji. Kliknij “Aktualizuj raport”, aby je wygenerować.</p>
          ) : (
            <div className="report-recommendations">
              {recommendations?.based_on_user_ideas.length ? (
                <>
                  <h3>
                    {language === 'pl'
                      ? 'Na podstawie pomysłów użytkownika'
                      : 'Based on user ideas'}
                  </h3>
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
                  <h3>
                    {language === 'pl'
                      ? 'Alternatywy morfologiczne'
                      : 'Morphological alternatives'}
                  </h3>
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
                  <h3>{language === 'pl' ? 'Trendy rynkowe' : 'Market trends'}</h3>
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
          <p>{t.placeholder}</p>
        </section>
      </main>
    </div>
  )
}
