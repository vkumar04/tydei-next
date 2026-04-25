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
 */
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
  if (!data || data.length === 0) return null

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
        {data.map((row) => {
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
      </CardContent>
    </Card>
  )
}
