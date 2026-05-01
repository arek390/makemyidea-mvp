import { useEffect, useMemo, useState } from 'react'

type RollingBalanceProps = {
  valueMinor: number
  fromMinor?: number | null
  locale: string
  className?: string
}

const DIGITS = Array.from({ length: 10 }, (_, i) => String(i))

const isDigitChar = (value: string) => value >= '0' && value <= '9'

const safeMinor = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)

const formatMinorNumber = (minor: number, locale: string) => {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeMinor(minor) / 100)
}

const pow10 = (exp: number) => {
  if (exp <= 0) return 1
  let value = 1
  for (let i = 0; i < exp; i += 1) value *= 10
  return value
}

const clampStepsForUi = (rawSteps: number, startDigit: number, endDigit: number) => {
  if (!Number.isFinite(rawSteps) || rawSteps <= 0) return 0
  const base = (endDigit - startDigit + 10) % 10
  const baseSteps = base === 0 ? 10 : base
  const extraCycles = Math.min(2, Math.floor(rawSteps / 10))
  return baseSteps + extraCycles * 10
}

const RollingDigit = ({
  startDigit,
  steps,
  placeIndex,
}: {
  startDigit: number
  steps: number
  placeIndex: number
}) => {
  const [active, setActive] = useState(false)
  const durationMs = 650 + Math.min(6, placeIndex) * 80
  const delayMs = Math.min(4, placeIndex) * 40

  const endPosition = startDigit + steps
  const column = useMemo(() => {
    const length = Math.max(1, endPosition + 1)
    const out: string[] = []
    for (let i = 0; i < length; i += 1) {
      out.push(DIGITS[i % 10]!)
    }
    return out
  }, [endPosition])

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setActive(true))
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return (
    <span className="rolling-digit" aria-hidden="true">
      <span
        className="rolling-digit-inner"
        style={{
          transform: `translateY(calc(var(--rolling-digit-h) * -${active ? endPosition : startDigit}))`,
          transitionDuration: `${durationMs}ms`,
          transitionDelay: `${delayMs}ms`,
        }}
      >
        {column.map((d, idx) => (
          <span className="rolling-digit-cell" key={idx}>
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

export const RollingBalance = ({ valueMinor, fromMinor = null, locale, className }: RollingBalanceProps) => {
  const toMinor = safeMinor(valueMinor)
  const from = fromMinor == null ? null : safeMinor(fromMinor)
  const formatted = useMemo(() => formatMinorNumber(toMinor, locale), [toMinor, locale])

  const tokens = useMemo(() => {
    const digitPlaceByIndexFromLeft: number[] = []
    let digitIndex = 0
    // Build map digitIndexFromLeft -> placeIndexFromRight (0 = last digit / grosz units).
    const placeIndexes: number[] = []
    for (let i = formatted.length - 1; i >= 0; i -= 1) {
      const ch = formatted[i] || ''
      if (isDigitChar(ch)) {
        placeIndexes.push(placeIndexes.length)
      }
    }
    const placeByLeft = placeIndexes.reverse()
    for (let i = 0; i < formatted.length; i += 1) {
      const ch = formatted[i] || ''
      if (isDigitChar(ch)) {
        digitPlaceByIndexFromLeft.push(placeByLeft[digitIndex] ?? 0)
        digitIndex += 1
      }
    }
    return { digitPlaceByIndexFromLeft }
  }, [formatted])

  const shouldAnimate = from != null && from < toMinor
  let digitFromLeft = 0

  return (
    <span className={['rolling-balance', className].filter(Boolean).join(' ')}>
      <span className="sr-only">{`${formatted} PLN`}</span>
      <span className="rolling-balance-number" aria-hidden="true">
        {Array.from(formatted).map((ch, idx) => {
          if (!isDigitChar(ch)) {
            return (
              <span className="rolling-sep" key={idx}>
                {ch}
              </span>
            )
          }

          const placeIndex = tokens.digitPlaceByIndexFromLeft[digitFromLeft] ?? 0
          digitFromLeft += 1

          if (!shouldAnimate || from == null) {
            return (
              <span className="rolling-digit-static" key={idx}>
                {ch}
              </span>
            )
          }

          const placeValue = pow10(placeIndex)
          const startDigit = Math.floor(from / placeValue) % 10
          const endDigit = Math.floor(toMinor / placeValue) % 10
          const rawSteps = Math.floor(toMinor / placeValue) - Math.floor(from / placeValue)
          const steps = clampStepsForUi(rawSteps, startDigit, endDigit)
          if (steps <= 0) {
            return (
              <span className="rolling-digit-static" key={idx}>
                {ch}
              </span>
            )
          }
          return (
            <RollingDigit key={idx} startDigit={startDigit} steps={steps} placeIndex={placeIndex} />
          )
        })}
      </span>
      <span className="rolling-balance-currency" aria-hidden="true">
        {' '}
        PLN
      </span>
    </span>
  )
}
