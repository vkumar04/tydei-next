"use client"

/**
 * Inputs card of the proposal analyzer (extracted verbatim from
 * upload-proposal-tab.tsx): vendor select, the two dropzones (contract PDF +
 * price file), the headless mapping-dialog fallback, and the collapsed
 * Advanced section. Purely presentational — every handler and state atom
 * arrives as a prop; prop names match the tab's original local identifiers.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react"
import type { VendorOption } from "../types"
import { ANALYZER_PRICE_FILE_SPECS } from "../pricing-file-reader"
import {
  PricingFileDropzone,
  type PricingFileDropzoneHandle,
} from "@/components/shared/uploads/pricing-file-dropzone"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import type {
  ContractVariant,
  UserSide,
} from "@/lib/contracts/clause-risk-analyzer"
import { CONTRACT_VARIANT_OPTIONS } from "./scoring-helpers"

interface ProposalInputsCardProps {
  vendors: VendorOption[]
  selectedVendorId: string | null
  onVendorChange: (vendorId: string | null) => void
  vendorConflict: boolean
  detectedVendorName: string | null
  analysisVendorName: string | null
  // Contract-PDF dropzone
  isAnalyzing: boolean
  isDragging: boolean
  setIsDragging: (dragging: boolean) => void
  onDrop: (e: React.DragEvent) => void
  onBrowse: () => void
  uploadedFileName: string | null
  // Price-file dropzone
  pricingAnalyzing: boolean
  pricingPhase: "reading" | "matching" | null
  pricingMatchCount: number
  pricingFileName: string | null
  handlePricingFile: (file: File) => Promise<void>
  mappingFallbackRef: React.RefObject<PricingFileDropzoneHandle | null>
  handleMappedPricingImport: (
    rows: Record<string, string>[],
    mapping: ResolvedMapping,
    meta: { fileName: string; headers: string[] },
  ) => Promise<void>
  // Advanced section
  side: UserSide
  setSide: (side: UserSide) => void
  variantOverride: ContractVariant | "auto"
  setVariantOverride: (variant: ContractVariant | "auto") => void
  clauseText: string
  setClauseText: (text: string) => void
  handleAnalyzeClauses: () => void
  clausePending: boolean
  canonicalPending: boolean
}

export function ProposalInputsCard({
  vendors,
  selectedVendorId,
  onVendorChange,
  vendorConflict,
  detectedVendorName,
  analysisVendorName,
  isAnalyzing,
  isDragging,
  setIsDragging,
  onDrop,
  onBrowse,
  uploadedFileName,
  pricingAnalyzing,
  pricingPhase,
  pricingMatchCount,
  pricingFileName,
  handlePricingFile,
  mappingFallbackRef,
  handleMappedPricingImport,
  side,
  setSide,
  variantOverride,
  setVariantOverride,
  clauseText,
  setClauseText,
  handleAnalyzeClauses,
  clausePending,
  canonicalPending,
}: ProposalInputsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyze a vendor proposal</CardTitle>
        <CardDescription>
          Drop the contract PDF and the proposal&rsquo;s price file — we
          compare the terms and pricing to what you have today, flag legal
          language, and tell you if it&rsquo;s good.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            Vendor (your selection wins — auto-filled from the PDF if
            left blank)
          </Label>
          <Select
            value={selectedVendorId ?? ""}
            onValueChange={(v) => onVendorChange(v || null)}
          >
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Select vendor…" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.displayName ?? v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {vendorConflict ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                PDF looks like {detectedVendorName} — analyzing as{" "}
                {analysisVendorName} (your selection).
              </span>
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Contract PDF */}
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={onBrowse}
            disabled={isAnalyzing}
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            } ${isAnalyzing ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
          >
            {isAnalyzing ? (
              <div className="space-y-2">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">
                  Extracting terms → scoring → lookback → legal scan…
                  <br />
                  up to 2 minutes
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {uploadedFileName ?? "Contract PDF"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {uploadedFileName ? "drop to replace" : "drop or click to browse"}
                </p>
              </div>
            )}
          </button>

          {/* Price file */}
          <button
            type="button"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) void handlePricingFile(file)
            }}
            onClick={() => {
              const input = document.createElement("input")
              input.type = "file"
              input.accept = ".csv,.xlsx,.xls"
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (file) void handlePricingFile(file)
              }
              input.click()
            }}
            disabled={pricingAnalyzing}
            className={`rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center transition-colors hover:border-primary/50 ${
              pricingAnalyzing ? "opacity-60 cursor-wait" : "cursor-pointer"
            }`}
          >
            {pricingAnalyzing ? (
              <div className="space-y-2">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">
                  {pricingPhase === "matching"
                    ? `Comparing ${pricingMatchCount} line${
                        pricingMatchCount === 1 ? "" : "s"
                      } to your COG…`
                    : "Reading price file…"}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <FileSpreadsheet className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {pricingFileName ?? "Price file (CSV / XLSX)"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pricingFileName
                    ? "drop to replace"
                    : "compares every line to your COG cost"}
                </p>
              </div>
            )}
          </button>
        </div>

        {/* Headless mapping-dialog fallback for the price file
            (uploader improvements 1, 2026-06-13): trigger={null} —
            the visible dropzone above stays the entry point; this
            only opens via ref when auto-detection finds 0 items. */}
        <PricingFileDropzone
          ref={mappingFallbackRef}
          trigger={null}
          specs={ANALYZER_PRICE_FILE_SPECS}
          surface="facility-proposal-analyzer-price-file"
          accept=".csv,.xlsx,.xls"
          onImport={handleMappedPricingImport}
        />

        {/* Advanced: the old jargon controls + manual clause paste. */}
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Advanced — analysis perspective, contract variant, paste text
          </summary>
          <div className="space-y-3 pt-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Analyze as</Label>
                <Select
                  value={side}
                  onValueChange={(v) => setSide(v as UserSide)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FACILITY">Facility</SelectItem>
                    <SelectItem value="VENDOR">Vendor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Contract variant</Label>
                <Select
                  value={variantOverride}
                  onValueChange={(v) =>
                    setVariantOverride(v as ContractVariant | "auto")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      Auto (from the PDF)
                    </SelectItem>
                    {CONTRACT_VARIANT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                Scanned PDF with no text layer? Paste the contract text:
              </Label>
              <Textarea
                value={clauseText}
                onChange={(e) => setClauseText(e.target.value)}
                placeholder="Paste contract clauses here…"
                rows={5}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAnalyzeClauses}
                disabled={
                  clausePending ||
                  canonicalPending ||
                  clauseText.trim().length === 0
                }
              >
                {clausePending ||
                canonicalPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  "Run legal scan on pasted text"
                )}
              </Button>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
