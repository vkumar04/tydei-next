"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Target } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { motion } from "motion/react"
import { fadeInUp } from "@/lib/animations"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

interface OpportunityCardProps {
  opportunity: RebateOpportunity
  onSetTarget: () => void
}

export function OpportunityCard({
  opportunity: opp,
  onSetTarget,
}: OpportunityCardProps) {
  return (
    <motion.div variants={fadeInUp}>
      <Card className="flex h-full flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {opp.vendorName}
              </p>
              <CardTitle className="mt-0.5 truncate text-sm font-medium">
                {opp.contractName}
              </CardTitle>
            </div>
            <Badge variant="secondary" className="shrink-0">
              Tier {opp.currentTier} &rarr; {opp.nextTier}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {/* Progress toward next tier */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                {formatCurrency(opp.currentSpend)} /{" "}
                {formatCurrency(opp.nextTierThreshold)}
              </span>
              <span className="font-medium">
                {opp.percentToNextTier.toFixed(0)}%
              </span>
            </div>
            <Progress value={opp.percentToNextTier} className="h-2" />
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Current Spend</p>
              <p className="font-semibold">
                {formatCurrency(opp.currentSpend)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Next Tier Threshold</p>
              <p className="font-semibold">
                {formatCurrency(opp.nextTierThreshold)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Spend Needed</p>
              <p className="font-semibold text-amber-500">
                {formatCurrency(opp.spendGap)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Potential Rebate Increase</p>
              <p className="font-semibold text-emerald-500">
                +{formatCurrency(opp.projectedAdditionalRebate)}
              </p>
            </div>
          </div>

          {/* Action button */}
          <Button
            size="sm"
            variant="outline"
            className="mt-auto w-full"
            onClick={onSetTarget}
          >
            <Target className="mr-1.5 size-3" />
            Set Spend Target
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  )
}
