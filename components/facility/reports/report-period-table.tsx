"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/formatting"
import { computeRunningCapitalBalances } from "@/lib/reports/running-capital-balance"
import type { ContractPeriodRow } from "./report-columns"

interface ReportPeriodTableProps {
  periods: ContractPeriodRow[]
  reportType: string
  /**
   * Canonical Rebate-table totals passed by the parent when available
   * (Charles 2026-04-23 audit). When present these OVERRIDE the
   * periods-reduce totals on the footer row so the report reconciles
   * with the Contract Detail header and the Dashboard. Older callers
   * that don't pass them fall back to the original reduce.
   */
  canonicalTotals?: {
    rebateEarned: number
    rebateCollected: number
  }
  /**
   * Current remaining capital balance for tie-in/capital contracts (the same
   * figure the header band shows). When provided, the tie-in "Balance" column
   * shows the running remaining balance per period — anchored so the most
   * recent period equals this value — instead of the always-$0 paymentExpected
   * (Vick 2026-06-22 "balance not coming over").
   */
  capitalRemainingBalance?: number | null
}

export function ReportPeriodTable({
  periods,
  reportType,
  canonicalTotals,
  capitalRemainingBalance,
}: ReportPeriodTableProps) {
  const isUsage = reportType === "usage"
  const isService = reportType === "service" || reportType === "capital"
  const isTieIn = reportType === "tie_in"

  // Running remaining capital balance per period (tie-in). Each period's
  // capital paydown ≈ paymentActual + rebateEarned (rebate is applied to
  // capital on a tie-in). Anchor the most-recent period's ENDING balance to
  // the contract's current remaining balance, then add each later period's
  // paydown back as we walk to older periods — so the column reconciles with
  // the header's Capital Balance regardless of the report window.
  const endingBalanceByIndex = useMemo<number[] | null>(
    () =>
      capitalRemainingBalance == null
        ? null
        : computeRunningCapitalBalances(periods, capitalRemainingBalance),
    [periods, capitalRemainingBalance],
  )

  const totalSpend = periods.reduce((s, p) => s + p.totalSpend, 0)
  const totalVolume = periods.reduce((s, p) => s + p.totalVolume, 0)
  const periodRebateEarned = periods.reduce((s, p) => s + p.rebateEarned, 0)
  const periodRebateCollected = periods.reduce((s, p) => s + p.rebateCollected, 0)
  // Prefer the canonical Rebate-table total, but fall back to the displayed
  // ContractPeriod rollup when it is absent OR zero — otherwise a contract
  // whose earned/collected lives only in ContractPeriod rollups (no Rebate
  // rows yet) showed a $0 footer total under non-zero period rows (Vick
  // 2026-06-22). CLAUDE.md: earned/collected come from Rebate rows OR
  // ContractPeriod rollups — `||` honors both; `??` wrongly trusted a 0.
  const totalRebateEarned = canonicalTotals?.rebateEarned || periodRebateEarned
  const totalRebateCollected =
    canonicalTotals?.rebateCollected || periodRebateCollected
  const totalPaymentExpected = periods.reduce((s, p) => s + p.paymentExpected, 0)
  const totalPaymentActual = periods.reduce((s, p) => s + p.paymentActual, 0)

  return (
    <div className="rounded-lg border overflow-hidden mb-6">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">#</th>
            <th className="px-4 py-3 text-left font-medium">Period</th>
            {isUsage && (
              <>
                <th className="px-4 py-3 text-right font-medium">Spend</th>
                <th className="px-4 py-3 text-right font-medium">Volume</th>
                <th className="px-4 py-3 text-right font-medium">Rebate (Earned)</th>
                <th className="px-4 py-3 text-right font-medium">Rebate (Collected)</th>
              </>
            )}
            {isService && (
              <>
                <th className="px-4 py-3 text-right font-medium">Payment (Expected)</th>
                <th className="px-4 py-3 text-right font-medium">Balance (Expected)</th>
                <th className="px-4 py-3 text-right font-medium">Payments (Actual)</th>
                <th className="px-4 py-3 text-right font-medium">Balance (Actual)</th>
              </>
            )}
            {isTieIn && (
              <>
                <th className="px-3 py-3 text-right font-medium">Spend Target</th>
                <th className="px-3 py-3 text-right font-medium">Spend Actual</th>
                <th className="px-3 py-3 text-right font-medium">Vol. Target</th>
                <th className="px-3 py-3 text-right font-medium">Vol. Actual</th>
                <th className="px-3 py-3 text-right font-medium">Rebate Earned</th>
                <th className="px-3 py-3 text-right font-medium">Rebate Collected</th>
                <th className="px-3 py-3 text-right font-medium">Payment Actual</th>
                <th className="px-3 py-3 text-right font-medium">Balance</th>
              </>
            )}
            {reportType === "grouped" && (
              <>
                <th className="px-4 py-3 text-right font-medium">Spend</th>
                <th className="px-4 py-3 text-right font-medium">Rebate Earned</th>
                <th className="px-4 py-3 text-right font-medium">Rebate Collected</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {periods.map((row, index) => (
            <tr key={row.id} className="border-t">
              <td className="px-4 py-3">{index + 1}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {row.periodStart.split("T")[0]} &ndash; {row.periodEnd.split("T")[0]}
              </td>
              {isUsage && (
                <>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.totalSpend)}</td>
                  <td className="px-4 py-3 text-right">{row.totalVolume}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                </>
              )}
              {isService && (
                <>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.paymentExpected)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.paymentActual)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                </>
              )}
              {isTieIn && (
                <>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.totalSpend)}</td>
                  {/* Spend Actual = realized spend (totalSpend); tie-in spend periods
                      carry no paymentActual, so reading it here always showed $0
                      while the footer (line ~153) correctly used totalSpend. */}
                  <td className="px-3 py-3 text-right">{formatCurrency(row.totalSpend)}</td>
                  <td className="px-3 py-3 text-right">{row.totalVolume}</td>
                  <td className="px-3 py-3 text-right">{row.totalVolume}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.paymentActual)}</td>
                  <td className="px-3 py-3 text-right">
                    {endingBalanceByIndex
                      ? formatCurrency(endingBalanceByIndex[index])
                      : formatCurrency(row.paymentExpected)}
                  </td>
                </>
              )}
              {reportType === "grouped" && (
                <>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.totalSpend)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-primary text-primary-foreground">
          <tr>
            <td colSpan={2} className="px-4 py-3 font-medium">Total (to date)</td>
            {isUsage && (
              <>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td className="px-4 py-3 text-right font-medium">-</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
              </>
            )}
            {isService && (
              <>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalPaymentExpected)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalPaymentActual)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
              </>
            )}
            {isTieIn && (
              <>
                {/* Columns: Spend Target | Spend Actual | Vol Target | Vol
                    Actual | Rebate Earned | Rebate Collected | Payment Actual
                    | Balance — each total aligned to its column (was
                    misaligned: spend total fell under Vol Actual). */}
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td className="px-3 py-3 text-right font-medium">-</td>
                <td className="px-3 py-3 text-right font-medium">{totalVolume.toLocaleString()}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalPaymentActual)}</td>
                <td className="px-3 py-3 text-right font-medium">
                  {capitalRemainingBalance != null
                    ? formatCurrency(capitalRemainingBalance)
                    : ""}
                </td>
              </>
            )}
            {reportType === "grouped" && (
              <>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
