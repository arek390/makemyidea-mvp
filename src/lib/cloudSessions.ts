import type {
  EngineBoardItem,
  EngineSessionDetail,
  EngineSessionSummary,
  ReportMeta,
} from '../storage/sessionStore'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './supabase/types'
import { supabase } from './supabase/client'

export type UserSessionsRow = {
  user_id: string
  session_id: string
  payload: CloudSessionPayload
  updated_at: string
  created_at?: string | null
}

export type UserSessionsInsert = UserSessionsRow

const typedSupabase = supabase as SupabaseClient<Database, 'public'>

export type CloudSessionPayload = {
  session: EngineSessionSummary
  boardItems: EngineBoardItem[]
  askedQuestionIds: string[]
  uiLanguage?: string
  report?: ReportMeta | null
}

export type CloudSessionRecord = {
  sessionId: string
  title: string | null
  payload: CloudSessionPayload
  updatedAt: number
  createdAt: number
  summary: EngineSessionSummary
  detail: EngineSessionDetail
}

const toTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

const normalizeSummary = (input: Partial<EngineSessionSummary>): EngineSessionSummary => ({
  id: String(input.id || ''),
  name: input.name ?? null,
  created_at: input.created_at ?? Date.now(),
  updated_at: input.updated_at ?? Date.now(),
  last_group_code: input.last_group_code ?? null,
  last_mode_code: input.last_mode_code ?? null,
  last_category_code: input.last_category_code ?? null,
  stuck_counter: input.stuck_counter ?? 0,
  tokensInTotal: input.tokensInTotal ?? 0,
  tokensOutTotal: input.tokensOutTotal ?? 0,
})

export const saveSessionToCloud = async (
  userId: string,
  detail: EngineSessionDetail,
  uiLanguage: string
): Promise<void> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  if (!detail.session) {
    throw new Error('Missing session data.')
  }
  const now = Date.now()
  const session = normalizeSummary({
    ...detail.session,
    updated_at: now,
  })
  const payload: CloudSessionPayload = {
    session,
    boardItems: detail.boardItems || [],
    askedQuestionIds: detail.askedQuestionIds || [],
    uiLanguage,
    report: detail.report ?? null,
  }
  const record: UserSessionsInsert = {
    user_id: userId,
    session_id: session.id,
    payload,
    updated_at: new Date(now).toISOString(),
  }
  const { error } = await typedSupabase
    .from('user_sessions')
    .upsert(record, { onConflict: 'user_id,session_id' })
  if (error) throw error
}

export const listCloudSessions = async (userId: string): Promise<CloudSessionRecord[]> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  const { data, error } = await typedSupabase
    .from('user_sessions')
    .select('session_id,payload,updated_at,created_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  if (!data) return []
  return (data as UserSessionsRow[]).map((row) => {
    const payload = (row.payload || {}) as CloudSessionPayload
    const now = Date.now()
    const updatedAt = toTimestamp(row.updated_at, now)
    const createdAt = toTimestamp(row.created_at, updatedAt)
    const sessionId = String(row.session_id || payload?.session?.id || '')
    const summary = normalizeSummary({
      ...(payload?.session || {}),
      id: sessionId,
      name: payload?.session?.name ?? null,
      updated_at: toTimestamp(payload?.session?.updated_at, updatedAt),
      created_at: toTimestamp(payload?.session?.created_at, createdAt),
    })
    const detail: EngineSessionDetail = {
      session: summary,
      boardItems: payload?.boardItems || [],
      askedQuestionIds: payload?.askedQuestionIds || [],
      report: payload?.report || null,
    }
    return {
      sessionId,
      title: payload?.session?.name ?? null,
      payload,
      updatedAt,
      createdAt,
      summary,
      detail,
    }
  })
}
