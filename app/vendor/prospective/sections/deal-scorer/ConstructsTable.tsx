"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"

import { formatCurrency } from "@/lib/formatting"
import type { VendorBenchmarkRow } from "@/lib/actions/prospective"
import type { ConstructForm } from "./construct-form"

interface ConstructsTableProps {
  constructs: ConstructForm[]
  benchmarks: VendorBenchmarkRow[] | undefined
  benchmarkById: Map<string, VendorBenchmarkRow>
  /** Known categories (uploaded benchmarks + attached proposal) for the
   *  per-construct category inputs — free text still allowed. */
  benchmarkCategories: string[]
  constructBlankReasons: string[]
  benchPick: string
  /** Parent seeds a construct from the picked benchmark and resets the pick. */
  onPickBenchmark: (benchmarkId: string) => void
  onAddConstruct: () => void
  onUpdateConstruct: (uid: string, patch: Partial<ConstructForm>) => void
  onRemoveConstruct: (uid: string) => void
}

export function ConstructsTable({
  constructs,
  benchmarks,
  benchmarkById,
  benchmarkCategories,
  constructBlankReasons,
  benchPick,
  onPickBenchmark,
  onAddConstruct,
  onUpdateConstruct,
  onRemoveConstruct,
}: ConstructsTableProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Label>Constructs</Label>
          <p className="text-xs text-muted-foreground">
            Pick products from your benchmark list — the benchmark file
            fills Current, Floor, Target and Volume where it carries those
            columns, with the price and usage files as fallbacks. You
            enter Ask. The score blends every construct.
          </p>
          {/* Charles 2026-07-28 → 2026-07-29: "these should fill in from
              the loaded benchmark file". The first pass answered it with
              an explanation, on the belief his file was two columns
              (Construct | National Avg Price). The real workbook is nine,
              and Current Pricing / TRL 12 Units were parsed and dropped
              for want of a field to land in — so Current and Volume now
              import and seed here. What's left genuinely can't be filled:
              name it rather than leaving blank cells to read as a bug. */}
          {constructBlankReasons.length > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Some columns stayed blank: {constructBlankReasons.join("; ")}.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(benchmarks?.length ?? 0) > 0 && (
            <Select value={benchPick} onValueChange={onPickBenchmark}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Add from benchmark…" />
              </SelectTrigger>
              <SelectContent>
                {(benchmarks ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.itemNumber} — {b.productName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onAddConstruct}>
            <Plus className="mr-1 h-4 w-4" /> Add custom
          </Button>
        </div>
      </div>

      {/* Known categories (uploaded benchmarks + attached proposal) for
          the per-construct category inputs — free text still allowed. */}
      <datalist id="deal-construct-categories">
        {benchmarkCategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Product</th>
              <th className="w-[92px] px-2 py-2 text-right font-medium">Current</th>
              <th className="w-[92px] px-2 py-2 text-right font-medium">Floor</th>
              <th className="w-[92px] px-2 py-2 text-right font-medium">Target</th>
              <th className="w-[92px] px-2 py-2 text-right font-medium">Ask</th>
              <th className="w-[92px] px-2 py-2 text-right font-medium">Volume</th>
              <th className="w-[88px] px-2 py-2 text-right font-medium">Rebate %</th>
              <th className="w-[120px] px-2 py-2 text-right font-medium">Benchmark</th>
              <th className="w-10 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {constructs.map((c, idx) => {
              const b = c.benchmarkId
                ? benchmarkById.get(c.benchmarkId)
                : null
              const isLast = idx === constructs.length - 1
              const numCell = (
                field: keyof ConstructForm,
                mode: "decimal" | "numeric" = "decimal",
              ) => (
                <td className="px-2 py-1.5">
                  <Input
                    className="h-8 w-full text-right"
                    type="number"
                    inputMode={mode}
                    value={c[field] as string}
                    onChange={(e) =>
                      onUpdateConstruct(c._uid, { [field]: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && isLast) onAddConstruct()
                    }}
                  />
                </td>
              )
              return (
                <tr key={c._uid} className="border-t align-top">
                  <td className="min-w-[180px] px-2 py-1.5">
                    {b ? (
                      <div className="min-w-0 space-y-1">
                        <div className="truncate font-medium">
                          {c.productName}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">
                            benchmark ·
                          </span>
                          <Input
                            className="h-6 flex-1 text-xs"
                            list="deal-construct-categories"
                            placeholder="category"
                            value={c.category}
                            onChange={(e) =>
                              onUpdateConstruct(c._uid, {
                                category: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 space-y-1">
                        <Input
                          className="h-8"
                          placeholder="Product name"
                          value={c.productName}
                          onChange={(e) =>
                            onUpdateConstruct(c._uid, {
                              productName: e.target.value,
                            })
                          }
                        />
                        <Input
                          className="h-6 text-xs"
                          list="deal-construct-categories"
                          placeholder="Category"
                          value={c.category}
                          onChange={(e) =>
                            onUpdateConstruct(c._uid, {
                              category: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                  </td>
                  {numCell("current")}
                  {numCell("floor")}
                  {numCell("target")}
                  {numCell("ask")}
                  {numCell("annualVolume", "numeric")}
                  {numCell("rebatePercent")}
                  <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs">
                    {b ? (
                      (() => {
                        // Range falls back P25–P75 → Min–Max; hidden when
                        // the upload carried no range data at all (was a
                        // hardcoded "$0–$0", bugs.rtfd 2026-07-07
                        // "Bottom not coming over").
                        const lo =
                          b.percentile25 > 0 ? b.percentile25 : b.minPrice
                        const hi =
                          b.percentile75 > 0 ? b.percentile75 : b.maxPrice
                        return (
                          <>
                            <div>
                              avg {formatCurrency(b.nationalAvgPrice)}
                            </div>
                            {lo > 0 || hi > 0 ? (
                              <div className="text-muted-foreground">
                                {lo > 0 ? formatCurrency(lo) : "—"}–
                                {hi > 0 ? formatCurrency(hi) : "—"}
                              </div>
                            ) : null}
                          </>
                        )
                      })()
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-red-600"
                      onClick={() => onRemoveConstruct(c._uid)}
                      disabled={constructs.length <= 1}
                      aria-label="Remove construct"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
