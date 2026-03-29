"use client"

import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

  // Compute invoice breakdown for stat cards
  const invoiceData = invoices.data?.invoices ?? []
  const paidAmount = invoiceData.filter((inv) => inv.status === "paid").reduce((sum, inv) => sum + inv.amount, 0)
  const pendingAmount = invoiceData.filter((inv) => inv.status === "open").reduce((sum, inv) => sum + inv.amount, 0)
  const overdueAmount = invoiceData.filter((inv) => inv.status === "uncollectible" || inv.status === "void").reduce((sum, inv) => sum + inv.amount, 0)

  return (
    <div className="space-y-6">
      {subs.data ? (
        <BillingOverview
          mrr={mrr.data?.reduce((_, d) => d.mrr, 0) ?? 0}
          subscriptions={subs.data.total}
          paidAmount={paidAmount}
          pendingAmount={pendingAmount}
          overdueAmount={overdueAmount}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Skeleton className="h-[80px] rounded-xl" />
          <Skeleton className="h-[80px] rounded-xl" />
          <Skeleton className="h-[80px] rounded-xl" />
          <Skeleton className="h-[80px] rounded-xl" />
        </div>
      )}

      {mrr.data ? (
        <MRRChart data={mrr.data} subscriptions={subs.data?.total ?? 0} />
      ) : (
        <Skeleton className="h-[380px] rounded-xl" />
      )}

      {invoices.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
            <CardDescription>View and manage subscription invoices</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <InvoiceTable invoices={invoices.data.invoices} />
          </CardContent>
        </Card>
      ) : (
        <Skeleton className="h-[300px] rounded-xl" />
      )}
    </div>
  )
}
