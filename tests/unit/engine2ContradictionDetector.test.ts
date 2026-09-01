import { describe, expect, it, vi } from 'vitest'
import {
  buildEngine2ContradictionDetectionInput,
  detectEngine2Contradictions,
  ENGINE2_CONTRADICTION_DETECTION_SYSTEM_PROMPT,
  validateEngine2ContradictionDetectionOutput,
} from '../../src/lib/server/engine2ContradictionDetector.js'

describe('Engine 2 contradiction detector', () => {
  it('passes recent conversation and latest user answer to the detector', () => {
    const input = buildEngine2ContradictionDetectionInput({
      language: 'pl',
      confirmedFindings: [{
        id: 'f-zone',
        semanticKey: 'lamp_light_intensity_zones',
        content: 'Chcesz regulować intensywność światła w jednej strefie na raz lub jednocześnie.',
        status: 'confirmed',
        sourceMessageIds: ['u-latest'],
      }],
      contradictions: [],
      activeQuestionId: 'q-zone',
      questions: [{
        id: 'q-zone',
        semanticKey: 'lamp_light_intensity_zone_mode',
        question: 'Czy regulacja ma dotyczyć jednej strefy czy kilku stref?',
        status: 'open',
        presentation: 'panel',
      }],
      history: [
        { id: 'u-old-1', role: 'user', content: 'Chcę lampę.' },
        { id: 'a-old-1', role: 'assistant', content: 'Pytanie.' },
        { id: 'u-old-2', role: 'user', content: 'Do biurka.' },
        { id: 'a-zone', role: 'assistant', content: 'Czy regulacja ma dotyczyć jednej strefy czy kilku stref?', questionId: 'q-zone' },
        {
          id: 'u-latest',
          role: 'user',
          content: 'chce oświetlać jedna strefę na raz / jednocześnie i moc regulować jej intensywnosc',
          replyToQuestionId: 'q-zone',
          replyToQuestionText: 'Czy regulacja ma dotyczyć jednej strefy czy kilku stref?',
        },
      ],
    })

    expect(input.recentConversation).toHaveLength(5)
    expect(input.latestUserAnswer).toMatchObject({
      id: 'u-latest',
      replyToQuestionId: 'q-zone',
      replyToQuestionText: 'Czy regulacja ma dotyczyć jednej strefy czy kilku stref?',
    })
    expect(ENGINE2_CONTRADICTION_DETECTION_SYSTEM_PROMPT).toContain('ambiguous alternatives')
    expect(ENGINE2_CONTRADICTION_DETECTION_SYSTEM_PROMPT).toContain('A / B')
    expect(input.contradictionMatrixReference.usage).toBe('inspiration_only')
  })

  it('recovers create candidates with placeholder IDs and weak finding refs', () => {
    const validation = validateEngine2ContradictionDetectionOutput({
      schemaVersion: 'engine2.contradiction_detection.v1',
      contradictionChanges: [{
        operation: 'create',
        contradictionId: 'contradiction-001',
        semanticKey: 'lamp_control_interface_visibility_vs_discretion',
        description: 'Sterowanie kątem ma być oczywiste, ale część sterowania jasnością lub stożkiem światła może być dyskretna.',
        sideA: 'Widoczne i oczywiste sterowanie kątem',
        sideB: 'Dyskretne sterowanie dodatkowymi opcjami',
        sourceFindingIds: ['engine2-finding-1787763849064-58'],
        sourceMessageIds: ['u-controls'],
        sideASourceFindingIds: [],
        sideBSourceFindingIds: [],
        sideASourceMessageIds: ['u-controls'],
        sideBSourceMessageIds: ['u-controls'],
        status: 'open',
        reportBlocking: true,
        verificationQuestionId: null,
        resolutionFindingIds: [],
        evidenceStatus: 'confirmed_requirement_tension',
        origin: 'user_requirements',
        formalEligible: true,
        rejectionReason: null,
      }],
    }, {
      language: 'pl',
      findings: [],
      contradictions: [],
      history: [{ id: 'u-controls', role: 'user', content: 'sterowanie kątem powinno być oczywiste, a jasnością bardziej dyskretne' }],
    })

    expect(validation.ok).toBe(true)
    expect(validation.output.contradictionChanges[0]).toMatchObject({
      contradictionId: null,
      status: 'suspected',
      sourceFindingIds: [],
      sourceMessageIds: ['u-controls'],
    })
    expect(validation.repairs[0].diagnostics.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'create_contradiction_id_ignored',
      'unknown_source_finding_ids_removed',
      'weak_grounding',
    ]))
  })

  it('reports latestQuestion in diagnostics when the user answers a panel question', async () => {
    const runTask = async (options) => {
      const data = { schemaVersion: 'engine2.contradiction_detection.v1', contradictionChanges: [] }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 1, output: 1, total: 2 } } }
    }
    const result = await detectEngine2Contradictions({
      input: {
        language: 'pl',
        confirmedFindings: [{
          id: 'f-answer',
          semanticKey: 'lamp_controls',
          content: 'Sterowanie kątem powinno być oczywiste.',
          status: 'confirmed',
          sourceMessageIds: ['u-answer'],
        }],
        allFindings: [{
          id: 'f-answer',
          semanticKey: 'lamp_controls',
          content: 'Sterowanie kątem powinno być oczywiste.',
          status: 'confirmed',
          sourceMessageIds: ['u-answer'],
        }],
        contradictions: [],
        questions: [{
          id: 'q-controls',
          semanticKey: 'lamp_controls',
          question: 'Jak chcesz sterować kątem i jasnością lampy?',
          status: 'open',
          presentation: 'panel',
        }],
        history: [
          { id: 'a-controls', role: 'assistant', content: 'Jak chcesz sterować kątem i jasnością lampy?', questionId: 'q-controls' },
          { id: 'u-answer', role: 'user', content: 'Kąt rączką, jasność dyskretnie.', replyToQuestionId: 'q-controls', replyToQuestionText: 'Jak chcesz sterować kątem i jasnością lampy?' },
        ],
      },
      apiKey: 'test',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.meta.latestQuestion).toBe('Jak chcesz sterować kątem i jasnością lampy?')
    expect(result.meta.latestAnswer).toBe('Kąt rączką, jasność dyskretnie.')
  })

  it('does not turn a plain alternative into a contradiction without model evidence', async () => {
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = { schemaVersion: 'engine2.contradiction_detection.v1', contradictionChanges: [] }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 1, output: 1, total: 2 } } }
    })

    const result = await detectEngine2Contradictions({
      input: {
        language: 'pl',
        confirmedFindings: [{
          id: 'f-power-choice',
          semanticKey: 'power_choice',
          content: 'Może być bateria albo USB.',
          status: 'confirmed',
          sourceMessageIds: ['u-power'],
        }],
        allFindings: [{
          id: 'f-power-choice',
          semanticKey: 'power_choice',
          content: 'Może być bateria albo USB.',
          status: 'confirmed',
          sourceMessageIds: ['u-power'],
        }],
        contradictions: [],
        questions: [],
        history: [{ id: 'u-power', role: 'user', content: 'Może być bateria albo USB.' }],
      },
      apiKey: 'test',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.contradictionChanges).toEqual([])
  })

  it('accepts a real LLM-detected contradiction after sufficient context', async () => {
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const parsedInput = JSON.parse(options.input)
      expect(parsedInput.confirmedFindings.map((entry: any) => entry.id)).toContain('f-runtime-weight')
      const data = {
        schemaVersion: 'engine2.contradiction_detection.v1',
        contradictionChanges: [{
          operation: 'create',
          contradictionId: null,
          semanticKey: 'full_day_runtime_vs_under_200g',
          description: 'Urządzenie ma działać cały dzień bez ładowania i jednocześnie ważyć mniej niż 200 g.',
          sideA: 'Długi czas pracy bez ładowania',
          sideB: 'Masa poniżej 200 g',
          sourceFindingIds: ['f-runtime-weight'],
          sourceMessageIds: ['u-runtime-weight'],
          sideASourceFindingIds: ['f-runtime-weight'],
          sideBSourceFindingIds: ['f-runtime-weight'],
          sideASourceMessageIds: ['u-runtime-weight'],
          sideBSourceMessageIds: ['u-runtime-weight'],
          status: 'suspected',
          reportBlocking: true,
          verificationQuestionId: null,
          resolutionFindingIds: [],
          evidenceStatus: 'confirmed_requirement_tension',
          origin: 'user_requirements',
          formalEligible: true,
          rejectionReason: null,
        }],
      }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 1, output: 1, total: 2 } } }
    })

    const finding = {
      id: 'f-runtime-weight',
      semanticKey: 'runtime_weight_constraint',
      content: 'Musi działać cały dzień bez ładowania i ważyć mniej niż 200 g.',
      status: 'confirmed',
      sourceMessageIds: ['u-runtime-weight'],
    }
    const result = await detectEngine2Contradictions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        contradictions: [],
        questions: [],
        history: [{ id: 'u-runtime-weight', role: 'user', content: finding.content }],
      },
      apiKey: 'test',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.contradictionChanges[0]).toMatchObject({
      semanticKey: 'full_day_runtime_vs_under_200g',
      status: 'suspected',
      sourceFindingIds: ['f-runtime-weight'],
    })
  })

  it('keeps old soft-pattern matches diagnostic instead of creating formal contradictions', async () => {
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = { schemaVersion: 'engine2.contradiction_detection.v1', contradictionChanges: [] }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 1, output: 1, total: 2 } } }
    })
    const finding = {
      id: 'f-soft',
      semanticKey: 'portable_stable_lamp',
      content: 'Lampa ma być lekka i przenośna, ale stabilna na biurku.',
      status: 'confirmed',
      sourceMessageIds: ['u-soft'],
    }

    const result = await detectEngine2Contradictions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        contradictions: [],
        questions: [],
        history: [{ id: 'u-soft', role: 'user', content: finding.content }],
      },
      apiKey: 'test',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.contradictionChanges).toEqual([])
    expect(result.heuristicContradictionChanges).toEqual([])
    expect(result.meta.heuristicContradictionCandidateCount).toBeGreaterThan(0)
    expect(result.meta.heuristicContradictionDecisionSource).toBe('diagnostics_only')
  })

  it('formalizes confirmed low-energy versus bright-light requirements from one accepted finding', async () => {
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = { schemaVersion: 'engine2.contradiction_detection.v1', contradictionChanges: [] }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 1, output: 1, total: 2 } } }
    })
    const finding = {
      id: 'f-energy-light',
      semanticKey: 'user_preference_energy_efficiency_vs_light_intensity',
      content: 'Preferujesz lampę, która zużywa mało energii i jednocześnie daje dobre, jasne światło.',
      status: 'confirmed',
      sourceMessageIds: ['u-energy-light'],
    }

    const result = await detectEngine2Contradictions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        contradictions: [],
        questions: [],
        history: [{ id: 'u-energy-light', role: 'user', content: finding.content }],
      },
      apiKey: 'test',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.contradictionChanges).toHaveLength(1)
    expect(result.contradictionChanges[0]).toMatchObject({
      semanticKey: 'lamp_energy_efficiency_vs_bright_light',
      sideA: 'Niskie zużycie energii',
      sideB: 'Dobre, jasne światło',
      sourceFindingIds: ['f-energy-light'],
      sideASourceFindingIds: ['f-energy-light'],
      sideBSourceFindingIds: ['f-energy-light'],
      evidenceStatus: 'confirmed_requirement_tension',
      origin: 'user_requirements',
      formalEligible: true,
    })
    expect(result.meta.heuristicContradictionDecisionSource).toBe('confirmed_pattern_formalized')
  })

  it('rejects matrix-inspired missing-side candidates without failing detection', async () => {
    const finding = {
      id: 'f-light',
      semanticKey: 'beam_adjustment',
      content: 'Chcesz regulować stożek światła od szerokiego ogólnego do punktowego.',
      status: 'confirmed',
      sourceMessageIds: ['u-light'],
    }
    const runTask = vi.fn().mockImplementationOnce(async (options) => {
      const data = {
        schemaVersion: 'engine2.contradiction_detection.v1',
        contradictionChanges: [{
          operation: 'create',
          contradictionId: null,
          semanticKey: 'light_quality_vs_energy_consumption',
          description: 'Jakość światła mogłaby zwiększać zużycie energii.',
          sideA: 'Lepsza jakość światła',
          sideB: 'Niskie zużycie energii',
          sourceFindingIds: ['f-light'],
          sourceMessageIds: ['u-light'],
          sideASourceFindingIds: ['f-light'],
          sideBSourceFindingIds: [],
          sideASourceMessageIds: ['u-light'],
          sideBSourceMessageIds: [],
          status: 'suspected',
          reportBlocking: true,
          verificationQuestionId: null,
          resolutionFindingIds: [],
          evidenceStatus: 'exploration_hypothesis',
          origin: 'matrix_hypothesis',
          formalEligible: false,
          rejectionReason: 'missing_user_requirement_for_low_energy',
        }],
      }
      options.onRawResponse?.({ content: JSON.stringify(data) })
      return { ok: true, data, meta: { providerCalled: true, tokens: { input: 1, output: 1, total: 2 } } }
    })

    const result = await detectEngine2Contradictions({
      input: {
        language: 'pl',
        confirmedFindings: [finding],
        allFindings: [finding],
        contradictions: [],
        questions: [],
        history: [{ id: 'u-light', role: 'user', content: finding.content }],
      },
      apiKey: 'test',
      aiSupportEnabled: true,
      runTask,
    })

    expect(result.ok).toBe(true)
    expect(result.contradictionChanges).toEqual([])
    expect(result.rejectedContradictionCandidates[0]).toMatchObject({
      semanticKey: 'light_quality_vs_energy_consumption',
      origin: 'matrix_hypothesis',
      formalEligible: false,
      rejectionReason: 'missing_user_requirement_for_low_energy',
    })
    expect(result.meta.acceptedContradictionCandidateCount).toBe(0)
    expect(result.meta.rejectedContradictionCandidateCount).toBe(1)
  })
})
