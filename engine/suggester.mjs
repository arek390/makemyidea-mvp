import { finalizeSelection, selectQuestion } from './questionSelector.mjs'
export { computeAnswerSignal } from './questionSelection.mjs'

export const suggestNextQuestion = ({
  sessionId,
  lang,
  action = 'AUTO',
  groupCode,
  modeCode,
  categoryCode,
  intentCode,
}) => {
  const { question, meta } = selectQuestion({
    sessionId,
    lang,
    action,
    groupCode,
    modeCode,
    categoryCode,
    intentCode,
  })

  if (process.env.DEBUG_SUGGESTER === '1') {
    console.log(
      JSON.stringify({
        event: 'selection',
        endpoint: 'coach/suggest',
        sessionId,
        action: meta?.action,
        cellKey: meta?.cellKey ?? null,
        candidatesInCell: meta?.candidatesInCell ?? null,
        askedInCell: meta?.askedInCell ?? null,
        exhausted: meta?.exhausted ?? null,
        selected: question?.id ?? null,
      })
    )
  }

  finalizeSelection({ sessionId, question })
  return question
}
