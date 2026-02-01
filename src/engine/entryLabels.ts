export type EntryLabelLanguage = 'Polish' | 'English' | 'pl' | 'en'

export const ENGINE_ENTRY_LABELS = [
  'pomysł',
  'obserwacja',
  'problem do rozwiązania',
  'ryzyko / blokada',
  'pytanie do klienta',
  'pytanie do dostawcy / partnera',
  'założenie do weryfikacji',
  'decyzja',
  'następny krok (action)',
]

export const ENGINE_ENTRY_LABEL_TRANSLATIONS: Record<string, string> = {
  'pomysł': 'idea',
  'obserwacja': 'observation',
  'problem do rozwiązania': 'problem to solve',
  'ryzyko / blokada': 'risk / blocker',
  'pytanie do klienta': 'question to customer',
  'pytanie do dostawcy / partnera': 'question to supplier / partner',
  'założenie do weryfikacji': 'assumption to validate',
  'decyzja': 'decision',
  'następny krok (action)': 'next step (action)',
}

export const ENGINE_ENTRY_LABEL_COLORS: Record<string, string> = {
  'pomysł': '#FFD9B3',
  'obserwacja': '#CFEBDD',
  'problem do rozwiązania': '#FFBDBD',
  'ryzyko / blokada': '#FFC9E3',
  'pytanie do klienta': '#CFE8FF',
  'pytanie do dostawcy / partnera': '#D7F5E0',
  'założenie do weryfikacji': '#E9D7FF',
  'decyzja': '#FFF1B8',
  'następny krok (action)': '#C7F0E0',
}

export const getEntryLabelText = (label: string, language: EntryLabelLanguage) => {
  if (language === 'English' || language === 'en') {
    return ENGINE_ENTRY_LABEL_TRANSLATIONS[label] || label
  }
  return label
}

export const getNoLabelText = (language: EntryLabelLanguage) =>
  language === 'English' || language === 'en' ? 'No label' : 'Brak etykiety'
