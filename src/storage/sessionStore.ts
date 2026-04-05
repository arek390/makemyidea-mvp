export type EngineBoardItem = {
  id: string
  type: 'idea' | 'observation' | 'doubt' | 'question'
  text: string
  label?: string | null
  question_id?: string | null
  question_text_pl?: string | null
  question_text_en?: string | null
  created_at?: number
  updated_at?: number
  entry_type?: 'free_input' | 'facilitated_input'
  prompt_type?: 'NEXT' | 'DEEPEN' | 'PERSPECTIVE' | 'RESET' | null
  matrix_row?: string | null
  matrix_col?: string | null
  sort_order?: number | null
  lastClassifiedText?: string | null
  classificationDirty?: boolean | null
}

export type EngineSessionSummary = {
  id: string
  name?: string | null
  created_at: number
  updated_at: number
  last_group_code: string | null
  last_mode_code: number | null
  last_category_code: string | null
  stuck_counter: number
  tokensInTotal?: number
  tokensOutTotal?: number
  cloud_board_items_migrated?: boolean
}

export type EngineSessionDetail = {
  session: EngineSessionSummary | null
  boardItems: EngineBoardItem[]
  askedQuestionIds: string[]
  report?: ReportMeta | null
}

export type StoredSession = {
  session: EngineSessionSummary
  boardItems: EngineBoardItem[]
  askedQuestionIds: string[]
  report?: ReportMeta | null
}

export type ReportSummary = {
  today: string
  change: string
  product: string
}

export type RecommendationItem = {
  title: string
  rationale: string
  how_to_test: string
  methods?: string[]
  confidence?: 'low' | 'med' | 'high'
}

export type ReportRecommendations = {
  based_on_user_ideas: RecommendationItem[]
  morphological: RecommendationItem[]
  market_trends: RecommendationItem[]
}

export type ReportTrizPrinciple = {
  id?: number
  name: string
  rationale?: string
  how_to_apply?: string
}

export type ReportTrizSolutionImage = {
  status?: 'idle' | 'ready' | 'failed'
  storage_path?: string
  public_url?: string
  mime_type?: string
  file_name?: string
  generated_at?: string
  prompt?: string
  error_message?: string
}

export type ReportTrizSolution = {
  title: string
  description: string
  sketch_prompt?: string
  image?: ReportTrizSolutionImage | null
  images?: ReportTrizSolutionImage[] | null
}

export type ReportTrizContradiction = {
  title: string
  description: string
  improving: string
  worsening: string
  principles: ReportTrizPrinciple[]
  solutions: ReportTrizSolution[]
}

export type ReportTrizSection = {
  section_title?: string
  section_intro?: string
  contradictions: ReportTrizContradiction[]
}

export type ReportIdea = {
  id: string
  text: string
  label?: string | null
  questionId?: string | null
  questionTextPl?: string | null
  questionTextEn?: string | null
  matrixRow?: string | null
  matrixCol?: string | null
}

export type ReportMeta = {
  id?: string | null
  created_at?: number | null
  updated_at?: number | null
  lang?: 'pl' | 'en' | null
  lastSummaryTextHash?: string | null
  summary?: ReportSummary | null
  ideas?: ReportIdea[] | null
  recommendations?: ReportRecommendations | null
  triz?: ReportTrizSection | null
}

export const STORAGE_KEY = 'engine-sessions-v1'
export const STORAGE_KEY_GUEST = 'engine-sessions-guest-v1'
const GUEST_FLAG_KEY = 'guest-mode'

let lastStorageError: string | null = null

const setLastError = (error: unknown) => {
  if (!import.meta.env.DEV) return
  if (error instanceof Error) {
    lastStorageError = error.message
  } else if (typeof error === 'string') {
    lastStorageError = error
  } else {
    lastStorageError = 'Unknown storage error'
  }
}

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const resolveStorageKey = () => {
  if (!isBrowser()) return STORAGE_KEY
  return window.localStorage.getItem(GUEST_FLAG_KEY) === 'true'
    ? STORAGE_KEY_GUEST
    : STORAGE_KEY
}

const readStore = (): Record<string, StoredSession> => {
  if (!isBrowser()) return {}
  try {
    const raw = window.localStorage.getItem(resolveStorageKey())
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { sessions?: Record<string, StoredSession> }
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return {}
    return parsed.sessions
  } catch (error) {
    setLastError(error)
    return {}
  }
}

const writeStore = (sessions: Record<string, StoredSession>) => {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(resolveStorageKey(), JSON.stringify({ sessions }))
  } catch (error) {
    setLastError(error)
  }
}

const normalizeSession = (session: EngineSessionSummary): EngineSessionSummary => ({
  ...session,
  name: session.name ?? null,
  last_group_code: session.last_group_code ?? null,
  last_mode_code: session.last_mode_code ?? null,
  last_category_code: session.last_category_code ?? null,
  stuck_counter: session.stuck_counter ?? 0,
  tokensInTotal: session.tokensInTotal ?? 0,
  tokensOutTotal: session.tokensOutTotal ?? 0,
  cloud_board_items_migrated: session.cloud_board_items_migrated ?? false,
})

export const listSessions = async (): Promise<EngineSessionSummary[]> => {
  const sessions = Object.values(readStore()).map((stored) => normalizeSession(stored.session))
  return sessions.sort((a, b) => b.updated_at - a.updated_at)
}

export const getSession = async (id: string): Promise<EngineSessionDetail | null> => {
  const sessions = readStore()
  const stored = sessions[id]
  if (!stored) return null
  return {
    session: normalizeSession(stored.session),
    boardItems: stored.boardItems || [],
    askedQuestionIds: stored.askedQuestionIds || [],
    report: stored.report || null,
  }
}

export const createSession = async (input?: {
  name?: string | null
  id?: string | null
}): Promise<EngineSessionDetail> => {
  const now = Date.now()
  const id = String(input?.id || '').trim() || generateId()
  const session: EngineSessionSummary = {
    id,
    name: input?.name ?? null,
    created_at: now,
    updated_at: now,
    last_group_code: null,
    last_mode_code: null,
    last_category_code: null,
    stuck_counter: 0,
    tokensInTotal: 0,
    tokensOutTotal: 0,
  }
  const record: StoredSession = {
    session,
    boardItems: [],
    askedQuestionIds: [],
    report: null,
  }
  const sessions = readStore()
  sessions[id] = record
  writeStore(sessions)
  return { session, boardItems: [], askedQuestionIds: [] }
}

export const updateSession = async (detail: EngineSessionDetail): Promise<void> => {
  if (!detail.session) return
  const sessions = readStore()
  sessions[detail.session.id] = {
    session: normalizeSession(detail.session),
    boardItems: detail.boardItems || [],
    askedQuestionIds: detail.askedQuestionIds || [],
    report: detail.report || null,
  }
  writeStore(sessions)
}

export const deleteSession = async (id: string): Promise<void> => {
  const sessions = readStore()
  if (!sessions[id]) return
  delete sessions[id]
  writeStore(sessions)
}

export const exportSessions = async (): Promise<StoredSession[]> => {
  return Object.values(readStore())
}

export const getLastStorageError = () => lastStorageError

export const getStorageSessionCount = () => Object.keys(readStore()).length

const isValidRecord = (value: unknown): value is StoredSession => {
  if (!value || typeof value !== 'object') return false
  const record = value as StoredSession
  if (!record.session || typeof record.session.id !== 'string') return false
  if (!Array.isArray(record.boardItems)) return false
  if (!Array.isArray(record.askedQuestionIds)) return false
  return true
}

export const importSessions = async (records: StoredSession[]): Promise<{ imported: number }> => {
  const sessions = readStore()
  let imported = 0
  records.forEach((record) => {
    if (!isValidRecord(record)) return
    let sessionId = record.session.id
    if (sessions[sessionId]) {
      sessionId = generateId()
    }
    const now = Date.now()
    const session: EngineSessionSummary = normalizeSession({
      ...record.session,
      id: sessionId,
      created_at: record.session.created_at || now,
      updated_at: record.session.updated_at || now,
    })
    sessions[sessionId] = {
      session,
      boardItems: record.boardItems.map((item) => ({
        ...item,
        created_at: item.created_at || now,
      })),
      askedQuestionIds: record.askedQuestionIds || [],
      report: record.report || null,
    }
    imported += 1
  })
  writeStore(sessions)
  return { imported }
}
