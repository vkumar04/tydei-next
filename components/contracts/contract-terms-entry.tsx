"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Plus,
  Trash2,
  DollarSign,
  TrendingUp,
  Percent,
  PieChart,
  BarChart3,
  Shield,
  Lock,
  Coins,
  HelpCircle,
  AlertTriangle,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Field } from "@/components/shared/forms/field"
import { Label } from "@/components/ui/label"
import { DefinitionTooltip } from "@/components/shared/definition-tooltip"
import { DefinitionTooltip as EnumDefinitionTooltip } from "@/components/contracts/definition-tooltip"
import { TERM_TYPE_DEFINITIONS } from "@/lib/contract-definitions"
import { ContractTierRow } from "@/components/contracts/contract-tier-row"
import { getCategories } from "@/lib/actions/categories"
import { queryKeys } from "@/lib/query-keys"
import type { TermFormValues, TierInput } from "@/lib/validators/contract-terms"
import { SpecificItemsPicker, type VendorItem } from "./specific-items-picker"
import { isCarveOutScopeLocked } from "@/lib/contracts/carve-out-scope"
import { CptCodeList } from "./_form/_cpt-code-list"
import { CategoryMappingSuggestions } from "./_form/_category-mapping-suggestions"

interface ContractTermsEntryProps {
  terms: TermFormValues[]
  onChange: (terms: TermFormValues[]) => void
  /** Preferred list of categories — usually the ones the user already
   *  picked on the contract header. When omitted or empty, the component
   *  falls back to fetching the full platform category list so
   *  Specific-Category tiers can always be scoped. */
  availableCategories?: { id: string; name: string }[]
  /** Vendor items (typically from the contract's pricing file) available
   *  for item-level scoping when `term.appliesTo === "specific_items"`.
   *  Empty array disables the picker with a helpful empty-state hint. */
  availableItems?: VendorItem[]
  /** Contract type from the parent contract — when "tie_in" we render
   *  per-term capital cost / interest rate / term-months inputs. */
  contractType?: string
}

/*
 * Visible term-type picker.
 *
 * Display order:
 *   1. Spend        → spend_rebate
 *   2. Market Share Spend → market_share
 *   3. Volume       → volume_rebate
 *   4. Carve Out    → carve_out
 *   5. Price reduction → price_reduction
 *   6. Market share Price reduction → market_share_price_reduction
 *
 * "Order" (po_rebate) was removed from the selectable picker + legend on
 * Charles 2026-06-07 (unused). It stays in the Prisma TermType enum and the
 * `hidden`-list below for back-compat with existing rows; the renderer still
 * shows it when an existing term already uses it (`tt.value === term.termType`).
 *
 * `growth_rebate` was retired this same session — growth is now a
 * property of any spend-basis term (`growthOnly: true`) rather than a
 * distinct term type. See prisma/migrations/20260525120000_drop_growth_rebate_term_type/.
 *
 * The remaining hidden entries (capitated_*, payment_rebate,
 * compliance_rebate, fixed_fee, locked_pricing, rebate_per_use) stay in
 * the Prisma enum for back-compat with existing rows but are not
 * surfaced for new-term creation. `hidden: true` is the sole filter;
 * the renderer below skips entries with that flag.
 */
const termTypes = [
  // ── Visible (in display order) ─────────────────────────────────
  // 1. Spend
  { value: "spend_rebate", label: "Spend", icon: DollarSign, description: "Rebate based on spend thresholds. Pair with the \"Growth\" baseline calculation method to rebate only spend above a baseline.", disabled: false },
  // 2. Market Share Spend — flat tier dollar amount per evaluation
  // period when `Contract.currentMarketShare` crosses the tier's
  // threshold. Threshold = spendMin column (interpreted as %);
  // rebate = rebateValue (flat $).
  { value: "market_share", label: "Market Share Spend", icon: PieChart, description: "Flat per-period rebate when current market share % crosses tier threshold. Update Current Market Share on the contract.", disabled: false },
  // 3. Volume — counts CPT-coded procedure occurrences across the
  // facility's Cases (deduped by case+CPT) within the term window.
  { value: "volume_rebate", label: "Volume", icon: TrendingUp, description: "Rebate based on procedure count. Set CPT codes on the term; tier thresholds are interpreted as occurrences (not dollars).", disabled: false },
  // 4. Carve Out — specific items excluded from the broader contract
  // terms; per-line carve-out percent applied via the Pricing tab.
  { value: "carve_out", label: "Carve Out", icon: Shield, description: "Specific items excluded from the broader contract terms — per-line carve-out percent applied via the Pricing tab.", disabled: false },
  // 5. Price reduction — no separate rebate accrual; enforced by the
  // contract's ContractPricing rows (the matched price IS the reduced
  // price).
  { value: "price_reduction", label: "Price reduction", icon: Percent, description: "Pricing-only contract — discounted prices applied via the Pricing tab. No separate rebate accrual.", disabled: false },
  // 6. Market share Price reduction — pricing-only; discount applies
  // once market share target is met. Configured via ContractPricing.
  // (Unhidden 2026-05-25 per Charles Bugs.rtfd.)
  { value: "market_share_price_reduction", label: "Market share Price reduction", icon: PieChart, description: "Pricing-only — discounted prices once market share target is met. Configure prices on the Pricing tab.", disabled: false },

  // ── Hidden (legacy / advanced types kept for back-compat) ──────
  // Order — po_rebate counts qualifying PurchaseOrder rows (status
  // submitted | approved | received) at the contract's vendor +
  // facility within the term's evaluation period. Tier thresholds are
  // PO COUNTS, rebateValue is dollars-per-PO at the achieved tier.
  // Removed from the selectable picker 2026-06-07 (Charles, unused);
  // hidden:true keeps it visible only on existing po_rebate terms.
  { value: "po_rebate", label: "Order", icon: DollarSign, description: "Per-order rebate. Tier thresholds are order counts; rebate values are dollars per order.", disabled: false, hidden: true },
  // Pricing-only — procedure-spend trigger.
  { value: "capitated_price_reduction", label: "Capitated Price Reduction", icon: BarChart3, description: "Pricing-only — discounted procedures once spend threshold is met. Configure prices on the Pricing tab.", disabled: false, hidden: true },
  // Per-procedure rebate. Routes through the volume bridge.
  { value: "capitated_pricing_rebate", label: "Capitated Pricing Rebate", icon: BarChart3, description: "Per-procedure rebate when CPT count crosses tier. Set CPT codes; tier rebateValue is $/procedure.", disabled: false, hidden: true },
  // Flat tier dollar amount per evaluation period when
  // `Contract.complianceRate` crosses the tier's threshold.
  { value: "compliance_rebate", label: "Compliance Rebate", icon: Shield, description: "Flat per-period rebate when compliance % crosses tier threshold. Update Compliance Rate on the contract.", disabled: false, hidden: true },
  // Flat dollar rebate per period via a single fixed_rebate tier.
  { value: "fixed_fee", label: "Fixed Fee", icon: Coins, description: "Fixed dollar rebate per period. Add one tier with rebate type Fixed Rebate and the dollar amount.", disabled: false, hidden: true },
  // Price catalog locked for the contract duration; no engine wiring.
  { value: "locked_pricing", label: "Locked Pricing", icon: Lock, description: "Price catalog locked for the contract duration. Pricing rows are managed via the Pricing tab; no separate rebate accrual.", disabled: false, hidden: true },
  // Shares the volume bridge — counts CPT occurrences, pays $/occurrence.
  { value: "rebate_per_use", label: "Rebate Per Use", icon: Coins, description: "Per-procedure rebate. Set CPT codes and add one tier at threshold 0 with the dollars per occurrence.", disabled: false, hidden: true },
  // Per-invoice rebate; counts qualifying Invoice rows within the
  // evaluation window.
  { value: "payment_rebate", label: "Payment Rebate", icon: Coins, description: "Per-invoice rebate. Tier thresholds are invoice counts; rebate values are dollars per invoice.", disabled: false, hidden: true },
] as const

const baselineTypes = [
  { value: "spend_based", label: "Spend Based" },
  { value: "volume_based", label: "Volume Based" },
  { value: "growth_based", label: "Growth Based" },
] as const

function createEmptyTerm(): TermFormValues {
  return {
    termName: "",
    termType: "spend_rebate",
    baselineType: "spend_based",
    evaluationPeriod: "annual",
    paymentTiming: "quarterly",
    appliesTo: "all_products",
    rebateMethod: "cumulative",
    growthOnly: false,
    effectiveStart: "",
    effectiveEnd: "",
    tiers: [],
  }
}

function createEmptyTier(
  tierNumber: number,
  termType?: string,
): TierInput {
  // Charles 2026-04-25 audit C6 + re-pass F6: every term type whose
  // engine adapter reads `tier.rebateValue` as flat dollars-per-event
  // (or per period) defaults to `fixed_rebate` so a user typing
  // "1000" stores as $1,000 not 100% of spend. The engine treats
  // fraction values as percent at the boundary, so a percent_of_spend
  // default would silently scale × 100 in the engine and pay $0.X
  // instead of $X. Verified against:
  //   - recompute-volume-accrual.ts (occurrences × rebateValue)
  //   - recompute-po-accrual.ts (count × rebateValue)
  //   - recompute-invoice-accrual.ts (count × rebateValue)
  //   - recompute-threshold-accrual.ts (per-period payoutForTier)
  // All other term types (spend_rebate, growth_rebate, …) keep the
  // percent_of_spend default.
  const flatPayoutTermTypes = new Set([
    "fixed_fee",
    "compliance_rebate",
    "market_share",
    "payment_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate",
  ])
  // Bug #25 (2026-05-11, Vick): volume_rebate's natural default is
  // $-per-unit (qty × rate), not flat $-per-period. The user reported
  // entering "$5" expecting "$5 × units used" but the writer
  // interpreted it as a flat $5 per period. Default new volume tiers
  // to `fixed_rebate_per_unit` so the UI label, engine math, and user
  // mental model all line up.
  let rebateType: TierInput["rebateType"]
  if (termType === "volume_rebate") {
    rebateType = "fixed_rebate_per_unit"
  } else if (termType && flatPayoutTermTypes.has(termType)) {
    rebateType = "fixed_rebate"
  } else {
    rebateType = "percent_of_spend"
  }
  return {
    tierNumber,
    spendMin: 0,
    rebateType,
    rebateValue: 0,
  }
}

export function ContractTermsEntry({
  terms,
  onChange,
  availableCategories = [],
  availableItems = [],
  contractType,
}: ContractTermsEntryProps) {
  // Fallback category fetch — runs only when the caller didn't pass any.
  // Every mount point of this component previously had to wire its own
  // "get categories from contract → fall back to global list" logic,
  // which meant most mount points simply didn't (new-contract form,
  // edit-contract form, vendor submission) and the Specific-Category
  // tier picker always told the user "add a category first" even though
  // dozens exist platform-wide.
  const { data: fallbackCategories } = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => getCategories(),
    enabled: availableCategories.length === 0,
  })

  const resolvedCategories = useMemo(() => {
    if (availableCategories.length > 0) return availableCategories
    return (fallbackCategories ?? []).map((c) => ({ id: c.id, name: c.name }))
  }, [availableCategories, fallbackCategories])

  // W1.G — when the contract type flips to "tie_in", gently pre-populate
  // sensible capital-term defaults on any term that's still fully blank for
  // that field. We only fill null/undefined values so we never clobber a
  // number the user just typed. Runs once per change to `contractType`
  // or when new terms are added; `onChange` is the parent setter so no
  // render loop (next render sees filled values and becomes a no-op).
  // NOTE: we intentionally do NOT seed interestRate — leave it null so the
  // user consciously fills it in (and W1.E's fraction↔percent round-trip
  // stays honest).
  useEffect(() => {
    if (contractType !== "tie_in") return
    if (terms.length === 0) return
    let changed = false
    const next = terms.map((t) => {
      const patch: Partial<TermFormValues> = {}
      if (t.termMonths == null) {
        patch.termMonths = 60
        changed = true
      }
      if (t.downPayment == null) {
        patch.downPayment = 0
        changed = true
      }
      if (t.paymentCadence == null) {
        patch.paymentCadence = "monthly"
        changed = true
      }
      if (t.shortfallHandling == null) {
        patch.shortfallHandling = "carry_forward"
        changed = true
      }
      if (t.amortizationShape == null) {
        patch.amortizationShape = "symmetrical"
        changed = true
      }
      return Object.keys(patch).length > 0 ? { ...t, ...patch } : t
    })
    if (changed) onChange(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractType, terms.length])

  // Bug #12 / #13: existing saved terms may have a termType / baselineType
  // / tier rebateType combination that the form's onValueChange cascade
  // would have rejected (e.g. a volume_rebate term with baselineType=
  // spend_based and percent_of_spend tiers). The form-side gates only
  // catch NEW changes; without this, opening such a term in edit mode
  // shows the legacy shape and the recompute math runs on the wrong
  // semantics. Self-heal once on mount: cascade baselineType + flip
  // percent_of_spend tiers to fixed_rebate (zeroing the value, since a
  // 0.10 fraction would read as $0.10 per period otherwise).
  useEffect(() => {
    if (terms.length === 0) return
    const PER_OCC = new Set([
      "volume_rebate",
      "rebate_per_use",
      "capitated_pricing_rebate",
    ])
    // Mirrors NON_PERCENT_TERM_TYPES in contract-tier-row.tsx — the
    // termTypes whose engines have no defined per-period $ base to
    // apply a percent against. volume_rebate and market_share ARE
    // legal % targets (bugs #16, #17) so they stay off this list.
    const TYPES_WITHOUT_PERCENT_TIERS = new Set([
      "rebate_per_use",
      "capitated_pricing_rebate",
      "compliance_rebate",
      "fixed_fee",
      "payment_rebate",
      "po_rebate",
    ])
    let changed = false
    const next = terms.map((t) => {
      const patch: Partial<TermFormValues> = {}
      const expectedBaseline: TermFormValues["baselineType"] | null = PER_OCC.has(
        t.termType,
      )
        ? "volume_based"
        : null
      if (expectedBaseline && t.baselineType !== expectedBaseline) {
        patch.baselineType = expectedBaseline
      }
      if (
        t.termType === "volume_rebate" &&
        t.volumeType == null
      ) {
        patch.volumeType = "procedure_code"
      }
      if (TYPES_WITHOUT_PERCENT_TIERS.has(t.termType) && t.tiers) {
        const fixedTiers = t.tiers.map((tier) => {
          if (tier.rebateType !== "percent_of_spend") return tier
          const preservedDollarValue = Number(tier.rebateValue ?? 0) * 100
          return {
            ...tier,
            rebateType: "fixed_rebate" as const,
            rebateValue: preservedDollarValue,
          }
        })
        const tiersChanged = fixedTiers.some((tier, idx) => tier !== t.tiers[idx])
        if (tiersChanged) patch.tiers = fixedTiers
      }
      if (Object.keys(patch).length > 0) {
        changed = true
        return { ...t, ...patch }
      }
      return t
    })
    if (changed) onChange(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addTerm() {
    onChange([...terms, createEmptyTerm()])
  }

  function removeTerm(index: number) {
    onChange(terms.filter((_, i) => i !== index))
  }

  function updateTerm(index: number, updated: Partial<TermFormValues>) {
    onChange(terms.map((t, i) => (i === index ? { ...t, ...updated } : t)))
  }

  function addTier(termIndex: number) {
    const term = terms[termIndex]
    const newTier = createEmptyTier(term.tiers.length + 1, term.termType)
    updateTerm(termIndex, { tiers: [...term.tiers, newTier] })
  }

  function updateTier(termIndex: number, tierIndex: number, tier: TierInput) {
    const term = terms[termIndex]
    const newTiers = term.tiers.map((t, i) => (i === tierIndex ? tier : t))
    updateTerm(termIndex, { tiers: newTiers })
  }

  function removeTier(termIndex: number, tierIndex: number) {
    const term = terms[termIndex]
    const newTiers = term.tiers
      .filter((_, i) => i !== tierIndex)
      .map((t, i) => ({ ...t, tierNumber: i + 1 }))
    updateTerm(termIndex, { tiers: newTiers })
  }

  if (terms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
        <p className="text-sm text-muted-foreground">No terms added yet</p>
        <Button type="button" variant="outline" className="mt-4" onClick={addTerm}>
          <Plus className="size-4" /> Add Term
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Accordion type="multiple" defaultValue={terms.map((_, i) => `term-${i}`)}>
        {terms.map((term, termIdx) => (
          <AccordionItem key={termIdx} value={`term-${termIdx}`}>
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                <span className="font-medium">
                  {term.termName || `Unnamed Term`}
                </span>
                <DefinitionTooltip term={term.termType}>
                  <Badge variant="outline" className="text-xs">
                    {term.termType.replace(/_/g, " ")}
                  </Badge>
                </DefinitionTooltip>
                <span className="text-xs text-muted-foreground">
                  {term.tiers.length} tier(s)
                </span>
                {term.evaluationPeriod && (
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {term.evaluationPeriod.replace(/_/g, " ")}
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-sm">Term Details</CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      // Guardrail (Bug 7): accidental clicks on the
                      // trash icon silently dropped terms populated by
                      // the AI extractor. Confirm before destroying
                      // an entire term + its tiers.
                      const label = term.termName || `term ${termIdx + 1}`
                      const tierCount = term.tiers.length
                      if (
                        typeof window !== "undefined" &&
                        !window.confirm(
                          `Delete "${label}" and its ${tierCount} tier${tierCount === 1 ? "" : "s"}? This cannot be undone until you save.`,
                        )
                      ) {
                        return
                      }
                      removeTerm(termIdx)
                    }}
                    className="text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Term Name" required>
                      <Input
                        value={term.termName}
                        onChange={(e) =>
                          updateTerm(termIdx, { termName: e.target.value })
                        }
                        placeholder="e.g., Spine Implant Rebate"
                      />
                    </Field>

                    <div className="space-y-2">
                      <Label className="inline-flex items-center">
                        Term Type
                        {term.termType && TERM_TYPE_DEFINITIONS[term.termType] && (
                          <EnumDefinitionTooltip
                            definition={TERM_TYPE_DEFINITIONS[term.termType]}
                          />
                        )}
                      </Label>
                      <Select
                        value={term.termType}
                        onValueChange={(v) => {
                          const nextType = v as TermFormValues["termType"]
                          // Cascade baseline + scope when the user changes
                          // term type, so the form doesn't get stuck in a
                          // mismatched state (Bug #5: switching to Volume
                          // Rebate while baseline still shows Spend Based).
                          // The user can still override after.
                          const baselineForType: TermFormValues["baselineType"] =
                            nextType === "volume_rebate" ||
                            nextType === "rebate_per_use" ||
                            nextType === "capitated_pricing_rebate" ||
                            nextType === "capitated_price_reduction"
                              ? "volume_based"
                              : "spend_based"
                          // Bug #6: count- and threshold-based termTypes
                          // pay a flat per-period or per-occurrence dollar
                          // amount; percent_of_spend tiers are incoherent
                          // there. When the user switches to one of those
                          // termTypes, auto-flip any existing
                          // percent_of_spend tier to fixed_rebate and zero
                          // out its rebate value (the prior value was a
                          // percent and would be misread as dollars).
                          // Mirrors NON_PERCENT_TERM_TYPES in
                          // contract-tier-row.tsx. volume_rebate and
                          // market_share legitimately accept percent
                          // tiers (bugs #16, #17) so they're absent.
                          const NON_PCT_TYPES = new Set([
                            "rebate_per_use",
                            "capitated_pricing_rebate",
                            "compliance_rebate",
                            "fixed_fee",
                            "payment_rebate",
                            "po_rebate",
                          ])
                          const tiersForNextType =
                            NON_PCT_TYPES.has(nextType)
                              ? (term.tiers ?? []).map((t) =>
                                  t.rebateType === "percent_of_spend"
                                    ? {
                                        ...t,
                                        rebateType: "fixed_rebate" as const,
                                        rebateValue: 0,
                                      }
                                    : t,
                                )
                              : (term.tiers ?? [])
                          updateTerm(termIdx, {
                            termType: nextType,
                            baselineType: baselineForType,
                            // For procedure-driven types, default volumeType
                            // to procedure_code so CPT-code field semantics
                            // line up. For non-procedure volume rebate, leave
                            // volumeType cleared.
                            volumeType:
                              nextType === "rebate_per_use" ||
                              nextType === "capitated_pricing_rebate"
                                ? "procedure_code"
                                : nextType === "volume_rebate"
                                  ? term.volumeType ?? "procedure_code"
                                  : undefined,
                            tiers: tiersForNextType,
                          })
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {termTypes
                            .filter(
                              (tt) =>
                                !(tt as { hidden?: boolean }).hidden ||
                                tt.value === term.termType,
                            )
                            .map((tt) => (
                            <SelectItem
                              key={tt.value}
                              value={tt.value}
                              disabled={tt.disabled}
                            >
                              <div className="flex items-center gap-2">
                                <tt.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div>
                                  <div>
                                    {tt.label}
                                    {tt.disabled && (
                                      <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">
                                        Engine pending
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {tt.description}
                                    {tt.disabled && " — selectable once the per-type engine ships; for now use Spend Rebate."}
                                  </div>
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Baseline Type">
                      <Select
                        value={term.baselineType}
                        onValueChange={(v) =>
                          updateTerm(termIdx, {
                            baselineType: v as TermFormValues["baselineType"],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {baselineTypes.map((bt) => (
                            <SelectItem key={bt.value} value={bt.value}>
                              {bt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    {term.baselineType === "spend_based" && (
                      <Field label="Spend Baseline ($)">
                        <Input
                          type="number"
                          value={term.spendBaseline ?? ""}
                          onChange={(e) =>
                            updateTerm(termIdx, {
                              spendBaseline: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          placeholder="0"
                        />
                      </Field>
                    )}
                    {term.baselineType === "volume_based" && (
                      <Field label="Volume Baseline (units)">
                        <Input
                          type="number"
                          value={term.volumeBaseline ?? ""}
                          onChange={(e) =>
                            updateTerm(termIdx, {
                              volumeBaseline: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          placeholder="0"
                        />
                      </Field>
                    )}
                    {term.baselineType === "growth_based" && (
                      <Field label="Growth Baseline (%)">
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={term.growthBaselinePercent ?? ""}
                          onChange={(e) =>
                            updateTerm(termIdx, {
                              growthBaselinePercent: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          placeholder="e.g. 5 for 5% growth"
                        />
                      </Field>
                    )}
                  </div>

                  {term.termType === "volume_rebate" && (
                    <Field label="Volume Counted By">
                      <Select
                        value={term.volumeType ?? "procedure_code"}
                        onValueChange={(v) => {
                          const next = v as TermFormValues["volumeType"]
                          if (next === "all_products") {
                            updateTerm(termIdx, {
                              volumeType: next,
                              appliesTo: "all_products",
                              cptCodes: [],
                            })
                          } else {
                            updateTerm(termIdx, { volumeType: next })
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all_products">
                            All products on contract (count units)
                          </SelectItem>
                          <SelectItem value="procedure_code">
                            Procedure code (CPT)
                          </SelectItem>
                          <SelectItem value="product_category">
                            Product category (units)
                          </SelectItem>
                          <SelectItem value="catalog_cap_based">
                            Catalog / cap based
                          </SelectItem>
                          <SelectItem value="purchase_order">
                            Purchase order (count POs)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  {/* Bug 5 (Vick 2026-06-02): "Payment Timing can be removed
                      because that all coincides with evaluation period." The
                      field is not wired into the rebate engine (see the TODO
                      in lib/rebates/calculate.ts) and duplicated the
                      Evaluation Period cadence, so it's dropped from the form.
                      The schema column + "quarterly" default stay for
                      AI-extract / import back-compat; nothing reads it for
                      math. Evaluation Period is now the single cadence. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Evaluation Period">
                      <Select
                        value={term.evaluationPeriod}
                        onValueChange={(v) =>
                          updateTerm(termIdx, { evaluationPeriod: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="quarterly">Quarterly</SelectItem>
                          <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                          <SelectItem value="annual">Annual</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  {/* Baseline Calculation Method (Charles Bugs.rtfd
                      2026-05-25). Replaces the old single-option "Rebate
                      Calculation Method" dropdown. Binds to the
                      `growthOnly` boolean; the legacy `rebateMethod`
                      field stays in the schema (default cumulative) and
                      is no longer surfaced in the picker. */}
                  <div className="space-y-2">
                    <Label className="inline-flex items-center gap-1">
                      Baseline Calculation Method
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center">
                              <HelpCircle
                                className="h-3.5 w-3.5 text-muted-foreground"
                                aria-label="Baseline calculation method help"
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[320px] p-3 text-xs">
                            <p className="mb-2">
                              <span className="font-medium">From dollar one:</span>{" "}
                              once the tier threshold is crossed, the tier rate
                              applies to every dollar from $1.
                            </p>
                            <p>
                              <span className="font-medium">Growth:</span>{" "}
                              the tier rate applies only to spend ABOVE the
                              baseline configured on the term.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Select
                      value={term.growthOnly ? "growth" : "from_dollar_one"}
                      onValueChange={(v) =>
                        updateTerm(termIdx, {
                          growthOnly: v === "growth",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="from_dollar_one">
                          <div className="flex flex-col">
                            <span className="font-medium">From dollar one</span>
                            <span className="text-xs text-muted-foreground">
                              Tier rate applies to every dollar after the tier threshold is crossed.
                            </span>
                          </div>
                        </SelectItem>
                        <SelectItem value="growth">
                          <div className="flex flex-col">
                            <span className="font-medium">Growth</span>
                            <span className="text-xs text-muted-foreground">
                              Tier rate applies only to spend above the baseline.
                            </span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {term.growthOnly
                        ? "Growth: rebate counts only dollars over the baseline."
                        : "From dollar one: rebate counts every dollar after the threshold is crossed."}
                    </p>
                  </div>

                  {/* Carve-out terms derive their product scope + per-SKU
                      rebate from the Pricing tab's carve-out % column
                      (lib/contracts/recompute/carve-out.ts reads
                      ContractPricing.carveOutPercent per SKU). The engine
                      ignores appliesTo / the manual SKU picker for carve-out,
                      so we show the controls locked rather than letting the
                      user configure something that has no effect.
                      Vick 2026-05-31 #3. */}
                  {isCarveOutScopeLocked(term.termType) ? (
                    <Field label="Product Scope">
                      <Select value="auto" disabled>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">
                            Auto (from pricing file)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Scope and per-SKU rebate % come from the Pricing tab.
                        Upload a pricing file with a carve-out % column to
                        populate items.
                      </p>
                      <div className="mt-2">
                        <SpecificItemsPicker
                          availableItems={availableItems}
                          selected={term.scopedItemNumbers ?? []}
                          onChange={() => {}}
                          readOnly
                        />
                      </div>
                    </Field>
                  ) : (
                    <Field label="Product Scope">
                      <Select
                        value={term.appliesTo}
                        onValueChange={(v) =>
                          updateTerm(termIdx, {
                            appliesTo: v,
                            // Drop the scoped category when moving back to
                            // all_products / specific_items.
                            scopedCategoryId:
                              v === "specific_category"
                                ? term.scopedCategoryId
                                : undefined,
                            scopedCategoryIds:
                              v === "specific_category"
                                ? term.scopedCategoryIds
                                : undefined,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all_products">All Products</SelectItem>
                          <SelectItem value="specific_category">Specific Category</SelectItem>
                          <SelectItem value="specific_items">Specific Items</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  {/* When a tier is scoped to a specific category, render a
                      combobox picker ("Pick a category") + chip list of
                      selected categories. Chips have a ✕ to remove.
                      E2E regression spec
                      (facility-contract-with-new-vendor-category-rebate.spec.ts)
                      asserts this combobox exists after selecting Specific
                      Category — keep the placeholder text canonical. We write
                      both `scopedCategoryIds` (canonical) and `scopedCategoryId`
                      (set to the first selected, kept for back-compat with
                      createContractTerm persistence). */}
                  {term.appliesTo === "specific_category" && (
                    <Field label="Categories" required>
                      {/*
                       * Charles 2026-04-25: cross-vendor category
                       * suggestions. When the user picks a category,
                       * surface other contracts at this facility that
                       * already use it so they don't redo configuration
                       * from scratch for every new vendor.
                       */}
                      <CategoryMappingSuggestions
                        scopedCategoryIds={term.scopedCategoryIds ?? []}
                        resolvedCategories={resolvedCategories}
                      />
                      {resolvedCategories.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Loading categories…
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <Select
                            value=""
                            onValueChange={(categoryId) => {
                              if (!categoryId) return
                              const cur = term.scopedCategoryIds ?? []
                              if (cur.includes(categoryId)) return
                              const next = [...cur, categoryId]
                              updateTerm(termIdx, {
                                scopedCategoryIds: next,
                                scopedCategoryId: next[0],
                              })
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Pick a category" />
                            </SelectTrigger>
                            <SelectContent>
                              {resolvedCategories.map((c) => {
                                const selectedIds = term.scopedCategoryIds ?? []
                                const alreadyPicked = selectedIds.includes(c.id)
                                return (
                                  <SelectItem
                                    key={c.id}
                                    value={c.id}
                                    disabled={alreadyPicked}
                                  >
                                    {c.name}
                                    {alreadyPicked ? " (added)" : ""}
                                  </SelectItem>
                                )
                              })}
                            </SelectContent>
                          </Select>
                          {(term.scopedCategoryIds ?? []).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {(term.scopedCategoryIds ?? []).map((id) => {
                                const c = resolvedCategories.find(
                                  (r) => r.id === id,
                                )
                                if (!c) return null
                                return (
                                  <Badge
                                    key={id}
                                    variant="secondary"
                                    className="pr-1"
                                  >
                                    <span className="text-xs">{c.name}</span>
                                    <button
                                      type="button"
                                      className="ml-1 rounded hover:bg-accent px-1"
                                      aria-label={`Remove ${c.name}`}
                                      onClick={() => {
                                        const next = (
                                          term.scopedCategoryIds ?? []
                                        ).filter((x) => x !== id)
                                        updateTerm(termIdx, {
                                          scopedCategoryIds: next,
                                          scopedCategoryId: next[0],
                                        })
                                      }}
                                    >
                                      ×
                                    </button>
                                  </Badge>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </Field>
                  )}

                  {!isCarveOutScopeLocked(term.termType) &&
                    term.appliesTo === "specific_items" && (
                      <Field label="Items">
                        <SpecificItemsPicker
                          availableItems={availableItems}
                          selected={term.scopedItemNumbers ?? []}
                          onChange={(next) =>
                            updateTerm(termIdx, { scopedItemNumbers: next })
                          }
                        />
                      </Field>
                    )}

                  {/* CPT codes only show when the term is genuinely
                      procedure-driven. For volume_rebate, that's keyed off
                      volumeType === "procedure_code" — a volume rebate by
                      product category or catalog cap doesn't need CPTs and
                      shouldn't surface them (Bug #4: CPTs were popping up on
                      every Volume Rebate even when product scope wasn't case-
                      based). The other CPT-driven types are always procedure-
                      based or have a per_procedure_rebate tier. */}
                  {((term.tiers ?? []).some(
                    (t) => t.rebateType === "per_procedure_rebate",
                  ) ||
                    (term.termType === "volume_rebate" &&
                      term.volumeType === "procedure_code") ||
                    term.termType === "capitated_pricing_rebate" ||
                    term.termType === "rebate_per_use") && (
                    <Field label="CPT Codes">
                      <CptCodeList
                        values={term.cptCodes ?? []}
                        onChange={(next) =>
                          updateTerm(termIdx, { cptCodes: next })
                        }
                      />
                    </Field>
                  )}

                  {contractType === "tie_in" && (
                    <div className="space-y-5 rounded-md border p-4">
                      {/* Charles W1.T — tie-in capital is contract-level now.
                          Capital cost / interest / term / cadence / shape
                          render once ABOVE the terms list in
                          ContractCapitalEntry. This block keeps only the
                          per-term consumable commitment + shortfall fields. */}

                      {/* Per-term: Consumable Commitment & Shortfall */}
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-sm font-semibold">
                            Consumable Commitment &amp; Shortfall
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            The usage side — how much spend the facility
                            commits to, and what happens if they fall short.
                          </p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="inline-flex items-center gap-1">
                              Minimum Annual Purchase ($)
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex cursor-help items-center">
                                      <HelpCircle
                                        className="h-3.5 w-3.5 text-muted-foreground"
                                        aria-label="Minimum annual purchase help"
                                      />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[320px] p-3 text-xs">
                                    <p>
                                      Hospital&apos;s annual consumable spend
                                      commitment. If actual spend falls short,
                                      the shortfall-handling policy (see
                                      Wave C) decides whether the vendor bills
                                      the gap or carries it forward.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </Label>
                            <Input
                              type="number"
                              value={term.minimumPurchaseCommitment ?? ""}
                              onChange={(e) =>
                                updateTerm(termIdx, {
                                  minimumPurchaseCommitment:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                            />
                            <p className="text-[11px] text-muted-foreground">
                              {contractType === "tie_in"
                                ? "Floor. If 12-month spend falls below this, the contract will not retire its capital on schedule. Drives the at-risk badge on the Capital Amortization card."
                                : "Reference only — not enforced in rebate math today."}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              If left blank, the term baseline is used as the minimum annual purchase floor.
                            </p>
                            {(term.minimumPurchaseCommitment == null ||
                              term.minimumPurchaseCommitment === 0) && (
                              <p className="inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>
                                  No minimum purchase commitment entered —
                                  the rebate paydown won&apos;t have a floor
                                  to run against.
                                </span>
                              </p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label className="inline-flex items-center gap-1">
                              Shortfall Handling
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    What happens when consumable spend falls
                                    below the minimum annual purchase
                                    commitment.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </Label>
                            <Select
                              value={term.shortfallHandling ?? "carry_forward"}
                              onValueChange={(value) =>
                                updateTerm(termIdx, {
                                  shortfallHandling:
                                    value === "bill_immediately" ||
                                    value === "carry_forward"
                                      ? value
                                      : null,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select shortfall handling" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="carry_forward">
                                  Carry forward — apply the shortfall to the
                                  next period&apos;s commitment
                                </SelectItem>
                                <SelectItem value="bill_immediately">
                                  Bill immediately — invoice the shortfall at
                                  period close
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Effective Start" required>
                      <Input
                        type="date"
                        value={term.effectiveStart}
                        onChange={(e) =>
                          updateTerm(termIdx, {
                            effectiveStart: e.target.value,
                          })
                        }
                      />
                    </Field>

                    <Field label="Effective End" required>
                      <Input
                        type="date"
                        value={term.effectiveEnd}
                        onChange={(e) =>
                          updateTerm(termIdx, {
                            effectiveEnd: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>

                  {/*
                    Tiers section.

                    Bug C 2026-05-25 (Charles Bugs.rtfd): "On carve out
                    here, having a tier does not work because each item
                    has different rebate it should all just come from
                    the price file only. And tiers is not needed."
                    Hidden for carve_out — per-item carve-out percent
                    lives on ContractPricing rows, not on a tier ladder.
                  */}
                  {term.termType !== "carve_out" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">Tiers</h4>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => addTier(termIdx)}
                        >
                          <Plus className="size-3" /> Add Tier
                        </Button>
                      </div>
                      {term.tiers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No tiers added
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {term.tiers.map((tier, tierIdx) => (
                            <ContractTierRow
                              key={tierIdx}
                              tier={tier}
                              index={tierIdx}
                              termType={term.termType}
                              onChange={(t) => updateTier(termIdx, tierIdx, t)}
                              onRemove={() => removeTier(termIdx, tierIdx)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {term.termType === "carve_out" && (
                    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Carve-out rebates are per item — set the rebate
                      percent on each pricing row in the Pricing tab.
                      Tiers are not used.
                    </div>
                  )}
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <Button type="button" variant="outline" onClick={addTerm}>
        <Plus className="size-4" /> Add Another Term
      </Button>
    </div>
  )
}

