"use client"

/**
 * Post-score price-file ask (Charles 2026-06-10: "When entering a PDF hard
 * to know what the pricing would be. It should want the price file as
 * well"). Rendered after a proposal PDF is scored — prompts for the
 * proposal's pricing file and runs the same COG-joined per-line variance
 * the Pricing tab uses, inline.
 */

import { useCallback, useState } from "react"
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
import { FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import {
  analyzePricingFile,
  type PricingFileAnalysis,
  type PricingFileItem,
} from "@/lib/prospective-analysis/pricing-file-analysis"
import { getCogPricingBenchmarks } from "@/lib/actions/prospective"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { readPricingRows, pricingRowsToItems } from "./pricing-file-reader"

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

export function ProposalPricingAskCard({
  vendorId,
}: {
  /** Resolved vendor for the COG benchmark join (null = facility-wide). */
  vendorId: string | null
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<PricingFileAnalysis | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!["csv", "xls", "xlsx"].includes(ext)) {
        toast.error("Upload a CSV or Excel pricing file.")
        return
      }
      setIsAnalyzing(true)
      try {
        const { headers, rows } = await readPricingRows(file)
        const items = pricingRowsToItems(headers, rows)
        if (items.length === 0) {
          toast.error(
            "No items found. Check that the file has an item-number column.",
          )
          return
        }
        const benchmarks = await getCogPricingBenchmarks({
          itemNumbers: items.map((i) => i.itemNumber),
          vendorId,
        }).catch((err) => {
          // Review R5: a failed join must be distinguishable from
          // genuinely-unmatched SKUs (sibling Pricing tab warns the same way).
          console.error("[proposal-pricing-ask] COG benchmark join failed:", err)
          toast.warning(
            "Couldn't load COG benchmarks — variance will only use the file's own current-price column.",
          )
          return []
        })
        const bySku = new Map(benchmarks.map((b) => [b.skuKey, b]))
        const joined: PricingFileItem[] = items.map((i) => {
          const b = bySku.get(normalizeSku(i.itemNumber))
          if (!b) return i
          return {
            ...i,
            currentPrice: b.currentPrice,
            estimatedAnnualQty: i.estimatedAnnualQty ?? b.annualQty,
          }
        })
        const result = analyzePricingFile(joined)
        setAnalysis(result)
        setFileName(file.name)
        toast.success(
          `Price file analyzed — ${result.summary.itemsWithCOGMatch} of ${result.summary.totalItems} lines matched to COG`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Parse failed")
      } finally {
        setIsAnalyzing(false)
      }
    },
    [vendorId],
  )

  const onBrowse = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".csv,.xlsx,.xls"
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) void handleFile(file)
    }
    input.click()
  }, [handleFile])

  const topLines = analysis
    ? [...analysis.lines]
        .filter((l) => l.variancePercent !== null)
        .sort(
          (a, b) =>
            Math.abs(b.variancePercent ?? 0) - Math.abs(a.variancePercent ?? 0),
        )
        .slice(0, 5)
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="h-4 w-4" />
          Add the proposal&rsquo;s price file
        </CardTitle>
        <CardDescription>
          The PDF alone can&rsquo;t tell you what the pricing would do — drop
          the proposal&rsquo;s price file to compare every line against your
          current COG cost.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!analysis ? (
          <button
            type="button"
            onClick={onBrowse}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) void handleFile(file)
            }}
            disabled={isAnalyzing}
            className="w-full rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 text-center transition-colors hover:border-primary/50 disabled:cursor-wait disabled:opacity-60"
          >
            {isAnalyzing ? (
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            ) : (
              <div className="space-y-1">
                <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium">Drop the price file</p>
                <p className="text-xs text-muted-foreground">
                  CSV / XLSX · includes column headers
                </p>
              </div>
            )}
          </button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Avg variance</p>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    analysis.summary.avgVariancePercent < 0
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {analysis.summary.avgVariancePercent.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Potential savings</p>
                <p className="text-lg font-bold tabular-nums text-emerald-600">
                  {fmt(analysis.summary.potentialSavings)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Matched to COG</p>
                <p className="text-lg font-bold tabular-nums">
                  {analysis.summary.itemsWithCOGMatch} /{" "}
                  {analysis.summary.totalItems}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Below / above COG</p>
                <p className="text-lg font-bold tabular-nums">
                  {analysis.summary.itemsBelowCOG} /{" "}
                  {analysis.summary.itemsAboveCOG}
                </p>
              </div>
            </div>
            {topLines.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item #</TableHead>
                    <TableHead className="text-right">Proposed</TableHead>
                    <TableHead className="text-right">Current (COG)</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topLines.map((l) => (
                    <TableRow key={l.itemNumber}>
                      <TableCell className="font-mono text-xs">
                        {l.itemNumber}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(l.proposedPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.currentPrice !== null ? fmt(l.currentPrice) : "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          (l.variancePercent ?? 0) < 0
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {l.variancePercent !== null
                          ? `${l.variancePercent.toFixed(1)}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {fileName} — full per-line table on the Pricing tab.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
