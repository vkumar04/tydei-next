"use client"

import { RefObject } from "react"
import { Plus, Search, ScanLine, CheckCircle2, XCircle, Clock, FileText, Package } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"

type AddMethod = "select" | "scan" | "exception"

type SearchResult = {
  id: string
  vendorItemNo: string
  description: string
  contractPrice: number | null
  listPrice?: number | null
  uom: string
  vendorId?: string
}

interface ExceptionProduct {
  sku: string
  name: string
  description: string
  unitPrice: string
  reason: string
}

export interface ProductAddMethodsProps {
  vendorId: string
  lineItemCount: number

  // Add method state
  addMethod: AddMethod
  onAddMethodChange: (method: AddMethod) => void

  // Search mode
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  searchResults: SearchResult[] | undefined
  isSearching: boolean
  selectedResult: SearchResult | null
  showResults: boolean
  onShowResultsChange: (show: boolean) => void
  onSelectResult: (result: SearchResult) => void
  onClearSelectedResult: () => void
  searchInputRef: RefObject<HTMLInputElement | null>
  searchResultsRef: RefObject<HTMLDivElement | null>
  addQuantity: number
  onAddQuantityChange: (qty: number) => void
  onAddSelectedProduct: () => void

  // Scan mode
  skuScanInput: string
  onSkuScanInputChange: (value: string) => void
  isLookingUp: boolean
  onScanLookup: () => void
  onSkuScanKeyPress: (e: React.KeyboardEvent) => void

  // Exception mode
  showExceptionForm: boolean
  onShowExceptionFormChange: (show: boolean) => void
  exceptionProduct: ExceptionProduct
  onExceptionProductChange: (product: ExceptionProduct) => void
  onAddException: () => void
  onCancelException: () => void
}

export function ProductAddMethods({
  vendorId,
  lineItemCount,
  addMethod,
  onAddMethodChange,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  isSearching,
  selectedResult,
  showResults,
  onShowResultsChange,
  onSelectResult,
  onClearSelectedResult,
  searchInputRef,
  searchResultsRef,
  addQuantity,
  onAddQuantityChange,
  onAddSelectedProduct,
  skuScanInput,
  onSkuScanInputChange,
  isLookingUp,
  onScanLookup,
  onSkuScanKeyPress,
  showExceptionForm,
  onShowExceptionFormChange,
  exceptionProduct,
  onExceptionProductChange,
  onAddException,
  onCancelException,
}: ProductAddMethodsProps) {
  if (!vendorId) {
    return (
      <div className="border rounded-lg p-6 bg-muted/30 text-center">
        <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-muted-foreground">Select a vendor above to add line items</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2">
          <Package className="h-4 w-4" />
          Line Items
        </h4>
        <div className="text-sm text-muted-foreground">
          {lineItemCount} item{lineItemCount !== 1 ? "s" : ""} added
        </div>
      </div>

      {/* Add Method Tabs */}
      <div className="border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center gap-2 mb-4">
          <Button
            variant={addMethod === "select" ? "default" : "outline"}
            size="sm"
            onClick={() => onAddMethodChange("select")}
          >
            <Search className="mr-1 h-3 w-3" />
            Search Products
          </Button>
          <Button
            variant={addMethod === "scan" ? "default" : "outline"}
            size="sm"
            onClick={() => onAddMethodChange("scan")}
          >
            <ScanLine className="mr-1 h-3 w-3" />
            Scan Barcode
          </Button>
          <Button
            variant={addMethod === "exception" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              onAddMethodChange("exception")
              onShowExceptionFormChange(true)
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
                    onSearchQueryChange(e.target.value)
                    if (e.target.value.length >= 2) onShowResultsChange(true)
                    else onShowResultsChange(false)
                  }}
                  onFocus={() =>
                    (searchResults ?? []).length > 0 && onShowResultsChange(true)
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
                        onClick={() => onSelectResult(result)}
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
                          <span className="font-medium text-green-600 dark:text-green-400">
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
                  onAddQuantityChange(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-20"
                min={1}
                placeholder="Qty"
              />
              <Button onClick={onAddSelectedProduct} disabled={!selectedResult}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Selected product indicator */}
            {selectedResult && (
              <div className="flex items-center justify-between p-2 bg-muted rounded-lg text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
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
                    onClick={onClearSelectedResult}
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
                onChange={(e) => onSkuScanInputChange(e.target.value)}
                onKeyDown={onSkuScanKeyPress}
                placeholder="Scan barcode or enter UDI/SKU..."
                autoFocus
              />
              <Button
                onClick={onScanLookup}
                disabled={!skuScanInput.trim() || isLookingUp}
              >
                {isLookingUp ? "Looking up..." : "Lookup"}
              </Button>
            </div>

            {/* Exception Form (within scan mode) */}
            {showExceptionForm && (
              <div className="p-3 border rounded-lg bg-background space-y-3">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <Clock className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    Product not in catalog - Add as exception
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={exceptionProduct.sku}
                    onChange={(e) =>
                      onExceptionProductChange({
                        ...exceptionProduct,
                        sku: e.target.value,
                      })
                    }
                    placeholder="SKU"
                  />
                  <Input
                    value={exceptionProduct.name}
                    onChange={(e) =>
                      onExceptionProductChange({
                        ...exceptionProduct,
                        name: e.target.value,
                      })
                    }
                    placeholder="Product Name *"
                  />
                  <Input
                    value={exceptionProduct.description}
                    onChange={(e) =>
                      onExceptionProductChange({
                        ...exceptionProduct,
                        description: e.target.value,
                      })
                    }
                    placeholder="Description"
                  />
                  <Input
                    value={exceptionProduct.unitPrice}
                    onChange={(e) =>
                      onExceptionProductChange({
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
                    onExceptionProductChange({
                      ...exceptionProduct,
                      reason: e.target.value,
                    })
                  }
                  placeholder="Reason for exception (optional)"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={onAddException}>
                    Add Exception
                  </Button>
                  <Button size="sm" variant="outline" onClick={onCancelException}>
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
                      onExceptionProductChange({
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
                      onExceptionProductChange({
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
                      onExceptionProductChange({
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
                      onExceptionProductChange({
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
                      onAddQuantityChange(Math.max(1, parseInt(e.target.value) || 1))
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
                      onExceptionProductChange({
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
                  onClick={onAddException}
                  disabled={!exceptionProduct.name || !exceptionProduct.unitPrice}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add Exception Item
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    onCancelException()
                    onAddMethodChange("select")
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
