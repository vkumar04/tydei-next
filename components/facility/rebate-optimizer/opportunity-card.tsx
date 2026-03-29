"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Target, TrendingUp } from "lucide-react"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

interface OpportunityCardProps {
  opportunity: RebateOpportunity
  onSetTarget: () => void
}

export function OpportunityCard({ opportunity: opp, onSetTarget }: OpportunityCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-medium">{opp.contractName}</CardTitle>
            <p className="text-xs text-muted-foreground">{opp.vendorName}</p>
          </div>
          <Badge variant="secondary">
            Tier {opp.currentTier} → {opp.nextTier}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              ${opp.currentSpend.toLocaleString()} / ${opp.nextTierThreshold.toLocaleString()}
            </span>
            <span className="font-medium">{opp.percentToNextTier.toFixed(0)}%</span>
          </div>
          <Progress value={opp.percentToNextTier} className="h-2" />
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Spend Gap</p>
            <p className="font-semibold text-amber-500">${opp.spendGap.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Projected Additional Rebate</p>
            <p className="font-semibold text-emerald-500">
              +${opp.projectedAdditionalRebate.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Current Rate</p>
            <p className="font-medium">{opp.currentRebatePercent}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Next Tier Rate</p>
            <p className="font-medium">{opp.nextRebatePercent}%</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={onSetTarget}>
          <Target className="mr-1.5 size-3" />
          Set Spend Target
        </Button>
      </CardContent>
    </Card>
  )
}
