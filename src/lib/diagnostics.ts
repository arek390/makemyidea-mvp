const ADMIN_EMAIL = 'arektest8@gmail.com'

export const DIAGNOSTICS_STORAGE_KEY = 'mmw:diagnosticsEnabled'

type EmailCarrier =
  | { email?: string | null }
  | { user?: { email?: string | null } | null }
  | null
  | undefined

export const getUserEmail = (input: EmailCarrier): string | null => {
  if (!input) return null
  if ('email' in input && typeof input.email === 'string') return input.email
  if ('user' in input && input.user && typeof input.user.email === 'string') {
    return input.user.email
  }
  return null
}

export const isAdminUser = (input: EmailCarrier) => {
  const email = getUserEmail(input)
  return !!email && email.toLowerCase() === ADMIN_EMAIL
}
