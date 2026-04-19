"use client"

import { HelpCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useQuery } from "@tanstack/react-query"
import { getOffContractSpend } from "@/lib/actions/contracts/off-contract-spend"
import { formatCurrency } from "@/lib/formatting"

export function OffContractSpendCard({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "off-contract-spend", contractId] as const,
    queryFn: () => getOffContractSpend(contractId),
  })

  if (isLoading || !data)
    return <div className="h-48 animate-pulse rounded-md bg-muted" />

  const total = data.onContract + data.notPriced + data.offContract
  const leakagePct = total > 0 ? (data.offContract / total) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>On vs Off Contract Spend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">On Contract</p>
            <p className="text-2xl font-bold text-emerald-600">
              {formatCurrency(data.onContract)}
            </p>
            <p className="text-xs text-muted-foreground">
              SKU in pricing file
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Not Priced</p>
            <p className="text-2xl font-bold text-sky-600">
              {formatCurrency(data.notPriced)}
            </p>
            <p className="text-xs text-muted-foreground">
              Vendor on contract, SKU missing from pricing file
            </p>
          </div>
          <div className="col-span-2">
            <p className="inline-flex items-center gap-1 text-muted-foreground">
              Off Contract
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center">
                      <HelpCircle
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label="Leakage help"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      Leakage counts only truly off-contract spend: purchases
                      from vendors outside any active contract (or unknown
                      vendors). &quot;Not Priced&quot; items are a pricing-file
                      gap, not leakage — the vendor is still on contract.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
            <p className="text-2xl font-bold text-amber-600">
              {formatCurrency(data.offContract)}
            </p>
            <p className="text-xs text-muted-foreground">
              {leakagePct.toFixed(1)}% leakage
            </p>
          </div>
        </div>

        {data.topNotPriced.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Top not-priced items</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor Item</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topNotPriced.map((i) => (
                  <TableRow key={`np-${i.vendorItemNo}`}>
                    <TableCell className="font-mono text-xs">
                      {i.vendorItemNo}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(i.totalSpend)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data.topOffContract.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No off-contract spend recorded. Run &quot;Re-run match&quot; on COG
            Data if this looks wrong.
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
                {data.topOffContract.map((i) => (
                  <TableRow key={`off-${i.vendorItemNo}`}>
                    <TableCell className="font-mono text-xs">
                      {i.vendorItemNo}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(i.totalSpend)}
                    </TableCell>
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
