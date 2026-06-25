"use client"

import { useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Gauge, AlertTriangle, TrendingUp, Sparkles, DollarSign, Trash2, Plus } from "lucide-react"
import { toast } from "sonner"

import { formatCurrency, formatPercent } from "@/lib/formatting"
import { queryKeys } from "@/lib/query-keys"
import { useVendorBenchmarks } from "@/hooks/use-prospective"
import {
  blendConstructsToScenarios,
  type DealConstruct,
} from "@/lib/prospective-analysis/blend-constructs"
import { PricingFileDropzone } from "@/components/shared/uploads/pricing-file-dropzone"
import {
  BUILDER_USAGE_UPLOAD_SPECS,
  BUILDER_PRICING_UPLOAD_SPECS,
  mapUsageRows,
  mapPricingRows,
} from "@/components/vendor/prospective/builder/file-handlers"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import {
  getVendorProspectiveAnalysis,
  type VendorProspectiveAnalysisInput,
} from "@/lib/actions/vendor-prospective"
import type {
  VendorContractVariant,
  VendorProspectiveResult,
} from "@/lib/prospective-analysis/vendor-prospective-analyzer"
import type { VendorProposal } from "@/lib/actions/prospective"
import { type OppEngineHandoff } from "./OpportunityEngineSection"

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
}

const NO_PROPOSAL = "__none__"

// One "construct" per product line: pick a benchmark (or free-text), then enter
// the Current / Floor / Target / Ask unit prices, annual volume and rebate %.
// Keyed by a stable UI-only _uid (CLAUDE.md: editable lists key by id, not idx).
interface ConstructForm {
  _uid: string
  benchmarkId: string | null
  productName: string
  current: string
  floor: string
  target: string
  ask: string
  annualVolume: string
  rebatePercent: string
}

function makeConstruct(seed?: Partial<ConstructForm>): ConstructForm {
  return {
    _uid: crypto.randomUUID(),
    benchmarkId: null,
    productName: "",
    current: "",
    floor: "",
    target: "",
    ask: "",
    annualVolume: "",
    rebatePercent: "0",
    ...seed,
  }
}

// ─── Section ───────────────────────────────────────────────────

export function DealScorerSection({ facilities, proposals, vendorId, onDealAnalyzed }: DealScorerSectionProps) {
  const queryClient = useQueryClient()
  const [facilityId, setFacilityId] = useState<string>("")
  const [proposalRowId, setProposalRowId] = useState<string>(NO_PROPOSAL)
  const [contractVariant, setContractVariant] =
    useState<VendorContractVariant>("USAGE_SPEND")
  const [constructs, setConstructs] = useState<ConstructForm[]>(() => [
    makeConstruct(),
  ])
  const { data: benchmarks } = useVendorBenchmarks(vendorId)
  const benchmarkById = useMemo(
    () => new Map((benchmarks ?? []).map((b) => [b.id, b])),
    [benchmarks],
  )
  const [benchPick, setBenchPick] = useState("")
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
  const [targetMargin, setTargetMargin] = useState("40")
  const [floorMargin, setFloorMargin] = useState("25")
  const [currentShare, setCurrentShare] = useState("")
  const [targetShare, setTargetShare] = useState("")
  const [estimatedSpend, setEstimatedSpend] = useState("")
  const [internalUnitCost, setInternalUnitCost] = useState("")
  const [equipmentCost, setEquipmentCost] = useState("")
  const [maintenanceCost, setMaintenanceCost] = useState("")
  // Audit L10: previously hardcoded to 60 / 0.05 / 0.10 server-input.
  const [termMonths, setTermMonths] = useState("60")
  const [interestRate, setInterestRate] = useState("5")
  const [discountRate, setDiscountRate] = useState("10")

  const isCapital = useMemo(
    () =>
      contractVariant === "CAPITAL_OUTRIGHT" ||
      contractVariant === "CAPITAL_LEASE" ||
      contractVariant === "CAPITAL_TIE_IN",
    [contractVariant],
  )

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

  function constructToDeal(c: ConstructForm): DealConstruct {
    return {
      current: Number(c.current || "0"),
      floor: Number(c.floor || "0"),
      target: Number(c.target || "0"),
      ask: Number(c.ask || "0"),
      annualVolume: Number(c.annualVolume || "0"),
      rebatePercent: Number(c.rebatePercent || "0"),
    }
  }

  function handleAnalyze() {
    if (!facilityId) {
      toast.error("Select a facility first")
      return
    }
    const { scenarios: blended, currentAnnualSpend } =
      blendConstructsToScenarios(constructs.map(constructToDeal))

    if (blended.length === 0) {
      toast.error("Add at least one construct with a price and annual volume")
      return
    }

    // Stepper auto-seed (PR 4/5): hand the just-analyzed deal to the Opportunity
    // Engine step — facility + blended Target-vs-Current price change + target
    // share. A fresh proposalId each Analyze so the engine re-applies the latest.
    if (onDealAnalyzed) {
      const totalVolume = blended[0]?.estimatedAnnualVolume ?? 0
      const blendedCurrentUnit =
        totalVolume > 0 ? currentAnnualSpend / totalVolume : 0
      const targetUnit =
        blended.find((s) => s.scenarioName === "Target")?.unitPrice ?? 0
      const priceChangePct =
        blendedCurrentUnit > 0
          ? (targetUnit - blendedCurrentUnit) / blendedCurrentUnit
          : 0
      analyzeSeqRef.current += 1
      onDealAnalyzed({
        proposalId: `step1-${facilityId}-${analyzeSeqRef.current}`,
        facilityId,
        priceChangePct,
        targetSharePct: targetShare ? Number(targetShare) : null,
        constructs: constructs.map((c) => ({
          productName: c.productName.trim() || "(unnamed)",
          ...constructToDeal(c),
        })),
      })
    }

    mutation.mutate({
      facilityId,
      contractVariant,
      pricingScenarios: blended,
      // Phase 2: persist the real per-construct deal so a scored proposal can be
      // pushed into the Opportunity Engine (the handoff).
      constructs: constructs.map((c) => ({
        benchmarkId: c.benchmarkId,
        productName: c.productName.trim(),
        ...constructToDeal(c),
      })),
      currentAnnualSpend,
      targetGrossMarginPercent: Number(targetMargin) / 100,
      minimumAcceptableGrossMarginPercent: Number(floorMargin) / 100,
      facilityEstimatedAnnualSpend: estimatedSpend
        ? Number(estimatedSpend)
        : undefined,
      internalUnitCost:
        internalUnitCost && Number(internalUnitCost) > 0
          ? Number(internalUnitCost)
          : undefined,
      facilityCurrentVendorShare: currentShare
        ? Number(currentShare) / 100
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
      proposalRowId: proposalRowId !== NO_PROPOSAL ? proposalRowId : undefined,
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
  function addBenchmarkConstruct(benchmarkId: string) {
    const b = benchmarkById.get(benchmarkId)
    if (!b) return
    const productName = `${b.itemNumber} — ${b.productName}`.slice(0, 90)
    // Auto-fill Current (price file) + Volume (usage) by matching the
    // benchmark's SKU; the vendor fills Floor / Target / Ask.
    const sku = normalizeSku(b.itemNumber)
    const current = currentPriceBySku.get(sku)
    const volume = usageVolumeBySku.get(sku)
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
        current: current != null ? String(current) : "",
        annualVolume: volume != null ? String(volume) : "",
      })
      if (blankIdx >= 0) {
        return prev.map((c, i) =>
          i === blankIdx ? { ...seed, _uid: c._uid } : c,
        )
      }
      return [...prev, seed]
    })
  }

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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="facility">Facility</Label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger id="facility">
                  <SelectValue placeholder="Select a facility..." />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {facilities.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No facilities related to your organization yet — facilities
                  appear here once you have a contract, sales history, or
                  submitted proposal with them.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="variant">Contract variant</Label>
              <Select
                value={contractVariant}
                onValueChange={(v) => setContractVariant(v as VendorContractVariant)}
              >
                <SelectTrigger id="variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USAGE_SPEND">Usage — Spend</SelectItem>
                  <SelectItem value="USAGE_VOLUME">Usage — Volume</SelectItem>
                  <SelectItem value="USAGE_MARKET_SHARE">Usage — Market Share</SelectItem>
                  <SelectItem value="CAPITAL_OUTRIGHT">Capital — Outright</SelectItem>
                  <SelectItem value="CAPITAL_LEASE">Capital — Lease</SelectItem>
                  <SelectItem value="CAPITAL_TIE_IN">Capital — Tie-in</SelectItem>
                  <SelectItem value="SERVICE_FIXED">Service — Fixed</SelectItem>
                  <SelectItem value="SERVICE_VARIABLE">Service — Variable</SelectItem>
                  <SelectItem value="GPO">GPO</SelectItem>
                  <SelectItem value="PRICING_ONLY">Pricing only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="attach-proposal">
              Attach score to proposal (optional)
            </Label>
            <Select value={proposalRowId} onValueChange={setProposalRowId}>
              <SelectTrigger id="attach-proposal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROPOSAL}>
                  Don&apos;t attach — just analyze
                </SelectItem>
                {proposals.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    #{p.id.slice(0, 8)} — {p.itemCount} items,{" "}
                    {formatCurrency(p.totalProposedCost)}
                    {p.dealScore ? ` (scored ${p.dealScore.overall})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The overall score is saved on the selected proposal and shown
              on its card in My Proposals.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <Label className="text-sm">
                Usage history{" "}
                {usageLoadedCount > 0 && (
                  <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">
                    · {usageLoadedCount} products
                  </span>
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                The 12-month volume each construct is compared against. Fills a
                construct&rsquo;s Volume when you pick its benchmark. Does not
                create constructs.
              </p>
              <PricingFileDropzone
                specs={BUILDER_USAGE_UPLOAD_SPECS}
                surface="vendor-deal-scorer-usage"
                accept=".csv,.txt,.xlsx,.xls"
                onImport={handleUsageImport}
                triggerLabel="Upload usage history"
                triggerHint="drop or click (.csv, .txt, .xlsx, .xls)"
              />
            </div>

            <div className="space-y-2 rounded-md border border-dashed p-3">
              <Label className="text-sm">
                Current price file{" "}
                {priceLoadedCount > 0 && (
                  <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">
                    · {priceLoadedCount} products
                  </span>
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                The price the facility pays today. Fills a construct&rsquo;s
                Current price when you pick its benchmark.
              </p>
              <PricingFileDropzone
                specs={BUILDER_PRICING_UPLOAD_SPECS}
                surface="vendor-deal-scorer-price"
                accept=".csv,.txt,.xlsx,.xls"
                onImport={handlePriceImport}
                triggerLabel="Upload current prices"
                triggerHint="drop or click (.csv, .txt, .xlsx, .xls)"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Label>Constructs</Label>
                <p className="text-xs text-muted-foreground">
                  Pick products from your benchmark list — usage fills Volume and
                  the price file fills Current; you enter Floor / Target / Ask.
                  The score blends every construct.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(benchmarks?.length ?? 0) > 0 && (
                  <Select
                    value={benchPick}
                    onValueChange={(v) => {
                      addBenchmarkConstruct(v)
                      setBenchPick("")
                    }}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Add from benchmark…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(benchmarks ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.itemNumber} — {b.productName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addConstruct}>
                  <Plus className="mr-1 h-4 w-4" /> Add custom
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-medium">Product</th>
                    <th className="p-2 text-right font-medium">Current</th>
                    <th className="p-2 text-right font-medium">Floor</th>
                    <th className="p-2 text-right font-medium">Target</th>
                    <th className="p-2 text-right font-medium">Ask</th>
                    <th className="p-2 text-right font-medium">Volume</th>
                    <th className="p-2 text-right font-medium">Rebate %</th>
                    <th className="p-2 text-right font-medium">Benchmark</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {constructs.map((c, idx) => {
                    const b = c.benchmarkId
                      ? benchmarkById.get(c.benchmarkId)
                      : null
                    const isLast = idx === constructs.length - 1
                    const numCell = (
                      field: keyof ConstructForm,
                      mode: "decimal" | "numeric" = "decimal",
                    ) => (
                      <td className="p-1.5">
                        <Input
                          className="h-8 w-[84px] text-right"
                          type="number"
                          inputMode={mode}
                          value={c[field] as string}
                          onChange={(e) =>
                            updateConstruct(c._uid, { [field]: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && isLast) addConstruct()
                          }}
                        />
                      </td>
                    )
                    return (
                      <tr key={c._uid} className="border-t align-top">
                        <td className="min-w-[180px] p-1.5">
                          {b ? (
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {c.productName}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                benchmark · {b.category ?? "uncategorized"}
                              </span>
                            </div>
                          ) : (
                            <Input
                              className="h-8"
                              placeholder="Product name"
                              value={c.productName}
                              onChange={(e) =>
                                updateConstruct(c._uid, {
                                  productName: e.target.value,
                                })
                              }
                            />
                          )}
                        </td>
                        {numCell("current")}
                        {numCell("floor")}
                        {numCell("target")}
                        {numCell("ask")}
                        {numCell("annualVolume", "numeric")}
                        {numCell("rebatePercent")}
                        <td className="whitespace-nowrap p-1.5 text-right text-xs">
                          {b ? (
                            <>
                              <div>avg {formatCurrency(b.nationalAvgPrice)}</div>
                              <div className="text-muted-foreground">
                                {formatCurrency(b.percentile25)}–
                                {formatCurrency(b.percentile75)}
                              </div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-1.5 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-600"
                            onClick={() => removeConstruct(c._uid)}
                            disabled={constructs.length <= 1}
                            aria-label="Remove construct"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="target-margin">Target margin %</Label>
              <Input
                id="target-margin"
                type="number"
                value={targetMargin}
                onChange={(e) => setTargetMargin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="floor-margin">Floor margin %</Label>
              <Input
                id="floor-margin"
                type="number"
                value={floorMargin}
                onChange={(e) => setFloorMargin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-share">Current share %</Label>
              <Input
                id="current-share"
                type="number"
                placeholder="optional"
                value={currentShare}
                onChange={(e) => setCurrentShare(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-share">Target share %</Label>
              <Input
                id="target-share"
                type="number"
                placeholder="optional"
                value={targetShare}
                onChange={(e) => setTargetShare(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="estimated-spend">
              Facility estimated annual category spend ($)
            </Label>
            <Input
              id="estimated-spend"
              type="number"
              placeholder="leave blank to estimate from your own sales"
              value={estimatedSpend}
              onChange={(e) => setEstimatedSpend(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The facility&apos;s TOTAL category spend across all vendors.
              Left blank, it&apos;s estimated from your own trailing-12mo
              sales to this facility — divided by Current share % when you
              provide one; otherwise penetration deltas are approximate.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="internal-unit-cost">Internal unit cost ($ / unit)</Label>
            <Input
              id="internal-unit-cost"
              type="number"
              inputMode="decimal"
              placeholder="leave blank to assume a 55% gross margin"
              value={internalUnitCost}
              onChange={(e) => setInternalUnitCost(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your true COGS per unit. Drives the gross-margin verdict for every
              scenario. Left blank, the analysis falls back to a 55% gross-margin
              (45% COGS) assumption.
            </p>
          </div>

          {isCapital && (
            <div className="grid gap-4 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="equipment-cost">Equipment cost ($)</Label>
                <Input
                  id="equipment-cost"
                  type="number"
                  value={equipmentCost}
                  onChange={(e) => setEquipmentCost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maint-cost">Annual maintenance ($)</Label>
                <Input
                  id="maint-cost"
                  type="number"
                  value={maintenanceCost}
                  onChange={(e) => setMaintenanceCost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="term-months">Term (months)</Label>
                <Input
                  id="term-months"
                  type="number"
                  inputMode="numeric"
                  value={termMonths}
                  onChange={(e) => setTermMonths(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interest-rate">Interest %</Label>
                <Input
                  id="interest-rate"
                  type="number"
                  inputMode="decimal"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="discount-rate">Discount %</Label>
                <Input
                  id="discount-rate"
                  type="number"
                  inputMode="decimal"
                  value={discountRate}
                  onChange={(e) => setDiscountRate(e.target.value)}
                />
              </div>
            </div>
          )}

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

// ─── Results ───────────────────────────────────────────────────

function ResultsView({ result }: { result: VendorProspectiveResult }) {
  // Audit M6: no caller supplies a proposedRebateConfig today, so the
  // tier-optimization result is the "No tiered rebate config supplied"
  // sentinel (all three numeric fields null). Hide the card rather than
  // render a permanently-dead "Achieved tier: none" panel.
  const t = result.tierOptimization
  const hasTierAnalysis =
    t.achievedTier != null ||
    t.distanceToNextTier != null ||
    t.additionalRebateAtNextTier != null

  return (
    <div className="space-y-4">
      {result.warnings.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <ul className="space-y-1 text-sm">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ScenarioTable result={result} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PenetrationCard result={result} />
        {hasTierAnalysis && <TierOptimizationCard result={result} />}
      </div>

      {result.capitalAnalysis && <CapitalCard result={result} />}
    </div>
  )
}

function ScenarioTable({ result }: { result: VendorProspectiveResult }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Scenario margin analysis</CardTitle>
        <CardDescription>
          Recommended scenario:{" "}
          {result.recommendedScenario ? (
            <span className="font-semibold">
              {result.recommendedScenario.scenarioName} —{" "}
              {formatPercent(result.recommendedScenario.grossMarginPercent * 100)} margin
            </span>
          ) : (
            <span className="text-red-600">none meet floor</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2 font-medium">Scenario</th>
                <th className="p-2 font-medium">Unit price</th>
                <th className="p-2 font-medium">Annual revenue</th>
                <th className="p-2 font-medium">Rebate paid</th>
                <th className="p-2 font-medium">Net revenue</th>
                <th className="p-2 font-medium">Gross margin</th>
                <th className="p-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {result.scenarioResults.map((s) => {
                const isRecommended =
                  result.recommendedScenario?.scenarioName === s.scenarioName
                return (
                  <tr
                    key={s.scenarioName}
                    className={
                      isRecommended
                        ? "border-t bg-emerald-50/50 dark:bg-emerald-950/20"
                        : "border-t"
                    }
                  >
                    <td className="p-2 font-medium">
                      {s.scenarioName}
                      {isRecommended && (
                        <Sparkles className="ml-1 inline h-3 w-3 text-emerald-600" />
                      )}
                    </td>
                    <td className="p-2">{formatCurrency(s.unitPrice)}</td>
                    <td className="p-2">{formatCurrency(s.annualRevenue)}</td>
                    <td className="p-2">{formatCurrency(s.annualRebatePaid)}</td>
                    <td className="p-2">{formatCurrency(s.netRevenue)}</td>
                    <td className="p-2">
                      {formatPercent(s.grossMarginPercent * 100)}
                    </td>
                    <td className="p-2">
                      {!s.meetsFloorMargin ? (
                        <Badge variant="destructive">below floor</Badge>
                      ) : s.meetsTargetMargin ? (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                          meets target
                        </Badge>
                      ) : (
                        <Badge variant="secondary">above floor</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function PenetrationCard({ result }: { result: VendorProspectiveResult }) {
  const p = result.penetrationAnalysis
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Penetration & revenue at risk
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label="Current share" value={formatPercent(p.currentShare * 100)} />
        <Row label="Target share" value={formatPercent(p.targetShare * 100)} />
        <Row
          label="Current revenue"
          value={formatCurrency(p.currentAnnualRevenue)}
        />
        <Row
          label="Target revenue"
          value={formatCurrency(p.targetAnnualRevenue)}
        />
        <Row
          label="Incremental opportunity"
          value={formatCurrency(p.incrementalRevenueOpportunity)}
          emphasis
        />
        <Row
          label="Revenue at risk"
          value={formatCurrency(result.revenueAtRisk)}
          emphasis
        />
      </CardContent>
    </Card>
  )
}

function TierOptimizationCard({ result }: { result: VendorProspectiveResult }) {
  const t = result.tierOptimization
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          Tier optimization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row
          label="Achieved tier"
          value={
            t.achievedTier
              ? (t.achievedTier.tierName ?? `Tier ${t.achievedTier.tierNumber}`)
              : "none"
          }
        />
        {t.distanceToNextTier != null && (
          <Row
            label="Distance to next"
            value={formatCurrency(t.distanceToNextTier)}
          />
        )}
        {t.additionalRebateAtNextTier != null && (
          <Row
            label="Additional rebate at next"
            value={formatCurrency(t.additionalRebateAtNextTier)}
          />
        )}
        <p className="border-t pt-3 text-muted-foreground">{t.recommendation}</p>
      </CardContent>
    </Card>
  )
}

function CapitalCard({ result }: { result: VendorProspectiveResult }) {
  const c = result.capitalAnalysis!
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          Capital ROI
        </CardTitle>
        <CardDescription>
          Recommended-scenario net revenue applied against equipment cost.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-2">
        <Row label="Equipment cost" value={formatCurrency(c.equipmentCost)} />
        <Row
          label="Annual maintenance"
          value={formatCurrency(c.annualMaintenanceCost)}
        />
        <Row label="Total deal value" value={formatCurrency(c.totalDealValue)} emphasis />
        <Row
          label="Payback"
          value={
            c.paybackYears != null
              ? `${c.paybackYears.toFixed(1)} yrs`
              : "never (margin too thin)"
          }
        />
        <Row label="NPV (at your discount rate)" value={formatCurrency(c.npv)} emphasis />
        {c.facilityBreakEvenPaymentPerPeriod != null && (
          <Row
            label="Facility break-even / mo"
            value={formatCurrency(c.facilityBreakEvenPaymentPerPeriod)}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={emphasis ? "font-semibold" : ""}>{value}</span>
    </div>
  )
}
