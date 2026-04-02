import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { formatCurrency } from "@/lib/formatting"
import {
  Plus,
  Trash2,
  ScanLine,
  Camera,
  Search,
  AlertCircle,
  Package,
  Building2,
  FileText,
} from "lucide-react"
import type { POLineItem, POType, VendorFacilityRow, VendorProductRow } from "./types"
import { poTypeLabels, poTypeDescriptions } from "./types"

// ─── Props ──────────────────────────────────────────────────────────

export interface POCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void

  // Form state
  facility: string
  onFacilityChange: (value: string) => void
  poType: POType
  onPOTypeChange: (value: POType) => void
  poDate: string
  onPODateChange: (value: string) => void
  notes: string
  onNotesChange: (value: string) => void

  // Data
  facilities: VendorFacilityRow[]
  selectedFacilityObj: VendorFacilityRow | undefined
  facilityProducts: VendorProductRow[]
  displayedFacilityProducts: VendorProductRow[]
  displayedCatalogProducts: VendorProductRow[]
  filteredFacilityProductsCount: number
  filteredCatalogProductsCount: number
  lineItems: POLineItem[]
  lineItemsTotal: number
  searchTerm: string

  // Product selection
  selectedProductToAdd: string
  onSelectedProductToAddChange: (value: string) => void
  productSearch: string
  onProductSearchChange: (value: string) => void
  addMethod: "select" | "scan"
  onAddMethodChange: (value: "select" | "scan") => void
  scanInput: string
  onScanInputChange: (value: string) => void

  // Exception form
  showExceptionForm: boolean
  exceptionProduct: {
    sku: string
    name: string
    description: string
    lotSn: string
    unitPrice: string
    reason: string
  }
  onExceptionProductChange: (value: {
    sku: string
    name: string
    description: string
    lotSn: string
    unitPrice: string
    reason: string
  }) => void

  // Callbacks
  onAddLineItem: () => void
  onScanProduct: () => void
  onScanKeyPress: (e: React.KeyboardEvent) => void
  onAddException: () => void
  onCancelException: () => void
  onCameraScan: () => void
  onUpdateQuantity: (productId: string, quantity: number) => void
  onUpdateLotSn: (productId: string, lotSn: string) => void
  onRemoveLineItem: (productId: string) => void
  onCreatePO: () => void
  isCreating: boolean
}

export function POCreateDialog({
  open,
  onOpenChange,
  facility,
  onFacilityChange,
  poType,
  onPOTypeChange,
  poDate,
  onPODateChange,
  notes,
  onNotesChange,
  facilities,
  selectedFacilityObj,
  facilityProducts,
  displayedFacilityProducts,
  displayedCatalogProducts,
  filteredFacilityProductsCount,
  filteredCatalogProductsCount,
  lineItems,
  lineItemsTotal,
  searchTerm,
  selectedProductToAdd,
  onSelectedProductToAddChange,
  productSearch,
  onProductSearchChange,
  addMethod,
  onAddMethodChange,
  scanInput,
  onScanInputChange,
  showExceptionForm,
  exceptionProduct,
  onExceptionProductChange,
  onAddLineItem,
  onScanProduct,
  onScanKeyPress,
  onAddException,
  onCancelException,
  onCameraScan,
  onUpdateQuantity,
  onUpdateLotSn,
  onRemoveLineItem,
  onCreatePO,
  isCreating,
}: POCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
          <DialogDescription>
            Create a new purchase order on behalf of a facility
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Facility and PO Type Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="facility">Facility *</Label>
              <Select value={facility} onValueChange={onFacilityChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {f.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="poType">PO Type *</Label>
              <Select
                value={poType}
                onValueChange={(v) => onPOTypeChange(v as POType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select PO type" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(poTypeLabels) as POType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      <div className="flex flex-col">
                        <span>{poTypeLabels[type]}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {poTypeDescriptions[poType]}
              </p>
            </div>
          </div>

          {/* PO Date */}
          <div className="space-y-2">
            <Label htmlFor="poDate">PO Date *</Label>
            <Input
              id="poDate"
              type="date"
              value={poDate}
              onChange={(e) => onPODateChange(e.target.value)}
              className="w-full max-w-xs"
            />
          </div>

          {/* Add Products - Method Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Add Products</Label>
                {facility && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Showing {facilityProducts.length} products from{" "}
                    {selectedFacilityObj?.name} price file
                    {selectedFacilityObj?.contractId && (
                      <span className="text-green-600 dark:text-green-400 ml-1">(Contract pricing)</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex gap-1 bg-muted p-1 rounded-lg">
                <Button
                  variant={addMethod === "select" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onAddMethodChange("select")}
                  className="h-7 px-3"
                >
                  <Package className="h-3 w-3 mr-1" />
                  Select
                </Button>
                <Button
                  variant={addMethod === "scan" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onAddMethodChange("scan")}
                  className="h-7 px-3"
                >
                  <ScanLine className="h-3 w-3 mr-1" />
                  Scan
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCameraScan}
                  className="h-7 px-3"
                >
                  <Camera className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {addMethod === "select" && (
              <div className="space-y-2">
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search products by name, SKU, or category..."
                    value={productSearch}
                    onChange={(e) => onProductSearchChange(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {/* Product list */}
                <div className="border rounded-lg max-h-[350px] overflow-y-auto">
                  {!searchTerm && !facility ? (
                    <div className="p-4 text-center text-muted-foreground">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Search for products by name, SKU, or category</p>
                      <p className="text-xs mt-1">
                        Or select a facility to see their price file
                      </p>
                    </div>
                  ) : searchTerm && searchTerm.length < 2 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      Type at least 2 characters to search...
                    </div>
                  ) : displayedFacilityProducts.length === 0 &&
                    displayedCatalogProducts.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      <p>No products match &quot;{productSearch}&quot;</p>
                      <p className="text-xs mt-1">
                        Try a different search term or add as exception
                      </p>
                    </div>
                  ) : (
                    <div>
                      {/* Facility Price File Products */}
                      {displayedFacilityProducts.length > 0 && (
                        <>
                          {facility && (
                            <div className="px-3 py-2 bg-green-50 dark:bg-green-950/30 text-xs font-medium text-green-700 dark:text-green-300 border-b flex items-center justify-between">
                              <span>
                                Price File Products ({filteredFacilityProductsCount})
                              </span>
                              {selectedFacilityObj?.contractId && (
                                <span>Contract Pricing</span>
                              )}
                            </div>
                          )}
                          <div className="divide-y">
                            {displayedFacilityProducts.map((p) => {
                              const hasContractPrice = p.contractPrice != null
                              const displayPrice = hasContractPrice
                                ? p.contractPrice!
                                : p.listPrice ?? 0
                              const isSelected = selectedProductToAdd === p.id
                              return (
                                <div
                                  key={p.id}
                                  className={`p-3 cursor-pointer hover:bg-muted/50 flex items-start justify-between gap-3 ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                                  onClick={() =>
                                    onSelectedProductToAddChange(isSelected ? "" : p.id)
                                  }
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium">{p.description}</div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                                      <span className="font-mono">{p.vendorItemNo}</span>
                                      {p.category && (
                                        <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                                          {p.category}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="font-medium">
                                      {formatCurrency(displayPrice)}
                                    </div>
                                    {hasContractPrice && (
                                      <div className="text-xs text-green-600 dark:text-green-400">
                                        Contract price
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )}

                      {/* Full Catalog Products (not in price file) */}
                      {displayedCatalogProducts.length > 0 && (
                        <>
                          <div className="px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-y flex items-center justify-between">
                            <span>
                              Full Catalog ({filteredCatalogProductsCount} more)
                            </span>
                            <span>List Price</span>
                          </div>
                          <div className="divide-y">
                            {displayedCatalogProducts.map((p) => {
                              const isSelected = selectedProductToAdd === p.id
                              return (
                                <div
                                  key={p.id}
                                  className={`p-3 cursor-pointer hover:bg-muted/50 flex items-start justify-between gap-3 ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                                  onClick={() =>
                                    onSelectedProductToAddChange(isSelected ? "" : p.id)
                                  }
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium">{p.description}</div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                                      <span className="font-mono">{p.vendorItemNo}</span>
                                      {p.category && (
                                        <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                                          {p.category}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="font-medium">
                                      {formatCurrency(p.listPrice ?? 0)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      List price
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )}

                      {/* Show count if more results */}
                      {(filteredFacilityProductsCount > 50 ||
                        filteredCatalogProductsCount >
                          50 - displayedFacilityProducts.length) && (
                        <div className="px-3 py-2 text-xs text-center text-muted-foreground bg-muted/30">
                          Showing first 50 results. Refine your search for more specific
                          results.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  onClick={onAddLineItem}
                  disabled={!selectedProductToAdd}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Selected Product
                </Button>
              </div>
            )}

            {addMethod === "scan" && !showExceptionForm && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Scan barcode or enter SKU..."
                      value={scanInput}
                      onChange={(e) => onScanInputChange(e.target.value)}
                      onKeyDown={onScanKeyPress}
                      className="pl-10"
                      autoFocus
                    />
                  </div>
                  <Button onClick={onScanProduct} disabled={!scanInput.trim()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Scan a barcode or manually enter a SKU/product code and press Enter
                </p>
              </div>
            )}

            {/* Product Exception Form */}
            {showExceptionForm && (
              <div className="border border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20 rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-medium">Product Exception</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  No product found matching &quot;{exceptionProduct.sku}&quot;. Enter details
                  to add as an exception.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="exc-sku">SKU / Code</Label>
                    <Input
                      id="exc-sku"
                      value={exceptionProduct.sku}
                      onChange={(e) =>
                        onExceptionProductChange({ ...exceptionProduct, sku: e.target.value })
                      }
                      placeholder="Enter SKU"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="exc-price">Unit Price *</Label>
                    <Input
                      id="exc-price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={exceptionProduct.unitPrice}
                      onChange={(e) =>
                        onExceptionProductChange({
                          ...exceptionProduct,
                          unitPrice: e.target.value,
                        })
                      }
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="exc-name">Product Name *</Label>
                  <Input
                    id="exc-name"
                    value={exceptionProduct.name}
                    onChange={(e) =>
                      onExceptionProductChange({ ...exceptionProduct, name: e.target.value })
                    }
                    placeholder="Enter product name"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="exc-desc">Description</Label>
                  <Input
                    id="exc-desc"
                    value={exceptionProduct.description}
                    onChange={(e) =>
                      onExceptionProductChange({
                        ...exceptionProduct,
                        description: e.target.value,
                      })
                    }
                    placeholder="Enter product description"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="exc-lotsn">LOT/SN</Label>
                  <Input
                    id="exc-lotsn"
                    value={exceptionProduct.lotSn}
                    onChange={(e) =>
                      onExceptionProductChange({ ...exceptionProduct, lotSn: e.target.value })
                    }
                    placeholder="Lot code or serial number"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="exc-reason">Reason for Exception</Label>
                  <Textarea
                    id="exc-reason"
                    value={exceptionProduct.reason}
                    onChange={(e) =>
                      onExceptionProductChange({ ...exceptionProduct, reason: e.target.value })
                    }
                    placeholder="Why is this product not in the price file? (e.g., new item, special request, trial product)"
                    rows={2}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={onCancelException}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={onAddException}
                    disabled={!exceptionProduct.name || !exceptionProduct.unitPrice}
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Exception
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Line Items Table */}
          {lineItems.length > 0 && (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="w-[140px]">LOT/SN</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item) => (
                    <TableRow
                      key={item.productId}
                      className={
                        item.isException
                          ? "bg-orange-50/50 dark:bg-orange-950/20"
                          : ""
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{item.productName}</div>
                          {item.isException && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-orange-100 text-orange-800 border-orange-300"
                            >
                              Exception
                            </Badge>
                          )}
                        </div>
                        {item.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {item.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.sku}
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="LOT/SN"
                          value={item.lotSn || ""}
                          onChange={(e) =>
                            onUpdateLotSn(item.productId, e.target.value)
                          }
                          className="w-[130px] h-8 text-sm"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) =>
                            onUpdateQuantity(
                              item.productId,
                              parseInt(e.target.value) || 1
                            )
                          }
                          className="w-[70px] h-8"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => onRemoveLineItem(item.productId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={5} className="text-right font-medium">
                      Order Total:
                    </TableCell>
                    <TableCell className="text-right font-bold text-lg">
                      {formatCurrency(lineItemsTotal)}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {lineItems.length === 0 && (
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No products added yet</p>
              <p className="text-sm">
                {addMethod === "scan"
                  ? "Scan a barcode or enter a SKU to add products"
                  : "Select a product from the dropdown or scan to add"}
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any special instructions or notes for this order..."
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onCreatePO}
            disabled={
              !facility ||
              !poDate ||
              lineItems.length === 0 ||
              isCreating
            }
          >
            <FileText className="mr-2 h-4 w-4" />
            {isCreating ? "Creating..." : "Create Purchase Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
