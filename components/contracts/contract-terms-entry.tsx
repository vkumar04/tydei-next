"use client"

import { useMemo } from "react"
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
} from "lucide-react"
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
import { DefinitionTooltip } from "@/components/shared/definition-tooltip"
import { ContractTierRow } from "@/components/contracts/contract-tier-row"
import { getCategories } from "@/lib/actions/categories"
import { queryKeys } from "@/lib/query-keys"
import type { TermFormValues, TierInput } from "@/lib/validators/contract-terms"
import { SpecificItemsPicker, type VendorItem } from "./specific-items-picker"

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
}

const termTypes = [
  { value: "spend_rebate", label: "Spend Rebate", icon: DollarSign, description: "Rebate based on spend thresholds" },
  { value: "volume_rebate", label: "Volume Rebate", icon: TrendingUp, description: "Rebate based on usage count. Baseline is in $ amounts" },
  { value: "price_reduction", label: "Price Reduction", icon: Percent, description: "Once spend/volume threshold is met, future purchases receive discounted prices" },
  { value: "market_share", label: "Market Share", icon: PieChart, description: "Rebate based on market share percentage" },
  { value: "market_share_price_reduction", label: "Market Share Price Reduction", icon: PieChart, description: "Once market share target is met, future purchases receive discounted prices" },
  { value: "capitated_price_reduction", label: "Capitated Price Reduction", icon: BarChart3, description: "Once procedure spend threshold is met, future procedures receive discounted prices" },
  { value: "capitated_pricing_rebate", label: "Capitated Pricing Rebate", icon: BarChart3, description: "Procedure-based ceiling price with rebate" },
  { value: "growth_rebate", label: "Growth Rebate", icon: TrendingUp, description: "Rebate based on spend growth over baseline" },
  { value: "compliance_rebate", label: "Compliance Rebate", icon: Shield, description: "Rebate for meeting compliance requirements" },
  { value: "fixed_fee", label: "Fixed Fee", icon: Coins, description: "Fixed dollar rebate amount" },
  { value: "locked_pricing", label: "Locked Pricing", icon: Lock, description: "Price locked for contract duration" },
  { value: "rebate_per_use", label: "Rebate Per Use", icon: Coins, description: "Per-unit rebate tracked by usage count" },
  { value: "po_rebate", label: "PO Rebate", icon: DollarSign, description: "Per-purchase-order rebate triggered by PO totals" },
  { value: "carve_out", label: "Carve Out", icon: Shield, description: "Specific items excluded from the broader contract terms" },
  { value: "payment_rebate", label: "Payment Rebate", icon: Coins, description: "Rebate triggered by payment timing or method" },
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
                    onClick={() => removeTerm(termIdx)}
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

                    <Field label="Term Type">
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
                            <SelectItem key={tt.value} value={tt.value}>
                              <div className="flex items-center gap-2">
                                <tt.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div>
                                  <div>{tt.label}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {tt.description}
                                  </div>
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
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

                  <Field label="Rebate Calculation Method">
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
                            <span className="font-medium">Whole-spend at the highest tier</span>
                            <span className="text-xs text-muted-foreground">All spend earns the rate of the top tier reached. Example: $750K at tier 3 (3%) → $22,500.</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="marginal">
                          <div className="flex flex-col">
                            <span className="font-medium">Each bracket at its own rate</span>
                            <span className="text-xs text-muted-foreground">Spend in each bracket earns that bracket&apos;s rate, summed. Example: $500K @ 2% + $250K @ 3% → $17,500.</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {term.rebateMethod === "marginal"
                        ? "Each spend bracket earns its own rate."
                        : "Entire spend earns the highest achieved tier's rate."}
                    </p>
                  </Field>

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

                  {/* When a tier is scoped to a specific category, require
                      the user to pick which category from the contract's
                      selected categories. */}
                  {term.appliesTo === "specific_category" && (
                    <Field label="Category" required>
                      {resolvedCategories.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Loading categories…
                        </p>
                      ) : (
                        <Select
                          value={term.scopedCategoryId ?? ""}
                          onValueChange={(v) =>
                            updateTerm(termIdx, { scopedCategoryId: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a category..." />
                          </SelectTrigger>
                          <SelectContent>
                            {resolvedCategories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
