import { describe, expect, it } from "vitest"
import type Stripe from "stripe"
import {
  invoicePeriodLabel,
  subscriptionPeriodEnd,
  toStripeInvoiceRow,
  toSubscriptionRow,
} from "../stripe-rows"

const JAN_31_2026 = 1769817600
const FEB_28_2026 = 1772236800

function item(overrides: Partial<Stripe.SubscriptionItem> = {}): Stripe.SubscriptionItem {
  return {
    id: "si_1",
    current_period_end: JAN_31_2026,
    current_period_start: JAN_31_2026 - 30 * 86400,
    price: { nickname: "Pro", unit_amount: 49900 } as Stripe.Price,
    ...overrides,
  } as Stripe.SubscriptionItem
}

function subscription(items: Stripe.SubscriptionItem[]): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    items: { data: items },
  } as unknown as Stripe.Subscription
}

describe("subscriptionPeriodEnd", () => {
  it("reads the period end from the subscription item, not the subscription", () => {
    const sub = subscription([item()])
    expect(subscriptionPeriodEnd(sub)).toBe(JAN_31_2026)
  })

  it("returns the latest end across multiple items", () => {
    const sub = subscription([item(), item({ id: "si_2", current_period_end: FEB_28_2026 })])
    expect(subscriptionPeriodEnd(sub)).toBe(FEB_28_2026)
  })

  it("returns null when there are no items", () => {
    expect(subscriptionPeriodEnd(subscription([]))).toBeNull()
  })
})

describe("toSubscriptionRow", () => {
  it("maps plan, amount in dollars, and an ISO period end", () => {
    const row = toSubscriptionRow(subscription([item()]))
    expect(row).toEqual({
      id: "sub_1",
      customerEmail: null,
      status: "active",
      planName: "Pro",
      amount: 499,
      currentPeriodEnd: "2026-01-31T00:00:00.000Z",
    })
  })

  it("never falls back to the epoch when the period end is missing", () => {
    const row = toSubscriptionRow(subscription([item({ current_period_end: undefined })]))
    expect(row.currentPeriodEnd).toBeNull()
    expect(row.currentPeriodEnd).not.toBe("1970-01-01T00:00:00.000Z")
  })

  it("defaults plan name and amount when the price has none", () => {
    const row = toSubscriptionRow(subscription([item({ price: {} as Stripe.Price })]))
    expect(row.planName).toBe("Standard")
    expect(row.amount).toBe(0)
  })
})

describe("invoicePeriodLabel", () => {
  it("collapses a same-month period to one label", () => {
    expect(invoicePeriodLabel(JAN_31_2026 - 10 * 86400, JAN_31_2026 - 86400)).toBe("Jan 2026")
  })

  it("renders a range across months", () => {
    expect(invoicePeriodLabel(JAN_31_2026 - 86400, FEB_28_2026)).toBe("Jan 2026 - Feb 2026")
  })

  it("returns null when either bound is missing", () => {
    expect(invoicePeriodLabel(0, FEB_28_2026)).toBeNull()
  })
})

describe("toStripeInvoiceRow", () => {
  it("maps the typed period fields without casts", () => {
    const inv = {
      id: "in_1",
      customer_email: "a@b.co",
      customer_name: "Acme",
      amount_due: 12345,
      status: "paid",
      created: JAN_31_2026,
      period_start: JAN_31_2026 - 86400,
      period_end: FEB_28_2026,
      invoice_pdf: "https://pdf",
    } as unknown as Stripe.Invoice
    expect(toStripeInvoiceRow(inv)).toEqual({
      id: "in_1",
      customerEmail: "a@b.co",
      customerName: "Acme",
      amount: 123.45,
      status: "paid",
      date: "2026-01-31T00:00:00.000Z",
      period: "Jan 2026 - Feb 2026",
      pdfUrl: "https://pdf",
    })
  })
})
