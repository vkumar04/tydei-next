"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { TrendingDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getTierPriceReductionForContract } from "@/lib/actions/contracts/tier-price-reduction"
import { formatCurrency } from "@/lib/formatting"

/**
 * Charles 2026-06-08 ("for price reduction the real benefits are shown in
 * COGS to show if they over paid or not and what the price would be"):
 * surfaces the per-SKU original-vs-effective price + total benefit for a
 * `price_reduction` contract, via the previously-unwired
 * `getTierPriceReductionForContract` engine. Price-reduction contracts earn
 * NO rebate — the benefit IS the discounted price, which this card makes
 * visible. Self-hides for any contract without a price_reduction term.
 */
const ROW_LIMIT = 10

export function PriceReductionCard({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.analytics.priceReduction(contractId),
    queryFn: () => getTierPriceReductionForContract({ contractId }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  // Aggregate the per-purchase lines into one row per SKU so the table is
  // readable: total qty, spend-weighted paid vs reduced unit price, benefit.
  const rows = useMemo(() => {
    const lines = data?.result?.priceReductionLines ?? []
    const bySku = new Map<
      string,
      { qty: number; paidSpend: number; reducedSpend: number; benefit: number }
    >()
    for (const l of lines) {
      const cur = bySku.get(l.referenceNumber) ?? {
        qty: 0,
        paidSpend: 0,
        reducedSpend: 0,
        benefit: 0,
      }
      cur.qty += l.quantity
      cur.paidSpend += l.originalUnitPrice * l.quantity
      cur.reducedSpend += l.effectiveUnitPrice * l.quantity
      cur.benefit += l.totalLineReduction
      bySku.set(l.referenceNumber, cur)
    }
    return Array.from(bySku.entries())
      .map(([sku, v]) => ({
        sku,
        qty: v.qty,
        paidUnit: v.qty > 0 ? v.paidSpend / v.qty : 0,
        reducedUnit: v.qty > 0 ? v.reducedSpend / v.qty : 0,
        benefit: v.benefit,
      }))
      .sort((a, b) => b.benefit - a.benefit)
  }, [data])

  // Hide the card entirely for contracts with no price_reduction term.
  if (!isLoading && !data?.result) return null

  const total = data?.result?.priceReductionValue ?? 0
  const skuCount = rows.length
  const shown = rows.slice(0, ROW_LIMIT)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4" />
            Price-Reduction Benefit
          </CardTitle>
          {!isLoading ? (
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrency(total)}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A pricing-only contract earns no rebate — the benefit is the
          discounted price. This is what was paid vs the contracted (reduced)
          price across {skuCount} SKU{skuCount === 1 ? "" : "s"}; a positive
          benefit means the reduced price is below what was paid.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No matched purchases in the contract window yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">SKU</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Paid / unit</th>
                  <th className="py-2 text-right font-medium">
                    Reduced price
                  </th>
                  <th className="py-2 text-right font-medium">Benefit</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.sku} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{r.sku}</td>
                    <td className="py-2 text-right tabular-nums">{r.qty}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(r.paidUnit)}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {formatCurrency(r.reducedUnit)}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        r.benefit > 0
                          ? "text-emerald-600"
                          : r.benefit < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    >
                      {formatCurrency(r.benefit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > ROW_LIMIT ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing top {ROW_LIMIT} of {rows.length} SKUs by benefit.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
