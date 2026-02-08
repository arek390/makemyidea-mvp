import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './supabase/types'
import { supabase } from './supabase/client'
import type { ReportIdea, ReportRecommendations, ReportSummary } from '../storage/sessionStore'

export type ReportRow = Database['public']['Tables']['reports']['Row']

export type ReportRecord = {
  id: string
  sessionId: string
  createdAt: number
  updatedAt: number
  summary: ReportSummary | null
  ideas: ReportIdea[] | null
  recommendations: ReportRecommendations | null
  lang?: 'pl' | 'en' | null
  lastSummaryTextHash: string | null
  sourceUpdatedAt: number
}

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

const parseSummaryJson = (
  value: unknown
): {
  summary: ReportSummary | null
  ideas: ReportIdea[] | null
  recommendations: ReportRecommendations | null
  lang?: 'pl' | 'en' | null
} => {
  if (!value || typeof value !== 'object') {
    return { summary: null, ideas: null, recommendations: null, lang: null }
  }
  const maybeSummary = value as {
    summary?: ReportSummary
    ideas?: unknown
    recommendations?: unknown
    lang?: unknown
  }
  const rawLang = typeof maybeSummary.lang === 'string' ? maybeSummary.lang.toLowerCase() : ''
  const lang =
    rawLang === 'pl' || rawLang === 'polish' ? 'pl' : rawLang === 'en' || rawLang === 'english' ? 'en' : null
  if (maybeSummary.summary || maybeSummary.ideas || maybeSummary.recommendations) {
    return {
      summary: (maybeSummary.summary as ReportSummary | null) ?? null,
      ideas: Array.isArray(maybeSummary.ideas) ? (maybeSummary.ideas as ReportIdea[]) : null,
      recommendations:
        maybeSummary.recommendations && typeof maybeSummary.recommendations === 'object'
          ? (maybeSummary.recommendations as ReportRecommendations)
          : null,
      lang,
    }
  }
  const legacy = value as Partial<ReportSummary>
  if (
    typeof legacy.today === 'string' ||
    typeof legacy.change === 'string' ||
    typeof legacy.product === 'string'
  ) {
    return { summary: legacy as ReportSummary, ideas: null, recommendations: null, lang }
  }
  return { summary: null, ideas: null, recommendations: null, lang }
}

const normalizeReportRow = (row: ReportRow): ReportRecord => {
  const now = Date.now()
  const parsed = parseSummaryJson(row.summary_json)
  return {
    id: String(row.id || ''),
    sessionId: String(row.session_id || ''),
    createdAt: toNumber(row.created_at, now),
    updatedAt: toNumber(row.updated_at, now),
    summary: parsed.summary,
    ideas: parsed.ideas,
    recommendations: parsed.recommendations,
    lang: parsed.lang ?? null,
    lastSummaryTextHash: row.last_summary_text_hash ?? null,
    sourceUpdatedAt: toNumber(row.source_updated_at, 0),
  }
}

export const fetchReportBySessionId = async (
  sessionId: string
): Promise<ReportRecord | null> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  if (!sessionId) return null
  const { data, error } = await typedSupabase
    .from('reports')
    .select(
      'id,session_id,created_at,updated_at,summary_json,last_summary_text_hash,source_updated_at'
    )
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return normalizeReportRow(data as ReportRow)
}

export const ensureReportExists = async (
  sessionId: string,
  sourceUpdatedAt: number,
  lang?: 'pl' | 'en' | null
): Promise<ReportRecord> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  if (!sessionId) {
    throw new Error('Missing session id.')
  }
  const existing = await fetchReportBySessionId(sessionId)
  if (existing) return existing
  const sessionRes = await supabase.auth.getSession()
  const token = sessionRes?.data?.session?.access_token || ''
  const response = await fetch('/api/report?action=generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sessionId }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok || !payload?.report) {
    const message = payload?.error || 'REPORT_GENERATE_FAILED'
    console.error('[report] ensure failed', { sessionId, message })
    const retry = await fetchReportBySessionId(sessionId)
    if (retry) return retry
    throw new Error(message)
  }
  return normalizeReportRow(payload.report as ReportRow)
}

export const updateReportBySessionId = async (
  sessionId: string,
  patch: Partial<ReportRow>
): Promise<ReportRecord | null> => {
  if (!supabase) {
    throw new Error('Missing Supabase client.')
  }
  if (!sessionId) return null
  const { data, error } = await typedSupabase
    .from('reports')
    .update(patch)
    .eq('session_id', sessionId)
    .select(
      'id,session_id,created_at,updated_at,summary_json,last_summary_text_hash,source_updated_at'
    )
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return normalizeReportRow(data as ReportRow)
}
