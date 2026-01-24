import { STORAGE_KEY_GUEST, type StoredSession } from '../storage/sessionStore'

const GUEST_FLAG_KEY = 'guest-mode'

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

export const isGuestMode = () => {
  if (!isBrowser()) return false
  return window.localStorage.getItem(GUEST_FLAG_KEY) === 'true'
}

export const enableGuestMode = () => {
  if (!isBrowser()) return
  window.localStorage.setItem(GUEST_FLAG_KEY, 'true')
}

export const clearGuestMode = () => {
  if (!isBrowser()) return
  window.localStorage.removeItem(GUEST_FLAG_KEY)
}

export const readGuestSessions = (): StoredSession[] => {
  if (!isBrowser()) return []
  const raw = window.localStorage.getItem(STORAGE_KEY_GUEST)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { sessions?: Record<string, StoredSession> }
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return []
    return Object.values(parsed.sessions)
  } catch {
    return []
  }
}

export const clearGuestSessions = () => {
  if (!isBrowser()) return
  window.localStorage.removeItem(STORAGE_KEY_GUEST)
}
