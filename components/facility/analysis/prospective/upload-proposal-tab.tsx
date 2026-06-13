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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
  RotateCcw,
} from "lucide-react"
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
import { ProposalReportPrint } from "./proposal-report-print"
import {
  getVendorLookbackComparison,
  type AnalyzeProposalInput,
  type LookbackExtractedTier,
  type VendorLookbackComparison,
} from "@/lib/actions/prospective-analysis"
import { getCogPricingBenchmarks } from "@/lib/actions/prospective"
import {
  matchVendorOptionByName,
  resolveAnalysisVendorId,
  vendorNamesLooselyMatch,
} from "@/lib/prospective-analysis/analysis-vendor"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import {
  readPricingRows,
  pricingRowsToItems,
  ANALYZER_PRICE_FILE_SPECS,
} from "./pricing-file-reader"
import {
  PricingFileDropzone,
  type PricingFileDropzoneHandle,
} from "@/components/shared/uploads/pricing-file-dropzone"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
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
  /**
   * Start-over hook (bug-bash C1): the parent owns `lastScored` (via the
   * scored-proposals list), so a full reset must clear it there too —
   * otherwise a stale verdict re-renders from props after the local state
   * clears.
   */
  onReset?: () => void
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
  onReset,
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
  // Bug-round 2026-06-12 R2: vendor precedence. The PDF-detected vendor name
  // (raw, from extraction) and the extracted spend tiers are kept so the
  // lookback can be RE-RUN when the user changes the dropdown after the PDF
  // already resolved a different vendor — a manual selection wins everywhere.
  const [detectedVendorName, setDetectedVendorName] = useState<string | null>(
    null,
  )
  const [extractedSpendTiers, setExtractedSpendTiers] = useState<
    LookbackExtractedTier[] | null
  >(null)
  // R2 mismatch guard: set when the price file has lines but ZERO matched the
  // analysis vendor's COG history. `matchesOtherVendor` = an unscoped probe
  // found the same SKUs in COG under some other vendor.
  const [pricingVendorMismatch, setPricingVendorMismatch] = useState<{
    vendorName: string
    matchesOtherVendor: boolean
  } | null>(null)
  // R2: parsed (pre-join) price-file lines, kept so the COG join can re-run
  // when the user corrects the Vendor dropdown after the file was analyzed.
  const [pricingFileItems, setPricingFileItems] = useState<{
    items: PricingFileItem[]
    fileName: string
  } | null>(null)

  const analyzeMutation = useAnalyzeProspectiveProposal()
  const clauseMutation = useAnalyzePDFClauses()
  const canonicalMutation = useExtractAndAnalyzeCanonical()

  // ── R2 vendor precedence: manual selection wins; PDF detection fills ──
  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) ?? null,
    [vendors, selectedVendorId],
  )
  const analysisVendorId = resolveAnalysisVendorId(
    selectedVendorId,
    lookback?.vendorId ?? null,
  )
  const analysisVendorName = selectedVendor
    ? (selectedVendor.displayName ?? selectedVendor.name)
    : (lookback?.vendorName ?? lastScored?.vendorName ?? null)
  // PDF detection disagrees with an explicit manual pick → visible notice
  // instead of a silent override (we analyze as the SELECTION).
  const vendorConflict = Boolean(
    selectedVendor &&
      detectedVendorName &&
      !vendorNamesLooselyMatch(detectedVendorName, selectedVendor.name) &&
      !vendorNamesLooselyMatch(detectedVendorName, selectedVendor.displayName),
  )
  // Mirror of `selectedVendorId` for async callbacks (the lookback promise
  // resolves long after launch — the closure value would be stale).
  const selectedVendorIdRef = useRef(selectedVendorId)
  selectedVendorIdRef.current = selectedVendorId

  // Bumped by Start over (bug-bash C1) so an in-flight analysis promise
  // that resolves AFTER the reset can't repopulate the cleared state —
  // each async path captures the generation at launch and bails if it
  // changed.
  const resetGenRef = useRef(0)

  // R2: which vendor the most recent lookback request was issued for —
  // stops the re-fetch effect below from retry-looping when a lookback
  // legitimately resolves to nothing for that selection.
  const lookbackRequestedVendorRef = useRef<string | null>(null)

  // ── Price file: COG join → variance analysis (re-runnable) ──────────
  // Which vendor drove the most recent join — lets the re-join effect below
  // fire only when the analysis vendor actually changed.
  const lastPricingJoinVendorRef = useRef<string | null>(null)
  const joinAndAnalyzePricing = useCallback(
    async (items: PricingFileItem[], fileName: string, gen: number) => {
      // R2: a manual dropdown selection wins over the PDF-detected vendor
      // (the old `lookback?.vendorId ?? selectedVendorId` let auto-detect
      // beat an explicit pick — the DePuy-PDF/Arthrex-selection bug).
      const vendorIdForJoin = resolveAnalysisVendorId(
        selectedVendorIdRef.current,
        lookback?.vendorId ?? null,
      )
      lastPricingJoinVendorRef.current = vendorIdForJoin
      const benchmarks = await getCogPricingBenchmarks({
        itemNumbers: items.map((i) => i.itemNumber),
        vendorId: vendorIdForJoin,
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

      // R2 mismatch guard ("require a mapping based on COGs"): the file
      // has lines but ZERO matched the analysis vendor's COG history —
      // almost certainly a vendor-selection mix-up. Probe the same SKUs
      // WITHOUT the vendor filter (the query is already bounded to the
      // file's SKUs, so the unscoped pass is cheap) to tell "wrong
      // vendor" apart from "items genuinely absent from COG".
      let mismatch: { vendorName: string; matchesOtherVendor: boolean } | null =
        null
      if (
        vendorIdForJoin &&
        result.summary.totalItems > 0 &&
        result.summary.itemsWithCOGMatch === 0
      ) {
        const selected = vendors.find((v) => v.id === vendorIdForJoin)
        const vendorLabel =
          selected?.displayName ??
          selected?.name ??
          lookback?.vendorName ??
          "the selected vendor"
        const unscoped = await getCogPricingBenchmarks({
          itemNumbers: items.map((i) => i.itemNumber),
          vendorId: null,
        }).catch(() => [])
        mismatch = {
          vendorName: vendorLabel,
          matchesOtherVendor: unscoped.length > 0,
        }
      }

      if (resetGenRef.current !== gen) return // Start over won the race
      setPricingVendorMismatch(mismatch)
      setPricingAnalysis(result)
      setPricingFileName(fileName)
      setPricingFileItems({ items, fileName })
      toast.success(
        `Price file analyzed — ${result.summary.itemsWithCOGMatch} of ${result.summary.totalItems} lines matched to COG`,
      )
    },
    [lookback?.vendorId, lookback?.vendorName, vendors],
  )

  // Uploader improvements 1 (2026-06-13): headless shared dropzone —
  // the analyzer keeps its own two-card dropzone VISUAL (happy path
  // stays zero-friction, no confirm dialog when items parse), and the
  // mapping dialog only opens via ref.openWithFile when auto-detection
  // yields 0 items (replacing the old dead-end toast). Imperative opens
  // log header telemetry inside the dropzone (feature 2d).
  const mappingFallbackRef = useRef<PricingFileDropzoneHandle>(null)

  // ── Price file: parse → COG join → variance analysis ────────────────
  const handlePricingFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!["csv", "xls", "xlsx"].includes(ext)) {
        toast.error("Price file must be CSV or Excel.")
        return
      }
      const gen = resetGenRef.current
      setPricingAnalyzing(true)
      try {
        const { headers, rows } = await readPricingRows(file)
        const items = pricingRowsToItems(headers, rows)
        if (items.length === 0) {
          // Column-mapper fallback (uploader improvements 1): let the
          // user map the columns manually instead of dead-ending.
          mappingFallbackRef.current?.openWithFile(file)
          return
        }
        await joinAndAnalyzePricing(items, file.name, gen)
      } catch (err) {
        if (resetGenRef.current !== gen) return
        toast.error(err instanceof Error ? err.message : "Price file parse failed")
      } finally {
        setPricingAnalyzing(false)
      }
    },
    [joinAndAnalyzePricing],
  )

  // Import path for the manual-mapping fallback dialog: same join +
  // variance pipeline, with the user's columns overriding auto-detect.
  const handleMappedPricingImport = useCallback(
    async (
      rows: Record<string, string>[],
      mapping: ResolvedMapping,
      meta: { fileName: string; headers: string[] },
    ) => {
      const items = pricingRowsToItems(meta.headers, rows, mapping)
      if (items.length === 0) {
        // Thrown so the dropzone toasts it and keeps the dialog open
        // for another mapping attempt.
        throw new Error(
          "no items found with this mapping — the mapped item-number column has no values.",
        )
      }
      const gen = resetGenRef.current
      setPricingAnalyzing(true)
      try {
        await joinAndAnalyzePricing(items, meta.fileName, gen)
      } finally {
        if (resetGenRef.current === gen) setPricingAnalyzing(false)
      }
    },
    [joinAndAnalyzePricing],
  )

  // ── R2: re-run the COG join when the analysis vendor changes ────────
  // Whoever changed it (manual dropdown correction, or the PDF lookback
  // resolving after the price file was already analyzed), the pricing
  // comparison must follow the SAME vendor-precedence rule as everything
  // else. The ref records which vendor the last join used so this only
  // fires on a real change.
  useEffect(() => {
    if (!pricingFileItems || pricingAnalyzing) return
    if (lastPricingJoinVendorRef.current === analysisVendorId) return
    const gen = resetGenRef.current
    setPricingAnalyzing(true)
    joinAndAnalyzePricing(pricingFileItems.items, pricingFileItems.fileName, gen)
      .catch((err) => {
        if (resetGenRef.current !== gen) return
        toast.error(
          err instanceof Error ? err.message : "Price re-analysis failed",
        )
      })
      .finally(() => {
        if (resetGenRef.current === gen) setPricingAnalyzing(false)
      })
  }, [analysisVendorId, pricingFileItems, pricingAnalyzing, joinAndAnalyzePricing])

  // ── Manual clause paste (fallback for scanned PDFs) ─────────────────
  const handleAnalyzeClauses = useCallback(async () => {
    const trimmed = clauseText.trim()
    if (!trimmed) {
      toast.error("Paste contract text first.")
      return
    }
    const gen = resetGenRef.current
    const variant =
      variantOverride === "auto" ? "USAGE_SPEND" : variantOverride
    const legacy = clauseMutation
      .mutateAsync({
        pdfText: trimmed,
        fileName: uploadedFileName ?? undefined,
      })
      .then((result) => {
        if (resetGenRef.current === gen) setClauseAnalysis(result)
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
        if (resetGenRef.current === gen) setCanonicalResult(result)
      })
      .catch(() => {
        // mutation toast handles user-facing error
      })

    await Promise.all([legacy, canonical])
    if (resetGenRef.current === gen) toast.success("Clause analysis complete")
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

      const gen = resetGenRef.current
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
        if (resetGenRef.current !== gen) return // Start over won the race

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
        const extractedTiers: LookbackExtractedTier[] = spendTerms.flatMap(
          (t) =>
            (t.tiers ?? []).map((tier) => ({
              tierNumber: tier.tierNumber,
              spendMin: tier.spendMin ?? 0,
              rebateValue: tier.rebateValue ?? 0,
            })),
        )
        // R2: keep the detection + tiers around so (a) a PDF-vs-selection
        // conflict is visible, (b) the lookback can re-run if the user
        // changes the vendor AFTER this analysis (manual pick wins).
        setDetectedVendorName(extracted.vendorName?.trim() || null)
        setExtractedSpendTiers(extractedTiers)
        // Manual selection wins server-side too: vendorId beats vendorName
        // in getVendorLookbackComparison's resolution order.
        lookbackRequestedVendorRef.current = selectedVendorId
        void getVendorLookbackComparison({
          vendorId: selectedVendorId,
          vendorName: extracted.vendorName ?? null,
          extractedTiers,
        })
          .then((result) => {
            if (resetGenRef.current !== gen) return
            setLookback(result)
            // R2: PDF auto-detection only FILLS THE GAP — and when it does,
            // reflect it in the dropdown so the user sees which vendor the
            // analysis is running as (instead of a silent invisible pick).
            if (!selectedVendorIdRef.current && result.vendorId) {
              const inList = vendors.some((v) => v.id === result.vendorId)
              const byName = inList
                ? null
                : matchVendorOptionByName(vendors, result.vendorName)
              if (inList) onVendorChange(result.vendorId)
              else if (byName) onVendorChange(byName.id)
            }
          })
          .catch((err) => {
            if (resetGenRef.current !== gen) return
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
            if (resetGenRef.current !== gen) return
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
        if (resetGenRef.current !== gen) return // post-reset phase stays idle
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
      onVendorChange,
      selectedVendorId,
      side,
      vendors,
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

  // ── R2: changing the Vendor dropdown AFTER the PDF analysis re-runs the
  // lookback as the selected vendor — the manual pick wins everywhere, not
  // just on the next upload.
  useEffect(() => {
    if (!selectedVendorId || !extractedSpendTiers) return
    if (lookbackLoading) return
    if (lookback?.vendorId === selectedVendorId) return
    if (lookbackRequestedVendorRef.current === selectedVendorId) return
    lookbackRequestedVendorRef.current = selectedVendorId
    const gen = resetGenRef.current
    setLookbackLoading(true)
    getVendorLookbackComparison({
      vendorId: selectedVendorId,
      extractedTiers: extractedSpendTiers,
    })
      .then((result) => {
        if (resetGenRef.current === gen) setLookback(result)
      })
      .catch((err) => {
        if (resetGenRef.current !== gen) return
        toast.error(
          err instanceof Error ? err.message : "12-month lookback failed",
        )
      })
      .finally(() => {
        if (resetGenRef.current === gen) setLookbackLoading(false)
      })
  }, [selectedVendorId, extractedSpendTiers, lookback, lookbackLoading])

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

  // Any analysis output on screen → show Export / Start over (bug-bash C1).
  const hasAnalysis = Boolean(
    lastScored || pricingAnalysis || canonicalResult || clauseAnalysis || lookback,
  )

  // ── Start over: clear EVERY piece of analysis state, local AND parent
  // (`lastScored` lives in the orchestrator's scored-proposals list — a
  // partial clear leaves a stale verdict re-rendering from props).
  const handleStartOver = useCallback(() => {
    resetGenRef.current += 1
    setClauseAnalysis(null)
    setUploadedFileName(null)
    setClauseText("")
    setSide("FACILITY")
    setVariantOverride("auto")
    setCanonicalResult(null)
    setLookback(null)
    setLookbackLoading(false)
    setPricingAnalysis(null)
    setPricingFileName(null)
    setPricingAnalyzing(false)
    setDetectedVendorName(null)
    setExtractedSpendTiers(null)
    setPricingVendorMismatch(null)
    setPricingFileItems(null)
    lookbackRequestedVendorRef.current = null
    lastPricingJoinVendorRef.current = null
    onReset?.()
    onPhaseChange("idle")
    toast.success("Analysis cleared — drop a new contract PDF to start over")
  }, [onReset, onPhaseChange])

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
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

        {/* ── Export / Start over (bug-bash C1: "Need a way to export/save
             the report and to clear the data and start over.") ─────────── */}
        {hasAnalysis ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Export report
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Start over
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear this analysis?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The verdict, scoring, lookback, price-file comparison, and
                    legal scan will be cleared so you can analyze a new
                    proposal. Export the report first if you want to keep it.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleStartOver}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Clear and start over
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}

        {/* ── The answer first, evidence below ─────────────────────────── */}
        {verdict && lastScored ? (
          <ProposalVerdictCard
            verdict={verdict}
            vendorName={analysisVendorName ?? lastScored.vendorName}
          />
        ) : null}

        {lastScored ? <ScoredProposalCard proposal={lastScored} /> : null}

        {lastScored ? (
          <ProposalLookbackCard
            lookback={lookback}
            isLoading={lookbackLoading}
          />
        ) : null}

        {/* R2 mismatch guard: price file has lines but NONE matched the
            analysis vendor's COG history — loud inline warning, not a
            toast, because the verdict below is unverified until the
            vendor mapping is right. */}
        {pricingVendorMismatch && pricingAnalysis ? (
          <Alert className="border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>
              Price file doesn&rsquo;t match {pricingVendorMismatch.vendorName}
              &rsquo;s purchase history
            </AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              <p>
                None of the price file&rsquo;s items match{" "}
                {pricingVendorMismatch.vendorName}&rsquo;s purchase history —
                check the Vendor selection. The price file may belong to a
                different vendor.
                {pricingVendorMismatch.matchesOtherVendor
                  ? " These items DO appear in your COG history under a different vendor — the Vendor selection above is almost certainly wrong for this file."
                  : ""}
              </p>
            </AlertDescription>
          </Alert>
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
        {/* R2: manual selection wins — the old `lookback?.vendorId ??
            selectedVendorId` let the PDF-detected vendor drive Spend
            patterns even when the user explicitly picked another vendor. */}
        <CogSpendPatternCard
          vendorId={analysisVendorId}
          vendorName={analysisVendorName ?? undefined}
        />
      </div>
    </div>

    {/* Print-only report — `window.print()` from "Export report" shows ONLY
        this (the interactive grid above is print:hidden; the app shell is
        hidden by the scoped @media print rule in app/globals.css). */}
    {hasAnalysis ? (
      <ProposalReportPrint
        vendorName={analysisVendorName}
        contractFileName={uploadedFileName}
        pricingFileName={pricingFileName}
        verdict={verdict}
        scored={lastScored}
        lookback={lookback}
        pricing={pricingAnalysis}
        legal={canonicalResult?.analysis ?? null}
      />
    ) : null}
    </>
  )
}
