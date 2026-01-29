import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'
import { groupItemsByCell } from './cellMapping'

type ReportPageProps = {
  snapshot: ReportSnapshot
  language: ReportLang
  onBack: () => void
}

export const ReportPage = ({ snapshot, language, onBack }: ReportPageProps) => {
  const t = reportCopy[language]
  const debug = import.meta.env.DEV ? groupItemsByCell(snapshot.ideas) : null
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
          <p>{t.placeholder}</p>
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
