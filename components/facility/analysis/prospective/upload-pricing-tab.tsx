"use client"

/**
 * Upload Pricing-file tab (spec §subsystem-2).
 *
 * CSV/XLSX dropzone → per-line variance vs current COG + summary stats.
 * The file is parsed client-side (CSV) or via /api/parse-file (XLSX) to
 * extract {itemNumber, description, proposedPrice, currentPrice?, qty?}
 * rows, then fed to the pure `analyzePricingFile` engine.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
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
  type PricingFileItem,
} from "@/lib/prospective-analysis/pricing-file-analysis"
import { getCogPricingBenchmarks } from "@/lib/actions/prospective"
import { readPricingRows, pricingRowsToItems } from "./pricing-file-reader"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { formatCurrency } from "@/lib/formatting"
import type {
  PricingFileAnalysisRecord,
  VendorOption,
} from "./types"

interface UploadPricingTabProps {
  vendors: VendorOption[]
  selectedVendorId: string | null
  onVendorChange: (vendorId: string | null) => void
  onAnalysisComplete: (record: PricingFileAnalysisRecord) => void
  lastAnalysis: PricingFileAnalysisRecord | null
}

function varianceColor(variancePct: number | null): string {
  if (variancePct === null) return "text-muted-foreground"
  if (variancePct < -5) return "text-emerald-600 font-medium"
  if (variancePct < 0) return "text-emerald-500"
  if (variancePct <= 3) return "text-amber-600"
  return "text-red-600 font-medium"
}

export function UploadPricingTab({
  vendors,
  selectedVendorId,
  onVendorChange,
  onAnalysisComplete,
  lastAnalysis,
}: UploadPricingTabProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!["csv", "xls", "xlsx"].includes(ext)) {
        toast.error("Upload a CSV or Excel file.")
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
        // Charles 2026-06-10 ("Analysis pricing not working to compare
        // pricing"): the analyzer expects items "already joined with COG
        // current prices by the caller" — this is that join. COG's
        // trailing-12mo benchmark is authoritative for "current"; the
        // file's own current_price column is only a fallback for SKUs the
        // facility has never purchased. Quantities backfill the same way
        // so savings-opportunity math has a real annual qty.
        const benchmarks = await getCogPricingBenchmarks({
          itemNumbers: items.map((i) => i.itemNumber),
          vendorId: selectedVendorId,
        }).catch((err) => {
          console.error("[upload-pricing-tab] COG benchmark join failed:", err)
          toast.warning(
            "Couldn't load COG benchmarks — falling back to the file's own current-price column.",
          )
          return []
        })
        const benchmarkBySku = new Map(benchmarks.map((b) => [b.skuKey, b]))
        const joined: PricingFileItem[] = items.map((i) => {
          const b = benchmarkBySku.get(normalizeSku(i.itemNumber))
          if (!b) return i
          return {
            ...i,
            currentPrice: b.currentPrice,
            estimatedAnnualQty: i.estimatedAnnualQty ?? b.annualQty,
          }
        })
        const analysis = analyzePricingFile(joined)
        const vendorName =
          vendors.find((v) => v.id === selectedVendorId)?.displayName ??
          vendors.find((v) => v.id === selectedVendorId)?.name ??
          null
        const record: PricingFileAnalysisRecord = {
          id: `pf-${Date.now().toString(36)}`,
          fileName: file.name,
          vendorName,
          createdAt: new Date().toISOString(),
          analysis,
        }
        onAnalysisComplete(record)
        toast.success(
          `Parsed ${items.length} rows — ${analysis.summary.itemsWithCOGMatch} matched to COG`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Parse failed"
        toast.error(msg)
      } finally {
        setIsAnalyzing(false)
      }
    },
    [onAnalysisComplete, selectedVendorId, vendors],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) void handleFile(file)
    },
    [handleFile],
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload pricing file (CSV / Excel)
          </CardTitle>
          <CardDescription>
            Per-line variance vs current COG + summary savings stats. The file
            must have an item-number column (sku, item_no, vendor_item_no).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vendor (optional, labels the analysis)</Label>
              <Select
                value={selectedVendorId ?? ""}
                onValueChange={(v) => onVendorChange(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor…" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.displayName ?? v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={onBrowse}
            disabled={isAnalyzing}
            className={`w-full border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            } ${isAnalyzing ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
          >
            {isAnalyzing ? (
              <div className="space-y-3">
                <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
                <p className="text-muted-foreground text-sm">
                  Parsing + analyzing…
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="font-medium">Drop a pricing file</p>
                <p className="text-xs text-muted-foreground">
                  CSV / XLSX · includes column headers
                </p>
              </div>
            )}
          </button>
        </CardContent>
      </Card>

      {lastAnalysis ? (
        <PricingAnalysisResults record={lastAnalysis} />
      ) : null}
    </div>
  )
}

function PricingAnalysisResults({
  record,
}: {
  record: PricingFileAnalysisRecord
}) {
  const { analysis, fileName, vendorName } = record
  const s = analysis.summary

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {fileName}
            {vendorName ? (
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                · {vendorName}
              </span>
            ) : null}
          </CardTitle>
          <CardDescription>
            {s.totalItems} rows · {s.itemsWithCOGMatch} matched to COG ·
            {" "}
            {s.itemsWithoutCOGMatch} unmatched
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat
              label="Avg variance"
              value={`${s.avgVariancePercent >= 0 ? "+" : ""}${s.avgVariancePercent.toFixed(1)}%`}
              tone={s.avgVariancePercent < 0 ? "good" : "warn"}
            />
            <Stat
              label="Proposed spend"
              value={formatCurrency(s.totalProposedAnnualSpend)}
            />
            <Stat
              label="Current spend"
              value={formatCurrency(s.totalCurrentAnnualSpend)}
            />
            <Stat
              label="Potential savings"
              value={formatCurrency(s.potentialSavings)}
              tone={s.potentialSavings > 0 ? "good" : "neutral"}
            />
            <Stat
              label="Below / Above COG"
              value={`${s.itemsBelowCOG} / ${s.itemsAboveCOG}`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-line variance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[480px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Proposed</TableHead>
                  <TableHead className="text-right">Current (COG)</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Savings opp.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.lines.map((line) => (
                  <TableRow key={line.itemNumber}>
                    <TableCell className="font-mono text-xs">
                      {line.itemNumber}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate">
                      {line.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ${line.proposedPrice.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {line.currentPrice !== null
                        ? `$${line.currentPrice.toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${varianceColor(line.variancePercent)}`}
                    >
                      {line.variancePercent !== null
                        ? `${line.variancePercent >= 0 ? "+" : ""}${line.variancePercent.toFixed(1)}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {line.savingsOpportunity !== null
                        ? formatCurrency(line.savingsOpportunity)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "good" | "warn" | "neutral"
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : "text-foreground"
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}
