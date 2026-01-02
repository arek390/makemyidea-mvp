import http from 'node:http'
import { URL } from 'node:url'

const PORT = Number(process.env.PORT || 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(JSON.stringify(payload))
}

const readJsonBody = async (req) => {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

const callOpenAI = async (messages, maxTokens = 800) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI error: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Missing content from OpenAI')
  }
  return content.trim()
}

const normalizeLanguage = (language) => {
  if (!language) return 'English'
  return language === 'Swiss' ? 'German' : language
}

const parseJsonArray = (value) => {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
  } catch {
    return null
  }
  return null
}

const containsPolishChars = (value) => /[ąćęłńóśżź]/i.test(value)

const translateList = async (items, language) => {
  const messages = [
    {
      role: 'system',
      content: `Translate the provided list into ${language}. Return only a JSON array of strings.`,
    },
    {
      role: 'user',
      content: `Translate this JSON array into ${language}. Output ONLY a JSON array of strings.\\n\\n${JSON.stringify(items)}`,
    },
  ]
  const content = await callOpenAI(messages, 400)
  const translated = parseJsonArray(content)
  if (!translated) throw new Error('Invalid translation response')
  return translated
}

const parseJsonObject = (value) => {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    return null
  }
  return null
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, hasKey: Boolean(OPENAI_API_KEY) })
    return
  }

  if (!OPENAI_API_KEY) {
    sendJson(res, 401, { error: 'OPENAI_API_KEY is not set on the server.' })
    return
  }

  if (url.pathname === '/api/generate-questions' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { productName, spaceDef, timeDef, count = 30 } = body
    if (!productName || !spaceDef || !timeDef) {
      sendJson(res, 400, { error: 'Missing productName, spaceDef, or timeDef.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content:
          'You generate focused, practical guiding questions. Return only JSON arrays of strings.',
      },
      {
        role: 'user',
        content: `Generate ${count} concise, insightful guiding questions for product "${productName}". The questions must reflect the intersection of space "${spaceDef}" and observation level "${timeDef}". Mix technical, business, user-need, trends, standards, connectivity, and price-vs-performance angles. Output ONLY a JSON array of strings, no extra text.`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 900)
      const questions = parseJsonArray(content)
      if (!questions) throw new Error('Invalid JSON array')
      sendJson(res, 200, { questions })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-names' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { description, count = 5 } = body
    if (!description) {
      sendJson(res, 400, { error: 'Missing description.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content:
          'You generate short, brandable product names. Return only JSON arrays of strings.',
      },
      {
        role: 'user',
        content: `Generate ${count} short, brandable product names (1-3 words) based on this description. Avoid punctuation. Output ONLY a JSON array of strings, no extra text.\\n\\nDescription:\\n${description}`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 300)
      const names = parseJsonArray(content)
      if (!names) throw new Error('Invalid JSON array')
      sendJson(res, 200, { names })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-ideas' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { productName, cells = [], ideasPerCell = 3 } = body
    if (!productName || !Array.isArray(cells) || !cells.length) {
      sendJson(res, 400, { error: 'Missing productName or cells.' })
      return
    }

    const promptCells = cells
      .map((cell) => `- ${cell.id}: space="${cell.spaceDef}", level="${cell.timeDef}"`)
      .join('\n')

    const messages = [
      {
        role: 'system',
        content:
          'You generate short, practical idea prompts. Return only JSON objects mapping cell ids to arrays of ideas.',
      },
      {
        role: 'user',
        content: `Generate ${ideasPerCell} concise ideas (max 50 words each) for each cell for product "${productName}". Each idea must relate to both the space and observation level. Return ONLY a JSON object where keys are cell ids and values are arrays of ideas.\n\nCells:\n${promptCells}`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 1200)
      const ideas = parseJsonObject(content)
      if (!ideas) throw new Error('Invalid JSON object')
      sendJson(res, 200, { ideas })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-space-options' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const {
      productName,
      description = '',
      worldCount = 10,
      elementCount = 10,
      language = 'English',
    } = body
    const outputLanguage = normalizeLanguage(language)
    if (!productName) {
      sendJson(res, 400, { error: 'Missing productName.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content: `You generate concise option lists in ${outputLanguage}. Return ONLY a JSON object with arrays.`,
      },
      {
        role: 'user',
        content: `Product: "${productName}". Description: "${description}".\n\nTask:\n1) Generate ${worldCount} options for where this product can exist, be used, or be found (near context and broader context). These are for the "World" category.\n2) Generate ${elementCount} options describing components, materials, subassemblies, or parts the product can be made of. These are for the "Elements" category.\n\nRequirements:\n- Write ONLY in ${outputLanguage}.\n- Each option 1-6 words.\n- Return ONLY a JSON object: {"worldOptions":[...],"elementOptions":[...]}\n- No extra text.`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 400)
      const parsed = parseJsonObject(content)
      if (!parsed || !Array.isArray(parsed.worldOptions) || !Array.isArray(parsed.elementOptions)) {
        throw new Error('Invalid JSON object')
      }
      sendJson(res, 200, {
        worldOptions: parsed.worldOptions,
        elementOptions: parsed.elementOptions,
      })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-time-options' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { productName, count = 15, language = 'English' } = body
    const outputLanguage = normalizeLanguage(language)
    if (!productName) {
      sendJson(res, 400, { error: 'Missing productName.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content:
          `You generate concise time/process/observation level options in ${outputLanguage}. Return only JSON arrays of strings.`,
      },
      {
        role: 'user',
        content: `Generate ${count} concise observation/time/process options (1-6 words) for product \"${productName}\". Write ONLY in ${outputLanguage}. Do not use any other language. Output ONLY a JSON array of strings, no extra text.`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 400)
      let options = parseJsonArray(content)
      if (!options) throw new Error('Invalid JSON array')
      options = await translateList(options, outputLanguage)
      sendJson(res, 200, { options })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`LLM server running on http://localhost:${PORT}`)
})
