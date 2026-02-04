import { handle as handleSelftest } from './_handlers/selftest.js'
import { handle as handleSession } from './_handlers/session.js'
import { handle as handleSessions } from './_handlers/sessions.js'

const resolveRoutePart = (route) => (Array.isArray(route) ? route[0] : route)

export default async function handler(req, res) {
  const part = resolveRoutePart(req.query?.route)
  switch (part) {
    case 'selftest':
      await handleSelftest(req, res)
      return
    case 'session':
      await handleSession(req, res)
      return
    case 'sessions':
      await handleSessions(req, res)
      return
    default:
      res.status(404).json({ ok: false, error: 'NOT_FOUND' })
  }
}
