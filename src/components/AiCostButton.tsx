import type { MouseEventHandler } from 'react'

type AiCostButtonProps = {
  label: string
  lang: 'pl' | 'en'
  priceMinor: number | null
  currency: 'PLN'
  priceLoading?: boolean
  loading?: boolean
  disabled?: boolean
  disabledTooltip?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
  metaLayout?: 'inside' | 'below'
}

const formatCurrency = (value: number, lang: 'pl' | 'en') => {
  const locale = lang === 'pl' ? 'pl-PL' : 'en-US'
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${formatted} PLN`
}

export const AiCostButton = ({
  label,
  lang,
  priceMinor,
  currency,
  priceLoading = false,
  loading = false,
  disabled = false,
  disabledTooltip,
  onClick,
  className,
  metaLayout = 'inside',
}: AiCostButtonProps) => {
  const amountText = (() => {
    if (priceLoading || priceMinor == null) return '—'
    const amount = priceMinor / 100
    return formatCurrency(amount, lang)
  })()
  const metaLine = (
    <span className={`report-ai-inline${metaLayout === 'below' ? ' report-ai-inline--below' : ''}`}>
      <span className="report-ai-text report-ai-text--single">
        {lang === 'pl' ? 'wspierane przez AI' : 'AI-assisted'}
      </span>
      <span className="report-ai-text report-ai-text--single">
        {lang === 'pl' ? 'koszt ' : 'cost '}
        {amountText}
      </span>
      <span className="report-ai-icon" aria-hidden="true">
        ✨
      </span>
    </span>
  )

  const button = (
    <button
      type="button"
      className={`primary report-update-btn${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      onClick={onClick}
    >
      <span className="report-update-btn__label">
        {loading && <span className="button-spinner report-update-btn__spinner" aria-hidden="true" />}
        <span>{label}</span>
      </span>
      {metaLayout === 'inside' ? metaLine : null}
    </button>
  )

  const content =
    metaLayout === 'below' ? (
      <span className={`report-update-btn-stack${className ? ` report-update-btn-stack--${className}` : ''}`}>
        {button}
        {metaLine}
      </span>
    ) : (
      button
    )

  if (disabled && disabledTooltip) {
    return (
      <span className="report-update-btn-tooltip-wrap" aria-label={disabledTooltip}>
        {content}
        <span className="report-update-cta-tooltip" role="tooltip">
          {disabledTooltip}
        </span>
      </span>
    )
  }

  return content
}
