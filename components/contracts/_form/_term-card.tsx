"use client"

import { Plus, Trash2, HelpCircle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field } from "@/components/shared/forms/field"
import { Label } from "@/components/ui/label"
import { ContractTierRow } from "@/components/contracts/contract-tier-row"
import type { TermFormValues, TierInput } from "@/lib/validators/contract-terms"
import type { VendorItem } from "../specific-items-picker"
import { baselineTypes } from "./_term-type-config"
import { TermTypeSelect } from "./_term-type-select"
import { TermVolumeTypeField, TermScopeFields } from "./_term-scope-fields"
import { TermTieInFields } from "./_term-tie-in-fields"

interface TermCardProps {
  term: TermFormValues
  termIdx: number
  contractType?: string
  resolvedCategories: { id: string; name: string }[]
  availableItems: VendorItem[]
  onUpdate: (updated: Partial<TermFormValues>) => void
  onRemove: () => void
  onAddTier: () => void
  onUpdateTier: (tierIndex: number, tier: TierInput) => void
  onRemoveTier: (tierIndex: number) => void
}

/** The full editing card for one term — everything inside the
 *  AccordionContent. The Accordion shell, index keys, and term/tier
 *  CRUD closures stay in ContractTermsEntry. */
export function TermCard({
  term,
  termIdx,
  contractType,
  resolvedCategories,
  availableItems,
  onUpdate,
  onRemove,
  onAddTier,
  onUpdateTier,
  onRemoveTier,
}: TermCardProps) {
  return (
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
            onRemove()
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
                onUpdate({ termName: e.target.value })
              }
              placeholder="e.g., Spine Implant Rebate"
            />
          </Field>

          <TermTypeSelect term={term} onUpdate={onUpdate} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Baseline Type">
            <Select
              value={term.baselineType}
              onValueChange={(v) =>
                onUpdate({
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
                  onUpdate({
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
                  onUpdate({
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
                  onUpdate({
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
          <TermVolumeTypeField term={term} onUpdate={onUpdate} />
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
                onUpdate({ evaluationPeriod: v })
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
                {/* bugs.rtfd 2026-06-13: a threshold that accumulates
                    over the whole contract instead of resetting each
                    period (tier qualifies on cumulative spend). */}
                <SelectItem value="lifetime">Lifetime (contract total)</SelectItem>
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
              onUpdate({
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

        <TermScopeFields
          term={term}
          onUpdate={onUpdate}
          resolvedCategories={resolvedCategories}
          availableItems={availableItems}
        />

        {contractType === "tie_in" && (
          <TermTieInFields
            term={term}
            contractType={contractType}
            onUpdate={onUpdate}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Effective Start" required>
            <Input
              type="date"
              value={term.effectiveStart}
              onChange={(e) =>
                onUpdate({
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
                onUpdate({
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
                onClick={onAddTier}
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
                    onChange={(t) => onUpdateTier(tierIdx, t)}
                    onRemove={() => onRemoveTier(tierIdx)}
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
  )
}
