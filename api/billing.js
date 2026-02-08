import { createHash, randomUUID } from 'crypto'
import { XMLParser } from 'fast-xml-parser'
import { createSupabaseServerClient } from '../src/lib/server/supabaseServer.js'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'

const readRawBody = async (req) => {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  return body
}

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex')

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

const resolveFxUsdPln = () => {
  const raw = Number(process.env.FX_USD_PLN || 0)
  return Number.isFinite(raw) && raw > 0 ? raw : 4.0
}

const resolveTestTopup = (tier, lang) => {
  const safeTier = String(tier || '').trim().toUpperCase()
  const isPl = lang === 'pl'
  const currency = isPl ? 'PLN' : 'USD'
  const amountMinorMap = isPl
    ? { S: 2000, M: 5000, L: 10000 }
    : { S: 500, M: 1500, L: 3000 }
  const amountMinor = amountMinorMap[safeTier] ?? null
  return { tier: safeTier, currency, amountMinor }
}

const handleTestTopup = async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const lang = normalizeLang(body.language || body.lang || body.locale, req)
    const { tier, currency, amountMinor } = resolveTestTopup(body.tier, lang)
    if (!tier || amountMinor == null) {
      sendJson(res, 400, { ok: false, error: 'INVALID_TIER' })
      return
    }

    const supabase = createSupabaseServerClient(req, res)
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user?.id) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }

    const amount = amountMinor / 100
    const fx = resolveFxUsdPln()
    const deltaPln = currency === 'PLN' ? amount : amount * fx
    const supabaseAdmin = getSupabaseAdmin()
    const requestId = randomUUID()
    const rpcRes = await supabaseAdmin.rpc('admin_increment_balance', {
      admin_user: data.user.id,
      target_user: data.user.id,
      delta_pln: deltaPln,
      request_id: requestId,
    })

    if (rpcRes.error) {
      res.status(500).json({ ok: false, error: rpcRes.error.message || 'RPC_FAILED' })
      return
    }

    const payload = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data
    const balanceAfterPln = Number(payload?.balance_after ?? 0)
    const balanceMinor =
      currency === 'PLN'
        ? Math.round(balanceAfterPln * 100)
        : Math.round((balanceAfterPln / fx) * 100)

    res.status(200).json({
      ok: true,
      added: { currency, amountMinor },
      newBalance: { currency, amountMinor: balanceMinor },
      balancePLN: Number.isFinite(balanceAfterPln) ? balanceAfterPln : 0,
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

  const supabase = createSupabaseServerClient(req, res)
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user?.id) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    return
  }

  const orderId = randomUUID()
  const amountStr = amountPln.toFixed(2)
  const amountGrosze = Math.round(amountPln * 100)

  const supabaseAdmin = getSupabaseAdmin()
  const insertRes = await supabaseAdmin
    .from('payments')
    .insert({
      user_id: data.user.id,
      provider: 'autopay',
      order_id: orderId,
      amount_pln: amountStr,
      amount_pln_grosze: amountGrosze,
      status: 'pending',
    })
  if (insertRes.error) {
    res.status(500).json({ ok: false, error: 'PAYMENT_CREATE_FAILED' })
    return
  }

  const hash = sha256([serviceId, orderId, amountStr, sharedKey].join('|'))

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
    const { data: account, error: accountError } = await supabase
      .from('billing_accounts')
      .select('balance_pln')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (accountError) {
      res.status(500).json({ ok: false, error: accountError.message || 'QUERY_FAILED' })
      return
    }
    const balance = Number(account?.balance_pln ?? 0)
    res.status(200).json({
      ok: true,
      balancePLN: Number.isFinite(balance) ? balance : 0,
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
  if (!xml || !xml.includes('<')) {
    sendJson(res, 400, { ok: false, error: 'INVALID_XML' })
    return
  }

  let parsed
  try {
    const parser = new XMLParser({ ignoreAttributes: false })
    parsed = parser.parse(xml)
  } catch {
    sendJson(res, 400, { ok: false, error: 'INVALID_XML' })
    return
  }

  const transactionList = parsed?.transactionList || parsed?.transactionlist
  const serviceID = String(transactionList?.serviceID || '')
  const transactionNode = transactionList?.transactions?.transaction
  const transaction = Array.isArray(transactionNode) ? transactionNode[0] : transactionNode
  if (!serviceID || !transaction) {
    sendJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
    return
  }

  const orderID = String(transaction?.orderID || '')
  const remoteID = String(transaction?.remoteID || '')
  const amount = String(transaction?.amount || '')
  const currency = String(transaction?.currency || '')
  const gatewayID = String(transaction?.gatewayID || '')
  const paymentDate = String(transaction?.paymentDate || '')
  const paymentStatus = String(transaction?.paymentStatus || '')
  const paymentStatusDetails = String(transaction?.paymentStatusDetails || '')
  const receivedHash = String(transactionList?.hash || transaction?.hash || '')

  const sharedKey = process.env.AUTOPAY_SHARED_KEY || ''
  if (!sharedKey) {
    sendJson(res, 500, { ok: false, error: 'MISSING_SHARED_KEY' })
    return
  }

  const expectedHash = sha256(
    [
      serviceID,
      orderID,
      remoteID,
      amount,
      currency,
      gatewayID,
      paymentDate,
      paymentStatus,
      paymentStatusDetails,
      sharedKey,
    ].join('|')
  )

  let confirmation = 'NOTCONFIRMED'
  if (receivedHash && receivedHash.toLowerCase() === expectedHash.toLowerCase()) {
    if (paymentStatus === 'SUCCESS') {
      try {
        const supabaseAdmin = getSupabaseAdmin()
        await supabaseAdmin.rpc('apply_payment', { order_id_in: orderID })
        console.log('[AUTOPAY ITN] applied orderID=%s', orderID)
        confirmation = 'CONFIRMED'
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
  res.status(200)
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.send(responseXml)
}

export default async function handler(req, res) {
  const actionFromQuery = resolveAction(req, null)
  if (actionFromQuery === 'itn') {
    await handleAutopayItn(req, res)
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
