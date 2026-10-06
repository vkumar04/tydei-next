import type Stripe from "stripe"

export interface SubscriptionRow {
  id: string
  customerEmail: string | null
  status: string
  planName: string
  amount: number
  currentPeriodEnd: string | null
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

export function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  let latest: number | null = null
  for (const item of sub.items.data) {
    const end = item.current_period_end
    if (typeof end === "number" && (latest === null || end > latest)) latest = end
  }
  return latest
}

export function toSubscriptionRow(s: Stripe.Subscription): SubscriptionRow {
  const first = s.items.data[0]
  const periodEnd = subscriptionPeriodEnd(s)
  return {
    id: s.id,
    customerEmail: null,
    status: s.status,
    planName: first?.price?.nickname ?? "Standard",
    amount: first?.price?.unit_amount ? first.price.unit_amount / 100 : 0,
    currentPeriodEnd: periodEnd === null ? null : new Date(periodEnd * 1000).toISOString(),
  }
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" })

export function invoicePeriodLabel(periodStart: number, periodEnd: number): string | null {
  if (!periodStart || !periodEnd) return null
  const start = monthYear.format(new Date(periodStart * 1000))
  const end = monthYear.format(new Date(periodEnd * 1000))
  return start === end ? start : `${start} - ${end}`
}

export function toStripeInvoiceRow(inv: Stripe.Invoice): StripeInvoiceRow {
  return {
    id: inv.id,
    customerEmail: inv.customer_email,
    customerName: inv.customer_name ?? null,
    amount: (inv.amount_due ?? 0) / 100,
    status: inv.status ?? "unknown",
    date: new Date((inv.created ?? 0) * 1000).toISOString(),
    period: invoicePeriodLabel(inv.period_start, inv.period_end),
    pdfUrl: inv.invoice_pdf ?? null,
  }
}
