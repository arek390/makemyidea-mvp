import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import {
  MATRIX_COLS,
  MATRIX_ROWS,
  cellKey,
  computeMappingDetails,
  mapEntryToCell,
  pickGravityTarget,
  type MatrixColKey,
  type MatrixRowKey,
} from './engineMatrix/matrixHeuristics'
import {
  createSession,
  deleteSession,
  exportSessions,
  getSession,
  importSessions,
  listSessions,
  updateSession,
  type EngineBoardItem,
  type EngineSessionDetail,
  type EngineSessionSummary,
} from './storage/sessionStore'

type StepId = 1 | 2 | 3 | 4
type SpaceSlot = 'supersystem' | 'subsystem'
type TimeSlot = 'past' | 'now' | 'future'

type Scenario = {
  id: string
  spaceId: number
  timeId: number
  spaceDefs: {
    subsystem: string
    system: string
    supersystem: string
  }
  timeDefs: {
    past: string
    now: string
    future: string
  }
}

type Idea = {
  id: string
  text: string
  source: 'user' | 'llm'
}

type OptionItem = {
  id: number
  label: string
  kind: 'world' | 'element'
}

type TimeOptionItem = {
  id: number
  label: string
}

type FeedbackEntry = {
  id: string
  timestamp: string
  context: {
    language: string
    route: string
    sessionId?: string
    matrixCell?: { row: string; col: string }
    questionId?: string
  }
  feedback: {
    doing: string
    unclear: string
    workaround: string
    suggestion: string
    keywords: string
  }
}

type LabelItem = {
  id: string
  text: string
  color: string
}

const ENGINE_ENTRY_LABELS = [
  'pomysł',
  'problem do rozwiązania',
  'ryzyko / blokada',
  'pytanie do klienta',
  'pytanie do dostawcy / partnera',
  'założenie do weryfikacji',
  'decyzja',
  'następny krok (action)',
]

const ENGINE_ENTRY_LABEL_TRANSLATIONS: Record<string, string> = {
  'pomysł': 'idea',
  'problem do rozwiązania': 'problem to solve',
  'ryzyko / blokada': 'risk / blocker',
  'pytanie do klienta': 'question to customer',
  'pytanie do dostawcy / partnera': 'question to supplier / partner',
  'założenie do weryfikacji': 'assumption to validate',
  'decyzja': 'decision',
  'następny krok (action)': 'next step (action)',
}

const ENGINE_ENTRY_LABEL_COLORS: Record<string, string> = {
  'pomysł': '#FFD9B3',
  'problem do rozwiązania': '#FFBDBD',
  'ryzyko / blokada': '#FFC9E3',
  'pytanie do klienta': '#CFE8FF',
  'pytanie do dostawcy / partnera': '#D7F5E0',
  'założenie do weryfikacji': '#E9D7FF',
  'decyzja': '#FFF1B8',
  'następny krok (action)': '#C7F0E0',
}

type Language =
  | 'English'
  | 'Chinese'
  | 'Spanish'
  | 'Hindi'
  | 'Polish'
  | 'German'

  | 'Swiss'
  | 'Italian'
  | 'French'

type FacilitationType = 'NEXT' | 'DEEPEN' | 'PERSPECTIVE' | 'RESET'
type FacilitationPrompt = { type: FacilitationType; text: string }

const WORD_LIMIT = 40
const SHORT_ENTRY_WORDS = 12
const DEFAULT_IDLE_THRESHOLD_MS = 15000
const ERASE_EMPTY_SECONDS_STRONG = 10
const UI_LANGUAGE_STORAGE_KEY = 'ui-language'
const FEEDBACK_STORAGE_KEY = 'makemyidea.feedback.v1'

type Translations = {
  stepLabel: string
  appTitle: string
  landingHeroTitle: string
  landingHeroSubtitle: string
  landingIntroTitleLines: [string, string, string]
  landingIntroSubtextLines: [string, string, string, string]
  landingIntroSubtextEmphasis: string
  landingCta: string
  landingThreeStepsCta: string
  landingThreeStepsTitle: string
  landingBeforeLead: string
  landingBeforeList: string[]
  landingBeforeEmphasis: { strong: string; medium: string; rest: string }
  landingAfterLead: string
  landingAfterList: string[]
  landingWhyLead: string
  landingWhyLines: string[]
  landingWhoTitle: string
  landingWhoList: string[]
  landingFinalLines: [string, string]
  workInProgressLink: string
  impulseButtonLabel: string
  impulseTitle: string
  impulseEmpty: string
  impulseClose: string
  report: string
  llmSettings: string
  languageLabel: string
  steps: Record<StepId, string>
  step1Intro: string
  productDescriptionLabel: string
  productDescriptionPlaceholder: string
  productDescriptionDoneLabel: string
  productNameSuggestionsLabel: string
  productNameLabel: string
  productNamePlaceholder: string
  step1SpacesTitle: string
  step1TimeframesTitle: string
  step1DragHint: string
  step1DropHere: string
  step1SystemLabel: string
  step1SystemLocked: string
  spaceListTitle: string
  spaceListHint: string
  timeListTitle: string
  timeListHint: string
  finalSpacesList: string
  finalTimesList: string
  noSelectionYet: string
  warningMax5: string
  scenarioIntro: string
  chooseScenario: string
  spaceLabel: string
  timeLabel: string
  axisSpaceLabel: string
  axisTimeLabel: string
  axisSubsystem: string
  axisSystem: string
  axisSupersystem: string
  axisPast: string
  axisNow: string
  axisFuture: string
  workshopIntro: string
  legendQuestion: string
  legendIdea: string
  showIdeaLabel: string
  supportiveQuestionTooltip: string
  addIdeaTooltip: string
  editIdeaTooltip: string
  ideaPlaceholder: string
  wordCount: (count: number) => string
  cancel: string
  saveIdea: string
  ideaGenerator: string
  labelEditorLabel: string
  keepOnlyMyIdeasLabel: string
  confirmRemoveIdeasTitle: string
  confirmRemoveIdeasMessage: string
  confirmYes: string
  confirmNo: string
  nextStepPrefix: string
  previousStepPrefix: string
  previousStepNone: string
  nextStepCompleted: string
  finalReportIntro: string
  reportLanguageLabel: string
  reportLanguageHint: string
  productLabel: string
  spacesLabel: string
  timeFramesLabel: string
  totalScenariosLabel: string
  chosenScenarioLabel: string
  spaceDefinitionsLabel: string
  timeDefinitionsLabel: string
  totalIdeasLabel: string
  cellsWithIdeasLabel: string
  ideasGeneratedLabel: string
  ideasUserLabel: string
  noIdeasLabel: string
  confirmProductLabel: string
  selectedLanguageLabel: string
  notSet: string
  notSelected: string
  noScenarioConfirmed: string
  enginePreviewTitle: string
  enginePreviewLandingLink: string
  enginePreviewLink: string
  enginePreviewSessionTitle: string
  enginePreviewSessionIdLabel: string
  enginePreviewSessionEmpty: string
  enginePreviewCreateSession: string
  enginePreviewReset: string
  enginePreviewBoardItemsTitle: string
  engineEntryLabelHint: string
  feedbackButtonLabel: string
  feedbackTitle: string
  feedbackDoingLabel: string
  feedbackUnclearLabel: string
  feedbackWorkaroundLabel: string
  feedbackSuggestionLabel: string
  feedbackKeywordsLabel: string
  feedbackSave: string
  feedbackCancel: string
  feedbackExport: string
  feedbackReminderText: string
  feedbackReminderSend: string
  feedbackReminderDismiss: string
  engineHelpButtonLabel: string
  enginePreviewBoardItemPlaceholder: string
  enginePreviewAddItem: string
  enginePreviewBoardItemsEmpty: string
  enginePreviewNextQuestionTitle: string
  enginePreviewSuggestQuestion: string
  enginePreviewQuestionEmpty: string
  enginePreviewNextAction: string
  enginePreviewSwapAction: string
  enginePreviewSimplifyAction: string
  enginePreviewDeepenAction: string
  enginePreviewAnswerPlaceholder: string
  enginePreviewSubmitAnswer: string
  enginePreviewNoMoreQuestions: string
  enginePreviewBackToApp: string
  enginePreviewMetaGroup: string
  enginePreviewMetaMode: string
  enginePreviewMetaCategory: string
  enginePreviewMetaDifficulty: string
  engineMatrixToggleLabel: string
  engineMatrixTitle: string
  engineSessionsToggle: string
  engineSessionsToggleOpen: string
  engineSessionsToggleClose: string
  engineSessionsTitle: string
  engineSessionsRefresh: string
  engineSessionsExport: string
  engineSessionsImport: string
  engineSessionsEmpty: string
  engineSessionsOpen: string
  engineSessionsDelete: string
  engineSessionsDeleting: string
  engineSessionDetailsTitle: string
  engineSessionDetailsIdLabel: string
  engineSessionDetailsNameLabel: string
  engineSessionDetailsUpdatedLabel: string
  engineSessionDetailsQuestionsLabel: string
  engineSessionDetailsBoardTitle: string
  engineSessionDetailsBoardEmpty: string
  engineFacilitationNote: string
  engineFacilitationNext: string
  engineFacilitationDeepen: string
  engineFacilitationPerspective: string
  engineNamePrompt: string
  engineNameLabel: string
  engineNamePlaceholder: string
  engineNameSave: string
  engineWordCountRemaining: (count: number) => string
  engineQuestionsWipNote: string
  enginePlaceholderInitial: string
  enginePlaceholderContinue: string
  engineWordLimitReached: string
  openReportPanel: string
  reportSnapshotTitle: string
  close: string
  editIdeaTitle: string
  generatedIdeaTitle: string
  questionsTitle: string
  nextQuestionsLabel: string
  prevQuestionsLabel: string
  labelEditorTitle: string
  labelEditorSave: string
  labelEditorAdd: string
  removeLabelAriaLabel: string
  engineEntryDeleteLabel: string
  engineEntryDeleteConfirm: string
  engineEntryDeleteYes: string
  engineEntryDeleteCancel: string
  labelDropPlaceholder: string
  noLabelText: string
  save: string
  llmSettingsTitle: string
  llmSettingsIntro: string
  llmApiBaseLabel: string
  llmApiBasePlaceholder: string
  llmSettingsSave: string
  llmSettingsSaved: string
  llmSettingsCostNote: string
  llmStatusOnline: string
  llmStatusOffline: string
  llmStatusUnknown: string
  llmTestConnection: string
  llmEnableConnection: string
  llmDisableConnection: string
  questionTemplates: (productName: string, spaceDef: string, timeDef: string) => string[]
  questionTemplate: (spaceDef: string, timeDef: string) => string
  llmIdeaTemplate: (spaceDef: string, timeDef: string) => string
  subsystemFallback: string
  subsystemTemplate: (productName: string) => string
  timeDefs: {
    past: (timeFrame: string) => string
    now: (timeFrame: string) => string
    future: (timeFrame: string) => string
  }
  analyzedProduct: string
  leadSpaceSuggestions: (productName: string) => string[]
  leadTimeSuggestions: (productName: string) => string[]
  spaceSuggestions: string[]
  timeSuggestions: string[]
  cellLabel: (spaceLabel: string, timeLabel: string) => string
}

const translations: Partial<Record<Language, Partial<Translations>>> & { Polish: Translations } = {
  English: {
    stepLabel: 'Step',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: 'Turn idea chaos into a clear product.',
    landingHeroSubtitle: 'No moderator. No sticky notes. No wasted time.',
    landingIntroTitleLines: [
      'makemyidea.work',
      'guides you step by step',
      'through product definition.',
    ],
    landingIntroSubtextLines: [
      'Online or on-site.',
      'Solo or with a team.',
      'AI support (if you want), but...',
      'always led by {emphasis}.',
    ],
    landingIntroSubtextEmphasis: 'you',
    landingCta: '▶ Start for free',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 steps',
    landingBeforeLead: 'If any of this sounds familiar — you are in the right place.',
    landingBeforeList: ['❌ Chaos', '❌ Lost notes', '❌ No decisions'],
    landingBeforeEmphasis: {
      strong: '',
      medium: '',
      rest: '',
    },
    landingAfterLead: 'Now the process works for you.',
    landingAfterList: ['✅ Process', '✅ Structured questions', '✅ Report'],
    landingWhyLead: 'We don’t replace thinking. We remove friction.',
    landingWhyLines: [
      'makemyidea.work',
      'structures the conversation',
      'keeps the process logical',
      'organizes knowledge in real time',
      'leaves people what matters most: decisions and creativity',
      'AI helps. Humans decide.',
    ],
    landingWhoTitle: 'Who is it for?',
    landingWhoList: [
      '🚀 You have an idea, but can’t define it well',
      '🛠️ You are a dev / PM and want real analysis, not brainstorming for sport',
      '🤝 You work with a distributed or hybrid team',
      '⏱️ You want results now, not after three workshops',
    ],
    landingFinalLines: ['You don’t need a perfect idea.', 'You need a solid process.'],
    workInProgressLink: 'Work in progress',
    impulseButtonLabel: 'Give me an impulse',
    impulseTitle: 'Suggested question',
    impulseEmpty: 'No question available yet.',
    impulseClose: 'Close',
    report: 'Report',
    llmSettings: 'LLM settings',
    languageLabel: 'Language',
    steps: {
      1: 'Tell us about your new product',
      2: 'Idea Clarity Grid scenario confirmation',
      3: 'Idea Clarity Grid workshop',
      4: 'Final report',
    },
  step1Intro: 'Define the product, spaces, and observation / thinking levels for the analysis.',
  productDescriptionLabel: 'Describe your new product/service',
  productDescriptionPlaceholder:
    'Who is it for, which age group, which market, what materials, main function, etc.',
  productDescriptionDoneLabel: 'Done',
    productNameSuggestionsLabel:
      'Name suggestions based on your description (drag a name into the product name field)',
  productNameLabel: 'Name your new product',
  productNamePlaceholder: 'e.g., modular battery pack',
    step1SpacesTitle: 'Where do we look?',
    step1TimeframesTitle: 'Observation / thinking level',
  step1DragHint: 'Drag options to the target fields below',
  step1DropHere: 'Drop here...',
    step1SystemLabel: 'Product',
  step1SystemLocked: 'Locked',
  spaceListTitle: 'Place / space list',
  spaceListHint: 'Select up to 5.',
    timeListTitle: 'Observation / thinking level list',
    timeListHint: 'Select up to 5.',
    finalSpacesList: 'Final spaces list',
    finalTimesList: 'Final observation / thinking level list',
  noSelectionYet: 'No selection yet.',
    warningMax5: 'Please keep space and time selections to 5 or fewer.',
    scenarioIntro:
      'Scenarios are generated for each space and time frame pairing. Select one and refine the axis definitions below.',
    chooseScenario: 'Choose this scenario',
    spaceLabel: 'Where do we look?',
    timeLabel: 'Observation / thinking level',
    axisSpaceLabel: 'Where do we look?',
    axisTimeLabel: 'Observation / thinking level',
    axisSubsystem: 'Elements',
    axisSystem: 'Product',
    axisSupersystem: 'World',
    axisPast: 'How is it?',
    axisNow: "What doesn't work?",
    axisFuture: 'How should it be',
    workshopIntro:
      'Use the question icon to prompt thinking. Use the idea icon to add your own post-it.',
    legendQuestion: 'Supportive question',
    legendIdea: 'New idea',
    showIdeaLabel: 'Show idea',
    supportiveQuestionTooltip: 'Supportive question',
    addIdeaTooltip: 'Add idea',
    editIdeaTooltip: 'Click to edit',
    ideaPlaceholder: 'Type your idea (max 50 words)',
    wordCount: (count) => `Remaining ${Math.max(0, 50 - count)} words`,
    cancel: 'Cancel',
    saveIdea: 'Save',
    ideaGenerator: 'Give me some ideas',
    labelEditorLabel: 'Label editor',
    keepOnlyMyIdeasLabel: 'Keep only my ideas',
    confirmRemoveIdeasTitle: 'Are you sure?',
    confirmRemoveIdeasMessage: 'This will remove all AI-generated ideas.',
    confirmYes: 'YES',
    confirmNo: 'NO',
    nextStepPrefix: 'Next step: ',
    previousStepPrefix: 'Previous step: ',
    previousStepNone: 'Previous step: none',
    nextStepCompleted: 'Next step: completed',
    finalReportIntro: 'Summary of the workshop data gathered so far.',
    reportLanguageLabel: 'Report language',
    reportLanguageHint:
      'Language selection will be used for report translation in a later version.',
    productLabel: 'Product',
    spacesLabel: 'Where do we look?',
    timeFramesLabel: 'Observation / thinking level',
    totalScenariosLabel: 'Total scenarios',
    chosenScenarioLabel: 'Chosen scenario',
    spaceDefinitionsLabel: 'Space definitions',
    timeDefinitionsLabel: 'Time definitions',
    totalIdeasLabel: 'Total ideas',
    cellsWithIdeasLabel: 'Cells with ideas',
    ideasGeneratedLabel: 'AI generated ideas',
    ideasUserLabel: 'User ideas',
    noIdeasLabel: 'No ideas yet.',
    confirmProductLabel: 'Confirm product name',
    selectedLanguageLabel: 'Selected language',
    notSet: 'Not set',
    notSelected: 'Not selected',
    noScenarioConfirmed: 'No scenario confirmed yet.',
    enginePreviewTitle: 'Question engine preview',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: 'Engine preview',
    enginePreviewSessionTitle: 'Session',
    enginePreviewSessionIdLabel: 'Session ID',
    enginePreviewSessionEmpty: 'Not created yet',
    enginePreviewCreateSession: 'Create session',
    enginePreviewReset: 'Save and close session',
    enginePreviewBoardItemsTitle: 'Board',
    engineEntryLabelHint: 'Click to add or change label',
    feedbackButtonLabel: 'Feedback',
    feedbackTitle: 'Feedback',
    feedbackDoingLabel: 'What were you doing?',
    feedbackUnclearLabel: 'What was unclear or difficult?',
    feedbackWorkaroundLabel: 'What did you do instead?',
    feedbackSuggestionLabel: 'What would help most?',
    feedbackKeywordsLabel: 'Words or phrases you used (if relevant)',
    feedbackSave: 'Save feedback',
    feedbackCancel: 'Cancel',
    feedbackExport: 'Export feedback',
    feedbackReminderText:
      'If you have a moment, please send feedback from this session — it really helps us improve.',
    feedbackReminderSend: 'Send feedback via email',
    feedbackReminderDismiss: 'Dismiss',
    engineHelpButtonLabel: 'Show helper actions',
    enginePreviewBoardItemPlaceholder: 'Describe a board item...',
    enginePreviewAddItem: 'Add item',
    enginePreviewBoardItemsEmpty: 'No board items yet.',
    enginePreviewNextQuestionTitle: 'Next question',
    enginePreviewSuggestQuestion: 'Next question',
    enginePreviewQuestionEmpty: 'No question yet.',
    enginePreviewNextAction: 'Next question',
    enginePreviewSwapAction: 'Swap',
    enginePreviewSimplifyAction: 'Simplify',
    enginePreviewDeepenAction: 'Deepen',
    enginePreviewAnswerPlaceholder: 'Type your answer...',
    enginePreviewSubmitAnswer: 'Submit answer',
    enginePreviewNoMoreQuestions: 'Step complete / no more questions.',
    enginePreviewBackToApp: 'Back to app',
    enginePreviewMetaGroup: 'Group',
    enginePreviewMetaMode: 'Mode',
    enginePreviewMetaCategory: 'Category',
    enginePreviewMetaDifficulty: 'Difficulty',
    engineMatrixToggleLabel: 'Diagnostic matrix',
    engineMatrixTitle: 'Matrix',
    engineSessionsToggle: 'Sessions',
    engineSessionsToggleOpen: 'Open session list',
    engineSessionsToggleClose: 'Close session list',
    engineSessionsTitle: 'Sessions',
    engineSessionsRefresh: 'Refresh',
    engineSessionsExport: 'Export sessions',
    engineSessionsImport: 'Import sessions',
    engineSessionsEmpty: 'No saved sessions.',
    engineSessionsOpen: 'Open session',
    engineSessionsDelete: 'Delete session',
    engineSessionsDeleting: 'Deleting...',
    engineSessionDetailsTitle: 'Session details',
    engineSessionDetailsIdLabel: 'ID',
    engineSessionDetailsNameLabel: 'Name',
    engineSessionDetailsUpdatedLabel: 'Last activity',
    engineSessionDetailsQuestionsLabel: 'Questions',
    engineSessionDetailsBoardTitle: 'Idea board',
    engineSessionDetailsBoardEmpty: 'No items.',
    engineFacilitationNote: 'If you want, I can help you look at this from another angle.',
    engineFacilitationNext: 'Next question',
    engineFacilitationDeepen: 'Deepen',
    engineFacilitationPerspective: 'Change perspective',
    engineNamePrompt: 'Give this session a name so it’s easier to return to.',
    engineNameLabel: 'Session name',
    engineNamePlaceholder: 'Session name',
    engineNameSave: 'Save and continue',
    engineWordCountRemaining: (count) => `Remaining ${count} words`,
    engineQuestionsWipNote: '',
    enginePlaceholderInitial:
      'What do you know about your product, or what you don’t know yet — start however you like.',
    enginePlaceholderContinue:
      'Continue — you can clarify, add something new, or change the thread.',
    engineWordLimitReached: 'Word limit reached.',
    openReportPanel: 'Open report panel',
    reportSnapshotTitle: 'Workshop report snapshot',
    close: 'Close',
    editIdeaTitle: 'Edit idea',
    generatedIdeaTitle: 'Generated idea',
    questionsTitle: 'Supportive questions',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Label editor',
    labelEditorSave: 'Save',
    labelEditorAdd: 'Add label',
    removeLabelAriaLabel: 'Remove label',
    engineEntryDeleteLabel: 'Delete item',
    engineEntryDeleteConfirm: 'Delete this item?',
    engineEntryDeleteYes: 'Yes',
    engineEntryDeleteCancel: 'Cancel',
    labelDropPlaceholder: 'Place your label',
    noLabelText: 'No label',
    save: 'Save',
    llmSettingsTitle: 'OpenAI server settings',
    llmSettingsIntro:
      'Connect your server to OpenAI by setting OPENAI_API_KEY and provide the API base URL.',
    llmApiBaseLabel: 'API base URL',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Save',
    llmSettingsSaved: 'Saved.',
    llmSettingsCostNote:
      'Using your API key will bill usage to your OpenAI account per their pricing.',
    llmStatusOnline: 'Server status: online',
    llmStatusOffline: 'Server status: offline',
    llmStatusUnknown: 'Server status: unknown',
    llmTestConnection: 'Test connection',
    llmEnableConnection: 'Enable OpenAI',
    llmDisableConnection: 'Disable OpenAI',
    questionTemplate: (spaceDef, timeDef) =>
      `How could "${spaceDef}" respond to "${timeDef}" and reveal a new opportunity?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Which unmet user need around "${productName}" appears in "${spaceDef}" during "${timeDef}"?`,
      `What new user behavior or trend could reshape "${productName}" in "${spaceDef}" for "${timeDef}"?`,
      `Which standards, regulations, or safety expectations are emerging for "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `What state-of-the-art tech or materials could improve "${productName}" for "${spaceDef}" in "${timeDef}"?`,
      `Where is the biggest performance bottleneck for "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `What is the best price vs performance trade-off for "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `Which features would users pay more for in "${spaceDef}" during "${timeDef}"—and which are non‑negotiable?`,
      `How could service, software, or data layers enhance "${productName}" in "${spaceDef}" during "${timeDef}"?`,
      `How should "${productName}" connect with other products in "${spaceDef}" during "${timeDef}" and what user benefit would that unlock?`,
      `What competitive alternative could beat "${productName}" on price or performance in "${spaceDef}" during "${timeDef}"?`,
      `What durability, maintenance, or lifecycle expectations should "${productName}" meet in "${spaceDef}" for "${timeDef}"?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Consider how ${spaceDef} connects with ${timeDef} to unlock customer, designer, and system insights.`,
    subsystemFallback: 'Key components: structure, power source, control layer',
    subsystemTemplate: (productName) =>
      `Key components: ${productName} housing, core module, interface layer`,
    timeDefs: {
      past: (timeFrame) => `Earlier stage of ${timeFrame}`,
      now: (timeFrame) => `Current state of ${timeFrame}`,
      future: (timeFrame) => `Next evolution of ${timeFrame}`,
    },
    analyzedProduct: 'Analyzed product',
    leadSpaceSuggestions: (productName) => [
      `Integration of ${productName} in a user ecosystem`,
      `Where ${productName} is installed`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} early manufacturing`,
      `${productName} core assembly`,
    ],
    spaceSuggestions: [
      'Home environment',
      'Vehicle cabin',
      'Industrial line',
      'Outdoor use',
      'Cold storage',
      'High heat exposure',
      'Wet environment',
      'Healthcare setting',
      'Retail display',
      'Warehousing',
      'Office workspace',
      'Public infrastructure',
      'Marine environment',
      'Aerospace cabin',
      'Construction site',
      'Smart city grid',
      'Agriculture field',
      'Data center',
      'Classroom',
      'Sports facility',
    ],
    timeSuggestions: [
      'Supplier production process',
      'In-house assembly',
      'Quality inspection',
      'Final testing',
      'Packaging process',
      'Distribution handling',
      'Customer usage phase',
      'Maintenance cycle',
      'Repair workflow',
      'End-of-life handling',
      'Recycling process',
      'Component preparation',
      'Raw material sourcing',
      'Component fabrication',
      'Surface finishing',
      'Supplier logistics',
      'Installation & commissioning',
      'Warranty service',
      'Second-life reuse',
      'Disassembly planning',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
  German: {
    stepLabel: 'Schritt',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: 'Ideenchaos in ein klares Produkt verwandeln.',
    landingHeroSubtitle: 'Kein Moderator. Keine Haftnotizen. Keine Zeitverschwendung.',
    landingIntroTitleLines: [
      'makemyidea.work',
      'führt dich Schritt für Schritt',
      'durch die Produktdefinition.',
    ],
    landingIntroSubtextLines: [
      'Online oder vor Ort.',
      'Allein oder mit Team.',
      'KI-Unterstützung (wenn du willst), aber...',
      'immer von {emphasis} gesteuert.',
    ],
    landingIntroSubtextEmphasis: 'dir',
    landingCta: 'Starte mit einer Idee, sieh es wirken.',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 Schritte',
    landingBeforeLead: 'Wenn dir das bekannt vorkommt — du bist hier richtig.',
    landingBeforeList: ['❌ Chaos', '❌ Verlorene Notizen', '❌ Keine Entscheidungen'],
    landingBeforeEmphasis: {
      strong: 'Viel Energie.',
      medium: 'Wenig Entscheidungen.',
      rest: 'Kein echter Fortschritt.',
    },
    landingAfterLead: 'Jetzt arbeitet der Prozess für dich.',
    landingAfterList: ['✅ Prozess', '✅ Strukturierte Fragen', '✅ Bericht'],
    landingWhyLead: 'Wir ersetzen Denken nicht. Wir entfernen Reibung.',
    landingWhyLines: [
      'makemyidea.work',
      'strukturiert das Gespräch',
      'hält die Prozesslogik',
      'ordnet Wissen in Echtzeit',
      'lässt den Menschen das Wichtigste: Entscheidungen und Kreativität',
      'KI hilft. Menschen entscheiden.',
    ],
    landingWhoTitle: 'Für wen?',
    landingWhoList: [
      '🚀 Du hast eine Idee, weißt aber nicht, wie du sie definierst',
      '🛠️ Du bist Dev / PM und willst echte Analyse, kein Brainstorming „zum Spaß“',
      '🤝 Du arbeitest mit einem verteilten oder hybriden Team',
      '⏱️ Du willst Ergebnisse jetzt, nicht nach drei Workshops',
    ],
    landingFinalLines: ['Du brauchst keine perfekte Idee.', 'Du brauchst einen guten Prozess.'],
    impulseButtonLabel: 'Gib mir einen Impuls',
    impulseTitle: 'Vorgeschlagene Frage',
    impulseEmpty: 'Noch keine Frage verfügbar.',
    impulseClose: 'Schließen',
    report: 'Bericht',
    llmSettings: 'LLM-Einstellungen',
    languageLabel: 'Sprache',
    steps: {
      1: 'Erzähl uns von deinem neuen Produkt',
      2: 'Idea Clarity Grid Szenariobestätigung',
      3: 'Idea Clarity Grid Workshop',
      4: 'Abschlussbericht',
    },
  step1Intro: 'Definieren Sie das Produkt, die Räume und die Beobachtungs- / Denkebenen für die Analyse.',
  productDescriptionLabel: 'Beschreiben Sie Ihr neues Produkt',
  productDescriptionPlaceholder:
    'Für wen ist es gedacht, welche Altersgruppe, welcher Markt, Materialien, Hauptfunktion usw.',
  productDescriptionDoneLabel: 'Fertig',
    productNameSuggestionsLabel:
      'Namensvorschläge basierend auf Ihrer Beschreibung (Name in das Namensfeld ziehen)',
  productNameLabel: 'Nennen Sie Ihr neues Produkt',
  productNamePlaceholder: 'z.B. modularer Batteriespeicher',
  step1SpacesTitle: 'Wo schauen wir hin?',
  step1TimeframesTitle: 'Beobachtungs- / Denkebene',
  step1DragHint: 'Optionen in die Zielfelder unten ziehen',
  step1DropHere: 'Hier ablegen...',
  step1SystemLabel: 'Produkt',
  step1SystemLocked: 'Gesperrt',
  spaceListTitle: 'Ort-/Raumliste',
  spaceListHint: 'Wählen Sie bis zu 5 aus.',
    timeListTitle: 'Liste der Beobachtungs- / Denkebenen',
    timeListHint: 'Wählen Sie bis zu 5 aus.',
    finalSpacesList: 'Endgültige Raumliste',
    finalTimesList: 'Endgültige Beobachtungs- / Denkebenen',
    noSelectionYet: 'Noch keine Auswahl.',
    warningMax5: 'Bitte halten Sie die Auswahl auf höchstens 5 Einträge.',
    scenarioIntro:
      'Szenarien werden für jede Raum- und Zeitrahmenkombination erzeugt. Wählen Sie eines aus und verfeinern Sie die Achsendefinitionen.',
    chooseScenario: 'Dieses Szenario wählen',
    spaceLabel: 'Wo schauen wir hin?',
    timeLabel: 'Beobachtungs- / Denkebene',
    axisSpaceLabel: 'Wo schauen wir hin?',
    axisTimeLabel: 'Beobachtungs- / Denkebene',
    axisSubsystem: 'Elemente',
    axisSystem: 'Produkt',
    axisSupersystem: 'Welt',
    axisPast: 'Wie ist es?',
    axisNow: 'Was funktioniert nicht?',
    axisFuture: 'Wie sollte es sein?',
    workshopIntro:
      'Nutzen Sie das Fragezeichen-Symbol für Impulse. Verwenden Sie das Ideen-Symbol, um eigene Notizen hinzuzufügen.',
    legendQuestion: 'Unterstützende Frage',
    legendIdea: 'Neue Idee',
    showIdeaLabel: 'Idee anzeigen',
    supportiveQuestionTooltip: 'Unterstützende Frage',
    addIdeaTooltip: 'Idee hinzufügen',
    editIdeaTooltip: 'Klicken zum Bearbeiten',
    ideaPlaceholder: 'Schreiben Sie Ihre Idee (max. 50 Wörter)',
    wordCount: (count) => `Verbleibend ${Math.max(0, 50 - count)} Wörter`,
    cancel: 'Abbrechen',
    saveIdea: 'Speichern',
    ideaGenerator: 'Gib mir Ideen',
    labelEditorLabel: 'Label-Editor',
    keepOnlyMyIdeasLabel: 'Nur meine Ideen behalten',
    confirmRemoveIdeasTitle: 'Bist du sicher?',
    confirmRemoveIdeasMessage: 'Alle KI-generierten Ideen werden entfernt.',
    confirmYes: 'JA',
    confirmNo: 'NEIN',
    nextStepPrefix: 'Nächster Schritt: ',
    previousStepPrefix: 'Vorheriger Schritt: ',
    previousStepNone: 'Vorheriger Schritt: keiner',
    nextStepCompleted: 'Nächster Schritt: abgeschlossen',
    finalReportIntro: 'Zusammenfassung der bisher gesammelten Workshop-Daten.',
    reportLanguageLabel: 'Berichtssprache',
    reportLanguageHint:
      'Die Sprachauswahl wird in einer späteren Version für die Übersetzung verwendet.',
    productLabel: 'Produkt',
    spacesLabel: 'Wo schauen wir hin?',
    timeFramesLabel: 'Beobachtungs- / Denkebene',
    totalScenariosLabel: 'Gesamte Szenarien',
    chosenScenarioLabel: 'Gewähltes Szenario',
    spaceDefinitionsLabel: 'Raumdefinitionen',
    timeDefinitionsLabel: 'Zeitdefinitionen',
    totalIdeasLabel: 'Gesamtideen',
    cellsWithIdeasLabel: 'Felder mit Ideen',
    ideasGeneratedLabel: 'KI-generierte Ideen',
    ideasUserLabel: 'Benutzerideen',
    noIdeasLabel: 'Noch keine Ideen.',
    confirmProductLabel: 'Produktnamen bestätigen',
    selectedLanguageLabel: 'Gewählte Sprache',
    notSet: 'Nicht festgelegt',
    notSelected: 'Nicht ausgewählt',
    noScenarioConfirmed: 'Noch kein Szenario bestätigt.',
    enginePreviewTitle: 'Fragen-Engine Vorschau',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: 'Engine Vorschau',
    enginePreviewSessionTitle: 'Sitzung',
    enginePreviewSessionIdLabel: 'Sitzungs-ID',
    enginePreviewSessionEmpty: 'Noch nicht erstellt',
    enginePreviewCreateSession: 'Sitzung erstellen',
    enginePreviewReset: 'Sitzung schließen',
    enginePreviewBoardItemsTitle: 'Board-Elemente',
    enginePreviewBoardItemPlaceholder: 'Board-Element beschreiben...',
    enginePreviewAddItem: 'Hinzufügen',
    enginePreviewBoardItemsEmpty: 'Noch keine Elemente.',
    enginePreviewNextQuestionTitle: 'Nächste Frage',
    enginePreviewSuggestQuestion: 'Nächste Frage',
    enginePreviewQuestionEmpty: 'Noch keine Frage.',
    enginePreviewNextAction: 'Nächste Frage',
    enginePreviewSwapAction: 'Tauschen',
    enginePreviewSimplifyAction: 'Vereinfachen',
    enginePreviewDeepenAction: 'Vertiefen',
    enginePreviewAnswerPlaceholder: 'Antwort eingeben...',
    enginePreviewSubmitAnswer: 'Antwort senden',
    enginePreviewNoMoreQuestions: 'Schritt abgeschlossen / keine weiteren Fragen.',
    enginePreviewBackToApp: 'Zurück zur App',
    enginePreviewMetaGroup: 'Gruppe',
    enginePreviewMetaMode: 'Modus',
    enginePreviewMetaCategory: 'Kategorie',
    enginePreviewMetaDifficulty: 'Schwierigkeit',
    openReportPanel: 'Berichtspanel öffnen',
    reportSnapshotTitle: 'Workshop-Berichtsübersicht',
    close: 'Schließen',
    editIdeaTitle: 'Idee bearbeiten',
    generatedIdeaTitle: 'Generierte Idee',
    questionsTitle: 'Unterstützende Fragen',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Label-Editor',
    labelEditorSave: 'Speichern',
    labelEditorAdd: 'Label hinzufügen',
    removeLabelAriaLabel: 'Label entfernen',
    labelDropPlaceholder: 'Label hier ablegen',
    noLabelText: 'Kein Label',
    save: 'Speichern',
    llmSettingsTitle: 'OpenAI-Servereinstellungen',
    llmSettingsIntro:
      'Verbinden Sie Ihren Server mit OpenAI (OPENAI_API_KEY) und geben Sie die API-Basis-URL an.',
    llmApiBaseLabel: 'API-Basis-URL',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Speichern',
    llmSettingsSaved: 'Gespeichert.',
    llmSettingsCostNote:
      'Die Nutzung Ihres API-Schlüssels wird Ihrem OpenAI-Konto gemäß deren Preisen berechnet.',
    llmStatusOnline: 'Serverstatus: online',
    llmStatusOffline: 'Serverstatus: offline',
    llmStatusUnknown: 'Serverstatus: unbekannt',
    llmTestConnection: 'Verbindung testen',
    llmEnableConnection: 'OpenAI aktivieren',
    llmDisableConnection: 'OpenAI deaktivieren',
    questionTemplate: (spaceDef, timeDef) =>
      `Wie könnte "${spaceDef}" auf "${timeDef}" reagieren und eine neue Chance eröffnen?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Welche unerfüllte Nutzerbedürfnis rund um "${productName}" zeigt sich in "${spaceDef}" während "${timeDef}"?`,
      `Welche neuen Nutzertrends könnten "${productName}" in "${spaceDef}" für "${timeDef}" verändern?`,
      `Welche Standards, Vorschriften oder Sicherheitsanforderungen entstehen für "${productName}" in "${spaceDef}" während "${timeDef}"?`,
      `Welche State‑of‑the‑Art‑Technologie oder Materialien verbessern "${productName}" in "${spaceDef}" für "${timeDef}"?`,
      `Wo liegt der größte Leistungs‑Engpass für "${productName}" in "${spaceDef}" während "${timeDef}"?`,
      `Wie sieht der beste Preis‑Leistungs‑Trade‑off für "${productName}" in "${spaceDef}" während "${timeDef}" aus?`,
      `Für welche Features würden Nutzer in "${spaceDef}" während "${timeDef}" mehr bezahlen – und was ist Pflicht?`,
      `Wie können Service, Software oder Datenebenen "${productName}" in "${spaceDef}" während "${timeDef}" aufwerten?`,
      `Wie sollte "${productName}" in "${spaceDef}" während "${timeDef}" mit anderen Produkten vernetzt sein – und welchen Nutzen bringt das?`,
      `Welche Alternative könnte "${productName}" bei Preis oder Leistung in "${spaceDef}" während "${timeDef}" schlagen?`,
      `Welche Haltbarkeits‑, Wartungs‑ oder Lebensdauer‑Erwartungen muss "${productName}" in "${spaceDef}" für "${timeDef}" erfüllen?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Überlegen Sie, wie ${spaceDef} mit ${timeDef} verknüpft ist, um Kunden-, Designer- und Systemperspektiven zu erschließen.`,
    subsystemFallback: 'Schlüsselkomponenten: Struktur, Energiequelle, Steuerungsebene',
    subsystemTemplate: (productName) =>
      `Schlüsselkomponenten: ${productName}-Gehäuse, Kernmodul, Schnittstellenschicht`,
    timeDefs: {
      past: (timeFrame) => `Frühere Phase von ${timeFrame}`,
      now: (timeFrame) => `Aktueller Stand von ${timeFrame}`,
      future: (timeFrame) => `Nächste Entwicklung von ${timeFrame}`,
    },
    analyzedProduct: 'Analysiertes Produkt',
    leadSpaceSuggestions: (productName) => [
      `Integration von ${productName} in ein Nutzer-Ökosystem`,
      `Wo ${productName} installiert ist`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} frühe Fertigung`,
      `${productName} Kernmontage`,
    ],
    spaceSuggestions: [
      'Wohnumgebung',
      'Fahrzeugkabine',
      'Industrieanlage',
      'Außeneinsatz',
      'Kühlraum',
      'Hohe Hitzeeinwirkung',
      'Feuchte Umgebung',
      'Gesundheitswesen',
      'Einzelhandelsfläche',
      'Lagerhaltung',
      'Büroarbeitsplatz',
      'Öffentliche Infrastruktur',
      'Maritime Umgebung',
      'Luftfahrtkabine',
      'Baustelle',
      'Smart-City-Netz',
      'Landwirtschaftliche Fläche',
      'Rechenzentrum',
      'Klassenzimmer',
      'Sportanlage',
    ],
    timeSuggestions: [
      'Produktion beim Zulieferer',
      'Interne Montage',
      'Qualitätsprüfung',
      'Endprüfung',
      'Verpackungsprozess',
      'Distributionshandling',
      'Nutzungsphase beim Kunden',
      'Wartungszyklus',
      'Reparaturablauf',
      'End-of-Life-Abwicklung',
      'Recyclingprozess',
      'Komponentenvorbereitung',
      'Rohstoffbeschaffung',
      'Komponentenfertigung',
      'Oberflächenbearbeitung',
      'Zuliefererlogistik',
      'Installation & Inbetriebnahme',
      'Garantieservice',
      'Zweitnutzung',
      'Demontageplanung',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
  Polish: {
    stepLabel: 'Krok',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: 'Zamień chaos pomysłów w klarowny produkt.',
    landingHeroSubtitle: 'Bez moderatora. Bez karteczek. Bez straty czasu.',
    landingIntroTitleLines: [
      'makemyidea.work',
      'prowadzi Cię krok po kroku',
      'przez proces definiowania produktu.',
    ],
    landingIntroSubtextLines: [
      'On-line lub on-site.',
      'Solo lub z zespołem.',
      'Wspierane przez AI (jeżeli chcesz), ale...',
      'sterowane zawsze przez {emphasis}.',
    ],
    landingIntroSubtextEmphasis: 'Ciebie',
    landingCta: '▶ Zacznij za darmo',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 kroki',
    landingBeforeLead: 'Jeśli choć jedno brzmi znajomo — jesteś w dobrym miejscu.',
    landingBeforeList: ['❌ Chaos', '❌ Zgubione notatki', '❌ Brak decyzji'],
    landingBeforeEmphasis: {
      strong: '',
      medium: '',
      rest: '',
    },
    landingAfterLead: 'Teraz proces pracuje dla Ciebie.',
    landingAfterList: ['✅ Proces', '✅ Ustrukturyzowane pytania', '✅ Raport'],
    landingWhyLead: 'Nie zastępujemy myślenia. Usuwamy tarcie.',
    landingWhyLines: [
      'makemyidea.work',
      'strukturyzuje rozmowę',
      'pilnuje logiki procesu',
      'porządkuje wiedzę w czasie rzeczywistym',
      'zostawia ludziom to, co najważniejsze: decyzje i kreatywność',
      'AI pomaga. Człowiek decyduje.',
    ],
    landingWhoTitle: 'Dla kogo?',
    landingWhoList: [
      '🚀 Masz pomysł, ale nie wiesz jak go dobrze zdefiniować',
      '🛠️ Jesteś devem / PM-em i chcesz sensownej analizy, nie burzy mózgów „dla sportu”',
      '🤝 Pracujesz z zespołem rozproszonym lub hybrydowym',
      '⏱️ Chcesz efektów teraz, a nie po 3 warsztatach',
    ],
    landingFinalLines: ['Nie potrzebujesz idealnego pomysłu.', 'Potrzebujesz dobrego procesu.'],
    workInProgressLink: 'Work in progress',
    impulseButtonLabel: 'Daj mi impuls',
    impulseTitle: 'Sugerowane pytanie',
    impulseEmpty: 'Brak pytania na ten moment.',
    impulseClose: 'Zamknij',
    report: 'Raport',
    llmSettings: 'Ustawienia LLM',
    languageLabel: 'Język',
    steps: {
      1: 'Opowiedz o swoim nowym produkcie',
      2: 'Potwierdzenie scenariusza Idea Clarity Grid',
      3: 'Warsztat Idea Clarity Grid',
      4: 'Raport końcowy',
    },
  step1Intro: 'Zdefiniuj produkt, przestrzenie oraz poziomy obserwacji / myślenia.',
  productDescriptionLabel: 'Opisz swój nowy produkt',
  productDescriptionPlaceholder:
    'Dla kogo, jaka grupa wiekowa, jaki rynek, z czego zrobiony, główna funkcja itd.',
  productDescriptionDoneLabel: 'Gotowe',
    productNameSuggestionsLabel:
      'Propozycje nazw na podstawie opisu (przeciągnij nazwę do pola nazwy produktu)',
  productNameLabel: 'Nazwij swój nowy produkt',
  productNamePlaceholder: 'np. modułowy pakiet baterii',
    step1SpacesTitle: 'Gdzie patrzymy?',
    step1TimeframesTitle: 'Poziom obserwacji / myślenia',
  step1DragHint: 'Przeciągnij opcje do pól docelowych poniżej',
  step1DropHere: 'Upuść tutaj...',
    step1SystemLabel: 'Produkt',
  step1SystemLocked: 'Zablokowane',
  spaceListTitle: 'Lista miejsc / przestrzeni',
  spaceListHint: 'Wybierz maksymalnie 5.',
  timeListTitle: 'Lista poziomów obserwacji / myślenia',
  timeListHint: 'Wybierz maksymalnie 5.',
  finalSpacesList: 'Końcowa lista przestrzeni',
  finalTimesList: 'Końcowa lista poziomów obserwacji / myślenia',
  noSelectionYet: 'Brak wyboru.',
  warningMax5:
    'Wybierz maksymalnie 5 pozycji dla przestrzeni i poziomów obserwacji / myślenia.',
    scenarioIntro:
      'Scenariusze są generowane dla każdej pary przestrzeń–czas. Wybierz jeden i doprecyzuj definicje osi.',
    chooseScenario: 'Wybierz ten scenariusz',
    spaceLabel: 'Gdzie patrzymy?',
    timeLabel: 'Poziom obserwacji / myślenia',
    axisSpaceLabel: 'Gdzie patrzymy?',
    axisTimeLabel: 'Poziom obserwacji / myślenia',
    axisSubsystem: 'Elementy',
    axisSystem: 'Produkt',
    axisSupersystem: 'Świat',
    axisPast: 'Jak jest?',
    axisNow: 'Co nie działa?',
    axisFuture: 'Jak powinno być',
    workshopIntro:
      'Użyj ikony pytania, aby uzyskać podpowiedź. Użyj ikony pomysłu, aby dodać własną karteczkę.',
    legendQuestion: 'Pytanie wspierające',
    legendIdea: 'Nowy pomysł',
    showIdeaLabel: 'Pokaż pomysł',
    supportiveQuestionTooltip: 'Pytanie wspierające',
    addIdeaTooltip: 'Wstaw pomysł',
    editIdeaTooltip: 'Kliknij, aby edytować',
    ideaPlaceholder: 'Wpisz pomysł (maks. 50 słów)',
    wordCount: (count) => `Pozostało ${Math.max(0, 50 - count)} słów`,
    cancel: 'Anuluj',
    saveIdea: 'Zapisz',
    ideaGenerator: 'Daj pomysły',
    labelEditorLabel: 'Edytor etykiet',
    keepOnlyMyIdeasLabel: 'Zostaw tylko moje pomysły',
    confirmRemoveIdeasTitle: 'Czy na pewno?',
    confirmRemoveIdeasMessage: 'To usunie wszystkie pomysły wygenerowane przez AI.',
    confirmYes: 'TAK',
    confirmNo: 'NIE',
    nextStepPrefix: 'Następny krok: ',
    previousStepPrefix: 'Poprzedni krok: ',
    previousStepNone: 'Poprzedni krok: brak',
    nextStepCompleted: 'Następny krok: zakończono',
    finalReportIntro: 'Podsumowanie danych zebranych podczas warsztatu.',
    reportLanguageLabel: 'Język raportu',
    reportLanguageHint:
      'Wybór języka będzie użyty do tłumaczenia raportu w późniejszej wersji.',
    productLabel: 'Produkt',
    spacesLabel: 'Gdzie patrzymy?',
    timeFramesLabel: 'Poziom obserwacji / myślenia',
    totalScenariosLabel: 'Liczba scenariuszy',
    chosenScenarioLabel: 'Wybrany scenariusz',
    spaceDefinitionsLabel: 'Definicje przestrzeni',
    timeDefinitionsLabel: 'Definicje czasu',
    totalIdeasLabel: 'Liczba pomysłów',
    cellsWithIdeasLabel: 'Pola z pomysłami',
    ideasGeneratedLabel: 'Pomysły wygenerowane przez AI',
    ideasUserLabel: 'Pomysły użytkownika',
    noIdeasLabel: 'Brak pomysłów.',
    confirmProductLabel: 'Zatwierdź nazwę produktu',
    selectedLanguageLabel: 'Wybrany język',
    notSet: 'Nie ustawiono',
    notSelected: 'Nie wybrano',
    noScenarioConfirmed: 'Brak potwierdzonego scenariusza.',
    openReportPanel: 'Otwórz panel raportu',
    reportSnapshotTitle: 'Podgląd raportu z warsztatu',
    close: 'Zamknij',
    editIdeaTitle: 'Edytuj pomysł',
    generatedIdeaTitle: 'Wygenerowany pomysł',
    questionsTitle: 'Pytania naprowadzające',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Edytor etykiet',
    labelEditorSave: 'Zapisz',
    labelEditorAdd: 'Dodaj etykietę',
    removeLabelAriaLabel: 'Usuń etykietę',
    engineEntryDeleteLabel: 'Usuń wpis',
    engineEntryDeleteConfirm: 'Usunąć ten wpis?',
    engineEntryDeleteYes: 'Tak',
    engineEntryDeleteCancel: 'Cofnij',
    labelDropPlaceholder: 'Upuść etykietę',
    noLabelText: 'Brak etykiety',
    save: 'Zapisz',
    enginePreviewTitle: 'Podgląd silnika pytań',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: 'Podgląd silnika',
    enginePreviewSessionTitle: 'Sesja',
    enginePreviewSessionIdLabel: 'ID sesji',
    enginePreviewSessionEmpty: 'Jeszcze nie utworzono',
    enginePreviewCreateSession: 'Utwórz sesję',
    enginePreviewReset: 'Zapisz i zamknij sesję',
    enginePreviewBoardItemsTitle: 'Tablica',
    engineEntryLabelHint: 'Kliknij żeby dodać lub zmienić etykietę',
    feedbackButtonLabel: 'Feedback',
    feedbackTitle: 'Feedback',
    feedbackDoingLabel: 'Co robiłeś/aś?',
    feedbackUnclearLabel: 'Co było niejasne lub trudne?',
    feedbackWorkaroundLabel: 'Co zrobiłeś/aś zamiast tego?',
    feedbackSuggestionLabel: 'Co najbardziej by pomogło?',
    feedbackKeywordsLabel: 'Słowa lub frazy, których użyłeś/aś (jeśli dotyczy)',
    feedbackSave: 'Zapisz feedback',
    feedbackCancel: 'Anuluj',
    feedbackExport: 'Eksportuj feedback',
    feedbackReminderText:
      'Jeśli masz chwilę, wyślij nam feedback z tej sesji — bardzo pomoże w dalszym rozwoju.',
    feedbackReminderSend: 'Wyślij feedback e-mailem',
    feedbackReminderDismiss: 'Pomiń',
    engineHelpButtonLabel: 'Pokaż działania pomocnicze',
    enginePreviewBoardItemPlaceholder: 'Opisz element tablicy...',
    enginePreviewAddItem: 'Dodaj',
    enginePreviewBoardItemsEmpty: 'Brak elementów.',
    enginePreviewNextQuestionTitle: 'Następne pytanie',
    enginePreviewSuggestQuestion: 'Następne pytanie',
    enginePreviewQuestionEmpty: 'Brak pytania.',
    enginePreviewNextAction: 'Następne pytanie',
    enginePreviewSwapAction: 'Zamień',
    enginePreviewSimplifyAction: 'Uprość',
    enginePreviewDeepenAction: 'Pogłęb',
    enginePreviewAnswerPlaceholder: 'Wpisz odpowiedź...',
    enginePreviewSubmitAnswer: 'Zapisz odpowiedź',
    enginePreviewNoMoreQuestions: 'Koniec kroku / brak dalszych pytań.',
    enginePreviewBackToApp: 'Wróć do aplikacji',
    enginePreviewMetaGroup: 'Grupa',
    enginePreviewMetaMode: 'Tryb',
    enginePreviewMetaCategory: 'Kategoria',
    enginePreviewMetaDifficulty: 'Trudność',
    engineMatrixToggleLabel: 'Matryca diagnostyczna',
    engineMatrixTitle: 'Matryca',
    engineSessionsToggle: 'Lista sesji',
    engineSessionsToggleOpen: 'Otwórz listę sesji',
    engineSessionsToggleClose: 'Zamknij listę sesji',
    engineSessionsTitle: 'Sesje',
    engineSessionsRefresh: 'Odśwież',
    engineSessionsExport: 'Eksportuj sesje',
    engineSessionsImport: 'Importuj sesje',
    engineSessionsEmpty: 'Brak zapisanych sesji.',
    engineSessionsOpen: 'Otwórz sesję',
    engineSessionsDelete: 'Usuń sesję',
    engineSessionsDeleting: 'Usuwanie...',
    engineSessionDetailsTitle: 'Szczegóły sesji',
    engineSessionDetailsIdLabel: 'ID',
    engineSessionDetailsNameLabel: 'Nazwa',
    engineSessionDetailsUpdatedLabel: 'Ostatnia aktywność',
    engineSessionDetailsQuestionsLabel: 'Zapytania',
    engineSessionDetailsBoardTitle: 'Tablica opisująca twój pomysł',
    engineSessionDetailsBoardEmpty: 'Brak elementów.',
    engineFacilitationNote: 'Jeśli chcesz, mogę pomóc spojrzeć na to z innej strony.',
    engineFacilitationNext: 'Następne pytanie',
    engineFacilitationDeepen: 'Pogłęb',
    engineFacilitationPerspective: 'Zmień perspektywę',
    engineNamePrompt: 'Nadaj nazwę tej sesji, żeby łatwiej do niej wrócić.',
    engineNameLabel: 'Nazwa sesji',
    engineNamePlaceholder: 'Nazwa sesji',
    engineNameSave: 'Zapisz i kontynuuj',
    engineWordCountRemaining: (count) => `Pozostało ${count} słów`,
    engineQuestionsWipNote: '',
    engineWordLimitReached: 'Osiągnięto limit słów.',
    enginePlaceholderInitial:
      'Co wiesz o swoim produkcie albo czego nie wiesz — zacznij tak, jak wolisz.',
    enginePlaceholderContinue:
      'Kontynuuj — możesz doprecyzować, dodać coś nowego albo zmienić wątek.',
    llmSettingsTitle: 'Ustawienia serwera OpenAI',
    llmSettingsIntro:
      'Połącz swój serwer z OpenAI (OPENAI_API_KEY) i podaj adres API.',
    llmApiBaseLabel: 'Adres API',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Zapisz',
    llmSettingsSaved: 'Zapisano.',
    llmSettingsCostNote:
      'Użycie klucza API obciąża Twoje konto OpenAI zgodnie z ich cennikiem.',
    llmStatusOnline: 'Status serwera: online',
    llmStatusOffline: 'Status serwera: offline',
    llmStatusUnknown: 'Status serwera: nieznany',
    llmTestConnection: 'Testuj połączenie',
    llmEnableConnection: 'Włącz OpenAI',
    llmDisableConnection: 'Wyłącz OpenAI',
    questionTemplate: (spaceDef, timeDef) =>
      `Jak "${spaceDef}" może odpowiedzieć na "${timeDef}" i ujawnić nową szansę?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Jaki konkretny problem "${productName}" rozwiązuje w "${spaceDef}" podczas "${timeDef}" – i dla kogo?`,
      `Kim jest pierwszy realny klient "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jak klient radzi sobie dziś z tym problemem w "${spaceDef}" podczas "${timeDef}"?`,
      `Dlaczego rozwiązanie "${productName}" jest lepsze lub inne w "${spaceDef}" podczas "${timeDef}"?`,
      `Jaką wartość mierzalną daje "${productName}" w "${spaceDef}" podczas "${timeDef}" (czas, koszty, ryzyko, komfort)?`,
      `Co musi się wydarzyć, żeby klient powiedział „biorę” dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jak wygląda pierwsza wersja (MVP) "${productName}" dla "${spaceDef}" podczas "${timeDef}"?`,
      `Jak planujesz dotrzeć do klientów "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie są największe ryzyka "${productName}" w "${spaceDef}" podczas "${timeDef}" (techniczne, rynkowe, regulacyjne, kosztowe)?`,
      `Po czym poznasz sukces lub potrzebę zatrzymania "${productName}" w "${spaceDef}" podczas "${timeDef}" (KPI 6–12 mies.)?`,
      `Jakie nowe potrzeby użytkownika pojawiają się dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Które funkcje "${productName}" w "${spaceDef}" podczas "${timeDef}" są kluczowe, a które zbędne?`,
      `Jakie standardy, normy lub certyfikacje mogą być wymagane dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie trendy, mody lub zmiany stylu życia wpływają na "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jaki jest oczekiwany poziom jakości i niezawodności "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie kompromisy price vs performance są akceptowalne dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Czy użytkownik jest skłonny zapłacić więcej za lepszą wydajność "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie argumenty cenowe przekonają klienta do "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie nowe materiały lub technologie mogą poprawić "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie ograniczenia energetyczne wpływają na "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Czy "${productName}" powinien komunikować się z innymi produktami w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie korzyści dla użytkownika daje integracja "${productName}" z innymi produktami w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie dane z "${productName}" w "${spaceDef}" podczas "${timeDef}" byłyby wartościowe dla użytkownika?`,
      `Jakie bariery wdrożenia lub integracji "${productName}" istnieją w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie konkurencyjne rozwiązania dominują w "${spaceDef}" podczas "${timeDef}" i czym się wyróżniają?`,
      `Jakie ryzyka prawne lub regulacyjne mogą wpłynąć na "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie wymagania dotyczące bezpieczeństwa użytkownika są krytyczne dla "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie wymagania dotyczące serwisu i utrzymania powinien spełnić "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jak długo użytkownik oczekuje bezawaryjnej pracy "${productName}" w "${spaceDef}" podczas "${timeDef}"?`,
      `Jakie elementy "${productName}" mogą być zoptymalizowane kosztowo bez utraty wartości w "${spaceDef}" podczas "${timeDef}"?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Rozważ, jak ${spaceDef} łączy się z ${timeDef}, aby odkryć perspektywy klienta, projektanta i systemu.`,
    subsystemFallback: 'Kluczowe komponenty: struktura, źródło zasilania, warstwa sterowania',
    subsystemTemplate: (productName) =>
      `Kluczowe komponenty: obudowa ${productName}, moduł główny, warstwa interfejsu`,
    timeDefs: {
      past: (timeFrame) => `Wcześniejszy etap: ${timeFrame}`,
      now: (timeFrame) => `Aktualny stan: ${timeFrame}`,
      future: (timeFrame) => `Następna ewolucja: ${timeFrame}`,
    },
    analyzedProduct: 'Analizowany produkt',
    leadSpaceSuggestions: (productName) => [
      `Integracja ${productName} w ekosystemie użytkownika`,
      `Gdzie ${productName} jest instalowany`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} – wczesna produkcja`,
      `${productName} – montaż główny`,
    ],
    spaceSuggestions: [
      'Środowisko domowe',
      'Kabina pojazdu',
      'Linia przemysłowa',
      'Użytkowanie na zewnątrz',
      'Chłodnia',
      'Wysoka temperatura',
      'Wilgotne środowisko',
      'Środowisko medyczne',
      'Ekspozycja w sklepie',
      'Magazyn',
      'Biuro',
      'Infrastruktura publiczna',
      'Środowisko morskie',
      'Kabina lotnicza',
      'Plac budowy',
      'Sieć smart city',
      'Pole uprawne',
      'Centrum danych',
      'Sala lekcyjna',
      'Obiekt sportowy',
    ],
    timeSuggestions: [
      'Proces produkcyjny u dostawcy',
      'Montaż wewnętrzny',
      'Kontrola jakości',
      'Test końcowy',
      'Proces pakowania',
      'Obsługa dystrybucji',
      'Faza użytkowania',
      'Cykl konserwacji',
      'Proces naprawy',
      'Zakończenie życia produktu',
      'Proces recyklingu',
      'Przygotowanie komponentów',
      'Pozyskanie surowców',
      'Wytwarzanie komponentów',
      'Wykończenie powierzchni',
      'Logistyka dostawców',
      'Instalacja i uruchomienie',
      'Serwis gwarancyjny',
      'Drugie życie produktu',
      'Planowanie demontażu',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
  Chinese: {
    stepLabel: '步骤',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: '把想法的混乱变成清晰的产品。',
    landingHeroSubtitle: '无需主持人。无需便利贴。无需浪费时间。',
    landingIntroTitleLines: [
      'makemyidea.work',
      '一步一步引导你',
      '完成产品定义。',
    ],
    landingIntroSubtextLines: [
      '线上或线下。',
      '独立或团队。',
      'AI 支持（如果你需要），但...',
      '始终由{emphasis}掌控。',
    ],
    landingIntroSubtextEmphasis: '你',
    landingCta: '从想法开始，看看效果。',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 步',
    landingBeforeLead: '如果有任何一句听起来熟悉——你来对了地方。',
    landingBeforeList: ['❌ 混乱', '❌ 笔记丢失', '❌ 没有决策'],
    landingBeforeEmphasis: {
      strong: '很多精力。',
      medium: '很少决策。',
      rest: '没有实质进展。',
    },
    landingAfterLead: '现在流程为你工作。',
    landingAfterList: ['✅ 流程', '✅ 结构化问题', '✅ 报告'],
    landingWhyLead: '我们不取代思考。我们去掉摩擦。',
    landingWhyLines: [
      'makemyidea.work',
      '让对话结构化',
      '确保流程逻辑',
      '实时整理知识',
      '把关键留给人：决策与创造力',
      'AI 帮助，人来决定。',
    ],
    landingWhoTitle: '适合谁？',
    landingWhoList: [
      '🚀 有想法，但不知道怎么定义',
      '🛠️ 你是开发者 / PM，想要真正的分析而不是“为了气氛”的头脑风暴',
      '🤝 分布式或混合团队',
      '⏱️ 想要现在就看到结果，而不是三次工作坊之后',
    ],
    landingFinalLines: ['你不需要完美的想法。', '你需要一个好流程。'],
    impulseButtonLabel: '给我一个启发',
    impulseTitle: '推荐问题',
    impulseEmpty: '暂时没有可用的问题。',
    impulseClose: '关闭',
    report: '报告',
    llmSettings: 'LLM 设置',
    languageLabel: '语言',
    steps: {
      1: '介绍你的新产品',
      2: 'Idea Clarity Grid 情景确认',
      3: 'Idea Clarity Grid 工作坊',
      4: '最终报告',
    },
  step1Intro: '定义产品、观察视角与分析层级。',
  productDescriptionLabel: '描述你的新产品',
  productDescriptionPlaceholder:
    '面向谁、年龄层、市场、材料、主要功能等。',
  productDescriptionDoneLabel: '完成',
    productNameSuggestionsLabel: '基于描述的名称建议（拖到产品名称字段）',
  productNameLabel: '为你的新产品命名',
  productNamePlaceholder: '例如：模块化电池包',
  step1SpacesTitle: '我们看向哪里？',
  step1TimeframesTitle: '观察 / 思考层级',
  step1DragHint: '将选项拖到下方目标区域',
  step1DropHere: '放这里…',
  step1SystemLabel: '产品',
  step1SystemLocked: '已锁定',
  spaceListTitle: '场景/空间列表',
  spaceListHint: '最多选择 5 个。',
    timeListTitle: '观察/思考层级列表',
    timeListHint: '最多选择 5 个。',
    finalSpacesList: '最终空间列表',
    finalTimesList: '最终观察/思考层级列表',
    noSelectionYet: '尚未选择。',
    warningMax5: '请将空间和观察/思考层级的选择控制在 5 个以内。',
    scenarioIntro: '系统会为每一对空间与层级生成情景。请选择一个并完善轴定义。',
    chooseScenario: '选择此情景',
    spaceLabel: '我们看向哪里？',
    timeLabel: '观察 / 思考层级',
    axisSpaceLabel: '我们看向哪里？',
    axisTimeLabel: '观察 / 思考层级',
    axisSubsystem: '元素',
    axisSystem: '产品',
    axisSupersystem: '世界',
    axisPast: '现状如何？',
    axisNow: '哪里失效？',
    axisFuture: '理想应当如何？',
    workshopIntro: '点击问号图标获取提示；点击灯泡图标添加想法。',
    legendQuestion: '支持性问题',
    legendIdea: '新想法',
    showIdeaLabel: '显示想法',
    supportiveQuestionTooltip: '支持性问题',
    addIdeaTooltip: '添加想法',
    editIdeaTooltip: '点击编辑',
    ideaPlaceholder: '输入你的想法（最多 50 词）',
    wordCount: (count) => `剩余 ${Math.max(0, 50 - count)} 词`,
    cancel: '取消',
    saveIdea: '保存',
    ideaGenerator: '给我一些想法',
    labelEditorLabel: '标签编辑器',
    keepOnlyMyIdeasLabel: '只保留我的想法',
    confirmRemoveIdeasTitle: '你确定吗？',
    confirmRemoveIdeasMessage: '这将删除所有 AI 生成的想法。',
    confirmYes: '是',
    confirmNo: '否',
    nextStepPrefix: '下一步：',
    previousStepPrefix: '上一步：',
    previousStepNone: '上一步：无',
    nextStepCompleted: '下一步：已完成',
    finalReportIntro: '当前工作坊数据摘要。',
    reportLanguageLabel: '报告语言',
    reportLanguageHint: '语言选择将在后续版本用于报告翻译。',
    productLabel: '产品',
    spacesLabel: '我们看向哪里？',
    timeFramesLabel: '观察 / 思考层级',
    totalScenariosLabel: '情景总数',
    chosenScenarioLabel: '已选情景',
    spaceDefinitionsLabel: '空间定义',
    timeDefinitionsLabel: '时间定义',
    totalIdeasLabel: '想法总数',
    cellsWithIdeasLabel: '有想法的单元格',
    ideasGeneratedLabel: 'AI 生成的想法',
    ideasUserLabel: '用户想法',
    noIdeasLabel: '暂无想法。',
    confirmProductLabel: '确认产品名称',
    selectedLanguageLabel: '选择的语言',
    notSet: '未设置',
    notSelected: '未选择',
    noScenarioConfirmed: '尚未确认情景。',
    enginePreviewTitle: '问题引擎预览',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: '引擎预览',
    enginePreviewSessionTitle: '会话',
    enginePreviewSessionIdLabel: '会话 ID',
    enginePreviewSessionEmpty: '尚未创建',
    enginePreviewCreateSession: '创建会话',
    enginePreviewReset: '关闭会话',
    enginePreviewBoardItemsTitle: '看板条目',
    enginePreviewBoardItemPlaceholder: '描述一个看板条目...',
    enginePreviewAddItem: '添加',
    enginePreviewBoardItemsEmpty: '暂无条目。',
    enginePreviewNextQuestionTitle: '下一题',
    enginePreviewSuggestQuestion: '下一题',
    enginePreviewQuestionEmpty: '暂无问题。',
    enginePreviewNextAction: '下一题',
    enginePreviewSwapAction: '更换',
    enginePreviewSimplifyAction: '简化',
    enginePreviewDeepenAction: '加深',
    enginePreviewAnswerPlaceholder: '输入你的回答...',
    enginePreviewSubmitAnswer: '提交回答',
    enginePreviewNoMoreQuestions: '步骤完成 / 没有更多问题。',
    enginePreviewBackToApp: '返回应用',
    enginePreviewMetaGroup: '组别',
    enginePreviewMetaMode: '模式',
    enginePreviewMetaCategory: '类别',
    enginePreviewMetaDifficulty: '难度',
    openReportPanel: '打开报告面板',
    reportSnapshotTitle: '工作坊报告快照',
    close: '关闭',
    editIdeaTitle: '编辑想法',
    generatedIdeaTitle: '生成的想法',
    questionsTitle: '引导性问题',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: '标签编辑器',
    labelEditorSave: '保存',
    labelEditorAdd: '添加标签',
    removeLabelAriaLabel: '删除标签',
    labelDropPlaceholder: '拖入标签',
    noLabelText: '无标签',
    save: '保存',
    llmSettingsTitle: 'OpenAI 服务器设置',
    llmSettingsIntro: '在服务器端设置 OPENAI_API_KEY，并填写 API 地址。',
    llmApiBaseLabel: 'API 地址',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: '保存',
    llmSettingsSaved: '已保存。',
    llmSettingsCostNote: '使用你的 API Key 会按 OpenAI 定价计费到你的账户。',
    llmStatusOnline: '服务器状态：在线',
    llmStatusOffline: '服务器状态：离线',
    llmStatusUnknown: '服务器状态：未知',
    llmTestConnection: '测试连接',
    llmEnableConnection: '启用 OpenAI',
    llmDisableConnection: '关闭 OpenAI',
    questionTemplate: (spaceDef, timeDef) =>
      `“${spaceDef}”如何回应“${timeDef}”并发现新的机会？`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `关于“${productName}”，在“${spaceDef}”的“${timeDef}”中有哪些未被满足的用户需求？`,
      `哪些新行为或趋势会改变“${productName}”在“${spaceDef}”的“${timeDef}”？`,
      `在“${spaceDef}”的“${timeDef}”，有哪些标准/法规/安全期待影响“${productName}”？`,
      `有哪些先进技术或材料可以提升“${productName}”在“${spaceDef}”的“${timeDef}”？`,
      `“${productName}”在“${spaceDef}”的“${timeDef}”中最大的性能瓶颈是什么？`,
      `“${productName}”在“${spaceDef}”的“${timeDef}”如何取得最佳性价比？`,
      `在“${spaceDef}”的“${timeDef}”，用户愿意为“${productName}”付费的功能是什么？哪些必须是标配？`,
      `服务/软件/数据层如何增强“${productName}”在“${spaceDef}”的“${timeDef}”？`,
      `“${productName}”在“${spaceDef}”的“${timeDef}”应如何与其他产品互联，并带来哪些用户收益？`,
      `哪些替代方案可能以价格或性能击败“${productName}”在“${spaceDef}”的“${timeDef}”？`,
      `“${productName}”在“${spaceDef}”的“${timeDef}”需要满足哪些耐久、维护或生命周期期待？`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `思考 ${spaceDef} 与 ${timeDef} 的关联，以发掘客户、设计师和系统视角。`,
    subsystemFallback: '关键组件：结构、能源来源、控制层',
    subsystemTemplate: (productName) =>
      `关键组件：${productName} 外壳、核心模块、接口层`,
    timeDefs: {
      past: (timeFrame) => `${timeFrame} 的早期阶段`,
      now: (timeFrame) => `${timeFrame} 的当前状态`,
      future: (timeFrame) => `${timeFrame} 的下一阶段`,
    },
    analyzedProduct: '被分析的产品',
    leadSpaceSuggestions: (productName) => [
      `${productName} 在用户生态中的集成`,
      `${productName} 的安装位置`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} 的早期制造`,
      `${productName} 的核心装配`,
    ],
    spaceSuggestions: [
      '家庭环境',
      '车辆座舱',
      '工业产线',
      '户外使用',
      '冷藏环境',
      '高温环境',
      '潮湿环境',
      '医疗场景',
      '零售展示',
      '仓储',
      '办公空间',
      '公共基础设施',
      '海洋环境',
      '航空座舱',
      '施工现场',
      '智慧城市网络',
      '农业场地',
      '数据中心',
      '教室',
      '体育场馆',
    ],
    timeSuggestions: [
      '供应商生产流程',
      '内部装配',
      '质量检验',
      '最终测试',
      '包装流程',
      '分销处理',
      '客户使用阶段',
      '维护周期',
      '维修流程',
      '产品生命周期末端',
      '回收流程',
      '组件准备',
      '原材料采购',
      '组件制造',
      '表面处理',
      '供应商物流',
      '安装与调试',
      '保修服务',
      '二次利用',
      '拆解规划',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
  Swiss: {
    stepLabel: 'Schritt',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: 'Ideenchaos in ein klares Produkt verwandeln.',
    landingHeroSubtitle: 'Kein Moderator. Keine Haftnotizen. Keine Zeitverschwendung.',
    landingIntroTitleLines: [
      'makemyidea.work',
      'führt dich Schritt für Schritt',
      'durch die Produktdefinition.',
    ],
    landingIntroSubtextLines: [
      'Online oder vor Ort.',
      'Allein oder mit Team.',
      'KI-Unterstützung (wenn du willst), aber...',
      'immer von {emphasis} gesteuert.',
    ],
    landingIntroSubtextEmphasis: 'dir',
    landingCta: 'Starte mit einer Idee, sieh es wirken.',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 Schritte',
    landingBeforeLead: 'Wenn dir das bekannt vorkommt — du bist hier richtig.',
    landingBeforeList: ['❌ Chaos', '❌ Verlorene Notizen', '❌ Keine Entscheidungen'],
    landingBeforeEmphasis: {
      strong: 'Viel Energie.',
      medium: 'Wenig Entscheidungen.',
      rest: 'Kein echter Fortschritt.',
    },
    landingAfterLead: 'Jetzt arbeitet der Prozess für dich.',
    landingAfterList: ['✅ Prozess', '✅ Strukturierte Fragen', '✅ Bericht'],
    landingWhyLead: 'Wir ersetzen Denken nicht. Wir entfernen Reibung.',
    landingWhyLines: [
      'makemyidea.work',
      'strukturiert das Gespräch',
      'hält die Prozesslogik',
      'ordnet Wissen in Echtzeit',
      'lässt den Menschen das Wichtigste: Entscheidungen und Kreativität',
      'KI hilft. Menschen entscheiden.',
    ],
    landingWhoTitle: 'Für wen?',
    landingWhoList: [
      '🚀 Du hast eine Idee, weißt aber nicht, wie du sie definierst',
      '🛠️ Du bist Dev / PM und willst echte Analyse, kein Brainstorming „zum Spaß“',
      '🤝 Du arbeitest mit einem verteilten oder hybriden Team',
      '⏱️ Du willst Ergebnisse jetzt, nicht nach drei Workshops',
    ],
    landingFinalLines: ['Du brauchst keine perfekte Idee.', 'Du brauchst einen guten Prozess.'],
    impulseButtonLabel: 'Gib mir einen Impuls',
    impulseTitle: 'Vorgeschlagene Frage',
    impulseEmpty: 'Keine Frage verfügbar.',
    impulseClose: 'Schliessen',
    report: 'Bericht',
    llmSettings: 'LLM-Einstellungen',
    languageLabel: 'Sprache',
    steps: {
      1: 'Erzähl uns von deinem neuen Produkt',
      2: 'Idea Clarity Grid Szenariobestätigung',
      3: 'Idea Clarity Grid Workshop',
      4: 'Schlussbericht',
    },
  step1Intro: 'Definieren Sie Produkt, Räume und Beobachtungs- / Denkebenen für die Analyse.',
  productDescriptionLabel: 'Beschreiben Sie Ihr neues Produkt',
  productDescriptionPlaceholder:
    'Für wen, welche Altersgruppe, welcher Markt, Materialien, Hauptfunktion usw.',
  productDescriptionDoneLabel: 'Fertig',
    productNameSuggestionsLabel:
      'Namensvorschläge basierend auf Ihrer Beschreibung (Name in das Namensfeld ziehen)',
  productNameLabel: 'Nennen Sie Ihr neues Produkt',
  productNamePlaceholder: 'z.B. modularer Batteriespeicher',
  step1SpacesTitle: 'Wo schauen wir hin?',
  step1TimeframesTitle: 'Beobachtungs- / Denkebene',
  step1DragHint: 'Optionen in die Zielfelder unten ziehen',
  step1DropHere: 'Hier ablegen...',
  step1SystemLabel: 'Produkt',
  step1SystemLocked: 'Gesperrt',
  spaceListTitle: 'Ort-/Raumliste',
  spaceListHint: 'Bis zu 5 auswählen.',
    timeListTitle: 'Liste der Beobachtungs- / Denkebenen',
    timeListHint: 'Bis zu 5 auswählen.',
    finalSpacesList: 'Endgültige Raumliste',
    finalTimesList: 'Endgültige Beobachtungs- / Denkebenen',
    noSelectionYet: 'Noch keine Auswahl.',
    warningMax5: 'Bitte maximal 5 Einträge auswählen.',
    scenarioIntro:
      'Szenarien werden für jede Raum- und Zeitrahmenkombination erzeugt. Wählen Sie eines aus und verfeinern Sie die Achsendefinitionen.',
    chooseScenario: 'Dieses Szenario wählen',
    spaceLabel: 'Wo schauen wir hin?',
    timeLabel: 'Beobachtungs- / Denkebene',
    axisSpaceLabel: 'Wo schauen wir hin?',
    axisTimeLabel: 'Beobachtungs- / Denkebene',
    axisSubsystem: 'Elemente',
    axisSystem: 'Produkt',
    axisSupersystem: 'Welt',
    axisPast: 'Wie ist es?',
    axisNow: 'Was funktioniert nicht?',
    axisFuture: 'Wie sollte es sein?',
    workshopIntro:
      'Nutzen Sie das Fragezeichen-Symbol für Impulse. Verwenden Sie das Ideen-Symbol, um eigene Notizen hinzuzufügen.',
    legendQuestion: 'Unterstützende Frage',
    legendIdea: 'Neue Idee',
    showIdeaLabel: 'Idee anzeigen',
    supportiveQuestionTooltip: 'Unterstützende Frage',
    addIdeaTooltip: 'Idee hinzufügen',
    editIdeaTooltip: 'Klicken zum Bearbeiten',
    ideaPlaceholder: 'Schreiben Sie Ihre Idee (max. 50 Wörter)',
    wordCount: (count) => `Verbleibend ${Math.max(0, 50 - count)} Wörter`,
    cancel: 'Abbrechen',
    saveIdea: 'Speichern',
    ideaGenerator: 'Gib mir Ideen',
    labelEditorLabel: 'Label-Editor',
    keepOnlyMyIdeasLabel: 'Nur meine Ideen behalten',
    confirmRemoveIdeasTitle: 'Bist du sicher?',
    confirmRemoveIdeasMessage: 'Alle KI-generierten Ideen werden entfernt.',
    confirmYes: 'JA',
    confirmNo: 'NEIN',
    nextStepPrefix: 'Nächster Schritt: ',
    previousStepPrefix: 'Vorheriger Schritt: ',
    previousStepNone: 'Vorheriger Schritt: keiner',
    nextStepCompleted: 'Nächster Schritt: abgeschlossen',
    finalReportIntro: 'Zusammenfassung der bisher gesammelten Workshop-Daten.',
    reportLanguageLabel: 'Berichtssprache',
    reportLanguageHint:
      'Die Sprachauswahl wird in einer späteren Version für die Übersetzung verwendet.',
    productLabel: 'Produkt',
    spacesLabel: 'Wo schauen wir hin?',
    timeFramesLabel: 'Beobachtungs- / Denkebene',
    totalScenariosLabel: 'Gesamte Szenarien',
    chosenScenarioLabel: 'Gewähltes Szenario',
    spaceDefinitionsLabel: 'Raumdefinitionen',
    timeDefinitionsLabel: 'Zeitdefinitionen',
    totalIdeasLabel: 'Gesamtideen',
    cellsWithIdeasLabel: 'Felder mit Ideen',
    ideasGeneratedLabel: 'KI-generierte Ideen',
    ideasUserLabel: 'Benutzerideen',
    noIdeasLabel: 'Noch keine Ideen.',
    confirmProductLabel: 'Produktnamen bestätigen',
    selectedLanguageLabel: 'Gewählte Sprache',
    notSet: 'Nicht festgelegt',
    notSelected: 'Nicht ausgewählt',
    noScenarioConfirmed: 'Noch kein Szenario bestätigt.',
    enginePreviewTitle: 'Fragen-Engine Vorschau',
    enginePreviewLandingLink: 'Landing page',
    enginePreviewLink: 'Engine Vorschau',
    enginePreviewSessionTitle: 'Sitzung',
    enginePreviewSessionIdLabel: 'Sitzungs-ID',
    enginePreviewSessionEmpty: 'Noch nicht erstellt',
    enginePreviewCreateSession: 'Sitzung erstellen',
    enginePreviewReset: 'Sitzung schließen',
    enginePreviewBoardItemsTitle: 'Board-Elemente',
    enginePreviewBoardItemPlaceholder: 'Board-Element beschreiben...',
    enginePreviewAddItem: 'Hinzufügen',
    enginePreviewBoardItemsEmpty: 'Noch keine Elemente.',
    enginePreviewNextQuestionTitle: 'Nächste Frage',
    enginePreviewSuggestQuestion: 'Nächste Frage',
    enginePreviewQuestionEmpty: 'Noch keine Frage.',
    enginePreviewNextAction: 'Nächste Frage',
    enginePreviewSwapAction: 'Tauschen',
    enginePreviewSimplifyAction: 'Vereinfachen',
    enginePreviewDeepenAction: 'Vertiefen',
    enginePreviewAnswerPlaceholder: 'Antwort eingeben...',
    enginePreviewSubmitAnswer: 'Antwort senden',
    enginePreviewNoMoreQuestions: 'Schritt abgeschlossen / keine weiteren Fragen.',
    enginePreviewBackToApp: 'Zurück zur App',
    enginePreviewMetaGroup: 'Gruppe',
    enginePreviewMetaMode: 'Modus',
    enginePreviewMetaCategory: 'Kategorie',
    enginePreviewMetaDifficulty: 'Schwierigkeit',
    openReportPanel: 'Berichtspanel öffnen',
    reportSnapshotTitle: 'Workshop-Berichtsübersicht',
    close: 'Schliessen',
    editIdeaTitle: 'Idee bearbeiten',
    generatedIdeaTitle: 'Generierte Idee',
    questionsTitle: 'Unterstützende Fragen',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Label-Editor',
    labelEditorSave: 'Speichern',
    labelEditorAdd: 'Label hinzufügen',
    removeLabelAriaLabel: 'Label entfernen',
    labelDropPlaceholder: 'Label hier ablegen',
    noLabelText: 'Kein Label',
    save: 'Speichern',
    llmSettingsTitle: 'OpenAI-Servereinstellungen',
    llmSettingsIntro:
      'Verbinden Sie Ihren Server mit OpenAI (OPENAI_API_KEY) und geben Sie die API-Basis-URL an.',
    llmApiBaseLabel: 'API-Basis-URL',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Speichern',
    llmSettingsSaved: 'Gespeichert.',
    llmSettingsCostNote:
      'Die Nutzung Ihres API-Schlüssels wird Ihrem OpenAI-Konto gemäß deren Preisen berechnet.',
    llmStatusOnline: 'Serverstatus: online',
    llmStatusOffline: 'Serverstatus: offline',
    llmStatusUnknown: 'Serverstatus: unbekannt',
    llmTestConnection: 'Verbindung testen',
    llmEnableConnection: 'OpenAI aktivieren',
    llmDisableConnection: 'OpenAI deaktivieren',
    questionTemplate: (spaceDef, timeDef) =>
      `Wie könnte "${spaceDef}" auf "${timeDef}" reagieren und eine neue Chance eröffnen?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Welche unerfüllte Nutzerbedürfnis rund um "${productName}" zeigt sich in "${spaceDef}" während "${timeDef}"?`,
      `Welche neuen Nutzertrends könnten "${productName}" in "${spaceDef}" für "${timeDef}" verändern?`,
      `Welche Standards, Vorschriften oder Sicherheitsanforderungen entstehen für "${productName}" in "${spaceDef}" während "${timeDef}"?`,
      `Welche State‑of‑the‑Art‑Technologie oder Materialien verbessern "${productName}" in "${spaceDef}" für "${timeDef}"?`,
      `Wo liegt der größte Leistungs‑Engpass für "${productName}" in "${spaceDef}" während "${timeDef}"?`,
      `Wie sieht der beste Preis‑Leistungs‑Trade‑off für "${productName}" in "${spaceDef}" während "${timeDef}" aus?`,
      `Für welche Features würden Nutzer in "${spaceDef}" während "${timeDef}" mehr bezahlen – und was ist Pflicht?`,
      `Wie können Service, Software oder Datenebenen "${productName}" in "${spaceDef}" während "${timeDef}" aufwerten?`,
      `Wie sollte "${productName}" in "${spaceDef}" während "${timeDef}" mit anderen Produkten vernetzt sein – und welchen Nutzen bringt das?`,
      `Welche Alternative könnte "${productName}" bei Preis oder Leistung in "${spaceDef}" während "${timeDef}" schlagen?`,
      `Welche Haltbarkeits‑, Wartungs‑ oder Lebensdauer‑Erwartungen muss "${productName}" in "${spaceDef}" für "${timeDef}" erfüllen?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Überlegen Sie, wie ${spaceDef} mit ${timeDef} verknüpft ist, um Kunden-, Designer- und Systemperspektiven zu erschliessen.`,
    subsystemFallback: 'Schlüsselkomponenten: Struktur, Energiequelle, Steuerungsebene',
    subsystemTemplate: (productName) =>
      `Schlüsselkomponenten: ${productName}-Gehäuse, Kernmodul, Schnittstellenschicht`,
    timeDefs: {
      past: (timeFrame) => `Frühere Phase von ${timeFrame}`,
      now: (timeFrame) => `Aktueller Stand von ${timeFrame}`,
      future: (timeFrame) => `Nächste Entwicklung von ${timeFrame}`,
    },
    analyzedProduct: 'Analysiertes Produkt',
    leadSpaceSuggestions: (productName) => [
      `Integration von ${productName} in ein Nutzer-Ökosystem`,
      `Wo ${productName} installiert ist`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} frühe Fertigung`,
      `${productName} Kernmontage`,
    ],
    spaceSuggestions: [
      'Wohnumgebung',
      'Fahrzeugkabine',
      'Industrieanlage',
      'Ausseneinsatz',
      'Kühlraum',
      'Hohe Hitzeeinwirkung',
      'Feuchte Umgebung',
      'Gesundheitswesen',
      'Einzelhandelsfläche',
      'Lagerhaltung',
      'Büroarbeitsplatz',
      'Öffentliche Infrastruktur',
      'Maritime Umgebung',
      'Luftfahrtkabine',
      'Baustelle',
      'Smart-City-Netz',
      'Landwirtschaftliche Fläche',
      'Rechenzentrum',
      'Klassenzimmer',
      'Sportanlage',
    ],
    timeSuggestions: [
      'Produktion beim Zulieferer',
      'Interne Montage',
      'Qualitätsprüfung',
      'Endprüfung',
      'Verpackungsprozess',
      'Distributionshandling',
      'Nutzungsphase beim Kunden',
      'Wartungszyklus',
      'Reparaturablauf',
      'End-of-Life-Abwicklung',
      'Recyclingprozess',
      'Komponentenvorbereitung',
      'Rohstoffbeschaffung',
      'Komponentenfertigung',
      'Oberflächenbearbeitung',
      'Zuliefererlogistik',
      'Installation & Inbetriebnahme',
      'Garantieservice',
      'Zweitnutzung',
      'Demontageplanung',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
  Italian: {
    stepLabel: 'Passo',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: "Trasforma il caos delle idee in un prodotto chiaro.",
    landingHeroSubtitle: 'Niente moderatore. Niente post-it. Niente tempo perso.',
    landingIntroTitleLines: [
      'makemyidea.work',
      'ti guida passo dopo passo',
      'nella definizione del prodotto.',
    ],
    landingIntroSubtextLines: [
      'Online o on-site.',
      'Da solo o in team.',
      'Supporto AI (se vuoi), ma...',
      'sempre guidato da {emphasis}.',
    ],
    landingIntroSubtextEmphasis: 'te',
    landingCta: "Parti da un'idea, guarda come funziona.",
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 passi',
    landingBeforeLead: 'Se anche uno ti suona familiare — sei nel posto giusto.',
    landingBeforeList: ['❌ Caos', '❌ Note perse', '❌ Nessuna decisione'],
    landingBeforeEmphasis: {
      strong: 'Tanta energia.',
      medium: 'Poche decisioni.',
      rest: 'Zero vero progresso.',
    },
    landingAfterLead: 'Ora il processo lavora per te.',
    landingAfterList: ['✅ Processo', '✅ Domande strutturate', '✅ Report'],
    landingWhyLead: 'Non sostituiamo il pensiero. Rimuoviamo l’attrito.',
    landingWhyLines: [
      'makemyidea.work',
      'struttura la conversazione',
      'tiene la logica del processo',
      'organizza la conoscenza in tempo reale',
      'lascia alle persone ciò che conta: decisioni e creatività',
      'AI aiuta. L’umano decide.',
    ],
    landingWhoTitle: 'Per chi?',
    landingWhoList: [
      '🚀 Hai un’idea ma non sai definirla bene',
      '🛠️ Sei dev / PM e vuoi analisi vera, non brainstorming “per sport”',
      '🤝 Lavori con un team distribuito o ibrido',
      '⏱️ Vuoi risultati ora, non dopo tre workshop',
    ],
    landingFinalLines: ['Non ti serve un’idea perfetta.', 'Ti serve un buon processo.'],
    impulseButtonLabel: 'Dammi un impulso',
    impulseTitle: 'Domanda suggerita',
    impulseEmpty: 'Nessuna domanda disponibile.',
    impulseClose: 'Chiudi',
    report: 'Rapporto',
    llmSettings: 'Impostazioni LLM',
    languageLabel: 'Lingua',
    steps: {
      1: 'Raccontaci del tuo nuovo prodotto',
      2: 'Conferma scenario Idea Clarity Grid',
      3: 'Workshop Idea Clarity Grid',
      4: 'Rapporto finale',
    },
  step1Intro: 'Definisci prodotto, spazi e livelli di osservazione per l’analisi.',
  productDescriptionLabel: 'Descrivi il tuo nuovo prodotto',
  productDescriptionPlaceholder:
    'Per chi è, fascia d’età, mercato, materiali, funzione principale, ecc.',
  productDescriptionDoneLabel: 'Fatto',
    productNameSuggestionsLabel:
      'Suggerimenti di nome basati sulla descrizione (trascina nel campo nome prodotto)',
  productNameLabel: 'Dai un nome al tuo nuovo prodotto',
  productNamePlaceholder: 'es. pacco batteria modulare',
    step1SpacesTitle: 'Dove guardiamo?',
    step1TimeframesTitle: 'Livello di osservazione / pensiero',
  step1DragHint: 'Trascina le opzioni nei campi sottostanti',
  step1DropHere: 'Rilascia qui...',
    step1SystemLabel: 'Prodotto',
  step1SystemLocked: 'Bloccato',
  spaceListTitle: 'Elenco luoghi / spazi',
  spaceListHint: 'Seleziona fino a 5.',
    timeListTitle: 'Elenco livelli di osservazione / pensiero',
    timeListHint: 'Seleziona fino a 5.',
    finalSpacesList: 'Elenco spazi finali',
    finalTimesList: 'Elenco livelli di osservazione / pensiero finali',
    noSelectionYet: 'Nessuna selezione.',
    warningMax5: 'Mantieni la selezione entro 5 voci per spazi e livelli.',
    scenarioIntro:
      'Gli scenari vengono generati per ogni coppia spazio/tempo. Selezionane uno e affina le definizioni degli assi.',
    chooseScenario: 'Scegli questo scenario',
    spaceLabel: 'Dove guardiamo?',
    timeLabel: 'Livello di osservazione / pensiero',
    axisSpaceLabel: 'Dove guardiamo?',
    axisTimeLabel: 'Livello di osservazione / pensiero',
    axisSubsystem: 'Elementi',
    axisSystem: 'Prodotto',
    axisSupersystem: 'Mondo',
    axisPast: 'Com’è?',
    axisNow: 'Cosa non funziona?',
    axisFuture: 'Come dovrebbe essere',
    workshopIntro:
      'Usa l’icona domanda per ottenere spunti. Usa l’icona idea per aggiungere i tuoi post-it.',
    legendQuestion: 'Domanda di supporto',
    legendIdea: 'Nuova idea',
    showIdeaLabel: 'Mostra idea',
    supportiveQuestionTooltip: 'Domanda di supporto',
    addIdeaTooltip: 'Inserisci idea',
    editIdeaTooltip: 'Clicca per modificare',
    ideaPlaceholder: 'Scrivi la tua idea (max 50 parole)',
    wordCount: (count) => `Restano ${Math.max(0, 50 - count)} parole`,
    cancel: 'Annulla',
    saveIdea: 'Salva',
    ideaGenerator: 'Dammi delle idee',
    labelEditorLabel: 'Editor etichette',
    keepOnlyMyIdeasLabel: 'Tieni solo le mie idee',
    confirmRemoveIdeasTitle: 'Sei sicuro?',
    confirmRemoveIdeasMessage: 'Questo rimuoverà tutte le idee generate dall’AI.',
    confirmYes: 'SÌ',
    confirmNo: 'NO',
    nextStepPrefix: 'Passo successivo: ',
    previousStepPrefix: 'Passo precedente: ',
    previousStepNone: 'Passo precedente: nessuno',
    nextStepCompleted: 'Passo successivo: completato',
    finalReportIntro: 'Sintesi dei dati raccolti durante il workshop.',
    reportLanguageLabel: 'Lingua del rapporto',
    reportLanguageHint:
      'La lingua selezionata verrà usata per la traduzione del rapporto in una versione successiva.',
    productLabel: 'Prodotto',
    spacesLabel: 'Dove guardiamo?',
    timeFramesLabel: 'Livello di osservazione / pensiero',
    totalScenariosLabel: 'Totale scenari',
    chosenScenarioLabel: 'Scenario scelto',
    spaceDefinitionsLabel: 'Definizioni dello spazio',
    timeDefinitionsLabel: 'Definizioni del tempo',
    totalIdeasLabel: 'Totale idee',
    cellsWithIdeasLabel: 'Celle con idee',
    ideasGeneratedLabel: 'Idee generate dall’AI',
    ideasUserLabel: 'Idee dell’utente',
    noIdeasLabel: 'Nessuna idea.',
    confirmProductLabel: 'Conferma nome prodotto',
    selectedLanguageLabel: 'Lingua selezionata',
    notSet: 'Non impostato',
    notSelected: 'Non selezionato',
    noScenarioConfirmed: 'Nessuno scenario confermato.',
    openReportPanel: 'Apri pannello rapporto',
    reportSnapshotTitle: 'Snapshot del rapporto',
    close: 'Chiudi',
    editIdeaTitle: 'Modifica idea',
    generatedIdeaTitle: 'Idea generata',
    questionsTitle: 'Domande guida',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Editor etichette',
    labelEditorSave: 'Salva',
    labelEditorAdd: 'Aggiungi etichetta',
    removeLabelAriaLabel: 'Rimuovi etichetta',
    labelDropPlaceholder: 'Trascina etichetta',
    noLabelText: 'Nessuna etichetta',
    save: 'Salva',
    llmSettingsTitle: 'Impostazioni server OpenAI',
    llmSettingsIntro:
      'Collega il tuo server a OpenAI (OPENAI_API_KEY) e inserisci l’URL API.',
    llmApiBaseLabel: 'URL API',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Salva',
    llmSettingsSaved: 'Salvato.',
    llmSettingsCostNote:
      'L’uso della tua chiave API addebita i costi al tuo account OpenAI secondo il loro listino.',
    llmStatusOnline: 'Stato server: online',
    llmStatusOffline: 'Stato server: offline',
    llmStatusUnknown: 'Stato server: sconosciuto',
    llmTestConnection: 'Test connessione',
    llmEnableConnection: 'Attiva OpenAI',
    llmDisableConnection: 'Disattiva OpenAI',
    questionTemplate: (spaceDef, timeDef) =>
      `Come potrebbe "${spaceDef}" rispondere a "${timeDef}" e rivelare una nuova opportunità?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Quale bisogno utente non soddisfatto legato a "${productName}" emerge in "${spaceDef}" durante "${timeDef}"?`,
      `Quali nuovi comportamenti o trend possono cambiare "${productName}" in "${spaceDef}" per "${timeDef}"?`,
      `Quali standard, normative o aspettative di sicurezza influenzano "${productName}" in "${spaceDef}" durante "${timeDef}"?`,
      `Quale tecnologia o materiale state-of-the-art può migliorare "${productName}" in "${spaceDef}" per "${timeDef}"?`,
      `Dov’è il principale collo di bottiglia prestazionale di "${productName}" in "${spaceDef}" durante "${timeDef}"?`,
      `Qual è il miglior compromesso price vs performance per "${productName}" in "${spaceDef}" durante "${timeDef}"?`,
      `Per quali funzioni gli utenti in "${spaceDef}" durante "${timeDef}" pagherebbero di più, e cosa è obbligatorio?`,
      `Come servizi, software o dati possono potenziare "${productName}" in "${spaceDef}" durante "${timeDef}"?`,
      `Come dovrebbe "${productName}" comunicare con altri prodotti in "${spaceDef}" durante "${timeDef}" e quale beneficio per l’utente ne deriva?`,
      `Quale alternativa potrebbe superare "${productName}" per prezzo o prestazioni in "${spaceDef}" durante "${timeDef}"?`,
      `Quali requisiti di durata, manutenzione o ciclo di vita deve soddisfare "${productName}" in "${spaceDef}" per "${timeDef}"?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Valuta come ${spaceDef} si collega a ${timeDef} per scoprire prospettive di clienti, designer e sistema.`,
    subsystemFallback: 'Componenti chiave: struttura, fonte di energia, livello di controllo',
    subsystemTemplate: (productName) =>
      `Componenti chiave: involucro ${productName}, modulo centrale, livello di interfaccia`,
    timeDefs: {
      past: (timeFrame) => `Fase precedente di ${timeFrame}`,
      now: (timeFrame) => `Stato attuale di ${timeFrame}`,
      future: (timeFrame) => `Evoluzione futura di ${timeFrame}`,
    },
    analyzedProduct: 'Prodotto analizzato',
    leadSpaceSuggestions: (productName) => [
      `Integrazione di ${productName} nell’ecosistema utente`,
      `Dove ${productName} è installato`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} produzione iniziale`,
      `${productName} assemblaggio principale`,
    ],
    spaceSuggestions: [
      'Ambiente domestico',
      'Abitacolo del veicolo',
      'Linea industriale',
      'Uso esterno',
      'Cella frigorifera',
      'Esposizione ad alte temperature',
      'Ambiente umido',
      'Ambiente sanitario',
      'Esposizione retail',
      'Magazzino',
      'Spazio ufficio',
      'Infrastruttura pubblica',
      'Ambiente marino',
      'Cabina aerospaziale',
      'Cantiere',
      'Rete smart city',
      'Campo agricolo',
      'Data center',
      'Aula',
      'Impianto sportivo',
    ],
    timeSuggestions: [
      'Processo produttivo del fornitore',
      'Assemblaggio interno',
      'Ispezione qualità',
      'Test finale',
      'Processo di confezionamento',
      'Gestione distribuzione',
      'Fase di utilizzo cliente',
      'Ciclo di manutenzione',
      'Flusso di riparazione',
      'Fine vita del prodotto',
      'Processo di riciclo',
      'Preparazione componenti',
      'Approvvigionamento materie prime',
      'Fabbricazione componenti',
      'Finitura superficiale',
      'Logistica fornitori',
      'Installazione e collaudo',
      'Servizio in garanzia',
      'Riutilizzo seconda vita',
      'Pianificazione smontaggio',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
  French: {
    stepLabel: 'Étape',
    appTitle: 'Idea Clarity Grid',
    landingHeroTitle: 'Transforme le chaos des idées en produit clair.',
    landingHeroSubtitle: 'Pas de modérateur. Pas de post-it. Pas de temps perdu.',
    landingIntroTitleLines: [
      'makemyidea.work',
      'te guide pas à pas',
      'dans la définition du produit.',
    ],
    landingIntroSubtextLines: [
      'En ligne ou sur site.',
      'Seul ou en équipe.',
      'Soutien IA (si tu veux), mais...',
      'toujours piloté par {emphasis}.',
    ],
    landingIntroSubtextEmphasis: 'toi',
    landingCta: 'Commence avec une idée, vois comment ça marche.',
    landingThreeStepsCta: 'Get started in 3 steps',
    landingThreeStepsTitle: '3 étapes',
    landingBeforeLead: 'Si l’un te parle — tu es au bon endroit.',
    landingBeforeList: ['❌ Chaos', '❌ Notes perdues', '❌ Pas de décisions'],
    landingBeforeEmphasis: {
      strong: 'Beaucoup d’énergie.',
      medium: 'Peu de décisions.',
      rest: 'Zéro vrai progrès.',
    },
    landingAfterLead: 'Maintenant, le processus travaille pour toi.',
    landingAfterList: ['✅ Processus', '✅ Questions structurées', '✅ Rapport'],
    landingWhyLead: 'Nous ne remplaçons pas la réflexion. Nous supprimons la friction.',
    landingWhyLines: [
      'makemyidea.work',
      'structure la conversation',
      'garde la logique du processus',
      'organise la connaissance en temps réel',
      'laisse l’essentiel aux gens : décisions et créativité',
      'L’IA aide. L’humain décide.',
    ],
    landingWhoTitle: 'Pour qui ?',
    landingWhoList: [
      '🚀 Tu as une idée mais tu ne sais pas la définir',
      '🛠️ Tu es dev / PM et veux une vraie analyse, pas un brainstorming “pour le sport”',
      '🤝 Tu travailles avec une équipe distribuée ou hybride',
      '⏱️ Tu veux des résultats maintenant, pas après trois ateliers',
    ],
    landingFinalLines: ['Tu n’as pas besoin d’une idée parfaite.', 'Tu as besoin d’un bon processus.'],
    impulseButtonLabel: 'Donne-moi un impulsion',
    impulseTitle: 'Question suggérée',
    impulseEmpty: 'Aucune question disponible.',
    impulseClose: 'Fermer',
    report: 'Rapport',
    llmSettings: 'Paramètres LLM',
    languageLabel: 'Langue',
    steps: {
      1: 'Parlez-nous de votre nouveau produit',
      2: 'Confirmation du scénario Idea Clarity Grid',
      3: 'Atelier Idea Clarity Grid',
      4: 'Rapport final',
    },
  step1Intro: 'Définissez le produit, les espaces et le niveau d’observation pour l’analyse.',
  productDescriptionLabel: 'Décrivez votre nouveau produit',
  productDescriptionPlaceholder:
    'Pour qui, tranche d’âge, marché, matériaux, fonction principale, etc.',
  productDescriptionDoneLabel: 'Terminé',
    productNameSuggestionsLabel:
      'Suggestions de nom basées sur votre description (glissez dans le champ du nom)',
  productNameLabel: 'Donnez un nom à votre nouveau produit',
  productNamePlaceholder: 'ex. pack batterie modulaire',
    step1SpacesTitle: 'Où regardons-nous ?',
    step1TimeframesTitle: 'Niveau d’observation / de réflexion',
  step1DragHint: 'Glissez les options dans les zones ci-dessous',
  step1DropHere: 'Déposez ici...',
    step1SystemLabel: 'Produit',
  step1SystemLocked: 'Verrouillé',
  spaceListTitle: 'Liste des lieux / espaces',
  spaceListHint: 'Sélectionnez jusqu’à 5.',
    timeListTitle: 'Liste des niveaux d’observation / de réflexion',
    timeListHint: 'Sélectionnez jusqu’à 5.',
    finalSpacesList: 'Liste finale des espaces',
    finalTimesList: 'Liste finale des niveaux d’observation / de réflexion',
    noSelectionYet: 'Aucune sélection.',
    warningMax5: 'Veuillez limiter la sélection à 5 éléments.',
    scenarioIntro:
      'Des scénarios sont générés pour chaque paire espace/temps. Sélectionnez-en un et affinez les définitions des axes.',
    chooseScenario: 'Choisir ce scénario',
    spaceLabel: 'Où regardons-nous ?',
    timeLabel: 'Niveau d’observation / de réflexion',
    axisSpaceLabel: 'Où regardons-nous ?',
    axisTimeLabel: 'Niveau d’observation / de réflexion',
    axisSubsystem: 'Éléments',
    axisSystem: 'Produit',
    axisSupersystem: 'Monde',
    axisPast: 'Comment est-ce ?',
    axisNow: 'Qu’est-ce qui ne marche pas ?',
    axisFuture: 'Comment cela devrait-il être',
    workshopIntro:
      'Utilisez l’icône question pour des pistes. Utilisez l’icône idée pour ajouter vos post-it.',
    legendQuestion: 'Question de soutien',
    legendIdea: 'Nouvelle idée',
    showIdeaLabel: 'Afficher l’idée',
    supportiveQuestionTooltip: 'Question de soutien',
    addIdeaTooltip: 'Ajouter une idée',
    editIdeaTooltip: 'Cliquez pour modifier',
    ideaPlaceholder: 'Saisissez votre idée (max 50 mots)',
    wordCount: (count) => `Il reste ${Math.max(0, 50 - count)} mots`,
    cancel: 'Annuler',
    saveIdea: 'Enregistrer',
    ideaGenerator: 'Donne-moi des idées',
    labelEditorLabel: 'Éditeur d’étiquettes',
    keepOnlyMyIdeasLabel: 'Garder uniquement mes idées',
    confirmRemoveIdeasTitle: 'Êtes-vous sûr ?',
    confirmRemoveIdeasMessage: 'Cela supprimera toutes les idées générées par l’IA.',
    confirmYes: 'OUI',
    confirmNo: 'NON',
    nextStepPrefix: 'Étape suivante : ',
    previousStepPrefix: 'Étape précédente : ',
    previousStepNone: 'Étape précédente : aucune',
    nextStepCompleted: 'Étape suivante : terminée',
    finalReportIntro: 'Synthèse des données recueillies pendant l’atelier.',
    reportLanguageLabel: 'Langue du rapport',
    reportLanguageHint:
      'La langue sélectionnée sera utilisée pour la traduction du rapport dans une version ultérieure.',
    productLabel: 'Produit',
    spacesLabel: 'Où regardons-nous ?',
    timeFramesLabel: 'Niveau d’observation / de réflexion',
    totalScenariosLabel: 'Nombre total de scénarios',
    chosenScenarioLabel: 'Scénario choisi',
    spaceDefinitionsLabel: 'Définitions des espaces',
    timeDefinitionsLabel: 'Définitions du temps',
    totalIdeasLabel: 'Nombre total d’idées',
    cellsWithIdeasLabel: 'Cellules avec idées',
    ideasGeneratedLabel: 'Idées générées par l’IA',
    ideasUserLabel: 'Idées de l’utilisateur',
    noIdeasLabel: 'Aucune idée.',
    confirmProductLabel: 'Confirmer le nom du produit',
    selectedLanguageLabel: 'Langue sélectionnée',
    notSet: 'Non défini',
    notSelected: 'Non sélectionné',
    noScenarioConfirmed: 'Aucun scénario confirmé.',
    openReportPanel: 'Ouvrir le panneau du rapport',
    reportSnapshotTitle: 'Aperçu du rapport',
    close: 'Fermer',
    editIdeaTitle: 'Modifier l’idée',
    generatedIdeaTitle: 'Idée générée',
    questionsTitle: 'Questions de soutien',
    nextQuestionsLabel: 'Next 10 guiding questions',
    prevQuestionsLabel: 'Previous 10 guiding questions',
    labelEditorTitle: 'Éditeur d’étiquettes',
    labelEditorSave: 'Enregistrer',
    labelEditorAdd: 'Ajouter une étiquette',
    removeLabelAriaLabel: 'Supprimer l’étiquette',
    labelDropPlaceholder: 'Déposez une étiquette',
    noLabelText: 'Aucune étiquette',
    save: 'Enregistrer',
    llmSettingsTitle: 'Paramètres serveur OpenAI',
    llmSettingsIntro:
      'Connectez votre serveur à OpenAI (OPENAI_API_KEY) et indiquez l’URL API.',
    llmApiBaseLabel: 'URL API',
    llmApiBasePlaceholder: 'http://localhost:8787',
    llmSettingsSave: 'Enregistrer',
    llmSettingsSaved: 'Enregistré.',
    llmSettingsCostNote:
      'L’utilisation de votre clé API sera facturée à votre compte OpenAI selon leur tarification.',
    llmStatusOnline: 'Statut serveur : en ligne',
    llmStatusOffline: 'Statut serveur : hors ligne',
    llmStatusUnknown: 'Statut serveur : inconnu',
    llmTestConnection: 'Tester la connexion',
    llmEnableConnection: 'Activer OpenAI',
    llmDisableConnection: 'Désactiver OpenAI',
    questionTemplate: (spaceDef, timeDef) =>
      `Comment "${spaceDef}" pourrait-il répondre à "${timeDef}" et révéler une nouvelle opportunité ?`,
    questionTemplates: (productName, spaceDef, timeDef) => [
      `Quel besoin utilisateur non satisfait lié à "${productName}" apparaît dans "${spaceDef}" pendant "${timeDef}" ?`,
      `Quels nouveaux comportements ou tendances pourraient transformer "${productName}" dans "${spaceDef}" pour "${timeDef}" ?`,
      `Quelles normes, réglementations ou attentes de sécurité affectent "${productName}" dans "${spaceDef}" pendant "${timeDef}" ?`,
      `Quelle technologie ou matériau de pointe peut améliorer "${productName}" dans "${spaceDef}" pour "${timeDef}" ?`,
      `Quel est le principal goulot de performance de "${productName}" dans "${spaceDef}" pendant "${timeDef}" ?`,
      `Quel est le meilleur compromis price vs performance pour "${productName}" dans "${spaceDef}" pendant "${timeDef}" ?`,
      `Pour quelles fonctions les utilisateurs dans "${spaceDef}" pendant "${timeDef}" paieraient-ils plus, et qu’est-ce qui est obligatoire ?`,
      `Comment des services, logiciels ou données peuvent-ils renforcer "${productName}" dans "${spaceDef}" pendant "${timeDef}" ?`,
      `Comment "${productName}" devrait-il se connecter à d’autres produits dans "${spaceDef}" pendant "${timeDef}" et quels bénéfices utilisateur en résultent ?`,
      `Quelle alternative pourrait battre "${productName}" en prix ou en performance dans "${spaceDef}" pendant "${timeDef}" ?`,
      `Quelles exigences de durabilité, maintenance ou cycle de vie "${productName}" doit-il respecter dans "${spaceDef}" pour "${timeDef}" ?`,
    ],
    llmIdeaTemplate: (spaceDef, timeDef) =>
      `Considérez comment ${spaceDef} se connecte à ${timeDef} pour révéler des perspectives client, designer et système.`,
    subsystemFallback: 'Composants clés : structure, source d’énergie, couche de contrôle',
    subsystemTemplate: (productName) =>
      `Composants clés : boîtier ${productName}, module central, couche d’interface`,
    timeDefs: {
      past: (timeFrame) => `Étape précédente de ${timeFrame}`,
      now: (timeFrame) => `État actuel de ${timeFrame}`,
      future: (timeFrame) => `Évolution future de ${timeFrame}`,
    },
    analyzedProduct: 'Produit analysé',
    leadSpaceSuggestions: (productName) => [
      `Intégration de ${productName} dans l’écosystème utilisateur`,
      `Où ${productName} est installé`,
    ],
    leadTimeSuggestions: (productName) => [
      `${productName} fabrication initiale`,
      `${productName} assemblage principal`,
    ],
    spaceSuggestions: [
      'Environnement domestique',
      'Habitacle de véhicule',
      'Ligne industrielle',
      'Usage extérieur',
      'Chambre froide',
      'Exposition à forte chaleur',
      'Environnement humide',
      'Secteur médical',
      'Présentoir retail',
      'Entrepôt',
      'Espace de bureau',
      'Infrastructure publique',
      'Environnement marin',
      'Cabine aéronautique',
      'Chantier',
      'Réseau smart city',
      'Champ agricole',
      'Centre de données',
      'Salle de classe',
      'Installation sportive',
    ],
    timeSuggestions: [
      'Processus de production du fournisseur',
      'Assemblage interne',
      'Contrôle qualité',
      'Test final',
      'Processus d’emballage',
      'Gestion de distribution',
      'Phase d’utilisation client',
      'Cycle de maintenance',
      'Processus de réparation',
      'Fin de vie du produit',
      'Processus de recyclage',
      'Préparation des composants',
      'Approvisionnement des matières premières',
      'Fabrication des composants',
      'Finition de surface',
      'Logistique fournisseur',
      'Installation et mise en service',
      'Service de garantie',
      'Réutilisation seconde vie',
      'Planification du démontage',
    ],
    cellLabel: (spaceLabel, timeLabel) => `${spaceLabel} + ${timeLabel}`,
  },
}

const polishTranslations: Translations = translations.Polish
const languageFallbacks: Partial<Record<Language, Language>> = {
  Spanish: 'English',
  Hindi: 'English',
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const withFallback = <T extends Record<string, unknown>>(base: T, override?: Partial<T>): T => {
  if (!override) return base
  const result: T = { ...base }
  ;(Object.keys(override) as (keyof T)[]).forEach((key) => {
    const overrideValue = override[key]
    if (overrideValue === undefined) return
    const baseValue = base[key]
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = withFallback(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>
      ) as T[keyof T]
    } else {
      result[key] = overrideValue as T[keyof T]
    }
  })
  return result
}

const getTranslations = (language: Language): Translations => {
  const fallbackLanguage = languageFallbacks[language]
  const fallbackTranslations = fallbackLanguage ? translations[fallbackLanguage] : undefined
  const mergedFallback = withFallback(polishTranslations, fallbackTranslations)
  return withFallback(mergedFallback, translations[language])
}

const stepOrder: StepId[] = [1, 2, 3, 4]
const DEFAULT_LLM_API_BASE = 'http://localhost:8787'
const SPACE_KIND_FOR_SLOT: Record<SpaceSlot, OptionItem['kind']> = {
  supersystem: 'world',
  subsystem: 'element',
}

const elementSuggestionFallbacks: Record<Language, string[]> = {
  English: [
    'Housing',
    'Core module',
    'Interface layer',
    'Fasteners',
    'Surface finish',
    'Electronics',
    'Packaging',
    'Power unit',
    'Sensors',
    'Materials',
  ],

  Spanish: [
    'Housing',
    'Core module',
    'Interface layer',
    'Fasteners',
    'Surface finish',
    'Electronics',
    'Packaging',
    'Power unit',
    'Sensors',
    'Materials',
  ],
  Hindi: [
    'Housing',
    'Core module',
    'Interface layer',
    'Fasteners',
    'Surface finish',
    'Electronics',
    'Packaging',
    'Power unit',
    'Sensors',
    'Materials',
  ],
  German: [
    'Gehäuse',
    'Kernmodul',
    'Schnittstelle',
    'Befestigungen',
    'Oberfläche',
    'Elektronik',
    'Verpackung',
    'Stromversorgung',
    'Sensoren',
    'Materialien',
  ],
  Polish: [
    'Obudowa',
    'Moduł główny',
    'Warstwa interfejsu',
    'Mocowania',
    'Wykończenie',
    'Elektronika',
    'Opakowanie',
    'Zasilanie',
    'Czujniki',
    'Materiały',
  ],
  Chinese: [
    '外壳',
    '核心模块',
    '接口层',
    '紧固件',
    '表面处理',
    '电子部件',
    '包装',
    '供电单元',
    '传感器',
    '材料',
  ],
  Swiss: [
    'Gehäuse',
    'Kernmodul',
    'Schnittstelle',
    'Befestigungen',
    'Oberfläche',
    'Elektronik',
    'Verpackung',
    'Stromversorgung',
    'Sensoren',
    'Materialien',
  ],
  Italian: [
    'Scocca',
    'Modulo principale',
    'Interfaccia',
    'Fissaggi',
    'Finitura',
    'Elettronica',
    'Imballaggio',
    'Alimentazione',
    'Sensori',
    'Materiali',
  ],
  French: [
    'Boîtier',
    'Module principal',
    'Interface',
    'Fixations',
    'Finition',
    'Électronique',
    'Emballage',
    'Alimentation',
    'Capteurs',
    'Matériaux',
  ],
}

const spaceSections = ['subsystem', 'system', 'supersystem'] as const
const timeSections = ['past', 'now', 'future'] as const

const buildWorldSuggestions = (productName: string, copy: Translations) => {
  if (!productName.trim()) return copy.spaceSuggestions
  const lead = copy.leadSpaceSuggestions(productName)
  return uniqueList([...lead, ...copy.spaceSuggestions]).slice(0, 20)
}

const buildElementSuggestions = (productName: string, copy: Translations, language: Language) => {
  const base = elementSuggestionFallbacks[language] || elementSuggestionFallbacks.English
  const template = productName
    ? copy.subsystemTemplate(productName).split(':').slice(1).join(':')
    : copy.subsystemFallback.split(':').slice(1).join(':')
  const derived = template
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return uniqueList([...derived, ...base]).slice(0, 20)
}

const buildTimeSuggestions = (productName: string, copy: Translations) => {
  if (!productName.trim()) return copy.timeSuggestions
  const lead = copy.leadTimeSuggestions(productName)
  return uniqueList([...lead, ...copy.timeSuggestions]).slice(0, 20)
}

const uniqueList = (items: string[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const looksEnglish = (items: string[]) => {
  const markers = [
    'home',
    'vehicle',
    'industrial',
    'outdoor',
    'supplier',
    'assembly',
    'quality',
    'testing',
    'packaging',
    'distribution',
    'maintenance',
    'repair',
    'recycling',
    'office',
    'public',
    'process',
    'final',
  ]
  return items.some((item) => {
    const lower = item.toLowerCase()
    return markers.some((marker) => lower.includes(marker))
  })
}

const looksPolish = (items: string[]) => {
  const markers = [
    'dom',
    'środowisko',
    'montaż',
    'produkcj',
    'użytkownik',
    'proces',
    'jakości',
    'kontrola',
    'dostaw',
    'podsystem',
    'element',
    'pojazd',
    'kabina',
    'linia',
  ]
  return items.some((item) => {
    const lower = item.toLowerCase()
    return markers.some((marker) => lower.includes(marker))
  })
}

const buildNameSuggestions = (description: string, fallback: string) => {
  const cleaned = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter((word) => word.length > 3)
  const primary = words[0] || fallback || 'Nova'
  const secondary = words[1] || 'Core'
  const picks = uniqueList([
    `${capitalize(primary)} ${capitalize(secondary)}`,
    `${capitalize(primary)} One`,
    `${capitalize(primary)} Flow`,
    `${capitalize(primary)} Studio`,
    `${capitalize(primary)} Pro`,
    `${capitalize(primary)} Hub`,
    `${capitalize(primary)} Link`,
  ])
  return picks.slice(0, 5)
}

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value

const IconReport = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M15 2v6h6M8 12h8M8 16h8M8 20h5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

const IconIdea = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M9 19h6M10 22h4M8 10a4 4 0 1 1 8 0c0 1.7-1 2.6-2 3.4-.6.5-1 1.1-1 2.1h-2c0-1-.4-1.6-1-2.1-1-.8-2-1.7-2-3.4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

const IconSearch = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle
      cx="11"
      cy="11"
      r="7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M16.5 16.5L21 21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

const IconWorld = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M3 12h18M12 3a12 12 0 0 1 0 18M12 3a12 12 0 0 0 0 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

const IconElement = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 8l8-4 8 4-8 4-8-4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M4 8v8l8 4 8-4V8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M12 12v8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

function App() {
  const [activeStep, setActiveStep] = useState<StepId>(1)
  const [showLanding, setShowLanding] = useState(true)
  const [landingView, setLandingView] = useState<'main' | 'threeSteps'>('main')
  const [productDescription, setProductDescription] = useState('')
  const [productDescriptionConfirmed, setProductDescriptionConfirmed] = useState(false)
  const [productName, setProductName] = useState('')
  const [productNameSuggestions, setProductNameSuggestions] = useState<string[]>([])
  const [productConfirmed, setProductConfirmed] = useState(false)
  const [spaceOptions, setSpaceOptions] = useState<OptionItem[]>(() => {
    const world = buildWorldSuggestions('', polishTranslations).slice(0, 10)
    const elements = buildElementSuggestions('', polishTranslations, 'Polish').slice(0, 10)
    return [
      ...world.map((label, index) => ({ id: index, label, kind: 'world' as const })),
      ...elements.map((label, index) => ({
        id: index + world.length,
        label,
        kind: 'element' as const,
      })),
    ]
  })
  const [timeOptions, setTimeOptions] = useState<TimeOptionItem[]>(
    polishTranslations.timeSuggestions.map((label, index) => ({ id: index, label }))
  )
  const [spaceAssignments, setSpaceAssignments] = useState<Record<SpaceSlot, number | null>>({
    supersystem: null,
    subsystem: null,
  })
  const [timeAssignments, setTimeAssignments] = useState<Record<TimeSlot, number | null>>({
    past: null,
    now: null,
    future: null,
  })
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null)
  const [workshopIdeas, setWorkshopIdeas] = useState<Record<string, Idea[]>>({})
  const [activeIdeaCell, setActiveIdeaCell] = useState<string | null>(null)
  const [ideaDraft, setIdeaDraft] = useState<string>('')
  const [hoveredCell, setHoveredCell] = useState<{ space: string; time: string } | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [labelEditorOpen, setLabelEditorOpen] = useState(false)
  const [ideaPreview, setIdeaPreview] = useState<Idea | null>(null)
  const [impulseQuestion, setImpulseQuestion] = useState<string | null>(null)
  const [impulseOpen, setImpulseOpen] = useState(false)
  const [engineSessionId, setEngineSessionId] = useState<string | null>(null)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const [llmApiBase, setLlmApiBase] = useState(DEFAULT_LLM_API_BASE)
  const [llmEnabled, setLlmEnabled] = useState(true)
  const [llmStatus, setLlmStatus] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [llmSaved, setLlmSaved] = useState(false)
  const [ideaLabels, setIdeaLabels] = useState<LabelItem[]>([
    { id: 'label-1', text: 'Question to customer', color: '#f6b8a2' },
    { id: 'label-2', text: 'New functionality', color: '#f4d6a0' },
    { id: 'label-3', text: 'Testing', color: '#b9e3c6' },
    { id: 'label-4', text: 'Cost Saving', color: '#b7d9f4' },
  ])
  const [ideaLabelAssignments, setIdeaLabelAssignments] = useState<Record<string, string | null>>({})
  const [ideaLabelDraft, setIdeaLabelDraft] = useState<string | null>(null)
  const [postItLabelDraft, setPostItLabelDraft] = useState<string | null>(null)
  const [postItEditOriginalText, setPostItEditOriginalText] = useState('')
  const [postItEdit, setPostItEdit] = useState<Idea | null>(null)
  const [postItEditCell, setPostItEditCell] = useState<string | null>(null)
  const [reportLanguage, setReportLanguage] = useState<Language>('Polish')
  const [uiLanguage, setUiLanguage] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'Polish'
    const saved = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)
    if (saved === 'English' || saved === 'Polish') return saved
    const languages = window.navigator?.languages ?? []
    const fallback = window.navigator?.language ? [window.navigator.language] : []
    const candidates = [...languages, ...fallback].filter(Boolean)
    const prefersPolish = candidates.some((lang) => lang.toLowerCase().startsWith('pl'))
    const defaultLanguage: Language = prefersPolish ? 'Polish' : 'English'
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, defaultLanguage)
    return defaultLanguage
  })
  const [enginePreviewSessionId, setEnginePreviewSessionId] = useState<string | null>(null)
  const [enginePreviewSessionName, setEnginePreviewSessionName] = useState('')
  const [engineNamePromptOpen, setEngineNamePromptOpen] = useState(false)
  const [engineNameDraft, setEngineNameDraft] = useState('')
  const [enginePreviewItems, setEnginePreviewItems] = useState<EngineBoardItem[]>([])
  const [enginePreviewInput, setEnginePreviewInput] = useState('')
  const [engineUiState, setEngineUiState] = useState<
    'INIT' | 'FREE_FLOW' | 'FACILITATION_OFFER' | 'FACILITATED_INPUT'
  >('INIT')
  const [engineActivePrompt, setEngineActivePrompt] = useState<FacilitationPrompt | null>(null)
  const [engineWeakSignals, setEngineWeakSignals] = useState(0)
  const [engineMediumSignals, setEngineMediumSignals] = useState(0)
  const [engineStrongSignals, setEngineStrongSignals] = useState(0)
  const [engineLastWeakKind, setEngineLastWeakKind] = useState<string | null>(null)
  const [engineLastMediumKind, setEngineLastMediumKind] = useState<string | null>(null)
  const [engineLastStrongKind, setEngineLastStrongKind] = useState<string | null>(null)
  const [engineOfferReason, setEngineOfferReason] = useState<string | null>(null)
  const [engineFreeEntryStreak, setEngineFreeEntryStreak] = useState(0)
  const [engineLastEntryAt, setEngineLastEntryAt] = useState<number | null>(null)
  const [engineLastEntryShort, setEngineLastEntryShort] = useState(false)
  const [engineInputFocused, setEngineInputFocused] = useState(false)
  const [engineLastInputActivityAt, setEngineLastInputActivityAt] = useState<number | null>(null)
  const engineEraseTimer = useRef<number | null>(null)
  const engineIdleTimer = useRef<number | null>(null)
  const engineIdleTriggered = useRef(false)
  const enginePreviousInput = useRef('')
  const engineLatestInput = useRef('')
  const engineLatestUiState = useRef<'INIT' | 'FREE_FLOW' | 'FACILITATION_OFFER' | 'FACILITATED_INPUT'>(
    'INIT'
  )
  const engineLatestFocus = useRef(false)
  const engineCooldownUntil = useRef(0)
  const engineInteractionBySession = useRef<Record<string, boolean>>({})
  const engineLastAddAtBySession = useRef<Record<string, number>>({})
  const engineResetOnSessionChange = useRef(false)
  const [enginePreviewError, setEnginePreviewError] = useState<string | null>(null)
  const [engineSessionsOpen, setEngineSessionsOpen] = useState(false)
  const [engineSessions, setEngineSessions] = useState<EngineSessionSummary[]>([])
  const [engineSessionsLoading, setEngineSessionsLoading] = useState(false)
  const [engineSessionsError, setEngineSessionsError] = useState<string | null>(null)
  const [engineDeleteLoadingId, setEngineDeleteLoadingId] = useState<string | null>(null)
  const [engineSessionDetail, setEngineSessionDetail] = useState<EngineSessionDetail | null>(null)
  const [engineEditItemId, setEngineEditItemId] = useState<string | null>(null)
  const [engineEditText, setEngineEditText] = useState('')
  const [engineEditLoading, setEngineEditLoading] = useState(false)
  const [enginePreviewEditId, setEnginePreviewEditId] = useState<string | null>(null)
  const [enginePreviewEditText, setEnginePreviewEditText] = useState('')
  const [engineEntryDeleteId, setEngineEntryDeleteId] = useState<string | null>(null)
  const [engineApiDebug, setEngineApiDebug] = useState<{
    endpoint: string
    status: number
    response: unknown
    rawText: string
  } | null>(null)
  const [engineFacilitationDiagnostics, setEngineFacilitationDiagnostics] = useState<{
    url: string
    status: number
    contentType: string
    raw: string
    json: unknown
    parseError: string | null
  } | null>(null)
  const [engineAskedQuestionIds, setEngineAskedQuestionIds] = useState<string[]>([])
  const [engineLastQuestionMeta, setEngineLastQuestionMeta] = useState<{
    id: string
    group_code?: string
    mode_code?: number
  } | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackForm, setFeedbackForm] = useState({
    doing: '',
    unclear: '',
    workaround: '',
    suggestion: '',
    keywords: '',
  })
  const [engineEntryHint, setEngineEntryHint] = useState<{
    x: number
    y: number
    visible: boolean
  }>({ x: 0, y: 0, visible: false })
  const [engineMatrixVisible] = useState(false)
  const [engineLabelEditorId, setEngineLabelEditorId] = useState<string | null>(null)
  const engineLabelEditorRef = useRef<HTMLDivElement | null>(null)
  const engineLabelCache = useRef<Record<string, string | null>>({})
  const engineInputRef = useRef<HTMLTextAreaElement | null>(null)
  const enginePendingFocusRef = useRef(false)
  const enginePendingArmingRef = useRef(false)
  const engineAllowIdleWithoutFocusRef = useRef(false)
  const engineIdleArmedRef = useRef(false)
  const engineIdleLastArmReasonRef = useRef<string | null>(null)
  const didLogMappingSelfTestRef = useRef(false)
  const lastGravitySuggestionRef = useRef<string | null>(null)
  const engineImportInputRef = useRef<HTMLInputElement | null>(null)
  const [feedbackReminder, setFeedbackReminder] = useState<{
    sessionId: string | null
    visible: boolean
  } | null>(null)

  const languageOptions: Language[] = [
    'English',
    'Chinese',
    'Spanish',
    'Hindi',
    'Polish',
    'German',
  ]

  const uiLanguageOptions: Language[] = ['Polish', 'English']

  const isDebugEnabled = () => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('debug') === '1') return true
    }
    return import.meta.env.VITE_DEBUG_UI === 'true'
  }

  const isE2EEnabled = () => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('e2e') === '1') return true
    }
    return import.meta.env.VITE_E2E === '1'
  }

  const logFacilitationEvent = (event: string, payload: Record<string, unknown>) => {
    if (!isDebugEnabled()) return
    const ts = Date.now()
    console.log(JSON.stringify({ event, ts, ...payload }))
  }

  const logSessionStore = (event: string, payload: Record<string, unknown>) => {
    if (!import.meta.env.DEV) return
    console.log(JSON.stringify({ event, ...payload }))
  }

  const readFeedbackEntries = (): FeedbackEntry[] => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const writeFeedbackEntries = (entries: FeedbackEntry[]) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(entries))
    } catch {
      // ignore write errors
    }
  }

  const createFeedbackId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  const getEngineSessionKey = () => enginePreviewSessionId ?? 'new'

  const clearEngineIdleTimer = (reason: string) => {
    if (engineIdleTimer.current) {
      window.clearTimeout(engineIdleTimer.current)
      engineIdleTimer.current = null
      logFacilitationEvent('idle_timer_cleared', { reason })
    }
  }

  const armIdleWatch = (reason: string) => {
    engineIdleArmedRef.current = true
    engineIdleLastArmReasonRef.current = reason
    engineAllowIdleWithoutFocusRef.current = true
    engineIdleTriggered.current = false
    setEngineLastInputActivityAt(Date.now())
    logFacilitationEvent('idle_watch_armed', { reason })
  }

  const markUserInitiatedInteraction = (source: 'pointer' | 'keystroke') => {
    const key = getEngineSessionKey()
    if (engineInteractionBySession.current[key]) return
    engineInteractionBySession.current[key] = true
    logFacilitationEvent('user_interaction_armed', { source, sessionId: key })
  }

  const syncEngineLabelCache = (items: EngineBoardItem[]) => {
    items.forEach((item) => {
      engineLabelCache.current[item.id] = item.label ?? null
    })
  }

  const setFacilitationCooldown = (reason: string) => {
    const until = Date.now() + 25000
    engineCooldownUntil.current = until
    logFacilitationEvent('facilitation_cooldown_set', { reason, until })
  }

  const canShowFacilitation = (reason: string) => {
    const now = Date.now()
    if (engineCooldownUntil.current > now) {
      logFacilitationEvent('facilitation_blocked_cooldown', {
        reason,
        until: engineCooldownUntil.current,
      })
      return false
    }
    return true
  }

  const resolveOfferReason = () => {
    let reason = 'short'
    if (engineStrongSignals > 0) {
      reason = 'erase'
    } else if (engineMediumSignals > 0) {
      if (engineLastMediumKind === 'idle') reason = 'idle'
      if (engineLastMediumKind === 'vague' || engineLastMediumKind === 'short_vague') {
        reason = 'vague'
      }
    } else if (engineWeakSignals > 0) {
      if (engineLastWeakKind == 'short_burst') reason = 'burst'
      else reason = 'short'
    }
    logFacilitationEvent('facilitation_reason_eval', {
      reason,
      words: countWords(engineLatestInput.current),
    })
    return reason
  }

  const normalizeApiBase = (value: string) => value.trim().replace(/\/+$/, '')
  const idleThresholdMs = isE2EEnabled()
    ? 800
    : isDebugEnabled()
      ? 5000
      : DEFAULT_IDLE_THRESHOLD_MS
  const postAddGraceMs = isE2EEnabled() ? 200 : 7000
  const isEnginePreview =
    typeof window !== 'undefined' && window.location.pathname === '/engine'
  const isWorkInProgress =
    typeof window !== 'undefined' && window.location.pathname === '/wip'
  const isIdeaGrid =
    typeof window !== 'undefined' && window.location.pathname === '/grid'

  useEffect(() => {
    engineLatestInput.current = enginePreviewInput
  }, [enginePreviewInput])


  useEffect(() => {
    engineLatestUiState.current = engineUiState
  }, [engineUiState])

  useEffect(() => {
    engineLatestFocus.current = engineInputFocused
  }, [engineInputFocused])

  useEffect(() => {
    if (!isEnginePreview) return
    if (!enginePreviewSessionId) return
    if (enginePendingFocusRef.current && engineInputRef.current) {
      enginePendingFocusRef.current = false
      engineInputRef.current.focus()
      setEngineInputFocused(true)
      setEngineLastInputActivityAt(Date.now())
    }
    if (enginePendingArmingRef.current) {
      enginePendingArmingRef.current = false
      engineInteractionBySession.current[enginePreviewSessionId] = true
      setEngineLastInputActivityAt(Date.now())
    }
  }, [isEnginePreview, enginePreviewSessionId])

  useEffect(() => {
    setEngineAskedQuestionIds([])
    setEngineLastQuestionMeta(null)
  }, [enginePreviewSessionId])

  useEffect(() => {
    const sessionKey = getEngineSessionKey()
    if (!engineResetOnSessionChange.current) {
      if (sessionKey !== 'new' && engineInteractionBySession.current['new']) {
        engineInteractionBySession.current[sessionKey] = true
        logFacilitationEvent('session_interaction_transferred', {
          from: 'new',
          to: sessionKey,
        })
      }
      logFacilitationEvent('session_switch_ignored', { sessionId: sessionKey })
      return
    }
    const transferInteraction =
      sessionKey !== 'new' &&
      engineInteractionBySession.current['new'] &&
      engineLastInputActivityAt !== null
    engineResetOnSessionChange.current = false
    clearEngineIdleTimer('session_switch')
    engineIdleTriggered.current = false
    engineInteractionBySession.current[sessionKey] = transferInteraction
    engineInteractionBySession.current['new'] = false
    if (!transferInteraction && !engineIdleArmedRef.current) {
      setEngineLastInputActivityAt(null)
    }
    setEngineOfferReason(null)
    setEngineUiState('FREE_FLOW')
    logFacilitationEvent('session_switched', { sessionId: sessionKey })
  }, [enginePreviewSessionId])

  useEffect(() => {
    const visible = engineUiState === 'FACILITATION_OFFER'
    logFacilitationEvent('facilitation_visibility', {
      visible,
      reason: engineOfferReason || 'none',
      words: countWords(engineLatestInput.current),
    })
  }, [engineUiState, engineOfferReason])

  useEffect(() => {
    if (!isDebugEnabled() || didLogMappingSelfTestRef.current) return
    didLogMappingSelfTestRef.current = true
    const examples = [
      'funkcja musialaby cos poprawic',
      'Funkcja musiałaby cos poprawic',
      'Powinna byc szybciej',
      'Powinny byc testy',
    ]
    examples.forEach((example) => {
      const details = computeMappingDetails(example, 'Polish')
      console.log(
        JSON.stringify({
          event: 'matrix_mapping_self_test',
          text: details.normalized,
          row: details.row,
          col: details.col,
          rowScores: details.rowScores,
          colScores: details.colScores,
        })
      )
    })
  }, [])

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


  const isDebugMatrix =
    typeof window !== 'undefined' && window.location.pathname === '/debug/matrix'

  if (isDebugMatrix) {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('sessionId')
    const debugEnabled = params.get('debug') === '1' || import.meta.env.VITE_DEBUG_UI === 'true'

    const [matrixData, setMatrixData] = useState(null as null | {
      matrix: Record<string, Record<string, { id: string; short_text: string; entry_type: string; promptType: string | null; created_at: number }[]>>
      coverage: { filledCells: number; totalCells: number }
      timeline: { id: string; short_text: string; created_at: number; matrix_row: string; matrix_col: string }[]
    })
    const [matrixError, setMatrixError] = useState<string | null>(null)
    const [matrixLoading, setMatrixLoading] = useState(false)

    useEffect(() => {
      if (!debugEnabled || !sessionId) return
      let timer: number | undefined
      const fetchMatrix = async () => {
        setMatrixLoading(true)
        setMatrixError(null)
        try {
          const response = await fetch(`${llmApiBase}/api/debug/matrix?sessionId=${sessionId}&debug=1`)
          if (!response.ok) {
        const msg = await response.text()
        throw new Error(msg || 'Request failed')
      }
          const data = await response.json()
          setMatrixData(data)
        } catch {
          setMatrixError('Unable to load matrix data.')
        } finally {
          setMatrixLoading(false)
        }
      }
      void fetchMatrix()
      timer = window.setInterval(fetchMatrix, 5000)
      return () => {
        if (timer) window.clearInterval(timer)
      }
    }, [debugEnabled, sessionId, llmApiBase])

    if (!debugEnabled) {
      return <div className="debug-matrix">Not available.</div>
    }

    if (!sessionId) {
      return <div className="debug-matrix">Missing sessionId.</div>
    }

    const rows = ['WORLD', 'PRODUCT', 'ELEMENTS']
    const cols = ['AS_IS', 'NOT_WORKING', 'SHOULD_BE']
    const recent = matrixData?.timeline?.[0]
    const formatMatrixLabel = (row: string, col: string) => {
      const rowLabel = row === 'WORLD' ? 'Świat / Środowisko' : row === 'PRODUCT' ? 'Produkt' : 'Elementy'
      const colLabel = col === 'AS_IS' ? 'Jak jest?' : col === 'NOT_WORKING' ? 'Co nie działa?' : 'Jak powinno być?'
      const cell = `${row === 'WORLD' ? 'A' : row === 'PRODUCT' ? 'B' : 'C'}${col === 'AS_IS' ? '1' : col === 'NOT_WORKING' ? '2' : '3'}`
      return `${cell} – ${rowLabel} / ${colLabel}`
    }

    const recentKey = recent ? `${recent.matrix_row}-${recent.matrix_col}` : null
    const rowLabel = (row: string) =>
      row === 'WORLD' ? 'Świat / Środowisko' : row === 'PRODUCT' ? 'Produkt' : 'Elementy'
    const colLabel = (col: string) =>
      col === 'AS_IS' ? 'Jak jest?' : col === 'NOT_WORKING' ? 'Co nie działa?' : 'Jak powinno być?'

    return (
      <div className="debug-matrix">
        <header>
          <h1>Debug Matrix</h1>
          <div className="debug-meta">
            <span>Session: {sessionId}</span>
            {matrixData && (
              <span>
                Pokrycie analizy: {matrixData.coverage.filledCells} / {matrixData.coverage.totalCells}
              </span>
            )}
          </div>
        </header>
        {matrixError && <div className="engine-error">{matrixError}</div>}
        {matrixLoading && <div className="engine-empty">Loading…</div>}
        {matrixData && (
          <div className="debug-grid">
            <div className="debug-corner" />
            {cols.map((col) => (
              <div key={col} className="debug-col-label">{colLabel(col)}</div>
            ))}
            {rows.map((row) => (
              <>
                <div key={`${row}-label`} className="debug-row-label">{rowLabel(row)}</div>
                {cols.map((col) => {
                  const answers = matrixData.matrix[row][col] || []
                  const isRecent = recentKey === `${row}-${col}`
                  return (
                    <div key={`${row}-${col}`} className={`debug-cell ${isRecent ? 'recent' : ''}`}>
                      <div className="debug-count">{answers.length} wpisów</div>
                      <ul>
                        {answers.map((answer) => (
                          <li key={`${answer.id}-${answer.created_at}`}>{answer.short_text}</li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        )}
        {matrixData && (
          <section className="debug-timeline">
            <h2>Ostatnie wpisy</h2>
            <ul>
              {matrixData.timeline.map((entry) => (
                <li key={`${entry.id}-${entry.created_at}`}>
                  <span className="debug-pill">{formatMatrixLabel(entry.matrix_row, entry.matrix_col)}</span>
                  <span>{entry.short_text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    )
  }

  const checkLlmStatus = async (base: string) => {
    if (!llmEnabled || !base) {
      setLlmStatus('offline')
      return
    }
    try {
      const response = await fetch(`${base}/api/health`, { method: 'GET' })
      setLlmStatus(response.ok ? 'online' : 'offline')
    } catch {
      setLlmStatus('offline')
    }
  }

  useEffect(() => {
    const savedBase = localStorage.getItem('llm_api_base')
    const savedEnabled = localStorage.getItem('llm_enabled')
    const nextEnabled = savedEnabled !== 'false'
    const nextBase = normalizeApiBase(savedBase || DEFAULT_LLM_API_BASE)
    setLlmEnabled(nextEnabled)
    setLlmApiBase(nextBase)
    if (nextEnabled) {
      void checkLlmStatus(nextBase)
    } else {
      setLlmStatus('offline')
    }
  }, [])

  useEffect(() => {
    if (!llmEnabled) {
      setLlmStatus('offline')
      return
    }
    void checkLlmStatus(llmApiBase)
  }, [llmEnabled, llmApiBase])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage)
  }, [uiLanguage])

  useEffect(() => {
    if (!showLanding) return
    const updateProgress = () => {
      const scrollTop = window.scrollY
      const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight)
      const progress = Math.min(1, Math.max(0, scrollTop / maxScroll))
      document.documentElement.style.setProperty('--scroll-progress', `${progress}`)
    }
    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)
    return () => {
      window.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [showLanding])

  useEffect(() => {
    if (!isEnginePreview) return
    const handleActivity = () => {
      if (!engineIdleArmedRef.current) return
      engineIdleTriggered.current = false
      setEngineLastInputActivityAt(Date.now())
    }
    window.addEventListener('pointerdown', handleActivity, { passive: true })
    window.addEventListener('keydown', handleActivity)
    return () => {
      window.removeEventListener('pointerdown', handleActivity)
      window.removeEventListener('keydown', handleActivity)
    }
  }, [isEnginePreview])

  useEffect(() => {
    if (!isEnginePreview) return
    if (engineUiState !== 'FREE_FLOW') return
    const sessionKey = getEngineSessionKey()
    const lastAddAt = engineLastAddAtBySession.current[sessionKey] || 0
    if (!engineInteractionBySession.current[sessionKey]) {
      logFacilitationEvent('facilitation_disarmed', { reason: 'not_armed', sessionId: sessionKey })
      return
    }
    if (Date.now() - lastAddAt < postAddGraceMs) {
      logFacilitationEvent('facilitation_disarmed', { reason: 'post_add_grace', sessionId: sessionKey })
      return
    }
    if (!canShowFacilitation('stuck')) return
    if (engineStrongSignals >= 1 || engineMediumSignals >= 2 || engineWeakSignals >= 3) {
      const reason = resolveOfferReason()
      setEngineOfferReason(reason)
      setEngineUiState('FACILITATION_OFFER')
      logFacilitationEvent('facilitation_offered', {
        sessionId: enginePreviewSessionId || 'unknown',
        reason,
        uiState: engineUiState,
      })
    }
  }, [
    isEnginePreview,
    engineUiState,
    engineStrongSignals,
    engineMediumSignals,
    engineWeakSignals,
    engineLastWeakKind,
    engineLastMediumKind,
    engineLastStrongKind,
    enginePreviewSessionId,
    postAddGraceMs,
  ])

  useEffect(() => {
    if (!isEnginePreview) return
    if (!enginePreviewSessionId) {
      clearEngineIdleTimer('no_session')
      return
    }
    const sessionKey = getEngineSessionKey()
    if (!engineIdleArmedRef.current) {
      clearEngineIdleTimer('idle_not_armed')
      return
    }
    if (!engineLastInputActivityAt) {
      clearEngineIdleTimer('no_activity_baseline')
      return
    }
    if (engineUiState !== 'FREE_FLOW' && engineUiState !== 'FACILITATED_INPUT') {
      clearEngineIdleTimer('ui_state_blocked')
      return
    }

    const delta = Date.now() - engineLastInputActivityAt
    const remaining = Math.max(0, idleThresholdMs - delta)
    clearEngineIdleTimer('reset')
    logFacilitationEvent('idle_timer_set', {
      sessionId: sessionKey,
      remaining,
      baseline: engineLastInputActivityAt,
    })
    engineIdleTimer.current = window.setTimeout(() => {
      const latestSession = getEngineSessionKey()
      const now = Date.now()
      const idleFor = engineLastInputActivityAt ? now - engineLastInputActivityAt : 0
      logFacilitationEvent('idle_timer_fired', {
        sessionId: latestSession,
        idleFor,
      })
      if (!engineIdleArmedRef.current) return
      if (
        engineLatestUiState.current !== 'FREE_FLOW' &&
        engineLatestUiState.current !== 'FACILITATED_INPUT'
      ) {
        return
      }
      const armReason = engineIdleLastArmReasonRef.current
      const ignoreCooldown = Boolean(armReason && armReason.startsWith('facilitation_'))
      if (!ignoreCooldown && !canShowFacilitation('idle')) return
      if (engineIdleTriggered.current) return
      registerSignal('medium', 'idle')
      engineIdleTriggered.current = true
      engineIdleArmedRef.current = false
      engineIdleLastArmReasonRef.current = null
      setEngineOfferReason('idle')
      if (engineLatestUiState.current !== 'FACILITATED_INPUT') {
        setEngineUiState('FACILITATION_OFFER')
      }
      engineAllowIdleWithoutFocusRef.current = false
      logFacilitationEvent('facilitation_offered', {
        sessionId: latestSession,
        reason: 'idle',
        uiState: engineLatestUiState.current,
      })
    }, remaining)
    return () => clearEngineIdleTimer('cleanup')
  }, [
    isEnginePreview,
    engineInputFocused,
    engineLastInputActivityAt,
    engineUiState,
    enginePreviewSessionId,
    idleThresholdMs,
  ])

  useEffect(() => {
    return () => {
      if (engineEraseTimer.current) {
        window.clearTimeout(engineEraseTimer.current)
      }
    }
  }, [])

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) || null


  const debugMatrixData = useMemo(() => {
    const entries = enginePreviewItems.map((item) => {
      const mapped = mapEntryToCell(item.text, uiLanguage)
      return {
        id: item.id,
        text: item.text,
        created_at: item.created_at || 0,
        cell: { row: mapped.row, col: mapped.col },
      }
    })

    const cells = new Map<string, { count: number; entries: typeof entries }>()
    const counts: Record<string, number> = {}
    MATRIX_ROWS.forEach((row) =>
      MATRIX_COLS.forEach((col) => {
        const key = cellKey(row.key, col.key)
        cells.set(key, { count: 0, entries: [] })
        counts[key] = 0
      })
    )

    entries.forEach((entry) => {
      const key = cellKey(entry.cell.row, entry.cell.col)
      const cell = cells.get(key)
      if (!cell) return
      cell.count += 1
      counts[key] += 1
      if (cell.entries.length < 3) {
        cell.entries.push(entry)
      }
    })

    const coverage = Array.from(cells.values()).filter((cell) => cell.count > 0).length
    const latestEntry = entries[0]
    const currentCell = latestEntry?.cell ?? { row: 'world' as MatrixRowKey, col: 'as_is' as MatrixColKey }
    const gravity = pickGravityTarget(currentCell, counts)

    return {
      cells,
      coverage,
      currentCell,
      targetCell: gravity.targetCell,
      targetReason: gravity.reason,
      rows: MATRIX_ROWS,
      cols: MATRIX_COLS,
      cellKey,
    }
  }, [enginePreviewItems])

  const feedbackContext = useMemo(() => {
    const route = typeof window !== 'undefined' ? window.location.pathname : ''
    const sessionId = enginePreviewSessionId || undefined
    const matrixCell = isEnginePreview
      ? {
          row: debugMatrixData?.currentCell?.row ?? 'world',
          col: debugMatrixData?.currentCell?.col ?? 'as_is',
        }
      : undefined
    return { route, sessionId, matrixCell }
  }, [debugMatrixData, enginePreviewSessionId, isEnginePreview])

  const sendFeedbackEmail = (sessionId: string | null) => {
    if (typeof window === 'undefined') return
    const subject = encodeURIComponent('Makemyidea.work feedback')
    const note =
      uiLanguage === 'English'
        ? 'The JSON file has been downloaded. Please attach it to this email.'
        : 'Plik JSON został pobrany. Dołącz go proszę do tej wiadomości.'
    const body = encodeURIComponent(
      `Feedback from session:\n` +
        `Session ID: ${sessionId ?? 'n/a'}\n` +
        `Route: ${feedbackContext.route}\n` +
        `Language: ${uiLanguage}\n` +
        `Timestamp: ${new Date().toISOString()}\n\n` +
        `${note}`
    )
    window.location.href = `mailto:areklupierz@gmail.com?subject=${subject}&body=${body}`
  }

  const exportFeedbackJson = () => {
    if (typeof window === 'undefined') return
    const entries = readFeedbackEntries()
    const payload = JSON.stringify(entries, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `makemyidea-feedback-${date}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const saveFeedbackEntry = () => {
    const entry: FeedbackEntry = {
      id: createFeedbackId(),
      timestamp: new Date().toISOString(),
      context: {
        language: uiLanguage,
        route: feedbackContext.route,
        sessionId: feedbackContext.sessionId,
        matrixCell: feedbackContext.matrixCell,
        questionId: engineLastQuestionMeta?.id,
      },
      feedback: {
        doing: feedbackForm.doing.trim(),
        unclear: feedbackForm.unclear.trim(),
        workaround: feedbackForm.workaround.trim(),
        suggestion: feedbackForm.suggestion.trim(),
        keywords: feedbackForm.keywords.trim(),
      },
    }
    const next = [...readFeedbackEntries(), entry]
    writeFeedbackEntries(next)
    setFeedbackForm({
      doing: '',
      unclear: '',
      workaround: '',
      suggestion: '',
      keywords: '',
    })
    setFeedbackOpen(false)
  }

  useEffect(() => {
    if (!isDebugEnabled()) return
    if (!debugMatrixData) return
    const key = `${debugMatrixData.currentCell.row}:${debugMatrixData.currentCell.col}->${debugMatrixData.targetCell.row}:${debugMatrixData.targetCell.col}`
    if (lastGravitySuggestionRef.current === key) return
    lastGravitySuggestionRef.current = key
    console.log(
      JSON.stringify({
        event: 'gravity_suggestion_changed',
        currentCell: debugMatrixData.currentCell,
        targetCell: debugMatrixData.targetCell,
        reason: debugMatrixData.targetReason,
      })
    )
  }, [debugMatrixData])


  useEffect(() => {
    if (activeStep !== 3 || !selectedScenario || engineSessionId) return
    const createEngineSession = async () => {
      try {
        const response = await fetch(`${llmApiBase}/api/engine/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: productName.trim() || 'Workshop session' }),
        })
        if (!response.ok) {
        const msg = await response.text()
        throw new Error(msg || 'Request failed')
      }
        const data = (await response.json()) as { sessionId?: string }
        if (data.sessionId) setEngineSessionId(data.sessionId)
      } catch {
        setEngineSessionId(null)
      }
    }
    void createEngineSession()
  }, [activeStep, selectedScenario, engineSessionId, llmApiBase])

  useEffect(() => {
    if (!showLanding) return
    const sections = Array.from(document.querySelectorAll('.landing-section'))
    if (!sections.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
          }
        })
      },
      { threshold: 0.45 }
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [showLanding])

  useEffect(() => {
    if (!isIdeaGrid) return
    setShowLanding(false)
    setLandingView('main')
    setActiveStep(3)
  }, [isIdeaGrid])

  useEffect(() => {
    if (!showLanding) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'threeSteps') {
      setLandingView('threeSteps')
    }
  }, [showLanding])

  const copy = useMemo(() => getTranslations(uiLanguage), [uiLanguage])
  const stepTitle = (stepId: StepId) => copy.steps[stepId]
  const stepHeading = (stepId: StepId) =>
    `${copy.stepLabel}${stepId} | ${stepTitle(stepId)}`
  const spaceLabelMap = {
    subsystem: copy.axisSubsystem,
    system: copy.axisSystem,
    supersystem: copy.axisSupersystem,
  }
  const timeLabelMap = {
    past: copy.axisPast,
    now: copy.axisNow,
    future: copy.axisFuture,
  }


  const feedbackReminderBanner =
    feedbackReminder?.visible && isEnginePreview ? (
      <div className="feedback-reminder" role="status">
        <span>{copy.feedbackReminderText}</span>
        <div className="feedback-reminder-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              exportFeedbackJson()
              window.setTimeout(() => {
                sendFeedbackEmail(feedbackReminder.sessionId)
              }, 350)
              setFeedbackReminder((prev) => (prev ? { ...prev, visible: false } : prev))
            }}
          >
            {copy.feedbackReminderSend}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setFeedbackReminder((prev) => (prev ? { ...prev, visible: false } : prev))}
          >
            {copy.feedbackReminderDismiss}
          </button>
        </div>
      </div>
    ) : null

  const feedbackPanel = feedbackOpen ? (
    <div className="feedback-panel">
      <div className="feedback-panel-header">
        <h3>{copy.feedbackTitle}</h3>
        <button type="button" className="ghost" onClick={() => setFeedbackOpen(false)}>
          {copy.close}
        </button>
      </div>
      <div className="feedback-panel-body">
        <label>
          <span>{copy.feedbackDoingLabel}</span>
          <textarea
            value={feedbackForm.doing}
            onChange={(event) =>
              setFeedbackForm((prev) => ({ ...prev, doing: event.target.value }))
            }
          />
        </label>
        <label>
          <span>{copy.feedbackUnclearLabel}</span>
          <textarea
            value={feedbackForm.unclear}
            onChange={(event) =>
              setFeedbackForm((prev) => ({ ...prev, unclear: event.target.value }))
            }
          />
        </label>
        <label>
          <span>{copy.feedbackWorkaroundLabel}</span>
          <textarea
            value={feedbackForm.workaround}
            onChange={(event) =>
              setFeedbackForm((prev) => ({ ...prev, workaround: event.target.value }))
            }
          />
        </label>
        <label>
          <span>{copy.feedbackSuggestionLabel}</span>
          <textarea
            value={feedbackForm.suggestion}
            onChange={(event) =>
              setFeedbackForm((prev) => ({ ...prev, suggestion: event.target.value }))
            }
          />
        </label>
        <label>
          <span>{copy.feedbackKeywordsLabel}</span>
          <textarea
            value={feedbackForm.keywords}
            onChange={(event) =>
              setFeedbackForm((prev) => ({ ...prev, keywords: event.target.value }))
            }
          />
        </label>
      </div>
      <div className="feedback-panel-actions">
        <button type="button" className="ghost" onClick={exportFeedbackJson}>
          {copy.feedbackExport}
        </button>
        <div className="feedback-panel-action-group">
          <button type="button" className="primary" onClick={saveFeedbackEntry}>
            {copy.feedbackSave}
          </button>
          <button type="button" className="ghost" onClick={() => setFeedbackOpen(false)}>
            {copy.feedbackCancel}
          </button>
        </div>
      </div>
    </div>
  ) : null

  const feedbackFab = (
    <button type="button" className="feedback-fab" onClick={() => setFeedbackOpen(true)}>
      {copy.feedbackButtonLabel}
    </button>
  )

  const spaceSectionsStep2 = ['supersystem', 'system', 'subsystem'] as const
  const spaceSectionsStep3 = ['supersystem', 'system', 'subsystem'] as const

  const autosizeTextarea = (element: HTMLTextAreaElement | null) => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

  const limitWords = (value: string, maxWords: number) => {
    const trimmed = value.trim()
    if (!trimmed) return value
    const words = trimmed.split(/\s+/)
    if (words.length <= maxWords) return value
    return words.slice(0, maxWords).join(' ')
  }

  const countWords = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).length
  }

  const containsVaguePhrase = (value: string) => {
    const lowered = value.toLowerCase()
    return [
      'nie wiem',
      'trudno powiedzieć',
      'to zależy',
      'chyba',
      'w sumie',
    ].some((phrase) => lowered.includes(phrase))
  }

  const resetStuckSignals = () => {
    setEngineWeakSignals(0)
    setEngineMediumSignals(0)
    setEngineStrongSignals(0)
    setEngineLastWeakKind(null)
    setEngineLastMediumKind(null)
    setEngineLastStrongKind(null)
    engineIdleTriggered.current = false
  }

  const registerSignal = (level: 'weak' | 'medium' | 'strong', kind: string) => {
    if (level === 'weak') {
      setEngineWeakSignals((prev) => prev + 1)
      setEngineLastWeakKind(kind)
    } else if (level === 'medium') {
      setEngineMediumSignals((prev) => prev + 1)
      setEngineLastMediumKind(kind)
    } else {
      setEngineStrongSignals((prev) => prev + 1)
      setEngineLastStrongKind(kind)
    }
  }

  useEffect(() => {
    let cancelled = false

    const applyOptions = (worlds: string[], elements: string[], times: string[]) => {
      if (cancelled) return
      setSpaceOptions([
        ...worlds.map((label, index) => ({ id: index, label, kind: 'world' as const })),
        ...elements.map((label, index) => ({
          id: index + worlds.length,
          label,
          kind: 'element' as const,
        })),
      ])
      setTimeOptions(times.map((label, index) => ({ id: index, label })))
    }

    const fallbackWorlds = buildWorldSuggestions(productName, copy).slice(0, 10)
    const fallbackElements = buildElementSuggestions(productName, copy, reportLanguage).slice(0, 10)
    const fallbackTimes = buildTimeSuggestions(productName, copy)

    if (!productName.trim() || llmStatus !== 'online') {
      applyOptions(fallbackWorlds, fallbackElements, fallbackTimes)
      return () => {
        cancelled = true
      }
    }

    const requestOptions = async () => {
      try {
        const [spaceRes, timeRes] = await Promise.all([
          fetch(`${llmApiBase}/api/generate-space-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productName: productName.trim(),
              description: productDescription.trim(),
              worldCount: 10,
              elementCount: 10,
              language: reportLanguage,
            }),
          }),
          fetch(`${llmApiBase}/api/generate-time-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productName: productName.trim(),
              count: 15,
              language: reportLanguage,
            }),
          }),
        ])

        if (!spaceRes.ok || !timeRes.ok) throw new Error('Request failed')
        const spaceData = (await spaceRes.json()) as {
          worldOptions?: string[]
          elementOptions?: string[]
        }
        const timeData = (await timeRes.json()) as { options?: string[] }
        if (
          !Array.isArray(spaceData.worldOptions) ||
          !Array.isArray(spaceData.elementOptions) ||
          !Array.isArray(timeData.options)
        ) {
          throw new Error('Invalid response')
        }
        const nextWorlds = uniqueList(spaceData.worldOptions).slice(0, 10)
        const nextElements = uniqueList(spaceData.elementOptions).slice(0, 10)
        const nextTimes = uniqueList(timeData.options).slice(0, 20)
        const needsPolishFallback = reportLanguage === 'Polish'
        const needsEnglishFallback = reportLanguage === 'English'
        const worldsOut =
          (needsPolishFallback && looksEnglish(nextWorlds)) ||
          (needsEnglishFallback && looksPolish(nextWorlds))
            ? fallbackWorlds
            : nextWorlds
        const elementsOut =
          (needsPolishFallback && looksEnglish(nextElements)) ||
          (needsEnglishFallback && looksPolish(nextElements))
            ? fallbackElements
            : nextElements
        const timesOut =
          (needsPolishFallback && looksEnglish(nextTimes)) ||
          (needsEnglishFallback && looksPolish(nextTimes))
            ? fallbackTimes
            : nextTimes
        applyOptions(
          worldsOut.length ? worldsOut : fallbackWorlds,
          elementsOut.length ? elementsOut : fallbackElements,
          timesOut.length ? timesOut : fallbackTimes
        )
      } catch {
        applyOptions(fallbackWorlds, fallbackElements, fallbackTimes)
      }
    }

    void requestOptions()

    return () => {
      cancelled = true
    }
  }, [productName, productDescription, copy, llmStatus, llmApiBase, reportLanguage])

  useEffect(() => {
    setProductConfirmed(false)
  }, [productName])

  useEffect(() => {
    setProductDescriptionConfirmed(false)
    setProductNameSuggestions([])
  }, [productDescription])

  const requestNameSuggestions = async () => {
    const description = productDescription.trim()
    if (!description) return

    setProductDescriptionConfirmed(true)

    if (llmStatus !== 'online') {
      setProductNameSuggestions(buildNameSuggestions(description, productName))
      return
    }

    try {
      const response = await fetch(`${llmApiBase}/api/generate-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, count: 5 }),
      })
      if (!response.ok) {
        const msg = await response.text()
        throw new Error(msg || 'Request failed')
      }
      const data = (await response.json()) as { names?: string[] }
      if (!Array.isArray(data.names) || data.names.length === 0) {
        throw new Error('Invalid response')
      }
      setProductNameSuggestions(data.names)
    } catch {
      setProductNameSuggestions(buildNameSuggestions(description, productName))
    }
  }

  const spaceOptionMap = useMemo(
    () => new Map(spaceOptions.map((option) => [option.id, option])),
    [spaceOptions]
  )
  const timeOptionMap = useMemo(
    () => new Map(timeOptions.map((option) => [option.id, option.label])),
    [timeOptions]
  )

  const assignedSpaceIds = useMemo(
    () =>
      Object.values(spaceAssignments).filter((id): id is number => typeof id === 'number'),
    [spaceAssignments]
  )
  const assignedTimeIds = useMemo(
    () =>
      Object.values(timeAssignments).filter((id): id is number => typeof id === 'number'),
    [timeAssignments]
  )

  const areSpaceSlotsComplete = useMemo(
    () => Object.values(spaceAssignments).every((id) => typeof id === 'number'),
    [spaceAssignments]
  )
  const areTimeSlotsComplete = useMemo(
    () => Object.values(timeAssignments).every((id) => typeof id === 'number'),
    [timeAssignments]
  )

  const finalSpaces = useMemo(
    () =>
      assignedSpaceIds
        .map((id) => spaceOptionMap.get(id)?.label)
        .filter((value): value is string => Boolean(value)),
    [assignedSpaceIds, spaceOptionMap]
  )

  const finalTimes = useMemo(
    () =>
      assignedTimeIds
        .map((id) => timeOptionMap.get(id))
        .filter((value): value is string => Boolean(value)),
    [assignedTimeIds, timeOptionMap]
  )

  useEffect(() => {
    if (!productConfirmed || !areSpaceSlotsComplete || !areTimeSlotsComplete) {
      setScenarios([])
      setSelectedScenarioId(null)
      return
    }

    const supersystemId = spaceAssignments.supersystem as number
    const subsystemId = spaceAssignments.subsystem as number
    const pastId = timeAssignments.past as number
    const nowId = timeAssignments.now as number
    const futureId = timeAssignments.future as number

    const supersystemLabel = spaceOptionMap.get(supersystemId)?.label || copy.notSelected
    const subsystemLabel = spaceOptionMap.get(subsystemId)?.label || copy.notSelected

    const scenario: Scenario = {
      id: `scenario-${supersystemId}-${subsystemId}-${pastId}-${nowId}-${futureId}`,
      spaceId: supersystemId,
      timeId: nowId,
      spaceDefs: {
        subsystem: subsystemLabel,
        system: productName || copy.analyzedProduct,
        supersystem: supersystemLabel,
      },
      timeDefs: {
        past: timeOptionMap.get(pastId) || copy.notSelected,
        now: timeOptionMap.get(nowId) || copy.notSelected,
        future: timeOptionMap.get(futureId) || copy.notSelected,
      },
    }

    setScenarios([scenario])
    setSelectedScenarioId(scenario.id)
  }, [
    productName,
    areSpaceSlotsComplete,
    areTimeSlotsComplete,
    spaceAssignments,
    timeAssignments,
    copy,
    spaceOptionMap,
    timeOptionMap,
  ])



  const handleDragStart = (
    event: React.DragEvent<HTMLElement>,
    type: 'space' | 'time',
    id: number
  ) => {
    event.dataTransfer.setData('application/json', JSON.stringify({ type, id }))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleNameDragStart = (event: React.DragEvent<HTMLElement>, name: string) => {
    event.dataTransfer.setData('text/plain', name)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleLabelDragStart = (event: React.DragEvent<HTMLElement>, labelId: string | null) => {
    event.dataTransfer.setData('application/label', labelId ?? '')
    event.dataTransfer.effectAllowed = 'move'
  }

  const labelPalette = [
    '#f6b8a2',
    '#f4d6a0',
    '#b9e3c6',
    '#b7d9f4',
    '#c7b6f2',
    '#f2b7d6',
    '#cfe8a8',
    '#a8e1e8',
    '#f2c5e8',
    '#f2a7c2',
  ]

  const getNextLabelColor = (labels: LabelItem[]) => {
    const used = new Set(labels.map((label) => label.color))
    return labelPalette.find((color) => !used.has(color)) || '#e7ebf0'
  }

  const getLabelById = (labelId: string | null) =>
    labelId ? ideaLabels.find((label) => label.id === labelId) || null : null

  const getLabelForIdea = (ideaId: string) => {
    const labelId = ideaLabelAssignments[ideaId]
    return getLabelById(labelId)
  }

  const allowDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const readDragPayload = (event: React.DragEvent<HTMLElement>) => {
    const raw = event.dataTransfer.getData('application/json')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as { type?: string; id?: number }
      if ((parsed.type !== 'space' && parsed.type !== 'time') || typeof parsed.id !== 'number') {
        return null
      }
      return parsed as { type: 'space' | 'time'; id: number }
    } catch {
      return null
    }
  }

  const handleDropOnSpace = (slot: SpaceSlot) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const payload = readDragPayload(event)
    if (!payload || payload.type !== 'space') return
    const optionKind = spaceOptionMap.get(payload.id)?.kind
    if (optionKind && optionKind !== SPACE_KIND_FOR_SLOT[slot]) {
      return
    }
    setSpaceAssignments((prev) => {
      const next = { ...prev }
      ;(Object.keys(next) as SpaceSlot[]).forEach((key) => {
        if (next[key] === payload.id) next[key] = null
      })
      next[slot] = payload.id
      return next
    })
  }

  const handleDropOnTime = (slot: TimeSlot) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const payload = readDragPayload(event)
    if (!payload || payload.type !== 'time') return
    setTimeAssignments((prev) => {
      const next = { ...prev }
      ;(Object.keys(next) as TimeSlot[]).forEach((key) => {
        if (next[key] === payload.id) next[key] = null
      })
      next[slot] = payload.id
      return next
    })
  }

  const updateScenarioSpaceDef = (key: keyof Scenario['spaceDefs'], value: string) => {
    setScenarios((prev) =>
      prev.map((scenario) =>
        scenario.id === selectedScenarioId
          ? {
              ...scenario,
              spaceDefs: {
                ...scenario.spaceDefs,
                [key]: value,
              },
            }
          : scenario
      )
    )
  }

  const updateScenarioTimeDef = (key: keyof Scenario['timeDefs'], value: string) => {
    setScenarios((prev) =>
      prev.map((scenario) =>
        scenario.id === selectedScenarioId
          ? {
              ...scenario,
              timeDefs: {
                ...scenario.timeDefs,
                [key]: value,
              },
            }
          : scenario
      )
    )
  }

  const addLlmIdeas = async () => {
    if (!selectedScenario) return
    const fallback = () => {
      setWorkshopIdeas((prev) => {
        const next: Record<string, Idea[]> = {}
        spaceSections.forEach((spaceKey) => {
          timeSections.forEach((timeKey) => {
            const cellKey = `${spaceKey}-${timeKey}`
            const spaceDef = selectedScenario.spaceDefs[spaceKey]
            const timeDef = selectedScenario.timeDefs[timeKey]
            const ideas: Idea[] = []
            for (let i = 0; i < 3; i += 1) {
              ideas.push({
                id: `llm-${cellKey}-${Date.now()}-${i}`,
                text: copy.llmIdeaTemplate(spaceDef, timeDef),
                source: 'llm',
              })
            }
            next[cellKey] = [...(prev[cellKey] || []), ...ideas]
          })
        })
        return next
      })
    }

    if (llmStatus !== 'online') {
      fallback()
      return
    }

    try {
      const cells = spaceSections.flatMap((spaceKey) =>
        timeSections.map((timeKey) => ({
          id: `${spaceKey}-${timeKey}`,
          spaceDef: selectedScenario.spaceDefs[spaceKey],
          timeDef: selectedScenario.timeDefs[timeKey],
        }))
      )
      const response = await fetch(`${llmApiBase}/api/generate-ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: productName || copy.analyzedProduct,
          ideasPerCell: 3,
          cells,
        }),
      })
      if (!response.ok) {
        const msg = await response.text()
        throw new Error(msg || 'Request failed')
      }
      const data = (await response.json()) as { ideas?: Record<string, string[]> }
      if (!data.ideas) throw new Error('Invalid response')

      setWorkshopIdeas((prev) => {
        const next: Record<string, Idea[]> = { ...prev }
        Object.entries(data.ideas || {}).forEach(([cellKey, ideaList]) => {
          const mapped = (ideaList || []).map((text, index) => ({
            id: `llm-${cellKey}-${Date.now()}-${index}`,
            text,
            source: 'llm' as const,
          }))
          next[cellKey] = [...(prev[cellKey] || []), ...mapped]
        })
        return next
      })
    } catch {
      fallback()
    }
  }

  const requestImpulse = async () => {
    if (!engineSessionId) return
    const boardItems = Object.values(workshopIdeas)
      .flat()
      .map((idea) => ({ type: 'idea', text: idea.text }))
    const endpoint = '/api/coach/suggest'
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: engineSessionId,
          boardItems,
          language: reportLanguage === 'English' ? 'en' : 'pl',
        }),
      })
      const rawText = await response.text()
      let data: { question?: { text?: string } | null; ok?: boolean } | null = null
      try {
        data = JSON.parse(rawText)
      } catch {
        data = null
      }
      if (!response.ok || !data) {
        setEngineApiDebug(
          import.meta.env.VITE_DEBUG_ENGINE === '1'
            ? { endpoint, status: response.status, response: data, rawText }
            : null
        )
        throw new Error('Request failed')
      }
      if (!data.question || !data.question.text) {
        setImpulseQuestion(copy.impulseEmpty)
      } else {
        setImpulseQuestion(data.question.text)
      }
    } catch {
      setImpulseQuestion(copy.impulseEmpty)
    }
    setImpulseOpen(true)
  }

  const keepOnlyUserIdeas = () => {
    setWorkshopIdeas((prev) => {
      const next: Record<string, Idea[]> = {}
      Object.entries(prev).forEach(([cellKey, ideas]) => {
        const filtered = ideas.filter((idea) => idea.source === 'user')
        if (filtered.length) next[cellKey] = filtered
      })
      return next
    })
    setIdeaLabelAssignments((prev) => {
      const next: Record<string, string | null> = {}
      Object.entries(prev).forEach(([ideaId, labelId]) => {
        if (ideaId.startsWith('user-')) {
          next[ideaId] = labelId
        }
      })
      return next
    })
  }

  const reportData = useMemo(() => {
    const step1 = {
      productName,
      spaces: finalSpaces,
      times: finalTimes,
    }

    const selectedScenarioLabel = selectedScenario
      ? copy.cellLabel(
          spaceOptionMap.get(selectedScenario.spaceId)?.label || copy.notSelected,
          timeOptionMap.get(selectedScenario.timeId) || copy.notSelected
        )
      : null

    const step2 = {
      totalScenarios: scenarios.length,
      selectedScenario: selectedScenarioLabel,
    }

    const step3 = selectedScenario
      ? {
          spaceDefs: selectedScenario.spaceDefs,
          timeDefs: selectedScenario.timeDefs,
        }
      : null

    const allIdeas = Object.values(workshopIdeas).flat()
    const totalIdeas = allIdeas.length
    const step4 = {
      totalIdeas,
      cellsWithIdeas: Object.values(workshopIdeas).filter((ideas) => ideas.length > 0).length,
      userIdeas: allIdeas.filter((idea) => idea.source === 'user').map((idea) => idea.text),
      llmIdeas: allIdeas.filter((idea) => idea.source === 'llm').map((idea) => idea.text),
    }

    const step4Report = {
      language: reportLanguage,
    }

    return { step1, step2, step3, step4, step4Report }
  }, [productName, finalSpaces, finalTimes, scenarios.length, selectedScenario, workshopIdeas, reportLanguage])

  const canProceedToStep2 =
    productConfirmed && areSpaceSlotsComplete && areTimeSlotsComplete

  const canProceedToStep3 = selectedScenarioId !== null
  const openMainLanding = () => {
    setLandingView('main')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const fetchJsonWithDiagnostics = async (url: string, options: RequestInit) => {
    const response = await fetch(url, options)
    const contentType = response.headers.get('content-type') || ''
    const raw = await response.text()
    let json: unknown = null
    let parseError: string | null = null
    try {
      json = JSON.parse(raw)
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error)
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      raw: raw.slice(0, 300),
      json,
      parseError,
      url,
    }
  }

  const activateFacilitationPrompt = async (type: FacilitationType) => {
    if (!enginePreviewSessionId) return
    setEnginePreviewError(null)
    setEngineFacilitationDiagnostics(null)
    const endpoint = '/api/coach/suggest'
    try {
      const result = await fetchJsonWithDiagnostics(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: enginePreviewSessionId,
          language: uiLanguage === 'English' ? 'en' : 'pl',
          action: type,
          askedIds: engineAskedQuestionIds,
          currentGroupCode: engineLastQuestionMeta?.group_code ?? null,
          currentModeCode: engineLastQuestionMeta?.mode_code ?? null,
        }),
      })
      const data = result.json as
        | {
            question?: {
              id?: string
              text?: string
              group_code?: string
              mode_code?: number
            } | null
          }
        | null
      if (!result.ok || !data) {
        setEngineFacilitationDiagnostics(result)
        throw new Error('Request failed')
      }
      const nextText = data.question?.text?.trim()
      if (!nextText) {
        setEngineFacilitationDiagnostics(result)
        setEngineActivePrompt(null)
        setEngineUiState('FREE_FLOW')
        setEngineOfferReason(null)
        setEnginePreviewError(copy.enginePreviewQuestionEmpty)
        return
      }
      setEngineApiDebug(import.meta.env.VITE_DEBUG_ENGINE === '1' ? {
        endpoint,
        status: result.status,
        response: data,
        rawText: result.raw,
      } : null)
      setEngineActivePrompt({ type, text: nextText })
      setEnginePreviewInput('')
      enginePreviousInput.current = ''
      setEngineUiState('FACILITATED_INPUT')
      setEngineOfferReason(null)
      logFacilitationEvent('facilitation_used', {
        sessionId: enginePreviewSessionId || 'unknown',
        action: type,
        promptText: nextText,
      })
      const questionId = data.question?.id
      if (questionId) {
        setEngineLastQuestionMeta({
          id: questionId,
          group_code: data.question?.group_code,
          mode_code: data.question?.mode_code,
        })
        setEngineAskedQuestionIds((prev) =>
          prev.includes(questionId) ? prev : [...prev, questionId]
        )
      }
      resetStuckSignals()
    } catch {
      setEngineActivePrompt(null)
      setEngineUiState('FREE_FLOW')
      setEngineOfferReason(null)
      setEnginePreviewError(copy.enginePreviewQuestionEmpty)
    }
  }

  const handleEnginePreviewInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const rawNext = event.target.value
    const prev = enginePreviewInput
    const nextWordCount = countWords(rawNext)
    const isDeletion = rawNext.length < prev.length
    if (nextWordCount > WORD_LIMIT && !isDeletion) {
      return
    }
    const next = limitWords(rawNext, WORD_LIMIT)
    setEnginePreviewInput(next)
    setEngineLastInputActivityAt(Date.now())
    engineIdleTriggered.current = false

    if (engineOfferReason) {
      logFacilitationEvent('facilitation_ignored', {
        sessionId: enginePreviewSessionId || 'unknown',
        reason: engineOfferReason || resolveOfferReason(),
      })
      setEngineOfferReason(null)
      if (engineUiState === 'FACILITATION_OFFER') {
        setEngineUiState('FREE_FLOW')
      }
    }

    if (engineEraseTimer.current) {
      window.clearTimeout(engineEraseTimer.current)
      engineEraseTimer.current = null
    }

    const prevInput = enginePreviousInput.current
    enginePreviousInput.current = next

    if (prevInput.trim() && !next.trim()) {
      engineEraseTimer.current = window.setTimeout(() => {
        if (engineInputFocused && !enginePreviousInput.current.trim()) {
          registerSignal('strong', 'erase')
        }
      }, ERASE_EMPTY_SECONDS_STRONG * 1000)
    }
  }

  const ensureEnginePreviewSession = async (nameOverride?: string) => {
    if (enginePreviewSessionId) return enginePreviewSessionId
    const name = (nameOverride ?? enginePreviewSessionName)?.trim()
    if (!name) {
      return null
    }
    try {
      const sessionDetail = await createSession({
        name,
      })
      if (sessionDetail.session?.id) {
        setEnginePreviewSessionId(sessionDetail.session.id)
        setEnginePreviewSessionName(sessionDetail.session.name ?? '')
        setEnginePreviewItems([])
        setEngineSessionDetail(sessionDetail)
        setEngineSessions(await listSessions())
        setFeedbackReminder(null)
        return sessionDetail.session.id
      }
    } catch {
      setEnginePreviewError('Unable to create engine session.')
      logSessionStore('engine_preview_create_failed', {})
    }
    return null
  }

  const handleEnginePreviewAdd = async (nameOverride?: string) => {
    const text = enginePreviewInput.trim()
    if (!text) return
    if (isDebugEnabled()) {
      const details = computeMappingDetails(text, uiLanguage)
      console.log(
        JSON.stringify({
          event: 'matrix_mapping_entry',
          row: details.row,
          col: details.col,
          rowScores: details.rowScores,
          colScores: details.colScores,
          rowMatches: details.rowMatches,
          colMatches: details.colMatches,
        })
      )
    }
    const nameToUse = (nameOverride ?? enginePreviewSessionName).trim()
    if (!nameToUse && enginePreviewItems.length === 0) {
      setEngineNameDraft('')
      setEngineNamePromptOpen(true)
      return
    }
    const sessionId = await ensureEnginePreviewSession()
    if (!sessionId) return
    engineInteractionBySession.current[sessionId] = true

    const now = Date.now()
    const wordCount = countWords(text)
    const isShort = wordCount > 0 && wordCount < SHORT_ENTRY_WORDS
    const isVague = containsVaguePhrase(text)
    const entryType = engineUiState === 'FACILITATED_INPUT' ? 'facilitated_input' : 'free_input'

    if (entryType === 'free_input') {
      if (isShort) registerSignal('weak', 'short')
      if (isShort && engineLastEntryShort && engineLastEntryAt && now - engineLastEntryAt < 15000) {
        registerSignal('weak', 'short_burst')
      }
      if (isVague) registerSignal('medium', 'vague')
      if (isShort && isVague) registerSignal('medium', 'short_vague')

      let nextStreak = engineFreeEntryStreak + 1
      if (nextStreak >= 3) {
        registerSignal('weak', 'no_facilitation')
        nextStreak = 0
      }
      setEngineFreeEntryStreak(nextStreak)
    } else {
      setEngineFreeEntryStreak(0)
    }

    setEnginePreviewError(null)
    try {
      const itemId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const newItem: EngineBoardItem = {
        id: itemId,
        type: 'idea',
        text,
        label: null,
        created_at: now,
        entry_type: entryType,
        prompt_type: engineActivePrompt?.type || null,
      }
      setEnginePreviewItems((prev) => [newItem, ...prev])
      setEnginePreviewInput('')
      setEngineLastInputActivityAt(now)
      setEngineInputFocused(true)
      engineLastAddAtBySession.current[sessionId] = now
      engineIdleTriggered.current = false
      clearEngineIdleTimer('post_add')
      setEngineOfferReason(null)
      if (entryType !== 'facilitated_input') {
        setEngineUiState('FREE_FLOW')
      }
      logFacilitationEvent('post_add_grace_start', {
        sessionId,
        until: now + postAddGraceMs,
      })
      const currentDetail = await getSession(sessionId)
      const sessionDetail = currentDetail ?? {
        session: {
          id: sessionId,
          name: nameToUse || null,
          created_at: now,
          updated_at: now,
          last_group_code: null,
          last_mode_code: null,
          last_category_code: null,
          stuck_counter: 0,
        },
        boardItems: [],
        askedQuestionIds: [],
      }
      const nextSessionName = sessionDetail.session?.name || nameToUse || null
      const updatedDetail: EngineSessionDetail = {
        ...sessionDetail,
        session: sessionDetail.session
          ? {
              ...sessionDetail.session,
              name: nextSessionName,
              updated_at: now,
            }
          : null,
        boardItems: [newItem, ...(sessionDetail.boardItems || [])],
      }
      await updateSession(updatedDetail)
      if (engineSessionDetail?.session?.id === sessionId) {
        setEngineSessionDetail(updatedDetail)
      }
      setEnginePreviewSessionName(nextSessionName ?? '')
      if (engineSessionsOpen) {
        setEngineSessions(await listSessions())
      }
      enginePreviousInput.current = ''
      if (entryType !== 'facilitated_input') {
        setEngineUiState('FREE_FLOW')
        setEngineActivePrompt(null)
      }
      setEngineOfferReason(null)
      if (engineUiState === 'FACILITATION_OFFER' || engineUiState === 'FACILITATED_INPUT') {
        resetStuckSignals()
      }
      logFacilitationEvent('entry_added', {
        sessionId: sessionId || 'unknown',
        entryType: entryType === 'facilitated_input' ? 'facilitated' : 'free',
        words: wordCount,
      })
      setEngineLastEntryAt(now)
      setEngineLastEntryShort(isShort)
      engineInputRef.current?.focus()
    } catch {
      setEnginePreviewError('Unable to add board item.')
      logSessionStore('engine_preview_add_failed', { sessionId })
    }
  }


  const resetEnginePreview = () => {
    engineResetOnSessionChange.current = true
    engineInteractionBySession.current = {}
    engineIdleArmedRef.current = false
    setEnginePreviewSessionId(null)
    setEnginePreviewItems([])
    setEnginePreviewError(null)
    setEngineSessionDetail(null)
    setEngineSessionsError(null)
    setEngineUiState('INIT')
    setEngineNamePromptOpen(false)
    setEngineNameDraft('')
    setEnginePreviewSessionName('')
    setEngineActivePrompt(null)
    setEngineOfferReason(null)
    resetStuckSignals()
    setEngineFreeEntryStreak(0)
    setEngineLastEntryAt(null)
    setEngineLastEntryShort(false)
    setEngineLastInputActivityAt(null)
    setEngineInputFocused(false)
  }

  const closeEnginePreviewSession = async () => {
    await flushEngineEntryLabels()
    const closingSessionId = enginePreviewSessionId
    logFacilitationEvent('session_closed', {
      sessionId: enginePreviewSessionId || 'unknown',
      sessionName: enginePreviewSessionName || null,
      items: enginePreviewItems.length,
    })
    resetEnginePreview()
    if (closingSessionId) {
      setFeedbackReminder({ sessionId: closingSessionId, visible: true })
    }
  }

  const fetchEngineSessions = async () => {
    setEngineSessionsError(null)
    setEngineSessionsLoading(true)
    try {
      const sessions = await listSessions()
      setEngineSessions(sessions)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się pobrać listy sesji. ${message}`)
      logSessionStore('engine_sessions_list_failed', { message })
    } finally {
      setEngineSessionsLoading(false)
    }
  }

  useEffect(() => {
    if (!isEnginePreview) return
    void fetchEngineSessions()
  }, [isEnginePreview])

  const deleteEngineSession = async (sessionId: string) => {
    setEngineSessionsError(null)
    setEngineDeleteLoadingId(sessionId)
    try {
      await deleteSession(sessionId)
      setEngineSessions((prev) => prev.filter((session) => session.id !== sessionId))
      if (engineSessionDetail?.session?.id === sessionId) {
        setEngineSessionDetail(null)
      }
      if (enginePreviewSessionId === sessionId) {
        resetEnginePreview()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się usunąć sesji. ${message}`)
      logSessionStore('engine_session_delete_failed', { sessionId, message })
    } finally {
      setEngineDeleteLoadingId(null)
    }
  }

  const updateEngineEntryLabel = async (entryId: string, label: string | null) => {
    setEngineSessionsError(null)
    setEnginePreviewItems((prev) =>
      prev.map((item) => (item.id === entryId ? { ...item, label } : item))
    )
    if (engineSessionDetail?.session) {
      setEngineSessionDetail((prev) =>
        prev
          ? {
              ...prev,
              boardItems: prev.boardItems.map((item) =>
                item.id === entryId ? { ...item, label } : item
              ),
            }
          : prev
      )
    }
    try {
      const sessionId = enginePreviewSessionId || engineSessionDetail?.session?.id
      if (!sessionId) return
      const detail = await getSession(sessionId)
      if (!detail?.session) return
      const updated: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.map((item) =>
          item.id === entryId ? { ...item, label } : item
        ),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updated)
      engineLabelCache.current[entryId] = label ?? null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zapisać etykiety. ${message}`)
      logSessionStore('engine_entry_label_failed', { entryId, message })
    }
  }

  const flushEngineEntryLabels = async () => {
    const pending = enginePreviewItems.filter(
      (item) => (engineLabelCache.current[item.id] ?? null) !== (item.label ?? null)
    )
    if (pending.length === 0) return
    await Promise.all(
      pending.map((item) => updateEngineEntryLabel(item.id, item.label ?? null))
    )
  }

  const fetchEngineSessionDetail = async (sessionId: string) => {
    setEngineSessionsError(null)
    setEngineEditItemId(null)
    setEngineEditText('')
    try {
      const data = await getSession(sessionId)
      if (!data) throw new Error('Missing session')
      setEngineSessionDetail(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się pobrać szczegółów sesji. ${message}`)
      logSessionStore('engine_session_detail_failed', { sessionId, message })
    }
  }

  const openEngineSession = async (sessionId: string) => {
    setEngineSessionsError(null)
    setEngineEditItemId(null)
    setEngineEditText('')
    try {
      const data = await getSession(sessionId)
      if (!data) throw new Error('Missing session')
      engineResetOnSessionChange.current = true
      const normalizedItems = (data.boardItems ?? []).map((item) => ({
        ...item,
        label: item.label ?? null,
      }))
      setEngineSessionDetail({ ...data, boardItems: normalizedItems })
      setEnginePreviewSessionId(data.session?.id ?? null)
      setEnginePreviewSessionName(data.session?.name ?? '')
      setEnginePreviewItems(normalizedItems)
      syncEngineLabelCache(normalizedItems)
      setEnginePreviewInput('')
      setEnginePreviewError(null)
      setEngineNamePromptOpen(false)
      setEngineNameDraft('')
      setFeedbackReminder(null)
      setEngineUiState('FREE_FLOW')
      setEngineActivePrompt(null)
      setEngineOfferReason(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się pobrać szczegółów sesji. ${message}`)
      logSessionStore('engine_session_open_failed', { sessionId, message })
    }
  }

  const startEditEngineItem = (item: EngineBoardItem) => {
    setEngineEditItemId(item.id)
    setEngineEditText(item.text)
  }

  const cancelEditEngineItem = () => {
    setEngineEditItemId(null)
    setEngineEditText('')
  }

  const finishEditEngineItem = () => {
    setEngineEditItemId(null)
    setEngineEditText('')
  }

  const saveEngineItem = async () => {
    if (!engineEditItemId || !engineSessionDetail?.session) return
    const targetId = engineEditItemId
    const sessionId = engineSessionDetail.session.id
    const nextText = engineEditText.trim()
    setEngineEditLoading(true)
    setEngineSessionsError(null)
    try {
      const detail = await getSession(sessionId)
      if (!detail?.session) throw new Error('Missing session')
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.map((item) =>
          item.id === targetId ? { ...item, text: nextText } : item
        ),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
      setEngineSessionDetail((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          boardItems: prev.boardItems.map((item) =>
            item.id === targetId ? { ...item, text: nextText } : item
          ),
        }
      })
      finishEditEngineItem()
      await fetchEngineSessionDetail(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zapisać zmian. ${message}`)
      logSessionStore('engine_item_save_failed', { sessionId, message })
    } finally {
      setEngineEditLoading(false)
    }
  }

  const startEnginePreviewEdit = (item: EngineBoardItem) => {
    setEngineLabelEditorId(null)
    setEnginePreviewEditId(item.id)
    setEnginePreviewEditText(item.text)
  }

  const cancelEnginePreviewEdit = () => {
    setEnginePreviewEditId(null)
    setEnginePreviewEditText('')
  }

  const saveEnginePreviewEdit = async () => {
    if (!enginePreviewEditId || !enginePreviewSessionId) return
    const nextText = enginePreviewEditText.trim()
    if (!nextText) return
    const limited = limitWords(nextText, WORD_LIMIT)
    setEnginePreviewItems((prev) =>
      prev.map((item) => (item.id === enginePreviewEditId ? { ...item, text: limited } : item))
    )
    if (engineSessionDetail?.session?.id === enginePreviewSessionId) {
      setEngineSessionDetail((prev) =>
        prev
          ? {
              ...prev,
              boardItems: prev.boardItems.map((item) =>
                item.id === enginePreviewEditId ? { ...item, text: limited } : item
              ),
            }
          : prev
      )
    }
    try {
      const detail = await getSession(enginePreviewSessionId)
      if (!detail?.session) return
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.map((item) =>
          item.id === enginePreviewEditId ? { ...item, text: limited } : item
        ),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zapisać zmian. ${message}`)
      logSessionStore('engine_preview_edit_failed', { message })
    } finally {
      cancelEnginePreviewEdit()
    }
  }

  const cancelEngineEntryDelete = () => {
    setEngineEntryDeleteId(null)
  }

  const confirmEngineEntryDelete = async (itemId: string) => {
    const sessionId = enginePreviewSessionId || engineSessionDetail?.session?.id
    if (!sessionId) return
    setEngineSessionsError(null)
    try {
      const detail = await getSession(sessionId)
      if (!detail?.session) return
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.filter((item) => item.id !== itemId),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
      setEnginePreviewItems((prev) => prev.filter((item) => item.id !== itemId))
      if (engineSessionDetail?.session) {
        setEngineSessionDetail((prev) =>
          prev
            ? {
                ...prev,
                boardItems: prev.boardItems.filter((item) => item.id !== itemId),
              }
            : prev
        )
      }
      if (enginePreviewEditId === itemId) cancelEnginePreviewEdit()
      if (engineLabelEditorId === itemId) setEngineLabelEditorId(null)
      delete engineLabelCache.current[itemId]
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się usunąć elementu. ${message}`)
      logSessionStore('engine_preview_item_delete_failed', { itemId, message })
    } finally {
      setEngineEntryDeleteId(null)
    }
  }

  const deleteEngineItem = async (itemId: string) => {
    if (!engineSessionDetail?.session) return
    setEngineEditLoading(true)
    setEngineSessionsError(null)
    try {
      const detail = await getSession(engineSessionDetail.session.id)
      if (!detail?.session) throw new Error('Missing session')
      const updatedDetail: EngineSessionDetail = {
        ...detail,
        boardItems: detail.boardItems.filter((item) => item.id !== itemId),
        session: { ...detail.session, updated_at: Date.now() },
      }
      await updateSession(updatedDetail)
      if (engineEditItemId === itemId) cancelEditEngineItem()
      await fetchEngineSessionDetail(engineSessionDetail.session.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się usunąć elementu. ${message}`)
      logSessionStore('engine_item_delete_failed', { itemId, message })
    } finally {
      setEngineEditLoading(false)
    }
  }

  const handleExportSessions = async () => {
    try {
      const sessions = await exportSessions()
      const payload = {
        exportedAt: Date.now(),
        sessions,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'engine-sessions.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się wyeksportować sesji. ${message}`)
      logSessionStore('engine_export_failed', { message })
    }
  }

  const handleImportSessions = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as { sessions?: unknown } | unknown[]
      const sessions = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { sessions?: unknown }).sessions)
          ? (parsed as { sessions: unknown[] }).sessions
          : null
      if (!sessions) {
        throw new Error('Nieprawidłowy format pliku.')
      }
      const result = await importSessions(sessions as Parameters<typeof importSessions>[0])
      setEngineSessionsError(null)
      setEngineSessions(await listSessions())
      logSessionStore('engine_import_done', { imported: result.imported })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      setEngineSessionsError(`Nie udało się zaimportować sesji. ${message}`)
      logSessionStore('engine_import_failed', { message })
    } finally {
      if (engineImportInputRef.current) {
        engineImportInputRef.current.value = ''
      }
    }
  }

  if (isEnginePreview) {
    const enginePlaceholder =
      engineUiState === 'FACILITATED_INPUT' && engineActivePrompt
        ? engineActivePrompt.text
        : enginePreviewItems.length === 0
          ? copy.enginePlaceholderInitial
          : copy.enginePlaceholderContinue

    const formatSessionLabel = (name: string | null | undefined, id: string) => {
      if (name && name.trim()) {
        return (
          <>
            <span className="engine-session-name">{name}</span> · {id}
          </>
        )
      }
      const shortId = id.slice(0, 8)
      return `Session ${shortId}`
    }

  const engineRemainingWords = Math.max(0, WORD_LIMIT - countWords(enginePreviewInput))
  const isEngineWordLimitReached =
    enginePreviewInput.trim().length > 0 && countWords(enginePreviewInput) >= WORD_LIMIT
  const showFacilitationOffer =
    engineUiState === 'FACILITATION_OFFER' ||
    engineOfferReason === 'idle' ||
    engineOfferReason === 'manual'
  const showHelpButton = !showFacilitationOffer
  const orderedEnginePreviewItems = useMemo(() => {
    const estimateLines = (value: string) => {
      const length = String(value || '').trim().length
      const perLine = 55
      return Math.max(1, Math.ceil(length / perLine))
    }
    return enginePreviewItems
      .map((item, index) => ({ item, index, lines: estimateLines(item.text) }))
      .sort((a, b) => a.lines - b.lines || a.index - b.index)
      .map(({ item }) => item)
  }, [enginePreviewItems])

  return (
      <div className="app engine-preview" data-testid="active-session">
        <header className="engine-header">
          <div>
            <a className="engine-kicker" href="/">
              makemyidea.work
            </a>
          </div>
        </header>
        <main className="engine-main">
          {feedbackReminderBanner}
          <section className="engine-panel">
            <div className="engine-panel-header">
              <h1>{copy.enginePreviewSessionTitle}</h1>
              <div className="engine-actions">
                {!enginePreviewSessionId && !engineSessionsOpen && (
                  <button
                    type="button"
                    className="primary"
                  data-testid="session-create"
                  onClick={async () => {
                    markUserInitiatedInteraction('pointer')
                    setEngineLastInputActivityAt(Date.now())
                    armIdleWatch('create_session')
                    setEngineNameDraft('')
                    setEngineNamePromptOpen(true)
                  }}
                >
                    {copy.enginePreviewCreateSession}
                  </button>
                )}
                {enginePreviewSessionId && (
                  <button
                    type="button"
                    className="ghost"
                    data-testid="session-close"
                    onClick={() => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      closeEnginePreviewSession()
                    }}
                  >
                    {copy.enginePreviewReset}
                  </button>
                )}
                {!enginePreviewSessionId && (
                  <button
                    type="button"
                    className="ghost"
                    data-testid="session-list-toggle"
                    onClick={() => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      const next = !engineSessionsOpen
                      const openList = async () => {
                        if (next) await flushEngineEntryLabels()
                        setEngineSessionsOpen(next)
                        if (next) fetchEngineSessions()
                      }
                      void openList()
                    }}
                  >
                    {engineSessionsOpen
                      ? copy.engineSessionsToggleClose
                      : copy.engineSessionsToggleOpen}
                  </button>
                )}
              </div>
            </div>
            <div className="engine-meta">
              <span>{copy.enginePreviewSessionIdLabel}:</span>
              <span className="engine-meta-value engine-meta-value--muted">
                {enginePreviewSessionId ? formatSessionLabel(enginePreviewSessionName, enginePreviewSessionId) : copy.enginePreviewSessionEmpty}
              </span>
            </div>
          </section>

          {engineSessionsOpen && (
            <section className="engine-panel engine-sessions">
              <div className="engine-panel-header">
                <h2>{copy.engineSessionsTitle}</h2>
                <div className="engine-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={fetchEngineSessions}
                    disabled={engineSessionsLoading}
                  >
                    {engineSessionsLoading ? '...' : copy.engineSessionsRefresh}
                  </button>
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
                                      onClick={saveEngineItem}
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
                                      Edytuj
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost danger"
                                      onClick={() => deleteEngineItem(item.id)}
                                      disabled={engineEditLoading}
                                    >
                                      Usuń
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
                    onChange={(event) => setEngineNameDraft(event.target.value.slice(0, 40))}
                    placeholder={copy.engineNamePlaceholder}
                  />
                </label>
                <div className="engine-facilitation-actions">
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-name-save"
                    onClick={async () => {
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                      const name = engineNameDraft.trim().replace(/\s+/g, ' ')
                      if (!name) return
                      armIdleWatch('save_and_continue')
                      engineInteractionBySession.current['new'] = true
                      setEngineInputFocused(true)
                      setEngineUiState('FREE_FLOW')
                      enginePendingArmingRef.current = true
                      enginePendingFocusRef.current = true
                      setEnginePreviewSessionName(name)
                      setEngineNamePromptOpen(false)
                      const sessionId = await ensureEnginePreviewSession(name)
                      if (sessionId) {
                        engineInteractionBySession.current[sessionId] = true
                        setEngineLastInputActivityAt(Date.now())
                      }
                      engineInputRef.current?.focus()
                      markUserInitiatedInteraction('pointer')
                      setEngineLastInputActivityAt(Date.now())
                    }}
                  >
                    {copy.engineNameSave}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setEngineNamePromptOpen(false)}
                  >
                    {copy.cancel}
                  </button>
                </div>
              </div>
            </section>
          )}

          {enginePreviewSessionId && (
            <section className="engine-panel">
              <div className="engine-panel-header">
                <h2>{copy.enginePreviewBoardItemsTitle}</h2>
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
              <div
                className={`engine-helper engine-facilitation-note ${
                  showFacilitationOffer ? 'is-visible' : 'is-hidden'
                }`}
                aria-hidden={!showFacilitationOffer}
              >
                {copy.engineFacilitationNote}
              </div>
              {uiLanguage === 'English' && copy.engineQuestionsWipNote && (
                <div className="engine-helper">{copy.engineQuestionsWipNote}</div>
              )}
              <div
                className={`engine-facilitation-actions engine-facilitation-actions--fade ${
                  showFacilitationOffer ? 'is-visible' : 'is-hidden'
                }`}
                data-testid="facilitation-buttons"
                aria-hidden={!showFacilitationOffer}
              >
                <button
                  type="button"
                  className="ghost"
                  data-testid="facilitation-next"
                  onClick={() => {
                    setFacilitationCooldown('NEXT')
                    armIdleWatch('facilitation_next')
                    void activateFacilitationPrompt('NEXT')
                  }}
                  disabled={!showFacilitationOffer}
                >
                  {copy.engineFacilitationNext}
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="facilitation-deepen"
                  onClick={() => {
                    setFacilitationCooldown('DEEPEN')
                    armIdleWatch('facilitation_deepen')
                    void activateFacilitationPrompt('DEEPEN')
                  }}
                  disabled={!showFacilitationOffer}
                >
                  {copy.engineFacilitationDeepen}
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="facilitation-perspective"
                  onClick={() => {
                    setFacilitationCooldown('PERSPECTIVE')
                    armIdleWatch('facilitation_perspective')
                    void activateFacilitationPrompt('PERSPECTIVE')
                  }}
                  disabled={!showFacilitationOffer}
                >
                  {copy.engineFacilitationPerspective}
                </button>
              </div>
              </div>
              {enginePreviewError && <div className="engine-error">{enginePreviewError}</div>}
              {enginePreviewError && engineFacilitationDiagnostics && (
                <div className="engine-debug-panel">
                  <div>URL: {engineFacilitationDiagnostics.url}</div>
                  <div>Status: {engineFacilitationDiagnostics.status}</div>
                  <div>Content-Type: {engineFacilitationDiagnostics.contentType}</div>
                  {engineFacilitationDiagnostics.json ? (
                    <pre>{JSON.stringify(engineFacilitationDiagnostics.json, null, 2)}</pre>
                  ) : (
                    <pre>
                      NON-JSON: {engineFacilitationDiagnostics.parseError || 'Unknown error'}
                      {'\n'}
                      {engineFacilitationDiagnostics.raw}
                    </pre>
                  )}
                </div>
              )}
              {import.meta.env.VITE_DEBUG_ENGINE === '1' && engineApiDebug && (
                <div className="engine-debug-panel">
                  <div>Endpoint: {engineApiDebug.endpoint}</div>
                  <div>Status: {engineApiDebug.status}</div>
                  <pre>{JSON.stringify(engineApiDebug.response, null, 2)}</pre>
                </div>
              )}
              <div className="engine-board-input">
                <textarea
                  data-testid="engine-input"
                  ref={engineInputRef}
                  value={enginePreviewInput}
                  onChange={(event) => {
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
                <div className="engine-input-footer">
                <span className="engine-word-count">
                  {isEngineWordLimitReached
                    ? copy.engineWordLimitReached
                    : copy.engineWordCountRemaining(engineRemainingWords)}
                </span>
                <button
                  type="button"
                  className="primary"
                  data-testid="add-entry"
                  onClick={() => {
                    markUserInitiatedInteraction('pointer')
                    setEngineLastInputActivityAt(Date.now())
                    setEngineInputFocused(true)
                    engineAllowIdleWithoutFocusRef.current = true
                    armIdleWatch('add_item')
                    engineInputRef.current?.focus()
                    void handleEnginePreviewAdd()
                  }}
                  disabled={!enginePreviewInput.trim()}
                >
                  {copy.enginePreviewAddItem}
                </button>
                </div>
              </div>
              <ul className="engine-entry-list">
                {enginePreviewItems.length === 0 && (
                  <li className="engine-empty">{copy.enginePreviewBoardItemsEmpty}</li>
                )}
                {orderedEnginePreviewItems.map((item) => (
                  <li
                    key={item.id}
                    className="engine-entry"
                    data-testid={`entry-row-${item.id}`}
                    onClick={() =>
                      setEngineLabelEditorId((prev) => (prev === item.id ? null : item.id))
                    }
                    onMouseMove={(event) => {
                      setEngineEntryHint({
                        x: event.clientX + 12,
                        y: event.clientY + 12,
                        visible: true,
                      })
                    }}
                    onMouseLeave={() =>
                      setEngineEntryHint((prev) => ({ ...prev, visible: false }))
                    }
                  >
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
                              onClick={saveEnginePreviewEdit}
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
                      <div className="engine-entry-label-group">
                        <button
                          type="button"
                          className="engine-entry-delete-button engine-entry-action"
                          aria-label={copy.engineEntryDeleteLabel}
                          title={copy.engineEntryDeleteLabel}
                          onClick={(event) => {
                            event.stopPropagation()
                            setEngineEntryDeleteId(item.id)
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
                          className="engine-entry-edit-button engine-entry-action"
                          aria-label={copy.editIdeaTitle}
                          onClick={(event) => {
                            event.stopPropagation()
                            startEnginePreviewEdit(item)
                          }}
                        >
                          ✎
                        </button>
                        {item.label && (
                          <span
                            className="engine-entry-label"
                            data-testid={`entry-label-${item.id}`}
                            style={{
                              backgroundColor:
                                ENGINE_ENTRY_LABEL_COLORS[item.label] || '#e7ebf0',
                              color: '#000000',
                            }}
                          >
                            {uiLanguage === 'English'
                              ? ENGINE_ENTRY_LABEL_TRANSLATIONS[item.label] || item.label
                              : item.label}
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
                            data-testid={`entry-label-select-${item.id}`}
                            value={item.label ?? ''}
                            onChange={(event) => {
                              const nextValue = event.target.value || null
                              armIdleWatch('label_change')
                              setEngineLastInputActivityAt(Date.now())
                              void updateEngineEntryLabel(item.id, nextValue)
                              setEngineLabelEditorId(null)
                            }}
                          >
                          <option value="">{copy.noLabelText}</option>
                          {ENGINE_ENTRY_LABELS.map((label) => (
                            <option key={label} value={label}>
                              {uiLanguage === 'English'
                                ? ENGINE_ENTRY_LABEL_TRANSLATIONS[label] || label
                                : label}
                            </option>
                          ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div
                className={`engine-entry-hint ${engineEntryHint.visible ? 'is-visible' : ''}`}
                style={{ left: engineEntryHint.x, top: engineEntryHint.y }}
                aria-hidden={!engineEntryHint.visible}
              >
                {copy.engineEntryLabelHint}
              </div>
            </section>
          )}
        </main>
        {feedbackPanel}
        {feedbackFab}
      </div>
    )
  }

  if (isWorkInProgress) {
    return (
      <div className="app">
        <div className="topbar-links">
          <a className="ghost topbar-link" href="/">
            Home page
          </a>
        </div>
        <div className="landing-section hero in-view">
          <div className="landing-inner">
            <a className="primary landing-cta" href="/?view=threeSteps">
              {copy.landingThreeStepsCta}
            </a>
            <a className="primary landing-cta" href="/grid">
              Grid
            </a>
            <button type="button" className="primary landing-cta">
              Watch 60-second demo
            </button>
          </div>
        </div>
        {feedbackPanel}
        {feedbackFab}
      </div>
    )
  }

  return (
    <div className="app">
      <header className={`top-bar ${showLanding ? 'landing-top' : ''}`}>
        {!showLanding && <div className="brand">{copy.appTitle}</div>}
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
        {!showLanding && (
          <button
            className="ghost llm-button"
            type="button"
            onClick={() => setLlmSettingsOpen(true)}
          >
            {copy.llmSettings}
          </button>
        )}
        <div className="topbar-links">
          {!showLanding && (
            <a className="ghost topbar-link" href="/">
              Landing page
            </a>
          )}
        </div>
        {!showLanding && activeStep !== 1 && (
          <button className="report-button" type="button" onClick={() => setReportOpen(true)}>
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
        {showLanding && landingView === 'main' && (
          <section className="landing">
            <div className="landing-section hero in-view">
              <div className="landing-inner">
                <h1>{copy.landingHeroTitle}</h1>
                <p>{copy.landingHeroSubtitle}</p>
                {uiLanguage === 'Polish' && (
                  <a
                    className="primary landing-cta"
                    href="https://youtu.be/2mLESqZKDj0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="landing-cta-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="36" height="36">
                        <path
                          fill="currentColor"
                          d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2.2l4.4 2.2a1 1 0 0 0 1.6-.8V8a1 1 0 0 0-1.6-.8L15 9.4V8a2 2 0 0 0-2-2H4z"
                        />
                      </svg>
                    </span>
                    Zobacz jak to działa (90 s)
                  </a>
                )}
                {uiLanguage === 'English' && (
                  <a
                    className="primary landing-cta"
                    href="https://youtu.be/0OBBZfOAltU"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="landing-cta-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="36" height="36">
                        <path
                          fill="currentColor"
                          d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2.2l4.4 2.2a1 1 0 0 0 1.6-.8V8a1 1 0 0 0-1.6-.8L15 9.4V8a2 2 0 0 0-2-2H4z"
                        />
                      </svg>
                    </span>
                    Watch how it works (90 sec)
                  </a>
                )}
              </div>
            </div>

            <div className="landing-section intro">
              <div className="landing-inner">
                <div className="intro-title">
                  <span className="title-brand">{copy.landingIntroTitleLines[0]}</span>
                  <span className="title-subline">
                    {copy.landingIntroTitleLines.slice(1).join(' ').trim()}
                  </span>
                </div>
                <p className="intro-subtext">
                  <span>{copy.landingIntroSubtextLines[0]}</span>
                  <span>{copy.landingIntroSubtextLines[1]}</span>
                  <span>{copy.landingIntroSubtextLines[2]}</span>
                  <span>
                    {copy.landingIntroSubtextLines[3]
                      .split('{emphasis}')
                      .map((part, index) =>
                        index === 0 ? (
                          part
                        ) : (
                          <span key={`emphasis-${index}`}>
                            <strong>{copy.landingIntroSubtextEmphasis}</strong>
                            {part}
                          </span>
                        )
                      )}
                  </span>
                </p>
                <div className="intro-cta">
                  <a className="primary landing-cta" href="/engine">
                    {copy.landingCta}
                  </a>
                  {uiLanguage === 'English' && (
                    <div className="landing-microcopy">
                      Sign up in 30 seconds • No credit card required
                    </div>
                  )}
                  {uiLanguage === 'Polish' && (
                    <div className="landing-microcopy">rejestracja w 30 s • bez karty</div>
                  )}
                </div>
              </div>
            </div>

            <div className="landing-section before">
              <div className="landing-inner">
                <p className="before-lead">
                  {copy.landingBeforeLead}
                </p>
                <ul className="icon-list negative">
                  {copy.landingBeforeList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="landing-emphasis">
                  <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                  <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                  {copy.landingBeforeEmphasis.rest}
                </div>
              </div>
            </div>

            <div className="landing-section after">
              <div className="landing-inner">
                <p className="before-lead">{copy.landingAfterLead}</p>
                <ul className="icon-list positive">
                  {copy.landingAfterList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="landing-section why">
              <div className="landing-inner">
                <p className="before-lead why-lead">
                  <span>{copy.landingWhyLead.split('. ')[0]}.</span>
                  <span>{copy.landingWhyLead.split('. ')[1]}</span>
                </p>
                <div className="stacked-lines">
                  <span className="stacked-brand">{copy.landingWhyLines[0]}</span>
                  {copy.landingWhyLines.slice(1).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="landing-section who">
              <div className="landing-inner">
                <h2>{copy.landingWhoTitle}</h2>
                <ul className="icon-list neutral">
                  {copy.landingWhoList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="landing-final">
                  <p>{copy.landingFinalLines[0]}</p>
                  <p className="final-shift">{copy.landingFinalLines[1]}</p>
                  <a className="primary landing-cta" href="/engine">
                    {copy.landingCta}
                  </a>
                  {uiLanguage === 'English' && (
                    <div className="landing-microcopy">
                      Sign up in 30 seconds • No credit card required
                    </div>
                  )}
                  {uiLanguage === 'Polish' && (
                    <div className="landing-microcopy">rejestracja w 30 s • bez karty</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
        {showLanding && landingView === 'threeSteps' && (
          <section className="landing">
            <div className="landing-section hero in-view">
              <div className="landing-inner">
                <div className="three-steps-title">{copy.landingThreeStepsTitle}</div>
                <h1>{copy.landingHeroTitle}</h1>
                <p>{copy.landingHeroSubtitle}</p>
                <button type="button" className="ghost landing-back" onClick={openMainLanding}>
                  ← Back to full page
                </button>
              </div>
            </div>

            <div className="landing-section intro">
              <div className="landing-inner">
                <div className="intro-title">
                  <span className="title-brand">{copy.landingIntroTitleLines[0]}</span>
                  <span className="title-subline">
                    {copy.landingIntroTitleLines.slice(1).join(' ').trim()}
                  </span>
                </div>
                <p className="intro-subtext">
                  <span>{copy.landingIntroSubtextLines[0]}</span>
                  <span>{copy.landingIntroSubtextLines[1]}</span>
                  <span>{copy.landingIntroSubtextLines[2]}</span>
                  <span>
                    {copy.landingIntroSubtextLines[3]
                      .split('{emphasis}')
                      .map((part, index) =>
                        index === 0 ? (
                          part
                        ) : (
                          <span key={`emphasis-three-${index}`}>
                            <strong>{copy.landingIntroSubtextEmphasis}</strong>
                            {part}
                          </span>
                        )
                      )}
                  </span>
                </p>
                <a className="primary landing-cta" href="/engine">
                  {copy.landingCta}
                </a>
              </div>
            </div>

            <div className="landing-section before">
              <div className="landing-inner">
                <p className="before-lead">{copy.landingBeforeLead}</p>
                <ul className="icon-list negative">
                  {copy.landingBeforeList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="landing-emphasis">
                  <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                  <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                  {copy.landingBeforeEmphasis.rest}
                </div>
              </div>
            </div>
          </section>
        )}
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
                <button type="button" className="primary" onClick={() => void requestImpulse()}>
                  {copy.impulseButtonLabel}
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
                  style={{ backgroundColor: `${label.color}4D` }}
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
                onChange={(event) => setReportLanguage(event.target.value as Language)}
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
              <button type="button" className="secondary" onClick={() => setReportOpen(true)}>
                {copy.openReportPanel}
              </button>
              <button type="button" className="primary" disabled>
                {copy.nextStepCompleted}
              </button>
            </div>
          </section>
        )}
      </main>
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
                        ? { backgroundColor: color, borderColor: color }
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
                      backgroundColor: `${label.color}4D`,
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
              <p>{impulseQuestion || copy.impulseEmpty}</p>
            </div>
          </div>
        </div>
      )}

      {reportOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{copy.reportSnapshotTitle}</h2>
              <button type="button" className="ghost" onClick={() => setReportOpen(false)}>
                {copy.close}
              </button>
            </div>
            <div className="modal-body">
              <div className="field-group">
                <label htmlFor="report-language-modal">{copy.reportLanguageLabel}</label>
                <select
                  id="report-language-modal"
                  value={reportLanguage}
                  onChange={(event) => setReportLanguage(event.target.value as Language)}
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
                      style={{ backgroundColor: `${label.color}4D` }}
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
                        ? { backgroundColor: color, borderColor: color }
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
                      backgroundColor: `${label.color}4D`,
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
                  disabled={!llmEnabled}
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
                  disabled={!llmEnabled}
                >
                  {copy.llmSettingsSave}
                </button>
                {llmSaved && <span className="muted">{copy.llmSettingsSaved}</span>}
              </div>
              <div className="actions llm-toggle">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setLlmEnabled(true)
                    localStorage.setItem('llm_enabled', 'true')
                    void checkLlmStatus(normalizeApiBase(llmApiBase))
                  }}
                  disabled={llmEnabled}
                >
                  {copy.llmEnableConnection}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setLlmEnabled(false)
                    localStorage.setItem('llm_enabled', 'false')
                    setLlmStatus('offline')
                  }}
                  disabled={!llmEnabled}
                >
                  {copy.llmDisableConnection}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {feedbackPanel}
      {feedbackFab}
    </div>
  )
}

export default App
