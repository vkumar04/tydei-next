import { NextResponse, type NextRequest } from "next/server"
import { stripe } from "@/lib/stripe"
import type Stripe from "stripe"

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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      console.log("[Stripe] Checkout completed:", session.id)
      break
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice
      console.log("[Stripe] Invoice paid:", invoice.id)
      break
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      console.log("[Stripe] Payment failed:", invoice.id)
      break
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      console.log("[Stripe] Subscription updated:", sub.id, sub.status)
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      console.log("[Stripe] Subscription deleted:", sub.id)
      break
    }
    default:
      console.log("[Stripe] Unhandled event:", event.type)
  }

  return NextResponse.json({ received: true })
}
