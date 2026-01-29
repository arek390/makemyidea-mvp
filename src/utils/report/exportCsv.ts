import type { EngineReportModel } from './buildEngineReport'

const escapeCsv = (value: string) => {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const buildCsv = (rows: string[][]) => rows.map((row) => row.map(escapeCsv).join(',')).join('\n')

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const exportEngineReportCsv = (report: EngineReportModel) => {
  const ideaRows = [
    ['id', 'text', 'createdAt', 'tags'],
    ...report.ideas.map((idea) => [
      idea.id,
      idea.text,
      idea.createdAt ? String(idea.createdAt) : '',
      idea.tags.join('|'),
    ]),
  ]
  downloadCsv('ideas.csv', buildCsv(ideaRows))

  const questionRows = [
    ['id', 'cellId', 'finalText', 'source', 'timestamp'],
    ...report.questionsAsked.map((question) => [
      question.id,
      question.cellId || '',
      question.finalText,
      question.source,
      question.timestamp ? String(question.timestamp) : '',
    ]),
  ]
  downloadCsv('questions.csv', buildCsv(questionRows))

  const responseRows = [
    ['questionId', 'answerText', 'linkedIdeaIds', 'timestamp'],
    ...report.responses.map((response) => [
      response.questionId,
      response.answerText,
      response.linkedIdeaIds.join('|'),
      response.timestamp ? String(response.timestamp) : '',
    ]),
  ]
  downloadCsv('responses.csv', buildCsv(responseRows))
}
