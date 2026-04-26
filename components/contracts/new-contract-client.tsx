"use client"

import { useState, useCallback, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  Save,
  FileText,
  Upload,
  CheckCircle2,
  X,
  Plus,
  Paperclip,
} from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractDocument } from "@/lib/actions/contracts"
import { importContractPricing, type ContractPricingItem } from "@/lib/actions/pricing-files"
import { parsePricingFile, detectPricingColumnMapping } from "@/lib/utils/parse-pricing-file"
import { createCategory, getCategories } from "@/lib/actions/categories"
import { computePricingVsCOG } from "@/lib/actions/cog-records"
import { deriveContractTotalFromCOG } from "@/lib/actions/contracts/derive-from-cog"
import { useAutoFillWhenPristine } from "@/hooks/use-auto-fill-when-pristine"
import { queryKeys } from "@/lib/query-keys"
import { createVendor } from "@/lib/actions/vendors"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import { normalizeAIRebateValue, toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { computeContractYears } from "@/lib/contracts/term-years"
import { PricingColumnMapper } from "@/components/contracts/pricing-column-mapper"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractFormReview } from "@/components/contracts/contract-form-review"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { ContractPdfDropZone } from "@/components/contracts/contract-pdf-drop-zone"
import { TieInCapitalPicker } from "@/components/contracts/tie-in-capital-picker"
import {
  CapitalLineItemsEditor,
  type CapitalLineItemDraft,
} from "@/components/contracts/capital-line-items-editor"
import { createCapitalLineItem } from "@/lib/actions/contracts/capital-line-items"
import { matchOrCreateVendorId } from "@/components/contracts/new-contract-helpers"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import type { ExtractedContractData } from "@/lib/ai/schemas"

interface NewContractClientProps {
  vendors: { id: string; name: string; displayName: string | null }[]
  categories: { id: string; name: string }[]
}

export function NewContractClient({
  vendors,
  categories,
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

  const [aiExtractOpen, setAiExtractOpen] = useState(false)
  const [droppedFile, setDroppedFile] = useState<File | null>(null)
  const [pricingItems, setPricingItems] = useState<ContractPricingItem[]>([])
  const [pricingFileName, setPricingFileName] = useState<string | null>(null)
  const [pricingCategories, setPricingCategories] = useState<string[]>([])
  const [pricingMapperOpen, setPricingMapperOpen] = useState(false)
  const [pricingRawHeaders, setPricingRawHeaders] = useState<string[]>([])
  const [pricingRawRows, setPricingRawRows] = useState<Record<string, string>[]>([])
  const [pricingAutoMapping, setPricingAutoMapping] = useState<Record<string, string>>({})
  const [pricingFileRef, setPricingFileRef] = useState<File | null>(null)
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
  // Bug 7 guardrail: remember how many terms AI populated so submit can
  // warn if the user ended up with fewer than that (accidental delete,
  // or reviewed-but-dropped). Null = no AI populate happened.
  const [aiTermCount, setAiTermCount] = useState<number | null>(null)

  // Charles audit suggestion #4 (v0-port): per-asset capital line items.
  // Persisted via createCapitalLineItem after the contract is created.
  const [capitalItems, setCapitalItems] = useState<CapitalLineItemDraft[]>([])

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

  const handlePricingUpload = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!["csv", "xlsx", "xls"].includes(ext ?? "")) {
      toast.error("Please upload a CSV or Excel (.xlsx/.xls) pricing file")
      return
    }

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

    let rawHeaders: string[] = []
    let dataRows: string[][] = []

    try {
      if (ext === "xlsx" || ext === "xls") {
        // Send Excel files to server-side parser
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch("/api/parse-file", {
          method: "POST",
          body: formData,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          toast.error((body as { error?: string } | null)?.error ?? "Failed to parse Excel file")
          return
        }
        const parsed = (await res.json()) as { headers: string[]; rows: Record<string, string>[] }
        rawHeaders = parsed.headers
        dataRows = parsed.rows.map((row) => rawHeaders.map((h) => row[h] ?? ""))
      } else {
        // CSV: parse client-side using shared parser
        const result = await parsePricingFile(file)
        rawHeaders = result.rawHeaders
        dataRows = result.rawRows.map((row) => rawHeaders.map((h) => row[h] ?? ""))
      }
    } catch {
      toast.error("Failed to read the file. Please check the format.")
      return
    }

    const normHeaders = rawHeaders.map(norm)

    const find = (...aliases: string[]) =>
      aliases.map(norm).reduce<number>(
        (found, a) => (found >= 0 ? found : normHeaders.indexOf(a)),
        -1,
      )

    const idxItem = find(
      "vendor_item_no", "vendoritemno", "vendoritem",
      "item_no", "itemno", "sku",
      "part_no", "partnumber", "partno", "catalog_no",
      "itemnumber", "item", "itemid", "itemcode",
      "stockno", "stocknumber", "materialid", "materialnumber",
      "productid", "productcode", "vendorpart", "vendorcatalog",
      "catalogno", "catalognumber", "referenceno", "refno", "refnumber",
      "referencenumber", "reference",
      "vendor_item_number", "vendoritemnumber", "item_number",
      "productno", "productnumber", "productref", "productrefnumber",
    )
    const idxDesc = find(
      "description", "desc", "product_description", "productdescription", "item_description",
      "productdesc", "itemname", "materialname", "materialdesc",
      "fulldescription",
    )
    const idxPrice = find(
      "contract_price", "contractprice", "unit_price", "unitprice", "price", "cost",
      "netprice", "yourprice", "discountprice", "discountedprice",
      "negotiatedprice", "agreementprice", "contractcost", "netcost",
      "sellprice", "sellingprice", "customerprice",
    )
    const idxList = find(
      "list_price", "listprice", "msrp", "retail_price",
      "catalogprice", "regularprice", "standardprice",
      "fullprice", "originalprice",
    )
    const idxCat = find(
      "category", "product_category", "department",
      "productcategory", "productcatgory",
      "productline", "productgroup", "producttype",
      "segment", "classification", "dept", "division",
    )
    const idxUom = find(
      "uom", "unit_of_measure", "unit",
      "unitofmeasure", "packsize", "packaging", "pkg", "measure",
    )

    // Build auto-mapping from detected indices
    const autoMap: Record<string, string> = {}
    if (idxItem >= 0) autoMap.vendorItemNo = rawHeaders[idxItem]
    if (idxDesc >= 0) autoMap.description = rawHeaders[idxDesc]
    if (idxPrice >= 0) autoMap.unitPrice = rawHeaders[idxPrice]
    if (idxList >= 0) autoMap.listPrice = rawHeaders[idxList]
    if (idxCat >= 0) autoMap.category = rawHeaders[idxCat]
    if (idxUom >= 0) autoMap.uom = rawHeaders[idxUom]

    // Build record-style rows for the mapper dialog
    const recordRows = dataRows.map((vals) => {
      const row: Record<string, string> = {}
      rawHeaders.forEach((h, i) => { row[h] = vals[i] ?? "" })
      return row
    })

    // If auto-mapping is incomplete (missing vendorItemNo OR unitPrice), open mapper
    if (!autoMap.vendorItemNo || !autoMap.unitPrice) {
      setPricingRawHeaders(rawHeaders)
      setPricingRawRows(recordRows)
      setPricingAutoMapping(autoMap)
      setPricingFileRef(file)
      setPricingMapperOpen(true)
      return
    }

    // Auto-mapping succeeded — build items directly
    const items = buildPricingItems(dataRows, rawHeaders, autoMap)

    if (items.length === 0) {
      toast.error("No valid pricing items found. Check your file has columns like vendor_item_no and contract_price.")
      return
    }

    finalizePricingImport(items, file.name)
  }, [form, liveCategories, queryClient])

  /** Build ContractPricingItem[] from raw data rows using a column mapping */
  function buildPricingItems(
    dataRows: string[][],
    rawHeaders: string[],
    colMapping: Record<string, string>,
  ): ContractPricingItem[] {
    const indexOf = (field: string) => {
      const col = colMapping[field]
      return col ? rawHeaders.indexOf(col) : -1
    }

    const idxItem = indexOf("vendorItemNo")
    const idxDesc = indexOf("description")
    const idxPrice = indexOf("unitPrice")
    const idxList = indexOf("listPrice")
    const idxCat = indexOf("category")
    const idxUom = indexOf("uom")

    return dataRows
      .map((vals) => {
        const g = (idx: number) => (idx >= 0 ? vals[idx] ?? "" : "")
        return {
          vendorItemNo: g(idxItem),
          description: g(idxDesc) || undefined,
          unitPrice: parseFloat(g(idxPrice).replace(/[^0-9.-]/g, "") || "0"),
          listPrice:
            parseFloat(g(idxList).replace(/[^0-9.-]/g, "") || "0") || undefined,
          category: g(idxCat) || undefined,
          uom: g(idxUom) || "EA",
        }
      })
      .filter((i) => i.vendorItemNo)
  }

  /** Shared finalization: set state, compute totals, auto-create categories, show toast */
  async function finalizePricingImport(items: ContractPricingItem[], fileName: string) {
    const cats = Array.from(
      new Set(items.map((i) => i.category).filter((c): c is string => !!c))
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
  function handleMappingApply(mapping: Record<string, string>) {
    setPricingMapperOpen(false)

    // Reconstruct dataRows (string[][]) from the stored record rows
    const dataRows = pricingRawRows.map((row) =>
      pricingRawHeaders.map((h) => row[h] ?? "")
    )

    const items = buildPricingItems(dataRows, pricingRawHeaders, mapping)

    if (items.length === 0) {
      toast.error("No valid pricing items found with the selected mapping.")
      return
    }

    finalizePricingImport(items, pricingFileRef?.name ?? "pricing-file")
  }

  async function handleAIExtract(data: ExtractedContractData, s3Key?: string, fileName?: string, aiPricingItems?: ContractPricingItem[], aiPricingCategories?: string[]) {
    if (s3Key) setContractS3Key(s3Key)
    if (fileName) setContractFileName(fileName)

    form.setValue("name", data.contractName)
    if (data.contractNumber) form.setValue("contractNumber", data.contractNumber)
    form.setValue("contractType", data.contractType)
    // Null-safe: the AI extractor now returns null for evergreen
    // contracts (expirationDate) and for undated fields (effectiveDate).
    // Store "" in the form so the date <input> renders empty; the server
    // action (lib/actions/contracts.ts) converts "" back to null.
    form.setValue("effectiveDate", data.effectiveDate ?? "")
    form.setValue("expirationDate", data.expirationDate ?? "")
    if (data.totalValue) {
      form.setValue("totalValue", data.totalValue)
      // Auto-compute annual value via calendar-month math so whole-year
      // contracts produce clean integer divisions (not 0.999 or 2.902).
      const years = computeContractYears(data.effectiveDate, data.expirationDate)
      form.setValue("annualValue", Math.round((data.totalValue / years) * 100) / 100)
    }
    if (data.description) form.setValue("description", data.description)

    // Merge product categories from the extraction. Prefer the plural
    // `productCategories` (multi-category contracts — Subsystem 9.12)
    // and fall back to the legacy singular `productCategory` when only
    // a primary category is returned. Names are matched case-insensitively
    // against the live category list; unmatched names are skipped here
    // (pricing-file import handles auto-create).
    if (data.productCategories && data.productCategories.length > 0) {
      const matchedIds: string[] = []
      for (const extractedName of data.productCategories) {
        const found = liveCategories.find(
          (c) => c.name.toLowerCase() === extractedName.toLowerCase(),
        )
        if (found) matchedIds.push(found.id)
      }
      if (matchedIds.length > 0) {
        const existing = form.getValues("categoryIds") ?? []
        const merged = Array.from(new Set([...existing, ...matchedIds]))
        form.setValue("categoryIds", merged)
        form.setValue("productCategoryId", merged[0])
      }
    } else if (data.productCategory) {
      // Legacy single-category fallback.
      const found = liveCategories.find(
        (c) => c.name.toLowerCase() === data.productCategory!.toLowerCase(),
      )
      if (found) {
        const existing = form.getValues("categoryIds") ?? []
        const merged = Array.from(new Set([...existing, found.id]))
        form.setValue("categoryIds", merged)
        form.setValue("productCategoryId", merged[0])
      }
    }

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
        growth_rebate: "growth_rebate",
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

    // Populate terms if extracted — preserve AI-detected types
    setAiTermCount(data.terms.length)
    if (data.terms.length > 0) {
      setTerms(
        data.terms.map((t) => {
          const termType = mapTermType(t.termType)
          const baselineType = mapBaselineType(t.termType)
          // Normalize AI-extracted rebate values (Charles R5.25). AI
          // models frequently return "3" for 3%; the DB wants 0.03.
          // Normalize at ingest so downstream math + display are both
          // correct.
          const normalizedTiers = t.tiers.map((tier) => ({
            tierNumber: tier.tierNumber,
            spendMin: tier.spendMin ?? 0,
            // 2026-04-26: AI no longer returns spendMax (Anthropic
            // 24-optional-param limit). The rebate engine derives
            // each tier's ceiling from the next tier's spendMin, so
            // undefined here is equivalent to "open upper bound".
            spendMax: undefined,
            rebateType: "percent_of_spend" as const,
            rebateValue: normalizeAIRebateValue("percent_of_spend", tier.rebateValue),
          }))
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

    // If pricing items were provided from the AI review step, finalize them
    if (aiPricingItems && aiPricingItems.length > 0) {
      await finalizePricingImport(aiPricingItems, "pricing-file")
      if (aiPricingCategories) setPricingCategories(aiPricingCategories)
      toast.success(`Contract data extracted with ${aiPricingItems.length} pricing items`)
    } else {
      toast.success("Contract data extracted — review the form below and submit")
    }
  }

  async function handleSubmit() {
    // Charles W1.W-E1 — client-side double-submit guard. The button is
    // already `disabled={createMutation.isPending}` but we also no-op
    // here so a programmatic double-invocation (e.g. Enter-key + click)
    // can't race through.
    if (createMutation.isPending) return

    const isValid = await form.trigger()
    if (!isValid) {
      toast.error("Please fix the form errors")
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
    await runPostCreateSideEffects(contract.id)

    router.push(`/dashboard/contracts/${contract.id}`)
  }

  async function runPostCreateSideEffects(contractId: string) {
    // Charles audit suggestion #4 (v0-port): persist capital line items
    // on the freshly-created contract.
    for (const it of capitalItems) {
      try {
        await createCapitalLineItem(contractId, {
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
      } catch (err) {
        console.error("[new-contract] createCapitalLineItem failed", err, { contractId })
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Contract saved, but a capital line item failed to persist: ${msg}`)
      }
    }
    if (pricingItems.length > 0) {
      try {
        await importContractPricing({ contractId, items: pricingItems })
      } catch (err) {
        console.error("[new-contract] importContractPricing failed", err, { contractId })
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Contract saved, but pricing import failed: ${msg}`)
      }
    }
    if (contractS3Key) {
      try {
        await createContractDocument({
          contractId,
          name: contractFileName ?? "Contract PDF",
          type: "main",
          url: contractS3Key,
        })
      } catch (err) {
        console.error("[new-contract] createContractDocument (main) failed", err, { contractId })
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Contract saved, but PDF attachment failed: ${msg}`)
      }
    }
    for (const doc of additionalDocs) {
      try {
        await createContractDocument({
          contractId,
          name: doc.name,
          type: doc.type,
        })
      } catch (err) {
        console.error("[new-contract] createContractDocument (additional) failed", err, { contractId, docName: doc.name })
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Contract saved, but attachment "${doc.name}" failed: ${msg}`)
      }
    }
  }

  async function handleSaveAsDraft() {
    // Charles W1.W-E1 — same guard as handleSubmit.
    if (createMutation.isPending) return

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

    await runPostCreateSideEffects(contract.id)

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

        {/* Entry-mode tabs — E2E regression spec
            (facility-contract-with-new-vendor-category-rebate.spec.ts)
            clicks the Manual Entry tab first. Default tab is "manual" so
            procurement teams who aren't uploading a PDF land on the form
            directly. "PDF / AI Extract" tab holds the drop zone. Form
            state is shared — extracting a PDF pre-fills the same form. */}
        <Tabs defaultValue="manual" className="w-full">
          <TabsList>
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            <TabsTrigger value="pdf">PDF / AI Extract</TabsTrigger>
          </TabsList>
          <TabsContent value="pdf" className="mt-4">
            <ContractPdfDropZone
              onFileSelected={(file, kind) => {
                if (kind === "contract") {
                  setDroppedFile(file)
                  setAiExtractOpen(true)
                } else if (kind === "pricing") {
                  void handlePricingUpload(file)
                } else {
                  toast.error(
                    "Unsupported file type. Use PDF / DOCX / TXT for contract documents, or CSV / XLSX / XLS for pricing files.",
                  )
                }
              }}
              extractedFileName={contractFileName}
              onReplace={() => {
                setContractFileName(null)
                setContractS3Key(null)
              }}
            />
          </TabsContent>
          <TabsContent value="manual" className="mt-4 space-y-6">
            <p className="text-sm text-muted-foreground">
              Fill in the form below. Switch to PDF / AI Extract to upload a
              contract PDF and auto-populate these fields.
            </p>
          </TabsContent>
        </Tabs>

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
        {form.watch("contractType") === "tie_in" && (
          <Card>
            <CardHeader>
              <CardTitle>Tied to Capital Contract</CardTitle>
              <CardDescription>
                Pick the capital contract this tie-in pays down with rebates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TieInCapitalPicker
                value={form.watch("tieInCapitalContractId") ?? null}
                onChange={(v) =>
                  form.setValue(
                    "tieInCapitalContractId",
                    v ?? undefined,
                  )
                }
              />
            </CardContent>
          </Card>
        )}

        {/* Charles audit suggestion #4 (v0-port): per-asset capital
            line items. v0's tie-in supports multi-equipment financing
            (e.g. MRI + service warranty); each item gets its own
            description / item # / serial / contract total / down /
            rate / term / payment type / cadence. */}
        {form.watch("contractType") === "tie_in" && (
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
                availableCategories={liveCategories.filter((c) =>
                  (form.watch("categoryIds") ?? []).includes(c.id),
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

        {/* Attachments (optional) — collapsed by default */}
        <Accordion type="single" collapsible>
          <AccordionItem
            value="attachments"
            className="rounded-lg border px-4"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                <span className="font-medium">Attachments (optional)</span>
                {(additionalDocs.length > 0 || pricingItems.length > 0) && (
                  <Badge variant="secondary">
                    {additionalDocs.length +
                      (pricingItems.length > 0 ? 1 : 0)}{" "}
                    attached
                  </Badge>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-6 pt-2">
              {/* Additional Documents */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium">Additional Documents</h4>
                  <p className="text-xs text-muted-foreground">
                    Amendments, addendums, or exhibits related to this contract
                  </p>
                </div>
                {additionalDocs.length > 0 && (
                  <div className="space-y-2">
                    {additionalDocs.map((doc, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 rounded-lg border p-2"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm">{doc.name}</span>
                          <Select
                            value={doc.type}
                            onValueChange={(value) =>
                              setAdditionalDocs((prev) =>
                                prev.map((d, i) =>
                                  i === idx ? { ...d, type: value } : d,
                                ),
                              )
                            }
                          >
                            <SelectTrigger className="h-7 w-[130px] shrink-0 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="amendment">Amendment</SelectItem>
                              <SelectItem value="addendum">Addendum</SelectItem>
                              <SelectItem value="exhibit">Exhibit</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() =>
                            setAdditionalDocs((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement("input")
                    input.type = "file"
                    input.accept = ".pdf,.doc,.docx,.txt"
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0]
                      if (file) {
                        setAdditionalDocs((prev) => [
                          ...prev,
                          { file, type: "amendment", name: file.name },
                        ])
                      }
                    }
                    input.click()
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Document
                </Button>
              </div>

              {/* Upload Pricing File */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium">Pricing File</h4>
                  <p className="text-xs text-muted-foreground">
                    CSV or Excel with vendor item numbers and pricing to link
                    to this contract
                  </p>
                </div>
                {pricingItems.length > 0 ? (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      <div>
                        <p className="text-sm font-medium">{pricingFileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {pricingItems.length} pricing items loaded
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {pricingItems.length} items
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setPricingItems([])
                          setPricingFileName(null)
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const input = document.createElement("input")
                      input.type = "file"
                      input.accept = ".csv,.xlsx,.xls"
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0]
                        if (file) handlePricingUpload(file)
                      }
                      input.click()
                    }}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Pricing File
                  </Button>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
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
            disabled={createMutation.isPending}
          >
            Save as Draft
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="relative min-w-40"
          >
            {/* Both labels are ALWAYS in the DOM at the same position;
                only one is visible via `invisible`. This prevents any
                reconciliation/transition window from painting both
                labels at once (the earlier bug where "Creating..." and
                "Create Contract" overlapped). */}
            <span
              className={createMutation.isPending ? "invisible" : "inline-flex items-center gap-2"}
              aria-hidden={createMutation.isPending || undefined}
            >
              <Save className="h-4 w-4" />
              Create Contract
            </span>
            {createMutation.isPending ? (
              <span className="absolute inset-0 inline-flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </span>
            ) : null}
          </Button>
        </div>
      </div>
    </>
  )
}
