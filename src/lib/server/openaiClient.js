const OPENAI_BASE_URL = 'https://api.openai.com/v1'

const toSafeCauseField = (value) => {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text.slice(0, 400) : null
}

export const buildSafeOpenAiCauseDiagnostic = (error) => {
  const cause = error?.cause
  if (!cause || typeof cause !== 'object') return null
  return {
    name: toSafeCauseField(cause?.name),
    code: toSafeCauseField(cause?.code),
    errno: toSafeCauseField(cause?.errno),
    syscall: toSafeCauseField(cause?.syscall),
    hostname: toSafeCauseField(cause?.hostname),
    message: toSafeCauseField(cause?.message),
  }
}

export const buildSafeOpenAiErrorDiagnostic = (error) => ({
  name: toSafeCauseField(error?.name),
  code: toSafeCauseField(error?.code),
  status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
  message: toSafeCauseField(error?.message || error),
  cause: buildSafeOpenAiCauseDiagnostic(error),
})

export const runOpenAiConnectionDiagnostic = async ({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
  timeoutMs = 10_000,
} = {}) => {
  try {
    await callOpenAIChat({
      apiKey,
      model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxTokens: 8,
      temperature: 0,
      timeoutMs,
    })
    return {
      ok: true,
      model,
      status: 'ok',
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      model,
      status: toSafeCauseField(error?.code || error?.message) || 'error',
      diagnostic: buildSafeOpenAiErrorDiagnostic(error),
    }
  }
}

export const callOpenAIChat = async ({
  model,
  messages,
  maxTokens = 800,
  temperature = 0.7,
  timeoutMs = 18_000,
  apiKey = process.env.OPENAI_API_KEY,
  responseFormat = null,
  onProviderEvent = null,
}) => {
  if (!apiKey) {
    const error = new Error('OPENAI_KEY_MISSING')
    error.code = 'OPENAI_KEY_MISSING'
    throw error
  }

  const controller = new AbortController()
  let abortReason = null
  let providerCallAbortedAt = null
  const responseFormatName = responseFormat?.json_schema?.name || responseFormat?.type || null
  const body = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  })
  const emit = (event) => {
    if (typeof onProviderEvent !== 'function') return
    try { onProviderEvent(event) } catch { /* diagnostic hooks must not affect provider calls */ }
  }
  const timeout = setTimeout(() => {
    abortReason = 'timeout'
    providerCallAbortedAt = new Date().toISOString()
    emit({
      type: 'aborted',
      providerCallAbortedAt,
      abortReason,
      timeoutSource: 'callOpenAIChat.setTimeout',
      timeoutMs,
      model,
      responseFormatName,
    })
    controller.abort()
  }, timeoutMs)
  const startedAt = Date.now()
  const providerCallStartedAt = new Date(startedAt).toISOString()
  emit({
    type: 'started',
    providerCallStartedAt,
    model,
    timeoutMs,
    endpoint: '/chat/completions',
    responseFormatName,
    requestBodyBytes: Buffer.byteLength(body, 'utf8'),
  })
  try {
    let response
    try {
      response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('OPENAI_REQUEST_TIMEOUT', { cause: error })
        timeoutError.code = 'OPENAI_REQUEST_TIMEOUT'
        timeoutError.causeType = error?.name || null
        timeoutError.providerDiagnostics = {
          providerCallStartedAt,
          providerCallResolvedAt: null,
          providerCallAbortedAt: providerCallAbortedAt || new Date().toISOString(),
          abortReason: abortReason || 'abort_error',
          timeoutSource: abortReason === 'timeout' ? 'callOpenAIChat.setTimeout' : 'fetch_abort',
          timeoutMs,
          model,
          responseFormatName,
          providerRequestId: null,
        }
        console.warn('[openai][request_timeout]', buildSafeOpenAiErrorDiagnostic(timeoutError))
        throw timeoutError
      }
      const rootCause = error?.cause && typeof error.cause === 'object' ? error.cause : error
      const transportError = new Error('OPENAI_TRANSPORT_ERROR', { cause: rootCause })
      transportError.code = 'OPENAI_TRANSPORT_ERROR'
      transportError.causeType = error?.name || null
      transportError.detail = error?.message || null
      transportError.providerDiagnostics = {
        providerCallStartedAt,
        providerCallResolvedAt: null,
        providerCallAbortedAt: null,
        abortReason: null,
        timeoutSource: null,
        timeoutMs,
        model,
        responseFormatName,
        providerRequestId: null,
      }
      console.warn('[openai][transport_error]', buildSafeOpenAiErrorDiagnostic(transportError))
      throw transportError
    }
    const providerRequestId = response.headers?.get?.('x-request-id') || null
    emit({
      type: 'resolved',
      providerCallResolvedAt: new Date().toISOString(),
      providerRequestId,
      status: response.status,
      model,
      responseFormatName,
    })

    if (!response.ok) {
      const errorText = await response.text()
      const error = new Error(`OPENAI_REQUEST_FAILED:${response.status}`)
      error.code = 'OPENAI_REQUEST_FAILED'
      error.status = response.status
      error.detail = errorText
      error.providerRequestId = providerRequestId
      error.providerDiagnostics = {
        providerCallStartedAt,
        providerCallResolvedAt: new Date().toISOString(),
        providerCallAbortedAt: null,
        abortReason: null,
        timeoutSource: null,
        timeoutMs,
        model,
        responseFormatName,
        providerRequestId,
      }
      console.warn('[openai][http_error]', buildSafeOpenAiErrorDiagnostic(error))
      throw error
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      const error = new Error('OPENAI_EMPTY_RESPONSE')
      error.code = 'OPENAI_EMPTY_RESPONSE'
      error.providerRequestId = providerRequestId || data?.id || null
      error.providerDiagnostics = {
        providerCallStartedAt,
        providerCallResolvedAt: new Date().toISOString(),
        providerCallAbortedAt: null,
        abortReason: null,
        timeoutSource: null,
        timeoutMs,
        model,
        responseFormatName,
        providerRequestId: error.providerRequestId,
      }
      throw error
    }

    return {
      content: content.trim(),
      usage: data?.usage,
      providerRequestId: providerRequestId || data?.id || null,
      latencyMs: Date.now() - startedAt,
      providerDiagnostics: {
        providerCallStartedAt,
        providerCallResolvedAt: new Date().toISOString(),
        providerCallAbortedAt: null,
        abortReason: null,
        timeoutSource: null,
        timeoutMs,
        model,
        responseFormatName,
        providerRequestId: providerRequestId || data?.id || null,
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}
