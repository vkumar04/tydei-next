import Stripe from "stripe"

// 2026-06-09 settings audit: previously this was an unconditional
// `new Stripe(process.env.STRIPE_SECRET_KEY!)` at module-load time —
// the same crash class fixed in lib/auth-server.ts ("Neither apiKey
// nor config.authenticator provided" when the env var is missing,
// killing every importer including the webhook route and any test
// that transitively pulls it in). Lazy-init with a clear error at
// CALL time instead.
let client: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error("Stripe not configured: STRIPE_SECRET_KEY missing")
  }
  if (!client) {
    client = new Stripe(key, { typescript: true })
  }
  return client
}
