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
 *
 * Decomposed 2026-08-05 (behavior-preserving): pure helpers live in
 * ./upload-proposal/scoring-helpers + ./upload-proposal/verdict-signals,
 * the two async pipelines in ./upload-proposal/use-pricing-analysis +
 * ./upload-proposal/use-proposal-pdf-analysis (sharing ONE
 * AnalysisSessionRefs instance), and the inputs card in
 * ./upload-proposal/proposal-inputs-card. This file orchestrates.
 */

import { useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
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
import { AlertTriangle, Loader2, Printer, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import type { AnalysisPhase, ScoredProposal, VendorOption } from "./types"
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
  resolveAnalysisVendorId,
  vendorNamesLooselyMatch,
} from "@/lib/prospective-analysis/analysis-vendor"
import { synthesizeProposalVerdict } from "@/lib/prospective-analysis/proposal-verdict"
import { useAnalysisSessionRefs } from "./upload-proposal/analysis-session"
import {
  legalSignalFrom,
  lookbackSignalFrom,
  pricingSignalFrom,
} from "./upload-proposal/verdict-signals"
import { usePricingAnalysis } from "./upload-proposal/use-pricing-analysis"
import { useProposalPdfAnalysis } from "./upload-proposal/use-proposal-pdf-analysis"
import { ProposalInputsCard } from "./upload-proposal/proposal-inputs-card"

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
  // ONE shared refs instance for both pipelines + Start over — the
  // reset-generation guard and the cross-order re-score behaviors
  // (pricing-then-PDF vs PDF-then-pricing) depend on it.
  const session = useAnalysisSessionRefs({
    selectedVendorId,
    lastScored,
    onProposalScored,
  })

  const analyzeMutation = useAnalyzeProspectiveProposal()
  const clauseMutation = useAnalyzePDFClauses()
  const canonicalMutation = useExtractAndAnalyzeCanonical()

  const {
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
  } = useProposalPdfAnalysis({
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
  })

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

  const {
    pricingAnalysis,
    pricingFileName,
    pricingAnalyzing,
    pricingPhase,
    pricingMatchCount,
    pricingVendorMismatch,
    mappingFallbackRef,
    handlePricingFile,
    handleMappedPricingImport,
    resetPricingAnalysis,
  } = usePricingAnalysis({
    session,
    vendors,
    lookback,
    analysisVendorId,
    analyzeMutation,
  })

  const isAnalyzing = phase === "analyzing"

  // ── The verdict: one answer from all four signals ────────────────────
  // Live analysis state wins; the evaluation's PERSISTED signals back-fill
  // after a reload, so the verdict matches what was shown at score time
  // instead of being re-synthesized from the score alone (F-C3).
  const verdict = useMemo(() => {
    if (!lastScored) return null
    const lb =
      lookbackSignalFrom(lookback) ?? lastScored.signals?.lookback ?? null
    const legal =
      legalSignalFrom(canonicalResult) ?? lastScored.signals?.legal ?? null
    const pricing =
      pricingSignalFrom(pricingAnalysis) ?? lastScored.signals?.pricing ?? null
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
  // partial clear leaves a stale verdict re-rendering from props). The gen
  // bump comes FIRST so in-flight promises bail; the two pipeline resets
  // together cover every atom the old inline clear did.
  const handleStartOver = useCallback(() => {
    session.resetGenRef.current += 1
    resetPdfAnalysis()
    resetPricingAnalysis()
    onReset?.()
    onPhaseChange("idle")
    toast.success("Analysis cleared — drop a new contract PDF to start over")
  }, [session, resetPdfAnalysis, resetPricingAnalysis, onReset, onPhaseChange])

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
      <div className="lg:col-span-2 space-y-6">
        {/* ── Inputs: PDF + price file, one card ─────────────────────── */}
        <ProposalInputsCard
          vendors={vendors}
          selectedVendorId={selectedVendorId}
          onVendorChange={onVendorChange}
          vendorConflict={vendorConflict}
          detectedVendorName={detectedVendorName}
          analysisVendorName={analysisVendorName}
          isAnalyzing={isAnalyzing}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          onDrop={onDrop}
          onBrowse={onBrowse}
          uploadedFileName={uploadedFileName}
          pricingAnalyzing={pricingAnalyzing}
          pricingPhase={pricingPhase}
          pricingMatchCount={pricingMatchCount}
          pricingFileName={pricingFileName}
          handlePricingFile={handlePricingFile}
          mappingFallbackRef={mappingFallbackRef}
          handleMappedPricingImport={handleMappedPricingImport}
          side={side}
          setSide={setSide}
          variantOverride={variantOverride}
          setVariantOverride={setVariantOverride}
          clauseText={clauseText}
          setClauseText={setClauseText}
          handleAnalyzeClauses={handleAnalyzeClauses}
          clausePending={clauseMutation.isPending}
          canonicalPending={canonicalMutation.isPending}
        />

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
                  <AlertDialogTitle>Clear upload evaluations?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears the verdict, scoring, lookback, price-file
                    comparison, and legal scan — and deletes{" "}
                    <strong>
                      every saved upload evaluation for your facility
                    </strong>
                    , including ones saved by teammates in earlier sessions.
                    Manually-entered evaluations are kept. Export the report
                    first if you want to keep it.
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
