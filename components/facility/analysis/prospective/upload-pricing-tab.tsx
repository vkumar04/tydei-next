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

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function findIndex(normHeaders: string[], ...aliases: string[]): number {
  return aliases
    .map(norm)
    .reduce<number>(
      (found, alias) => (found >= 0 ? found : normHeaders.indexOf(alias)),
      -1,
    )
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        fields.push(current.trim())
        current = ""
      } else {
        current += ch
      }
    }
  }
  fields.push(current.trim())
  return fields
}

async function readRows(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "csv") {
    let text = await file.text()
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l) => l.trim())
    const headers = parseCsvRow(lines[0] ?? "").map((h) =>
      h.replace(/^"|"$/g, ""),
    )
    const rows = lines.slice(1).map((line) => {
      const vals = parseCsvRow(line)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => {
        row[h] = vals[i] ?? ""
      })
      return row
    })
    return { headers, rows }
  }
  // Excel — delegate to server
  const formData = new FormData()
  formData.append("file", file)
  const res = await fetch("/api/parse-file", {
    method: "POST",
    body: formData,
  })
  if (!res.ok) throw new Error("Failed to parse Excel file")
  return (await res.json()) as {
    headers: string[]
    rows: Record<string, string>[]
  }
}

function rowsToItems(
  headers: string[],
  rows: Record<string, string>[],
): PricingFileItem[] {
  const normHeaders = headers.map(norm)
  const idxItem = findIndex(
    normHeaders,
    "item_no",
    "itemno",
    "vendor_item_no",
    "vendoritemno",
    "sku",
    "item_number",
    "itemnumber",
  )
  const idxDesc = findIndex(
    normHeaders,
    "description",
    "desc",
    "item_description",
    "product_name",
  )
  const idxProposed = findIndex(
    normHeaders,
    "proposed_price",
    "proposedprice",
    "price",
    "unit_price",
    "new_price",
  )
  const idxCurrent = findIndex(
    normHeaders,
    "current_price",
    "currentprice",
    "unit_cost",
    "cost",
  )
  const idxQty = findIndex(
    normHeaders,
    "quantity",
    "qty",
    "quantity_ordered",
    "estimated_qty",
    "annual_qty",
  )

  const parseNum = (v: string): number =>
    parseFloat(v.replace(/[^0-9.-]/g, "") || "0")

  return rows
    .map((row): PricingFileItem | null => {
      const get = (idx: number) => (idx >= 0 ? (row[headers[idx]!] ?? "") : "")
      const itemNumber = get(idxItem)
      if (!itemNumber) return null
      const description = get(idxDesc)
      const proposedPrice = parseNum(get(idxProposed))
      const currentRaw = get(idxCurrent)
      const qtyRaw = get(idxQty)
      return {
        itemNumber,
        description,
        proposedPrice,
        currentPrice: currentRaw ? parseNum(currentRaw) || null : null,
        estimatedAnnualQty: qtyRaw ? parseNum(qtyRaw) || null : null,
      }
    })
    .filter((x): x is PricingFileItem => x !== null)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
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
        const { headers, rows } = await readRows(file)
        const items = rowsToItems(headers, rows)
        if (items.length === 0) {
          toast.error(
            "No items found. Check that the file has an item-number column.",
          )
          return
        }
        const analysis = analyzePricingFile(items)
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
