import { describe, expect, it } from 'vitest'
import { ENGINE2_CONTRADICTION_DETECTION_RESPONSE_FORMAT } from '../../src/lib/server/engine2ContradictionDetector.js'
import { ENGINE2_PANEL_QUESTION_RESPONSE_FORMAT } from '../../src/lib/server/engine2PanelQuestionGenerator.js'
import { ENGINE2_READINESS_RESPONSE_FORMAT } from '../../src/lib/server/engine2ReadinessEvaluator.js'
import { ENGINE2_TURN_RESPONSE_FORMAT } from '../../src/lib/server/engine2LlmTurnPlanner.js'

const responseFormats = [
  ENGINE2_TURN_RESPONSE_FORMAT,
  ENGINE2_CONTRADICTION_DETECTION_RESPONSE_FORMAT,
  ENGINE2_READINESS_RESPONSE_FORMAT,
  ENGINE2_PANEL_QUESTION_RESPONSE_FORMAT,
]

const collectStrictObjectRequiredErrors = (
  schema: Record<string, any>,
  path = 'schema',
  errors: string[] = [],
) => {
  if (!schema || typeof schema !== 'object') return errors
  if (schema.type === 'object' && schema.additionalProperties === false && schema.properties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    for (const key of Object.keys(schema.properties)) {
      if (!required.has(key)) errors.push(`${path}.required missing ${key}`)
    }
  }
  for (const key of ['properties', '$defs', 'definitions'] as const) {
    const children = schema[key]
    if (children && typeof children === 'object') {
      for (const [childKey, childSchema] of Object.entries(children)) {
        collectStrictObjectRequiredErrors(childSchema as Record<string, any>, `${path}.${key}.${childKey}`, errors)
      }
    }
  }
  if (schema.items) collectStrictObjectRequiredErrors(schema.items, `${path}.items`, errors)
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(schema[key])) {
      schema[key].forEach((child: Record<string, any>, index: number) => {
        collectStrictObjectRequiredErrors(child, `${path}.${key}[${index}]`, errors)
      })
    }
  }
  return errors
}

describe('Engine 2 strict response format schemas', () => {
  it('require every property on strict objects accepted by OpenAI response_format', () => {
    const errors = responseFormats.flatMap((format) => {
      const schema = format.json_schema.schema
      const name = format.json_schema.name
      return collectStrictObjectRequiredErrors(schema).map((error) => `${name}: ${error}`)
    })
    expect(errors).toEqual([])
  })
})
