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
    userName: string
    sessionGoal: string
    executiveSummary: string
    perspectiveMap: string
    collectedIdeas: string
    insights: string
    nextSteps: string
    appendices: string
    tableEntry: string
    tableLabel: string
    labelMissing: string
    noEntries: string
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
    userName: 'User',
    sessionGoal: 'Session goal',
    executiveSummary: 'Executive summary',
    perspectiveMap: 'Perspective / questions map',
    collectedIdeas: 'Collected ideas and observations',
    insights: 'Insights & patterns',
    nextSteps: 'Recommendations / next steps',
    appendices: 'Appendices (raw data + metadata)',
    tableEntry: 'Entry',
    tableLabel: 'Label',
    labelMissing: 'label not defined',
    noEntries: 'No entries',
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
    userName: 'Użytkownik',
    sessionGoal: 'Cel sesji',
    executiveSummary: 'Podsumowanie',
    perspectiveMap: 'Mapa perspektyw / pytań',
    collectedIdeas: 'Zebrane pomysły i obserwacje',
    insights: 'Wnioski i wzorce',
    nextSteps: 'Rekomendacje / następne kroki',
    appendices: 'Załączniki (surowe dane + metadane)',
    tableEntry: 'Wpis',
    tableLabel: 'Etykieta',
    labelMissing: 'etykieta niezdefiniowana',
    noEntries: 'Brak wpisów',
    placeholder: 'Treść przykładowa — do uzupełnienia w kolejnych wersjach.',
  },
}
