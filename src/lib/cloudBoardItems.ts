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
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token || ''
  if (!token) {
    throw new Error('AUTH_REQUIRED')
  }
  const response = await fetch('/api/board-items?action=upsert', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId: input.session_id,
      text: input.text,
      label: input.label ?? null,
      matrixRow: input.matrix_row ?? null,
      matrixCol: input.matrix_col ?? null,
      questionId: input.question_id ?? null,
      questionTextPl: input.question_text_pl ?? null,
      questionTextEn: input.question_text_en ?? null,
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'UPSERT_FAILED')
  }
  return normalizeRow(payload.item as BoardItemRow)
}

export const updateBoardItemLabel = async (
  sessionId: string,
  itemId: string,
  label: string | null
): Promise<number | null> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token || ''
  if (!token) {
    throw new Error('AUTH_REQUIRED')
  }
  const response = await fetch('/api/board-items?action=upsert', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId, itemId, label }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'UPDATE_FAILED')
  }
  const balanceAfter = Number(payload?.balance_after_minor ?? NaN)
  return Number.isFinite(balanceAfter) ? balanceAfter : null
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
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token || ''
  if (!token) {
    throw new Error('AUTH_REQUIRED')
  }
  const response = await fetch('/api/board-items?action=upsert', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId, itemId, matrixRow, matrixCol }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'UPDATE_FAILED')
  }
}
