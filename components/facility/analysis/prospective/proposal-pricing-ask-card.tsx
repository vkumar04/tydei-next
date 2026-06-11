"use client"

/**
 * Price-file panel of the proposal analyzer (Charles 2026-06-10: "it should
 * want the price file as well"). CONTROLLED — the parent (upload-proposal-
 * tab) owns parsing + the COG join so the verdict synthesizer can read the
 * same analysis. This component only renders the dropzone / results.
 */

import { useCallback } from "react"
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
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"
import { formatCurrency } from "@/lib/formatting"

export function ProposalPricingAskCard({
  analysis,
  fileName,
  isAnalyzing,
  onFile,
}: {
  analysis: PricingFileAnalysis | null
  fileName: string | null
  isAnalyzing: boolean
  onFile: (file: File) => void
}) {
  const onBrowse = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".csv,.xlsx,.xls"
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) onFile(file)
    }
    input.click()
  }, [onFile])

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
          Pricing vs your current cost
        </CardTitle>
        <CardDescription>
          {analysis
            ? `${fileName} — every line compared against your COG history.`
            : "The PDF alone can't tell you what the pricing would do — drop the proposal's price file to compare every line against your current cost."}
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
              if (file) onFile(file)
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
                  {formatCurrency(analysis.summary.potentialSavings)}
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
                        {formatCurrency(l.proposedPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.currentPrice !== null
                          ? formatCurrency(l.currentPrice)
                          : "—"}
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
            <button
              type="button"
              onClick={onBrowse}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Replace price file
            </button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
