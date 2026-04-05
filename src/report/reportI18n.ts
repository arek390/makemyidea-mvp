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
    trizTitle: string
    trizIntro: string
    trizImproving: string
    trizWorsening: string
    trizPrinciples: string
    trizSolutions: string
    trizEmpty: string
    trizGenerateSketch: string
    trizRegenerateSketch: string
    trizDownloadImage: string
    trizSaveImage: string
    trizDeleteImage: string
    trizGeneratingImage: string
    trizImageFailed: string
    trizImageDeleteFailed: string
    trizNoImageYet: string
    trizImageIncluded: string
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
    labelSaveError: string
    recommendationsEmpty: string
    recommendationsIdeasTitle: string
    recommendationsMorphTitle: string
    recommendationsTrendsTitle: string
    updatingAria: string
    reportOutdatedNotice: string
    reportOutdatedPrint: string
  }
> = {
  en: {
    title: 'Action plan',
    back: 'Back to session',
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
    trizTitle: 'Contradictions & Innovation Paths (TRIZ)',
    trizIntro:
      'This section highlights the strongest tensions in your idea and turns them into practical innovation directions instead of trade-offs you simply accept.',
    trizImproving: 'What we want to improve',
    trizWorsening: 'What gets worse',
    trizPrinciples: 'Suggested TRIZ principles',
    trizSolutions: 'Potential solution directions',
    trizEmpty:
      'Not enough strong contradictions were found in the current material. Add more concrete tensions, constraints, or trade-offs to generate this section.',
    trizGenerateSketch: 'Generate sketch',
    trizRegenerateSketch: 'Generate again',
    trizDownloadImage: 'Download image',
    trizSaveImage: 'Save image',
    trizDeleteImage: 'Delete image',
    trizGeneratingImage: 'Generating image…',
    trizImageFailed: 'Image generation failed.',
    trizImageDeleteFailed: 'Image deletion failed.',
    trizNoImageYet: 'No image yet.',
    trizImageIncluded: 'Image included in report.',
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
    reportUpdate: 'Update\naction plan',
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
    labelSaveError: 'Failed to save label.',
    recommendationsEmpty: 'No recommendations. Click “Update action plan” to generate them.',
    recommendationsIdeasTitle: 'Based on your ideas',
    recommendationsMorphTitle: 'Morphological alternatives',
    recommendationsTrendsTitle: 'Market trends',
    updatingAria: 'Updating…',
    reportOutdatedNotice:
      'Due to new board entries, the Executive summary, Contradictions & Innovation Paths (TRIZ), Perspective / questions map, and\nRecommendations / next steps sections\nrequire an update.',
    reportOutdatedPrint:
      'The report does not yet reflect the latest board entries. This applies to the Executive summary, Contradictions & Innovation Paths (TRIZ), Perspective / questions map, and Recommendations / next steps sections.',
  },
  pl: {
    title: 'Plan działania',
    back: 'Wróć do sesji',
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
    trizTitle: 'Sprzeczności i kierunki innowacji (TRIZ)',
    trizIntro:
      'Ta sekcja pokazuje najmocniejsze napięcia w twoim pomyśle i zamienia je w praktyczne kierunki innowacji zamiast kompromisów, które trzeba tylko zaakceptować.',
    trizImproving: 'Co chcemy poprawić',
    trizWorsening: 'Co się pogarsza',
    trizPrinciples: 'Sugerowane zasady TRIZ',
    trizSolutions: 'Potencjalne kierunki rozwiązań',
    trizEmpty:
      'W obecnym materiale nie znaleziono wystarczająco mocnych sprzeczności. Dodaj więcej konkretnych napięć, ograniczeń lub kompromisów, aby wygenerować tę sekcję.',
    trizGenerateSketch: 'Wygeneruj szkic',
    trizRegenerateSketch: 'Wygeneruj ponownie',
    trizDownloadImage: 'Pobierz grafikę',
    trizSaveImage: 'Zapisz grafikę',
    trizDeleteImage: 'Usuń grafikę',
    trizGeneratingImage: 'Generowanie grafiki…',
    trizImageFailed: 'Nie udało się wygenerować grafiki.',
    trizImageDeleteFailed: 'Nie udało się usunąć grafiki.',
    trizNoImageYet: 'Brak grafiki.',
    trizImageIncluded: 'Grafika dołączona do raportu.',
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
    reportUpdate: 'Aktualizuj Plan działania',
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
    labelSaveError: 'Nie udało się zapisać etykiety.',
    recommendationsEmpty: 'Brak rekomendacji. Kliknij “Aktualizuj Plan działania”, aby je wygenerować.',
    recommendationsIdeasTitle: 'Na podstawie twoich pomysłów',
    recommendationsMorphTitle: 'Alternatywy morfologiczne',
    recommendationsTrendsTitle: 'Trendy rynkowe',
    updatingAria: 'Aktualizowanie…',
    reportOutdatedNotice:
      'Ze względu na nowe wpisy na tablicy, rozdziały Podsumowanie, Sprzeczności i kierunki innowacji (TRIZ), Mapa perspektyw / pytań oraz Rekomendacje / następne kroki wymagają aktualizacji.',
    reportOutdatedPrint:
      'Raport nie odzwierciedla jeszcze najnowszych wpisów na tablicy. Dotyczy to rozdziałów Podsumowanie, Sprzeczności i kierunki innowacji (TRIZ), Mapa perspektyw / pytań oraz Rekomendacje / następne kroki.',
  },
}
