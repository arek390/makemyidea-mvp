import type { Dispatch, DragEvent, SetStateAction } from 'react'
import type { Idea, LabelItem, Language, Scenario, StepId, Translations } from '../App'

type LegacyReportData = {
  step1: { productName: string; spaces: string[]; times: string[] }
  step2: { totalScenarios: number; selectedScenario: string | null }
  step3: { spaceDefs: Scenario['spaceDefs']; timeDefs: Scenario['timeDefs'] } | null
  step4: { totalIdeas: number; cellsWithIdeas: number; userIdeas: string[]; llmIdeas: string[] }
  step4Report: { language: Language }
}

export type Engine1LegacyModalsProps = {
  activeIdeaCell: string | null
  allowDrop: (event: DragEvent<HTMLElement>) => void
  confirmRemoveOpen: boolean
  copy: Translations
  countWords: (value: string) => number
  getLabelById: (labelId: string | null) => LabelItem | null | undefined
  getNextLabelColor: (labels: LabelItem[]) => string
  handleLabelDragStart: (event: DragEvent<HTMLElement>, labelId: string | null) => void
  ideaDraft: string
  ideaLabelAssignments: Record<string, string | null>
  ideaLabelDraft: string | null
  ideaLabels: LabelItem[]
  ideaPreview: Idea | null
  impulseOpen: boolean
  impulseQuestion: string | null
  impulseSource: 'llm' | 'fallback' | null
  isSuggestLoading: boolean
  keepOnlyUserIdeas: () => void
  labelEditorOpen: boolean
  languageOptions: Language[]
  lastLlmSource: 'llm' | 'fallback' | null
  lastLlmWhy: string | null
  postItEdit: Idea | null
  postItEditCell: string | null
  postItEditOriginalText: string
  postItLabelDraft: string | null
  reportData: LegacyReportData
  reportLanguage: Language
  reportSnapshotOpen: boolean
  setActiveIdeaCell: Dispatch<SetStateAction<string | null>>
  setConfirmRemoveOpen: Dispatch<SetStateAction<boolean>>
  setIdeaDraft: Dispatch<SetStateAction<string>>
  setIdeaLabelAssignments: Dispatch<SetStateAction<Record<string, string | null>>>
  setIdeaLabelDraft: Dispatch<SetStateAction<string | null>>
  setIdeaLabels: Dispatch<SetStateAction<LabelItem[]>>
  setIdeaPreview: Dispatch<SetStateAction<Idea | null>>
  setImpulseOpen: Dispatch<SetStateAction<boolean>>
  setLabelEditorOpen: Dispatch<SetStateAction<boolean>>
  setPostItEdit: Dispatch<SetStateAction<Idea | null>>
  setPostItEditCell: Dispatch<SetStateAction<string | null>>
  setPostItLabelDraft: Dispatch<SetStateAction<string | null>>
  setReportSnapshotOpen: Dispatch<SetStateAction<boolean>>
  setWorkshopIdeas: Dispatch<SetStateAction<Record<string, Idea[]>>>
  showDiagnostics: boolean
  showSuggestLoadingUI: boolean
  stepHeading: (stepId: StepId) => string
  withAlpha: (hexColor: string, alphaHex?: string) => string
}

export function Engine1LegacyModals({
  activeIdeaCell,
  allowDrop,
  confirmRemoveOpen,
  copy,
  countWords,
  getLabelById,
  getNextLabelColor,
  handleLabelDragStart,
  ideaDraft,
  ideaLabelAssignments,
  ideaLabelDraft,
  ideaLabels,
  ideaPreview,
  impulseOpen,
  impulseQuestion,
  impulseSource,
  isSuggestLoading,
  keepOnlyUserIdeas,
  labelEditorOpen,
  languageOptions,
  lastLlmSource,
  lastLlmWhy,
  postItEdit,
  postItEditCell,
  postItEditOriginalText,
  postItLabelDraft,
  reportData,
  reportLanguage,
  reportSnapshotOpen,
  setActiveIdeaCell,
  setConfirmRemoveOpen,
  setIdeaDraft,
  setIdeaLabelAssignments,
  setIdeaLabelDraft,
  setIdeaLabels,
  setIdeaPreview,
  setImpulseOpen,
  setLabelEditorOpen,
  setPostItEdit,
  setPostItEditCell,
  setPostItLabelDraft,
  setReportSnapshotOpen,
  setWorkshopIdeas,
  showDiagnostics,
  showSuggestLoadingUI,
  stepHeading,
  withAlpha,
}: Engine1LegacyModalsProps) {
  return (
    <>
    {activeIdeaCell && (
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-content">
          <div className="modal-header">
            <h2>{copy.editIdeaTitle}</h2>
            {(() => {
              const labelItem = getLabelById(ideaLabelDraft)
              const isFilled = Boolean(labelItem)
              const color = labelItem?.color || null
              return (
                <div
                  className={`label-drop-target ${isFilled ? 'filled' : 'placeholder'}`}
                  style={
                    isFilled && color
                      ? { backgroundColor: withAlpha(color), borderColor: color }
                      : undefined
                  }
                  onDragOver={allowDrop}
                  onDrop={(event) => {
                    event.preventDefault()
                    const dropped = event.dataTransfer.getData('application/label')
                    setIdeaLabelDraft(dropped || null)
                  }}
                >
                  {isFilled ? labelItem?.text : copy.labelDropPlaceholder}
                </div>
              )
            })()}
          </div>
          <div className="modal-body">
            <textarea
              className="modal-textarea"
              value={ideaDraft}
              onChange={(event) => setIdeaDraft(event.target.value)}
              placeholder={copy.ideaPlaceholder}
            />
            <div className="label-row">
              <button
                type="button"
                className="label-chip no-label"
                draggable
                onDragStart={(event) => handleLabelDragStart(event, null)}
              >
                {copy.noLabelText}
              </button>
              {ideaLabels.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  className="label-chip"
                  draggable
                  onDragStart={(event) => handleLabelDragStart(event, label.id)}
                  style={{
                    backgroundColor: withAlpha(label.color),
                  }}
                >
                  {label.text}
                </button>
              ))}
            </div>
            <div className="idea-editor-actions">
              <span>{copy.wordCount(countWords(ideaDraft))}</span>
              <div>
                <button type="button" className="ghost" onClick={() => setActiveIdeaCell(null)}>
                  {copy.cancel}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!ideaDraft.trim() || countWords(ideaDraft) > 50}
                  onClick={() => {
                    const ideaId = `user-${Date.now()}`
                    setWorkshopIdeas((prev) => ({
                      ...prev,
                      [activeIdeaCell]: [...(prev[activeIdeaCell] || []), { id: ideaId, text: ideaDraft.trim(), source: 'user' }],
                    }))
                    if (ideaLabelDraft) {
                      setIdeaLabelAssignments((prev) => ({
                        ...prev,
                        [ideaId]: ideaLabelDraft,
                      }))
                    }
                    setActiveIdeaCell(null)
                  }}
                >
                  {copy.saveIdea}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}

    {impulseOpen && (
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-content">
          <div className="modal-header">
            <h2>{copy.impulseTitle}</h2>
            <button type="button" className="ghost" onClick={() => setImpulseOpen(false)}>
              {copy.impulseClose}
            </button>
          </div>
          <div className="modal-body">
            {isSuggestLoading ? (
              showSuggestLoadingUI ? (
                <div className="impulse-placeholder" role="status" aria-live="polite">
                  <div className="impulse-placeholder-line" />
                  <div className="impulse-placeholder-line short" />
                  <p className="muted">{copy.engineFacilitationLoadingPerspective}</p>
                </div>
              ) : (
                <div className="impulse-placeholder" aria-hidden="true" />
              )
            ) : (
              <p>{impulseQuestion || copy.impulseEmpty}</p>
            )}
            {!isSuggestLoading && impulseQuestion && impulseSource && showDiagnostics && (
              <span className="impulse-source-row">
                <span
                  className={`impulse-source-chip ${
                    impulseSource === 'fallback' ? 'fallback' : 'ai'
                  }`}
                >
                  {impulseSource === 'fallback'
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
        </div>
      </div>
    )}

    {reportSnapshotOpen && (
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-content">
          <div className="modal-header">
            <h2>{copy.reportSnapshotTitle}</h2>
            <button type="button" className="ghost" onClick={() => setReportSnapshotOpen(false)}>
              {copy.close}
            </button>
          </div>
          <div className="modal-body">
            <div className="field-group">
              <label htmlFor="report-language-modal">{copy.reportLanguageLabel}</label>
              <select
                id="report-language-modal"
                value={reportLanguage}
                disabled
              >
                {languageOptions.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </div>
            <div className="report-section">
              <h3>{stepHeading(1)}</h3>
              <p>
                <strong>{copy.productLabel}:</strong>{' '}
                {reportData.step1.productName || copy.notSet}
              </p>
              <p>
                <strong>{copy.spacesLabel}:</strong>{' '}
                {reportData.step1.spaces.length
                  ? reportData.step1.spaces.join(', ')
                  : copy.notSet}
              </p>
              <p>
                <strong>{copy.timeFramesLabel}:</strong>{' '}
                {reportData.step1.times.length
                  ? reportData.step1.times.join(', ')
                  : copy.notSet}
              </p>
            </div>
            <div className="report-section">
              <h3>{stepHeading(2)}</h3>
              <p>
                <strong>{copy.totalScenariosLabel}:</strong>{' '}
                {reportData.step2.totalScenarios}
              </p>
              <p>
                <strong>{copy.chosenScenarioLabel}:</strong>{' '}
                {reportData.step2.selectedScenario || copy.notSelected}
              </p>
              {reportData.step3 ? (
                <>
                  <p>
                    <strong>{copy.spaceDefinitionsLabel}:</strong>{' '}
                    {`${reportData.step3.spaceDefs.subsystem} | ${reportData.step3.spaceDefs.system} | ${reportData.step3.spaceDefs.supersystem}`}
                  </p>
                  <p>
                    <strong>{copy.timeDefinitionsLabel}:</strong>{' '}
                    {`${reportData.step3.timeDefs.past} | ${reportData.step3.timeDefs.now} | ${reportData.step3.timeDefs.future}`}
                  </p>
                </>
              ) : (
                <p>{copy.noScenarioConfirmed}</p>
              )}
            </div>
            <div className="report-section">
              <h3>{stepHeading(3)}</h3>
              <p>
                <strong>{copy.totalIdeasLabel}:</strong> {reportData.step4.totalIdeas}
              </p>
              <p>
                <strong>{copy.cellsWithIdeasLabel}:</strong> {reportData.step4.cellsWithIdeas} /
                9
              </p>
              <div className="idea-groups">
                <div>
                  <strong>{copy.ideasUserLabel}:</strong>
                  {reportData.step4.userIdeas.length ? (
                    <ul className="idea-list">
                      {reportData.step4.userIdeas.map((idea, index) => (
                        <li key={`user-idea-modal-${index}`}>{idea}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">{copy.noIdeasLabel}</p>
                  )}
                </div>
                <div>
                  <strong>{copy.ideasGeneratedLabel}:</strong>
                  {reportData.step4.llmIdeas.length ? (
                    <ul className="idea-list">
                      {reportData.step4.llmIdeas.map((idea, index) => (
                        <li key={`llm-idea-modal-${index}`}>{idea}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">{copy.noIdeasLabel}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="report-section">
              <h3>{stepHeading(4)}</h3>
              <p>
                <strong>{copy.selectedLanguageLabel}:</strong> {reportData.step4Report.language}
              </p>
            </div>
          </div>
        </div>
      </div>
    )}

    {labelEditorOpen && (
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-content">
          <div className="modal-header">
            <h2>{copy.labelEditorTitle}</h2>
            <button type="button" className="ghost" onClick={() => setLabelEditorOpen(false)}>
              {copy.close}
            </button>
          </div>
          <div className="modal-body">
            <div className="label-editor-list">
              {ideaLabels.map((label) => (
                <div key={label.id} className="label-editor-row">
                  <input
                    type="text"
                    value={label.text}
                    onChange={(event) => {
                      const next = ideaLabels.map((item) =>
                        item.id === label.id ? { ...item, text: event.target.value } : item
                      )
                      setIdeaLabels(next)
                    }}
                    style={{ backgroundColor: withAlpha(label.color) }}
                  />
                  <button
                    type="button"
                    className="label-delete"
                    aria-label={copy.removeLabelAriaLabel}
                    title={copy.removeLabelAriaLabel}
                    onClick={() => {
                      setIdeaLabels((prev) => prev.filter((item) => item.id !== label.id))
                      setIdeaLabelAssignments((prev) => {
                        const next: Record<string, string | null> = {}
                        Object.entries(prev).forEach(([ideaId, labelId]) => {
                          if (labelId !== label.id) next[ideaId] = labelId
                        })
                        return next
                      })
                      if (ideaLabelDraft === label.id) setIdeaLabelDraft(null)
                      if (postItLabelDraft === label.id) setPostItLabelDraft(null)
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {ideaLabels.length < 10 && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setIdeaLabels((prev) => [
                      ...prev,
                      {
                        id: `label-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        text: '',
                        color: getNextLabelColor(prev),
                      },
                    ])
                  }
                >
                  {copy.labelEditorAdd}
                </button>
              )}
            </div>
            <div className="actions label-editor-actions">
              <button type="button" className="primary" onClick={() => setLabelEditorOpen(false)}>
                {copy.labelEditorSave}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {postItEdit && postItEditCell && (
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-content">
          <div className="modal-header">
            <h2>{copy.editIdeaTitle}</h2>
            {(() => {
              const labelItem = getLabelById(postItLabelDraft)
              const isFilled = Boolean(labelItem)
              const color = labelItem?.color || null
              return (
                <div
                  className={`label-drop-target ${isFilled ? 'filled' : 'placeholder'}`}
                  style={
                    isFilled && color
                      ? { backgroundColor: withAlpha(color), borderColor: color }
                      : undefined
                  }
                  onDragOver={allowDrop}
                  onDrop={(event) => {
                    event.preventDefault()
                    const dropped = event.dataTransfer.getData('application/label')
                    setPostItLabelDraft(dropped || null)
                  }}
                >
                  {isFilled ? labelItem?.text : copy.labelDropPlaceholder}
                </div>
              )
            })()}
          </div>
          <div className="modal-body">
            <textarea
              className="modal-textarea"
              value={postItEdit.text}
              readOnly={postItEdit.source !== 'user'}
              onChange={(event) =>
                setPostItEdit({ ...postItEdit, text: event.target.value })
              }
            />
            <div className="label-row">
              <button
                type="button"
                className="label-chip no-label"
                draggable
                onDragStart={(event) => handleLabelDragStart(event, null)}
              >
                {copy.noLabelText}
              </button>
              {ideaLabels.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  className="label-chip"
                  draggable
                  onDragStart={(event) => handleLabelDragStart(event, label.id)}
                  style={{
                    backgroundColor: withAlpha(label.color),
                  }}
                >
                  {label.text}
                </button>
              ))}
            </div>
            <div className="idea-editor-actions">
              <span>{copy.wordCount(countWords(postItEdit.text))}</span>
              <div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setPostItEdit(null)
                    setPostItEditCell(null)
                  }}
                >
                  {copy.cancel}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    countWords(postItEdit.text) > 50 ||
                    (postItEdit.source !== 'user' &&
                      postItLabelDraft === (ideaLabelAssignments[postItEdit.id] ?? null)) ||
                    (postItEdit.source === 'user' &&
                      postItEdit.text === postItEditOriginalText &&
                      postItLabelDraft === (ideaLabelAssignments[postItEdit.id] ?? null))
                  }
                  onClick={() => {
                    if (postItEdit.source === 'user') {
                      setWorkshopIdeas((prev) => {
                        const current = prev[postItEditCell] || []
                        return {
                          ...prev,
                          [postItEditCell]: current.map((idea) =>
                            idea.id === postItEdit.id
                              ? { ...idea, text: postItEdit.text }
                              : idea
                          ),
                        }
                      })
                    }
                    setIdeaLabelAssignments((prev) => ({
                      ...prev,
                      [postItEdit.id]: postItLabelDraft ?? null,
                    }))
                    setPostItEdit(null)
                    setPostItEditCell(null)
                  }}
                >
                  {copy.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}

    {ideaPreview && (
      <div className="modal" role="dialog" aria-modal="true">
        <div
          className="idea-preview"
          style={{
            background:
              ideaPreview.source === 'user'
                ? 'rgba(247, 215, 122, 1)'
                : 'rgba(142, 192, 255, 1)',
          }}
        >
          <button
            type="button"
            className="idea-preview-close"
            onMouseEnter={() => setIdeaPreview(null)}
          >
            ×
          </button>
          <p>{ideaPreview.text}</p>
        </div>
      </div>
    )}

    {confirmRemoveOpen && (
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-content">
          <div className="modal-header">
            <h2>{copy.confirmRemoveIdeasTitle}</h2>
          </div>
          <div className="modal-body">
            <p>{copy.confirmRemoveIdeasMessage}</p>
            <div className="confirm-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setConfirmRemoveOpen(false)}
              >
                {copy.confirmNo}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  keepOnlyUserIdeas()
                  setConfirmRemoveOpen(false)
                }}
              >
                {copy.confirmYes}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
