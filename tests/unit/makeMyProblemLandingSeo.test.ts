import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import middleware from '../../middleware'
import {
  makeSiteAwareLegalText,
  makeSiteAwarePrivacyPolicyBody,
  termsAndConditionsDe,
  termsAndConditionsEn,
  termsAndConditionsPl,
} from '../../src/legal/termsAndConditions'
import { publicPages } from '../../src/sites/publicPages'

const makeMyProblemPages = publicPages.filter((page) => page.siteId === 'makeMyProblem')

const callMiddleware = (url: string) => middleware(new Request(url))

describe('MakeMyProblem language landing pages', () => {
  it('defines crawlable EN, PL and DE pages with independent metadata', () => {
    expect(makeMyProblemPages.map((page) => page.pathname).sort()).toEqual(['/de', '/en', '/pl'])

    for (const page of makeMyProblemPages) {
      const language = page.pathname.slice(1)
      expect(page.lang).toBe(language)
      expect(page.title).not.toEqual('')
      expect(page.description).not.toEqual('')
      expect(page.alternateLinks).toEqual([
        { hreflang: 'en', href: 'https://www.makemyproblem.work/en' },
        { hreflang: 'pl', href: 'https://www.makemyproblem.work/pl' },
        { hreflang: 'de', href: 'https://www.makemyproblem.work/de' },
        { hreflang: 'x-default', href: 'https://www.makemyproblem.work/en' },
      ])
    }

    expect(new Set(makeMyProblemPages.map((page) => page.title)).size).toBe(3)
    expect(new Set(makeMyProblemPages.map((page) => page.description)).size).toBe(3)
  })

  it('renders language switch links and keeps CTA pointed at Engine 2', () => {
    for (const page of makeMyProblemPages) {
      const language = page.pathname.slice(1)
      expect(page.bodyHtml).toContain('href="/en"')
      expect(page.bodyHtml).toContain('href="/pl"')
      expect(page.bodyHtml).toContain('href="/de"')
      expect(page.bodyHtml).toContain(`href="/privacy/${language}"`)
      expect(page.bodyHtml).toContain(`href="/termsandconditions/${language}"`)
      expect(page.bodyHtml).toContain('href="/engine_2"')
    }
  })
})

describe('MakeMyProblem language routing middleware', () => {
  it('redirects the MakeMyProblem root to the English landing page', () => {
    const response = callMiddleware('https://www.makemyproblem.work/')

    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('https://www.makemyproblem.work/en')
  })

  it('rewrites supported language URLs to their static landing pages', () => {
    for (const language of ['en', 'pl', 'de']) {
      const response = callMiddleware(`https://www.makemyproblem.work/${language}`)

      expect(response?.headers.get('x-middleware-rewrite')).toBe(
        `https://www.makemyproblem.work/_sites/makemyproblem/${language}/index.html`
      )
      expect(response?.headers.get('X-Robots-Tag')).toBeNull()
    }
  })

  it('marks MakeMyProblem app and private SPA routes as noindex, follow', () => {
    const noindexRoutes = [
      '/engine_2',
      '/login',
      '/topup',
      '/app',
      '/app/session/example',
      '/report',
      '/sessions/example/report',
      '/auth/callback',
    ]

    for (const route of noindexRoutes) {
      const response = callMiddleware(`https://www.makemyproblem.work${route}`)

      expect(response?.headers.get('x-middleware-next')).toBe('1')
      expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    }
  })

  it('marks MakeMyProblem legal pages as noindex, follow', () => {
    const legalRoutes = [
      '/privacy/en',
      '/privacy/pl',
      '/privacy/de',
      '/termsandconditions/en',
      '/termsandconditions/pl',
      '/termsandconditions/de',
    ]

    for (const route of legalRoutes) {
      const response = callMiddleware(`https://www.makemyproblem.work${route}`)

      expect(response?.headers.get('x-middleware-next')).toBe('1')
      expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    }
  })

  it('normalizes uppercase and trailing slash language URLs', () => {
    expect(callMiddleware('https://www.makemyproblem.work/PL')?.headers.get('location')).toBe(
      'https://www.makemyproblem.work/pl'
    )
    expect(callMiddleware('https://www.makemyproblem.work/de/')?.headers.get('location')).toBe(
      'https://www.makemyproblem.work/de'
    )
  })

  it('returns 404 for unsupported two-letter locale URLs', () => {
    for (const language of ['fr', 'es', 'it']) {
      const response = callMiddleware(`https://www.makemyproblem.work/${language}`)

      expect(response?.status).toBe(404)
      expect(response?.headers.get('location')).toBeNull()
    }
  })

  it('redirects MakeMyProblem apex root directly to canonical EN', () => {
    const response = callMiddleware('https://makemyproblem.work/')

    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('https://www.makemyproblem.work/en')
  })

  it('does not serve MakeMyProblem landing pages on MakeMyIdea host', () => {
    const response = callMiddleware('https://www.makemyidea.work/en')

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://www.makemyidea.work/_sites/makemyidea/en/index.html'
    )
  })
})

describe('MakeMyProblem sitemap and robots', () => {
  it('does not keep a mixed static sitemap fallback in public assets', () => {
    expect(existsSync('public/sitemap.xml')).toBe(false)
  })

  it('serves a host-specific MakeMyProblem sitemap', async () => {
    const response = callMiddleware('https://www.makemyproblem.work/sitemap.xml')
    const sitemap = await response?.text()

    expect(response?.status).toBe(200)
    expect(sitemap).toContain('<loc>https://www.makemyproblem.work/en</loc>')
    expect(sitemap).toContain('<loc>https://www.makemyproblem.work/pl</loc>')
    expect(sitemap).toContain('<loc>https://www.makemyproblem.work/de</loc>')
    expect(sitemap).toContain('hreflang="x-default" href="https://www.makemyproblem.work/en"')
    expect(sitemap).not.toContain('makemyidea.work')
  })

  it('does not block indexing in robots and points to the MakeMyProblem sitemap URL', () => {
    const robots = readFileSync('public/robots.txt', 'utf8')

    expect(robots).toContain('Allow: /')
    expect(robots).toContain('Sitemap: https://www.makemyproblem.work/sitemap.xml')
    expect(robots).not.toMatch(/Disallow:\s*\/(?:en|pl|de|engine_2|login|topup|privacy|termsandconditions)/)
  })
})

describe('MakeMyProblem legal site awareness', () => {
  it('uses MakeMyProblem naming in privacy policy copy', () => {
    for (const language of ['en', 'pl', 'de'] as const) {
      const body = makeSiteAwarePrivacyPolicyBody(language, 'MakeMyProblem.work').join('\n')

      expect(body).toContain('MakeMyProblem.work')
      expect(body).not.toContain('MakeMyIdea.work')
    }
  })

  it('uses MakeMyProblem naming in terms copy without changing legal structure', () => {
    for (const terms of [termsAndConditionsEn, termsAndConditionsPl, termsAndConditionsDe]) {
      const body = makeSiteAwareLegalText(terms, 'MakeMyProblem.work')

      expect(body).toContain('MakeMyProblem.work')
      expect(body).toContain('https://www.makemyproblem.work')
      expect(body).not.toContain('MakeMyIdea.work')
      expect(body).not.toContain('https://makemyidea.work')
      expect(body).not.toContain('https://makemyproblem.work')
    }
  })
})
