import type { EngineBoardItem } from '../storage/sessionStore'
import { ENGINE_SORT_GAP } from './constants'
import type {
  AiQuestion,
  FacilitationPerspective,
  SpeechRecognitionCtor,
  SuggestLabelType,
} from './types'

type NormalizeSuggestResponsePayload = {
  ok?: boolean
  question?: string | AiQuestion | null
  data?: { question?: string | AiQuestion | null; questions?: AiQuestion[] }
  meta?: {
    source?: string | null
    tokens?: {
      input?: number
      output?: number
    }
  }
  source?: string | null
}

export const normalizeSuggestResponse = (payload: NormalizeSuggestResponsePayload) => {
  const questions = Array.isArray(payload?.data?.questions) ? payload.data.questions : []
  const primaryCandidate =
    (questions[0] as AiQuestion | undefined) ??
    (payload?.question as AiQuestion | string | null) ??
    (payload?.data?.question as AiQuestion | string | null)
  const mergeMetaCandidate =
    (payload?.question as AiQuestion | null) ??
    (payload?.data?.question as AiQuestion | null) ??
    null
  let questionObj: AiQuestion | null = null
  if (typeof primaryCandidate === 'string') {
    const text = primaryCandidate.trim()
    questionObj = text ? { text } : null
  } else if (primaryCandidate && typeof primaryCandidate === 'object') {
    const text = typeof primaryCandidate.text === 'string' ? primaryCandidate.text.trim() : ''
    if (text) {
      const merged = mergeMetaCandidate && typeof mergeMetaCandidate === 'object'
        ? { ...primaryCandidate, ...mergeMetaCandidate, text }
        : { ...primaryCandidate, text }
      questionObj = merged
    }
  }
  const questionText = questionObj?.text ?? null
  const sourceFromMeta = payload?.meta?.source ?? payload?.source ?? null
  const tokenInput = Number(payload?.meta?.tokens?.input ?? 0)
  const tokenOutput = Number(payload?.meta?.tokens?.output ?? 0)
  const labelType: SuggestLabelType =
    sourceFromMeta === 'fallback'
      ? 'fallback'
      : tokenInput || tokenOutput
        ? 'ai'
        : 'fallback'
  return {
    questionText,
    questionObj,
    labelType,
    questions,
  }
}

export const toMatrixRowKey = (groupCode?: string | null) => {
  const group = String(groupCode || '').toUpperCase()
  if (group === 'A') return 'world'
  if (group === 'B') return 'product'
  if (group === 'C') return 'elements'
  return null
}

export const toMatrixColKey = (modeCode?: number | null) => {
  if (modeCode === 1) return 'as_is'
  if (modeCode === 2) return 'not_working'
  if (modeCode === 3) return 'should_be'
  return null
}

export const getEntryCellId = (item: EngineBoardItem) => {
  const row = String(item.matrix_row || '').toLowerCase()
  const col = String(item.matrix_col || '').toLowerCase()
  const group = row === 'world' ? 'A' : row === 'product' ? 'B' : row === 'elements' ? 'C' : null
  const mode = col === 'as_is' ? '1' : col === 'not_working' ? '2' : col === 'should_be' ? '3' : null
  return group && mode ? `${group}${mode}` : null
}

export const normalizeEngineEntryTypeForLlm = (value: EngineBoardItem['entry_type'] | string | null | undefined) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'facilitated_input') return 'facilitated_input'
  if (raw === 'seed_from_brief') return 'seed_from_brief'
  if (raw === 'manual_input' || raw === 'free_input') return 'manual_input'
  return 'other'
}

export const normalizeEngineAreaForLlm = (value: string | null | undefined) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'as_is' || raw === 'not_working' || raw === 'should_be') return raw
  return null
}

export const clipLlmContextText = (value: unknown, maxLen: number) => {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

export const normalizeEngineBoardEntryForLlm = (
  item: EngineBoardItem,
  uiLanguage: 'English' | 'Polish',
  options: { maxAnswerLen?: number; maxQuestionLen?: number } = {}
) => {
  const answer = clipLlmContextText(item.text, options.maxAnswerLen ?? 280)
  if (!answer) return null
  const primaryQuestion =
    uiLanguage === 'English'
      ? item.question_text_en ?? item.question_text_pl ?? null
      : item.question_text_pl ?? item.question_text_en ?? null
  const question = clipLlmContextText(primaryQuestion, options.maxQuestionLen ?? 260) || null
  const matrix_row = item.matrix_row ?? null
  const matrix_col = item.matrix_col ?? null
  const entryType = normalizeEngineEntryTypeForLlm(item.entry_type)
  return {
    id: item.id,
    area: normalizeEngineAreaForLlm(matrix_col),
    matrix_cell: getEntryCellId(item),
    matrix_row,
    matrix_col,
    entry_type: entryType === 'other' && question ? 'facilitated_input' : entryType,
    question,
    answer,
    text: answer,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    tags: item.label ? [item.label] : undefined,
  }
}

export const cellCodeToMatrix = (cellCode: string) => {
  const code = String(cellCode || '').trim().toUpperCase()
  if (!/^[ABC][123]$/.test(code)) return null
  const group = code[0]
  const mode = Number(code[1])
  return {
    matrix_row: toMatrixRowKey(group) ?? null,
    matrix_col: toMatrixColKey(mode) ?? null,
  }
}

export const perspectiveToAllowedCellIds = (perspective: FacilitationPerspective | null) => {
  if (perspective === 'as_is') return ['A1', 'B1', 'C1'] as const
  if (perspective === 'not_working') return ['A2', 'B2', 'C2'] as const
  if (perspective === 'should_be') return ['A3', 'B3', 'C3'] as const
  return null
}

export const modeToFacilitationPerspective = (modeCode?: number | null): FacilitationPerspective | null => {
  if (modeCode === 1) return 'as_is'
  if (modeCode === 2) return 'not_working'
  if (modeCode === 3) return 'should_be'
  return null
}

export const applyTextEditClassification = (item: EngineBoardItem, nextText: string) => {
  const last = item.lastClassifiedText ?? null
  const dirty = !last || last !== nextText
  return { ...item, text: nextText, classificationDirty: dirty }
}

export const normalizeBoardItem = (item: EngineBoardItem) => {
  const legacyRow = (item as { matrixRow?: string | null }).matrixRow ?? null
  const legacyCol = (item as { matrixCol?: string | null }).matrixCol ?? null
  const legacyCell = (item as { matrixCell?: string | null; cellCode?: string | null }).matrixCell ??
    (item as { cellCode?: string | null }).cellCode ??
    null
  let matrixRow = item.matrix_row ?? legacyRow ?? null
  let matrixCol = item.matrix_col ?? legacyCol ?? null
  if ((!matrixRow || !matrixCol) && legacyCell) {
    const mapped = cellCodeToMatrix(String(legacyCell))
    if (mapped?.matrix_row && mapped?.matrix_col) {
      matrixRow = mapped.matrix_row
      matrixCol = mapped.matrix_col
    }
  }
  const createdAtRaw = item.created_at ?? null
  const updatedAtRaw = (item as { updated_at?: unknown }).updated_at ?? null
  const createdAt =
    typeof createdAtRaw === 'number'
      ? createdAtRaw
      : typeof createdAtRaw === 'string' && !Number.isNaN(Date.parse(createdAtRaw))
        ? Date.parse(createdAtRaw)
        : undefined
  const updatedAt =
    typeof updatedAtRaw === 'number'
      ? updatedAtRaw
      : typeof updatedAtRaw === 'string' && !Number.isNaN(Date.parse(updatedAtRaw))
        ? Date.parse(updatedAtRaw)
        : undefined
  const sortOrderRaw = (item as { sort_order?: unknown }).sort_order ?? null
  const sortOrder =
    typeof sortOrderRaw === 'number'
      ? sortOrderRaw
      : typeof sortOrderRaw === 'string'
        ? Number(sortOrderRaw)
        : undefined
  return {
    ...item,
    label: item.label ?? null,
    matrix_row: matrixRow ?? null,
    matrix_col: matrixCol ?? null,
    sort_order: Number.isFinite(sortOrder ?? NaN) ? sortOrder : item.sort_order ?? null,
    created_at: createdAt ?? item.created_at,
    updated_at: updatedAt ?? item.updated_at,
  }
}

export const normalizeBoardItems = (items: EngineBoardItem[]) => {
  const normalized = items.map(normalizeBoardItem)
  return normalized.map((item, index) => ({
    ...item,
    sort_order:
      typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
        ? item.sort_order
        : (index + 1) * ENGINE_SORT_GAP,
  }))
}

export const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null
  const speechWindow = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

export const getMeaningfulWords = (value: string) =>
  (value.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? [])
    .map((word) => word.trim().toLocaleLowerCase())
    .filter((word) => word.length > 2)
