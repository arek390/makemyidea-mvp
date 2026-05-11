import type { ReportLang } from './reportI18n'
import type { ReportExecutionReport, ReportRecommendations, ReportTrizSection } from '../storage/sessionStore'

export type ReportIdea = {
  id: string
  text: string
  label?: string | null
  questionId?: string | null
  questionTextPl?: string | null
  questionTextEn?: string | null
  matrixRow?: string | null
  matrixCol?: string | null
}

export type ReportSnapshot = {
  sessionId?: string | null
  sessionName: string
  date: string
  userName: string
  ideas: ReportIdea[]
  questions?: { id: string; text: string }[]
  sourceUpdatedAt?: number | null
  reportMeta?: {
    createdAt?: number | null
    updatedAt?: number | null
    sourceUpdatedAt?: number | null
    lastSummaryTextHash?: string | null
    summary?: {
      headline?: string
      narrative?: string
      today: string
      change: string
      product: string
    } | null
    ideas?: ReportIdea[] | null
    recommendations?: ReportRecommendations | unknown
    triz?: ReportTrizSection | null
    execution_report?: ReportExecutionReport | null
    lang?: 'pl' | 'en' | null
  } | null
}

const escapeCsv = (value: string) => {
  const normalized = String(value ?? '')
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

const sanitizeFilenamePart = (value: string) => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\/\\:\?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'report'
}

export const downloadReportCsv = (
  snapshot: ReportSnapshot,
  items: ReportIdea[],
  language: ReportLang
) => {
  const rows: string[] = []
  rows.push(['Pytanie', 'Wpis', 'Etykieta'].map(escapeCsv).join(','))
  if (items.length === 0) {
    rows.push(['', '', ''].map(escapeCsv).join(','))
  } else {
    items.forEach((idea) => {
      const question =
        language === 'pl'
          ? idea.questionTextPl || ''
          : idea.questionTextEn || ''
      const text = idea.text || ''
      const label = idea.label || ''
      rows.push([question, text, label].map(escapeCsv).join(','))
    })
  }

  const downloadedDate = new Date().toISOString().slice(0, 10)
  const kindLabel = language === 'pl' ? 'wpisy-idea-studio' : 'idea-studio-items'
  const fileName = `${sanitizeFilenamePart(snapshot.sessionName)}-${downloadedDate}-${kindLabel}.csv`
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
