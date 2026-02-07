import type { MouseEventHandler } from 'react'

type AiCostButtonProps = {
  label: string
  lang: 'pl' | 'en'
  priceGrosze: number | null
  priceLoading?: boolean
  fxUsdPln?: number | null
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
}

const formatPlnCurrency = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value)

const formatUsdCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

export const AiCostButton = ({
  label,
  lang,
  priceGrosze,
  priceLoading = false,
  fxUsdPln = null,
  onClick,
  className,
}: AiCostButtonProps) => {
  const amountText = (() => {
    if (priceLoading || priceGrosze == null) return '—'
    const pln = priceGrosze / 100
    if (lang === 'pl') return formatPlnCurrency(pln)
    if (!fxUsdPln || fxUsdPln <= 0) return '—'
    return formatUsdCurrency(pln / fxUsdPln)
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
