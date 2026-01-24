import { createServerClient } from '@supabase/ssr'

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

const parseCookies = (cookieHeader = '') =>
  cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const index = part.indexOf('=')
      if (index === -1) return acc
      const key = decodeURIComponent(part.slice(0, index))
      const value = decodeURIComponent(part.slice(index + 1))
      acc[key] = value
      return acc
    }, {})

const serializeCookie = (name: string, value: string, options: Record<string, unknown> = {}) => {
  const opts = {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    ...options,
  } as {
    path?: string
    httpOnly?: boolean
    sameSite?: string
    maxAge?: number
    expires?: Date
    domain?: string
    secure?: boolean
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

export const config = {
  matcher: ['/app/:path*'],
}

export async function middleware(request: Request) {
  const url = new URL(request.url)
  const headers = new Headers({ 'x-middleware-next': '1' })

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(null, { status: 200, headers })
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const cookies = parseCookies(cookieHeader)
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get: (name) => cookies[name],
      set: (name, value, options) => {
        headers.append('Set-Cookie', serializeCookie(name, value, options))
      },
      remove: (name, options) => {
        headers.append('Set-Cookie', serializeCookie(name, '', { ...options, maxAge: 0 }))
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  if (!data?.user) {
    const redirectUrl = new URL('/login', url)
    redirectUrl.searchParams.set('next', `${url.pathname}${url.search}`)
    return Response.redirect(redirectUrl, 302)
  }

  return new Response(null, { status: 200, headers })
}
