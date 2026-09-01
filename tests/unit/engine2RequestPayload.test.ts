import { describe, expect, it } from 'vitest'
import {
  buildAnalyzeMessageRequestBody,
  buildRetryAnalyzeRequestBody,
  createEngine2UserMessage,
  resolveEngine2EffectiveReplyTarget,
} from '../../src/engine2/requestPayload.js'

describe('engine2 request payload builders', () => {
  it('keeps the selected panel-question context on the local transcript message', () => {
    const message = createEngine2UserMessage({
      id: 'u-q5',
      content: 'Lampa ma służyć do pracy przy komputerze i napraw.',
      replyToQuestionId: 'q5',
      replyToQuestionText: 'W jakim środowisku i scenariuszach lampa będzie używana?',
      replyTargetSource: 'explicit_composer',
    })
    expect(message).toMatchObject({
      replyToQuestionId: 'q5',
      replyToQuestionText: 'W jakim środowisku i scenariuszach lampa będzie używana?',
      replyTargetSource: 'explicit_composer',
    })
  })

  it('does not infer a reply target and lets an explicit panel target win', () => {
    const questions = [
      { id: 'q2', question: 'Jakich dodatkowych funkcji potrzebujesz?', status: 'open' as const, presentation: 'panel' as const },
      { id: 'q3', question: 'Jak szeroka ma być wiązka?', status: 'open' as const, presentation: 'panel' as const },
    ]
    expect(resolveEngine2EffectiveReplyTarget({
      explicitComposerReplyTargetId: null,
      activeQuestionId: 'q2',
      openQuestions: questions,
    })).toEqual({ question: null, source: 'none' })
    expect(resolveEngine2EffectiveReplyTarget({
      explicitComposerReplyTargetId: 'q3',
      activeQuestionId: 'q2',
      openQuestions: questions,
    })).toMatchObject({ question: { id: 'q3' }, source: 'explicit_composer' })
  })

  it('does not guess without a clicked panel question', () => {
    const panelOnly = [{ id: 'q2', question: 'Pytanie', status: 'open' as const, presentation: 'panel' as const }]
    const ambiguous = [
      { id: 'q2', question: 'Pytanie 2', status: 'open' as const, presentation: 'panel' as const },
      { id: 'q3', question: 'Pytanie 3', status: 'open' as const, presentation: 'panel' as const },
    ]
    expect(resolveEngine2EffectiveReplyTarget({ explicitComposerReplyTargetId: null, activeQuestionId: 'q2', openQuestions: panelOnly }))
      .toEqual({ question: null, source: 'none' })
    expect(resolveEngine2EffectiveReplyTarget({ explicitComposerReplyTargetId: null, activeQuestionId: 'q2', openQuestions: ambiguous }))
      .toEqual({ question: null, source: 'none' })
  })

  it('includes current open questions in analyze and retry payloads', () => {
    const openQuestions = [
      { id: 'gap-1', question: 'Jakiej funkcji oczekuje klient?' },
      { id: 'gap-2', question: 'Dlaczego obecna oferta tego nie daje?' },
    ]

    const analyzePayload = buildAnalyzeMessageRequestBody({
      trialId: 'trial-1',
      turnId: 'turn-1',
      language: 'pl',
      messageId: 'msg-1',
      messageContent: 'Krótka odpowiedź.',
      history: [{ id: 'msg-1', role: 'user', content: 'Krótka odpowiedź.' }],
      findings: [],
      rejectedFingerprints: [],
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['msg-0'],
      providerCalls: 2,
      selectedQuestion: { id: 'gap-1', question: 'Jakiej funkcji oczekuje klient?' },
      replyToGapId: 'gap-1',
      activeQuestionGapId: 'gap-1',
      openQuestions,
    })

    const retryPayload = buildRetryAnalyzeRequestBody({
      trialId: 'trial-1',
      turnId: 'turn-2',
      language: 'pl',
      retryMessageId: 'msg-1',
      retryMessageContent: 'Krótka odpowiedź.',
      history: [{ id: 'msg-1', role: 'user', content: 'Krótka odpowiedź.' }],
      findings: [],
      rejectedFingerprints: [],
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['msg-0'],
      providerCalls: 2,
      selectedQuestion: { id: 'gap-1', question: 'Jakiej funkcji oczekuje klient?' },
      replyToGapId: 'gap-1',
      activeQuestionGapId: 'gap-1',
      openQuestions,
    })

    expect(analyzePayload.openQuestions).toEqual(openQuestions)
    expect(retryPayload.openQuestions).toEqual(openQuestions)
    expect(analyzePayload).toMatchObject({ replyToGapId: 'gap-1', activeQuestionGapId: 'gap-1' })
    expect(retryPayload).toMatchObject({ replyToGapId: 'gap-1', activeQuestionGapId: 'gap-1' })
    expect(analyzePayload.trialCounters).toEqual({
      successfulTrialTurns: 1,
      successfulTurnMessageIds: ['msg-0'],
      providerCalls: 2,
    })
  })
})
