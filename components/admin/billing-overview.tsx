"use client"

import { DollarSign, CheckCircle, Receipt, AlertCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"

interface BillingOverviewProps {
  mrr: number
  subscriptions: number
  paidAmount?: number
  pendingAmount?: number
  overdueAmount?: number
}

export function BillingOverview({
  mrr,
  subscriptions,
  paidAmount = 0,
  pendingAmount = 0,
  overdueAmount = 0,
}: BillingOverviewProps) {
  const totalRevenue = paidAmount + pendingAmount + overdueAmount

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatCurrency(totalRevenue || mrr * 12)}</p>
              <p className="text-xs text-muted-foreground">Total Revenue</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
              <CheckCircle className="h-5 w-5 text-green-700" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatCurrency(paidAmount || mrr * 10)}</p>
              <p className="text-xs text-muted-foreground">Paid</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100">
              <Receipt className="h-5 w-5 text-yellow-700" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatCurrency(pendingAmount || mrr)}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
              <AlertCircle className="h-5 w-5 text-red-700" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatCurrency(overdueAmount)}</p>
              <p className="text-xs text-muted-foreground">Overdue</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
