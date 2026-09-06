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
const makeMyProblemLandingPages = makeMyProblemPages.filter((page) => ['/en', '/pl', '/de'].includes(page.pathname))
const makeMyProblemUseCasePaths = [
  '/en/use-cases/conflicting-technical-requirements',
  '/en/use-cases/technical-customer-complaint',
] as const

const callMiddleware = (url: string) => middleware(new Request(url))

const getMakeMyProblemPage = (language: 'en' | 'pl' | 'de') => {
  const page = makeMyProblemLandingPages.find((candidate) => candidate.lang === language)

  expect(page).toBeDefined()
  expect(page).toHaveProperty('bodyHtml')

  return page as (typeof makeMyProblemPages)[number] & { bodyHtml: string }
}

const getJsonLdBlocks = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1] || '{}')
  )

const getMakeMyProblemUseCasePage = (pathname: (typeof makeMyProblemUseCasePaths)[number]) => {
  const page = makeMyProblemPages.find((candidate) => candidate.pathname === pathname)

  expect(page).toBeDefined()
  expect(page).toHaveProperty('bodyHtml')

  return page as (typeof makeMyProblemPages)[number] & { bodyHtml: string }
}

describe('MakeMyProblem language landing pages', () => {
  it('defines crawlable EN, PL and DE pages with independent metadata', () => {
    expect(makeMyProblemLandingPages.map((page) => page.pathname).sort()).toEqual(['/de', '/en', '/pl'])

    for (const page of makeMyProblemLandingPages) {
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

    expect(new Set(makeMyProblemLandingPages.map((page) => page.title)).size).toBe(3)
    expect(new Set(makeMyProblemLandingPages.map((page) => page.description)).size).toBe(3)
  })

  it('uses technical positioning in titles while keeping hero H1 copy stable', () => {
    expect(getMakeMyProblemPage('en').title).toBe('AI Technical Problem Solving & Action Plans | MakeMyProblem')
    expect(getMakeMyProblemPage('pl').title).toBe('AI do rozwiązywania problemów technicznych | MakeMyProblem')
    expect(getMakeMyProblemPage('de').title).toBe('KI für technische Problemlösung | MakeMyProblem')

    expect(getMakeMyProblemPage('en').bodyHtml).toContain('<h1 id="hero-title">Got a problem? Let’s work it out.</h1>')
    expect(getMakeMyProblemPage('pl').bodyHtml).toContain('<h1 id="hero-title">Masz problem? Rozwiążmy go.</h1>')
    expect(getMakeMyProblemPage('de').bodyHtml).toContain(
      '<h1 id="hero-title">Hast du ein Problem? Lass es uns lösen.</h1>'
    )
  })

  it('clarifies technical AI-assisted problem solving in hero supporting copy', () => {
    expect(getMakeMyProblemPage('en').description).toContain('engineers and technical teams')
    expect(getMakeMyProblemPage('en').description).toContain('technical problems')
    expect(getMakeMyProblemPage('en').description).toContain('AI-guided conversation')
    expect(getMakeMyProblemPage('en').bodyHtml).toContain('AI technical problem solving')
    expect(getMakeMyProblemPage('en').bodyHtml).toContain('engineers and technical teams')
    expect(getMakeMyProblemPage('en').bodyHtml).toContain('technical problems')
    expect(getMakeMyProblemPage('en').bodyHtml).toContain('concrete action plan')

    expect(getMakeMyProblemPage('pl').description).toContain('inżynierom i zespołom technicznym')
    expect(getMakeMyProblemPage('pl').description).toContain('problemy techniczne')
    expect(getMakeMyProblemPage('pl').description).toContain('AI')
    expect(getMakeMyProblemPage('pl').bodyHtml).toContain('inżynierom i zespołom technicznym')
    expect(getMakeMyProblemPage('pl').bodyHtml).toContain('z pomocą AI')
    expect(getMakeMyProblemPage('pl').bodyHtml).toContain('konkretny plan działania')

    expect(getMakeMyProblemPage('de').description).toContain('Ingenieure und technische Teams')
    expect(getMakeMyProblemPage('de').description).toContain('technische Probleme')
    expect(getMakeMyProblemPage('de').description).toContain('KI-gestützten Gespräch')
    expect(getMakeMyProblemPage('de').bodyHtml).toContain('Ingenieure und technische Teams')
    expect(getMakeMyProblemPage('de').bodyHtml).toContain('technische Probleme')
    expect(getMakeMyProblemPage('de').bodyHtml).toContain('konkreten Aktionsplan')
  })

  it('renders language switch links and keeps CTA pointed at Engine 2', () => {
    for (const page of makeMyProblemLandingPages) {
      const language = page.pathname.slice(1)
      expect(page.bodyHtml).toContain('href="/en"')
      expect(page.bodyHtml).toContain('href="/pl"')
      expect(page.bodyHtml).toContain('href="/de"')
      expect(page.bodyHtml).toContain(`href="/privacy/${language}"`)
      expect(page.bodyHtml).toContain(`href="/termsandconditions/${language}"`)
      expect(page.bodyHtml).toContain('href="/engine_2"')
    }
  })

  it('renders one WebApplication JSON-LD block for each language landing page', () => {
    const expectedByLanguage = {
      en: {
        url: 'https://www.makemyproblem.work/en',
        description:
          'MakeMyProblem.Work helps engineers and technical teams clarify technical problems through a short AI-guided conversation and turn them into focused next actions.',
      },
      pl: {
        url: 'https://www.makemyproblem.work/pl',
        description:
          'MakeMyProblem.Work pomaga inżynierom i zespołom technicznym doprecyzować problemy techniczne w krótkiej rozmowie wspieranej przez AI i przejść do konkretnych działań.',
      },
      de: {
        url: 'https://www.makemyproblem.work/de',
        description:
          'MakeMyProblem.Work unterstützt Ingenieure und technische Teams dabei, technische Probleme in einem kurzen KI-gestützten Gespräch zu klären und konkrete nächste Schritte abzuleiten.',
      },
    } as const

    for (const language of ['en', 'pl', 'de'] as const) {
      const blocks = getJsonLdBlocks(getMakeMyProblemPage(language).bodyHtml)

      expect(blocks).toHaveLength(1)
      expect(blocks[0]).toMatchObject({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'MakeMyProblem',
        url: expectedByLanguage[language].url,
        description: expectedByLanguage[language].description,
        inLanguage: language,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web browser',
        publisher: {
          '@type': 'Organization',
          name: 'Aremai',
          url: 'https://www.aremai.tech',
        },
      })
      expect(blocks[0]).not.toHaveProperty('offers')
      expect(blocks[0]).not.toHaveProperty('aggregateRating')
      expect(blocks[0]).not.toHaveProperty('review')
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

  it('routes draft MakeMyProblem use-case pages to static HTML with temporary noindex', () => {
    for (const path of makeMyProblemUseCasePaths) {
      const response = callMiddleware(`https://www.makemyproblem.work${path}`)

      expect(response?.headers.get('x-middleware-rewrite')).toBe(
        `https://www.makemyproblem.work/_sites/makemyproblem${path}/index.html`
      )
      expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    }
  })
})

describe('MakeMyProblem draft use-case pages', () => {
  it('defines the two EN-only draft use-case pages as non-indexable public pages', () => {
    for (const path of makeMyProblemUseCasePaths) {
      const page = getMakeMyProblemUseCasePage(path)

      expect(page.lang).toBe('en')
      expect(page.indexable).toBe(false)
      expect(page.title).toContain('DEVELOPMENT-ONLY')
      expect(page.description).toContain('Final SEO copy is not published yet')
      expect(page.alternateLinks).toEqual([{ hreflang: 'en', href: `https://www.makemyproblem.work${path}` }])
      expect(page.cta.href).toBe('/engine_2')
    }
  })

  it('renders reusable MakeMyProblem structure without use-case JSON-LD or final examples', () => {
    for (const path of makeMyProblemUseCasePaths) {
      const page = getMakeMyProblemUseCasePage(path)

      expect(page.bodyHtml).toContain('class="site-header"')
      expect(page.bodyHtml).toContain('class="site-header__logo"')
      expect(page.bodyHtml).toContain('class="use-case-page"')
      expect(page.bodyHtml).toContain('class="use-case-hero"')
      expect(page.bodyHtml).toContain('Problem situation')
      expect(page.bodyHtml).toContain('What makes this difficult')
      expect(page.bodyHtml).toContain('How MakeMyProblem helps')
      expect(page.bodyHtml).toContain('Example scenario')
      expect(page.bodyHtml).toContain('Example output / action plan')
      expect(page.bodyHtml).toContain('When this use case fits')
      expect(page.bodyHtml).toContain('class="final-cta"')
      expect(page.bodyHtml).toContain('class="site-footer"')
      expect(page.bodyHtml).toContain('href="/engine_2"')
      expect(page.bodyHtml).not.toContain('application/ld+json')
      expect(page.bodyHtml).not.toContain('Lorem ipsum')
      expect(page.bodyHtml).not.toContain('TODO')
      expect(page.bodyHtml).not.toContain('PLACEHOLDER')
    }
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
    expect(sitemap).not.toContain('/en/use-cases/conflicting-technical-requirements')
    expect(sitemap).not.toContain('/en/use-cases/technical-customer-complaint')
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
