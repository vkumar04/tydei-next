"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { ArrowLeft, Loader2, Save } from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractDocumentSafe } from "@/lib/actions/contracts"
import { importContractPricingSafe, type ContractPricingItem } from "@/lib/actions/pricing-files"
import { parsePricingFile, buildPricingItems } from "@/lib/utils/parse-pricing-file"
import { createCategory, getCategories, getMappedCategoryUniverse } from "@/lib/actions/categories"
import { computePricingVsCOG } from "@/lib/actions/cog-records"
import { deriveContractTotalFromCOG } from "@/lib/actions/contracts/derive-from-cog"
import { useAutoFillWhenPristine } from "@/hooks/use-auto-fill-when-pristine"
import { queryKeys } from "@/lib/query-keys"
import { createVendor } from "@/lib/actions/vendors"
import type {
  TermFormValues,
  TierInput,
} from "@/lib/validators/contract-terms"
import { normalizeAIRebateValue, toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { computeContractYears } from "@/lib/contracts/term-years"
import { selectScopeableCategories } from "@/lib/contracts/scopeable-categories"
import { applyCategoryRemap } from "@/lib/categories/apply-category-remap"
import { PricingColumnMapper } from "@/components/contracts/pricing-column-mapper"
import { PricingCategoryRemapDialog } from "@/components/pricing/pricing-category-remap-dialog"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractFormReview } from "@/components/contracts/contract-form-review"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { EntryModeTabs } from "@/components/vendor/contracts/submission"
import {
  CapitalLineItemsEditor,
  buildSeededCapitalLineItem,
  resolveSeededFinancedTotal,
  type CapitalLineItemDraft,
} from "@/components/contracts/capital-line-items-editor"
import { createCapitalLineItemSafe } from "@/lib/actions/contracts/capital-line-items"
import {
  matchOrCreateVendorId,
  deriveRebatePayPeriod,
} from "@/components/contracts/new-contract-helpers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import type { ExtractedContractData } from "@/lib/ai/schemas"

interface NewContractClientProps {
  vendors: { id: string; name: string; displayName: string | null }[]
  categories: { id: string; name: string }[]
  /** bugs.rtfd 2026-06-13: mapped-category universe (confirmed CategoryMapping
   *  targets ∪ this facility's price-file categories) — the term picker's base
   *  list, unioned with the in-memory price file being uploaded. */
  mappedCategories?: string[]
}

export function NewContractClient({
  vendors,
  categories,
  mappedCategories = [],
}: NewContractClientProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  // Dynamically fetch categories so newly-created ones appear without full page refresh
  const { data: dynamicCategories } = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => getCategories(),
    initialData: categories,
  })
  const liveCategories = useMemo(
    () => dynamicCategories ?? categories,
    [dynamicCategories, categories],
  )
  // bugs.rtfd 2026-06-13: live mapped-category universe (refetches), so the
  // term picker never freezes at a stale page-load snapshot.
  const { data: liveMappedCategories } = useQuery({
    queryKey: queryKeys.categories.mappedUniverse,
    queryFn: () => getMappedCategoryUniverse(),
    initialData: mappedCategories,
  })

  // Bug #20 (2026-05-11, Vick): default to Upload PDF because that's
  // the primary intake path — almost every contract starts as a
  // vendor PDF the user is digitizing. Manual entry is the escape
  // hatch, not the default.
  const [entryMode, setEntryMode] = useState<"ai" | "pdf" | "manual">("pdf")
  const [aiExtractOpen, setAiExtractOpen] = useState(false)
  const [droppedFile, setDroppedFile] = useState<File | null>(null)
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [extractionComplete, setExtractionComplete] = useState(false)
  const [pricingItems, setPricingItems] = useState<ContractPricingItem[]>([])
  const [pricingFileName, setPricingFileName] = useState<string | null>(null)
  const [pricingCategories, setPricingCategories] = useState<string[]>([])
  const [pricingMapperOpen, setPricingMapperOpen] = useState(false)
  const [pricingRawHeaders, setPricingRawHeaders] = useState<string[]>([])
  const [pricingRawRows, setPricingRawRows] = useState<Record<string, string>[]>([])
  const [pricingAutoMapping, setPricingAutoMapping] = useState<Record<string, string>>({})
  const [pricingFileRef, setPricingFileRef] = useState<File | null>(null)
  // Charles 2026-06-06: pre-import category-realign capture. The contract
  // doesn't exist yet at upload time, so we open the realign dialog now,
  // stash the chosen detected→canonical map, and thread it into the
  // deferred post-create import (runPostCreateSideEffects).
  const [pricingRemapOpen, setPricingRemapOpen] = useState(false)
  const [pricingCategoryRemap, setPricingCategoryRemap] = useState<
    Record<string, string> | undefined
  >(undefined)
  // Items waiting for the realign step before they're committed to
  // `pricingItems`. Captured the file name so finalize can label them.
  const [pendingPricingItems, setPendingPricingItems] = useState<
    ContractPricingItem[]
  >([])
  const [pendingPricingFileName, setPendingPricingFileName] = useState<
    string | null
  >(null)
  const [pendingPricingCategories, setPendingPricingCategories] = useState<
    string[]
  >([])
  const [contractS3Key, setContractS3Key] = useState<string | null>(null)
  const [contractFileName, setContractFileName] = useState<string | null>(null)
  const [additionalDocs, setAdditionalDocs] = useState<
    { file: File; type: string; name: string }[]
  >([])
  const {
    form,
    terms,
    setTerms,
  } = useContractForm()
  const createMutation = useCreateContract()
  // bugs.rtfd 2026-06-11 B1 — `createMutation.isPending` only covers the
  // createContract call itself. The post-create side effects
  // (runPostCreateSideEffects: capital line items → pricing import →
  // documents) run AFTER mutateAsync resolves, so on a 15k-item pricing
  // file the button re-enabled for 50s+ mid-import and a second click
  // created a duplicate contract. `finalizing` keeps the action bar
  // disabled through that window.
  const [finalizing, setFinalizing] = useState(false)
  // Feature 5 (uploader improvement 5, 2026-06-13): chunked pricing import
  // progress, surfaced in the existing busy label as "Importing pricing… N%".
  // null while no pricing chunk is in flight (the label falls back to the
  // plain "Importing pricing…" the B1 fix established).
  const [pricingPercent, setPricingPercent] = useState<number | null>(null)
  // Bug 7 guardrail: remember how many terms AI populated so submit can
  // warn if the user ended up with fewer than that (accidental delete,
  // or reviewed-but-dropped). Null = no AI populate happened.
  const [aiTermCount, setAiTermCount] = useState<number | null>(null)

  // Charles audit suggestion #4 (v0-port): per-asset capital line items.
  // Persisted via createCapitalLineItem after the contract is created.
  const [capitalItems, setCapitalItems] = useState<CapitalLineItemDraft[]>([])

  // Safety net: seed a capital line item whenever the contract type TRANSITIONS
  // into tie_in/capital while the editor is empty. The AI-extract handler
  // already seeds when it CLASSIFIES a contract as tie_in/capital, but it
  // routinely mis-classifies an equipment-contribution contract as `usage`
  // (its spend-rebate tiers match the "usage" rule), so when the user corrects
  // the type the Capital / Leased Items editor would land empty — which BLOCKS
  // save (the submit gate requires >=1 item). Seeding here makes capital "come
  // up" no matter how the type was set. Mirrors the AI-extract seed via the
  // same shared builder. Fires only on an actual transition (prev-type ref),
  // not on mount or on capitalItems changes. Vick "AI not grabbing the capital
  // again on the Tie in" 2026-06-22.
  const watchedContractType = form.watch("contractType")
  const prevContractTypeRef = useRef(watchedContractType)
  useEffect(() => {
    const prev = prevContractTypeRef.current
    prevContractTypeRef.current = watchedContractType
    if (prev === watchedContractType) return
    if (watchedContractType !== "tie_in" && watchedContractType !== "capital")
      return
    setCapitalItems((items) => {
      if (items.length > 0) return items
      return [
        buildSeededCapitalLineItem({
          financedTotal: resolveSeededFinancedTotal({
            totalValue: form.getValues("totalValue"),
            fallback: form.getValues("annualValue"),
          }),
          contractName: form.getValues("name"),
          description: form.getValues("description"),
        }),
      ]
    })
  }, [watchedContractType, form])

  // Charles W1.W-E1 — one idempotency key per form session.
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `new-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  // Auto-derive Contract Total + Annual from COG when vendor/date
  // changes. Guarded by dirtyFields so a user-typed value (Charles's
  // 5.3M prod regression) is never clobbered. See
  // hooks/use-auto-fill-when-pristine.ts.
  const watchedVendorId = form.watch("vendorId")
  const watchedEffective = form.watch("effectiveDate")
  const watchedExpiration = form.watch("expirationDate")
  useAutoFillWhenPristine(
    form,
    async () => {
      if (!watchedVendorId) return {}
      const r = await deriveContractTotalFromCOG(watchedVendorId, {
        effectiveDate: watchedEffective || null,
        expirationDate: watchedExpiration || null,
      })
      return { totalValue: r.totalValue, annualValue: r.annualValue }
    },
    [watchedVendorId, watchedEffective, watchedExpiration],
  )

  // Charles 2026-06-06: create-flow pricing parity. This now routes through
  // the SHARED parse/build helpers (parsePricingFile / buildPricingItems) so
  // carve-out % survives, and through pricingNeedsManualMapping so unrecognized
  // category columns also open the mapper. Because the contract doesn't exist
  // yet, the realign step (PricingCategoryRemapDialog) only CAPTURES the chosen
  // map; the actual import is deferred to runPostCreateSideEffects.
  const handlePricingUpload = useCallback(async (file: File) => {
    let parsed
    try {
      parsed = await parsePricingFile(file)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read the pricing file. Please check the format.",
      )
      return
    }

    // Incomplete auto-mapping (missing required columns, or an unrecognized
    // category column) → open the column mapper. `needsManualMapping` is the
    // shared result that also catches stray category headers.
    if (parsed.needsManualMapping) {
      setPricingRawHeaders(parsed.rawHeaders)
      setPricingRawRows(parsed.rawRows)
      setPricingAutoMapping(parsed.autoMapping)
      setPricingFileRef(file)
      setPricingMapperOpen(true)
      return
    }

    if (parsed.items.length === 0) {
      toast.error("No valid pricing items found. Check your file has columns like vendor_item_no and contract_price.")
      return
    }

    await stageItemsWithRemapStep(parsed.items, file.name)
    // stageItemsWithRemapStep/finalizePricingImport read these via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, liveCategories, queryClient])

  /**
   * Pre-import realign capture. When the parsed items carry detected
   * categories, open the realign dialog so the user can match them to the
   * canonical set; the chosen map is captured into state and applied during
   * the deferred post-create import. When no categories are detected, finalize
   * straight through (unchanged, no friction).
   */
  async function stageItemsWithRemapStep(
    items: ContractPricingItem[],
    fileName: string,
  ) {
    const categories = Array.from(
      new Set(
        items
          .map((i) => i.category?.trim())
          .filter((c): c is string => !!c),
      ),
    )
    if (categories.length === 0) {
      setPricingCategoryRemap(undefined)
      await finalizePricingImport(items, fileName)
      return
    }
    setPendingPricingItems(items)
    setPendingPricingCategories(categories)
    setPendingPricingFileName(fileName)
    setPricingRemapOpen(true)
  }

  /** Realign dialog applied — capture the map, then finalize the staged items. */
  async function handlePricingRemapApply(remap: Record<string, string>) {
    setPricingRemapOpen(false)
    setPricingCategoryRemap(Object.keys(remap).length > 0 ? remap : undefined)
    await finalizePricingImport(
      pendingPricingItems,
      pendingPricingFileName ?? "pricing-file",
      remap,
    )
    setPendingPricingItems([])
    setPendingPricingCategories([])
    setPendingPricingFileName(null)
  }

  /** Shared finalization: set state, compute totals, auto-create categories, show toast */
  async function finalizePricingImport(
    items: ContractPricingItem[],
    fileName: string,
    // bugs.rtfd 2026-06-13 (Realign Categories screenshot): the realign step
    // collapses detected names into canonical targets (e.g. "Extremities &
    // Trauma" → "Ortho-Extremity"). The deferred DB import already applies
    // this remap, but the in-memory category list that drives the TERM
    // PICKER and auto-select must reflect the SAME remap — otherwise the
    // picker offers the raw pre-remap name the user just collapsed away.
    // `setPricingCategoryRemap` is async (stale in this closure), so the
    // remap is passed in explicitly from handlePricingRemapApply.
    remap: Record<string, string> = {},
  ) {
    const cats = Array.from(
      new Set(
        items
          .map((i) => applyCategoryRemap(i.category, remap))
          .filter((c): c is string => !!c),
      ),
    )
    setPricingCategories(cats)

    // Auto-create categories that don't exist yet
    const existingNames = new Set(liveCategories.map((c) => c.name.toLowerCase()))
    let createdCount = 0
    for (const cat of cats) {
      if (!existingNames.has(cat.toLowerCase())) {
        try {
          await createCategory({ name: cat })
          createdCount++
        } catch {
          // Category may already exist — ignore
        }
      }
    }
    // Invalidate React Query cache so the Category dropdown picks up new entries
    if (createdCount > 0) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all })
    }
    // bugs.rtfd 2026-06-13: a price-file import adds to the mapped universe —
    // refetch it so the term picker reflects the new categories immediately.
    await queryClient.invalidateQueries({
      queryKey: queryKeys.categories.mappedUniverse,
    })

    // Auto-select all pricing categories in the form
    if (cats.length > 0) {
      const refreshedCats = queryClient.getQueryData<{ id: string; name: string }[]>(queryKeys.categories.all)
      const catList = refreshedCats ?? liveCategories
      const matchedIds = cats
        .map((cat) => catList.find((c) => c.name.toLowerCase() === cat.toLowerCase())?.id)
        .filter((id): id is string => !!id)
      if (matchedIds.length > 0) {
        const existing = form.getValues("categoryIds") ?? []
        const merged = Array.from(new Set([...existing, ...matchedIds]))
        form.setValue("categoryIds", merged)
        form.setValue("productCategoryId", merged[0])
      }
    }

    // Calculate projected total by matching pricing items against COG data.
    // For each pricing item, find historical COG quantity and multiply by
    // the proposed price — this gives a realistic projected spend.
    const vendorId = form.getValues("vendorId")
    if (vendorId && (!form.getValues("totalValue") || form.getValues("totalValue") === 0)) {
      try {
        const cogTotal = await computePricingVsCOG(vendorId, items)
        if (cogTotal > 0) {
          form.setValue("totalValue", Math.round(cogTotal * 100) / 100)
          const eff = form.getValues("effectiveDate")
          const exp = form.getValues("expirationDate")
          if (eff && exp) {
            const years = computeContractYears(eff, exp)
            form.setValue("annualValue", Math.round((cogTotal / years) * 100) / 100)
          }
        }
      } catch {
        // COG lookup failed — leave total empty for manual entry
      }
    }

    setPricingItems(items)
    setPricingFileName(fileName)
    toast.success(`Loaded ${items.length} pricing items from ${fileName}${cats.length > 0 ? ` (${cats.length} categories detected)` : ""}`)
  }

  /** Called when user applies mapping from the column mapper dialog */
  async function handleMappingApply(mapping: Record<string, string>) {
    setPricingMapperOpen(false)

    // Reconstruct dataRows (string[][]) from the stored record rows
    const dataRows = pricingRawRows.map((row) =>
      pricingRawHeaders.map((h) => row[h] ?? "")
    )

    // Shared builder — includes carveOutPercent.
    const items = buildPricingItems(dataRows, pricingRawHeaders, mapping)

    if (items.length === 0) {
      toast.error("No valid pricing items found with the selected mapping.")
      return
    }

    await stageItemsWithRemapStep(items, pricingFileRef?.name ?? "pricing-file")
  }

  async function handleAIExtract(data: ExtractedContractData, s3Key?: string, fileName?: string, aiPricingItems?: ContractPricingItem[], aiPricingCategories?: string[]) {
    if (s3Key) setContractS3Key(s3Key)
    if (fileName) setContractFileName(fileName)
    setExtractionComplete(true)

    form.setValue("name", data.contractName)
    if (data.contractNumber) form.setValue("contractNumber", data.contractNumber)
    form.setValue("contractType", data.contractType)
    // Null-safe: the AI extractor now returns null for evergreen
    // contracts (expirationDate) and for undated fields (effectiveDate).
    // Store "" in the form so the date <input> renders empty; the server
    // action (lib/actions/contracts.ts) converts "" back to null.
    form.setValue("effectiveDate", data.effectiveDate ?? "")
    form.setValue("expirationDate", data.expirationDate ?? "")
    // Bug 8 (Charles 2026-06-20: "the AI still making one part correctly as
    // annual and the first part still monthly"). The contract-level
    // "Performance & Rebate Pay Period". The model reliably captures the
    // per-TERM Evaluation Period (e.g. "annual") but frequently leaves the
    // top-level `rebatePayPeriod` null — so the form fell back to its monthly
    // default even though the term clearly said annual. Derive the pay period
    // from the terms' evaluationPeriod / paymentTiming when the top-level
    // field is absent. The dates card keeps performancePeriod +
    // rebatePayPeriod in lockstep, so set BOTH.
    const payPeriod = deriveRebatePayPeriod(data.rebatePayPeriod, data.terms)
    if (payPeriod) {
      form.setValue("performancePeriod", payPeriod)
      form.setValue("rebatePayPeriod", payPeriod)
    }
    if (data.totalValue) {
      form.setValue("totalValue", data.totalValue)
      // Auto-compute annual value via calendar-month math so whole-year
      // contracts produce clean integer divisions (not 0.999 or 2.902).
      const years = computeContractYears(data.effectiveDate, data.expirationDate)
      form.setValue("annualValue", Math.round((data.totalValue / years) * 100) / 100)
    }
    if (data.description) form.setValue("description", data.description)

    // Bug #8 / "No capital coming up" (Vick 2026-06-16): a tie_in / capital
    // contract BY DEFINITION finances equipment, so the Capital / Leased
    // Items editor must never land empty after extraction — an empty editor
    // also BLOCKS save (the submit gate below requires >=1 capital item).
    // The AI reliably classifies the type (contractType="tie_in") but
    // sometimes misses the explicit capitalCost line (returns undefined)
    // while still extracting totalValue / term / cadence — when that
    // happened, the old `capitalCost > 0` gate seeded NOTHING and capital
    // "stopped coming up." Seed for ANY tie_in / capital, using the best
    // available amount as the financed total (capitalCost → totalValue →
    // annualValue), so the row is present and prefilled for the user to
    // correct rather than an empty, un-saveable editor.
    if (data.contractType === "tie_in" || data.contractType === "capital") {
      // Replace the editor's contents with the AI-seeded item rather than
      // appending — extraction runs once at the top of the form, before the
      // user has touched the editor. Built via the shared helper so this and
      // the manual-type-change safety net below can never drift.
      setCapitalItems([
        buildSeededCapitalLineItem({
          financedTotal: resolveSeededFinancedTotal({
            capitalCost: data.capitalCost,
            totalValue: data.totalValue,
            fallback: form.getValues("annualValue"),
          }),
          description: data.description,
          contractName: data.contractName,
          downPayment: data.downPayment,
          interestRatePercent: data.interestRatePercent,
          termMonths: data.termMonths,
          paymentCadence: data.paymentCadence,
        }),
      ])
    }

    // 2026-06-08 (Charles "when using AI assist to add a contract categories
    // do not add here"): do NOT auto-fill the Categories field from the AI
    // PDF extraction. Contract categories are user-selected or COG/pricing-
    // derived (see contract-form.tsx "Calculated from COG + pricing files"),
    // not lifted from the contract PDF. The AI still extracts
    // `productCategories` for confidence/merger, but it must not write into
    // the form here. The pricing-file import path (finalizePricingImport)
    // still populates categories from the uploaded spreadsheet.

    // Try to match vendor by name, auto-create if not found
    const matchedId = matchOrCreateVendorId(data.vendorName ?? "", vendors)
    if (matchedId) {
      form.setValue("vendorId", matchedId)
    } else if (data.vendorName?.trim()) {
      try {
        const newVendor = await createVendor({
          name: data.vendorName,
          displayName: data.vendorName,
          tier: "standard",
        })
        form.setValue("vendorId", newVendor.id)
        toast.success(`Vendor "${data.vendorName}" added to vendor list`)
        router.refresh()
      } catch {
        toast.warning(`Could not auto-create vendor "${data.vendorName}" — please pick one`)
      }
    }

    // Map term types from AI extraction. Keep this in sync with the
    // TermType enum in prisma/schema.prisma — every value the schema
    // accepts must round-trip here.
    const mapTermType = (t: string): TermFormValues["termType"] => {
      const typeMap: Record<string, TermFormValues["termType"]> = {
        spend_rebate: "spend_rebate",
        volume_rebate: "volume_rebate",
        price_reduction: "price_reduction",
        market_share: "market_share",
        market_share_price_reduction: "market_share_price_reduction",
        capitated_price_reduction: "capitated_price_reduction",
        capitated_pricing_rebate: "capitated_pricing_rebate",
        // Legacy growth_rebate folds into spend_rebate (growth is now
        // expressed via growthOnly on the term, set elsewhere in this
        // mapper or by the Baseline Calculation Method picker).
        growth_rebate: "spend_rebate",
        compliance_rebate: "compliance_rebate",
        fixed_fee: "fixed_fee",
        locked_pricing: "locked_pricing",
        rebate_per_use: "rebate_per_use",
        po_rebate: "po_rebate",
        carve_out: "carve_out",
        payment_rebate: "payment_rebate",
      }
      const normalized = t.toLowerCase().replace(/[\s-]/g, "_")
      return typeMap[normalized] ?? "spend_rebate"
    }

    const mapBaselineType = (t: string): TermFormValues["baselineType"] => {
      if (t.toLowerCase().includes("volume") || t.toLowerCase().includes("unit")) return "volume_based"
      if (t.toLowerCase().includes("growth")) return "growth_based"
      return "spend_based"
    }

    // Populate terms if extracted — preserve AI-detected types.
    // Defensive (vendor-crash class, 2026-06-10): degenerate extractions can
    // arrive without terms/tiers arrays — guard so the page doesn't crash.
    const extractedTerms = data.terms ?? []
    setAiTermCount(extractedTerms.length)
    if (extractedTerms.length > 0) {
      setTerms(
        extractedTerms.map((t) => {
          const termType = mapTermType(t.termType)
          const baselineType = mapBaselineType(t.termType)
          // Normalize AI-extracted rebate values (Charles R5.25). AI
          // models frequently return "3" for 3%; the DB wants 0.03.
          // Normalize at ingest so downstream math + display are both
          // correct.
          // 2026-04-28: derive spendMax inline from next tier's spendMin
          // (-1). The AI Zod schema dropped spendMax to fit Anthropic's
          // 24-optional-param limit; the toLegacyExtractedContract mapper
          // does this derivation but is only used by tests, not the live
          // ai-extract path. Top tier stays undefined (open-ended).
          // Charles 2026-04-28 — Spend Max column was empty in the form
          // after the c555730 "fix" because that fix only updated the
          // dead-code mapper.
          const sortedTiers = [...(t.tiers ?? [])].sort(
            (a, b) => (a.tierNumber ?? 0) - (b.tierNumber ?? 0),
          )
          // Bug #6 / Bug #8: count- and threshold-based termTypes can't
          // accept percent_of_spend tiers — the engine reads rebateValue as
          // dollars per period / per occurrence, so a fractional 0.05 from
          // a "5%" extraction becomes $0.05 instead of $5,000. Map the AI
          // output to the right rebateType for the termType:
          //   - volume_rebate, rebate_per_use, capitated_pricing_rebate
          //     → per_procedure_rebate (per-occurrence dollar amount)
          //   - market_share, compliance_rebate, fixed_fee, payment_rebate,
          //     po_rebate → fixed_rebate (flat per-period dollar amount)
          //   - everything else (spend_rebate, growth_rebate, …) keeps
          //     percent_of_spend.
          const PER_OCCURRENCE_TYPES = new Set([
            "volume_rebate",
            "rebate_per_use",
            "capitated_pricing_rebate",
          ])
          const FLAT_PERIOD_TYPES = new Set([
            "market_share",
            "compliance_rebate",
            "fixed_fee",
            "payment_rebate",
            "po_rebate",
          ])
          const tierRebateType: TierInput["rebateType"] =
            PER_OCCURRENCE_TYPES.has(termType)
              ? "per_procedure_rebate"
              : FLAT_PERIOD_TYPES.has(termType)
                ? "fixed_rebate"
                : "percent_of_spend"
          const normalizedTiers = sortedTiers.map((tier, idx) => {
            const next = sortedTiers[idx + 1]
            const derivedSpendMax =
              next?.spendMin != null ? next.spendMin - 1 : undefined
            return {
              tierNumber: tier.tierNumber,
              spendMin: tier.spendMin ?? 0,
              spendMax: derivedSpendMax,
              rebateType: tierRebateType,
              rebateValue: normalizeAIRebateValue(
                tierRebateType,
                tier.rebateValue,
              ),
            }
          })
          // Generate smart term name from the denormalized display
          // value so the label reads "(3%)" not "(0.03%)".
          const displayRebates = normalizedTiers.map((tr) =>
            toDisplayRebateValue(tr.rebateType, tr.rebateValue),
          )
          const minRebate = displayRebates.length > 0 ? Math.min(...displayRebates) : 0
          const maxRebate = displayRebates.length > 0 ? Math.max(...displayRebates) : 0
          const smartName = t.termName || (
            minRebate !== maxRebate
              ? `${termType.replace(/_/g, " ")} (${minRebate}%-${maxRebate}%)`
              : `${termType.replace(/_/g, " ")} (${maxRebate}%)`
          )
          return {
            termName: smartName,
            termType,
            baselineType,
            evaluationPeriod: "annual" as const,
            paymentTiming: "quarterly" as const,
            appliesTo: "all_products" as const,
            rebateMethod: "cumulative" as const,
            effectiveStart: data.effectiveDate ?? "",
            effectiveEnd: data.expirationDate ?? "",
            tiers: normalizedTiers,
          }
        })
      )
    }

    // If pricing items were provided from the AI review step, stage them
    // through the realign step (same shared path as the Upload-PDF tab) so a
    // detected→canonical category map is captured for the deferred import.
    if (aiPricingItems && aiPricingItems.length > 0) {
      await stageItemsWithRemapStep(aiPricingItems, "pricing-file")
      if (aiPricingCategories) setPricingCategories(aiPricingCategories)
      toast.success(`Contract data extracted with ${aiPricingItems.length} pricing items`)
    } else {
      toast.success("Contract data extracted — review the form below and submit")
    }
  }

  async function handleSubmit() {
    // Charles W1.W-E1 — client-side double-submit guard. The button is
    // already `disabled={createMutation.isPending || finalizing}` but we
    // also no-op here so a programmatic double-invocation (e.g.
    // Enter-key + click) can't race through. `finalizing` covers the
    // post-create side-effect window (bugs.rtfd 2026-06-11 B1).
    if (createMutation.isPending || finalizing) return

    const isValid = await form.trigger()
    if (!isValid) {
      toast.error("Please fix the form errors")
      return
    }

    // Bug #10: a tie-in contract by definition pairs financed capital
    // equipment with usage / rebate terms. Submitting a tie-in with no
    // capital line items leaves the amortization schedule empty (no
    // contractTotal, rate, term to compute against) and the rebate-applied
    // math has nothing to retire. Block the submit and tell the user
    // exactly what to add. Same gate applies to contractType="capital".
    if (
      (form.getValues("contractType") === "tie_in" ||
        form.getValues("contractType") === "capital") &&
      capitalItems.length === 0
    ) {
      toast.error(
        "Add at least one Capital / Leased Item before saving a tie-in or capital contract.",
      )
      return
    }

    // Bug 7 guardrail: if the AI originally extracted more terms than
    // what's about to be submitted, ask the user to confirm. Common
    // failure mode: user clicked a trash icon mid-review and didn't
    // realize the term was gone by submit time.
    if (aiTermCount !== null && terms.length < aiTermCount) {
      const missing = aiTermCount - terms.length
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `You're about to create this contract with ${terms.length} term(s), but the AI extractor found ${aiTermCount}. ${missing} term${missing === 1 ? " was" : "s were"} removed during review. Continue?`,
        )
      ) {
        return
      }
    }

    // Primary "Create Contract" path: the form's default status is "draft"
    // (see useContractForm), which excludes the contract from
    // recomputeMatchStatusesForVendor and leaves every COG row as
    // off_contract_item. The symmetric "Save as Draft" button explicitly
    // sets "draft"; the main CTA must explicitly set "active" so the two
    // buttons have aligned semantics.
    form.setValue("status", "active")

    const values = form.getValues()
    // Charles W1.W-D3 + W1.W-E1 — include tie-in capital fields alongside
    // the idempotency key. createContract reads all six off `data` and
    // writes them to the Contract row; non-tie-in contracts leave
    // capital null.
    const contract = await createMutation.mutateAsync({
      ...values,
      idempotencyKey: idempotencyKeyRef.current,
      // Charles — terms now persist inside createContract in one action.
      // Sending them in the payload eliminates the previous race where a
      // client-side for-loop calling createContractTerm after the contract
      // was created could leave terms missing on tie-in saves.
      terms,
    })

    // Charles 2026-04-24 (Bug 5): these post-create side effects previously
    // threw into the outer async handler with no catch, producing an
    // unhandled rejection / generic red toast that made users think the
    // contract itself failed. The contract IS saved at this point — surface
    // the real failure reason without hiding the successful create, and
    // always navigate so the user lands on their new contract.
    // bugs.rtfd 2026-06-11 B1: keep the action bar disabled while the
    // pricing import (up to 120s) runs — navigation order is unchanged.
    setFinalizing(true)
    try {
      await runPostCreateSideEffects(contract.id)
    } finally {
      setFinalizing(false)
    }

    router.push(`/dashboard/contracts/${contract.id}`)
  }

  async function runPostCreateSideEffects(contractId: string) {
    // Charles audit suggestion #4 (v0-port): persist capital line items
    // on the freshly-created contract.
    //
    // Vick 2026-05-31: these post-create side effects use the *Safe
    // (error-as-value) action variants. Next.js 16 redacts any error
    // THROWN from a Server Action in production builds to the generic
    // "An error occurred in the Server Components render" digest, so the
    // old try/catch + err.message toast could only ever show that
    // boilerplate. The Safe variants return the real reason as a value.
    for (const it of capitalItems) {
      const res = await createCapitalLineItemSafe(contractId, {
        description: it.description,
        itemNumber: it.itemNumber || null,
        serialNumber: it.serialNumber || null,
        contractTotal: it.contractTotal,
        initialSales: it.initialSales,
        interestRate: Math.min(1, Math.max(0, it.interestRatePercent / 100)),
        termMonths: it.termMonths,
        paymentType: it.paymentType,
        paymentCadence: it.paymentCadence,
      })
      if (!res.ok) {
        toast.error(`Contract saved, but a capital line item failed to persist: ${res.error}`)
      }
    }
    if (pricingItems.length > 0) {
      // Charles 2026-06-06: pass the realign map captured at upload time so
      // the deferred import applies it ahead of canonicalization (parity with
      // the contract-detail Pricing tab's importWithRemapStep).
      //
      // Feature 5 (2026-06-13): chunk at 2000 rows so each transaction stays
      // well under the 120s budget on big catalogs (SYK/DePuy 15k+ files).
      //   chunk 0      → mode "replace", skipPostProcessing (wipe priors once)
      //   middle chunks→ mode "append",  skipPostProcessing (accumulate)
      //   final chunk  → mode "append",  run post-processing once on the full
      //                  row set (carve-out auto-create + recompute)
      // The realign map is forwarded on the FINAL chunk only — that's the call
      // that persists the confirmed remap (post-processing). Progress feeds the
      // busy label "Importing pricing… N%". B1 finalizing gate is unchanged —
      // this all runs inside the existing setFinalizing(true) window.
      const PRICING_CHUNK_SIZE = 2000
      const total = pricingItems.length
      const chunkCount = Math.ceil(total / PRICING_CHUNK_SIZE)
      setPricingPercent(0)
      let pricingFailed = false
      for (let index = 0; index < chunkCount && !pricingFailed; index++) {
        const isFirst = index === 0
        const isLast = index === chunkCount - 1
        const chunk = pricingItems.slice(
          index * PRICING_CHUNK_SIZE,
          index * PRICING_CHUNK_SIZE + PRICING_CHUNK_SIZE,
        )
        const res = await importContractPricingSafe({
          contractId,
          items: chunk,
          // The realign map must canonicalize categories on EVERY chunk's
          // rows (not just the last), so forward it on all chunks. It's only
          // PERSISTED once, in the final chunk's post-processing
          // (persistConfirmedCategoryRemap runs only when skipPostProcessing
          // is false) — so middle chunks apply it without re-persisting.
          categoryRemap: pricingCategoryRemap,
          mode: isFirst ? "replace" : "append",
          skipPostProcessing: !isLast,
        })
        if (!res.ok) {
          pricingFailed = true
          toast.error(
            `Contract saved, but pricing import failed after ${(
              index * PRICING_CHUNK_SIZE
            ).toLocaleString()} of ${total.toLocaleString()} rows: ${res.error}`,
          )
          break
        }
        const done = Math.min(total, (index + 1) * PRICING_CHUNK_SIZE)
        setPricingPercent(Math.round((done / total) * 100))
      }
      setPricingPercent(null)
    }
    if (contractS3Key) {
      const res = await createContractDocumentSafe({
        contractId,
        name: contractFileName ?? "Contract PDF",
        type: "main",
        url: contractS3Key,
      })
      if (!res.ok) {
        toast.error(`Contract saved, but PDF attachment failed: ${res.error}`)
      }
    }
    for (const doc of additionalDocs) {
      const res = await createContractDocumentSafe({
        contractId,
        name: doc.name,
        type: doc.type,
      })
      if (!res.ok) {
        toast.error(`Contract saved, but attachment "${doc.name}" failed: ${res.error}`)
      }
    }
  }

  async function handleSaveAsDraft() {
    // Charles W1.W-E1 — same guard as handleSubmit (incl. the B1
    // finalizing window, bugs.rtfd 2026-06-11).
    if (createMutation.isPending || finalizing) return

    // Set status to draft regardless of validation
    form.setValue("status", "draft")

    const values = form.getValues()
    // Only require a name for draft
    if (!values.name) {
      toast.error("Please enter a contract name")
      return
    }

    const contract = await createMutation.mutateAsync({
      ...values,
      idempotencyKey: idempotencyKeyRef.current,
      terms,
    })

    // bugs.rtfd 2026-06-11 B1 — same finalizing gate as handleSubmit.
    setFinalizing(true)
    try {
      await runPostCreateSideEffects(contract.id)
    } finally {
      setFinalizing(false)
    }

    router.push(`/dashboard/contracts/${contract.id}`)
  }

  return (
    <>
      <div className="flex flex-col gap-6 pb-28">
        {/* Page header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/contracts">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance">New Contract</h1>
            <p className="text-sm text-muted-foreground">
              Upload a PDF for AI extraction, or fill the form manually.
            </p>
          </div>
        </div>

        <AIExtractDialog
          open={aiExtractOpen}
          onOpenChange={(o) => {
            setAiExtractOpen(o)
            if (!o) setDroppedFile(null)
          }}
          onExtracted={handleAIExtract}
          initialFile={droppedFile}
        />

        <PricingColumnMapper
          open={pricingMapperOpen}
          onOpenChange={setPricingMapperOpen}
          headers={pricingRawHeaders}
          sampleRows={pricingRawRows}
          autoMapping={pricingAutoMapping}
          onApply={handleMappingApply}
        />

        {/* Charles 2026-06-06: pre-import category realign. Captures the
            detected→canonical map for the deferred post-create import; if the
            user cancels, the staged items are dropped (no import). */}
        <PricingCategoryRemapDialog
          open={pricingRemapOpen}
          onOpenChange={(o) => {
            setPricingRemapOpen(o)
            if (!o) {
              // Cancelled the realign step — drop the staged items.
              setPendingPricingItems([])
              setPendingPricingCategories([])
              setPendingPricingFileName(null)
            }
          }}
          detectedCategories={pendingPricingCategories}
          onApply={handlePricingRemapApply}
        />

        {/* 3-tab entry mode (AI Assistant / Upload PDF / Manual Entry) —
            mirrors v0's facility + vendor design and the vendor-side
            VendorContractSubmission. Form state is shared across tabs;
            switching to AI or PDF pre-fills the same form. The PDF tab
            owns Additional Documents + Pricing File uploads. */}
        <EntryModeTabs
          entryMode={entryMode}
          onEntryModeChange={setEntryMode}
          contractFile={contractFile}
          extractionComplete={extractionComplete}
          onPDFUpload={(file) => {
            setContractFile(file)
            setExtractionComplete(false)
            setDroppedFile(file)
            setAiExtractOpen(true)
          }}
          onClearPDF={() => {
            setContractFile(null)
            setExtractionComplete(false)
            setDroppedFile(null)
            setContractFileName(null)
            setContractS3Key(null)
          }}
          onAIExtracted={(data, s3Key, fileName) =>
            void handleAIExtract(data, s3Key, fileName)
          }
          additionalDocs={additionalDocs}
          onAddDoc={(file, type) =>
            setAdditionalDocs((prev) => [...prev, { file, type, name: file.name }])
          }
          onRemoveDoc={(i) =>
            setAdditionalDocs((prev) => prev.filter((_, idx) => idx !== i))
          }
          onChangeDocType={(i, type) =>
            setAdditionalDocs((prev) =>
              prev.map((d, idx) => (idx === i ? { ...d, type } : d)),
            )
          }
          pricingFileName={pricingFileName}
          pricingItemCount={pricingItems.length}
          onPricingUpload={(file) => void handlePricingUpload(file)}
          onClearPricing={() => {
            setPricingItems([])
            setPricingFileName(null)
          }}
        />

        {/* Contract Details form */}
        <ContractFormBasicInfo
          form={form}
          vendors={vendors}
          categories={liveCategories}
          onCreateCategory={async (name) => {
            const created = await createCategory({ name })
            await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all })
            toast.success(`Created category "${created.name}"`)
            return { id: created.id, name: created.name }
          }}
        />

        {/* Tie-in capital contract picker */}
        {/* Charles audit suggestion #4 (v0-port): per-asset capital
            line items. v0's tie-in supports multi-equipment financing
            (e.g. MRI + service warranty); each item gets its own
            description / item # / serial / contract total / down /
            rate / term / payment type / cadence. The legacy "Tied to
            Capital Contract" picker has been retired — capital is the
            line-items table below, not a foreign-key to a separate
            capital contract. */}
        {/* 2026-06-15: render for capital AND tie_in — the AI-seed (line
            395) and persist (line 610) gates already cover both, but the
            editor was tie_in-only, so a `capital`-type contract hid its
            Capital/Leased Items and you couldn't add items (Vick "capital
            items not adding still"). Matches the vendor-submission gate. */}
        {(form.watch("contractType") === "tie_in" ||
          form.watch("contractType") === "capital") && (
          <CapitalLineItemsEditor
            items={capitalItems}
            onChange={setCapitalItems}
          />
        )}

        {/* Contract Terms */}
        {form.watch("contractType") !== "pricing_only" && (
          <Card>
            <CardHeader>
              <CardTitle>Contract Terms</CardTitle>
              <CardDescription>
                Define rebate tiers, pricing terms, market share
                commitments, carve-outs, and other contract conditions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContractTermsEntry
                terms={terms}
                onChange={setTerms}
                contractType={form.watch("contractType")}
                availableItems={pricingItems.map((p) => ({
                  vendorItemNo: p.vendorItemNo,
                  description: p.description ?? null,
                }))}
                // bugs.rtfd 2026-06-13 ("cog and pricing file mapped
                // categories should be the only ones displayed"): the term
                // picker offers the mapped-category universe (confirmed
                // CategoryMapping targets ∪ this facility's price-file
                // categories) unioned with the price file being uploaded right
                // now (pricingCategories, not yet persisted). See
                // selectScopeableCategories.
                availableCategories={selectScopeableCategories(
                  liveCategories,
                  [...liveMappedCategories, ...pricingCategories],
                  form.watch("categoryIds") ?? [],
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* Review Summary */}
        <ContractFormReview
          values={form.getValues()}
          terms={terms}
          vendors={vendors}
          categories={liveCategories}
        />

      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <Button variant="ghost" asChild>
            <Link href="/dashboard/contracts">Cancel</Link>
          </Button>
          <Button
            variant="outline"
            onClick={handleSaveAsDraft}
            disabled={createMutation.isPending || finalizing}
          >
            Save as Draft
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || finalizing}
            className="relative min-w-40"
          >
            {/* Both labels are ALWAYS in the DOM at the same position;
                only one is visible via `invisible`. This prevents any
                reconciliation/transition window from painting both
                labels at once (the earlier bug where "Creating..." and
                "Create Contract" overlapped). The busy state also covers
                `finalizing` — the post-create side-effect window
                (bugs.rtfd 2026-06-11 B1). */}
            <span
              className={
                createMutation.isPending || finalizing
                  ? "invisible"
                  : "inline-flex items-center gap-2"
              }
              aria-hidden={createMutation.isPending || finalizing || undefined}
            >
              <Save className="h-4 w-4" />
              Create Contract
            </span>
            {createMutation.isPending || finalizing ? (
              <span className="absolute inset-0 inline-flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {finalizing
                  ? pricingPercent !== null
                    ? `Importing pricing… ${pricingPercent}%`
                    : "Importing pricing…"
                  : "Creating..."}
              </span>
            ) : null}
          </Button>
        </div>
      </div>
    </>
  )
}
