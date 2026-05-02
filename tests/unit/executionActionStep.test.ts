import { describe, expect, it } from 'vitest'
import { rewriteNounPhraseActionStep, sanitizeExecutionActionStep } from '../../src/lib/server/handlers/reportUpdate.js'

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

  it('rewrites short noun-phrase titles into executable steps', () => {
    expect(rewriteNounPhraseActionStep('Mechanizm szybkiego zatrzasku', '', 'pl')).toBe(
      'Zaprojektuj mechanizm szybkiego zatrzasku'
    )
    expect(rewriteNounPhraseActionStep('Skala kolorowa lub graficzna', '', 'pl')).toBe(
      'Zaprojektuj skala kolorowa lub graficzna'
    )
    expect(rewriteNounPhraseActionStep('Materiały kompozytowe z włókien węglowych', '', 'pl')).toBe(
      'Dobierz materiały kompozytowe z włókien węglowych'
    )
  })
})
