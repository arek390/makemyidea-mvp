import type { SiteId } from './siteConfig'
import { siteConfigs } from './siteConfig'
import { makeMyProblemHomePage } from './makemyproblem/landing'

type PublicPageBase = {
  siteId: SiteId
  pathname: '/'
  title: string
  description: string
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

export const publicPages: readonly PublicPageDefinition[] = [
  {
    siteId: siteConfigs.makeMyIdea.id,
    pathname: '/',
    title: 'MakeMyIdea.Work - Develop stronger product ideas',
    description:
      'MakeMyIdea.Work helps you shape product ideas into clearer scenarios, questions, decisions and action plans.',
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
  makeMyProblemHomePage,
] as const
