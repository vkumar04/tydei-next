"use client"

import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { BillingOverview } from "./billing-overview"
import { MRRChart } from "./mrr-chart"
import { InvoiceTable } from "./invoice-table"
import {
  getSubscriptions,
  getStripeInvoices,
  getMRRData,
} from "@/lib/actions/admin/billing"
import { queryKeys } from "@/lib/query-keys"

export function BillingClient() {
  const subs = useQuery({
    queryKey: queryKeys.admin.subscriptions(),
    queryFn: () => getSubscriptions({}),
  })
  const invoices = useQuery({
    queryKey: queryKeys.admin.invoices(),
    queryFn: () => getStripeInvoices({}),
  })
  const mrr = useQuery({
    queryKey: queryKeys.admin.mrr(12),
    queryFn: () => getMRRData(12),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Stripe subscriptions, invoices, and MRR" />

      {subs.data ? (
        <BillingOverview
          mrr={mrr.data?.reduce((_, d) => d.mrr, 0) ?? 0}
          subscriptions={subs.data.total}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-[120px] rounded-xl" />
          <Skeleton className="h-[120px] rounded-xl" />
        </div>
      )}

      {mrr.data ? <MRRChart data={mrr.data} /> : <Skeleton className="h-[380px] rounded-xl" />}

      {invoices.data ? (
        <InvoiceTable invoices={invoices.data.invoices} />
      ) : (
        <Skeleton className="h-[300px] rounded-xl" />
      )}
    </div>
  )
}
