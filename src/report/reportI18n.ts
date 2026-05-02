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
    trizSelectionHint: string
    trizExplanation: string
    trizDirections: string
    trizApproaches: string
    trizReflections: string
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
    reportOutdatedTooltip: string
    reportUpdateDisabledTooltip: string
    reportOutdatedPrint: string
    classicReportView: string
	    actionPlanView: string
	    yourDataTitle: string
	    whereYouAreTitle: string
	    actionPlanSectionTitle: string
	    actionPlanOtherLabel: string
	    decisionsTitle: string
	    whatNextTitle: string
	    actionPlanEmpty: string
	    mapContextTitle: string
    strongestArea: string
    weakestArea: string
    decisionRiskNote: string
    whyItMatters: string
    riskOfIgnoring: string
    whyNow: string
    expectedResult: string
    chooseAWhen: string
    chooseBWhen: string
    consequenceA: string
    consequenceB: string
    howToCheck: string
    positiveMeans: string
    negativeMeans: string
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
    trizTitle: 'Key trade-offs in your project',
    trizIntro:
      'This section highlights the most important trade-offs in your idea and helps you make deliberate design decisions instead of defaulting to accidental compromises.',
    trizSelectionHint:
      'Select the solutions you want to include in your action plan.',
    trizExplanation: 'Why this trade-off matters',
    trizDirections: 'Solution directions',
    trizApproaches: 'Possible approaches',
    trizReflections: 'What this points you to',
    trizImproving: 'What we want to improve',
    trizWorsening: 'What gets worse',
    trizPrinciples: 'Helpful design cues',
    trizSolutions: 'Potential solution directions',
    trizEmpty:
      'No clear trade-offs are visible in your project yet. To generate this section, add entries that describe concrete decisions or constraints, for example:\n– something needs to be both lightweight and durable\n– you want to reduce cost while maintaining quality\n– the product should be simple to use but offer many features.\nThe more situations like this you describe, the easier it will be to suggest meaningful solution directions.',
    trizGenerateSketch: 'Generate sketch',
    trizRegenerateSketch: 'Generate another sketch',
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
      'Due to new board entries, the Executive summary, Key trade-offs in your project, Perspective / questions map, and\nRecommendations / next steps sections\nrequire an update.',
    reportOutdatedTooltip: 'The plan requires an update after new entries.',
    reportUpdateDisabledTooltip: 'Add entries to the Idea Studio to update the action plan.',
    reportOutdatedPrint:
      'The report does not yet reflect the latest board entries. This applies to the Executive summary, Key trade-offs in your project, Perspective / questions map, and Recommendations / next steps sections.',
    classicReportView: 'Classic report',
	    actionPlanView: 'Action Plan',
	    yourDataTitle: 'Your input',
	    whereYouAreTitle: 'Where you are now',
	    actionPlanSectionTitle: 'Action plan',
	    actionPlanOtherLabel: 'Other',
	    decisionsTitle: 'Key decisions to make',
	    whatNextTitle: 'What next',
	    actionPlanEmpty: 'This action-focused variant is not available for this report yet. Update the report to generate it.',
	    mapContextTitle: 'Current interpretation',
    strongestArea: 'Strongest area',
    weakestArea: 'Weakest area',
    decisionRiskNote: 'Decision risk note',
    whyItMatters: 'Why it matters',
    riskOfIgnoring: 'Risk of ignoring',
    whyNow: 'Why now',
    expectedResult: 'Expected result',
    chooseAWhen: 'Choose A when',
    chooseBWhen: 'Choose B when',
    consequenceA: 'Consequence A',
    consequenceB: 'Consequence B',
    howToCheck: 'How to check',
    positiveMeans: 'A positive result means',
    negativeMeans: 'A negative result means',
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
    trizTitle: 'Kluczowe kompromisy w Twoim projekcie',
    trizIntro:
      'Ta sekcja pokazuje najważniejsze kompromisy projektowe w Twoim pomyśle i pomaga podejmować świadome decyzje zamiast przypadkowych wyborów.',
    trizSelectionHint:
      'Zaznacz te rozwiązania, które chcesz uwzględnić w planie działania.',
    trizExplanation: 'Dlaczego ten kompromis ma znaczenie',
    trizDirections: 'Kierunki rozwiązań',
    trizApproaches: 'Możliwe podejścia',
    trizReflections: 'Na co to Cię naprowadza',
    trizImproving: 'Co chcemy poprawić',
    trizWorsening: 'Co się pogarsza',
    trizPrinciples: 'Pomocne wskazówki projektowe',
    trizSolutions: 'Potencjalne kierunki rozwiązań',
    trizEmpty:
      'Na razie nie widać wyraźnych kompromisów w Twoim projekcie. Aby ta sekcja mogła się pojawić, dodaj wpisy, w których opisujesz konkretne decyzje lub ograniczenia, np.:\n– coś ma być jednocześnie lekkie i wytrzymałe\n– chcesz obniżyć koszt, ale utrzymać jakość\n– produkt ma być prosty w użyciu, ale mieć dużo funkcji.\nIm więcej takich sytuacji opiszesz, tym łatwiej będzie wskazać sensowne kierunki rozwiązań.',
    trizGenerateSketch: 'Wygeneruj szkic',
    trizRegenerateSketch: 'Wygeneruj kolejny szkic',
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
      'Ze względu na nowe wpisy na tablicy, rozdziały Podsumowanie, Kluczowe kompromisy w Twoim projekcie, Mapa perspektyw / pytań oraz Rekomendacje / następne kroki wymagają aktualizacji.',
    reportOutdatedTooltip: 'Plan wymaga aktualizacji po nowych wpisach.',
    reportUpdateDisabledTooltip:
      'Dodaj wpisy do Pracowni pomysłu, aby zaktualizować plan działania.',
    reportOutdatedPrint:
      'Raport nie odzwierciedla jeszcze najnowszych wpisów na tablicy. Dotyczy to rozdziałów Podsumowanie, Kluczowe kompromisy w Twoim projekcie, Mapa perspektyw / pytań oraz Rekomendacje / następne kroki.',
    classicReportView: 'Raport klasyczny',
	    actionPlanView: 'Plan działania',
	    yourDataTitle: 'Twoje dane',
	    whereYouAreTitle: 'Gdzie jesteś teraz',
	    actionPlanSectionTitle: 'Plan działania',
	    actionPlanOtherLabel: 'Inne',
	    decisionsTitle: 'Kluczowe decyzje do podjęcia',
	    whatNextTitle: 'Co dalej',
	    actionPlanEmpty: 'Ten wariant nastawiony na działanie nie jest jeszcze dostępny dla tego raportu. Zaktualizuj raport, aby go wygenerować.',
	    mapContextTitle: 'Obecna interpretacja',
    strongestArea: 'Najsilniej opisany obszar',
    weakestArea: 'Najsłabiej opisany obszar',
    decisionRiskNote: 'Ryzyko decyzyjne',
    whyItMatters: 'Dlaczego to ważne',
    riskOfIgnoring: 'Co ryzykujesz, jeśli to zignorujesz',
    whyNow: 'Dlaczego teraz',
    expectedResult: 'Oczekiwany rezultat',
    chooseAWhen: 'Wybierz A, gdy',
    chooseBWhen: 'Wybierz B, gdy',
    consequenceA: 'Konsekwencja A',
    consequenceB: 'Konsekwencja B',
    howToCheck: 'Jak to sprawdzić',
    positiveMeans: 'Pozytywny wynik oznacza',
    negativeMeans: 'Negatywny wynik oznacza',
  },
}
