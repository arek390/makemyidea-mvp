import type { Engine2Copy } from '../engine2/Engine2Page'
import {
  blogArticleAiWeekendEn,
  blogArticleAiWeekendPl,
  blogArticleNeedBetterQuestionsEn,
  blogArticleNeedBetterQuestionsPl,
  blogArticleSalesPitchEn,
  blogArticleSalesPitchPl,
} from './blog'

export type Language = 'English' | 'Polish'
export type BlogId = 'blog-1' | 'blog-2' | 'blog-3'
type StepId = 1 | 2 | 3 | 4

export type BlogArticleTextSegment = {
  text: string
  strong?: boolean
  emphasis?: boolean
}

export type BlogArticleBlock =
  | { type: 'paragraph'; content: BlogArticleTextSegment[] }
  | {
      type: 'list'
      items: BlogArticleTextSegment[][]
      level?: number
      ordered?: boolean
      start?: number
    }
  | { type: 'lineGroup'; lines: BlogArticleTextSegment[][] }
  | { type: 'divider' }
  | { type: 'section'; className: string; blocks: BlogArticleBlock[] }
  | {
      type: 'qaList'
      pairs: { question: BlogArticleTextSegment[]; answer: BlogArticleTextSegment[] }[]
    }

export type BlogArticleContent = string | BlogArticleBlock[]
export type BlogItem = { title: string; description: string; slug: string; article: BlogArticleContent }

export type Translations = {
  stepLabel: string
  appTitle: string
  landingHeroTitle: string
  landingHeroSubtitle: string
  landingHeroBullets: string[]
  landingHeroTryWithoutSignupCta: string
  landingHeroTryWithoutSignupNote: string
  engine2: Engine2Copy
  landingIntroTitleLines: string[]
  landingIntroSubtextLines: string[]
  landingIntroSubtextEmphasis: string
  landingIntroCtaNoteLines: string[]
  landingCta: string
  landingLoginCta: string
  landingCtaNote: string
  landingExamplesCta: string
  landingThreeStepsCta: string
  landingThreeStepsTitle: string
  landingBackToFull: string
  landingBeforeLead: string
  landingBeforeList: string[]
  landingBeforeEmphasis: { strong: string; medium: string; rest: string }
  landingAfterLead: string
  landingAfterList: string[]
  landingWhyLead: string
  landingWhyLines: string[]
  landingHowTitle: string
  landingHowSteps: { title: string; lines: string[] }[]
  landingHowLines: string[]
  landingWhoTitle: string
  landingWhoList: string[]
  landingFinalLines: [string, string]
  landingPrivacyTitle: string
  landingTermsTitle: string
  landingContactTitle: string
  landingBlogTitle: string
  landingPrivacyBody: string
  landingPrivacyLink: string
  examplesBackHome: string
  examplesTitle: string
  examplesDescription: string
  examplesItems: { title: string; description: string }[]
  examplesSectionInitialInput: string
  examplesSectionGeneratedReport: string
  examplesSectionActionPlan: string
  examplesPlaceholder: string
  blogTitle: string
  blogDescription: string
  blogItems: BlogItem[]
  workInProgressLink: string
  impulseButtonLabel: string
  impulseTitle: string
  impulseEmpty: string
  impulseClose: string
  impulseSourceFallback: string
  impulseSourceAi: string
  impulseSourceAiGenerated: string
  impulseSourceDeterministic: string
  report: string
  llmSettings: string
  languageLabel: string
  engine: {
  saveSession: string
  newSession: string
    saveSuccess: string
    saveRequiresAuth: string
    saveMissingSession: string
    saveFailed: string
  }
  auth: {
    logout: string
    logoutFailed: string
    loginStartFailed: string
  }
  authCallback: {
    invalidLink: string
    missingCode: string
    signInFailed: string
    backToApp: string
    redirectHint: string
    tryAgain: string
    tryAgainCta: string
    oauthOriginMismatch: string
    pkceMismatch: string
    pkceMissing: string
    expired: string
    redirectMismatch: string
    unknownError: string
    returnToLogin: string
    sendLinkAgain: string
    goHome: string
  }
  loginTitle: string
  loginSubtitle: string
  loginSessionHelper: string
  topupTitle: string
  topupSubtitle: string
  topupConfig: {
    amounts: [string, string, string]
    currency: string
    captions: [[string, string], [string, string], [string, string]]
    footer: string
  }
  topupReturnLabel: string
  loginContinue: string
  loginGoogleLabel: string
  loginGoogleCta: string
  loginGoogleLoading: string
  loginEmailLabel: string
  loginEmailPlaceholder: string
  loginEmailCta: string
  loginEmailSending: string
  loginEmailCooldown: (seconds: number) => string
  loginPasswordToggleLabel: string
  loginPasswordPlaceholder: string
  loginPasswordSignIn: string
  loginPasswordSignUp: string
  loginGuestLabel: string
  loginGuestCta: string
  loginGuestActive: string
  loginNoticeSent: string
  loginNoticeSignup: string
  loginEmailError: string
  loginCallbackTitle: string
  loginGuestMergePrompt: string
  loginGuestMergeYes: string
  loginGuestMergeNo: string
  loginGuestMergeLoading: string
  loginDevSmtpNotice: string
  loginDevResetAuth: string
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
  enginePreviewOpenReport: string
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
  enginePreviewCreateReport: string
  enginePreviewBoardItemsTitle: string
  engineEntryLabelHint: string
  engineEntryEditHint: string
  engineEntryDeleteHint: string
  engineEntryLabelActionHint: string
  engineEntryQuestionHint: string
  engineEntryQuestionFallback: string
  engineSectionAddEntryHint: string
  engineSectionAddEntryAria: (sectionTitle: string) => string
  engineDraftRemoveEntry: string
  feedbackButtonLabel: string
  feedbackTitle: string
  feedbackMessageLabel: string
  feedbackMessagePlaceholder: string
  feedbackSend: string
  feedbackSent: string
  feedbackPrivacyNote: string
  feedbackReminderText: string
  feedbackReminderSend: string
  feedbackReminderDismiss: string
  missingLabelModalTitle: string
  missingLabelModalBody: (count: number) => string
  missingLabelPrimary: string
  missingLabelSecondary: string
  missingLabelHint: string
  missingLabelBadge: string
  missingLabelComplete: string
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
  engineFacilitationAsIs: string
  engineFacilitationProblem: string
  engineFacilitationDesired: string
  engineFacilitationLoadingLabel: string
  engineFacilitationRetryMessage: string
  engineFacilitationRetryCta: string
  engineFacilitationLoadingPerspective: string
  engineFacilitationLoadingDeepen: string
  engineNamePrompt: string
  engineNameLabel: string
  engineNamePlaceholder: string
  engineNameSave: string
  engineInitialBriefTitle: string
  engineInitialBriefDescription: string
  engineInitialBriefPlaceholder: string
  engineInitialBriefSubmit: string
  engineInitialBriefSubmitting: string
  engineInitialBriefNeedsMoreInfo: string
  engineInitialBriefWordCountRemaining: (count: number) => string
  engineInitialBriefWordLimitReached: string
  engineInitialBriefLengthIntro: string
  engineInitialBriefLengthTarget: string
  engineInitialBriefLengthCount: (count: number, target: number) => string
  engineInitialBriefLengthLow: string
  engineInitialBriefLengthUseful: string
  engineInitialBriefLengthStrong: string
  engineInitialBriefLengthEnough: string
  engineInitialBriefLengthContinue: string
  engineInitialBriefEmpty: string
  engineInitialBriefTooLong: string
  engineInitialBriefFailed: string
  engineInitialBriefSuggestFailed: string
  engineInitialBriefSaveFailed: string
  engineInitialBriefPartialSaveFailed: (savedCount: number, failedCount: number) => string
  engineInitialBriefVoiceInputLabel: string
  engineInitialBriefVoiceInputListening: string
  engineInitialBriefVoiceInputUnavailable: string
  engineInitialBriefVoiceInputError: string
  engineWordCountRemaining: (count: number) => string
  engineQuestionsWipNote: string
  enginePlaceholderInitial: string
  enginePlaceholderContinue: string
  engineWordLimitReached: string
  openReportPanel: string
  reportSnapshotTitle: string
  reportTitle: string
  reportPrint: string
  reportDownloadPdf: string
  reportExportCsv: string
  reportCoverTitle: string
  reportTocTitle: string
  reportSessionGoalTitle: string
  reportExecutiveSummaryTitle: string
  reportPerspectiveMapTitle: string
  reportCollectedResponsesTitle: string
  reportQuestionsTableTitle: string
  reportIdeasTableTitle: string
  reportResponsesTableTitle: string
  reportInsightsTitle: string
  reportRecommendationsTitle: string
  reportAppendicesTitle: string
  reportNotProvided: string
  reportNoData: string
  reportSessionMetaTitle: string
  reportExportLinksTitle: string
  reportAuthorLabel: string
  reportParticipantsLabel: string
  reportDateRangeLabel: string
  reportSessionNameLabel: string
  reportQuestionsLabel: string
  reportIdeasLabel: string
  reportCellsVisitedLabel: string
  reportDuplicatesLabel: string
  reportKeywordsTitle: string
  reportPerspectiveVisited: string
  reportPerspectiveQuestions: string
  reportQuestionIdLabel: string
  reportQuestionTextLabel: string
  reportQuestionSourceLabel: string
  reportQuestionCellLabel: string
  reportIdeaIdLabel: string
  reportIdeaTextLabel: string
  reportIdeaTagsLabel: string
  reportIdeaCreatedLabel: string
  reportAnswerQuestionLabel: string
  reportAnswerTextLabel: string
  reportAnswerCreatedLabel: string
  reportRecommendationExpandIdeas: string
  reportRecommendationExplorePerspectives: string
  reportRecommendationDeduplicate: string
  reportRecommendationPrioritize: string
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
  debugMatrixUnavailable: string
  debugMatrixMissingSession: string
  debugMatrixLoadError: string
  llmSettingsTitle: string
  llmSettingsIntro: string
  llmApiBaseLabel: string
  llmApiBasePlaceholder: string
  llmSettingsSave: string
  llmSettingsSaved: string
  llmSettingsCostNote: string
  llmUsageIndicatorLabel: string
  llmCostLabel: (usd: string) => string
  llmCostPlnLabel: (pln: string) => string
  llmCostPlnFallback: string
  llmCostBreakdown: string
  llmCostTotalTokens: (tokens: string) => string
  llmCostTotalUsd: (usd: string) => string
  llmCostTotalPln: (pln: string) => string
  llmCostTotalPlnFallback: string
  llmCostModelRow: (model: string, input: string, output: string, usd: string) => string
  diagnosticsAuthLabel: string
  adminNavLabel: string
  insufficientBalanceNotice: string
  llmStatusOnline: string
  llmStatusOffline: string
  llmStatusUnknown: string
  llmTestConnection: string
  llmEnableConnection: string
  llmDisableConnection: string
  aiSupportOn: string
  aiSupportOff: string
  diagnosticsOn: string
  diagnosticsOff: string
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

export type CreateTranslationsParams = {
  canonicalDisplayHost: string
  blogArticleSlugs: Record<Language, Record<BlogId, string>>
}

export function createTranslationResolver({
  canonicalDisplayHost,
  blogArticleSlugs,
}: CreateTranslationsParams) {
  const translations: Partial<Record<Language, Partial<Translations>>> & { Polish: Translations } = {
    English: {
      stepLabel: 'Step',
      appTitle: 'Idea Clarity Grid',
      landingHeroTitle: 'Have an idea? Make it stronger.',
      landingHeroSubtitle: 'Explore it, challenge it and turn it into an actionable concept.',
      landingHeroBullets: [
        '🎤 Describe your situation',
        '🧠 Identify key unknowns and assumptions',
        '⚖️ Compare possible paths forward',
        '📍 Get a structured action plan',
      ],
      landingHeroTryWithoutSignupCta: 'Try it without signing up',
      landingHeroTryWithoutSignupNote: 'No credit card. No account needed. About 5 minutes.',
      engine2: {
        pageLabel: 'Public conversation workspace',
        conversationTitle: 'Let’s understand what you’re working on',
        resetConversationButton: 'Start new conversation',
        initialAssistantMessage:
          'Describe the situation, problem or idea as you understand it today. You don’t need to prepare a complete description or meet any length requirement. Start with what you already know — I’ll ask about anything else we may need.',
        initialAssistantHint: 'Start with what you already know. We’ll organize the rest together.',
        inputPlaceholder: 'Describe what you’re working on...',
        inputAriaLabel: 'Describe what you’re working on',
        sendButton: 'Send',
        sendingButton: 'Analyzing your answer…',
        findingsTitle: 'Conversation map',
        pendingFindingsTitle: 'To confirm',
        knowledgeTitle: 'What we know',
        confirmedFindingsTitle: 'Confirmed',
        knowledgeEmpty: 'After you confirm the first findings, the most important information will appear here.',
        knowledgeShowMoreAction: 'Show more',
        knowledgeShowLessAction: 'Show less',
        openQuestionsTitle: 'What is still worth clarifying',
        openQuestionsEmpty: 'No urgent open questions stand out right now.',
        openQuestionsWaiting:
          'Review the current proposals first. Then I will point to the next questions worth clarifying.',
        openQuestionsAnswerAction: 'Answer',
        selectedQuestionPrefix: 'You are answering:',
        answeredQuestionPrefix: 'Reply to:',
        clearSelectedQuestionAction: 'Cancel',
        pendingReviewMessage:
          'Check whether I understood you correctly. Accept, edit, or reject each proposal, then we’ll move on.',
        pendingReviewBadge: 'Needs review',
        blockedSendMessage:
          'Review the current proposals first. They will not be used as facts until you accept or edit them.',
        confirmAllAction: 'Confirm all',
        rejectAllAction: 'Reject all',
        retryAnalysisAction: 'Retry analysis',
        retryQuestionGenerationAction: 'Retry question generation',
        progressLabel: 'Readiness',
        reportReadyTitle: 'Ready for the next step',
        reportReadyBody:
          'The confirmed findings are strong enough to prepare a report, but report generation is not enabled in this public trial yet.',
        reportCtaDisabled: 'Report generation comes later',
        trialEndedTitle: 'Public trial limit reached',
        trialEndedBody:
          'This trial has reached the AI response limit. Your work remains in this browser tab.',
        errorMessage: 'Something went wrong. Please try again.',
        adminUsageTitle: 'Trial AI usage',
        adminLastCall: 'Last call',
        adminTotal: 'Total',
        adminModel: 'model',
        adminTokens: 'tokens in/out',
        adminCost: 'cost',
        findingCard: {
          confirmedStatus: 'Confirmed',
          acceptAction: 'That’s right',
          editAction: 'Edit',
          rejectAction: 'Reject',
          saveAction: 'Save as confirmed',
          cancelAction: 'Cancel',
          editInputAriaLabel: 'Edit finding content',
        },
      },
      landingIntroTitleLines: [
        canonicalDisplayHost,
        'guides you from describing the situation',
        'to decisions and a clear action plan',
        'step by step.',
      ],
      landingIntroSubtextLines: [
        '',
        '',
        '',
        '',
      ],
      landingIntroSubtextEmphasis: 'you',
      landingIntroCtaNoteLines: [
        'No signup required. No subscription.',
        '',
      ],
      landingCta: 'Start your first session free.',
      landingLoginCta: 'Log in',
      landingCtaNote: 'No signup required. No subscription.',
      landingExamplesCta: 'See example action plans',
      landingThreeStepsCta: 'Start in 3 steps',
      landingThreeStepsTitle: '3 steps',
      landingBackToFull: '← Back to full page',
      landingBeforeLead: "Most projects don't get stuck because of a lack of ideas.\nThey get stuck because:",
      landingBeforeList: [
        '• the problem isn’t clearly defined',
        '• key assumptions haven’t been validated',
        '• no one knows what to do next',
        '',
        '❌ Unclear problem',
        '❌ Unvalidated assumptions',
        '❌ No action plan',
        '',
        'Sound familiar?',
      ],
      landingBeforeEmphasis: {
        strong: '',
        medium: '',
        rest: '',
      },
      landingAfterLead:
        "It's not a lack of ideas.\nMaking good decisions is difficult when information is incomplete, priorities are unclear, and the next steps are unknown.",
      landingAfterList: [
        'Instead of starting with a blank page, you follow a structured process:',
        '✅ Your situation is transformed into clear observations.\nYou see what works and what needs attention.',
        '✅ Key unknowns, assumptions, and contradictions become visible.\nEvaluating possible directions becomes easier.',
        '✅ You end up with a structured action plan, ready for discussion and execution.',
        '',
        'No guessing. No chaos.',
      ],
      landingWhyLead: "We don't provide ready-made answers.\nWe help you make better decisions.",
      landingWhyLines: [
        canonicalDisplayHost,
        'guides you through the process step by step',
        'helps uncover key unknowns',
        'organizes information in real time',
        'doesn\'t let difficult decisions be avoided',
        'AI assists.',
        'Humans decide.',
      ],
      landingHowTitle: 'How does it work?',
      landingHowSteps: [],
      landingHowLines: [
        'Describe your situation.',
        'Answer a few guided questions.',
        'Choose the best direction forward.',
        'Get an action plan.',
      ],
      landingWhoTitle: 'Who is it for?',
      landingWhoList: [
        '🛠️ You have a problem that needs solving',
        '🚀 You have an idea you want to develop',
        "🤝 You've received a new customer requirement",
        '📊 You need to make a decision with limited information',
        '⏱️ You need an action plan faster than another meeting',
      ],
      landingFinalLines: ["You don't need a perfect idea.", 'You need a process that leads to a decision.'],
      landingPrivacyTitle: 'Privacy Policy',
      landingTermsTitle: 'Terms and Conditions',
      landingContactTitle: 'Contact',
      landingBlogTitle: 'Read the blog',
      landingPrivacyBody:
        'We process account, session, board, report and AI usage data only to operate the product, paid features and admin diagnostics.',
      landingPrivacyLink: 'Read the full privacy policy',
      examplesBackHome: 'Back to home',
      examplesTitle: 'Example Action Plans',
      examplesDescription:
        'See how an initial idea can be transformed into a structured report and action plan.',
      examplesItems: [
        { title: 'Example 1', description: 'Smart product concept' },
        { title: 'Example 2', description: 'Service improvement' },
        { title: 'Example 3', description: 'Team decision process' },
      ],
      examplesSectionInitialInput: 'Initial input',
      examplesSectionGeneratedReport: 'Generated report',
      examplesSectionActionPlan: 'Action plan',
      examplesPlaceholder: 'Content will be added here.',
      blogTitle: 'Blog',
      blogDescription: 'Articles related to the MakeMyIdea.com application.',
      blogItems: [
        {
          title: 'You don’t need more ideas. You need better questions.',
          description:
            '“We need a few concepts, an action plan, and answers for the client. Preferably by tomorrow.” Sound familiar? This is everyday life for many engineering teams. The problem is that decisions have to be made with incomplete data and under time pressure. See how facilitation and AI can help you move from uncertainty to a concrete action plan.',
          slug: blogArticleSlugs.English['blog-1'],
          article: blogArticleNeedBetterQuestionsEn,
        },
        {
          title: 'From Sales Pitch to Action Plan in 15 Minutes',
          description:
            'Most people start by looking for ideas. Yet every good idea begins with a clearly defined need. What should you do if a client is looking for a solution that your company has never produced before, and you need to come up with a response by the end of the day? This article shows you how to move from a description of the problem to a concrete action plan – before the first solution is even developed.',
          slug: blogArticleSlugs.English['blog-2'],
          article: blogArticleSalesPitchEn,
        },
        {
          title: 'Can AI Save Your Weekend?',
          description:
            'Friday, 2:00 p.m. Your boss asks for an action plan for a project that doesn’t exist yet. The material is due at the board meeting on Monday morning. You’re short on time, information, and ready-made answers. How can you prepare a sensible plan without sacrificing your entire weekend? This example shows how to combine a project manager’s experience with the capabilities of AI to create a starting point for further decisions in just a few minutes.',
          slug: blogArticleSlugs.English['blog-3'],
          article: blogArticleAiWeekendEn,
        },
      ],
      workInProgressLink: 'Work in progress',
      impulseButtonLabel: 'Give me an impulse',
      impulseTitle: 'Suggested question',
      impulseEmpty: 'No question available yet.',
      impulseClose: 'Close',
      impulseSourceFallback: 'Offline mode (fallback)',
      impulseSourceAi: 'AI',
      impulseSourceAiGenerated: 'AI generated',
      impulseSourceDeterministic: 'Deterministic fallback',
      report: 'Action plan',
      llmSettings: 'LLM settings',
      languageLabel: 'LANGUAGE',
      engine: {
      saveSession: 'Save session',
      newSession: 'New session',
        saveSuccess: 'Saved',
        saveRequiresAuth: 'Log in to save sessions.',
        saveMissingSession: 'Start a session before saving.',
        saveFailed: 'Save failed.',
      },
      auth: {
        logout: 'Log out',
        logoutFailed: 'Log out failed.',
        loginStartFailed: 'Unable to start login. Please try again.',
      },
      authCallback: {
        invalidLink: 'Invalid or expired login link. Please request a new one.',
        missingCode: 'Sign-in failed. Please try again.',
        signInFailed: 'Sign-in did not complete. Please try again.',
        backToApp: 'Back to app',
        redirectHint:
          'Check Supabase Auth Redirect URLs + Google OAuth origins/redirect.',
        tryAgain: 'Try again.',
        tryAgainCta: 'Try again',
        oauthOriginMismatch:
          'Please complete sign-in on the same address (localhost vs 127.0.0.1).',
        pkceMismatch:
          'This login link was opened on a different site or browser. Please open it in the same browser and device where you started login.',
        pkceMissing: 'Invalid or expired login link. Please request a new one.',
        expired: 'This login link has expired. Please request a new one.',
        redirectMismatch: 'Login link redirect mismatch. Please request a new link.',
        unknownError: 'Unable to sign you in. Please try again.',
        returnToLogin: 'Return to login',
        sendLinkAgain: 'Send login link again',
        goHome: 'Go to homepage',
      },
      loginTitle: 'Login',
      loginSubtitle: 'Sign in to continue.',
      loginSessionHelper:
        'We save your sessions and action plans so you can come back to them later.',
      topupTitle: 'Top up your service balance with obligation to pay',
      topupSubtitle: '',
      topupConfig: {
        amounts: ['20', '50', '100'],
        currency: 'PLN',
        captions: [
          ['1 report', '+ iterations'],
          ['full session on', 'a single product'],
          ['multiple concepts', 'or team work'],
        ],
        footer: 'Credits are used flexibly — you only pay for report generation and updates.',
      },
      topupReturnLabel: 'Return to the previous page',
      loginContinue: 'Continue',
      loginGoogleLabel: 'Google',
      loginGoogleCta: 'Continue with Google',
      loginGoogleLoading: 'Connecting...',
      loginEmailLabel: 'Email',
      loginEmailPlaceholder: 'you@company.com',
      loginEmailCta: 'Email me a login link',
      loginEmailSending: 'Sending...',
      loginEmailCooldown: (seconds) => `Wait ${seconds}s`,
      loginPasswordToggleLabel: 'Email + password (dev)',
      loginPasswordPlaceholder: 'password',
      loginPasswordSignIn: 'Sign in',
      loginPasswordSignUp: 'Sign up',
      loginGuestLabel: 'Guest',
      loginGuestCta: 'Try as guest',
      loginGuestActive: 'In guest mode — data is stored locally.',
      loginNoticeSent: 'Check your email for the login link.',
      loginNoticeSignup:
        'Account created. If email confirmation is required, check your inbox.',
      loginEmailError: 'Enter a valid email.',
      loginCallbackTitle: 'Signing you in...',
      loginGuestMergePrompt: 'We found work from your guest session. Import it?',
      loginGuestMergeYes: 'Yes, import',
      loginGuestMergeNo: 'No, discard',
      loginGuestMergeLoading: 'Importing...',
      loginDevSmtpNotice:
        "Can't find the email? Check spam, try again, or use Google.",
      loginDevResetAuth: 'Reset auth (dev)',
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
      axisFuture: 'How should it be?',
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
        'Report language follows the app language selected on the landing page.',
      enginePreviewOpenReport: 'Go to action plan',
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
      enginePreviewCreateReport: 'Analyze entries and build an action plan',
      enginePreviewBoardItemsTitle: 'Idea Studio',
      engineEntryLabelHint: 'Click to add or change label',
      engineEntryEditHint: 'Edit',
      engineEntryDeleteHint: 'Delete',
      engineEntryLabelActionHint: 'Label',
      engineEntryQuestionHint: 'Show source question',
      engineEntryQuestionFallback: 'This entry was created without a facilitation question.',
      engineSectionAddEntryHint: 'Add item to this section',
      engineSectionAddEntryAria: (sectionTitle) => `Add item to ${sectionTitle}`,
      engineDraftRemoveEntry: 'Remove item',
      feedbackButtonLabel: 'Feedback',
      feedbackTitle: 'Feedback',
      feedbackMessageLabel: 'Your feedback',
      feedbackMessagePlaceholder: 'Tell us what worked, what was hard, what to improve…',
      feedbackSend: 'Send feedback by email',
      feedbackSent: 'Thanks! Your feedback has been sent.',
      feedbackPrivacyNote: 'Do not include sensitive data.',
      feedbackReminderText:
        'If you have a moment, please send feedback from this session — it really helps us improve.',
      feedbackReminderSend: 'Send feedback via email',
      feedbackReminderDismiss: 'Dismiss',
      missingLabelModalTitle: 'Some notes are missing labels',
      missingLabelModalBody: (count) =>
        `You have ${count} note(s) without a label (idea/risk/question, etc.). Add labels now? It will make your report clearer.`,
      missingLabelPrimary: "Yes, I’ll label them now",
      missingLabelSecondary: 'No, go to report',
      missingLabelHint: 'Click the label dropdown and choose a category.',
      missingLabelBadge: 'Missing label',
      missingLabelComplete: 'All set — you can go to the report.',
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
      engineSessionDetailsBoardTitle: 'Idea Studio',
      engineSessionDetailsBoardEmpty: 'No items.',
      engineFacilitationNote: 'Answer a focused question to move forward',
      engineFacilitationNext: 'Next question',
      engineFacilitationAsIs: 'How is it now?',
      engineFacilitationProblem: "What doesn't work?",
      engineFacilitationDesired: 'How should it be?',
      engineFacilitationLoadingLabel: 'Generating question…',
      engineFacilitationRetryMessage: 'Couldn’t generate the question. Please retry.',
      engineFacilitationRetryCta: 'Retry',
      engineFacilitationLoadingPerspective: 'Choosing a question for this perspective',
      engineFacilitationLoadingDeepen: 'Choosing a question for your board',
      engineNamePrompt: 'Give this session a name so it’s easier to return to.',
      engineNameLabel: 'Session name',
      engineNamePlaceholder: 'Session name',
      engineNameSave: 'Save and continue',
      engineInitialBriefTitle: 'Describe your situation',
      engineInitialBriefDescription:
        "Write freely about what you're trying to solve, understand, improve, or decide. Include any context, requirements, observations, constraints, and open questions. I will organize the information into the first board entries for this session.",
      engineInitialBriefPlaceholder:
        'Example: Who is this for, what does not work today, what should change, what assumptions do you have, what questions are still open?',
      engineInitialBriefSubmit: 'Create first entries',
      engineInitialBriefSubmitting: 'Creating entries…',
      engineInitialBriefNeedsMoreInfo: 'We need a little more information to create the first entries.',
      engineInitialBriefWordCountRemaining: (count) => `Remaining ${count} words`,
      engineInitialBriefWordLimitReached: 'Word limit reached (1000).',
      engineInitialBriefLengthIntro: 'Context is starting to form',
      engineInitialBriefLengthTarget: 'A good start is about 200 words.',
      engineInitialBriefLengthCount: (count, target) => `You now have ${count} / ~${target} words.`,
      engineInitialBriefLengthLow: '',
      engineInitialBriefLengthUseful: 'The situation is becoming clearer',
      engineInitialBriefLengthStrong: 'Important dependencies are emerging',
      engineInitialBriefLengthEnough: 'This is a good moment for analysis',
      engineInitialBriefLengthContinue: 'You can continue or move on',
      engineInitialBriefEmpty: 'Please enter a short description first.',
      engineInitialBriefTooLong: 'The description exceeds the 1000-word limit.',
      engineInitialBriefFailed: 'Unable to create initial entries. Please try again.',
      engineInitialBriefSuggestFailed: 'Unable to analyze the brief into first entries. Please try again.',
      engineInitialBriefSaveFailed: 'The brief was analyzed, but the first entries could not be saved.',
      engineInitialBriefPartialSaveFailed: (savedCount, failedCount) =>
        `The brief was analyzed. Saved ${savedCount} entries, but ${failedCount} could not be saved.`,
      engineInitialBriefVoiceInputLabel: 'Use voice input',
      engineInitialBriefVoiceInputListening: 'Listening…',
      engineInitialBriefVoiceInputUnavailable: 'Voice input is not available in this browser.',
      engineInitialBriefVoiceInputError: 'Voice input is currently unavailable.',
      engineWordCountRemaining: (count) => `Remaining ${count} words`,
      engineQuestionsWipNote: '',
      enginePlaceholderInitial:
        'What do you know about your product, or what you don’t know yet — start however you like.',
      enginePlaceholderContinue:
        'Continue — you can clarify, add something new, or change the thread.',
      engineWordLimitReached: 'Word limit reached.',
      openReportPanel: 'Open report panel',
      reportSnapshotTitle: 'Workshop report snapshot',
      reportTitle: 'Session report',
      reportPrint: 'Print',
      reportDownloadPdf: 'Download PDF',
      reportExportCsv: 'Export data (CSV)',
      reportCoverTitle: 'Cover',
      reportTocTitle: 'Table of contents',
      reportSessionGoalTitle: 'Session goal',
      reportExecutiveSummaryTitle: 'Executive summary',
      reportPerspectiveMapTitle: 'Perspective / questions map',
      reportCollectedResponsesTitle: 'Collected responses',
      reportQuestionsTableTitle: 'Questions',
      reportIdeasTableTitle: 'Ideas',
      reportResponsesTableTitle: 'Responses',
      reportInsightsTitle: 'Insights & patterns',
      reportRecommendationsTitle: 'Recommendations / next steps',
      reportAppendicesTitle: 'Appendices',
      reportNotProvided: 'Not provided',
      reportNoData: 'No data available.',
      reportSessionMetaTitle: 'Session metadata',
      reportExportLinksTitle: 'Export links',
      reportAuthorLabel: 'Author',
      reportParticipantsLabel: 'Participants',
      reportDateRangeLabel: 'Date',
      reportSessionNameLabel: 'Session name',
      reportQuestionsLabel: 'Questions',
      reportIdeasLabel: 'Ideas',
      reportCellsVisitedLabel: 'Cells visited',
      reportDuplicatesLabel: 'Duplicates',
      reportKeywordsTitle: 'Top themes',
      reportPerspectiveVisited: 'Visited',
      reportPerspectiveQuestions: 'Questions',
      reportQuestionIdLabel: 'ID',
      reportQuestionTextLabel: 'Question',
      reportQuestionSourceLabel: 'Source',
      reportQuestionCellLabel: 'Cell',
      reportIdeaIdLabel: 'ID',
      reportIdeaTextLabel: 'Idea',
      reportIdeaTagsLabel: 'Tags',
      reportIdeaCreatedLabel: 'Created',
      reportAnswerQuestionLabel: 'Question',
      reportAnswerTextLabel: 'Answer',
      reportAnswerCreatedLabel: 'Created',
      reportRecommendationExpandIdeas: 'Expand ideas before moving to evaluation.',
      reportRecommendationExplorePerspectives: 'Explore additional perspectives in the 3×3 map.',
      reportRecommendationDeduplicate: 'Deduplicate similar ideas to reduce noise.',
      reportRecommendationPrioritize: 'Prioritize the strongest ideas and define next actions.',
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
      debugMatrixUnavailable: 'Not available.',
      debugMatrixMissingSession: 'Missing sessionId.',
      debugMatrixLoadError: 'Unable to load matrix data.',
      llmSettingsTitle: 'OpenAI server settings',
      llmSettingsIntro:
        'Connect your server to OpenAI by setting OPENAI_API_KEY and provide the API base URL.',
      llmApiBaseLabel: 'API base URL',
      llmApiBasePlaceholder: 'http://localhost:8787',
      llmSettingsSave: 'Save',
      llmSettingsSaved: 'Saved.',
      llmSettingsCostNote:
        'Using your API key will bill usage to your OpenAI account per their pricing.',
      llmUsageIndicatorLabel: 'LLM usage indicator',
      llmCostLabel: (usd) => `Cost: $${usd}`,
      llmCostPlnLabel: (pln) => `Cost (PLN): ${pln} zł`,
      llmCostPlnFallback: 'PLN: …',
      llmCostBreakdown: 'Breakdown',
      llmCostTotalTokens: (tokens) => `Total tokens: ${tokens}`,
      llmCostTotalUsd: (usd) => `Total USD: $${usd}`,
      llmCostTotalPln: (pln) => `Total PLN: ${pln} zł`,
      llmCostTotalPlnFallback: 'Total PLN: …',
      llmCostModelRow: (model, input, output, usd) =>
        `${model}: ${input} in / ${output} out · $${usd}`,
      diagnosticsAuthLabel: 'auth',
      adminNavLabel: 'Admin',
      insufficientBalanceNotice: 'Your balance is too low. Top up your service balance to continue.',
      llmStatusOnline: 'Server status: online',
      llmStatusOffline: 'Server status: offline',
      llmStatusUnknown: 'Server status: unknown',
      llmTestConnection: 'Test connection',
      llmEnableConnection: 'Enable OpenAI',
      llmDisableConnection: 'Disable OpenAI',
      aiSupportOn: 'AI support ON',
      aiSupportOff: 'AI support OFF',
      diagnosticsOn: 'Diagnostics ON',
      diagnosticsOff: 'Diagnostics OFF',
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
    Polish: {
      stepLabel: 'Krok',
      appTitle: 'Idea Clarity Grid',
      landingHeroTitle: 'Masz pomysł? Wzmocnij go.',
      landingHeroSubtitle: 'Zbadaj go, poddaj próbie i zmień w koncepcję gotową do działania.',
      landingHeroBullets: [
        '🎤 Opisz sytuację',
        '🧠 Odkryj najważniejsze niewiadome',
        '⚖️ Oceń możliwe kierunki działania',
        '📍 Otrzymaj gotowy plan kolejnych kroków',
      ],
      landingHeroTryWithoutSignupCta: 'Wypróbuj bez rejestracji',
      landingHeroTryWithoutSignupNote: 'Bez karty płatniczej. Bez zakładania konta. Około 5 minut.',
      engine2: {
        pageLabel: 'Publiczny interfejs rozmowy',
        conversationTitle: 'Zrozummy, nad czym pracujesz',
        resetConversationButton: 'Nowa rozmowa',
        initialAssistantMessage:
          'Opisz sytuację, problem lub pomysł tak, jak rozumiesz go dzisiaj. Nie musisz przygotowywać pełnego opisu ani spełniać żadnego wymogu długości. Zacznij od tego, co już wiesz — dopytam o pozostałe informacje, których możemy potrzebować.',
        initialAssistantHint: 'Zacznij od tego, co już wiesz. Resztę uporządkujemy wspólnie.',
        inputPlaceholder: 'Opisz, nad czym pracujesz...',
        inputAriaLabel: 'Opisz, nad czym pracujesz',
        sendButton: 'Wyślij',
        sendingButton: 'Analizuję odpowiedź…',
        findingsTitle: 'Mapa rozmowy',
        pendingFindingsTitle: 'Do potwierdzenia',
        knowledgeTitle: 'Co już wiemy',
        confirmedFindingsTitle: 'Potwierdzone',
        knowledgeEmpty: 'Po potwierdzeniu pierwszych ustaleń pojawią się tutaj najważniejsze informacje.',
        knowledgeShowMoreAction: 'Pokaż więcej',
        knowledgeShowLessAction: 'Pokaż mniej',
        openQuestionsTitle: 'Co warto jeszcze ustalić',
        openQuestionsEmpty: 'Na tym etapie nie widać pilnych kwestii do doprecyzowania.',
        openQuestionsWaiting:
          'Najpierw rozpatrz bieżące propozycje. Potem wskażę kolejne kwestie, które warto wyjaśnić.',
        openQuestionsAnswerAction: 'Odpowiedz',
        selectedQuestionPrefix: 'Odpowiadasz na:',
        answeredQuestionPrefix: 'Odpowiedź na:',
        clearSelectedQuestionAction: 'Anuluj',
        pendingReviewMessage:
          'Sprawdź, czy dobrze zrozumiałem Twoją wypowiedź. Zaakceptuj, popraw lub odrzuć każdą propozycję, a przejdziemy dalej.',
        pendingReviewBadge: 'Do sprawdzenia',
        blockedSendMessage:
          'Najpierw rozpatrz bieżące propozycje. Nie użyję ich jako faktów, dopóki ich nie zaakceptujesz albo nie poprawisz.',
        confirmAllAction: 'Potwierdź wszystkie',
        rejectAllAction: 'Odrzuć wszystkie',
        retryAnalysisAction: 'Ponów analizę',
        retryQuestionGenerationAction: 'Spróbuj ponownie wygenerować pytania',
        progressLabel: 'Gotowość',
        reportReadyTitle: 'Gotowe do kolejnego kroku',
        reportReadyBody:
          'Potwierdzone ustalenia wystarczają, aby przygotować raport, ale generowanie raportu nie jest jeszcze włączone w tej publicznej próbie.',
        reportCtaDisabled: 'Raport będzie w kolejnym etapie',
        trialEndedTitle: 'Limit publicznej próby osiągnięty',
        trialEndedBody:
          'Ta próba osiągnęła limit odpowiedzi AI. Twoja praca pozostaje w tej zakładce przeglądarki.',
        errorMessage: 'Coś poszło nie tak. Spróbuj ponownie.',
        adminUsageTitle: 'Użycie AI w próbie',
        adminLastCall: 'Ostatnie wywołanie',
        adminTotal: 'Łącznie',
        adminModel: 'model',
        adminTokens: 'tokeny wej./wyj.',
        adminCost: 'koszt',
        findingCard: {
          confirmedStatus: 'Ustalone',
          acceptAction: 'Zgadza się',
          editAction: 'Popraw',
          rejectAction: 'Odrzuć',
          saveAction: 'Zapisz jako ustalone',
          cancelAction: 'Anuluj',
          editInputAriaLabel: 'Edytuj treść ustalenia',
        },
      },
      landingIntroTitleLines: [
        canonicalDisplayHost,
        'prowadzi Cię od opisu sytuacji',
        'do decyzji i konkretnego planu działania',
        'krok po kroku.',
      ],
      landingIntroSubtextLines: [
        '',
        '',
        '',
        '',
      ],
      landingIntroSubtextEmphasis: 'Ciebie',
      landingIntroCtaNoteLines: [
        'Bez rejestracji. Bez subskrypcji.',
        '',
      ],
      landingCta: 'Rozpocznij pierwszą sesję za darmo.',
      landingLoginCta: 'Zaloguj',
      landingCtaNote: 'Bez rejestracji. Bez subskrypcji.',
      landingExamplesCta: 'Zobacz przykładowe plany działania',
      landingThreeStepsCta: 'Zacznij w 3 krokach',
      landingThreeStepsTitle: '3 kroki',
      landingBackToFull: '← Wróć do pełnej strony',
      landingBeforeLead: 'Większość projektów nie zatrzymuje się przez brak pomysłów.\nZatrzymują się, ponieważ:',
      landingBeforeList: [
        '• problem nie został dobrze zdefiniowany',
        '• kluczowe założenia nie zostały zweryfikowane',
        '• nikt nie wie, jaki powinien być następny krok',
        '',
        '❌ Niejasny problem',
        '❌ Niezweryfikowane założenia',
        '❌ Brak planu działania',
        '',
        'Brzmi znajomo?',
      ],
      landingBeforeEmphasis: {
        strong: '',
        medium: '',
        rest: '',
      },
      landingAfterLead:
        'To nie jest problem braku pomysłów.\nTrudno podejmować dobre decyzje, gdy brakuje informacji, jasności i kolejnych kroków.',
      landingAfterList: [
        'Zamiast zaczynać od pustej kartki, korzystasz z procesu, który prowadzi Cię krok po kroku:',
        '✅ Z opisu sytuacji powstają konkretne obserwacje.\nWidzisz, co działa, a co wymaga uwagi.',
        '✅ Kluczowe niewiadome, założenia i sprzeczności stają się widoczne.\nŁatwiej ocenić możliwe kierunki działania.',
        '✅ Na końcu otrzymujesz uporządkowany plan działania, gotowy do dalszej pracy i dyskusji.',
        '',
        'Bez zgadywania. Bez chaosu.',
      ],
      landingWhyLead: 'Nie dajemy gotowych odpowiedzi.\nPomagamy dojść do lepszych decyzji.',
      landingWhyLines: [
        canonicalDisplayHost,
        'pilnuje logiki procesu',
        'utrzymuje fokus',
        'porządkuje wiedzę w czasie rzeczywistym',
        'nie pozwala ominąć trudnych decyzji',
        'AI pomaga.',
        'Człowiek decyduje.',
      ],
      landingHowTitle: 'Jak to działa?',
      landingHowSteps: [],
      landingHowLines: [
        'Opisz sytuację.',
        'Odpowiedz na kilka pytań.',
        'Podejmij decyzje.',
        'Otrzymaj plan działania.',
      ],
      landingWhoTitle: 'Dla kogo?',
      landingWhoList: [
        '🛠️ Masz problem, który musisz rozwiązać',
        '🚀 Masz pomysł, który chcesz rozwinąć',
        '🤝 Otrzymałeś nowe wymaganie od klienta',
        '📊 Musisz podjąć decyzję przy ograniczonej ilości informacji',
        '⏱️ Potrzebujesz planu działania szybciej niż kolejnego spotkania',
      ],
      landingFinalLines: ['Nie potrzebujesz idealnego pomysłu.', 'Potrzebujesz procesu, który doprowadzi Cię do decyzji.'],
      landingPrivacyTitle: 'Polityka prywatności',
      landingTermsTitle: 'Regulamin serwisu',
      landingContactTitle: 'Kontakt',
      landingBlogTitle: 'Przeczytaj blog',
      landingPrivacyBody:
        'Aplikacja MakeMyIdea.work zbiera podstawowe dane użytkownika, takie jak adres email oraz identyfikator konta Google, wyłącznie w celu umożliwienia logowania i korzystania z aplikacji.',
      landingPrivacyLink: 'Przeczytaj pełną politykę prywatności',
      examplesBackHome: 'Wróć na stronę główną',
      examplesTitle: 'Przykładowe plany działania',
      examplesDescription:
        'Zobacz, jak pierwszy opis pomysłu może zostać przekształcony w uporządkowany raport i plan działania.',
      examplesItems: [
        { title: 'Przykład 1', description: 'Koncepcja produktu smart' },
        { title: 'Przykład 2', description: 'Usprawnienie usługi' },
        { title: 'Przykład 3', description: 'Proces decyzyjny zespołu' },
      ],
      examplesSectionInitialInput: 'Pierwszy wpis',
      examplesSectionGeneratedReport: 'Wygenerowany raport',
      examplesSectionActionPlan: 'Plan działania',
      examplesPlaceholder: 'Treść zostanie dodana tutaj.',
      blogTitle: 'Blog',
      blogDescription: 'Artykuły powiązane z tematyką aplikacji makemyidea.com.',
      blogItems: [
        {
          title: 'Nie potrzebujesz więcej pomysłów. Potrzebujesz lepszych pytań.',
          description:
            '„Potrzebujemy kilku koncepcji, planu działania i odpowiedzi dla klienta. Najlepiej na jutro.” Brzmi znajomo? To codzienność wielu zespołów inżynierskich. Problem polega na tym, że decyzje trzeba podejmować przy niepełnych danych i pod presją czasu. Zobacz, jak podejście facilitation oraz AI mogą pomóc przejść od niepewności do konkretnego planu działania.',
          slug: blogArticleSlugs.Polish['blog-1'],
          article: blogArticleNeedBetterQuestionsPl,
        },
        {
          title: 'Od rozmowy handlowej do action planu w 15 minut',
          description:
            'Większość ludzi zaczyna od szukania pomysłów. Tymczasem każdy dobry pomysł zaczyna się od dobrze opisanej potrzeby. Co zrobić, gdy klient oczekuje rozwiązania, którego firma nigdy wcześniej nie produkowała, a odpowiedź trzeba przygotować jeszcze tego samego dnia? Ten artykuł pokazuje, jak przejść od opisu problemu do konkretnego planu działania – zanim powstanie pierwsze rozwiązanie.',
          slug: blogArticleSlugs.Polish['blog-2'],
          article: blogArticleSalesPitchPl,
        },
        {
          title: 'Czy AI może uratować Twój weekend?',
          description:
            'Piątek, 14:00. Szef prosi o plan działania dla projektu, który jeszcze nie istnieje. W poniedziałek rano materiał ma trafić na spotkanie zarządu. Brakuje czasu, informacji i gotowych odpowiedzi. Jak przygotować sensowny plan bez poświęcania całego weekendu? Ten przykład pokazuje, jak połączyć doświadczenie kierownika projektu z możliwościami AI, aby w kilkanaście minut stworzyć punkt startowy do dalszych decyzji.',
          slug: blogArticleSlugs.Polish['blog-3'],
          article: blogArticleAiWeekendPl,
        },
      ],
      workInProgressLink: 'W toku',
      impulseButtonLabel: 'Daj mi impuls',
      impulseTitle: 'Sugerowane pytanie',
      impulseEmpty: 'Brak pytania na ten moment.',
      impulseClose: 'Zamknij',
      impulseSourceFallback: 'Tryb offline (wersja zapasowa)',
      impulseSourceAi: 'AI',
      impulseSourceAiGenerated: 'Wygenerowane przez AI',
      impulseSourceDeterministic: 'Deterministyczna wersja zapasowa',
      report: 'Plan działania',
      llmSettings: 'Ustawienia LLM',
      languageLabel: 'JĘZYK',
      engine: {
      saveSession: 'Zapisz sesję',
      newSession: 'Nowa sesja',
        saveSuccess: 'Zapisano',
        saveRequiresAuth: 'Zaloguj się, aby zapisać sesje.',
        saveMissingSession: 'Rozpocznij sesję przed zapisem.',
        saveFailed: 'Nie udało się zapisać.',
      },
      auth: {
        logout: 'Wyloguj się',
        logoutFailed: 'Nie udało się wylogować.',
        loginStartFailed: 'Nie udało się rozpocząć logowania. Spróbuj ponownie.',
      },
      authCallback: {
        invalidLink: 'Nieprawidłowy lub wygasły link logowania. Wyślij nowy link.',
        missingCode: 'Logowanie nie powiodło się. Spróbuj ponownie.',
        signInFailed: 'Logowanie nie zakończyło się. Spróbuj ponownie.',
        backToApp: 'Wróć do aplikacji',
        redirectHint:
          'Sprawdź Supabase Auth Redirect URLs + Google OAuth origins/redirect.',
        tryAgain: 'Spróbuj ponownie.',
        tryAgainCta: 'Spróbuj ponownie',
        oauthOriginMismatch:
          'Dokończ logowanie na tym samym adresie (localhost vs 127.0.0.1).',
        pkceMismatch:
          'Ten link został otwarty w innej przeglądarce lub na innej stronie. Otwórz go w tej samej przeglądarce i na tym samym urządzeniu, na którym rozpocząłeś logowanie.',
        pkceMissing: 'Nieprawidłowy lub wygasły link logowania. Wyślij nowy link.',
        expired: 'Ten link logowania wygasł. Wyślij nowy link.',
        redirectMismatch: 'Niezgodny adres przekierowania. Wyślij nowy link.',
        unknownError: 'Nie udało się zalogować. Spróbuj ponownie.',
        returnToLogin: 'Wróć do logowania',
        sendLinkAgain: 'Wyślij link ponownie',
        goHome: 'Przejdź na stronę główną',
      },
      loginTitle: 'Logowanie',
      loginSubtitle: 'Zaloguj się, aby kontynuować.',
      loginSessionHelper:
        'Zapisujemy Twoje sesje i plany akcji, żebyś mógł wrócić do nich później.',
      topupTitle: 'Doładuj saldo (usługowe) z obowiązkiem zapłaty',
      topupSubtitle: '',
      topupConfig: {
        amounts: ['20', '50', '100'],
        currency: 'PLN',
        captions: [
          ['1 raport', '+ iteracje'],
          ['pełna sesja nad', 'jednym produktem'],
          ['kilka koncepcji lub', 'praca zespołowa'],
        ],
        footer:
          'Środki wykorzystujesz elastycznie — płacisz tylko za generowanie i aktualizacje raportu.',
      },
      topupReturnLabel: 'Wróć na poprzednią stronę',
      loginContinue: 'Kontynuuj',
      loginGoogleLabel: 'Google',
      loginGoogleCta: 'Kontynuuj z Google',
      loginGoogleLoading: 'Łączenie...',
      loginEmailLabel: 'E-mail',
      loginEmailPlaceholder: 'you@company.com',
      loginEmailCta: 'Wyślij link do logowania',
      loginEmailSending: 'Wysyłanie...',
      loginEmailCooldown: (seconds) => `Poczekaj ${seconds}s`,
      loginPasswordToggleLabel: 'E-mail + hasło (dev)',
      loginPasswordPlaceholder: 'hasło',
      loginPasswordSignIn: 'Zaloguj się',
      loginPasswordSignUp: 'Zarejestruj się',
      loginGuestLabel: 'Gość',
      loginGuestCta: 'Wypróbuj jako gość',
      loginGuestActive: 'W trybie gościa — dane są zapisywane lokalnie.',
      loginNoticeSent: 'Sprawdź e-mail — wysłaliśmy link do logowania.',
      loginNoticeSignup:
        'Konto utworzone. Jeśli wymagane jest potwierdzenie email, sprawdź skrzynkę.',
      loginEmailError: 'Wpisz poprawny adres e-mail.',
      loginCallbackTitle: 'Logowanie...',
      loginGuestMergePrompt: 'Znaleźliśmy pracę z sesji gościa. Zaimportować?',
      loginGuestMergeYes: 'Tak, importuj',
      loginGuestMergeNo: 'Nie, odrzuć',
      loginGuestMergeLoading: 'Importowanie...',
      loginDevSmtpNotice:
        'Nie widzisz maila? Sprawdź spam lub spróbuj jeszcze raz albo przez Google.',
      loginDevResetAuth: 'Zresetuj auth (dev)',
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
      axisFuture: 'Jak powinno być?',
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
        'Język raportu jest zgodny z językiem wybranym na landing page.',
      enginePreviewOpenReport: 'Przejdź do planu działania',
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
      reportTitle: 'Raport z sesji',
      reportPrint: 'Drukuj',
      reportDownloadPdf: 'Pobierz PDF',
      reportExportCsv: 'Eksport danych (CSV)',
      reportCoverTitle: 'Okładka',
      reportTocTitle: 'Spis treści',
      reportSessionGoalTitle: 'Cel sesji',
      reportExecutiveSummaryTitle: 'Streszczenie wykonawcze',
      reportPerspectiveMapTitle: 'Mapa perspektyw / pytań',
      reportCollectedResponsesTitle: 'Zebrane odpowiedzi',
      reportQuestionsTableTitle: 'Pytania',
      reportIdeasTableTitle: 'Pomysły',
      reportResponsesTableTitle: 'Odpowiedzi',
      reportInsightsTitle: 'Wnioski i wzorce',
      reportRecommendationsTitle: 'Rekomendacje / następne kroki',
      reportAppendicesTitle: 'Aneksy',
      reportNotProvided: 'Nie podano',
      reportNoData: 'Brak danych.',
      reportSessionMetaTitle: 'Metadane sesji',
      reportExportLinksTitle: 'Eksport',
      reportAuthorLabel: 'Autor',
      reportParticipantsLabel: 'Uczestnicy',
      reportDateRangeLabel: 'Data',
      reportSessionNameLabel: 'Nazwa sesji',
      reportQuestionsLabel: 'Pytania',
      reportIdeasLabel: 'Pomysły',
      reportCellsVisitedLabel: 'Odwiedzone komórki',
      reportDuplicatesLabel: 'Duplikaty',
      reportKeywordsTitle: 'Najczęstsze motywy',
      reportPerspectiveVisited: 'Odwiedzone',
      reportPerspectiveQuestions: 'Pytania',
      reportQuestionIdLabel: 'ID',
      reportQuestionTextLabel: 'Pytanie',
      reportQuestionSourceLabel: 'Źródło',
      reportQuestionCellLabel: 'Komórka',
      reportIdeaIdLabel: 'ID',
      reportIdeaTextLabel: 'Pomysł',
      reportIdeaTagsLabel: 'Tagi',
      reportIdeaCreatedLabel: 'Utworzono',
      reportAnswerQuestionLabel: 'Pytanie',
      reportAnswerTextLabel: 'Odpowiedź',
      reportAnswerCreatedLabel: 'Utworzono',
      reportRecommendationExpandIdeas: 'Rozwiń listę pomysłów przed oceną.',
      reportRecommendationExplorePerspectives: 'Sprawdź dodatkowe perspektywy w siatce 3×3.',
      reportRecommendationDeduplicate: 'Usuń duplikaty, aby zmniejszyć szum.',
      reportRecommendationPrioritize: 'Nadaj priorytety najlepszym pomysłom i ustal kolejne kroki.',
      close: 'Zamknij',
      editIdeaTitle: 'Edytuj pomysł',
      generatedIdeaTitle: 'Wygenerowany pomysł',
      questionsTitle: 'Pytania naprowadzające',
      nextQuestionsLabel: 'Następne 10 pytań naprowadzających',
      prevQuestionsLabel: 'Poprzednie 10 pytań naprowadzających',
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
      debugMatrixUnavailable: 'Niedostępne.',
      debugMatrixMissingSession: 'Brak sessionId.',
      debugMatrixLoadError: 'Nie udało się wczytać danych matrycy.',
      enginePreviewTitle: 'Podgląd silnika pytań',
      enginePreviewLandingLink: 'Landing page',
      enginePreviewLink: 'Podgląd silnika',
      enginePreviewSessionTitle: 'Sesja',
      enginePreviewSessionIdLabel: 'ID sesji',
      enginePreviewSessionEmpty: 'Jeszcze nie utworzono',
      enginePreviewCreateSession: 'Utwórz sesję',
      enginePreviewReset: 'Zapisz i zamknij sesję',
      enginePreviewCreateReport: 'Przeanalizuj wpisy i ułóż plan działania',
      enginePreviewBoardItemsTitle: 'Pracownia pomysłu',
      engineEntryLabelHint: 'Kliknij żeby dodać lub zmienić etykietę',
      engineEntryEditHint: 'Edytuj',
      engineEntryDeleteHint: 'Usuń',
      engineEntryLabelActionHint: 'Etykieta',
      engineEntryQuestionHint: 'Pokaż pytanie źródłowe',
      engineEntryQuestionFallback: 'Wpis powstał bez pytania facylitującego.',
      engineSectionAddEntryHint: 'Dodaj wpis do tej sekcji',
      engineSectionAddEntryAria: (sectionTitle) => `Dodaj wpis do sekcji ${sectionTitle}`,
      engineDraftRemoveEntry: 'Usuń wpis',
      feedbackButtonLabel: 'Opinia',
      feedbackTitle: 'Opinia',
      feedbackMessageLabel: 'Twoja wiadomość / opinia',
      feedbackMessagePlaceholder: 'Napisz, co działało, co było trudne, co poprawić…',
      feedbackSend: 'Wyślij opinię e-mailem',
      feedbackSent: 'Dzięki! Opinia została wysłana.',
      feedbackPrivacyNote: 'Nie dodawaj danych wrażliwych.',
      feedbackReminderText:
        'Jeśli masz chwilę, wyślij nam opinię z tej sesji — bardzo pomoże w dalszym rozwoju.',
      feedbackReminderSend: 'Wyślij opinię e-mailem',
      feedbackReminderDismiss: 'Pomiń',
      missingLabelModalTitle: 'Brakuje etykiet dla części wpisów',
      missingLabelModalBody: (count) =>
        `Na tablicy masz ${count} wpis(ów) bez etykiety (np. pomysł/ryzyko/pytanie). Chcesz uzupełnić etykiety teraz? Dzięki temu raport będzie bardziej czytelny.`,
      missingLabelPrimary: 'Tak, uzupełnię teraz',
      missingLabelSecondary: 'Nie, przejdź do raportu',
      missingLabelHint: 'Kliknij dropdown etykiety i wybierz kategorię.',
      missingLabelBadge: 'Brak etykiety',
      missingLabelComplete: 'Gotowe — możesz przejść do raportu.',
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
      engineSessionDetailsBoardTitle: 'Pracownia pomysłu',
      engineSessionDetailsBoardEmpty: 'Brak elementów.',
      engineFacilitationNote: 'Odpowiedz na konkretne pytanie, żeby iść dalej',
      engineFacilitationNext: 'Następne pytanie',
      engineFacilitationAsIs: 'Jak jest?',
      engineFacilitationProblem: 'Co nie działa?',
      engineFacilitationDesired: 'Jak powinno być?',
      engineFacilitationLoadingLabel: 'Generuję pytanie…',
      engineFacilitationRetryMessage: 'Nie udało się wygenerować pytania. Spróbuj ponownie.',
      engineFacilitationRetryCta: 'Spróbuj ponownie',
      engineFacilitationLoadingPerspective: 'Dobieram pytanie do tej perspektywy',
      engineFacilitationLoadingDeepen: 'Dobieram pytanie do Twojej tablicy',
      engineNamePrompt: 'Nadaj nazwę tej sesji, żeby łatwiej do niej wrócić.',
      engineNameLabel: 'Nazwa sesji',
      engineNamePlaceholder: 'Nazwa sesji',
      engineNameSave: 'Zapisz i kontynuuj',
      engineInitialBriefTitle: 'Opisz swoją sytuację',
      engineInitialBriefDescription:
        'Napisz, co próbujesz rozwiązać, zrozumieć, usprawnić lub zdecydować. Dodaj dostępne informacje, wymagania, obserwacje, ograniczenia i pytania. Pomogę uporządkować je w pierwsze elementy tablicy dla tej sesji.',
      engineInitialBriefPlaceholder:
        'Przykład: Dla kogo to jest, co dziś nie działa, co chcesz zmienić, jakie masz założenia, jakie pytania pozostają otwarte?',
      engineInitialBriefSubmit: 'Utwórz pierwsze wpisy',
      engineInitialBriefSubmitting: 'Tworzę wpisy…',
      engineInitialBriefNeedsMoreInfo: 'Potrzebujemy trochę więcej informacji, żeby utworzyć pierwsze wpisy.',
      engineInitialBriefWordCountRemaining: (count) => `Pozostało ${count} słów`,
      engineInitialBriefWordLimitReached: 'Osiągnięto limit słów (1000).',
      engineInitialBriefLengthIntro: 'Początek kontekstu',
      engineInitialBriefLengthTarget: 'Dobry start to około 200 słów.',
      engineInitialBriefLengthCount: (count, target) => `Teraz masz ${count} / ~${target} słów.`,
      engineInitialBriefLengthLow: '',
      engineInitialBriefLengthUseful: 'Obraz sytuacji staje się wyraźniejszy',
      engineInitialBriefLengthStrong: 'Pojawiają się istotne zależności',
      engineInitialBriefLengthEnough: 'To dobry moment na analizę',
      engineInitialBriefLengthContinue: 'Możesz kontynuować albo przejść dalej',
      engineInitialBriefEmpty: 'Najpierw wpisz krótki opis.',
      engineInitialBriefTooLong: 'Opis przekracza limit 1000 słów.',
      engineInitialBriefFailed: 'Nie udało się utworzyć pierwszych wpisów. Spróbuj ponownie.',
      engineInitialBriefSuggestFailed: 'Nie udało się przeanalizować opisu na pierwsze wpisy. Spróbuj ponownie.',
      engineInitialBriefSaveFailed: 'Opis został przeanalizowany, ale nie udało się zapisać pierwszych wpisów.',
      engineInitialBriefPartialSaveFailed: (savedCount, failedCount) =>
        `Opis został przeanalizowany. Zapisano ${savedCount} wpisów, ale ${failedCount} nie udało się zapisać.`,
      engineInitialBriefVoiceInputLabel: 'Użyj wprowadzania głosowego',
      engineInitialBriefVoiceInputListening: 'Nasłuchiwanie…',
      engineInitialBriefVoiceInputUnavailable: 'Wprowadzanie głosowe nie jest dostępne w tej przeglądarce.',
      engineInitialBriefVoiceInputError: 'Wprowadzanie głosowe jest chwilowo niedostępne.',
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
      llmUsageIndicatorLabel: 'Wskaźnik użycia LLM',
      llmCostLabel: (usd) => `Koszt: $${usd}`,
      llmCostPlnLabel: (pln) => `Koszt (PLN): ${pln} zł`,
      llmCostPlnFallback: 'PLN: …',
      llmCostBreakdown: 'Szczegóły',
      llmCostTotalTokens: (tokens) => `Łącznie tokenów: ${tokens}`,
      llmCostTotalUsd: (usd) => `Suma USD: $${usd}`,
      llmCostTotalPln: (pln) => `Suma PLN: ${pln} zł`,
      llmCostTotalPlnFallback: 'Suma PLN: …',
      llmCostModelRow: (model, input, output, usd) =>
        `${model}: ${input} wej. / ${output} wyj. · $${usd}`,
      diagnosticsAuthLabel: 'auth',
      adminNavLabel: 'Panel admina',
      insufficientBalanceNotice: 'Saldo jest zbyt niskie. Doładuj saldo (usługowe), aby kontynuować.',
      llmStatusOnline: 'Status serwera: online',
      llmStatusOffline: 'Status serwera: offline',
      llmStatusUnknown: 'Status serwera: nieznany',
      llmTestConnection: 'Testuj połączenie',
      llmEnableConnection: 'Włącz OpenAI',
      llmDisableConnection: 'Wyłącz OpenAI',
      aiSupportOn: 'AI support ON',
      aiSupportOff: 'AI support OFF',
      diagnosticsOn: 'Diagnostyka ON',
      diagnosticsOff: 'Diagnostyka OFF',
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
  }

  const polishTranslations: Translations = translations.Polish
  const languageFallbacks: Partial<Record<Language, Language>> = {}

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

  return function getTranslations(language: Language): Translations {
    const fallbackLanguage = languageFallbacks[language]
    const fallbackTranslations = fallbackLanguage ? translations[fallbackLanguage] : undefined
    const mergedFallback = withFallback(polishTranslations, fallbackTranslations)
    return withFallback(mergedFallback, translations[language])
  }
}
