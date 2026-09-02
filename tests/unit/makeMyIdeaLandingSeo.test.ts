import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import middleware from '../../middleware'
import { publicPages } from '../../src/sites/publicPages'

const makeMyIdeaPages = publicPages.filter((page) => page.siteId === 'makeMyIdea')
const callMiddleware = (url: string) => middleware(new Request(url))

describe('MakeMyIdea language landing pages', () => {
  it('defines crawlable EN, PL and DE pages with independent metadata', () => {
    expect(makeMyIdeaPages.map((page) => page.pathname).sort()).toEqual(['/de', '/en', '/pl'])

    for (const page of makeMyIdeaPages) {
      expect(page.lang).toBe(page.pathname.slice(1))
      expect(page.alternateLinks).toEqual([
        { hreflang: 'en', href: 'https://www.makemyidea.work/en' },
        { hreflang: 'pl', href: 'https://www.makemyidea.work/pl' },
        { hreflang: 'de', href: 'https://www.makemyidea.work/de' },
        { hreflang: 'x-default', href: 'https://www.makemyidea.work/en' },
      ])
    }

    expect(new Set(makeMyIdeaPages.map((page) => page.title)).size).toBe(3)
    expect(new Set(makeMyIdeaPages.map((page) => page.description)).size).toBe(3)
  })

  it('keeps language switch links, Engine 1 CTA and footer link destinations stable', () => {
    for (const page of makeMyIdeaPages) {
      expect(page.cta.href).toBe('/engine')
    }

    const route = readFileSync('src/engine1/Engine1LegacyRoute.tsx', 'utf8')
    expect(route).toContain('href={`/${language.lang}`}')
    expect(route).toContain('href="/privacy"')
    expect(route).toContain('href="/blog"')
    expect(route).toContain('href="/termsandconditions"')
    expect(route).toContain('href="mailto:makemyideawork@aremai.tech"')
  })

  it('uses the MakeMyProblem header and footer UI hooks without sharing product content', () => {
    const route = readFileSync('src/engine1/Engine1LegacyRoute.tsx', 'utf8')
    expect(route).toContain('className="landing-header-toggle"')
    expect(route).toContain('className="landing-bottom-bar"')
    expect(route).toContain('MakeMyIdea.Work')
    expect(route).not.toContain('MakeMyProblem.Work')
  })
})

describe('MakeMyIdea language routing middleware', () => {
  it('redirects root to EN', () => {
    const response = callMiddleware('https://www.makemyidea.work/')

    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('https://www.makemyidea.work/en')
  })

  it('rewrites supported language URLs to MakeMyIdea static landing pages', () => {
    for (const language of ['en', 'pl', 'de']) {
      const response = callMiddleware(`https://www.makemyidea.work/${language}`)

      expect(response?.headers.get('x-middleware-rewrite')).toBe(
        `https://www.makemyidea.work/_sites/makemyidea/${language}/index.html`
      )
    }
  })

  it('normalizes uppercase and trailing slash language URLs', () => {
    expect(callMiddleware('https://www.makemyidea.work/PL')?.headers.get('location')).toBe(
      'https://www.makemyidea.work/pl'
    )
    expect(callMiddleware('https://www.makemyidea.work/de/')?.headers.get('location')).toBe(
      'https://www.makemyidea.work/de'
    )
  })

  it('returns 404 for unsupported two-letter locale URLs', () => {
    for (const language of ['fr', 'es', 'it']) {
      const response = callMiddleware(`https://www.makemyidea.work/${language}`)

      expect(response?.status).toBe(404)
      expect(response?.headers.get('location')).toBeNull()
    }
  })

  it('redirects apex root directly to canonical EN', () => {
    const response = callMiddleware('https://makemyidea.work/')

    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('https://www.makemyidea.work/en')
  })

  it('keeps MakeMyProblem language URLs on the MakeMyProblem static pages', () => {
    const response = callMiddleware('https://www.makemyproblem.work/pl')

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://www.makemyproblem.work/_sites/makemyproblem/pl/index.html'
    )
  })

  it('serves a host-specific MakeMyIdea sitemap', async () => {
    const response = callMiddleware('https://www.makemyidea.work/sitemap.xml')
    const sitemap = await response?.text()

    expect(response?.status).toBe(200)
    expect(sitemap).toContain('<loc>https://www.makemyidea.work/en</loc>')
    expect(sitemap).toContain('<loc>https://www.makemyidea.work/pl</loc>')
    expect(sitemap).toContain('<loc>https://www.makemyidea.work/de</loc>')
    expect(sitemap).toContain('hreflang="x-default" href="https://www.makemyidea.work/en"')
    expect(sitemap).not.toContain('makemyproblem.work')
  })
})
