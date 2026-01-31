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
    lastSummaryTextHash?: string | null
    summary?: { today: string; change: string; product: string } | null
  } | null
}

const escapeCsv = (value: string) => {
  const normalized = value.replace(/\r?\n/g, ' ').trim()
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

export const downloadReportCsv = (snapshot: ReportSnapshot) => {
  const rows: string[] = []
  rows.push(['sessionName', 'date', 'userName'].map(escapeCsv).join(','))
  rows.push(
    [snapshot.sessionName || '—', snapshot.date || '—', snapshot.userName || '—']
      .map(escapeCsv)
      .join(',')
  )
  rows.push('')
  rows.push(['ideas'].join(','))
  rows.push(['id', 'text'].map(escapeCsv).join(','))
  if (snapshot.ideas.length === 0) {
    rows.push(['-', ''].map(escapeCsv).join(','))
  } else {
    snapshot.ideas.forEach((idea) => {
      rows.push([idea.id, idea.text].map(escapeCsv).join(','))
    })
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'report_v1.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
