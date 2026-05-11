import { getSupabaseAdmin } from './supabaseAdmin.js'

const toInt = (value) => {
  const num = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(num) ? Math.trunc(num) : NaN
}

const toFiniteNumber = (value) => {
  const num = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(num) ? Number(num) : NaN
}

const plnToMinor = (value) => {
  const num = toFiniteNumber(value)
  return Number.isFinite(num) ? Math.round(num * 100) : NaN
}

const normalizeCurrency = (_value) => {
  // Billing is PLN-only. Keep accepting legacy inputs, but normalize to PLN.
  return 'PLN'
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
  _preferredCurrency = null,
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
  const existingRaw = String(profile?.billing_currency || '').toUpperCase()
  const next = 'PLN'
  if (!profile) {
    const insertRes = await client
      .schema('public')
      .from('profiles')
      .insert({ id: safeUserId, billing_currency: next })
    if (insertRes.error) {
      throw createBillingError('PROFILE_UPSERT_FAILED', insertRes.error.message)
    }
    return next
  }
  if (existingRaw !== next) {
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

export const grantWelcomeBalance = async (
  userId,
  supabaseAdmin = null,
  logScope = 'billing'
) => {
  const safeUserId = String(userId || '').trim()
  const userIdPrefix = safeUserId.slice(0, 8)
  const logPrefix = `[${logScope}][welcome_balance]`
  if (!safeUserId) {
    console.error(`${logPrefix} failed`, { userIdPrefix: null, message: 'Missing user id.' })
    return {
      attempted: false,
      granted: false,
      amountMinor: 0,
      balanceAfterMinor: 0,
      repairedLegacyBalance: false,
    }
  }

  const client = supabaseAdmin || getSupabaseAdmin()
  let hasWelcomeRule = false
  let welcomeRuleActive = false
  let expectedAmountMinor = 0

  const welcomeRuleRes = await client
    .schema('public')
    .from('pricing_rules')
    .select('action_key,welcome_balance_pln,is_active,price_grosze')
    .in('action_key', ['welcome_bonus', 'welcome'])
  if (welcomeRuleRes.error) {
    console.error(`${logPrefix} config_failed`, {
      userIdPrefix,
      message: welcomeRuleRes.error.message ?? null,
      code: welcomeRuleRes.error.code ?? null,
    })
  } else {
    const rules = Array.isArray(welcomeRuleRes.data) ? welcomeRuleRes.data : []
    const selectedRule =
      rules.find((rule) => rule.action_key === 'welcome_bonus') ||
      rules.find((rule) => rule.action_key === 'welcome') ||
      null
    hasWelcomeRule = Boolean(selectedRule)
    welcomeRuleActive = selectedRule?.is_active === true
    const amountFromPrice = toInt(selectedRule?.price_grosze)
    const amountFromRule = plnToMinor(selectedRule?.welcome_balance_pln)
    expectedAmountMinor =
      selectedRule?.action_key === 'welcome_bonus' && Number.isFinite(amountFromPrice)
        ? amountFromPrice
        : Number.isFinite(amountFromRule)
          ? amountFromRule
          : Number.isFinite(amountFromPrice)
            ? amountFromPrice
            : 0
    console.log(`${logPrefix} config`, {
      userIdPrefix,
      hasWelcomeRule,
      welcomeRuleActive,
      actionKey: selectedRule?.action_key ?? null,
      expectedAmountMinor,
    })
  }

  let granted = false
  let amountMinor = 0
  let balanceAfterMinor = 0
  let rpcShape = 'none'
  console.log(`${logPrefix} attempt`, { userIdPrefix })
  const grantRes = await client.rpc('grant_welcome_balance', { p_user_id: safeUserId })
  if (grantRes.error) {
    console.error(`${logPrefix} failed`, {
      userIdPrefix,
      message: grantRes.error?.message ?? null,
      code: grantRes.error?.code ?? null,
      details: grantRes.error?.details ?? null,
      hint: grantRes.error?.hint ?? null,
    })
  } else {
    const row = Array.isArray(grantRes.data) ? grantRes.data[0] : grantRes.data
    const hasMinorReturn = row && Object.prototype.hasOwnProperty.call(row, 'amount_pln_grosze')
    const hasLegacyReturn = row && Object.prototype.hasOwnProperty.call(row, 'amount_pln')
    rpcShape = hasMinorReturn ? 'grosze' : hasLegacyReturn ? 'legacy_pln' : 'unknown'
    amountMinor = hasMinorReturn ? toInt(row?.amount_pln_grosze) : plnToMinor(row?.amount_pln)
    balanceAfterMinor = hasMinorReturn
      ? toInt(row?.balance_after_pln_grosze)
      : plnToMinor(row?.balance_after_pln)
    if (!Number.isFinite(amountMinor)) amountMinor = 0
    if (!Number.isFinite(balanceAfterMinor)) balanceAfterMinor = 0
    granted = Object.prototype.hasOwnProperty.call(row || {}, 'granted')
      ? Boolean(row?.granted)
      : amountMinor > 0
    console.log(granted ? `${logPrefix} granted` : `${logPrefix} already_or_skipped`, {
      userIdPrefix,
      granted,
      rpcShape,
      amountMinor,
      balanceAfterMinor,
    })
  }

  let accountBalanceMinor = 0
  let legacyBalanceMinor = 0
  let welcomeGranted = false
  let repairedLegacyBalance = false
  const accountRes = await client
    .schema('public')
    .from('billing_accounts')
    .select('balance_pln_grosze,balance_pln,welcome_granted')
    .eq('user_id', safeUserId)
    .maybeSingle()
  if (accountRes.error) {
    console.error(`${logPrefix} account_check_failed`, {
      userIdPrefix,
      message: accountRes.error.message ?? null,
      code: accountRes.error.code ?? null,
    })
  } else {
    accountBalanceMinor = toInt(accountRes.data?.balance_pln_grosze)
    if (!Number.isFinite(accountBalanceMinor)) accountBalanceMinor = 0
    legacyBalanceMinor = plnToMinor(accountRes.data?.balance_pln)
    if (!Number.isFinite(legacyBalanceMinor)) legacyBalanceMinor = 0
    welcomeGranted = accountRes.data?.welcome_granted === true

    if (welcomeGranted && accountBalanceMinor <= 0 && legacyBalanceMinor > 0) {
      console.warn(`${logPrefix} legacy_balance_detected`, {
        userIdPrefix,
        rpcShape,
        accountBalanceMinor,
        legacyBalanceMinor,
      })
      const repairRes = await client
        .schema('public')
        .from('billing_accounts')
        .update({
          balance_pln_grosze: legacyBalanceMinor,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', safeUserId)
        .eq('welcome_granted', true)
      if (repairRes.error) {
        console.error(`${logPrefix} legacy_balance_repair_failed`, {
          userIdPrefix,
          message: repairRes.error.message ?? null,
          code: repairRes.error.code ?? null,
        })
      } else {
        repairedLegacyBalance = true
        accountBalanceMinor = legacyBalanceMinor
        balanceAfterMinor = legacyBalanceMinor
        console.warn(`${logPrefix} legacy_balance_repaired`, {
          userIdPrefix,
          balanceAfterMinor: legacyBalanceMinor,
        })
      }
    }

    console.log(`${logPrefix} account`, {
      userIdPrefix,
      accountBalanceMinor,
      legacyBalanceMinor,
      welcomeGranted,
      repairedLegacyBalance,
    })
  }

  if (accountBalanceMinor <= 0) {
    console.warn(`${logPrefix} zero_after_attempt`, {
      userIdPrefix,
      hasWelcomeRule,
      welcomeRuleActive,
      expectedAmountMinor,
      rpcShape,
      granted,
      amountMinor,
      balanceAfterMinor,
      welcomeGranted,
      legacyBalanceMinor,
    })
  }

  return {
    attempted: true,
    granted,
    amountMinor,
    balanceAfterMinor,
    accountBalanceMinor,
    legacyBalanceMinor,
    welcomeGranted,
    repairedLegacyBalance,
    hasWelcomeRule,
    welcomeRuleActive,
    expectedAmountMinor,
    rpcShape,
  }
}

export const getPriceForAction = async (
  actionKey,
  _currency,
  supabaseAdmin = null
) => {
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
    throw createBillingError('PRICE_GROSZE_MISSING', 'Invalid pricing rule.')
  }
  return price
}

export const chargeUserBalance = async (
  userId,
  actionKey,
  referenceId = null,
  supabaseAdmin = null,
  _options = {}
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
  const billingCurrency = await resolveBillingCurrency(safeUserId, null, client)
  await ensureBillingAccount(safeUserId, client)
  const { data, error } = await client.rpc('charge_user_balance', {
    p_user_id: safeUserId,
    p_action_key: safeActionKey,
    p_reference_id: referenceId ? String(referenceId) : null,
    p_currency: 'PLN',
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
  const currency = 'PLN'
  return {
    currency,
    balanceBeforeMinor: Number.isFinite(balanceBeforeMinor) ? balanceBeforeMinor : null,
    balanceAfterMinor: Number.isFinite(balanceAfterMinor) ? balanceAfterMinor : null,
    amountMinor: Number.isFinite(amountMinor) ? amountMinor : null,
  }
}
