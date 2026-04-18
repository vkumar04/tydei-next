"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatting"

interface OffContractItem {
  sku: string
  name: string
  quantity: number
  unitPrice: number
  contractPrice: number | null
}

interface AlertDetailOffContractItemsProps {
  metadata: Record<string, unknown>
}

function parseItems(metadata: Record<string, unknown>): OffContractItem[] {
  const raw = metadata.items
  if (!Array.isArray(raw)) return []
  const items: OffContractItem[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const sku = typeof e.sku === "string" ? e.sku : null
    const name = typeof e.name === "string" ? e.name : null
    const quantity = typeof e.quantity === "number" ? e.quantity : null
    const unitPrice = typeof e.unitPrice === "number" ? e.unitPrice : null
    if (sku === null || name === null || quantity === null || unitPrice === null)
      continue
    const contractPrice =
      typeof e.contractPrice === "number" ? e.contractPrice : null
    items.push({ sku, name, quantity, unitPrice, contractPrice })
  }
  return items
}

export function AlertDetailOffContractItems({
  metadata,
}: AlertDetailOffContractItemsProps) {
  const items = parseItems(metadata)

  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Off-Contract Items</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Contract Price</TableHead>
              <TableHead className="text-right">Extended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.sku}>
                <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(item.unitPrice)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {item.contractPrice !== null
                    ? formatCurrency(item.contractPrice)
                    : "—"}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(item.unitPrice * item.quantity)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
