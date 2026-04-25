"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getCategorySuggestions as getCategorySuggestionsAction } from "@/lib/actions/contracts/category-suggestions"
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
  Sparkles,
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
import {
  formatRebateMethodLabel,
  describeRebateMethod,
} from "@/lib/contracts/rebate-method-label"
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
import { Checkbox } from "@/components/ui/checkbox"
import { DefinitionTooltip } from "@/components/shared/definition-tooltip"
import { DefinitionTooltip as EnumDefinitionTooltip } from "@/components/contracts/definition-tooltip"
import { TERM_TYPE_DEFINITIONS } from "@/lib/contract-definitions"
import { ContractTierRow } from "@/components/contracts/contract-tier-row"
import { getCategories } from "@/lib/actions/categories"
import { queryKeys } from "@/lib/query-keys"
import type { TermFormValues, TierInput } from "@/lib/validators/contract-terms"
import { SpecificItemsPicker, type VendorItem } from "./specific-items-picker"
import { TieInAmortizationPreview } from "./tie-in-amortization-preview"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  toDisplayInterestRate,
  fromDisplayInterestRate,
} from "@/lib/contracts/interest-rate-normalize"

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
 * Charles 2026-04-25: dispatcher rebuilt this session. All 15
 * `termType` values now route to a real engine path. See
 * `docs/architecture/rebate-engine-map.md` for the writer-per-type
 * matrix. `disabled` is reserved for future types whose semantics
 * aren't defined yet (currently none).
 */
const termTypes = [
  { value: "spend_rebate", label: "Spend Rebate", icon: DollarSign, description: "Rebate based on spend thresholds", disabled: false },
  // Charles 2026-04-25: volume rebate now wired through
  // `recomputeVolumeAccrualForTerm`. Counts CPT-coded procedure
  // occurrences across the facility's Cases (deduped by case+CPT)
  // within the term window. Configure CPT codes on the term and use
  // tier `spendMin` columns as occurrence thresholds.
  { value: "volume_rebate", label: "Volume Rebate", icon: TrendingUp, description: "Rebate based on procedure count. Set CPT codes on the term; tier thresholds are interpreted as occurrences (not dollars).", disabled: false },
  // Charles 2026-04-25: price_reduction has no separate rebate accrual —
  // it's enforced by the contract's ContractPricing rows (the matched
  // price IS the reduced price). Enabled so users can categorize their
  // pricing-only contracts correctly; no Rebate rows are emitted.
  { value: "price_reduction", label: "Price Reduction", icon: Percent, description: "Pricing-only contract — discounted prices applied via the Pricing tab. No separate rebate accrual.", disabled: false },
  // Charles 2026-04-25: market_share rebate pays a flat tier dollar
  // amount per evaluation period when `Contract.currentMarketShare`
  // crosses the tier's threshold. Threshold = spendMin column
  // (interpreted as %); rebate = rebateValue (flat $).
  { value: "market_share", label: "Market Share", icon: PieChart, description: "Flat per-period rebate when current market share % crosses tier threshold. Update Current Market Share on the contract.", disabled: false },
  // Charles 2026-04-25: pricing-only — discount applies once market
  // share target is met. Configured via ContractPricing rows; no
  // separate rebate accrual.
  { value: "market_share_price_reduction", label: "Market Share Price Reduction", icon: PieChart, description: "Pricing-only — discounted prices once market share target is met. Configure prices on the Pricing tab.", disabled: false },
  // Charles 2026-04-25: pricing-only — procedure-spend trigger.
  // Same model as market_share_price_reduction; discount applies via
  // ContractPricing once the trigger is met.
  { value: "capitated_price_reduction", label: "Capitated Price Reduction", icon: BarChart3, description: "Pricing-only — discounted procedures once spend threshold is met. Configure prices on the Pricing tab.", disabled: false },
  // Charles 2026-04-25: per-procedure rebate. Routes through the
  // volume bridge — set CPT codes + tier ladder where rebateValue
  // is dollars per procedure at the achieved tier.
  { value: "capitated_pricing_rebate", label: "Capitated Pricing Rebate", icon: BarChart3, description: "Per-procedure rebate when CPT count crosses tier. Set CPT codes; tier rebateValue is $/procedure.", disabled: false },
  // Charles 2026-04-25: growth-baseline math now wired through
  // `recomputeAccrualForContract` → `buildEvaluationPeriodAccruals`.
  // When `baselineType === "growth_based"` AND `spendBaseline > 0`,
  // the engine evaluates tiers against `max(0, periodSpend −
  // proRatedBaseline)` so only spend ABOVE the baseline counts.
  { value: "growth_rebate", label: "Growth Rebate", icon: TrendingUp, description: "Rebate based on spend growth over baseline. Set Baseline Type=Growth Based + Annual Spend Baseline below.", disabled: false },
  // Charles 2026-04-25: compliance_rebate pays a flat tier dollar
  // amount per evaluation period when `Contract.complianceRate`
  // crosses the tier's threshold (same shape as market_share).
  { value: "compliance_rebate", label: "Compliance Rebate", icon: Shield, description: "Flat per-period rebate when compliance % crosses tier threshold. Update Compliance Rate on the contract.", disabled: false },
  // Charles 2026-04-25: fixed_fee works through the existing spend
  // writer when the user adds a single tier with rebateType=fixed_rebate
  // (the spend writer reads `t.rebateType === "fixed_rebate"` and emits
  // the flat dollar amount per evaluation period — see
  // recompute-accrual.ts ~line 175). One tier with spendMin=0 +
  // fixed_rebate $X gives the user a flat $X each period.
  { value: "fixed_fee", label: "Fixed Fee", icon: Coins, description: "Fixed dollar rebate per period. Add one tier with rebate type Fixed Rebate and the dollar amount.", disabled: false },
  // Charles 2026-04-25: locked_pricing has no rebate computation —
  // it's a pricing catalog (ContractPricing rows lock prices for the
  // contract duration). The contract's pricing-file import + the COG
  // matcher already enforce locked prices via `escalatorPercent: null`.
  // No engine wiring needed; just enable so users can categorize
  // their pricing-only contracts correctly.
  { value: "locked_pricing", label: "Locked Pricing", icon: Lock, description: "Price catalog locked for the contract duration. Pricing rows are managed via the Pricing tab; no separate rebate accrual.", disabled: false },
  // Charles 2026-04-25: rebate_per_use shares the volume bridge —
  // counts CPT occurrences and pays a flat $/occurrence (no tier
  // ladder needed; configure with one tier at threshold 0).
  { value: "rebate_per_use", label: "Rebate Per Use", icon: Coins, description: "Per-procedure rebate. Set CPT codes and add one tier at threshold 0 with the dollars per occurrence.", disabled: false },
  // Charles 2026-04-25: po_rebate counts qualifying PurchaseOrder
  // rows (status submitted | approved | received) at the contract's
  // vendor + facility within the term's evaluation period. Tier
  // thresholds are PO COUNTS, rebateValue is dollars-per-PO at the
  // achieved tier.
  { value: "po_rebate", label: "PO Rebate", icon: DollarSign, description: "Per-purchase-order rebate. Tier thresholds are PO counts; rebate values are dollars per PO.", disabled: false },
  { value: "carve_out", label: "Carve Out", icon: Shield, description: "Specific items excluded from the broader contract terms", disabled: true },
  // Charles 2026-04-25: per-invoice rebate. Counts qualifying
  // Invoice rows (matching vendor + facility + within window +
  // non-cancelled status); tier rebateValue is dollars per invoice.
  // v2 will add on-time-payment threshold once Invoice gains a
  // paidDate field.
  { value: "payment_rebate", label: "Payment Rebate", icon: Coins, description: "Per-invoice rebate. Tier thresholds are invoice counts; rebate values are dollars per invoice.", disabled: false },
] as const

const baselineTypes = [
  { value: "spend_based", label: "Spend Based" },
  { value: "volume_based", label: "Volume Based" },
  { value: "growth_based", label: "Growth Based" },
] as const

/** Charles W1.X-A6 — Comma/whitespace-separated CPT code entry with chip
 *  display. CPT codes are short alphanumerics (5 chars usually), so a
 *  lightweight picker without a live catalog is acceptable here. */
function CptCodeList({
  values,
  onChange,
}: {
  values: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")
  function commit(raw: string) {
    const tokens = raw
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
    if (tokens.length === 0) return
    const next = [...values]
    for (const t of tokens) if (!next.includes(t)) next.push(t)
    onChange(next)
    setDraft("")
  }
  return (
    <div className="space-y-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            commit(draft)
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
        placeholder="e.g. 27447, 27130 (Enter to add)"
      />
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((code) => (
            <Badge key={code} variant="secondary" className="pr-1">
              <span className="text-xs font-mono">{code}</span>
              <button
                type="button"
                className="ml-1 rounded hover:bg-accent px-1"
                aria-label={`Remove ${code}`}
                onClick={() => onChange(values.filter((c) => c !== code))}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function createEmptyTerm(): TermFormValues {
  return {
    termName: "",
    termType: "spend_rebate",
    baselineType: "spend_based",
    evaluationPeriod: "annual",
    paymentTiming: "quarterly",
    appliesTo: "all_products",
    rebateMethod: "cumulative",
    effectiveStart: "",
    effectiveEnd: "",
    tiers: [],
  }
}

function createEmptyTier(tierNumber: number): TierInput {
  return {
    tierNumber,
    spendMin: 0,
    rebateType: "percent_of_spend",
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
    const newTier = createEmptyTier(term.tiers.length + 1)
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
                        onValueChange={(v) =>
                          updateTerm(termIdx, {
                            termType: v as TermFormValues["termType"],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {termTypes.map((tt) => (
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
                    <Field label="Payment Timing">
                      <Select
                        value={term.paymentTiming}
                        onValueChange={(v) =>
                          updateTerm(termIdx, { paymentTiming: v })
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

                  <div className="space-y-2">
                    <Label className="inline-flex items-center gap-1">
                      Rebate Calculation Method
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center">
                              <HelpCircle
                                className="h-3.5 w-3.5 text-muted-foreground"
                                aria-label="Rebate calculation method help"
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[320px] p-3 text-xs">
                            <p>
                              <span className="font-medium">Retroactive (Dollar 1 / Cumulative):</span>{" "}
                              once the highest tier is reached, that tier&apos;s
                              rate applies to the entire spend from dollar one.
                            </p>
                            <p className="mt-2">
                              <span className="font-medium">Tiered (Per-slice / Marginal):</span>{" "}
                              each tier&apos;s rate applies only to dollars
                              within that tier&apos;s band.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Select
                      value={term.rebateMethod ?? "cumulative"}
                      onValueChange={(v) =>
                        updateTerm(termIdx, {
                          rebateMethod: v as "cumulative" | "marginal",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cumulative">
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {formatRebateMethodLabel("cumulative")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {describeRebateMethod("cumulative")}
                            </span>
                          </div>
                        </SelectItem>
                        <SelectItem value="marginal">
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {formatRebateMethodLabel("marginal")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {describeRebateMethod("marginal")}
                            </span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {term.rebateMethod === "marginal"
                        ? "Tiered: each tier's rate applies only to dollars within that tier's band."
                        : "Retroactive: the highest-achieved tier's rate applies to the entire spend from dollar one."}
                    </p>
                  </div>

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

                  {term.appliesTo === "specific_items" && (
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

                  {/* Charles 2026-04-25: CPT codes are required when EITHER
                      a tier carries per_procedure_rebate OR the term type
                      itself is one of the CPT-driven engines (volume_rebate,
                      capitated_pricing_rebate, rebate_per_use). The previous
                      gate hid the input from the term-type users — they'd
                      never see the field even though their dropdown
                      description told them to set it, and the engine would
                      silently match 0 cases. Show the input whenever ANY
                      signal demands CPT codes. */}
                  {((term.tiers ?? []).some(
                    (t) => t.rebateType === "per_procedure_rebate",
                  ) ||
                    term.termType === "volume_rebate" ||
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

                  {/* Charles W1.X-A6 — Per-Unit rebate tiers pay per item, so
                      the term MUST be scoped to specific items with REF
                      numbers. Nudge the user when that pairing is missing. */}
                  {(term.tiers ?? []).some(
                    (t) => t.rebateType === "fixed_rebate_per_unit",
                  ) &&
                    (term.appliesTo !== "specific_items" ||
                      (term.scopedItemNumbers ?? []).length === 0) && (
                      <p className="inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          Per-Unit rebate tiers require a Specific Items scope
                          with at least one REF number selected.
                        </span>
                      </p>
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

                  {/* Tiers */}
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
                            onChange={(t) => updateTier(termIdx, tierIdx, t)}
                            onRemove={() => removeTier(termIdx, tierIdx)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
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

/**
 * Charles 2026-04-25: surface other contracts at the facility that
 * already use the same category, so users entering a new contract
 * for a different vendor can see how their peers configured the
 * same scope. Shows a compact one-line hint per matched contract;
 * clicking opens the contract in a new tab so the user can compare
 * tier ladders side-by-side.
 */
function CategoryMappingSuggestions({
  scopedCategoryIds,
  resolvedCategories,
}: {
  scopedCategoryIds: string[]
  resolvedCategories: Array<{ id: string; name: string }>
}) {
  // Use the FIRST scoped category as the lookup key; in the common
  // case users add categories one at a time and only the first
  // matters for "what does my peer's contract look like".
  const firstCatId = scopedCategoryIds[0]
  const categoryName =
    resolvedCategories.find((c) => c.id === firstCatId)?.name ?? null
  const { data } = useQuery({
    queryKey: ["category-suggestions", categoryName],
    queryFn: () =>
      categoryName
        ? getCategorySuggestionsAction({ category: categoryName })
        : Promise.resolve([]),
    enabled: Boolean(categoryName),
  })
  if (!categoryName || !data || data.length === 0) return null
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-2.5 text-xs">
      <p className="font-medium text-foreground">
        Other contracts using {categoryName}:
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {data.slice(0, 5).map((s) => (
          <li
            key={s.contractId}
            className="flex items-baseline justify-between gap-3"
          >
            <a
              href={`/dashboard/contracts/${s.contractId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-primary hover:underline"
            >
              {s.vendorName} — {s.contractName}
            </a>
            {s.templateTerm && (
              <span className="shrink-0 text-muted-foreground">
                {s.templateTerm.tiers.length} tier
                {s.templateTerm.tiers.length === 1 ? "" : "s"} ·{" "}
                {s.templateTerm.evaluationPeriod}-eval
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Open in a new tab to compare configurations side-by-side.
      </p>
    </div>
  )
}
