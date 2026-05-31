import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    rpc: vi.fn(),
  },
  serverAuthGetUser: vi.fn(),
  isStripeEnabled: vi.fn(),
  resolveStripeCurrency: vi.fn(),
  createStripeCheckoutSession: vi.fn(),
  verifyStripeWebhook: vi.fn(),
}))

vi.mock('../../src/lib/server/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => mocks.admin,
}))

vi.mock('../../src/lib/server/supabaseServer.js', () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: mocks.serverAuthGetUser },
  }),
}))

vi.mock('../../src/lib/server/payments/stripe.js', () => ({
  isStripeEnabled: mocks.isStripeEnabled,
  resolveStripeCurrency: mocks.resolveStripeCurrency,
  createStripeCheckoutSession: mocks.createStripeCheckoutSession,
  verifyStripeWebhook: mocks.verifyStripeWebhook,
}))

const { default: billingHandler } = await import('../../api/billing.js')

const makeReq = ({
  method = 'GET',
  url = '/api/billing',
  body,
  rawBody = '',
  headers = {},
}: {
  method?: string
  url?: string
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
}) => ({
  method,
  url,
  headers: { host: 'localhost', ...headers },
  query: {},
  body,
  async *[Symbol.asyncIterator]() {
    if (rawBody) yield Buffer.from(rawBody)
  },
})

type MockRes = {
  statusCode: number
  headers: Record<string, string>
  payload: unknown
  sent: unknown
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const makeRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    payload: undefined,
    sent: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: vi.fn((payload: unknown) => {
      res.payload = payload
      return res
    }),
    setHeader: vi.fn((name: string, value: string) => {
      res.headers[name] = value
    }),
    send: vi.fn((value: unknown) => {
      res.sent = value
    }),
    end: vi.fn(),
  } satisfies MockRes
  return res
}

type QueryBuilder = {
  insert?: ReturnType<typeof vi.fn>
  select?: ReturnType<typeof vi.fn>
  single?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  eq?: ReturnType<typeof vi.fn>
  maybeSingle?: ReturnType<typeof vi.fn>
}

const makeInsertSelectBuilder = (row: unknown) => {
  const builder: QueryBuilder = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn(async () => ({ data: row, error: null }))
  return builder
}

const makeUpdateBuilder = () => {
  const builder: QueryBuilder = {}
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  return builder
}

const makeLookupBuilder = (row: unknown) => {
  const builder: QueryBuilder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => ({ data: row, error: null }))
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTOPAY_SERVICE_ID = 'autopay-service'
  process.env.AUTOPAY_GATEWAY_URL = 'https://autopay.example'
  process.env.AUTOPAY_FORM_HASH_KEY = 'autopay-form-key'
  mocks.serverAuthGetUser.mockResolvedValue({
    data: { user: { id: 'user_1', email: 'user@example.com' } },
    error: null,
  })
  mocks.isStripeEnabled.mockReturnValue(true)
  mocks.resolveStripeCurrency.mockReturnValue('pln')
  mocks.admin.rpc.mockResolvedValue({ error: null })
})

describe('billing Stripe integration', () => {
  it('blocks create_stripe_checkout when Stripe is disabled', async () => {
    mocks.isStripeEnabled.mockReturnValue(false)
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'POST',
      url: '/api/billing?action=create_stripe_checkout',
      body: { amountPln: '20.00', returnTo: '/engine' },
    }), res)

    expect(res.statusCode).toBe(404)
    expect(res.payload).toMatchObject({ ok: false, error: 'NOT_FOUND' })
  })

  it('keeps Autopay create_payment on the existing HTML form flow', async () => {
    const autopayInsert = {
      insert: vi.fn(async () => ({ error: null })),
    }
    mocks.admin.from.mockReturnValue(autopayInsert)
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'POST',
      url: '/api/billing?action=create_payment',
      body: { amountPln: '20.00' },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(String(res.sent)).toContain('action="https://autopay.example"')
    expect(autopayInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'autopay',
      status: 'pending',
      amount_pln_grosze: 2000,
    }))
  })

  it('creates a pending Stripe payment and returns Checkout URL without applying balance', async () => {
    const insertBuilder = makeInsertSelectBuilder({ id: 'pay_1', provider_payload: { stripe: {} } })
    const updateBuilder = makeUpdateBuilder()
    mocks.admin.from
      .mockReturnValueOnce(insertBuilder)
      .mockReturnValueOnce(updateBuilder)
    mocks.createStripeCheckoutSession.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.test/session',
      payment_status: 'unpaid',
    })
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'POST',
      url: '/api/billing?action=create_stripe_checkout',
      body: { amountPln: '20.00' },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ ok: true, url: 'https://checkout.stripe.test/session' })
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'stripe',
      status: 'pending',
      amount_pln_grosze: 2000,
      tokens_to_add: 2000,
      provider_payload: expect.objectContaining({
        stripe: expect.objectContaining({
          return_to: '/engine',
        }),
      }),
    }))
    expect(mocks.createStripeCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      orderId: expect.stringMatching(/^stripe_/),
      amountMinor: 2000,
      currency: 'pln',
      returnTo: '/engine',
    }))
    expect(mocks.admin.rpc).not.toHaveBeenCalled()
  })

  it('redirects Stripe success return to the original app page without rendering topup', async () => {
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'GET',
      url: '/api/billing?action=stripe_return&session_id=cs_test_123&return_to=%2Fengine',
    }), res)

    expect(res.statusCode).toBe(303)
    expect(res.headers.Location).toBe('/engine?payment=stripe_success&session_id=cs_test_123')
    expect(mocks.admin.from).not.toHaveBeenCalled()
  })

  it('redirects Stripe cancel return to the original app page without rendering topup', async () => {
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'GET',
      url: '/api/billing?action=stripe_cancel_return&return_to=%2Fengine',
    }), res)

    expect(res.statusCode).toBe(303)
    expect(res.headers.Location).toBe('/engine?payment=stripe_cancelled')
    expect(mocks.admin.from).not.toHaveBeenCalled()
  })

  it('routes stripe_webhook before JSON parsing and rejects an invalid signature', async () => {
    mocks.verifyStripeWebhook.mockRejectedValue(new Error('bad signature'))
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'POST',
      url: '/api/billing?action=stripe_webhook',
      rawBody: 'not json',
      headers: { 'stripe-signature': 'bad' },
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ ok: false, error: 'INVALID_SIGNATURE' })
    expect(mocks.verifyStripeWebhook).toHaveBeenCalledWith('not json', 'bad')
  })

  it('applies a paid Stripe checkout session through apply_payment', async () => {
    const payment = {
      id: 'pay_1',
      user_id: 'user_1',
      provider: 'stripe',
      order_id: 'stripe_order_1',
      amount_pln_grosze: 2000,
      status: 'pending',
      provider_payload: { stripe: { checkout_session_id: 'cs_test_123' } },
      paid_at: null,
    }
    mocks.verifyStripeWebhook.mockResolvedValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: 123,
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          amount_total: 2000,
          currency: 'pln',
          payment_intent: 'pi_1',
          metadata: { internalPaymentId: 'pay_1', orderId: 'stripe_order_1', userId: 'user_1' },
        },
      },
    })
    mocks.admin.from
      .mockReturnValueOnce(makeLookupBuilder(payment))
      .mockReturnValueOnce(makeUpdateBuilder())
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'POST',
      url: '/api/billing?action=stripe_webhook',
      rawBody: '{"id":"evt_1"}',
      headers: { 'stripe-signature': 'sig' },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(mocks.admin.rpc).toHaveBeenCalledWith('apply_payment', { order_id_in: 'stripe_order_1' })
  })

  it('does not apply balance when Stripe amount does not match payment amount', async () => {
    const payment = {
      id: 'pay_1',
      user_id: 'user_1',
      provider: 'stripe',
      order_id: 'stripe_order_1',
      amount_pln_grosze: 2000,
      status: 'pending',
      provider_payload: { stripe: { checkout_session_id: 'cs_test_123' } },
      paid_at: null,
    }
    mocks.verifyStripeWebhook.mockResolvedValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: 123,
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          amount_total: 2100,
          currency: 'pln',
          metadata: { internalPaymentId: 'pay_1', orderId: 'stripe_order_1', userId: 'user_1' },
        },
      },
    })
    mocks.admin.from
      .mockReturnValueOnce(makeLookupBuilder(payment))
      .mockReturnValueOnce(makeUpdateBuilder())
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'POST',
      url: '/api/billing?action=stripe_webhook',
      rawBody: '{"id":"evt_1"}',
      headers: { 'stripe-signature': 'sig' },
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ ok: false, error: 'AMOUNT_MISMATCH' })
    expect(mocks.admin.rpc).not.toHaveBeenCalled()
  })

  it('does not apply balance when Stripe currency does not match configured currency', async () => {
    const payment = {
      id: 'pay_1',
      user_id: 'user_1',
      provider: 'stripe',
      order_id: 'stripe_order_1',
      amount_pln_grosze: 2000,
      status: 'pending',
      provider_payload: { stripe: { checkout_session_id: 'cs_test_123' } },
      paid_at: null,
    }
    mocks.verifyStripeWebhook.mockResolvedValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: 123,
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          amount_total: 2000,
          currency: 'eur',
          metadata: { internalPaymentId: 'pay_1', orderId: 'stripe_order_1', userId: 'user_1' },
        },
      },
    })
    mocks.admin.from
      .mockReturnValueOnce(makeLookupBuilder(payment))
      .mockReturnValueOnce(makeUpdateBuilder())
    const res = makeRes()

    await billingHandler(makeReq({
      method: 'POST',
      url: '/api/billing?action=stripe_webhook',
      rawBody: '{"id":"evt_1"}',
      headers: { 'stripe-signature': 'sig' },
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.payload).toMatchObject({ ok: false, error: 'CURRENCY_MISMATCH' })
    expect(mocks.admin.rpc).not.toHaveBeenCalled()
  })
})
