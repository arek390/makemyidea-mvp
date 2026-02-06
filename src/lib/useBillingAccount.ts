import { useEffect, useState } from 'react'
import { supabase as client } from './supabase/client'

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
    const supabase = client
    if (!enabled || !userId || !supabase) {
      setState(defaultState)
      return () => {
        cancelled = true
      }
    }

    setState((prev) => ({ ...prev, loading: true, error: null }))

    const run = async () => {
      const { data, error } = await supabase
        .from('billing_accounts')
        .select('balance_pln')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setState({ balancePLN: 0, loading: false, error: error.message })
        return
      }

      const balance = Number(data?.balance_pln ?? 0)
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
