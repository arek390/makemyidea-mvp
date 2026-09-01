import { describe, expect, it } from 'vitest'
import {
  buildKnowledgeSummary,
  resolveOpenQuestionById,
} from '../../src/engine2/conversationGuide.js'

const confirmedFinding = (id: string, content: string, updatedAt: string) => ({
  id,
  category: 'fact' as const,
  categoryLabel: 'Ustalenie',
  content,
  status: 'confirmed' as const,
  source: 'ai_interpretation' as const,
  updatedAt,
  fingerprint: `fp-${id}`,
  internal: {
    matrixRow: 'product' as const,
    matrixCol: 'as_is' as const,
    matrixCell: 'B1',
    confidence: 0.8,
  },
})

describe('engine2 conversation guide helpers', () => {
  it('builds the knowledge summary only from confirmed findings and caps it at three items', () => {
    const summary = buildKnowledgeSummary([
      confirmedFinding('old-1', 'Klient oczekuje produktu spoza obecnej oferty.', '2026-07-30T10:00:00.000Z'),
      {
        ...confirmedFinding('pending-1', 'To nie powinno wejść do wiedzy.', '2026-07-30T12:00:00.000Z'),
        status: 'pending' as const,
      },
      confirmedFinding('new-1', 'Obecna oferta nie odpowiada tej potrzebie.', '2026-07-31T12:00:00.000Z'),
      confirmedFinding('dup-1', 'Klient oczekuje produktu spoza obecnej oferty.', '2026-08-01T12:00:00.000Z'),
      confirmedFinding('new-2', 'Zapytanie wraca regularnie od klientów.', '2026-08-01T11:00:00.000Z'),
      confirmedFinding('new-3', 'Brak takiego produktu blokuje część sprzedaży.', '2026-08-01T10:00:00.000Z'),
    ])

    expect(summary).toHaveLength(3)
    expect(summary.map((entry) => entry.text)).toEqual([
      'Klient oczekuje produktu spoza obecnej oferty.',
      'Zapytanie wraca regularnie od klientów.',
      'Brak takiego produktu blokuje część sprzedaży.',
    ])
  })

  it('can resolve the active question from persisted state', () => {
    const active = resolveOpenQuestionById(
      [
        { id: 'gap-1', question: 'Jaką potrzebę klienta ma rozwiązać ten produkt?' },
        { id: 'gap-2', question: 'Co wiadomo o oczekiwanej funkcji produktu?' },
      ],
      'gap-2',
    )

    expect(active).toEqual({
      id: 'gap-2',
      question: 'Co wiadomo o oczekiwanej funkcji produktu?',
    })
  })

  it('renders confirmed user findings in direct second-person Polish', () => {
    const summary = buildKnowledgeSummary([
      {
        ...confirmedFinding('usb', 'Użytkownik potwierdził, że port USB jest dobrą opcją.', '2026-08-22T10:00:00.000Z'),
        displayText: 'Użytkownik potwierdził, że port USB jest dobrą opcją.',
      },
      {
        ...confirmedFinding('no-touch', 'Użytkownik nie chce sterowania dotykowego.', '2026-08-22T10:01:00.000Z'),
        displayText: 'Użytkownik nie chce sterowania dotykowego.',
      },
      {
        ...confirmedFinding('app', 'Użytkownik proponuje sterowanie aplikacją.', '2026-08-22T10:02:00.000Z'),
        displayText: 'Użytkownik proponuje sterowanie aplikacją.',
      },
    ], 10)

    expect(summary.map((entry) => entry.text)).toEqual([
      'Proponujesz sterowanie aplikacją.',
      'Nie chcesz sterowania dotykowego.',
      'Potwierdzasz, że port USB jest dobrą opcją.',
    ])
    expect(summary.some((entry) => entry.text.includes('Użytkownik'))).toBe(false)
  })
})
