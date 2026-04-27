import { createHash, randomUUID } from 'crypto'
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

const resolveCurrencyFromLang = (lang) => (lang === 'pl' ? 'PLN' : 'USD')

const resolveTestTopup = (tier, currency) => {
  const safeTier = String(tier || '').trim().toUpperCase()
  const safeCurrency = currency === 'USD' ? 'USD' : 'PLN'
  const amountMinorMap = safeCurrency === 'PLN'
    ? { S: 2000, M: 5000, L: 10000 }
    : { S: 500, M: 1500, L: 3000 }
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

    const balanceColumn =
      currency === 'USD' ? 'balance_usd_cents' : 'balance_pln_grosze'
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
  const sharedKey = process.env.AUTOPAY_SHARED_KEY || ''
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
  console.log('[AUTOPAY CREATE] order_id_length', { orderId, length: orderId.length })
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
  console.log('[AUTOPAY CREATE] return_url', { returnUrl })
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
  console.log('[AUTOPAY CREATE] form_payload', {
    serviceId,
    orderId,
    amountStr,
    description,
    currency,
    hasCustomerEmail: Boolean(userEmail),
    hasReturnUrl: Boolean(returnUrl),
    gatewayUrl,
    hashPrefix: hash.slice(0, 8),
  })

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
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    const userId = data.user.id
    const lang = normalizeLang(req.query?.lang || req.query?.language, req)
    const preferredCurrency = resolveCurrencyFromLang(lang)
    const supabaseAdmin = getSupabaseAdmin()
    const billingCurrency = await resolveBillingCurrency(
      userId,
      preferredCurrency,
      supabaseAdmin
    )
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
    const balanceMinor =
      billingCurrency === 'USD'
        ? Number(account?.balance_usd_cents ?? 0)
        : Number(account?.balance_pln_grosze ?? 0)
    res.status(200).json({
      ok: true,
      currency: billingCurrency,
      balanceMinor: Number.isFinite(balanceMinor) ? balanceMinor : 0,
      balance_pln_grosze: Number(account?.balance_pln_grosze ?? 0),
      balance_usd_cents: Number(account?.balance_usd_cents ?? 0),
    })
  } catch (error) {
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

  console.log('[AUTOPAY ITN] received')

  const rawBody = await readRawBody(req)
  console.log('[AUTOPAY ITN] raw_body_present', Boolean(rawBody))
  let transactions = null
  if (rawBody) {
    const params = new URLSearchParams(rawBody)
    transactions = params.get('transactions')
  }
  if (!transactions && req.body && typeof req.body === 'object') {
    transactions = req.body.transactions
  }
  if (!transactions) {
    sendJson(res, 400, { ok: false, error: 'MISSING_TRANSACTIONS' })
    return
  }

  let xml = ''
  try {
    xml = Buffer.from(String(transactions), 'base64').toString('utf8')
  } catch {
    sendJson(res, 400, { ok: false, error: 'INVALID_BASE64' })
    return
  }
  console.log('[AUTOPAY ITN] decoded_xml_prefix', String(xml).slice(0, 160))
  if (!xml || !xml.includes('<')) {
    sendJson(res, 400, { ok: false, error: 'INVALID_XML' })
    return
  }

  let parsed
  try {
    // Keep values as strings (no number coercion) to avoid breaking hash verification
    // (e.g. "20.00" -> 20 or leading zeros in dates).
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false })
    parsed = parser.parse(xml)
  } catch {
    sendJson(res, 400, { ok: false, error: 'INVALID_XML' })
    return
  }

  const transactionList = parsed?.transactionList || parsed?.transactionlist
  const cleanField = (value) => String(value ?? '').trim()
  const serviceID = cleanField(transactionList?.serviceID || '')
  const transactionNode = transactionList?.transactions?.transaction
  const transaction = Array.isArray(transactionNode) ? transactionNode[0] : transactionNode
  if (!serviceID || !transaction) {
    sendJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
    return
  }

  const orderID = cleanField(transaction?.orderID || '')
  const remoteID = cleanField(transaction?.remoteID || '')
  const amount = cleanField(transaction?.amount || '')
  const currency = cleanField(transaction?.currency || '')
  const gatewayID = cleanField(transaction?.gatewayID || '')
  const paymentDate = cleanField(transaction?.paymentDate || '')
  const paymentStatus = cleanField(transaction?.paymentStatus || '')
  const paymentStatusDetails = cleanField(transaction?.paymentStatusDetails || '')
  const receivedHash = cleanField(transactionList?.hash || transaction?.hash || '')
  const receivedHashPrefix = receivedHash ? receivedHash.slice(0, 8) : ''

  console.log('[AUTOPAY ITN] parsed_fields', {
    serviceID,
    orderID,
    remoteID,
    amount,
    currency,
    gatewayID,
    paymentDate,
    paymentStatus,
    paymentStatusDetails,
    receivedHashPrefix,
  })
  console.log('[AUTOPAY ITN] received_hash_prefix', receivedHashPrefix)

  const sharedKey = process.env.AUTOPAY_SHARED_KEY || ''
  if (!sharedKey) {
    sendJson(res, 500, { ok: false, error: 'MISSING_SHARED_KEY' })
    return
  }

  const hashValues = [
    serviceID,
    orderID,
    remoteID,
    amount,
    currency,
    gatewayID,
    paymentDate,
    paymentStatus,
    paymentStatusDetails,
  ]
  // Log without shared key.
  const hashInputStringPrefix = `${hashValues.join('|')}|`.slice(0, 200)
  console.log('[AUTOPAY ITN] hash_input_string_prefix', hashInputStringPrefix)

  const expectedHash = sha256(`${hashValues.join('|')}|${sharedKey}`)
  console.log('[AUTOPAY ITN] expected_hash_prefix', expectedHash.slice(0, 8))

  let confirmation = 'NOTCONFIRMED'
  if (receivedHash && receivedHash.toLowerCase() === expectedHash.toLowerCase()) {
    if (paymentStatus === 'SUCCESS') {
      try {
        const supabaseAdmin = getSupabaseAdmin()
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from('payments')
          .select('amount_pln_grosze,status')
          .eq('order_id', orderID)
          .maybeSingle()
        if (paymentError) {
          console.error('[AUTOPAY ITN] payment_lookup_failed', { orderID, message: paymentError.message })
          confirmation = 'NOTCONFIRMED'
        } else if (!payment) {
          console.log('[AUTOPAY ITN] payment_lookup_result', { orderID, found: false })
          confirmation = 'NOTCONFIRMED'
        } else {
          const itnAmountGrosze = parsePlnToGrosze(amount)
          const expectedAmountGrosze = Number(payment.amount_pln_grosze ?? NaN)
          console.log('[AUTOPAY ITN] payment_lookup_result', {
            orderID,
            found: true,
            dbAmountGrosze: Number.isFinite(expectedAmountGrosze) ? expectedAmountGrosze : null,
            dbStatus: payment.status ?? null,
          })

          if (itnAmountGrosze == null || !Number.isFinite(expectedAmountGrosze)) {
            console.log('[AUTOPAY ITN] amount_check', {
              orderID,
              itnAmountGrosze: itnAmountGrosze ?? null,
              dbAmountGrosze: Number.isFinite(expectedAmountGrosze) ? expectedAmountGrosze : null,
              match: false,
              parseOk: false,
            })
            confirmation = 'NOTCONFIRMED'
          } else if (itnAmountGrosze !== expectedAmountGrosze) {
            console.log('[AUTOPAY ITN] amount_check', {
              orderID,
              itnAmountGrosze,
              dbAmountGrosze: expectedAmountGrosze,
              match: false,
              parseOk: true,
            })
            confirmation = 'NOTCONFIRMED'
          } else {
            await supabaseAdmin.rpc('apply_payment', { order_id_in: orderID })
            console.log('[AUTOPAY ITN] amount_check', {
              orderID,
              itnAmountGrosze,
              dbAmountGrosze: expectedAmountGrosze,
              match: true,
              parseOk: true,
            })
            console.log('[AUTOPAY ITN] applied', { orderID, amount })
            confirmation = 'CONFIRMED'
          }
        }
      } catch (error) {
        console.error('[AUTOPAY ITN] apply_failed', { orderID, message: error?.message })
        confirmation = 'NOTCONFIRMED'
      }
    }
  } else {
    console.log('[AUTOPAY ITN] hash_mismatch orderID=%s', orderID)
  }

  const responseXml = buildConfirmXml({
    serviceID,
    orderID,
    confirmation,
    sharedKey,
  })
  console.log('[AUTOPAY ITN] response_confirmation', confirmation)
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
