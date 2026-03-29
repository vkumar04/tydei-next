"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { Field } from "@/components/shared/forms/field"
import { useImportInvoice } from "@/hooks/use-invoices"

interface Vendor {
  id: string
  name: string
}

interface InvoiceImportDialogProps {
  facilityId: string
  vendors: Vendor[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function InvoiceImportDialog({
  facilityId, vendors, open, onOpenChange, onComplete,
}: InvoiceImportDialogProps) {
  const importInvoice = useImportInvoice()
  const [vendorId, setVendorId] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0])
  const [file, setFile] = useState<File | null>(null)

  async function handleSubmit() {
    if (!file || !vendorId || !invoiceNumber) return

    const text = await file.text()
    const lines = text.split("\n").filter((l) => l.trim())
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())

    const descIdx = headers.findIndex((h) => h.includes("description") || h.includes("desc"))
    const itemIdx = headers.findIndex((h) => h.includes("item") || h.includes("sku"))
    const priceIdx = headers.findIndex((h) => h.includes("price") || h.includes("cost"))
    const qtyIdx = headers.findIndex((h) => h.includes("qty") || h.includes("quantity"))

    const lineItems = lines.slice(1).map((line) => {
      const cols = line.split(",").map((c) => c.trim())
      return {
        inventoryDescription: cols[descIdx] || cols[0] || "Unknown",
        vendorItemNo: itemIdx >= 0 ? cols[itemIdx] : undefined,
        invoicePrice: parseFloat(cols[priceIdx] || "0") || 0,
        invoiceQuantity: parseInt(cols[qtyIdx] || "1") || 1,
      }
    }).filter((li) => li.inventoryDescription !== "Unknown")

    await importInvoice.mutateAsync({
      facilityId,
      vendorId,
      invoiceNumber,
      invoiceDate,
      lineItems,
    })

    onComplete()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
          <Field label="Invoice Number" required>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </Field>
          <Field label="Invoice Date" required>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
          <Field label="CSV File" required>
            <Input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={importInvoice.isPending || !file || !vendorId}>
            {importInvoice.isPending && <Loader2 className="animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
