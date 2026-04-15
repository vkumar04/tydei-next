"use client"

import { useQuery } from "@tanstack/react-query"
import { TrendingUp } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BillingOverview } from "./billing-overview"
import { InvoiceTable } from "./invoice-table"
import { formatCurrency } from "@/lib/formatting"
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

  // Latest MRR point
  const latestMRR = mrr.data && mrr.data.length > 0 ? mrr.data[mrr.data.length - 1].mrr : 0
  const subscriptionCount = subs.data?.total ?? 0
  const avgRevenuePerAccount = subscriptionCount > 0 ? latestMRR / subscriptionCount : 0

  return (
    <div className="space-y-6">
      {subs.data ? (
        <BillingOverview
          mrr={latestMRR}
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

      {/* MRR Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Monthly Recurring Revenue
          </CardTitle>
          <CardDescription>Platform subscription metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Current MRR</p>
              <p className="text-3xl font-bold">{formatCurrency(latestMRR)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Active Subscriptions
              </p>
              <p className="text-3xl font-bold">{subscriptionCount}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Avg. Revenue per Account
              </p>
              <p className="text-3xl font-bold">
                {formatCurrency(avgRevenuePerAccount)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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
