import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, DragEvent as ReactDragEvent, SetStateAction } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/supabase/types'
import {
  ENGINE_ENTRY_LABEL_COLORS,
  ENGINE_ENTRY_LABELS,
  getEntryLabelText,
  getNoLabelText,
} from '../engine/entryLabels'
import {
  ENGINE_SORT_GAP,
  INITIAL_BRIEF_RECOMMENDED_WORD_TARGET,
  INITIAL_BRIEF_WORD_LIMIT,
  WORD_LIMIT,
} from './constants'
import type { EnginePerspectiveKey } from './types'
import { getEntryCellId } from './utils'

type EngineBoardItem = any
type EngineEditPayload = { id: string; text: string }
type EngineMovePayload = { id: string; section: EnginePerspectiveKey; index: number }
type EnginePreviewEditPayload = { id: string; text: string }

const safeLower = (value: unknown) => String(value ?? '').toLocaleLowerCase()

const isMissingLabel = (item: EngineBoardItem) => {
  const label = String(item.label ?? '').trim()
  return !label || safeLower(label) === 'n/a'
}

export type Engine1AuthPlatform = {
  authDisabled: boolean
  authSession: Session | null
  client: SupabaseClient<Database> | null
  handleLogout: () => Promise<void>
  isAdmin: boolean
  isAuthed: boolean
  logoutInProgress: boolean
  missingSupabaseEnvMessage: string
}

export type Engine1BillingPlatform = {
  balanceCurrency: 'PLN'
  billingAccount: {
    loading: boolean
    error: string | null
    balanceMinor: number
  }
  billingBalanceOverrideMinor: number | null
  insufficientBalanceState: {
    active: boolean
  }
  reportCreatePriceLoading: boolean
  reportCreatePriceMinor: number | null
  sessionCreatePriceLoading: boolean
}

type Engine1ModelUsage = {
  inputTokens: number
  outputTokens: number
  totalUSD: number
  eventsCount: number
}

type Engine1SessionUsage = {
  perModel: Record<string, Engine1ModelUsage>
  totalUSD: number
  totalPLN: number | null
  totalTokens: number
}

type Engine1LlmStatus = 'unknown' | 'online' | 'offline'

type Engine1SessionUsageDiagnosticsError = {
  code: string | null
  message: string
  details: string | null
  hint: string | null
}

type Engine1SessionUsageDiagnostics = {
  sessionId: string | null
  summaryQueryStatus: 'idle' | 'running' | 'ok' | 'error'
  eventsQueryStatus: 'idle' | 'running' | 'ok' | 'error'
  realtimeStatus: string | null
  summaryError: Engine1SessionUsageDiagnosticsError | null
  eventsError: Engine1SessionUsageDiagnosticsError | null
  lastCheckedAt: number | null
}

export type Engine1AiPlatform = {
  aiSupportEnabled: boolean
  checkLlmStatus: (base: string) => Promise<void>
  currentTokensTotal: number
  llmApiBase: string
  llmUsageClass: string
  modelUsageEntries: [string, Engine1ModelUsage][]
  normalizeApiBase: (value: string) => string
  sessionUsage: Engine1SessionUsage
  totalCostPln: number | null
  totalCostUsd: number
}

export type Engine1NavigationPlatform = {
  reportNavigationLoading: boolean
  setHashPath: Dispatch<SetStateAction<string>>
  storeTopupReturnTo: () => void
}

export type Engine1DiagnosticsPlatform = {
  activeUsageSessionIdNormalized: string | null
  DIAGNOSTICS_STORAGE_KEY: string
  isDiagEnabled: () => boolean
  sessionUsageDiagnostics: Engine1SessionUsageDiagnostics
  setAiSupportEnabled: Dispatch<SetStateAction<boolean>>
  setDiagnosticsEnabled: Dispatch<SetStateAction<boolean>>
  setFacilitationCooldown: (reason: string) => void
  setLlmStatus: Dispatch<SetStateAction<Engine1LlmStatus>>
  showDiagnostics: boolean
  showSessionUsage: boolean
}

export type Engine1AppProps = {
  actionPlanReadinessEnabled: any
  ActionPlanReadinessGauge: any
  actionPlanReadinessHeuristic: any
  actionPlanReadinessLlmCache: any
  actionPlanReadinessMeaningfulCount: any
  activateEngineDraftTarget: any
  activateFacilitationPrompt: any
  AiCostButton: any
  aiPlatform: Engine1AiPlatform
  applyEngineInitialBriefTextChange: any
  armIdleWatch: any
  assignNaItems: any
  authPlatform: Engine1AuthPlatform
  autosizeTextarea: any
  billingPlatform: Engine1BillingPlatform
  clearEngineDraftTarget: any
  clearEngineIdleTimer: any
  closeEngineLabelEditor: () => void
  cancelEngineEntryDelete: () => void
  confirmEngineEntryDelete: (entryId: string) => Promise<void> | void
  copy: any
  cancelEngineNamePrompt: () => void
  debugMatrixData: { rows: any[]; cols: any[]; targetCell?: any; cells: Map<any, { count?: any; entries?: any[] }>; [key: string]: any }
  deleteEngineItem: any
  deleteEngineSession: any
  diagnosticsPlatform: Engine1DiagnosticsPlatform
  engineActiveFacilitationPerspective: any
  engineActivePrompt: any
  engineAddEntryLoading: any
  engineAllowIdleWithoutFocusRef: any
  engineAssignLoading: any
  engineDeleteLoadingId: any
  engineDraftTargetSection: any
  engineEditLoading: any
  engineEditResetSignal: any
  engineEntryDeleteId: any
  engineFacilitationInlineError: any
  engineFacilitationLoading: any
  engineFacilitationLoadingType: any
  EngineHeader: any
  engineIdleArmedRef: any
  engineIdleTriggered: any
  engineImportInputRef: any
  engineInitialBriefError: any
  engineInitialBriefInputRef: any
  engineInitialBriefOpen: any
  engineInitialBriefSubmitLabel: any
  engineInitialBriefSubmitting: any
  engineInitialBriefVoiceCorrectionSeqRef: any
  engineInitialBriefVoiceState: any
  engineInputRef: any
  engineInteractionBySession: any
  engineLabelEditorId: any
  engineLabelEditorRef: any
  engineLabelSelectRef: any
  engineMatrixVisible: any
  engineMovingEntryId: any
  engineNameDraft: any
  engineNameError: any
  engineNamePromptOpen: any
  engineNameSaving: any
  engineNotice: any
  engineOfferReason: any
  enginePreviewError: any
  enginePreviewInput: any
  enginePreviewItems: any[]
  enginePreviewSessionId: any
  enginePreviewSessionName: any
  enginePreviewVoiceError: any
  enginePreviewVoiceState: any
  enginePromptSource: any
  engineSessionDetail: { boardItems: any[]; [key: string]: any } | null
  engineSessionPersisted: any
  engineSessions: any[]
  engineSessionsError: any
  engineSessionsOpen: any
  engineUiState: any
  engineUnassignedItems: any
  facilitationIntroRef: any
  feedbackFab: any
  feedbackPanel: any
  feedbackReminderBanner: any
  formatBalanceMinor: any
  formatPln: any
  formatTokenTotal: any
  formatUsd: any
  getEngineInitialBriefDisplayedText: any
  getEngineSessionKey: any
  getReportMetaForSession: any
  goToActionPlan: any
  handleEnginePreviewAdd: any
  handleEngineEntryLabelChange: (entryId: string, label: string | null) => void
  handleEnginePreviewInputChange: any
  handleEngineNameDraftChange: (value: string) => void
  handleExportSessions: any
  handleImportSessions: any
  handleReportNavigation: any
  hasEnoughEngineInitialBriefContent: any
  highlightMissingLabels: any
  isPhoneViewport: any
  landingLogoUrl: any
  lastFacilitationPerspective: any
  lastFacilitationType: any
  lastLlmSource: any
  lastLlmWhy: any
  limitWords: any
  logFacilitationEvent: any
  missingLabelCount: any
  missingLabelModal: any
  moveEngineEntryToSection: (payload: EngineMovePayload) => Promise<void> | void
  navigationPlatform: Engine1NavigationPlatform
  notices: any
  openEngineSession: any
  questionMatrix: { rows: any[]; cols: any[]; entriesByName?: Record<string, any[]>; [key: string]: any }
  reportRecords: any
  resolveFacilitationRequestType: any
  saveCurrentSessionToCloud: any
  saveEngineItem: (payload: EngineEditPayload) => Promise<boolean> | boolean
  saveEnginePreviewEdit: (payload: EnginePreviewEditPayload) => Promise<void> | void
  setEngineFacilitationInlineError: (value: any | ((prev: any) => any)) => void
  setEngineInitialBriefVoicePreview: (value: any | ((prev: any) => any)) => void
  setEngineInitialBriefVoiceState: (value: any | ((prev: any) => any)) => void
  setEngineInputFocused: (value: any | ((prev: any) => any)) => void
  setEngineLastInputActivityAt: (value: any | ((prev: any) => any)) => void
  setEngineOfferReason: (value: any | ((prev: any) => any)) => void
  setEnginePreviewVoiceState: (value: any | ((prev: any) => any)) => void
  setEngineSessionsOpen: (value: any | ((prev: any) => any)) => void
  setEngineUiState: (value: any | ((prev: any) => any)) => void
  showEngineFacilitationLoadingUI: any
  showEngineInputCaret: any
  showFirstQuestionWrapper: any
  startNewSession: any
  stopEngineInitialBriefRecognition: any
  stopEnginePreviewRecognition: any
  submitEngineInitialBrief: any
  submitEngineNamePrompt: () => void
  syncEnginePreviewVoiceTranscript: any
  toggleEngineInitialBriefVoiceInput: any
  toggleEngineLabelEditor: (entryId: string) => void
  toggleEngineSessionsList: () => void
  toggleEnginePreviewVoiceInput: any
  uiLanguage: any
  openEngineEntryDeleteConfirm: (entryId: string) => void
  withAlpha: any
}

export function Engine1App({
    actionPlanReadinessEnabled,
    ActionPlanReadinessGauge,
    actionPlanReadinessHeuristic,
    actionPlanReadinessLlmCache,
    actionPlanReadinessMeaningfulCount,
    activateEngineDraftTarget,
    activateFacilitationPrompt,
    AiCostButton,
    aiPlatform,
    applyEngineInitialBriefTextChange,
    armIdleWatch,
    assignNaItems,
    authPlatform,
    autosizeTextarea,
    billingPlatform,
    clearEngineDraftTarget,
    clearEngineIdleTimer,
    closeEngineLabelEditor,
    cancelEngineEntryDelete,
    confirmEngineEntryDelete,
    copy,
    cancelEngineNamePrompt,
    debugMatrixData,
    deleteEngineItem,
    deleteEngineSession,
    diagnosticsPlatform,
    engineActiveFacilitationPerspective,
    engineActivePrompt,
    engineAddEntryLoading,
    engineAllowIdleWithoutFocusRef,
    engineAssignLoading,
    engineDeleteLoadingId,
    engineDraftTargetSection,
    engineEditLoading,
    engineEditResetSignal,
    engineEntryDeleteId,
    engineFacilitationInlineError,
    engineFacilitationLoading,
    engineFacilitationLoadingType,
    EngineHeader,
    engineIdleArmedRef,
    engineIdleTriggered,
    engineImportInputRef,
    engineInitialBriefError,
    engineInitialBriefInputRef,
    engineInitialBriefOpen,
    engineInitialBriefSubmitLabel,
    engineInitialBriefSubmitting,
    engineInitialBriefVoiceCorrectionSeqRef,
    engineInitialBriefVoiceState,
    engineInputRef,
    engineInteractionBySession,
    engineLabelEditorId,
    engineLabelEditorRef,
    engineLabelSelectRef,
    engineMatrixVisible,
    engineMovingEntryId,
    engineNameDraft,
    engineNameError,
    engineNamePromptOpen,
    engineNameSaving,
    engineNotice,
    engineOfferReason,
    enginePreviewError,
    enginePreviewInput,
    enginePreviewItems,
    enginePreviewSessionId,
    enginePreviewSessionName,
    enginePreviewVoiceError,
    enginePreviewVoiceState,
    enginePromptSource,
    engineSessionDetail,
    engineSessionPersisted,
    engineSessions,
    engineSessionsError,
    engineSessionsOpen,
    engineUiState,
    engineUnassignedItems,
    facilitationIntroRef,
    feedbackFab,
    feedbackPanel,
    feedbackReminderBanner,
    formatBalanceMinor,
    formatPln,
    formatTokenTotal,
    formatUsd,
    getEngineInitialBriefDisplayedText,
    getEngineSessionKey,
    getReportMetaForSession,
    goToActionPlan,
    handleEnginePreviewAdd,
    handleEngineEntryLabelChange,
    handleEnginePreviewInputChange,
    handleEngineNameDraftChange,
    handleExportSessions,
    handleImportSessions,
    handleReportNavigation,
    hasEnoughEngineInitialBriefContent,
    highlightMissingLabels,
    isPhoneViewport,
    landingLogoUrl,
    lastFacilitationPerspective,
    lastFacilitationType,
    lastLlmSource,
    lastLlmWhy,
    limitWords,
    logFacilitationEvent,
    missingLabelCount,
    missingLabelModal,
    moveEngineEntryToSection,
    navigationPlatform,
    notices,
    openEngineSession,
    questionMatrix,
    reportRecords,
    resolveFacilitationRequestType,
    saveCurrentSessionToCloud,
    saveEngineItem,
    saveEnginePreviewEdit,
    setEngineFacilitationInlineError,
    setEngineInitialBriefVoicePreview,
    setEngineInitialBriefVoiceState,
    setEngineInputFocused,
    setEngineLastInputActivityAt,
    setEngineOfferReason,
    setEnginePreviewVoiceState,
    setEngineSessionsOpen,
    setEngineUiState,
    showEngineFacilitationLoadingUI,
    showEngineInputCaret,
    showFirstQuestionWrapper,
    startNewSession,
    stopEngineInitialBriefRecognition,
    stopEnginePreviewRecognition,
    submitEngineInitialBrief,
    submitEngineNamePrompt,
    syncEnginePreviewVoiceTranscript,
    toggleEngineInitialBriefVoiceInput,
    toggleEngineLabelEditor,
    toggleEngineSessionsList,
    toggleEnginePreviewVoiceInput,
    uiLanguage,
    openEngineEntryDeleteConfirm,
    withAlpha,
}: Engine1AppProps) {
  const [engineBoardLayoutVersion, setEngineBoardLayoutVersion] = useState(0)
  const [engineEntryRowSpans, setEngineEntryRowSpans] = useState<Record<string, number>>({})
  const [engineDraggingEntryId, setEngineDraggingEntryId] = useState<string | null>(null)
  const [engineDragOverSection, setEngineDragOverSection] = useState<EnginePerspectiveKey | null>(null)
  const [engineDragTargetIndex, setEngineDragTargetIndex] = useState<number | null>(null)
  const [engineEditItemId, setEngineEditItemId] = useState<string | null>(null)
  const [engineEditText, setEngineEditText] = useState('')
  const [enginePreviewEditId, setEnginePreviewEditId] = useState<string | null>(null)
  const [enginePreviewEditText, setEnginePreviewEditText] = useState('')
  const engineDragHoverTimerRef = useRef<number | null>(null)
  const enginePendingDragTargetRef = useRef<{
    section: EnginePerspectiveKey
    index: number
  } | null>(null)
  const engineEntryNodesRef = useRef<Record<string, HTMLLIElement | null>>({})
  const wasPhoneViewportRef = useRef(false)

  const countWords = (value: string) => {
    const matches = value.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)
    return matches?.length ?? 0
  }

  const sanitizeInlineHelperText = (value: string | null | undefined) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()

  const formatSessionLabel = (name: string | null | undefined, id: string) => {
    if (name && name.trim()) {
      return <span className="engine-session-name">{name}</span>
    }
    const shortId = id.slice(0, 8)
    return `${notices.sessionLabelPrefix} ${shortId}`
  }

  const resolveEntryQuestionHelperText = (item: EngineBoardItem) => {
    const primary =
      uiLanguage === 'Polish'
        ? item.question_text_pl ?? item.question_text_en ?? null
        : item.question_text_en ?? item.question_text_pl ?? null
    const questionText = sanitizeInlineHelperText(primary)
    return questionText || copy.engineEntryQuestionFallback
  }

  const markUserInitiatedInteraction = (source: 'pointer' | 'keystroke') => {
    const key = getEngineSessionKey()
    if (engineInteractionBySession.current[key]) return
    engineInteractionBySession.current[key] = true
    logFacilitationEvent('user_interaction_armed', { source, sessionId: key })
  }

  const orderedEnginePreviewItems = useMemo(() => {
    return [...enginePreviewItems]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aOrder =
          typeof a.item.sort_order === 'number' && Number.isFinite(a.item.sort_order)
            ? a.item.sort_order
            : (a.index + 1) * ENGINE_SORT_GAP
        const bOrder =
          typeof b.item.sort_order === 'number' && Number.isFinite(b.item.sort_order)
            ? b.item.sort_order
            : (b.index + 1) * ENGINE_SORT_GAP
        return aOrder - bOrder || a.index - b.index
      })
      .map(({ item }) => item)
  }, [enginePreviewItems])

  const resolveEngineEntryLayoutClass = (item: EngineBoardItem) => {
    const wordCount = countWords(item.text)
    const textLength = String(item.text || '').trim().length
    if (wordCount > 45 || textLength > 280) return 'is-hero'
    if (wordCount > 30 || textLength > 180) return 'is-wide'
    return 'is-medium'
  }

  const enginePerspectiveSections = useMemo(() => {
    const sections = [
      { key: 'as_is', title: copy.axisPast, toneClass: 'is-as-is' },
      { key: 'not_working', title: copy.axisNow, toneClass: 'is-not-working' },
      { key: 'should_be', title: copy.axisFuture, toneClass: 'is-should-be' },
    ] as const
    const grouped: Record<'as_is' | 'not_working' | 'should_be', EngineBoardItem[]> = {
      as_is: [],
      not_working: [],
      should_be: [],
    }
    orderedEnginePreviewItems.forEach((item) => {
      const key: EnginePerspectiveKey =
        item.matrix_col === 'as_is' || item.matrix_col === 'not_working' || item.matrix_col === 'should_be'
          ? item.matrix_col
          : 'not_working'
      grouped[key].push(item)
    })
    return sections.map((section) => ({
      ...section,
      items: grouped[section.key].map((item) => ({
        item,
        layoutClass: resolveEngineEntryLayoutClass(item),
      })),
    }))
  }, [copy.axisFuture, copy.axisNow, copy.axisPast, orderedEnginePreviewItems])

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    if (isPhoneViewport) {
      setEngineEntryRowSpans({})
      return
    }

    const calculateRowSpan = (id: string, node: HTMLLIElement) => {
      const list = node.closest('.engine-entry-list')
      if (!(list instanceof HTMLElement)) return
      if (node.offsetWidth === 0 || list.offsetWidth === 0) return
      const styles = window.getComputedStyle(list)
      const rowHeight = parseFloat(styles.gridAutoRows || '') || 4
      const rowGap =
        parseFloat(styles.rowGap || '') || parseFloat(styles.getPropertyValue('grid-row-gap')) || 12
      const content = node.querySelector('.engine-entry-main')
      const contentHeight =
        content instanceof HTMLElement ? content.scrollHeight : node.scrollHeight
      const nodeStyles = window.getComputedStyle(node)
      const verticalPadding =
        (parseFloat(nodeStyles.paddingTop || '') || 0) +
        (parseFloat(nodeStyles.paddingBottom || '') || 0)
      const borderWidth =
        (parseFloat(nodeStyles.borderTopWidth || '') || 0) +
        (parseFloat(nodeStyles.borderBottomWidth || '') || 0)
      const measuredHeight = contentHeight + verticalPadding + borderWidth
      const span = Math.max(1, Math.ceil((measuredHeight + rowGap) / (rowHeight + rowGap)))
      setEngineEntryRowSpans((prev) => (prev[id] === span ? prev : { ...prev, [id]: span }))
    }

    const nodes = Object.entries(engineEntryNodesRef.current).filter(
      (entry): entry is [string, HTMLLIElement] => entry[1] instanceof HTMLLIElement
    )
    if (!nodes.length) return

    nodes.forEach(([id, node]) => calculateRowSpan(id, node))

    const frame = window.requestAnimationFrame(() => {
      nodes.forEach(([id, node]) => calculateRowSpan(id, node))
    })
    const settleFrame = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        nodes.forEach(([id, node]) => calculateRowSpan(id, node))
      })
    }, 80)
    const lateSettleFrame = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        nodes.forEach(([id, node]) => calculateRowSpan(id, node))
      })
    }, 280)

    let cancelled = false
    if (typeof document !== 'undefined' && 'fonts' in document && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (cancelled) return
        window.requestAnimationFrame(() => {
          nodes.forEach(([id, node]) => calculateRowSpan(id, node))
        })
      })
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            entries.forEach((entry) => {
              const node = entry.target
              if (!(node instanceof HTMLLIElement)) return
              const id = node.dataset.entryId
              if (!id) return
              calculateRowSpan(id, node)
            })
          })

    nodes.forEach(([, node]) => resizeObserver?.observe(node))

    const handleResize = () => {
      nodes.forEach(([id, node]) => calculateRowSpan(id, node))
    }

    window.addEventListener('resize', handleResize)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settleFrame)
      window.clearTimeout(lateSettleFrame)
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
    }
  }, [
    enginePerspectiveSections,
    engineEntryDeleteId,
    engineLabelEditorId,
    isPhoneViewport,
  ])

  useEffect(() => {
    setEngineEntryRowSpans({})
  }, [enginePreviewSessionId])

  useEffect(() => {
    if (isPhoneViewport) {
      wasPhoneViewportRef.current = true
      setEngineEntryRowSpans({})
      return
    }
    if (!wasPhoneViewportRef.current) return
    wasPhoneViewportRef.current = false
    engineEntryNodesRef.current = {}
    setEngineEntryRowSpans({})
    setEngineBoardLayoutVersion((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 120)
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 320)
    }
  }, [isPhoneViewport])

  useEffect(() => {
    return () => {
      if (engineDragHoverTimerRef.current) {
        window.clearTimeout(engineDragHoverTimerRef.current)
        engineDragHoverTimerRef.current = null
      }
    }
  }, [])

  const handleEngineEntryDragStart = (
    event: ReactDragEvent<HTMLLIElement>,
    item: EngineBoardItem
  ) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('button, select, textarea, option')) {
      event.preventDefault()
      return
    }
    if (engineMovingEntryId === item.id) {
      event.preventDefault()
      return
    }
    setEngineDraggingEntryId(item.id)
    setEngineDragOverSection(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }

  const handleEngineEntryDragEnd = () => {
    if (engineDragHoverTimerRef.current) {
      window.clearTimeout(engineDragHoverTimerRef.current)
      engineDragHoverTimerRef.current = null
    }
    enginePendingDragTargetRef.current = null
    setEngineDraggingEntryId(null)
    setEngineDragOverSection(null)
    setEngineDragTargetIndex(null)
  }

  const scheduleEngineDragTarget = (
    sectionKey: EnginePerspectiveKey,
    targetIndex: number
  ) => {
    const currentSection = engineDragOverSection
    const currentIndex = engineDragTargetIndex
    const pending = enginePendingDragTargetRef.current

    if (currentSection !== sectionKey || currentIndex === null) {
      if (engineDragHoverTimerRef.current) {
        window.clearTimeout(engineDragHoverTimerRef.current)
        engineDragHoverTimerRef.current = null
      }
      enginePendingDragTargetRef.current = null
      setEngineDragOverSection(sectionKey)
      setEngineDragTargetIndex(targetIndex)
      return
    }

    if (currentIndex === targetIndex) return
    if (pending?.section === sectionKey && pending.index === targetIndex) return

    if (engineDragHoverTimerRef.current) {
      window.clearTimeout(engineDragHoverTimerRef.current)
    }
    enginePendingDragTargetRef.current = { section: sectionKey, index: targetIndex }
    engineDragHoverTimerRef.current = window.setTimeout(() => {
      const next = enginePendingDragTargetRef.current
      if (!next) return
      setEngineDragOverSection(next.section)
      setEngineDragTargetIndex(next.index)
      enginePendingDragTargetRef.current = null
      engineDragHoverTimerRef.current = null
    }, 100)
  }

  const handleEngineSectionDragOver = (
    event: ReactDragEvent<HTMLElement>,
    sectionKey: EnginePerspectiveKey,
    targetIndex: number
  ) => {
    if (!engineDraggingEntryId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    scheduleEngineDragTarget(sectionKey, targetIndex)
  }

  const handleEngineEntryDragOver = (
    event: ReactDragEvent<HTMLLIElement>,
    sectionKey: EnginePerspectiveKey,
    itemIndex: number
  ) => {
    if (!engineDraggingEntryId) return
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    const targetIndex = event.clientY < midpoint ? itemIndex : itemIndex + 1
    handleEngineSectionDragOver(event, sectionKey, targetIndex)
  }

  const handleEngineSectionDrop = async (
    event: ReactDragEvent<HTMLElement>,
    sectionKey: EnginePerspectiveKey
  ) => {
    event.preventDefault()
    const draggedId = engineDraggingEntryId || event.dataTransfer.getData('text/plain')
    const pendingTarget = enginePendingDragTargetRef.current
    const targetIndex =
      pendingTarget && pendingTarget.section === sectionKey
        ? pendingTarget.index
        : engineDragTargetIndex ?? 0
    if (engineDragHoverTimerRef.current) {
      window.clearTimeout(engineDragHoverTimerRef.current)
      engineDragHoverTimerRef.current = null
    }
    enginePendingDragTargetRef.current = null
    setEngineDragOverSection(null)
    setEngineDragTargetIndex(null)
    setEngineDraggingEntryId(null)
    if (!draggedId) return
    await moveEngineEntryToSection({
      id: draggedId,
      section: sectionKey,
      index: targetIndex,
    })
  }

  const handleEngineSectionDragLeave = (
    event: ReactDragEvent<HTMLElement>,
    sectionKey: EnginePerspectiveKey
  ) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    if (engineDragHoverTimerRef.current) {
      window.clearTimeout(engineDragHoverTimerRef.current)
      engineDragHoverTimerRef.current = null
    }
    enginePendingDragTargetRef.current = null
    setEngineDragOverSection((prev) => (prev === sectionKey ? null : prev))
    setEngineDragTargetIndex(null)
  }

  const startEditEngineItem = (item: EngineBoardItem) => {
    setEngineEditItemId(item.id)
    setEngineEditText(item.text)
  }

  const cancelEditEngineItem = () => {
    setEngineEditItemId(null)
    setEngineEditText('')
  }

  const handleSaveEngineItem = async () => {
    if (!engineEditItemId) return
    const saved = await saveEngineItem({
      id: engineEditItemId,
      text: engineEditText,
    })
    if (saved) cancelEditEngineItem()
  }

  useEffect(() => {
    cancelEditEngineItem()
  }, [engineEditResetSignal])

  useEffect(() => {
    if (!engineEditItemId) return
    if (engineSessionDetail?.boardItems?.some((item) => item.id === engineEditItemId)) return
    cancelEditEngineItem()
  }, [engineEditItemId, engineSessionDetail?.boardItems])

  const startEnginePreviewEdit = (item: EngineBoardItem) => {
    closeEngineLabelEditor()
    setEnginePreviewEditId(item.id)
    setEnginePreviewEditText(item.text)
  }

  const cancelEnginePreviewEdit = () => {
    setEnginePreviewEditId(null)
    setEnginePreviewEditText('')
  }

  const handleSaveEnginePreviewEdit = async () => {
    if (!enginePreviewEditId) return
    try {
      await saveEnginePreviewEdit({
        id: enginePreviewEditId,
        text: enginePreviewEditText,
      })
    } finally {
      cancelEnginePreviewEdit()
    }
  }

  useEffect(() => {
    if (!enginePreviewEditId) return
    if (enginePreviewItems.some((item) => item.id === enginePreviewEditId)) return
    cancelEnginePreviewEdit()
  }, [enginePreviewEditId, enginePreviewItems])

  const enginePlaceholder =
    enginePreviewItems.length === 0
      ? copy.enginePlaceholderInitial
      : copy.enginePlaceholderContinue
  const hasEngineBoardEntries = enginePreviewItems.length > 0
  const engineRemainingWords = Math.max(0, WORD_LIMIT - countWords(enginePreviewInput))
  const isEngineWordLimitReached =
    enginePreviewInput.trim().length > 0 && countWords(enginePreviewInput) >= WORD_LIMIT
  const engineInitialBriefDisplayedText = getEngineInitialBriefDisplayedText()
  const engineInitialBriefWords = countWords(engineInitialBriefDisplayedText)
  const engineInitialBriefRemainingWords = Math.max(
    0,
    INITIAL_BRIEF_WORD_LIMIT - engineInitialBriefWords
  )
  const engineInitialBriefRecommendedProgress = Math.min(
    engineInitialBriefWords / INITIAL_BRIEF_RECOMMENDED_WORD_TARGET,
    1
  )
  const engineInitialBriefRecommendedPercent = Math.round(
    engineInitialBriefRecommendedProgress * 100
  )
  const engineInitialBriefLengthState =
    engineInitialBriefWords >= INITIAL_BRIEF_RECOMMENDED_WORD_TARGET
      ? 'enough'
      : engineInitialBriefWords >= 120
        ? 'strong'
        : engineInitialBriefWords >= 40
          ? 'useful'
          : 'low'
  const engineInitialBriefLengthStatus =
    engineInitialBriefLengthState === 'enough'
      ? copy.engineInitialBriefLengthEnough
      : engineInitialBriefLengthState === 'strong'
        ? copy.engineInitialBriefLengthStrong
        : engineInitialBriefLengthState === 'useful'
          ? copy.engineInitialBriefLengthUseful
          : copy.engineInitialBriefLengthLow
  const engineInitialBriefLengthMessage =
    engineInitialBriefLengthState === 'low'
      ? copy.engineInitialBriefLengthIntro
      : engineInitialBriefLengthStatus
  const isEngineInitialBriefLimitReached =
    engineInitialBriefDisplayedText.trim().length > 0 &&
    engineInitialBriefWords >= INITIAL_BRIEF_WORD_LIMIT
  const hasEngineDraftContent =
    Boolean(enginePreviewInput.trim()) || enginePreviewVoiceState === 'listening'
  const showEngineDraftRemove = Boolean(engineDraftTargetSection) && hasEngineDraftContent
  const engineDraftToneClass =
    engineDraftTargetSection === 'as_is'
      ? 'is-as-is'
      : engineDraftTargetSection === 'not_working'
        ? 'is-not-working'
        : engineDraftTargetSection === 'should_be'
          ? 'is-should-be'
          : ''
  const showFacilitationOffer =
    engineUiState === 'FACILITATION_OFFER' ||
    engineOfferReason === 'idle' ||
    engineOfferReason === 'manual'
  const showHelpButton = !showFacilitationOffer
  const facilitationDisabled = !engineSessionPersisted || !enginePreviewSessionId
  const facilitationPerspectiveActions: Array<{
    key: EnginePerspectiveKey
    label: string
    toneClass: 'is-as-is' | 'is-not-working' | 'is-should-be'
    testId: string
  }> = [
    {
      key: 'as_is',
      label: copy.engineFacilitationAsIs,
      toneClass: 'is-as-is',
      testId: 'facilitation-as-is',
    },
    {
      key: 'not_working',
      label: copy.engineFacilitationProblem,
      toneClass: 'is-not-working',
      testId: 'facilitation-not-working',
    },
    {
      key: 'should_be',
      label: copy.engineFacilitationDesired,
      toneClass: 'is-should-be',
      testId: 'facilitation-should-be',
    },
  ]

  return (
      <div className="app engine-preview" data-testid="active-session">
        <EngineHeader
          logoUrl={landingLogoUrl}
          copy={copy}
          uiLanguage={uiLanguage}
          isAuthed={authPlatform.isAuthed}
          isAdmin={authPlatform.isAdmin}
          logoutInProgress={authPlatform.logoutInProgress}
          billingLoading={billingPlatform.billingAccount.loading}
          billingError={billingPlatform.billingAccount.error}
          billingBalanceMinor={billingPlatform.billingAccount.balanceMinor}
          billingBalanceOverrideMinor={billingPlatform.billingBalanceOverrideMinor}
          insufficientBalanceActive={billingPlatform.insufficientBalanceState.active}
          engineNotice={engineNotice}
          showBalance
          showWorkspaceActions
          canStartNewSession={Boolean(enginePreviewSessionId && !engineNamePromptOpen)}
          showDiagnostics={diagnosticsPlatform.showDiagnostics}
          aiSupportEnabled={aiPlatform.aiSupportEnabled}
          showSessionUsage={diagnosticsPlatform.showSessionUsage}
          llmUsageClass={aiPlatform.llmUsageClass}
          currentTokensTotal={aiPlatform.currentTokensTotal}
          totalCostUsd={aiPlatform.totalCostUsd}
          totalCostPln={aiPlatform.totalCostPln}
          sessionUsage={aiPlatform.sessionUsage}
          modelUsageEntries={aiPlatform.modelUsageEntries}
          diagnosticsAuthEmail={authPlatform.authSession?.user?.email ?? null}
          onBalanceClick={() => {
            if (typeof window !== 'undefined') {
              navigationPlatform.storeTopupReturnTo()
              window.location.hash = '#/topup'
              navigationPlatform.setHashPath('/topup')
            }
          }}
          onSaveSession={() => {
            void saveCurrentSessionToCloud()
          }}
          onStartNewSession={() => {
            void startNewSession()
          }}
          onAdminClick={() => {
            if (typeof window !== 'undefined') {
              window.location.hash = '#/admin'
            }
          }}
          onLogout={() => {
            void authPlatform.handleLogout()
          }}
          onToggleDiagnostics={() => {
            const nextEnabled = !diagnosticsPlatform.showDiagnostics
            diagnosticsPlatform.setDiagnosticsEnabled(nextEnabled)
            localStorage.setItem(
              diagnosticsPlatform.DIAGNOSTICS_STORAGE_KEY,
              nextEnabled ? 'true' : 'false'
            )
          }}
          onToggleAiSupport={() => {
            const nextEnabled = !aiPlatform.aiSupportEnabled
            diagnosticsPlatform.setAiSupportEnabled(nextEnabled)
            localStorage.setItem('aiSupportEnabled', nextEnabled ? 'true' : 'false')
            if (nextEnabled) {
              void aiPlatform.checkLlmStatus(aiPlatform.normalizeApiBase(aiPlatform.llmApiBase))
            } else {
              diagnosticsPlatform.setLlmStatus('offline')
            }
          }}
          formatBalanceMinor={formatBalanceMinor}
          formatTokenTotal={formatTokenTotal}
          formatUsd={formatUsd}
          formatPln={formatPln}
          isDiagEnabled={diagnosticsPlatform.isDiagEnabled()}
        />
        {authPlatform.authDisabled && (
          <div className="engine-error" role="status">
            {authPlatform.missingSupabaseEnvMessage}
          </div>
        )}
        <main className="engine-main">
          {feedbackReminderBanner}
          <section className="engine-panel engine-panel-session">
            <div className="engine-panel-header">
              <h1>{copy.enginePreviewSessionTitle}</h1>
              <div className="engine-actions engine-actions-session">
                {!enginePreviewSessionId && !engineSessionsOpen && !engineNamePromptOpen && (
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-create"
                    onClick={async () => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      armIdleWatch('create_session')
                      void startNewSession()
                    }}
                  >
                    {copy.enginePreviewCreateSession}
                  </button>
                )}
                {enginePreviewSessionId && hasEngineBoardEntries && (
                  <div className="engine-actions-group">
                    {(() => {
                      const currentSessionId = enginePreviewSessionId
                      const reportMeta = getReportMetaForSession(currentSessionId)
                      const reportLookupResolved =
                        !authPlatform.authSession?.user?.id ||
                        Object.prototype.hasOwnProperty.call(reportRecords, currentSessionId) ||
                        Boolean(reportMeta?.id)
                      const hasReport = Boolean(
                        currentSessionId && (reportRecords[currentSessionId]?.id || reportMeta?.id)
                      )
                      if (!reportLookupResolved) return null
                      if (hasReport) {
                        return (
                          <button
                            type="button"
                            className="primary"
                            data-testid="session-report"
                            onClick={() => {
                              markUserInitiatedInteraction('pointer')
                              setEngineLastInputActivityAt(Date.now())
                              goToActionPlan()
                            }}
                          >
                            {copy.enginePreviewOpenReport}
                          </button>
                        )
                      }
                      return (
                        <AiCostButton
                          label={copy.enginePreviewCreateReport}
                          lang={uiLanguage === 'Polish' ? 'pl' : 'en'}
                          priceMinor={billingPlatform.reportCreatePriceMinor}
                          currency={billingPlatform.balanceCurrency}
                          priceLoading={billingPlatform.reportCreatePriceLoading}
                          loading={navigationPlatform.reportNavigationLoading}
                          disabled={navigationPlatform.reportNavigationLoading}
                          className="engine-create-report-btn"
                          metaLayout="below"
                          onClick={() => {
                            markUserInitiatedInteraction('pointer')
                            setEngineLastInputActivityAt(Date.now())
                            void handleReportNavigation()
                          }}
                        />
                      )
                    })()}
                  </div>
                )}
                {!enginePreviewSessionId &&
                  authPlatform.authSession?.user?.id &&
                  engineSessions.length > 0 && (
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-list-toggle"
                    onClick={() => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      void toggleEngineSessionsList()
                    }}
                  >
                    {engineSessionsOpen
                      ? copy.engineSessionsToggleClose
                      : copy.engineSessionsToggleOpen}
                  </button>
                )}
              </div>
            </div>
          {(enginePreviewSessionId || engineSessionsOpen || engineSessionDetail?.session) && (
            <div className="engine-meta">
              <span>{copy.enginePreviewSessionIdLabel}:</span>
              <span className="engine-meta-value engine-meta-value--muted">
                {enginePreviewSessionId
                  ? formatSessionLabel(enginePreviewSessionName, enginePreviewSessionId)
                  : copy.enginePreviewSessionEmpty}
              </span>
            </div>
          )}
        </section>

        {engineSessionsOpen && (
          <section className="engine-panel engine-sessions">
            <div className="engine-panel-header">
              <h2>{copy.engineSessionsTitle}</h2>
              <div className="engine-actions">
              </div>
            </div>
            {engineSessionsError && (
              <div className="engine-error">{engineSessionsError}</div>
            )}
            {!engineSessionsError && engineSessions.length === 0 && (
              <div className="engine-empty">{copy.engineSessionsEmpty}</div>
            )}
            <ul className="engine-list">
              {engineSessions.map((session) => (
                <li
                  key={session.id}
                  className="engine-session-row"
                  data-testid={`session-item-${session.id}`}
                >
                  <span className="engine-session-id">{formatSessionLabel(session.name, session.id)}</span>
                  <span className="engine-session-meta">
                    {new Date(session.updated_at).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    data-testid={`session-open-${session.id}`}
                    onClick={() => {
                      armIdleWatch('open_session')
                      openEngineSession(session.id)
                      setEngineSessionsOpen(false)
                    }}
                  >
                    {copy.engineSessionsOpen}
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => deleteEngineSession(session.id)}
                    disabled={engineDeleteLoadingId === session.id}
                  >
                    {engineDeleteLoadingId === session.id
                      ? copy.engineSessionsDeleting
                      : copy.engineSessionsDelete}
                  </button>
                </li>
              ))}
            </ul>
            {engineSessionDetail?.session && (
                <div className="engine-session-detail">
                  <h3>{copy.engineSessionDetailsTitle}</h3>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsIdLabel}:</span>
                    <span className="engine-meta-value">{engineSessionDetail.session.id}</span>
                  </div>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsNameLabel}:</span>
                    <span className="engine-meta-value">{engineSessionDetail.session.name || '—'}</span>
                  </div>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsUpdatedLabel}:</span>
                    <span className="engine-meta-value">{new Date(engineSessionDetail.session.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="engine-meta">
                    <span>{copy.engineSessionDetailsQuestionsLabel}:</span>
                    <span className="engine-meta-value">{engineSessionDetail.askedQuestionIds.length}</span>
                  </div>
                  <div className="engine-session-board">
                    <h4>{copy.engineSessionDetailsBoardTitle}</h4>
                    {engineSessionDetail.boardItems.length === 0 ? (
                      <div className="engine-empty">{copy.engineSessionDetailsBoardEmpty}</div>
                    ) : (
                      <ul className="engine-list">
                        {engineSessionDetail.boardItems.map((item) => {
                          const isEditing = engineEditItemId === item.id
                          return (
                            <li key={item.id} className="engine-item-row">
                              <span className="engine-badge">{item.type}</span>
                              {isEditing ? (
                                <textarea
                                  className="engine-item-input"
                                  rows={2}
                                  value={engineEditText}
                                  onChange={(event) => setEngineEditText(event.target.value)}
                                />
                              ) : (
                                <span className="engine-item-text">{item.text}</span>
                              )}
                              <div className="engine-item-actions">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      className="primary"
                                      onClick={handleSaveEngineItem}
                                      disabled={engineEditLoading || !engineEditText.trim()}
                                    >
                                      Zapisz
                                    </button>
                                    <button type="button" className="ghost" onClick={cancelEditEngineItem}>
                                      Anuluj
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() => startEditEngineItem(item)}
                                      disabled={engineEditLoading}
                                    >
                                      {notices.editAction}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost danger"
                                      onClick={() => deleteEngineItem(item.id)}
                                      disabled={engineEditLoading}
                                    >
                                      {notices.deleteAction}
                                    </button>
                                  </>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
            )}
          </section>
        )}

        {engineSessionsOpen && diagnosticsPlatform.showDiagnostics && (
          <section className="engine-panel">
            <div className="engine-panel-header">
              <h2>
                {uiLanguage === 'Polish'
                  ? 'Narzędzia diagnostyczne administracyjne'
                  : 'Administrative diagnostics tools'}
              </h2>
              <div className="engine-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    markUserInitiatedInteraction('pointer')
                    setEngineLastInputActivityAt(Date.now())
                    handleExportSessions()
                  }}
                >
                  {copy.engineSessionsExport}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => engineImportInputRef.current?.click()}
                >
                  {copy.engineSessionsImport}
                </button>
                <input
                  ref={engineImportInputRef}
                  type="file"
                  accept="application/json"
                  className="sr-only"
                  onChange={handleImportSessions}
                />
              </div>
            </div>
            <div className="engine-helper">
              <strong>Session usage diagnostics</strong>
              <div className="engine-meta">
                <span>sessionId:</span>
                <span className="engine-meta-value">
                  {diagnosticsPlatform.activeUsageSessionIdNormalized || '—'}
                </span>
              </div>
              <div className="engine-meta">
                <span>summary query:</span>
                <span className="engine-meta-value">
                  {diagnosticsPlatform.sessionUsageDiagnostics.summaryQueryStatus}
                </span>
              </div>
              <div className="engine-meta">
                <span>events query:</span>
                <span className="engine-meta-value">
                  {diagnosticsPlatform.sessionUsageDiagnostics.eventsQueryStatus}
                </span>
              </div>
              <div className="engine-meta">
                <span>realtime:</span>
                <span className="engine-meta-value">
                  {diagnosticsPlatform.sessionUsageDiagnostics.realtimeStatus || '—'}
                </span>
              </div>
              <div className="engine-meta">
                <span>last checked:</span>
                <span className="engine-meta-value">
                  {diagnosticsPlatform.sessionUsageDiagnostics.lastCheckedAt
                    ? new Date(
                        diagnosticsPlatform.sessionUsageDiagnostics.lastCheckedAt
                      ).toLocaleString()
                    : '—'}
                </span>
              </div>
              <div className="engine-meta">
                <span>gpt-image-1:</span>
                <span className="engine-meta-value">
                  {aiPlatform.sessionUsage.perModel['gpt-image-1']
                    ? `${aiPlatform.sessionUsage.perModel['gpt-image-1'].eventsCount} ev, ${formatTokenTotal(
                        aiPlatform.sessionUsage.perModel['gpt-image-1'].inputTokens
                      )} in / ${formatTokenTotal(
                        aiPlatform.sessionUsage.perModel['gpt-image-1'].outputTokens
                      )} out, $${formatUsd(aiPlatform.sessionUsage.perModel['gpt-image-1'].totalUSD)}`
                    : '—'}
                </span>
              </div>
              {(diagnosticsPlatform.sessionUsageDiagnostics.summaryError ||
                diagnosticsPlatform.sessionUsageDiagnostics.eventsError) && (
                <div className="engine-meta">
                  <span>error:</span>
                  <span className="engine-meta-value">
                    {diagnosticsPlatform.sessionUsageDiagnostics.summaryError
                      ? `summary ${
                          diagnosticsPlatform.sessionUsageDiagnostics.summaryError.code || '—'
                        }: ${diagnosticsPlatform.sessionUsageDiagnostics.summaryError.message}`
                      : ''}
                    {diagnosticsPlatform.sessionUsageDiagnostics.summaryError &&
                    diagnosticsPlatform.sessionUsageDiagnostics.eventsError
                      ? ' | '
                      : ''}
                    {diagnosticsPlatform.sessionUsageDiagnostics.eventsError
                      ? `events ${
                          diagnosticsPlatform.sessionUsageDiagnostics.eventsError.code || '—'
                        }: ${diagnosticsPlatform.sessionUsageDiagnostics.eventsError.message}`
                      : ''}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

          {debugMatrixData && engineMatrixVisible && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{copy.engineMatrixTitle}</h2>
              </div>
              <div className="engine-debug-matrix" data-testid="debug-matrix">
                <input
                  type="checkbox"
                  className="sr-only"
                  data-testid="debug-matrix-toggle"
                  checked
                  readOnly
                />
                <div className="engine-debug-meta" data-testid="matrix-coverage">
                  Coverage: {debugMatrixData.coverage}/9
                </div>
                <div className="engine-debug-meta">
                  Gravity suggests next input toward:{' '}
                  {debugMatrixData.rows.find((row) => row.key === debugMatrixData.targetCell.row)
                    ?.label}{' '}
                  ×{' '}
                  {debugMatrixData.cols.find((col) => col.key === debugMatrixData.targetCell.col)
                    ?.label}
                </div>
                <div className="engine-debug-grid">
                  <div className="engine-debug-corner" />
                  {debugMatrixData.cols.map((col) => (
                    <div key={col.key} className="engine-debug-col-label">
                      {col.label}
                    </div>
                  ))}
                  {debugMatrixData.rows.map((row) => (
                    <div key={row.key} className="engine-debug-row">
                      <div className="engine-debug-row-label">{row.label}</div>
                      {debugMatrixData.cols.map((col) => {
                        const matrixKey = debugMatrixData.cellKey(row.key, col.key)
                        const cell = debugMatrixData.cells.get(matrixKey)
                        const isTarget =
                          debugMatrixData.targetCell.row === row.key &&
                          debugMatrixData.targetCell.col === col.key
                        return (
                          <div
                            key={matrixKey}
                            className={`engine-debug-cell ${isTarget ? 'target' : ''}`}
                            data-testid={`matrix-cell-${row.key}-${col.key}`}
                          >
                            <div className="engine-debug-count">{cell?.count ?? 0}</div>
                            <div className="engine-debug-items">
                              {(cell?.entries ?? []).map((entry) => (
                                <div key={entry.id} className="engine-debug-item" title={entry.text}>
                                  {entry.text}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {engineNamePromptOpen && !enginePreviewSessionId && (
            <section className="engine-panel">
              <div className="engine-name-prompt">
                <div className="engine-helper">{copy.engineNamePrompt}</div>
                <label>
                  <span>{copy.engineNameLabel}</span>
                  <input
                    data-testid="session-name-input"
                    value={engineNameDraft}
                    onChange={(event) => {
                      handleEngineNameDraftChange(event.target.value)
                    }}
                    placeholder={copy.engineNamePlaceholder}
                  />
                </label>
                <div className="engine-facilitation-actions">
                  {engineNameError && (
                    <span className="text-sm text-red-600">{engineNameError}</span>
                  )}
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-name-save"
                    disabled={engineNameSaving}
                    onClick={() => {
                      void submitEngineNamePrompt()
                    }}
                  >
                    {copy.engineNameSave}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={cancelEngineNamePrompt}
                  >
                    {copy.cancel}
                  </button>
                </div>
              </div>
            </section>
          )}

          {enginePreviewSessionId && diagnosticsPlatform.showDiagnostics && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{uiLanguage === 'Polish' ? 'Matryca pytań' : 'Question matrix'}</h2>
                <div className="engine-helper">
                  {uiLanguage === 'Polish'
                    ? 'Liczba zadanych pytań w kategoriach + aktualna kategoria'
                    : 'Question counts by category + current question category'}
                </div>
              </div>
              <div className="engine-question-matrix">
                <div className="engine-question-matrix-corner" />
                {questionMatrix.cols.map((col) => (
                  <div key={col.key} className="engine-question-matrix-col">
                    {uiLanguage === 'Polish' ? col.labelPl : col.labelEn}
                  </div>
                ))}
                {questionMatrix.rows.map((row) => (
                  <div key={row.key} className="engine-question-matrix-row">
                    <div className="engine-question-matrix-row-label">
                      {uiLanguage === 'Polish' ? row.labelPl : row.labelEn}
                    </div>
                    {questionMatrix.cols.map((col) => {
                      const key = `${row.key}${col.key}`
                      const count = questionMatrix.counts[key] || 0
                      const isCurrent = questionMatrix.currentKey === key
                      return (
                        <div
                          key={key}
                          className={`engine-question-matrix-cell ${isCurrent ? 'is-current' : ''}`}
                        >
                          <span className="engine-question-matrix-count">{count}</span>
                          <span className="engine-question-matrix-code">{key}</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}

          {enginePreviewSessionId && engineInitialBriefOpen && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{copy.engineInitialBriefTitle}</h2>
              </div>
              <div className="engine-helper">{copy.engineInitialBriefDescription}</div>
              <div className="engine-board-input">
                <div className="engine-input-field engine-input-field-with-action">
                  <textarea
                    ref={engineInitialBriefInputRef}
                    data-testid="engine-initial-brief-input"
                    value={getEngineInitialBriefDisplayedText()}
                    onChange={(event) => {
                      if (engineInitialBriefVoiceState === 'listening') {
                        stopEngineInitialBriefRecognition('abort')
                        setEngineInitialBriefVoiceState('idle')
                        setEngineInitialBriefVoicePreview('')
                      }
                      engineInitialBriefVoiceCorrectionSeqRef.current += 1
                      applyEngineInitialBriefTextChange(event.target.value)
                      autosizeTextarea(event.currentTarget)
                    }}
                    placeholder={copy.engineInitialBriefPlaceholder}
                    rows={6}
                  />
                  <button
                    type="button"
                    className={`ghost engine-input-action engine-input-action--voice is-${engineInitialBriefVoiceState}`}
                    aria-label={
                      engineInitialBriefVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel
                    }
                    title={
                      engineInitialBriefVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : engineInitialBriefVoiceState === 'unavailable'
                          ? copy.engineInitialBriefVoiceInputUnavailable
                          : copy.engineInitialBriefVoiceInputLabel
                    }
                    onClick={toggleEngineInitialBriefVoiceInput}
                    data-testid="engine-initial-brief-voice-input"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path
                        d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
                        fill="currentColor"
                      />
                    </svg>
                    <span>
                      {engineInitialBriefVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel}
                    </span>
                  </button>
                </div>
                {engineInitialBriefError && (
                  <div className="engine-error">{engineInitialBriefError}</div>
                )}
                <div className={`engine-brief-length-guide is-${engineInitialBriefLengthState}`}>
                  <div className="engine-brief-length-guide__header">
                    <span>{copy.engineInitialBriefLengthTarget}</span>
                    <span>
                      {copy.engineInitialBriefLengthCount(
                        engineInitialBriefWords,
                        INITIAL_BRIEF_RECOMMENDED_WORD_TARGET
                      )}
                    </span>
                  </div>
                  <div
                    className="engine-brief-length-guide__bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={INITIAL_BRIEF_RECOMMENDED_WORD_TARGET}
                    aria-valuenow={Math.min(
                      engineInitialBriefWords,
                      INITIAL_BRIEF_RECOMMENDED_WORD_TARGET
                    )}
                    aria-label={copy.engineInitialBriefLengthTarget}
                  >
                    <span
                      className="engine-brief-length-guide__fill"
                      style={{ width: `${engineInitialBriefRecommendedPercent}%` }}
                    />
                  </div>
                  <div className="engine-brief-length-guide__footer">
                    <span>{engineInitialBriefLengthMessage}</span>
                  </div>
                </div>
                <div className="engine-input-footer">
                  <span className="engine-word-count">
                    {isEngineInitialBriefLimitReached
                      ? copy.engineInitialBriefWordLimitReached
                      : copy.engineInitialBriefWordCountRemaining(engineInitialBriefRemainingWords)}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    data-testid="engine-initial-brief-submit"
                    onClick={() => {
                      void submitEngineInitialBrief()
                    }}
                    disabled={
                      !hasEnoughEngineInitialBriefContent ||
                      engineInitialBriefSubmitting ||
                      engineInitialBriefWords > INITIAL_BRIEF_WORD_LIMIT ||
                      Boolean(
                        authPlatform.authSession?.user?.id &&
                          authPlatform.client &&
                          billingPlatform.sessionCreatePriceLoading
                      )
                    }
                  >
                    {engineInitialBriefSubmitting && (
                      <span className="button-spinner" aria-hidden="true" />
                    )}
                    {engineInitialBriefSubmitting
                      ? copy.engineInitialBriefSubmitting
                      : engineInitialBriefSubmitLabel}
                  </button>
                </div>
              </div>
            </section>
          )}

          {enginePreviewSessionId && !engineInitialBriefOpen && (
            <>
              {actionPlanReadinessEnabled && (
                <section className="engine-panel">
                  <div className="engine-panel-header">
                    <div className="action-plan-readiness-title-row">
                      <h2>
                        {uiLanguage === 'Polish'
                          ? 'Jak zwiększyć gotowość planu działania'
                          : 'Action plan readiness guide'}
                      </h2>
                      {actionPlanReadinessLlmCache.loading && (
                        <span
                          className="button-spinner button-spinner--dark action-plan-readiness-title-spinner"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                  <div className="engine-helper">
                    {(() => {
                      if (!enginePreviewItems.length) {
                        return (
                          <div className="action-plan-readiness-layout">
                            <div className="action-plan-readiness-layout__content" />
                            <div className="action-plan-readiness-layout__gauge">
                              <ActionPlanReadinessGauge
                                score={0}
                                level="not_ready"
                                language={uiLanguage === 'Polish' ? 'pl' : 'en'}
                              />
                            </div>
                          </div>
                        )
                      }

                      // Only block content while the request is actually in-flight.
                      // `pending` is a debounce marker and can stay true while items keep changing.
                      const readinessLlmLoading = actionPlanReadinessLlmCache.loading
                      const finalScore = actionPlanReadinessHeuristic.score
                      if (readinessLlmLoading) {
                        return (
                          <div className="action-plan-readiness-layout">
                            <div className="action-plan-readiness-layout__content" />
                            <div className="action-plan-readiness-layout__gauge">
                              <ActionPlanReadinessGauge
                                score={finalScore}
                                level={
                                  actionPlanReadinessHeuristic.level === 'weak'
                                    ? 'not_ready'
                                    : actionPlanReadinessHeuristic.level === 'strong'
                                      ? 'strong_material'
                                      : 'can_proceed'
                                }
                                language={uiLanguage === 'Polish' ? 'pl' : 'en'}
                              />
                            </div>
                          </div>
                        )
                      }

                      const description = (() => {
                        if (uiLanguage === 'Polish') {
                          if (actionPlanReadinessMeaningfulCount < 3) {
                            return 'Masz jeszcze za mało wpisów, żeby plan działania był konkretny.'
                          }
                          if (
                            actionPlanReadinessMeaningfulCount >= 3 &&
                            actionPlanReadinessHeuristic.notWorkingMeaningfulCount < 3
                          ) {
                            return 'Twój materiał jest jeszcze jednostronny — skupia się na tym, jak powinno być, ale brakuje tego, co nie działa.'
                          }
                          if (actionPlanReadinessHeuristic.coverage < 2) {
                            return 'Materiał jest jeszcze wąski (brakuje perspektyw). Uzupełnij go, aby decyzje były lepiej ugruntowane.'
                          }
                          if (actionPlanReadinessHeuristic.coverage === 3) {
                            return 'Materiał jest zbalansowany i powinien dać sensowne priorytety, decyzje i kolejne kroki.'
                          }
                          return 'Materiał wygląda wystarczająco, ale można go jeszcze wzmocnić, żeby plan działania był bardziej trafny.'
                        }
                        if (actionPlanReadinessMeaningfulCount < 3) {
                          return 'There are not enough entries yet for a concrete action plan.'
                        }
                        if (
                          actionPlanReadinessMeaningfulCount >= 3 &&
                          actionPlanReadinessHeuristic.notWorkingMeaningfulCount < 3
                        ) {
                          return 'The material is still one-sided — it focuses on what should be, but misses what is not working.'
                        }
                        if (actionPlanReadinessHeuristic.coverage < 2) {
                          return 'The material is still narrow (missing perspectives). Add more for better grounded decisions.'
                        }
                        if (actionPlanReadinessHeuristic.coverage === 3) {
                          return 'The material is balanced and should yield clearer priorities, decisions, and next steps.'
                        }
                        return 'The material looks sufficient, but you can still strengthen it to make the action plan more grounded.'
                      })()

                      const llmSummary = actionPlanReadinessLlmCache.lastLLMResult?.summary || ''
                      const llmHowToBoost = actionPlanReadinessLlmCache.lastLLMResult?.howToBoost || ''
                      const llmBiggestBoostRightNow =
                        actionPlanReadinessLlmCache.lastLLMResult?.biggestBoostRightNow || ''

                      const summaryText = llmSummary || description
                      const howToBoostText =
                        llmHowToBoost ||
                        actionPlanReadinessHeuristic.improvements.slice(0, 3).join(' · ')
                      const biggestBoostRightNowText =
                        llmBiggestBoostRightNow || actionPlanReadinessHeuristic.nextBestAction || ''
                      const normalizeReadinessLine = (value: string) =>
                        String(value || '').replace(/\s+/g, ' ').trim()
                      const shouldShowHowToBoost = Boolean(
                        normalizeReadinessLine(howToBoostText) &&
                          normalizeReadinessLine(howToBoostText) !==
                            normalizeReadinessLine(biggestBoostRightNowText)
                      )
                      return (
                        <div className="action-plan-readiness-layout">
                          <div className="action-plan-readiness-layout__content">
                            <div className="action-plan-readiness-field">
                              <div className="engine-meta">
                                <span>{uiLanguage === 'Polish' ? 'Opis' : 'Summary'}</span>
                                <span className="engine-meta-value">{summaryText}</span>
                              </div>
                            </div>
                            {shouldShowHowToBoost && (
                              <div className="action-plan-readiness-field">
                                <div className="engine-meta">
                                  <span>
                                    {uiLanguage === 'Polish' ? 'Jak podnieść wynik' : 'How to boost'}
                                  </span>
                                  <span className="engine-meta-value">{howToBoostText}</span>
                                </div>
                              </div>
                            )}
                            {biggestBoostRightNowText && (
                              <div className="action-plan-readiness-field is-boost-now">
                                <div className="engine-meta">
                                  <span>
                                    {uiLanguage === 'Polish'
                                      ? 'Najbardziej pomoże teraz'
                                      : 'Biggest boost right now'}
                                  </span>
                                  <span className="engine-meta-value">{biggestBoostRightNowText}</span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="action-plan-readiness-layout__gauge">
                            <ActionPlanReadinessGauge
                              score={finalScore}
                              level={
                                actionPlanReadinessHeuristic.level === 'weak'
                                  ? 'not_ready'
                                  : actionPlanReadinessHeuristic.level === 'strong'
                                    ? 'strong_material'
                                    : 'can_proceed'
                              }
                              language={uiLanguage === 'Polish' ? 'pl' : 'en'}
                            />
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </section>
              )}

              <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{copy.enginePreviewBoardItemsTitle}</h2>
                {diagnosticsPlatform.showDiagnostics && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={assignNaItems}
                    disabled={
                      engineAssignLoading ||
                      engineUnassignedItems.length === 0 ||
                      !aiPlatform.aiSupportEnabled ||
                      !engineSessionPersisted
                    }
                    title={
                      !aiPlatform.aiSupportEnabled
                        ? notices.aiDisabled
                        : !engineSessionPersisted
                          ? notices.createSessionFirst
                          : engineUnassignedItems.length === 0
                          ? notices.noNaEntries
                          : notices.assignNaAction
                    }
                  >
                    {engineAssignLoading ? notices.assignNaLoading : notices.assignNaAction}
                  </button>
                )}
                {highlightMissingLabels && missingLabelCount > 0 && (
                  <span className="engine-missing-label-hint">{copy.missingLabelHint}</span>
                )}
                <button
                  type="button"
                  className={`ghost engine-help-trigger engine-facilitation-actions--fade ${
                    showHelpButton ? 'is-visible' : 'is-hidden'
                  }`}
                  aria-label={copy.engineHelpButtonLabel}
                  onClick={() => {
                    clearEngineIdleTimer('manual_help')
                    engineIdleTriggered.current = false
                    engineIdleArmedRef.current = false
                    setEngineLastInputActivityAt(Date.now())
                    setEngineOfferReason('manual')
                    if (engineUiState !== 'FACILITATED_INPUT') {
                      setEngineUiState('FACILITATION_OFFER')
                    }
                  }}
                >
                  ?
                </button>
              </div>
              {uiLanguage === 'English' && copy.engineQuestionsWipNote && (
                <div className="engine-helper">{copy.engineQuestionsWipNote}</div>
              )}
              <div
                className={`engine-facilitation-offer engine-facilitation-actions--fade ${
                  showFacilitationOffer ? 'is-visible' : 'is-hidden'
                }`}
                aria-hidden={!showFacilitationOffer}
              >
                <div
                  className="engine-helper engine-facilitation-note"
                  style={
                    uiLanguage === 'English'
                      ? { transform: 'translate(-75px, -5px)' }
                      : undefined
                  }
                >
                  {copy.engineFacilitationNote}
                </div>
                <div
                  className="engine-facilitation-actions"
                  data-testid="facilitation-buttons"
                >
                  {engineFacilitationInlineError && (
                    <span className="text-sm text-red-600">{engineFacilitationInlineError}</span>
                  )}
                  {facilitationPerspectiveActions.map((action) => {
                    const isActive = engineActiveFacilitationPerspective === action.key
                    return (
                      <button
                        key={action.key}
                        type="button"
                        className={`ghost engine-facilitation-perspective-button ${action.toneClass} ${
                          isActive ? 'is-active' : ''
                        }`}
                        data-testid={action.testId}
                        onClick={() => {
                          if (facilitationDisabled) {
                            setEngineFacilitationInlineError(notices.createSessionFirst)
                            return
                          }
                          const nextType = resolveFacilitationRequestType(action.key)
                          diagnosticsPlatform.setFacilitationCooldown(`${nextType}:${action.key}`)
                          armIdleWatch(
                            nextType === 'DEEPEN'
                              ? `facilitation_continue_${action.key}`
                              : `facilitation_switch_${action.key}`
                          )
                          void activateFacilitationPrompt(nextType, action.key)
                        }}
                        disabled={
                          !showFacilitationOffer || engineFacilitationLoading || facilitationDisabled
                        }
                      >
                        {action.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {enginePreviewError && (
                <div className="engine-error">
                  <span>{enginePreviewError}</span>
                  {lastFacilitationType && lastFacilitationPerspective && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        void activateFacilitationPrompt(
                          lastFacilitationType,
                          lastFacilitationPerspective
                        )
                      }}
                    >
                      {copy.engineFacilitationRetryCta}
                    </button>
                  )}
                </div>
              )}
              <div className="engine-board-input">
                {(engineFacilitationLoading && showEngineFacilitationLoadingUI
                  ? copy.engineFacilitationLoadingPerspective
                  : engineActivePrompt?.text) && (
                  <div
                    className={`engine-helper engine-facilitation-prompt ${
                      lastFacilitationPerspective === 'as_is'
                        ? 'is-as-is'
                        : lastFacilitationPerspective === 'not_working'
                          ? 'is-not-working'
                          : lastFacilitationPerspective === 'should_be'
                            ? 'is-should-be'
                            : ''
                    }`}
                  >
                    <div className="engine-facilitation-question">
                      {engineFacilitationLoading && showEngineFacilitationLoadingUI ? (
                        <span className="engine-facilitation-loading-row">
                          <span className="button-spinner" aria-hidden="true" />
                          <span className="engine-facilitation-loading-text">
                            {engineFacilitationLoadingType === 'DEEPEN'
                              ? copy.engineFacilitationLoadingDeepen
                              : copy.engineFacilitationLoadingPerspective}
                          </span>
                        </span>
                      ) : (
                        <>
                          {showFirstQuestionWrapper && facilitationIntroRef.current ? (
                            <div className="engine-facilitation-intro">
                              {facilitationIntroRef.current}
                            </div>
                          ) : null}
                          <div>{engineActivePrompt?.text}</div>
                        </>
                      )}
                    </div>
                    {!engineFacilitationLoading &&
                      diagnosticsPlatform.showDiagnostics &&
                      enginePromptSource && (
                      <span className="impulse-source-row">
                        <span
                          className={`impulse-source-chip ${
                            enginePromptSource === 'fallback' ? 'fallback' : 'ai'
                          }`}
                        >
                          {enginePromptSource === 'fallback'
                            ? copy.impulseSourceFallback
                            : copy.impulseSourceAi}
                        </span>
                        {import.meta.env.DEV && (
                          <span className="impulse-source-note">
                            {lastLlmSource === 'llm'
                              ? copy.impulseSourceAiGenerated
                              : copy.impulseSourceDeterministic}
                            {lastLlmWhy ? ` · ${lastLlmWhy}` : ''}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`engine-input-field engine-input-field-with-action ${
                    engineDraftToneClass ? `is-targeted ${engineDraftToneClass}` : ''
                  }`}
                >
                  {showEngineInputCaret && <span className="engine-input-caret" aria-hidden="true" />}
                  <textarea
                    data-testid="engine-input"
                    ref={engineInputRef}
                    value={enginePreviewInput}
                    onChange={(event) => {
                      if (enginePreviewVoiceState === 'listening') {
                        stopEnginePreviewRecognition('abort')
                        setEnginePreviewVoiceState('idle')
                      }
                      handleEnginePreviewInputChange(event)
                      engineIdleTriggered.current = false
                      clearEngineIdleTimer('input_change')
                      setEngineLastInputActivityAt(Date.now())
                      logFacilitationEvent('idle_timer_reset', { reason: 'input_change', at: Date.now() })
                    }}
                    onPointerDown={() => {
                      markUserInitiatedInteraction('pointer')
                      engineAllowIdleWithoutFocusRef.current = false
                      if (engineUiState === 'INIT') {
                        setEngineUiState('FREE_FLOW')
                      }
                      engineIdleTriggered.current = false
                      clearEngineIdleTimer('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      logFacilitationEvent('idle_timer_reset', { reason: 'pointer', at: Date.now() })
                    }}
                    onKeyDown={() => {
                      markUserInitiatedInteraction('keystroke')
                      engineAllowIdleWithoutFocusRef.current = false
                      if (engineOfferReason) {
                        setEngineOfferReason(null)
                        if (engineUiState === 'FACILITATION_OFFER') {
                          setEngineUiState('FREE_FLOW')
                        }
                      }
                      if (engineUiState === 'INIT') {
                        setEngineUiState('FREE_FLOW')
                      }
                      engineIdleTriggered.current = false
                      clearEngineIdleTimer('keystroke')
                      setEngineLastInputActivityAt(Date.now())
                      logFacilitationEvent('idle_timer_reset', { reason: 'keystroke', at: Date.now() })
                    }}
                    onFocus={() => {
                      setEngineInputFocused(true)
                      engineAllowIdleWithoutFocusRef.current = false
                      logFacilitationEvent('input_focus', { sessionId: getEngineSessionKey() })
                    }}
                    onBlur={() => {
                      setEngineInputFocused(false)
                      clearEngineIdleTimer('input_blur')
                      logFacilitationEvent('input_blur', { sessionId: getEngineSessionKey() })
                    }}
                    placeholder={enginePlaceholder}
                    rows={3}
                  />
                  <button
                    type="button"
                    className={`ghost engine-input-action engine-input-action--voice is-${enginePreviewVoiceState}`}
                    aria-label={
                      enginePreviewVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel
                    }
                    title={
                      enginePreviewVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : enginePreviewVoiceState === 'unavailable'
                          ? copy.engineInitialBriefVoiceInputUnavailable
                          : copy.engineInitialBriefVoiceInputLabel
                    }
                    onClick={toggleEnginePreviewVoiceInput}
                    data-testid="engine-input-voice"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path
                        d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
                        fill="currentColor"
                      />
                    </svg>
                    <span>
                      {enginePreviewVoiceState === 'listening'
                        ? copy.engineInitialBriefVoiceInputListening
                        : copy.engineInitialBriefVoiceInputLabel}
                    </span>
                  </button>
                </div>
                {enginePreviewVoiceError && (
                  <div className="engine-helper">{enginePreviewVoiceError}</div>
                )}
                <div className="engine-input-footer">
                  <span className="engine-word-count">
                    {isEngineWordLimitReached
                      ? copy.engineWordLimitReached
                      : copy.engineWordCountRemaining(engineRemainingWords)}
                  </span>
                  <div className="engine-input-footer-actions">
                    {showEngineDraftRemove && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={clearEngineDraftTarget}
                      >
                        {copy.engineDraftRemoveEntry}
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary"
                      data-testid="add-entry"
                      onClick={() => {
                        if (engineAddEntryLoading) return
                        const syncedText = syncEnginePreviewVoiceTranscript()
                        if (syncedText === null) return
                        if (enginePreviewVoiceState === 'listening') {
                          stopEnginePreviewRecognition('stop')
                          setEnginePreviewVoiceState('idle')
                        }
                        markUserInitiatedInteraction('pointer')
                        setEngineLastInputActivityAt(Date.now())
                        setEngineInputFocused(true)
                        engineAllowIdleWithoutFocusRef.current = true
                        armIdleWatch('add_item')
                        engineInputRef.current?.focus()
                        void handleEnginePreviewAdd(undefined, syncedText, engineDraftTargetSection)
                      }}
                      disabled={!enginePreviewInput.trim() || engineAddEntryLoading}
                    >
                      {engineAddEntryLoading && <span className="button-spinner" aria-hidden="true" />}
                      {copy.enginePreviewAddItem}
                    </button>
                  </div>
                </div>
              </div>
              {enginePreviewItems.length === 0 ? (
                <div className="engine-empty">{copy.enginePreviewBoardItemsEmpty}</div>
              ) : (
                <div className="engine-perspective-board" key={`engine-board-${engineBoardLayoutVersion}`}>
                  {enginePerspectiveSections.map((section) => (
                    <section
                      key={section.key}
                      className={`engine-perspective-section ${section.toneClass} ${
                        engineDragOverSection === section.key ? 'is-drop-target' : ''
                      } ${engineDraggingEntryId ? 'is-drag-active' : ''}`}
                      onDragOver={(event) =>
                        handleEngineSectionDragOver(
                          event,
                          section.key as EnginePerspectiveKey,
                          section.items.length
                        )
                      }
                      onDrop={(event) =>
                        void handleEngineSectionDrop(event, section.key as EnginePerspectiveKey)
                      }
                      onDragLeave={(event) =>
                        handleEngineSectionDragLeave(event, section.key as EnginePerspectiveKey)
                      }
                    >
                      <div className="engine-perspective-header">
                        <h3>{section.title}</h3>
                        <div className="engine-perspective-header-actions">
                          <button
                            type="button"
                            className={`engine-perspective-add-button ${
                              engineDraftTargetSection === section.key ? 'is-active' : ''
                            }`}
                            aria-label={copy.engineSectionAddEntryAria(section.title)}
                            title={copy.engineSectionAddEntryHint}
                            onClick={() => activateEngineDraftTarget(section.key as EnginePerspectiveKey)}
                          >
                            <span aria-hidden="true">+</span>
                          </button>
                          <span className="engine-perspective-count">{section.items.length}</span>
                        </div>
                      </div>
                      <ul className="engine-entry-list">
                        {(() => {
                          const renderedItems: Array<
                            | { kind: 'item'; item: EngineBoardItem; layoutClass: string; itemIndex: number }
                            | { kind: 'placeholder'; key: string; layoutClass: string }
                          > = []
                          section.items.forEach(({ item, layoutClass }, itemIndex) => {
                            if (
                              engineDraggingEntryId &&
                              engineDragOverSection === section.key &&
                              engineDragTargetIndex === itemIndex
                            ) {
                              const dragged = enginePreviewItems.find((entry) => entry.id === engineDraggingEntryId)
                              renderedItems.push({
                                kind: 'placeholder',
                                key: `placeholder-${section.key}-${itemIndex}`,
                                layoutClass: dragged ? resolveEngineEntryLayoutClass(dragged) : 'is-medium',
                              })
                            }
                            renderedItems.push({ kind: 'item', item, layoutClass, itemIndex })
                          })
                          if (
                            engineDraggingEntryId &&
                            engineDragOverSection === section.key &&
                            engineDragTargetIndex === section.items.length
                          ) {
                            const dragged = enginePreviewItems.find((entry) => entry.id === engineDraggingEntryId)
                            renderedItems.push({
                              kind: 'placeholder',
                              key: `placeholder-${section.key}-end`,
                              layoutClass: dragged ? resolveEngineEntryLayoutClass(dragged) : 'is-medium',
                            })
                          }

                          return renderedItems.map((rendered) => {
                            if (rendered.kind === 'placeholder') {
                              return (
                                <li
                                  key={rendered.key}
                                  className={`engine-entry engine-entry-placeholder ${rendered.layoutClass}`}
                                  aria-hidden="true"
                                />
                              )
                            }

                            const { item, layoutClass, itemIndex } = rendered
                            return (
                              <li
                                key={item.id}
                                ref={(node) => {
                                  if (node) {
                                    engineEntryNodesRef.current[item.id] = node
                                  } else {
                                    delete engineEntryNodesRef.current[item.id]
                                  }
                                }}
                                style={
                                  engineEntryRowSpans[item.id]
                                    ? { gridRowEnd: `span ${engineEntryRowSpans[item.id]}` }
                                    : undefined
                                }
                                className={`engine-entry ${layoutClass} ${
                                  engineDraggingEntryId === item.id ? 'is-dragging' : ''
                                } ${engineMovingEntryId === item.id ? 'is-moving' : ''} ${
                                  highlightMissingLabels && isMissingLabel(item) ? 'missing-label' : ''
                                }`}
                                data-testid={`entry-row-${item.id}`}
                                data-entry-id={item.id}
                                draggable={enginePreviewEditId !== item.id && engineMovingEntryId !== item.id}
                                onDragStart={(event) => handleEngineEntryDragStart(event, item)}
                                onDragEnd={handleEngineEntryDragEnd}
                                onDragOver={(event) =>
                                  handleEngineEntryDragOver(
                                    event,
                                    section.key as EnginePerspectiveKey,
                                    itemIndex
                                  )
                                }
                              >
                            {diagnosticsPlatform.showDiagnostics &&
                              (() => {
                                const cellId = getEntryCellId(item)
                                return (
                                  <button
                                    type="button"
                                    className={`engine-entry-cell ${cellId ? '' : 'is-na'}`}
                                    title={cellId ? `Cell ${cellId}` : 'N/A'}
                                    disabled
                                  >
                                    {cellId || 'N/A'}
                                  </button>
                                )
                              })()}
                            <div className="engine-entry-main">
                              {enginePreviewEditId === item.id ? (
                                <div className="engine-entry-edit" onClick={(event) => event.stopPropagation()}>
                                  <textarea
                                    className="engine-entry-edit-input"
                                    rows={3}
                                    value={enginePreviewEditText}
                                    onChange={(event) => {
                                      const next = limitWords(event.target.value, WORD_LIMIT)
                                      setEnginePreviewEditText(next)
                                    }}
                                  />
                                  <div className="engine-entry-edit-actions">
                                    <button
                                      type="button"
                                      className="primary"
                                      onClick={handleSaveEnginePreviewEdit}
                                      disabled={!enginePreviewEditText.trim()}
                                    >
                                      {copy.save}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={cancelEnginePreviewEdit}
                                    >
                                      {copy.cancel}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="engine-entry-text">{item.text}</div>
                              )}
                              {enginePreviewEditId !== item.id &&
                                engineEntryDeleteId !== item.id &&
                                engineLabelEditorId !== item.id && (
                                <div className="engine-entry-actions">
                                  <div className="engine-entry-question-help">
                                    <button
                                      type="button"
                                      className="engine-entry-question-button engine-entry-action"
                                      aria-label={copy.engineEntryQuestionHint}
                                      title={copy.engineEntryQuestionHint}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                      }}
                                    >
                                      ?
                                    </button>
                                    <div className="engine-entry-question-tooltip" role="note">
                                      {resolveEntryQuestionHelperText(item)}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="engine-entry-edit-button engine-entry-action"
                                    aria-label={copy.engineEntryEditHint}
                                    title={copy.engineEntryEditHint}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      startEnginePreviewEdit(item)
                                    }}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="engine-entry-delete-button engine-entry-action"
                                    aria-label={copy.engineEntryDeleteHint}
                                    title={copy.engineEntryDeleteHint}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openEngineEntryDeleteConfirm(item.id)
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="14"
                                      height="14"
                                      aria-hidden="true"
                                    >
                                      <path
                                        fill="currentColor"
                                        d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 1 0 0 2H6v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9zm1 2h4v1h-4V5zm-1 4a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1zm6 1a1 1 0 1 0-2 0v7a1 1 0 1 0 2 0v-7z"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="engine-entry-label-button engine-entry-action"
                                    aria-label={copy.engineEntryLabelActionHint}
                                    title={copy.engineEntryLabelActionHint}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleEngineLabelEditor(item.id)
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="14"
                                      height="14"
                                      aria-hidden="true"
                                    >
                                      <path
                                        fill="currentColor"
                                        d="M10.59 13.41a1 1 0 0 1 0-1.41l6.3-6.3a3 3 0 1 1 4.24 4.24l-6.3 6.3a1 1 0 0 1-1.41 0l-2.83-2.83ZM18.3 7.1l-5.6 5.6 1.41 1.41 5.6-5.6a1 1 0 0 0-1.41-1.41ZM3 6a3 3 0 0 1 3-3h6a1 1 0 1 1 0 2H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3a1 1 0 1 1 2 0v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Z"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              )}
                              <div className="engine-entry-label-group">
                                {highlightMissingLabels && isMissingLabel(item) && (
                                  <span className="engine-entry-missing-badge">
                                    {copy.missingLabelBadge}
                                  </span>
                                )}
                                {item.label && (
                                  <span
                                    className="engine-entry-label"
                                    data-testid={`entry-label-${item.id}`}
                                    style={{
                                      backgroundColor:
                                        withAlpha(ENGINE_ENTRY_LABEL_COLORS[item.label] || '#e7ebf0'),
                                      color: '#000000',
                                    }}
                                  >
                                    {uiLanguage === 'English'
                                      ? getEntryLabelText(item.label, 'English')
                                      : getEntryLabelText(item.label, 'Polish')}
                                  </span>
                                )}
                              </div>
                            </div>
                            {engineEntryDeleteId === item.id && (
                              <div
                                className="engine-entry-delete-confirm"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <span>{copy.engineEntryDeleteConfirm}</span>
                                <div className="engine-entry-delete-actions">
                                  <button
                                    type="button"
                                    className="primary"
                                    onClick={() => confirmEngineEntryDelete(item.id)}
                                  >
                                    {copy.engineEntryDeleteYes}
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={cancelEngineEntryDelete}
                                  >
                                    {copy.engineEntryDeleteCancel}
                                  </button>
                                </div>
                              </div>
                            )}
                            {engineLabelEditorId === item.id && (
                              <div
                                ref={engineLabelEditorRef}
                                className="engine-entry-label-editor"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <label className="engine-entry-label-field">
                                  <span className="sr-only">Etykieta wpisu</span>
                                  <select
                                    ref={engineLabelSelectRef}
                                    data-testid={`entry-label-select-${item.id}`}
                                    value={item.label ?? ''}
                                    onChange={(event) => {
                                      const nextValue = event.target.value || null
                                      handleEngineEntryLabelChange(item.id, nextValue)
                                    }}
                                  >
                                  <option value="">{getNoLabelText(uiLanguage)}</option>
                                  {ENGINE_ENTRY_LABELS.map((label) => (
                                    <option key={label} value={label}>
                                      {getEntryLabelText(label, uiLanguage)}
                                    </option>
                                  ))}
                                  </select>
                                </label>
                              </div>
                            )}
                              </li>
                            )
                          })
                        })()}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
              </section>
            </>
          )}
        </main>
          {feedbackPanel}
          {feedbackFab}
          {missingLabelModal}
        </div>

  )
}
