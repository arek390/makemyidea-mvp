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
      'id,session_id,type,text,label,question_id,question_text_pl,question_text_en,created_at,entry_type,prompt_type,matrix_row,matrix_col,last_classified_text,classification_dirty'
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!data) return []
  return (data as BoardItemRow[]).map(normalizeRow)
}

export const insertBoardItem = async (
  item: EngineBoardItem & {
    user_id: string
    session_id: string
    question_text_pl?: string | null
    question_text_en?: string | null
  }
): Promise<EngineBoardItem> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  const { data, error } = await typedSupabase
    .from('board_items')
    .insert({
      id: item.id,
      user_id: item.user_id,
      session_id: item.session_id,
      type: item.type,
      text: item.text,
      label: item.label ?? null,
      question_id: item.question_id ?? null,
      question_text_pl: item.question_text_pl ?? null,
      question_text_en: item.question_text_en ?? null,
      created_at: item.created_at ?? Date.now(),
      entry_type: item.entry_type ?? null,
      prompt_type: item.prompt_type ?? null,
      matrix_row: item.matrix_row ?? null,
      matrix_col: item.matrix_col ?? null,
      last_classified_text: item.lastClassifiedText ?? null,
      classification_dirty: item.classificationDirty ?? null,
    })
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
  if (error) throw error
}
