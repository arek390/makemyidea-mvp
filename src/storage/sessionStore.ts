export type EngineBoardItem = {
  id: string
  type: 'idea' | 'observation' | 'doubt' | 'question'
  text: string
  label?: string | null
  created_at?: number
  entry_type?: 'free_input' | 'facilitated_input'
  prompt_type?: 'NEXT' | 'DEEPEN' | 'PERSPECTIVE' | 'RESET' | null
  matrix_row?: string | null
  matrix_col?: string | null
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
}

export type EngineSessionDetail = {
  session: EngineSessionSummary | null
  boardItems: EngineBoardItem[]
  askedQuestionIds: string[]
}

type StoredSession = {
  session: EngineSessionSummary
  boardItems: EngineBoardItem[]
  askedQuestionIds: string[]
}

export const STORAGE_KEY = 'engine-sessions-v1'

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

const readStore = (): Record<string, StoredSession> => {
  if (!isBrowser()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions }))
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
  }
}

export const createSession = async (input?: {
  name?: string | null
}): Promise<EngineSessionDetail> => {
  const now = Date.now()
  const id = generateId()
  const session: EngineSessionSummary = {
    id,
    name: input?.name ?? null,
    created_at: now,
    updated_at: now,
    last_group_code: null,
    last_mode_code: null,
    last_category_code: null,
    stuck_counter: 0,
  }
  const record: StoredSession = {
    session,
    boardItems: [],
    askedQuestionIds: [],
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
    }
    imported += 1
  })
  writeStore(sessions)
  return { imported }
}
