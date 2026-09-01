import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runLlmTaskMock } = vi.hoisted(() => ({
  runLlmTaskMock: vi.fn(),
}))

vi.mock('../../llm/llmRouter.mjs', () => ({
  runLlmTask: runLlmTaskMock,
}))

import { analyzeSeedLikeText } from '../../src/lib/server/seedAnalysis.js'

describe('analyzeSeedLikeText', () => {
  beforeEach(() => {
    runLlmTaskMock.mockReset()
  })

  it('extracts and classifies one finding from a short conversation turn in a single LLM call', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        entries: [
          {
            text: 'Klient oczekuje produktu spoza obecnej oferty.',
            cellCode: 'B2',
            confidence: 0.88,
            kind: 'problem',
          },
        ],
      },
      meta: {
        modelUsed: 'gpt-4.1-mini',
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: null,
        tokens: { input: 12, output: 14, total: 26 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Mój klient chce produkt, którego nie mam w ofercie.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      text: 'Klient oczekuje produktu spoza obecnej oferty.',
      cellCode: 'B2',
      kind: 'problem',
    })
    expect(runLlmTaskMock).toHaveBeenCalledTimes(1)
    expect(runLlmTaskMock.mock.calls[0][0].task).toBe('seed-analysis-turn')
  })

  it('accepts structured conversation-turn entries returned as content plus column and level', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        entries: [
          {
            content: 'Klient oczekuje produktu spoza obecnej oferty.',
            column: '2',
            level: 'product',
            confidence: 0.88,
            kind: 'problem',
          },
        ],
      },
      meta: {
        modelUsed: 'gpt-4.1-mini',
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: null,
        tokens: { input: 12, output: 14, total: 26 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Mój klient chce produkt, którego nie mam w ofercie.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      text: 'Klient oczekuje produktu spoza obecnej oferty.',
      cellCode: 'B2',
      kind: 'problem',
    })
  })

  it('extracts several findings from a longer conversation turn in the final entries format', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        entries: [
          {
            text: 'Klient oczekuje produktu spoza obecnej oferty.',
            cellCode: 'B2',
            confidence: 0.9,
            kind: 'problem',
          },
          {
            text: 'Muszę odmawiać części zapytań sprzedażowych.',
            cellCode: 'A2',
            confidence: 0.82,
            kind: 'observation',
          },
          {
            text: 'Tracę okazje sprzedażowe przez brak takiego produktu.',
            cellCode: 'B2',
            confidence: 0.85,
            kind: 'problem',
          },
        ],
      },
      meta: {
        modelUsed: 'gpt-4.1-mini',
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: null,
        tokens: { input: 20, output: 40, total: 60 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie. Muszę odmawiać części zapytań i tracę przez to sprzedaż.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Mój klient chce produkt, którego nie mam w ofercie. Muszę odmawiać części zapytań i tracę przez to sprzedaż.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.entries).toHaveLength(3)
    expect(result.entries.map((entry) => entry.text)).toEqual([
      'Klient oczekuje produktu spoza obecnej oferty.',
      'Muszę odmawiać części zapytań sprzedażowych.',
      'Tracę okazje sprzedażowe przez brak takiego produktu.',
    ])
  })

  it('returns no-findings for a valid empty conversation-turn payload', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: true,
      data: { entries: [] },
      meta: {
        modelUsed: 'gpt-4.1-mini',
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: null,
        tokens: { input: 8, output: 2, total: 10 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Nie wiem jeszcze nic konkretnego.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Nie wiem jeszcze nic konkretnego.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.meta?.errorCategory).toBe('NO_FINDINGS')
    expect(runLlmTaskMock).toHaveBeenCalledTimes(1)
  })

  it('accepts a correct JSON payload shape nested under result.entries', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        result: {
          entries: [
            {
              text: 'Oczekiwany produkt nie znajduje się w obecnej ofercie firmy.',
              cellCode: 'B2',
              confidence: 0.84,
              kind: 'problem',
            },
          ],
        },
      },
      meta: {
        modelUsed: 'gpt-4.1-mini',
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: null,
        tokens: { input: 12, output: 12, total: 24 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Mój klient chce produkt, którego nie mam w ofercie.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].text).toBe('Oczekiwany produkt nie znajduje się w obecnej ofercie firmy.')
  })

  it('returns a parse error instead of no-findings when the payload misses a usable entries array', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        result: {
          data: [
            {
              text: 'Klient oczekuje produktu spoza obecnej oferty.',
            },
          ],
        },
      },
      meta: {
        modelUsed: 'gpt-4.1-mini',
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: null,
        tokens: { input: 12, output: 12, total: 24 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Mój klient chce produkt, którego nie mam w ofercie.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.meta?.errorCategory).toBe('PARSE_ERROR')
    expect(result.meta?.errorInfo).toMatchObject({
      status: 'missing_entries_array',
      rawEntriesCount: 0,
    })
  })

  it('passes active question and conversation context for a short answer', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        entries: [
          {
            text: 'Miesięczny wolumen zapotrzebowania wynosi około 10 sztuk.',
            cellCode: 'A1',
            confidence: 0.78,
            kind: 'observation',
          },
        ],
      },
      meta: {
        modelUsed: 'gpt-4.1-mini',
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: null,
        tokens: { input: 10, output: 10, total: 20 },
      },
    })

    await analyzeSeedLikeText({
      text: 'Około 10 sztuk miesięcznie.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Około 10 sztuk miesięcznie.'],
        recentConversation: [
          { role: 'assistant', content: 'Jak duży jest miesięczny wolumen tego zapotrzebowania?', gapId: 'gap-volume', semanticKey: 'volume' },
          { role: 'user', content: 'Około 10 sztuk miesięcznie.' },
        ],
        confirmedEntries: ['Klient oczekuje produktu spoza obecnej oferty.'],
        rejectedEntries: [],
        activeProposals: ['Klient oczekuje produktu spoza obecnej oferty.'],
        currentGaps: [
          {
            id: 'gap-volume',
            semanticKey: 'volume',
            gapType: 'matrix_coverage',
            gapStatus: 'open',
            matrixRow: 'world',
            matrixCol: 'as_is',
            question: 'Jak duży jest miesięczny wolumen tego zapotrzebowania?',
          },
        ],
        askedQuestionsHistory: [
          {
            content: 'Jak duży jest miesięczny wolumen tego zapotrzebowania?',
            gapId: 'gap-volume',
            semanticKey: 'volume',
          },
        ],
        selectedOpenQuestion: 'Jak duży jest miesięczny wolumen tego zapotrzebowania?',
        lastAssistantQuestion: 'Jak duży jest miesięczny wolumen tego zapotrzebowania?',
        activeQuestionGapId: 'gap-volume',
        activeQuestionSemanticKey: 'volume',
      },
    })

    const input = JSON.parse(runLlmTaskMock.mock.calls[0][0].input)
    expect(input.selected_open_question).toBe('Jak duży jest miesięczny wolumen tego zapotrzebowania?')
    expect(input.latest_user_message).toBe('Około 10 sztuk miesięcznie.')
    expect(input.last_assistant_question).toBe('Jak duży jest miesięczny wolumen tego zapotrzebowania?')
    expect(input.active_question_gap_id).toBe('gap-volume')
    expect(input.active_question_semantic_key).toBe('volume')
    expect(input.recent_conversation).toHaveLength(2)
    expect(input.current_gaps[0]).toMatchObject({
      id: 'gap-volume',
      semantic_key: 'volume',
      question: 'Jak duży jest miesięczny wolumen tego zapotrzebowania?',
    })
  })

  it('preserves transport errors instead of rewriting them to no-findings', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: false,
      error: 'TypeError: fetch failed',
      meta: {
        modelUsed: null,
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: 'TRANSPORT_ERROR',
        tokens: { input: 0, output: 0, total: 0 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Mój klient chce produkt, którego nie mam w ofercie.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.meta?.errorCategory).toBe('TRANSPORT_ERROR')
    expect(runLlmTaskMock).toHaveBeenCalledTimes(1)
  })

  it('preserves timeout errors for a conversation turn', async () => {
    runLlmTaskMock.mockResolvedValueOnce({
      ok: false,
      error: 'Error: OPENAI_REQUEST_TIMEOUT',
      meta: {
        modelUsed: null,
        attemptedModel: 'gpt-4.1-mini',
        errorCategory: 'TIMEOUT',
        tokens: { input: 0, output: 0, total: 0 },
      },
    })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'conversation_turn',
      allowTextFallback: false,
      context: {
        recentUserMessages: ['Mój klient chce produkt, którego nie mam w ofercie.'],
        confirmedEntries: [],
        rejectedEntries: [],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.meta?.errorCategory).toBe('TIMEOUT')
  })

  it('keeps brief mode as extract then classify', async () => {
    runLlmTaskMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          entries: [
            { text: 'Klient oczekuje produktu spoza obecnej oferty.' },
            { text: 'Brak takiego produktu w ofercie blokuje sprzedaż.' },
          ],
        },
        meta: {
          modelUsed: 'gpt-4.1-mini',
          attemptedModel: 'gpt-4.1-mini',
          errorCategory: null,
          tokens: { input: 10, output: 14, total: 24 },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          entries: [
            { text: 'Klient oczekuje produktu spoza obecnej oferty.', cellCode: 'B2', confidence: 0.9, kind: 'problem' },
            { text: 'Brak takiego produktu w ofercie blokuje sprzedaż.', cellCode: 'B2', confidence: 0.86, kind: 'problem' },
          ],
        },
        meta: {
          modelUsed: 'gpt-4.1-mini',
          attemptedModel: 'gpt-4.1-mini',
          errorCategory: null,
          tokens: { input: 10, output: 14, total: 24 },
        },
      })

    const result = await analyzeSeedLikeText({
      text: 'Mój klient chce produkt, którego nie mam w ofercie. To blokuje część sprzedaży.',
      locale: 'pl',
      apiKey: 'test-key',
      aiSupportEnabled: true,
      mode: 'brief',
      allowTextFallback: true,
    })

    expect(result.ok).toBe(true)
    expect(result.entries).toHaveLength(2)
    expect(runLlmTaskMock).toHaveBeenCalledTimes(2)
    expect(runLlmTaskMock.mock.calls[0][0].task).toBe('seed-extraction')
    expect(runLlmTaskMock.mock.calls[1][0].task).toBe('seed-classification')
  })
})
