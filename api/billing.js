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
const md5 = (value) => createHash('md5').update(value, 'utf8').digest('hex')

const buildHashPayload = (values) => values.map((value) => String(value ?? '').trim()).filter(Boolean).join('|')

const safeKeyMeta = (key) => {
  const value = String(key || '')
  return {
    present: Boolean(value),
    len: value.length,
  }
}

const fingerprintKey = (key) => {
  const value = String(key || '')
  if (!value) return null
  return sha256(value).slice(0, 6)
}

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

const isHashDiagEnabled = () => {
  const raw = String(process.env.AUTOPAY_ITN_HASH_DIAG || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

const isHashDiagMd5Enabled = () => {
  const raw = String(process.env.AUTOPAY_ITN_HASH_DIAG_MD5 || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
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
  console.log('[AUTOPAY CREATE] payment_insert_ok', {
    orderId,
    userIdPrefix: String(userId).slice(0, 8),
    amountPln,
    amountGrosze,
  })

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
  console.log('[AUTOPAY CREATE] key_meta', {
    serviceId,
    formKey: safeKeyMeta(sharedKey),
    formKeyFingerprint: fingerprintKey(sharedKey),
    formKeyEnv: sharedKeySource,
    formHashPrefix: hash.slice(0, 8),
  })
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
  const rawUrl = req?.url || ''
  const contentType = String(req?.headers?.['content-type'] || '')
  const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '')
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : req?.socket?.remoteAddress || 'unknown'
  console.log('[AUTOPAY ITN] received', {
    itnRequestId,
    url: rawUrl,
    method: req.method,
    contentType,
    ip,
  })

  const rawBody = await readRawBody(req)
  console.log('[AUTOPAY ITN] raw_body_present', { itnRequestId, present: Boolean(rawBody), len: rawBody.length })
  let transactions = null
  if (rawBody) {
    const params = new URLSearchParams(rawBody)
    const keys = []
    for (const [key] of params.entries()) {
      if (keys.length >= 12) break
      keys.push(key)
    }
    console.log('[AUTOPAY ITN] raw_body_keys', { itnRequestId, keys })
    transactions = params.get('transactions')
  }
  if (!transactions && req.body && typeof req.body === 'object') {
    console.log('[AUTOPAY ITN] body_object_keys', {
      itnRequestId,
      keys: Object.keys(req.body).slice(0, 12),
    })
    transactions = req.body.transactions
  }
  if (!transactions) {
    console.log('[AUTOPAY ITN] missing_transactions', { itnRequestId })
    sendJson(res, 400, { ok: false, error: 'MISSING_TRANSACTIONS', itnRequestId })
    return
  }

  let xml = ''
  try {
    xml = Buffer.from(String(transactions), 'base64').toString('utf8')
  } catch {
    console.log('[AUTOPAY ITN] invalid_base64', { itnRequestId })
    sendJson(res, 400, { ok: false, error: 'INVALID_BASE64', itnRequestId })
    return
  }
  console.log('[AUTOPAY ITN] decoded_xml_prefix', { itnRequestId, prefix: String(xml).slice(0, 160) })
  if (!xml || !xml.includes('<')) {
    console.log('[AUTOPAY ITN] invalid_xml', { itnRequestId })
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
    console.log('[AUTOPAY ITN] xml_parse_failed', { itnRequestId })
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
    console.log('[AUTOPAY ITN] invalid_payload', { itnRequestId, hasServiceID: Boolean(serviceID), hasTx: Boolean(transaction) })
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
  const receivedHashPrefix = receivedHash ? receivedHash.slice(0, 8) : ''

  console.log('[AUTOPAY ITN] parsed_fields', {
    itnRequestId,
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

  const { key: sharedKey, source: sharedKeySource } = resolveAutopayKey({
    serviceId: serviceID,
    kind: 'itn',
  })
  if (!sharedKey) {
    console.error('[AUTOPAY ITN] missing_shared_key', { itnRequestId })
    sendJson(res, 500, { ok: false, error: 'MISSING_SHARED_KEY', itnRequestId })
    return
  }
  console.log('[AUTOPAY ITN] key_meta', {
    itnRequestId,
    serviceID,
    sharedKey: safeKeyMeta(sharedKey),
    sharedKeyFingerprint: fingerprintKey(sharedKey),
    sharedKeyEnv: sharedKeySource,
    diagEnabled: isHashDiagEnabled(),
  })

  // Official docs example (Autopay Online Payment Gateway - Documentation, "Example calculation of the value of a hash function in an ITN message"):
  // Hash = SHA256("serviceID|orderID|remoteID|amount|currency|gatewayID|paymentDate|paymentStatus|paymentStatusDetails|shared_key")
  // IMPORTANT: empty optional fields MUST preserve separators (i.e. do NOT drop empty values).
  // IMPORTANT: do NOT add an extra trailing separator after shared_key.
  const hashValuesRaw = [
    serviceID,
    orderID_raw,
    remoteID_raw,
    amount_raw,
    currency_raw,
    gatewayID_raw,
    paymentDate_raw,
    paymentStatus_raw,
    paymentStatusDetails_raw,
  ]
  const hashFieldNames = [
    'serviceID',
    'orderID',
    'remoteID',
    'amount',
    'currency',
    'gatewayID',
    'paymentDate',
    'paymentStatus',
    'paymentStatusDetails',
  ]
  const rawPairs = hashFieldNames.map((name, idx) => ({
    name,
    value: String(hashValuesRaw[idx] ?? ''),
  }))
  const normalizedPairs = rawPairs.map((pair) => ({
    name: pair.name,
    // No normalization beyond XML decoding (hash input is sensitive to whitespace).
    value: pair.value,
  }))

  const hashPayload = normalizedPairs.map((pair) => pair.value).join('|')
  const expectedDoc = sha256(`${hashPayload}|${sharedKey}`).toLowerCase()

  console.log('[AUTOPAY ITN] hash_fields', {
    itnRequestId,
    included: hashFieldNames,
    trailingSeparatorUsed: false,
  })
  console.log('[AUTOPAY ITN] hash_algorithm_version', {
    itnRequestId,
    value: 'itn_v2_pipe_shared_key_final',
    hasSeparatorBeforeSharedKey: true,
    hasTrailingSeparatorAfterSharedKey: false,
    fieldCountIncludingSharedKey: 10,
  })
  console.log('[AUTOPAY ITN] hash_values_normalized', {
    itnRequestId,
    values: normalizedPairs.map((p) => ({ [p.name]: p.value })),
  })

  // Production verifier: documented variant (all fields, pipes, then pipe + key).
  const expectedHash = expectedDoc
  console.log('[AUTOPAY ITN] expected_hash_prefix', { itnRequestId, prefix: expectedHash.slice(0, 8) })
  console.log('[AUTOPAY ITN] received_hash_prefix', { itnRequestId, prefix: receivedHashPrefix })

  if (isHashDiagEnabled()) {
    const receivedLower = String(receivedHash || '').toLowerCase()

    const fieldValuesClean = [
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
    const fieldNames = [...hashFieldNames]
    const fieldValuesRaw = [...normalizedPairs.map((p) => p.value)]

    const variants = []
    const addVariant = (name, fields, hashValue, algo = 'sha256') => {
      variants.push({
        name,
        algo,
        fields,
        prefix: String(hashValue || '').slice(0, 8),
        match: String(hashValue || '').toLowerCase() === receivedLower,
      })
    }

    const joinAll = (values) => values.map((v) => String(v ?? '')).join('|')
    const joinSkipEmpty = (values) =>
      values
        .map((v) => String(v ?? ''))
        .filter((v) => v !== '')
        .join('|')

    // 1) documented variant (all fields, key as final pipe-separated field)
    addVariant(
      '1_doc_fields_pipe_shared_key_final',
      [...fieldNames, 'sharedKey'],
      sha256(`${joinAll(fieldValuesRaw)}|${sharedKey}`).toLowerCase()
    )
    // 2) without serviceID
    addVariant(
      '2_no_serviceID_pipe_shared_key_final',
      [...fieldNames.slice(1), 'sharedKey'],
      sha256(`${joinAll(fieldValuesRaw.slice(1))}|${sharedKey}`).toLowerCase()
    )
    // 3) without remoteID
    addVariant(
      '3_no_remoteID_pipe_shared_key_final',
      ['serviceID', 'orderID', 'amount', 'currency', 'gatewayID', 'paymentDate', 'paymentStatus', 'paymentStatusDetails', 'sharedKey'],
      sha256(
        `${joinAll([
          serviceID,
          orderID_raw,
          amount_raw,
          currency_raw,
          gatewayID_raw,
          paymentDate_raw,
          paymentStatus_raw,
          paymentStatusDetails_raw,
        ])}|${sharedKey}`
      ).toLowerCase()
    )
    // 4) without paymentStatusDetails
    addVariant(
      '4_no_paymentStatusDetails_pipe_shared_key_final',
      ['serviceID', 'orderID', 'remoteID', 'amount', 'currency', 'gatewayID', 'paymentDate', 'paymentStatus', 'sharedKey'],
      sha256(
        `${joinAll([
          serviceID,
          orderID_raw,
          remoteID_raw,
          amount_raw,
          currency_raw,
          gatewayID_raw,
          paymentDate_raw,
          paymentStatus_raw,
        ])}|${sharedKey}`
      ).toLowerCase()
    )
    // 5) omit empty fields
    addVariant(
      '5_skip_empty_fields_pipe_shared_key_final',
      [...fieldNames.filter((_, i) => String(fieldValuesRaw[i] ?? '') !== ''), 'sharedKey'],
      sha256(`${joinSkipEmpty(fieldValuesRaw)}|${sharedKey}`).toLowerCase()
    )
    // 6) include empty fields as separators (same as 1, but named explicitly)
    addVariant(
      '6_include_empty_fields_as_separators_pipe_shared_key_final',
      [...fieldNames, 'sharedKey'],
      sha256(`${joinAll(fieldValuesRaw)}|${sharedKey}`).toLowerCase()
    )
    // 7) use cleaned values (trimmed) instead of raw XML
    addVariant(
      '7_clean_values_trimmed_pipe_shared_key_final',
      [...fieldNames, 'sharedKey'],
      sha256(`${joinAll(fieldValuesClean)}|${sharedKey}`).toLowerCase()
    )
    // 8) append sharedKey directly without pipe
    addVariant(
      '8_fields_plus_shared_key_no_pipe',
      [...fieldNames, 'sharedKey'],
      sha256(`${joinAll(fieldValuesRaw)}${sharedKey}`).toLowerCase()
    )
    // 9) add trailing pipe after sharedKey
    addVariant(
      '9_fields_pipe_shared_key_pipe_trailing',
      [...fieldNames, 'sharedKey', '(trailing|)'],
      sha256(`${joinAll(fieldValuesRaw)}|${sharedKey}|`).toLowerCase()
    )
    // 10) SHA256(decoded XML without hash node + pipe + sharedKey)
    const xmlNoHash = String(xml || '').replace(/<hash>.*?<\\/hash>/s, '')
    addVariant(
      '10_xml_without_hash_node_pipe_shared_key_final',
      ['xml_without_hash_node', 'sharedKey'],
      sha256(`${xmlNoHash}|${sharedKey}`).toLowerCase()
    )

    if (isHashDiagMd5Enabled()) {
      addVariant(
        'md5_doc_fields_pipe_shared_key_final',
        [...fieldNames, 'sharedKey'],
        md5(`${joinAll(fieldValuesRaw)}|${sharedKey}`).toLowerCase(),
        'md5'
      )
    }

    for (const v of variants) {
      console.log('[AUTOPAY ITN] hash_diag_variant', {
        itnRequestId,
        serviceID,
        variant: v.name,
        algo: v.algo,
        fields: v.fields,
        prefix: v.prefix,
        match: v.match,
      })
    }
  }

  let confirmation = 'NOTCONFIRMED'
  const hashMatches = receivedHash && receivedHash.toLowerCase() === expectedHash.toLowerCase()
  if (hashMatches) {
    console.log('[AUTOPAY ITN] hash_match', { itnRequestId, orderID })
    if (currency !== 'PLN') {
      console.log('[AUTOPAY ITN] hash_ok_but_currency_not_pln', { itnRequestId, orderID, currency })
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
          console.log('[AUTOPAY ITN] pending_payment_update_ok', { itnRequestId, orderID })
          confirmation = 'CONFIRMED'
        }
      } catch (error) {
        console.error('[AUTOPAY ITN] pending_payment_update_failed', { itnRequestId, orderID, message: error?.message })
      }
    } else if (paymentStatus === 'SUCCESS' && paymentStatusDetails === 'AUTHORIZED') {
      try {
        const supabaseAdmin = getSupabaseAdmin()
        console.log('[AUTOPAY ITN] hash_ok', { itnRequestId, orderID })
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from('payments')
          .select('user_id,amount_pln_grosze,status,updated_at')
          .eq('order_id', orderID)
          .maybeSingle()
        if (paymentError) {
          console.error('[AUTOPAY ITN] payment_lookup_failed', { itnRequestId, orderID, message: paymentError.message })
          confirmation = 'NOTCONFIRMED'
        } else if (!payment) {
          console.log('[AUTOPAY ITN] payment_lookup_result', { itnRequestId, orderID, found: false })
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
          } else {
            console.log('[AUTOPAY ITN] payment_provider_payload_update_ok', { itnRequestId, orderID })
          }

          const itnAmountGrosze = parsePlnToGrosze(amount)
          const expectedAmountGrosze = Number(payment.amount_pln_grosze ?? NaN)
          console.log('[AUTOPAY ITN] payment_lookup_result', {
            itnRequestId,
            orderID,
            found: true,
            dbAmountGrosze: Number.isFinite(expectedAmountGrosze) ? expectedAmountGrosze : null,
            dbStatus: payment.status ?? null,
            userIdPrefix: String(payment.user_id || '').slice(0, 8),
          })

          if (itnAmountGrosze == null || !Number.isFinite(expectedAmountGrosze)) {
            console.log('[AUTOPAY ITN] amount_check', {
              itnRequestId,
              orderID,
              itnAmountGrosze: itnAmountGrosze ?? null,
              dbAmountGrosze: Number.isFinite(expectedAmountGrosze) ? expectedAmountGrosze : null,
              match: false,
              parseOk: false,
            })
            confirmation = 'NOTCONFIRMED'
          } else if (itnAmountGrosze !== expectedAmountGrosze) {
            console.log('[AUTOPAY ITN] amount_check', {
              itnRequestId,
              orderID,
              itnAmountGrosze,
              dbAmountGrosze: expectedAmountGrosze,
              match: false,
              parseOk: true,
            })
            confirmation = 'NOTCONFIRMED'
          } else {
            const balanceBefore = await supabaseAdmin
              .from('billing_accounts')
              .select('balance_pln_grosze,balance_pln,total_paid_pln')
              .eq('user_id', payment.user_id)
              .maybeSingle()
            console.log('[AUTOPAY ITN] pre_apply_snapshot', {
              itnRequestId,
              orderID,
              billingAccountFound: Boolean(balanceBefore.data),
              balance_pln_grosze: balanceBefore.data?.balance_pln_grosze ?? null,
              balance_pln: balanceBefore.data?.balance_pln ?? null,
              total_paid_pln: balanceBefore.data?.total_paid_pln ?? null,
              accountError: balanceBefore.error ? balanceBefore.error.message : null,
            })

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
              console.log('[AUTOPAY ITN] post_apply_snapshot', {
                itnRequestId,
                orderID,
                paymentStatus: paymentAfter.data?.status ?? null,
                paidAt: paymentAfter.data?.paid_at ?? null,
                billingTransactionsForOrderId: Array.isArray(billingTx.data) ? billingTx.data.length : null,
                billingTransactionsError: billingTx.error ? billingTx.error.message : null,
                billingAccountFound: Boolean(balanceAfter.data),
                balance_pln_grosze: balanceAfter.data?.balance_pln_grosze ?? null,
                balance_pln: balanceAfter.data?.balance_pln ?? null,
                total_paid_pln: balanceAfter.data?.total_paid_pln ?? null,
                paymentAfterError: paymentAfter.error ? paymentAfter.error.message : null,
                accountAfterError: balanceAfter.error ? balanceAfter.error.message : null,
              })
              confirmation = 'CONFIRMED'
            }
            console.log('[AUTOPAY ITN] amount_check', {
              itnRequestId,
              orderID,
              itnAmountGrosze,
              dbAmountGrosze: expectedAmountGrosze,
              match: true,
              parseOk: true,
            })
            console.log('[AUTOPAY ITN] applied', { itnRequestId, orderID, amount })
          }
        }
      } catch (error) {
        console.error('[AUTOPAY ITN] apply_failed', { itnRequestId, orderID, message: error?.message })
        confirmation = 'NOTCONFIRMED'
      }
    } else {
      console.log('[AUTOPAY ITN] hash_ok_but_status_not_creditable', {
        itnRequestId,
        orderID,
        paymentStatus,
        paymentStatusDetails,
      })
    }
  } else {
    console.log('[AUTOPAY ITN] hash_mismatch', { itnRequestId, orderID, receivedHashPrefix })
  }

  const responseXml = buildConfirmXml({
    serviceID,
    orderID,
    confirmation,
    sharedKey,
  })
  console.log('[AUTOPAY ITN] response_confirmation', { itnRequestId, orderID, confirmation })
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
