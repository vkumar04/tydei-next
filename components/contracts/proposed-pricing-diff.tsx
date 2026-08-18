"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { queryKeys } from "@/lib/query-keys"
import { formatCurrency } from "@/lib/formatting"
import { getContractPricing } from "@/lib/actions/pricing-files"
import {
  matchProposedPricing,
  summarizePricingMatch,
  type ProposedPricingItem,
} from "@/lib/contracts/pricing-match"

/**
 * The reviewer's view of proposed pricing.
 *
 * Runs the SAME `matchProposedPricing` the vendor previewed with and that
 * `approveContractChangeProposal` applies, so the three cannot disagree about
 * which rows are new and which are reprices. Approving writes exactly this.
 */
export function ProposedPricingDiff({
  contractId,
  items,
}: {
  contractId: string
  items: ProposedPricingItem[]
}) {
  const { data: existing = [], isLoading } = useQuery({
    queryKey: queryKeys.contracts.pricing(contractId),
    queryFn: () => getContractPricing(contractId),
  })

  const match = useMemo(
    () =>
      matchProposedPricing(
        items,
        existing.map((e) => ({
          id: e.id,
          vendorItemNo: e.vendorItemNo,
          description: e.description,
          category: e.category,
          unitPrice: e.unitPrice,
        })),
      ),
    [items, existing],
  )

  if (items.length === 0) return null

  const conflicts = match.changes.filter((c) => c.categoryConflict)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium">Proposed pricing</p>
        <span className="text-[11px] text-muted-foreground">
          {isLoading ? "matching…" : summarizePricingMatch(match)}
        </span>
        {match.added.length > 0 && (
          <Badge
            variant="outline"
            className="border-emerald-600/40 text-emerald-600 dark:text-emerald-400"
          >
            {match.added.length} new
          </Badge>
        )}
        {match.updated.length > 0 && (
          <Badge
            variant="outline"
            className="border-amber-600/40 text-amber-600 dark:text-amber-400"
          >
            {match.updated.length} repriced
          </Badge>
        )}
      </div>

      {match.duplicateSkus.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Duplicate item numbers in the proposal — only the last of each would
          apply: {match.duplicateSkus.slice(0, 5).join(", ")}
          {match.duplicateSkus.length > 5 ? "…" : ""}
        </p>
      )}
      {conflicts.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {conflicts.length} item
          {conflicts.length === 1 ? "" : "s"} propose a different category than
          the contract currently records — approving keeps the existing category.
        </p>
      )}

      <div className="max-h-72 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Proposed</TableHead>
              <TableHead className="text-right">Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {match.changes.map((c, i) => (
              <TableRow key={`${c.item.vendorItemNo}-${i}`}>
                <TableCell className="font-mono text-xs">
                  {c.item.vendorItemNo}
                </TableCell>
                <TableCell className="max-w-[16rem] truncate text-xs">
                  {c.item.description || "—"}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {c.oldPrice != null ? formatCurrency(c.oldPrice) : "—"}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatCurrency(c.item.unitPrice)}
                </TableCell>
                <TableCell className="text-right">
                  {c.kind === "add" ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-600/40 text-emerald-600 dark:text-emerald-400"
                    >
                      New
                    </Badge>
                  ) : c.kind === "update" ? (
                    <span
                      className={`text-xs tabular-nums ${
                        (c.delta ?? 0) > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {(c.delta ?? 0) > 0 ? "+" : ""}
                      {formatCurrency(c.delta ?? 0)}
                      {c.deltaPercent != null
                        ? ` (${(c.deltaPercent * 100).toFixed(1)}%)`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Unchanged
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
