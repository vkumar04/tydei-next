"use client"

import { useRef, useState } from "react"
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
import { Badge } from "@/components/ui/badge"
import {
  Zap,
  ScanLine,
  Plus,
  FileText,
  Building2,
  Hash,
  Package,
  DollarSign,
  RefreshCw,
  CheckCircle2,
  Upload,
  AlertTriangle,
  X,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useImportInvoice } from "@/hooks/use-invoices"
import { importInvoice as importInvoiceAction } from "@/lib/actions/invoices"
import {
  parseEdi810,
  type Edi810ParseResult,
} from "@/lib/invoices/edi-810-parser"
import {
  extractedInvoiceSchema,
  type ExtractedInvoiceData,
} from "@/lib/ai/invoice-extract-schema"
import { toast } from "sonner"
import { roundToCents } from "@/lib/money/round"

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

// 2026-06-10 invoices batch: EDI (X12 810 parser) and OCR (Claude
// vision via /api/ai/extract-invoice) are now real import paths —
// replacing the previous honest-but-disabled "Coming soon" tiles
// (which themselves replaced fabricated-success stubs, see H5).
type ImportMethod = "manual" | "edi" | "ocr" | null

const MAX_OCR_BYTES = 25 * 1024 * 1024

interface ManualLineItem {
  lineNumber: number
  itemNumber: string
  description: string
  quantity: number
  unitOfMeasure: string
  unitPrice: number
  extendedPrice: number
}

function computeTotal(
  subtotal: string,
  tax: string,
  shipping: string,
  discount: string
): string {
  return (
    parseFloat(subtotal || "0") +
    parseFloat(tax || "0") +
    parseFloat(shipping || "0") -
    parseFloat(discount || "0")
  ).toFixed(2)
}

function matchVendorByName(
  vendors: Vendor[],
  name: string | null | undefined
): Vendor | undefined {
  const needle = (name ?? "").trim().toLowerCase()
  if (!needle) return undefined
  return vendors.find((v) => v.name.trim().toLowerCase() === needle)
}

const EMPTY_MANUAL_INVOICE = {
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
}

export function InvoiceImportDialog({
  facilityId,
  vendors,
  open,
  onOpenChange,
  onComplete,
}: InvoiceImportDialogProps) {
  const importInvoice = useImportInvoice()
  const queryClient = useQueryClient()
  const [importMethod, setImportMethod] = useState<ImportMethod>(null)

  // Manual entry state
  const [manualInvoice, setManualInvoice] = useState({ ...EMPTY_MANUAL_INVOICE })

  const [currentLineItem, setCurrentLineItem] = useState({
    itemNumber: "",
    description: "",
    quantity: 1,
    unitOfMeasure: "EA",
    unitPrice: 0,
  })

  // OCR state
  const [ocrExtracting, setOcrExtracting] = useState(false)
  const ocrInputRef = useRef<HTMLInputElement>(null)

  // EDI state
  const [ediFileName, setEdiFileName] = useState("")
  const [ediResult, setEdiResult] = useState<Edi810ParseResult | null>(null)
  const [ediVendorSel, setEdiVendorSel] = useState<Record<number, string>>({})
  const [ediImporting, setEdiImporting] = useState(false)
  const ediInputRef = useRef<HTMLInputElement>(null)

  const resetForm = () => {
    setManualInvoice({ ...EMPTY_MANUAL_INVOICE })
    setCurrentLineItem({
      itemNumber: "",
      description: "",
      quantity: 1,
      unitOfMeasure: "EA",
      unitPrice: 0,
    })
    setOcrExtracting(false)
    setEdiFileName("")
    setEdiResult(null)
    setEdiVendorSel({})
    setEdiImporting(false)
  }

  const handleClose = (open: boolean) => {
    if (!open) {
      setImportMethod(null)
      resetForm()
    }
    onOpenChange(open)
  }

  const handleProcessImport = async () => {
    if (
      !manualInvoice.invoiceNumber ||
      !manualInvoice.vendor ||
      manualInvoice.lineItems.length === 0
    ) {
      toast.error("Please fill in required fields and add at least one line item")
      return
    }

    const validLineItems = manualInvoice.lineItems.filter(
      (li) => (li.description || li.itemNumber).trim().length > 0
    )
    if (validLineItems.length === 0) {
      toast.error("Line items need a description or item number")
      return
    }

    try {
      await importInvoice.mutateAsync({
        facilityId,
        vendorId: manualInvoice.vendor,
        invoiceNumber: manualInvoice.invoiceNumber,
        invoiceDate:
          manualInvoice.invoiceDate || new Date().toISOString().split("T")[0],
        poNumber: manualInvoice.poNumber.trim() || undefined,
        taxAmount: parseFloat(manualInvoice.taxAmount || "0") || 0,
        shippingAmount: parseFloat(manualInvoice.shippingAmount || "0") || 0,
        discountAmount: parseFloat(manualInvoice.discountAmount || "0") || 0,
        notes: manualInvoice.notes.trim() || undefined,
        lineItems: validLineItems.map((li) => ({
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
        totalAmount: computeTotal(
          newSubtotal,
          prev.taxAmount,
          prev.shippingAmount,
          prev.discountAmount
        ),
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
    setManualInvoice((prev) => {
      // Fix: previously only subtotal was recomputed, leaving the
      // displayed Invoice Total stale after removing a line.
      const newSubtotal = (
        parseFloat(prev.subtotal || "0") - item.extendedPrice
      ).toFixed(2)
      return {
        ...prev,
        lineItems: prev.lineItems.filter((_, i) => i !== idx),
        subtotal: newSubtotal,
        totalAmount: computeTotal(
          newSubtotal,
          prev.taxAmount,
          prev.shippingAmount,
          prev.discountAmount
        ),
      }
    })
  }

  // ── OCR flow ──────────────────────────────────────────────────

  const applyExtracted = (extracted: ExtractedInvoiceData) => {
    const matchedVendor = matchVendorByName(vendors, extracted.vendorName)
    const lineItems: ManualLineItem[] = (extracted.lineItems ?? [])
      .filter(
        (li) =>
          (li.description ?? "").trim().length > 0 ||
          (li.vendorItemNo ?? "").trim().length > 0
      )
      .map((li, i) => {
        const quantity = Math.max(1, Math.round(li.quantity ?? 1))
        const unitPrice = li.unitPrice ?? 0
        return {
          lineNumber: i + 1,
          itemNumber: li.vendorItemNo ?? "",
          description: li.description ?? "",
          quantity,
          unitOfMeasure: "EA",
          unitPrice,
          extendedPrice: roundToCents(quantity * unitPrice),
        }
      })
    const subtotal = lineItems
      .reduce((sum, li) => sum + li.extendedPrice, 0)
      .toFixed(2)
    const taxAmount = extracted.tax != null ? extracted.tax.toFixed(2) : ""
    const shippingAmount =
      extracted.shipping != null ? extracted.shipping.toFixed(2) : ""
    const discountAmount =
      extracted.discount != null ? Math.abs(extracted.discount).toFixed(2) : ""

    setManualInvoice({
      ...EMPTY_MANUAL_INVOICE,
      invoiceNumber: extracted.invoiceNumber ?? "",
      invoiceDate: extracted.invoiceDate ?? "",
      vendor: matchedVendor?.id ?? "",
      poNumber: extracted.poNumber ?? "",
      lineItems,
      subtotal,
      taxAmount,
      shippingAmount,
      discountAmount,
      totalAmount: computeTotal(subtotal, taxAmount, shippingAmount, discountAmount),
    })
    setImportMethod("manual")
    if (!matchedVendor && extracted.vendorName) {
      toast.warning(
        `Vendor "${extracted.vendorName}" is not in your vendor list — select one manually.`
      )
    } else {
      toast.success("Invoice extracted — review the fields, then import.")
    }
  }

  const handleOcrFile = async (file: File) => {
    const isPdf =
      file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf"
    if (!isPdf) {
      toast.error("OCR import only supports PDF files.")
      return
    }
    if (file.size > MAX_OCR_BYTES) {
      toast.error(
        `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB — maximum size is 25MB.`
      )
      return
    }
    setOcrExtracting(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/ai/extract-invoice", {
        method: "POST",
        body: formData,
      })
      const json = (await res.json().catch(() => null)) as {
        extracted?: unknown
        error?: string
        details?: string
      } | null
      if (!res.ok || !json?.extracted) {
        throw new Error(
          json?.details || json?.error || `Extraction failed (HTTP ${res.status})`
        )
      }
      const extracted = extractedInvoiceSchema.parse(json.extracted)
      applyExtracted(extracted)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to extract invoice from PDF"
      )
    } finally {
      setOcrExtracting(false)
    }
  }

  // ── EDI flow ──────────────────────────────────────────────────

  const handleEdiFile = async (file: File) => {
    try {
      const text = await file.text()
      const result = parseEdi810(text)
      if (result.invoices.length === 0) {
        toast.error(
          `Could not parse EDI 810 file: ${result.errors.slice(0, 3).join(" ") || "no invoices found."}`
        )
        return
      }
      const sel: Record<number, string> = {}
      result.invoices.forEach((inv, i) => {
        const matched = matchVendorByName(vendors, inv.vendorName)
        if (matched) sel[i] = matched.id
      })
      setEdiFileName(file.name)
      setEdiResult(result)
      setEdiVendorSel(sel)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read EDI file"
      )
    }
  }

  const handleEdiImport = async () => {
    if (!ediResult) return
    const unmatched = ediResult.invoices.filter((_, i) => !ediVendorSel[i])
    if (unmatched.length > 0) {
      toast.error(
        `Select a vendor for ${unmatched.length === 1 ? "invoice " + unmatched[0].invoiceNumber : `${unmatched.length} invoices`} before importing.`
      )
      return
    }

    setEdiImporting(true)
    const failures: string[] = []
    let imported = 0
    for (let i = 0; i < ediResult.invoices.length; i++) {
      const inv = ediResult.invoices[i]
      const lineItems = inv.lineItems.map((li, n) => ({
        inventoryDescription:
          (li.description ?? "").trim() ||
          (li.vendorItemNo ?? "").trim() ||
          `Line ${n + 1}`,
        vendorItemNo: li.vendorItemNo ?? undefined,
        invoicePrice: li.unitPrice,
        invoiceQuantity: Math.max(1, Math.round(li.quantity)),
      }))
      const base = {
        facilityId,
        vendorId: ediVendorSel[i],
        invoiceNumber: inv.invoiceNumber,
        invoiceDate:
          inv.invoiceDate ?? new Date().toISOString().split("T")[0],
        lineItems,
      }
      try {
        try {
          await importInvoiceAction({
            ...base,
            poNumber: inv.poNumber ?? undefined,
          })
        } catch (err) {
          // BIG04 PO references often aren't in tydei — retry unlinked
          // rather than failing the whole invoice on a missing PO row.
          const msg = err instanceof Error ? err.message : String(err)
          if (inv.poNumber && msg.includes("was not found for this facility")) {
            await importInvoiceAction(base)
          } else {
            throw err
          }
        }
        imported++
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        failures.push(`${inv.invoiceNumber}: ${msg}`)
      }
    }
    setEdiImporting(false)

    if (imported > 0) {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all })
    }
    if (failures.length === 0) {
      toast.success(
        `Imported ${imported} invoice${imported === 1 ? "" : "s"} from ${ediFileName}`
      )
      onComplete()
      handleClose(false)
    } else {
      toast.error(
        `Imported ${imported}, failed ${failures.length}: ${failures.slice(0, 2).join("; ")}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import New Invoices</DialogTitle>
          <DialogDescription>
            Import via EDI 810, OCR scan of a PDF invoice, or manual entry —
            the system compares line items against contract pricing to detect
            discrepancies.
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
                  Upload an X12 810 invoice file
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
                  Extract from a PDF invoice with AI
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
              disabled={ocrExtracting || ediImporting}
              onClick={() => {
                setImportMethod(null)
                resetForm()
              }}
            >
              Back to options
            </Button>

            {importMethod === "ocr" && (
              <div className="space-y-4">
                <input
                  ref={ocrInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleOcrFile(file)
                    e.target.value = ""
                  }}
                />
                <button
                  onClick={() => ocrInputRef.current?.click()}
                  disabled={ocrExtracting}
                  className="flex w-full flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 hover:border-primary hover:bg-muted/50 transition-colors disabled:cursor-wait disabled:opacity-70"
                >
                  {ocrExtracting ? (
                    <>
                      <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                      <div className="text-center">
                        <p className="font-medium">Extracting invoice…</p>
                        <p className="text-sm text-muted-foreground">
                          Claude is reading the PDF — this takes 10-30 seconds
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <div className="text-center">
                        <p className="font-medium">Upload a PDF invoice</p>
                        <p className="text-sm text-muted-foreground">
                          PDF only, up to 25MB. Extracted fields are prefilled
                          into the entry form for review before import.
                        </p>
                      </div>
                    </>
                  )}
                </button>
              </div>
            )}

            {importMethod === "edi" && !ediResult && (
              <div className="space-y-4">
                <input
                  ref={ediInputRef}
                  type="file"
                  accept=".edi,.x12,.810,.txt,.dat,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleEdiFile(file)
                    e.target.value = ""
                  }}
                />
                <button
                  onClick={() => ediInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 hover:border-primary hover:bg-muted/50 transition-colors"
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">Upload an X12 EDI 810 file</p>
                    <p className="text-sm text-muted-foreground">
                      .edi, .x12, .810 or .txt — parsed locally, previewed
                      before anything is imported.
                    </p>
                  </div>
                </button>
              </div>
            )}

            {importMethod === "edi" && ediResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{ediFileName}</span>
                  <Badge variant="secondary">
                    {ediResult.invoices.length} invoice
                    {ediResult.invoices.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                {ediResult.errors.length > 0 && (
                  <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="space-y-1 text-amber-900 dark:text-amber-100">
                      <p className="font-medium">Parsed with warnings</p>
                      <ul className="list-disc pl-4 text-xs">
                        {ediResult.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                        {ediResult.errors.length > 5 && (
                          <li>…and {ediResult.errors.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
                  {ediResult.invoices.map((inv, i) => {
                    const lineSum = inv.lineItems.reduce(
                      (sum, li) => sum + li.quantity * li.unitPrice,
                      0
                    )
                    return (
                      <div key={i} className="rounded-lg border p-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium">
                            {inv.invoiceNumber}
                          </span>
                          {inv.invoiceDate && (
                            <span className="text-sm text-muted-foreground">
                              {inv.invoiceDate}
                            </span>
                          )}
                          {inv.poNumber && (
                            <Badge variant="outline">PO {inv.poNumber}</Badge>
                          )}
                          <span className="ml-auto text-sm text-muted-foreground">
                            {inv.lineItems.length} line
                            {inv.lineItems.length === 1 ? "" : "s"} · $
                            {lineSum.toFixed(2)}
                            {inv.totalAmount !== null &&
                              Math.abs(inv.totalAmount - lineSum) > 0.01 && (
                                <span title="TDS stated total differs from line-item sum">
                                  {" "}
                                  (stated ${inv.totalAmount.toFixed(2)})
                                </span>
                              )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs w-16">Vendor</Label>
                          <Select
                            value={ediVendorSel[i] ?? ""}
                            onValueChange={(v) =>
                              setEdiVendorSel((prev) => ({ ...prev, [i]: v }))
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue
                                placeholder={
                                  inv.vendorName
                                    ? `Match "${inv.vendorName}"…`
                                    : "Select vendor"
                                }
                              />
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
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Item/SKU</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="w-16">Qty</TableHead>
                              <TableHead className="w-24">Unit Price</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inv.lineItems.map((li, n) => (
                              <TableRow key={n}>
                                <TableCell className="font-mono text-sm">
                                  {li.vendorItemNo ?? "-"}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {li.description ?? "-"}
                                </TableCell>
                                <TableCell>{li.quantity}</TableCell>
                                <TableCell>
                                  ${li.unitPrice.toFixed(2)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )
                  })}
                </div>
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
                      <Label htmlFor="poNumber">PO Number</Label>
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
                      <p className="text-xs text-muted-foreground">
                        If provided, must match one of this facility&apos;s
                        purchase orders — the invoice is linked to it.
                      </p>
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
                            setManualInvoice((prev) => ({
                              ...prev,
                              taxAmount: e.target.value,
                              totalAmount: computeTotal(
                                prev.subtotal,
                                e.target.value,
                                prev.shippingAmount,
                                prev.discountAmount
                              ),
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
                            setManualInvoice((prev) => ({
                              ...prev,
                              shippingAmount: e.target.value,
                              totalAmount: computeTotal(
                                prev.subtotal,
                                prev.taxAmount,
                                e.target.value,
                                prev.discountAmount
                              ),
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
                            setManualInvoice((prev) => ({
                              ...prev,
                              discountAmount: e.target.value,
                              totalAmount: computeTotal(
                                prev.subtotal,
                                prev.taxAmount,
                                prev.shippingAmount,
                                e.target.value
                              ),
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
          {importMethod === "manual" && (
            <Button
              onClick={handleProcessImport}
              disabled={importInvoice.isPending || !manualInvoice.invoiceNumber}
            >
              {importInvoice.isPending ? (
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
          {importMethod === "edi" && ediResult && (
            <Button onClick={handleEdiImport} disabled={ediImporting}>
              {ediImporting ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Import {ediResult.invoices.length} Invoice
                  {ediResult.invoices.length === 1 ? "" : "s"}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
