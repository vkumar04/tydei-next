"use client"

/**
 * Upload Proposal tab (spec §subsystem-1 + §subsystem-7).
 *
 * - PDF dropzone
 * - On drop: extracts via `/api/ai/extract-contract`, scores via
 *   `analyzeProposal`, and runs clause analysis via `analyzeUploadedPDF`
 * - Renders the scored proposal + COG spend-pattern sidebar (§subsystem-8)
 *   + clause analyzer panel
 */

import { useCallback, useState } from "react"
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
import { FileText, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import type {
  AnalysisPhase,
  ClauseAnalysis,
  ScoredProposal,
  VendorOption,
} from "./types"
import {
  useAnalyzePDFClauses,
  useAnalyzeProspectiveProposal,
  useExtractAndAnalyzeCanonical,
} from "./hooks"
import { ScoredProposalCard } from "./scored-proposal-card"
import { CogSpendPatternCard } from "./cog-spend-pattern-card"
import { PdfClauseAnalyzerPanel } from "./pdf-clause-analyzer-panel"
import { CanonicalClauseAnalyzerPanel } from "./canonical-clause-analyzer-panel"
import type { AnalyzeProposalInput } from "@/lib/actions/prospective-analysis"
import type {
  ContractVariant,
  PDFContractAnalysisResult,
  UserSide,
} from "@/lib/contracts/clause-risk-analyzer"

const CONTRACT_VARIANT_OPTIONS: { value: ContractVariant; label: string }[] = [
  { value: "USAGE_SPEND", label: "Usage — Spend tiers" },
  { value: "USAGE_VOLUME", label: "Usage — Volume tiers" },
  { value: "USAGE_CARVEOUT", label: "Usage — Carve-out" },
  { value: "USAGE_MARKET_SHARE", label: "Usage — Market share" },
  { value: "USAGE_CAPITATED", label: "Usage — Capitated" },
  { value: "USAGE_TIEIN", label: "Usage — Tie-in" },
  { value: "CAPITAL_PURCHASE", label: "Capital — Purchase" },
  { value: "CAPITAL_LEASE", label: "Capital — Lease" },
  { value: "CAPITAL_TIEIN", label: "Capital — Tie-in" },
  { value: "SERVICE_MAINTENANCE", label: "Service — Maintenance" },
  { value: "SERVICE_FULL", label: "Service — Full-service" },
  { value: "GPO", label: "GPO" },
  { value: "PRICING_ONLY", label: "Pricing only" },
]

interface UploadProposalTabProps {
  vendors: VendorOption[]
  selectedVendorId: string | null
  onVendorChange: (vendorId: string | null) => void
  onProposalScored: (proposal: ScoredProposal) => void
  lastScored: ScoredProposal | null
  phase: AnalysisPhase
  onPhaseChange: (phase: AnalysisPhase) => void
}

interface ExtractedContract {
  contractName: string
  vendorName: string
  contractType: string
  effectiveDate: string
  expirationDate: string
  totalValue?: number
  description?: string
  terms: {
    termName: string
    termType: string
    tiers: {
      tierNumber: number
      spendMin?: number
      spendMax?: number
      rebateValue?: number
    }[]
  }[]
}

/**
 * Map AI-extracted contract data to a scoring input with reasonable
 * fallbacks. Users can re-enter via the manual tab if any field needs
 * refinement — this path optimizes for "drop a PDF, see a score".
 */
function buildScoringInput(
  extracted: ExtractedContract,
  currentSpend: number,
): AnalyzeProposalInput {
  const proposedAnnualSpend = extracted.totalValue ?? currentSpend * 1
  const topTierRate =
    extracted.terms
      .flatMap((t) => t.tiers)
      .map((t) => t.rebateValue ?? 0)
      .reduce((max, v) => (v > max ? v : max), 0) || 0

  const topTierMinSpend =
    extracted.terms
      .flatMap((t) => t.tiers)
      .map((t) => t.spendMin ?? 0)
      .reduce((max, v) => (v > max ? v : max), 0) || 0

  // Contract duration in years — rough parse; defaults to 3 if we can't tell.
  let termYears = 3
  if (extracted.effectiveDate && extracted.expirationDate) {
    const start = new Date(extracted.effectiveDate).getTime()
    const end = new Date(extracted.expirationDate).getTime()
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      termYears = Math.max(
        1,
        Math.round((end - start) / (365.25 * 24 * 3600 * 1000)),
      )
    }
  }

  return {
    proposedAnnualSpend,
    currentSpend,
    priceVsMarket: 0,
    minimumSpend: topTierMinSpend,
    proposedRebateRate: topTierRate,
    termYears,
    exclusivity: false,
    marketShareCommitment: null,
    minimumSpendIsHighPct:
      currentSpend > 0 ? topTierMinSpend > currentSpend * 0.8 : false,
    priceProtection: false,
    paymentTermsNet60Or90: false,
    volumeDiscountAbove5Percent: false,
  }
}

export function UploadProposalTab({
  vendors,
  selectedVendorId,
  onVendorChange,
  onProposalScored,
  lastScored,
  phase,
  onPhaseChange,
}: UploadProposalTabProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [clauseAnalysis, setClauseAnalysis] = useState<ClauseAnalysis | null>(
    lastScored?.clauseAnalysis ?? null,
  )
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [clauseText, setClauseText] = useState("")
  const [side, setSide] = useState<UserSide>("FACILITY")
  const [contractVariant, setContractVariant] =
    useState<ContractVariant>("USAGE_SPEND")
  const [canonicalResult, setCanonicalResult] = useState<{
    analysis: PDFContractAnalysisResult
    extractedClauseCount: number
    truncated: boolean
  } | null>(null)

  const analyzeMutation = useAnalyzeProspectiveProposal()
  const clauseMutation = useAnalyzePDFClauses()
  const canonicalMutation = useExtractAndAnalyzeCanonical()

  const handleAnalyzeClauses = useCallback(async () => {
    const trimmed = clauseText.trim()
    if (!trimmed) {
      toast.error("Paste contract text first.")
      return
    }
    // Run both analyzers in parallel — legacy 0-10 panel + canonical
    // 0-100 panel — so the user sees both views from one click.
    const legacy = clauseMutation
      .mutateAsync({
        pdfText: trimmed,
        fileName: uploadedFileName ?? undefined,
      })
      .then((result) => {
        setClauseAnalysis(result)
      })
      .catch(() => {
        // mutation toast handles user-facing error
      })

    const canonical = canonicalMutation
      .mutateAsync({
        pdfText: trimmed,
        side,
        contractVariant,
        contractName: uploadedFileName ?? "Pasted contract text",
      })
      .then((result) => {
        setCanonicalResult(result)
      })
      .catch(() => {
        // mutation toast handles user-facing error
      })

    await Promise.all([legacy, canonical])
    toast.success("Clause analysis complete")
  }, [
    canonicalMutation,
    clauseMutation,
    clauseText,
    contractVariant,
    side,
    uploadedFileName,
  ])

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase()
      if (ext !== "pdf") {
        toast.error("Only PDF proposals are supported here.")
        return
      }

      onPhaseChange("analyzing")
      setUploadedFileName(file.name)
      setCanonicalResult(null)

      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append(
          "userInstructions",
          "Extract pricing, rebate tiers, term dates, and total contract value.",
        )
        const res = await fetch("/api/ai/extract-contract", {
          method: "POST",
          body: formData,
        })
        if (!res.ok) {
          const body = (await res
            .json()
            .catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? "PDF extraction failed")
        }
        const json = (await res.json()) as {
          extracted: ExtractedContract
          pdfText?: string
        }
        const extracted = json.extracted
        // Use proposed total as current-spend fallback (spec §2: no external
        // benchmark data → current spend = proposed annual on unknown vendors).
        const currentSpend = extracted.totalValue ?? 0
        const input = buildScoringInput(extracted, currentSpend)

        const result = await analyzeMutation.mutateAsync(input)

        const scored: ScoredProposal = {
          id: `upl-${Date.now().toString(36)}`,
          vendorName: extracted.vendorName || "Unknown vendor",
          createdAt: new Date().toISOString(),
          source: "upload",
          input,
          result,
          clauseAnalysis: null,
        }
        onProposalScored(scored)
        onPhaseChange("complete")
        toast.success("Proposal scored")

        // Kick off the canonical (24-category, side-aware) clause
        // analyzer in the background so the user gets the rich clause
        // breakdown without a second click. Failures are toasted but
        // do not roll back the scoring step above.
        const pdfText = json.pdfText?.trim() ?? ""
        if (pdfText.length > 0) {
          try {
            const contractName =
              extracted.contractName ||
              extracted.vendorName ||
              file.name.replace(/\.pdf$/i, "")
            const canonical = await canonicalMutation.mutateAsync({
              pdfText,
              side,
              contractVariant,
              contractName,
            })
            setCanonicalResult(canonical)
            toast.success(
              `Canonical clause analysis: ${canonical.extractedClauseCount} clause${
                canonical.extractedClauseCount === 1 ? "" : "s"
              } extracted`,
            )
          } catch {
            // useExtractAndAnalyzeCanonical surfaces a toast already.
          }
        } else {
          toast.message(
            "PDF had no recoverable text layer — canonical clause analyzer skipped (paste text below to run manually).",
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Analysis failed"
        toast.error(msg)
        onPhaseChange("error")
      }
    },
    [
      analyzeMutation,
      canonicalMutation,
      contractVariant,
      onPhaseChange,
      onProposalScored,
      side,
    ],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const onBrowse = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".pdf"
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) void handleFile(file)
    }
    input.click()
  }, [handleFile])

  const isAnalyzing = phase === "analyzing"

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload vendor proposal (PDF)</CardTitle>
            <CardDescription>
              Drop a proposal PDF — we extract terms, score 5 dimensions, and
              flag clause risks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Vendor (for spend-pattern sidebar)</Label>
                <Select
                  value={selectedVendorId ?? ""}
                  onValueChange={(v) => onVendorChange(v || null)}
                >
                  <SelectTrigger>
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
              </div>
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
                  value={contractVariant}
                  onValueChange={(v) =>
                    setContractVariant(v as ContractVariant)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_VARIANT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

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
              className={`w-full border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              } ${isAnalyzing ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
            >
              {isAnalyzing ? (
                <div className="space-y-3">
                  <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
                  <p className="text-muted-foreground text-sm">
                    Extracting + scoring… this can take up to 2 minutes.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <p className="font-medium">Drop a PDF here</p>
                  <p className="text-xs text-muted-foreground">
                    or click to browse
                  </p>
                </div>
              )}
            </button>
          </CardContent>
        </Card>

        {lastScored ? <ScoredProposalCard proposal={lastScored} /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Clause analyzer
            </CardTitle>
            <CardDescription>
              Paste contract text (or copy from the PDF) to run the
              deterministic 25-clause risk scan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={clauseText}
              onChange={(e) => setClauseText(e.target.value)}
              placeholder="Paste contract clauses here…"
              rows={6}
            />
            <Button
              onClick={handleAnalyzeClauses}
              disabled={
                clauseMutation.isPending ||
                canonicalMutation.isPending ||
                clauseText.trim().length === 0
              }
            >
              {clauseMutation.isPending || canonicalMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                "Analyze clauses"
              )}
            </Button>
          </CardContent>
        </Card>

        {canonicalResult ? (
          <CanonicalClauseAnalyzerPanel
            result={canonicalResult.analysis}
            extractedClauseCount={canonicalResult.extractedClauseCount}
            truncated={canonicalResult.truncated}
          />
        ) : canonicalMutation.isPending ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Running canonical clause analyzer…
            </CardContent>
          </Card>
        ) : null}

        {clauseAnalysis ? (
          <PdfClauseAnalyzerPanel
            analysis={clauseAnalysis}
            fileName={uploadedFileName ?? undefined}
          />
        ) : null}
      </div>

      <div className="space-y-6">
        <CogSpendPatternCard
          vendorId={selectedVendorId}
          vendorName={
            vendors.find((v) => v.id === selectedVendorId)?.displayName ??
            vendors.find((v) => v.id === selectedVendorId)?.name ??
            undefined
          }
        />
      </div>
    </div>
  )
}
