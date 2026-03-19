export type EntryLabelLanguage = 'Polish' | 'English' | 'pl' | 'en'

export const ENGINE_ENTRY_LABELS = [
  'pomysł',
  'problem do rozwiązania',
  'ryzyko / blokada',
  'założenie do weryfikacji',
  'następny krok (action)',
]

export const ENGINE_ENTRY_LABEL_DISPLAY_PL: Record<string, string> = {
  'pomysł': 'pomysł',
  'obserwacja': 'obserwacja',
  'problem do rozwiązania': 'problem',
  'ryzyko / blokada': 'ryzyko / blokada',
  'pytanie do klienta': 'do weryfikacji',
  'pytanie do dostawcy / partnera': 'do weryfikacji',
  'założenie do weryfikacji': 'do weryfikacji',
  'decyzja': 'decyzja',
  'następny krok (action)': 'do zrobienia',
}

export const ENGINE_ENTRY_LABEL_TRANSLATIONS: Record<string, string> = {
  'pomysł': 'idea',
  'obserwacja': 'observation',
  'problem do rozwiązania': 'problem',
  'ryzyko / blokada': 'risk / blocker',
  'pytanie do klienta': 'to validate',
  'pytanie do dostawcy / partnera': 'to validate',
  'założenie do weryfikacji': 'to validate',
  'decyzja': 'decision',
  'następny krok (action)': 'to do',
}

export const ENGINE_ENTRY_LABEL_COLORS: Record<string, string> = {
  'pomysł': '#F2EEE8',
  'obserwacja': '#CFEBDD',
  'problem do rozwiązania': '#CDB9A1',
  'ryzyko / blokada': '#B8A084',
  'pytanie do klienta': '#DCCFBD',
  'pytanie do dostawcy / partnera': '#DCCFBD',
  'założenie do weryfikacji': '#DCCFBD',
  'decyzja': '#FFF1B8',
  'następny krok (action)': '#E8E1D6',
}

export const getEntryLabelText = (label: string, language: EntryLabelLanguage) => {
  if (language === 'English' || language === 'en') {
    return ENGINE_ENTRY_LABEL_TRANSLATIONS[label] || label
  }
  return ENGINE_ENTRY_LABEL_DISPLAY_PL[label] || label
}

export const getNoLabelText = (language: EntryLabelLanguage) =>
  language === 'English' || language === 'en' ? 'No label' : 'Brak etykiety'
