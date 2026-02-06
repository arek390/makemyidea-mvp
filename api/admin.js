import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import {
  handleAdminBillingList,
  handleAdminBillingTopup,
  handleAdminReportList,
} from '../src/lib/server/handlers/admin.js'

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'billing_list') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminBillingList(req, res)
    return
  }
  if (action === 'billing_topup') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleAdminBillingTopup(req, res)
    return
  }
  if (action === 'report_list') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminReportList(req, res)
    return
  }
  notFound(res)
}
