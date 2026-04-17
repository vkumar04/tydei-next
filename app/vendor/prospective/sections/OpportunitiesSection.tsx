"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Target, TrendingUp, ArrowUpRight, Gauge, Plus } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { StatusBadge } from "./shared"
import type { VendorProposal } from "@/lib/actions/prospective"

interface Props {
  proposals: VendorProposal[] | undefined
  isLoading: boolean
  totalProposals: number
  totalProjectedSpend: number
  onNewProposal: () => void
}

export function OpportunitiesSection({
  proposals,
  isLoading,
  totalProposals,
  totalProjectedSpend,
  onNewProposal,
}: Props) {
  const metrics = [
    { icon: Target, label: "Total Opportunities", value: String(totalProposals), color: "text-primary", bg: "bg-primary/10" },
    { icon: TrendingUp, label: "Potential Revenue", value: formatCurrency(totalProjectedSpend), color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/30" },
    { icon: ArrowUpRight, label: "Avg Growth Potential", value: "--", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
    { icon: Gauge, label: "Avg Opportunity Score", value: "--", color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
  ]

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${m.bg}`}>
                  <m.icon className={`h-5 w-5 ${m.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{m.label}</p>
                  <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Facility Opportunities</CardTitle>
          <CardDescription>
            Upload COG/usage data to see real facility opportunities based on actual spend patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-md" />
              ))}
            </div>
          ) : proposals && proposals.length > 0 ? (
            <div className="space-y-4">
              {proposals.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Target className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {p.itemCount} items &middot; {formatCurrency(p.totalProposedCost)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {p.facilityIds.length} facilities &middot;{" "}
                        {new Date(p.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Projected Spend</p>
                      <p className="font-medium text-primary">{formatCurrency(p.totalProposedCost)}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No facility opportunities yet</p>
              <p className="text-sm mt-1">Create a new proposal to get started</p>
              <Button size="sm" className="mt-4" onClick={onNewProposal}>
                <Plus className="mr-2 h-4 w-4" />
                New Proposal
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
