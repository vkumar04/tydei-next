import { NextResponse, type NextRequest } from "next/server"
import { getStripe } from "@/lib/stripe"
import type Stripe from "stripe"
import { handleStripeWebhook } from "@/lib/billing/stripe-webhook"

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    // Fail closed — without the secret we cannot verify authenticity.
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  await handleStripeWebhook(event)

  return NextResponse.json({ received: true })
}
