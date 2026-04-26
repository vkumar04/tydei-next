import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { FacilityRow } from "./types"

export function FacilityTableSection({ facilityRows }: { facilityRows: FacilityRow[] }) {
  const totalVendorSpend = facilityRows.reduce((s, r) => s + r.yourSpend, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Share by Facility &amp; Category</CardTitle>
        <CardDescription>Your sales distribution across facilities</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Facility Name</TableHead>
              <TableHead className="text-right">Your Sales</TableHead>
              <TableHead className="text-right">Facility Spend</TableHead>
              <TableHead className="text-right">Share %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facilityRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  No facility data available
                </TableCell>
              </TableRow>
            ) : (
              facilityRows.map((row) => (
                <TableRow key={row.facility}>
                  <TableCell className="font-medium">{row.facility}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.yourSpend)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.totalSpend)}</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        row.sharePct >= 30 ? "default" : row.sharePct >= 15 ? "secondary" : "outline"
                      }
                    >
                      {formatPercent(row.sharePct)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {facilityRows.length > 0 && (
          <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
            {facilityRows.length} facilities | Your total sales: {formatCurrency(totalVendorSpend)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
