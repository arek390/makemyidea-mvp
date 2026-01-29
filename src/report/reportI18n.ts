export type ReportLang = 'pl' | 'en'

export const reportCopy: Record<
  ReportLang,
  {
    title: string
    back: string
    print: string
    downloadPdf: string
    exportCsv: string
    cover: string
    toc: string
    sessionName: string
    date: string
    sessionGoal: string
    executiveSummary: string
    perspectiveMap: string
    collectedResponses: string
    insights: string
    nextSteps: string
    appendices: string
    placeholder: string
  }
> = {
  en: {
    title: 'Report',
    back: 'Back',
    print: 'Print',
    downloadPdf: 'Download PDF',
    exportCsv: 'Export CSV',
    cover: 'Cover',
    toc: 'Table of contents',
    sessionName: 'Session',
    date: 'Date',
    sessionGoal: 'Session goal',
    executiveSummary: 'Executive summary',
    perspectiveMap: 'Perspective / questions map',
    collectedResponses: 'Collected responses',
    insights: 'Insights & patterns',
    nextSteps: 'Recommendations / next steps',
    appendices: 'Appendices (raw data + metadata)',
    placeholder: 'Placeholder content — to be completed in later versions.',
  },
  pl: {
    title: 'Raport',
    back: 'Wstecz',
    print: 'Drukuj',
    downloadPdf: 'Pobierz PDF',
    exportCsv: 'Eksport CSV',
    cover: 'Okładka',
    toc: 'Spis treści',
    sessionName: 'Sesja',
    date: 'Data',
    sessionGoal: 'Cel sesji',
    executiveSummary: 'Podsumowanie',
    perspectiveMap: 'Mapa perspektyw / pytań',
    collectedResponses: 'Zebrane odpowiedzi',
    insights: 'Wnioski i wzorce',
    nextSteps: 'Rekomendacje / następne kroki',
    appendices: 'Załączniki (surowe dane + metadane)',
    placeholder: 'Treść przykładowa — do uzupełnienia w kolejnych wersjach.',
  },
}
