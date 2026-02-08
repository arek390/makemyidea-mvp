import { useEffect, useState } from 'react'
import { apiFetch } from './apiFetch'
import { useAuthState } from './authState'

type BillingAccountState = {
  balanceMinor: number
  currency: 'PLN' | 'USD'
  loading: boolean
  error: string | null
}

const defaultState: BillingAccountState = {
  balanceMinor: 0,
  currency: 'PLN',
  loading: false,
  error: null,
}

type UseBillingAccountOptions = {
  enabled?: boolean
  uiLanguage?: 'Polish' | 'English'
}

export const useBillingAccount = (
  userId: string | null,
  options?: UseBillingAccountOptions
): BillingAccountState => {
  const { authReady } = useAuthState()
  const enabled = options?.enabled ?? true
  const uiLanguage = options?.uiLanguage ?? null
  const [state, setState] = useState<BillingAccountState>(defaultState)

  useEffect(() => {
    let cancelled = false
    if (!authReady || !enabled || !userId) {
      setState(defaultState)
      return () => {
        cancelled = true
      }
    }

    setState((prev) => ({ ...prev, loading: true, error: null }))

    const run = async () => {
      const lang =
        uiLanguage === 'Polish' ? 'pl' : uiLanguage === 'English' ? 'en' : null
      const url = lang
        ? `/api/billing?action=balance&lang=${encodeURIComponent(lang)}`
        : '/api/billing?action=balance'
      const response = await apiFetch(url, { method: 'GET' })
      const payload = await response.json().catch(() => null)

      if (cancelled) return

      if (!response.ok || !payload?.ok) {
        setState({
          balanceMinor: 0,
          currency: 'PLN',
          loading: false,
          error: payload?.error || 'Unable to load billing balance.',
        })
        return
      }

      const balance = Number(payload?.balanceMinor ?? 0)
      const currency = payload?.currency === 'USD' ? 'USD' : 'PLN'
      setState({
        balanceMinor: Number.isFinite(balance) ? balance : 0,
        currency,
        loading: false,
        error: null,
      })
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [authReady, enabled, userId, uiLanguage])

  return state
}
