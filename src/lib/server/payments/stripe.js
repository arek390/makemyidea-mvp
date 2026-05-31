const STRIPE_API_VERSION = '2024-06-20'

export const isStripeEnabled = () => {
  const value = String(process.env.STRIPE_ENABLED || '').trim().toLowerCase()
  return value === 'true' || value === '1'
}

export const resolveStripeCurrency = () =>
  String(process.env.STRIPE_CURRENCY || 'pln').trim().toLowerCase()

const requireEnv = (name) => {
  const value = String(process.env[name] || '').trim()
  if (!value) {
    const error = new Error(`Missing ${name}`)
    error.code = `MISSING_${name}`
    throw error
  }
  return value
}

let stripeClient = null
let stripeClientKey = null

export const getStripeClient = async () => {
  const secretKey = requireEnv('STRIPE_SECRET_KEY')
  if (stripeClient && stripeClientKey === secretKey) return stripeClient
  const mod = await import('stripe')
  const Stripe = mod.default || mod
  stripeClient = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION })
  stripeClientKey = secretKey
  return stripeClient
}

export const createStripeCheckoutSession = async ({
  userId,
  orderId,
  internalPaymentId,
  amountMinor,
  currency,
}) => {
  const stripe = await getStripeClient()
  const safeCurrency = String(currency || resolveStripeCurrency()).trim().toLowerCase()
  const successUrl = requireEnv('STRIPE_SUCCESS_URL')
  const cancelUrl = requireEnv('STRIPE_CANCEL_URL')
  const metadata = {
    provider: 'stripe',
    orderId: String(orderId || ''),
    internalPaymentId: String(internalPaymentId || ''),
    userId: String(userId || ''),
  }

  return stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: safeCurrency,
          unit_amount: Number(amountMinor),
          product_data: {
            name: 'MakeMyIdea.work Service Balance Top-up',
          },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
  })
}

export const verifyStripeWebhook = async (rawBody, signature) => {
  const stripe = await getStripeClient()
  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET')
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
}
