import { useEffect, useState } from 'react'
import { apiFetch } from './apiFetch'

type BillingAccountState = {
  balancePLN: number
  loading: boolean
  error: string | null
}

const defaultState: BillingAccountState = {
  balancePLN: 0,
  loading: false,
  error: null,
}

type UseBillingAccountOptions = {
  enabled?: boolean
}

export const useBillingAccount = (
  userId: string | null,
  options?: UseBillingAccountOptions
): BillingAccountState => {
  const enabled = options?.enabled ?? true
  const [state, setState] = useState<BillingAccountState>(defaultState)

  useEffect(() => {
    let cancelled = false
    if (!enabled || !userId) {
      setState(defaultState)
      return () => {
        cancelled = true
      }
    }

    setState((prev) => ({ ...prev, loading: true, error: null }))

    const run = async () => {
      const response = await apiFetch('/api/billing?action=balance', { method: 'GET' })
      const payload = await response.json().catch(() => null)

      if (cancelled) return

      if (!response.ok || !payload?.ok) {
        setState({
          balancePLN: 0,
          loading: false,
          error: payload?.error || 'Unable to load billing balance.',
        })
        return
      }

      const balance = Number(payload?.balancePLN ?? 0)
      setState({
        balancePLN: Number.isFinite(balance) ? balance : 0,
        loading: false,
        error: null,
      })
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [enabled, userId])

  return state
}
