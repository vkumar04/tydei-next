"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Field } from "@/components/shared/forms/field"
import { POLineItemBuilder } from "./po-line-item-builder"
import { useCreatePurchaseOrder, useProductSearch } from "@/hooks/use-purchase-orders"
import { formatCurrency } from "@/lib/formatting"
import type { POLineItemInput } from "@/lib/validators/purchase-orders"

interface Vendor {
  id: string
  name: string
}

interface POCreateFormProps {
  facilityId: string
  vendors: Vendor[]
}

export function POCreateForm({ facilityId, vendors }: POCreateFormProps) {
  const router = useRouter()
  const create = useCreatePurchaseOrder()

  const [vendorId, setVendorId] = useState("")
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split("T")[0])
  const [lineItems, setLineItems] = useState<POLineItemInput[]>([
    { inventoryDescription: "", quantity: 1, unitPrice: 0, uom: "EA", isOffContract: false },
  ])
  const [searchQuery, setSearchQuery] = useState("")

  const { data: searchResults } = useProductSearch(facilityId, searchQuery, vendorId || undefined)

  const total = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await create.mutateAsync({
      facilityId,
      vendorId,
      orderDate,
      lineItems: lineItems.filter((li) => li.inventoryDescription.trim()),
    })
    router.push("/dashboard/purchase-orders")
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>PO Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" required>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Order Date" required>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Line Items
            <span className="text-base font-normal text-muted-foreground">
              Total: {formatCurrency(total, true)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <POLineItemBuilder
            lineItems={lineItems}
            onChange={setLineItems}
            searchResults={searchResults ?? []}
            onSearch={setSearchQuery}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || !vendorId}>
          {create.isPending && <Loader2 className="animate-spin" />}
          Create Purchase Order
        </Button>
      </div>
    </form>
  )
}
