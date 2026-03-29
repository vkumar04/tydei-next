"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown } from "lucide-react"
import type { SurgeonScorecard } from "@/lib/actions/cases"

interface SurgeonScorecardCardProps {
  scorecard: SurgeonScorecard
  avgCostPerCase?: number
}

export function SurgeonScorecardCard({
  scorecard,
  avgCostPerCase = 0,
}: SurgeonScorecardCardProps) {
  const isBelowAvg =
    avgCostPerCase > 0 && scorecard.avgSpendPerCase < avgCostPerCase
  const isAboveAvg =
    avgCostPerCase > 0 && scorecard.avgSpendPerCase > avgCostPerCase

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{scorecard.surgeonName}</CardTitle>
          {isBelowAvg && (
            <TrendingDown className="size-4 text-emerald-600" />
          )}
          {isAboveAvg && (
            <TrendingUp className="size-4 text-red-500" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Cases:</span>{" "}
            <span className="font-medium">{scorecard.caseCount}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Avg Cost:</span>{" "}
            <span
              className={`font-medium ${
                isBelowAvg
                  ? "text-emerald-600"
                  : isAboveAvg
                    ? "text-red-600"
                    : ""
              }`}
            >
              ${Math.round(scorecard.avgSpendPerCase).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Supply Utilization (on-contract %) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Supply Utilization</span>
            <span className="font-medium">
              {Math.round(scorecard.onContractPercent)}%
            </span>
          </div>
          <Progress value={scorecard.onContractPercent} className="h-2" />
        </div>

        {/* Compliance */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Compliance</span>
            <span className="font-medium">
              {Math.round(scorecard.complianceRate)}%
            </span>
          </div>
          <Progress value={scorecard.complianceRate} className="h-2" />
        </div>

        {scorecard.topProcedures.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Top Procedures
            </p>
            <div className="flex flex-wrap gap-1">
              {scorecard.topProcedures.slice(0, 3).map((p) => (
                <Badge key={p.cptCode} variant="outline" className="text-xs">
                  {p.cptCode} ({p.count})
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
