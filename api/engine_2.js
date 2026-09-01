import { readJsonBody, sendJson } from '../src/lib/server/http.js'
import { handleEngine2Public } from '../src/lib/server/handlers/engine2Public.js'

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body
  await handleEngine2Public(req, res)
}
