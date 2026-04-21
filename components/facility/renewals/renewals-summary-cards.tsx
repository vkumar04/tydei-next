"use client"

/**
 * Facility-wide summary cards for the renewals page.
 *
 * Consumes the pre-aggregated RenewalSummary shape produced by
 * `computeRenewalSummary` (lib/renewals/summary-stats.ts). Four uniform-
 * height cards with colored left-borders mirroring the status palette:
 *   red    → critical (≤30d)
 *   yellow → warning (≤90d, cumulative w/ critical)
 *   blue   → upcoming (at-risk dollar exposure)
 *   green  → healthy (strong performers)
 */

import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  Clock,
  DollarSign,
  CheckCircle2,
  HelpCircle,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCurrency } from "@/lib/formatting"
import type { RenewalSummary } from "@/lib/renewals/summary-stats"

interface RenewalsSummaryCardsProps {
  summary: RenewalSummary
}

type BorderAccent = "red" | "yellow" | "blue" | "green"

const accentBorderClass: Record<BorderAccent, string> = {
  red: "border-l-red-500",
  yellow: "border-l-yellow-500",
  blue: "border-l-blue-500",
  green: "border-l-green-500",
}

const accentIconClass: Record<BorderAccent, string> = {
  red: "text-red-500/60",
  yellow: "text-yellow-500/60",
  blue: "text-blue-500/60",
  green: "text-green-500/60",
}

interface StatCardProps {
  icon: LucideIcon
  title: string
  value: string
  description: string
  accent: BorderAccent
  /** When present, a help icon next to the title opens this tooltip.
   *  Use to spell out how the number is computed (Charles iMessage
   *  2026-04-20 N11/N12 — "too vague"). */
  tooltip?: string
}

function StatCard({ icon: Icon, title, value, description, accent, tooltip }: StatCardProps) {
  return (
    <Card className={`border-l-4 ${accentBorderClass[accent]} h-full`}>
      <CardContent className="flex h-full flex-col justify-between gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              {title}
              {tooltip ? (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${title} help`}
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">{tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          </div>
          <Icon className={`h-8 w-8 shrink-0 ${accentIconClass[accent]}`} />
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

export function RenewalsSummaryCards({ summary }: RenewalsSummaryCardsProps) {
  const cumulative90 = summary.criticalCount + summary.warningCount

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={AlertTriangle}
        title="Expiring in 30 Days"
        value={summary.criticalCount.toString()}
        description="immediate attention"
        accent="red"
      />
      <StatCard
        icon={Clock}
        title="Expiring in 90 Days"
        value={cumulative90.toString()}
        description="action needed"
        accent="yellow"
      />
      <StatCard
        icon={DollarSign}
        title="At-Risk Spend"
        value={formatCurrency(summary.totalAtRiskSpend)}
        description="under-performing contracts"
        accent="blue"
        tooltip="Sum of spend across contracts whose commitment is under 80%. A contract's commitment is (current market share / marketShareCommitment) when that's tracked, else (rebates earned / contract value) — see the Commitment help on the Strong Performers card."
      />
      <StatCard
        icon={CheckCircle2}
        title="Strong Performers"
        value={summary.strongPerformers.toString()}
        description="met or exceeded commitment"
        accent="green"
        tooltip="Count of contracts where commitment ≥ 100%. Commitment = (current market share / marketShareCommitment) × 100 when the contract tracks market share, otherwise (rebates earned / total contract value) × 100. ≥ 100 means the contract is on or ahead of its promised pace."
      />
    </div>
  )
}
