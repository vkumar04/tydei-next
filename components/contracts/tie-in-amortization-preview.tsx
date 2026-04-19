"use client"

/**
 * Wave D — inline amortization preview for the contract-terms entry form.
 *
 * Renders directly inside the Tie-In Capital Schedule block between the
 * Wave B cadence/min-purchase row and the Wave C shortfall-handling
 * select. Two modes:
 *
 *   - symmetrical: live-computes the PMT schedule via
 *     `buildScheduleForTerm` (pure engine, no I/O) and shows a read-only
 *     table. This is the schedule Charles flagged as "not showing" —
 *     the engine always existed but no UI surfaced it during entry.
 *
 *   - custom: hides the read-only view and renders an editable table,
 *     one row per scheduled period, with a currency input for
 *     amortizationDue. The closing balance updates reactively as the
 *     user edits so mismatches surface immediately. A mismatch banner
 *     nags when the sum of amortizationDue deviates from the
 *     symmetrical target (capitalCost - downPayment + totalInterest).
 *
 * The component is purely presentational — it receives the term values
 * and bubbles edits through `onCustomRowsChange`. Persistence runs on
 * save via `updateContractTerm` / `createContractTerm` (Wave D write
 * path). A collapsible wrapper keeps the panel out of the way when
 * terms don't need capital scheduling.
 */

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/formatting"
import { buildScheduleForTerm } from "@/lib/contracts/tie-in-schedule"

interface CustomRow {
  periodNumber: number
  amortizationDue: number
}

interface TieInAmortizationPreviewProps {
  capitalCost: number | null | undefined
  downPayment: number | null | undefined
  interestRate: number | null | undefined
  termMonths: number | null | undefined
  paymentCadence: "monthly" | "quarterly" | "annual" | undefined
  /** ISO yyyy-mm-dd from the term's effectiveStart — used to date rows. */
  effectiveStart: string
  amortizationShape: "symmetrical" | "custom"
  /** Present when shape === "custom"; indexed by periodNumber. */
  customRows?: CustomRow[]
  onCustomRowsChange: (rows: CustomRow[]) => void
}

function monthsPerPeriod(
  p: "monthly" | "quarterly" | "annual",
): number {
  switch (p) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "annual":
      return 12
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function formatPeriodDate(iso: string): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

export function TieInAmortizationPreview({
  capitalCost,
  downPayment,
  interestRate,
  termMonths,
  paymentCadence,
  effectiveStart,
  amortizationShape,
  customRows,
  onCustomRowsChange,
}: TieInAmortizationPreviewProps) {
  const [open, setOpen] = useState(true)
  const cadence = paymentCadence ?? "monthly"

  // Build a live symmetrical schedule — used both as the read-only
  // preview and as the seed for custom-mode rows when the user flips.
  const symmetricalSchedule = useMemo(() => {
    const entries = buildScheduleForTerm({
      capitalCost,
      downPayment,
      interestRate,
      termMonths,
      paymentCadence: cadence,
    })
    if (entries.length === 0) return []
    const start = effectiveStart ? new Date(effectiveStart) : new Date()
    const step = monthsPerPeriod(cadence)
    return entries.map((e) => ({
      ...e,
      periodDate: addMonths(start, e.periodNumber * step).toISOString(),
    }))
  }, [
    capitalCost,
    downPayment,
    interestRate,
    termMonths,
    cadence,
    effectiveStart,
  ])

  const isIncomplete =
    capitalCost == null ||
    interestRate == null ||
    termMonths == null ||
    Number(capitalCost) <= 0 ||
    Number(termMonths) <= 0

  // Derive the custom-mode table rows:
  //   - if user has edits in customRows use those amounts
  //   - otherwise seed from symmetricalSchedule so the table is never
  //     empty the moment the user flips modes
  const customDisplayRows = useMemo(() => {
    if (symmetricalSchedule.length === 0) return []
    const start = effectiveStart ? new Date(effectiveStart) : new Date()
    const step = monthsPerPeriod(cadence)
    const interestPerPeriod =
      Number(interestRate ?? 0) /
      (cadence === "annual" ? 1 : cadence === "quarterly" ? 4 : 12)

    let opening = Math.max(
      0,
      Number(capitalCost ?? 0) - Number(downPayment ?? 0),
    )
    return symmetricalSchedule.map((sym, idx) => {
      const periodNumber = sym.periodNumber
      const override = customRows?.find(
        (r) => r.periodNumber === periodNumber,
      )
      const amortizationDue =
        override?.amortizationDue != null
          ? override.amortizationDue
          : sym.amortizationDue
      const interestCharge = opening * interestPerPeriod
      const principalDue = amortizationDue - interestCharge
      const closingBalance = opening - principalDue
      const row = {
        periodNumber,
        periodDate: addMonths(
          start,
          periodNumber * step,
        ).toISOString(),
        openingBalance: opening,
        interestCharge,
        principalDue,
        amortizationDue,
        closingBalance,
        index: idx,
      }
      opening = closingBalance
      return row
    })
  }, [
    symmetricalSchedule,
    customRows,
    capitalCost,
    downPayment,
    interestRate,
    cadence,
    effectiveStart,
  ])

  // Target sum: engine-PMT total across all periods, which already
  // equals (capitalCost − downPayment) + total interest charges.
  const targetTotal = useMemo(
    () => symmetricalSchedule.reduce((a, r) => a + r.amortizationDue, 0),
    [symmetricalSchedule],
  )
  const customTotal = useMemo(
    () => customDisplayRows.reduce((a, r) => a + r.amortizationDue, 0),
    [customDisplayRows],
  )
  const mismatch =
    amortizationShape === "custom" &&
    symmetricalSchedule.length > 0 &&
    Math.abs(customTotal - targetTotal) > 0.5

  function updateCustomRow(periodNumber: number, amount: number) {
    const next: CustomRow[] = customDisplayRows.map((r) => ({
      periodNumber: r.periodNumber,
      amortizationDue:
        r.periodNumber === periodNumber ? amount : r.amortizationDue,
    }))
    onCustomRowsChange(next)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border bg-muted/20">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between px-3 py-2 text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Amortization Schedule (preview)
            </span>
            <span className="text-xs text-muted-foreground">
              {amortizationShape === "custom" ? "Custom" : "Symmetrical"} ·{" "}
              {symmetricalSchedule.length} period(s)
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 px-3 pb-3">
          {isIncomplete ? (
            <p className="text-xs text-muted-foreground">
              Fill capital cost, interest rate, and term months to preview.
            </p>
          ) : amortizationShape === "symmetrical" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-2 text-left font-medium">#</th>
                    <th className="py-1.5 pr-2 text-left font-medium">
                      Period Date
                    </th>
                    <th className="py-1.5 pr-2 text-right font-medium">
                      Opening
                    </th>
                    <th className="py-1.5 pr-2 text-right font-medium">
                      Interest
                    </th>
                    <th className="py-1.5 pr-2 text-right font-medium">
                      Principal
                    </th>
                    <th className="py-1.5 pr-2 text-right font-medium">
                      Amort. Due
                    </th>
                    <th className="py-1.5 text-right font-medium">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {symmetricalSchedule.map((row) => (
                    <tr key={row.periodNumber} className="border-b last:border-0">
                      <td className="py-1.5 pr-2 font-medium">
                        {row.periodNumber}
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">
                        {formatPeriodDate(row.periodDate)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatCurrency(row.openingBalance)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatCurrency(row.interestCharge)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatCurrency(row.principalDue)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatCurrency(row.amortizationDue)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCurrency(row.closingBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              {mismatch && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Sum of custom amortization due ({formatCurrency(customTotal)})
                  differs from the engine target ({formatCurrency(targetTotal)}) by{" "}
                  {formatCurrency(Math.abs(customTotal - targetTotal))}.
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1.5 pr-2 text-left font-medium">#</th>
                      <th className="py-1.5 pr-2 text-left font-medium">
                        Period Date
                      </th>
                      <th className="py-1.5 pr-2 text-right font-medium">
                        Amort. Due (editable)
                      </th>
                      <th className="py-1.5 text-right font-medium">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customDisplayRows.map((row) => (
                      <tr
                        key={row.periodNumber}
                        className="border-b last:border-0"
                      >
                        <td className="py-1.5 pr-2 font-medium">
                          {row.periodNumber}
                        </td>
                        <td className="py-1.5 pr-2 text-muted-foreground">
                          {formatPeriodDate(row.periodDate)}
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="ml-auto h-7 w-32 text-right tabular-nums"
                            value={row.amortizationDue}
                            onChange={(e) =>
                              updateCustomRow(
                                row.periodNumber,
                                e.target.value === ""
                                  ? 0
                                  : Number(e.target.value),
                              )
                            }
                          />
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatCurrency(row.closingBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
