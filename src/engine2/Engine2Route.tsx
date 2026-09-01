import type { ComponentType } from 'react'
import { Engine2Page, type Engine2Copy } from './Engine2Page'

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

export function Engine2Route({
  EngineHeader,
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
  authDisabled,
  missingSupabaseEnvMessage,
  isDiagEnabled,
  publicLoginHref,
  onAdminClick,
  onLogout,
  onToggleDiagnostics,
  onToggleAiSupport,
  formatBalanceMinor,
  formatTokenTotal,
  formatUsd,
  formatPln,
  getAccessToken,
}: Engine2RouteProps) {
  return (
    <div className="app engine2-shell" data-testid="public-engine-preview">
      <EngineHeader
        logoUrl={logoUrl}
        copy={copy}
        uiLanguage={uiLanguage}
        isAuthed={isAuthed}
        isAdmin={isAdmin}
        logoutInProgress={logoutInProgress}
        billingLoading={billingLoading}
        billingError={billingError}
        billingBalanceMinor={billingBalanceMinor}
        billingBalanceOverrideMinor={billingBalanceOverrideMinor}
        insufficientBalanceActive={insufficientBalanceActive}
        engineNotice={engineNotice}
        showBalance={false}
        showWorkspaceActions={false}
        canStartNewSession={false}
        showDiagnostics={showDiagnostics}
        aiSupportEnabled={aiSupportEnabled}
        showSessionUsage={showSessionUsage}
        llmUsageClass={llmUsageClass}
        currentTokensTotal={currentTokensTotal}
        totalCostUsd={totalCostUsd}
        totalCostPln={totalCostPln}
        sessionUsage={sessionUsage}
        modelUsageEntries={modelUsageEntries}
        diagnosticsAuthEmail={diagnosticsAuthEmail}
        publicLoginHref={publicLoginHref}
        onBalanceClick={() => {}}
        onSaveSession={() => {}}
        onStartNewSession={() => {}}
        onAdminClick={onAdminClick}
        onLogout={onLogout}
        onToggleDiagnostics={onToggleDiagnostics}
        onToggleAiSupport={onToggleAiSupport}
        formatBalanceMinor={formatBalanceMinor}
        formatTokenTotal={formatTokenTotal}
        formatUsd={formatUsd}
        formatPln={formatPln}
        isDiagEnabled={isDiagEnabled}
      />
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
