"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useCreatePurchaseOrder, useProductSearch } from "@/hooks/use-purchase-orders"
import { toast } from "sonner"
import type { POLineItemInput } from "@/lib/validators/purchase-orders"

import { OrderHeader } from "./form/order-header"
import { PatientBillingInfo } from "./form/patient-billing-info"
import { ProductAddMethods } from "./form/product-add-methods"
import { LineItemsTable } from "./form/line-items-table"
import { OrderTotalAndNotes } from "./form/order-total-and-notes"
import { DialogFooterActions } from "./form/dialog-footer-actions"

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

  const handleVendorChange = useCallback((v: string) => {
    setVendorId(v)
    setLineItems([])
    setSelectedResult(null)
    setSearchQuery("")
  }, [])

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query)
    setSelectedResult(null)
  }, [])

  const handleSelectResult = useCallback((result: SearchResult) => {
    setSelectedResult(result)
    setSearchQuery(`${result.vendorItemNo} - ${result.description}`)
    setShowResults(false)
  }, [])

  const handleClearSelectedResult = useCallback(() => {
    setSelectedResult(null)
    setSearchQuery("")
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
          <OrderHeader
            vendors={vendors}
            vendorId={vendorId}
            orderDate={orderDate}
            procedureDate={procedureDate}
            onVendorChange={handleVendorChange}
            onOrderDateChange={setOrderDate}
            onProcedureDateChange={setProcedureDate}
          />

          <PatientBillingInfo
            patientMRN={patientMRN}
            patientInitials={patientInitials}
            billToAddress={billToAddress}
            paymentTerms={paymentTerms}
            departmentCode={departmentCode}
            glCode={glCode}
            onPatientMRNChange={setPatientMRN}
            onPatientInitialsChange={setPatientInitials}
            onBillToAddressChange={setBillToAddress}
            onPaymentTermsChange={setPaymentTerms}
            onDepartmentCodeChange={setDepartmentCode}
            onGlCodeChange={setGlCode}
          />

          <ProductAddMethods
            vendorId={vendorId}
            lineItemCount={lineItems.length}
            addMethod={addMethod}
            onAddMethodChange={setAddMethod}
            searchQuery={searchQuery}
            onSearchQueryChange={handleSearchQueryChange}
            searchResults={searchResults}
            isSearching={isSearching}
            selectedResult={selectedResult}
            showResults={showResults}
            onShowResultsChange={setShowResults}
            onSelectResult={handleSelectResult}
            onClearSelectedResult={handleClearSelectedResult}
            searchInputRef={searchInputRef}
            searchResultsRef={searchResultsRef}
            addQuantity={addQuantity}
            onAddQuantityChange={setAddQuantity}
            onAddSelectedProduct={addSelectedProduct}
            skuScanInput={skuScanInput}
            onSkuScanInputChange={setSkuScanInput}
            isLookingUp={isLookingUp}
            onScanLookup={handleScanLookup}
            onSkuScanKeyPress={handleSkuScanKeyPress}
            showExceptionForm={showExceptionForm}
            onShowExceptionFormChange={setShowExceptionForm}
            exceptionProduct={exceptionProduct}
            onExceptionProductChange={setExceptionProduct}
            onAddException={handleAddException}
            onCancelException={handleCancelException}
          />

          {vendorId && (
            <>
              <LineItemsTable
                lineItems={lineItems}
                onRemoveLineItem={removeLineItem}
                onUpdateQuantity={updateLineItemQuantity}
                onUpdatePrice={updateLineItemPrice}
                onUpdateField={updateLineItemField}
              />

              <OrderTotalAndNotes
                total={total}
                lineItemCount={lineItems.length}
                specialInstructions={specialInstructions}
                poNotes={poNotes}
                onSpecialInstructionsChange={setSpecialInstructions}
                onPONotesChange={setPONotes}
              />
            </>
          )}
        </div>

        <DialogFooterActions
          lineItemCount={lineItems.length}
          isPending={create.isPending}
          onCancel={() => onOpenChange(false)}
          onSaveDraft={() => handleSubmit(true)}
          onSubmit={() => handleSubmit(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
