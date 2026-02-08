import type { ReportLang } from './reportI18n'

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
    lastSummaryTextHash?: string | null
    summary?: { today: string; change: string; product: string } | null
    ideas?: ReportIdea[] | null
    recommendations?: unknown
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

const formatDate = (value?: number | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10)
    }
  }
  return new Date().toISOString().slice(0, 10)
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

  const fileName = `${sanitizeFilenamePart(snapshot.sessionName)}_${formatDate(
    snapshot.reportMeta?.createdAt ?? null
  )}.csv`
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
