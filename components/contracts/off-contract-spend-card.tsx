"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useQuery } from "@tanstack/react-query"
import { getOffContractSpend } from "@/lib/actions/contracts/off-contract-spend"
import { formatCurrency } from "@/lib/formatting"

export function OffContractSpendCard({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "off-contract-spend", contractId] as const,
    queryFn: () => getOffContractSpend(contractId),
  })

  if (isLoading || !data) return <div className="h-48 animate-pulse rounded-md bg-muted" />

  const total = data.onContract + data.offContract
  const offPct = total > 0 ? (data.offContract / total) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>On vs Off Contract Spend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">On Contract</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(data.onContract)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Off Contract</p>
            <p className="text-2xl font-bold text-amber-600">{formatCurrency(data.offContract)}</p>
            <p className="text-xs text-muted-foreground">{offPct.toFixed(1)}% leakage</p>
          </div>
        </div>
        {data.offContractItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No off-contract spend recorded. Run &quot;Re-run match&quot; on COG Data if this looks wrong.
          </p>
        ) : (
          <div>
            <p className="mb-2 text-sm font-medium">Top off-contract items</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor Item</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.offContractItems.map((i) => (
                  <TableRow key={i.vendorItemNo}>
                    <TableCell className="font-mono text-xs">{i.vendorItemNo}</TableCell>
                    <TableCell className="text-right">{formatCurrency(i.totalSpend)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
