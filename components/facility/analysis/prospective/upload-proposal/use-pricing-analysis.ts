import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { VendorOption } from "../types"
import type { useAnalyzeProspectiveProposal } from "../hooks"
import {
  getCogPricingBenchmarks,
} from "@/lib/actions/prospective"
import type {
  AnalyzeProposalInput,
  VendorLookbackComparison,
} from "@/lib/actions/prospective-analysis"
import { resolveAnalysisVendorId } from "@/lib/prospective-analysis/analysis-vendor"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import {
  readPricingRows,
  pricingRowsToItems,
} from "../pricing-file-reader"
import type { PricingFileDropzoneHandle } from "@/components/shared/uploads/pricing-file-dropzone"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import {
  analyzePricingFile,
  type PricingFileAnalysis,
  type PricingFileItem,
} from "@/lib/prospective-analysis/pricing-file-analysis"
import { pricingSignalFrom } from "./verdict-signals"
import { priceVsMarketFromAnalysis } from "./scoring-helpers"
import type { AnalysisSessionRefs } from "./analysis-session"

/**
 * Price-file pipeline of the proposal analyzer (extracted verbatim from
 * upload-proposal-tab.tsx): parse → COG join → variance analysis, the
 * manual-mapping fallback, and the R2 re-join-on-vendor-change effect.
 * Shares the session refs with the PDF pipeline so the reset-generation
 * guard and the PDF-then-pricing re-score keep working across both.
 */
export function usePricingAnalysis({
  session,
  vendors,
  lookback,
  analysisVendorId,
  analyzeMutation,
}: {
  session: AnalysisSessionRefs
  vendors: VendorOption[]
  lookback: VendorLookbackComparison | null
  analysisVendorId: string | null
  analyzeMutation: ReturnType<typeof useAnalyzeProspectiveProposal>
}) {
  const {
    resetGenRef,
    selectedVendorIdRef,
    pricingAnalysisRef,
    lastScoredRef,
    onProposalScoredRef,
    lastPricingJoinVendorRef,
  } = session

  const [pricingAnalysis, setPricingAnalysis] =
    useState<PricingFileAnalysis | null>(null)
  const [pricingFileName, setPricingFileName] = useState<string | null>(null)
  const [pricingAnalyzing, setPricingAnalyzing] = useState(false)
  // Staged feedback (perf 2026-06-13): the price-file zone showed a bare
  // spinner that read as "frozen" even when fast. "reading" → parsing the
  // workbook client-side; "matching" → joining the N parsed lines to COG.
  const [pricingPhase, setPricingPhase] = useState<
    "reading" | "matching" | null
  >(null)
  // How many lines the current join is comparing (for the "Comparing N
  // lines to your COG…" status during the matching phase).
  const [pricingMatchCount, setPricingMatchCount] = useState<number>(0)
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

  // ── Price file: COG join → variance analysis (re-runnable) ──────────
  const joinAndAnalyzePricing = useCallback(
    async (items: PricingFileItem[], fileName: string, gen: number) => {
      // Staged feedback: parse is done, the COG join begins now.
      if (resetGenRef.current === gen) {
        setPricingMatchCount(items.length)
        setPricingPhase("matching")
      }
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
      pricingAnalysisRef.current = result
      setPricingFileName(fileName)
      setPricingFileItems({ items, fileName })
      toast.success(
        `Price file analyzed — ${result.summary.itemsWithCOGMatch} of ${result.summary.totalItems} lines matched to COG`,
      )

      // Audit P1#6: feed price-vs-market into the deal score. When the file
      // matched COG and an upload proposal is already scored, re-score it with
      // the realized avg variance vs current price (negative = cheaper = better
      // score). Non-fatal — a re-score failure leaves the pricing analysis and
      // the original score intact.
      const scored = lastScoredRef.current
      const priceVsMarket = priceVsMarketFromAnalysis(result)
      if (scored?.source === "upload" && scored.input) {
        try {
          const rescoreInput: AnalyzeProposalInput = {
            ...scored.input,
            priceVsMarket,
          }
          const rescored = await analyzeMutation.mutateAsync(rescoreInput)
          if (resetGenRef.current !== gen) return
          onProposalScoredRef.current({
            ...scored,
            input: rescoreInput,
            result: rescored,
            signals: {
              lookback: scored.signals?.lookback ?? null,
              legal: scored.signals?.legal ?? null,
              pricing: pricingSignalFrom(result),
            },
          })
          toast.success(
            priceVsMarket >= 0
              ? `Deal score updated — proposal is ${priceVsMarket}% cheaper than current price`
              : `Deal score updated — proposal is ${Math.abs(priceVsMarket)}% above current price`,
          )
        } catch (err) {
          console.error(
            "[proposal-analyzer] price-vs-market re-score failed:",
            err,
          )
        }
      }
    },
    [
      lookback?.vendorId,
      lookback?.vendorName,
      vendors,
      analyzeMutation,
      resetGenRef,
      selectedVendorIdRef,
      pricingAnalysisRef,
      lastScoredRef,
      onProposalScoredRef,
      lastPricingJoinVendorRef,
    ],
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
      setPricingPhase("reading")
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
        setPricingPhase(null)
      }
    },
    [joinAndAnalyzePricing, resetGenRef],
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
        if (resetGenRef.current === gen) {
          setPricingAnalyzing(false)
          setPricingPhase(null)
        }
      }
    },
    [joinAndAnalyzePricing, resetGenRef],
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
        if (resetGenRef.current === gen) {
          setPricingAnalyzing(false)
          setPricingPhase(null)
        }
      })
  }, [
    analysisVendorId,
    pricingFileItems,
    pricingAnalyzing,
    joinAndAnalyzePricing,
    lastPricingJoinVendorRef,
    resetGenRef,
  ])

  // ── Start over (bug-bash C1): the pricing half of the full clear. The
  // tab bumps resetGenRef FIRST, then calls this — it must clear every
  // pricing atom AND the pricing-side session refs (a partial clear
  // resurrects the stale-verdict bug).
  const resetPricingAnalysis = useCallback(() => {
    setPricingAnalysis(null)
    setPricingFileName(null)
    setPricingAnalyzing(false)
    setPricingPhase(null)
    setPricingVendorMismatch(null)
    setPricingFileItems(null)
    lastPricingJoinVendorRef.current = null
    pricingAnalysisRef.current = null
  }, [lastPricingJoinVendorRef, pricingAnalysisRef])

  return {
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
  }
}
