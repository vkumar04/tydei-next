import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Plus,
  Trash2,
  Calculator,
  TrendingUp,
  DollarSign,
  PieChart as PieChartIcon,
  Percent,
  HelpCircle,
  PiggyBank,
} from "lucide-react"
import {
  defaultTargetTypeForTermType,
  type ProposalTermsEstimateResult,
} from "@/lib/prospective-analysis/proposal-term-estimate"
import type { NewProposalState, ProspectiveTerm, ProspectiveTermTier } from "./types"
import { formatCurrencyShort } from "./types"

const TERM_TYPES = [
  { value: "spend_rebate", label: "Spend Rebate", description: "Rebate calculated based on total dollar spend thresholds. Higher spend = higher rebate tier.", icon: DollarSign },
  { value: "volume_rebate", label: "Volume Rebate", description: "Rebate based on unit/case volume purchased. Ideal for high-volume consumables.", icon: TrendingUp },
  { value: "market_share_rebate", label: "Market Share Rebate", description: "Rebate earned when facility purchases a target % of category from your products.", icon: PieChartIcon },
  { value: "price_reduction", label: "Price Reduction", description: "Once spend/volume threshold is met, future purchases receive discounted unit prices.", icon: Percent },
]

const labelForType = (value: ProspectiveTerm["termType"]): string =>
  TERM_TYPES.find((t) => t.value === value)?.label ?? value

// Target metric options — spend thresholds are DOLLARS, volume thresholds are
// UNITS, market-share thresholds are PERCENTS (CLAUDE.md type-confusion rule).
const TARGET_TYPES: { value: ProspectiveTerm["targetType"]; label: string }[] = [
  { value: "spend", label: "Spend ($)" },
  { value: "volume", label: "Volume (units)" },
  { value: "market_share", label: "Market share (%)" },
]

const labelForTargetType = (value: ProspectiveTerm["targetType"]): string =>
  TARGET_TYPES.find((t) => t.value === value)?.label ?? value

const REBATE_TYPES: { value: ProspectiveTerm["rebateType"]; label: string }[] = [
  { value: "percent", label: "% of spend" },
  { value: "fixed", label: "Fixed $" },
  { value: "per_unit", label: "$ per unit" },
]

const labelForRebateType = (value: ProspectiveTerm["rebateType"]): string =>
  REBATE_TYPES.find((t) => t.value === value)?.label ?? value

const rebateValueLabel = (term: ProspectiveTerm): string => {
  const noun = term.termType === "price_reduction" ? "Discount" : "Rebate"
  switch (term.rebateType) {
    case "fixed":
      return `${noun} ($)`
    case "per_unit":
      return `${noun} ($/unit)`
    case "percent":
      return `${noun} (%)`
  }
}

const targetValueLabel = (targetType: ProspectiveTerm["targetType"]): string => {
  switch (targetType) {
    case "volume":
      return "Target Volume (units)"
    case "market_share":
      return "Share Commitment (%)"
    case "spend":
      return "Target Spend ($)"
  }
}

const tierMinPlaceholder = (targetType: ProspectiveTerm["targetType"]): string =>
  targetType === "volume" ? "Min units" : targetType === "market_share" ? "Min %" : "Min $"

const tierMaxPlaceholder = (targetType: ProspectiveTerm["targetType"]): string =>
  targetType === "volume" ? "Max units" : targetType === "market_share" ? "Max %" : "Max $"

const tierValuePlaceholder = (rebateType: ProspectiveTerm["rebateType"]): string =>
  rebateType === "fixed" ? "Rebate $" : rebateType === "per_unit" ? "$/unit" : "Rebate %"

export interface ContractTermsProps {
  newProposal: NewProposalState
  addTerm: () => void
  removeTerm: (termId: string) => void
  updateTerm: (termId: string, updates: Partial<ProspectiveTerm>) => void
  estimate: ProposalTermsEstimateResult
}

export function ContractTerms({
  newProposal,
  addTerm,
  removeTerm,
  updateTerm,
  estimate,
}: ContractTermsProps) {
  // Tier-row mutations route through updateTerm; rows keyed + deleted by the
  // stable UI-only _uid (CLAUDE.md list-key rule — never the array index).
  const addTier = (term: ProspectiveTerm) =>
    updateTerm(term.id, {
      tiers: [...term.tiers, { _uid: crypto.randomUUID(), min: 0, value: 0 }],
    })
  const updateTier = (
    term: ProspectiveTerm,
    uid: string,
    updates: Partial<Omit<ProspectiveTermTier, "_uid">>,
  ) =>
    updateTerm(term.id, {
      tiers: term.tiers.map((t) => (t._uid === uid ? { ...t, ...updates } : t)),
    })
  const removeTier = (term: ProspectiveTerm, uid: string) =>
    updateTerm(term.id, { tiers: term.tiers.filter((t) => t._uid !== uid) })

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-4">
          <Label className="text-base font-semibold">Proposed Terms</Label>
          <Button variant="outline" size="sm" onClick={addTerm}>
            <Plus className="mr-2 h-4 w-4" />
            Add Term
          </Button>
        </div>

        {newProposal.terms.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
            <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No terms added yet</p>
            <p className="text-sm">Add rebate or pricing terms to your proposal</p>
          </div>
        ) : (
          <div className="space-y-4">
            {newProposal.terms.map((term, index) => (
              <div key={term.id} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Term {index + 1}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => removeTerm(term.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 [&>*]:min-w-0">
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      Term Type
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="font-medium mb-1">Contract Term Types</p>
                          <p className="text-xs">Choose how rebates are calculated. Each type uses different metrics (spend, volume, or market share) to determine rebate amounts.</p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <Select
                      value={term.termType}
                      onValueChange={(v) => {
                        const termType = v as ProspectiveTerm["termType"]
                        // Keep the target metric in sync with the term type;
                        // the user can still override it afterwards.
                        updateTerm(term.id, {
                          termType,
                          targetType: defaultTargetTypeForTermType(termType),
                        })
                      }}
                    >
                      {/* Radix clones the selected SelectItem's children into
                          the trigger — with the rich two-line item content
                          below, that rendered the whole description sentence
                          in the (w-fit) trigger and blew up the grid row.
                          Passing plain-label children to <SelectValue> pins
                          what the trigger displays (Radix: "Controlling the
                          value displayed in the trigger"). */}
                      <SelectTrigger className="w-full">
                        <SelectValue>{labelForType(term.termType)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[350px]">
                        {TERM_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value} className="py-2">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <t.icon className="h-3 w-3 shrink-0" />
                                <span className="font-medium">{t.label}</span>
                              </div>
                              <span className="text-xs text-muted-foreground pl-5">{t.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Target Metric</Label>
                    <Select
                      value={term.targetType}
                      onValueChange={(v) =>
                        updateTerm(term.id, { targetType: v as ProspectiveTerm["targetType"] })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>{labelForTargetType(term.targetType)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{targetValueLabel(term.targetType)}</Label>
                    <Input
                      type="number"
                      value={term.targetValue}
                      onChange={(e) => updateTerm(term.id, { targetValue: parseFloat(e.target.value) || 0 })}
                      placeholder="Threshold"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rebate Type</Label>
                    <Select
                      value={term.rebateType}
                      onValueChange={(v) =>
                        updateTerm(term.id, { rebateType: v as ProspectiveTerm["rebateType"] })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>{labelForRebateType(term.rebateType)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {REBATE_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{rebateValueLabel(term)}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={term.rebatePercent}
                      onChange={(e) => updateTerm(term.id, { rebatePercent: parseFloat(e.target.value) || 0 })}
                      placeholder={term.rebateType === "percent" ? "e.g., 3.5" : "e.g., 25"}
                    />
                  </div>
                </div>

                {/* Tier ladder — optional; when present it overrides the flat
                    rate. Thresholds are in the target metric's units. */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1 text-muted-foreground">
                      Tiers (optional — override the flat rate)
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs">
                            The highest tier whose minimum the projection reaches
                            pays out. Thresholds use the target metric&apos;s units
                            ({labelForTargetType(term.targetType)}); the tier value
                            uses the rebate type ({labelForRebateType(term.rebateType)}).
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <Button variant="ghost" size="sm" onClick={() => addTier(term)}>
                      <Plus className="mr-1 h-3 w-3" />
                      Add tier
                    </Button>
                  </div>
                  {term.tiers.length > 0 && (
                    <div className="space-y-2">
                      {term.tiers.map((tier, tierIdx) => (
                        <div
                          key={tier._uid}
                          className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-2 [&>*]:min-w-0"
                        >
                          <Badge variant="outline" className="shrink-0 text-xs">
                            T{tierIdx + 1}
                          </Badge>
                          <Input
                            type="number"
                            value={tier.min}
                            onChange={(e) =>
                              updateTier(term, tier._uid, { min: parseFloat(e.target.value) || 0 })
                            }
                            placeholder={tierMinPlaceholder(term.targetType)}
                            aria-label={`Tier ${tierIdx + 1} minimum`}
                          />
                          <Input
                            type="number"
                            value={tier.max ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value
                              updateTier(term, tier._uid, {
                                max: raw === "" ? undefined : parseFloat(raw) || 0,
                              })
                            }}
                            placeholder={tierMaxPlaceholder(term.targetType)}
                            aria-label={`Tier ${tierIdx + 1} maximum (optional)`}
                          />
                          <Input
                            type="number"
                            step="0.1"
                            value={tier.value}
                            onChange={(e) =>
                              updateTier(term, tier._uid, { value: parseFloat(e.target.value) || 0 })
                            }
                            placeholder={tierValuePlaceholder(term.rebateType)}
                            aria-label={`Tier ${tierIdx + 1} rebate value`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={() => removeTier(term, tier._uid)}
                            aria-label={`Remove tier ${tierIdx + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Estimated Impact — rebate and price-reduction savings are DIFFERENT
          things and are shown separately (price_reduction never pays rebate). */}
      {newProposal.terms.length > 0 && (
        <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
          <CardContent className="pt-4 space-y-3">
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Annual Rebate</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {formatCurrencyShort(estimate.totalRebate)}
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Annual Savings</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {formatCurrencyShort(estimate.totalSavings)}
                  </p>
                  <p className="text-xs text-muted-foreground">From price-reduction terms</p>
                </div>
                <PiggyBank className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            {estimate.perTerm.length > 0 && (
              <ul className="space-y-1 border-t border-green-200 dark:border-green-800 pt-3">
                {estimate.perTerm.map((t, i) => (
                  <li key={newProposal.terms[i]?.id ?? i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-medium">
                      {t.label}
                      {": "}
                      {t.savings > 0
                        ? `${formatCurrencyShort(t.savings)} savings`
                        : `${formatCurrencyShort(t.rebate)} rebate`}
                    </span>
                    <span className="text-muted-foreground">{t.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
