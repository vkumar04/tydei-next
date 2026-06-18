"use client"

/**
 * Surgeon × Vendor Spend report (Charles 2026-06-18). Per surgeon, how much
 * they spend with each vendor (from case supplies), with a contract-compliance
 * split. Sortable + filterable like the other case-costing lists. Fed by
 * `getSurgeonVendorSpend` via `useSurgeonVendorSpend`.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useTableSort, SortableHead } from "@/components/shared/use-table-sort"
import { Search } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import type { SurgeonVendorSpendRow } from "@/lib/actions/case-costing/surgeon-vendor-spend"

interface SurgeonVendorSpendReportProps {
  rows: SurgeonVendorSpendRow[] | undefined
  isLoading: boolean
}

export function SurgeonVendorSpendReport({
  rows,
  isLoading,
}: SurgeonVendorSpendReportProps) {
  const sort = useTableSort<SurgeonVendorSpendRow, string>(rows ?? [], {
    accessors: {
      surgeonName: (r) => r.surgeonName,
      vendorName: (r) => r.vendorName,
      totalSpend: (r) => r.totalSpend,
      onContractSpend: (r) => r.onContractSpend,
      offContractSpend: (r) => r.offContractSpend,
      compliancePercent: (r) => r.compliancePercent,
      supplyCount: (r) => r.supplyCount,
    },
    searchFields: [(r) => r.surgeonName, (r) => r.vendorName],
    initialSort: { key: "totalSpend", dir: "desc" },
  })

  if (isLoading) {
    return <Skeleton className="h-[320px] w-full" />
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No surgeon-vendor spend data available for this window. Import case
        supplies and run enrichment to populate it.
      </p>
    )
  }

  const totalSpend = rows.reduce((s, r) => s + r.totalSpend, 0)
  const onContract = rows.reduce((s, r) => s + r.onContractSpend, 0)
  const overallCompliance = totalSpend > 0 ? (onContract / totalSpend) * 100 : 0

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search
          className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={sort.query}
          onChange={(e) => sort.setQuery(e.target.value)}
          placeholder="Filter by surgeon or vendor…"
          aria-label="Filter surgeon-vendor spend"
          className="pl-8"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Surgeon" sortKey="surgeonName" state={sort} />
            <SortableHead label="Vendor" sortKey="vendorName" state={sort} />
            <SortableHead label="Total spend" sortKey="totalSpend" state={sort} align="right" />
            <SortableHead label="On contract" sortKey="onContractSpend" state={sort} align="right" />
            <SortableHead label="Off contract" sortKey="offContractSpend" state={sort} align="right" />
            <SortableHead label="Supplies" sortKey="supplyCount" state={sort} align="right" />
            <SortableHead label="Compliance" sortKey="compliancePercent" state={sort} align="right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sort.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No rows match your filter.
              </TableCell>
            </TableRow>
          ) : (
            sort.rows.map((r) => (
              <TableRow key={`${r.surgeonName} ${r.vendorName}`}>
                <TableCell className="font-medium">{r.surgeonName}</TableCell>
                <TableCell>{r.vendorName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(r.totalSpend)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(r.onContractSpend)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                  {formatCurrency(r.offContractSpend)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.supplyCount}
                </TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant={
                      r.compliancePercent >= 80
                        ? "default"
                        : r.compliancePercent >= 50
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {Math.round(r.compliancePercent)}%
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-4">
        <div>
          <p className="text-sm font-medium">Total supply spend</p>
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalSpend)}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-sm text-muted-foreground">
            {rows.length} surgeon-vendor pairs
          </p>
          <p className="text-sm text-muted-foreground">
            Overall compliance: {Math.round(overallCompliance)}%
          </p>
        </div>
      </div>
    </div>
  )
}
