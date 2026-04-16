import { describe, expect, it } from 'vitest'
import { resolveReportLang } from '../../src/lib/server/handlers/reportUpdate.js'

describe('resolveReportLang', () => {
  it('prefers explicitly requested language over existing report language', () => {
    expect(resolveReportLang('pl', 'en', 'pl')).toBe('en')
    expect(resolveReportLang('en', 'pl', 'pl')).toBe('pl')
  })

  it('falls back to existing report language when request is missing', () => {
    expect(resolveReportLang('pl', null, 'pl')).toBe('pl')
    expect(resolveReportLang('en', null, 'pl')).toBe('en')
  })

  it('uses fallback when neither requested nor existing language is valid', () => {
    expect(resolveReportLang('unknown', null, 'pl')).toBe('pl')
    expect(resolveReportLang(null, null, 'pl')).toBe('pl')
  })
})

