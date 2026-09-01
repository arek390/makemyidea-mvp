import { describe, expect, it, vi } from 'vitest'
import {
  buildEngine2PanelQuestionInput,
  diversifyEngine2PanelQuestionCandidates,
  engine2QuestionExplorationKey,
  engine2QuestionSemanticCluster,
  generateEngine2PanelQuestions,
  validateEngine2PanelQuestions,
} from '../../src/lib/server/engine2PanelQuestionGenerator.js'

const finding = {
  id: 'f-lamp',
  semanticKey: 'lamp_goal',
  content: 'Chcesz zaprojektować lampę na biurko.',
  status: 'confirmed',
  decisionAt: '2026-08-22T18:00:00.000Z',
}

const candidate = (key: string, question: string) => ({
  clientRef: key,
  semanticKey: key,
  question,
  intent: 'Ustalić jeden konkretny warunek projektu.',
  presentation: 'panel',
  reason: 'Wynika z potwierdzonego ustalenia o lampie.',
  groundedInFindingIds: [finding.id],
  concreteAnchorText: 'lampa na biurko',
  uncertaintyToResolve: 'konkretny kompromis projektu',
  userCanAnswerFromExperience: true,
  forbiddenGenericCategoryQuestion: false,
  targetType: 'priority',
  targetContradictionId: null,
  explorationArea: key,
  semanticExplorationKey: key,
  contradictionHypothesis: `Hipoteza do sprawdzenia: ${key}`,
  matrixInspiration: 'internal improving/worsening axis',
  matrixInspirationIsHypothesis: true,
  noveltyReason: 'Sprawdza nową niewiadomą w rozmowie.',
  diversityReason: 'Dotyczy osobnego obszaru eksploracji.',
  whyNotDuplicate: 'Nie powtarza wcześniejszego pytania.',
  questionPurpose: 'Odkryć fakt potrzebny do dalszej analizy.',
})

const legacyCandidate = (key: string, question: string) => {
  const {
    explorationArea,
    semanticExplorationKey,
    contradictionHypothesis,
    matrixInspiration,
    ...entry
  } = candidate(key, question)
  void explorationArea
  void semanticExplorationKey
  void contradictionHypothesis
  void matrixInspiration
  return entry
}

describe('Engine 2 panel question generator', () => {
  it('generate_panel_questions_is_lightweight', async () => {
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = {
        schemaVersion: 'engine2.panel_questions.v1',
        questionCandidates: [
          candidate('light_mode', 'Czy lampa ma przełączać się między szerokim światłem do pracy przy komputerze a skupionym światłem do napraw?'),
          candidate('stable_base', 'Czy ważniejsze jest małe miejsce na biurku, czy cięższa podstawa dająca stabilność?'),
          candidate('battery_boundary', 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?'),
        ],
      }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 10, output: 10, total: 20 } } }
    })

    const result = await generateEngine2PanelQuestions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        activeContradictions: [],
        questions: [],
      },
      apiKey: 'test-key',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.questionCandidates).toHaveLength(3)
    expect(runTask).toHaveBeenCalledTimes(1)
    expect(runTask.mock.calls[0][0].task).toBe('engine2-panel-questions')
    expect(runTask.mock.calls[0][0].timeoutMs).toBe(35_000)
    expect(runTask.mock.calls[0][0].responseFormat.json_schema.name).toBe('engine2_panel_questions')
    expect(runTask.mock.calls[0][0].input).toContain('contradictionMatrixReference')
    expect(runTask.mock.calls[0][0].input).not.toContain('components')
    expect(runTask.mock.calls[0][0].input).not.toContain('criticalMissing')
  })

  it('question_generation_keeps_structural_candidates_despite_metadata_quality_issues', async () => {
    const runTask = vi.fn()
      .mockImplementationOnce(async (options) => {
        const data = {
          schemaVersion: 'engine2.panel_questions.v1',
          questionCandidates: [
            {
              ...candidate('generic_features', 'Jakie cechy i funkcje powinna mieć lampa?'),
              reason: 'Użytkownik chce doprecyzować lampę.',
              uncertaintyToResolve: 'cechy i funkcje',
              forbiddenGenericCategoryQuestion: true,
              targetType: 'less_ideal_metadata',
            },
            candidate('stable_base', 'Czy ważniejsze jest małe miejsce na biurku, czy cięższa podstawa dająca stabilność?'),
            candidate('battery_boundary', 'Czy akumulator ma działać godzinę przy pełnej jasności, czy może wtedy świecić słabiej?'),
          ],
        }
        options.onRawResponse?.({ content: JSON.stringify(data) })
        return { ok: true, data, meta: { providerCalled: true, tokens: { input: 10, output: 10, total: 20 } } }
      })

    const result = await generateEngine2PanelQuestions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        activeContradictions: [],
        questions: [],
        conversationContext: [],
      },
      apiKey: 'test-key',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.questionCandidates).toHaveLength(3)
    expect(result.questionCandidates.map((question) => question.semanticKey)).toEqual(['generic_features', 'stable_base', 'battery_boundary'])
    expect(result.partialValidation).toMatchObject({
      validCandidateCount: 3,
      invalidCandidateCount: 0,
    })
    expect(runTask).toHaveBeenCalledTimes(1)
    expect(runTask.mock.calls[0][0].task).toBe('engine2-panel-questions')
  })

  it('retries panel question generation when JSON is truncated at the output token limit', async () => {
    const runTask = vi.fn()
      .mockImplementationOnce(async (options) => {
        options.onRawResponse?.({ content: '{"schemaVersion":"engine2.panel_questions.v1","questionCandidates":[{"question":"ucięte' })
        return {
          ok: false,
          data: null,
          meta: {
            providerCalled: true,
            errorCategory: 'PARSE_ERROR',
            tokens: { input: 100, output: options.maxOutputTokens, total: 100 + options.maxOutputTokens },
          },
        }
      })
      .mockImplementationOnce(async (options) => {
        const data = {
          schemaVersion: 'engine2.panel_questions.v1',
          questionCandidates: [
            candidate('usage_context', 'W jakich sytuacjach najczęściej korzystasz z lampy na biurku?'),
            candidate('brightness_control', 'Czy potrzebujesz płynnej regulacji jasności, czy wystarczą dwa lub trzy poziomy?'),
            candidate('desk_space_boundary', 'Ile miejsca na biurku może zajmować podstawa lampy?'),
          ],
        }
        options.onRawResponse?.({ content: JSON.stringify(data) })
        return { ok: true, data, meta: { providerCalled: true, tokens: { input: 100, output: 900, total: 1000 } } }
      })

    const result = await generateEngine2PanelQuestions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        activeContradictions: [],
        questions: [],
        conversationContext: [],
      },
      apiKey: 'test-key',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.questionCandidates).toHaveLength(3)
    expect(runTask).toHaveBeenCalledTimes(2)
    expect(runTask.mock.calls[0][0].maxOutputTokens).toBe(1800)
    expect(runTask.mock.calls[1][0].maxOutputTokens).toBe(2800)
    expect(result.meta.repairRetry).toBe(true)
    expect(result.attempts[0].validation.errors).toContain('response was truncated at maxOutputTokens=1800')
  })

  it('prioritizes a candidate that targets an active contradiction', async () => {
    const contradiction = {
      id: 'c-zone-mode',
      semanticKey: 'lamp_zone_mode_ambiguity',
      status: 'suspected',
      description: 'Niejasne sterowanie strefami.',
      reportBlocking: true,
    }
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = {
        schemaVersion: 'engine2.panel_questions.v1',
        questionCandidates: [
          candidate('usage_context', 'Czy lampa będzie częściej używana przy komputerze, czy przy naprawach?'),
          candidate('lamp_light_intensity_zone_mode', 'Czy chodzi Ci o jedną regulowaną strefę, kilka stref regulowanych niezależnie, czy kilka stref zmienianych jednocześnie jednym ustawieniem?'),
          candidate('constraints_budget', 'Czy limit ceny jest twardy, czy możesz go zwiększyć dla lepszego sterowania?'),
        ],
      }
      data.questionCandidates[1].targetType = 'contradiction_probe'
      data.questionCandidates[1].targetContradictionId = contradiction.id
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 10, output: 10, total: 20 } } }
    })

    const result = await generateEngine2PanelQuestions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        activeContradictions: [contradiction],
        contradictions: [contradiction],
        questions: [],
      },
      apiKey: 'test-key',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.questionCandidates[0]).toMatchObject({
      semanticKey: 'lamp_light_intensity_zone_mode',
      targetContradictionId: contradiction.id,
    })
  })

  it('does not return three panel questions from one semantic cluster', async () => {
    expect(engine2QuestionSemanticCluster('lamp_light_intensity_zone_count')).toBe('lamp_light_intensity')
    expect(engine2QuestionSemanticCluster('lamp_light_intensity_range_preference')).toBe('lamp_light_intensity')
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = {
        schemaVersion: 'engine2.panel_questions.v1',
        questionCandidates: [
          legacyCandidate('lamp_light_intensity_zone_count', 'Czy lampa ma mieć jedną strefę światła, czy kilka stref?'),
          legacyCandidate('lamp_light_intensity_range_preference', 'Czy ważniejszy jest duży zakres jasności, czy prosta regulacja?'),
          legacyCandidate('lamp_light_intensity_zone_size_preference', 'Czy strefa światła ma być wąska, czy szeroka?'),
        ],
      }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 10, output: 10, total: 20 } } }
    })

    const result = await generateEngine2PanelQuestions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        activeContradictions: [],
        questions: [],
      },
      apiKey: 'test-key',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.questionCandidates).toHaveLength(2)
    expect(new Set(result.questionCandidates.map((question) => question.semanticKey))).not.toContain('lamp_light_intensity_zone_size_preference')
  })

  it('rejects another non-contradiction question from a cluster already asked twice', () => {
    const result = diversifyEngine2PanelQuestionCandidates([
      legacyCandidate('lamp_light_intensity_zone_size_preference', 'Czy strefa światła ma być wąska, czy szeroka?'),
      legacyCandidate('usage_context_repairs', 'Czy lampa będzie częściej używana przy komputerze, czy przy naprawach?'),
    ], {
      questions: [
        { id: 'q1', semanticKey: 'lamp_light_intensity_zone_count', status: 'answered' },
        { id: 'q2', semanticKey: 'lamp_light_intensity_range_preference', status: 'answered' },
      ],
    })

    expect(result.candidates.map((question) => question.semanticKey)).toEqual(['usage_context_repairs'])
    expect(result.skipped[0]).toMatchObject({ reason: 'semantic_cluster_history_limit', cluster: 'lamp_light_intensity' })
  })

  it('uses the whole confirmed context and matrix reference when a portable product is used in motion', async () => {
    const confirmedFindings = [
      { ...finding, id: 'f-portable', semanticKey: 'product_portable', content: 'Produkt ma być przenośny.' },
      { ...finding, id: 'f-motion', semanticKey: 'used_in_motion', content: 'Produkt będzie używany w ruchu.' },
      { ...finding, id: 'f-durable', semanticKey: 'durable', content: 'Produkt ma wytrzymać przypadkowe uderzenia.' },
    ]
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const parsed = JSON.parse(options.input)
      expect(parsed.contradictionMatrixReference.parameters).toContain('Weight of moving object')
      expect(parsed.confirmedFindings.map((entry: any) => entry.id)).toEqual(['f-portable', 'f-motion', 'f-durable'])
      const data = {
        schemaVersion: 'engine2.panel_questions.v1',
        questionCandidates: [
          { ...candidate('mass_vs_runtime', 'Czy podczas użycia w ruchu ważniejsza jest niska masa w dłoni, czy dłuższa praca bez ładowania?'), groundedInFindingIds: ['f-portable', 'f-motion'] },
          { ...candidate('durability_vs_comfort', 'Czy obudowa ma przede wszystkim chronić przy uderzeniach, czy mniej męczyć rękę podczas długiego noszenia?'), groundedInFindingIds: ['f-motion', 'f-durable'] },
          { ...candidate('motion_context', 'W jakiej sytuacji produkt najczęściej będzie używany w ruchu: spacer, transport, czy praca rękami?'), groundedInFindingIds: ['f-motion'] },
        ],
      }
      data.questionCandidates[0].targetType = 'contradiction_probe'
      data.questionCandidates[1].targetType = 'contradiction_probe'
      data.questionCandidates[2].targetType = 'usage_example'
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 10, output: 10, total: 20 } } }
    })

    const result = await generateEngine2PanelQuestions({
      input: {
        language: 'pl',
        confirmedFindings,
        allFindings: confirmedFindings,
        activeContradictions: [],
        questions: [],
      },
      apiKey: 'test-key',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.questionCandidates).toHaveLength(3)
    expect(new Set(result.questionCandidates.map(engine2QuestionExplorationKey)).size).toBe(3)
    expect(result.questionCandidates.map((entry) => entry.semanticExplorationKey)).not.toEqual([
      'mobility_1',
      'mobility_2',
      'mobility_3',
    ])
  })

  it('rejects internal TRIZ and matrix terminology in user-facing questions', () => {
    const validation = validateEngine2PanelQuestions({
      schemaVersion: 'engine2.panel_questions.v1',
      questionCandidates: [
        candidate('matrix_language', 'Który parametr z Contradiction Matrix jest ważniejszy: ease of manufacture czy device complexity?'),
        candidate('mass_vs_runtime', 'Czy ważniejsza jest niska masa, czy dłuższa praca bez ładowania?'),
        candidate('usage_context', 'W jakiej sytuacji najczęściej będziesz używać produktu?'),
      ],
    }, { language: 'pl', allFindings: [finding], questions: [] })

    expect(validation.ok).toBe(false)
    expect(validation.errors).toContain('questionCandidates[0] leaks internal matrix terminology')
  })

  it('rejects three questions from the same semantic exploration area', () => {
    const costA = { ...candidate('cost_material', 'Czy koszt materiału jest ważniejszy niż trwałość?'), semanticExplorationKey: 'cost_tradeoff', explorationArea: 'koszt' }
    const costB = { ...candidate('cost_service', 'Czy koszt serwisu jest ważniejszy niż łatwa naprawa?'), semanticExplorationKey: 'cost_tradeoff', explorationArea: 'koszt' }
    const costC = { ...candidate('cost_delivery', 'Czy koszt dostawy jest ważniejszy niż szybka dostępność?'), semanticExplorationKey: 'cost_tradeoff', explorationArea: 'koszt' }
    const validation = validateEngine2PanelQuestions({
      schemaVersion: 'engine2.panel_questions.v1',
      questionCandidates: [costA, costB, costC],
    }, { language: 'pl', allFindings: [finding], questions: [] })

    expect(validation.ok).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      'duplicate semantic exploration area: cost_tradeoff',
      'questionCandidates must cover three distinct semantic exploration areas',
    ]))
  })

  it('allows one legacy semantic cluster when explicit exploration areas are distinct', () => {
    const validation = validateEngine2PanelQuestions({
      schemaVersion: 'engine2.panel_questions.v1',
      questionCandidates: [
        { ...candidate('lamp_light_source_quality_tradeoff', 'Czy preferujesz źródło światła z bardzo naturalnym odwzorowaniem kolorów, nawet jeśli oznacza to wyższy koszt?'), explorationArea: 'lamp_light_quality', semanticExplorationKey: 'lamp_light_source_quality_tradeoff', matrixInspiration: 'Illumination intensity vs Use of energy by stationary object' },
        { ...candidate('lamp_light_source_directional_control', 'Czy wolisz wąski, kierunkowy strumień światła, czy szeroki rozsył wymagający dodatkowego skupienia?'), explorationArea: 'lamp_light_directionality', semanticExplorationKey: 'lamp_light_source_directional_control', matrixInspiration: 'Illumination intensity vs Ease of operation' },
        { ...candidate('lamp_light_source_heat_emission_tradeoff', 'Czy źródło światła ma emitować jak najmniej ciepła, nawet jeśli będzie droższe?'), explorationArea: 'lamp_ergonomics', semanticExplorationKey: 'lamp_light_source_heat_emission_tradeoff', matrixInspiration: 'Temperature vs Ease of operation' },
      ],
    }, { language: 'pl', allFindings: [finding], questions: [
      { id: 'q-old-1', semanticKey: 'lamp_light_intensity_zone_count', status: 'answered' },
      { id: 'q-old-2', semanticKey: 'lamp_light_intensity_range_preference', status: 'answered' },
    ] })

    expect(validation.ok).toBe(true)
  })

  it('continues generating questions when two contradictions already exist', async () => {
    const contradictions = [
      { id: 'c-1', semanticKey: 'mass_vs_runtime', status: 'suspected', description: 'Masa kontra czas pracy.' },
      { id: 'c-2', semanticKey: 'durability_vs_comfort', status: 'open', description: 'Trwałość kontra komfort.' },
    ]
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = {
        schemaVersion: 'engine2.panel_questions.v1',
        questionCandidates: [
          { ...candidate('mass_runtime_probe', 'Czy przy całym dniu pracy akceptujesz cięższy akumulator, czy wolisz krótszy czas działania?'), targetType: 'contradiction_probe', targetContradictionId: 'c-1' },
          { ...candidate('durability_comfort_probe', 'Czy obudowa ma lepiej chronić przy upadku, czy pozostać wygodna przy długim trzymaniu?'), targetType: 'contradiction_probe', targetContradictionId: 'c-2' },
          candidate('charging_boundary', 'Jaki jest najdłuższy czas bez dostępu do ładowania w typowym użyciu?'),
        ],
      }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 10, output: 10, total: 20 } } }
    })

    const result = await generateEngine2PanelQuestions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        contradictions,
        activeContradictions: contradictions,
        questions: [],
      },
      apiKey: 'test-key',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.questionCandidates).toHaveLength(3)
    expect(result.meta.errorCategory).toBeNull()
  })

  it('builds question input from all confirmed findings, not only the latest one', () => {
    const input = buildEngine2PanelQuestionInput({
      language: 'pl',
      confirmedFindings: [
        { ...finding, id: 'f-old', semanticKey: 'old_context', content: 'Urządzenie jest dla seniorów.' },
        { ...finding, id: 'f-new', semanticKey: 'new_constraint', content: 'Urządzenie ma działać bez telefonu.' },
      ],
      questions: [],
    })

    expect(input.confirmedFindings.map((entry: any) => entry.id)).toEqual(['f-old', 'f-new'])
    expect(input.contradictionMatrixReference.usage).toBe('inspiration_only')
  })

  it('lamp regression keeps three questions semantically diverse without repeating light distribution', () => {
    const findings = [
      {
        id: 'f-need',
        semanticKey: 'desk_lamp_need',
        content: 'Chcesz zaprojektować nową lampę na biurko, ponieważ obecne lampy nie dają światła tam, gdzie go potrzebujesz.',
        status: 'confirmed',
      },
      {
        id: 'f-cost',
        semanticKey: 'lower_cost',
        content: 'Chcesz zachować niższy koszt.',
        status: 'confirmed',
      },
      {
        id: 'f-adjustment',
        semanticKey: 'beam_position_and_width_adjustment',
        content: 'Chcesz łatwo dopasować miejsce świecenia i zmieniać średnicę stożka od szerokiego ogólnego do punktowego dla precyzyjnych prac.',
        status: 'confirmed',
      },
    ]
    const validation = validateEngine2PanelQuestions({
      schemaVersion: 'engine2.panel_questions.v1',
      questionCandidates: [
        { ...candidate('current_failure_mode', 'Co dokładnie przeszkadza w obecnych lampach: zakres ruchu, stabilność po ustawieniu, zajmowane miejsce czy sam sposób regulacji?'), groundedInFindingIds: ['f-need'], explorationArea: 'obecny problem', semanticExplorationKey: 'current_failure_mode', targetType: 'observation' },
        { ...candidate('adjustment_usage_context', 'Jak często w jednej sesji pracy zmieniasz miejsce świecenia lub szerokość stożka?'), groundedInFindingIds: ['f-adjustment'], explorationArea: 'warunki użycia', semanticExplorationKey: 'adjustment_usage_context', targetType: 'usage_example' },
        { ...candidate('post_adjustment_stability', 'Czy po ustawieniu światła lampa musi pozostać nieruchoma podczas precyzyjnej pracy rękami?'), groundedInFindingIds: ['f-adjustment'], explorationArea: 'stabilność po ustawieniu', semanticExplorationKey: 'post_adjustment_stability', targetType: 'success_test' },
      ],
    }, { language: 'pl', allFindings: findings, questions: [] })

    expect(validation.ok).toBe(true)
    expect(new Set(validation.output.questionCandidates.map(engine2QuestionExplorationKey)).size).toBe(3)
    expect(validation.output.questionCandidates.filter((entry) => /szerok|punktow/i.test(entry.question))).toHaveLength(1)
  })
})
