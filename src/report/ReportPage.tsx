import { useEffect, useMemo, useRef, useState } from 'react'
import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'
import { groupItemsByCell } from './cellMapping'
import { UsageBadge } from '../components/UsageBadge'
import { buildSessionGoalText, extractProductNameFromSessionName } from './sessionGoal'

type ReportPageProps = {
  snapshot: ReportSnapshot
  language: ReportLang
  onBack: () => void
  aiSupportEnabled: boolean
  diagnosticsEnabled: boolean
  naFillStatus?: 'idle' | 'running' | 'done' | 'error'
  onAiUsage?: (meta: unknown) => void
}

type AiSummary = { today: string; change: string; product: string }
type AiClassification = {
  id: string
  suggestedCellId: string
  confidence: number
  shouldMove: boolean
  reason?: string
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
  | { summary: AiSummary; hash?: string }
  | AiSummary

export const ReportPage = ({
  snapshot,
  language,
  onBack,
  aiSupportEnabled,
  diagnosticsEnabled,
  naFillStatus,
  onAiUsage,
}: ReportPageProps) => {
  const t = reportCopy[language]
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [lastSummaryHash, setLastSummaryHash] = useState<string | null>(null)
  const [summaryItems, setSummaryItems] = useState(snapshot.ideas)
  const [summaryUsage, setSummaryUsage] = useState<SummaryUsage | null>(null)
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const debug = import.meta.env.DEV ? groupItemsByCell(snapshot.ideas) : null
  const summaryAutoAttempted = useRef(false)
  const questionLookup = useMemo(() => {
    const map = new Map<string, string>()
    const questions = Array.isArray(snapshot.questions) ? snapshot.questions : []
    questions.forEach((question) => {
      const id = String(question?.id || '').trim()
      const text = String(question?.text || '').trim()
      if (id && text) map.set(id, text)
    })
    return map
  }, [snapshot.questions])
  const cacheBase = useMemo(() => {
    if (typeof window === 'undefined') return null
    const sessionId = window.sessionStorage.getItem('reportReturnSessionId') || ''
    return sessionId || snapshot.sessionName || 'unknown'
  }, [snapshot.sessionName])
  const summaryCacheKey = useMemo(() => {
    if (!cacheBase) return null
    return `report_ai_summary::${cacheBase}::${language}`
  }, [cacheBase, language])
  const reclassCacheKey = useMemo(() => {
    if (!cacheBase) return null
    return `report_reclass::${cacheBase}::${language}`
  }, [cacheBase, language])
  const computeBoardHash = useMemo(() => {
    const items = summaryItems
      .map((item) => ({
        id: item.id,
        text: String(item.text || '').trim(),
        row: item.matrixRow || '',
        col: item.matrixCol || '',
        label: item.label || '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const payload = items.map((item) => `${item.id}|${item.row}|${item.col}|${item.label}|${item.text}`).join('||')
    let hash = 0
    for (let i = 0; i < payload.length; i += 1) {
      hash = (hash << 5) - hash + payload.charCodeAt(i)
      hash |= 0
    }
    return String(hash)
  }, [summaryItems])
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
          const hash = (parsed as { hash?: string }).hash || null
          if (summary && typeof summary === 'object') {
            setAiSummary(summary)
            setLastSummaryHash(hash)
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

  const handleUpdateReport = () => {
    if (typeof window === 'undefined') return
    const sessionId = window.sessionStorage.getItem('reportReturnSessionId') || ''
    const sourceUpdatedAt = Number(snapshot.sourceUpdatedAt || 0)
    if (!sessionId) {
      setUpdateNotice(t.reportUpdated)
      return
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
          JSON.stringify({ summary: emptySummary, hash: computeBoardHash })
        )
        setLastSummaryHash(computeBoardHash)
      }
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
          entries: entriesPayload,
          cells: ensuredCells,
        }),
      })
      const raw = await response.text()
      let data: {
        ok?: boolean
        source?: 'llm' | 'fallback'
        summary?: AiSummary
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
          JSON.stringify({ summary, hash: computeBoardHash })
        )
        setLastSummaryHash(computeBoardHash)
      }
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
    if (computeBoardHash && lastSummaryHash && computeBoardHash === lastSummaryHash) return
    if (summaryAutoAttempted.current) return
    summaryAutoAttempted.current = true
    await runSummary()
  }

  useEffect(() => {
    void generateSummaryIfNeeded()
  }, [computeBoardHash, lastSummaryHash])
  return (
    <div className="report-page">
      <header className="report-header">
        <h1>{t.title}</h1>
        <div className="report-actions">
          <button type="button" className="ghost" onClick={onBack}>
            {t.back}
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
          {Boolean(aiSummary?.today?.trim()) && (
            <div className="report-summary-block">
              <h3>{t.summaryToday}</h3>
              <p>{aiSummary?.today}</p>
            </div>
          )}
          {Boolean(aiSummary?.change?.trim()) && (
            <div className="report-summary-block">
              <h3>{t.summaryChange}</h3>
              <p>{aiSummary?.change}</p>
            </div>
          )}
          {Boolean(aiSummary?.product?.trim()) && (
            <div className="report-summary-block">
              <h3>{t.summaryProduct}</h3>
              <p>{aiSummary?.product}</p>
            </div>
          )}
          {summaryStatus === 'done' &&
            !aiSummary?.today?.trim() &&
            !aiSummary?.change?.trim() &&
            !aiSummary?.product?.trim() && (
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
                    const questionText = idea.questionId
                      ? questionLookup.get(idea.questionId) || '—'
                      : '—'
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
