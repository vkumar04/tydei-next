import { NextResponse, type NextRequest } from "next/server"
import { stripe } from "@/lib/stripe"
import type Stripe from "stripe"
import { handleStripeWebhook } from "@/lib/actions/admin/billing"

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  await handleStripeWebhook(event)

  return NextResponse.json({ received: true })
}
