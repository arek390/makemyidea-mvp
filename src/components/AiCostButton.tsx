import type { MouseEventHandler } from 'react'

type AiCostButtonProps = {
  label: string
  lang: 'pl' | 'en'
  priceMinor: number | null
  currency: 'PLN' | 'USD'
  priceLoading?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
}

const formatCurrency = (value: number, currency: 'PLN' | 'USD') => {
  const locale = currency === 'PLN' ? 'pl-PL' : 'en-US'
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

export const AiCostButton = ({
  label,
  lang,
  priceMinor,
  currency,
  priceLoading = false,
  onClick,
  className,
}: AiCostButtonProps) => {
  const amountText = (() => {
    if (priceLoading || priceMinor == null) return '—'
    const amount = priceMinor / 100
    return formatCurrency(amount, currency)
  })()
  return (
    <button
      type="button"
      className={`primary report-update-btn${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="report-ai-inline">
        <span className="report-ai-text report-ai-text--stack">
          <span className="report-ai-text-line">
            {lang === 'pl' ? 'wspierane przez AI' : 'AI-assisted'}
          </span>
          <span className="report-ai-text-line">
            {lang === 'pl' ? 'koszt ' : 'cost '}
            {amountText}
          </span>
        </span>
        <span className="report-ai-icon" aria-hidden="true">
          ✨
        </span>
      </span>
    </button>
  )
}
