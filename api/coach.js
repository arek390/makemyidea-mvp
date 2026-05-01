import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import { handleCoachSuggest } from '../src/lib/server/handlers/coachSuggest.js'
import { handleCoachGenerate } from '../src/lib/server/handlers/coachGenerate.js'
import { handleEngineNextQuestion } from '../src/lib/server/handlers/engineNextQuestion.js'
import { handleActionPlanReadiness } from '../src/lib/server/handlers/actionPlanReadiness.js'

const GENERATE_ACTIONS = new Set(['ideas', 'names', 'space-options', 'time-options'])

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'suggest') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleCoachSuggest(req, res)
    return
  }
  if (GENERATE_ACTIONS.has(action)) {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleCoachGenerate(req, res, action)
    return
  }
  if (action === 'next-question') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleEngineNextQuestion(req, res)
    return
  }
  if (action === 'action_plan_readiness') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    const requestId =
      (typeof req?.headers?.get === 'function' ? req.headers.get('x-request-id') : null) ||
      req?.headers?.['x-request-id'] ||
      null
    await handleActionPlanReadiness(req, res)
    return
  }
  notFound(res)
}
