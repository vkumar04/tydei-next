"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import {
  Activity,
  Building2,
  Database,
  DollarSign,
  Landmark,
  Minus,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react"
import { formatCurrency, formatCompactCurrency } from "@/lib/formatting"
import {
  DEFAULT_PROFORMA_LINE_ITEMS,
  EMPTY_PURCHASE_SCENARIO,
  computePurchaseDividendImpact,
  lineItemsToProforma,
  type ProformaLineItems,
  type PurchaseScenario,
} from "@/lib/financial-analysis/proforma-pnl"
import { FileSpreadsheet } from "lucide-react"
import {
  createMedicareRateResolver,
  effectiveReimbursementPerCase,
  DEFAULT_PERCENT_OF_MEDICARE,
} from "@/lib/financial-analysis/medicare-asc-rates"
import {
  annualize,
  getPayorTrend,
  type PayorProcedureGroup,
  type PayorQuarter,
} from "@/lib/payor-volume/parse-payor-volume-rows"
import {
  getDividendProposal,
  type SavedDividendProposal,
} from "@/lib/actions/dividend-proposals"
import {
  usePayorVolumeDatasets,
  useProformaStatements,
  useMedicareRateSets,
  useMedicareRateOverrides,
} from "@/hooks/use-dividend"
import {
  MoneyInput,
  DeltaTile,
  PnlRow,
  GOOD_TONE,
  BAD_TONE,
} from "@/components/vendor/prospective/dividend/primitives"
import { ProformaEditor } from "@/components/vendor/prospective/dividend/proforma-editor"
import { PayorVolumeUploadDialog } from "@/components/vendor/prospective/dividend/payor-volume-upload-dialog"
import { ProformaUploadDialog } from "@/components/vendor/prospective/dividend/proforma-upload-dialog"
import { MedicareRatesUploadDialog } from "@/components/vendor/prospective/dividend/medicare-rates-upload-dialog"
import { MedicareRateManager } from "@/components/vendor/prospective/dividend/medicare-rate-manager"
import {
  DividendProposalActions,
  type DividendProposalSnapshot,
} from "@/components/vendor/prospective/dividend/dividend-proposal-actions"

/** Stable key for a group's quarter, used to store scenario volume edits. */
function quarterKey(group: string, q: PayorQuarter): string {
  return `${group}::${q.year}-Q${q.quarter}`
}

/** Group names come from uploads with arbitrary casing — never compare raw. */
function normGroup(name: string): string {
  return name.trim().toLowerCase()
}

const DEFAULT_PURCHASE: PurchaseScenario = {
  ...EMPTY_PURCHASE_SCENARIO,
  productName: "New implant system",
  supplyCostDeltaPerCase: 250,
  affectedCases: 1_200,
  incrementalCases: 150,
}

/**
 * Dividend / DCF Impact Report — model a prospective purchase and see how it
 * flows through the facility's steady-state P&L to NOI, the annual owner
 * dividend (distributable cash flow), NPV, payback, and enterprise value.
 * Grounded in payor-reported procedure volume and public Medicare ASC rates.
 */
export function DividendImpactSection({
  vendorId,
  facilities,
  openProposalId,
  onProposalOpened,
}: {
  vendorId: string
  facilities: { id: string; name: string }[]
  /** A saved proposal to load, set when opened from the Opportunities list. */
  openProposalId?: string | null
  /** Called once the load has been applied (or has failed), clearing the request. */
  onProposalOpened?: () => void
}) {
  const [lineItems, setLineItems] = useState<ProformaLineItems>(
    DEFAULT_PROFORMA_LINE_ITEMS,
  )
  const [purchase, setPurchase] = useState<PurchaseScenario>(DEFAULT_PURCHASE)
  const [showProforma, setShowProforma] = useState(false)
  const [payorGroupNames, setPayorGroupNames] = useState<string[]>([])
  // Scenario overrides for individual quarters, keyed `group::YYYY-Qn`, on top
  // of the payor-reported baseline (new cases, ramping quarters).
  const [quarterEdits, setQuarterEdits] = useState<Record<string, number>>({})
  // Facility reimbursement level vs. Medicare (Steady State proforma = 1.2×).
  const [percentOfMedicare, setPercentOfMedicare] = useState(
    DEFAULT_PERCENT_OF_MEDICARE,
  )
  // Manual override of the (blended) public Medicare rate.
  const [medicareRateOverride, setMedicareRateOverride] = useState<
    number | null
  >(null)
  // "" until the vendor picks one; datasets arrive from the server, so the
  // effective selection is DERIVED below rather than synced by an effect.
  const [facilityKeySel, setFacilityKeySel] = useState<string>("")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [proformaUploadOpen, setProformaUploadOpen] = useState(false)
  const [ratesUploadOpen, setRatesUploadOpen] = useState(false)
  // "" = the built-in CY2025 national table.
  const [rateSetId, setRateSetId] = useState<string>("")
  // Which uploaded P&L the current lineItems came from, so a manual edit is
  // visibly distinguishable from "as uploaded".
  const [proformaSource, setProformaSource] = useState<string | null>(null)
  // The saved proposal currently loaded (enables in-place "Save"/"Update").
  const [currentProposalId, setCurrentProposalId] = useState<string | null>(null)
  const [currentProposalName, setCurrentProposalName] = useState<string | null>(
    null,
  )

  const { data: facilityOptions = [], isLoading: datasetsLoading } =
    usePayorVolumeDatasets(vendorId)
  const { data: proformaStatements = [] } = useProformaStatements(vendorId)
  const { data: rateSets = [], isLoading: ratesLoading } =
    useMedicareRateSets(vendorId)
  const { data: rateOverrides = [] } = useMedicareRateOverrides(vendorId)

  // The uploaded rate table currently applied; undefined = built-in.
  const activeRateSet = rateSets.find((s) => s.id === rateSetId)

  // Derive the effective selection: fall back to the first dataset so the tab
  // is usable the moment one exists, and so a selection pointing at a deleted
  // dataset self-heals. `undefined` when the vendor has uploaded nothing yet.
  const activeDataset =
    facilityOptions.find((d) => d.facilityKey === facilityKeySel) ??
    facilityOptions[0]
  const payorGroups: PayorProcedureGroup[] = activeDataset?.groups ?? []

  const selectedPayors = useMemo(
    () => payorGroups.filter((g) => payorGroupNames.includes(g.group)),
    [payorGroupNames, payorGroups],
  )

  // Apply the user's quarter edits on top of the payor baseline, re-deriving
  // each group's annualized volume through the canonical annualize() so an
  // edited group is annualized exactly the way the upload parser did it.
  const effectiveSelectedPayors = useMemo<PayorProcedureGroup[]>(
    () =>
      selectedPayors.map((g) => {
        const quarters = g.quarters.map((q) => {
          const v = quarterEdits[quarterKey(g.group, q)]
          return v === undefined ? q : { ...q, volume: v }
        })
        const { total, annualized } = annualize(quarters)
        return {
          ...g,
          quarters,
          totalVolume: total,
          annualizedVolume: annualized,
        }
      }),
    [selectedPayors, quarterEdits],
  )

  const totalSelectedVolume = useMemo(
    () => effectiveSelectedPayors.reduce((s, g) => s + g.annualizedVolume, 0),
    [effectiveSelectedPayors],
  )
  const baselineSelectedVolume = useMemo(
    () => selectedPayors.reduce((s, g) => s + g.annualizedVolume, 0),
    [selectedPayors],
  )
  const hasQuarterEdits = totalSelectedVolume !== baselineSelectedVolume

  // Per-group public Medicare rate, blended by (edited) volume.
  // Index the rate sources once per change, not once per selected group.
  const resolveRate = useMemo(
    () =>
      createMedicareRateResolver({
        overrides: rateOverrides,
        uploaded: activeRateSet?.rates,
      }),
    [rateOverrides, activeRateSet],
  )

  const medicareBreakdown = useMemo(
    () =>
      effectiveSelectedPayors.map((g) => ({
        group: g.group,
        volume: g.annualizedVolume,
        rate: resolveRate(g.group),
      })),
    [effectiveSelectedPayors, resolveRate],
  )
  const blendedMedicareRate = useMemo(() => {
    const withRate = medicareBreakdown.filter(
      (m) => m.rate && m.rate.medicareRate > 0,
    )
    const totVol = withRate.reduce((s, m) => s + m.volume, 0)
    if (totVol <= 0) return 0
    return (
      withRate.reduce((s, m) => s + m.rate!.medicareRate * m.volume, 0) / totVol
    )
  }, [medicareBreakdown])
  const medicareRate = medicareRateOverride ?? blendedMedicareRate
  const facilityReimbursement = effectiveReimbursementPerCase(
    medicareRate,
    percentOfMedicare,
  )

  // Derive, don't mirror: when payor groups are selected, the affected-case
  // baseline IS their combined annualized volume, and incremental cases bill
  // at exactly the reimbursement the Medicare card displays — including $0
  // (packaged add-on codes), so the card and the engine can never disagree.
  const groupsSelected = payorGroupNames.length > 0
  const effectivePurchase = useMemo<PurchaseScenario>(
    () => ({
      ...purchase,
      affectedCases: groupsSelected ? totalSelectedVolume : purchase.affectedCases,
      caseReimbursement: groupsSelected ? facilityReimbursement : undefined,
    }),
    [purchase, groupsSelected, totalSelectedVolume, facilityReimbursement],
  )

  const impact = useMemo(
    () =>
      computePurchaseDividendImpact(
        lineItemsToProforma(lineItems),
        effectivePurchase,
      ),
    [lineItems, effectivePurchase],
  )

  const setP = (patch: Partial<PurchaseScenario>) =>
    setPurchase((s) => ({ ...s, ...patch }))
  const setF = (patch: Partial<ProformaLineItems>) =>
    setLineItems((s) => ({ ...s, ...patch }))

  const togglePayorGroup = (name: string) => {
    setMedicareRateOverride(null)
    const removing = payorGroupNames.includes(name)
    const next = removing
      ? payorGroupNames.filter((n) => n !== name)
      : [...payorGroupNames, name]
    setPayorGroupNames(next)
    // Drop any quarter edits for a deselected group so they don't reappear.
    if (removing) {
      setQuarterEdits((edits) =>
        Object.fromEntries(
          Object.entries(edits).filter(([k]) => !k.startsWith(`${name}::`)),
        ),
      )
    }
    if (next.length) {
      setP({
        productName: next.length === 1 ? next[0] : `${next.length} procedure groups`,
      })
    }
  }

  const clearPayorGroups = () => {
    setPayorGroupNames([])
    setMedicareRateOverride(null)
    setQuarterEdits({})
  }

  const setQuarterVolume = (group: string, q: PayorQuarter, volume: number) => {
    setQuarterEdits((edits) => ({
      ...edits,
      [quarterKey(group, q)]: Math.max(0, volume),
    }))
  }
  const resetQuarterEdits = (group: string) => {
    setQuarterEdits((edits) =>
      Object.fromEntries(
        Object.entries(edits).filter(([k]) => !k.startsWith(`${group}::`)),
      ),
    )
  }

  /** Load an uploaded P&L into the editable line items. */
  const applyProforma = (statement: {
    facilityKey: string
    lineItems: ProformaLineItems
    facilityLabel: string
  }) => {
    setLineItems(statement.lineItems)
    setProformaSource(statement.facilityLabel)
  }

  // Switching facilities resets the selected procedure groups so stale volume
  // never leaks across facilities, and swaps in that facility's uploaded P&L.
  // Critically, a facility with NO uploaded P&L falls back to the example
  // rather than keeping the previous facility's statement — otherwise one
  // report would silently mix facility A's P&L with facility B's volume.
  const applyFacility = (key: string) => {
    setFacilityKeySel(key)
    clearPayorGroups()
    const statement = proformaStatements.find((s) => s.facilityKey === key)
    if (statement) {
      applyProforma(statement)
    } else if (proformaSource !== null) {
      setLineItems(DEFAULT_PROFORMA_LINE_ITEMS)
      setProformaSource(null)
      toast.info(
        "No P&L on file for this facility — reset to the example statement. Upload the facility's P&L or enter it below.",
      )
    }
  }

  // Restore a saved proposal's full scenario in one shot. The payor dataset
  // may have changed (re-upload, rename, deletion) since the save, so group
  // references are reconciled against the CURRENT dataset — case-insensitive,
  // dropped groups surfaced — instead of silently pointing at nothing.
  const loadProposal = (p: SavedDividendProposal) => {
    const dataset = p.facilityKey
      ? facilityOptions.find((d) => d.facilityKey === p.facilityKey)
      : undefined
    if (!dataset && p.payload.payorGroupNames.length > 0) {
      toast.warning(
        `The payor dataset for “${p.facilityLabel}” is no longer available — the saved scenario numbers were restored, but its volume grounding was dropped.`,
      )
    }
    const currentNameByNorm = new Map(
      (dataset?.groups ?? []).map((g) => [normGroup(g.group), g.group]),
    )
    const kept: string[] = []
    const dropped: string[] = []
    for (const name of p.payload.payorGroupNames) {
      const current = dataset ? currentNameByNorm.get(normGroup(name)) : undefined
      if (current) kept.push(current)
      else dropped.push(name)
    }
    if (dataset && dropped.length > 0) {
      toast.warning(
        `${dropped.length} saved procedure group${dropped.length === 1 ? " is" : "s are"} no longer in the dataset and ${dropped.length === 1 ? "was" : "were"} dropped: ${dropped.join(", ")}`,
      )
    }
    // Re-key quarter edits to the dataset's current group spelling; edits for
    // dropped groups go with them.
    const edits: Record<string, number> = {}
    for (const [key, volume] of Object.entries(p.payload.quarterEdits)) {
      const sep = key.lastIndexOf("::")
      if (sep < 0) continue
      const current = currentNameByNorm.get(normGroup(key.slice(0, sep)))
      if (current && kept.includes(current)) {
        edits[`${current}${key.slice(sep)}`] = volume
      }
    }

    // Restore the rate table the proposal was saved against; warn rather than
    // silently recomputing on the built-in if that table is gone.
    const savedRateSetId = p.payload.medicareRateSetId ?? null
    if (savedRateSetId && !rateSets.some((s) => s.id === savedRateSetId)) {
      toast.warning(
        "The Medicare rate table this proposal was saved with is no longer available — the built-in CY2025 rates were used instead.",
      )
      setRateSetId("")
    } else {
      setRateSetId(savedRateSetId ?? "")
    }

    setLineItems(p.payload.lineItems)
    // The restored P&L comes from the proposal, not from a live upload.
    setProformaSource(null)
    setPurchase(p.payload.purchase)
    setFacilityKeySel(dataset?.facilityKey ?? "")
    setPayorGroupNames(kept)
    setQuarterEdits(edits)
    setPercentOfMedicare(p.payload.percentOfMedicare)
    setMedicareRateOverride(p.payload.medicareRateOverride)
    setCurrentProposalId(p.id)
    setCurrentProposalName(p.name)
  }

  // Load a proposal requested from the Opportunities list. Gated on the
  // datasets and rate sets being settled: loadProposal reconciles the saved
  // payor groups and rate set against them, so firing mid-fetch would report
  // every group as "no longer in the dataset" and warn spuriously.
  const readyToLoad = !datasetsLoading && !ratesLoading
  useEffect(() => {
    if (!openProposalId || !readyToLoad) return
    let cancelled = false
    void (async () => {
      try {
        const full = await getDividendProposal(openProposalId)
        if (cancelled) return
        if (full) loadProposal(full)
        else toast.error("This proposal could not be loaded")
      } catch {
        if (!cancelled) toast.error("This proposal could not be loaded")
      } finally {
        if (!cancelled) onProposalOpened?.()
      }
    })()
    return () => {
      cancelled = true
    }
    // loadProposal closes over live query data; re-running on its identity
    // would reload on every refetch. The id is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openProposalId, readyToLoad])

  const snapshot: DividendProposalSnapshot = {
    // The DERIVED selection, not the raw state — with auto-fallback the two
    // differ, and the proposal must record the dataset actually modeled.
    facilityKey: activeDataset?.facilityKey ?? null,
    facilityLabel: activeDataset?.facilityLabel ?? "Unspecified facility",
    payload: {
      lineItems,
      // Deliberately the EFFECTIVE scenario (derived affectedCases +
      // caseReimbursement), not the raw inputs: a restored proposal must
      // reproduce its saved economics even if the grounding dataset later
      // changes or disappears (loadProposal falls back to these numbers).
      purchase: effectivePurchase,
      payorGroupNames,
      quarterEdits,
      percentOfMedicare,
      medicareRateOverride,
      medicareRateSetId: activeRateSet?.id ?? null,
      // Snapshot the authoritative rates too — they outrank the rate set, so
      // recording only the set id would let a later rate edit silently change
      // a saved proposal's figures.
      medicareRateOverrides: rateOverrides.map((r) => ({
        group: r.group,
        label: r.label,
        code: r.code,
        medicareRate: r.medicareRate,
        note: r.note,
        rateEntered: r.rateEntered,
      })),
    },
    summary: {
      verdict: impact.verdict,
      noiImpact: impact.noiImpact,
      annualDividendImpact: impact.annualDividendImpact,
      netPresentValue: impact.netPresentValue,
      paybackYears: impact.paybackYears,
    },
  }

  const accretive = impact.verdict === "accretive"
  const neutral = impact.verdict === "neutral"
  const VerdictIcon = neutral ? Minus : accretive ? TrendingUp : TrendingDown
  const verdictTone = neutral
    ? "border-border bg-muted/40"
    : accretive
      ? "border-emerald-600/40 bg-emerald-600/10"
      : "border-red-600/40 bg-red-600/10"
  const verdictText = neutral
    ? "No material effect on the dividend"
    : accretive
      ? "This purchase increases the dividend"
      : "This purchase reduces the dividend"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            Dividend &amp; DCF Impact Report
            {currentProposalName ? (
              <Badge variant="secondary" className="font-normal">
                {currentProposalName}
              </Badge>
            ) : null}
          </h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Model a prospective purchase and see exactly how it flows through
            the facility&apos;s steady-state P&amp;L to Net Operating Income,
            the annual owner dividend (distributable cash flow), and the
            discounted-cash-flow value. It answers the customer&apos;s core
            question: does this change help or hurt the dividend?
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MedicareRateManager
            overrides={rateOverrides}
            uploaded={activeRateSet?.rates}
            onRatesChanged={() => setMedicareRateOverride(null)}
          />
          <DividendProposalActions
            vendorId={vendorId}
          currentId={currentProposalId}
          currentName={currentProposalName}
          onLoad={loadProposal}
          onSaved={(p) => {
            setCurrentProposalId(p.id)
            setCurrentProposalName(p.name)
          }}
          onDeleted={(id) => {
            // Deleting the loaded proposal must not leave Save pointing at a
            // dead row — revert to "Save proposal" (create) mode.
            if (id === currentProposalId) {
              setCurrentProposalId(null)
              setCurrentProposalName(null)
            }
          }}
          snapshot={snapshot}
          report={{
            facilityLabel: activeDataset?.facilityLabel ?? "Unspecified facility",
            lineItems,
            purchase: effectivePurchase,
            payorGroupNames,
            percentOfMedicare,
            medicareRate,
            facilityReimbursement,
            totalSelectedVolume,
            impact,
            }}
          />
        </div>
      </div>

      {/* Purchase scenario inputs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposed Purchase</CardTitle>
          <CardDescription>
            Enter the economics of your proposal. Positive supply figures mean
            the facility pays more; use a negative value to model savings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Facility payor dataset */}
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <Label className="text-xs text-muted-foreground">
              Facility payor dataset
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={activeDataset?.facilityKey ?? ""}
                onValueChange={applyFacility}
                disabled={facilityOptions.length === 0}
              >
                <SelectTrigger className="sm:max-w-md">
                  <SelectValue
                    placeholder={
                      datasetsLoading
                        ? "Loading…"
                        : "No payor data yet — upload a file"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {facilityOptions.map((d) => (
                    <SelectItem key={d.facilityKey} value={d.facilityKey}>
                      {d.facilityLabel}
                      {d.connected ? " · connected" : " · unconnected"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setUploadOpen(true)}
              >
                <Upload className="h-4 w-4" />
                Upload payor data
              </Button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {activeDataset
                ? `${activeDataset.groups.length} groups · ${activeDataset.totalAnnualizedVolume.toLocaleString()} cases/yr${
                    activeDataset.periods.length
                      ? ` · ${activeDataset.periods.join(", ")}`
                      : ""
                  } · ${activeDataset.fileName}`
                : datasetsLoading
                  ? "Loading your payor datasets…"
                  : "Upload a payor volume file to ground this analysis in real case volume."}
            </span>
          </div>

          {/* Payor-reported procedure groups (multi-select) */}
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Payor-reported procedure groups
              </Label>
              {selectedPayors.length > 0 ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <Activity className="h-3 w-3" />
                    {selectedPayors.length} selected ·{" "}
                    {totalSelectedVolume.toLocaleString()} cases/yr
                  </Badge>
                  <button
                    type="button"
                    onClick={clearPayorGroups}
                    className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
            {payorGroups.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                <Database className="h-4 w-4" />
                {activeDataset
                  ? "This dataset has no procedure groups — re-upload a file with Procedure Group, Year, Quarter, and Volume columns."
                  : "Upload payor volume data to select procedure groups. Without it the analysis runs on the proforma's own case volume."}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {payorGroups.map((g) => {
                  const active = payorGroupNames.includes(g.group)
                  return (
                    <button
                      key={g.group}
                      type="button"
                      aria-pressed={active}
                      onClick={() => togglePayorGroup(g.group)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        active
                          ? `border-emerald-600 bg-emerald-600/10 ${GOOD_TONE}`
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {g.group}
                    </button>
                  )
                })}
              </div>
            )}
            <span className="text-[11px] text-muted-foreground">
              Grounds the scenario in this facility&apos;s payor-verified
              volume. Select one or more groups to set the affected-case
              baseline to their combined annualized volume.
            </span>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <Label
              htmlFor="dividend-product-name"
              className="text-xs text-muted-foreground"
            >
              Product / proposal name
            </Label>
            <Input
              id="dividend-product-name"
              value={purchase.productName}
              onChange={(e) => setP({ productName: e.target.value })}
            />
          </div>
          <MoneyInput
            label="Supply cost change per case"
            value={purchase.supplyCostDeltaPerCase}
            onChange={(v) => setP({ supplyCostDeltaPerCase: v })}
            hint="Negative = savings vs current product"
          />
          {groupsSelected ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Affected cases / year
              </Label>
              <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm tabular-nums">
                {totalSelectedVolume.toLocaleString()}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Derived from the selected payor groups — edit quarters below.
              </span>
            </div>
          ) : (
            <MoneyInput
              label="Affected cases / year"
              value={purchase.affectedCases}
              onChange={(v) => setP({ affectedCases: v })}
              prefix=""
              hint="Existing cases that use this product"
            />
          )}
          <MoneyInput
            label="Incremental cases / year"
            value={purchase.incrementalCases}
            onChange={(v) => setP({ incrementalCases: v })}
            prefix=""
            hint="New volume the product enables"
          />
          <MoneyInput
            label="Net revenue change per case"
            value={purchase.revenueDeltaPerCase}
            onChange={(v) => setP({ revenueDeltaPerCase: v })}
            hint="From acuity / reimbursement mix"
          />
          <MoneyInput
            label="One-time capital outlay"
            value={purchase.capitalOutlay}
            onChange={(v) => setP({ capitalOutlay: v })}
            hint="Robot / console / equipment purchase"
          />
          <MoneyInput
            label="Recurring annual cost"
            value={purchase.recurringAnnualCost}
            onChange={(v) => setP({ recurringAnnualCost: v })}
            hint="Service, lease, or warranty"
          />
        </CardContent>
      </Card>

      {/* Verdict banner */}
      <div
        className={`flex flex-col gap-3 rounded-lg border p-5 sm:flex-row sm:items-center sm:justify-between ${verdictTone}`}
      >
        <div className="flex items-center gap-3">
          <VerdictIcon
            className={`h-8 w-8 ${neutral ? "text-muted-foreground" : accretive ? GOOD_TONE : BAD_TONE}`}
          />
          <div>
            <div className="text-base font-semibold">{verdictText}</div>
            <div className="text-sm text-muted-foreground">
              {purchase.productName || "Proposed purchase"} · steady-state
              impact
            </div>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-xs text-muted-foreground">
            Annual dividend change
          </div>
          <div
            className={`text-3xl font-bold tabular-nums ${neutral ? "text-foreground" : accretive ? GOOD_TONE : BAD_TONE}`}
          >
            {impact.annualDividendImpact > 0 ? "+" : ""}
            {formatCurrency(impact.annualDividendImpact)}
          </div>
        </div>
      </div>

      {/* Payor volume basis */}
      {effectiveSelectedPayors.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Payor-Reported Volume
            </CardTitle>
            <CardDescription>
              Quarterly case volume from payor data across{" "}
              {effectiveSelectedPayors.length} selected group
              {effectiveSelectedPayors.length === 1 ? "" : "s"}, annualized to{" "}
              {totalSelectedVolume.toLocaleString()} cases/yr — the
              affected-case basis for this analysis. Edit any quarter to model
              volume changes (new cases, ramping quarters).
              {hasQuarterEdits ? (
                <span className="text-foreground">
                  {" "}
                  Scenario is{" "}
                  {totalSelectedVolume - baselineSelectedVolume >= 0 ? "+" : ""}
                  {(totalSelectedVolume - baselineSelectedVolume).toLocaleString()}{" "}
                  cases/yr vs. the payor baseline of{" "}
                  {baselineSelectedVolume.toLocaleString()}.
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {effectiveSelectedPayors.map((g) => {
              const trend = getPayorTrend(g)
              const baseline = selectedPayors.find((s) => s.group === g.group)
              const delta =
                g.annualizedVolume -
                (baseline?.annualizedVolume ?? g.annualizedVolume)
              // Quarter-level comparison, not the annual delta — offsetting
              // edits (+50 in Q1, −50 in Q2) must still surface Reset.
              const edited =
                baseline !== undefined &&
                g.quarters.some((q) => {
                  const b = baseline.quarters.find(
                    (bq) => bq.year === q.year && bq.quarter === q.quarter,
                  )
                  return b !== undefined && b.volume !== q.volume
                })
              return (
                <div key={g.group} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{g.group}</span>
                    <span className="text-xs text-muted-foreground">
                      {g.annualizedVolume.toLocaleString()} cases/yr
                    </span>
                    {edited ? (
                      <Badge
                        variant="outline"
                        className={`gap-1 ${delta > 0 ? `border-emerald-600/40 ${GOOD_TONE}` : `border-red-600/40 ${BAD_TONE}`}`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toLocaleString()} vs. baseline
                      </Badge>
                    ) : trend.direction !== "flat" ? (
                      <Badge
                        variant="outline"
                        className={`gap-1 ${trend.direction === "up" ? `border-emerald-600/40 ${GOOD_TONE}` : `border-red-600/40 ${BAD_TONE}`}`}
                      >
                        <Activity className="h-3 w-3" />
                        {trend.direction === "up" ? "+" : ""}
                        {trend.changePercent}% QoQ
                      </Badge>
                    ) : null}
                    {edited ? (
                      <button
                        type="button"
                        onClick={() => resetQuarterEdits(g.group)}
                        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.quarters.map((q) => {
                      const baseQ = baseline?.quarters.find(
                        (b) => b.year === q.year && b.quarter === q.quarter,
                      )
                      const qEdited = baseQ ? baseQ.volume !== q.volume : false
                      return (
                        <div
                          key={`${q.year}-${q.quarter}`}
                          className={`flex min-w-24 flex-col gap-1 rounded-md border px-3 py-2 ${qEdited ? "border-emerald-600/50 bg-emerald-600/5" : "border-border"}`}
                        >
                          <span className="text-[11px] text-muted-foreground">
                            {q.year} Q{q.quarter}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            value={q.volume}
                            onChange={(e) =>
                              setQuarterVolume(
                                g.group,
                                q,
                                Math.round(Number(e.target.value) || 0),
                              )
                            }
                            className="h-8 w-24 border-0 bg-transparent px-0 text-lg font-semibold tabular-nums focus-visible:ring-0"
                            aria-label={`${g.group} ${q.year} Q${q.quarter} case volume`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* Medicare reimbursement basis */}
      {selectedPayors.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Medicare Reimbursement
              {selectedPayors.length === 1
                ? ` — ${selectedPayors[0].group}`
                : " (volume-weighted blend)"}
            </CardTitle>
            <CardDescription>
              Facilities are paid a negotiated percent of Medicare; effective
              reimbursement per case = Medicare rate × % of Medicare.
              {medicareBreakdown.length === 1 && medicareBreakdown[0].rate?.note
                ? ` ${medicareBreakdown[0].rate.note}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Which rate table applies */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1.5 sm:max-w-md sm:flex-1">
                <Label className="text-[11px] text-muted-foreground">
                  Rate table
                </Label>
                <Select
                  value={rateSetId || "builtin"}
                  onValueChange={(v) => {
                    setRateSetId(v === "builtin" ? "" : v)
                    setMedicareRateOverride(null)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="builtin">
                      Built-in — CMS CY2025 national average
                    </SelectItem>
                    {rateSets.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {s.rates.length} rates
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  {activeRateSet
                    ? `From ${activeRateSet.fileName}. Groups missing from the file fall back to the built-in rates.`
                    : "Public CMS ASC national payment rates. Upload your own for a newer publication year or a locality-adjusted table."}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setRatesUploadOpen(true)}
              >
                <Upload className="h-4 w-4" />
                Upload rates
              </Button>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="dividend-medicare-rate"
                  className="text-[11px] text-muted-foreground"
                >
                  Medicare rate ($/case)
                </Label>
                <Input
                  id="dividend-medicare-rate"
                  type="number"
                  value={Math.round(medicareRate)}
                  onChange={(e) =>
                    setMedicareRateOverride(Number(e.target.value) || 0)
                  }
                />
                <span className="text-[11px] text-muted-foreground">
                  {selectedPayors.length === 1
                    ? (medicareBreakdown[0]?.rate?.code ?? "no public rate")
                    : "volume-weighted blend"}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="dividend-percent-of-medicare"
                  className="text-[11px] text-muted-foreground"
                >
                  % of Medicare
                </Label>
                <Input
                  id="dividend-percent-of-medicare"
                  type="number"
                  value={percentOfMedicare}
                  onChange={(e) =>
                    setPercentOfMedicare(Number(e.target.value) || 0)
                  }
                />
                <span className="text-[11px] text-muted-foreground">
                  {(percentOfMedicare / 100).toFixed(2)}× Medicare
                </span>
              </div>
              <div className="flex flex-col justify-center rounded-md border border-border px-3 py-2">
                <span className="text-[11px] text-muted-foreground">
                  Medicare allowable
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(medicareRate)}
                </span>
              </div>
              <div className="flex flex-col justify-center rounded-md border border-emerald-600/40 bg-emerald-600/10 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">
                  Facility reimbursement/case
                </span>
                <span
                  className={`text-lg font-semibold tabular-nums ${GOOD_TONE}`}
                >
                  {formatCurrency(facilityReimbursement)}
                </span>
              </div>
            </div>
            {selectedPayors.length > 1 ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-3">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Rate by group (weighting the blend)
                </span>
                {medicareBreakdown.map((m) => (
                  <div
                    key={m.group}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {m.group}
                      {m.rate ? ` · ${m.rate.code}` : " · no public rate"}
                    </span>
                    <span className="tabular-nums">
                      {m.rate ? formatCurrency(m.rate.medicareRate) : "—"} ·{" "}
                      {m.volume.toLocaleString()} cases
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Headline deltas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DeltaTile
          label="Net Operating Income"
          value={`${impact.noiImpact > 0 ? "+" : ""}${formatCompactCurrency(impact.noiImpact, { kDecimals: 1 })}`}
          sub={`${formatCompactCurrency(impact.before.netOperatingIncome, { kDecimals: 1 })} → ${formatCompactCurrency(impact.after.netOperatingIncome, { kDecimals: 1 })}`}
          icon={DollarSign}
          positive={impact.noiImpact === 0 ? null : impact.noiImpact > 0}
        />
        <DeltaTile
          label="Annual Dividend (net of capital)"
          value={`${impact.annualDividendImpact > 0 ? "+" : ""}${formatCompactCurrency(impact.annualDividendImpact, { kDecimals: 1 })}`}
          sub={
            impact.annualCapitalCharge > 0
              ? `${formatCompactCurrency(impact.operatingDividendImpact, { kDecimals: 1 })} operating − ${formatCompactCurrency(impact.annualCapitalCharge, { kDecimals: 1 })} capital/yr`
              : `${formatCompactCurrency(impact.annualDividendBefore, { kDecimals: 1 })} → ${formatCompactCurrency(impact.annualDividendAfter, { kDecimals: 1 })}`
          }
          icon={Landmark}
          positive={
            impact.annualDividendImpact === 0
              ? null
              : impact.annualDividendImpact > 0
          }
        />
        <DeltaTile
          label="5-Yr NPV (net of capital)"
          value={`${impact.netPresentValue > 0 ? "+" : ""}${formatCompactCurrency(impact.netPresentValue, { kDecimals: 1 })}`}
          sub={
            impact.capitalOutlay > 0
              ? `after ${formatCompactCurrency(impact.capitalOutlay, { kDecimals: 1 })} outlay`
              : "discounted dividend stream"
          }
          icon={TrendingUp}
          positive={
            impact.netPresentValue === 0 ? null : impact.netPresentValue > 0
          }
        />
        <DeltaTile
          label="Capital Payback"
          value={
            impact.capitalOutlay <= 0
              ? "n/a"
              : impact.paybackYears === null
                ? "Never"
                : `${impact.paybackYears.toFixed(1)} yrs`
          }
          sub={
            impact.capitalOutlay > 0
              ? `on ${formatCompactCurrency(impact.capitalOutlay, { kDecimals: 1 })}`
              : "no capital outlay"
          }
          icon={Timer}
          positive={
            impact.capitalOutlay <= 0
              ? null
              : impact.paybackYears !== null &&
                impact.paybackYears <= impact.assumptions.dcfProjectionYears
          }
        />
      </div>

      {/* Before / After P&L */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Steady-State P&amp;L — Before vs. After
          </CardTitle>
          <CardDescription>
            How the purchase moves each operating line. Expense increases show
            in red; dividend and income gains show in green.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                <TableRow className="text-xs uppercase text-muted-foreground">
                  <TableCell>Line</TableCell>
                  <TableCell className="text-right">Before</TableCell>
                  <TableCell className="text-right">After</TableCell>
                  <TableCell className="text-right">Change</TableCell>
                </TableRow>
                <PnlRow
                  label="Total Revenue"
                  before={impact.before.totalRevenue}
                  after={impact.after.totalRevenue}
                  bold
                />
                <PnlRow
                  label="Medical Supplies"
                  before={impact.before.medicalSupplyExpense}
                  after={impact.after.medicalSupplyExpense}
                  indent
                  invertGood
                />
                <PnlRow
                  label="Other Variable Expenses"
                  before={impact.before.otherVariableExpense}
                  after={impact.after.otherVariableExpense}
                  indent
                  invertGood
                />
                <PnlRow
                  label="Total Variable Expenses"
                  before={impact.before.totalVariableExpense}
                  after={impact.after.totalVariableExpense}
                  invertGood
                />
                <PnlRow
                  label="Fixed Expenses"
                  before={impact.before.fixedExpenses}
                  after={impact.after.fixedExpenses}
                  invertGood
                />
                <PnlRow
                  label="Net Operating Income"
                  before={impact.before.netOperatingIncome}
                  after={impact.after.netOperatingIncome}
                  bold
                />
                {impact.annualCapitalCharge > 0 ? (
                  <TableRow>
                    <TableCell className="pl-8 text-muted-foreground">
                      Annual capital charge
                      <span className="ml-1 text-[11px]">
                        ({formatCurrency(impact.capitalOutlay)} ÷{" "}
                        {effectivePurchase.capitalUsefulLifeYears ||
                          impact.assumptions.dcfProjectionYears}{" "}
                        yrs)
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">—</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(impact.annualCapitalCharge)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${BAD_TONE}`}>
                      −{formatCurrency(impact.annualCapitalCharge)}
                    </TableCell>
                  </TableRow>
                ) : null}
                <PnlRow
                  label="Annual Dividend (Distributable CF)"
                  before={impact.annualDividendBefore}
                  after={impact.annualDividendAfter}
                  bold
                />
                <TableRow>
                  <TableCell className="text-muted-foreground">
                    Case Volume
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {impact.before.caseVolume.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {impact.after.caseVolume.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {impact.after.caseVolume - impact.before.caseVolume >= 0
                      ? "+"
                      : ""}
                    {(
                      impact.after.caseVolume - impact.before.caseVolume
                    ).toLocaleString()}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Enterprise value impact */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enterprise Value Impact</CardTitle>
          <CardDescription>
            Change in enterprise value at each EBITDA multiple, net of any
            capital outlay.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {impact.evScenarios.map((s) => {
            const v = s.incrementalEvNetOfCapital
            return (
              <div
                key={s.multiple}
                className="flex flex-col gap-1 rounded-lg border border-border p-4"
              >
                <div className="text-xs text-muted-foreground">
                  {s.multiple}× EBITDA
                </div>
                <div
                  className={`text-xl font-semibold tabular-nums ${v > 0 ? GOOD_TONE : v < 0 ? BAD_TONE : "text-foreground"}`}
                >
                  {v > 0 ? "+" : ""}
                  {formatCompactCurrency(v, { kDecimals: 1 })}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Facility P&L: upload the statement, or type it in below. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <FileSpreadsheet className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Facility P&amp;L</div>
            <div className="text-[11px] text-muted-foreground">
              {proformaSource
                ? `Loaded from the uploaded statement for ${proformaSource}. Edits below override it.`
                : "Using the 1.2× Medicare example. Upload the facility's Steady State Proforma, or enter it line by line below."}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {proformaSource ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLineItems(DEFAULT_PROFORMA_LINE_ITEMS)
                setProformaSource(null)
              }}
            >
              Reset to example
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setProformaUploadOpen(true)}
          >
            <Upload className="h-4 w-4" />
            Upload P&amp;L
          </Button>
        </div>
      </div>

      {/* Editable facility proforma */}
      <ProformaEditor
        open={showProforma}
        onOpenChange={setShowProforma}
        lineItems={lineItems}
        onChange={setF}
      />

      <PayorVolumeUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        facilities={facilities}
        onSaved={(key) => applyFacility(key)}
      />

      <ProformaUploadDialog
        open={proformaUploadOpen}
        onOpenChange={setProformaUploadOpen}
        facilities={facilities}
        onImported={(r) => applyProforma(r)}
      />

      <MedicareRatesUploadDialog
        open={ratesUploadOpen}
        onOpenChange={setRatesUploadOpen}
        onImported={(r) => {
          setRateSetId(r.id)
          // Drop any manual rate override, or the freshly uploaded table
          // would be selected but have no effect on the displayed rate.
          setMedicareRateOverride(null)
        }}
      />
    </div>
  )
}
