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
  user_id: string
  email: string | null
  balance_pln: number | null
}

type AdminPageProps = {
  authLoading: boolean
}

const ADMIN_EMAIL = 'arektest8@gmail.com'

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

export const AdminPage = ({ authLoading }: AdminPageProps) => {
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('')
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
          setAdminEmail('')
          setAdminLoading(false)
        }
        return
      }
      setAdminLoading(true)
      try {
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        const email = (data.user?.email || '').trim().toLowerCase()
        if (!cancelled) {
          setAdminEmail(email)
        }
      } catch {
        if (!cancelled) {
          setAdminEmail('')
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

  const isAdmin = adminEmail === ADMIN_EMAIL

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        if (!supabase) throw new Error('AUTH_REQUIRED')
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token || ''
        if (!token) throw new Error('AUTH_REQUIRED')
        const response = await fetch('/api/admin/report?limit=500&offset=0', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'LOAD_FAILED')
        }
        if (!cancelled) {
          setRows(Array.isArray(payload.rows) ? payload.rows : [])
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'LOAD_FAILED'
          setError(
            message === 'AUTH_REQUIRED' ? 'Brak sesji. Zaloguj się ponownie.' : message
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const load = async () => {
      setBillingLoading(true)
      setBillingError(null)
      try {
        if (!supabase) throw new Error('AUTH_REQUIRED')
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token || ''
        if (!token) throw new Error('AUTH_REQUIRED')
        const response = await fetch('/api/admin/billing/list?limit=500&offset=0', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'LOAD_FAILED')
        }
        if (!cancelled) {
          setBillingRows(Array.isArray(payload.items) ? payload.items : [])
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'LOAD_FAILED'
          setBillingError(
            message === 'AUTH_REQUIRED' ? 'Brak sesji. Zaloguj się ponownie.' : message
          )
        }
      } finally {
        if (!cancelled) setBillingLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isAdmin])

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
    const raw = billingInputs[row.user_id] || ''
    const delta = Number(raw)
    setBillingNotice(null)
    setBillingError(null)
    if (!Number.isFinite(delta) || delta <= 0) {
      setBillingError('Podaj dodatnią kwotę.')
      return
    }
    if (!supabase) {
      setBillingError('Brak sesji. Zaloguj się ponownie.')
      return
    }
    setBillingBusy((prev) => ({ ...prev, [row.user_id]: true }))
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || ''
      if (!token) throw new Error('AUTH_REQUIRED')
      const response = await fetch('/api/admin/billing/topup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: row.user_id,
          deltaPLN: delta,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'TOPUP_FAILED')
      }
      const balanceAfter = Number(payload.balanceAfter ?? 0)
      setBillingRows((prev) =>
        prev.map((item) =>
          item.user_id === row.user_id ? { ...item, balance_pln: balanceAfter } : item
        )
      )
      setBillingInputs((prev) => ({ ...prev, [row.user_id]: '' }))
      setBillingNotice(
        `Zasilono: +${delta.toFixed(2)} PLN → saldo ${balanceAfter.toFixed(2)} PLN`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TOPUP_FAILED'
      setBillingError(
        message === 'AUTH_REQUIRED' ? 'Brak sesji. Zaloguj się ponownie.' : message
      )
    } finally {
      setBillingBusy((prev) => ({ ...prev, [row.user_id]: false }))
    }
  }

  if (authLoading || adminLoading) {
    return (
      <div className="app admin-page">
        <div className="admin-panel">
          <p className="muted">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="app admin-page">
        <div className="admin-panel">
          <h1>Admin</h1>
          <p className="muted">Brak dostępu</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app admin-page">
      <div className="admin-panel">
        <header className="admin-header">
          <div>
            <h1>Users → Sessions</h1>
            <p className="muted">Admin-only report</p>
          </div>
          <div className="admin-controls">
            <input
              type="search"
              placeholder="Szukaj po session_name lub session_id"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="admin-sort">
              <label>
                Sort
                <select
                  value={sortKey}
                  onChange={(event) =>
                    setSortKey(event.target.value as 'session_created_at' | 'cost_pln' | 'tokens_total')
                  }
                >
                  <option value="session_created_at">Created at</option>
                  <option value="cost_pln">Cost PLN</option>
                  <option value="tokens_total">Tokens total</option>
                </select>
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              >
                {sortDir === 'asc' ? 'ASC' : 'DESC'}
              </button>
            </div>
          </div>
        </header>

        {error && <p className="admin-error">{error}</p>}
        {loading && <p className="muted">Loading report...</p>}

        {!loading && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User email</th>
                  <th>Session</th>
                  <th>Created</th>
                  <th>Board items</th>
                  <th>Report created</th>
                  <th>Report updated</th>
                  <th>Tokens</th>
                  <th>Cost PLN</th>
                  <th>Cost USD</th>
                  <th>Balance PLN</th>
                  <th>Total paid PLN</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="admin-empty">
                      Brak danych
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
                    <td>{row.report_created ? 'Yes' : 'No'}</td>
                    <td>{row.report_updated ? 'Yes' : 'No'}</td>
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
              <h1>Billing / Saldo</h1>
              <p className="muted">Zasilenie kont użytkowników (admin-only)</p>
            </div>
            <div className="admin-controls">
              <input
                type="search"
                placeholder="Szukaj po emailu"
                value={billingSearch}
                onChange={(event) => setBillingSearch(event.target.value)}
              />
            </div>
          </header>

          {billingNotice && <p className="admin-notice">{billingNotice}</p>}
          {billingError && <p className="admin-error">{billingError}</p>}
          {billingLoading && <p className="muted">Loading billing...</p>}

          {!billingLoading && (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--billing">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Balance PLN</th>
                    <th>Zasil</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBillingRows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="admin-empty">
                        Brak danych
                      </td>
                    </tr>
                  )}
                  {filteredBillingRows.map((row) => (
                    <tr key={row.user_id}>
                      <td>{row.email || '—'}</td>
                      <td>{formatMoney(row.balance_pln, 'PLN')}</td>
                      <td>
                        <div className="admin-topup">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            placeholder="Kwota PLN"
                            value={billingInputs[row.user_id] ?? ''}
                            onChange={(event) =>
                              setBillingInputs((prev) => ({
                                ...prev,
                                [row.user_id]: event.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="secondary"
                            disabled={billingBusy[row.user_id] === true}
                            onClick={() => handleTopup(row)}
                          >
                            {billingBusy[row.user_id] ? '...' : 'Zasil'}
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
