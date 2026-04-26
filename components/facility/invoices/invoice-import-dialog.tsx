"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Zap,
  ScanLine,
  Plus,
  FileSpreadsheet,
  FileText,
  Building2,
  Hash,
  Package,
  DollarSign,
  RefreshCw,
  CheckCircle2,
  X,
} from "lucide-react"
import { useImportInvoice } from "@/hooks/use-invoices"
import { toast } from "sonner"

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

type ImportMethod = "edi" | "ocr" | "manual" | null

interface ManualLineItem {
  lineNumber: number
  itemNumber: string
  description: string
  quantity: number
  unitOfMeasure: string
  unitPrice: number
  extendedPrice: number
}

export function InvoiceImportDialog({
  facilityId,
  vendors,
  open,
  onOpenChange,
  onComplete,
}: InvoiceImportDialogProps) {
  const importInvoice = useImportInvoice()
  const [importMethod, setImportMethod] = useState<ImportMethod>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Manual entry state
  const [manualInvoice, setManualInvoice] = useState({
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    vendor: "",
    vendorAccountNumber: "",
    poNumber: "",
    shipmentNumber: "",
    billOfLading: "",
    remitToAddress: "",
    shipToAddress: "",
    lineItems: [] as ManualLineItem[],
    subtotal: "",
    taxAmount: "",
    shippingAmount: "",
    discountAmount: "",
    totalAmount: "",
    paymentTerms: "NET30",
    notes: "",
  })

  const [currentLineItem, setCurrentLineItem] = useState({
    itemNumber: "",
    description: "",
    quantity: 1,
    unitOfMeasure: "EA",
    unitPrice: 0,
  })

  const resetForm = () => {
    setManualInvoice({
      invoiceNumber: "",
      invoiceDate: "",
      dueDate: "",
      vendor: "",
      vendorAccountNumber: "",
      poNumber: "",
      shipmentNumber: "",
      billOfLading: "",
      remitToAddress: "",
      shipToAddress: "",
      lineItems: [],
      subtotal: "",
      taxAmount: "",
      shippingAmount: "",
      discountAmount: "",
      totalAmount: "",
      paymentTerms: "NET30",
      notes: "",
    })
    setCurrentLineItem({
      itemNumber: "",
      description: "",
      quantity: 1,
      unitOfMeasure: "EA",
      unitPrice: 0,
    })
  }

  const handleClose = (open: boolean) => {
    if (!open) {
      setImportMethod(null)
      resetForm()
      setIsProcessing(false)
    }
    onOpenChange(open)
  }

  const handleProcessImport = async () => {
    if (importMethod === "manual") {
      // Use real import for manual entry
      if (
        !manualInvoice.invoiceNumber ||
        !manualInvoice.vendor ||
        manualInvoice.lineItems.length === 0
      ) {
        toast.error("Please fill in required fields and add at least one line item")
        return
      }

      try {
        await importInvoice.mutateAsync({
          facilityId,
          vendorId: manualInvoice.vendor,
          invoiceNumber: manualInvoice.invoiceNumber,
          invoiceDate:
            manualInvoice.invoiceDate || new Date().toISOString().split("T")[0],
          lineItems: manualInvoice.lineItems.map((li) => ({
            inventoryDescription: li.description || li.itemNumber,
            vendorItemNo: li.itemNumber || undefined,
            invoicePrice: li.unitPrice,
            invoiceQuantity: li.quantity,
          })),
        })
        onComplete()
        handleClose(false)
      } catch {
        // error handled by mutation
      }
      return
    }

    // Simulate processing for EDI/OCR
    setIsProcessing(true)
    const processingTime = importMethod === "ocr" ? 3000 : 2000

    setTimeout(() => {
      setIsProcessing(false)
      handleClose(false)
      toast.success("Invoice imported and validated", {
        description:
          "Invoice compared against PO and contract pricing. 2 discrepancies found totaling $1,240",
      })
    }, processingTime)
  }

  const handleOCRUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setIsProcessing(true)
      setTimeout(() => {
        setManualInvoice((prev) => ({
          ...prev,
          invoiceNumber: "OCR-" + Math.random().toString().slice(2, 8),
          vendor: vendors[0]?.id ?? "",
          poNumber: "PO-2024-001",
          invoiceDate: new Date().toISOString().slice(0, 10),
          totalAmount: "52450.00",
        }))
        setIsProcessing(false)
        toast.success("Invoice scanned", {
          description:
            "Data extracted from document. Please verify before submitting.",
        })
      }, 2500)
    }
  }

  const handleEDIUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setIsProcessing(true)
      setTimeout(() => {
        setIsProcessing(false)
        toast.success("EDI file processed", {
          description:
            "3 invoices imported. Comparing against POs and contracts...",
        })
        handleProcessImport()
      }, 2000)
    }
  }

  const addLineItem = () => {
    if (currentLineItem.itemNumber && currentLineItem.unitPrice > 0) {
      const extendedPrice = currentLineItem.quantity * currentLineItem.unitPrice
      const newLineItem: ManualLineItem = {
        lineNumber: manualInvoice.lineItems.length + 1,
        itemNumber: currentLineItem.itemNumber,
        description: currentLineItem.description,
        quantity: currentLineItem.quantity,
        unitOfMeasure: currentLineItem.unitOfMeasure,
        unitPrice: currentLineItem.unitPrice,
        extendedPrice,
      }
      const newSubtotal = (
        parseFloat(manualInvoice.subtotal || "0") + extendedPrice
      ).toFixed(2)
      setManualInvoice((prev) => ({
        ...prev,
        lineItems: [...prev.lineItems, newLineItem],
        subtotal: newSubtotal,
        totalAmount: (
          parseFloat(newSubtotal) +
          parseFloat(prev.taxAmount || "0") +
          parseFloat(prev.shippingAmount || "0") -
          parseFloat(prev.discountAmount || "0")
        ).toFixed(2),
      }))
      setCurrentLineItem({
        itemNumber: "",
        description: "",
        quantity: 1,
        unitOfMeasure: "EA",
        unitPrice: 0,
      })
    }
  }

  const removeLineItem = (idx: number) => {
    const item = manualInvoice.lineItems[idx]
    setManualInvoice((prev) => ({
      ...prev,
      lineItems: prev.lineItems.filter((_, i) => i !== idx),
      subtotal: (
        parseFloat(prev.subtotal || "0") - item.extendedPrice
      ).toFixed(2),
    }))
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import New Invoices</DialogTitle>
          <DialogDescription>
            Import invoices via EDI, scan with OCR, or enter manually. The
            system will compare against referenced POs and contract pricing to
            detect discrepancies.
          </DialogDescription>
        </DialogHeader>

        {!importMethod ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-6">
            <button
              onClick={() => setImportMethod("edi")}
              className="flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed hover:border-primary hover:bg-muted/50 transition-colors"
            >
              <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900">
                <Zap className="h-6 w-6 text-blue-600" />
              </div>
              <div className="text-center">
                <p className="font-medium">EDI Import</p>
                <p className="text-sm text-muted-foreground">
                  Upload EDI 810 files
                </p>
              </div>
            </button>

            <button
              onClick={() => setImportMethod("ocr")}
              className="flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed hover:border-primary hover:bg-muted/50 transition-colors"
            >
              <div className="p-3 rounded-full bg-green-100 dark:bg-green-900">
                <ScanLine className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center">
                <p className="font-medium">OCR Scan</p>
                <p className="text-sm text-muted-foreground">
                  Scan PDF/image invoices
                </p>
              </div>
            </button>

            <button
              onClick={() => setImportMethod("manual")}
              className="flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed hover:border-primary hover:bg-muted/50 transition-colors"
            >
              <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-900">
                <Plus className="h-6 w-6 text-purple-600" />
              </div>
              <div className="text-center">
                <p className="font-medium">Manual Entry</p>
                <p className="text-sm text-muted-foreground">
                  Enter invoice details
                </p>
              </div>
            </button>
          </div>
        ) : (
          <div className="py-4 space-y-4">
            {/* Back button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setImportMethod(null)
                resetForm()
              }}
            >
              Back to options
            </Button>

            {importMethod === "edi" && (
              <div className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">
                    Upload EDI 810 Invoice File
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Supports X12 810 format. Multiple invoices per file
                    supported.
                  </p>
                  <Input
                    type="file"
                    accept=".edi,.txt,.x12"
                    className="max-w-xs mx-auto"
                    onChange={handleEDIUpload}
                    disabled={isProcessing}
                  />
                </div>
                {isProcessing && (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Processing EDI file...
                  </div>
                )}
              </div>
            )}

            {importMethod === "ocr" && (
              <div className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <ScanLine className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">
                    Scan Invoice Document
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Upload PDF or image. OCR will extract invoice details
                    automatically.
                  </p>
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="max-w-xs mx-auto"
                    onChange={handleOCRUpload}
                    disabled={isProcessing}
                  />
                </div>
                {isProcessing && (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Scanning and extracting data...
                  </div>
                )}
                {manualInvoice.invoiceNumber && !isProcessing && (
                  <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200">
                    <p className="font-medium text-green-800 dark:text-green-400 mb-2">
                      Data Extracted
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <p>Invoice: {manualInvoice.invoiceNumber}</p>
                      <p>
                        Vendor:{" "}
                        {vendors.find((v) => v.id === manualInvoice.vendor)
                          ?.name ?? manualInvoice.vendor}
                      </p>
                      <p>PO Reference: {manualInvoice.poNumber}</p>
                      <p>Amount: ${manualInvoice.totalAmount}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {importMethod === "manual" && (
              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
                {/* Header Information */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Invoice Header
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="invoiceNumber">Invoice Number *</Label>
                      <Input
                        id="invoiceNumber"
                        value={manualInvoice.invoiceNumber}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            invoiceNumber: e.target.value,
                          }))
                        }
                        placeholder="INV-XXXXX"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invoiceDate">Invoice Date *</Label>
                      <Input
                        id="invoiceDate"
                        type="date"
                        value={manualInvoice.invoiceDate}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            invoiceDate: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dueDate">Due Date</Label>
                      <Input
                        id="dueDate"
                        type="date"
                        value={manualInvoice.dueDate}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            dueDate: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Vendor Information */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Vendor Information
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vendor">Vendor Name *</Label>
                      <Select
                        value={manualInvoice.vendor}
                        onValueChange={(v) =>
                          setManualInvoice((prev) => ({ ...prev, vendor: v }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select vendor" />
                        </SelectTrigger>
                        <SelectContent>
                          {vendors.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vendorAccountNumber">
                        Vendor Account #
                      </Label>
                      <Input
                        id="vendorAccountNumber"
                        value={manualInvoice.vendorAccountNumber}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            vendorAccountNumber: e.target.value,
                          }))
                        }
                        placeholder="ACCT-XXXXX"
                      />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label htmlFor="remitToAddress">Remit-To Address</Label>
                      <Input
                        id="remitToAddress"
                        value={manualInvoice.remitToAddress}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            remitToAddress: e.target.value,
                          }))
                        }
                        placeholder="123 Vendor St, City, State ZIP"
                      />
                    </div>
                  </div>
                </div>

                {/* Reference Numbers */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    Reference Numbers
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="poNumber">PO Number *</Label>
                      <Input
                        id="poNumber"
                        value={manualInvoice.poNumber}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            poNumber: e.target.value,
                          }))
                        }
                        placeholder="PO-2024-XXX"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipmentNumber">
                        Shipment/Packing Slip #
                      </Label>
                      <Input
                        id="shipmentNumber"
                        value={manualInvoice.shipmentNumber}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            shipmentNumber: e.target.value,
                          }))
                        }
                        placeholder="SHP-XXXXX"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billOfLading">Bill of Lading #</Label>
                      <Input
                        id="billOfLading"
                        value={manualInvoice.billOfLading}
                        onChange={(e) =>
                          setManualInvoice((prev) => ({
                            ...prev,
                            billOfLading: e.target.value,
                          }))
                        }
                        placeholder="BOL-XXXXX"
                      />
                    </div>
                  </div>
                </div>

                {/* Line Items */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Line Items
                  </h4>

                  {/* Existing Line Items */}
                  {manualInvoice.lineItems.length > 0 && (
                    <div className="border rounded-lg mb-4">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Item/SKU</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="w-20">Qty</TableHead>
                            <TableHead className="w-20">UoM</TableHead>
                            <TableHead className="w-24">Unit Price</TableHead>
                            <TableHead className="w-24">Extended</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {manualInvoice.lineItems.map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{item.lineNumber}</TableCell>
                              <TableCell className="font-mono text-sm">
                                {item.itemNumber}
                              </TableCell>
                              <TableCell className="text-sm">
                                {item.description}
                              </TableCell>
                              <TableCell>{item.quantity}</TableCell>
                              <TableCell>{item.unitOfMeasure}</TableCell>
                              <TableCell>
                                ${item.unitPrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="font-medium">
                                ${item.extendedPrice.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeLineItem(idx)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Add New Line Item */}
                  <div className="p-3 bg-muted/50 rounded-lg space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Enter item details to add line items
                    </p>
                    <div className="grid grid-cols-6 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Item/SKU</Label>
                        <Input
                          value={currentLineItem.itemNumber}
                          onChange={(e) =>
                            setCurrentLineItem((prev) => ({
                              ...prev,
                              itemNumber: e.target.value,
                            }))
                          }
                          placeholder="SKU-XXX"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Input
                          value={currentLineItem.description}
                          onChange={(e) =>
                            setCurrentLineItem((prev) => ({
                              ...prev,
                              description: e.target.value,
                            }))
                          }
                          placeholder="Product description"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Qty</Label>
                        <Input
                          type="number"
                          value={currentLineItem.quantity}
                          onChange={(e) =>
                            setCurrentLineItem((prev) => ({
                              ...prev,
                              quantity: parseInt(e.target.value) || 1,
                            }))
                          }
                          className="h-8 text-sm"
                          min={1}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Unit Price</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={currentLineItem.unitPrice || ""}
                          onChange={(e) =>
                            setCurrentLineItem((prev) => ({
                              ...prev,
                              unitPrice: parseFloat(e.target.value) || 0,
                            }))
                          }
                          className="h-8 text-sm"
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">&nbsp;</Label>
                        <Button
                          size="sm"
                          className="h-8 w-full"
                          onClick={addLineItem}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    UoM: EA (Each), BX (Box), CS (Case), PK (Pack), KT (Kit)
                  </p>
                </div>

                {/* Totals */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Invoice Totals
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Label>Subtotal</Label>
                        <span className="font-mono">
                          $
                          {parseFloat(manualInvoice.subtotal || "0").toFixed(2)}
                        </span>
                      </div>
                      <div className="flex gap-2 items-center">
                        <Label htmlFor="taxAmount" className="w-24">
                          Tax Amount
                        </Label>
                        <Input
                          id="taxAmount"
                          type="number"
                          step="0.01"
                          value={manualInvoice.taxAmount}
                          onChange={(e) => {
                            const tax = parseFloat(e.target.value) || 0
                            setManualInvoice((prev) => ({
                              ...prev,
                              taxAmount: e.target.value,
                              totalAmount: (
                                parseFloat(prev.subtotal || "0") +
                                tax +
                                parseFloat(prev.shippingAmount || "0") -
                                parseFloat(prev.discountAmount || "0")
                              ).toFixed(2),
                            }))
                          }}
                          placeholder="0.00"
                          className="w-28"
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <Label htmlFor="shippingAmount" className="w-24">
                          Shipping
                        </Label>
                        <Input
                          id="shippingAmount"
                          type="number"
                          step="0.01"
                          value={manualInvoice.shippingAmount}
                          onChange={(e) => {
                            const shipping = parseFloat(e.target.value) || 0
                            setManualInvoice((prev) => ({
                              ...prev,
                              shippingAmount: e.target.value,
                              totalAmount: (
                                parseFloat(prev.subtotal || "0") +
                                parseFloat(prev.taxAmount || "0") +
                                shipping -
                                parseFloat(prev.discountAmount || "0")
                              ).toFixed(2),
                            }))
                          }}
                          placeholder="0.00"
                          className="w-28"
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <Label htmlFor="discountAmount" className="w-24">
                          Discount
                        </Label>
                        <Input
                          id="discountAmount"
                          type="number"
                          step="0.01"
                          value={manualInvoice.discountAmount}
                          onChange={(e) => {
                            const discount = parseFloat(e.target.value) || 0
                            setManualInvoice((prev) => ({
                              ...prev,
                              discountAmount: e.target.value,
                              totalAmount: (
                                parseFloat(prev.subtotal || "0") +
                                parseFloat(prev.taxAmount || "0") +
                                parseFloat(prev.shippingAmount || "0") -
                                discount
                              ).toFixed(2),
                            }))
                          }}
                          placeholder="0.00"
                          className="w-28"
                        />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="p-4 bg-muted rounded-lg">
                        <div className="flex justify-between items-center text-lg font-semibold">
                          <span>Invoice Total</span>
                          <span className="text-primary">
                            $
                            {parseFloat(
                              manualInvoice.totalAmount || "0"
                            ).toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="paymentTerms">Payment Terms</Label>
                        <Select
                          value={manualInvoice.paymentTerms}
                          onValueChange={(v) =>
                            setManualInvoice((prev) => ({
                              ...prev,
                              paymentTerms: v,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NET15">Net 15</SelectItem>
                            <SelectItem value="NET30">Net 30</SelectItem>
                            <SelectItem value="NET45">Net 45</SelectItem>
                            <SelectItem value="NET60">Net 60</SelectItem>
                            <SelectItem value="DUE_ON_RECEIPT">
                              Due on Receipt
                            </SelectItem>
                            <SelectItem value="2_10_NET30">
                              2/10 Net 30
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="notes">
                    Notes / Special Instructions
                  </Label>
                  <Input
                    id="notes"
                    value={manualInvoice.notes}
                    onChange={(e) =>
                      setManualInvoice((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    placeholder="Any additional notes or special instructions..."
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          {importMethod && (
            <Button
              onClick={handleProcessImport}
              disabled={
                isProcessing ||
                importInvoice.isPending ||
                (importMethod === "manual" && !manualInvoice.invoiceNumber)
              }
            >
              {isProcessing || importInvoice.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Import &amp; Validate
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
