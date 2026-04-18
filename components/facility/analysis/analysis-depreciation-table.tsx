"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatting"
import type { DepreciationEntry } from "@/lib/financial-analysis/macrs"

/**
 * MACRS 5-year half-year schedule table. Six rows regardless of
 * contract term (IRS schedule runs 6 taxable years); when the contract
 * term is shorter, the trailing rows are shown for context but the
 * orchestrator can decide whether they contribute to cashflows.
 */
export interface AnalysisDepreciationTableProps {
  schedule: DepreciationEntry[]
}

export function AnalysisDepreciationTable({
  schedule,
}: AnalysisDepreciationTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">MACRS depreciation schedule</CardTitle>
        <CardDescription>
          IRS Pub 946 Table A-1, 5-year property, half-year convention.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Depreciation</TableHead>
              <TableHead className="text-right">Cumulative</TableHead>
              <TableHead className="text-right">Book value</TableHead>
              <TableHead className="text-right">Tax savings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedule.map((row) => (
              <TableRow key={row.year}>
                <TableCell>{row.year}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {(row.depreciationPercent * 100).toFixed(2)}%
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(row.depreciationAmount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(row.cumulativeDepreciation)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(row.bookValue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(row.taxSavings)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
