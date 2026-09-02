import type { Dispatch, DragEvent, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from 'react'
import type { Idea, LabelItem, Language, OptionItem, Scenario, SpaceSlot, StepId, TimeOptionItem, TimeSlot, Translations } from '../App'
import { Engine1LandingBody } from './Engine1LandingBody'
import { Engine1LegacyModals } from './Engine1LegacyModals'
import { Engine1LegacyResultFlow } from './Engine1LegacyResultFlow'
import { Engine1LegacySetupFlow } from './Engine1LegacySetupFlow'
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
  const landingPathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : ''
  const landingLanguage = landingPathname === '/pl' ? 'pl' : landingPathname === '/de' ? 'de' : 'en'
  const landingLanguages = [
    { lang: 'en', name: 'English', code: 'EN' },
    { lang: 'de', name: 'Deutsch', code: 'DE' },
    { lang: 'pl', name: 'Polski', code: 'PL' },
  ] as const
  const activeLandingLanguage =
    landingLanguages.find((language) => language.lang === landingLanguage) || landingLanguages[0]

  return (
  <div className="app">
    <header className={`top-bar ${showLanding ? 'landing-top' : ''}`}>
      {showLanding && (
        <a className="landing-logo" href={`/${landingLanguage}`} aria-label="MakeMyIdea.Work home">
          <img src={landingLogoUrl} alt="MakeMyIdea.Work" />
        </a>
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
      {showLanding ? (
        <>
          <input className="landing-header-toggle" id="landing-header-menu-toggle" type="checkbox" />
          <label className="landing-header-toggle-button" htmlFor="landing-header-menu-toggle" aria-label="Open menu">
            <span />
          </label>
          <nav className="landing-header-menu" aria-label="Primary menu">
            <a className="landing-header-link" href={`/${landingLanguage}`}>Home</a>
            <a className="landing-header-link" href="#how">How It Works</a>
            <a className="landing-header-link" href="/examples">Examples</a>
            <a className="landing-header-link" href="/blog">Read the blog</a>
            <a className="landing-header-link" href="https://www.aremai.tech">About</a>
            <details className="landing-header-language">
              <summary aria-label="Change language">
                <span className="landing-header-language-globe" aria-hidden="true">◎</span>
                <span>{activeLandingLanguage.code}</span>
                <span className="landing-header-language-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div className="landing-header-language-menu">
                {landingLanguages.map((language) => (
                  <a
                    key={language.lang}
                    className="landing-header-language-option"
                    href={`/${language.lang}`}
                    lang={language.lang}
                    aria-current={language.lang === landingLanguage ? 'page' : undefined}
                    onClick={() => setUiLanguage(language.lang === 'pl' ? 'Polish' : 'English')}
                  >
                    <span className="landing-header-language-check" aria-hidden="true">
                      {language.lang === landingLanguage ? '✓' : ''}
                    </span>
                    <span>{language.name}</span>
                    <span className="landing-header-language-code">{language.code}</span>
                  </a>
                ))}
              </div>
            </details>
            <a className="landing-header-login" href="/login" onClick={handleLandingCtaClick}>
              {copy.landingLoginCta}
            </a>
          </nav>
        </>
      ) : (
        <div className="topbar-links" />
      )}
      {!showLanding && activeStep === 1 && (
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
      <Engine1LegacySetupFlow
        activeStep={activeStep}
        allowDrop={allowDrop}
        assignedSpaceIds={assignedSpaceIds}
        assignedTimeIds={assignedTimeIds}
        autosizeTextarea={autosizeTextarea}
        canProceedToStep2={canProceedToStep2}
        canProceedToStep3={canProceedToStep3}
        copy={copy}
        handleDragStart={handleDragStart}
        handleDropOnSpace={handleDropOnSpace}
        handleDropOnTime={handleDropOnTime}
        handleNameDragStart={handleNameDragStart}
        IconElement={IconElement}
        IconWorld={IconWorld}
        limitWords={limitWords}
        productConfirmed={productConfirmed}
        productDescription={productDescription}
        productDescriptionConfirmed={productDescriptionConfirmed}
        productName={productName}
        productNameSuggestions={productNameSuggestions}
        requestNameSuggestions={requestNameSuggestions}
        selectedScenario={selectedScenario}
        setActiveStep={setActiveStep}
        setProductConfirmed={setProductConfirmed}
        setProductDescription={setProductDescription}
        setProductName={setProductName}
        showLanding={showLanding}
        spaceAssignments={spaceAssignments}
        spaceLabelMap={spaceLabelMap}
        spaceOptionMap={spaceOptionMap}
        spaceOptions={spaceOptions}
        spaceSectionsStep2={spaceSectionsStep2}
        stepHeading={stepHeading}
        stepTitle={stepTitle}
        timeAssignments={timeAssignments}
        timeLabelMap={timeLabelMap}
        timeOptionMap={timeOptionMap}
        timeOptions={timeOptions}
        timeSections={timeSections}
        updateScenarioSpaceDef={updateScenarioSpaceDef}
        updateScenarioTimeDef={updateScenarioTimeDef}
      />
      <Engine1LegacyResultFlow
        activeStep={activeStep}
        addLlmIdeas={addLlmIdeas}
        copy={copy}
        getLabelForIdea={getLabelForIdea}
        hoveredCell={hoveredCell}
        IconIdea={IconIdea}
        IconSearch={IconSearch}
        ideaLabelAssignments={ideaLabelAssignments}
        ideaLabels={ideaLabels}
        isSuggestLoading={isSuggestLoading}
        languageOptions={languageOptions}
        reportData={reportData}
        reportLanguage={reportLanguage}
        requestImpulse={requestImpulse}
        selectedScenario={selectedScenario}
        setActiveIdeaCell={setActiveIdeaCell}
        setActiveStep={setActiveStep}
        setConfirmRemoveOpen={setConfirmRemoveOpen}
        setHoveredCell={setHoveredCell}
        setIdeaDraft={setIdeaDraft}
        setIdeaLabelDraft={setIdeaLabelDraft}
        setIdeaPreview={setIdeaPreview}
        setLabelEditorOpen={setLabelEditorOpen}
        setPostItEdit={setPostItEdit}
        setPostItEditCell={setPostItEditCell}
        setPostItEditOriginalText={setPostItEditOriginalText}
        setPostItLabelDraft={setPostItLabelDraft}
        setReportSnapshotOpen={setReportSnapshotOpen}
        showLanding={showLanding}
        showSuggestLoadingUI={showSuggestLoadingUI}
        spaceLabelMap={spaceLabelMap}
        spaceSectionsStep3={spaceSectionsStep3}
        stepHeading={stepHeading}
        stepTitle={stepTitle}
        timeLabelMap={timeLabelMap}
        timeSections={timeSections}
        withAlpha={withAlpha}
        workshopIdeas={workshopIdeas}
      />
    </main>
    {showLanding && (
      <footer className="landing-bottom-bar">
        <div className="landing-bottom-inner">
          <div className="landing-bottom-top">
            <div className="landing-bottom-brand">
              <a
                className="landing-bottom-logo-link"
                href="https://www.aremai.tech"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="AremAI website"
              >
                <img
                  className="landing-bottom-logo"
                  src={new URL('/logo/aremai_logo_footer.webp', import.meta.url).href}
                  alt="AremAI"
                  loading="lazy"
                />
              </a>
              <p className="landing-bottom-tagline">AI-assisted web apps for idea development.</p>
            </div>
            <nav className="landing-bottom-links" aria-label="Legal links">
              <a className="landing-bottom-link" href="/privacy">
                {copy.landingPrivacyTitle}
              </a>
              <a className="landing-bottom-link" href="/blog">
                {copy.landingBlogTitle}
              </a>
              <a className="landing-bottom-link" href="/termsandconditions">
                {copy.landingTermsTitle}
              </a>
              <a className="landing-bottom-link" href="mailto:makemyideawork@aremai.tech">
                {copy.landingContactTitle}
              </a>
            </nav>
          </div>
          <div className="landing-bottom-disclaimer-row">
            <p className="landing-bottom-disclaimer">
              <strong>Disclaimer:</strong> AI-generated outputs require independent validation and are not production approval.
            </p>
          </div>
          <div className="landing-bottom-copyright-row">
            <p className="landing-bottom-copyright">© 2026 MakeMyIdeaWork All rights reserved.</p>
          </div>
        </div>
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
