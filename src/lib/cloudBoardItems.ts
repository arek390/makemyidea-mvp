import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './supabase/types'
import { supabase } from './supabase/client'
import type { EngineBoardItem } from '../storage/sessionStore'

export type BoardItemRow = Database['public']['Tables']['board_items']['Row']

const typedSupabase = supabase as SupabaseClient<Database, 'public'>

const toNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const asNumber = Number(value)
    if (!Number.isNaN(asNumber)) return asNumber
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

const normalizeRow = (row: BoardItemRow): EngineBoardItem => ({
  id: String(row.id || ''),
  type: (row.type as EngineBoardItem['type']) ?? 'idea',
  text: String(row.text || ''),
  label: row.label ?? null,
  question_id: row.question_id ?? null,
  question_text_pl: row.question_text_pl ?? null,
  question_text_en: row.question_text_en ?? null,
  created_at: toNumber(row.created_at, Date.now()),
  entry_type: (row.entry_type as EngineBoardItem['entry_type']) ?? undefined,
  prompt_type: (row.prompt_type as EngineBoardItem['prompt_type']) ?? null,
  matrix_row: row.matrix_row ?? null,
  matrix_col: row.matrix_col ?? null,
  lastClassifiedText: row.last_classified_text ?? null,
  classificationDirty: row.classification_dirty ?? null,
})

export const fetchBoardItems = async (
  sessionId: string,
  _userId: string
): Promise<EngineBoardItem[]> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  if (!sessionId) return []
  const { data, error } = await typedSupabase
    .from('board_items')
    .select(
      'id,session_id,user_id,text,label,matrix_row,matrix_col,question_id,question_text_pl,question_text_en,created_at'
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[board_items] query failed', {
      status: (error as { status?: number | null })?.status,
      code: (error as { code?: string | null })?.code,
      message: (error as { message?: string | null })?.message,
      details: (error as { details?: string | null })?.details,
      hint: (error as { hint?: string | null })?.hint,
    })
    throw error
  }
  if (!data) return []
  const items = (data as BoardItemRow[]).map(normalizeRow)
  console.log('[board_items] fetched', {
    sessionId,
    count: items.length,
    withQuestionCount: items.filter(
      (item) => Boolean(item.question_text_pl || item.question_text_en)
    ).length,
  })
  return items
}

export const insertBoardItem = async (input: {
  user_id: string
  session_id: string
  text: string
  label?: string | null
  matrix_row?: string | null
  matrix_col?: string | null
  question_id?: string | null
  question_text_pl?: string | null
  question_text_en?: string | null
}): Promise<EngineBoardItem> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  const payload = {
    user_id: input.user_id,
    session_id: input.session_id,
    text: input.text,
    label: input.label ?? null,
    matrix_row: input.matrix_row ?? null,
    matrix_col: input.matrix_col ?? null,
    question_id: input.question_id ?? null,
    question_text_pl: input.question_text_pl ?? null,
    question_text_en: input.question_text_en ?? null,
  }
  const { data, error } = await typedSupabase
    .from('board_items')
    .insert(payload)
    .select(
      'id,user_id,session_id,type,text,label,question_id,question_text_pl,question_text_en,created_at,entry_type,prompt_type,matrix_row,matrix_col,last_classified_text,classification_dirty'
    )
    .single()
  if (error) throw error
  return normalizeRow(data as BoardItemRow)
}

export const updateBoardItemLabel = async (
  sessionId: string,
  itemId: string,
  label: string | null
): Promise<void> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  const { error } = await typedSupabase
    .from('board_items')
    .update({ label })
    .eq('session_id', sessionId)
    .eq('id', itemId)
  if (error) {
    console.error('[board_items] query failed', {
      status: (error as { status?: number | null })?.status,
      code: (error as { code?: string | null })?.code,
      message: (error as { message?: string | null })?.message,
      details: (error as { details?: string | null })?.details,
      hint: (error as { hint?: string | null })?.hint,
    })
    throw error
  }
}

export const updateBoardItemMatrix = async (
  sessionId: string,
  itemId: string,
  matrixRow: string | null,
  matrixCol: string | null
): Promise<void> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  const { error } = await typedSupabase
    .from('board_items')
    .update({ matrix_row: matrixRow, matrix_col: matrixCol })
    .eq('session_id', sessionId)
    .eq('id', itemId)
  if (error) {
    console.error('[board_items] matrix update failed', {
      status: (error as { status?: number | null })?.status,
      code: (error as { code?: string | null })?.code,
      message: (error as { message?: string | null })?.message,
      details: (error as { details?: string | null })?.details,
      hint: (error as { hint?: string | null })?.hint,
    })
    throw error
  }
}
