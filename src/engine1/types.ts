export type FacilitationType = 'NEXT' | 'DEEPEN' | 'PERSPECTIVE' | 'RESET'
export type FacilitationPrompt = { type: FacilitationType; text: string }

export type AiQuestion = {
  id?: string
  text?: string
  grounded_in?: string[]
  why_this_question?: string
  group_code?: string
  mode_code?: number
}

export type SuggestLabelType = 'ai' | 'fallback'

export type SpeechRecognitionAlternativeLike = { transcript: string }
export type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}
export type SpeechRecognitionResultListLike = {
  length: number
  [index: number]: SpeechRecognitionResultLike
}
export type SpeechRecognitionEventLike = Event & {
  resultIndex?: number
  results: SpeechRecognitionResultListLike
}
export type SpeechRecognitionErrorEventLike = Event & {
  error?: string
}
export type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  abort: () => void
  start: () => void
  stop: () => void
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export type EnginePerspectiveKey = 'as_is' | 'not_working' | 'should_be'
export type FacilitationPerspective = EnginePerspectiveKey

export type ActionPlanReadinessLlmResult = {
  summary: string
  howToBoost: string
  biggestBoostRightNow: string
  qualityLevel: 'low' | 'medium' | 'high'
  // Legacy / optional (kept for compatibility while the endpoint migrates).
  insights?: string[]
  improvements?: string[]
  nextBestAction?: string
}
