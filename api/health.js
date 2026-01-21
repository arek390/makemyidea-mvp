import { sendJson } from './_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  sendJson(res, 200, { ok: true, hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY) })
}
