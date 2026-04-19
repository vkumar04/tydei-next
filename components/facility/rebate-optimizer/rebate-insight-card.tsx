"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Flag,
  Sparkles,
  Calculator,
} from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import type { RebateInsight } from "@/lib/ai/rebate-optimizer-schemas"

interface RebateInsightCardProps {
  insight: RebateInsight
  onFlag: (insight: RebateInsight) => void
  onOpenInScenarioBuilder?: (insight: RebateInsight) => void
  isFlagging?: boolean
  isFlagged?: boolean
}

const CONFIDENCE_BADGE: Record<RebateInsight["confidence"], string> = {
  high: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-900",
  medium:
    "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-200 dark:border-yellow-900",
  low: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-800",
}

const ACTION_LABEL: Record<RebateInsight["actionType"], string> = {
  redirect_spend: "Redirect spend",
  accelerate_purchase: "Accelerate purchase",
  negotiate_tier: "Negotiate tier",
  log_collection: "Log collection",
  review_compliance: "Review compliance",
}

export function RebateInsightCard({
  insight,
  onFlag,
  onOpenInScenarioBuilder,
  isFlagging,
  isFlagged,
}: RebateInsightCardProps) {
  const [rationaleOpen, setRationaleOpen] = useState(false)

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Badge variant="secondary" className="mt-0.5 shrink-0">
              #{insight.rank}
            </Badge>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight">
                {insight.title}
              </CardTitle>
              <CardDescription className="mt-1 text-sm text-muted-foreground">
                {insight.summary}
              </CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {insight.impactDollars !== null && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Impact</p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                  {formatCurrency(insight.impactDollars)}
                </p>
              </div>
            )}
            <Badge
              variant="outline"
              className={CONFIDENCE_BADGE[insight.confidence]}
            >
              {insight.confidence}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Collapsible open={rationaleOpen} onOpenChange={setRationaleOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
            >
              {rationaleOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {rationaleOpen ? "Hide reasoning" : "Show reasoning"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {insight.rationale}
            </p>
          </CollapsibleContent>
        </Collapsible>

        {insight.citedContractIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span className="font-medium">Cited:</span>
            {insight.citedContractIds.map((id) => (
              <Link
                key={id}
                href={`/dashboard/contracts/${id}`}
                className="inline-flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400"
              >
                {id.slice(0, 8)}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="outline" className="gap-1">
            <Sparkles className="h-3 w-3" />
            {ACTION_LABEL[insight.actionType]}
          </Badge>
          {onOpenInScenarioBuilder && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => onOpenInScenarioBuilder(insight)}
            >
              <Calculator className="h-3 w-3" />
              Open in Scenario Builder
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => onFlag(insight)}
            disabled={isFlagging || isFlagged}
          >
            <Flag className="h-3 w-3" />
            {isFlagged ? "Flagged" : "Flag for review"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
