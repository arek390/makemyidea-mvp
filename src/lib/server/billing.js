import { getSupabaseAdmin } from './supabaseAdmin.js'

const toInt = (value) => {
  const num = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(num) ? Math.trunc(num) : NaN
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
  if (combined.includes('INSUFFICIENT_BALANCE')) {
    return { code: 'INSUFFICIENT_BALANCE', status: 402 }
  }
  if (combined.includes('AUTH_REQUIRED')) {
    return { code: 'AUTH_REQUIRED', status: 401 }
  }
  return null
}

export const getPriceForAction = async (actionKey, supabaseAdmin = null) => {
  const safeKey = String(actionKey || '').trim()
  if (!safeKey) {
    throw createBillingError('PRICING_RULE_MISSING', 'Missing action key.')
  }
  const client = supabaseAdmin || getSupabaseAdmin()
  const { data, error } = await client
    .schema('public')
    .from('pricing_rules')
    .select('price_grosze,is_active')
    .eq('action_key', safeKey)
    .maybeSingle()
  if (error) {
    throw createBillingError('PRICING_RULE_LOOKUP_FAILED', error.message)
  }
  if (!data || data.is_active !== true) {
    throw createBillingError('PRICING_RULE_MISSING', 'Pricing rule missing or inactive.')
  }
  const price = toInt(data.price_grosze)
  if (!Number.isFinite(price) || price < 0) {
    throw createBillingError('PRICING_RULE_INVALID', 'Invalid pricing rule.')
  }
  return price
}

export const chargeUserBalance = async (
  userId,
  actionKey,
  referenceId = null,
  supabaseAdmin = null
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
  const { data, error } = await client.rpc('charge_user_balance', {
    p_user_id: safeUserId,
    p_action_key: safeActionKey,
    p_reference_id: referenceId ? String(referenceId) : null,
  })
  if (error) {
    throw createBillingError(error.code || 'BILLING_FAILED', error.message || 'Billing failed.')
  }
  const row = Array.isArray(data) ? data[0] : data
  return {
    balanceBeforeGrosze: toInt(row?.balance_before_grosze),
    balanceAfterGrosze: toInt(row?.balance_after_grosze),
    amountGrosze: toInt(row?.amount_grosze),
  }
}
