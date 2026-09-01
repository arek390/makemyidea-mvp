import type { Engine2Finding } from './findingState'

export type Engine2PackageContinueReason =
  | 'NO_PENDING_PACKAGE'
  | 'PACKAGE_NOT_HYDRATED'
  | 'PACKAGE_HAS_NO_PROPOSALS'
  | 'PACKAGE_STILL_PENDING'
  | 'CONTINUE_ALREADY_STARTED'
  | 'READY'

export type Engine2PackageStats = {
  packageId: string | null
  expectedProposalCount: number
  packageFindings: Engine2Finding[]
  packageProposalCount: number
  packagePendingCount: number
  packageResolvedCount: number
  isHydrated: boolean
}

export const resolveEngine2PackageStats = ({
  findings,
  pendingPackageId,
  pendingDecisionPackageId = null,
  pendingPackageExpectedCount,
}: {
  findings: Engine2Finding[]
  pendingPackageId: string | null
  pendingDecisionPackageId?: string | null
  pendingPackageExpectedCount: number
}): Engine2PackageStats => {
  const packageId =
    (typeof pendingPackageId === 'string' && pendingPackageId) ||
    (typeof pendingDecisionPackageId === 'string' && pendingDecisionPackageId) ||
    null
  const packageFindings = packageId
    ? findings.filter((finding) => finding.packageId === packageId)
    : []
  const packageProposalCount = packageFindings.length
  const explicitExpectedProposalCount = Math.max(0, Math.trunc(Number(pendingPackageExpectedCount) || 0))
  const expectedProposalCount = explicitExpectedProposalCount || packageProposalCount
  const hasExplicitDecision = (finding: Engine2Finding) =>
    ['confirmed', 'rejected'].includes(finding.status) &&
    ['user_accept', 'user_change', 'user_reject'].includes(String(finding.decisionSource || ''))
  const packageResolvedCount = packageFindings.filter(hasExplicitDecision).length
  const packagePendingCount = packageFindings.length - packageResolvedCount
  const isHydrated =
    !packageId ? false : expectedProposalCount > 0 && packageProposalCount >= expectedProposalCount

  return {
    packageId,
    expectedProposalCount,
    packageFindings,
    packageProposalCount,
    packagePendingCount,
    packageResolvedCount,
    isHydrated,
  }
}

export const resolveEngine2ContinueGate = ({
  findings,
  pendingPackageId,
  pendingDecisionPackageId = null,
  pendingPackageExpectedCount,
  continuing,
  loading,
  currentContinuationPackageId,
}: {
  findings: Engine2Finding[]
  pendingPackageId: string | null
  pendingDecisionPackageId?: string | null
  pendingPackageExpectedCount: number
  continuing: boolean
  loading: boolean
  currentContinuationPackageId: string | null
}) => {
  const stats = resolveEngine2PackageStats({
    findings,
    pendingPackageId,
    pendingDecisionPackageId,
    pendingPackageExpectedCount,
  })

  if (!stats.packageId) {
    return { allowed: false, reason: 'NO_PENDING_PACKAGE' as Engine2PackageContinueReason, stats }
  }
  if (continuing || loading || currentContinuationPackageId === stats.packageId) {
    return { allowed: false, reason: 'CONTINUE_ALREADY_STARTED' as Engine2PackageContinueReason, stats }
  }
  if (stats.expectedProposalCount <= 0 || stats.packageProposalCount <= 0) {
    return { allowed: false, reason: 'PACKAGE_HAS_NO_PROPOSALS' as Engine2PackageContinueReason, stats }
  }
  if (!stats.isHydrated) {
    return { allowed: false, reason: 'PACKAGE_NOT_HYDRATED' as Engine2PackageContinueReason, stats }
  }
  if (stats.packagePendingCount > 0 || stats.packageResolvedCount < stats.expectedProposalCount) {
    return { allowed: false, reason: 'PACKAGE_STILL_PENDING' as Engine2PackageContinueReason, stats }
  }

  return { allowed: true, reason: 'READY' as Engine2PackageContinueReason, stats }
}
