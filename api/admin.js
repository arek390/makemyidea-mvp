import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import {
  handleAdminBillingList,
  handleAdminBillingReset,
  handleAdminBillingTopup,
  handleAdminReportList,
  handleAdminCheck,
  handleAdminDebug,
  handleAdminAuthProbe,
  handleAdminPricingSync,
  handleAdminWhoAmI,
} from '../src/lib/server/handlers/admin.js'

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'admin.billing.list') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminBillingList(req, res)
    return
  }
  if (action === 'admin.billing.topup') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleAdminBillingTopup(req, res)
    return
  }
  if (action === 'admin.billing.reset') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleAdminBillingReset(req, res)
    return
  }
  if (action === 'admin.report.list') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminReportList(req, res)
    return
  }
  if (action === 'admin.whoami') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminWhoAmI(req, res)
    return
  }
  if (action === 'admin.check') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminCheck(req, res)
    return
  }
  if (action === 'admin.debug') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminDebug(req, res)
    return
  }
  if (action === 'admin.pricing.sync') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleAdminPricingSync(req, res)
    return
  }
  if (action === 'admin.auth_probe') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    await handleAdminAuthProbe(req, res)
    return
  }
  notFound(res)
}
