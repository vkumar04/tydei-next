"use client"

import { Plus, DollarSign } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { DefinitionTooltip } from "@/components/shared/definition-tooltip"
import type { TermFormValues, TierInput } from "@/lib/validators/contract-terms"
import type { VendorItem } from "./specific-items-picker"
import { createEmptyTerm, createEmptyTier } from "./_form/_term-type-config"
import {
  useResolvedCategories,
  useTermShapeSelfHeal,
  useTieInTermDefaults,
} from "./_form/_use-term-form-state"
import { TermCard } from "./_form/_term-card"

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

export function ContractTermsEntry({
  terms,
  onChange,
  availableCategories = [],
  availableItems = [],
  contractType,
}: ContractTermsEntryProps) {
  const resolvedCategories = useResolvedCategories(availableCategories)
  useTieInTermDefaults(contractType, terms, onChange)
  useTermShapeSelfHeal(terms, onChange)

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
    // Bug 2026-06-08 ("just showing a dollar amount"): a market-share rebate
    // that mixed a percent_of_spend tier 1 with fixed_rebate tiers 2/3 read
    // as incoherent ($ on the higher tiers). Inherit the previous tier's
    // rebate type so a term stays internally consistent — the user sets the
    // type once on tier 1 and added tiers follow. They can still override
    // per tier afterward.
    const prevTier = term.tiers[term.tiers.length - 1]
    if (prevTier) newTier.rebateType = prevTier.rebateType
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
              <TermCard
                term={term}
                termIdx={termIdx}
                contractType={contractType}
                resolvedCategories={resolvedCategories}
                availableItems={availableItems}
                onUpdate={(updated) => updateTerm(termIdx, updated)}
                onRemove={() => removeTerm(termIdx)}
                onAddTier={() => addTier(termIdx)}
                onUpdateTier={(tierIdx, tier) =>
                  updateTier(termIdx, tierIdx, tier)
                }
                onRemoveTier={(tierIdx) => removeTier(termIdx, tierIdx)}
              />
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
