import { describe, expect, it } from 'vitest'
import { cellKey, mapEntryToCell, pickGravityTarget } from '../../src/engineDebug/matrixHeuristics'

describe('matrixHeuristics', () => {
  it('maps "funkcja musialaby" to Produkt × Jak powinno być', () => {
    const result = mapEntryToCell('funkcja musialaby cos poprawic')
    expect(result.row).toBe('product')
    expect(result.col).toBe('should_be')
  })

  it('handles diacritics in should-be column', () => {
    const result = mapEntryToCell('Funkcja musiałaby być szybsza')
    expect(result.row).toBe('product')
    expect(result.col).toBe('should_be')
  })

  it('handles should-be inflections', () => {
    const result = mapEntryToCell('Powinny byc testy')
    expect(result.col).toBe('should_be')
  })

  it('picks gravity target from empty neighbor first', () => {
    const counts = {
      [cellKey('world', 'as_is')]: 2,
      [cellKey('elements', 'as_is')]: 0,
      [cellKey('product', 'not_working')]: 1,
      [cellKey('product', 'should_be')]: 5,
    }
    const target = pickGravityTarget({ row: 'product', col: 'as_is' }, counts)
    expect(target.targetCell).toEqual({ row: 'elements', col: 'as_is' })
    expect(target.reason).toBe('empty')
  })

  it('picks lowest-count neighbor when none empty', () => {
    const counts = {
      [cellKey('world', 'as_is')]: 2,
      [cellKey('elements', 'as_is')]: 4,
      [cellKey('product', 'not_working')]: 1,
      [cellKey('product', 'should_be')]: 3,
    }
    const target = pickGravityTarget({ row: 'product', col: 'as_is' }, counts)
    expect(target.targetCell).toEqual({ row: 'product', col: 'not_working' })
    expect(target.reason).toBe('lowest_count')
  })
})
