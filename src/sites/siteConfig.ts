export type SiteId = 'makeMyIdea' | 'makeMyProblem'

export type SiteConfig = {
  id: SiteId
  canonicalHost: string
  canonicalUrl: string
  canonicalDisplayHost: string
  brandName: string
  primaryAppRoute: '/engine' | '/engine_2'
}

const makeMyIdeaSiteConfig: SiteConfig = Object.freeze({
  id: 'makeMyIdea',
  canonicalHost: 'www.makemyidea.work',
  canonicalUrl: 'https://www.makemyidea.work',
  canonicalDisplayHost: 'makemyidea.work',
  brandName: 'MakeMyIdea.Work',
  primaryAppRoute: '/engine',
})

const makeMyProblemSiteConfig: SiteConfig = Object.freeze({
  id: 'makeMyProblem',
  canonicalHost: 'www.makemyproblem.work',
  canonicalUrl: 'https://www.makemyproblem.work',
  canonicalDisplayHost: 'makemyproblem.work',
  brandName: 'MakeMyProblem.Work',
  primaryAppRoute: '/engine_2',
})

export const siteConfigs: Readonly<Record<SiteId, SiteConfig>> = Object.freeze({
  makeMyIdea: makeMyIdeaSiteConfig,
  makeMyProblem: makeMyProblemSiteConfig,
})

const makeMyIdeaHosts = new Set([
  'makemyidea.work',
  'www.makemyidea.work',
  'makemyidea.localhost',
  'localhost',
  '127.0.0.1',
])

const makeMyProblemHosts = new Set([
  'makemyproblem.work',
  'www.makemyproblem.work',
  'makemyproblem.localhost',
])

export function resolveSite(hostname: string): SiteConfig {
  const normalizedHostname = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')

  if (makeMyProblemHosts.has(normalizedHostname)) {
    return siteConfigs.makeMyProblem
  }
  if (makeMyIdeaHosts.has(normalizedHostname)) {
    return siteConfigs.makeMyIdea
  }

  return siteConfigs.makeMyIdea
}
