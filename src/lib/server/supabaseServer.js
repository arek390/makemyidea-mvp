import { createServerClient } from '@supabase/ssr'

const parseCookies = (cookieHeader = '') =>
  cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=')
      if (index === -1) return acc
      const key = decodeURIComponent(part.slice(0, index))
      const value = decodeURIComponent(part.slice(index + 1))
      acc[key] = value
      return acc
    }, {})

const serializeCookie = (name, value, options = {}) => {
  const opts = {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    ...options,
  }
  const segments = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`]
  if (opts.maxAge != null) segments.push(`Max-Age=${Math.floor(opts.maxAge)}`)
  if (opts.expires) segments.push(`Expires=${opts.expires.toUTCString()}`)
  if (opts.path) segments.push(`Path=${opts.path}`)
  if (opts.domain) segments.push(`Domain=${opts.domain}`)
  if (opts.sameSite) segments.push(`SameSite=${opts.sameSite}`)
  if (opts.secure) segments.push('Secure')
  if (opts.httpOnly) segments.push('HttpOnly')
  return segments.join('; ')
}

const appendSetCookie = (res, value) => {
  const existing = res.getHeader('Set-Cookie')
  if (!existing) {
    res.setHeader('Set-Cookie', value)
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value])
  } else {
    res.setHeader('Set-Cookie', [existing, value])
  }
}

export const createSupabaseServerClient = (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase env vars for server.')
  }

  const cookieHeader = req?.headers?.cookie || ''
  const cookies = parseCookies(cookieHeader)

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get: (name) => cookies[name],
      set: (name, value, options) => {
        appendSetCookie(res, serializeCookie(name, value, options))
      },
      remove: (name, options) => {
        appendSetCookie(res, serializeCookie(name, '', { ...options, maxAge: 0 }))
      },
    },
  })
}
