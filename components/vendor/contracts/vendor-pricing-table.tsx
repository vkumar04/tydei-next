"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import { getVendorContractPricing } from "@/lib/actions/pricing-files"

/**
 * 2026-06-09 facility→vendor UI parity ("the UI on vendor side needs to
 * function more like the facility side"): the facility contract detail has a
 * Pricing tab; the vendor portal had none — vendors couldn't see the price
 * list governing their own contract. Read-only by design (pricing mutations
 * stay facility-gated).
 */
export function VendorPricingTable({ contractId }: { contractId: string }) {
  const [search, setSearch] = useState("")
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-contract-pricing", contractId],
    queryFn: () => getVendorContractPricing(contractId),
    staleTime: 5 * 60_000,
  })

  const rows = (data ?? []).filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.vendorItemNo.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q) ||
      (r.category ?? "").toLowerCase().includes(q)
    )
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Contract Pricing</CardTitle>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {rows.length} of {(data ?? []).length} items
            </span>
          )}
        </div>
        <Input
          placeholder="Search SKU, description, or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-2 max-w-sm"
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {search
              ? "No pricing items match the search."
              : "No pricing items on this contract yet."}
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">SKU</th>
                  <th className="py-2 text-left font-medium">Description</th>
                  <th className="py-2 text-left font-medium">Category</th>
                  <th className="py-2 text-right font-medium">Unit Price</th>
                  <th className="py-2 text-right font-medium">Carve-out %</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 font-mono text-xs">{r.vendorItemNo}</td>
                    <td className="max-w-[280px] truncate py-1.5" title={r.description ?? undefined}>
                      {r.description ?? "—"}
                    </td>
                    <td className="py-1.5">
                      {r.category ? (
                        <Badge variant="outline" className="text-xs">{r.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatCurrency(Number(r.unitPrice))}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.carveOutPercent != null
                        ? `${(Number(r.carveOutPercent) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing first 500 — refine the search to narrow.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
