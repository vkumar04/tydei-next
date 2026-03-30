"use server"

import { requireAdmin } from "@/lib/actions/auth"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/db"
import type { CreditTierId } from "@prisma/client"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface SubscriptionRow {
  id: string
  customerEmail: string | null
  status: string
  planName: string
  amount: number
  currentPeriodEnd: string
}

export interface StripeInvoiceRow {
  id: string
  customerEmail: string | null
  customerName: string | null
  amount: number
  status: string
  date: string
  period: string | null
  pdfUrl: string | null
}

// ─── Get Subscriptions ──────────────────────────────────────────

export async function getSubscriptions(input: {
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ subscriptions: SubscriptionRow[]; total: number }> {
  await requireAdmin()
  const { status, pageSize = 20 } = input

  const params: Record<string, unknown> = { limit: pageSize }
  if (status) params.status = status

  const subs = await stripe.subscriptions.list(params as Parameters<typeof stripe.subscriptions.list>[0])

  return serialize({
    subscriptions: subs.data.map((s) => ({
      id: s.id,
      customerEmail: null,
      status: s.status,
      planName: s.items.data[0]?.price?.nickname ?? "Standard",
      amount: s.items.data[0]?.price?.unit_amount ? s.items.data[0].price.unit_amount / 100 : 0,
      currentPeriodEnd: new Date(((s as unknown as Record<string, unknown>).current_period_end as number ?? 0) * 1000).toISOString(),
    })),
    total: subs.data.length,
  })
}

// ─── Get Stripe Invoices ────────────────────────────────────────

export async function getStripeInvoices(input: {
  status?: "paid" | "pending" | "overdue"
  page?: number
  pageSize?: number
}): Promise<{ invoices: StripeInvoiceRow[]; total: number }> {
  await requireAdmin()
  const { status, pageSize = 20 } = input

  const params: Record<string, unknown> = { limit: pageSize }
  if (status === "paid") params.status = "paid"
  else if (status === "pending") params.status = "open"

  const invoices = await stripe.invoices.list(params as Parameters<typeof stripe.invoices.list>[0])

  return serialize({
    invoices: invoices.data.map((inv) => {
      const periodStart = (inv as unknown as Record<string, unknown>).period_start as number | undefined
      const periodEnd = (inv as unknown as Record<string, unknown>).period_end as number | undefined
      let period: string | null = null
      if (periodStart && periodEnd) {
        const fmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" })
        const start = fmt.format(new Date(periodStart * 1000))
        const end = fmt.format(new Date(periodEnd * 1000))
        period = start === end ? start : `${start} - ${end}`
      }
      return {
        id: inv.id,
        customerEmail: inv.customer_email,
        customerName: inv.customer_name ?? null,
        amount: (inv.amount_due ?? 0) / 100,
        status: inv.status ?? "unknown",
        date: new Date((inv.created ?? 0) * 1000).toISOString(),
        period,
        pdfUrl: inv.invoice_pdf ?? null,
      }
    }),
    total: invoices.data.length,
  })
}

// ─── Get MRR Data ───────────────────────────────────────────────

export async function getMRRData(
  months: number
): Promise<{ month: string; mrr: number }[]> {
  await requireAdmin()

  const now = new Date()
  const results: { month: string; mrr: number }[] = []

  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = date.toISOString().slice(0, 7)

    const activeFacilities = await prisma.facility.count({
      where: {
        status: "active",
        createdAt: { lte: new Date(date.getFullYear(), date.getMonth() + 1, 0) },
      },
    })

    results.push({ month, mrr: activeFacilities * 499 })
  }

  return serialize(results)
}

// ─── Update AI Credit Tier ──────────────────────────────────────

export async function updateAICreditTier(input: {
  entityId: string
  entityType: "facility" | "vendor"
  tierId: CreditTierId
}) {
  await requireAdmin()
  const { entityId, entityType, tierId } = input

  const creditTierLimits: Record<CreditTierId, number> = {
    starter: 500,
    professional: 2000,
    enterprise: 5000,
    unlimited: 999999,
  }

  const where = entityType === "facility"
    ? { facilityId: entityId }
    : { vendorId: entityId }

  await prisma.aICredit.updateMany({
    where,
    data: { tierId, monthlyCredits: creditTierLimits[tierId] },
  })
}

// ─── Create Checkout Session ────────────────────────────────────

export async function createCheckoutSession(input: {
  priceId: string
  organizationId: string
}): Promise<{ url: string }> {
  await requireAdmin()

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/admin/billing?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/admin/billing?cancelled=true`,
    metadata: { organizationId: input.organizationId },
  })

  return { url: session.url! }
}

// ─── Cancel Subscription ────────────────────────────────────────

export async function cancelSubscription(subscriptionId: string) {
  await requireAdmin()

  await stripe.subscriptions.cancel(subscriptionId)
}

// ─── Create Billing Portal Session ─────────────────────────────

export async function createBillingPortalSession(input: {
  facilityId: string
}): Promise<{ url: string }> {
  await requireAdmin()

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    include: { organization: true },
  })

  // Look up existing Stripe customer or fall back to creating a portal
  // via the organization metadata
  const orgId = facility.organizationId
  if (!orgId) {
    throw new Error("Facility is not linked to an organization")
  }

  // Search for a customer by metadata or create one
  const customers = await stripe.customers.list({
    limit: 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ query: `metadata["organizationId"]:"${orgId}"` } as any),
  })

  let customerId: string

  if (customers.data.length > 0) {
    customerId = customers.data[0].id
  } else {
    // Try to find by active subscription metadata
    const subs = await stripe.subscriptions.list({ limit: 100 })
    const match = subs.data.find(
      (s) => s.metadata?.organizationId === orgId
    )
    if (match && typeof match.customer === "string") {
      customerId = match.customer
    } else {
      // No Stripe customer found -- create one
      const customer = await stripe.customers.create({
        name: facility.name,
        metadata: { organizationId: orgId, facilityId: input.facilityId },
      })
      customerId = customer.id
    }
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/admin/billing`,
  })

  return { url: session.url }
}

// ─── Subscription Plans ────────────────────────────────────────

export interface PlanInfo {
  id: string
  name: string
  price: number
  interval: string
  features: string[]
}

export async function getAvailablePlans(): Promise<PlanInfo[]> {
  await requireAdmin()

  try {
    const prices = await stripe.prices.list({
      active: true,
      type: "recurring",
      expand: ["data.product"],
      limit: 10,
    })

    return prices.data.map((price) => {
      const product = price.product as import("stripe").Stripe.Product
      return {
        id: price.id,
        name: product.name ?? price.nickname ?? "Plan",
        price: (price.unit_amount ?? 0) / 100,
        interval: price.recurring?.interval ?? "month",
        features: product.marketing_features?.map((f) => f.name ?? "") ?? [],
      }
    })
  } catch {
    // Return mock plans if Stripe is not configured with products yet
    return [
      {
        id: "price_starter",
        name: "Starter",
        price: 299,
        interval: "month",
        features: [
          "Up to 5 contracts",
          "Basic reporting",
          "Email support",
          "500 AI credits/month",
        ],
      },
      {
        id: "price_professional",
        name: "Professional",
        price: 499,
        interval: "month",
        features: [
          "Unlimited contracts",
          "Advanced reporting & PDF export",
          "Priority support",
          "2,000 AI credits/month",
          "Surgeon scorecards",
        ],
      },
      {
        id: "price_enterprise",
        name: "Enterprise",
        price: 999,
        interval: "month",
        features: [
          "Everything in Professional",
          "Multi-facility support",
          "Custom integrations",
          "Dedicated success manager",
          "5,000 AI credits/month",
        ],
      },
    ]
  }
}

// ─── Handle Stripe Webhook Events ──────────────────────────────

export async function handleStripeWebhook(event: import("stripe").Stripe.Event) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as import("stripe").Stripe.Subscription
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
      const sub = event.data.object as import("stripe").Stripe.Subscription
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
      const invoice = event.data.object as import("stripe").Stripe.Invoice
      console.log(`[Stripe Webhook] Invoice paid: ${invoice.id}`)
      break
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as import("stripe").Stripe.Invoice
      console.log(`[Stripe Webhook] Payment failed: ${invoice.id}`)
      break
    }
    default:
      console.log(`[Stripe Webhook] Unhandled event: ${event.type}`)
  }
}
