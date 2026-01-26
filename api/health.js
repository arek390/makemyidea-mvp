import { sendJson } from './_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const scope = String(url.searchParams.get('scope') || '').trim().toLowerCase()
  if (scope === 'ping') {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() })
    return
  }
  if (scope === 'llm') {
    sendJson(res, 200, {
      ok: true,
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      aiSupportEnabled: process.env.AI_SUPPORT_DISABLED !== 'true',
    })
    return
  }
  sendJson(res, 200, { ok: true, hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY) })
}
