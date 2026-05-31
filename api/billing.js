import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { XMLParser } from 'fast-xml-parser'
import { createSupabaseServerClient } from '../src/lib/server/supabaseServer.js'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction, resolveQueryValue } from '../src/lib/server/router.js'
import {
  resolveBillingCurrency,
  ensureBillingAccount,
  grantWelcomeBalance,
} from '../src/lib/server/billing.js'
import {
  createStripeCheckoutSession,
  isStripeEnabled,
  resolveStripeCurrency,
  verifyStripeWebhook,
} from '../src/lib/server/payments/stripe.js'

const readRawBody = async (req) => {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  return body
}

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex')

const buildHashPayload = (values) => values.map((value) => String(value ?? '').trim()).filter(Boolean).join('|')

const resolveAutopayKey = ({ serviceId, kind }) => {
  const sid = String(serviceId || '').trim()
  const perService = (name) => (sid ? process.env[`${name}_${sid}`] : '')

  if (kind === 'itn') {
    const name1 = 'AUTOPAY_ITN_HASH_KEY'
    const name2 = 'AUTOPAY_SHARED_KEY'
    const v =
      perService(name1) ||
      process.env[name1] ||
      perService(name2) ||
      process.env[name2] ||
      ''
    const source =
      (perService(name1) && `${name1}_${sid}`) ||
      (process.env[name1] && name1) ||
      (perService(name2) && `${name2}_${sid}`) ||
      (process.env[name2] && name2) ||
      null
    return { key: v, source }
  }

  // kind === 'form'
  const name1 = 'AUTOPAY_FORM_HASH_KEY'
  const name2 = 'AUTOPAY_SHARED_KEY'
  const v =
    perService(name1) ||
    process.env[name1] ||
    perService(name2) ||
    process.env[name2] ||
    ''
  const source =
    (perService(name1) && `${name1}_${sid}`) ||
    (process.env[name1] && name1) ||
    (perService(name2) && `${name2}_${sid}`) ||
    (process.env[name2] && name2) ||
    null
  return { key: v, source }
}

const buildConfirmXml = ({ serviceID, orderID, confirmation, sharedKey }) => {
  const hash = sha256([serviceID, orderID, confirmation, sharedKey].join('|'))
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<confirmationList>` +
    `<serviceID>${serviceID}</serviceID>` +
    `<transactionsConfirmations>` +
    `<transactionConfirmed>` +
    `<orderID>${orderID}</orderID>` +
    `<confirmation>${confirmation}</confirmation>` +
    `</transactionConfirmed>` +
    `</transactionsConfirmations>` +
    `<hash>${hash}</hash>` +
    `</confirmationList>`
}

const timingSafeHexEqual = (a, b) => {
  const aa = String(a || '')
  const bb = String(b || '')
  if (!aa || !bb) return false
  if (aa.length !== bb.length) return false
  try {
    return timingSafeEqual(Buffer.from(aa, 'utf8'), Buffer.from(bb, 'utf8'))
  } catch {
    return false
  }
}

const normalizeAmountPln = (value) => {
  if (value == null) return null
  const num = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  if (!Number.isFinite(num)) return null
  return Math.round(num * 100) / 100
}

const parsePlnToGrosze = (value) => {
  if (value == null) return null
  const num = typeof value === 'string' ? Number(value.replace(',', '.').trim()) : Number(value)
  if (!Number.isFinite(num)) return null
  return Math.round(num * 100)
}

const resolveAuthenticatedUser = async (req, res, supabaseAdmin = getSupabaseAdmin()) => {
  const supabase = createSupabaseServerClient(req, res)
  const { data } = await supabase.auth.getUser()
  let userId = data?.user?.id ?? null
  let userEmail = data?.user?.email ?? null
  if (!userId) {
    const authHeader = req?.headers?.authorization || req?.headers?.Authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (token) {
      const { data: tokenData, error: tokenError } = await supabaseAdmin.auth.getUser(token)
      if (!tokenError && tokenData?.user?.id) {
        userId = tokenData.user.id
        userEmail = tokenData.user.email || null
      }
    }
  }
  return { userId, userEmail }
}

const mergeProviderPayload = (existingPayload, provider, patch) => {
  const existing =
    existingPayload && typeof existingPayload === 'object' && !Array.isArray(existingPayload)
      ? existingPayload
      : {}
  const existingProvider =
    existing[provider] && typeof existing[provider] === 'object' && !Array.isArray(existing[provider])
      ? existing[provider]
      : {}
  return {
    ...existing,
    [provider]: {
      ...existingProvider,
      ...patch,
    },
  }
}

const mergeStripeEventPayload = (existingPayload, patch, event) => {
  const previous = mergeProviderPayload(existingPayload, 'stripe', patch)
  const stripePayload =
    previous.stripe && typeof previous.stripe === 'object' && !Array.isArray(previous.stripe)
      ? previous.stripe
      : {}
  const previousEvents =
    stripePayload.events && typeof stripePayload.events === 'object' && !Array.isArray(stripePayload.events)
      ? stripePayload.events
      : {}
  return {
    ...previous,
    stripe: {
      ...stripePayload,
      events: {
        ...previousEvents,
        [event.id]: {
          type: event.type,
          created: event.created ?? null,
          received_at: new Date().toISOString(),
        },
      },
    },
  }
}

const normalizeInternalReturnTo = (value) => {
  const raw = String(value || '').trim()
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/engine'
  if (raw.startsWith('/api/')) return '/engine'
  if (raw === '/report#/topup' || raw.startsWith('/report#/topup?')) return '/engine'
  return raw
}

const appendReturnPaymentParams = (returnTo, params) => {
  const target = normalizeInternalReturnTo(returnTo)
  const hashIndex = target.indexOf('#')
  const beforeHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : ''
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') query.set(key, String(value))
  }
  const sep = beforeHash.includes('?') ? '&' : '?'
  return `${beforeHash}${sep}${query.toString()}${hash}`
}

const resolveStripeReturnTo = async (req, sessionId) => {
  const rawQueryReturnTo = resolveQueryValue(req, 'return_to')
  const queryReturnTo = normalizeInternalReturnTo(rawQueryReturnTo)
  if (rawQueryReturnTo != null && String(rawQueryReturnTo).trim()) return queryReturnTo
  const safeSessionId = String(sessionId || '').trim()
  if (!safeSessionId) return queryReturnTo
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data } = await supabaseAdmin
      .from('payments')
      .select('provider_payload')
      .eq('provider', 'stripe')
      .eq('provider_payload->stripe->>checkout_session_id', safeSessionId)
      .maybeSingle()
    return normalizeInternalReturnTo(data?.provider_payload?.stripe?.return_to || queryReturnTo)
  } catch (error) {
    console.error('[STRIPE RETURN] return_to_lookup_failed', {
      sessionId: safeSessionId,
      message: error?.message ?? String(error),
    })
    return queryReturnTo
  }
}

const normalizeLang = (value, req) => {
  const raw = String(value || '').toLowerCase()
  if (raw.startsWith('pl')) return 'pl'
  if (raw.includes('polish')) return 'pl'
  if (raw.startsWith('en')) return 'en'
  if (raw.includes('english')) return 'en'
  const header = String(req?.headers?.['accept-language'] || '').toLowerCase()
  if (header.startsWith('pl')) return 'pl'
  return 'en'
}

// Billing is PLN-only (language must not affect currency).
const resolveCurrencyFromLang = () => 'PLN'

const resolveTestTopup = (tier, currency) => {
  const safeTier = String(tier || '').trim().toUpperCase()
  const safeCurrency = 'PLN'
  const amountMinorMap = { S: 2000, M: 5000, L: 10000 }
  const amountMinor = amountMinorMap[safeTier] ?? null
  return { tier: safeTier, currency: safeCurrency, amountMinor }
}

const handleTestTopup = async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}

    const supabase = createSupabaseServerClient(req, res)
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user?.id) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }

    const supabaseAdmin = getSupabaseAdmin()
    const lang = normalizeLang(body.language || body.lang || body.locale, req)
    const preferredCurrency = resolveCurrencyFromLang(lang)
    const billingCurrency = await resolveBillingCurrency(
      data.user.id,
      preferredCurrency,
      supabaseAdmin
    )
    await ensureBillingAccount(data.user.id, supabaseAdmin)
    const { tier, currency, amountMinor } = resolveTestTopup(body.tier, billingCurrency)
    if (!tier || amountMinor == null) {
      sendJson(res, 400, { ok: false, error: 'INVALID_TIER' })
      return
    }

    const balanceColumn = 'balance_pln_grosze'
    const { data: account, error: accountError } = await supabaseAdmin
      .from('billing_accounts')
      .select(`${balanceColumn}`)
      .eq('user_id', data.user.id)
      .maybeSingle()
    if (accountError) {
      res.status(500).json({ ok: false, error: accountError.message || 'QUERY_FAILED' })
      return
    }
    const currentMinor = Number(account?.[balanceColumn] ?? 0)
    const nextMinor = currentMinor + amountMinor
    const updateRes = await supabaseAdmin
      .from('billing_accounts')
      .update({ [balanceColumn]: nextMinor, updated_at: new Date().toISOString() })
      .eq('user_id', data.user.id)
    if (updateRes.error) {
      res.status(500).json({ ok: false, error: updateRes.error.message || 'UPDATE_FAILED' })
      return
    }

    const requestId = randomUUID()
    await supabaseAdmin.from('billing_balance_adjustments').insert({
      admin_user_id: data.user.id,
      target_user_id: data.user.id,
      delta_pln: currency === 'PLN' ? amountMinor / 100 : 0,
      balance_before: currency === 'PLN' ? currentMinor / 100 : 0,
      balance_after: currency === 'PLN' ? nextMinor / 100 : 0,
      delta_minor: amountMinor,
      balance_before_minor: currentMinor,
      balance_after_minor: nextMinor,
      currency,
      note: 'test_topup',
      request_id: requestId,
    })

    res.status(200).json({
      ok: true,
      added: { currency, amountMinor },
      newBalance: { currency, amountMinor: nextMinor },
      balance: { currency, amountMinor: nextMinor },
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'SERVER_ERROR' })
  }
}

const handleCreatePayment = async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const amountPlnRaw = body.amountPln
  const packageId = body.packageId

  let amountPln = normalizeAmountPln(amountPlnRaw)
  if (amountPln == null && packageId != null) {
    sendJson(res, 400, { ok: false, error: 'UNKNOWN_PACKAGE' })
    return
  }
  if (amountPln == null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_AMOUNT' })
    return
  }
  if (amountPln < 0.1 || amountPln > 100000) {
    sendJson(res, 400, { ok: false, error: 'AMOUNT_OUT_OF_RANGE' })
    return
  }

  const serviceId = process.env.AUTOPAY_SERVICE_ID || ''
  const { key: sharedKey, source: sharedKeySource } = resolveAutopayKey({
    serviceId,
    kind: 'form',
  })
  const gatewayUrl = process.env.AUTOPAY_GATEWAY_URL || ''
  if (!serviceId || !sharedKey || !gatewayUrl) {
    sendJson(res, 500, { ok: false, error: 'MISSING_AUTOPAY_ENV' })
    return
  }

  const supabaseAdmin = getSupabaseAdmin()
  const supabase = createSupabaseServerClient(req, res)
  const { data, error } = await supabase.auth.getUser()
  let userId = data?.user?.id ?? null
  let userEmail = data?.user?.email ?? null
  if (!userId) {
    const authHeader = req?.headers?.authorization || req?.headers?.Authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (token) {
      const { data: tokenData, error: tokenError } = await supabaseAdmin.auth.getUser(token)
      if (!tokenError && tokenData?.user?.id) {
        userId = tokenData.user.id
        userEmail = tokenData.user.email || null
      }
    }
  }
  if (!userId) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    return
  }

  const orderId = randomUUID().replace(/-/g, '')
  const amountStr = amountPln.toFixed(2)
  const amountGrosze = Math.round(amountPln * 100)

  const insertRes = await supabaseAdmin
    .from('payments')
    .insert({
      user_id: userId,
      provider: 'autopay',
      order_id: orderId,
      amount_pln_grosze: amountGrosze,
      tokens_to_add: amountGrosze,
      status: 'pending',
    })
  if (insertRes.error) {
    console.error('[AUTOPAY CREATE] payment_insert_failed', {
      message: insertRes.error.message,
      code: insertRes.error.code,
      details: insertRes.error.details,
      hint: insertRes.error.hint,
    })
    res.status(500).json({ ok: false, error: 'PAYMENT_CREATE_FAILED' })
    return
  }

  const descriptionHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim()
  const description = `Top up ${descriptionHost || 'makemyidea.work'}`
  const currency = 'PLN'
  const returnUrl = (() => {
    const envReturnUrl = String(process.env.AUTOPAY_RETURN_URL || '').trim()
    if (envReturnUrl) return envReturnUrl
    return 'https://makemyidea.work/api/billing?action=return'
  })()
  const hashPayload = buildHashPayload([
    serviceId,
    orderId,
    amountStr,
    description,
    null, // GatewayID (optional)
    currency,
    userEmail,
    returnUrl, // ReturnURL (optional, order 45 in docs)
  ])
  const hash = sha256(`${hashPayload}|${sharedKey}`)

  const html = `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <title>Autopay</title>
  </head>
  <body onload="document.forms[0].submit()">
    <form method="POST" action="${gatewayUrl}">
      <input type="hidden" name="ServiceID" value="${serviceId}" />
      <input type="hidden" name="OrderID" value="${orderId}" />
      <input type="hidden" name="Amount" value="${amountStr}" />
      <input type="hidden" name="Description" value="${description}" />
      <input type="hidden" name="Currency" value="${currency}" />
      ${userEmail ? `<input type="hidden" name="CustomerEmail" value="${userEmail}" />` : ''}
      ${returnUrl ? `<input type="hidden" name="ReturnURL" value="${returnUrl}" />` : ''}
      <input type="hidden" name="Hash" value="${hash}" />
      <noscript>
        <button type="submit">Kontynuuj</button>
      </noscript>
    </form>
  </body>
</html>`

  res.status(200)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
}

const handleCreateStripeCheckout = async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  if (!isStripeEnabled()) {
    notFound(res)
    return
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const amountPln = normalizeAmountPln(body.amountPln)
  const returnTo = normalizeInternalReturnTo(body.returnTo)
  if (amountPln == null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_AMOUNT' })
    return
  }
  if (amountPln < 0.1 || amountPln > 100000) {
    sendJson(res, 400, { ok: false, error: 'AMOUNT_OUT_OF_RANGE' })
    return
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { userId } = await resolveAuthenticatedUser(req, res, supabaseAdmin)
  if (!userId) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    return
  }

  const orderId = `stripe_${randomUUID().replace(/-/g, '')}`
  const amountGrosze = Math.round(amountPln * 100)
  const tokensToAdd = amountGrosze
  const currency = resolveStripeCurrency()
  const createdAt = new Date().toISOString()

  console.log('[STRIPE CHECKOUT] creating_payment', {
    orderId,
    amountPlnGrosze: amountGrosze,
    tokensToAdd,
    currency,
    provider: 'stripe',
  })

  const insertRes = await supabaseAdmin
    .from('payments')
    .insert({
      user_id: userId,
      provider: 'stripe',
      order_id: orderId,
      amount_pln_grosze: amountGrosze,
      tokens_to_add: tokensToAdd,
      status: 'pending',
      provider_payload: {
        stripe: {
          currency,
          created_at: createdAt,
          mode: 'checkout',
          test_mode: true,
          return_to: returnTo,
        },
      },
    })
    .select('id,provider_payload')
    .single()
  if (insertRes.error || !insertRes.data?.id) {
    console.error('[STRIPE CHECKOUT] payment_insert_failed', {
      message: insertRes.error?.message,
      code: insertRes.error?.code,
      details: insertRes.error?.details,
      hint: insertRes.error?.hint,
    })
    sendJson(res, 500, { ok: false, error: 'PAYMENT_CREATE_FAILED' })
    return
  }

  let session
  try {
    session = await createStripeCheckoutSession({
      userId,
      orderId,
      internalPaymentId: insertRes.data.id,
      amountMinor: amountGrosze,
      currency,
      returnTo,
    })
  } catch (error) {
    console.error('[STRIPE CHECKOUT] session_create_failed', {
      orderId,
      message: error?.message ?? String(error),
      code: error?.code ?? null,
    })
    sendJson(res, 500, { ok: false, error: 'STRIPE_SESSION_CREATE_FAILED' })
    return
  }

  const providerPayload = mergeProviderPayload(insertRes.data.provider_payload, 'stripe', {
    checkout_session_id: session.id,
    checkout_session_url_created: Boolean(session.url),
    payment_status: session.payment_status ?? null,
    return_to: returnTo,
    updated_at: new Date().toISOString(),
  })
  const updateRes = await supabaseAdmin
    .from('payments')
    .update({ provider_payload: providerPayload, updated_at: new Date().toISOString() })
    .eq('id', insertRes.data.id)
  if (updateRes.error) {
    console.error('[STRIPE CHECKOUT] payment_session_update_failed', {
      orderId,
      sessionId: session.id,
      message: updateRes.error.message,
      code: updateRes.error.code,
    })
    sendJson(res, 500, { ok: false, error: 'PAYMENT_UPDATE_FAILED' })
    return
  }

  sendJson(res, 200, { ok: true, url: session.url })
}

const handleBalance = async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  try {
    const supabase = createSupabaseServerClient(req, res)
    if (process.env.NODE_ENV !== 'production') {
      const authHeader = req?.headers?.authorization || req?.headers?.Authorization || ''
      console.log('[billing] auth header present', Boolean(authHeader))
    }
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      console.log('[billing][balance] unauthorized', {
        hasUser: Boolean(data?.user),
        hasError: Boolean(error),
        error: error ? String(error.message || error) : null,
      })
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    const userId = data.user.id
    const userIdPrefix = String(userId).slice(0, 8)
    const supabaseAdmin = getSupabaseAdmin()
    // Ensure profile currency is normalized to PLN (legacy profiles might have USD).
    await resolveBillingCurrency(userId, null, supabaseAdmin)
    const billingCurrency = 'PLN'
    try {
      await grantWelcomeBalance(userId, supabaseAdmin, 'billing')
    } catch (error) {
      console.error('[billing][welcome_balance] failed', {
        userIdPrefix,
        message: error?.message ?? null,
        code: error?.code ?? null,
      })
    }
    await ensureBillingAccount(userId, supabaseAdmin)
    const { data: account, error: accountError } = await supabaseAdmin
      .from('billing_accounts')
      .select('balance_pln_grosze,balance_usd_cents')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (accountError) {
      res.status(500).json({ ok: false, error: accountError.message || 'QUERY_FAILED' })
      return
    }
    const balanceMinor = Number(account?.balance_pln_grosze ?? 0)
    console.log('[billing][balance] ok', { userIdPrefix, balanceMinor })
    res.status(200).json({
      ok: true,
      currency: billingCurrency,
      balanceMinor: Number.isFinite(balanceMinor) ? balanceMinor : 0,
      balance_pln_grosze: Number(account?.balance_pln_grosze ?? 0),
      // Legacy: kept for compatibility, no longer used in runtime billing.
      balance_usd_cents: Number(account?.balance_usd_cents ?? 0),
    })
  } catch (error) {
    console.error('[billing][balance] failed', { message: error?.message || String(error) })
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' })
  }
}

const handleAutopayItn = async (req, res) => {
  if (req.method === 'GET') {
    sendJson(res, 200, { ok: true, endpoint: 'billing', action: 'itn', method: 'GET' })
    return
  }
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }

  const itnRequestId = `itn-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`

  const rawBody = await readRawBody(req)
  let transactions = null
  if (rawBody) {
    const params = new URLSearchParams(rawBody)
    const keys = []
    for (const [key] of params.entries()) {
      if (keys.length >= 12) break
      keys.push(key)
    }
    transactions = params.get('transactions')
  }
  if (!transactions && req.body && typeof req.body === 'object') {
    transactions = req.body.transactions
  }
  if (!transactions) {
    sendJson(res, 400, { ok: false, error: 'MISSING_TRANSACTIONS', itnRequestId })
    return
  }

  let xml = ''
  try {
    xml = Buffer.from(String(transactions), 'base64').toString('utf8')
  } catch {
    sendJson(res, 400, { ok: false, error: 'INVALID_BASE64', itnRequestId })
    return
  }
  if (!xml || !xml.includes('<')) {
    sendJson(res, 400, { ok: false, error: 'INVALID_XML', itnRequestId })
    return
  }

  let parsed
  try {
    // Keep values as strings (no number coercion) to avoid breaking hash verification
    // (e.g. "20.00" -> 20 or leading zeros in dates).
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false })
    parsed = parser.parse(xml)
  } catch {
    sendJson(res, 400, { ok: false, error: 'INVALID_XML', itnRequestId })
    return
  }

  const transactionList = parsed?.transactionList || parsed?.transactionlist
  const cleanField = (value) => String(value ?? '').trim()
  const rawField = (value) => String(value ?? '')
  const serviceID = cleanField(transactionList?.serviceID || '')
  const transactionNode = transactionList?.transactions?.transaction
  const transaction = Array.isArray(transactionNode) ? transactionNode[0] : transactionNode
  if (!serviceID || !transaction) {
    sendJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD', itnRequestId })
    return
  }

  // For HASH verification we must use values exactly as transmitted in XML (beyond XML decoding).
  // Do NOT trim these values, as hash input is sensitive to even whitespace.
  const orderID_raw = rawField(transaction?.orderID || '')
  const remoteID_raw = rawField(transaction?.remoteID || '')
  const amount_raw = rawField(transaction?.amount || '')
  const currency_raw = rawField(transaction?.currency || '')
  const gatewayID_raw = rawField(transaction?.gatewayID || '')
  const paymentDate_raw = rawField(transaction?.paymentDate || '')
  const paymentStatus_raw = rawField(transaction?.paymentStatus || '')
  const paymentStatusDetails_raw = rawField(transaction?.paymentStatusDetails || '')
  const receivedHash_raw = rawField(transactionList?.hash || transaction?.hash || '')

  // Cleaned versions for routing/DB lookups/logic.
  const orderID = cleanField(orderID_raw)
  const remoteID = cleanField(remoteID_raw)
  const amount = cleanField(amount_raw)
  const currency = cleanField(currency_raw)
  const gatewayID = cleanField(gatewayID_raw)
  const paymentDate = cleanField(paymentDate_raw)
  const paymentStatus = cleanField(paymentStatus_raw)
  const paymentStatusDetails = cleanField(paymentStatusDetails_raw)
  const receivedHash = cleanField(receivedHash_raw)

  const { key: sharedKey, source: sharedKeySource } = resolveAutopayKey({
    serviceId: serviceID,
    kind: 'itn',
  })
  if (!sharedKey) {
    console.error('[AUTOPAY ITN] missing_shared_key', { itnRequestId })
    sendJson(res, 500, { ok: false, error: 'MISSING_SHARED_KEY', itnRequestId })
    return
  }

  // ITN hash verification must handle extra non-empty fields in SUCCESS payloads.
  // Approach:
  // - Take `serviceID` from transactionList.
  // - Extract direct child elements of `<transaction>` from the decoded XML in their original order.
  // - Exclude hash/checksum fields and empty values (no empty separators).
  // - Append sharedKey as final pipe-separated value.
  // - SHA256 hex.
  const extractOrderedTransactionFields = (xmlText) => {
    const text = String(xmlText || '')
    const match = text.match(/<transaction\b[^>]*>([\s\S]*?)<\/transaction>/i)
    if (!match) return []
    const inner = match[1] || ''
    const out = []
    const re = /<([A-Za-z0-9_:-]+)>([^<]*)<\/\1>/g
    let m
    while ((m = re.exec(inner))) {
      const name = String(m[1] || '').trim()
      const value = String(m[2] || '').trim()
      if (!name) continue
      const normalizedName = name.toLowerCase()
      if (normalizedName === 'hash' || normalizedName === 'checksum' || normalizedName === 'hashvalue') continue
      if (!value) continue
      out.push({ name, value })
    }
    return out
  }

  const orderedTxPairs = extractOrderedTransactionFields(xml)
  const hashValuesRaw = [serviceID, ...orderedTxPairs.map((p) => p.value)]
  const expectedHash = sha256(`${hashValuesRaw.join('|')}|${sharedKey}`).toLowerCase()

  let confirmation = 'NOTCONFIRMED'
  const hashMatches =
    Boolean(receivedHash) && timingSafeHexEqual(String(receivedHash).toLowerCase(), expectedHash)
  if (hashMatches) {
    if (currency !== 'PLN') {
      // Keep PLN-only billing.
    } else if (paymentStatus === 'PENDING') {
      // Valid ITN but not a final state — persist identifiers for audit, do not credit balance.
      try {
        const supabaseAdmin = getSupabaseAdmin()
        const providerPayloadPatch = {
          itn: {
            remoteID,
            gatewayID,
            paymentDate,
            paymentStatus,
            paymentStatusDetails,
            currency,
          },
        }
        const updateRes = await supabaseAdmin
          .from('payments')
          .update({ provider_payload: providerPayloadPatch, updated_at: new Date().toISOString() })
          .eq('order_id', orderID)
        if (updateRes.error) {
          console.error('[AUTOPAY ITN] pending_payment_update_failed', {
            itnRequestId,
            orderID,
            message: updateRes.error.message,
            code: updateRes.error.code,
          })
        } else {
          confirmation = 'CONFIRMED'
        }
      } catch (error) {
        console.error('[AUTOPAY ITN] pending_payment_update_failed', { itnRequestId, orderID, message: error?.message })
      }
    } else if (paymentStatus === 'SUCCESS' && paymentStatusDetails === 'AUTHORIZED') {
      try {
        const supabaseAdmin = getSupabaseAdmin()
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from('payments')
          .select('user_id,amount_pln_grosze,status,updated_at')
          .eq('order_id', orderID)
          .maybeSingle()
        if (paymentError) {
          console.error('[AUTOPAY ITN] payment_lookup_failed', { itnRequestId, orderID, message: paymentError.message })
          confirmation = 'NOTCONFIRMED'
        } else if (!payment) {
          confirmation = 'NOTCONFIRMED'
        } else {
          // Persist the Autopay-side identifiers for later audit/debug (no secrets).
          const providerPayloadPatch = {
            itn: {
              remoteID,
              gatewayID,
              paymentDate,
              paymentStatus,
              paymentStatusDetails,
              currency,
            },
          }
          const providerUpdate = await supabaseAdmin
            .from('payments')
            .update({ provider_payload: providerPayloadPatch, updated_at: new Date().toISOString() })
            .eq('order_id', orderID)
          if (providerUpdate.error) {
            console.error('[AUTOPAY ITN] payment_provider_payload_update_failed', {
              itnRequestId,
              orderID,
              message: providerUpdate.error.message,
              code: providerUpdate.error.code,
            })
          }

          const itnAmountGrosze = parsePlnToGrosze(amount)
          const expectedAmountGrosze = Number(payment.amount_pln_grosze ?? NaN)

          if (itnAmountGrosze == null || !Number.isFinite(expectedAmountGrosze)) {
            confirmation = 'NOTCONFIRMED'
          } else if (itnAmountGrosze !== expectedAmountGrosze) {
            confirmation = 'NOTCONFIRMED'
          } else {
            const balanceBefore = await supabaseAdmin
              .from('billing_accounts')
              .select('balance_pln_grosze,balance_pln,total_paid_pln')
              .eq('user_id', payment.user_id)
              .maybeSingle()

            const rpcRes = await supabaseAdmin.rpc('apply_payment', { order_id_in: orderID })
            if (rpcRes.error) {
              console.error('[AUTOPAY ITN] apply_payment_rpc_failed', {
                itnRequestId,
                orderID,
                message: rpcRes.error.message,
                code: rpcRes.error.code,
                details: rpcRes.error.details,
                hint: rpcRes.error.hint,
              })
              confirmation = 'NOTCONFIRMED'
            } else {
              const paymentAfter = await supabaseAdmin
                .from('payments')
                .select('status,paid_at,updated_at')
                .eq('order_id', orderID)
                .maybeSingle()
              const billingTx = await supabaseAdmin
                .from('billing_transactions')
                .select('id,action_key,amount_grosze,reference_id,created_at')
                .eq('reference_id', orderID)
                .limit(5)
              const balanceAfter = await supabaseAdmin
                .from('billing_accounts')
                .select('balance_pln_grosze,balance_pln,total_paid_pln,updated_at')
                .eq('user_id', payment.user_id)
                .maybeSingle()
              confirmation = 'CONFIRMED'
              console.log('[AUTOPAY ITN] credited', { itnRequestId, orderID, amount, currency })
            }
          }
        }
      } catch (error) {
        console.error('[AUTOPAY ITN] apply_failed', { itnRequestId, orderID, message: error?.message })
        confirmation = 'NOTCONFIRMED'
      }
    } else {
      // Valid ITN but not a creditable final state.
    }
  }

  const responseXml = buildConfirmXml({
    serviceID,
    orderID,
    confirmation,
    sharedKey,
  })
  console.log('[AUTOPAY ITN] confirmation_sent', { itnRequestId, orderID, confirmation })
  res.status(200)
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.send(responseXml)
}

const handleAutopayReturn = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }
  res.statusCode = 303
  res.setHeader('Location', '/engine?payment=success')
  res.end()
}

const redirect303 = (res, location) => {
  res.statusCode = 303
  res.setHeader('Location', location)
  res.end()
}

const handleStripeReturn = async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  const sessionId = String(resolveQueryValue(req, 'session_id') || '').trim()
  const returnTo = await resolveStripeReturnTo(req, sessionId)
  redirect303(res, appendReturnPaymentParams(returnTo, {
    payment: 'stripe_success',
    session_id: sessionId,
  }))
}

const handleStripeCancelReturn = async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  const sessionId = String(resolveQueryValue(req, 'session_id') || '').trim()
  const returnTo = await resolveStripeReturnTo(req, sessionId)
  redirect303(res, appendReturnPaymentParams(returnTo, {
    payment: 'stripe_cancelled',
    session_id: sessionId,
  }))
}

const lookupStripePaymentForSession = async (supabaseAdmin, session) => {
  const metadata = session?.metadata || {}
  const internalPaymentId = String(metadata.internalPaymentId || '').trim()
  const orderId = String(metadata.orderId || '').trim()
  let query = supabaseAdmin
    .from('payments')
    .select('id,user_id,provider,order_id,amount_pln_grosze,status,provider_payload,paid_at')
    .eq('provider', 'stripe')
  if (internalPaymentId) {
    query = query.eq('id', internalPaymentId)
  } else if (orderId) {
    query = query.eq('order_id', orderId)
  } else {
    return { payment: null, error: null }
  }
  const { data, error } = await query.maybeSingle()
  return { payment: data ?? null, error }
}

const updateStripePaymentPayload = async (supabaseAdmin, payment, patch, event, status = null) => {
  const providerPayload = mergeStripeEventPayload(payment.provider_payload, patch, event)
  const update = {
    provider_payload: providerPayload,
    updated_at: new Date().toISOString(),
  }
  if (status && payment.status === 'pending') update.status = status
  const { error } = await supabaseAdmin
    .from('payments')
    .update(update)
    .eq('id', payment.id)
    .eq('provider', 'stripe')
  return error
}

const handleStripePaidSession = async ({ supabaseAdmin, session, event }) => {
  if (session.payment_status !== 'paid') {
    return { ok: true, skipped: 'NOT_PAID' }
  }
  const { payment, error } = await lookupStripePaymentForSession(supabaseAdmin, session)
  if (error) {
    return { ok: false, status: 500, error: 'PAYMENT_LOOKUP_FAILED', detail: error.message }
  }
  if (!payment) {
    return { ok: false, status: 404, error: 'PAYMENT_NOT_FOUND' }
  }
  if (payment.provider !== 'stripe') {
    return { ok: false, status: 400, error: 'PROVIDER_MISMATCH' }
  }
  if (payment.status !== 'pending' && payment.status !== 'paid') {
    await updateStripePaymentPayload(supabaseAdmin, payment, {
      checkout_session_id: session.id,
      payment_status: session.payment_status ?? null,
      ignored_status: payment.status,
    }, event)
    return { ok: true, skipped: 'PAYMENT_NOT_SETTLEABLE' }
  }

  const expectedAmount = Number(payment.amount_pln_grosze ?? NaN)
  const stripeAmount = Number(session.amount_total ?? NaN)
  const expectedCurrency = resolveStripeCurrency()
  const stripeCurrency = String(session.currency || '').trim().toLowerCase()
  if (!Number.isFinite(expectedAmount) || !Number.isFinite(stripeAmount) || stripeAmount !== expectedAmount) {
    await updateStripePaymentPayload(supabaseAdmin, payment, {
      checkout_session_id: session.id,
      payment_status: session.payment_status ?? null,
      amount_total: session.amount_total ?? null,
      amount_mismatch: true,
    }, event)
    return { ok: false, status: 400, error: 'AMOUNT_MISMATCH' }
  }
  if (stripeCurrency !== expectedCurrency) {
    await updateStripePaymentPayload(supabaseAdmin, payment, {
      checkout_session_id: session.id,
      payment_status: session.payment_status ?? null,
      currency: stripeCurrency,
      currency_mismatch: true,
    }, event)
    return { ok: false, status: 400, error: 'CURRENCY_MISMATCH' }
  }

  const preApplyUpdateError = await updateStripePaymentPayload(supabaseAdmin, payment, {
    checkout_session_id: session.id,
    payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    payment_status: session.payment_status ?? null,
    amount_total: session.amount_total ?? null,
    currency: stripeCurrency,
    last_success_event_id: event.id,
  }, event)
  if (preApplyUpdateError) {
    return { ok: false, status: 500, error: 'PAYMENT_UPDATE_FAILED', detail: preApplyUpdateError.message }
  }

  const rpcRes = await supabaseAdmin.rpc('apply_payment', { order_id_in: payment.order_id })
  if (rpcRes.error) {
    return { ok: false, status: 500, error: 'APPLY_PAYMENT_FAILED', detail: rpcRes.error.message }
  }
  return { ok: true, settled: true }
}

const handleStripeWebhook = async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  if (!isStripeEnabled()) {
    notFound(res)
    return
  }

  const rawBody = await readRawBody(req)
  const signature = req?.headers?.['stripe-signature'] || req?.headers?.['Stripe-Signature'] || ''
  let event
  try {
    event = await verifyStripeWebhook(rawBody, signature)
  } catch (error) {
    const errorCode = String(error?.code || '')
    if (errorCode.startsWith('MISSING_STRIPE_')) {
      sendJson(res, 500, { ok: false, error: 'MISSING_STRIPE_ENV' })
      return
    }
    console.error('[STRIPE WEBHOOK] signature_verification_failed', {
      message: error?.message ?? String(error),
    })
    sendJson(res, 400, { ok: false, error: 'INVALID_SIGNATURE' })
    return
  }

  const supabaseAdmin = getSupabaseAdmin()
  const session = event?.data?.object
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const result = await handleStripePaidSession({ supabaseAdmin, session, event })
    if (!result.ok) {
      console.error('[STRIPE WEBHOOK] paid_session_failed', {
        eventId: event.id,
        type: event.type,
        error: result.error,
        detail: result.detail ?? null,
      })
      sendJson(res, result.status || 500, { ok: false, error: result.error })
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }

  if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
    const { payment, error } = await lookupStripePaymentForSession(supabaseAdmin, session)
    if (error) {
      sendJson(res, 500, { ok: false, error: 'PAYMENT_LOOKUP_FAILED' })
      return
    }
    if (payment) {
      const nextStatus = event.type === 'checkout.session.expired' ? 'canceled' : 'failed'
      const updateError = await updateStripePaymentPayload(supabaseAdmin, payment, {
        checkout_session_id: session.id,
        payment_status: session.payment_status ?? null,
        last_failure_event_id: event.id,
      }, event, nextStatus)
      if (updateError) {
        sendJson(res, 500, { ok: false, error: 'PAYMENT_UPDATE_FAILED' })
        return
      }
    }
    sendJson(res, 200, { ok: true })
    return
  }

  sendJson(res, 200, { ok: true, ignored: true })
}

const handlePaymentStatus = async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  const provider = String(resolveQueryValue(req, 'provider') || '').trim().toLowerCase()
  const sessionId = String(resolveQueryValue(req, 'session_id') || '').trim()
  if (provider !== 'stripe' || !sessionId) {
    sendJson(res, 400, { ok: false, error: 'INVALID_PAYMENT_STATUS_QUERY' })
    return
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { userId } = await resolveAuthenticatedUser(req, res, supabaseAdmin)
  if (!userId) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    return
  }
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('status,paid_at,provider_payload')
    .eq('provider', 'stripe')
    .eq('user_id', userId)
    .eq('provider_payload->stripe->>checkout_session_id', sessionId)
    .maybeSingle()
  if (error) {
    sendJson(res, 500, { ok: false, error: 'PAYMENT_STATUS_LOOKUP_FAILED' })
    return
  }
  if (!data) {
    sendJson(res, 404, { ok: false, error: 'PAYMENT_NOT_FOUND' })
    return
  }
  const status = ['pending', 'paid', 'failed', 'canceled'].includes(data.status) ? data.status : 'pending'
  sendJson(res, 200, {
    ok: true,
    status,
    balanceUpdated: status === 'paid' && Boolean(data.paid_at),
  })
}

export default async function handler(req, res) {
  const actionFromQuery = resolveAction(req, null)
  if (actionFromQuery === 'itn') {
    await handleAutopayItn(req, res)
    return
  }
  if (actionFromQuery === 'stripe_webhook') {
    await handleStripeWebhook(req, res)
    return
  }
  if (actionFromQuery === 'return') {
    await handleAutopayReturn(req, res)
    return
  }
  if (actionFromQuery === 'stripe_return') {
    await handleStripeReturn(req, res)
    return
  }
  if (actionFromQuery === 'stripe_cancel_return') {
    await handleStripeCancelReturn(req, res)
    return
  }

  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'create_payment') {
    await handleCreatePayment(req, res)
    return
  }
  if (action === 'create_stripe_checkout') {
    await handleCreateStripeCheckout(req, res)
    return
  }
  if (action === 'balance') {
    await handleBalance(req, res)
    return
  }
  if (action === 'payment_status') {
    await handlePaymentStatus(req, res)
    return
  }
  if (action === 'test_topup') {
    // TEMP: free topup for testers – remove when Autopay live.
    await handleTestTopup(req, res)
    return
  }
  notFound(res)
}
