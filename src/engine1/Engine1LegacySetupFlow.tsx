import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react'
import type { OptionItem, Scenario, SpaceSlot, StepId, TimeOptionItem, TimeSlot, Translations } from '../App'

type LegacyComponent = () => ReactNode

export type Engine1LegacySetupFlowProps = {
  activeStep: StepId
  allowDrop: (event: DragEvent<HTMLElement>) => void
  assignedSpaceIds: number[]
  assignedTimeIds: number[]
  autosizeTextarea: (element: HTMLTextAreaElement | null) => void
  canProceedToStep2: boolean
  canProceedToStep3: boolean
  copy: Translations
  handleDragStart: (event: DragEvent<HTMLElement>, type: 'space' | 'time', id: number) => void
  handleDropOnSpace: (slot: SpaceSlot) => (event: DragEvent<HTMLDivElement>) => void
  handleDropOnTime: (slot: TimeSlot) => (event: DragEvent<HTMLDivElement>) => void
  handleNameDragStart: (event: DragEvent<HTMLElement>, name: string) => void
  IconElement: LegacyComponent
  IconWorld: LegacyComponent
  limitWords: (value: string, maxWords: number) => string
  productConfirmed: boolean
  productDescription: string
  productDescriptionConfirmed: boolean
  productName: string
  productNameSuggestions: string[]
  requestNameSuggestions: () => Promise<void> | void
  selectedScenario: Scenario | null
  setActiveStep: Dispatch<SetStateAction<StepId>>
  setProductConfirmed: Dispatch<SetStateAction<boolean>>
  setProductDescription: Dispatch<SetStateAction<string>>
  setProductName: Dispatch<SetStateAction<string>>
  showLanding: boolean
  spaceAssignments: Record<SpaceSlot, number | null>
  spaceLabelMap: Record<SpaceSlot | 'system', string>
  spaceOptionMap: Map<number, OptionItem>
  spaceOptions: OptionItem[]
  spaceSectionsStep2: readonly ('supersystem' | 'system' | 'subsystem')[]
  stepHeading: (stepId: StepId) => string
  stepTitle: (stepId: StepId) => string
  timeAssignments: Record<TimeSlot, number | null>
  timeLabelMap: Record<TimeSlot, string>
  timeOptionMap: Map<number, string>
  timeOptions: TimeOptionItem[]
  timeSections: readonly TimeSlot[]
  updateScenarioSpaceDef: (key: keyof Scenario['spaceDefs'], value: string) => void
  updateScenarioTimeDef: (key: keyof Scenario['timeDefs'], value: string) => void
}

export function Engine1LegacySetupFlow({
  activeStep,
  allowDrop,
  assignedSpaceIds,
  assignedTimeIds,
  autosizeTextarea,
  canProceedToStep2,
  canProceedToStep3,
  copy,
  handleDragStart,
  handleDropOnSpace,
  handleDropOnTime,
  handleNameDragStart,
  IconElement,
  IconWorld,
  limitWords,
  productConfirmed,
  productDescription,
  productDescriptionConfirmed,
  productName,
  productNameSuggestions,
  requestNameSuggestions,
  selectedScenario,
  setActiveStep,
  setProductConfirmed,
  setProductDescription,
  setProductName,
  showLanding,
  spaceAssignments,
  spaceLabelMap,
  spaceOptionMap,
  spaceOptions,
  spaceSectionsStep2,
  stepHeading,
  stepTitle,
  timeAssignments,
  timeLabelMap,
  timeOptionMap,
  timeOptions,
  timeSections,
  updateScenarioSpaceDef,
  updateScenarioTimeDef,
}: Engine1LegacySetupFlowProps) {
  return (
    <>
      {!showLanding && activeStep === 1 && (
        <section className="panel">
          <div className="step1-section">
            <div className="panel-header">
              <h1>{stepHeading(1)}</h1>
              <p>{copy.step1Intro}</p>
            </div>

            <div className="field-group">
              <label htmlFor="product-description">{copy.productDescriptionLabel}</label>
              <div className="product-description-row">
                <textarea
                  id="product-description"
                  rows={4}
                  value={productDescription}
                  onChange={(event) => {
                    const next = limitWords(event.target.value, 500)
                    setProductDescription(next)
                  }}
                  placeholder={copy.productDescriptionPlaceholder}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={!productDescription.trim()}
                  onClick={() => {
                    void requestNameSuggestions()
                  }}
                >
                  {copy.productDescriptionDoneLabel}
                </button>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="product-name">{copy.productNameLabel}</label>
              <div className="product-input">
                <input
                  id="product-name"
                  type="text"
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder={copy.productNamePlaceholder}
                  onDragOver={allowDrop}
                  onDrop={(event) => {
                    event.preventDefault()
                    const dropped = event.dataTransfer.getData('text/plain')
                    if (dropped) setProductName(dropped)
                  }}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={!productName.trim()}
                  onClick={() => setProductConfirmed(true)}
                >
                  {copy.confirmProductLabel}
                </button>
              </div>
              {productDescriptionConfirmed && (
                <div className="name-suggestions">
                  <span className="muted">{copy.productNameSuggestionsLabel}</span>
                  <div className="name-suggestion-row">
                    {productNameSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="name-suggestion"
                        draggable
                        onDragStart={(event) => handleNameDragStart(event, suggestion)}
                        onClick={() => setProductName(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {productConfirmed && (
            <div className="step1-section">
              <div className="step1-panels">
                <div className="step1-panel">
                  <h2>{copy.step1SpacesTitle}</h2>
                  <p className="muted">{copy.step1DragHint}</p>
                  <div className="dropzone-stack">
                    <div
                      className={`step1-dropzone space ${
                        spaceAssignments.supersystem !== null ? 'filled' : ''
                      }`}
                      onDragOver={allowDrop}
                      onDrop={handleDropOnSpace('supersystem')}
                    >
                      <div className="dropzone-header">
                        <span className="dropzone-title">{copy.axisSupersystem}</span>
                      </div>
                      <div className="dropzone-body">
                        {spaceAssignments.supersystem === null ? (
                          <span className="placeholder">{copy.step1DropHere}</span>
                        ) : (
                          <button
                            type="button"
                            className="dropzone-value"
                            draggable
                            onDragStart={(event) =>
                              handleDragStart(event, 'space', spaceAssignments.supersystem as number)
                            }
                          >
                            {spaceOptionMap.get(spaceAssignments.supersystem)?.label || copy.notSet}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="step1-dropzone locked">
                      <div className="dropzone-header">
                        <span className="dropzone-title">{copy.step1SystemLabel}</span>
                        <span className="lock-tag">{copy.step1SystemLocked}</span>
                      </div>
                      <div className="dropzone-body">
                        <span className="dropzone-value static">
                          {productName || copy.notSet}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`step1-dropzone space ${
                        spaceAssignments.subsystem !== null ? 'filled' : ''
                      }`}
                      onDragOver={allowDrop}
                      onDrop={handleDropOnSpace('subsystem')}
                    >
                      <div className="dropzone-header">
                        <span className="dropzone-title">{copy.axisSubsystem}</span>
                      </div>
                      <div className="dropzone-body">
                        {spaceAssignments.subsystem === null ? (
                          <span className="placeholder">{copy.step1DropHere}</span>
                        ) : (
                          <button
                            type="button"
                            className="dropzone-value"
                            draggable
                            onDragStart={(event) =>
                              handleDragStart(event, 'space', spaceAssignments.subsystem as number)
                            }
                          >
                            {spaceOptionMap.get(spaceAssignments.subsystem)?.label || copy.notSet}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="step1-options">
                    {spaceOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`step1-option ${
                          assignedSpaceIds.includes(option.id) ? 'assigned' : ''
                        }`}
                        draggable
                        onDragStart={(event) => handleDragStart(event, 'space', option.id)}
                      >
                        <span className="drag-handle" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <span className="option-icon" aria-hidden="true">
                          {option.kind === 'world' ? <IconWorld /> : <IconElement />}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="step1-panel">
                  <h2>{copy.step1TimeframesTitle}</h2>
                  <p className="muted">{copy.step1DragHint}</p>
                  <div className="dropzone-stack">
                    {(['past', 'now', 'future'] as const).map((slot) => (
                      <div
                        key={slot}
                        className={`step1-dropzone time ${
                          timeAssignments[slot] !== null ? 'filled' : ''
                        }`}
                        onDragOver={allowDrop}
                        onDrop={handleDropOnTime(slot)}
                      >
                        <div className="dropzone-header">
                          <span className="dropzone-title">{timeLabelMap[slot]}</span>
                        </div>
                        <div className="dropzone-body">
                          {timeAssignments[slot] === null ? (
                            <span className="placeholder">{copy.step1DropHere}</span>
                          ) : (
                            <button
                              type="button"
                              className="dropzone-value"
                              draggable
                              onDragStart={(event) =>
                                handleDragStart(event, 'time', timeAssignments[slot] as number)
                              }
                            >
                              {timeOptionMap.get(timeAssignments[slot] as number) || copy.notSet}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="step1-options">
                    {timeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`step1-option ${
                          assignedTimeIds.includes(option.id) ? 'assigned' : ''
                        }`}
                        draggable
                        onDragStart={(event) => handleDragStart(event, 'time', option.id)}
                      >
                        <span className="drag-handle" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="actions">
                <button type="button" className="ghost" disabled>
                  {copy.previousStepNone}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!canProceedToStep2}
                  onClick={() => setActiveStep(2)}
                >
                  {copy.nextStepPrefix}
                  {stepTitle(2)}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {!showLanding && activeStep === 2 && (
        <section className="panel step2">
          <div className="panel-header">
            <h1>{stepHeading(2)}</h1>
            <p>{copy.scenarioIntro}</p>
          </div>

          {selectedScenario && (
            <div className="step2-grid">
              {spaceSectionsStep2.map((section, rowIndex) => (
                <div
                  key={section}
                  className="axis-definition step2-space"
                  style={{ gridRow: rowIndex + 1, gridColumn: 1 }}
                >
                  <strong>{spaceLabelMap[section]}</strong>
                  {section === 'system' ? (
                    <input
                      type="text"
                      value={productName}
                      readOnly
                      className="read-only"
                    />
                  ) : (
                    <textarea
                      rows={1}
                      ref={autosizeTextarea}
                      value={selectedScenario.spaceDefs[section]}
                      onChange={(event) => {
                        updateScenarioSpaceDef(section, event.target.value)
                        autosizeTextarea(event.currentTarget)
                      }}
                    />
                  )}
                </div>
              ))}

              {spaceSectionsStep2.map((spaceKey, rowIndex) =>
                timeSections.map((timeKey, colIndex) => (
                  <div
                    key={`${spaceKey}-${timeKey}`}
                    className="matrix-cell"
                    style={{ gridRow: rowIndex + 1, gridColumn: colIndex + 2 }}
                  />
                ))
              )}

              {timeSections.map((section, colIndex) => (
                <div
                  key={section}
                  className="axis-definition step2-time"
                  style={{ gridRow: 4, gridColumn: colIndex + 2 }}
                >
                  <strong>{timeLabelMap[section]}</strong>
                  <textarea
                    rows={1}
                    ref={autosizeTextarea}
                    value={selectedScenario.timeDefs[section]}
                    onChange={(event) => {
                      updateScenarioTimeDef(section, event.target.value)
                      autosizeTextarea(event.currentTarget)
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="actions">
            <button type="button" className="ghost" onClick={() => setActiveStep(1)}>
              {copy.previousStepPrefix}
              {stepTitle(1)}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canProceedToStep3}
              onClick={() => setActiveStep(3)}
            >
              {copy.nextStepPrefix}
              {stepTitle(3)}
            </button>
          </div>
        </section>
      )}
    </>
  )
}
