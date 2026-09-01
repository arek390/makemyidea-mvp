export type Engine2FindingStatus = 'pending' | 'confirmed' | 'rejected'

export type Engine2FindingCategory =
  | 'goal'
  | 'need'
  | 'fact'
  | 'constraint'
  | 'assumption'
  | 'question'
  | 'contradiction'

export type Engine2FindingSource = 'ai_interpretation' | 'user_edit' | 'unknown'

export type Engine2FindingInternal = {
  matrixRow: 'world' | 'product' | 'elements' | null
  matrixCol: 'as_is' | 'not_working' | 'should_be' | null
  matrixCell: string | null
  confidence: number | null
}

export type Engine2Finding = {
  id: string
  semanticKey?: string
  category: Engine2FindingCategory
  categoryLabel: string
  content: string
  displayText?: string
  evidence?: string | null
  status: Engine2FindingStatus
  source?: Engine2FindingSource
  fingerprint?: string
  sourceMessageIds?: string[]
  internal?: Engine2FindingInternal
  packageId?: string | null
  originalContent?: string | null
  proposedOperation?: 'add' | 'revise' | 'withdraw'
  targetFindingId?: string | null
  decisionSource?: 'user_accept' | 'user_change' | 'user_reject' | null
  decisionAt?: string | null
  updatedAt?: string | null
}

export type Engine2FindingState = {
  findings: Engine2Finding[]
  editingFindingId: string | null
  editingContent: string
}

export type Engine2FindingAction =
  | { type: 'addProposed'; finding: Engine2Finding }
  | { type: 'addProposedBatch'; findings: Engine2Finding[] }
  | { type: 'replaceAll'; findings: Engine2Finding[] }
  | { type: 'confirm'; id: string }
  | { type: 'confirmAll'; ids?: string[] }
  | { type: 'startEdit'; id: string }
  | { type: 'changeEdit'; content: string }
  | { type: 'saveEdit' }
  | { type: 'cancelEdit' }
  | { type: 'reject'; id: string }
  | { type: 'rejectAll'; ids?: string[] }

export function createEngine2FindingState(
  findings: Engine2Finding[] = [],
): Engine2FindingState {
  return {
    findings,
    editingFindingId: null,
    editingContent: '',
  }
}

export function engine2FindingReducer(
  state: Engine2FindingState,
  action: Engine2FindingAction,
): Engine2FindingState {
  switch (action.type) {
    case 'addProposed':
      return {
        ...state,
        findings: [...state.findings, action.finding],
      }
    case 'addProposedBatch':
      return {
        ...state,
        findings: [...state.findings, ...action.findings],
      }
    case 'replaceAll':
      return {
        ...state,
        findings: action.findings,
        editingFindingId: null,
        editingContent: '',
      }
    case 'confirm':
      return state
    case 'confirmAll': {
      return state
    }
    case 'startEdit': {
      const finding = state.findings.find((item) => item.id === action.id)
      if (!finding) return state
      return {
        ...state,
        editingFindingId: action.id,
        editingContent: finding.content,
      }
    }
    case 'changeEdit':
      if (!state.editingFindingId) return state
      return {
        ...state,
        editingContent: action.content,
      }
    case 'saveEdit': {
      if (!state.editingFindingId) return state
      const content = state.editingContent.trim()
      if (!content) return state
      return {
        findings: state.findings,
        editingFindingId: null,
        editingContent: '',
      }
    }
    case 'cancelEdit':
      return {
        ...state,
        editingFindingId: null,
        editingContent: '',
      }
    case 'reject':
      return {
        findings: state.findings,
        editingFindingId: state.editingFindingId === action.id ? null : state.editingFindingId,
        editingContent: state.editingFindingId === action.id ? '' : state.editingContent,
      }
    case 'rejectAll': {
      const rejectedIds = new Set((action.ids || state.findings.filter((finding) => finding.status === 'pending').map((finding) => finding.id)).filter(Boolean))
      const editingReset = state.editingFindingId && rejectedIds.has(state.editingFindingId)
      return {
        findings: state.findings,
        editingFindingId: editingReset ? null : state.editingFindingId,
        editingContent: editingReset ? '' : state.editingContent,
      }
    }
    default:
      return state
  }
}
