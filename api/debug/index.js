import fs from 'node:fs'
import path from 'node:path'
import { sendJson } from '../_lib/http.js'

const resolveAction = (req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  return String(url.searchParams.get('action') || '').trim().toLowerCase()
}

const handleDbHealth = async (req, res) => {
  if (process.env.DEBUG_ENGINE !== '1') {
    sendJson(res, 404, { ok: false, error: 'Not Found' })
    return
  }
  try {
    const { initEngineDb, ENGINE_DB_PATH } = await import('../../engine/db.mjs')
    const { getDbHealth } = await import('../../engine/dbHealth.mjs')
    const { getCsvInfo } = await import('../../engine/questionDataset.mjs')

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  const action = resolveAction(req)
  if (action === 'db-health') {
    await handleDbHealth(req, res)
    return
  }
  if (action === 'questions-source') {
    handleQuestionsSource(req, res)
    return
  }
  sendJson(res, 400, { ok: false, error: 'INVALID_ACTION' })
}
