import type { Language, Translations } from '../content/copy'
import type { ModelUsage, SessionUsage } from '../App'

export type EngineHeaderProps = {
  logoUrl: string
  copy: Translations
  uiLanguage: Language
  isAuthed: boolean
  isAdmin: boolean
  logoutInProgress: boolean
  billingLoading: boolean
  billingError: string | null
  billingBalanceMinor: number
  billingBalanceOverrideMinor: number | null
  insufficientBalanceActive: boolean
  engineNotice: { message: string; variant: 'success' | 'error' } | null
  showBalance: boolean
  showWorkspaceActions: boolean
  canStartNewSession: boolean
  showDiagnostics: boolean
  aiSupportEnabled: boolean
  showSessionUsage: boolean
  llmUsageClass: string
  currentTokensTotal: number
  totalCostUsd: number
  totalCostPln: number | null
  sessionUsage: SessionUsage
  modelUsageEntries: [string, ModelUsage][]
  diagnosticsAuthEmail: string | null
  publicLoginHref?: string
  adminEngineSwitcher?: 'engine1' | 'engine2'
  onBalanceClick: () => void
  onSaveSession: () => void
  onStartNewSession: () => void
  onAdminClick: () => void
  onLogout: () => void
  onToggleDiagnostics: () => void
  onToggleAiSupport: () => void
  formatBalanceMinor: (minor: number) => string
  formatTokenTotal: (value: number) => string
  formatUsd: (value: number) => string
  formatPln: (value: number) => string
  isDiagEnabled: boolean
}

export function EngineHeader({
  logoUrl,
  copy,
  uiLanguage,
  isAuthed,
  isAdmin,
  logoutInProgress,
  billingLoading,
  billingError,
  billingBalanceMinor,
  billingBalanceOverrideMinor,
  insufficientBalanceActive,
  engineNotice,
  showBalance,
  showWorkspaceActions,
  canStartNewSession,
  showDiagnostics,
  aiSupportEnabled,
  showSessionUsage,
  llmUsageClass,
  currentTokensTotal,
  totalCostUsd,
  totalCostPln,
  sessionUsage,
  modelUsageEntries,
  diagnosticsAuthEmail,
  publicLoginHref,
  adminEngineSwitcher,
  onBalanceClick,
  onSaveSession,
  onStartNewSession,
  onAdminClick,
  onLogout,
  onToggleDiagnostics,
  onToggleAiSupport,
  formatBalanceMinor,
  formatTokenTotal,
  formatUsd,
  formatPln,
  isDiagEnabled,
}: EngineHeaderProps) {
  return (
    <header className="engine-header">
      <div>
        <a className="engine-header-logo" href="/" aria-label="MakeMyIdea.Work">
          <img src={logoUrl} alt="MakeMyIdea.Work" />
        </a>
      </div>
      {showBalance && isAuthed && !logoutInProgress && (
        <div className="engine-header-balance" aria-live="polite">
          <div className="engine-balance-row">
            <div
              className={`engine-balance${billingLoading || billingError ? ' engine-balance--loading' : ''}`}
              role="button"
              tabIndex={0}
              onClick={onBalanceClick}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onBalanceClick()
                }
              }}
            >
              <button
                type="button"
                className="engine-balance-icon"
                aria-label={
                  uiLanguage === 'Polish'
                    ? 'Doładuj saldo (usługowe) z obowiązkiem zapłaty'
                    : 'Top up service balance with obligation to pay'
                }
              >
                💰
              </button>
              <span className="engine-balance-value">
                {billingLoading || billingError
                  ? '—'
                  : formatBalanceMinor(billingBalanceOverrideMinor ?? billingBalanceMinor)}
              </span>
            </div>
            {insufficientBalanceActive && (
              <span className="engine-balance-warning">
                {copy.insufficientBalanceNotice}
              </span>
            )}
            {engineNotice && !logoutInProgress && (
              <span className={`engine-notice engine-notice--${engineNotice.variant} engine-notice--inline`}>
                {engineNotice.message}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="engine-header-actions">
        {showWorkspaceActions && (
          <>
            <button className="secondary" type="button" onClick={onSaveSession}>
              {copy.engine.saveSession}
            </button>
            {canStartNewSession && (
              <button className="secondary" type="button" onClick={onStartNewSession}>
                {copy.engine.newSession}
              </button>
            )}
          </>
        )}
        {!isAuthed && publicLoginHref && (
          <a className="primary engine-public-login" href={publicLoginHref}>
            {copy.landingLoginCta}
          </a>
        )}
        {isAuthed && isAdmin && adminEngineSwitcher && (
          <nav className="engine-admin-switcher" aria-label="Admin engine navigation">
            <a
              className={adminEngineSwitcher === 'engine1' ? 'secondary' : 'ghost'}
              href="/engine"
            >
              Engine 1
            </a>
            <a
              className={adminEngineSwitcher === 'engine2' ? 'secondary' : 'ghost'}
              href="/engine_2"
            >
              Engine 2
            </a>
          </nav>
        )}
        {isAdmin && (
          <button className="ghost" type="button" onClick={onAdminClick}>
            {copy.adminNavLabel}
          </button>
        )}
        {isAuthed && (
          <button className="ghost" type="button" onClick={onLogout}>
            {copy.auth.logout}
          </button>
        )}
        {isDiagEnabled && (
          <span className="muted">
            {copy.diagnosticsAuthLabel}: {diagnosticsAuthEmail ?? '—'}
          </span>
        )}
        {isAdmin && (
          <button
            className={`ai-support-toggle diagnostics-toggle ${showDiagnostics ? 'on' : 'off'}`}
            type="button"
            onClick={onToggleDiagnostics}
          >
            {showDiagnostics ? copy.diagnosticsOn : copy.diagnosticsOff}
          </button>
        )}
        {showDiagnostics && (
          <>
            <button
              className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
              type="button"
              onClick={onToggleAiSupport}
            >
              {aiSupportEnabled ? copy.aiSupportOn : copy.aiSupportOff}
            </button>
            {showSessionUsage && (
              <>
                <button
                  className={`ai-support-toggle llm-usage-indicator ${llmUsageClass}`}
                  type="button"
                  aria-label={copy.llmUsageIndicatorLabel}
                  title={copy.llmUsageIndicatorLabel}
                  disabled
                >
                  {`${formatTokenTotal(currentTokensTotal)} tok`}
                </button>
                <div className="llm-cost-panel" aria-live="polite">
                  <div className="llm-cost-line">
                    {copy.llmCostLabel(formatUsd(totalCostUsd))}
                  </div>
                  <div className="llm-cost-line">
                    {totalCostPln != null
                      ? copy.llmCostPlnLabel(formatPln(totalCostPln || 0))
                      : copy.llmCostPlnFallback}
                  </div>
                  <details className="llm-cost-details">
                    <summary>{copy.llmCostBreakdown}</summary>
                    <div className="llm-cost-breakdown">
                      <div className="llm-cost-row">
                        {copy.llmCostTotalTokens(formatTokenTotal(sessionUsage.totalTokens))}
                      </div>
                      <div className="llm-cost-row">
                        {copy.llmCostTotalUsd(formatUsd(totalCostUsd))}
                      </div>
                      <div className="llm-cost-row">
                        {totalCostPln != null
                          ? copy.llmCostTotalPln(formatPln(totalCostPln || 0))
                          : copy.llmCostTotalPlnFallback}
                      </div>
                      {modelUsageEntries.map(([model, usage]) => (
                        <div key={model} className="llm-cost-row">
                          {copy.llmCostModelRow(
                            model,
                            formatTokenTotal(usage.inputTokens),
                            formatTokenTotal(usage.outputTokens),
                            formatUsd(usage.totalUSD)
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </header>
  )
}
