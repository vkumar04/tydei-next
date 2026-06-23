"use client"

import { useMemo, useState } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { formatCurrency } from "@/lib/formatting"
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/components/shared/multi-select-combobox"
import { useVendorBenchmarks } from "@/hooks/use-prospective"
import type { VendorBenchmarkRow } from "@/lib/actions/prospective"

export interface ScenarioPrice {
  name: string
  unitPrice: number | null
}

interface Props {
  vendorId: string
  scenarios: ScenarioPrice[]
}

type RangePosition = "below" | "in" | "above" | "unknown"

function comparePrice(
  price: number,
  b: VendorBenchmarkRow,
): { deltaPct: number | null; position: RangePosition } {
  const deltaPct =
    b.nationalAvgPrice > 0
      ? ((price - b.nationalAvgPrice) / b.nationalAvgPrice) * 100
      : null
  let position: RangePosition = "unknown"
  if (b.percentile25 > 0 && b.percentile75 > 0) {
    if (price < b.percentile25) position = "below"
    else if (price > b.percentile75) position = "above"
    else position = "in"
  }
  return { deltaPct, position }
}

const POSITION_LABEL: Record<RangePosition, string> = {
  below: "below range",
  in: "in range",
  above: "above range",
  unknown: "—",
}

const POSITION_TONE: Record<RangePosition, string> = {
  // Vendor is the seller: a price above the market P75 reads as "expensive
  // vs benchmark" (amber), inside the band is healthy (green), under P25 is
  // aggressive/cheap (sky).
  below: "text-sky-600 dark:text-sky-400",
  in: "text-green-600 dark:text-green-400",
  above: "text-amber-600 dark:text-amber-400",
  unknown: "text-muted-foreground",
}

/**
 * Deal Scorer → "Compare against benchmarks". A multi-select of the
 * vendor's LOADED benchmark products (Benchmarks tab) + a client-side
 * comparison of the Floor/Target/Ceiling scenario unit prices against each
 * selected benchmark's average and P25–P75 band. Pure display — it does
 * NOT feed the scoring engine (intentionally decoupled from
 * `getVendorProspectiveAnalysis`).
 */
export function DealScorerBenchmarkCompare({ vendorId, scenarios }: Props) {
  const { data: benchmarks, isLoading } = useVendorBenchmarks(vendorId)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const benchmarkById = useMemo(
    () => new Map((benchmarks ?? []).map((b) => [b.id, b])),
    [benchmarks],
  )

  const options = useMemo<MultiSelectOption[]>(
    () =>
      (benchmarks ?? []).map((b) => ({
        value: b.id,
        label: `${b.itemNumber} — ${b.productName}`,
        sublabel: `${b.category} · avg ${formatCurrency(b.nationalAvgPrice)}`,
        searchText: `${b.category} ${b.source}`,
      })),
    [benchmarks],
  )

  // Only scenarios with a real entered price are comparable.
  const pricedScenarios = scenarios.filter(
    (s): s is ScenarioPrice & { unitPrice: number } =>
      s.unitPrice != null && s.unitPrice > 0,
  )
  const selected = selectedIds
    .map((id) => benchmarkById.get(id))
    .filter((b): b is VendorBenchmarkRow => Boolean(b))

  if (!isLoading && (benchmarks?.length ?? 0) === 0) {
    return (
      <div className="space-y-2">
        <Label>Compare against benchmarks</Label>
        <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          No benchmarks loaded yet. Upload your benchmark pricing in the{" "}
          <span className="font-medium">Benchmarks</span> tab to compare these
          scenarios against market data.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Compare against benchmarks</Label>
        <p className="text-xs text-muted-foreground">
          Pick one or more uploaded benchmark products to measure your Floor /
          Target / Ceiling unit prices against the market.{" "}
          <span className="font-medium">Informational only</span> — this
          comparison does not change the deal score (the score uses your margin
          targets and facility parameters).
        </p>
        <MultiSelectCombobox
          options={options}
          selected={selectedIds}
          onChange={setSelectedIds}
          placeholder={isLoading ? "Loading benchmarks…" : "Select benchmarks…"}
          searchPlaceholder="Search item # or product…"
          emptyText="No benchmark matches."
        />
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((b) => (
            <Badge key={b.id} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-[200px] truncate">
                {b.itemNumber} — {b.productName}
              </span>
              <button
                type="button"
                aria-label={`Remove ${b.itemNumber}`}
                className="rounded-sm opacity-70 hover:opacity-100"
                onClick={() =>
                  setSelectedIds((prev) => prev.filter((id) => id !== b.id))
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-medium">Benchmark</th>
                <th className="p-2 text-right font-medium">Avg</th>
                <th className="p-2 text-right font-medium">P25–P75</th>
                {pricedScenarios.map((s) => (
                  <th key={s.name} className="p-2 text-right font-medium">
                    {s.name}
                    <div className="text-xs font-normal text-muted-foreground">
                      {formatCurrency(s.unitPrice)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.map((b) => (
                <tr key={b.id} className="border-t align-top">
                  <td className="p-2">
                    <div className="font-medium">{b.itemNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.productName}
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    {formatCurrency(b.nationalAvgPrice)}
                  </td>
                  <td className="p-2 text-right text-xs text-muted-foreground">
                    {b.percentile25 > 0 || b.percentile75 > 0
                      ? `${formatCurrency(b.percentile25)} – ${formatCurrency(b.percentile75)}`
                      : "—"}
                  </td>
                  {pricedScenarios.map((s) => {
                    const { deltaPct, position } = comparePrice(s.unitPrice, b)
                    return (
                      <td key={s.name} className="p-2 text-right">
                        <div className={`font-medium ${POSITION_TONE[position]}`}>
                          {deltaPct == null
                            ? "—"
                            : `${deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(deltaPct).toFixed(1)}%`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {POSITION_LABEL[position]}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected.length > 0 && pricedScenarios.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Enter a unit price in the scenarios above to see how it compares.
        </p>
      )}
    </div>
  )
}
