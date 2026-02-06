import fs from 'node:fs'
import path from 'node:path'
import { initEngineDb, ENGINE_DB_PATH } from '../engine/db.mjs'
import { getDbHealth } from '../engine/dbHealth.mjs'
import { getCsvInfo } from '../engine/questionDataset.mjs'
import { listBoardItems } from '../engine/sessionRepository.mjs'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction, resolveQueryValue, isDevEnabled } from '../src/lib/server/router.js'

let didWarnLowQuestionCount = false
const warnLowQuestionCount = () => {
  if (didWarnLowQuestionCount) return
  if (process.env.NODE_ENV === 'production') return
  const db = initEngineDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM questions').get()
  if (row?.count < 100) {
    console.warn(`[engine] Low question count detected (${row.count}). Did you seed the DB?`)
  }
  didWarnLowQuestionCount = true
}

const guardDev = (res) => {
  if (!isDevEnabled()) {
    notFound(res)
    return false
  }
  return true
}

const handleDbHealth = async (req, res) => {
  if (!guardDev(res)) return
  if (process.env.DEBUG_ENGINE !== '1') {
    sendJson(res, 404, { ok: false, error: 'Not Found' })
    return
  }
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  try {
    initEngineDb()
    const dbHealth = getDbHealth()
    const csvInfo = getCsvInfo()

    sendJson(res, 200, {
      ok: true,
      env: process.env.VERCEL ? 'vercel' : 'local',
      dbPath: ENGINE_DB_PATH || null,
      dbHealth,
      csvInfo,
    })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error?.message || 'Server error' })
  }
}

const handleQuestionsSource = (req, res) => {
  if (!guardDev(res)) return
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  try {
    const cwd = process.cwd()
    const csvPath = path.join(cwd, 'public', 'questions_enriched_pl_eng.csv')
    let exists = false
    try {
      exists = fs.existsSync(csvPath)
    } catch {
      exists = false
    }

    if (!exists) {
      sendJson(res, 200, { ok: false, error: 'CSV_NOT_FOUND', cwd, csvPath, exists })
      return
    }

    const raw = fs.readFileSync(csvPath, 'utf8')
    const lines = raw.split(/\r?\n/).filter(Boolean)
    const rows = Math.max(0, lines.length - 1)
    const header = lines[0] || ''
    const delim = header.split(';').length > header.split(',').length ? ';' : ','

    const idSet = new Set()
    const langSet = new Set()
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split(delim)
      const id = (parts[0] || '').trim()
      const lang = (parts[parts.length - 1] || '').trim()
      if (id) idSet.add(id)
      if (lang) langSet.add(lang)
    }

    sendJson(res, 200, {
      ok: true,
      cwd,
      csvPath,
      exists: true,
      stats: { rows, uniqueIds: idSet.size, langs: Array.from(langSet).sort() },
    })
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      error: 'EXCEPTION_READING_CSV',
      message: String(error && error.message ? error.message : error),
    })
  }
}

const getEnvHost = () => {
  const url = process.env.SUPABASE_URL || ''
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

const handleSelftest = async (req, res) => {
  if (!guardDev(res)) return
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }

  const steps = {
    adminCheck: { ok: false, error: null },
    insert: { ok: false, error: null },
    select: { ok: false, found: false, row: null, error: null },
    delete: { ok: false, error: null },
  }
  const envHost = getEnvHost()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const env = {
    hasUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceRoleKey,
    serviceRoleKeyLen: hasServiceRoleKey ? key.length : null,
    serviceRoleKeyPrefix: hasServiceRoleKey ? key.slice(0, 6) : null,
  }
  let sessionId = ''
  try {
    const supabaseAdmin = getSupabaseAdmin()
    try {
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 })
      steps.adminCheck.ok = true
    } catch (error) {
      steps.adminCheck.error = {
        message: error?.message ?? null,
        status: error?.status ?? null,
        name: error?.name ?? null,
      }
    }
    sessionId = crypto.randomUUID()
    const name = `selftest-${sessionId.slice(0, 8)}`
    const userId = '00000000-0000-0000-0000-000000000000'

    const insertRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .insert({ id: sessionId, user_id: userId, name })
    if (insertRes.error) {
      steps.insert.error = {
        code: insertRes.error?.code ?? null,
        message: insertRes.error?.message ?? null,
        details: insertRes.error?.details ?? null,
        hint: insertRes.error?.hint ?? null,
        status: insertRes.error?.status ?? null,
      }
    } else {
      steps.insert.ok = true
    }

    const selectRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id,user_id,name')
      .eq('id', sessionId)
      .maybeSingle()
    if (selectRes.error) {
      steps.select.error = {
        code: selectRes.error?.code ?? null,
        message: selectRes.error?.message ?? null,
        details: selectRes.error?.details ?? null,
        hint: selectRes.error?.hint ?? null,
        status: selectRes.error?.status ?? null,
      }
    } else {
      steps.select.ok = true
      steps.select.found = Boolean(selectRes.data)
      steps.select.row = selectRes.data || null
    }

    const deleteRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .delete()
      .eq('id', sessionId)
    if (deleteRes.error) {
      steps.delete.error = {
        code: deleteRes.error?.code ?? null,
        message: deleteRes.error?.message ?? null,
        details: deleteRes.error?.details ?? null,
        hint: deleteRes.error?.hint ?? null,
        status: deleteRes.error?.status ?? null,
      }
    } else {
      steps.delete.ok = true
    }
  } catch (error) {
    if (!steps.insert.ok && !steps.insert.error) {
      steps.insert.error = {
        code: error?.code ?? null,
        message: error?.message ?? null,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
        status: error?.status ?? null,
      }
    }
  }

  res.status(200).json({
    ok: steps.insert.ok && steps.select.ok && steps.delete.ok,
    envHost,
    env,
    steps,
  })
}

const handleSession = async (req, res) => {
  if (!guardDev(res)) return
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  const sessionId = String(resolveQueryValue(req, 'sessionId') || '').trim()
  if (!sessionId) {
    res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' })
    return
  }
  let data = null
  let error = null
  let publicRawRes = null
  let authRawRes = null
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const resSelect = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id,user_id,name')
      .eq('id', sessionId)
      .maybeSingle()
    publicRawRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
    authRawRes = await supabaseAdmin
      .schema('auth')
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
    data = resSelect.data || null
    error = resSelect.error || null
  } catch (err) {
    error = err
  }
  res.status(200).json({
    ok: true,
    found: Boolean(data),
    session: data
      ? { id: data.id ?? null, user_id: data.user_id ?? null, name: data.name ?? null }
      : null,
    supabaseError: error
      ? {
          code: error?.code ?? null,
          message: error?.message ?? null,
          details: error?.details ?? null,
        }
      : null,
    envHost: getEnvHost(),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    publicRawCount: Array.isArray(publicRawRes?.data) ? publicRawRes.data.length : 0,
    authRawCount: Array.isArray(authRawRes?.data) ? authRawRes.data.length : 0,
  })
}

const handleSessions = async (req, res) => {
  if (!guardDev(res)) return
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const countRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id', { count: 'exact', head: true })
    const listRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id,user_id,name,created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    const authCountRes = await supabaseAdmin
      .schema('auth')
      .from('sessions')
      .select('id', { count: 'exact', head: true })
    res.status(200).json({
      ok: true,
      diag: {
        supabaseUrl: process.env.SUPABASE_URL || null,
        hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      errors: {
        publicCountErr: countRes.error
          ? {
              code: countRes.error?.code ?? null,
              message: countRes.error?.message ?? null,
              details: countRes.error?.details ?? null,
              hint: countRes.error?.hint ?? null,
              status: countRes.error?.status ?? null,
            }
          : null,
        authCountErr: authCountRes.error
          ? {
              code: authCountRes.error?.code ?? null,
              message: authCountRes.error?.message ?? null,
              details: authCountRes.error?.details ?? null,
              hint: authCountRes.error?.hint ?? null,
              status: authCountRes.error?.status ?? null,
            }
          : null,
        lastSessionsErr: listRes.error
          ? {
              code: listRes.error?.code ?? null,
              message: listRes.error?.message ?? null,
              details: listRes.error?.details ?? null,
              hint: listRes.error?.hint ?? null,
              status: listRes.error?.status ?? null,
            }
          : null,
      },
      envHost: getEnvHost(),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      countSessions: typeof countRes.count === 'number' ? countRes.count : null,
      countPublicSessions: typeof countRes.count === 'number' ? countRes.count : null,
      countAuthSessions:
        typeof authCountRes.count === 'number' ? authCountRes.count : null,
      lastSessions: listRes.data || null,
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: {
        code: error?.code ?? null,
        message: error?.message ?? 'Request failed',
        details: error?.details ?? null,
      },
    })
  }
}

const handleMatrix = (req, res) => {
  if (!guardDev(res)) return
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  initEngineDb()
  warnLowQuestionCount()
  const sessionId = String(resolveQueryValue(req, 'sessionId') || '').trim()
  if (!sessionId) {
    sendJson(res, 400, { error: 'Missing sessionId.' })
    return
  }

  const entries = listBoardItems({ sessionId, limit: 500 })

  const baseMatrix = {
    WORLD: { AS_IS: [], NOT_WORKING: [], SHOULD_BE: [] },
    PRODUCT: { AS_IS: [], NOT_WORKING: [], SHOULD_BE: [] },
    ELEMENTS: { AS_IS: [], NOT_WORKING: [], SHOULD_BE: [] },
  }

  const matrix = JSON.parse(JSON.stringify(baseMatrix))

  const short = (text) => {
    const trimmed = String(text || '').trim()
    if (!trimmed) return ''
    if (trimmed.length <= 140) return trimmed
    return trimmed.slice(0, 140) + '…'
  }

  entries.forEach((entry) => {
    const row = entry.matrix_row || 'PRODUCT'
    const col = entry.matrix_col || 'AS_IS'
    if (!matrix[row] || !matrix[row][col]) return
    matrix[row][col].push({
      id: entry.id,
      short_text: short(entry.text),
      entry_type: entry.entry_type || 'free_input',
      promptType: entry.prompt_type || null,
      created_at: entry.created_at,
    })
  })

  let filledCells = 0
  Object.keys(matrix).forEach((row) => {
    Object.keys(matrix[row]).forEach((col) => {
      if (matrix[row][col].length > 0) filledCells += 1
    })
  })

  const timeline = entries
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      matrix_row: entry.matrix_row || 'PRODUCT',
      matrix_col: entry.matrix_col || 'AS_IS',
      short_text: short(entry.text),
      created_at: entry.created_at,
    }))

  sendJson(res, 200, {
    matrix,
    coverage: { filledCells, totalCells: 9 },
    timeline,
  })
}

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  switch (action) {
    case 'db_health':
      await handleDbHealth(req, res)
      return
    case 'questions_source':
      handleQuestionsSource(req, res)
      return
    case 'selftest':
      await handleSelftest(req, res)
      return
    case 'session':
      await handleSession(req, res)
      return
    case 'sessions':
      await handleSessions(req, res)
      return
    case 'matrix':
      handleMatrix(req, res)
      return
    default:
      notFound(res)
  }
}
