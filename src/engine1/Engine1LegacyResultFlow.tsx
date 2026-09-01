import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { Idea, LabelItem, Language, Scenario, StepId, TimeSlot, Translations } from '../App'

type LegacyComponent = () => ReactNode

type LegacyReportData = {
  step1: { productName: string; spaces: string[]; times: string[] }
  step2: { totalScenarios: number; selectedScenario: string | null }
  step3: { spaceDefs: Scenario['spaceDefs']; timeDefs: Scenario['timeDefs'] } | null
  step4: { totalIdeas: number; cellsWithIdeas: number; userIdeas: string[]; llmIdeas: string[] }
  step4Report: { language: Language }
}

export type Engine1LegacyResultFlowProps = {
  activeStep: StepId
  addLlmIdeas: () => Promise<void> | void
  copy: Translations
  getLabelForIdea: (ideaId: string) => LabelItem | null | undefined
  hoveredCell: { space: string; time: string } | null
  IconIdea: LegacyComponent
  IconSearch: LegacyComponent
  ideaLabelAssignments: Record<string, string | null>
  ideaLabels: LabelItem[]
  isSuggestLoading: boolean
  languageOptions: Language[]
  reportData: LegacyReportData
  reportLanguage: Language
  requestImpulse: () => Promise<void> | void
  selectedScenario: Scenario | null
  setActiveIdeaCell: Dispatch<SetStateAction<string | null>>
  setActiveStep: Dispatch<SetStateAction<StepId>>
  setConfirmRemoveOpen: Dispatch<SetStateAction<boolean>>
  setHoveredCell: Dispatch<SetStateAction<{ space: string; time: string } | null>>
  setIdeaDraft: Dispatch<SetStateAction<string>>
  setIdeaLabelDraft: Dispatch<SetStateAction<string | null>>
  setIdeaPreview: Dispatch<SetStateAction<Idea | null>>
  setLabelEditorOpen: Dispatch<SetStateAction<boolean>>
  setPostItEdit: Dispatch<SetStateAction<Idea | null>>
  setPostItEditCell: Dispatch<SetStateAction<string | null>>
  setPostItEditOriginalText: Dispatch<SetStateAction<string>>
  setPostItLabelDraft: Dispatch<SetStateAction<string | null>>
  setReportSnapshotOpen: Dispatch<SetStateAction<boolean>>
  showLanding: boolean
  showSuggestLoadingUI: boolean
  spaceLabelMap: Record<'supersystem' | 'system' | 'subsystem', string>
  spaceSectionsStep3: readonly ('supersystem' | 'system' | 'subsystem')[]
  stepHeading: (stepId: StepId) => string
  stepTitle: (stepId: StepId) => string
  timeLabelMap: Record<TimeSlot, string>
  timeSections: readonly TimeSlot[]
  withAlpha: (hexColor: string, alphaHex?: string) => string
  workshopIdeas: Record<string, Idea[]>
}

export function Engine1LegacyResultFlow({
  activeStep,
  addLlmIdeas,
  copy,
  getLabelForIdea,
  hoveredCell,
  IconIdea,
  IconSearch,
  ideaLabelAssignments,
  ideaLabels,
  isSuggestLoading,
  languageOptions,
  reportData,
  reportLanguage,
  requestImpulse,
  selectedScenario,
  setActiveIdeaCell,
  setActiveStep,
  setConfirmRemoveOpen,
  setHoveredCell,
  setIdeaDraft,
  setIdeaLabelDraft,
  setIdeaPreview,
  setLabelEditorOpen,
  setPostItEdit,
  setPostItEditCell,
  setPostItEditOriginalText,
  setPostItLabelDraft,
  setReportSnapshotOpen,
  showLanding,
  showSuggestLoadingUI,
  spaceLabelMap,
  spaceSectionsStep3,
  stepHeading,
  stepTitle,
  timeLabelMap,
  timeSections,
  withAlpha,
  workshopIdeas,
}: Engine1LegacyResultFlowProps) {
  return (
    <>
      {!showLanding && activeStep === 3 && selectedScenario && (
        <section className="panel step3">
          <div className="step3-header">
            <div className="panel-header">
              <h1>{stepHeading(3)}</h1>
              <p>{copy.workshopIntro}</p>
            </div>
            <div className="action-stack">
              <button
                type="button"
                className="primary"
                disabled={isSuggestLoading}
                onClick={() => void requestImpulse()}
                aria-busy={isSuggestLoading}
              >
                {showSuggestLoadingUI && (
                  <span className="button-spinner" aria-hidden="true" />
                )}
                {showSuggestLoadingUI ? copy.engineFacilitationLoadingLabel : copy.impulseButtonLabel}
              </button>
              <button type="button" className="primary" onClick={() => void addLlmIdeas()}>
                {copy.ideaGenerator}
              </button>
              <button type="button" className="primary" onClick={() => setConfirmRemoveOpen(true)}>
                {copy.keepOnlyMyIdeasLabel}
              </button>
              <button type="button" className="primary" onClick={() => setLabelEditorOpen(true)}>
                {copy.labelEditorLabel}
              </button>
            </div>
          </div>

          <div className="legend">
            <div>
              <IconIdea />
              <span>{copy.legendIdea}</span>
            </div>
            <div>
              <IconSearch />
              <span>{copy.showIdeaLabel}</span>
            </div>
          </div>
          <div className="legend-labels">
            {ideaLabels.map((label) => (
              <span
                key={label.id}
                className="legend-chip"
                style={{ backgroundColor: withAlpha(label.color) }}
              >
                {label.text}
              </span>
            ))}
          </div>

          <div className="step3-grid">
            {spaceSectionsStep3.map((section, rowIndex) => (
              <div
                key={section}
                className={`axis-definition step3-space ${
                  hoveredCell?.space === section ? 'highlight' : ''
                }`}
                style={{ gridRow: rowIndex + 1, gridColumn: 1 }}
              >
                <strong>{spaceLabelMap[section]}</strong>
                <span>{selectedScenario.spaceDefs[section]}</span>
              </div>
            ))}

            {spaceSectionsStep3.map((spaceKey, rowIndex) =>
              timeSections.map((timeKey, colIndex) => {
                const cellKey = `${spaceKey}-${timeKey}`
                const ideas = workshopIdeas[cellKey] || []
                const isHovered =
                  hoveredCell?.space === spaceKey && hoveredCell?.time === timeKey
                return (
                  <div
                    key={cellKey}
                    className={`matrix-cell ${isHovered ? 'highlight' : ''}`}
                    style={{ gridRow: rowIndex + 1, gridColumn: colIndex + 2 }}
                    onMouseEnter={() => setHoveredCell({ space: spaceKey, time: timeKey })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <div className="cell-head">
                      <span className="cell-label">
                        {copy.cellLabel(spaceLabelMap[spaceKey], timeLabelMap[timeKey])}
                      </span>
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="icon-button"
                          title={copy.addIdeaTooltip}
                          onClick={() => {
                            setActiveIdeaCell(cellKey)
                            setIdeaDraft('')
                            setIdeaLabelDraft(null)
                          }}
                        >
                          <IconIdea />
                        </button>
                      </div>
                    </div>
                    <div className="post-it-area">
                      {ideas.map((idea) => {
                        const labelInfo = getLabelForIdea(idea.id)
                        return (
                          <button
                            key={idea.id}
                            type="button"
                            className={`post-it ${idea.source}`}
                            title={copy.editIdeaTooltip}
                            onClick={() => {
                              setPostItEdit(idea)
                              setPostItEditCell(cellKey)
                              setPostItLabelDraft(ideaLabelAssignments[idea.id] ?? null)
                              setPostItEditOriginalText(idea.text)
                            }}
                          >
                            <span
                              className="post-it-zoom"
                              onClick={(event) => {
                                event.stopPropagation()
                                setIdeaPreview(idea)
                              }}
                            >
                              🔍
                            </span>
                            {labelInfo && (
                              <span
                                className="label-dot"
                                style={{ color: labelInfo.color }}
                              />
                            )}
                            {idea.text}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}

            {timeSections.map((section, colIndex) => (
              <div
                key={section}
                className={`axis-definition step3-time ${
                  hoveredCell?.time === section ? 'highlight' : ''
                }`}
                style={{ gridRow: 4, gridColumn: colIndex + 2 }}
              >
                <strong>{timeLabelMap[section]}</strong>
                <span>{selectedScenario.timeDefs[section]}</span>
              </div>
            ))}
          </div>

          <div className="actions">
            <button type="button" className="ghost" onClick={() => setActiveStep(2)}>
              {copy.previousStepPrefix}
              {stepTitle(2)}
            </button>
            <button type="button" className="primary" onClick={() => setActiveStep(4)}>
              {copy.nextStepPrefix}
              {stepTitle(4)}
            </button>
          </div>
        </section>
      )}

      {!showLanding && activeStep === 4 && (
        <section className="panel">
          <div className="panel-header">
            <h1>{stepHeading(4)}</h1>
            <p>{copy.finalReportIntro}</p>
          </div>

          <div className="field-group">
            <label htmlFor="report-language">{copy.reportLanguageLabel}</label>
            <select
              id="report-language"
              value={reportLanguage}
              disabled
            >
              {languageOptions.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
            <p className="muted">{copy.reportLanguageHint}</p>
          </div>

          <div className="report">
            <div className="report-section">
              <h2>{stepHeading(1)}</h2>
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
                {reportData.step1.times.length ? reportData.step1.times.join(', ') : copy.notSet}
              </p>
            </div>

            <div className="report-section">
              <h2>{stepHeading(2)}</h2>
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
              <h2>{stepHeading(3)}</h2>
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
                        <li key={`user-idea-${index}`}>{idea}</li>
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
                        <li key={`llm-idea-${index}`}>{idea}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">{copy.noIdeasLabel}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="report-section">
              <h2>{stepHeading(4)}</h2>
              <p>
                <strong>{copy.selectedLanguageLabel}:</strong> {reportData.step4Report.language}
              </p>
            </div>
          </div>

          <div className="actions">
            <button type="button" className="ghost" onClick={() => setActiveStep(3)}>
              {copy.previousStepPrefix}
              {stepTitle(3)}
            </button>
            <button type="button" className="secondary" onClick={() => setReportSnapshotOpen(true)}>
              {copy.openReportPanel}
            </button>
            <button type="button" className="primary" disabled>
              {copy.nextStepCompleted}
            </button>
          </div>
        </section>
      )}
    </>
  )
}
