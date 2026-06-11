"use client"

/**
 * Proposal analyzer (spec §subsystem-1 + §subsystem-7; reworked 2026-06-10,
 * Charles: "Needs to take the terms of a PDF and the pricing file that is
 * loaded and compare the pricing and terms to what they have and figure out
 * if it is good. Should tag any legal language issues as well. Right now the
 * UI for it is very difficult to use.").
 *
 * One flow: drop the contract PDF (+ the proposal's price file) → we
 * extract terms, score them, run the 12-month lookback against existing
 * contracts, compare every price line to COG, scan the contract language —
 * and synthesize ONE verdict (good deal / negotiate / decline) with the
 * reasons spelled out. The jargon controls ("Analyze as", "Contract
 * variant") moved into a collapsed Advanced section; the variant is
 * auto-derived from the extracted contract.
 */

import { useCallback, useMemo, useState } from "react"
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
import { FileSpreadsheet, FileText, Loader2, Upload } from "lucide-react"
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
import { ProposalLookbackCard } from "./proposal-lookback-card"
import { ProposalPricingAskCard } from "./proposal-pricing-ask-card"
import { ProposalVerdictCard } from "./proposal-verdict-card"
import {
  getVendorLookbackComparison,
  type AnalyzeProposalInput,
  type VendorLookbackComparison,
} from "@/lib/actions/prospective-analysis"
import { getCogPricingBenchmarks } from "@/lib/actions/prospective"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { readPricingRows, pricingRowsToItems } from "./pricing-file-reader"
import {
  analyzePricingFile,
  type PricingFileAnalysis,
  type PricingFileItem,
} from "@/lib/prospective-analysis/pricing-file-analysis"
import { synthesizeProposalVerdict } from "@/lib/prospective-analysis/proposal-verdict"
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
 * refinement — this path optimizes for "drop a PDF, see a verdict".
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

/**
 * Auto-derive the clause-analyzer variant from the extracted contract so
 * the user doesn't have to know the taxonomy (review of the old UI: the
 * upfront "Contract variant" select was a major usability complaint).
 */
function deriveContractVariant(extracted: ExtractedContract): ContractVariant {
  const termTypes = new Set(
    (extracted.terms ?? []).map((t) => String(t.termType ?? "").trim()),
  )
  switch (extracted.contractType) {
    case "capital":
      return "CAPITAL_PURCHASE"
    case "tie_in":
      return "CAPITAL_TIEIN"
    case "service":
      return "SERVICE_MAINTENANCE"
    case "grouped":
      return "GPO"
    case "pricing_only":
      return "PRICING_ONLY"
    default:
      if (termTypes.has("market_share")) return "USAGE_MARKET_SHARE"
      if (termTypes.has("carve_out")) return "USAGE_CARVEOUT"
      if (termTypes.has("volume_rebate")) return "USAGE_VOLUME"
      return "USAGE_SPEND"
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
  // "auto" = derive from the extracted contract; a manual pick wins.
  const [variantOverride, setVariantOverride] = useState<
    ContractVariant | "auto"
  >("auto")
  const [canonicalResult, setCanonicalResult] = useState<{
    analysis: PDFContractAnalysisResult
    extractedClauseCount: number
    truncated: boolean
  } | null>(null)
  // Charles 2026-06-10: 12-month lookback projection + price-file analysis.
  const [lookback, setLookback] = useState<VendorLookbackComparison | null>(
    null,
  )
  const [lookbackLoading, setLookbackLoading] = useState(false)
  const [pricingAnalysis, setPricingAnalysis] =
    useState<PricingFileAnalysis | null>(null)
  const [pricingFileName, setPricingFileName] = useState<string | null>(null)
  const [pricingAnalyzing, setPricingAnalyzing] = useState(false)

  const analyzeMutation = useAnalyzeProspectiveProposal()
  const clauseMutation = useAnalyzePDFClauses()
  const canonicalMutation = useExtractAndAnalyzeCanonical()

  // ── Price file: parse → COG join → variance analysis ────────────────
  const handlePricingFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!["csv", "xls", "xlsx"].includes(ext)) {
        toast.error("Price file must be CSV or Excel.")
        return
      }
      setPricingAnalyzing(true)
      try {
        const { headers, rows } = await readPricingRows(file)
        const items = pricingRowsToItems(headers, rows)
        if (items.length === 0) {
          toast.error(
            "No items found in the price file. Check it has an item-number column.",
          )
          return
        }
        const benchmarks = await getCogPricingBenchmarks({
          itemNumbers: items.map((i) => i.itemNumber),
          vendorId: lookback?.vendorId ?? selectedVendorId,
        }).catch((err) => {
          console.error("[proposal-analyzer] COG benchmark join failed:", err)
          toast.warning(
            "Couldn't load COG benchmarks — variance will only use the file's own current-price column.",
          )
          return []
        })
        const bySku = new Map(benchmarks.map((b) => [b.skuKey, b]))
        const joined: PricingFileItem[] = items.map((i) => {
          const b = bySku.get(normalizeSku(i.itemNumber))
          if (!b) return i
          return {
            ...i,
            currentPrice: b.currentPrice,
            estimatedAnnualQty: i.estimatedAnnualQty ?? b.annualQty,
          }
        })
        const result = analyzePricingFile(joined)
        setPricingAnalysis(result)
        setPricingFileName(file.name)
        toast.success(
          `Price file analyzed — ${result.summary.itemsWithCOGMatch} of ${result.summary.totalItems} lines matched to COG`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Price file parse failed")
      } finally {
        setPricingAnalyzing(false)
      }
    },
    [lookback?.vendorId, selectedVendorId],
  )

  // ── Manual clause paste (fallback for scanned PDFs) ─────────────────
  const handleAnalyzeClauses = useCallback(async () => {
    const trimmed = clauseText.trim()
    if (!trimmed) {
      toast.error("Paste contract text first.")
      return
    }
    const variant =
      variantOverride === "auto" ? "USAGE_SPEND" : variantOverride
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
        contractVariant: variant,
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
    variantOverride,
    side,
    uploadedFileName,
  ])

  // ── Contract PDF: extract → score → lookback → legal scan ───────────
  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase()
      if (ext !== "pdf") {
        toast.error("Drop the contract PDF here (price files go in the right dropzone).")
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

        // 12-month lookback + existing-contract comparison (Charles
        // 2026-06-10). Fire-and-render: failures surface inline, never roll
        // back the score above.
        setLookbackLoading(true)
        setLookback(null)
        // Review R1: only spend-dollar ladders may feed the spend projection
        // (market_share tiers store % thresholds, carve-out/fixed tiers pay
        // per-SKU or flat — the recurring type-confusion class). Terms with
        // no/unknown termType default in (most proposals are spend rebates).
        const SPEND_DOLLAR_TERM_TYPES = new Set([
          "spend_rebate",
          "growth_rebate",
          "",
        ])
        const spendTerms = (extracted.terms ?? []).filter((t) =>
          SPEND_DOLLAR_TERM_TYPES.has(String(t.termType ?? "").trim()),
        )
        void getVendorLookbackComparison({
          vendorId: selectedVendorId,
          vendorName: extracted.vendorName ?? null,
          extractedTiers: spendTerms.flatMap((t) =>
            (t.tiers ?? []).map((tier) => ({
              tierNumber: tier.tierNumber,
              spendMin: tier.spendMin ?? 0,
              rebateValue: tier.rebateValue ?? 0,
            })),
          ),
        })
          .then((result) => setLookback(result))
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : "12-month lookback failed",
            )
          })
          .finally(() => setLookbackLoading(false))

        // Legal language scan — auto-runs with the auto-derived variant
        // (manual override from the Advanced section wins).
        const pdfText = json.pdfText?.trim() ?? ""
        if (pdfText.length > 0) {
          try {
            const contractName =
              extracted.contractName ||
              extracted.vendorName ||
              file.name.replace(/\.pdf$/i, "")
            const variant =
              variantOverride === "auto"
                ? deriveContractVariant(extracted)
                : variantOverride
            const canonical = await canonicalMutation.mutateAsync({
              pdfText,
              side,
              contractVariant: variant,
              contractName,
            })
            setCanonicalResult(canonical)
            toast.success(
              `Legal scan: ${canonical.extractedClauseCount} clause${
                canonical.extractedClauseCount === 1 ? "" : "s"
              } checked`,
            )
          } catch {
            // useExtractAndAnalyzeCanonical surfaces a toast already.
          }
        } else {
          toast.message(
            "PDF had no recoverable text layer — paste the contract text under Advanced to run the legal scan.",
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
      variantOverride,
      onPhaseChange,
      onProposalScored,
      selectedVendorId,
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

  // ── The verdict: one answer from all four signals ────────────────────
  const verdict = useMemo(() => {
    if (!lastScored) return null
    const lb =
      lookback && lookback.vendorId !== null
        ? {
            trailing12moSpend: lookback.trailing12moSpend,
            predictedAnnualRebate: lookback.predicted?.annualRebate ?? null,
            predictedRatePct: lookback.predicted?.rebatePercent ?? null,
            bestExistingEffectiveRatePct: (() => {
              const rates = lookback.existingContracts
                .map((c) => c.effectiveRatePct)
                .filter((r): r is number => r !== null)
              return rates.length > 0 ? Math.max(...rates) : null
            })(),
            hasExistingContracts: lookback.existingContracts.length > 0,
          }
        : null
    const legal = canonicalResult
      ? {
          overallRiskScore: canonicalResult.analysis.overallRiskScore,
          overallRiskLevel: String(canonicalResult.analysis.overallRiskLevel),
          criticalFlagCount: canonicalResult.analysis.criticalFlags.length,
        }
      : null
    const pricing = pricingAnalysis
      ? {
          avgVariancePercent: pricingAnalysis.summary.avgVariancePercent,
          potentialSavings: pricingAnalysis.summary.potentialSavings,
          itemsWithCOGMatch: pricingAnalysis.summary.itemsWithCOGMatch,
          totalItems: pricingAnalysis.summary.totalItems,
          itemsAboveCOG: pricingAnalysis.summary.itemsAboveCOG,
        }
      : null
    return synthesizeProposalVerdict({
      scoreOverall: lastScored.result.scores.overall,
      scoreVerdict: lastScored.result.recommendation.verdict,
      pricing,
      lookback: lb,
      legal,
    })
  }, [lastScored, lookback, canonicalResult, pricingAnalysis])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* ── Inputs: PDF + price file, one card ─────────────────────── */}
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
              <Label>Vendor (optional — auto-detected from the PDF)</Label>
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
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
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
                      clauseMutation.isPending ||
                      canonicalMutation.isPending ||
                      clauseText.trim().length === 0
                    }
                  >
                    {clauseMutation.isPending ||
                    canonicalMutation.isPending ? (
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

        {/* ── The answer first, evidence below ─────────────────────────── */}
        {verdict && lastScored ? (
          <ProposalVerdictCard
            verdict={verdict}
            vendorName={lookback?.vendorName ?? lastScored.vendorName}
          />
        ) : null}

        {lastScored ? <ScoredProposalCard proposal={lastScored} /> : null}

        {lastScored ? (
          <ProposalLookbackCard
            lookback={lookback}
            isLoading={lookbackLoading}
          />
        ) : null}

        {lastScored || pricingAnalysis ? (
          <ProposalPricingAskCard
            analysis={pricingAnalysis}
            fileName={pricingFileName}
            isAnalyzing={pricingAnalyzing}
            onFile={(f) => void handlePricingFile(f)}
          />
        ) : null}

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
              Scanning contract language…
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
          vendorId={lookback?.vendorId ?? selectedVendorId}
          vendorName={
            lookback?.vendorName ??
            vendors.find((v) => v.id === selectedVendorId)?.displayName ??
            vendors.find((v) => v.id === selectedVendorId)?.name ??
            undefined
          }
        />
      </div>
    </div>
  )
}
