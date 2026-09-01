import { resolveSite } from './src/sites/siteConfig'

const siteEntryPaths = {
  makeMyIdea: '/_sites/makemyidea/index.html',
  makeMyProblem: '/_sites/makemyproblem/index.html',
} as const

export const config = {
  matcher: '/',
}

export default function middleware(request: Request) {
  const url = new URL(request.url)
  if (url.pathname !== '/') return

  const site = resolveSite(url.hostname)
  url.pathname = siteEntryPaths[site.id]

  return new Response(null, {
    headers: {
      'x-middleware-rewrite': url.toString(),
    },
  })
}
