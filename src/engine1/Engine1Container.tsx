import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { Engine1App, type Engine1AppProps } from './Engine1App'
import type { EnginePerspectiveKey } from './types'

type CreateNamedEngineSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error?: 'SESSION_NAME_COLLISION' | 'SESSION_NAME_SAVE_FAILED' }

type EnginePreviewAddResult = 'needs_name' | void

type Engine1ContainerProps = Omit<
  Engine1AppProps,
  | 'cancelEngineEntryDelete'
  | 'cancelEngineNamePrompt'
  | 'closeEngineLabelEditor'
  | 'confirmEngineEntryDelete'
  | 'engineNameDraft'
  | 'engineNameError'
  | 'engineNamePromptOpen'
  | 'engineNameSaving'
  | 'engineEntryDeleteId'
  | 'engineLabelEditorId'
  | 'engineLabelEditorRef'
  | 'engineLabelSelectRef'
  | 'fetchEngineSessions'
  | 'flushEngineEntryLabels'
  | 'handleEngineEntryLabelChange'
  | 'handleEngineNameDraftChange'
  | 'handleEnginePreviewAdd'
  | 'isMissingLabel'
  | 'missingLabelModal'
  | 'openEngineEntryDeleteConfirm'
  | 'resumeNamePromptAfterList'
  | 'setEngineEntryDeleteId'
  | 'setEngineLabelEditorId'
  | 'startNewSession'
  | 'submitEngineNamePrompt'
  | 'toggleEngineLabelEditor'
  | 'toggleEngineSessionsList'
  | 'updateEngineEntryLabel'
> & {
  createNamedEngineSession: (payload: {
    name: string
    shouldShowInitialBrief: boolean
  }) => Promise<CreateNamedEngineSessionResult>
  deleteEngineEntry: (entryId: string) => Promise<boolean> | boolean
  enginePendingArmingRef: MutableRefObject<boolean>
  enginePendingFocusRef: MutableRefObject<boolean>
  fetchEngineSessions: () => Promise<void> | void
  flushEngineEntryLabels: () => Promise<void> | void
  handleEnginePreviewAdd: (
    nameOverride?: string,
    textOverride?: string,
    targetSectionOverride?: EnginePerspectiveKey | null
  ) => Promise<EnginePreviewAddResult> | EnginePreviewAddResult
  renderMissingLabelModal: (openLabelEditor: (entryId: string) => void) => ReactNode
  startNewSession: () => Promise<boolean> | boolean
  updateEngineEntryLabel: (entryId: string, label: string | null) => Promise<boolean> | boolean
}

export function Engine1Container(props: Engine1ContainerProps) {
  const [engineLabelEditorId, setEngineLabelEditorId] = useState<string | null>(null)
  const [engineEntryDeleteId, setEngineEntryDeleteId] = useState<string | null>(null)
  const [engineNamePromptOpen, setEngineNamePromptOpen] = useState(false)
  const [engineNameDraft, setEngineNameDraft] = useState('')
  const [engineNameError, setEngineNameError] = useState<string | null>(null)
  const [engineNameSaving, setEngineNameSaving] = useState(false)
  const [resumeNamePromptAfterList, setResumeNamePromptAfterList] = useState(false)
  const engineLabelEditorRef = useRef<HTMLDivElement | null>(null)
  const engineLabelSelectRef = useRef<HTMLSelectElement | null>(null)

  useEffect(() => {
    if (!engineLabelEditorId) return
    const handleClick = (event: MouseEvent) => {
      if (!engineLabelEditorRef.current) return
      if (!engineLabelEditorRef.current.contains(event.target as Node)) {
        setEngineLabelEditorId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [engineLabelEditorId])

  useEffect(() => {
    if (!engineLabelEditorId || typeof window === 'undefined') return
    const select = engineLabelSelectRef.current
    if (!select) return

    const frame = window.requestAnimationFrame(() => {
      const currentSelect = engineLabelSelectRef.current
      if (!currentSelect) return
      currentSelect.focus()
      const pickerSelect = currentSelect as HTMLSelectElement & {
        showPicker?: () => void
      }
      if (typeof pickerSelect.showPicker === 'function') {
        pickerSelect.showPicker()
        return
      }
      currentSelect.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      currentSelect.click()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [engineLabelEditorId])

  useEffect(() => {
    if (engineLabelEditorId && !props.enginePreviewItems.some((item) => item.id === engineLabelEditorId)) {
      setEngineLabelEditorId(null)
    }
    if (engineEntryDeleteId && !props.enginePreviewItems.some((item) => item.id === engineEntryDeleteId)) {
      setEngineEntryDeleteId(null)
    }
  }, [engineEntryDeleteId, engineLabelEditorId, props.enginePreviewItems])

  useEffect(() => {
    setEngineNameError(null)
  }, [props.uiLanguage])

  useEffect(() => {
    if (!props.enginePreviewSessionId) return
    setEngineNamePromptOpen(false)
    setEngineNameDraft('')
    setEngineNameError(null)
    setEngineNameSaving(false)
    setResumeNamePromptAfterList(false)
  }, [props.enginePreviewSessionId])

  const markUserInitiatedInteraction = (source: 'pointer' | 'keystroke') => {
    const key = props.getEngineSessionKey()
    if (props.engineInteractionBySession.current[key]) return
    props.engineInteractionBySession.current[key] = true
    props.logFacilitationEvent('user_interaction_armed', { source, sessionId: key })
  }

  const openEngineNamePrompt = () => {
    setEngineNameDraft('')
    setEngineNamePromptOpen(true)
  }

  const startNewSession = async () => {
    const ready = await props.startNewSession()
    if (!ready) return
    openEngineNamePrompt()
  }

  const handleEnginePreviewAdd: Engine1ContainerProps['handleEnginePreviewAdd'] = async (
    nameOverride,
    textOverride,
    targetSectionOverride
  ) => {
    const result = await props.handleEnginePreviewAdd(
      nameOverride,
      textOverride,
      targetSectionOverride
    )
    if (result === 'needs_name') {
      openEngineNamePrompt()
    }
    return result
  }

  const toggleEngineSessionsList = async () => {
    const next = !props.engineSessionsOpen
    if (next) await props.flushEngineEntryLabels()
    props.setEngineSessionsOpen(next)
    if (next) {
      if (engineNamePromptOpen) {
        setResumeNamePromptAfterList(true)
        setEngineNamePromptOpen(false)
      }
      if (engineNameError) setEngineNameError(null)
    } else if (!props.enginePreviewSessionId && resumeNamePromptAfterList) {
      setEngineNamePromptOpen(true)
      setResumeNamePromptAfterList(false)
    }
    if (next) props.fetchEngineSessions()
  }

  const handleEngineNameDraftChange = (value: string) => {
    setEngineNameDraft(value.slice(0, 40))
    if (engineNameError) setEngineNameError(null)
  }

  const cancelEngineNamePrompt = () => {
    setEngineNamePromptOpen(false)
  }

  const toggleEngineLabelEditor = (entryId: string) => {
    setEngineLabelEditorId((prev) => (prev === entryId ? null : entryId))
  }

  const closeEngineLabelEditor = () => {
    setEngineLabelEditorId(null)
  }

  const handleEngineEntryLabelChange = (entryId: string, label: string | null) => {
    props.armIdleWatch('label_change')
    props.setEngineLastInputActivityAt(Date.now())
    void props.updateEngineEntryLabel(entryId, label)
    setEngineLabelEditorId(null)
  }

  const openEngineEntryDeleteConfirm = (entryId: string) => {
    setEngineEntryDeleteId(entryId)
  }

  const cancelEngineEntryDelete = () => {
    setEngineEntryDeleteId(null)
  }

  const confirmEngineEntryDelete = async (entryId: string) => {
    const deleted = await props.deleteEngineEntry(entryId)
    if (deleted && engineLabelEditorId === entryId) setEngineLabelEditorId(null)
    setEngineEntryDeleteId(null)
  }

  const submitEngineNamePrompt = async () => {
    markUserInitiatedInteraction('pointer')
    props.setEngineLastInputActivityAt(Date.now())
    if (engineNameSaving) return
    const name = engineNameDraft.trim().replace(/\s+/g, ' ')
    if (!name) {
      setEngineNameError(props.notices.sessionNameRequired)
      return
    }
    setEngineNameSaving(true)
    setEngineNameError(null)
    props.armIdleWatch('save_and_continue')
    props.engineInteractionBySession.current['new'] = true
    props.setEngineInputFocused(false)
    props.setEngineUiState('INIT')
    props.enginePendingArmingRef.current = false
    props.enginePendingFocusRef.current = false
    const shouldShowInitialBrief = Boolean(
      props.authPlatform.authSession?.user?.id && props.authPlatform.client
    )
    const result = await props.createNamedEngineSession({
      name,
      shouldShowInitialBrief,
    })
    if (!result.ok) {
      if (result.error === 'SESSION_NAME_COLLISION') {
        setEngineNameError(props.notices.sessionNameCollision)
      } else if (result.error === 'SESSION_NAME_SAVE_FAILED') {
        setEngineNameError(props.notices.sessionNameSaveFailed)
      }
      setEngineNameSaving(false)
      return
    }
    setEngineNamePromptOpen(false)
    setEngineNameSaving(false)
    markUserInitiatedInteraction('pointer')
    props.setEngineLastInputActivityAt(Date.now())
  }

  return (
    <Engine1App
      {...props}
      cancelEngineNamePrompt={cancelEngineNamePrompt}
      cancelEngineEntryDelete={cancelEngineEntryDelete}
      closeEngineLabelEditor={closeEngineLabelEditor}
      confirmEngineEntryDelete={confirmEngineEntryDelete}
      engineEntryDeleteId={engineEntryDeleteId}
      engineLabelEditorId={engineLabelEditorId}
      engineLabelEditorRef={engineLabelEditorRef}
      engineLabelSelectRef={engineLabelSelectRef}
      engineNameDraft={engineNameDraft}
      engineNameError={engineNameError}
      engineNamePromptOpen={engineNamePromptOpen}
      engineNameSaving={engineNameSaving}
      handleEngineEntryLabelChange={handleEngineEntryLabelChange}
      handleEngineNameDraftChange={handleEngineNameDraftChange}
      handleEnginePreviewAdd={handleEnginePreviewAdd}
      missingLabelModal={props.renderMissingLabelModal(setEngineLabelEditorId)}
      openEngineEntryDeleteConfirm={openEngineEntryDeleteConfirm}
      startNewSession={startNewSession}
      submitEngineNamePrompt={submitEngineNamePrompt}
      toggleEngineSessionsList={toggleEngineSessionsList}
      toggleEngineLabelEditor={toggleEngineLabelEditor}
    />
  )
}
