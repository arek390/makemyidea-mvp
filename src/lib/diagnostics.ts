import type { Session } from '@supabase/supabase-js'

export const ADMIN_EMAIL = 'makemyideawork@aremai.tech'

export const DIAGNOSTICS_STORAGE_KEY = 'mmw:diagnosticsEnabled'

type EmailOnly = { email?: string | null }
type UserEmail = {
  user?: { email?: string | null; user_metadata?: { email?: string | null } | undefined } | null
}

const hasUser = (value: unknown): value is UserEmail => {
  return typeof value === 'object' && value !== null && 'user' in value
}

const hasEmail = (value: unknown): value is EmailOnly => {
  return typeof value === 'object' && value !== null && 'email' in value
}

export const isAdminUser = (
  session: Session | EmailOnly | UserEmail | null | undefined
): boolean => {
  const admin = ADMIN_EMAIL
  let email = ''

  if (!session) return false

  if (hasUser(session) && session.user) {
    email = session.user.email || session.user.user_metadata?.email || ''
  } else if (hasEmail(session)) {
    email = session.email || ''
  }

  const result = email.trim().toLowerCase() === admin
  return result
}
