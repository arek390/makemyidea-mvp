import { describe, expect, it } from 'vitest'
import { validatePolishedActionPlan } from '../../src/lib/server/handlers/reportUpdate.js'

describe('validatePolishedActionPlan', () => {
  const original = [
    {
      step: 'Zaprojektuj mechanizm blokady segmentów',
      status: 'in_progress',
      details: 'Uwzględnij obsługę jedną ręką.',
      technology_options: ['zatrzask sprężynowy'],
      done_when: 'Szkic mechanizmu i ryzyka są gotowe.',
      source_type: 'triz',
      source_ref: 'triz:0:1',
      derived_from_user_choice: true,
    },
    {
      step: 'Zbuduj prototyp blokady segmentów',
      status: 'pending',
      details: 'Wykonaj prototyp w skali 1:1.',
      technology_options: ['druk 3D'],
      done_when: 'Prototyp działa i da się go testować.',
      source_type: 'triz',
      source_ref: 'triz:0:1',
      derived_from_user_choice: true,
    },
  ]

  it('rejects wrong length', () => {
    const candidate = [
      {
        step: 'Zaprojektuj mechanizm blokady segmentów',
        status: 'in_progress',
        details: 'Uwzględnij obsługę jedną ręką.',
        technology_options: ['zatrzask sprężynowy'],
        done_when: 'Szkic mechanizmu i ryzyka są gotowe.',
      },
    ]
    expect(validatePolishedActionPlan(original, candidate, 'pl').ok).toBe(false)
  })

  it('rejects status changes', () => {
    const candidate = original.map((x) => ({
      step: x.step,
      status: x.status === 'in_progress' ? 'pending' : x.status,
      details: x.details,
      technology_options: x.technology_options,
      done_when: x.done_when,
    }))
    const res = validatePolishedActionPlan(original, candidate, 'pl')
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => String(e).startsWith('status_changed:'))).toBe(true)
  })

  it('accepts a valid copy-only polish', () => {
    const candidate = [
      {
        step: 'Zaprojektuj mechanizm blokady segmentów',
        status: 'in_progress',
        details: 'Zadbaj o obsługę jedną ręką i stabilność po zablokowaniu.',
        technology_options: ['zatrzask sprężynowy'],
        done_when: 'Szkic mechanizmu z punktami ryzyka jest gotowy.',
      },
      {
        step: 'Zbuduj prototyp blokady segmentów',
        status: 'pending',
        details: 'Wykonaj prototyp 1:1 do testów użytkowych.',
        technology_options: ['druk 3D'],
        done_when: 'Prototyp jest zmontowany i gotowy do serii testów.',
      },
    ]
    expect(validatePolishedActionPlan(original, candidate, 'pl')).toEqual({ ok: true, errors: [] })
  })
})

