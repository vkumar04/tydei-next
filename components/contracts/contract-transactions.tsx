"use client"

import { useQuery } from "@tanstack/react-query"
import {
  DollarSign,
  TrendingUp,
  Percent,
  Calendar,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { getContractPeriods } from "@/lib/actions/contract-periods"

interface ContractTransactionsProps {
  contractId: string
}

interface PeriodRow {
  id: string
  periodStart: string
  periodEnd: string
  totalSpend: number
  rebateEarned: number
  rebateCollected: number
  tierAchieved: number | null
}

function getPeriodStatus(periodEnd: string): "completed" | "active" | "upcoming" {
  const now = new Date()
  const end = new Date(periodEnd)
  const start = new Date(periodEnd)
  start.setMonth(start.getMonth() - 3) // approximate period start
  if (end < now) return "completed"
  if (start <= now && end >= now) return "active"
  return "upcoming"
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  completed: { label: "Completed", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  upcoming: { label: "Upcoming", variant: "outline" },
}

export function ContractTransactions({ contractId }: ContractTransactionsProps) {
  const { data: periods, isLoading } = useQuery({
    queryKey: ["contractPeriods", contractId],
    queryFn: () => getContractPeriods(contractId),
    enabled: !!contractId,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-[200px] w-full" />
      </div>
    )
  }

  const rows: PeriodRow[] = (periods ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    periodStart: p.periodStart as string,
    periodEnd: p.periodEnd as string,
    totalSpend: Number(p.totalSpend ?? 0),
    rebateEarned: Number(p.rebateEarned ?? 0),
    rebateCollected: Number(p.rebateCollected ?? 0),
    tierAchieved: p.tierAchieved != null ? Number(p.tierAchieved) : null,
  }))

  const totalSpend = rows.reduce((s, r) => s + r.totalSpend, 0)
  const totalRebates = rows.reduce((s, r) => s + r.rebateEarned, 0)
  const totalCollected = rows.reduce((s, r) => s + r.rebateCollected, 0)
  const collectionRate =
    totalRebates > 0 ? (totalCollected / totalRebates) * 100 : 0

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Transaction Ledger
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No contract period data available yet. Period transactions will
            appear here once spend data is tracked against this contract.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Spend</p>
              <p className="text-xl font-bold">{formatCurrency(totalSpend)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Rebates</p>
              <p className="text-xl font-bold">{formatCurrency(totalRebates)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Percent className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Collection Rate</p>
              <p className="text-xl font-bold">{collectionRate.toFixed(1)}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Periods Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Contract Periods
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Rebate Earned</TableHead>
                  <TableHead className="text-center">Tier</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const status = getPeriodStatus(row.periodEnd)
                  const config = statusConfig[status]
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {formatDate(row.periodStart)} &ndash;{" "}
                        {formatDate(row.periodEnd)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.totalSpend)}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">
                        {formatCurrency(row.rebateEarned)}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.tierAchieved != null ? (
                          <Badge variant="outline">Tier {row.tierAchieved}</Badge>
                        ) : (
                          <span className="text-muted-foreground">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
