"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { DisputeDialog } from "./dispute-dialog"
import { useFlagInvoiceLineItem, useResolveInvoiceLineItem } from "@/hooks/use-invoices"
import { AlertTriangle, Check } from "lucide-react"

type ValidationLineItem = {
  lineItemId: string
  inventoryDescription: string
  vendorItemNo: string | null
  invoicePrice: number
  invoiceQuantity: number
  totalLineCost: number
  contractPrice: number | null
  variancePercent: number | null
  isFlagged: boolean
  hasDiscrepancy: boolean
}

interface InvoiceValidationDetailProps {
  invoiceId: string
  validation: {
    lineItems: ValidationLineItem[]
    discrepancyCount: number
    averageVariance: number
  }
}

export function InvoiceValidationDetail({ invoiceId, validation }: InvoiceValidationDetailProps) {
  const [disputeItem, setDisputeItem] = useState<ValidationLineItem | null>(null)
  const flagItem = useFlagInvoiceLineItem()
  const resolveItem = useResolveInvoiceLineItem()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Badge variant={validation.discrepancyCount > 0 ? "destructive" : "default"}>
          {validation.discrepancyCount} discrepancies
        </Badge>
        {validation.averageVariance > 0 && (
          <span className="text-sm text-muted-foreground">
            Avg variance: {formatPercent(validation.averageVariance)}
          </span>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Item Validation</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Item #</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Invoice Price</TableHead>
                <TableHead>Contract Price</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {validation.lineItems.map((li) => (
                <TableRow key={li.lineItemId} className={li.hasDiscrepancy ? "bg-destructive/5" : ""}>
                  <TableCell>{li.inventoryDescription}</TableCell>
                  <TableCell>{li.vendorItemNo ?? "-"}</TableCell>
                  <TableCell>{li.invoiceQuantity}</TableCell>
                  <TableCell>{formatCurrency(li.invoicePrice, true)}</TableCell>
                  <TableCell>
                    {li.contractPrice !== null ? formatCurrency(li.contractPrice, true) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {li.variancePercent !== null ? (
                      <span className={Math.abs(li.variancePercent) > 5 ? "font-medium text-destructive" : ""}>
                        {li.variancePercent > 0 ? "+" : ""}{formatPercent(li.variancePercent)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {li.isFlagged ? (
                      <Badge variant="destructive">Flagged</Badge>
                    ) : li.hasDiscrepancy ? (
                      <AlertTriangle className="size-4 text-amber-500" />
                    ) : (
                      <Check className="size-4 text-emerald-500" />
                    )}
                  </TableCell>
                  <TableCell>
                    {li.isFlagged ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveItem.mutate(li.lineItemId)}
                      >
                        Resolve
                      </Button>
                    ) : li.hasDiscrepancy ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDisputeItem(li)}
                      >
                        Flag
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {disputeItem && (
        <DisputeDialog
          open={!!disputeItem}
          onOpenChange={(open) => { if (!open) setDisputeItem(null) }}
          itemDescription={disputeItem.inventoryDescription}
          onSubmit={(notes) => {
            flagItem.mutate({ lineItemId: disputeItem.lineItemId, notes })
            setDisputeItem(null)
          }}
        />
      )}
    </div>
  )
}
