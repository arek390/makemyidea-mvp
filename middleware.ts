import { resolveSite } from './src/sites/siteConfig.js'

const publicLandingLanguages = new Set(['en', 'pl', 'de'])
const languageAlternates = (origin: string) =>
  ['en', 'pl', 'de']
    .map((lang) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${origin}/${lang}" />`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}/en" />`)
    .join('\n')

const sitemapUrl = (loc: string, alternates = '') => `  <url>
    <loc>${loc}</loc>
${alternates ? `${alternates}\n` : ''}    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`

const makeSitemap = (siteOrigin: string, extraUrls: string[] = []) => {
  const alternates = languageAlternates(siteOrigin)
  const languageUrls = ['en', 'pl', 'de'].map((lang) => sitemapUrl(`${siteOrigin}/${lang}`, alternates))
  const remainingUrls = extraUrls.map((loc) => sitemapUrl(loc).replace('<priority>1.0</priority>', '<priority>0.5</priority>'))
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
${languageUrls.concat(remainingUrls).join('\n\n')}
</urlset>
`
}

const makeMyIdeaExtraSitemapUrls = [
  'https://www.makemyidea.work/login',
  'https://www.makemyidea.work/privacy',
  'https://www.makemyidea.work/blog',
  'https://www.makemyidea.work/blog/you-dont-need-more-ideas-you-need-better-questions-pl',
  'https://www.makemyidea.work/blog/you-dont-need-more-ideas-you-need-better-questions-en',
  'https://www.makemyidea.work/blog/from-sales-pitch-to-action-plan-in-15-minutes-pl',
  'https://www.makemyidea.work/blog/from-sales-pitch-to-action-plan-in-15-minutes-en',
  'https://www.makemyidea.work/blog/can-ai-save-your-weekend-pl',
  'https://www.makemyidea.work/blog/can-ai-save-your-weekend-en',
]

export const config = {
  matcher: '/:path*',
}

const rewriteTo = (url: URL) =>
  new Response(null, {
    headers: {
      'x-middleware-rewrite': url.toString(),
    },
  })

export default function middleware(request: Request) {
  const url = new URL(request.url)
  const site = resolveSite(url.hostname)

  if (
    url.hostname === site.canonicalDisplayHost &&
    (url.hostname === 'makemyidea.work' || url.hostname === 'makemyproblem.work')
  ) {
    url.hostname = site.canonicalHost
    if (url.pathname === '/') {
      url.pathname = '/en'
    }
    return Response.redirect(url, 308)
  }

  if (url.pathname === '/robots.txt') {
    return new Response(`User-agent: *
Allow: /

Sitemap: ${site.canonicalUrl}/sitemap.xml
`, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  if (url.pathname === '/sitemap.xml') {
    const sitemap =
      site.id === 'makeMyIdea'
        ? makeSitemap(site.canonicalUrl, makeMyIdeaExtraSitemapUrls)
        : makeSitemap(site.canonicalUrl)
    return new Response(sitemap, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
      },
    })
  }

  if (site.id === 'makeMyIdea' || site.id === 'makeMyProblem') {
    const languageMatch = url.pathname.match(/^\/([a-z]{2})\/?$/i)

    if (url.pathname === '/') {
      url.pathname = '/en'
      return Response.redirect(url, 308)
    }

    if (!languageMatch) return

    const language = languageMatch[1].toLowerCase()
    const canonicalPathname = `/${language}`

    if (!publicLandingLanguages.has(language)) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    if (url.pathname !== canonicalPathname) {
      url.pathname = canonicalPathname
      return Response.redirect(url, 308)
    }

    const siteDir = site.id === 'makeMyIdea' ? 'makemyidea' : 'makemyproblem'
    url.pathname = `/_sites/${siteDir}/${language}/index.html`
    return rewriteTo(url)
  }
}
