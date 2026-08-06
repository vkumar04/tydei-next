"use client"

import { useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getCategories } from "@/lib/actions/categories"
import { queryKeys } from "@/lib/query-keys"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import { NON_PERCENT_TIER_TERM_TYPES } from "./_term-type-config"

// Fallback category fetch — runs only when the caller didn't pass any.
// Every mount point of this component previously had to wire its own
// "get categories from contract → fall back to global list" logic,
// which meant most mount points simply didn't (new-contract form,
// edit-contract form, vendor submission) and the Specific-Category
// tier picker always told the user "add a category first" even though
// dozens exist platform-wide.
export function useResolvedCategories(
  availableCategories: { id: string; name: string }[],
): { id: string; name: string }[] {
  const { data: fallbackCategories } = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => getCategories(),
    enabled: availableCategories.length === 0,
  })

  const resolvedCategories = useMemo(() => {
    if (availableCategories.length > 0) return availableCategories
    return (fallbackCategories ?? []).map((c) => ({ id: c.id, name: c.name }))
  }, [availableCategories, fallbackCategories])

  return resolvedCategories
}

// W1.G — when the contract type flips to "tie_in", gently pre-populate
// sensible capital-term defaults on any term that's still fully blank for
// that field. We only fill null/undefined values so we never clobber a
// number the user just typed. Runs once per change to `contractType`
// or when new terms are added; `onChange` is the parent setter so no
// render loop (next render sees filled values and becomes a no-op).
// NOTE: we intentionally do NOT seed interestRate — leave it null so the
// user consciously fills it in (and W1.E's fraction↔percent round-trip
// stays honest).
export function useTieInTermDefaults(
  contractType: string | undefined,
  terms: TermFormValues[],
  onChange: (terms: TermFormValues[]) => void,
): void {
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
}

// Bug #12 / #13: existing saved terms may have a termType / baselineType
// / tier rebateType combination that the form's onValueChange cascade
// would have rejected (e.g. a volume_rebate term with baselineType=
// spend_based and percent_of_spend tiers). The form-side gates only
// catch NEW changes; without this, opening such a term in edit mode
// shows the legacy shape and the recompute math runs on the wrong
// semantics. Self-heal once on mount: cascade baselineType + flip
// percent_of_spend tiers to fixed_rebate (zeroing the value, since a
// 0.10 fraction would read as $0.10 per period otherwise).
export function useTermShapeSelfHeal(
  terms: TermFormValues[],
  onChange: (terms: TermFormValues[]) => void,
): void {
  useEffect(() => {
    if (terms.length === 0) return
    const PER_OCC = new Set([
      "volume_rebate",
      "rebate_per_use",
      "capitated_pricing_rebate",
    ])
    // NON_PERCENT_TIER_TERM_TYPES (shared with contract-tier-row.tsx's
    // rebate-type picker) — the termTypes whose engines have no defined
    // per-period $ base to apply a percent against. volume_rebate and
    // market_share ARE legal % targets (bugs #16, #17) so they stay off
    // this list.
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
      if (NON_PERCENT_TIER_TERM_TYPES.has(t.termType) && t.tiers) {
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
}
