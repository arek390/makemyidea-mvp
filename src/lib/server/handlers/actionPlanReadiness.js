import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { sendJson } from '../http.js'
import { runLlmTask, createRateLimiter } from '../../../../llm/llmRouter.mjs'
import { recordSessionAiUsageEvent } from '../aiCostEvents.js'

const limiter = createRateLimiter({ windowMs: 60_000, max: 20 })

const buildModels = () => ({
  // This handler uses `/v1/chat/completions` via `src/lib/server/openaiClient.js`,
  // so keep the defaults compatible with that endpoint.
  default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
  preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-4.1-mini',
  escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-4.1-mini',
})

const getBearerToken = (req) => {
  const authHeader =
    req?.headers?.authorization ||
    req?.headers?.Authorization ||
    (typeof req?.headers?.get === 'function' ? req.headers.get('authorization') : '') ||
    ''
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  return ''
}

const toText = (value, maxLen) => {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  if (typeof maxLen === 'number' && maxLen > 0 && trimmed.length > maxLen) {
    return `${trimmed.slice(0, maxLen)}…`
  }
  return trimmed
}

const normalizeLanguage = (value) => {
  const raw = String(value || '').toLowerCase().trim()
  return raw === 'en' ? 'en' : 'pl'
}

const normalizeItems = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const text = toText(item.text, 280)
      if (!text) return null
      const matrix_row = toText(item.matrix_row, 32) || null
      const matrix_col = toText(item.matrix_col, 32) || null
      return {
        text,
        ...(matrix_row ? { matrix_row } : {}),
        ...(matrix_col ? { matrix_col } : {}),
      }
    })
    .filter(Boolean)
    .slice(0, 15)
}

const buildPrompt = ({ language, items }) => {
  const entriesText = items
    .map((item, index) => {
      const meta = [item.matrix_row ? `row=${item.matrix_row}` : null, item.matrix_col ? `col=${item.matrix_col}` : null]
        .filter(Boolean)
        .join(', ')
      return `${index + 1}. ${item.text}${meta ? ` (${meta})` : ''}`
    })
    .join('\n')

  if (language === 'en') {
    return `User entries:\n${entriesText}\n\nTask:\nYou are evaluating whether the user's material is ready to produce a good action plan.\nGenerate THREE different short texts (each 1 sentence, max 2 short sentences):\n\n1) summary (diagnosis): What is the main current readiness state of the material?\n2) howToBoost (direction): What kind of material is missing to improve readiness?\n3) biggestBoostRightNow (one action): What ONE concrete thing should the user add next for the biggest immediate boost?\n\nReturn JSON only (no markdown):\n{\n  \"summary\": \"...\",\n  \"howToBoost\": \"...\",\n  \"biggestBoostRightNow\": \"...\",\n  \"qualityLevel\": \"low | medium | high\",\n  \"insights\": [\"optional, max 3\"],\n  \"improvements\": [\"optional, max 3\"],\n  \"nextBestAction\": \"optional\"\n}\n\nRules:\n- Keep the three fields stylistically distinct (not paraphrases)\n- Be specific; avoid vague phrases like \"improve clarity\"\n- Assess the material, not the person\n- No generic advice like \"add more details\"\n- No markdown`
  }

  return `Wpisy użytkownika:\n${entriesText}\n\nZadanie:\nOceniasz, czy materiał jest gotowy do stworzenia dobrego planu działania.\nWygeneruj TRZY różne krótkie teksty (każdy 1 zdanie, maks. 2 krótkie zdania):\n\n1) summary (diagnoza): Jaki jest dziś główny stan gotowości materiału?\n2) howToBoost (kierunek): Jakiego rodzaju materiału brakuje, żeby podnieść gotowość?\n3) biggestBoostRightNow (jedna akcja): Jaka JEDNA konkretna rzecz da teraz największy wzrost?\n\nZwróć wyłącznie JSON (bez markdown):\n{\n  \"summary\": \"...\",\n  \"howToBoost\": \"...\",\n  \"biggestBoostRightNow\": \"...\",\n  \"qualityLevel\": \"low | medium | high\",\n  \"insights\": [\"opcjonalne, max 3\"],\n  \"improvements\": [\"opcjonalne, max 3\"],\n  \"nextBestAction\": \"opcjonalne\"\n}\n\nZasady:\n- 3 pola muszą być stylistycznie różne (nie parafrazy)\n- Konkretnie; unikaj ogólników typu \"popraw klarowność\"\n- Oceniaj materiał, nie osobę\n- Bez ogólnej porady typu \"dodaj więcej szczegółów\"\n- Bez markdown`
}

const extractJsonCandidate = (raw) => {
  const text = typeof raw === 'string' ? raw : String(raw ?? '')
  if (!text.trim()) return ''

  // 1) ```json ... ``` fenced block
  const fence = text.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fence?.[1]) return fence[1].trim()

  // 2) Any fenced block (fallback)
  const anyFence = text.match(/```\s*([\s\S]*?)\s*```/i)
  if (anyFence?.[1]) return anyFence[1].trim()

  // 3) Mixed text + JSON: slice from first "{" to last "}"
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim()

  return text.trim()
}

const tryParseJson = (raw) => {
  const candidate = extractJsonCandidate(raw)
  if (!candidate) return { ok: false, data: null, attempted: '' }

  const attempts = [
    candidate,
    candidate.trim(),
    // Remove trailing commas before } or ]
    candidate.replace(/,\s*([}\]])/g, '$1').trim(),
  ]

  for (const attempted of attempts) {
    try {
      return { ok: true, data: JSON.parse(attempted), attempted }
    } catch {
      // continue
    }
  }

  return { ok: false, data: null, attempted: attempts[attempts.length - 1] || candidate }
}

const normalizeResult = (value) => {
  const obj = value && typeof value === 'object' ? value : null
  const qualityLevel =
    obj?.qualityLevel === 'high' || obj?.qualityLevel === 'medium' || obj?.qualityLevel === 'low'
      ? obj.qualityLevel
      : 'medium'
  const summary = toText(obj?.summary, 220)
  const howToBoost = toText(obj?.howToBoost, 220)
  const biggestBoostRightNow = toText(obj?.biggestBoostRightNow, 220)
  const insights = Array.isArray(obj?.insights)
    ? obj.insights.map((x) => toText(x, 140)).filter(Boolean).slice(0, 3)
    : []
  const improvements = Array.isArray(obj?.improvements)
    ? obj.improvements.map((x) => toText(x, 140)).filter(Boolean).slice(0, 3)
    : []
  const nextBestAction = toText(obj?.nextBestAction, 160)
  return { summary, howToBoost, biggestBoostRightNow, qualityLevel, insights, improvements, nextBestAction }
}

const fallback = (ok) => ({
  ok: Boolean(ok),
  summary: '',
  howToBoost: '',
  biggestBoostRightNow: '',
  qualityLevel: 'medium',
  insights: [],
  improvements: [],
  nextBestAction: '',
})

let didTempBlockLog = false

export const handleActionPlanReadiness = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }

  // TEMP: hard block readiness operation at backend handler level (action/task name based).
  if (!didTempBlockLog) {
    didTempBlockLog = true
    console.log('[TEMP BLOCK] action-plan-readiness backend handler blocked')
  }
  sendJson(res, 200, { ok: true, disabled: true, source: 'temp_block_action_plan_readiness' })
  return

  try {
    const requestId =
      (typeof req?.headers?.get === 'function' ? req.headers.get('x-request-id') : null) ||
      req?.headers?.['x-request-id'] ||
      req?.headers?.['x-vercel-id'] ||
      `apr_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const sourceTask = 'action-plan-readiness'
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const sessionId = toText(body.sessionId, 128)
    const language = normalizeLanguage(body.language)
    const items = normalizeItems(body.items)
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'SESSION_ID_REQUIRED' })
      return
    }

    const meaningfulCount = items.length
    if (meaningfulCount < 3) {
      sendJson(res, 200, {
        ok: true,
        summary: '',
        howToBoost: '',
        biggestBoostRightNow: '',
        qualityLevel: 'low',
        insights: [],
        improvements: [],
        nextBestAction: '',
      })
      return
    }

    const token = getBearerToken(req)
    if (!token) {
      sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
      return
    }

    const supabaseAdmin = getSupabaseAdmin()
    const authRes = await supabaseAdmin.auth.getUser(token)
    const userId = authRes?.data?.user?.id || null
    if (authRes?.error || !userId) {
      sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
      return
    }

    const sessionRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id,user_id')
      .eq('id', sessionId)
      .limit(1)
      .maybeSingle()
    if (sessionRes.error) {
      sendJson(res, 500, { ok: false, error: 'SESSION_LOOKUP_FAILED' })
      return
    }
    if (!sessionRes.data || String(sessionRes.data.user_id || '') !== String(userId)) {
      sendJson(res, 403, { ok: false, error: 'FORBIDDEN' })
      return
    }

    const prompt = buildPrompt({ language, items })
    const taskInstructions =
      language === 'en'
        ? 'Return ONLY valid JSON. No markdown. Required keys: summary, howToBoost, biggestBoostRightNow. Optional keys: qualityLevel, insights, improvements, nextBestAction. Keep the three required fields short (1 sentence, max 2 short sentences) and distinct.'
        : 'Zwróć WYŁĄCZNIE poprawny JSON. Bez markdown. Wymagane klucze: summary, howToBoost, biggestBoostRightNow. Opcjonalne: qualityLevel, insights, improvements, nextBestAction. 3 wymagane pola krótko (1 zdanie, max 2 krótkie zdania) i stylistycznie różnie.'

    const llmRes = await runLlmTask({
      apiKey: process.env.OPENAI_API_KEY,
      aiSupportEnabled: true,
      task: 'action-plan-readiness',
      input: prompt,
      sessionId,
      language: language === 'en' ? 'English' : 'Polish',
      taskInstructions,
      parseResponse: (value) => {
        const parsed = tryParseJson(value)
        if (!parsed.ok || !parsed.data || typeof parsed.data !== 'object') {
          return null
        }
        return normalizeResult(parsed.data)
      },
      fallbackData: null,
      models: buildModels(),
      maxOutputTokens: 260,
      rateLimiter: limiter,
      rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
    })

    if (llmRes?.meta) {
      await recordSessionAiUsageEvent(supabaseAdmin, {
        sessionId,
        reportId: null,
        userId,
        actionKey: null,
        sourceTask: 'action-plan-readiness',
        referenceId: null,
        meta: llmRes.meta,
      })
    }

    if (!llmRes?.ok || !llmRes.data) {
      sendJson(res, 200, fallback(false))
      return
    }

    sendJson(res, 200, { ok: true, ...llmRes.data })
  } catch {
    sendJson(res, 200, fallback(false))
  }
}
