import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import { handleReportUpdate } from '../src/lib/server/handlers/reportUpdate.js'

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'update') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleReportUpdate(req, res)
    return
  }
  notFound(res)
}
