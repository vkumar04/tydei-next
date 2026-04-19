"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
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
import { getPricingImportHistory } from "@/lib/actions/imports/pricing-history"

export function PricingImportHistoryCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["pricing-import-history"] as const,
    queryFn: () => getPricingImportHistory(),
  })

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pricing File Imports</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No pricing-file imports yet.
          </p>
        </CardContent>
      </Card>
    )
  }

  const anyMatches = data.some((r) => r.itemMatchCount !== null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing File Imports</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              {anyMatches && (
                <TableHead className="text-right">Matched</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  {r.fileName}
                </TableCell>
                <TableCell>
                  {new Date(r.uploadedAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">{r.rowCount}</TableCell>
                {anyMatches && (
                  <TableCell className="text-right">
                    {r.itemMatchCount ?? "—"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
