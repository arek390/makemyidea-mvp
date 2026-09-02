import type { SiteId } from './siteConfig'
import { siteConfigs } from './siteConfig'
import { makeMyProblemHomePages } from './makemyproblem/landing'

type PublicPageBase = {
  siteId: SiteId
  pathname: string
  lang?: 'en' | 'pl' | 'de'
  title: string
  description: string
  alternateLinks?: readonly {
    hreflang: 'en' | 'pl' | 'de' | 'x-default'
    href: string
  }[]
  cta: {
    label: string
    href: '/engine' | '/engine_2'
  }
}

export type BasicPublicPageDefinition = PublicPageBase & {
  heading: string
  body: string[]
}

export type HtmlPublicPageDefinition = PublicPageBase & {
  bodyHtml: string
  styles: string
}

export type PublicPageDefinition = BasicPublicPageDefinition | HtmlPublicPageDefinition

const makeMyIdeaAlternateLinks = [
  { hreflang: 'en', href: `${siteConfigs.makeMyIdea.canonicalUrl}/en` },
  { hreflang: 'pl', href: `${siteConfigs.makeMyIdea.canonicalUrl}/pl` },
  { hreflang: 'de', href: `${siteConfigs.makeMyIdea.canonicalUrl}/de` },
  { hreflang: 'x-default', href: `${siteConfigs.makeMyIdea.canonicalUrl}/en` },
] as const

export const publicPages: readonly PublicPageDefinition[] = [
  {
    siteId: siteConfigs.makeMyIdea.id,
    pathname: '/en',
    lang: 'en',
    title: 'MakeMyIdea.Work - Develop stronger product ideas',
    description:
      'MakeMyIdea.Work helps you shape product ideas into clearer scenarios, questions, decisions and action plans.',
    alternateLinks: makeMyIdeaAlternateLinks,
    heading: 'Develop stronger product ideas with MakeMyIdea.Work',
    body: [
      'Use a structured Engine 1 workspace to describe an idea, explore missing context and turn early thinking into a clearer action plan.',
      'This static page is generated at build time as the first proof of concept for crawlable MakeMyIdea public pages.',
    ],
    cta: {
      label: 'Open Engine 1',
      href: siteConfigs.makeMyIdea.primaryAppRoute,
    },
  },
  {
    siteId: siteConfigs.makeMyIdea.id,
    pathname: '/pl',
    lang: 'pl',
    title: 'MakeMyIdea.Work - Rozwijaj lepsze pomysły produktowe',
    description:
      'MakeMyIdea.Work pomaga zamieniać pomysły produktowe w klarowniejsze scenariusze, pytania, decyzje i plany działania.',
    alternateLinks: makeMyIdeaAlternateLinks,
    heading: 'Rozwijaj lepsze pomysły produktowe z MakeMyIdea.Work',
    body: [
      'Użyj uporządkowanego workspace Engine 1, aby opisać pomysł, sprawdzić brakujący kontekst i zamienić wczesne myślenie w jaśniejszy plan działania.',
      'Ta statyczna strona jest generowana podczas buildu jako pierwszy krok do crawlable public pages MakeMyIdea.',
    ],
    cta: {
      label: 'Otwórz Engine 1',
      href: siteConfigs.makeMyIdea.primaryAppRoute,
    },
  },
  {
    siteId: siteConfigs.makeMyIdea.id,
    pathname: '/de',
    lang: 'de',
    title: 'MakeMyIdea.Work - Entwickle stärkere Produktideen',
    description:
      'MakeMyIdea.Work hilft, Produktideen in klarere Szenarien, Fragen, Entscheidungen und Aktionspläne zu überführen.',
    alternateLinks: makeMyIdeaAlternateLinks,
    heading: 'Entwickle stärkere Produktideen mit MakeMyIdea.Work',
    body: [
      'Nutze einen strukturierten Engine-1-Workspace, um eine Idee zu beschreiben, fehlenden Kontext zu prüfen und frühes Denken in einen klareren Aktionsplan zu überführen.',
      'Diese statische Seite wird beim Build generiert als erster Schritt zu crawlbaren öffentlichen MakeMyIdea-Seiten.',
    ],
    cta: {
      label: 'Engine 1 öffnen',
      href: siteConfigs.makeMyIdea.primaryAppRoute,
    },
  },
  ...makeMyProblemHomePages,
] as const
