import type Stripe from "stripe"
import { prisma } from "@/lib/db"

/**
 * 2026-06-09 settings audit BLOCKER: this handler previously lived as an
 * exported async function in the "use server" file
 * lib/actions/admin/billing.ts — which made it a PUBLICLY INVOKABLE
 * server action. Any client could POST a forged
 * `customer.subscription.deleted` event (no Stripe signature check on
 * the RPC path — the signature is only verified in the webhook route)
 * and flip any facility's status to inactive by guessing/learning its
 * organizationId. Moved to this plain module (same pattern as
 * lib/notifications/in-app-helper.ts, Iter3-B2) so the ONLY entry point
 * is app/api/webhooks/stripe/route.ts, which verifies the signature
 * before calling.
 */
export async function handleStripeWebhook(event: Stripe.Event) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      const orgId = sub.metadata?.organizationId
      if (orgId) {
        const facility = await prisma.facility.findFirst({
          where: { organizationId: orgId },
        })
        if (facility) {
          await prisma.facility.update({
            where: { id: facility.id },
            data: { status: sub.status === "active" ? "active" : "inactive" },
          })
        }
      }
      console.log(`[Stripe Webhook] Subscription ${event.type}: ${sub.id} (${sub.status})`)
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      const orgId = sub.metadata?.organizationId
      if (orgId) {
        const facility = await prisma.facility.findFirst({
          where: { organizationId: orgId },
        })
        if (facility) {
          await prisma.facility.update({
            where: { id: facility.id },
            data: { status: "inactive" },
          })
        }
      }
      console.log(`[Stripe Webhook] Subscription cancelled: ${sub.id}`)
      break
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice
      console.log(`[Stripe Webhook] Invoice paid: ${invoice.id}`)
      break
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      console.log(`[Stripe Webhook] Payment failed: ${invoice.id}`)
      break
    }
    default:
      console.log(`[Stripe Webhook] Unhandled event: ${event.type}`)
  }
}
