import { describe, expect, it } from 'vitest'
import { classifyLlmErrorCategory } from '../../llm/llmRouter.mjs'

describe('classifyLlmErrorCategory', () => {
  it('classifies transport failures separately from parse and generic LLM errors', () => {
    const transportError = Object.assign(new Error('OPENAI_TRANSPORT_ERROR'), { code: 'OPENAI_TRANSPORT_ERROR' })
    const timeoutError = Object.assign(new Error('OPENAI_REQUEST_TIMEOUT'), { code: 'OPENAI_REQUEST_TIMEOUT' })
    const httpError = Object.assign(new Error('OPENAI_REQUEST_FAILED:503'), { code: 'OPENAI_REQUEST_FAILED', status: 503 })
    const parseError = new Error('Invalid model response.')

    expect(classifyLlmErrorCategory(transportError)).toBe('TRANSPORT_ERROR')
    expect(classifyLlmErrorCategory(timeoutError)).toBe('TIMEOUT')
    expect(classifyLlmErrorCategory(httpError)).toBe('API_HTTP_ERROR')
    expect(classifyLlmErrorCategory(parseError)).toBe('PARSE_ERROR')
    expect(classifyLlmErrorCategory(new Error('Unexpected failure'))).toBe('LLM_ERROR')
  })
})
