import { useEffect, useMemo, useState } from 'react'
import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'
import { groupItemsByCell } from './cellMapping'

type ReportPageProps = {
  snapshot: ReportSnapshot
  language: ReportLang
  onBack: () => void
  aiSupportEnabled: boolean
  onAiUsage?: (meta: unknown) => void
}

type AiSummary = { today: string; change: string; product: string }

export const ReportPage = ({
  snapshot,
  language,
  onBack,
  aiSupportEnabled,
  onAiUsage,
}: ReportPageProps) => {
  const t = reportCopy[language]
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [aiPartialNote, setAiPartialNote] = useState<string | null>(null)
  const debug = import.meta.env.DEV ? groupItemsByCell(snapshot.ideas) : null
  const grouped = useMemo(() => groupItemsByCell(snapshot.ideas), [snapshot.ideas])
  const cacheKey = useMemo(() => {
    if (typeof window === 'undefined') return null
    const sessionId = window.sessionStorage.getItem('reportReturnSessionId') || ''
    const keyBase = sessionId || snapshot.sessionName || 'unknown'
    return `report_ai_summary::${keyBase}::${language}`
  }, [language, snapshot.sessionName])
  const cellsPayload = useMemo(() => {
    const toTexts = (items: { text?: string | null }[]) =>
      items.map((item) => String(item.text || '').trim()).filter(Boolean)
    return {
      A1: toTexts(grouped.cells.A1),
      B1: toTexts(grouped.cells.B1),
      C1: toTexts(grouped.cells.C1),
      A2: toTexts(grouped.cells.A2),
      B2: toTexts(grouped.cells.B2),
      C2: toTexts(grouped.cells.C2),
      A3: toTexts(grouped.cells.A3),
      B3: toTexts(grouped.cells.B3),
      C3: toTexts(grouped.cells.C3),
    }
  }, [grouped])
  const emptyToday = !cellsPayload.A1.length && !cellsPayload.B1.length && !cellsPayload.C1.length
  const emptyChange = !cellsPayload.A2.length && !cellsPayload.B2.length && !cellsPayload.C2.length
  const emptyProduct = !cellsPayload.A3.length && !cellsPayload.B3.length && !cellsPayload.C3.length
  const emptyMessages = {
    today: t.aiEmptyA1,
    change: t.aiEmptyA2,
    product: t.aiEmptyA3,
  }

  useEffect(() => {
    if (!cacheKey || typeof window === 'undefined') return
    const cached = window.sessionStorage.getItem(cacheKey)
    if (!cached) return
    try {
      const parsed = JSON.parse(cached) as AiSummary
      if (parsed?.today && parsed?.change && parsed?.product) {
        setAiSummary(parsed)
      }
    } catch {
      // ignore
    }
  }, [cacheKey])

  const runSummary = async () => {
    setAiNotice(null)
    setAiPartialNote(null)
    if (!aiSupportEnabled) {
      setAiNotice(t.aiDisabled)
      return
    }
    if (emptyToday && emptyChange && emptyProduct) {
      setAiSummary({
        today: emptyMessages.today,
        change: emptyMessages.change,
        product: emptyMessages.product,
      })
      return
    }
    if (emptyToday || emptyChange || emptyProduct) {
      setAiPartialNote(t.aiPartialNote)
    }
    setAiLoading(true)
    try {
      const response = await fetch('/api/coach/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ai-support': aiSupportEnabled ? 'on' : 'off',
        },
        body: JSON.stringify({
          action: 'report_summary',
          locale: language,
          sessionName: snapshot.sessionName || '',
          cells: cellsPayload,
        }),
      })
      const raw = await response.text()
      let data: {
        ok?: boolean
        source?: 'llm' | 'fallback'
        summary?: AiSummary
        meta?: { errorCategory?: string }
      } | null = null
      try {
        data = JSON.parse(raw)
      } catch {
        data = null
      }
      if (!response.ok || !data || data.ok === false || !data.summary) {
        setAiNotice(t.aiUnavailable)
        setAiSummary({
          today: emptyMessages.today,
          change: emptyMessages.change,
          product: emptyMessages.product,
        })
        return
      }
      const summary = {
        today: emptyToday ? emptyMessages.today : data.summary.today,
        change: emptyChange ? emptyMessages.change : data.summary.change,
        product: emptyProduct ? emptyMessages.product : data.summary.product,
      }
      setAiSummary(summary)
      if (data.source === 'fallback' || data.meta?.errorCategory) {
        setAiNotice(t.aiUnavailable)
      }
      if (cacheKey && typeof window !== 'undefined') {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(summary))
      }
      if (onAiUsage && data.meta) {
        onAiUsage(data.meta)
      }
    } catch {
      setAiNotice(t.aiUnavailable)
    } finally {
      setAiLoading(false)
    }
  }
  return (
    <div className="report-page">
      <header className="report-header">
        <h1>{t.title}</h1>
        <div className="report-actions">
          <button type="button" className="ghost" onClick={onBack}>
            {t.back}
          </button>
          <button type="button" className="ghost" onClick={() => window.print()}>
            {t.print}
          </button>
          <button type="button" className="ghost" onClick={() => window.print()}>
            {t.downloadPdf}
          </button>
          <button type="button" className="primary" onClick={() => downloadReportCsv(snapshot)}>
            {t.exportCsv}
          </button>
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
          <p>{t.placeholder}</p>
        </section>

        <section id="summary" className="report-section">
          <h2>{t.executiveSummary}</h2>
          <div className="report-summary-actions">
            <button
              type="button"
              className="ghost"
              onClick={runSummary}
              disabled={aiLoading || !aiSupportEnabled}
            >
              {aiLoading ? t.aiGenerating : aiSummary ? t.aiRegenerate : t.aiGenerate}
            </button>
            {aiNotice && <span className="muted">{aiNotice}</span>}
            {aiPartialNote && <span className="muted">{aiPartialNote}</span>}
            {!aiSupportEnabled && <span className="muted">{t.aiDisabled}</span>}
          </div>
          <div className="report-summary-block">
            <h3>{t.summaryToday}</h3>
            <p>{aiSummary?.today || t.placeholder}</p>
          </div>
          <div className="report-summary-block">
            <h3>{t.summaryChange}</h3>
            <p>{aiSummary?.change || t.placeholder}</p>
          </div>
          <div className="report-summary-block">
            <h3>{t.summaryProduct}</h3>
            <p>{aiSummary?.product || t.placeholder}</p>
          </div>
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
                  <th>{t.tableEntry}</th>
                  <th>{t.tableLabel}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.ideas.length === 0 ? (
                  <tr>
                    <td colSpan={2}>{t.noEntries}</td>
                  </tr>
                ) : (
                  snapshot.ideas.map((idea) => {
                    const label = idea.label?.trim() ? idea.label.trim() : t.labelMissing
                    return (
                      <tr key={idea.id}>
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
          <p>{t.placeholder}</p>
        </section>

        <section id="appendix" className="report-section">
          <h2>{t.appendices}</h2>
          <p>{t.placeholder}</p>
        </section>
        {debug && (
          <section className="report-section">
            <h2>DEBUG: Matrix mapping</h2>
            <p className="muted">Counts per cell (A1..C3) + sample items.</p>
            <div className="report-debug-grid">
              {Object.entries(debug.cells).map(([cellId, items]) => (
                <div key={cellId} className="report-debug-card">
                  <strong>
                    {cellId} · {items.length}
                  </strong>
                  <ul>
                    {items.slice(0, 2).map((item) => (
                      <li key={`${cellId}-${item.id}`}>{item.text || '—'}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="report-debug-card">
                <strong>UNASSIGNED · {debug.unassigned.length}</strong>
                <ul>
                  {debug.unassigned.slice(0, 2).map((item) => (
                    <li key={`UNASSIGNED-${item.id}`}>{item.text || '—'}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
