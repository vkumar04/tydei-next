"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertTriangle } from "lucide-react"
import type { COGRecordInput } from "@/lib/validators/cog-records"

interface COGImportPreviewProps {
  records: COGRecordInput[]
  duplicates: number
  errors: string[]
}

export function COGImportPreview({
  records,
  duplicates,
  errors,
}: COGImportPreviewProps) {
  const preview = records.slice(0, 10)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="default">{records.length} records</Badge>
        {duplicates > 0 && (
          <Badge variant="secondary">{duplicates} potential duplicates</Badge>
        )}
      </div>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {errors.length} validation error(s): {errors.slice(0, 3).join(", ")}
            {errors.length > 3 && `... and ${errors.length - 3} more`}
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-md border max-h-64 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Inv #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">
                  {r.inventoryNumber}
                </TableCell>
                <TableCell className="max-w-[200px] truncate">
                  {r.inventoryDescription}
                </TableCell>
                <TableCell>{r.vendorName ?? "—"}</TableCell>
                <TableCell className="text-right">
                  ${r.unitCost.toFixed(2)}
                </TableCell>
                <TableCell>{r.transactionDate}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {records.length > 10 && (
        <p className="text-xs text-muted-foreground">
          Showing first 10 of {records.length} records
        </p>
      )}
    </div>
  )
}
