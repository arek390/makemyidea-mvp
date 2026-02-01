export type ReportLang = 'pl' | 'en'

export const reportCopy: Record<
  ReportLang,
  {
    title: string
    back: string
    print: string
    downloadPdf: string
    pdfPrint: string
    exportCsv: string
    cover: string
    toc: string
    sessionName: string
    date: string
    userName: string
    sessionGoal: string
    executiveSummary: string
    summaryToday: string
    summaryChange: string
    summaryProduct: string
    perspectiveMap: string
    collectedIdeas: string
    nextSteps: string
    appendices: string
    aiGenerate: string
    aiRegenerate: string
    aiGenerating: string
    aiDisabled: string
    aiUnavailable: string
    aiPartialNote: string
    aiEmptyA1: string
    aiEmptyA2: string
    aiEmptyA3: string
    summaryGenerating: string
    summaryEmptyTitle: string
    summaryEmptyBody: string
    reportUpdate: string
    reportUpdated: string
    reportNoChanges: string
    logout: string
    naAssigning: string
    naAssigningError: string
    tableEntry: string
    tableLabel: string
    tableQuestion: string
    noEntries: string
    placeholder: string
  }
> = {
  en: {
    title: 'Report',
    back: 'Back',
    print: 'Print',
    downloadPdf: 'Download PDF',
    pdfPrint: 'PDF / Print',
    exportCsv: 'Export "Collected ideas & observations" to CSV',
    cover: 'Cover',
    toc: 'Table of contents',
    sessionName: 'Session',
    date: 'Date',
    userName: 'Report author',
    sessionGoal: 'Session goal',
    executiveSummary: 'Executive summary',
    summaryToday: 'What I see today',
    summaryChange: 'What I want to change',
    summaryProduct: 'My product concept',
    perspectiveMap: 'Perspective / questions map',
    collectedIdeas: 'Collected ideas and observations',
    nextSteps: 'Recommendations / next steps',
    appendices: 'Appendices',
    aiGenerate: 'Generate AI summary',
    aiRegenerate: 'Regenerate',
    aiGenerating: 'Generating…',
    aiDisabled: 'AI support is disabled.',
    aiUnavailable: 'AI unavailable — showing fallback.',
    aiPartialNote: 'Some cells are empty; summary generated from available entries.',
    aiEmptyA1: 'No entries in key perspectives – summary not generated.',
    aiEmptyA2: 'No entries in A2/B2/C2 – summary not generated.',
    aiEmptyA3: 'No entries in A3/B3/C3 – summary not generated.',
    summaryGenerating: 'Creating summary…',
    summaryEmptyTitle: 'You’ll get a summary once you add a few more notes',
    summaryEmptyBody:
      'Right now there isn’t enough on the board to create a summary that truly helps you move forward. Add 2–3 short notes (like sticky notes) and I’ll generate a clear summary and suggested next steps.',
    reportUpdate: 'Update report',
    reportUpdated: 'Report updated.',
    reportNoChanges: 'No changes to apply.',
    logout: 'Log out',
    naAssigning: 'Assigning entries…',
    naAssigningError: 'Unable to assign entries automatically.',
    tableEntry: 'Entry',
    tableLabel: 'Label',
    tableQuestion: 'Question',
    noEntries: 'No entries',
    placeholder: 'Placeholder content — to be completed in later versions.',
  },
  pl: {
    title: 'Raport',
    back: 'Wstecz',
    print: 'Drukuj',
    downloadPdf: 'Pobierz PDF',
    pdfPrint: 'PDF / Drukuj',
    exportCsv: 'Export "Zebrane pomysły i obserwacje" do CSV',
    cover: 'Informacje ogólne',
    toc: 'Spis treści',
    sessionName: 'Sesja',
    date: 'Data',
    userName: 'Autor raportu',
    sessionGoal: 'Cel sesji',
    executiveSummary: 'Podsumowanie',
    summaryToday: 'To widzę dzisiaj',
    summaryChange: 'To chcę zmienić',
    summaryProduct: 'To mój pomysł na produkt',
    perspectiveMap: 'Mapa perspektyw / pytań',
    collectedIdeas: 'Zebrane pomysły i obserwacje',
    nextSteps: 'Rekomendacje / następne kroki',
    appendices: 'Załączniki',
    aiGenerate: 'Generuj podsumowanie AI',
    aiRegenerate: 'Generuj ponownie',
    aiGenerating: 'Generuję…',
    aiDisabled: 'Obsługa AI jest wyłączona.',
    aiUnavailable: 'AI niedostępne — pokazuję fallback.',
    aiPartialNote: 'Część pól jest pusta — podsumowanie na podstawie dostępnych wpisów.',
    aiEmptyA1: 'Brak wpisów w kluczowych perspektywach – nie generuję podsumowania.',
    aiEmptyA2: 'Brak wpisów w perspektywach A2/B2/C2 – nie generuję podsumowania.',
    aiEmptyA3: 'Brak wpisów w perspektywach A3/B3/C3 – nie generuję podsumowania.',
    summaryGenerating: 'Tworzę podsumowanie…',
    summaryEmptyTitle: 'Podsumowanie pojawi się, gdy dopiszesz kilka wpisów',
    summaryEmptyBody:
      'Na razie na tablicy jest zbyt mało konkretnych informacji, żeby przygotować podsumowanie, które realnie pomoże iść dalej. Dodaj 2–3 krótkie wpisy (jak post-it) — wtedy wygeneruję klarowne podsumowanie i kolejne kroki.',
    reportUpdate: 'Aktualizuj raport',
    reportUpdated: 'Raport został zaktualizowany.',
    reportNoChanges: 'Brak zmian do wprowadzenia.',
    logout: 'Wyloguj',
    naAssigning: 'Uzupełnianie przypisań…',
    naAssigningError: 'Nie udało się uzupełnić przypisań automatycznie.',
    tableEntry: 'Wpis',
    tableLabel: 'Etykieta',
    tableQuestion: 'Pytanie',
    noEntries: 'Brak wpisów',
    placeholder: 'Treść przykładowa — do uzupełnienia w kolejnych wersjach.',
  },
}
