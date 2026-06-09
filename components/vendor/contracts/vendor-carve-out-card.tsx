"use client"

import { useQuery } from "@tanstack/react-query"
import { Scissors } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getVendorCarveOutRebate } from "@/lib/actions/contracts/carve-out"

/**
 * 2026-06-09 facility→vendor feature port ("copy similar features from
 * facilities to the vendor side"): the facility Performance tab shows a
 * "Carve-out rebate" tile (per-SKU rebate + eligible spend + effective
 * rate) — the vendor portal had NO carve-out surface even though the
 * vendor's flagship prod contract is a carve-out tie-in. Same engine via
 * the vendor-scoped getVendorCarveOutRebate. Self-hides when the contract
 * has no carve-out lines.
 */
export function VendorCarveOutCard({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-carve-out", contractId],
    queryFn: () => getVendorCarveOutRebate(contractId),
    staleTime: 5 * 60_000,
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />
            Carve-out Rebate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    )
  }

  const lineCount = data?.carveOutLines?.length ?? 0
  if (!data || (data.rebateEarned <= 0 && lineCount === 0)) return null

  const eligibleSpend = data.eligibleSpend ?? 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />
            Carve-out Rebate
          </CardTitle>
          <span className="text-lg font-semibold tabular-nums">
            {formatCurrency(data.rebateEarned)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {/* Carve-out = per-SKU rate from the pricing file applied to
              matched spend — same engine the facility portal shows. */}
          {lineCount} carved-out SKU{lineCount === 1 ? "" : "s"} ·{" "}
          {formatCurrency(eligibleSpend)} eligible spend
        </p>
        {eligibleSpend > 0 && (
          <p className="text-xs text-muted-foreground">
            Effective carve-out rate:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {((data.rebateEarned / eligibleSpend) * 100).toFixed(1)}%
            </span>{" "}
            of eligible spend
          </p>
        )}
      </CardContent>
    </Card>
  )
}
