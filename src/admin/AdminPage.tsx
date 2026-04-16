import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import { useAuthState } from '../lib/authState'

type AdminRow = {
  user_id: string | null
  user_email: string | null
  session_id: string | null
  session_name: string | null
  session_created_at: string | null
  board_items_count: number | null
  report_created: boolean | null
  report_updated: boolean | null
  tokens_input_total: number | null
  tokens_output_total: number | null
  tokens_total: number | null
  usage_cost_pln: number | null
  usage_cost_usd: number | null
  total_cost_session_minor: number | null
  last_image_cost_minor: number | null
  last_image_cost_currency: 'PLN' | 'USD' | null
  last_report_update_cost_minor: number | null
  last_report_update_cost_currency: 'PLN' | 'USD' | null
  last_report_generate_cost_minor: number | null
  last_report_generate_cost_currency: 'PLN' | 'USD' | null
  balance_pln_grosze: number | null
  balance_usd_cents: number | null
  billing_currency: 'PLN' | 'USD' | null
  total_paid_pln: number | null
}

type BillingRow = {
  userId: string
  email: string | null
  balanceMinor: number | null
  currency: 'PLN' | 'USD'
}

type AdminPageProps = {
  authLoading: boolean
  uiLanguage: 'Polish' | 'English'
}

type PricingInfo = {
  latestSync: {
    status?: string | null
    sync_finished_at?: string | null
    sync_started_at?: string | null
  } | null
  latestFetchedAt: string | null
  sourceLabel: string | null
  sourceUrl: string | null
  activeSnapshotsCount: number
  isFresh: boolean
}

const formatNumber = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value)
}

const formatMoney = (value: number | null | undefined, currency: 'PLN' | 'USD') => {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

const formatMoneyMinor = (minor: number | null | undefined, currency: 'PLN' | 'USD') => {
  if (minor == null || Number.isNaN(minor)) return '—'
  return formatMoney(minor / 100, currency)
}

const formatSessionMinor = (
  minor: number | null | undefined,
  currency: 'PLN' | 'USD' | null | undefined
) => {
  const resolved = currency === 'USD' ? 'USD' : 'PLN'
  return formatMoneyMinor(minor, resolved)
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export const AdminPage = ({ authLoading, uiLanguage }: AdminPageProps) => {
  const isPl = uiLanguage === 'Polish'
  const t = {
    authRequired: isPl ? 'Brak sesji. Zaloguj się ponownie.' : 'No session. Please sign in again.',
    positiveAmount: isPl ? 'Podaj dodatnią kwotę.' : 'Enter a positive amount.',
    noAccess: isPl ? 'Brak dostępu' : 'No access',
    adminTitle: isPl ? 'Admin' : 'Admin',
    adminIdentityLine: (userId: string | null, email: string | null) =>
      isPl
        ? `User ID: ${userId || '—'} | Email: ${email || '—'}`
        : `User ID: ${userId || '—'} | Email: ${email || '—'}`,
    adminCopyUserId: isPl ? 'Skopiuj User ID' : 'Copy User ID',
    adminBackToEngine: isPl ? 'Wróć do engine' : 'Back to engine',
    adminAccessDeniedTitle: isPl ? 'Brak dostępu' : 'Access denied',
    adminAccessDeniedBody: isPl
      ? 'Nie masz dostępu do panelu admina. Skopiuj swój User ID i dodaj go do tabeli admin_users.'
      : 'You do not have access to the admin panel. Copy your User ID and add it to the admin_users table.',
    adminDebugAccess: isPl ? 'Debug access' : 'Debug access',
    adminDebugError: isPl ? 'Nie udało się pobrać debug.' : 'Failed to fetch debug.',
    sessionLoading: isPl ? 'Ładowanie sesji…' : 'Loading session…',
    sessionMissing: isPl ? 'Brak sesji. Zaloguj się ponownie.' : 'No session. Please sign in again.',
    sessionLoginCta: isPl ? 'Zaloguj ponownie' : 'Sign in again',
    sessionDebug: isPl ? 'Debug session' : 'Debug session',
    billingTitle: isPl ? 'Zasilenie kont użytkowników (admin-only)' : 'User account top-ups (admin-only)',
    billingSearchPlaceholder: isPl
      ? 'Szukaj po session_name lub session_id'
      : 'Search by session_name or session_id',
    topupAction: isPl ? 'Zasil' : 'Top up',
    topupNotice: (deltaLabel: string, balanceLabel: string) =>
      isPl
        ? `Zasilono: +${deltaLabel} → saldo ${balanceLabel}`
        : `Topped up: +${deltaLabel} → balance ${balanceLabel}`,
    loading: isPl ? 'Ładowanie...' : 'Loading...',
    loadingReport: isPl ? 'Ładowanie raportu...' : 'Loading report...',
    loadingBilling: isPl ? 'Ładowanie billing...' : 'Loading billing...',
    usersSessionsTitle: isPl ? 'Użytkownicy → Sesje' : 'Users → Sessions',
    adminOnlyReport: isPl ? 'Raport tylko dla admina' : 'Admin-only report',
    sortLabel: isPl ? 'Sortuj' : 'Sort',
    sortCreatedAt: isPl ? 'Utworzono' : 'Created at',
    sortCostPln: isPl ? 'Koszt sesji' : 'Session cost',
    sortTokens: isPl ? 'Tokeny' : 'Tokens total',
    sortAsc: isPl ? 'Rosnąco' : 'Ascending',
    sortDesc: isPl ? 'Malejąco' : 'Descending',
    tableUserEmail: isPl ? 'Email użytkownika' : 'User email',
    tableSession: isPl ? 'Sesja' : 'Session',
    tableCreated: isPl ? 'Utworzono' : 'Created',
    tableBoardItems: isPl ? 'Wpisy na tablicy' : 'Board items',
    tableReportCreated: isPl ? 'Raport utworzony' : 'Report created',
    tableReportUpdated: isPl ? 'Raport zaktualizowany' : 'Report updated',
    tableTokens: isPl ? 'Tokeny' : 'Tokens',
    tableCostPln: isPl ? 'Koszt sesji' : 'Session cost',
    tableCostUsd: isPl ? 'Ostatni koszt grafiki' : 'Last image cost',
    tableLastReportUpdate: isPl ? 'Ostatni koszt update raportu' : 'Last report update cost',
    tableLastReportGenerate: isPl ? 'Ostatni koszt generate raportu' : 'Last report generate cost',
    tableBalancePln: isPl ? 'Saldo' : 'Balance',
    tableTotalPaidPln: isPl ? 'Suma wpłat PLN' : 'Total paid PLN',
    tableYes: isPl ? 'Tak' : 'Yes',
    tableNo: isPl ? 'Nie' : 'No',
    tableEmpty: isPl ? 'Brak danych' : 'No data',
    billingHeader: isPl ? 'Billing / Saldo' : 'Billing / Balance',
    billingTableEmail: isPl ? 'Email' : 'Email',
    billingTableBalance: isPl ? 'Saldo' : 'Balance',
    billingTableAction: isPl ? 'Zasil' : 'Top up',
    billingTableReset: isPl ? 'Reset' : 'Reset',
    billingEmailSearchPlaceholder: isPl ? 'Szukaj po emailu' : 'Search by email',
    billingAmountPlaceholder: isPl ? 'Kwota' : 'Amount',
    billingResetLabel: isPl ? 'Reset do 0' : 'Reset to 0',
    billingResetConfirm: (email: string | null, userId: string) =>
      isPl
        ? `Na pewno zresetować saldo użytkownika ${email || userId} do 0?`
        : `Reset balance for ${email || userId} to 0?`,
    billingResetNotice: isPl ? 'Saldo zresetowane do 0.' : 'Balance reset to 0.',
    billingResetFailed: isPl
      ? 'Nie udało się zresetować salda.'
      : 'Unable to reset the balance.',
    pricingStatus: isPl ? 'Cennik modeli OpenAI' : 'OpenAI model pricing',
    pricingSyncNow: isPl ? 'Synchronizuj ceny teraz' : 'Sync prices now',
    pricingSyncRunning: isPl ? 'Synchronizacja cen...' : 'Syncing prices...',
    pricingSource: isPl ? 'Źródło cen' : 'Pricing source',
    pricingUpdatedAt: isPl ? 'Ostatni snapshot cen' : 'Latest pricing snapshot',
    pricingSyncState: isPl ? 'Status synchronizacji' : 'Sync status',
  }
  const { user, authReady } = useAuthState()
  const authUserId = user?.id ?? null
  const authEmail = user?.email ?? null
  const [adminIdentity, setAdminIdentity] = useState<{ userId: string | null; email: string | null } | null>(null)
  const [adminAllowed, setAdminAllowed] = useState<'unknown' | 'yes' | 'no'>('unknown')
  const [rows, setRows] = useState<AdminRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [billingSearch, setBillingSearch] = useState('')
  const [billingRows, setBillingRows] = useState<BillingRow[]>([])
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [billingNotice, setBillingNotice] = useState<string | null>(null)
  const [billingInputs, setBillingInputs] = useState<Record<string, string>>({})
  const [billingBusy, setBillingBusy] = useState<Record<string, boolean>>({})
  const [billingResetBusy, setBillingResetBusy] = useState<Record<string, boolean>>({})
  const [debugPayload, setDebugPayload] = useState<string | null>(null)
  const [sessionDebugPayload, setSessionDebugPayload] = useState<string | null>(null)
  const [pricingInfo, setPricingInfo] = useState<PricingInfo | null>(null)
  const [pricingSyncBusy, setPricingSyncBusy] = useState(false)
  const [sortKey, setSortKey] = useState<'session_created_at' | 'total_cost_session_minor' | 'tokens_total'>(
    'session_created_at'
  )
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    if (!authReady) return
    if (!authUserId) {
      setAdminAllowed('no')
      return
    }
    setAdminAllowed('unknown')
  }, [authReady, authUserId])

  useEffect(() => {
    if (!authReady) return
    if (authUserId) return
    setRows([])
    setBillingRows([])
    setError(null)
    setBillingError(null)
    setBillingNotice(null)
    setDebugPayload(null)
    setSessionDebugPayload(null)
  }, [authReady, authUserId])

  useEffect(() => {
    if (!authReady || !authUserId) {
      setAdminIdentity(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        if (!supabase) throw new Error('AUTH_REQUIRED')
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token || ''
        if (!token) throw new Error('AUTH_REQUIRED')
        const response = await fetch('/api/admin?action=admin.whoami', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) return
        if (!cancelled) {
          setAdminIdentity({
            userId: payload.userId ?? null,
            email: payload.email ?? null,
          })
        }
      } catch {
        if (!cancelled) setAdminIdentity(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [authReady, authUserId])

  useEffect(() => {
    if (!authReady) return
    if (!authUserId) {
      setAdminAllowed('no')
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        if (!supabase) throw new Error('AUTH_REQUIRED')
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token || ''
        if (!token) throw new Error('AUTH_REQUIRED')
        const requestPath = '/api/admin?action=admin.check'
        const response = await fetch(requestPath, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          if (!cancelled && import.meta.env.DEV) {
            setDebugPayload(
              JSON.stringify(
                {
                  source: 'admin.check',
                  httpStatus: response.status,
                  responseOk: response.ok,
                  payload,
                },
                null,
                2
              )
            )
          }
          if (!cancelled) setAdminAllowed('no')
          return
        }
        if (!cancelled) {
          if (import.meta.env.DEV) {
            setDebugPayload(
              JSON.stringify(
                {
                  source: 'admin.check',
                  reasonCode: payload.reasonCode ?? null,
                  diagnostic: payload.diagnostic ?? null,
                },
                null,
                2
              )
            )
          }
          setAdminAllowed(payload.isAdmin ? 'yes' : 'no')
        }
      } catch {
        if (!cancelled) setAdminAllowed('no')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [authReady, authUserId, authEmail])

  useEffect(() => {
    setError(null)
    setBillingError(null)
    setBillingNotice(null)
  }, [uiLanguage])

  const fetchReportRows = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!authReady || !authUserId) return
      if (adminAllowed === 'no') return
      if (!options?.silent) {
        setLoading(true)
      }
      setError(null)
      try {
        if (!supabase) throw new Error('AUTH_REQUIRED')
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token || ''
        if (!token) throw new Error('AUTH_REQUIRED')
        const response = await fetch('/api/admin?action=admin.report.list&limit=500&offset=0', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          if (response.status === 403 || payload?.error === 'FORBIDDEN') {
            setAdminAllowed('no')
            setError(t.noAccess)
            return
          }
          throw new Error(payload?.error || 'LOAD_FAILED')
        }
        setAdminAllowed('yes')
        setRows(Array.isArray(payload.rows) ? payload.rows : [])
        setPricingInfo(payload?.pricing ?? null)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'LOAD_FAILED'
        setError(message === 'AUTH_REQUIRED' ? t.authRequired : message)
      } finally {
        if (!options?.silent) setLoading(false)
      }
    },
    [adminAllowed, authReady, authUserId, t.authRequired, t.noAccess]
  )

  useEffect(() => {
    if (!authReady || !authUserId) return
    if (adminAllowed === 'no') return
    void fetchReportRows()
  }, [authReady, authUserId, adminAllowed, fetchReportRows])

  useEffect(() => {
    if (!authReady || !authUserId || adminAllowed !== 'yes' || !supabase) return
    let delayedRefreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (delayedRefreshTimer) {
        window.clearTimeout(delayedRefreshTimer)
      }
      delayedRefreshTimer = window.setTimeout(() => {
        void fetchReportRows({ silent: true })
      }, 250)
    }

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      scheduleRefresh()
    }

    const channel = supabase
      .channel('admin-session-costs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_ai_cost_events',
        },
        () => {
          scheduleRefresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_ai_cost_summary',
        },
        () => {
          scheduleRefresh()
        }
      )
      .subscribe()

    window.addEventListener('focus', handleVisibilityOrFocus)
    document.addEventListener('visibilitychange', handleVisibilityOrFocus)

    return () => {
      if (delayedRefreshTimer) {
        window.clearTimeout(delayedRefreshTimer)
      }
      window.removeEventListener('focus', handleVisibilityOrFocus)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      void supabase.removeChannel(channel)
    }
  }, [adminAllowed, authReady, authUserId, fetchReportRows])

  const fetchBillingRows = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!authReady || !authUserId) return
      if (adminAllowed === 'no') return
      let cancelled = false
      if (!options?.silent) {
        setBillingLoading(true)
      }
      setBillingError(null)
      try {
        if (!supabase) throw new Error('AUTH_REQUIRED')
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token || ''
        if (!token) throw new Error('AUTH_REQUIRED')
        const response = await fetch('/api/admin?action=admin.billing.list&limit=500&offset=0', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          if (response.status === 403 || payload?.error === 'FORBIDDEN') {
            if (!cancelled) {
              setAdminAllowed('no')
              setBillingError(t.noAccess)
            }
            return
          }
          const errorMessage =
            payload?.error?.message || payload?.error || 'LOAD_FAILED'
          throw new Error(errorMessage)
        }
        if (!cancelled) {
          setAdminAllowed('yes')
          setBillingRows(Array.isArray(payload.items) ? payload.items : [])
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'LOAD_FAILED'
          setBillingError(message === 'AUTH_REQUIRED' ? t.authRequired : message)
        }
      } finally {
        if (!cancelled && !options?.silent) setBillingLoading(false)
      }
    },
    [adminAllowed, authReady, authUserId, t.authRequired, t.noAccess]
  )

  useEffect(() => {
    void fetchBillingRows()
  }, [fetchBillingRows])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => {
      const name = String(row.session_name || '').toLowerCase()
      const id = String(row.session_id || '').toLowerCase()
      return name.includes(query) || id.includes(query)
    })
  }, [rows, search])

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows]
    const dir = sortDir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
      if (sortKey === 'session_created_at') {
        const av = a.session_created_at ? new Date(a.session_created_at).getTime() : 0
        const bv = b.session_created_at ? new Date(b.session_created_at).getTime() : 0
        return (av - bv) * dir
      }
      const av = Number(a[sortKey] ?? 0)
      const bv = Number(b[sortKey] ?? 0)
      return (av - bv) * dir
    })
    return sorted
  }, [filteredRows, sortKey, sortDir])

  useEffect(() => {
    const sample = sortedRows[0] || null
    console.log('[admin.ui] row sample', {
      sample: sample
        ? {
            session_id: sample.session_id ?? null,
            tokens_input_total: sample.tokens_input_total ?? null,
            tokens_output_total: sample.tokens_output_total ?? null,
            tokens_total: sample.tokens_total ?? null,
            total_tokens_input: (sample as unknown as { total_tokens_input?: number | null })
              .total_tokens_input ?? null,
            total_tokens_output: (sample as unknown as { total_tokens_output?: number | null })
              .total_tokens_output ?? null,
          }
        : null,
    })
  }, [sortedRows])

  const filteredBillingRows = useMemo(() => {
    const query = billingSearch.trim().toLowerCase()
    if (!query) return billingRows
    return billingRows.filter((row) => String(row.email || '').toLowerCase().includes(query))
  }, [billingRows, billingSearch])

  const handleTopup = async (row: BillingRow) => {
    const raw = billingInputs[row.userId] || ''
    const delta = Number(raw)
    setBillingNotice(null)
    setBillingError(null)
    if (!Number.isFinite(delta) || delta <= 0) {
      setBillingError(t.positiveAmount)
      return
    }
    if (!supabase) {
      setBillingError(t.authRequired)
      return
    }
    setBillingBusy((prev) => ({ ...prev, [row.userId]: true }))
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || ''
      if (!token) throw new Error('AUTH_REQUIRED')
      const amountMinor = Math.round(delta * 100)
      const response = await fetch('/api/admin?action=admin.billing.topup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: row.userId,
          amountMinor,
          currency: row.currency,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const errorMessage =
          payload?.error?.message || payload?.error || 'TOPUP_FAILED'
        const seenUserId = payload?.seenUserId
        throw new Error(
          seenUserId ? `${errorMessage} (seenUserId: ${seenUserId})` : errorMessage
        )
      }
      const balanceAfterMinor = Number(payload.balance_after_minor ?? NaN)
      const balanceLabel = Number.isFinite(balanceAfterMinor)
        ? formatMoneyMinor(balanceAfterMinor, row.currency)
        : '—'
      const deltaLabel = formatMoney(delta, row.currency)
      setBillingInputs((prev) => ({ ...prev, [row.userId]: '' }))
      setBillingNotice(t.topupNotice(deltaLabel, balanceLabel))
      await fetchBillingRows({ silent: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TOPUP_FAILED'
      setBillingError(message === 'AUTH_REQUIRED' ? t.authRequired : message)
    } finally {
      setBillingBusy((prev) => ({ ...prev, [row.userId]: false }))
    }
  }

  const handleResetBalance = async (row: BillingRow) => {
    setBillingNotice(null)
    setBillingError(null)
    if (!supabase) {
      setBillingError(t.authRequired)
      return
    }
    const confirmed = window.confirm(t.billingResetConfirm(row.email, row.userId))
    if (!confirmed) return
    setBillingResetBusy((prev) => ({ ...prev, [row.userId]: true }))
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || ''
      if (!token) throw new Error('AUTH_REQUIRED')
      const response = await fetch('/api/admin?action=admin.billing.reset', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: row.userId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        if (response.status === 403 || payload?.error === 'FORBIDDEN') {
          throw new Error(t.noAccess)
        }
        const errorMessage = payload?.error || t.billingResetFailed
        throw new Error(errorMessage)
      }
      setBillingNotice(t.billingResetNotice)
      await fetchBillingRows({ silent: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : t.billingResetFailed
      setBillingError(message === 'AUTH_REQUIRED' ? t.authRequired : message)
    } finally {
      setBillingResetBusy((prev) => ({ ...prev, [row.userId]: false }))
    }
  }

  const handleDebugAccess = async () => {
    setDebugPayload(null)
    try {
      if (!supabase) throw new Error('AUTH_REQUIRED')
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || ''
      if (!token) throw new Error('AUTH_REQUIRED')
      const response = await fetch('/api/admin?action=admin.debug', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok && !payload) {
        throw new Error(t.adminDebugError)
      }
      setDebugPayload(JSON.stringify(payload, null, 2))
    } catch (err) {
      const message = err instanceof Error ? err.message : t.adminDebugError
      setDebugPayload(
        JSON.stringify({ ok: false, error: message }, null, 2)
      )
    }
  }

  const handlePricingSync = async () => {
    setPricingSyncBusy(true)
    setError(null)
    try {
      if (!supabase) throw new Error('AUTH_REQUIRED')
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || ''
      if (!token) throw new Error('AUTH_REQUIRED')
      const response = await fetch('/api/admin?action=admin.pricing.sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload) {
        throw new Error(payload?.error || 'PRICING_SYNC_FAILED')
      }
      setPricingInfo(payload?.pricing ?? null)
      const listResponse = await fetch('/api/admin?action=admin.report.list&limit=500&offset=0', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const listPayload = await listResponse.json().catch(() => null)
      if (listResponse.ok && listPayload?.ok) {
        setRows(Array.isArray(listPayload.rows) ? listPayload.rows : [])
        setPricingInfo(listPayload?.pricing ?? payload?.pricing ?? null)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PRICING_SYNC_FAILED'
      setError(message === 'AUTH_REQUIRED' ? t.authRequired : message)
    } finally {
      setPricingSyncBusy(false)
    }
  }

  const handleSessionDebug = async () => {
    setSessionDebugPayload(null)
    try {
      if (!supabase) throw new Error('AUTH_REQUIRED')
      const sessionRes = await supabase.auth.getSession()
      const userRes = await supabase.auth.getUser()
      const session = sessionRes.data?.session
      const user = userRes.data?.user
      const payload = {
        href: typeof window !== 'undefined' ? window.location.href : null,
        hasCode: typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).has('code')
          : false,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
        supabaseHost: (() => {
          try {
            return new URL(import.meta.env.VITE_SUPABASE_URL).hostname
          } catch {
            return null
          }
        })(),
        session: session
          ? { userId: session.user?.id ?? null, expiresAt: session.expires_at ?? null }
          : null,
        user: user ? { id: user.id, email: user.email ?? null } : null,
      }
      setSessionDebugPayload(JSON.stringify(payload, null, 2))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'SESSION_DEBUG_FAILED'
      setSessionDebugPayload(JSON.stringify({ ok: false, error: message }, null, 2))
    }
  }

  if (authLoading || !authReady) {
    return (
      <div className="app admin-page">
        <div className="admin-panel">
          <p className="muted">{t.sessionLoading}</p>
        </div>
      </div>
    )
  }

  if (!authUserId) {
    return (
      <div className="app admin-page">
        <div className="admin-panel">
          <h1>{t.adminTitle}</h1>
          <p className="muted">{t.sessionMissing}</p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/login'
                }
              }}
            >
              {t.sessionLoginCta}
            </button>
            <button type="button" className="ghost" onClick={handleSessionDebug}>
              {t.sessionDebug}
            </button>
          </div>
          {sessionDebugPayload && (
            <pre className="admin-debug">{sessionDebugPayload}</pre>
          )}
        </div>
      </div>
    )
  }

  if (adminAllowed === 'no') {
    return (
      <div className="app admin-page">
        <div className="admin-panel">
          <h1>{t.adminAccessDeniedTitle}</h1>
          <p className="muted">{t.adminAccessDeniedBody}</p>
          <p className="muted">
            {t.adminIdentityLine(
              adminIdentity?.userId ?? authUserId,
              adminIdentity?.email ?? authEmail
            )}
          </p>
          <button
            type="button"
            className="primary"
            disabled={!adminIdentity?.userId && !authUserId}
            onClick={() => {
              const value = adminIdentity?.userId ?? authUserId
              if (!value) return
              void navigator.clipboard.writeText(value)
            }}
          >
            {t.adminCopyUserId}
          </button>
          <button type="button" className="ghost" onClick={handleDebugAccess}>
            {t.adminDebugAccess}
          </button>
          {debugPayload && (
            <pre className="admin-debug">{debugPayload}</pre>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="app admin-page">
      <div className="admin-panel">
        <div className="admin-section">
          <header className="admin-header">
            <div>
          <h1>{t.billingHeader}</h1>
          <p className="muted">{t.billingTitle}</p>
          <p className="muted">
            {t.adminIdentityLine(
              adminIdentity?.userId ?? authUserId,
              adminIdentity?.email ?? authEmail
            )}
          </p>
          <button
            type="button"
            className="ghost"
            disabled={!adminIdentity?.userId && !authUserId}
            onClick={() => {
              const value = adminIdentity?.userId ?? authUserId
              if (!value) return
              void navigator.clipboard.writeText(value)
            }}
          >
            {t.adminCopyUserId}
          </button>
            </div>
            <div className="admin-controls">
            <button type="button" className="ghost" onClick={handleDebugAccess}>
              {t.adminDebugAccess}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/engine'
                }
              }}
            >
              {t.adminBackToEngine}
            </button>
            <input
              type="search"
              placeholder={t.billingEmailSearchPlaceholder}
                value={billingSearch}
                onChange={(event) => setBillingSearch(event.target.value)}
              />
            </div>
          </header>

          {debugPayload && (
            <pre className="admin-debug">{debugPayload}</pre>
          )}

          {billingNotice && <p className="admin-notice">{billingNotice}</p>}
          {billingError && <p className="admin-error">{billingError}</p>}
          {billingLoading && <p className="muted">{t.loadingBilling}</p>}

          {!billingLoading && (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--billing">
                <thead>
                  <tr>
                    <th>{t.billingTableEmail}</th>
                    <th>{t.billingTableBalance}</th>
                    <th>{t.billingTableAction}</th>
                    <th>{t.billingTableReset}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBillingRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="admin-empty">
                        {t.tableEmpty}
                      </td>
                    </tr>
                  )}
                  {filteredBillingRows.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.email || '—'}</td>
                      <td>{formatMoneyMinor(row.balanceMinor, row.currency)}</td>
                      <td>
                        <div className="admin-topup">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            placeholder={t.billingAmountPlaceholder}
                            value={billingInputs[row.userId] ?? ''}
                            onChange={(event) =>
                              setBillingInputs((prev) => ({
                                ...prev,
                                [row.userId]: event.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="secondary"
                            disabled={billingBusy[row.userId] === true}
                            onClick={() => handleTopup(row)}
                          >
                            {billingBusy[row.userId] ? '...' : t.topupAction}
                          </button>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost danger"
                          disabled={billingResetBusy[row.userId] === true}
                          onClick={() => handleResetBalance(row)}
                        >
                          {billingResetBusy[row.userId] ? '...' : t.billingResetLabel}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <header className="admin-header admin-header--sessions">
          <div>
          <h1>{t.usersSessionsTitle}</h1>
          <p className="muted">{t.adminOnlyReport}</p>
          {pricingInfo && (
            <>
              <p className="muted">
                {t.pricingSource}: {pricingInfo.sourceLabel || '—'}
                {pricingInfo.sourceUrl ? ` (${pricingInfo.sourceUrl})` : ''}
              </p>
              <p className="muted">
                {t.pricingUpdatedAt}: {formatDateTime(pricingInfo.latestFetchedAt)}
              </p>
              <p className="muted">
                {t.pricingSyncState}: {pricingInfo.latestSync?.status || '—'}
              </p>
            </>
          )}
          </div>
          <div className="admin-controls">
            <input
              type="search"
              placeholder={t.billingSearchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="admin-sort">
              <label>
                {t.sortLabel}
                <select
                  value={sortKey}
                  onChange={(event) =>
                    setSortKey(
                      event.target.value as
                        | 'session_created_at'
                        | 'total_cost_session_minor'
                        | 'tokens_total'
                    )
                  }
                >
                  <option value="session_created_at">{t.sortCreatedAt}</option>
                  <option value="total_cost_session_minor">{t.sortCostPln}</option>
                  <option value="tokens_total">{t.sortTokens}</option>
                </select>
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              >
                {sortDir === 'asc' ? t.sortAsc : t.sortDesc}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={pricingSyncBusy}
                onClick={handlePricingSync}
              >
                {pricingSyncBusy ? t.pricingSyncRunning : t.pricingSyncNow}
              </button>
            </div>
          </div>
        </header>

        {error && <p className="admin-error">{error}</p>}
        {loading && <p className="muted">{t.loadingReport}</p>}

        {!loading && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t.tableUserEmail}</th>
                  <th>{t.tableSession}</th>
                  <th>{t.tableCreated}</th>
                  <th>{t.tableBoardItems}</th>
                  <th>{t.tableReportCreated}</th>
                  <th>{t.tableReportUpdated}</th>
                  <th>{t.tableTokens}</th>
                  <th>{t.tableCostPln}</th>
                  <th>{t.tableCostUsd}</th>
                  <th>{t.tableLastReportUpdate}</th>
                  <th>{t.tableLastReportGenerate}</th>
                  <th>{t.tableBalancePln}</th>
                  <th>{t.tableTotalPaidPln}</th>
                </tr>
              </thead>
              <tbody>
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={13} className="admin-empty">
                      {t.tableEmpty}
                      </td>
                    </tr>
                  )}
                {sortedRows.map((row) => (
                  <tr key={`${row.user_id || 'user'}-${row.session_id || 'session'}`}>
                    <td>{row.user_email || '—'}</td>
                    <td>
                      <div className="admin-session">
                        <div className="admin-session-name">
                          {row.session_name || '—'}
                        </div>
                        <div className="admin-session-id">{row.session_id || '—'}</div>
                      </div>
                    </td>
                    <td>{formatDateTime(row.session_created_at)}</td>
                    <td>{formatNumber(row.board_items_count)}</td>
                    <td>{row.report_created ? t.tableYes : t.tableNo}</td>
                    <td>{row.report_updated ? t.tableYes : t.tableNo}</td>
                    <td>{formatNumber(row.tokens_total)}</td>
                    <td>{formatSessionMinor(row.total_cost_session_minor, row.billing_currency)}</td>
                    <td>{formatSessionMinor(row.last_image_cost_minor, row.last_image_cost_currency)}</td>
                    <td>
                      {formatSessionMinor(
                        row.last_report_update_cost_minor,
                        row.last_report_update_cost_currency
                      )}
                    </td>
                    <td>
                      {formatSessionMinor(
                        row.last_report_generate_cost_minor,
                        row.last_report_generate_cost_currency
                      )}
                    </td>
                    <td>
                      {formatMoneyMinor(
                        row.billing_currency === 'USD'
                          ? row.balance_usd_cents
                          : row.balance_pln_grosze,
                        row.billing_currency === 'USD' ? 'USD' : 'PLN'
                      )}
                    </td>
                    <td>{formatMoney(row.total_paid_pln, 'PLN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Manual test checklist:
            1) Zaloguj jako arektest8@gmail.com → widzisz tabelę Billing.
            2) Zaloguj jako zwykły user → nie widzisz tabeli, endpointy zwracają 403.
            3) Zasil +20 → saldo rośnie, audyt zapisany.
            4) Refresh → saldo nadal poprawne.
            5) Próba delta<=0 → 400. */}
      </div>
    </div>
  )
}
