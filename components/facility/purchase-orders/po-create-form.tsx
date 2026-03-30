"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Loader2, Plus, Trash2, Search, ScanLine, CheckCircle2, XCircle, Clock, Package, FileText, Building2, DollarSign, User } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useCreatePurchaseOrder, useProductSearch } from "@/hooks/use-purchase-orders"
import { formatCurrency } from "@/lib/formatting"
import { toast } from "sonner"
import type { POLineItemInput } from "@/lib/validators/purchase-orders"

interface Vendor {
  id: string
  name: string
}

interface POCreateFormProps {
  facilityId: string
  vendors: Vendor[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AddMethod = "select" | "scan" | "exception"

interface ExceptionProduct {
  sku: string
  name: string
  description: string
  unitPrice: string
  reason: string
}

// Internal line item with extra UI-only fields
interface UILineItem extends POLineItemInput {
  _id: string
  lotNumber: string
  serialNumber: string
}

type SearchResult = {
  id: string
  vendorItemNo: string
  description: string
  contractPrice: number | null
  listPrice?: number | null
  uom: string
  vendorId?: string
}

export function POCreateDialog({ facilityId, vendors, open, onOpenChange }: POCreateFormProps) {
  const create = useCreatePurchaseOrder()

  // ── Form state ──
  const [vendorId, setVendorId] = useState("")
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split("T")[0])
  const [procedureDate, setProcedureDate] = useState("")
  const [patientMRN, setPatientMRN] = useState("")
  const [patientInitials, setPatientInitials] = useState("")
  const [billToAddress, setBillToAddress] = useState("Accounts Payable - 123 Medical Center Dr, City, ST 12345")
  const [paymentTerms, setPaymentTerms] = useState("NET30")
  const [departmentCode, setDepartmentCode] = useState("")
  const [glCode, setGlCode] = useState("")
  const [specialInstructions, setSpecialInstructions] = useState("")
  const [poNotes, setPONotes] = useState("")

  // ── Line items ──
  const [lineItems, setLineItems] = useState<UILineItem[]>([])
  const [addQuantity, setAddQuantity] = useState(1)
  const [addMethod, setAddMethod] = useState<AddMethod>("select")

  // ── Product search (select mode) ──
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [showResults, setShowResults] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchResultsRef = useRef<HTMLDivElement>(null)

  const { data: searchResults, isFetching: isSearching } = useProductSearch(
    facilityId,
    searchQuery,
    vendorId || undefined,
  )

  // ── Barcode scan mode ──
  const [skuScanInput, setSkuScanInput] = useState("")
  const [isLookingUp, setIsLookingUp] = useState(false)

  // ── Exception mode ──
  const [showExceptionForm, setShowExceptionForm] = useState(false)
  const [exceptionProduct, setExceptionProduct] = useState<ExceptionProduct>({
    sku: "", name: "", description: "", unitPrice: "", reason: "",
  })

  // ── Computed ──
  const total = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0),
    [lineItems],
  )

  // ── Click outside to close search ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        searchResultsRef.current &&
        !searchResultsRef.current.contains(e.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        setShowResults(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // ── Reset ──
  const resetForm = useCallback(() => {
    setVendorId("")
    setOrderDate(new Date().toISOString().split("T")[0])
    setProcedureDate("")
    setPatientMRN("")
    setPatientInitials("")
    setBillToAddress("Accounts Payable - 123 Medical Center Dr, City, ST 12345")
    setPaymentTerms("NET30")
    setDepartmentCode("")
    setGlCode("")
    setSpecialInstructions("")
    setPONotes("")
    setLineItems([])
    setAddQuantity(1)
    setAddMethod("select")
    setSearchQuery("")
    setSelectedResult(null)
    setShowResults(false)
    setSkuScanInput("")
    setIsLookingUp(false)
    setShowExceptionForm(false)
    setExceptionProduct({ sku: "", name: "", description: "", unitPrice: "", reason: "" })
  }, [])

  // ── Handlers ──

  const handleSelectResult = useCallback((result: SearchResult) => {
    setSelectedResult(result)
    setSearchQuery(`${result.vendorItemNo} - ${result.description}`)
    setShowResults(false)
  }, [])

  const addSelectedProduct = useCallback(() => {
    if (!selectedResult) return
    const price = selectedResult.contractPrice ?? 0
    setLineItems((prev) => [
      ...prev,
      {
        _id: `new-${Date.now()}`,
        inventoryDescription: selectedResult.description,
        vendorItemNo: selectedResult.vendorItemNo,
        quantity: addQuantity,
        unitPrice: price,
        uom: selectedResult.uom || "EA",
        isOffContract: false,
        lotNumber: "",
        serialNumber: "",
      },
    ])
    setSearchQuery("")
    setSelectedResult(null)
    setShowResults(false)
    setAddQuantity(1)
    toast.success("Product added", { description: selectedResult.description })
  }, [selectedResult, addQuantity])

  const handleScanLookup = useCallback(async () => {
    if (!skuScanInput.trim()) return
    setIsLookingUp(true)
    // Simulate lookup delay, then add item with the scanned SKU
    await new Promise((r) => setTimeout(r, 400))

    // Add to line items with the scanned value as vendorItemNo
    setLineItems((prev) => [
      ...prev,
      {
        _id: `scan-${Date.now()}`,
        inventoryDescription: skuScanInput.trim(),
        vendorItemNo: skuScanInput.trim(),
        quantity: 1,
        unitPrice: 0,
        uom: "EA",
        isOffContract: false,
        lotNumber: "",
        serialNumber: "",
      },
    ])
    toast.success("Item added from scan", { description: "Enter price and Lot/Serial" })
    setSkuScanInput("")
    setIsLookingUp(false)
  }, [skuScanInput])

  const handleSkuScanKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleScanLookup()
      }
    },
    [handleScanLookup],
  )

  const handleAddException = useCallback(() => {
    if (!exceptionProduct.name || !exceptionProduct.unitPrice) {
      toast.error("Missing information", { description: "Please enter product name and price" })
      return
    }
    const price = parseFloat(exceptionProduct.unitPrice)
    if (isNaN(price) || price <= 0) {
      toast.error("Invalid price", { description: "Please enter a valid price" })
      return
    }
    const qty = addQuantity || 1
    const description = exceptionProduct.description
      ? `${exceptionProduct.name} - ${exceptionProduct.description} (Exception${exceptionProduct.reason ? `: ${exceptionProduct.reason}` : ""})`
      : `${exceptionProduct.name} (Exception${exceptionProduct.reason ? `: ${exceptionProduct.reason}` : ""})`

    setLineItems((prev) => [
      ...prev,
      {
        _id: `exc-${Date.now()}`,
        inventoryDescription: description,
        vendorItemNo: exceptionProduct.sku || `EXC-${Date.now()}`,
        quantity: qty,
        unitPrice: price,
        uom: "EA",
        isOffContract: true,
        lotNumber: "",
        serialNumber: "",
      },
    ])
    toast.success("Exception item added", { description: exceptionProduct.name })
    setShowExceptionForm(false)
    setExceptionProduct({ sku: "", name: "", description: "", unitPrice: "", reason: "" })
    setAddQuantity(1)
    setSkuScanInput("")
    setAddMethod("select")
  }, [exceptionProduct, addQuantity])

  const handleCancelException = useCallback(() => {
    setShowExceptionForm(false)
    setExceptionProduct({ sku: "", name: "", description: "", unitPrice: "", reason: "" })
    setSkuScanInput("")
  }, [])

  const removeLineItem = useCallback((id: string) => {
    setLineItems((prev) => prev.filter((li) => li._id !== id))
  }, [])

  const updateLineItemQuantity = useCallback((id: string, quantity: number) => {
    if (quantity < 1) return
    setLineItems((prev) =>
      prev.map((li) => (li._id === id ? { ...li, quantity } : li)),
    )
  }, [])

  const updateLineItemPrice = useCallback((id: string, price: number) => {
    if (price < 0) return
    setLineItems((prev) =>
      prev.map((li) => (li._id === id ? { ...li, unitPrice: price } : li)),
    )
  }, [])

  const updateLineItemField = useCallback(
    (id: string, field: "lotNumber" | "serialNumber", value: string) => {
      setLineItems((prev) =>
        prev.map((li) => (li._id === id ? { ...li, [field]: value } : li)),
      )
    },
    [],
  )

  // ── Submit ──
  const handleSubmit = useCallback(
    async (asDraft: boolean) => {
      if (lineItems.length === 0) {
        toast.error("Please add at least one line item")
        return
      }
      if (!vendorId) {
        toast.error("Please select a vendor")
        return
      }
      await create.mutateAsync({
        facilityId,
        vendorId,
        orderDate,
        lineItems: lineItems.map(({ _id, lotNumber, serialNumber, ...rest }) => rest),
      })
      if (asDraft) {
        toast.success("PO saved as draft")
      }
      resetForm()
      onOpenChange(false)
    },
    [lineItems, vendorId, facilityId, orderDate, create, resetForm, onOpenChange],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) resetForm()
      }}
    >
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Bill Only PO</DialogTitle>
          <DialogDescription>
            Create a purchase order for products already used in a procedure
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Header */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Order Header
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Select Vendor *</Label>
                <Select
                  value={vendorId}
                  onValueChange={(v) => {
                    setVendorId(v)
                    setLineItems([])
                    setSelectedResult(null)
                    setSearchQuery("")
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          {vendor.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>PO Date *</Label>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Procedure Date</Label>
                <Input
                  type="date"
                  value={procedureDate}
                  onChange={(e) => setProcedureDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Patient & Billing Information */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <User className="h-4 w-4" />
              Patient &amp; Billing Information
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Patient MRN</Label>
                <Input
                  value={patientMRN}
                  onChange={(e) => setPatientMRN(e.target.value)}
                  placeholder="Medical Record Number"
                />
              </div>
              <div className="space-y-2">
                <Label>Patient Initials</Label>
                <Input
                  value={patientInitials}
                  onChange={(e) => setPatientInitials(e.target.value.toUpperCase())}
                  placeholder="e.g., JD"
                  maxLength={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Bill-To Address</Label>
                <Input
                  value={billToAddress}
                  onChange={(e) => setBillToAddress(e.target.value)}
                  placeholder="Billing address"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Enter either Patient MRN or Initials for Bill Only PO identification
            </p>
          </div>

          {/* Payment & Accounting */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Payment &amp; Accounting
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Payment Terms</Label>
                <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NET15">Net 15</SelectItem>
                    <SelectItem value="NET30">Net 30</SelectItem>
                    <SelectItem value="NET45">Net 45</SelectItem>
                    <SelectItem value="NET60">Net 60</SelectItem>
                    <SelectItem value="2_10_NET30">2/10 Net 30</SelectItem>
                    <SelectItem value="DUE_ON_RECEIPT">Due on Receipt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department Code</Label>
                <Input
                  value={departmentCode}
                  onChange={(e) => setDepartmentCode(e.target.value)}
                  placeholder="e.g., ORTHO, SURG"
                />
              </div>
              <div className="space-y-2">
                <Label>GL Code / Cost Center</Label>
                <Input
                  value={glCode}
                  onChange={(e) => setGlCode(e.target.value)}
                  placeholder="e.g., 4100-200"
                />
              </div>
            </div>
          </div>

          {/* Line Items Section */}
          {!vendorId && (
            <div className="border rounded-lg p-6 bg-muted/30 text-center">
              <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Select a vendor above to add line items</p>
            </div>
          )}

          {vendorId && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Line Items
                </h4>
                <div className="text-sm text-muted-foreground">
                  {lineItems.length} item{lineItems.length !== 1 ? "s" : ""} added
                </div>
              </div>

              {/* Add Method Tabs */}
              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center gap-2 mb-4">
                  <Button
                    variant={addMethod === "select" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAddMethod("select")}
                  >
                    <Search className="mr-1 h-3 w-3" />
                    Search Products
                  </Button>
                  <Button
                    variant={addMethod === "scan" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAddMethod("scan")}
                  >
                    <ScanLine className="mr-1 h-3 w-3" />
                    Scan Barcode
                  </Button>
                  <Button
                    variant={addMethod === "exception" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setAddMethod("exception")
                      setShowExceptionForm(true)
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Exception
                  </Button>
                </div>

                {/* Search/Select Mode */}
                {addMethod === "select" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Type to search across COG data, contracts, and catalog (min 2 characters)
                    </p>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Input
                          ref={searchInputRef}
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value)
                            setSelectedResult(null)
                            if (e.target.value.length >= 2) setShowResults(true)
                            else setShowResults(false)
                          }}
                          onFocus={() =>
                            (searchResults ?? []).length > 0 && setShowResults(true)
                          }
                          placeholder="Type product code, SKU, or description..."
                          className={selectedResult ? "border-primary" : ""}
                        />
                        {isSearching && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}

                        {/* Dynamic Search Results Dropdown */}
                        {showResults && (searchResults ?? []).length > 0 && (
                          <div
                            ref={searchResultsRef}
                            className="absolute z-50 top-full left-0 right-0 mt-1 max-h-64 overflow-auto bg-background border rounded-lg shadow-lg"
                          >
                            {(searchResults ?? []).map((result, idx) => (
                              <button
                                key={`${result.id}-${idx}`}
                                type="button"
                                className="w-full px-3 py-2 text-left hover:bg-muted flex items-center justify-between gap-2 border-b last:border-b-0"
                                onClick={() => handleSelectResult(result)}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono text-sm truncate">
                                    {result.vendorItemNo}
                                  </div>
                                  <div className="text-sm text-muted-foreground truncate">
                                    {result.description}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="outline" className="text-xs">
                                    Contract
                                  </Badge>
                                  <span className="font-medium text-green-600">
                                    ${(result.contractPrice ?? 0).toFixed(2)}
                                  </span>
                                </div>
                              </button>
                            ))}
                            {(searchResults ?? []).length >= 20 && (
                              <div className="px-3 py-2 text-xs text-muted-foreground text-center bg-muted">
                                Showing first 20 results. Type more to narrow search.
                              </div>
                            )}
                          </div>
                        )}

                        {/* No results message */}
                        {showResults &&
                          (searchResults ?? []).length === 0 &&
                          searchQuery.length >= 2 &&
                          !isSearching && (
                            <div className="absolute z-50 top-full left-0 right-0 mt-1 p-3 bg-background border rounded-lg shadow-lg text-center text-sm text-muted-foreground">
                              No products found for &quot;{searchQuery}&quot;
                            </div>
                          )}
                      </div>
                      <Input
                        type="number"
                        value={addQuantity}
                        onChange={(e) =>
                          setAddQuantity(Math.max(1, parseInt(e.target.value) || 1))
                        }
                        className="w-20"
                        min={1}
                        placeholder="Qty"
                      />
                      <Button onClick={addSelectedProduct} disabled={!selectedResult}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Selected product indicator */}
                    {selectedResult && (
                      <div className="flex items-center justify-between p-2 bg-muted rounded-lg text-sm">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="font-mono">{selectedResult.vendorItemNo}</span>
                          <span className="text-muted-foreground truncate max-w-[200px]">
                            {selectedResult.description}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            ${(selectedResult.contractPrice ?? 0).toFixed(2)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedResult(null)
                              setSearchQuery("")
                            }}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Unified Barcode Scan Mode */}
                {addMethod === "scan" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Scan any barcode (UDI, GTIN, SKU). Automatically checks FDA GUDID, then
                      COG data and contracts.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        value={skuScanInput}
                        onChange={(e) => setSkuScanInput(e.target.value)}
                        onKeyDown={handleSkuScanKeyPress}
                        placeholder="Scan barcode or enter UDI/SKU..."
                        autoFocus
                      />
                      <Button
                        onClick={handleScanLookup}
                        disabled={!skuScanInput.trim() || isLookingUp}
                      >
                        {isLookingUp ? "Looking up..." : "Lookup"}
                      </Button>
                    </div>

                    {/* Exception Form (within scan mode) */}
                    {showExceptionForm && (
                      <div className="p-3 border rounded-lg bg-background space-y-3">
                        <div className="flex items-center gap-2 text-amber-600">
                          <Clock className="h-4 w-4" />
                          <span className="text-sm font-medium">
                            Product not in catalog - Add as exception
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            value={exceptionProduct.sku}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                sku: e.target.value,
                              })
                            }
                            placeholder="SKU"
                          />
                          <Input
                            value={exceptionProduct.name}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                name: e.target.value,
                              })
                            }
                            placeholder="Product Name *"
                          />
                          <Input
                            value={exceptionProduct.description}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                description: e.target.value,
                              })
                            }
                            placeholder="Description"
                          />
                          <Input
                            value={exceptionProduct.unitPrice}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                unitPrice: e.target.value,
                              })
                            }
                            placeholder="Unit Price *"
                            type="number"
                          />
                        </div>
                        <Input
                          value={exceptionProduct.reason}
                          onChange={(e) =>
                            setExceptionProduct({
                              ...exceptionProduct,
                              reason: e.target.value,
                            })
                          }
                          placeholder="Reason for exception (optional)"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleAddException}>
                            Add Exception
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleCancelException}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Exception Item Mode */}
                {addMethod === "exception" && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Add an item that is not in the standard product catalog. This will be
                      flagged as an exception for review.
                    </p>
                    <div className="p-4 border rounded-lg bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-4">
                        <FileText className="h-4 w-4" />
                        <span className="text-sm font-medium">Exception Item Entry</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">SKU / Item Number</Label>
                          <Input
                            value={exceptionProduct.sku}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                sku: e.target.value,
                              })
                            }
                            placeholder="e.g., CUSTOM-001"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">
                            Product Name <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            value={exceptionProduct.name}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                name: e.target.value,
                              })
                            }
                            placeholder="e.g., Custom Implant Kit"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">Description</Label>
                          <Input
                            value={exceptionProduct.description}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                description: e.target.value,
                              })
                            }
                            placeholder="Full description of the item..."
                          />
                        </div>
                        <div>
                          <Label className="text-xs">
                            Unit Price <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            value={exceptionProduct.unitPrice}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                unitPrice: e.target.value,
                              })
                            }
                            placeholder="0.00"
                            type="number"
                            min="0"
                            step="0.01"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Quantity</Label>
                          <Input
                            type="number"
                            value={addQuantity}
                            onChange={(e) =>
                              setAddQuantity(Math.max(1, parseInt(e.target.value) || 1))
                            }
                            min={1}
                            placeholder="1"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">Reason for Exception</Label>
                          <Input
                            value={exceptionProduct.reason}
                            onChange={(e) =>
                              setExceptionProduct({
                                ...exceptionProduct,
                                reason: e.target.value,
                              })
                            }
                            placeholder="e.g., Special order for complex case, not in standard catalog"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button
                          onClick={handleAddException}
                          disabled={!exceptionProduct.name || !exceptionProduct.unitPrice}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Add Exception Item
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            handleCancelException()
                            setAddMethod("select")
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Line Items Table */}
              {lineItems.length > 0 && (
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
                                updateLineItemField(item._id, "lotNumber", e.target.value)
                              }
                              className="h-8 text-sm"
                              placeholder="Lot"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.serialNumber || ""}
                              onChange={(e) =>
                                updateLineItemField(item._id, "serialNumber", e.target.value)
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
                                updateLineItemQuantity(
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
                                updateLineItemPrice(
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
                              onClick={() => removeLineItem(item._id)}
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
              )}

              {/* Total */}
              {lineItems.length > 0 && (
                <div className="flex justify-end">
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">Order Total:</span>
                      <span className="text-2xl font-bold">
                        ${total.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Special Instructions & Notes */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Special Instructions</Label>
                  <Input
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="e.g., Deliver to Loading Dock B"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Internal Notes</Label>
                  <Input
                    value={poNotes}
                    onChange={(e) => setPONotes(e.target.value)}
                    placeholder="Internal notes (not sent to vendor)"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleSubmit(true)}
            disabled={lineItems.length === 0 || create.isPending}
          >
            {create.isPending && <Loader2 className="animate-spin" />}
            Save as Draft
          </Button>
          <Button
            onClick={() => handleSubmit(false)}
            disabled={lineItems.length === 0 || create.isPending}
          >
            {create.isPending && <Loader2 className="animate-spin" />}
            Submit PO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
