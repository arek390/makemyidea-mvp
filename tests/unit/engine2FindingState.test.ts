import { describe, expect, it } from 'vitest'
import {
  createEngine2FindingState,
  engine2FindingReducer,
  type Engine2Finding,
} from '../../src/engine2/findingState.js'

const proposedFinding: Engine2Finding = {
  id: 'finding-1',
  category: 'goal',
  categoryLabel: 'Proponowany cel',
  content: 'Uruchomić publiczny proces rozmowy.',
  status: 'pending',
  source: 'ai_interpretation',
  fingerprint: 'finding-fingerprint-1',
  sourceMessageIds: ['message-1'],
  internal: {
    matrixRow: 'product',
    matrixCol: 'should_be',
    matrixCell: 'B3',
    confidence: 0.82,
  },
  packageId: 'package-1',
}

describe('engine2FindingReducer', () => {
  it('frontend_does_not_confirm_optimistically', () => {
    const state = createEngine2FindingState([proposedFinding])

    const next = engine2FindingReducer(state, { type: 'confirm', id: proposedFinding.id })

    expect(next.findings[0]).toMatchObject({
      id: proposedFinding.id,
      status: 'pending',
      content: proposedFinding.content,
    })
  })

  it('enters edit mode with the current finding content', () => {
    const state = createEngine2FindingState([proposedFinding])

    const next = engine2FindingReducer(state, { type: 'startEdit', id: proposedFinding.id })

    expect(next.editingFindingId).toBe(proposedFinding.id)
    expect(next.editingContent).toBe(proposedFinding.content)
  })

  it('clears edit mode without changing the proposed finding before backend confirmation', () => {
    const editingState = engine2FindingReducer(
      createEngine2FindingState([proposedFinding]),
      { type: 'startEdit', id: proposedFinding.id },
    )
    const changedState = engine2FindingReducer(editingState, {
      type: 'changeEdit',
      content: 'Doprecyzować publiczny proces rozmowy.',
    })

    const next = engine2FindingReducer(changedState, { type: 'saveEdit' })

    expect(next.findings[0]).toMatchObject({
      content: proposedFinding.content,
      status: 'pending',
    })
    expect(next.editingFindingId).toBeNull()
    expect(next.editingContent).toBe('')
  })

  it('cancels editing without changing the proposed finding', () => {
    const editingState = engine2FindingReducer(
      createEngine2FindingState([proposedFinding]),
      { type: 'startEdit', id: proposedFinding.id },
    )
    const changedState = engine2FindingReducer(editingState, {
      type: 'changeEdit',
      content: 'Ta zmiana nie powinna zostać zapisana.',
    })

    const next = engine2FindingReducer(changedState, { type: 'cancelEdit' })

    expect(next.findings[0]).toEqual(proposedFinding)
    expect(next.editingFindingId).toBeNull()
    expect(next.editingContent).toBe('')
  })

  it('does not reject a proposed finding optimistically', () => {
    const state = createEngine2FindingState([proposedFinding])

    const next = engine2FindingReducer(state, { type: 'reject', id: proposedFinding.id })

    expect(next.findings[0]).toMatchObject({
      id: proposedFinding.id,
      status: 'pending',
      fingerprint: 'finding-fingerprint-1',
    })
  })

  it('adds a proposed package without confirming it', () => {
    const state = createEngine2FindingState()

    const next = engine2FindingReducer(state, {
      type: 'addProposedBatch',
      findings: [proposedFinding],
    })

    expect(next.findings).toHaveLength(1)
    expect(next.findings[0]).toMatchObject({
      status: 'pending',
      packageId: 'package-1',
    })
  })

  it('does not confirm all proposed findings optimistically', () => {
    const secondFinding: Engine2Finding = {
      ...proposedFinding,
      id: 'finding-2',
      fingerprint: 'finding-fingerprint-2',
    }
    const state = createEngine2FindingState([proposedFinding, secondFinding])

    const next = engine2FindingReducer(state, { type: 'confirmAll' })

    expect(next.findings.every((finding) => finding.status === 'pending')).toBe(true)
  })

  it('does not reject all proposed findings optimistically', () => {
    const secondFinding: Engine2Finding = {
      ...proposedFinding,
      id: 'finding-2',
      fingerprint: 'finding-fingerprint-2',
    }
    const state = createEngine2FindingState([proposedFinding, secondFinding])

    const next = engine2FindingReducer(state, { type: 'rejectAll' })

    expect(next.findings.every((finding) => finding.status === 'pending')).toBe(true)
  })

  it('allows a backend-confirmed finding to enter edit mode without local confirmation', () => {
    const confirmedState = createEngine2FindingState([{
      ...proposedFinding,
      status: 'confirmed',
      decisionSource: 'user_accept',
      decisionAt: '2026-08-22T15:00:00.000Z',
    }])
    const editingState = engine2FindingReducer(confirmedState, {
      type: 'startEdit',
      id: proposedFinding.id,
    })
    const changedState = engine2FindingReducer(editingState, {
      type: 'changeEdit',
      content: 'Zaktualizowana potwierdzona informacja.',
    })

    const next = engine2FindingReducer(changedState, { type: 'saveEdit' })

    expect(next.findings[0]).toMatchObject({
      content: proposedFinding.content,
      status: 'confirmed',
      decisionSource: 'user_accept',
    })
  })
})
