export const ADMIN_EMAIL = 'arektest8@gmail.com'

export const DIAGNOSTICS_STORAGE_KEY = 'mmw:diagnosticsEnabled'

type EmailCarrier =
  | { email?: string | null }
  | { user?: { email?: string | null; user_metadata?: { email?: string | null } } | null }
  | null
  | undefined

export const isAdminUser = (session: EmailCarrier) => {
  const email = String(
    session?.user?.email ||
      (session?.user as { user_metadata?: { email?: string | null } } | null)?.user_metadata?.email ||
      ''
  )
  const normalized = email.trim().toLowerCase()
  const result = normalized === ADMIN_EMAIL
  if (import.meta?.env?.DEV) {
    console.log('[isAdminUser] email:', email, 'isAdmin:', result)
  }
  return result
}
