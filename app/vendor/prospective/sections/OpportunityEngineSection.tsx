"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { clamp } from "@/lib/math/clamp"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Rocket,
  TrendingUp,
  Boxes,
  PieChart,
  MapPin,
  Cpu,
  Sparkles,
  Target,
  Info,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle } from "lucide-react"
import {
  downloadOpportunityCsv,
  downloadOpportunityPdf,
  type OpportunityReportAudience,
} from "./export-opportunity"
import { formatPercent } from "@/lib/formatting"
import { cn } from "@/lib/utils"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import { queryKeys } from "@/lib/query-keys"
import { updateProposalOpportunity } from "@/lib/actions/prospective"
import { useVendorProposalDetail } from "@/hooks/use-prospective"
import {
  computeOpportunityEngine,
  DEFAULT_OPPORTUNITY_SCENARIO,
  type OpportunityScenarioInput,
} from "@/lib/prospective-analysis/opportunity-engine"
import {
  explainOpportunityEngine,
  type OpportunityExplainSources,
  type OpportunityLeverSource,
  type OpportunityOutputExplanation,
} from "@/lib/prospective-analysis/opportunity-explain"
import {
  computeVendorOpportunityScore,
  type ScoreDimension,
} from "@/lib/prospective-analysis/vendor-opportunity-score"
import {
  useVendorOpportunityData,
  useVendorOpportunityInsights,
} from "@/hooks/use-analysis-insights"
import { useVendorDivisionsWithMembers } from "@/hooks/use-divisions"
import type { VendorInsightSnapshot } from "@/lib/ai/analysis-insight-schemas"
import {
  FacilityCurrentStatePanel,
  type FacilityCurrentStateSnapshot,
} from "@/components/vendor/prospective/facility-current-state"
import { BenchmarkPositionCard } from "@/components/vendor/prospective/benchmark-position-card"

// ─── Types ─────────────────────────────────────────────────────

interface FacilityOption {
  id: string
  name: string
}

/**
 * Pre-fill payload pushed in from a scored proposal ("Analyze in Opportunity
 * Engine" on a My Proposals card) — the proposal → score → opportunity story.
 */
export interface OppDealConstructRow {
  productName: string
  category?: string
  current: number
  floor: number
  target: number
  ask: number
  annualVolume: number
  rebatePercent: number
}

export interface OppEngineHandoff {
  proposalId: string
  /** The REAL persisted proposal id (when known) — enables "Save to proposal".
   *  Distinct from `proposalId`, which is the apply-once key. */
  savedProposalId?: string | null
  facilityId: string | null
  /** Blended Target vs Current unit price, fraction. */
  priceChangePct: number
  /** Deal's market-share commitment, 0–100, or null. */
  targetSharePct: number | null
  /** Capital/equipment revenue in the deal (equipment cost), or null. */
  capitalRevenue?: number | null
  /** The vendor's own facility-supply-spend estimate from the Deal Scorer
   *  (Σ of the entered category spends). Pre-fills the Opportunity Engine's
   *  editable "Facility supply spend" so a one-way vendor doesn't re-type an
   *  estimate they already entered (Charles 2026-07-06 "still asking these
   *  questions"; option B). Null when nothing was entered. */
  facilitySupplySpend?: number | null
  /**
   * The deal's OWN current revenue — construct Σ(current × volume), else the
   * usage-file Σ. When present it drives the engine's current revenue/share
   * seed so "Current" comes from the entered deal (usage file or manual
   * entries), never the vendor's book-of-business or the default scenario
   * (bugs.rtfd 2026-07-07). Null when the deal carried no current prices.
   */
  currentRevenue?: number | null
  /** The Deal Scorer's manual "Current share %" entry (0–100), or null. */
  currentSharePct?: number | null
  /** Per-construct deal rows — feeds the export's by-product breakdown. */
  constructs?: OppDealConstructRow[]
}

/**
 * Imperative export surface — the one-page workspace renders the Export
 * dropdown at the TOP of the page ("Export button should be at the top not in
 * the middle", bugs.rtfd 2026-07-07) while the live engine/score/snapshot
 * state stays in this section.
 */
export interface OpportunityEngineExportHandle {
  exportPdf: (audience: OpportunityReportAudience) => Promise<void>
  exportCsv: (audience: OpportunityReportAudience) => void
  /** Persist the current run onto the attached proposal. Returns false when
   *  no saved proposal is attached (caller should explain). */
  saveToProposal: () => boolean
}

interface OpportunityEngineSectionProps {
  vendorId: string
  /** Optional — not required; the engine is assumption-driven. */
  facilities?: FacilityOption[]
  /** When set, pre-fills facility + price/share sliders from a scored deal. */
  initialDeal?: OppEngineHandoff | null
  /**
   * The saved proposal the workspace is attached to. On RE-ENTRY there is no
   * deal handoff — the vendor just reopened the proposal — so this is the only
   * route back to the Opportunity run they left on it (Charles 2026-07-27
   * "you can go back and look at it again"). It also enables "Save opportunity
   * to proposal" without an Analyze first.
   */
  attachedProposalId?: string | null
  /**
   * One-page workspace (Charles 2026-07-06 "entering facility twice"): the ONE
   * facility for this workspace, sourced LIVE from the ProposalBuilder above.
   * When set it locks BOTH facility controls (Facility Current State + Deal
   * Scenario) to it — the facility is entered once, up top, not re-asked here.
   */
  lockedFacilityId?: string | null
}

const BAND_SUBLABEL: Record<
  ReturnType<typeof computeOpportunityEngine>["winProbabilityBand"],
  string
> = {
  long_shot: "Long-shot likelihood",
  competitive: "Competitive",
  likely: "Likely to convert",
}

/**
 * Blended current unit price across a deal's constructs — Σ(current × volume)
 * ÷ Σ volume, null when the deal carries no current prices. ONE copy, shared
 * by the live handoff and the re-entry restore below so the two paths can't
 * drift (Charles 2026-07-27).
 */
function blendedCurrentAsp(rows: OppDealConstructRow[]): number | null {
  const volume = rows.reduce((s, c) => s + Math.max(0, c.annualVolume), 0)
  const spend = rows.reduce(
    (s, c) => s + Math.max(0, c.current) * Math.max(0, c.annualVolume),
    0,
  )
  return volume > 0 && spend > 0 ? spend / volume : null
}

// Compact USD: $6.9M / $803K / $420.
function usd(n: number): string {
  const sign = n < 0 ? "-" : ""
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`
  return `${sign}$${Math.round(abs)}`
}

// ─── Section ───────────────────────────────────────────────────

export const OpportunityEngineSection = forwardRef<
  OpportunityEngineExportHandle,
  OpportunityEngineSectionProps
>(function OpportunityEngineSection(
  {
    vendorId,
    facilities = [],
    initialDeal = null,
    attachedProposalId = null,
    lockedFacilityId = null,
  },
  ref,
) {
  // The pitching entity is the vendor's DIVISION; the target facility can be
  // chosen from related facilities OR written in (this only labels the
  // exported report — it is never shown to the facility). Vick 2026-06-22.
  const { data: divisions } = useVendorDivisionsWithMembers(vendorId)
  const divisionOptions = divisions ?? []
  const [division, setDivision] = useState<string>("")
  const [facility, setFacility] = useState<string>("")
  // The Facility Current State panel emits its live model here so the
  // page-level Export includes it alongside the deal scenario.
  const [facilitySnapshot, setFacilitySnapshot] =
    useState<FacilityCurrentStateSnapshot | null>(null)
  const effectiveDivision =
    division || divisionOptions[0]?.name || "All divisions"
  // Slider state is held as integer percentages; mapped to fractions below.
  const [priceChangePctInt, setPriceChangePctInt] = useState(
    Math.round(DEFAULT_OPPORTUNITY_SCENARIO.priceChangePct * 100),
  )
  const [targetSharePctInt, setTargetSharePctInt] = useState(
    Math.round(DEFAULT_OPPORTUNITY_SCENARIO.targetShare * 100),
  )
  const [volumeGrowthPctInt, setVolumeGrowthPctInt] = useState(
    Math.round(DEFAULT_OPPORTUNITY_SCENARIO.expectedVolumeGrowthPct * 100),
  )
  // Per-construct deal rows from the handoff — included in the export's
  // by-product breakdown (the unified report).
  const [dealConstructs, setDealConstructs] = useState<OppDealConstructRow[]>([])
  // Capital/equipment revenue from the deal — 0 when the deal has no capital
  // block (was a hardcoded $1.3M default for every deal).
  const [capitalRevenue, setCapitalRevenue] = useState(0)
  // Vendor's facility-supply-spend estimate from the Deal Scorer — pre-fills
  // the (editable) "Facility supply spend" so it isn't re-asked (Charles
  // 2026-07-06 option B). Null → the panel keeps its own real/zero seed.
  const [dealSupplySpend, setDealSupplySpend] = useState<number | null>(null)
  // The deal's own current revenue / manual share / blended current ASP —
  // when a deal handoff is present these OWN the engine's current-state seed
  // (usage file → "Current" spend; manual entries otherwise — bugs.rtfd
  // 2026-07-07). Null until a deal arrives.
  const [dealCurrentRevenue, setDealCurrentRevenue] = useState<number | null>(null)
  const [dealCurrentSharePct, setDealCurrentSharePct] = useState<number | null>(null)
  const [dealCurrentAsp, setDealCurrentAsp] = useState<number | null>(null)
  const saveOpportunity = useToastMutation(updateProposalOpportunity, {
    invalidate: [queryKeys.prospective.all],
    success: "Opportunity saved to the proposal",
    error: "Failed to save the opportunity",
  })

  // Apply a scored-deal handoff ONCE per proposal (a one-shot external command,
  // not a derived mirror) — pre-fills the facility label + price/share sliders
  // so the just-scored deal drives the Opportunity Engine. User tweaks after
  // are preserved (the ref guards re-application).
  const appliedDealRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialDeal || appliedDealRef.current === initialDeal.proposalId) return
    appliedDealRef.current = initialDeal.proposalId
    setDealConstructs(initialDeal.constructs ?? [])
    setCapitalRevenue(initialDeal.capitalRevenue ?? 0)
    setDealSupplySpend(initialDeal.facilitySupplySpend ?? null)
    setDealCurrentRevenue(initialDeal.currentRevenue ?? null)
    setDealCurrentSharePct(initialDeal.currentSharePct ?? null)
    setDealCurrentAsp(blendedCurrentAsp(initialDeal.constructs ?? []))
    if (initialDeal.facilityId) {
      const f = facilities.find((x) => x.id === initialDeal.facilityId)
      if (f) setFacility(f.name)
    }
    // Clamp to the slider's domain — a handoff outside it (deep discount)
    // would otherwise set state the control can't represent (V-C6).
    setPriceChangePctInt(
      clamp(Math.round(initialDeal.priceChangePct * 100), -20, 20),
    )
    if (initialDeal.targetSharePct != null) {
      setTargetSharePctInt(
        clamp(Math.round(initialDeal.targetSharePct), 0, 100),
      )
    }
  }, [initialDeal, facilities])

  // The real proposal THIS run belongs to — it enables "Save opportunity to
  // proposal" and keys the re-entry restore below. Derived, never mirrored into
  // state (CLAUDE.md). A live deal handoff names it first: a card's
  // "Opportunity Engine" button must save onto ITS proposal, not whatever the
  // Deal Scorer's picker happens to be holding. Otherwise it's the proposal the
  // scorer is attached to — the RE-ENTRY path, where no Analyze ever runs
  // (Charles 2026-07-27 "you can go back and look at it again").
  const savedProposalId =
    initialDeal?.savedProposalId ?? attachedProposalId ?? null
  // Read through the shared detail query — the builder above holds the same row
  // under the same factory key, so reopening a proposal costs no extra
  // round-trip.
  const { data: attachedDetail } = useVendorProposalDetail(savedProposalId)
  // Apply the saved proposal ONCE, the same one-shot ref guard the initialDeal
  // handoff above uses, so a vendor tweak afterwards stands (and a background
  // refetch doesn't undo it). Division and facility are deliberately NOT
  // restored: the workspace above owns them (locked from the builder), and
  // re-seeding them here would fight it.
  const restoredProposalRef = useRef<string | null>(null)
  useEffect(() => {
    if (!attachedDetail) return
    if (restoredProposalRef.current === attachedDetail.id) return
    // A deal analyzed in THIS session OWNS the engine — a fresh run always
    // beats the stored one.
    if (appliedDealRef.current !== null) return
    restoredProposalRef.current = attachedDetail.id
    // Restore the DEAL before its levers. Restoring the sliders alone would
    // move them against the book-of-business/default seeds, so the six stat
    // cards would render a scenario that was never actually run — the exact
    // "not sure where these numbers are coming from" failure the seed
    // priority exists to prevent (Charles 2026-07-27).
    const handoff = attachedDetail.dealHandoff
    if (handoff) {
      setDealConstructs(handoff.constructs)
      setCapitalRevenue(handoff.capitalRevenue ?? 0)
      setDealCurrentRevenue(
        handoff.currentAnnualSpend > 0 ? handoff.currentAnnualSpend : null,
      )
      setDealCurrentAsp(blendedCurrentAsp(handoff.constructs))
    }
    // Facility supply spend + current share are Deal-Scorer assumptions, not
    // part of the handoff — Σ the saved category-spend rows the same way the
    // live handoff does (falling back to the single legacy `estimatedSpend`).
    const assumptions = attachedDetail.dealAssumptions
    if (assumptions) {
      setDealCurrentSharePct(assumptions.currentSharePct)
      const spend =
        assumptions.estimatedCategorySpends &&
        assumptions.estimatedCategorySpends.length > 0
          ? assumptions.estimatedCategorySpends.reduce(
              (s, r) => s + (r.spend ?? 0),
              0,
            )
          : (assumptions.estimatedSpend ?? 0)
      setDealSupplySpend(spend > 0 ? spend : null)
    }
    // Stored as fractions; the sliders hold whole percents. Clamp to each
    // slider's domain (V-C6) so a run saved outside it still renders.
    const saved = attachedDetail.opportunityScenario
    if (saved) {
      setPriceChangePctInt(
        clamp(Math.round(saved.priceChangePct * 100), -20, 20),
      )
      setTargetSharePctInt(clamp(Math.round(saved.targetShare * 100), 0, 100))
      setVolumeGrowthPctInt(
        clamp(Math.round(saved.expectedVolumeGrowthPct * 100), -10, 30),
      )
    }
  }, [attachedDetail])

  // One-page workspace: mirror the builder's LIVE facility into the field so
  // scoping, the Facility Current State panel, and the export all follow it —
  // and both facility controls render read-only (Charles 2026-07-06 "entering
  // facility twice"). Follows changes as the vendor re-picks up top.
  useEffect(() => {
    if (!lockedFacilityId) return
    const name = facilities.find((x) => x.id === lockedFacilityId)?.name
    if (name) setFacility((prev) => (prev === name ? prev : name))
  }, [lockedFacilityId, facilities])
  const facilityLocked = Boolean(lockedFacilityId) || Boolean(initialDeal?.facilityId)

  const priceChangePct = priceChangePctInt / 100
  const targetShare = targetSharePctInt / 100
  const expectedVolumeGrowthPct = volumeGrowthPctInt / 100

  // The Deal Scenario facility, resolved name→id (same resolution the
  // Facility Current State sync uses). When it names a known facility, the
  // DB seed below is SCOPED to it — the engine models "this facility"
  // instead of the vendor's whole book of business.
  const scopedFacilityId =
    facilities.find((f) => f.name === facility.trim())?.id ?? null

  // Real DB seed: the vendor's trailing-12mo ASP, addressable market, share —
  // facility-scoped when the Deal Scenario names a known facility.
  const { data: dbData } = useVendorOpportunityData(
    vendorId,
    scopedFacilityId ?? undefined,
  )
  const aiInsights = useVendorOpportunityInsights()

  // Current-state seeds, resolved value + provenance TOGETHER so the scenario
  // and the explain popovers can't drift. Priority (bugs.rtfd 2026-07-07 "when
  // a usage file is entered that should serve as the Current spend; no usage /
  // no two-way → only the manual entries"): the DEAL's own data (usage-file
  // revenue, manual category spends, manual share) wins over the vendor's
  // book-of-business seed, and the default scenario is the last resort only.
  const seeds = useMemo(() => {
    const seed = (value: number, source: OpportunityLeverSource) => ({
      value,
      source,
    })
    // Addressable spend = the facility's total category spend. Manual entries
    // from the Deal Scorer first; else derive it from the deal's own revenue ÷
    // manual share; else the vendor's real sales seed; else the deal's own
    // revenue floor (better than a fabricated market); else the default.
    const addressableSpend =
      dealSupplySpend != null && dealSupplySpend > 0
        ? seed(dealSupplySpend, "deal handoff")
        : dealCurrentRevenue != null &&
            dealCurrentRevenue > 0 &&
            dealCurrentSharePct != null &&
            dealCurrentSharePct > 0
          ? seed(
              dealCurrentRevenue / (Math.min(100, dealCurrentSharePct) / 100),
              "deal handoff",
            )
          : dbData?.hasData && dbData.addressableSpend > 0
            ? seed(dbData.addressableSpend, "your data")
            : dealCurrentRevenue != null && dealCurrentRevenue > 0
              ? seed(dealCurrentRevenue, "deal handoff")
              : seed(DEFAULT_OPPORTUNITY_SCENARIO.addressableSpend, "default")
    // Current share: the deal's revenue over the resolved addressable, else
    // the manual entry (a typed 0 is a real answer), else book / default.
    const currentShare =
      dealCurrentRevenue != null && addressableSpend.value > 0
        ? seed(
            clamp(dealCurrentRevenue / addressableSpend.value, 0, 1),
            "deal handoff",
          )
        : dealCurrentSharePct != null
          ? seed(clamp(dealCurrentSharePct, 0, 100) / 100, "deal handoff")
          : dbData?.hasData
            ? seed(dbData.currentShare, "your data")
            : seed(DEFAULT_OPPORTUNITY_SCENARIO.currentShare, "default")
    // ASP: the deal's blended current unit price, else the vendor's real ASP.
    const currentAsp =
      dealCurrentAsp != null && dealCurrentAsp > 0
        ? seed(dealCurrentAsp, "deal handoff")
        : dbData?.hasData && dbData.currentAsp > 0
          ? seed(dbData.currentAsp, "your data")
          : seed(DEFAULT_OPPORTUNITY_SCENARIO.currentAsp, "default")
    return { addressableSpend, currentShare, currentAsp }
  }, [
    dbData,
    dealSupplySpend,
    dealCurrentRevenue,
    dealCurrentSharePct,
    dealCurrentAsp,
  ])

  const scenario = useMemo<OpportunityScenarioInput>(
    () => ({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      currentAsp: seeds.currentAsp.value,
      addressableSpend: seeds.addressableSpend.value,
      currentShare: seeds.currentShare.value,
      // Real incumbent signal: the top competitor's spend share (0–1
      // fraction) at the vendor's facilities, not the hardcoded default.
      incumbentStrength:
        dbData?.hasData && dbData.topCompetitorSharePct != null
          ? dbData.topCompetitorSharePct
          : DEFAULT_OPPORTUNITY_SCENARIO.incumbentStrength,
      // Capital rides in from the deal handoff — 0 when the deal has none.
      capitalRoboticRevenue: capitalRevenue,
      priceChangePct,
      targetShare,
      expectedVolumeGrowthPct,
    }),
    [seeds, dbData, capitalRevenue, priceChangePct, targetShare, expectedVolumeGrowthPct],
  )

  const engine = useMemo(() => computeOpportunityEngine(scenario), [scenario])

  // Calculation transparency: per-output explain tables (formula + levers +
  // where each lever came from). The section knows the provenance — whether
  // the DB seed applied (dbData.hasData), whether a deal handoff set a
  // slider, or whether a slider still sits at its default seed.
  const explains = useMemo(() => {
    const handoffApplied =
      initialDeal != null && appliedDealRef.current === initialDeal.proposalId
    const priceFromHandoff =
      handoffApplied &&
      priceChangePctInt ===
        clamp(Math.round((initialDeal?.priceChangePct ?? 0) * 100), -20, 20)
    const shareFromHandoff =
      handoffApplied &&
      initialDeal?.targetSharePct != null &&
      targetSharePctInt === clamp(Math.round(initialDeal.targetSharePct), 0, 100)
    const sliderSource = (
      atDefault: boolean,
      fromHandoff: boolean,
    ): OpportunityLeverSource =>
      fromHandoff ? "deal handoff" : atDefault ? "default" : "slider"
    const dataSource = (isReal: boolean): OpportunityLeverSource =>
      isReal ? "your data" : "default"

    const sources: OpportunityExplainSources = {
      priceChangePct: sliderSource(
        priceChangePctInt ===
          Math.round(DEFAULT_OPPORTUNITY_SCENARIO.priceChangePct * 100),
        priceFromHandoff,
      ),
      targetShare: sliderSource(
        targetSharePctInt ===
          Math.round(DEFAULT_OPPORTUNITY_SCENARIO.targetShare * 100),
        shareFromHandoff,
      ),
      expectedVolumeGrowthPct: sliderSource(
        volumeGrowthPctInt ===
          Math.round(
            DEFAULT_OPPORTUNITY_SCENARIO.expectedVolumeGrowthPct * 100,
          ),
        false,
      ),
      // Current-state levers carry the provenance resolved WITH their values
      // in the seeds memo (deal handoff > your data > default) so the popover
      // badges can't drift from the numbers.
      currentShare: seeds.currentShare.source,
      incumbentStrength: dataSource(
        dbData?.hasData === true && dbData.topCompetitorSharePct != null,
      ),
      addressableSpend: seeds.addressableSpend.source,
      currentAsp: seeds.currentAsp.source,
    }
    return explainOpportunityEngine(scenario, sources)
  }, [
    scenario,
    seeds,
    dbData,
    initialDeal,
    priceChangePctInt,
    targetSharePctInt,
    volumeGrowthPctInt,
  ])
  const explainFor = (key: OpportunityOutputExplanation["key"]) =>
    explains.filter((e) => e.key === key)

  const score = useMemo(
    () =>
      computeVendorOpportunityScore({
        engine,
        // Strategic inputs are now DERIVED FROM REAL DB DATA
        // (getVendorOpportunityData), not hardcoded. They fall back to
        // neutral values only when the vendor has no sales/contract history.
        rebateCostPct: dbData?.rebateCostPct ?? 0.1,
        // Share-of-wallet gain = the move this scenario actually models.
        shareOfWalletGainPct: Math.max(
          0,
          targetShare - (dbData?.currentShare ?? 0),
        ),
        // Displaceable incumbent share (0–100).
        competitiveDisplacementScore: Math.round(
          (dbData?.topCompetitorSharePct ?? 0) * 100,
        ),
        // Breadth of product lines already held (count ÷ 6 ContractTypes).
        multiBuPenetrationScore: Math.round(
          ((dbData?.contractTypeCount ?? 0) / 6) * 100,
        ),
        // Equipment/technology footprint: capital/tie-in contracts present.
        technologyAdoptionScore: dbData?.hasCapitalContract ? 80 : 40,
        competitiveThreat: dbData?.competitiveThreat ?? "Incumbent supplier",
        hasCapital: engine.capitalRoboticRevenue > 0,
      }),
    [engine, dbData, targetShare],
  )

  // AI snapshot — sent to Claude on demand for the richer win-prob / offer read.
  const aiSnapshot: VendorInsightSnapshot = {
    currentAsp: engine.currentRevenue > 0 ? engine.currentRevenue / Math.max(1, engine.currentUnits) : DEFAULT_OPPORTUNITY_SCENARIO.currentAsp,
    priceChangePct,
    currentShare: dbData?.currentShare ?? DEFAULT_OPPORTUNITY_SCENARIO.currentShare,
    targetShare,
    expectedVolumeGrowthPct,
    addressableSpend: engine.addressableSpend,
    currentRevenue: engine.currentRevenue,
    targetRevenue: engine.targetRevenue,
    incrementalRevenue: engine.incrementalRevenue,
    netUnitImpact: engine.netUnitImpact,
    blendedMarketShare: engine.blendedMarketShare,
    territoryRecurringRevenue: engine.territoryRecurringRevenue,
    capitalRoboticRevenue: engine.capitalRoboticRevenue,
    deterministicWinProbabilityPct: engine.winProbability * 100,
    opportunityScoreOverall: score.overall,
    competitiveThreat: score.winProbability.competitiveThreat,
  }

  // Top-of-page export (the stepper renders the dropdown; state lives here).
  const scenarioMeta = {
    division: effectiveDivision,
    facility: facility.trim() || "Unspecified facility",
    priceChangePct,
    targetShare,
    expectedVolumeGrowthPct,
  }
  useImperativeHandle(ref, () => ({
    exportPdf: (audience: OpportunityReportAudience) =>
      downloadOpportunityPdf(
        engine,
        score,
        scenarioMeta,
        facilitySnapshot,
        dealConstructs,
        audience,
      ),
    exportCsv: (audience: OpportunityReportAudience) =>
      downloadOpportunityCsv(
        engine,
        score,
        scenarioMeta,
        facilitySnapshot,
        dealConstructs,
        audience,
      ),
    saveToProposal: () => {
      if (!savedProposalId || saveOpportunity.isPending) return false
      saveOpportunity.mutate({
        proposalId: savedProposalId,
        scenario: {
          division: effectiveDivision,
          facility: facility.trim() || "Unspecified facility",
          priceChangePct,
          targetShare,
          expectedVolumeGrowthPct,
          winProbability: engine.winProbability,
          incrementalRevenue: engine.incrementalRevenue,
          currentRevenue: engine.currentRevenue,
          targetRevenue: engine.targetRevenue,
          blendedMarketShare: engine.blendedMarketShare,
          opportunityScore: score.overall,
          savedAt: new Date().toISOString(),
        },
      })
      return true
    },
  }))

  const ai = aiInsights.data
  const winColor =
    engine.winProbabilityBand === "likely"
      ? "text-emerald-600"
      : "text-amber-600"

  return (
    <div className="space-y-4">
      {/* Heading block. The Export dropdown moved to the TOP of the one-page
          workspace (ProposalStepper toolbar, via the export handle) — "Export
          button should be at the top not in the middle" (bugs.rtfd
          2026-07-07). */}
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Rocket className="h-5 w-5 text-primary" />
          Opportunity Engine
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Score a prospective deal by ASP impact, category growth (in dollars
          and market share), and net unit impact. Capital / robotic revenue is
          separated because it does not carry recurring service that hits the
          territory number.
        </p>
      </div>

      {/* Facility Current State — the financial picture of the pitch target.
          Follows the Deal Scenario facility when it names a known facility, so
          the export never pairs one facility's current state with another's
          scenario (V-B1). */}
      <FacilityCurrentStatePanel
        vendorId={vendorId}
        facilities={facilities}
        syncFacilityId={scopedFacilityId}
        // Facility already chosen in the builder above (or a scored deal) → the
        // facility is known; lock it so it isn't re-asked (Charles 2026-07-06).
        locked={facilityLocked}
        // Pre-fill the editable supply-spend from the vendor's Deal-Scorer
        // estimate so it isn't re-asked (option B).
        seedSupplySpend={dealSupplySpend}
        onSnapshotChange={setFacilitySnapshot}
      />

      {/* Deal Scenario */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal Scenario</CardTitle>
          <CardDescription>
            Model the levers — vendor, price vs current ASP, target share, and
            expected category growth.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="oe-division">Division</Label>
              <Select value={effectiveDivision} onValueChange={setDivision}>
                <SelectTrigger id="oe-division">
                  <SelectValue placeholder="Select a division" />
                </SelectTrigger>
                <SelectContent>
                  {divisionOptions.length === 0 ? (
                    <SelectItem value="All divisions">All divisions</SelectItem>
                  ) : (
                    divisionOptions.map((d) => (
                      <SelectItem key={d.id} value={d.name}>
                        {d.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="oe-facility">Facility</Label>
              {facilityLocked ? (
                // Inherited from the builder above / the scored deal — read-only,
                // don't re-ask (Charles 2026-07-06 "enter your facility twice").
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                  {facility || "From your proposal"}
                </p>
              ) : (
                <>
                  <Input
                    id="oe-facility"
                    list="oe-facility-options"
                    value={facility}
                    onChange={(e) => setFacility(e.target.value)}
                    placeholder="Choose or type a facility"
                  />
                  <datalist id="oe-facility-options">
                    {facilities.map((f) => (
                      <option key={f.id} value={f.name} />
                    ))}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    For your report only — choose a facility you serve or write
                    in a new prospect. Not shared with the facility.
                  </p>
                </>
              )}
            </div>

            <SliderControl
              label="Price change vs current ASP"
              value={priceChangePctInt}
              onChange={setPriceChangePctInt}
              min={-20}
              max={20}
              step={1}
              format={(v) => `${v > 0 ? "+" : ""}${v}%`}
            />

            <SliderControl
              label="Target market share"
              value={targetSharePctInt}
              onChange={setTargetSharePctInt}
              min={0}
              max={100}
              step={1}
              format={(v) => `${v}%`}
            />

            <SliderControl
              label="Expected volume growth"
              value={volumeGrowthPctInt}
              onChange={setVolumeGrowthPctInt}
              min={-10}
              max={30}
              step={1}
              format={(v) => `${v > 0 ? "+" : ""}${v}%`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Benchmark Position — where actuals + the proposed price sit vs the
          vendor's UPLOADED benchmarks, per category. */}
      <BenchmarkPositionCard
        categoryBenchmarks={dbData?.categoryBenchmarks ?? []}
        priceChangePct={priceChangePct}
      />

      {/* Honesty banner: when the vendor has no COG/contract history, the
          seeds are default assumptions, not real data — say so plainly. */}
      {dbData && !dbData.hasData && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No sales or contract history found for your organization yet — the
            figures below are modeled from default assumptions, not your data.
            Tune the levers to explore a scenario.
          </span>
        </div>
      )}

      {/* Six output stat cards */}
      <p className="text-xs text-muted-foreground">
        {scopedFacilityId
          ? `Modeled for this facility (${facility.trim()})`
          : "Modeled across your book of business"}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Target}
          label="Win Probability (model)"
          value={formatPercent(engine.winProbability * 100)}
          valueClassName={winColor}
          sublabel={`${BAND_SUBLABEL[engine.winProbabilityBand]} — deterministic model`}
          explains={explainFor("winProbability")}
        />
        <StatCard
          icon={TrendingUp}
          label="Incremental Revenue"
          value={`${engine.incrementalRevenue > 0 ? "+" : ""}${usd(engine.incrementalRevenue)}`}
          valueClassName="text-emerald-600"
          sublabel={`${usd(engine.currentRevenue)} → ${usd(engine.targetRevenue)}`}
          explains={[
            ...explainFor("incrementalRevenue"),
            ...explainFor("currentRevenue"),
          ]}
        />
        <StatCard
          icon={Boxes}
          label="Net Unit Impact"
          value={`${engine.netUnitImpact > 0 ? "+" : ""}${Math.round(engine.netUnitImpact)}`}
          valueClassName="text-emerald-600"
          sublabel="units vs current run-rate"
          explains={explainFor("netUnitImpact")}
        />
        <StatCard
          icon={PieChart}
          label="Blended Market Share"
          value={formatPercent(engine.blendedMarketShare * 100)}
          sublabel={`of ${usd(engine.addressableSpend)} addressable`}
        />
        <StatCard
          icon={MapPin}
          label="Territory Recurring Revenue"
          value={usd(engine.territoryRecurringRevenue)}
          valueClassName="text-emerald-600"
          sublabel="Counts toward the rep's territory number"
        />
        {engine.capitalRoboticRevenue > 0 && (
          <StatCard
            icon={Cpu}
            label="Capital / Robotic Revenue"
            value={usd(engine.capitalRoboticRevenue)}
            sublabel="Does not hit territory number"
          />
        )}
      </div>

      {/* AI Win Probability & Recommended Offer */}
      <Card className="border-primary/30">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Win Probability &amp; Recommended Offer
            </CardTitle>
            <CardDescription>
              {ai
                ? "Claude's read of this scenario."
                : "Deterministic estimate — generate the AI read for richer rationale."}
            </CardDescription>
          </div>
          <Button
            onClick={() => aiInsights.mutate(aiSnapshot)}
            disabled={aiInsights.isPending}
            className="shrink-0"
          >
            {aiInsights.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : ai ? (
              "Regenerate AI insights"
            ) : (
              "Generate AI insights"
            )}
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {aiInsights.error && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{aiInsights.error.message}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat
              label="Win Probability"
              value={formatPercent(
                (ai
                  ? ai.winProbability.probabilityPct
                  : score.winProbability.probability * 100),
              )}
            />
            <MiniStat
              label="Risk Level"
              value={ai ? ai.winProbability.riskLevel : score.winProbability.riskLevel}
            />
            <MiniStat
              label="Competitive Threat"
              value={
                ai
                  ? ai.winProbability.competitiveThreat
                  : // No REAL named competitor (one-way connections gate off
                    // facility-side competitor data) → show "—", never a
                    // fabricated placeholder name.
                    dbData?.competitiveThreat ?? "—"
              }
            />
            <MiniStat
              label="Recommended Action"
              value={
                ai
                  ? ai.winProbability.recommendedAction
                  : score.winProbability.recommendedAction
              }
            />
          </div>

          {ai?.winProbability.rationale && (
            <p className="text-sm text-muted-foreground">
              {ai.winProbability.rationale}
            </p>
          )}

          <div className="rounded-md border bg-muted/20 p-4">
            <p className="text-sm font-medium">Recommended Offer Structure</p>
            <p className="mt-1 text-sm text-muted-foreground">
              To achieve{" "}
              {ai
                ? ai.recommendedOffer.targetConversionPct
                : score.recommendedOffer.targetConversionPct}
              % likelihood of conversion, recommend:
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {(ai ? ai.recommendedOffer.items : score.recommendedOffer.items).map(
                (item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ),
              )}
            </ul>
            {ai?.recommendedOffer.rationale && (
              <p className="mt-3 text-xs text-muted-foreground">
                {ai.recommendedOffer.rationale}
              </p>
            )}
          </div>

          {ai?.opportunityScoreRead && (
            <p className="text-sm text-muted-foreground">
              {ai.opportunityScoreRead}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Vendor Opportunity Score */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor Opportunity Score</CardTitle>
          <CardDescription>
            Weighted across financial and strategic dimensions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold">{score.overall}</span>
            <span className="text-lg text-muted-foreground">/ 100</span>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <DimensionColumn title="Financial" dimensions={score.financial} />
            <DimensionColumn title="Strategic" dimensions={score.strategic} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
})

// ─── Sub-components ────────────────────────────────────────────

function SliderControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  format: (v: number) => string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm font-semibold tabular-nums">
          {format(value)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(vals) => onChange(vals[0] ?? min)}
      />
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  valueClassName,
  sublabel,
  explains,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  valueClassName?: string
  sublabel: string
  /** Optional calculation-transparency tables → Info popover beside the label. */
  explains?: OpportunityOutputExplanation[]
}) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
          {explains && explains.length > 0 && (
            <ExplainPopover explains={explains} />
          )}
        </div>
        <p className={cn("text-2xl font-bold", valueClassName)}>{value}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </CardContent>
    </Card>
  )
}

/** "How is this calculated?" — formula + lever rows with source badges. */
function ExplainPopover({
  explains,
}: {
  explains: OpportunityOutputExplanation[]
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How this number is calculated"
          className="ml-auto shrink-0 text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="z-50 max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto p-3 text-xs shadow-lg"
      >
        {explains.map((ex) => (
          <div key={ex.key} className="space-y-1.5">
            <p className="font-medium">{ex.title}</p>
            <p className="rounded bg-muted/50 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
              {ex.formula}
            </p>
            <div className="space-y-1">
              {ex.levers.map((lever) => (
                <div
                  key={lever.label}
                  className="flex items-start justify-between gap-2"
                >
                  <span className="text-muted-foreground">{lever.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-right tabular-nums">
                    <span>
                      {lever.value}
                      {lever.detail && (
                        <span className="text-muted-foreground">
                          {" "}
                          {lever.detail}
                        </span>
                      )}
                    </span>
                    <SourceBadge source={lever.source} />
                  </span>
                </div>
              ))}
            </div>
            {ex.note && (
              <p className="text-[10px] italic leading-snug text-muted-foreground">
                {ex.note}
              </p>
            )}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const SOURCE_BADGE_CLASS: Record<OpportunityLeverSource, string> = {
  slider: "border-primary/30 text-primary",
  "your data": "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  default: "border-border text-muted-foreground",
  "deal handoff": "border-amber-300 text-amber-700 dark:text-amber-400",
}

function SourceBadge({ source }: { source: OpportunityLeverSource }) {
  return (
    <span
      className={cn(
        "rounded border px-1 py-px text-[9px] font-medium uppercase leading-none tracking-wide",
        SOURCE_BADGE_CLASS[source],
      )}
    >
      {source}
    </span>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

function DimensionColumn({
  title,
  dimensions,
}: {
  title: string
  dimensions: ScoreDimension[]
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="space-y-3">
        {dimensions.map((d) => (
          <div key={d.key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{d.label}</span>
              <span className="text-xs text-muted-foreground">
                weight {d.weight}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, d.score))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
