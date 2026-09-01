import type { EnginePerspectiveKey, FacilitationPerspective } from './types'

export const WORD_LIMIT = 100
export const INITIAL_BRIEF_WORD_LIMIT = 1000
export const INITIAL_BRIEF_RECOMMENDED_WORD_TARGET = 200
export const INITIAL_BRIEF_MIN_MEANINGFUL_WORDS = 25
export const INITIAL_BRIEF_MIN_DISTINCT_MEANINGFUL_WORDS = 3
export const SHORT_ENTRY_WORDS = 12
export const DEFAULT_IDLE_THRESHOLD_MS = 15000
export const ERASE_EMPTY_SECONDS_STRONG = 10
export const MAX_AUTO_CLASSIFY = 25

export const ENGINE_PERSPECTIVE_KEYS: EnginePerspectiveKey[] = ['as_is', 'not_working', 'should_be']
export const ENGINE_SORT_GAP = 1024

export const FACILITATION_PERSPECTIVE_MODE: Record<FacilitationPerspective, 1 | 2 | 3> = {
  as_is: 1,
  not_working: 2,
  should_be: 3,
}
