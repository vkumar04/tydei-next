"use client"

import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field } from "@/components/shared/forms/field"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import {
  SpecificItemsPicker,
  type VendorItem,
} from "../specific-items-picker"
import { isCarveOutScopeLocked } from "@/lib/contracts/carve-out-scope"
import { CptCodeList } from "./_cpt-code-list"
import { ReferenceNumberList } from "./_reference-number-list"
import { CategoryMappingSuggestions } from "./_category-mapping-suggestions"

interface TermVolumeTypeFieldProps {
  term: TermFormValues
  onUpdate: (updated: Partial<TermFormValues>) => void
}

/** "Volume Counted By" — rendered by the term card only for
 *  `termType === "volume_rebate"`, between the baseline grid and the
 *  Evaluation Period field (order matters; keep it out of
 *  TermScopeFields which renders later in the card). */
export function TermVolumeTypeField({ term, onUpdate }: TermVolumeTypeFieldProps) {
  return (
    <Field label="Volume Counted By">
      <Select
        value={term.volumeType ?? "procedure_code"}
        onValueChange={(v) => {
          const next = v as TermFormValues["volumeType"]
          if (next === "all_products") {
            // Review F7: also clear any category scope so a
            // stale scopedCategoryIds can't ride along onto
            // an all-products term at save time.
            onUpdate({
              volumeType: next,
              appliesTo: "all_products",
              cptCodes: [],
              scopedCategoryId: undefined,
              scopedCategoryIds: undefined,
            })
          } else if (next === "product_category") {
            // bugs.rtfd 2026-06-13 #5 (Vick): "Product category
            // (units)" counts volume per category, so the scope
            // can't be All Products. Force Specific Category and
            // KEEP any categories the user already picked (they
            // must end up with ≥1 — required by
            // refineProductCategoryScope). If appliesTo was
            // all_products / specific_items, flip it to
            // specific_category so the Categories picker appears.
            onUpdate({
              volumeType: next,
              appliesTo: "specific_category",
            })
          } else {
            onUpdate({ volumeType: next })
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
      {/* Charles 2026-06-10: "volume counted by and product
          scope — if those are doing the same thing, remove
          one." They are distinct dimensions (volumeType = how
          units are tallied; appliesTo = which products
          count), so both stay — but spell that out so the
          form doesn't read as a duplicate. */}
      <p className="text-xs text-muted-foreground">
        How units are tallied — product units, CPT procedures,
        or PO count. Product Scope below picks which products
        count toward it.
      </p>
    </Field>
  )
}

interface TermScopeFieldsProps {
  term: TermFormValues
  onUpdate: (updated: Partial<TermFormValues>) => void
  resolvedCategories: { id: string; name: string }[]
  availableItems: VendorItem[]
}

/** Product scope, category picker, specific-items picker, CPT codes,
 *  and reference numbers for one term. Renders a fragment so the
 *  parent CardContent's `space-y-4` keeps applying to each block. */
export function TermScopeFields({
  term,
  onUpdate,
  resolvedCategories,
  availableItems,
}: TermScopeFieldsProps) {
  return (
    <>
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
            // bugs.rtfd 2026-06-13 #5 — product_category volume
            // forces Specific Category; coerce the displayed value
            // so an inconsistent inbound state (e.g. AI extract
            // arriving as all_products) doesn't render a blank
            // trigger for the now-removed All Products item.
            value={
              term.termType === "volume_rebate" &&
              term.volumeType === "product_category"
                ? "specific_category"
                : term.appliesTo
            }
            disabled={
              // Review F7: lock only when the state is CONSISTENT
              // (AI extracts can arrive with volumeType=all_products
              // but a category scope — leave the select editable so
              // the user can resolve it instead of being stranded).
              term.termType === "volume_rebate" &&
              term.volumeType === "all_products" &&
              term.appliesTo === "all_products"
            }
            onValueChange={(v) =>
              onUpdate({
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
              {/* bugs.rtfd 2026-06-13 #5 (Vick): when volume is
                  counted by product category, the scope can't be
                  All Products — units are tallied per category — so
                  the "All Products" option is removed entirely. */}
              {!(
                term.termType === "volume_rebate" &&
                term.volumeType === "product_category"
              ) && (
                <SelectItem value="all_products">All Products</SelectItem>
              )}
              <SelectItem value="specific_category">Specific Category</SelectItem>
              <SelectItem value="specific_items">Specific Items</SelectItem>
            </SelectContent>
          </Select>
          {term.termType === "volume_rebate" &&
            term.volumeType === "all_products" &&
            term.appliesTo === "all_products" && (
              <p className="text-xs text-muted-foreground">
                Locked to All Products by &quot;All products on
                contract&quot; above.
              </p>
            )}
          {/* bugs.rtfd 2026-06-13 #5 — spell out why All Products is
              gone for product-category volume. */}
          {term.termType === "volume_rebate" &&
            term.volumeType === "product_category" && (
              <p className="text-xs text-muted-foreground">
                &quot;Product category (units)&quot; counts volume by
                category — pick at least one category below. All
                Products isn&apos;t available for this volume type.
              </p>
            )}
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
                  onUpdate({
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
                            onUpdate({
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
                onUpdate({ scopedItemNumbers: next })
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
              onUpdate({ cptCodes: next })
            }
          />
        </Field>
      )}

      {/* Charles 2026-06-06 — cross-vendor reference numbers.
          Always available (not gated by term type): they're
          the robust cross-vendor match key for grouped
          contracts where vendor names / SKUs drift. The COG
          matcher uses these as the manufacturerNo fallback
          (lib/contracts/match.ts). Without a capture path the
          fallback was dead in practice. */}
      <Field label="Reference Numbers">
        <ReferenceNumberList
          values={term.referenceNumbers ?? []}
          onChange={(next) =>
            onUpdate({ referenceNumbers: next })
          }
        />
      </Field>
    </>
  )
}
