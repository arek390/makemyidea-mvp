import { describe, expect, it } from 'vitest'
import { buildKnowledgeSummary } from '../../src/engine2/conversationGuide.js'
import { createEngine2FindingState, engine2FindingReducer, type Engine2Finding } from '../../src/engine2/findingState.js'
import { resolveEngine2ContinueGate } from '../../src/engine2/packageState.js'

const proposal = (id: string): Engine2Finding => ({
  id,
  category: 'constraint',
  categoryLabel: 'Proponowane ograniczenie',
  content: `Ustalenie ${id}`,
  status: 'pending',
  source: 'ai_interpretation',
  fingerprint: `fp-${id}`,
  packageId: 'package-1',
  internal: {
    matrixRow: 'product',
    matrixCol: 'not_working',
    matrixCell: 'B2',
    confidence: 0.9,
  },
})

describe('engine2 package continue gate', () => {
  it('waits until all proposals from the active package are loaded and resolved, then exposes them in knowledge', () => {
    const expectedProposalCount = 3
    const stateAfterAnalyze = engine2FindingReducer(createEngine2FindingState(), {
      type: 'addProposedBatch',
      findings: [proposal('finding-1'), proposal('finding-2'), proposal('finding-3')],
    })

    expect(stateAfterAnalyze.findings).toHaveLength(3)
    expect(stateAfterAnalyze.findings.every((finding) => finding.status === 'pending')).toBe(true)

    const gateBeforeDecisions = resolveEngine2ContinueGate({
      findings: stateAfterAnalyze.findings,
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: expectedProposalCount,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gateBeforeDecisions.allowed).toBe(false)
    expect(gateBeforeDecisions.reason).toBe('PACKAGE_STILL_PENDING')
    expect(gateBeforeDecisions.stats.packageProposalCount).toBe(3)
    expect(gateBeforeDecisions.stats.packagePendingCount).toBe(3)

    const stateAfterTwoDecisions = {
      ...stateAfterAnalyze,
      findings: stateAfterAnalyze.findings.map((finding) =>
        finding.id === 'finding-1'
          ? { ...finding, status: 'confirmed' as const, decisionSource: 'user_accept' as const, decisionAt: '2026-08-22T15:00:00.000Z' }
          : finding.id === 'finding-2'
            ? { ...finding, status: 'rejected' as const, decisionSource: 'user_reject' as const, decisionAt: '2026-08-22T15:00:01.000Z' }
            : finding
      ),
    }

    const gateAfterTwoDecisions = resolveEngine2ContinueGate({
      findings: stateAfterTwoDecisions.findings,
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: expectedProposalCount,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gateAfterTwoDecisions.allowed).toBe(false)
    expect(gateAfterTwoDecisions.reason).toBe('PACKAGE_STILL_PENDING')
    expect(gateAfterTwoDecisions.stats.packageResolvedCount).toBe(2)
    expect(gateAfterTwoDecisions.stats.packagePendingCount).toBe(1)

    const finalState = {
      ...stateAfterTwoDecisions,
      findings: stateAfterTwoDecisions.findings.map((finding) =>
        finding.id === 'finding-3'
          ? {
              ...finding,
              content: 'Zmienione ustalenie finding-3',
              status: 'confirmed' as const,
              decisionSource: 'user_change' as const,
              decisionAt: '2026-08-22T15:00:02.000Z',
            }
          : finding
      ),
    }

    const gateAfterAllDecisions = resolveEngine2ContinueGate({
      findings: finalState.findings,
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: expectedProposalCount,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gateAfterAllDecisions.allowed).toBe(true)
    expect(gateAfterAllDecisions.reason).toBe('READY')
    expect(gateAfterAllDecisions.stats.packageResolvedCount).toBe(3)
    expect(gateAfterAllDecisions.stats.packagePendingCount).toBe(0)

    expect(buildKnowledgeSummary(finalState.findings, 10).map((entry) => entry.text)).toEqual([
      'Ustalenie finding-1',
      'Zmienione ustalenie finding-3',
    ])
  })

  it('blocks continuation while the active package id exists but findings have not hydrated yet', () => {
    const gate = resolveEngine2ContinueGate({
      findings: [],
      pendingPackageId: 'package-1',
      pendingPackageExpectedCount: 3,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gate.allowed).toBe(false)
    expect(gate.reason).toBe('PACKAGE_HAS_NO_PROPOSALS')
    expect(gate.stats.packageProposalCount).toBe(0)
  })

  it('allows continuation from pendingDecisionPackageId when pendingPackageId has not hydrated yet', () => {
    const resolved = [
      { ...proposal('finding-1'), status: 'confirmed' as const, decisionSource: 'user_accept' as const },
      { ...proposal('finding-2'), status: 'rejected' as const, decisionSource: 'user_reject' as const },
    ]
    const gate = resolveEngine2ContinueGate({
      findings: resolved,
      pendingPackageId: null,
      pendingDecisionPackageId: 'package-1',
      pendingPackageExpectedCount: 0,
      continuing: false,
      loading: false,
      currentContinuationPackageId: null,
    })

    expect(gate.allowed).toBe(true)
    expect(gate.reason).toBe('READY')
    expect(gate.stats.expectedProposalCount).toBe(2)
    expect(gate.stats.packageResolvedCount).toBe(2)
  })
})
