import { getSupabaseAdmin } from './supabaseAdmin.js'

const toInt = (value) => {
  const num = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(num) ? Math.trunc(num) : NaN
}

const normalizeCurrency = (value) => {
  const raw = String(value || '').toUpperCase()
  if (raw === 'PLN' || raw === 'USD') return raw
  return null
}

export const createBillingError = (code, message) => {
  const err = new Error(message || code)
  err.code = code
  return err
}

export const normalizeBillingError = (error) => {
  const message = String(error?.message || '')
  const code = String(error?.code || '')
  const combined = `${code} ${message}`.toUpperCase()
  if (combined.includes('PRICING_RULE_MISSING') || combined.includes('PRICING_RULE_INACTIVE')) {
    return { code: 'PRICING_RULE_MISSING', status: 400 }
  }
  if (combined.includes('PRICE_CENTS_MISSING') || combined.includes('PRICE_GROSZE_MISSING')) {
    return { code: 'PRICING_RULE_MISSING', status: 400 }
  }
  if (combined.includes('BILLING_CURRENCY_MISSING')) {
    return { code: 'BILLING_CURRENCY_MISSING', status: 400 }
  }
  if (combined.includes('INSUFFICIENT_BALANCE') || combined.includes('INSUFFICIENT_FUNDS')) {
    return { code: 'INSUFFICIENT_BALANCE', status: 402 }
  }
  if (combined.includes('AUTH_REQUIRED')) {
    return { code: 'AUTH_REQUIRED', status: 401 }
  }
  return null
}

export const resolveBillingCurrency = async (
  userId,
  preferredCurrency = null,
  supabaseAdmin = null
) => {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId) {
    throw createBillingError('AUTH_REQUIRED', 'Missing user id.')
  }
  const client = supabaseAdmin || getSupabaseAdmin()
  const { data: profile, error } = await client
    .schema('public')
    .from('profiles')
    .select('billing_currency')
    .eq('id', safeUserId)
    .maybeSingle()
  if (error) {
    throw createBillingError('PROFILE_LOOKUP_FAILED', error.message)
  }
  const existing = normalizeCurrency(profile?.billing_currency)
  if (existing) return existing

  const next = normalizeCurrency(preferredCurrency) || null
  if (!next) {
    throw createBillingError('BILLING_CURRENCY_MISSING', 'Missing billing currency.')
  }
  if (!profile) {
    const insertRes = await client
      .schema('public')
      .from('profiles')
      .insert({ id: safeUserId, billing_currency: next })
    if (insertRes.error) {
      throw createBillingError('PROFILE_UPSERT_FAILED', insertRes.error.message)
    }
  } else {
    const updateRes = await client
      .schema('public')
      .from('profiles')
      .update({ billing_currency: next })
      .eq('id', safeUserId)
    if (updateRes.error) {
      throw createBillingError('PROFILE_UPSERT_FAILED', updateRes.error.message)
    }
  }
  return next
}

export const ensureBillingAccount = async (userId, supabaseAdmin = null) => {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId) return
  const client = supabaseAdmin || getSupabaseAdmin()
  const { error } = await client
    .schema('public')
    .from('billing_accounts')
    .upsert(
      {
        user_id: safeUserId,
        balance_pln_grosze: 0,
        balance_usd_cents: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id', ignoreDuplicates: true }
    )
  if (error) {
    throw createBillingError('BILLING_ACCOUNT_INIT_FAILED', error.message)
  }
}

export const getPriceForAction = async (
  actionKey,
  currency,
  supabaseAdmin = null
) => {
  const safeKey = String(actionKey || '').trim()
  if (!safeKey) {
    throw createBillingError('PRICING_RULE_MISSING', 'Missing action key.')
  }
  const safeCurrency = normalizeCurrency(currency)
  if (!safeCurrency) {
    throw createBillingError('BILLING_CURRENCY_MISSING', 'Missing billing currency.')
  }
  const client = supabaseAdmin || getSupabaseAdmin()
  const { data, error } = await client
    .schema('public')
    .from('pricing_rules')
    .select('price_grosze,price_cents,is_active')
    .eq('action_key', safeKey)
    .maybeSingle()
  if (error) {
    throw createBillingError('PRICING_RULE_LOOKUP_FAILED', error.message)
  }
  if (!data || data.is_active !== true) {
    throw createBillingError('PRICING_RULE_MISSING', 'Pricing rule missing or inactive.')
  }
  const price = toInt(safeCurrency === 'USD' ? data.price_cents : data.price_grosze)
  if (!Number.isFinite(price) || price < 0) {
    const errCode = safeCurrency === 'USD' ? 'PRICE_CENTS_MISSING' : 'PRICE_GROSZE_MISSING'
    throw createBillingError(errCode, 'Invalid pricing rule.')
  }
  return price
}

export const chargeUserBalance = async (
  userId,
  actionKey,
  referenceId = null,
  supabaseAdmin = null,
  options = {}
) => {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId) {
    throw createBillingError('AUTH_REQUIRED', 'Missing user id.')
  }
  const safeActionKey = String(actionKey || '').trim()
  if (!safeActionKey) {
    throw createBillingError('PRICING_RULE_MISSING', 'Missing action key.')
  }
  const client = supabaseAdmin || getSupabaseAdmin()
  const preferredCurrency = options?.preferredCurrency || null
  const billingCurrency = await resolveBillingCurrency(safeUserId, preferredCurrency, client)
  await ensureBillingAccount(safeUserId, client)
  const { data, error } = await client.rpc('charge_user_balance', {
    p_user_id: safeUserId,
    p_action_key: safeActionKey,
    p_reference_id: referenceId ? String(referenceId) : null,
    p_currency: billingCurrency,
  })
  if (error) {
    console.error('[billing][charge_user_balance] rpc failed', {
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    })
    throw createBillingError(error.code || 'BILLING_FAILED', error.message || 'Billing failed.')
  }
  const row = Array.isArray(data) ? data[0] : data
  const balanceBeforeMinor = toInt(row?.balance_before_minor)
  const balanceAfterMinor = toInt(row?.balance_after_minor)
  const amountMinor = toInt(row?.amount_minor)
  const currency = normalizeCurrency(row?.currency) || billingCurrency
  return {
    currency,
    balanceBeforeMinor: Number.isFinite(balanceBeforeMinor) ? balanceBeforeMinor : null,
    balanceAfterMinor: Number.isFinite(balanceAfterMinor) ? balanceAfterMinor : null,
    amountMinor: Number.isFinite(amountMinor) ? amountMinor : null,
  }
}
