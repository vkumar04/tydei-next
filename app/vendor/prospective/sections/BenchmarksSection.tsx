"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Scale } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { useVendorBenchmarks } from "@/hooks/use-prospective"

interface Props {
  vendorId: string
}

export function BenchmarksSection({ vendorId }: Props) {
  const { data: benchmarks, isLoading } = useVendorBenchmarks(vendorId)

  return (
    <Card>
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
              history. Once benchmark data is loaded, it will appear here.
            </p>
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
