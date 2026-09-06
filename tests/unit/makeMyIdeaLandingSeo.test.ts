import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import middleware from '../../middleware'
import {
  makeSiteAwareLegalText,
  makeSiteAwarePrivacyPolicyBody,
  termsAndConditionsEn,
  termsAndConditionsPl,
} from '../../src/legal/termsAndConditions'
import { publicPages } from '../../src/sites/publicPages'

const makeMyIdeaPages = publicPages.filter((page) => page.siteId === 'makeMyIdea')
const makeMyProblemUseCasePaths = [
  '/en/use-cases/conflicting-technical-requirements',
  '/en/use-cases/technical-customer-complaint',
] as const
const callMiddleware = (url: string) => middleware(new Request(url))

const getMakeMyIdeaPage = (language: 'en' | 'pl' | 'de') => {
  const page = makeMyIdeaPages.find((candidate) => candidate.lang === language)

  expect(page).toBeDefined()

  return page as (typeof makeMyIdeaPages)[number]
}

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

  it('keeps MakeMyIdea title, heading and metadata unchanged', () => {
    expect(getMakeMyIdeaPage('en')).toMatchObject({
      title: 'MakeMyIdea.Work - Develop stronger product ideas',
      description:
        'MakeMyIdea.Work helps you shape product ideas into clearer scenarios, questions, decisions and action plans.',
      heading: 'Develop stronger product ideas with MakeMyIdea.Work',
    })
    expect(getMakeMyIdeaPage('pl')).toMatchObject({
      title: 'MakeMyIdea.Work - Rozwijaj lepsze pomysły produktowe',
      description:
        'MakeMyIdea.Work pomaga zamieniać pomysły produktowe w klarowniejsze scenariusze, pytania, decyzje i plany działania.',
      heading: 'Rozwijaj lepsze pomysły produktowe z MakeMyIdea.Work',
    })
    expect(getMakeMyIdeaPage('de')).toMatchObject({
      title: 'MakeMyIdea.Work - Entwickle stärkere Produktideen',
      description:
        'MakeMyIdea.Work hilft, Produktideen in klarere Szenarien, Fragen, Entscheidungen und Aktionspläne zu überführen.',
      heading: 'Entwickle stärkere Produktideen mit MakeMyIdea.Work',
    })
  })

  it('does not include new MakeMyProblem landing copy fragments', () => {
    const makeMyIdeaContent = makeMyIdeaPages
      .map((page) => [
        page.title,
        page.description,
        'heading' in page ? page.heading : '',
        'body' in page ? page.body.join('\n') : '',
      ].join('\n'))
      .join('\n')

    expect(makeMyIdeaContent).not.toContain('AI Technical Problem Solving')
    expect(makeMyIdeaContent).not.toContain('technical problems')
    expect(makeMyIdeaContent).not.toContain('rozwiązywania problemów technicznych')
    expect(makeMyIdeaContent).not.toContain('problemy techniczne')
    expect(makeMyIdeaContent).not.toContain('technische Problemlösung')
    expect(makeMyIdeaContent).not.toContain('technische Probleme')
  })

  it('does not receive MakeMyProblem JSON-LD or Aremai publisher structured data', () => {
    const makeMyIdeaContent = makeMyIdeaPages
      .map((page) =>
        [
          page.title,
          page.description,
          'heading' in page ? page.heading : '',
          'body' in page ? page.body.join('\n') : '',
          'bodyHtml' in page ? page.bodyHtml : '',
        ].join('\n')
      )
      .join('\n')

    expect(makeMyIdeaContent).not.toContain('application/ld+json')
    expect(makeMyIdeaContent).not.toContain('"@type":"WebApplication"')
    expect(makeMyIdeaContent).not.toContain('"name":"MakeMyProblem"')
    expect(makeMyIdeaContent).not.toContain('"publisher"')
    expect(makeMyIdeaContent).not.toContain('"name":"Aremai"')
  })

  it('does not receive MakeMyProblem use-case page templates or draft content', () => {
    const makeMyIdeaContent = makeMyIdeaPages
      .map((page) =>
        [
          page.title,
          page.description,
          'heading' in page ? page.heading : '',
          'body' in page ? page.body.join('\n') : '',
          'bodyHtml' in page ? page.bodyHtml : '',
        ].join('\n')
      )
      .join('\n')

    expect(makeMyIdeaContent).not.toContain('use-case-page')
    expect(makeMyIdeaContent).not.toContain('DEVELOPMENT-ONLY')
    expect(makeMyIdeaContent).not.toContain('Conflicting technical requirements')
    expect(makeMyIdeaContent).not.toContain('Technical customer complaint')
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
      expect(response?.headers.get('X-Robots-Tag')).toBeNull()
    }
  })

  it('does not apply MakeMyProblem noindex policy to MakeMyIdea routes', () => {
    for (const route of ['/engine_2', '/login', '/topup', '/privacy/en', '/termsandconditions/en']) {
      const response = callMiddleware(`https://www.makemyidea.work${route}`)

      expect(response?.headers.get('X-Robots-Tag')).toBeUndefined()
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

  it('does not render MakeMyProblem use-case pages on MakeMyIdea host', () => {
    for (const path of makeMyProblemUseCasePaths) {
      const response = callMiddleware(`https://www.makemyidea.work${path}`)

      expect(response).toBeUndefined()
    }
  })

  it('serves a host-specific MakeMyIdea sitemap', async () => {
    const response = callMiddleware('https://www.makemyidea.work/sitemap.xml')
    const sitemap = await response?.text()

    expect(response?.status).toBe(200)
    expect(sitemap).toContain('<loc>https://www.makemyidea.work/en</loc>')
    expect(sitemap).toContain('<loc>https://www.makemyidea.work/pl</loc>')
    expect(sitemap).toContain('<loc>https://www.makemyidea.work/de</loc>')
    expect(sitemap).toContain('hreflang="x-default" href="https://www.makemyidea.work/en"')
    expect(sitemap).not.toContain('/en/use-cases/conflicting-technical-requirements')
    expect(sitemap).not.toContain('/en/use-cases/technical-customer-complaint')
    expect(sitemap).not.toContain('makemyproblem.work')
  })
})

describe('MakeMyIdea legal regression', () => {
  it('keeps MakeMyIdea naming in legal copy', () => {
    const privacyBody = makeSiteAwarePrivacyPolicyBody('en', 'MakeMyIdea.work').join('\n')
    const englishTerms = makeSiteAwareLegalText(termsAndConditionsEn, 'MakeMyIdea.work')
    const polishTerms = makeSiteAwareLegalText(termsAndConditionsPl, 'MakeMyIdea.work')

    expect(privacyBody).toContain('MakeMyIdea.work')
    expect(englishTerms).toContain('MakeMyIdea.work')
    expect(polishTerms).toContain('MakeMyIdea.work')
    expect(englishTerms).toContain('https://makemyidea.work')
    expect(polishTerms).toContain('https://makemyidea.work')
    expect(`${privacyBody}\n${englishTerms}\n${polishTerms}`).not.toContain('MakeMyProblem.work')
  })
})
