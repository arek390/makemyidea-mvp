const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export const callOpenAIChat = async ({
  model,
  messages,
  maxTokens = 800,
  temperature = 0.7,
  timeoutMs = 18_000,
  apiKey = process.env.OPENAI_API_KEY,
}) => {
  if (!apiKey) {
    const error = new Error('OPENAI_KEY_MISSING')
    error.code = 'OPENAI_KEY_MISSING'
    throw error
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      const error = new Error(`OPENAI_REQUEST_FAILED:${response.status}`)
      error.code = 'OPENAI_REQUEST_FAILED'
      error.detail = errorText
      throw error
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      const error = new Error('OPENAI_EMPTY_RESPONSE')
      error.code = 'OPENAI_EMPTY_RESPONSE'
      throw error
    }

    return { content: content.trim(), usage: data?.usage }
  } finally {
    clearTimeout(timeout)
  }
}
