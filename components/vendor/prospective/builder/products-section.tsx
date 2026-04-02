import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Upload,
  History,
  Package,
  Sparkles,
  Loader2,
  CheckCircle2,
  Trash2,
} from "lucide-react"
import type { NewProposalState, FileUploadProgressState } from "./types"
import { formatCurrencyShort } from "./types"

export interface ProductsSectionProps {
  newProposal: NewProposalState
  fileUploadProgress: FileUploadProgressState
  aiProductDescription: string
  setAiProductDescription: (v: string) => void
  isGeneratingAI: boolean
  handleUsageFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  handlePricingFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  generateProductsFromAI: () => void
  removeProductFromProposal: (benchmarkId: string) => void
}

export function ProductsSection({
  newProposal,
  fileUploadProgress,
  aiProductDescription,
  setAiProductDescription,
  isGeneratingAI,
  handleUsageFileUpload,
  handlePricingFileUpload,
  generateProductsFromAI,
  removeProductFromProposal,
}: ProductsSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Label className="text-base font-semibold">Products / Pricing</Label>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{newProposal.products.length} products</Badge>
        </div>
      </div>

      {/* File Upload Progress Indicator */}
      {fileUploadProgress.isLoading && (
        <div className="mb-4 p-4 rounded-lg bg-primary/5 border border-primary/20 animate-pulse">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
            <span className="font-medium text-sm">
              {fileUploadProgress.type === "usage" && "Processing Usage History"}
              {fileUploadProgress.type === "pricing" && "Processing Pricing File"}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 mb-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${fileUploadProgress.progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{fileUploadProgress.message}</p>
        </div>
      )}

      {/* Workflow Guide */}
      {!fileUploadProgress.isLoading && (
        <div className="mb-4 p-3 rounded-lg bg-muted/50 border">
          <p className="text-xs font-medium text-foreground mb-2">Recommended Workflow:</p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Load <strong>Usage History</strong> (12-month PO data with pricing, volume, ref numbers)</li>
            <li>Load <strong>Proposed Pricing</strong> (your new prices for this deal)</li>
            <li>Add <strong>AI Notes</strong> describing the deal situation</li>
          </ol>
        </div>
      )}

      {/* Load Products Options */}
      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        {/* Usage File Upload */}
        <div className="p-4 border rounded-lg border-dashed bg-blue-50/50 dark:bg-blue-950/10">
          <div className="flex items-center gap-2 mb-2">
            <History className="h-4 w-4 text-blue-600" />
            <span className="font-medium text-sm">Upload Usage History</span>
            <Badge variant="secondary" className="text-xs">Recommended</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Load 12-month historical usage with product names, ref numbers, pricing, and volume. This provides the baseline for deal analysis.
          </p>
          <div className="relative">
            <Input
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              onChange={handleUsageFileUpload}
              className="cursor-pointer"
              disabled={fileUploadProgress.isLoading}
            />
          </div>
          {newProposal.products.some(p => p.monthlyUsage && p.monthlyUsage.length > 0) && (
            <div className="mt-2 p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {newProposal.products.filter(p => p.monthlyUsage && p.monthlyUsage.length > 0).length} products with historical data
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">
                Avg {Math.round(newProposal.products.filter(p => p.monthlyUsage).reduce((sum, p) => sum + (p.monthlyUsage?.length || 0), 0) / Math.max(1, newProposal.products.filter(p => p.monthlyUsage).length))} months of history per product
              </p>
            </div>
          )}
        </div>

        {/* Proposed Pricing File Upload */}
        <div className="p-4 border rounded-lg border-dashed">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Upload Proposed Pricing</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Load your proposed pricing for this deal. Will merge with usage data if product names match.
          </p>
          <div className="relative">
            <Input
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              onChange={handlePricingFileUpload}
              className="cursor-pointer"
              disabled={fileUploadProgress.isLoading}
            />
          </div>
          {newProposal.products.some(p => p.proposedPrice > 0) && (
            <div className="mt-2 p-2 rounded bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
              <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {newProposal.products.filter(p => p.proposedPrice > 0).length} products loaded from pricing file
              </p>
              {(() => {
                const pricingProducts = newProposal.products.filter(p => p.proposedPrice > 0)
                const matchedWithUsage = pricingProducts.filter(p => p.projectedVolume > 0).length
                const avgPrice = pricingProducts.reduce((sum, p) => sum + p.proposedPrice, 0) / pricingProducts.length
                return (
                  <>
                    <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                      {matchedWithUsage} matched with usage data ({Math.round((matchedWithUsage / pricingProducts.length) * 100)}%)
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-500">
                      Avg price: ${avgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </>
                )
              })()}
            </div>
          )}
        </div>

        {/* AI Generation */}
        <div className="p-4 border rounded-lg border-dashed">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Generate with AI</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Describe products in natural language, one per line
          </p>
          <div className="space-y-2">
            <Textarea
              placeholder={"Primary Hip System $8,500 50 units\nRevision Hip System $12,000 30 units\nSpinal Fusion Kit $15,000"}
              value={aiProductDescription}
              onChange={(e) => setAiProductDescription(e.target.value)}
              className="text-sm h-20 resize-none"
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={generateProductsFromAI}
              disabled={isGeneratingAI || !aiProductDescription.trim()}
            >
              {isGeneratingAI ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Products
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Products List */}
      {newProposal.products.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground border rounded-lg">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No products added yet</p>
          <p className="text-sm">Upload a pricing file or use AI to add products</p>
        </div>
      ) : (() => {
        const pricingProducts = newProposal.products.filter(p => p.proposedPrice > 0)
        const usageOnlyProducts = newProposal.products.filter(p => p.proposedPrice === 0 && p.projectedVolume > 0)

        return (
          <>
            {/* Proposed Pricing Products */}
            {pricingProducts.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Proposed Pricing ({pricingProducts.length} products)
                </p>
                {[...pricingProducts]
                  .sort((a, b) => {
                    const aSpend = a.projectedVolume > 0 ? a.proposedPrice * a.projectedVolume : 0
                    const bSpend = b.projectedVolume > 0 ? b.proposedPrice * b.projectedVolume : 0
                    if (aSpend > 0 && bSpend > 0) return bSpend - aSpend
                    if (aSpend > 0 && bSpend === 0) return -1
                    if (aSpend === 0 && bSpend > 0) return 1
                    return b.proposedPrice - a.proposedPrice
                  })
                  .map((product, idx) => (
                    <div key={`${product.benchmarkId}-${idx}`} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {product.refNumber && (
                            <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{product.refNumber}</span>
                          )}
                          <p className="font-medium text-sm truncate">{product.productName}</p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="font-semibold text-foreground">${product.proposedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/unit</span>
                          {product.projectedVolume > 0 ? (
                            <>
                              <span>{product.projectedVolume.toLocaleString()} units used</span>
                              <span className="text-primary font-medium">
                                {formatCurrencyShort(product.proposedPrice * product.projectedVolume)}
                              </span>
                            </>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">No usage data</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removeProductFromProposal(product.benchmarkId)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
              </div>
            )}

            {/* Usage-only products */}
            {usageOnlyProducts.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">
                  Additional Opportunity ({usageOnlyProducts.length} products not in pricing)
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mb-2">
                  These products were used by the facility but are not in your proposed pricing.
                  Total spend: {formatCurrencyShort(usageOnlyProducts.reduce((sum, p) => {
                    const historicalSpend = p.monthlyUsage?.reduce((s, m) => s + m.revenue, 0) ||
                                           (p.historicalAvgPrice || 0) * p.projectedVolume
                    return sum + historicalSpend
                  }, 0))}
                </p>
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-700 dark:text-amber-400 hover:underline">
                    View {usageOnlyProducts.length} unmatched products
                  </summary>
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {usageOnlyProducts.slice(0, 20).map((product, idx) => (
                      <div key={`usage-${product.benchmarkId}-${idx}`} className="flex justify-between text-amber-600 dark:text-amber-500">
                        <span className="truncate">{product.refNumber || product.productName}</span>
                        <span>{product.projectedVolume.toLocaleString()} units</span>
                      </div>
                    ))}
                    {usageOnlyProducts.length > 20 && (
                      <p className="text-amber-500">...and {usageOnlyProducts.length - 20} more</p>
                    )}
                  </div>
                </details>
              </div>
            )}
          </>
        )
      })()}

      {/* Products Summary */}
      {newProposal.products.length > 0 && (() => {
        const pricingProducts = newProposal.products.filter(p => p.proposedPrice > 0)
        const usageOnlyProducts = newProposal.products.filter(p => p.proposedPrice === 0 && p.projectedVolume > 0)
        const hasPricing = pricingProducts.length > 0
        const productsWithVolume = newProposal.products.filter(p => p.proposedPrice > 0 && p.projectedVolume > 0)
        const totalProducts = pricingProducts.length
        const totalVolume = productsWithVolume.reduce((sum, p) => sum + p.projectedVolume, 0)
        const proposedValue = productsWithVolume.reduce((sum, p) => sum + p.proposedPrice * p.projectedVolume, 0)
        const additionalOpportunity = usageOnlyProducts.reduce((sum, p) => {
          const historicalSpend = p.monthlyUsage?.reduce((s, m) => s + m.revenue, 0) ||
                                 (p.historicalAvgPrice || 0) * p.projectedVolume
          return sum + historicalSpend
        }, 0)
        const totalOpportunity = newProposal.totalOpportunity

        return (
          <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Proposed Products</p>
                <p className="font-semibold">{hasPricing ? totalProducts.toLocaleString() : "-"}</p>
                {hasPricing && productsWithVolume.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">{productsWithVolume.length.toLocaleString()} with volume</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Volume</p>
                <p className="font-semibold">{hasPricing ? totalVolume.toLocaleString() : "-"}</p>
                {!hasPricing && (
                  <p className="text-[10px] text-muted-foreground">Load pricing file</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Proposed Value</p>
                <p className="font-semibold text-primary">
                  {hasPricing ? formatCurrencyShort(proposedValue) : "-"}
                </p>
                {hasPricing && totalOpportunity > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {((proposedValue / totalOpportunity) * 100).toFixed(0)}% of opportunity
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Opportunity</p>
                <p className="font-semibold text-green-600 dark:text-green-400">
                  {totalOpportunity > 0 ? formatCurrencyShort(totalOpportunity) : "-"}
                </p>
                {hasPricing && additionalOpportunity > 0 && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">+{formatCurrencyShort(additionalOpportunity)} unpriced</p>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
