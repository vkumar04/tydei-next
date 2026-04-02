"use client"

import { Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import type { POLineItemInput } from "@/lib/validators/purchase-orders"

// Internal line item with extra UI-only fields
interface UILineItem extends POLineItemInput {
  _id: string
  lotNumber: string
  serialNumber: string
}

export interface LineItemsTableProps {
  lineItems: UILineItem[]
  onRemoveLineItem: (id: string) => void
  onUpdateQuantity: (id: string, quantity: number) => void
  onUpdatePrice: (id: string, price: number) => void
  onUpdateField: (id: string, field: "lotNumber" | "serialNumber", value: string) => void
}

export function LineItemsTable({
  lineItems,
  onRemoveLineItem,
  onUpdateQuantity,
  onUpdatePrice,
  onUpdateField,
}: LineItemsTableProps) {
  if (lineItems.length === 0) return null

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-28">Lot #</TableHead>
            <TableHead className="w-28">Serial #</TableHead>
            <TableHead className="w-20">Qty</TableHead>
            <TableHead className="w-28">Unit Price</TableHead>
            <TableHead className="text-right">Extended</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineItems.map((item) => (
            <TableRow key={item._id}>
              <TableCell className="font-mono text-sm">
                {item.vendorItemNo ?? ""}
              </TableCell>
              <TableCell
                className="max-w-[200px] truncate"
                title={item.inventoryDescription}
              >
                {item.inventoryDescription}
              </TableCell>
              <TableCell>
                <Input
                  value={item.lotNumber || ""}
                  onChange={(e) =>
                    onUpdateField(item._id, "lotNumber", e.target.value)
                  }
                  className="h-8 text-sm"
                  placeholder="Lot"
                />
              </TableCell>
              <TableCell>
                <Input
                  value={item.serialNumber || ""}
                  onChange={(e) =>
                    onUpdateField(item._id, "serialNumber", e.target.value)
                  }
                  className="h-8 text-sm"
                  placeholder="S/N"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={item.quantity}
                  onChange={(e) =>
                    onUpdateQuantity(
                      item._id,
                      parseInt(e.target.value) || 1,
                    )
                  }
                  className="w-16 h-8"
                  min={1}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={item.unitPrice}
                  onChange={(e) =>
                    onUpdatePrice(
                      item._id,
                      parseFloat(e.target.value) || 0,
                    )
                  }
                  className="w-24 h-8 text-right"
                  step="0.01"
                  min={0}
                />
              </TableCell>
              <TableCell className="text-right font-medium">
                ${(item.quantity * item.unitPrice).toFixed(2)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveLineItem(item._id)}
                  className="h-8 w-8"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
