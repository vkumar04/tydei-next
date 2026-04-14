"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CreditCard, ExternalLink, Sparkles, TrendingUp } from "lucide-react"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BillingOverview } from "./billing-overview"
import { MRRChart } from "./mrr-chart"
import { InvoiceTable } from "./invoice-table"
import { formatCurrency } from "@/lib/formatting"
import {
  getSubscriptions,
  getStripeInvoices,
  getMRRData,
  createBillingPortalSession,
  createCheckoutSession,
  getAvailablePlans,
} from "@/lib/actions/admin/billing"
import { queryKeys } from "@/lib/query-keys"

export function BillingClient() {
  const [isRedirecting, setIsRedirecting] = useState(false)

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
  const plans = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => getAvailablePlans(),
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

  const handleManageSubscription = async (facilityId: string) => {
    setIsRedirecting(true)
    try {
      const { url } = await createBillingPortalSession({ facilityId })
      window.location.href = url
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open billing portal")
      setIsRedirecting(false)
    }
  }

  const handleUpgradePlan = async (priceId: string, organizationId: string) => {
    setIsRedirecting(true)
    try {
      const { url } = await createCheckoutSession({ priceId, organizationId })
      window.location.href = url
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create checkout session")
      setIsRedirecting(false)
    }
  }

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

      {/* Subscription Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Subscription Management
              </CardTitle>
              <CardDescription>
                Manage billing, update payment methods, and change plans
              </CardDescription>
            </div>
            <Button
              variant="outline"
              className="gap-2"
              disabled={isRedirecting}
              onClick={() => handleManageSubscription("default")}
            >
              <ExternalLink className="h-4 w-4" />
              {isRedirecting ? "Redirecting..." : "Manage Subscription"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Available Plans */}
      {plans.data && plans.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Available Plans
            </CardTitle>
            <CardDescription>
              Upgrade or switch your subscription plan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {plans.data.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-lg border p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-lg">{plan.name}</h3>
                      {plan.name === "Professional" && (
                        <Badge className="bg-primary/10 text-primary">Popular</Badge>
                      )}
                    </div>
                    <p className="text-3xl font-bold mb-1">
                      ${plan.price}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{plan.interval}
                      </span>
                    </p>
                    <ul className="mt-4 space-y-2">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <span className="text-green-500 mt-0.5">&#10003;</span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button
                    className="mt-4 w-full gap-2"
                    variant={plan.name === "Professional" ? "default" : "outline"}
                    disabled={isRedirecting}
                    onClick={() => handleUpgradePlan(plan.id, "default")}
                  >
                    <Sparkles className="h-4 w-4" />
                    {isRedirecting ? "Redirecting..." : "Upgrade Plan"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
