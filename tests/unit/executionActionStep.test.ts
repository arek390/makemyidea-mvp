import { describe, expect, it } from 'vitest'
import { sanitizeExecutionActionStep } from '../../src/lib/server/handlers/reportUpdate.js'

describe('sanitizeExecutionActionStep', () => {
  it('strips leaked English meta-prefixes in Polish', () => {
    expect(sanitizeExecutionActionStep('Define zaprojektuj mechanizm blokady', 'pl')).toBe(
      'Zaprojektuj mechanizm blokady'
    )
    expect(sanitizeExecutionActionStep('Design zaprojektuj kolorową skalę', 'pl')).toBe(
      'Zaprojektuj kolorową skalę'
    )
  })

  it('does not introduce "Define" for Polish', () => {
    const step = sanitizeExecutionActionStep('define dobierz materiały', 'pl')
    expect(/^define\s+/i.test(step)).toBe(false)
  })
})

