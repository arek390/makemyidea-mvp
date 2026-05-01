import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { XMLParser } from 'fast-xml-parser'
import { createSupabaseServerClient } from '../src/lib/server/supabaseServer.js'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import { resolveBillingCurrency, ensureBillingAccount } from '../src/lib/server/billing.js'

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
    const supabaseAdmin = getSupabaseAdmin()
    // Ensure profile currency is normalized to PLN (legacy profiles might have USD).
    await resolveBillingCurrency(userId, null, supabaseAdmin)
    const billingCurrency = 'PLN'
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
    console.log('[billing][balance] ok', { userIdPrefix: String(userId).slice(0, 8), balanceMinor })
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

export default async function handler(req, res) {
  const actionFromQuery = resolveAction(req, null)
  if (actionFromQuery === 'itn') {
    await handleAutopayItn(req, res)
    return
  }
  if (actionFromQuery === 'return') {
    await handleAutopayReturn(req, res)
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
  if (action === 'balance') {
    await handleBalance(req, res)
    return
  }
  if (action === 'test_topup') {
    // TEMP: free topup for testers – remove when Autopay live.
    await handleTestTopup(req, res)
    return
  }
  notFound(res)
}
