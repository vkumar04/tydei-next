"use client"

/**
 * Facility renewals table.
 *
 * Columns: status pill, contract name, vendor, days until expiration,
 * commitment %, actions. Rows are clickable and delegate selection to
 * the parent orchestrator via `onSelect`.
 *
 * Status pill colors follow the spec:
 *   critical → red, warning → yellow, upcoming → blue, ok → green.
 */

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/shared/empty-state"
import { FileText, Eye } from "lucide-react"
import type { RenewalStatus } from "@/lib/renewals/engine"
import { formatDate } from "@/lib/formatting"

export interface RenewalRow {
  id: string
  name: string
  contractNumber: string | null
  vendorName: string
  expirationDate: string
  daysUntilExpiry: number
  status: RenewalStatus
  /** Percentage in [0, 100+]; null when commitment can't be computed. */
  commitmentMet: number | null
}

interface RenewalsListProps {
  rows: RenewalRow[]
  selectedId: string | null
  onSelect: (row: RenewalRow) => void
}

const statusBadgeClass: Record<RenewalStatus, string> = {
  critical:
    "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300",
  warning:
    "bg-yellow-100 text-yellow-900 hover:bg-yellow-100 dark:bg-yellow-900/40 dark:text-yellow-300",
  upcoming:
    "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300",
  ok: "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/40 dark:text-green-300",
}

const statusLabel: Record<RenewalStatus, string> = {
  critical: "Critical",
  warning: "Warning",
  upcoming: "Upcoming",
  ok: "On Track",
}

export function RenewalsList({ rows, selectedId, onSelect }: RenewalsListProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No renewals match your filters"
        description="Adjust the status filter or clear your search to see more contracts."
      />
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Status</TableHead>
            <TableHead>Contract</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead className="text-right">Expires</TableHead>
            <TableHead className="text-right">Days Left</TableHead>
            <TableHead className="w-[180px]">Commitment</TableHead>
            <TableHead className="w-[110px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSelected = selectedId === row.id
            const commitmentPct = row.commitmentMet ?? null
            const displayPct =
              commitmentPct === null
                ? null
                : Math.max(0, Math.min(commitmentPct, 100))
            return (
              <TableRow
                key={row.id}
                data-state={isSelected ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => onSelect(row)}
              >
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={statusBadgeClass[row.status]}
                  >
                    {statusLabel[row.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  {row.contractNumber ? (
                    <div className="text-xs text-muted-foreground">
                      {row.contractNumber}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{row.vendorName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDate(row.expirationDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.daysUntilExpiry}
                </TableCell>
                <TableCell>
                  {displayPct === null ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Progress value={displayPct} className="h-2 flex-1" />
                      <span className="w-10 text-right text-xs tabular-nums">
                        {Math.round(displayPct)}%
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(row)
                    }}
                    aria-label={`View ${row.name}`}
                  >
                    <Eye className="mr-1 h-4 w-4" />
                    View
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
