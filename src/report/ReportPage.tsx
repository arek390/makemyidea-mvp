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
  onUpdateLabel?: (itemId: string, label: string | null) => Promise<boolean>
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
  onLogout,
  aiSupportEnabled,
  diagnosticsEnabled,
  naFillStatus,
  onUpdateLabel,
}: ReportPageProps) => {
  const t = reportCopy[language]
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
  const [labelUpdating, setLabelUpdating] = useState<Record<string, boolean>>({})
  const [summaryUsage] = useState<SummaryUsage | null>(null)
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const summaryAutoAttempted = useRef(false)
  const reportSessionId = snapshot.sessionId || null
  const [reportMetaLoaded, setReportMetaLoaded] = useState(!client || !reportSessionId)
  const labelErrorText =
    language === 'pl' ? 'Nie udało się zapisać etykiety.' : 'Failed to save label.'

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
    try {
      await fetch('/api/report/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: reportSessionId }),
      })
    } catch {
      // ignore
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
  const hasRecommendations =
    recommendations.based_on_user_ideas.length ||
    recommendations.morphological.length ||
    recommendations.market_trends.length
  return (
    <div className="report-page">
      <header className="report-header">
        <div>
          <div className="report-title-row">
            <h1>{t.title}</h1>
            <span className="report-updating-slot" aria-hidden={naFillStatus !== 'running'}>
              {naFillStatus === 'running' && (
                <span
                  className="report-updating-indicator"
                  role="status"
                  aria-label={language === 'pl' ? 'Aktualizowanie…' : 'Updating…'}
                  title={language === 'pl' ? 'Aktualizowanie…' : 'Updating…'}
                />
              )}
            </span>
          </div>
          <div className="engine-kicker">MAKEMYIDEA.WORK</div>
        </div>
        <div className="report-actions">
          <button type="button" className="primary" onClick={onBack}>
            {t.back}
          </button>
          {showUpdate && (
            <button type="button" className="primary" onClick={handleUpdateReport}>
              {t.reportUpdate}
            </button>
          )}
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
          <p>{t.placeholder}</p>
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
                  summaryItems.map((idea) => {
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
          <div className="report-actions">
            <button type="button" className="primary" onClick={() => window.print()}>
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
