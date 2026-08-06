"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Gauge } from "lucide-react"
import { toast } from "sonner"

import { queryKeys } from "@/lib/query-keys"
import { useVendorBenchmarks } from "@/hooks/use-prospective"
import { blendConstructsToScenarios } from "@/lib/prospective-analysis/blend-constructs"
import {
  mapUsageRows,
  mapPricingRows,
} from "@/components/vendor/prospective/builder/file-handlers"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { seedConstructFromBenchmark } from "./construct-seed"
import {
  getVendorProspectiveAnalysis,
  type VendorProspectiveAnalysisInput,
} from "@/lib/actions/vendor-prospective"
import type { VendorContractVariant } from "@/lib/prospective-analysis/vendor-prospective-analyzer"
import type { VendorProposal } from "@/lib/actions/prospective"
import { type OppEngineHandoff } from "./OpportunityEngineSection"
import {
  NO_PROPOSAL,
  makeConstruct,
  constructToDeal,
  type ConstructForm,
} from "./deal-scorer/construct-form"
import { computeConstructBlankReasons } from "./deal-scorer/construct-blank-reasons"
import { estimateCategorySpendFromFiles } from "./deal-scorer/estimate-category-spend"
import { useProposalHydration } from "./deal-scorer/use-proposal-hydration"
import { useFacilityActualsSync } from "./deal-scorer/use-facility-actuals-sync"
import { DealInputsHeader } from "./deal-scorer/DealInputsHeader"
import { ConstructsTable } from "./deal-scorer/ConstructsTable"
import { AssumptionFields } from "./deal-scorer/AssumptionFields"
import { ResultsView } from "./deal-scorer/DealScorerResults"

// ─── Types ─────────────────────────────────────────────────────

interface FacilityOption {
  id: string
  name: string
}

interface DealScorerSectionProps {
  facilities: FacilityOption[]
  /** Existing draft proposals — selecting one attaches the computed
   *  score to it (persisted server-side, audit H2). */
  proposals: VendorProposal[]
  /** Vendor scope for loading the benchmark-comparison picker. */
  vendorId: string
  /**
   * Stepper hook (PR 4/5): emitted on Analyze with the blended deal
   * (facility + Target-vs-Current price change + target share) so the stepper
   * can auto-seed the Opportunity Engine step without the manual handoff.
   */
  onDealAnalyzed?: (deal: OppEngineHandoff) => void
  /**
   * A just-created/opened proposal id — selects it in the proposal picker and
   * hydrates the construct grid from its products ("save → next step").
   */
  preselectedProposalId?: string | null
  /**
   * The proposal this section is actually attached to, reported upward on
   * every change (preselect OR the picker). The Opportunity Engine below needs
   * it to restore the proposal's saved scenario on RE-ENTRY, when no Analyze
   * ever runs (Charles 2026-07-27 "go back and look at it again"). Null when
   * nothing is attached.
   */
  onProposalAttached?: (proposalId: string | null) => void
  /**
   * One-page workspace mode (Charles 2026-07-06 "you should not need to enter
   * the facility twice or usage or pricing"): when the Deal Scorer sits below
   * the ProposalBuilder on the same page, the facility, usage, pricing, and
   * categories were ALREADY entered in the builder and ride in on the attached
   * proposal. In embedded mode we HIDE the facility select and the upload
   * dropzones — showing an inherited summary instead — so nothing is
   * re-entered. The proposal picker is NOT hidden (Charles 2026-07-27): it is
   * the only way back into a proposal saved in an earlier session.
   */
  embedded?: boolean
  /**
   * One-page bridge (Charles 2026-07-06): "Analyze deal" is the single commit
   * — when the builder above has unsaved content, this persists it first and
   * returns the created proposal id + facility so the score attaches and the
   * facility resolves without a separate mid-page Save.
   *
   * Three outcomes: the saved proposal, `null` to carry on analyzing with
   * whatever is already attached, or `"abort"` when there is nothing to attach
   * and a score computed here would be written nowhere — the workspace has
   * already explained why (Charles 2026-07-27).
   */
  beforeAnalyze?: () => Promise<
    { proposalId: string; facilityId: string | null } | "abort" | null
  >
  /**
   * One-page LIVE inheritance (Charles 2026-07-06 "categories not coming
   * over"): the categories + facility the user is picking in the ProposalBuilder
   * above, streamed down BEFORE Analyze persists the proposal. `builderCategories`
   * seeds/backfills construct categories and fills the category datalist;
   * `builderFacilityId` resolves the inherited-facility summary before attach.
   * Without these the Deal Scorer only learns categories after a proposal is
   * saved + refetched — i.e. never, in the build-first flow.
   */
  builderCategories?: string[]
  builderFacilityId?: string | null
}

// ─── Section ───────────────────────────────────────────────────

export function DealScorerSection({ facilities, proposals, vendorId, onDealAnalyzed, preselectedProposalId, onProposalAttached, embedded = false, beforeAnalyze, builderCategories = [], builderFacilityId = null }: DealScorerSectionProps) {
  const queryClient = useQueryClient()
  const [facilityId, setFacilityId] = useState<string>("")
  const [proposalRowId, setProposalRowId] = useState<string>(NO_PROPOSAL)
  // The vendor explicitly picked "Don't attach — just analyze". Distinct from
  // "nothing attached yet": it opts OUT of the one-page bridge save, so Analyze
  // neither persists a proposal nor blocks (Charles 2026-07-27).
  const [detachRequested, setDetachRequested] = useState(false)
  const [contractVariant, setContractVariant] =
    useState<VendorContractVariant>("USAGE_SPEND")
  const [constructs, setConstructs] = useState<ConstructForm[]>(() => [
    makeConstruct(),
  ])
  const { data: benchmarks } = useVendorBenchmarks(vendorId)
  // Categories picked on the ATTACHED PROPOSAL (builder productCategories) —
  // they flow into the category picker + construct labels, so a benchmark
  // file without a Category column doesn't strand the deal as "Uncategorized"
  // (Vick 2026-07-04 "the categories I loaded when entering a proposal are
  // not coming over").
  const [proposalCategories, setProposalCategories] = useState<string[]>([])
  // The LIVE category source for the one-page flow: the builder's current
  // selection (streamed down before Analyze) merged with the attached
  // proposal's categories (post-Analyze). Use this everywhere the constructs
  // need a category — NOT the post-attach-only `proposalCategories` (Charles
  // 2026-07-06 "categories not coming over" in the build-first flow).
  const effectiveCategories = useMemo(
    () =>
      Array.from(
        new Set(
          [...(builderCategories ?? []), ...proposalCategories].filter(Boolean),
        ),
      ),
    [builderCategories, proposalCategories],
  )
  const benchmarkCategories = useMemo(
    () =>
      [
        ...new Set([
          ...(benchmarks ?? []).map((b) => b.category),
          ...effectiveCategories,
        ]),
      ]
        .filter((c) => c && c !== "Uncategorized")
        .sort(),
    [benchmarks, effectiveCategories],
  )
  const benchmarkById = useMemo(
    () => new Map((benchmarks ?? []).map((b) => [b.id, b])),
    [benchmarks],
  )
  const [benchPick, setBenchPick] = useState("")
  // When the builder's categories arrive/change (live, before Analyze) OR the
  // attached proposal's categories load, backfill any construct still blank
  // with the FIRST category — never clobber one the vendor already typed
  // (Charles 2026-07-06 "categories not coming over"). Uses the first of the
  // set (not `=== 1`) so a multi-category proposal still labels constructs
  // instead of leaving them "uncategorized"; the vendor can retarget any
  // construct via the category datalist.
  const firstCategory = effectiveCategories[0]
  useEffect(() => {
    if (!firstCategory) return
    setConstructs((prev) =>
      prev.some((c) => !c.category.trim())
        ? prev.map((c) =>
            c.category.trim() ? c : { ...c, category: firstCategory },
          )
        : prev,
    )
  }, [firstCategory])
  const analyzeSeqRef = useRef(0)
  // Reference data: usage gives the VOLUME each construct is compared against;
  // the price file gives the CURRENT price. Keyed by normalized SKU; they
  // auto-fill a construct's Volume / Current when it's picked from the benchmark
  // list (constructs come from the benchmark dropdown, NOT from these files).
  const [usageVolumeBySku, setUsageVolumeBySku] = useState<Map<string, number>>(
    () => new Map(),
  )
  const [currentPriceBySku, setCurrentPriceBySku] = useState<Map<string, number>>(
    () => new Map(),
  )
  const [usageLoadedCount, setUsageLoadedCount] = useState(0)
  const [priceLoadedCount, setPriceLoadedCount] = useState(0)

  // Current revenue straight from the usage + price files: Σ(current price ×
  // volume) across every item. Authoritative for penetration (Vick 2026-06-25
  // "current revenue should come from the usage file"), not spend × share.
  const usageCurrentRevenue = useMemo(() => {
    let sum = 0
    for (const [sku, price] of currentPriceBySku) {
      sum += price * (usageVolumeBySku.get(sku) ?? 0)
    }
    return sum
  }, [currentPriceBySku, usageVolumeBySku])

  // Starting-point spend for a category picked on a "Facility estimated annual
  // category spend" row — the derivation itself lives in
  // deal-scorer/estimate-category-spend.ts; this just binds the loaded
  // reference state.
  function estimateCategorySpend(category: string): number {
    return estimateCategorySpendFromFiles(category, {
      benchmarks,
      currentPriceBySku,
      usageVolumeBySku,
      usageCurrentRevenue,
      currentShare,
    })
  }

  // Coming from a builder save (or a reopened proposal) just SELECTS the
  // proposal in the picker; the load below keys on that selection, so choosing
  // a proposal manually behaves identically.
  useEffect(() => {
    if (!preselectedProposalId) return
    setProposalRowId(preselectedProposalId)
    setDetachRequested(false)
  }, [preselectedProposalId])

  // Report the attached proposal up to the workspace so the Opportunity Engine
  // below can restore ITS saved run for the same proposal. Ref-hold the
  // callback (same idiom as onDraftChange in the builder) so identity churn
  // doesn't re-fire it.
  const onProposalAttachedRef = useRef(onProposalAttached)
  onProposalAttachedRef.current = onProposalAttached
  useEffect(() => {
    onProposalAttachedRef.current?.(
      proposalRowId === NO_PROPOSAL ? null : proposalRowId,
    )
  }, [proposalRowId])

  const [targetMargin, setTargetMargin] = useState("40")
  const [floorMargin, setFloorMargin] = useState("25")
  const [currentShare, setCurrentShare] = useState("")
  const [targetShare, setTargetShare] = useState("")
  // Facility estimated spend, ONE ROW PER CATEGORY (Charles 2026-07-05
  // "should be able to enter more than one category spend"). The Σ feeds the
  // analyzer; the categories scope the server backfill.
  const [categorySpends, setCategorySpends] = useState<
    { _uid: string; category: string; spend: string }[]
  >(() => [{ _uid: crypto.randomUUID(), category: "", spend: "" }])
  const [internalUnitCost, setInternalUnitCost] = useState("")
  const [equipmentCost, setEquipmentCost] = useState("")
  const [maintenanceCost, setMaintenanceCost] = useState("")
  // Audit L10: previously hardcoded to 60 / 0.05 / 0.10 server-input.
  const [termMonths, setTermMonths] = useState("60")
  const [interestRate, setInterestRate] = useState("5")
  const [discountRate, setDiscountRate] = useState("10")

  // When a real proposal is attached (via preselect OR the dropdown), load its
  // usage + pricing as the reference and restore the saved deal — one-shot per
  // proposal id; see deal-scorer/use-proposal-hydration.ts. NOTE: registered
  // AFTER the attach-report effect above and BEFORE the actuals sync below,
  // matching the pre-split effect order.
  useProposalHydration(proposalRowId, {
    setFacilityId,
    setProposalCategories,
    setCategorySpends,
    setUsageVolumeBySku,
    setUsageLoadedCount,
    setCurrentPriceBySku,
    setPriceLoadedCount,
    setTargetMargin,
    setFloorMargin,
    setCurrentShare,
    setInternalUnitCost,
    setContractVariant,
    setEquipmentCost,
    setMaintenanceCost,
    setTermMonths,
    setInterestRate,
    setDiscountRate,
    setTargetShare,
    setConstructs,
  })

  const isCapital = useMemo(
    () =>
      contractVariant === "CAPITAL_OUTRIGHT" ||
      contractVariant === "CAPITAL_LEASE" ||
      contractVariant === "CAPITAL_TIE_IN",
    [contractVariant],
  )

  // Wave-2 E: two-way sync auto-pull of the facility's trailing-12mo actuals —
  // one-shot per facility; see deal-scorer/use-facility-actuals-sync.ts.
  const actualsSyncMode = useFacilityActualsSync(facilityId, benchmarks, {
    setCurrentPriceBySku,
    setPriceLoadedCount,
    setUsageVolumeBySku,
    setUsageLoadedCount,
    backfillFromReference,
    setCurrentShare,
    setCategorySpends,
  })

  const mutation = useMutation({
    mutationFn: (input: VendorProspectiveAnalysisInput) =>
      getVendorProspectiveAnalysis(input),
    onSuccess: (_result, input) => {
      if (input.proposalRowId) {
        // The score was persisted onto the proposal row — refresh the
        // proposals list so the card shows it.
        queryClient.invalidateQueries({ queryKey: queryKeys.prospective.all })
        toast.success("Score attached to the selected proposal")
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to analyze deal"),
  })

  async function handleAnalyze() {
    // One-page single-commit: if the builder above has unsaved content, save
    // it first — that becomes the attached proposal + resolves the facility,
    // so there's no separate mid-page Save (Charles 2026-07-06). The builder's
    // LIVE facility pick is the fallback so an unattached analyze still knows
    // where the deal is aimed.
    let effFacilityId = facilityId || builderFacilityId || ""
    let effProposalId = proposalRowId
    if (beforeAnalyze && proposalRowId === NO_PROPOSAL && !detachRequested) {
      const saved = await beforeAnalyze()
      // Nothing to attach — the workspace toasted why. Scoring on would throw
      // the run away (Charles 2026-07-27 "…and look at it again").
      if (saved === "abort") return
      if (saved) {
        effProposalId = saved.proposalId
        setProposalRowId(saved.proposalId)
        if (saved.facilityId) {
          effFacilityId = saved.facilityId
          setFacilityId(saved.facilityId)
        }
      }
    }
    if (!effFacilityId) {
      // In the one-page flow the facility lives in the builder above; the
      // bridge save (beforeAnalyze) already toasted the specific gap (missing
      // product/category/facility), so point there instead of a generic
      // "select a facility" the user can't act on here.
      toast.error(
        embedded
          ? "Complete the proposal above (facility + a product), then Analyze."
          : "Select a facility first",
      )
      return
    }
    const { scenarios: blended, currentAnnualSpend } =
      blendConstructsToScenarios(constructs.map(constructToDeal))

    if (blended.length === 0) {
      toast.error("Add at least one construct with a price and annual volume")
      return
    }

    // The vendor's own facility-supply-spend estimate (Σ of the entered
    // category spends) — carried in the handoff so the Opportunity Engine
    // pre-fills its editable "Facility supply spend" instead of re-asking
    // (Charles 2026-07-06 option B).
    const categorySpendSum = categorySpends.reduce(
      (acc, r) => acc + (r.spend ? Number(r.spend) : 0),
      0,
    )

    // Stepper auto-seed (PR 4/5): hand the just-analyzed deal to the Opportunity
    // Engine step — facility + blended Target-vs-Current price change + target
    // share. A fresh proposalId each Analyze so the engine re-applies the latest.
    if (onDealAnalyzed) {
      const totalVolume = blended[0]?.estimatedAnnualVolume ?? 0
      const blendedCurrentUnit =
        totalVolume > 0 ? currentAnnualSpend / totalVolume : 0
      const targetUnit =
        blended.find((s) => s.scenarioName === "Target")?.unitPrice ?? 0
      // No Target prices entered → no proposed change (0), not −100% (V-C6).
      const priceChangePct =
        blendedCurrentUnit > 0 && targetUnit > 0
          ? (targetUnit - blendedCurrentUnit) / blendedCurrentUnit
          : 0
      analyzeSeqRef.current += 1
      onDealAnalyzed({
        proposalId: `step1-${effFacilityId}-${analyzeSeqRef.current}`,
        // When the deal is attached to a real proposal, carry its id so Step 2
        // can save the Opportunity run back onto it.
        savedProposalId:
          effProposalId !== NO_PROPOSAL ? effProposalId : null,
        facilityId: effFacilityId,
        priceChangePct,
        targetSharePct: targetShare ? Number(targetShare) : null,
        // Capital component of THIS deal — Step 2's Capital/Robotic revenue
        // shows real deal capital or nothing (was a hardcoded $1.3M default).
        capitalRevenue:
          isCapital && equipmentCost ? Number(equipmentCost) : null,
        facilitySupplySpend: categorySpendSum > 0 ? categorySpendSum : null,
        // The deal's OWN current revenue — construct Σ(current × volume), else
        // the usage-file Σ — so the Opportunity Engine's "current" comes from
        // the entered deal, never the book-of-business/default seed (bugs.rtfd
        // 2026-07-07 "not sure where these numbers are coming from").
        currentRevenue:
          currentAnnualSpend > 0
            ? currentAnnualSpend
            : usageCurrentRevenue > 0
              ? usageCurrentRevenue
              : null,
        // Manual entry — "" stays null, but a typed 0 is a real answer.
        currentSharePct: currentShare !== "" ? Number(currentShare) : null,
        constructs: constructs.map((c) => ({
          productName: c.productName.trim() || "(unnamed)",
          category: c.category.trim() || undefined,
          ...constructToDeal(c),
        })),
      })
    }

    mutation.mutate({
      facilityId: effFacilityId,
      contractVariant,
      pricingScenarios: blended,
      // Phase 2: persist the real per-construct deal so a scored proposal can be
      // pushed into the Opportunity Engine (the handoff).
      constructs: constructs.map((c) => ({
        benchmarkId: c.benchmarkId,
        productName: c.productName.trim(),
        category: c.category.trim() || undefined,
        ...constructToDeal(c),
      })),
      currentAnnualSpend,
      targetGrossMarginPercent: Number(targetMargin) / 100,
      minimumAcceptableGrossMarginPercent: Number(floorMargin) / 100,
      ...(() => {
        const rows = categorySpends
          .map((r) => ({
            category: r.category.trim(),
            spend: r.spend ? Number(r.spend) : null,
          }))
          .filter((r) => r.category !== "" || (r.spend ?? 0) > 0)
        const sum = rows.reduce((acc, r) => acc + (r.spend ?? 0), 0)
        return {
          facilityEstimatedAnnualSpend: sum > 0 ? sum : undefined,
          estimatedCategorySpends: rows.length > 0 ? rows : undefined,
        }
      })(),
      internalUnitCost:
        internalUnitCost && Number(internalUnitCost) > 0
          ? Number(internalUnitCost)
          : undefined,
      facilityCurrentVendorShare: currentShare
        ? Number(currentShare) / 100
        : undefined,
      // Current revenue on the CONSTRUCTS being negotiated — Σ(construct
      // current price × volume), the same universe the scenario table scores
      // against. Feeding the whole usage-file Σ here instead put the
      // penetration half on a larger SKU set than the scenario half, so the
      // analyzer's spend floor + "revenue loss" warning fired on inconsistent
      // bases (Charles 2026-07-06 "the AI spend numbers here are wrong").
      // Falls back to the usage-file Σ only when no construct carries a current
      // price.
      facilityCurrentVendorRevenue:
        currentAnnualSpend > 0
          ? currentAnnualSpend
          : usageCurrentRevenue > 0
            ? usageCurrentRevenue
            : undefined,
      targetVendorShare: targetShare ? Number(targetShare) / 100 : undefined,
      capitalDetails:
        isCapital && equipmentCost
          ? {
              equipmentCost: Number(equipmentCost),
              annualMaintenanceCost: maintenanceCost
                ? Number(maintenanceCost)
                : 0,
              termMonths: Number(termMonths) > 0 ? Number(termMonths) : 60,
              interestRate: Number(interestRate) >= 0 ? Number(interestRate) / 100 : 0.05,
              discountRate: Number(discountRate) >= 0 ? Number(discountRate) / 100 : 0.1,
            }
          : undefined,
      proposalRowId: effProposalId !== NO_PROPOSAL ? effProposalId : undefined,
    })
  }

  function updateConstruct(uid: string, patch: Partial<ConstructForm>) {
    setConstructs((prev) =>
      prev.map((c) => (c._uid === uid ? { ...c, ...patch } : c)),
    )
  }

  function addConstruct() {
    setConstructs((prev) => [...prev, makeConstruct()])
  }

  // Usage = the VOLUME reference (Vick 2026-06-24: "usage is where volume and
  // spend is compared against" — it does NOT create constructs). Build a
  // SKU→volume map and backfill the volume on any already-picked benchmark
  // constructs that match.
  function handleUsageImport(
    rows: Record<string, string>[],
    mapping: ResolvedMapping,
    meta: { fileName: string; headers: string[] },
  ) {
    const result = mapUsageRows(meta.headers, rows, mapping)
    if (!result.ok) {
      toast.error("Usage file needs a product-name column")
      return
    }
    const map = new Map<string, number>()
    for (const p of result.products) {
      const sku = normalizeSku(p.refNumber)
      if (!sku) continue
      map.set(sku, p.historicalAvgVolume ?? p.projectedVolume ?? 0)
    }
    setUsageVolumeBySku(map)
    setUsageLoadedCount(map.size)
    backfillFromReference({ volume: map })
    toast.success(`Usage loaded — ${map.size} products (volume reference)`)
  }

  // Current price file (Vick 2026-06-24: "price file loaded is current price").
  // SKU→price map; backfills Current on matching benchmark constructs.
  function handlePriceImport(
    rows: Record<string, string>[],
    mapping: ResolvedMapping,
    meta: { fileName: string; headers: string[] },
  ) {
    const result = mapPricingRows(meta.headers, rows, mapping)
    if (!result.ok) {
      toast.error("Price file needs a product name or reference column")
      return
    }
    const map = new Map<string, number>()
    for (const p of result.products) {
      const sku = normalizeSku(p.refNumber)
      if (!sku || !(p.proposedPrice > 0)) continue
      map.set(sku, p.proposedPrice)
    }
    setCurrentPriceBySku(map)
    setPriceLoadedCount(map.size)
    backfillFromReference({ price: map })
    toast.success(`Current prices loaded — ${map.size} products`)
  }

  // Fill Volume / Current on existing benchmark constructs from the reference
  // maps (only where the field is still blank — never clobber an entry).
  function backfillFromReference(ref: {
    volume?: Map<string, number>
    price?: Map<string, number>
  }) {
    setConstructs((prev) =>
      prev.map((c) => {
        const b = c.benchmarkId ? benchmarkById.get(c.benchmarkId) : null
        if (!b) return c
        const sku = normalizeSku(b.itemNumber)
        const v = ref.volume?.get(sku)
        const p = ref.price?.get(sku)
        return {
          ...c,
          annualVolume: !c.annualVolume && v != null ? String(v) : c.annualVolume,
          current: !c.current && p != null ? String(p) : c.current,
        }
      }),
    )
  }

  function removeConstruct(uid: string) {
    setConstructs((prev) =>
      prev.length <= 1 ? prev : prev.filter((c) => c._uid !== uid),
    )
  }

  // Add a construct seeded from an uploaded benchmark — fills the first blank
  // row if there is one, otherwise appends.
  // Why a benchmark-picked construct still has empty cells. Derived during
  // render (never mirrored into state) from the same inputs the auto-fill reads,
  // so it cannot drift from what actually happened.
  const constructBlankReasons = useMemo(
    () =>
      computeConstructBlankReasons(
        constructs,
        priceLoadedCount,
        usageLoadedCount,
      ),
    [constructs, priceLoadedCount, usageLoadedCount],
  )

  function addBenchmarkConstruct(benchmarkId: string) {
    const b = benchmarkById.get(benchmarkId)
    if (!b) return
    const productName = `${b.itemNumber} — ${b.productName}`.slice(0, 90)
    // Every cell the benchmark ROW can answer — Current ("Current Pricing"),
    // Volume ("TRL 12 Units"), Floor and Target — with the separately-uploaded
    // price / usage files as SKU-matched fallbacks. The rule itself lives in
    // construct-seed.ts so it stays pinned by tests and can't drift from the
    // blank-cell copy below, which derives from the same precedence.
    const sku = normalizeSku(b.itemNumber)
    const seeded = seedConstructFromBenchmark(b, {
      price: currentPriceBySku.get(sku),
      volume: usageVolumeBySku.get(sku),
    })
    // Seed the category from the benchmark's own Category column when present,
    // else the FIRST category the vendor picked in the builder above (live) or
    // on the attached proposal; blank (and editable) only when nothing is
    // available (Charles 2026-07-06 "categories not coming over").
    const seededCat =
      b.category && b.category !== "Uncategorized"
        ? b.category
        : (effectiveCategories[0] ?? "")
    setConstructs((prev) => {
      const blankIdx = prev.findIndex(
        (c) =>
          !c.benchmarkId &&
          !c.productName &&
          !c.current &&
          !c.floor &&
          !c.target &&
          !c.ask &&
          !c.annualVolume,
      )
      const seed = makeConstruct({
        benchmarkId: b.id,
        productName,
        category: seededCat,
        ...seeded,
      })
      if (blankIdx >= 0) {
        return prev.map((c, i) =>
          i === blankIdx ? { ...seed, _uid: c._uid } : c,
        )
      }
      return [...prev, seed]
    })
  }

  // Inherited-context derivations (embedded one-page flow). The facility
  // resolves from the local pick, else the builder's LIVE facility selection
  // (streamed down before Analyze), so the summary names it immediately instead
  // of waiting for the bridge-save (Charles 2026-07-06).
  const effectiveFacilityId = facilityId || builderFacilityId || ""
  const inheritedFacilityName =
    facilities.find((f) => f.id === effectiveFacilityId)?.name ?? null
  // In the one-page flow the facility, usage, pricing, and categories are
  // BUILDER concerns — always inherit, never re-ask here (Charles 2026-07-06).
  // Before the bridge-save the facility resolves on "Analyze deal"; the
  // summary shows the proposal facility once known.
  const inheritInputs = embedded

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal Scorer</CardTitle>
          <CardDescription>
            Build the deal product-by-product — Current / Floor / Target / Ask
            pricing per construct — and see margin, payback, and penetration
            upside. Attach the score to a proposal to push it into the
            Opportunity Engine.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <DealInputsHeader
            embedded={embedded}
            inheritInputs={inheritInputs}
            inheritedFacilityName={inheritedFacilityName}
            usageLoadedCount={usageLoadedCount}
            priceLoadedCount={priceLoadedCount}
            actualsSyncMode={actualsSyncMode}
            facilityId={facilityId}
            setFacilityId={setFacilityId}
            facilities={facilities}
            contractVariant={contractVariant}
            setContractVariant={setContractVariant}
            proposalRowId={proposalRowId}
            onProposalRowChange={(v) => {
              setProposalRowId(v)
              setDetachRequested(v === NO_PROPOSAL)
            }}
            proposals={proposals}
            onUsageImport={handleUsageImport}
            onPriceImport={handlePriceImport}
          />

          <ConstructsTable
            constructs={constructs}
            benchmarks={benchmarks}
            benchmarkById={benchmarkById}
            benchmarkCategories={benchmarkCategories}
            constructBlankReasons={constructBlankReasons}
            benchPick={benchPick}
            onPickBenchmark={(v) => {
              addBenchmarkConstruct(v)
              setBenchPick("")
            }}
            onAddConstruct={addConstruct}
            onUpdateConstruct={updateConstruct}
            onRemoveConstruct={removeConstruct}
          />

          <AssumptionFields
            targetMargin={targetMargin}
            setTargetMargin={setTargetMargin}
            floorMargin={floorMargin}
            setFloorMargin={setFloorMargin}
            currentShare={currentShare}
            setCurrentShare={setCurrentShare}
            targetShare={targetShare}
            setTargetShare={setTargetShare}
            categorySpends={categorySpends}
            setCategorySpends={setCategorySpends}
            benchmarkCategories={benchmarkCategories}
            estimateCategorySpendFromFiles={estimateCategorySpend}
            internalUnitCost={internalUnitCost}
            setInternalUnitCost={setInternalUnitCost}
            isCapital={isCapital}
            equipmentCost={equipmentCost}
            setEquipmentCost={setEquipmentCost}
            maintenanceCost={maintenanceCost}
            setMaintenanceCost={setMaintenanceCost}
            termMonths={termMonths}
            setTermMonths={setTermMonths}
            interestRate={interestRate}
            setInterestRate={setInterestRate}
            discountRate={discountRate}
            setDiscountRate={setDiscountRate}
          />

          <div className="flex justify-end">
            <Button onClick={handleAnalyze} disabled={mutation.isPending}>
              <Gauge className="mr-2 h-4 w-4" />
              {mutation.isPending ? "Analyzing…" : "Analyze deal"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {mutation.data && <ResultsView result={mutation.data} />}
    </div>
  )
}
