import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'

type ReportPageProps = {
  snapshot: ReportSnapshot
  language: ReportLang
  onBack: () => void
}

export const ReportPage = ({ snapshot, language, onBack }: ReportPageProps) => {
  const t = reportCopy[language]

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
              <a href="#responses">{t.collectedResponses}</a>
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
          <h2>{t.collectedResponses}</h2>
          <p>{t.placeholder}</p>
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
      </main>
    </div>
  )
}
