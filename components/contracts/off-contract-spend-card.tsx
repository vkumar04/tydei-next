"use client"

import { useState } from "react"
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
import type { OffContractSpendItem } from "@/lib/actions/contracts/off-contract-spend"
import { formatCurrency } from "@/lib/formatting"

function BucketDrilldown({
  title,
  items,
  emptyMessage,
  keyPrefix,
}: {
  title: string
  items: OffContractSpendItem[]
  emptyMessage: string
  keyPrefix: string
}) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyMessage}</p>
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium hover:underline"
        aria-expanded={open}
      >
        <span aria-hidden>{open ? "\u25BC" : "\u25B6"}</span>
        {title} ({items.length})
      </button>
      {open ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor Item</TableHead>
              <TableHead className="text-right">Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={`${keyPrefix}-${i.vendorItemNo}`}>
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
      ) : null}
    </div>
  )
}

export function OffContractSpendCard({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "off-contract-spend", contractId] as const,
    queryFn: () => getOffContractSpend(contractId),
  })

  if (isLoading || !data)
    return <div className="h-48 animate-pulse rounded-md bg-muted" />

  const total =
    data.onContract + data.notPriced + data.preMatch + data.offContract
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
          {data.preMatch > 0 ? (
            <div className="col-span-2">
              <p className="inline-flex items-center gap-1 text-muted-foreground">
                Pre-Match
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help items-center">
                        <HelpCircle
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-label="Pre-match help"
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">
                        Same-vendor SKUs the matcher hasn&apos;t classified
                        yet. Not leakage — these are purchases from this
                        contract&apos;s vendor that need enrichment. Run
                        &quot;Re-run match&quot; on COG Data to resolve them
                        into On Contract or Not Priced.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </p>
              <p className="text-2xl font-bold text-violet-600">
                {formatCurrency(data.preMatch)}
              </p>
              <p className="text-xs text-muted-foreground">
                Same-vendor SKUs awaiting match
              </p>
            </div>
          ) : null}
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
                      gap; &quot;Pre-Match&quot; items are same-vendor rows
                      awaiting enrichment — neither is leakage.
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

        <div className="space-y-3">
          <BucketDrilldown
            title="On-contract items"
            items={data.topOnContract}
            emptyMessage="No on-contract spend recorded yet."
            keyPrefix="on"
          />
          <BucketDrilldown
            title="Not-priced items"
            items={data.topNotPriced}
            emptyMessage="No not-priced spend."
            keyPrefix="np"
          />
          {data.preMatch > 0 ? (
            <BucketDrilldown
              title="Pre-match items"
              items={data.topPreMatch}
              emptyMessage="No pre-match spend."
              keyPrefix="pm"
            />
          ) : null}
          <BucketDrilldown
            title="Off-contract items"
            items={data.topOffContract}
            emptyMessage='No off-contract spend recorded. Run "Re-run match" on COG Data if this looks wrong.'
            keyPrefix="off"
          />
        </div>
      </CardContent>
    </Card>
  )
}
