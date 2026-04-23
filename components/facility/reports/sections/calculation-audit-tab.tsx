"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import { MetricCard } from "./metric-card"
import type { ContractPeriodRow } from "../report-columns"
import type { ReportData, DateRange } from "./types"

/* ─── Props ──────────────────────────────────────────────────── */

export interface CalculationAuditTabProps {
  data: ReportData | undefined
  allPeriods: ContractPeriodRow[]
  dateRange: DateRange
}

/* ─── Component ──────────────────────────────────────────────── */

export function CalculationAuditTab({
  data,
  allPeriods,
  dateRange,
}: CalculationAuditTabProps) {
  const totalSpend = allPeriods.reduce((s, p) => s + p.totalSpend, 0)
  // Charles 2026-04-23 audit — canonical rebate totals come from the
  // per-contract `rebateEarnedCanonical` / `rebateCollectedCanonical`
  // fields (server-computed via sumEarnedRebatesLifetime /
  // sumCollectedRebates on the Rebate table). ContractPeriod-based
  // reducers drifted from the rest of the app.
  const totalRebateEarned =
    data?.contracts.reduce(
      (s, c) => s + (c.rebateEarnedCanonical ?? 0),
      0,
    ) ?? 0
  const totalRebateCollected =
    data?.contracts.reduce(
      (s, c) => s + (c.rebateCollectedCanonical ?? 0),
      0,
    ) ?? 0
  const totalPaymentExpected = allPeriods.reduce((s, p) => s + p.paymentExpected, 0)
  const totalPaymentActual = allPeriods.reduce((s, p) => s + p.paymentActual, 0)

  return (
    <>
      {/* Audit header */}
      <Card>
        <CardHeader className="bg-muted/50">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Calculation Audit Report</CardTitle>
              <CardDescription>
                Complete breakdown of how rebates and tiers are calculated with source data
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline">{data?.contracts.length ?? 0} contracts</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
            <p className="text-sm text-muted-foreground">
              This report shows every detail of how your contract calculations are performed.
              You can verify each purchase order, item, and the formulas used to calculate your rebates and tier status.
              All calculations are auditable and traceable to source documents.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary metrics */}
      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Total Eligible Spend" value={formatCurrency(totalSpend)} />
        <MetricCard
          label="Rebate Earned"
          value={formatCurrency(totalRebateEarned)}
          className="text-green-600 dark:text-green-400"
        />
        <MetricCard
          label="Rebate Collected"
          value={formatCurrency(totalRebateCollected)}
          className="text-blue-600"
        />
        <MetricCard label="Payment Expected" value={formatCurrency(totalPaymentExpected)} />
        <MetricCard label="Payment Actual" value={formatCurrency(totalPaymentActual)} />
      </div>

      {/* Per-contract breakdown */}
      {data?.contracts.map((c) => {
        const cSpend = c.periods.reduce((s, p) => s + p.totalSpend, 0)
        const cRebEarned = c.rebateEarnedCanonical ?? 0
        const cRebCollected = c.rebateCollectedCanonical ?? 0
        return (
          <Card key={c.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{c.name}</CardTitle>
                  <CardDescription>
                    {c.vendor} &mdash; {c.contractType}
                  </CardDescription>
                </div>
                <Badge variant="outline">{c.periods.length} periods</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="p-3 rounded-lg bg-muted/50 text-sm">
                  <span className="text-muted-foreground">Total Spend</span>
                  <p className="font-bold text-lg">{formatCurrency(cSpend)}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 text-sm">
                  <span className="text-muted-foreground">Rebate Earned</span>
                  <p className="font-bold text-lg text-green-600 dark:text-green-400">
                    {formatCurrency(cRebEarned)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 text-sm">
                  <span className="text-muted-foreground">Rebate Collected</span>
                  <p className="font-bold text-lg text-blue-600">
                    {formatCurrency(cRebCollected)}
                  </p>
                </div>
              </div>

              {/* Period rows */}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">#</th>
                      <th className="px-4 py-3 text-left font-medium">Period</th>
                      <th className="px-4 py-3 text-right font-medium">Spend</th>
                      <th className="px-4 py-3 text-right font-medium">Rebate Earned</th>
                      <th className="px-4 py-3 text-right font-medium">Rebate Collected</th>
                      <th className="px-4 py-3 text-right font-medium">Payment Exp.</th>
                      <th className="px-4 py-3 text-right font-medium">Payment Act.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.periods.map((p, i) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-4 py-3">{i + 1}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {p.periodStart.split("T")[0]} &ndash;{" "}
                          {p.periodEnd.split("T")[0]}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.totalSpend)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.rebateEarned)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.rebateCollected)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.paymentExpected)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.paymentActual)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-primary text-primary-foreground">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 font-medium">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(cSpend)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(cRebEarned)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(cRebCollected)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(
                          c.periods.reduce((s, p) => s + p.paymentExpected, 0)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(
                          c.periods.reduce((s, p) => s + p.paymentActual, 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}
