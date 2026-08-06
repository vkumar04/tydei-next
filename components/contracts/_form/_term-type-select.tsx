"use client"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DefinitionTooltip as EnumDefinitionTooltip } from "@/components/contracts/definition-tooltip"
import { TERM_TYPE_DEFINITIONS } from "@/lib/contract-definitions"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import { termTypes, NON_PERCENT_TIER_TERM_TYPES } from "./_term-type-config"

/**
 * Pure type-change cascade — computes the patch applied when the user
 * changes a term's type, so the form doesn't get stuck in a
 * mismatched state (Bug #5: switching to Volume Rebate while baseline
 * still shows Spend Based). The user can still override after.
 */
export function getTermTypeChangePatch(
  term: TermFormValues,
  nextType: TermFormValues["termType"],
): Partial<TermFormValues> {
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
  // Membership is the shared NON_PERCENT_TIER_TERM_TYPES
  // (also used by contract-tier-row.tsx's picker filter
  // and the mount self-heal). volume_rebate and
  // market_share legitimately accept percent
  // tiers (bugs #16, #17) so they're absent.
  const tiersForNextType =
    NON_PERCENT_TIER_TERM_TYPES.has(nextType)
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
  // Bug 2026-06-08 ("when market share is selected,
  // categories need to be chosen"): market share is
  // inherently per-category, so default the scope to
  // Specific Category when switching to a market-share
  // term that's still scoped to All Products. The
  // Categories field below is already `required`.
  const isMarketShareType =
    nextType === "market_share" ||
    nextType === "market_share_price_reduction"
  const appliesToForType =
    isMarketShareType && term.appliesTo === "all_products"
      ? "specific_category"
      : term.appliesTo
  return {
    termType: nextType,
    baselineType: baselineForType,
    appliesTo: appliesToForType,
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
  }
}

interface TermTypeSelectProps {
  term: TermFormValues
  onUpdate: (updated: Partial<TermFormValues>) => void
}

export function TermTypeSelect({ term, onUpdate }: TermTypeSelectProps) {
  return (
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
          onUpdate(getTermTypeChangePatch(term, nextType))
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
  )
}
