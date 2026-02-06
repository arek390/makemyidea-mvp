import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase/client'

type AuthSnapshot = {
  session: Session | null
  user: User | null
  authReady: boolean
}

let state: AuthSnapshot = {
  session: null,
  user: null,
  authReady: false,
}

let initialized = false
const listeners = new Set<() => void>()

const emit = () => {
  listeners.forEach((listener) => listener())
}

const setState = (next: AuthSnapshot) => {
  state = next
  emit()
}

const ensureInit = () => {
  if (initialized) return
  initialized = true

  if (!supabase) {
    setState({ session: null, user: null, authReady: true })
    return
  }

  supabase.auth
    .getSession()
    .then(({ data }) => {
      const session = data.session ?? null
      setState({
        session,
        user: session?.user ?? null,
        authReady: true,
      })
    })
    .catch(() => {
      setState({ session: null, user: null, authReady: true })
    })

  supabase.auth.onAuthStateChange((_event, session) => {
    setState({
      session: session ?? null,
      user: session?.user ?? null,
      authReady: true,
    })
  })
}

export const getAuthState = (): AuthSnapshot => {
  ensureInit()
  return state
}

export const getAuthReady = (): boolean => {
  ensureInit()
  return state.authReady
}

export const subscribeAuth = (listener: () => void) => {
  ensureInit()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useAuthState = (): AuthSnapshot => {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => getAuthState())

  useEffect(() => {
    return subscribeAuth(() => {
      setSnapshot(getAuthState())
    })
  }, [])

  return snapshot
}
