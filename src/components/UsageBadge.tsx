type UsageBadgeProps = {
  totalTokens: number
  costPln: number
  model: string | null
  locale: 'pl-PL' | 'en-US'
}

const formatTokenTotal = (value: number, locale: 'pl-PL' | 'en-US') =>
  new Intl.NumberFormat(locale).format(Math.max(0, Math.floor(value || 0)))

const formatPln = (value: number, locale: 'pl-PL' | 'en-US') =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.max(0, value || 0)
  )

export const UsageBadge = ({ totalTokens, costPln, model, locale }: UsageBadgeProps) => {
  const modelClass = model ? `llm-model-${model.replace(/\./g, '-')}` : 'llm-model-none'
  return (
    <div className="report-usage-badge">
      <button
        className={`ai-support-toggle llm-usage-indicator ${modelClass}`}
        type="button"
        aria-label="LLM usage indicator"
        title={model ? `Model: ${model}` : 'Model: —'}
        disabled
      >
        {`${formatTokenTotal(totalTokens, locale)} tok`}
      </button>
      <div className="llm-cost-panel" aria-live="polite">
        <div className="llm-cost-line">
          {locale === 'pl-PL' ? `PLN: ${formatPln(costPln, locale)} zł` : `PLN: ${formatPln(costPln, locale)} zł`}
        </div>
      </div>
    </div>
  )
}
