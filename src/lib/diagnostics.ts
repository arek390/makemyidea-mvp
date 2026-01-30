const ADMIN_EMAIL = 'arektest8@gmail.com'

export const DIAGNOSTICS_STORAGE_KEY = 'mmw:diagnosticsEnabled'

export const isAdminUser = (
  sessionOrUser?:
    | { email?: string | null }
    | { user?: { email?: string | null } | null }
    | null
) => {
  if (!sessionOrUser) return false
  const email =
    ('email' in sessionOrUser && sessionOrUser.email) ||
    (sessionOrUser.user && sessionOrUser.user.email) ||
    null
  if (!email) return false
  return String(email).toLowerCase() === ADMIN_EMAIL
}
