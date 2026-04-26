"use client"

import { useState, useRef } from "react"
import {
  Check,
  Pencil,
  Calendar,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  X,
  Loader2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ExtractedContractData } from "@/lib/ai/schemas"
import type { ContractPricingItem } from "@/lib/actions/pricing-files"
import { parsePricingFile } from "@/lib/utils/parse-pricing-file"

interface AIExtractReviewProps {
  extracted: ExtractedContractData
  confidence: number
  onAccept: (data: ExtractedContractData, pricingItems?: ContractPricingItem[], pricingCategories?: string[]) => void
}

export function AIExtractReview({
  extracted,
  confidence,
  onAccept,
}: AIExtractReviewProps) {
  const [data, setData] = useState(extracted)
  const [editField, setEditField] = useState<string | null>(null)
  const [showTerms, setShowTerms] = useState(false)
  const [pricingItems, setPricingItems] = useState<ContractPricingItem[]>([])
  const [pricingFileName, setPricingFileName] = useState<string | null>(null)
  const [pricingCategories, setPricingCategories] = useState<string[]>([])
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingError, setPricingError] = useState<string | null>(null)
  const pricingInputRef = useRef<HTMLInputElement>(null)

  async function handlePricingFile(file: File) {
    setPricingLoading(true)
    setPricingError(null)
    try {
      const result = await parsePricingFile(file)
      if (result.needsManualMapping) {
        setPricingError("Could not auto-detect columns. Please upload a file with vendor_item_no and contract_price columns.")
        return
      }
      if (result.items.length === 0) {
        setPricingError("No valid pricing items found. Check your file format.")
        return
      }
      setPricingItems(result.items)
      setPricingFileName(file.name)
      setPricingCategories(result.categories)
    } catch (err) {
      setPricingError(err instanceof Error ? err.message : "Failed to parse pricing file")
    } finally {
      setPricingLoading(false)
    }
  }

  const confidenceLabel =
    confidence >= 0.8 ? "High" : confidence >= 0.5 ? "Medium" : "Low"
  const confidenceColor =
    confidence >= 0.8
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
      : confidence >= 0.5
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
        : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"

  function updateField(field: string, value: string) {
    setData((prev) => ({
      ...prev,
      [field]: field === "totalValue" ? parseFloat(value) || 0 : value,
    }))
    setEditField(null)
  }

  function EditableField({
    field,
    label,
    value,
    multiline,
  }: {
    field: string
    label: string
    value: string
    multiline?: boolean
  }) {
    const isEditing = editField === field
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {isEditing ? (
          multiline ? (
            <Textarea
              defaultValue={value}
              rows={4}
              autoFocus
              onBlur={(e) => updateField(field, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey)
                  updateField(field, e.currentTarget.value)
              }}
            />
          ) : (
            <Input
              defaultValue={value}
              autoFocus
              onBlur={(e) => updateField(field, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  updateField(field, e.currentTarget.value)
              }}
            />
          )
        ) : (
          <div
            className="flex items-start gap-1.5 group cursor-pointer"
            onClick={() => setEditField(field)}
          >
            <p className="font-semibold text-sm leading-snug">
              {value || "Not detected"}
            </p>
            <Pencil className="h-3 w-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
      {/* Confidence badge */}
      <div className="flex items-center justify-between">
        <Label className="font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Extracted Contract Details
        </Label>
        <Badge className={confidenceColor}>
          {confidenceLabel} confidence ({Math.round(confidence * 100)}%)
        </Badge>
      </div>

      {/* Key Contract Info */}
      <div className="p-4 rounded-lg border bg-primary/5">
        <div className="grid gap-4 sm:grid-cols-3">
          <EditableField
            field="contractName"
            label="Contract Name"
            value={data.contractName}
          />
          <EditableField
            field="vendorName"
            label="Vendor"
            value={data.vendorName}
          />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Contract Type</p>
            <Select
              value={data.contractType}
              onValueChange={(v) =>
                setData((prev) => ({
                  ...prev,
                  contractType: v as ExtractedContractData["contractType"],
                }))
              }
            >
              <SelectTrigger className="h-8 w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usage">Usage-Based</SelectItem>
                <SelectItem value="pricing_only">Pricing Only</SelectItem>
                <SelectItem value="capital">Capital Equipment</SelectItem>
                <SelectItem value="grouped">GPO/Group</SelectItem>
                <SelectItem value="tie_in">Tie-In</SelectItem>
                <SelectItem value="service">Service</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Dates + Value */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="p-3 rounded-lg border space-y-1">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Effective Date
          </p>
          {editField === "effectiveDate" ? (
            <Input
              type="date"
              defaultValue={data.effectiveDate ?? ""}
              autoFocus
              onBlur={(e) => updateField("effectiveDate", e.target.value)}
            />
          ) : (
            <p
              className="font-medium text-sm cursor-pointer group flex items-center gap-1"
              onClick={() => setEditField("effectiveDate")}
            >
              {data.effectiveDate ?? "Not detected"}
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </p>
          )}
        </div>
        <div className="p-3 rounded-lg border space-y-1">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Expiration Date
          </p>
          {editField === "expirationDate" ? (
            <Input
              type="date"
              defaultValue={data.expirationDate ?? ""}
              autoFocus
              onBlur={(e) => updateField("expirationDate", e.target.value)}
            />
          ) : (
            <p
              className="font-medium text-sm cursor-pointer group flex items-center gap-1"
              onClick={() => setEditField("expirationDate")}
            >
              {data.expirationDate ?? "Evergreen"}
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </p>
          )}
        </div>
        <div className="p-3 rounded-lg border space-y-1">
          <p className="text-xs text-muted-foreground">Total Value</p>
          {editField === "totalValue" ? (
            <Input
              type="number"
              defaultValue={String(data.totalValue ?? 0)}
              autoFocus
              onBlur={(e) => updateField("totalValue", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  updateField("totalValue", e.currentTarget.value)
              }}
            />
          ) : (
            <p
              className="font-medium text-sm cursor-pointer group flex items-center gap-1"
              onClick={() => setEditField("totalValue")}
            >
              {data.totalValue
                ? `$${data.totalValue.toLocaleString()}`
                : "Not detected"}
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      {data.description && (
        <div className="space-y-1.5">
          <EditableField
            field="description"
            label="Description"
            value={data.description}
            multiline
          />
        </div>
      )}

      <Separator />

      {/* Terms */}
      {data.terms.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="font-medium">
              Rebate Terms ({data.terms.length})
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTerms(!showTerms)}
            >
              {showTerms ? "Collapse" : "Expand All"}
              {showTerms ? (
                <ChevronUp className="ml-1 h-4 w-4" />
              ) : (
                <ChevronDown className="ml-1 h-4 w-4" />
              )}
            </Button>
          </div>

          <div className="space-y-2">
            {data.terms.map((term, i) => (
              <div key={i} className="p-3 rounded-lg border bg-card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{term.termName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {term.termType}
                      </Badge>
                      {term.tiers.length > 0 && (
                        <Badge className="bg-primary/10 text-primary text-xs">
                          {term.tiers.length} Tier
                          {term.tiers.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {showTerms && term.tiers.length > 0 && (
                  <div className="mt-3 pt-3 border-t grid gap-1.5">
                    {term.tiers.map((tier, ti) => (
                      <div
                        key={ti}
                        className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-muted-foreground">
                            Tier {tier.tierNumber}
                          </span>
                          {tier.spendMin != null && (
                            <span>${(tier.spendMin / 1000).toFixed(0)}K+</span>
                          )}
                        </div>
                        {tier.rebateValue != null && (
                          <Badge variant="secondary">
                            {tier.rebateValue}% rebate
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link Pricing File */}
      <Separator />
      <div className="space-y-3">
        <Label className="font-medium flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Link Pricing File
        </Label>
        <p className="text-xs text-muted-foreground">
          Optionally attach a CSV or Excel pricing file to import with the contract.
        </p>

        <input
          ref={pricingInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handlePricingFile(file)
            // Reset so the same file can be re-selected
            e.target.value = ""
          }}
        />

        {pricingItems.length > 0 ? (
          <div className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{pricingFileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {pricingItems.length} pricing items loaded
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  setPricingItems([])
                  setPricingFileName(null)
                  setPricingCategories([])
                  setPricingError(null)
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{pricingItems.length} items</Badge>
              {pricingCategories.map((cat) => (
                <Badge key={cat} variant="outline" className="text-xs">
                  {cat}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pricingLoading}
            onClick={() => pricingInputRef.current?.click()}
          >
            {pricingLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {pricingLoading ? "Parsing..." : "Upload Pricing File"}
          </Button>
        )}

        {pricingError && (
          <p className="text-xs text-destructive">{pricingError}</p>
        )}
      </div>

      {/* Accept button */}
      <Button
        className="w-full"
        size="lg"
        onClick={() =>
          onAccept(
            data,
            pricingItems.length > 0 ? pricingItems : undefined,
            pricingCategories.length > 0 ? pricingCategories : undefined,
          )
        }
      >
        <Check className="h-4 w-4" /> Accept & Populate Form
      </Button>
    </div>
  )
}
