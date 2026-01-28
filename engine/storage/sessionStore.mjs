import { createClient } from '@supabase/supabase-js'
import { getEngineDb } from '../db.mjs'

const nowMs = () => Date.now()
const isProduction = () => process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

let cachedSupabase = null
let cachedStore = null
let cachedStoreType = null

const createEnvError = (message) => {
  const error = new Error(message)
  error.code = 'ENV_MISSING'
  return error
}

const getSupabaseClient = () => {
  if (cachedSupabase) return cachedSupabase
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.SUPABASE_ANON_KEY
  const key = serviceRoleKey || anonKey
  if (!url || !key) {
    throw createEnvError('Supabase env is missing: SUPABASE_URL and key are required.')
  }
  cachedSupabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedSupabase
}

const ensureSessionsColumns = () => {
  const db = getEngineDb()
  const columns = db.prepare(`PRAGMA table_info(sessions)`).all().map((row) => row.name)
  if (!columns.includes('name')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN name TEXT').run()
  }
  if (!columns.includes('tokens_in_total')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN tokens_in_total INTEGER NOT NULL DEFAULT 0').run()
  }
  if (!columns.includes('tokens_out_total')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN tokens_out_total INTEGER NOT NULL DEFAULT 0').run()
  }
}

const ensureSessionStateColumns = () => {
  const db = getEngineDb()
  const columns = db.prepare(`PRAGMA table_info(session_state)`).all().map((row) => row.name)
  if (!columns.includes('current_group_code')) {
    db.prepare('ALTER TABLE session_state ADD COLUMN current_group_code TEXT').run()
  }
  if (!columns.includes('current_mode_code')) {
    db.prepare('ALTER TABLE session_state ADD COLUMN current_mode_code INTEGER').run()
  }
  if (!columns.includes('recent_cells')) {
    db.prepare('ALTER TABLE session_state ADD COLUMN recent_cells TEXT').run()
  }
  if (!columns.includes('visit_counts')) {
    db.prepare('ALTER TABLE session_state ADD COLUMN visit_counts TEXT').run()
  }
  if (!columns.includes('cell_pointers')) {
    db.prepare('ALTER TABLE session_state ADD COLUMN cell_pointers TEXT').run()
  }
}

const createSqliteStore = () => {
  const store = {
    type: 'sqlite',
    ensureSessionExists: (sessionId) => {
      if (!sessionId) return null
      const db = getEngineDb()
      ensureSessionsColumns()
      const existing = db
        .prepare(
          `SELECT id, name, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter,
                  tokens_in_total, tokens_out_total
           FROM sessions WHERE id = @id`
        )
        .get({ id: sessionId })
      if (existing) return existing
      const timestamp = nowMs()
      db.prepare(
        `INSERT INTO sessions (id, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter, tokens_in_total, tokens_out_total)
         VALUES (@id, @created_at, @updated_at, NULL, NULL, NULL, 0, 0, 0)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
      ).run({ id: sessionId, created_at: timestamp, updated_at: timestamp })
      return db
        .prepare(
          `SELECT id, name, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter,
                  tokens_in_total, tokens_out_total
           FROM sessions WHERE id = @id`
        )
        .get({ id: sessionId })
    },
    ensureSessionState: (sessionId) => {
      if (!sessionId) return null
      store.ensureSessionExists(sessionId)
      const db = getEngineDb()
      ensureSessionStateColumns()
      const timestamp = nowMs()
      db.prepare(
        `INSERT INTO session_state (session_id, depth_level, hard_streak, last_question_id, last_difficulty, asked_count, updated_at)
         VALUES (@session_id, 3, 0, NULL, NULL, 0, @updated_at)
         ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at`
      ).run({ session_id: sessionId, updated_at: timestamp })
      return db
        .prepare(
          `SELECT session_id, depth_level, hard_streak, last_question_id, last_difficulty, asked_count, updated_at,
                  current_group_code, current_mode_code, recent_cells, visit_counts, cell_pointers
           FROM session_state
           WHERE session_id = @session_id`
        )
        .get({ session_id: sessionId })
    },
    getSessionState: (sessionId) => {
      const db = getEngineDb()
      return db
        .prepare(
          `SELECT session_id, depth_level, hard_streak, last_question_id, last_difficulty, asked_count, updated_at,
                  current_group_code, current_mode_code, recent_cells, visit_counts, cell_pointers
           FROM session_state
           WHERE session_id = @session_id`
        )
        .get({ session_id: sessionId })
    },
    updateSessionStateRow: ({
      sessionId,
      depth_level,
      hard_streak,
      last_question_id,
      last_difficulty,
      asked_count,
      current_group_code,
      current_mode_code,
      recent_cells,
      visit_counts,
      cell_pointers,
    }) => {
      const db = getEngineDb()
      db.prepare(
        `UPDATE session_state
         SET updated_at = @updated_at,
             depth_level = COALESCE(@depth_level, depth_level),
             hard_streak = COALESCE(@hard_streak, hard_streak),
             last_question_id = COALESCE(@last_question_id, last_question_id),
             last_difficulty = COALESCE(@last_difficulty, last_difficulty),
             asked_count = COALESCE(@asked_count, asked_count),
             current_group_code = COALESCE(@current_group_code, current_group_code),
             current_mode_code = COALESCE(@current_mode_code, current_mode_code),
             recent_cells = COALESCE(@recent_cells, recent_cells),
             visit_counts = COALESCE(@visit_counts, visit_counts),
             cell_pointers = COALESCE(@cell_pointers, cell_pointers)
         WHERE session_id = @session_id`
      ).run({
        session_id: sessionId,
        updated_at: nowMs(),
        depth_level,
        hard_streak,
        last_question_id,
        last_difficulty,
        asked_count,
        current_group_code,
        current_mode_code,
        recent_cells,
        visit_counts,
        cell_pointers,
      })
    },
  }
  return store
}

const createSupabaseStore = () => {
  const store = {
    type: 'supabase',
    ensureSessionExists: async (sessionId) => {
      if (!sessionId) return null
      const client = getSupabaseClient()
      const timestamp = new Date().toISOString()
      const { error } = await client
        .from('sessions')
        .upsert(
          {
            id: sessionId,
            name: null,
            created_at: timestamp,
            updated_at: timestamp,
          },
          { onConflict: 'id' }
        )
      if (error) throw error
      const { data, error: fetchError } = await client
        .from('sessions')
        .select(
          'id, name, created_at, updated_at, last_group_code, last_mode_code, last_category_code, stuck_counter, tokens_in_total, tokens_out_total'
        )
        .eq('id', sessionId)
        .maybeSingle()
      if (fetchError) throw fetchError
      return data || null
    },
    ensureSessionState: async (sessionId) => {
      if (!sessionId) return null
      await store.ensureSessionExists(sessionId)
      const client = getSupabaseClient()
      const timestamp = new Date().toISOString()
      const { error } = await client
        .from('session_state')
        .upsert(
          {
            session_id: sessionId,
            depth_level: 3,
            hard_streak: 0,
            last_question_id: null,
            last_difficulty: null,
            asked_count: 0,
            updated_at: timestamp,
          },
          { onConflict: 'session_id' }
        )
      if (error) throw error
      return store.getSessionState(sessionId)
    },
    getSessionState: async (sessionId) => {
      const client = getSupabaseClient()
      const { data, error } = await client
        .from('session_state')
        .select(
          'session_id, depth_level, hard_streak, last_question_id, last_difficulty, asked_count, updated_at, current_group_code, current_mode_code, recent_cells, visit_counts, cell_pointers'
        )
        .eq('session_id', sessionId)
        .maybeSingle()
      if (error) throw error
      return data || null
    },
    updateSessionStateRow: async ({
      sessionId,
      depth_level,
      hard_streak,
      last_question_id,
      last_difficulty,
      asked_count,
      current_group_code,
      current_mode_code,
      recent_cells,
      visit_counts,
      cell_pointers,
    }) => {
      const client = getSupabaseClient()
      const payload = {
        updated_at: new Date().toISOString(),
      }
      if (depth_level !== undefined) payload.depth_level = depth_level
      if (hard_streak !== undefined) payload.hard_streak = hard_streak
      if (last_question_id !== undefined) payload.last_question_id = last_question_id
      if (last_difficulty !== undefined) payload.last_difficulty = last_difficulty
      if (asked_count !== undefined) payload.asked_count = asked_count
      if (current_group_code !== undefined) payload.current_group_code = current_group_code
      if (current_mode_code !== undefined) payload.current_mode_code = current_mode_code
      if (recent_cells !== undefined) payload.recent_cells = recent_cells
      if (visit_counts !== undefined) payload.visit_counts = visit_counts
      if (cell_pointers !== undefined) payload.cell_pointers = cell_pointers
      const { error } = await client.from('session_state').update(payload).eq('session_id', sessionId)
      if (error) throw error
    },
  }
  return store
}

export const getSessionStoreType = () => cachedStoreType || (isProduction() ? 'supabase' : 'sqlite')

export const getSessionStore = () => {
  if (cachedStore) return cachedStore
  cachedStoreType = isProduction() ? 'supabase' : 'sqlite'
  cachedStore = cachedStoreType === 'supabase' ? createSupabaseStore() : createSqliteStore()
  return cachedStore
}

export const ensureSessionState = async (sessionId) => {
  const store = getSessionStore()
  return store.ensureSessionState(sessionId)
}

export const getSessionState = async (sessionId) => {
  const store = getSessionStore()
  return store.getSessionState(sessionId)
}

export const updateSessionStateRow = async (input) => {
  const store = getSessionStore()
  return store.updateSessionStateRow(input)
}
