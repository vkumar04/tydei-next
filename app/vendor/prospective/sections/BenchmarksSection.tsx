"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { PRODUCT_CATEGORIES } from "@/components/vendor/prospective/builder/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, Loader2, Scale, Upload } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/formatting"
import { buildReportFilename } from "@/lib/reports/csv-export"
import {
  useImportVendorBenchmarks,
  useVendorBenchmarks,
} from "@/hooks/use-prospective"
import {
  PricingFileDropzone,
  type PricingFileDropzoneHandle,
} from "@/components/shared/uploads/pricing-file-dropzone"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import type { VendorBenchmarkRow } from "@/lib/actions/prospective"
import {
  mapBenchmarkRows,
  benchmarkCoverageGaps,
  buildBenchmarkTemplateCsv,
  BENCHMARK_UPLOAD_SPECS,
} from "./benchmark-file-reader"

interface Props {
  vendorId: string
}

/**
 * The distribution columns a bare "Construct | National Avg Price" file
 * can't fill. Kept as DATA (not inline JSX) so the <TableHead>/<TableCell>
 * pair, the visibility rule and the omitted-column footnote all read from
 * one list and can't drift apart. Charles 2026-07-27.
 */
interface DistributionColumn {
  key: keyof Pick<
    VendorBenchmarkRow,
    | "percentile25"
    | "percentile50"
    | "percentile75"
    | "minPrice"
    | "maxPrice"
    | "sampleSize"
  >
  label: string
  format: (value: number) => string
  cellClassName?: string
}

const DISTRIBUTION_COLUMNS: DistributionColumn[] = [
  { key: "percentile25", label: "P25", format: formatCurrency },
  { key: "percentile50", label: "Median", format: formatCurrency },
  { key: "percentile75", label: "P75", format: formatCurrency },
  { key: "minPrice", label: "Min", format: formatCurrency },
  { key: "maxPrice", label: "Max", format: formatCurrency },
  {
    key: "sampleSize",
    label: "Sample",
    format: (n) => n.toLocaleString(),
    cellClassName: "text-muted-foreground",
  },
]

/** "A", "A and B", "A, B and C" — for naming columns in prose. */
function andList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

export function BenchmarksSection({ vendorId }: Props) {
  const { data: benchmarks, isLoading } = useVendorBenchmarks(vendorId)
  const importMutation = useImportVendorBenchmarks(vendorId)
  // Charles 2026-07-04 ("This still needs to be fixed" — every imported row
  // showed Uncategorized): real benchmark files often carry no category
  // column, which strands the per-category surfaces (Benchmark Position,
  // category picker). Applied only to rows WITHOUT their own category.
  const [defaultCategory, setDefaultCategory] = useState("")

  // "Need to be able to add data for the benchmarks" (Vick 2026-06-12),
  // reworked onto the shared <PricingFileDropzone> (uploader improvements
  // 1+2, 2026-06-13): CSV/XLSX upload → parse → mapping/preview dialog
  // (column-mapper fallback when headers don't auto-resolve) →
  // vendor-scoped bulk import.
  const dropzoneRef = useRef<PricingFileDropzoneHandle>(null)

  const handleImport = useCallback(
    async (
      rows: Record<string, string>[],
      mapping: ResolvedMapping,
      meta: { fileName: string; headers: string[] },
      reportProgress: (done: number, total: number) => void,
    ) => {
      const parsed = mapBenchmarkRows(meta.headers, rows, mapping)
      if (parsed.items.length === 0) {
        // Keep this self-service: item numbers mapped but every row was
        // dropped for missing price data (the dialog already enforces
        // the item-number column itself).
        toast.error(
          "Benchmark import: no usable rows — every row is missing price data (national avg, percentile, min or max).",
        )
        return
      }
      // Feature 5: chunked import with progress. mutateAsync so the dropzone
      // dialog stays open (and shows the progress bar) until every chunk
      // lands; rethrow on failure so the dialog keeps the file mapped for a
      // retry (importInChunks' message names how many rows already landed).
      const fallback = defaultCategory.trim()
      const items = fallback
        ? parsed.items.map((it) =>
            it.category ? it : { ...it, category: fallback },
          )
        : parsed.items
      await importMutation.mutateAsync({
        items,
        onProgress: reportProgress,
      })
    },
    [importMutation, defaultCategory],
  )

  // The existing confirm copy ("N rows parsed, M with a national average
  // price") now lives in the mapping dialog's confirm step.
  //
  // Charles 2026-07-27 ("Benchmarks still do not have all of the information
  // as they should"): only `itemNumber` is `required`, so a two-column
  // Construct/National-Avg file cleared the dialog under a reassuring "all
  // columns detected" and imported with every distribution field null — which
  // he read as the app losing his data. Name the columns the file DOESN'T
  // carry, before he imports.
  const confirmCopy = useCallback(
    (rows: Record<string, string>[], mapping: ResolvedMapping): string => {
      // Headers are recoverable from the mapping's claimed columns plus
      // the row keys; mapBenchmarkRows only reads mapped columns when an
      // override is passed, so row-key order is irrelevant here.
      const headers = Object.keys(rows[0] ?? {})
      const parsed = mapBenchmarkRows(headers, rows, mapping)
      const fallback = defaultCategory.trim()
      // A category gap isn't a gap when the default category above fills it.
      // With nothing importable, EVERY field reads as a gap — that list is
      // noise on top of the "no price data" sentence, which already says
      // what's wrong, so hold it back until at least one row survives.
      const gaps =
        parsed.items.length === 0
          ? []
          : benchmarkCoverageGaps(parsed.coverage).filter(
              (g) => !(g.key === "category" && fallback !== ""),
            )
      return (
        `${parsed.items.length} row${parsed.items.length === 1 ? "" : "s"} parsed, ` +
        `${parsed.withNationalAvg} with a national average price.` +
        (parsed.droppedNoPrice > 0
          ? ` ${parsed.droppedNoPrice} row${parsed.droppedNoPrice === 1 ? " will be" : "s will be"} skipped (no price data).`
          : "") +
        (gaps.length > 0
          ? ` No values found for ${andList(gaps.map((g) => g.label))} — ${
              gaps.length === 1 ? "that column" : "those columns"
            } will be blank on every imported row. Download the template to see every column we read.`
          : "") +
        " Re-importing an item replaces your prior uploaded benchmark for that item."
      )
    },
    [defaultCategory],
  )

  const busy = importMutation.isPending

  // Derived, never mirrored into state: a distribution column is shown only
  // when at least one loaded row carries it. Six columns of "—" is what made
  // Charles read a two-column upload as lost data (2026-07-27); the footnote
  // below names what's hidden and how to supply it.
  const { visibleDistribution, omittedDistribution } = useMemo(() => {
    const rows = benchmarks ?? []
    const visible = DISTRIBUTION_COLUMNS.filter((col) =>
      rows.some((row) => row[col.key] > 0),
    )
    return {
      visibleDistribution: visible,
      omittedDistribution: DISTRIBUTION_COLUMNS.filter(
        (col) => !visible.includes(col),
      ),
    }
  }, [benchmarks])

  // Says out loud what the hidden columns are and how to get them back —
  // a table that quietly narrows is no clearer than a table of dashes.
  const omittedNote = useMemo(() => {
    if (omittedDistribution.length === 0) return null
    const one = omittedDistribution.length === 1
    return (
      `${andList(omittedDistribution.map((col) => col.label))} ` +
      `${one ? "is" : "are"} hidden — no imported benchmark row carries ` +
      `${one ? "it" : "them"}. Add ${one ? "that column" : "those columns"} ` +
      "to your benchmark file (Download template lists every column we read) " +
      `and re-import to show ${one ? "it" : "them"} here.`
    )
  }, [omittedDistribution])

  // Header-only CSV of every column the parser reads, built from
  // BENCHMARK_UPLOAD_SPECS at click time so it can't drift from the parser.
  // Blob + object URL — no file-saving dependency (conventions: no new deps).
  const downloadTemplate = useCallback(() => {
    const url = URL.createObjectURL(
      new Blob([buildBenchmarkTemplateCsv()], {
        type: "text/csv;charset=utf-8",
      }),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = buildReportFilename("Benchmark Import Template")
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [])

  const importControls = (
    <div className="flex flex-col gap-1">
      <Input
        className="h-8 w-[220px]"
        placeholder="Default category (optional)"
        value={defaultCategory}
        onChange={(e) => setDefaultCategory(e.target.value)}
        list="benchmark-default-categories"
      />
      <datalist id="benchmark-default-categories">
        {PRODUCT_CATEGORIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <span className="text-[11px] text-muted-foreground">
        Applied to imported rows without their own category
      </span>
    </div>
  )

  const templateButton = (
    <Button variant="ghost" size="sm" onClick={downloadTemplate}>
      <Download className="h-4 w-4" />
      Download template
    </Button>
  )

  const importButton = (
    <Button variant="outline" size="sm" disabled={busy}>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Upload className="h-4 w-4" />
      )}
      Import benchmarks
    </Button>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          Product Pricing Benchmarks
        </CardTitle>
        <CardDescription>
          Your uploaded pricing benchmarks. Rows come only from benchmark files
          you import here (<code>ProductBenchmark</code> rows tagged to this
          vendor) — seeded / national benchmarks are no longer mixed in.
        </CardDescription>
        <CardAction>
          <div className="flex items-start gap-3">
            {importControls}
            {templateButton}
            <PricingFileDropzone
              ref={dropzoneRef}
              specs={BENCHMARK_UPLOAD_SPECS}
              surface="vendor-benchmarks"
              accept=".csv,.xlsx,.xls"
              trigger={importButton}
              onImport={handleImport}
              confirmCopy={confirmCopy}
              disabled={busy}
            />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-md" />
            ))}
          </div>
        ) : !benchmarks || benchmarks.length === 0 ? (
          <div className="py-12 text-center">
            <Scale className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">
              No benchmark data available
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              No <code>ProductBenchmark</code> rows are linked to this vendor,
              and no national benchmarks match the item numbers in your COG
              history. Import a CSV or Excel benchmark file to get started.
            </p>
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => dropzoneRef.current?.openFilePicker()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Import benchmarks
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">National Avg</TableHead>
                    {visibleDistribution.map((col) => (
                      <TableHead key={col.key} className="text-right">
                        {col.label}
                      </TableHead>
                    ))}
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {benchmarks.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{row.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.itemNumber}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.category}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {row.nationalAvgPrice > 0
                          ? formatCurrency(row.nationalAvgPrice)
                          : "—"}
                      </TableCell>
                      {visibleDistribution.map((col) => (
                        <TableCell
                          key={col.key}
                          className={`text-right ${col.cellClassName ?? ""}`}
                        >
                          {row[col.key] > 0 ? col.format(row[col.key]) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-xs text-muted-foreground">
                        {row.source}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 space-y-1 border-t pt-4 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>{benchmarks.length} benchmark rows</span>
              </div>
              {omittedNote ? <p className="text-xs">{omittedNote}</p> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
