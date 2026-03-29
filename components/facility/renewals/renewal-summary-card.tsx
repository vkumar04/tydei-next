"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { AlertTriangle, TrendingUp, Calendar } from "lucide-react"
import type { RenewalSummary } from "@/lib/actions/renewals"

interface RenewalSummaryCardProps {
  summary: RenewalSummary
}

export function RenewalSummaryCard({ summary }: RenewalSummaryCardProps) {
  const urgency =
    summary.daysUntilExpiry <= 30 ? "destructive" : summary.daysUntilExpiry <= 60 ? "secondary" : "outline"

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{summary.contract.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{summary.contract.vendorName}</p>
          </div>
          <Badge variant={urgency}>
            {summary.daysUntilExpiry}d remaining
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress
          value={Math.max(5, 100 - (summary.daysUntilExpiry / 365) * 100)}
          className="h-2"
        />
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground">Total Spend</p>
              <p className="font-semibold">${summary.totalSpend.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-500" />
            <div>
              <p className="text-muted-foreground">Total Rebate</p>
              <p className="font-semibold">${summary.totalRebate.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground">Tier Achieved</p>
              <p className="font-semibold">{summary.tierAchieved ?? "N/A"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            <div>
              <p className="text-muted-foreground">Auto-Renewal</p>
              <p className="font-semibold">{summary.contract.autoRenewal ? "Yes" : "No"}</p>
            </div>
          </div>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs font-medium text-muted-foreground">Recommendation</p>
          <p className="mt-1 text-sm">{summary.renewalRecommendation}</p>
        </div>
      </CardContent>
    </Card>
  )
}
