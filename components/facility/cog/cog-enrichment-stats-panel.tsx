"use client"

/**
 * Enrichment stats panel for the COG data page.
 *
 * Reads the existing `useCOGStats` hook (already wired) and presents
 * the match-rate story as a single focused card:
 *
 *   - Total rows
 *   - Matched (on-contract) rows
 *   - Unmatched (off-contract) rows
 *   - On-contract percentage
 *
 * Per the spec (2026-04-18-cog-data-rewrite.md §6), stats are derived
 * from persisted enrichment columns upstream; this panel is UI-only
 * and must not recompute.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, AlertTriangle, Database, Percent } from "lucide-react"
import { useCOGStats } from "@/hooks/use-cog"

interface CogEnrichmentStatsPanelProps {
  facilityId: string
}

const pct = (num: number, denom: number): number => {
  if (denom <= 0) return 0
  return Math.min(100, Math.max(0, (num / denom) * 100))
}

export function CogEnrichmentStatsPanel({
  facilityId,
}: CogEnrichmentStatsPanelProps) {
  const { data, isPending, isError } = useCOGStats(facilityId)

  if (isPending) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Enrichment Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Enrichment Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Unable to load enrichment stats. Retry loading this page or run
            Match Pricing.
          </p>
        </CardContent>
      </Card>
    )
  }

  const totalRows = data.totalItems
  const matched = data.onContractCount
  const unmatched = data.offContractCount
  const onContractPct = pct(matched, totalRows)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          Enrichment Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile
            icon={<Database className="h-4 w-4 text-muted-foreground" />}
            label="Total rows"
            value={totalRows.toLocaleString()}
            tone="neutral"
          />
          <StatTile
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            label="Matched"
            value={matched.toLocaleString()}
            tone="positive"
          />
          <StatTile
            icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
            label="Unmatched"
            value={unmatched.toLocaleString()}
            tone="warning"
          />
          <StatTile
            icon={<Percent className="h-4 w-4 text-primary" />}
            label="On-contract"
            value={`${onContractPct.toFixed(1)}%`}
            tone="accent"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Match coverage</span>
            <span>
              {matched.toLocaleString()} / {totalRows.toLocaleString()}
            </span>
          </div>
          <Progress value={onContractPct} />
        </div>
      </CardContent>
    </Card>
  )
}

interface StatTileProps {
  icon: React.ReactNode
  label: string
  value: string
  tone: "neutral" | "positive" | "warning" | "accent"
}

function StatTile({ icon, label, value, tone }: StatTileProps) {
  const toneClass = {
    neutral: "text-foreground",
    positive: "text-emerald-700 dark:text-emerald-400",
    warning: "text-amber-700 dark:text-amber-400",
    accent: "text-primary",
  }[tone]

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  )
}
