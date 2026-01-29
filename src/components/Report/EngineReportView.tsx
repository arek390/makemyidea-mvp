import { useEffect } from 'react'
import type { EngineReportModel } from '../../utils/report/buildEngineReport'

type ReportCopy = {
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
}

type Props = {
  report: EngineReportModel
  copy: ReportCopy
  onClose: () => void
  onPrint: () => void
  onDownloadPdf: () => void
  onExportCsv: () => void
  locale: 'Polish' | 'English'
}

const formatDate = (value: number | null, locale: 'Polish' | 'English') => {
  if (!value) return '—'
  const lang = locale === 'Polish' ? 'pl-PL' : 'en-US'
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

const recommendationCopy = (key: EngineReportModel['recommendations'][number], copy: ReportCopy) => {
  switch (key) {
    case 'expand_ideas':
      return copy.reportRecommendationExpandIdeas
    case 'explore_perspectives':
      return copy.reportRecommendationExplorePerspectives
    case 'deduplicate':
      return copy.reportRecommendationDeduplicate
    case 'prioritize':
      return copy.reportRecommendationPrioritize
    default:
      return ''
  }
}

export const EngineReportView = ({
  report,
  copy,
  onClose,
  onPrint,
  onDownloadPdf,
  onExportCsv,
  locale,
}: Props) => {
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[report] ReportView mounted', { sessionId: report.sessionMeta.sessionId })
    }
  }, [report.sessionMeta.sessionId])

  if (import.meta.env.DEV) {
    console.log('[report] ReportView render', { sessionId: report.sessionMeta.sessionId })
  }
  const toc = [
    { id: 'report-cover', label: copy.reportCoverTitle },
    { id: 'report-toc', label: copy.reportTocTitle },
    { id: 'report-goal', label: copy.reportSessionGoalTitle },
    { id: 'report-summary', label: copy.reportExecutiveSummaryTitle },
    { id: 'report-perspectives', label: copy.reportPerspectiveMapTitle },
    { id: 'report-responses', label: copy.reportCollectedResponsesTitle },
    { id: 'report-insights', label: copy.reportInsightsTitle },
    { id: 'report-recommendations', label: copy.reportRecommendationsTitle },
    { id: 'report-appendices', label: copy.reportAppendicesTitle },
  ]

  const summaryLines = [
    `${copy.reportIdeasLabel}: ${report.stats.totals.ideas}`,
    `${copy.reportQuestionsLabel}: ${report.stats.totals.questions}`,
    `${copy.reportCellsVisitedLabel}: ${report.stats.totals.cellsVisited}/9`,
    `${copy.reportDuplicatesLabel}: ${report.stats.totals.duplicates}`,
  ]

  const rows = ['A', 'B', 'C']
  const cols = [1, 2, 3]

  return (
    <div className="report-view">
      <div className="report-header">
        <div>
          <div className="report-brand">makemyidea.work</div>
          <h1>{copy.reportTitle}</h1>
        </div>
        <div className="report-actions">
          <button type="button" className="ghost" onClick={onPrint}>
            {copy.reportPrint}
          </button>
          <button type="button" className="ghost" onClick={onDownloadPdf}>
            {copy.reportDownloadPdf}
          </button>
          <button type="button" className="ghost" onClick={onExportCsv}>
            {copy.reportExportCsv}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <section id="report-cover" className="report-section">
        <h2>{copy.reportCoverTitle}</h2>
        <div className="report-grid">
          <div>
            <strong>{copy.reportSessionNameLabel}:</strong> {report.sessionMeta.name || '—'}
          </div>
          <div>
            <strong>{copy.reportDateRangeLabel}:</strong>{' '}
            {formatDate(report.sessionMeta.createdAt, locale)} —{' '}
            {formatDate(report.sessionMeta.updatedAt, locale)}
          </div>
          <div>
            <strong>{copy.reportAuthorLabel}:</strong> {report.sessionMeta.author || '—'}
          </div>
          <div>
            <strong>{copy.reportParticipantsLabel}:</strong>{' '}
            {report.sessionMeta.participants.length
              ? report.sessionMeta.participants.join(', ')
              : '—'}
          </div>
        </div>
      </section>

      <section id="report-toc" className="report-section">
        <h2>{copy.reportTocTitle}</h2>
        <ol className="report-toc">
          {toc.map((entry) => (
            <li key={entry.id}>
              <a href={`#${entry.id}`}>{entry.label}</a>
            </li>
          ))}
        </ol>
      </section>

      <details id="report-goal" className="report-section" open>
        <summary>{copy.reportSessionGoalTitle}</summary>
        <p>{report.goal || copy.reportNotProvided}</p>
      </details>

      <details id="report-summary" className="report-section" open>
        <summary>{copy.reportExecutiveSummaryTitle}</summary>
        <ul>
          {summaryLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {report.insights.topKeywords.length ? (
          <p>
            <strong>{copy.reportKeywordsTitle}:</strong> {report.insights.topKeywords.join(', ')}
          </p>
        ) : (
          <p>{copy.reportNoData}</p>
        )}
      </details>

      <details id="report-perspectives" className="report-section" open>
        <summary>{copy.reportPerspectiveMapTitle}</summary>
        <table className="report-matrix">
          <thead>
            <tr>
              <th></th>
              {cols.map((col) => (
                <th key={`col-${col}`}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`row-${row}`}>
                <th>{row}</th>
                {cols.map((col) => {
                  const key = `${row}${col}`
                  const count = report.stats.perCellCounts[key] || 0
                  return (
                    <td key={key}>
                      <div className="report-matrix-cell">
                        <div>{copy.reportPerspectiveVisited}: {count > 0 ? 1 : 0}</div>
                        <div>{copy.reportPerspectiveQuestions}: {count}</div>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details id="report-responses" className="report-section" open>
        <summary>{copy.reportCollectedResponsesTitle}</summary>
        <h3>{copy.reportQuestionsTableTitle}</h3>
        {report.questionsAsked.length ? (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th>{copy.reportQuestionIdLabel}</th>
                  <th>{copy.reportQuestionCellLabel}</th>
                  <th>{copy.reportQuestionTextLabel}</th>
                  <th>{copy.reportQuestionSourceLabel}</th>
                </tr>
              </thead>
              <tbody>
                {report.questionsAsked.map((question) => (
                  <tr key={question.id}>
                    <td>{question.id}</td>
                    <td>{question.cellId || '—'}</td>
                    <td>{question.finalText}</td>
                    <td>{question.source === 'unknown' ? '—' : question.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{copy.reportNoData}</p>
        )}

        <h3>{copy.reportIdeasTableTitle}</h3>
        {report.ideas.length ? (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th>{copy.reportIdeaIdLabel}</th>
                  <th>{copy.reportIdeaTextLabel}</th>
                  <th>{copy.reportIdeaTagsLabel}</th>
                  <th>{copy.reportIdeaCreatedLabel}</th>
                </tr>
              </thead>
              <tbody>
                {report.ideas.map((idea) => (
                  <tr key={idea.id}>
                    <td>{idea.id}</td>
                    <td>{idea.text}</td>
                    <td>{idea.tags.length ? idea.tags.join(', ') : '—'}</td>
                    <td>{formatDate(idea.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{copy.reportNoData}</p>
        )}

        <h3>{copy.reportResponsesTableTitle}</h3>
        {report.responses.length ? (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th>{copy.reportAnswerQuestionLabel}</th>
                  <th>{copy.reportAnswerTextLabel}</th>
                  <th>{copy.reportAnswerCreatedLabel}</th>
                </tr>
              </thead>
              <tbody>
                {report.responses.map((response, index) => (
                  <tr key={`${response.questionId}-${index}`}>
                    <td>{response.questionId}</td>
                    <td>{response.answerText}</td>
                    <td>{formatDate(response.timestamp, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{copy.reportNoData}</p>
        )}
      </details>

      <details id="report-insights" className="report-section" open>
        <summary>{copy.reportInsightsTitle}</summary>
        {report.insights.topKeywords.length ? (
          <p>
            <strong>{copy.reportKeywordsTitle}:</strong> {report.insights.topKeywords.join(', ')}
          </p>
        ) : (
          <p>{copy.reportNoData}</p>
        )}
        <p>
          <strong>{copy.reportDuplicatesLabel}:</strong> {report.insights.duplicates}
        </p>
      </details>

      <details id="report-recommendations" className="report-section" open>
        <summary>{copy.reportRecommendationsTitle}</summary>
        <ul>
          {report.recommendations.map((item) => (
            <li key={item}>{recommendationCopy(item, copy)}</li>
          ))}
        </ul>
      </details>

      <details id="report-appendices" className="report-section" open>
        <summary>{copy.reportAppendicesTitle}</summary>
        <h3>{copy.reportSessionMetaTitle}</h3>
        <div className="report-grid">
          <div>
            <strong>ID:</strong> {report.sessionMeta.sessionId}
          </div>
          <div>
            <strong>{copy.reportSessionNameLabel}:</strong> {report.sessionMeta.name || '—'}
          </div>
          <div>
            <strong>{copy.reportDateRangeLabel}:</strong>{' '}
            {formatDate(report.sessionMeta.createdAt, locale)} —{' '}
            {formatDate(report.sessionMeta.updatedAt, locale)}
          </div>
        </div>
        <h3>{copy.reportExportLinksTitle}</h3>
        <p>{copy.reportExportCsv}</p>
      </details>
    </div>
  )
}
