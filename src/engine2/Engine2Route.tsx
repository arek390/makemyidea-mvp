import type { ComponentType } from 'react'
import { Engine2Page, type Engine2Copy } from './Engine2Page'

type LandingLang = 'en' | 'pl' | 'de'

type Engine2RouteProps = {
  EngineHeader: ComponentType<any>
  logoUrl: string
  copy: Record<string, any> & { engine2: Engine2Copy }
  uiLanguage: string
  isAuthed: boolean
  isAdmin: boolean
  logoutInProgress: boolean
  billingLoading: boolean
  billingError: string | null
  billingBalanceMinor: number
  billingBalanceOverrideMinor: number | null
  insufficientBalanceActive: boolean
  engineNotice: { message: string; variant: 'success' | 'error' } | null
  showDiagnostics: boolean
  aiSupportEnabled: boolean
  showSessionUsage: boolean
  llmUsageClass: string
  currentTokensTotal: number
  totalCostUsd: number
  totalCostPln: number | null
  sessionUsage: unknown
  modelUsageEntries: unknown[]
  diagnosticsAuthEmail: string | null
  authDisabled: boolean
  missingSupabaseEnvMessage: string
  isDiagEnabled: boolean
  publicLoginHref?: string
  adminEngineSwitcher?: 'engine1' | 'engine2'
  onAdminClick: () => void
  onLogout: () => void
  onToggleDiagnostics: () => void
  onToggleAiSupport: () => void
  formatBalanceMinor: (minor: number) => string
  formatTokenTotal: (value: number) => string
  formatUsd: (value: number) => string
  formatPln: (value: number) => string
  getAccessToken: () => Promise<string>
}

const MAKE_MY_PROBLEM_LANDING_LANGUAGE_STORAGE_KEY = 'makemyproblem-landing-language'

const isLandingLang = (value: string | null): value is LandingLang =>
  value === 'en' || value === 'pl' || value === 'de'

const resolveLandingLang = (uiLanguage: string): LandingLang => {
  if (typeof window !== 'undefined') {
    const savedLandingLang = window.localStorage.getItem(MAKE_MY_PROBLEM_LANDING_LANGUAGE_STORAGE_KEY)
    if (isLandingLang(savedLandingLang)) return savedLandingLang
  }
  return uiLanguage === 'Polish' ? 'pl' : 'en'
}

const resolveNav = (lang: LandingLang) => {
  if (lang === 'pl') {
    return {
      home: 'Start',
      howItWorks: 'Jak to działa',
      examples: 'Przykłady',
      pricing: 'Cennik',
      about: 'O nas',
    }
  }
  if (lang === 'de') {
    return {
      home: 'Start',
      howItWorks: 'So funktioniert es',
      examples: 'Beispiele',
      pricing: 'Preise',
      about: 'Über uns',
    }
  }
  return {
    home: 'Home',
    howItWorks: 'How It Works',
    examples: 'Examples',
    pricing: 'Pricing',
    about: 'About',
  }
}

export function Engine2Route(props: Engine2RouteProps) {
  const {
    copy,
    uiLanguage,
    isAuthed,
    isAdmin,
    authDisabled,
    missingSupabaseEnvMessage,
    publicLoginHref,
    onAdminClick,
    onLogout,
    aiSupportEnabled,
    showDiagnostics,
    getAccessToken,
  } = props
  const landingLang = resolveLandingLang(uiLanguage)
  const nav = resolveNav(landingLang)

  return (
    <div className="app engine2-shell" data-testid="public-engine-preview">
      <header className="engine2-site-header" aria-label="Primary navigation">
        <div className="engine2-site-header__inner">
          <a className="engine2-site-header__logo-link" href={`/${landingLang}`} aria-label="MakeMyProblem.Work home">
            <img
              className="engine2-site-header__logo"
              src="/logo/logo_makemyproblemwork_transp.png"
              alt="MakeMyProblem.Work"
            />
          </a>
          <input className="engine2-site-header__toggle" id="engine2-site-header-menu-toggle" type="checkbox" />
          <label
            className="engine2-site-header__toggle-button"
            htmlFor="engine2-site-header-menu-toggle"
            aria-label="Open menu"
          >
            <span />
          </label>
          <nav className="engine2-site-header__menu" aria-label="Primary menu">
            <a className="engine2-site-header__link" href={`/${landingLang}#home`}>{nav.home}</a>
            <a className="engine2-site-header__link" href={`/${landingLang}#how-it-works`}>{nav.howItWorks}</a>
            <a className="engine2-site-header__link" href={`/${landingLang}#examples`}>{nav.examples}</a>
            <a className="engine2-site-header__link" href={`/${landingLang}#pricing`}>{nav.pricing}</a>
            <a className="engine2-site-header__link" href="https://www.aremai.tech">{nav.about}</a>
            {!isAuthed ? (
              <a className="engine2-site-header__login" href={publicLoginHref || '/login?returnTo=%2Fengine_2'}>
                {copy.landingLoginCta}
              </a>
            ) : (
              <>
                {isAdmin && (
                  <button className="engine2-site-header__link engine2-site-header__button" type="button" onClick={onAdminClick}>
                    {copy.adminNavLabel}
                  </button>
                )}
                <button className="engine2-site-header__login engine2-site-header__button" type="button" onClick={onLogout}>
                  {copy.auth.logout}
                </button>
              </>
            )}
          </nav>
        </div>
      </header>
      {authDisabled && (
        <div className="engine-error engine-public-notice" role="status">
          {missingSupabaseEnvMessage}
        </div>
      )}
      <Engine2Page
        copy={copy.engine2}
        language={uiLanguage === 'Polish' ? 'pl' : 'en'}
        aiSupportEnabled={aiSupportEnabled}
        diagnosticsEnabled={showDiagnostics}
        getAccessToken={getAccessToken}
      />
    </div>
  )
}
