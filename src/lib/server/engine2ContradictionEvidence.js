import { ENGINE2_OPEN_CONTRADICTION_STATUSES } from './engine2UserFacingText.js'

const text = (value, max = 0) => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return max ? normalized.slice(0, max) : normalized
}

const idArray = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((entry) => text(entry, 120))
  .filter(Boolean))]

const sourceMessageIdsFromFindings = (findingIds, findingById) => idArray(
  findingIds.flatMap((id) => findingById.get(id)?.sourceMessageIds || [])
)

export const normalizeEngine2ContradictionEvidence = (change = {}, context = {}) => {
  const findings = Array.isArray(context.findings) ? context.findings : []
  const findingById = new Map(findings.map((finding) => [finding?.id, finding]).filter(([id]) => id))
  const sourceFindingIds = idArray(change.sourceFindingIds || change.findingIds)
  const sourceMessageIds = idArray(change.sourceMessageIds || change.messageIds)
  const legacyCanSplit = sourceFindingIds.length >= 2
  const sideASourceFindingIds = idArray(change.sideASourceFindingIds || change.sideAFindingIds || change.sideASources?.findingIds)
  const sideBSourceFindingIds = idArray(change.sideBSourceFindingIds || change.sideBFindingIds || change.sideBSources?.findingIds)
  const resolvedSideAFindingIds = sideASourceFindingIds.length
    ? sideASourceFindingIds
    : legacyCanSplit ? [sourceFindingIds[0]] : []
  const resolvedSideBFindingIds = sideBSourceFindingIds.length
    ? sideBSourceFindingIds
    : legacyCanSplit ? [sourceFindingIds[1]] : []
  const sideASourceMessageIds = idArray(
    change.sideASourceMessageIds ||
    change.sideAMessageIds ||
    change.sideASources?.messageIds ||
    sourceMessageIdsFromFindings(resolvedSideAFindingIds, findingById)
  )
  const sideBSourceMessageIds = idArray(
    change.sideBSourceMessageIds ||
    change.sideBMessageIds ||
    change.sideBSources?.messageIds ||
    sourceMessageIdsFromFindings(resolvedSideBFindingIds, findingById)
  )
  const origin = ['user_requirements', 'matrix_hypothesis', 'heuristic'].includes(change.origin)
    ? change.origin
    : 'user_requirements'
  const hasSideAEvidence = resolvedSideAFindingIds.length > 0 || sideASourceMessageIds.length > 0
  const hasSideBEvidence = resolvedSideBFindingIds.length > 0 || sideBSourceMessageIds.length > 0
  const evidenceStatus = ['confirmed_requirement_tension', 'exploration_hypothesis', 'alternative_or_mode'].includes(change.evidenceStatus)
    ? change.evidenceStatus
    : hasSideAEvidence && hasSideBEvidence && origin === 'user_requirements'
      ? 'confirmed_requirement_tension'
      : origin === 'matrix_hypothesis' || origin === 'heuristic'
        ? 'exploration_hypothesis'
        : 'exploration_hypothesis'
  const activeLike = ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(change.status)
  const formalEligible = Boolean(
    evidenceStatus === 'confirmed_requirement_tension' &&
    origin === 'user_requirements' &&
    hasSideAEvidence &&
    hasSideBEvidence
  )
  const rejectionReason = formalEligible
    ? null
    : text(change.rejectionReason, 300) ||
      (evidenceStatus === 'alternative_or_mode'
        ? 'alternative_or_mode_not_formal_contradiction'
        : origin !== 'user_requirements'
          ? 'origin_not_user_requirements'
          : !hasSideAEvidence || !hasSideBEvidence
            ? 'missing_two_sided_user_evidence'
            : activeLike ? 'not_formal_eligible' : null)

  return {
    ...change,
    sourceFindingIds,
    findingIds: sourceFindingIds,
    sourceMessageIds,
    messageIds: sourceMessageIds,
    sideASourceFindingIds: resolvedSideAFindingIds,
    sideBSourceFindingIds: resolvedSideBFindingIds,
    sideASourceMessageIds,
    sideBSourceMessageIds,
    evidenceStatus,
    origin,
    formalEligible,
    rejectionReason,
  }
}

export const isEngine2FormalContradictionChangeEligible = (change) => {
  if (!['create', 'update'].includes(change?.operation)) return true
  if (!ENGINE2_OPEN_CONTRADICTION_STATUSES.includes(change?.status)) return true
  return change.formalEligible === true && change.evidenceStatus === 'confirmed_requirement_tension' && change.origin === 'user_requirements'
}
