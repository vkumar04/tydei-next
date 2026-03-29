"use client"

import { Trash2, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatting"
import type { POLineItemInput } from "@/lib/validators/purchase-orders"

type ProductSearchResult = {
  id: string
  vendorItemNo: string
  description: string
  contractPrice: number | null
  uom: string
}

interface POLineItemBuilderProps {
  lineItems: POLineItemInput[]
  onChange: (items: POLineItemInput[]) => void
  searchResults: ProductSearchResult[]
  onSearch: (query: string) => void
}

function emptyItem(): POLineItemInput {
  return { inventoryDescription: "", quantity: 1, unitPrice: 0, uom: "EA", isOffContract: false }
}

export function POLineItemBuilder({ lineItems, onChange, searchResults, onSearch }: POLineItemBuilderProps) {
  function updateItem(index: number, partial: Partial<POLineItemInput>) {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], ...partial }
    onChange(updated)
  }

  function removeItem(index: number) {
    onChange(lineItems.filter((_, i) => i !== index))
  }

  function selectProduct(index: number, product: ProductSearchResult) {
    updateItem(index, {
      inventoryDescription: product.description,
      vendorItemNo: product.vendorItemNo,
      unitPrice: product.contractPrice ?? 0,
      uom: product.uom,
    })
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">Description</TableHead>
            <TableHead>Item #</TableHead>
            <TableHead className="w-[80px]">Qty</TableHead>
            <TableHead className="w-[120px]">Unit Price</TableHead>
            <TableHead className="w-[120px]">Extended</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineItems.map((item, i) => (
            <TableRow key={i}>
              <TableCell>
                <Input
                  value={item.inventoryDescription}
                  onChange={(e) => {
                    updateItem(i, { inventoryDescription: e.target.value })
                    onSearch(e.target.value)
                  }}
                  placeholder="Search or enter description"
                />
                {searchResults.length > 0 && item.inventoryDescription.length >= 2 && !item.vendorItemNo && (
                  <div className="absolute z-10 mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                    {searchResults.slice(0, 5).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                        onClick={() => selectProduct(i, r)}
                      >
                        {r.description} ({r.vendorItemNo})
                      </button>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Input value={item.vendorItemNo ?? ""} onChange={(e) => updateItem(i, { vendorItemNo: e.target.value })} />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: parseInt(e.target.value) || 1 })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                />
              </TableCell>
              <TableCell className="text-sm font-medium">
                {formatCurrency(item.quantity * item.unitPrice, true)}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => removeItem(i)}>
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lineItems, emptyItem()])}>
        <Plus className="size-4" /> Add Line Item
      </Button>
    </div>
  )
}
