"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getCategoryMarketShareForVendor } from "@/lib/actions/cog/category-market-share"

/**
 * Per-category market share for a contract's vendor at the active
 * facility. Charles 2026-04-25: "Don't seeing anything for category
 * market share." Computed live from COG (trailing 12 months) so it
 * reflects actual purchase mix without schema changes.
 *
 * 2026-04-26: User feedback "several contracts missing market share /
 * I don't understand why some do and some do not." Root cause was
 * COG-import variance — some vendors' rows have category=null so the
 * card silently rendered nothing. We now render explicit empty-state
 * variants ("no spend recorded" / "spend exists but un-categorized")
 * and a footnote when un-categorized spend is material.
 */

const UNCATEGORIZED_FOOTNOTE_THRESHOLD = 0.05 // 5% of vendor total

export function CategoryMarketShareCard({
  vendorId,
  contractId,
}: {
  vendorId: string
  /**
   * Optional — when present, the action overlays per-category
   * commitment % so the card can render "X% / Y% commitment".
   */
  contractId?: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["category-market-share", vendorId, contractId ?? null],
    queryFn: () =>
      getCategoryMarketShareForVendor({ vendorId, contractId }),
    // 2026-04-28: invalidation is now wired from every COG mutation
    // (use-cog.ts), so default staleTime is fine — the prior
    // staleTime: 0 hack is no longer needed.
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Share by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data) return null

  const { rows, uncategorizedSpend, totalVendorSpend } = data

  // ─── Empty-state branch 1: vendor has zero spend in the window ──
  if (totalVendorSpend === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Share by Category</CardTitle>
          <CardDescription>
            No spend recorded for this vendor at this facility in the
            last 12 months.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // ─── Empty-state branch 2: spend exists but ALL un-categorized ──
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Share by Category</CardTitle>
          <CardDescription>
            This vendor has{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(totalVendorSpend)}
            </span>{" "}
            of spend in the last 12 months, but none of the COG records
            are categorized — so we can&apos;t compute share by
            category. Categorize the COG import (or remap items to
            categories) and this card will populate.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // ─── Normal render: show categories + footnote if material gap ──
  const uncategorizedRatio =
    totalVendorSpend > 0 ? uncategorizedSpend / totalVendorSpend : 0
  const showUncategorizedFootnote =
    uncategorizedRatio > UNCATEGORIZED_FOOTNOTE_THRESHOLD

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Share by Category</CardTitle>
        <CardDescription>
          Vendor&apos;s share of facility spend in each product category
          (trailing 12 months, computed from COG).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => {
          // Charles 2026-04-25 (audit follow-up): when a per-category
          // commitment exists, layer it onto the share progress bar
          // so the user sees met-vs-target at a glance.
          const meetingCommitment =
            row.commitmentPct != null && row.sharePct >= row.commitmentPct
          return (
            <div key={row.category} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{row.category}</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{row.sharePct.toFixed(1)}%</span>
                  {row.commitmentPct != null && (
                    <span
                      className={
                        meetingCommitment
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }
                    >
                      {" "}
                      / {row.commitmentPct.toFixed(1)}% commitment
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatCurrency(row.vendorSpend)} of{" "}
                    {formatCurrency(row.categoryTotal)}
                  </span>
                </span>
              </div>
              <Progress value={Math.min(100, row.sharePct)} />
              <p className="text-[11px] text-muted-foreground">
                {row.competingVendors === 1
                  ? "Sole supplier in this category"
                  : `${row.competingVendors} vendors competing`}
                {row.commitmentPct != null &&
                  (meetingCommitment
                    ? ` · meeting commitment`
                    : ` · ${(row.commitmentPct - row.sharePct).toFixed(1)}% short of commitment`)}
              </p>
            </div>
          )
        })}
        {showUncategorizedFootnote && (
          <p className="border-t pt-2 text-[11px] text-amber-700 dark:text-amber-400">
            Plus {formatCurrency(uncategorizedSpend)} un-categorized (
            {(uncategorizedRatio * 100).toFixed(0)}% of vendor total) —
            shares above only reflect categorized spend. Run COG
            categorization to capture the full footprint.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
