import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase/client'

type AdminRow = {
  user_id: string | null
  user_email: string | null
  session_id: string | null
  session_name: string | null
  session_created_at: string | null
  board_items_count: number | null
  report_created: boolean | null
  report_updated: boolean | null
  tokens_total: number | null
  cost_pln: number | null
  cost_usd: number | null
  balance_pln: number | null
  total_paid_pln: number | null
}

type BillingRow = {
  userId: string
  email: string | null
  balancePLN: number | null
}

type AdminPageProps = {
  authLoading: boolean
  uiLanguage: 'Polish' | 'English'
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
    adminAccessDeniedTitle: isPl ? 'Brak dostępu' : 'Access denied',
    adminAccessDeniedBody: isPl
      ? 'Nie masz dostępu do panelu admina. Skopiuj swój User ID i dodaj go do tabeli admin_users.'
      : 'You do not have access to the admin panel. Copy your User ID and add it to the admin_users table.',
    billingTitle: isPl ? 'Zasilenie kont użytkowników (admin-only)' : 'User account top-ups (admin-only)',
    billingSearchPlaceholder: isPl
      ? 'Szukaj po session_name lub session_id'
      : 'Search by session_name or session_id',
    topupAction: isPl ? 'Zasil' : 'Top up',
    topupNotice: (delta: number, balanceAfter: number) =>
      isPl
        ? `Zasilono: +${delta.toFixed(2)} PLN → saldo ${balanceAfter.toFixed(2)} PLN`
        : `Topped up: +${delta.toFixed(2)} PLN → balance ${balanceAfter.toFixed(2)} PLN`,
    loading: isPl ? 'Ładowanie...' : 'Loading...',
    loadingReport: isPl ? 'Ładowanie raportu...' : 'Loading report...',
    loadingBilling: isPl ? 'Ładowanie billing...' : 'Loading billing...',
    usersSessionsTitle: isPl ? 'Użytkownicy → Sesje' : 'Users → Sessions',
    adminOnlyReport: isPl ? 'Raport tylko dla admina' : 'Admin-only report',
    sortLabel: isPl ? 'Sortuj' : 'Sort',
    sortCreatedAt: isPl ? 'Utworzono' : 'Created at',
    sortCostPln: isPl ? 'Koszt PLN' : 'Cost PLN',
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
    tableCostPln: isPl ? 'Koszt PLN' : 'Cost PLN',
    tableCostUsd: isPl ? 'Koszt USD' : 'Cost USD',
    tableBalancePln: isPl ? 'Saldo PLN' : 'Balance PLN',
    tableTotalPaidPln: isPl ? 'Suma wpłat PLN' : 'Total paid PLN',
    tableYes: isPl ? 'Tak' : 'Yes',
    tableNo: isPl ? 'Nie' : 'No',
    tableEmpty: isPl ? 'Brak danych' : 'No data',
    billingHeader: isPl ? 'Billing / Saldo' : 'Billing / Balance',
    billingTableEmail: isPl ? 'Email' : 'Email',
    billingTableBalance: isPl ? 'Saldo PLN' : 'Balance PLN',
    billingTableAction: isPl ? 'Zasil' : 'Top up',
    billingEmailSearchPlaceholder: isPl ? 'Szukaj po emailu' : 'Search by email',
    billingAmountPlaceholder: isPl ? 'Kwota PLN' : 'Amount PLN',
  }
  const [adminLoading, setAdminLoading] = useState(true)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [authEmail, setAuthEmail] = useState<string | null>(null)
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
  const [sortKey, setSortKey] = useState<'session_created_at' | 'cost_pln' | 'tokens_total'>(
    'session_created_at'
  )
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (authLoading) return
      if (!supabase) {
        if (!cancelled) {
          setAuthUserId(null)
          setAuthEmail(null)
          setAdminLoading(false)
        }
        return
      }
      setAdminLoading(true)
      try {
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        if (!cancelled) {
          const nextUserId = data.user?.id ?? null
          setAuthUserId(nextUserId)
          setAuthEmail(data.user?.email ?? null)
          setAdminAllowed(nextUserId ? 'unknown' : 'no')
        }
      } catch {
        if (!cancelled) {
          setAuthUserId(null)
          setAuthEmail(null)
          setAdminAllowed('no')
        }
      } finally {
        if (!cancelled) setAdminLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [authLoading])

  useEffect(() => {
    if (!authUserId) {
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
  }, [authUserId])

  useEffect(() => {
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
        const response = await fetch('/api/admin?action=admin.check', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          if (!cancelled) setAdminAllowed('no')
          return
        }
        if (!cancelled) {
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
  }, [authUserId])

  useEffect(() => {
    setError(null)
    setBillingError(null)
    setBillingNotice(null)
  }, [uiLanguage])

  useEffect(() => {
    if (adminAllowed === 'no') return
    let cancelled = false
    const load = async () => {
      setLoading(true)
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
            if (!cancelled) {
              setAdminAllowed('no')
              setError(t.noAccess)
            }
            return
          }
          throw new Error(payload?.error || 'LOAD_FAILED')
        }
        if (!cancelled) {
          setAdminAllowed('yes')
          setRows(Array.isArray(payload.rows) ? payload.rows : [])
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'LOAD_FAILED'
          setError(message === 'AUTH_REQUIRED' ? t.authRequired : message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [adminAllowed])

  useEffect(() => {
    if (adminAllowed === 'no') return
    let cancelled = false
    const load = async () => {
      setBillingLoading(true)
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
        if (!cancelled) setBillingLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [adminAllowed])

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
      const response = await fetch('/api/admin?action=admin.billing.topup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: row.userId,
          deltaPLN: delta,
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
      const balanceAfter = Number(payload.balance_after ?? 0)
      setBillingRows((prev) =>
        prev.map((item) =>
          item.userId === row.userId ? { ...item, balancePLN: balanceAfter } : item
        )
      )
      setBillingInputs((prev) => ({ ...prev, [row.userId]: '' }))
      setBillingNotice(t.topupNotice(delta, balanceAfter))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TOPUP_FAILED'
      setBillingError(message === 'AUTH_REQUIRED' ? t.authRequired : message)
    } finally {
      setBillingBusy((prev) => ({ ...prev, [row.userId]: false }))
    }
  }

  if (authLoading || adminLoading) {
    return (
      <div className="app admin-page">
        <div className="admin-panel">
          <p className="muted">{t.loading}</p>
        </div>
      </div>
    )
  }

  if (!authUserId) {
    return (
      <div className="app admin-page">
        <div className="admin-panel">
          <h1>{t.adminTitle}</h1>
          <p className="muted">{t.authRequired}</p>
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
        </div>
      </div>
    )
  }

  return (
    <div className="app admin-page">
      <div className="admin-panel">
        <header className="admin-header">
          <div>
          <h1>{t.usersSessionsTitle}</h1>
          <p className="muted">{t.adminOnlyReport}</p>
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
                    setSortKey(event.target.value as 'session_created_at' | 'cost_pln' | 'tokens_total')
                  }
                >
                  <option value="session_created_at">{t.sortCreatedAt}</option>
                  <option value="cost_pln">{t.sortCostPln}</option>
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
                  <th>{t.tableBalancePln}</th>
                  <th>{t.tableTotalPaidPln}</th>
                </tr>
              </thead>
              <tbody>
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="admin-empty">
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
                    <td>{formatMoney(row.cost_pln, 'PLN')}</td>
                    <td>{formatMoney(row.cost_usd, 'USD')}</td>
                    <td>{formatMoney(row.balance_pln, 'PLN')}</td>
                    <td>{formatMoney(row.total_paid_pln, 'PLN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
            <input
              type="search"
              placeholder={t.billingEmailSearchPlaceholder}
                value={billingSearch}
                onChange={(event) => setBillingSearch(event.target.value)}
              />
            </div>
          </header>

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
                  </tr>
                </thead>
                <tbody>
                  {filteredBillingRows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="admin-empty">
                        {t.tableEmpty}
                      </td>
                    </tr>
                  )}
                  {filteredBillingRows.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.email || '—'}</td>
                      <td>{formatMoney(row.balancePLN, 'PLN')}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

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
