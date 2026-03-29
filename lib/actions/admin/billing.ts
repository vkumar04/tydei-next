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
  amount: number
  status: string
  date: string
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
    invoices: invoices.data.map((inv) => ({
      id: inv.id,
      customerEmail: inv.customer_email,
      amount: (inv.amount_due ?? 0) / 100,
      status: inv.status ?? "unknown",
      date: new Date((inv.created ?? 0) * 1000).toISOString(),
      pdfUrl: inv.invoice_pdf ?? null,
    })),
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
