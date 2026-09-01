import type { Dispatch, DragEvent, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from 'react'
import type { Idea, LabelItem, Language, OptionItem, Scenario, SpaceSlot, StepId, TimeOptionItem, TimeSlot, Translations } from '../App'
import { Engine1LandingBody } from './Engine1LandingBody'
import { Engine1LegacyModals } from './Engine1LegacyModals'
type LegacyComponent = () => ReactNode
type LlmStatus = 'unknown' | 'online' | 'offline'
type LlmPingResult = {
  error?: string | null
  message?: string | null
  model?: string | null
  tokensIn?: number | null
  tokensOut?: number | null
} | null

type LegacyReportData = {
  step1: { productName: string; spaces: string[]; times: string[] }
  step2: { totalScenarios: number; selectedScenario: string | null }
  step3: { spaceDefs: Scenario['spaceDefs']; timeDefs: Scenario['timeDefs'] } | null
  step4: { totalIdeas: number; cellsWithIdeas: number; userIdeas: string[]; llmIdeas: string[] }
  step4Report: { language: Language }
}

export type Engine1LegacyRouteProps = {
  activeIdeaCell: string | null
  activeStep: StepId
  addLlmIdeas: () => Promise<void> | void
  aiSupportEnabled: boolean
  allowDrop: (event: DragEvent<HTMLElement>) => void
  assignedSpaceIds: number[]
  assignedTimeIds: number[]
  autosizeTextarea: (element: HTMLTextAreaElement | null) => void
  canProceedToStep2: boolean
  canProceedToStep3: boolean
  checkLlmStatus: (base: string) => Promise<void> | void
  confirmRemoveOpen: boolean
  copy: Translations
  countWords: (value: string) => number
  DIAGNOSTICS_STORAGE_KEY: string
  feedbackFab: ReactNode
  feedbackPanel: ReactNode
  getLabelById: (labelId: string | null) => LabelItem | null | undefined
  getLabelForIdea: (ideaId: string) => LabelItem | null | undefined
  getNextLabelColor: (labels: LabelItem[]) => string
  handleDragStart: (event: DragEvent<HTMLElement>, type: 'space' | 'time', id: number) => void
  handleDropOnSpace: (slot: SpaceSlot) => (event: DragEvent<HTMLDivElement>) => void
  handleDropOnTime: (slot: TimeSlot) => (event: DragEvent<HTMLDivElement>) => void
  handleLabelDragStart: (event: DragEvent<HTMLElement>, labelId: string | null) => void
  handleLandingCtaClick: (event?: ReactMouseEvent<HTMLAnchorElement>) => void
  handleLlmPing: () => Promise<void> | void
  handleNameDragStart: (event: DragEvent<HTMLElement>, name: string) => void
  hoveredCell: { space: string; time: string } | null
  IconElement: LegacyComponent
  IconIdea: LegacyComponent
  IconReport: LegacyComponent
  IconSearch: LegacyComponent
  IconWorld: LegacyComponent
  ideaDraft: string
  ideaLabelAssignments: Record<string, string | null>
  ideaLabelDraft: string | null
  ideaLabels: LabelItem[]
  ideaPreview: Idea | null
  impulseOpen: boolean
  impulseQuestion: string | null
  impulseSource: 'llm' | 'fallback' | null
  isAdmin: boolean
  isSuggestLoading: boolean
  keepOnlyUserIdeas: () => void
  labelEditorOpen: boolean
  landingLogoUrl: string
  landingView: 'main' | 'threeSteps'
  languageOptions: Language[]
  lastLlmSource: 'llm' | 'fallback' | null
  lastLlmWhy: string | null
  limitWords: (value: string, maxWords: number) => string
  llmApiBase: string
  llmPingResult: LlmPingResult
  llmSaved: boolean
  llmSettingsOpen: boolean
  llmStatus: LlmStatus
  missingLabelModal: ReactNode
  normalizeApiBase: (value: string) => string
  openMainLanding: () => void
  postItEdit: Idea | null
  postItEditCell: string | null
  postItEditOriginalText: string
  postItLabelDraft: string | null
  productConfirmed: boolean
  productDescription: string
  productDescriptionConfirmed: boolean
  productName: string
  productNameSuggestions: string[]
  reportData: LegacyReportData
  reportLanguage: Language
  reportSnapshotOpen: boolean
  requestImpulse: () => Promise<void> | void
  requestNameSuggestions: () => Promise<void> | void
  selectedScenario: Scenario | null
  setActiveIdeaCell: Dispatch<SetStateAction<string | null>>
  setActiveStep: Dispatch<SetStateAction<StepId>>
  setAiSupportEnabled: Dispatch<SetStateAction<boolean>>
  setConfirmRemoveOpen: Dispatch<SetStateAction<boolean>>
  setDiagnosticsEnabled: Dispatch<SetStateAction<boolean>>
  setHoveredCell: Dispatch<SetStateAction<{ space: string; time: string } | null>>
  setIdeaDraft: Dispatch<SetStateAction<string>>
  setIdeaLabelAssignments: Dispatch<SetStateAction<Record<string, string | null>>>
  setIdeaLabelDraft: Dispatch<SetStateAction<string | null>>
  setIdeaLabels: Dispatch<SetStateAction<LabelItem[]>>
  setIdeaPreview: Dispatch<SetStateAction<Idea | null>>
  setImpulseOpen: Dispatch<SetStateAction<boolean>>
  setLabelEditorOpen: Dispatch<SetStateAction<boolean>>
  setLlmApiBase: Dispatch<SetStateAction<string>>
  setLlmSaved: Dispatch<SetStateAction<boolean>>
  setLlmSettingsOpen: Dispatch<SetStateAction<boolean>>
  setLlmStatus: Dispatch<SetStateAction<LlmStatus>>
  setPostItEdit: Dispatch<SetStateAction<Idea | null>>
  setPostItEditCell: Dispatch<SetStateAction<string | null>>
  setPostItEditOriginalText: Dispatch<SetStateAction<string>>
  setPostItLabelDraft: Dispatch<SetStateAction<string | null>>
  setProductConfirmed: Dispatch<SetStateAction<boolean>>
  setProductDescription: Dispatch<SetStateAction<string>>
  setProductName: Dispatch<SetStateAction<string>>
  setReportSnapshotOpen: Dispatch<SetStateAction<boolean>>
  setUiLanguage: Dispatch<SetStateAction<Language>>
  setWorkshopIdeas: Dispatch<SetStateAction<Record<string, Idea[]>>>
  showDiagnostics: boolean
  showLanding: boolean
  showSuggestLoadingUI: boolean
  spaceAssignments: Record<SpaceSlot, number | null>
  spaceLabelMap: Record<SpaceSlot | 'system', string>
  spaceOptionMap: Map<number, OptionItem>
  spaceOptions: OptionItem[]
  spaceSectionsStep2: readonly ('supersystem' | 'system' | 'subsystem')[]
  spaceSectionsStep3: readonly ('supersystem' | 'system' | 'subsystem')[]
  stepHeading: (stepId: StepId) => string
  stepOrder: StepId[]
  stepTitle: (stepId: StepId) => string
  timeAssignments: Record<TimeSlot, number | null>
  timeLabelMap: Record<TimeSlot, string>
  timeOptionMap: Map<number, string>
  timeOptions: TimeOptionItem[]
  timeSections: readonly TimeSlot[]
  uiLanguage: Language
  uiLanguageOptions: Language[]
  updateScenarioSpaceDef: (key: keyof Scenario['spaceDefs'], value: string) => void
  updateScenarioTimeDef: (key: keyof Scenario['timeDefs'], value: string) => void
  withAlpha: (hexColor: string, alphaHex?: string) => string
  workshopIdeas: Record<string, Idea[]>
}

export function Engine1LegacyRoute({
  activeIdeaCell,
  activeStep,
  addLlmIdeas,
  aiSupportEnabled,
  allowDrop,
  assignedSpaceIds,
  assignedTimeIds,
  autosizeTextarea,
  canProceedToStep2,
  canProceedToStep3,
  checkLlmStatus,
  confirmRemoveOpen,
  copy,
  countWords,
  DIAGNOSTICS_STORAGE_KEY,
  feedbackFab,
  feedbackPanel,
  getLabelById,
  getLabelForIdea,
  getNextLabelColor,
  handleDragStart,
  handleDropOnSpace,
  handleDropOnTime,
  handleLabelDragStart,
  handleLandingCtaClick,
  handleLlmPing,
  handleNameDragStart,
  hoveredCell,
  IconElement,
  IconIdea,
  IconReport,
  IconSearch,
  IconWorld,
  ideaDraft,
  ideaLabelAssignments,
  ideaLabelDraft,
  ideaLabels,
  ideaPreview,
  impulseOpen,
  impulseQuestion,
  impulseSource,
  isAdmin,
  isSuggestLoading,
  keepOnlyUserIdeas,
  labelEditorOpen,
  landingLogoUrl,
  landingView,
  languageOptions,
  lastLlmSource,
  lastLlmWhy,
  limitWords,
  llmApiBase,
  llmPingResult,
  llmSaved,
  llmSettingsOpen,
  llmStatus,
  missingLabelModal,
  normalizeApiBase,
  openMainLanding,
  postItEdit,
  postItEditCell,
  postItEditOriginalText,
  postItLabelDraft,
  productConfirmed,
  productDescription,
  productDescriptionConfirmed,
  productName,
  productNameSuggestions,
  reportData,
  reportLanguage,
  reportSnapshotOpen,
  requestImpulse,
  requestNameSuggestions,
  selectedScenario,
  setActiveIdeaCell,
  setActiveStep,
  setAiSupportEnabled,
  setConfirmRemoveOpen,
  setDiagnosticsEnabled,
  setHoveredCell,
  setIdeaDraft,
  setIdeaLabelAssignments,
  setIdeaLabelDraft,
  setIdeaLabels,
  setIdeaPreview,
  setImpulseOpen,
  setLabelEditorOpen,
  setLlmApiBase,
  setLlmSaved,
  setLlmSettingsOpen,
  setLlmStatus,
  setPostItEdit,
  setPostItEditCell,
  setPostItEditOriginalText,
  setPostItLabelDraft,
  setProductConfirmed,
  setProductDescription,
  setProductName,
  setReportSnapshotOpen,
  setUiLanguage,
  setWorkshopIdeas,
  showDiagnostics,
  showLanding,
  showSuggestLoadingUI,
  spaceAssignments,
  spaceLabelMap,
  spaceOptionMap,
  spaceOptions,
  spaceSectionsStep2,
  spaceSectionsStep3,
  stepHeading,
  stepOrder,
  stepTitle,
  timeAssignments,
  timeLabelMap,
  timeOptionMap,
  timeOptions,
  timeSections,
  uiLanguage,
  uiLanguageOptions,
  updateScenarioSpaceDef,
  updateScenarioTimeDef,
  withAlpha,
  workshopIdeas,
}: Engine1LegacyRouteProps) {
  return (
  <div className="app">
    <header className={`top-bar ${showLanding ? 'landing-top' : ''}`}>
      {showLanding && (
        <div className="landing-logo">
          <img src={landingLogoUrl} alt="MakeMyIdea.Work" />
        </div>
      )}
      {!showLanding && (
        <div className="engine-brand">
          <div className="engine-logo">
            <img src={landingLogoUrl} alt="MakeMyIdea.Work" />
          </div>
        </div>
      )}
      {!showLanding && (
        <div className="roadmap">
          {stepOrder.map((stepId) => (
            <button
              key={stepId}
              type="button"
              className={`roadmap-step ${stepId === activeStep ? 'active' : ''}`}
              onClick={() => {
                if (stepId <= activeStep) setActiveStep(stepId)
              }}
            >
              <span className="step-index">
                {copy.stepLabel} {stepId}
              </span>
              <span className="step-title">{stepTitle(stepId)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="topbar-links">
        {showLanding && (
          <>
            <a className="ghost topbar-link landing-blog-link" href="/blog">
              {copy.landingBlogTitle}
            </a>
            <a className="primary topbar-link landing-login-link" href="/login" onClick={handleLandingCtaClick}>
              {copy.landingLoginCta}
            </a>
          </>
        )}
      </div>
      {(showLanding || activeStep === 1) && (
        <label className="topbar-language">
          <span>{copy.languageLabel}</span>
          <select
            value={uiLanguage}
            onChange={(event) => setUiLanguage(event.target.value as Language)}
          >
            {uiLanguageOptions.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
      )}
      {!showLanding && isAdmin && (
        <button
          className={`ai-support-toggle diagnostics-toggle ${showDiagnostics ? 'on' : 'off'}`}
          type="button"
          onClick={() => {
            const nextEnabled = !showDiagnostics
            setDiagnosticsEnabled(nextEnabled)
            localStorage.setItem(
              DIAGNOSTICS_STORAGE_KEY,
              nextEnabled ? 'true' : 'false'
            )
          }}
        >
          {showDiagnostics ? copy.diagnosticsOn : copy.diagnosticsOff}
        </button>
      )}
      {!showLanding && showDiagnostics && (
        <button
          className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
          type="button"
          onClick={() => {
            const nextEnabled = !aiSupportEnabled
            setAiSupportEnabled(nextEnabled)
            localStorage.setItem('aiSupportEnabled', nextEnabled ? 'true' : 'false')
            if (nextEnabled) {
              void checkLlmStatus(normalizeApiBase(llmApiBase))
            } else {
              setLlmStatus('offline')
            }
          }}
        >
          {aiSupportEnabled ? copy.aiSupportOn : copy.aiSupportOff}
        </button>
      )}
      {!showLanding && (
        <button
          className="ghost llm-button"
          type="button"
          onClick={() => setLlmSettingsOpen(true)}
        >
          {copy.llmSettings}
        </button>
      )}
      {!showLanding && activeStep !== 1 && (
        <button className="report-button" type="button" onClick={() => setReportSnapshotOpen(true)}>
          <IconReport />
          <span>{copy.report}</span>
        </button>
      )}
      {showLanding && (
        <div className="scroll-progress" aria-hidden="true">
          <span />
        </div>
      )}
    </header>

    <main className="content">
      <Engine1LandingBody
        copy={copy}
        handleLandingCtaClick={handleLandingCtaClick}
        landingView={landingView}
        openMainLanding={openMainLanding}
        showLanding={showLanding}
        uiLanguage={uiLanguage}
      />
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
    </main>
    {showLanding && (
      <footer className="landing-bottom-bar">
        <nav className="landing-bottom-links" aria-label="Legal links">
          <a className="ghost landing-bottom-link" href="/privacy">
            {copy.landingPrivacyTitle}
          </a>
          <a className="ghost landing-bottom-link" href="/blog">
            {copy.landingBlogTitle}
          </a>
          <a className="ghost landing-bottom-link" href="/termsandconditions">
            {copy.landingTermsTitle}
          </a>
          <a className="ghost landing-bottom-link" href="mailto:makemyideawork@aremai.tech">
            {copy.landingContactTitle}
          </a>
        </nav>
        <a
          className="landing-bottom-logo-link"
          href="https://www.aremai.tech"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="AremAI website"
        >
          <img
            className="landing-bottom-logo"
            src={new URL('/logo/aremai_logo.png.webp', import.meta.url).href}
            alt="AremAI"
            loading="lazy"
          />
        </a>
      </footer>
    )}
    <Engine1LegacyModals
      activeIdeaCell={activeIdeaCell}
      allowDrop={allowDrop}
      confirmRemoveOpen={confirmRemoveOpen}
      copy={copy}
      countWords={countWords}
      getLabelById={getLabelById}
      getNextLabelColor={getNextLabelColor}
      handleLabelDragStart={handleLabelDragStart}
      ideaDraft={ideaDraft}
      ideaLabelAssignments={ideaLabelAssignments}
      ideaLabelDraft={ideaLabelDraft}
      ideaLabels={ideaLabels}
      ideaPreview={ideaPreview}
      impulseOpen={impulseOpen}
      impulseQuestion={impulseQuestion}
      impulseSource={impulseSource}
      isSuggestLoading={isSuggestLoading}
      keepOnlyUserIdeas={keepOnlyUserIdeas}
      labelEditorOpen={labelEditorOpen}
      languageOptions={languageOptions}
      lastLlmSource={lastLlmSource}
      lastLlmWhy={lastLlmWhy}
      postItEdit={postItEdit}
      postItEditCell={postItEditCell}
      postItEditOriginalText={postItEditOriginalText}
      postItLabelDraft={postItLabelDraft}
      reportData={reportData}
      reportLanguage={reportLanguage}
      reportSnapshotOpen={reportSnapshotOpen}
      setActiveIdeaCell={setActiveIdeaCell}
      setConfirmRemoveOpen={setConfirmRemoveOpen}
      setIdeaDraft={setIdeaDraft}
      setIdeaLabelAssignments={setIdeaLabelAssignments}
      setIdeaLabelDraft={setIdeaLabelDraft}
      setIdeaLabels={setIdeaLabels}
      setIdeaPreview={setIdeaPreview}
      setImpulseOpen={setImpulseOpen}
      setLabelEditorOpen={setLabelEditorOpen}
      setPostItEdit={setPostItEdit}
      setPostItEditCell={setPostItEditCell}
      setPostItLabelDraft={setPostItLabelDraft}
      setReportSnapshotOpen={setReportSnapshotOpen}
      setWorkshopIdeas={setWorkshopIdeas}
      showDiagnostics={showDiagnostics}
      showSuggestLoadingUI={showSuggestLoadingUI}
      stepHeading={stepHeading}
      withAlpha={withAlpha}
    />
    {llmSettingsOpen && (
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-content">
          <div className="modal-header">
            <h2>{copy.llmSettingsTitle}</h2>
            <button type="button" className="ghost" onClick={() => setLlmSettingsOpen(false)}>
              {copy.close}
            </button>
          </div>
          <div className="modal-body">
            <p className="muted">{copy.llmSettingsIntro}</p>
            <div className="field-group">
              <label htmlFor="llm-api-base">{copy.llmApiBaseLabel}</label>
              <input
                id="llm-api-base"
                type="text"
                value={llmApiBase}
                onChange={(event) => {
                  setLlmApiBase(event.target.value)
                  setLlmSaved(false)
                  setLlmStatus('unknown')
                }}
                placeholder={copy.llmApiBasePlaceholder}
              />
            </div>
            <p className="muted">
              {llmStatus === 'online'
                ? copy.llmStatusOnline
                : llmStatus === 'offline'
                  ? copy.llmStatusOffline
                  : copy.llmStatusUnknown}
            </p>
            <p className="muted">{copy.llmSettingsCostNote}</p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const normalized = normalizeApiBase(llmApiBase)
                  setLlmApiBase(normalized)
                  void checkLlmStatus(normalized)
                }}
                disabled={!aiSupportEnabled}
              >
                {copy.llmTestConnection}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const normalized = normalizeApiBase(llmApiBase)
                  setLlmApiBase(normalized)
                  localStorage.setItem('llm_api_base', normalized)
                  void checkLlmStatus(normalized)
                  setLlmSaved(true)
                }}
                disabled={!aiSupportEnabled}
              >
                {copy.llmSettingsSave}
              </button>
              {llmSaved && <span className="muted">{copy.llmSettingsSaved}</span>}
            </div>
            {showDiagnostics && (
              <div className="actions llm-toggle">
                <button
                  type="button"
                  className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
                  onClick={() => {
                    const nextEnabled = !aiSupportEnabled
                    setAiSupportEnabled(nextEnabled)
                    localStorage.setItem('aiSupportEnabled', nextEnabled ? 'true' : 'false')
                    if (nextEnabled) {
                      void checkLlmStatus(normalizeApiBase(llmApiBase))
                    } else {
                      setLlmStatus('offline')
                    }
                  }}
                >
                  {aiSupportEnabled ? copy.aiSupportOn : copy.aiSupportOff}
                </button>
                {import.meta.env.DEV && (
                  <button type="button" className="ghost" onClick={handleLlmPing}>
                    LLM ping
                  </button>
                )}
              </div>
            )}
            {import.meta.env.DEV && llmPingResult && (
              <div className="engine-helper">
                {llmPingResult.error
                  ? `Ping error: ${llmPingResult.error}`
                  : `Ping OK: ${llmPingResult.model ?? 'model?'} | in ${
                      llmPingResult.tokensIn ?? 0
                    } / out ${llmPingResult.tokensOut ?? 0}${
                      llmPingResult.message ? ` | ${llmPingResult.message}` : ''
                    }`}
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {feedbackPanel}
    {feedbackFab}
    {missingLabelModal}
  </div>
  )
}
