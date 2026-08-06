import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type {
  AnalysisPhase,
  ClauseAnalysis,
  ScoredProposal,
  VendorOption,
} from "../types"
import type {
  useAnalyzePDFClauses,
  useAnalyzeProspectiveProposal,
  useExtractAndAnalyzeCanonical,
} from "../hooks"
import {
  getVendorLookbackComparison,
  type LookbackExtractedTier,
  type VendorLookbackComparison,
} from "@/lib/actions/prospective-analysis"
import { matchVendorOptionByName } from "@/lib/prospective-analysis/analysis-vendor"
import type {
  ContractVariant,
  PDFContractAnalysisResult,
  UserSide,
} from "@/lib/contracts/clause-risk-analyzer"
import {
  buildScoringInput,
  deriveContractVariant,
  isSpendDollarTerm,
  priceVsMarketFromAnalysis,
  type ExtractedContract,
} from "./scoring-helpers"
import {
  legalSignalFrom,
  lookbackSignalFrom,
  pricingSignalFrom,
} from "./verdict-signals"
import type { AnalysisSessionRefs } from "./analysis-session"

/**
 * Contract-PDF pipeline of the proposal analyzer (extracted verbatim from
 * upload-proposal-tab.tsx): extract → score → 12-month lookback → legal
 * scan, plus the manual clause-paste fallback and the R2 re-run-lookback-
 * on-vendor-change effect. Shares the session refs with the pricing
 * pipeline so the reset-generation guard and the pricing-then-PDF score
 * feed keep working across both.
 */
export function useProposalPdfAnalysis({
  session,
  vendors,
  selectedVendorId,
  onVendorChange,
  onProposalScored,
  lastScored,
  onPhaseChange,
  analyzeMutation,
  clauseMutation,
  canonicalMutation,
}: {
  session: AnalysisSessionRefs
  vendors: VendorOption[]
  selectedVendorId: string | null
  onVendorChange: (vendorId: string | null) => void
  onProposalScored: (proposal: ScoredProposal) => void
  lastScored: ScoredProposal | null
  onPhaseChange: (phase: AnalysisPhase) => void
  analyzeMutation: ReturnType<typeof useAnalyzeProspectiveProposal>
  clauseMutation: ReturnType<typeof useAnalyzePDFClauses>
  canonicalMutation: ReturnType<typeof useExtractAndAnalyzeCanonical>
}) {
  const {
    resetGenRef,
    selectedVendorIdRef,
    lookbackRequestedVendorRef,
    pricingAnalysisRef,
  } = session

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
    resetGenRef,
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

        // Spend-dollar tiers feed BOTH the lookback projection and the score's
        // top-tier rate (shared isSpendDollarTerm filter — broadened so the
        // AI's varied spend-rebate labels aren't dropped).
        const extractedTiers: LookbackExtractedTier[] = (extracted.terms ?? [])
          .filter((t) => isSpendDollarTerm(t.termType))
          .flatMap((t) =>
            (t.tiers ?? []).map((tier) => ({
              tierNumber: tier.tierNumber,
              spendMin: tier.spendMin ?? 0,
              rebateValue: tier.rebateValue ?? 0,
            })),
          )
        // R2: keep the detection + tiers around so a PDF-vs-selection conflict
        // is visible and the lookback can re-run on a later vendor change.
        setDetectedVendorName(extracted.vendorName?.trim() || null)
        setExtractedSpendTiers(extractedTiers)
        // Honesty (audit P1): if the PDF had rebate tiers but none are
        // spend-dollar (e.g. market-share / per-unit), say so — the 12-month
        // projection covers spend-rebate ladders only, so it'll read empty.
        const totalTierCount = (extracted.terms ?? []).reduce(
          (n, t) => n + (t.tiers?.length ?? 0),
          0,
        )
        if (totalTierCount > 0 && extractedTiers.length === 0) {
          toast.info(
            "Rebate tiers found, but none are spend-dollar tiers — the 12-month projection covers spend-rebate ladders only.",
          )
        }

        // Run the 12-month lookback FIRST so the score's currentSpend baseline
        // is the facility's REAL trailing-12mo spend with this vendor — not the
        // proposed contract total, which inflated savings/confidence on known
        // vendors (audit P0). Lookback failures fall back to the proposed total
        // and never block scoring.
        setLookbackLoading(true)
        setLookback(null)
        lookbackRequestedVendorRef.current = selectedVendorId
        let trailingSpend = 0
        let lookbackResult: VendorLookbackComparison | null = null
        try {
          const lb = await getVendorLookbackComparison({
            vendorId: selectedVendorId,
            vendorName: extracted.vendorName ?? null,
            extractedTiers,
          })
          if (resetGenRef.current !== gen) return
          setLookback(lb)
          lookbackResult = lb
          trailingSpend = lb.trailing12moSpend
          // PDF auto-detection only FILLS THE GAP — reflect it in the dropdown
          // so the user sees which vendor the analysis is running as.
          if (!selectedVendorIdRef.current && lb.vendorId) {
            const inList = vendors.some((v) => v.id === lb.vendorId)
            const byName = inList
              ? null
              : matchVendorOptionByName(vendors, lb.vendorName)
            if (inList) onVendorChange(lb.vendorId)
            else if (byName) onVendorChange(byName.id)
          }
        } catch (err) {
          if (resetGenRef.current !== gen) return
          toast.error(
            err instanceof Error ? err.message : "12-month lookback failed",
          )
        } finally {
          setLookbackLoading(false)
        }

        // Baseline = real trailing-12mo actuals when the vendor is known; else
        // the proposed total (spec §2: unknown vendors have no actuals).
        const currentSpend =
          trailingSpend > 0 ? trailingSpend : (extracted.totalValue ?? 0)
        // Feed price-vs-market into the score when a price file was already
        // analyzed (pricing-then-PDF order); the price-file handler re-scores
        // for the PDF-then-pricing order.
        const input = buildScoringInput(
          extracted,
          currentSpend,
          priceVsMarketFromAnalysis(pricingAnalysisRef.current),
        )

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
          // Persist what the user is about to SEE (F-C3): lookback + any
          // already-analyzed price file. The legal scan attaches below once
          // it completes.
          signals: {
            lookback: lookbackSignalFrom(lookbackResult),
            pricing: pricingSignalFrom(pricingAnalysisRef.current),
            legal: null,
          },
        }
        onProposalScored(scored)
        onPhaseChange("complete")
        toast.success("Proposal scored")

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
            // Attach the legal summary onto the persisted evaluation — the
            // orchestrator resolves this to an UPDATE of the just-saved row
            // (same client id), so View-after-reload has the legal signal.
            onProposalScored({
              ...scored,
              signals: {
                lookback: scored.signals?.lookback ?? null,
                pricing: scored.signals?.pricing ?? null,
                legal: legalSignalFrom(canonical),
              },
            })
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
      resetGenRef,
      selectedVendorIdRef,
      lookbackRequestedVendorRef,
      pricingAnalysisRef,
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
  }, [
    selectedVendorId,
    extractedSpendTiers,
    lookback,
    lookbackLoading,
    lookbackRequestedVendorRef,
    resetGenRef,
  ])

  // ── Start over (bug-bash C1): the PDF/clause half of the full clear.
  // The tab bumps resetGenRef FIRST, then calls this — it must clear
  // every PDF-pipeline atom AND the lookback-request session ref (a
  // partial clear resurrects the stale-verdict bug).
  const resetPdfAnalysis = useCallback(() => {
    setClauseAnalysis(null)
    setUploadedFileName(null)
    setClauseText("")
    setSide("FACILITY")
    setVariantOverride("auto")
    setCanonicalResult(null)
    setLookback(null)
    setLookbackLoading(false)
    setDetectedVendorName(null)
    setExtractedSpendTiers(null)
    lookbackRequestedVendorRef.current = null
  }, [lookbackRequestedVendorRef])

  return {
    isDragging,
    setIsDragging,
    clauseAnalysis,
    uploadedFileName,
    clauseText,
    setClauseText,
    side,
    setSide,
    variantOverride,
    setVariantOverride,
    canonicalResult,
    lookback,
    lookbackLoading,
    detectedVendorName,
    handleAnalyzeClauses,
    onDrop,
    onBrowse,
    resetPdfAnalysis,
  }
}
