"use client"

import { useCallback, useRef } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Scale, Upload } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/formatting"
import {
  useImportVendorBenchmarks,
  useVendorBenchmarks,
} from "@/hooks/use-prospective"
import {
  PricingFileDropzone,
  type PricingFileDropzoneHandle,
} from "@/components/shared/uploads/pricing-file-dropzone"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import { mapBenchmarkRows, BENCHMARK_UPLOAD_SPECS } from "./benchmark-file-reader"

interface Props {
  vendorId: string
}

export function BenchmarksSection({ vendorId }: Props) {
  const { data: benchmarks, isLoading } = useVendorBenchmarks(vendorId)
  const importMutation = useImportVendorBenchmarks(vendorId)

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
      await importMutation.mutateAsync({
        items: parsed.items,
        onProgress: reportProgress,
      })
    },
    [importMutation],
  )

  // The existing confirm copy ("N rows parsed, M with a national average
  // price") now lives in the mapping dialog's confirm step.
  const confirmCopy = useCallback(
    (rows: Record<string, string>[], mapping: ResolvedMapping): string => {
      // Headers are recoverable from the mapping's claimed columns plus
      // the row keys; mapBenchmarkRows only reads mapped columns when an
      // override is passed, so row-key order is irrelevant here.
      const headers = Object.keys(rows[0] ?? {})
      const parsed = mapBenchmarkRows(headers, rows, mapping)
      return (
        `${parsed.items.length} row${parsed.items.length === 1 ? "" : "s"} parsed, ` +
        `${parsed.withNationalAvg} with a national average price.` +
        (parsed.droppedNoPrice > 0
          ? ` ${parsed.droppedNoPrice} row${parsed.droppedNoPrice === 1 ? " will be" : "s will be"} skipped (no price data).`
          : "") +
        " Re-importing an item replaces your prior uploaded benchmark for that item."
      )
    },
    [],
  )

  const busy = importMutation.isPending

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
                    <TableHead className="text-right">P25</TableHead>
                    <TableHead className="text-right">Median</TableHead>
                    <TableHead className="text-right">P75</TableHead>
                    <TableHead className="text-right">Sample</TableHead>
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
                      <TableCell className="text-right">
                        {row.percentile25 > 0
                          ? formatCurrency(row.percentile25)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.percentile50 > 0
                          ? formatCurrency(row.percentile50)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.percentile75 > 0
                          ? formatCurrency(row.percentile75)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.sampleSize > 0 ? row.sampleSize.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.source}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
              <span>{benchmarks.length} benchmark rows</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
