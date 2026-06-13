"use client"

import { useRef, useState } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { readPricingRows } from "@/components/facility/analysis/prospective/pricing-file-reader"
import {
  mapBenchmarkRows,
  type ParsedBenchmarkRows,
} from "./benchmark-file-reader"

interface Props {
  vendorId: string
}

export function BenchmarksSection({ vendorId }: Props) {
  const { data: benchmarks, isLoading } = useVendorBenchmarks(vendorId)
  const importMutation = useImportVendorBenchmarks(vendorId)

  // "Need to be able to add data for the benchmarks" (Vick 2026-06-12):
  // CSV/XLSX upload → parse client-side (XLSX via /api/parse-file) →
  // confirm row counts → vendor-scoped bulk import.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [pending, setPending] = useState<ParsedBenchmarkRows | null>(null)

  const onFileSelected = async (file: File) => {
    setParsing(true)
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!["csv", "xlsx", "xls"].includes(ext)) {
        toast.error("Benchmark import: please upload a CSV or Excel (.xlsx/.xls) file")
        return
      }
      const { headers, rows } = await readPricingRows(file)
      const parsed = mapBenchmarkRows(headers, rows)
      if (parsed.items.length === 0) {
        toast.error(
          "Benchmark import: no usable rows found — the file needs an item-number column plus at least one price column (national avg, percentile, min or max).",
        )
        return
      }
      setPending(parsed)
    } catch (err) {
      toast.error(
        `Benchmark import: failed to parse the file — ${err instanceof Error ? err.message : "unknown error"}`,
      )
    } finally {
      setParsing(false)
    }
  }

  const confirmImport = () => {
    if (!pending) return
    importMutation.mutate(pending.items)
    setPending(null)
  }

  const busy = parsing || importMutation.isPending

  const importButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => fileInputRef.current?.click()}
    >
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
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset so re-selecting the same file fires onChange again.
          e.target.value = ""
          if (file) void onFileSelected(file)
        }}
      />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          Product Pricing Benchmarks
        </CardTitle>
        <CardDescription>
          National and category benchmarks for this vendor&rsquo;s catalog. Rows
          are pulled from <code>ProductBenchmark</code> entries tagged to this
          vendor, plus national-benchmark rows that match item numbers seen in
          your COG history.
        </CardDescription>
        <CardAction>{importButton}</CardAction>
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
            <div className="mt-4 flex justify-center">{importButton}</div>
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

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import benchmark data?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? `${pending.items.length} row${pending.items.length === 1 ? "" : "s"} parsed, ` +
                  `${pending.withNationalAvg} with a national average price.` +
                  (pending.droppedNoPrice > 0
                    ? ` ${pending.droppedNoPrice} row${pending.droppedNoPrice === 1 ? " was" : "s were"} skipped (no price data).`
                    : "") +
                  " Re-importing an item replaces your prior uploaded benchmark for that item."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>Import</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
