import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'

const getBearerToken = (req) => {
  const authHeader =
    req?.headers?.authorization ||
    req?.headers?.Authorization ||
    (typeof req?.headers?.get === 'function' ? req.headers.get('authorization') : '') ||
    ''
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  return ''
}

const logDeleteStage = (stage, meta) => {
  console.log('[session.delete]', stage, meta)
}

const deleteAndCount = async ({ query, label, table, selectColumns, filters }) => {
  const result = await query.select(selectColumns)
  if (result.error) {
    logDeleteStage(`${label}_failed`, {
      table,
      filters,
      message: result.error.message || null,
      code: result.error.code || null,
      details: result.error.details || null,
      hint: result.error.hint || null,
    })
    return { ok: false, error: result.error, count: 0 }
  }
  const count = Array.isArray(result.data) ? result.data.length : 0
  logDeleteStage(`${label}_deleted`, { table, filters, count })
  return { ok: true, count }
}

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action !== 'delete') {
    notFound(res)
    return
  }
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const token = getBearerToken(req)
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
    return
  }

  const payload = body && typeof body === 'object' ? body : {}
  const sessionId = String(payload.sessionId || '').trim()
  if (!sessionId) {
    sendJson(res, 400, { ok: false, error: 'SESSION_ID_REQUIRED' })
    return
  }

  const supabaseAdmin = getSupabaseAdmin()
  const authRes = await supabaseAdmin.auth.getUser(token)
  const currentUserId = authRes?.data?.user?.id || null
  if (authRes?.error || !currentUserId) {
    sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
    return
  }

  const sessionRes = await supabaseAdmin
    .schema('public')
    .from('sessions')
    .select('id,user_id')
    .eq('id', sessionId)
    .eq('user_id', currentUserId)
    .maybeSingle()

  if (sessionRes.error) {
    logDeleteStage('ownership_check_failed', {
      sessionId,
      currentUserId,
      message: sessionRes.error.message || null,
      code: sessionRes.error.code || null,
    })
    sendJson(res, 500, { ok: false, error: 'SESSION_OWNERSHIP_CHECK_FAILED' })
    return
  }

  if (!sessionRes.data?.id) {
    logDeleteStage('ownership_not_confirmed', { sessionId, currentUserId })
    sendJson(res, 404, { ok: false, error: 'SESSION_NOT_FOUND' })
    return
  }

  logDeleteStage('delete_start', { sessionId, currentUserId })

  const deleted = {
    reports: 0,
    boardItems: 0,
    aiCostEvents: 0,
    userSessions: 0,
    sessionState: 0,
    sessions: 0,
  }

  const reportsDelete = await deleteAndCount(
    {
      query: supabaseAdmin.schema('public').from('reports').delete().eq('session_id', sessionId),
      label: 'reports',
      table: 'reports',
      selectColumns: 'id',
      filters: { session_id: sessionId },
    }
  )
  if (!reportsDelete.ok) {
    sendJson(res, 500, { ok: false, error: 'REPORTS_DELETE_FAILED' })
    return
  }
  deleted.reports = reportsDelete.count

  const boardItemsDelete = await deleteAndCount(
    {
      query: supabaseAdmin.schema('public').from('board_items').delete().eq('session_id', sessionId),
      label: 'board_items',
      table: 'board_items',
      selectColumns: 'id',
      filters: { session_id: sessionId },
    }
  )
  if (!boardItemsDelete.ok) {
    sendJson(res, 500, { ok: false, error: 'BOARD_ITEMS_DELETE_FAILED' })
    return
  }
  deleted.boardItems = boardItemsDelete.count

  const aiCostEventsDelete = await deleteAndCount(
    {
      query: supabaseAdmin
        .schema('public')
        .from('session_ai_cost_events')
        .delete()
        .eq('session_id', sessionId),
      label: 'session_ai_cost_events',
      table: 'session_ai_cost_events',
      selectColumns: 'id',
      filters: { session_id: sessionId },
    }
  )
  if (!aiCostEventsDelete.ok) {
    sendJson(res, 500, { ok: false, error: 'SESSION_AI_COST_EVENTS_DELETE_FAILED' })
    return
  }
  deleted.aiCostEvents = aiCostEventsDelete.count

  const userSessionsDelete = await deleteAndCount(
    {
      query: supabaseAdmin
        .schema('public')
        .from('user_sessions')
        .delete()
        .eq('session_id', sessionId)
        .eq('user_id', currentUserId),
      label: 'user_sessions',
      table: 'user_sessions',
      selectColumns: 'session_id,user_id',
      filters: { session_id: sessionId, user_id: currentUserId },
    }
  )
  if (!userSessionsDelete.ok) {
    sendJson(res, 500, { ok: false, error: 'USER_SESSIONS_DELETE_FAILED' })
    return
  }
  deleted.userSessions = userSessionsDelete.count

  const sessionStateDelete = await deleteAndCount(
    {
      query: supabaseAdmin.schema('public').from('session_state').delete().eq('session_id', sessionId),
      label: 'session_state',
      table: 'session_state',
      selectColumns: 'session_id',
      filters: { session_id: sessionId },
    }
  )
  if (!sessionStateDelete.ok) {
    sendJson(res, 500, { ok: false, error: 'SESSION_STATE_DELETE_FAILED' })
    return
  }
  deleted.sessionState = sessionStateDelete.count

  const sessionsDelete = await deleteAndCount(
    {
      query: supabaseAdmin.schema('public').from('sessions').delete().eq('id', sessionId),
      label: 'sessions',
      table: 'sessions',
      selectColumns: 'id',
      filters: { id: sessionId },
    }
  )
  if (!sessionsDelete.ok) {
    sendJson(res, 500, { ok: false, error: 'SESSIONS_DELETE_FAILED' })
    return
  }
  deleted.sessions = sessionsDelete.count

  logDeleteStage('delete_complete', { sessionId, currentUserId, deleted })
  sendJson(res, 200, {
    ok: true,
    deletedSessionId: sessionId,
    deleted,
  })
}
