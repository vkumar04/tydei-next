"use client"

import { useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Save,
  FileText,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  X,
  Plus,
  Paperclip,
} from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractTerm } from "@/lib/actions/contract-terms"
import { createContractDocument } from "@/lib/actions/contracts"
import { importContractPricing, type ContractPricingItem } from "@/lib/actions/pricing-files"
import { parsePricingFile, buildPricingItems as buildPricingItemsShared, detectPricingColumnMapping } from "@/lib/utils/parse-pricing-file"
import { createCategory, getCategories } from "@/lib/actions/categories"
import { queryKeys } from "@/lib/query-keys"
import { createVendor } from "@/lib/actions/vendors"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import { PricingColumnMapper } from "@/components/contracts/pricing-column-mapper"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractFormReview } from "@/components/contracts/contract-form-review"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { AITextExtract } from "@/components/contracts/ai-text-extract"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

  const [entryMode, setEntryMode] = useState<"ai" | "manual" | "pdf">("ai")
  const [aiExtractOpen, setAiExtractOpen] = useState(false)
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

    // Auto-select the first pricing category in the form if none is selected
    if (cats.length > 0 && !form.getValues("productCategoryId")) {
      // Find the matching category ID from the live list
      const refreshedCats = queryClient.getQueryData<{ id: string; name: string }[]>(queryKeys.categories.all)
      const match = (refreshedCats ?? liveCategories).find(
        (c) => cats.some((cat) => c.name.toLowerCase() === cat.toLowerCase())
      )
      if (match) {
        form.setValue("productCategoryId", match.id)
      }
    }

    // Do NOT auto-set totalValue from pricing file — a pricing file is a
    // catalog of available items, not a purchase order. Summing all unit
    // prices produces wildly inflated numbers (e.g. $57M for 10K items).

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
    form.setValue("effectiveDate", data.effectiveDate)
    form.setValue("expirationDate", data.expirationDate)
    if (data.totalValue) {
      form.setValue("totalValue", data.totalValue)
      // Auto-compute annual value
      const years = Math.max(1, (new Date(data.expirationDate).getTime() - new Date(data.effectiveDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      form.setValue("annualValue", Math.round((data.totalValue / years) * 100) / 100)
    }
    if (data.description) form.setValue("description", data.description)

    // Try to match vendor by name, auto-create if not found
    const matchedVendor = vendors.find(
      (v) =>
        v.name.toLowerCase().includes(data.vendorName.toLowerCase()) ||
        (v.displayName ?? "")
          .toLowerCase()
          .includes(data.vendorName.toLowerCase())
    )
    if (matchedVendor) {
      form.setValue("vendorId", matchedVendor.id)
    } else if (data.vendorName) {
      // Auto-create vendor
      try {
        const newVendor = await createVendor({ name: data.vendorName, displayName: data.vendorName, tier: "standard" })
        form.setValue("vendorId", newVendor.id)
        toast.success(`Vendor "${data.vendorName}" added to vendor list`)
        router.refresh()
      } catch {
        // Vendor creation failed — user can select manually
      }
    }

    // Map term types from AI extraction instead of hardcoding
    const mapTermType = (t: string): TermFormValues["termType"] => {
      const typeMap: Record<string, TermFormValues["termType"]> = {
        spend_rebate: "spend_rebate",
        volume_rebate: "volume_rebate",
        price_reduction: "price_reduction",
        market_share: "market_share",
        growth_rebate: "growth_rebate",
        compliance_rebate: "compliance_rebate",
        fixed_fee: "fixed_fee",
        locked_pricing: "locked_pricing",
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
    if (data.terms.length > 0) {
      setTerms(
        data.terms.map((t) => {
          const termType = mapTermType(t.termType)
          const baselineType = mapBaselineType(t.termType)
          // Generate smart term name if generic
          const minRebate = t.tiers.length > 0 ? Math.min(...t.tiers.map(tr => tr.rebateValue ?? 0)) : 0
          const maxRebate = t.tiers.length > 0 ? Math.max(...t.tiers.map(tr => tr.rebateValue ?? 0)) : 0
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
            effectiveStart: data.effectiveDate,
            effectiveEnd: data.expirationDate,
            tiers: t.tiers.map((tier) => ({
              tierNumber: tier.tierNumber,
              spendMin: tier.spendMin ?? 0,
              spendMax: tier.spendMax,
              rebateType: "percent_of_spend" as const,
              rebateValue: tier.rebateValue ?? 0,
            })),
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
      toast.success("Contract data extracted — upload a pricing file or switch to Manual Entry to review")
    }
    setEntryMode("pdf")
  }

  async function handleSubmit() {
    const isValid = await form.trigger()
    if (!isValid) {
      toast.error("Please fix the form errors")
      return
    }

    const values = form.getValues()
    const contract = await createMutation.mutateAsync(values)

    // Create terms for the new contract
    for (const term of terms) {
      await createContractTerm({
        ...term,
        contractId: contract.id,
      })
    }

    // Import pricing file if provided
    if (pricingItems.length > 0) {
      await importContractPricing({ contractId: contract.id, items: pricingItems })
    }

    // Save uploaded contract PDF as a document
    if (contractS3Key) {
      await createContractDocument({
        contractId: contract.id,
        name: contractFileName ?? "Contract PDF",
        type: "main",
        url: contractS3Key,
      })
    }

    // Save additional documents
    for (const doc of additionalDocs) {
      await createContractDocument({
        contractId: contract.id,
        name: doc.name,
        type: doc.type,
      })
    }

    router.push(`/dashboard/contracts/${contract.id}`)
  }

  async function handleSaveAsDraft() {
    // Set status to draft regardless of validation
    form.setValue("status", "draft")

    const values = form.getValues()
    // Only require a name for draft
    if (!values.name) {
      toast.error("Please enter a contract name")
      return
    }

    const contract = await createMutation.mutateAsync(values)

    // Create terms for the new contract
    for (const term of terms) {
      await createContractTerm({
        ...term,
        contractId: contract.id,
      })
    }

    // Import pricing file if provided
    if (pricingItems.length > 0) {
      await importContractPricing({ contractId: contract.id, items: pricingItems })
    }

    // Save uploaded contract PDF as a document
    if (contractS3Key) {
      await createContractDocument({
        contractId: contract.id,
        name: contractFileName ?? "Contract PDF",
        type: "main",
        url: contractS3Key,
      })
    }

    // Save additional documents
    for (const doc of additionalDocs) {
      await createContractDocument({
        contractId: contract.id,
        name: doc.name,
        type: doc.type,
      })
    }

    router.push(`/dashboard/contracts/${contract.id}`)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/contracts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-balance">New Contract</h1>
          <p className="text-muted-foreground">
            Create a new vendor contract
          </p>
        </div>
      </div>

      <AIExtractDialog
        open={aiExtractOpen}
        onOpenChange={setAiExtractOpen}
        onExtracted={handleAIExtract}
      />

      <PricingColumnMapper
        open={pricingMapperOpen}
        onOpenChange={setPricingMapperOpen}
        headers={pricingRawHeaders}
        sampleRows={pricingRawRows}
        autoMapping={pricingAutoMapping}
        onApply={handleMappingApply}
      />

      {/* Entry Mode Tabs */}
      <Tabs
        value={entryMode}
        onValueChange={(v) => setEntryMode(v as "ai" | "manual" | "pdf")}
        className="mb-2"
      >
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="ai" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Assistant
          </TabsTrigger>
          <TabsTrigger value="pdf" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload PDF
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Manual Entry
          </TabsTrigger>
        </TabsList>

        {/* AI Assistant Tab */}
        <TabsContent value="ai" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Contract Extraction
              </CardTitle>
              <CardDescription>
                Upload a contract PDF and AI will extract the key fields
                automatically
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-muted-foreground">
                Upload a contract document and AI will extract all the relevant
                details.
              </p>
              <Button onClick={() => setAiExtractOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Start AI Extraction
              </Button>
            </CardContent>
          </Card>

          <AITextExtract onExtracted={(data) => handleAIExtract(data)} />
        </TabsContent>

        {/* Upload PDF Tab */}
        <TabsContent value="pdf" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Contract PDF
              </CardTitle>
              <CardDescription>
                Upload a PDF document to auto-fill the contract form via AI extraction
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 py-6">
              <Button onClick={() => setAiExtractOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Upload & Extract with AI
              </Button>
            </CardContent>
          </Card>

          {/* Additional Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-5 w-5" />
                Additional Documents
              </CardTitle>
              <CardDescription>
                Upload amendments, addendums, or exhibits related to this contract
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {additionalDocs.length > 0 && (
                <div className="space-y-2">
                  {additionalDocs.map((doc, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-lg border"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{doc.name}</span>
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {doc.type}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() =>
                          setAdditionalDocs((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
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
                {additionalDocs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {additionalDocs.length} document{additionalDocs.length !== 1 ? "s" : ""} attached
                  </p>
                )}
              </div>
              {additionalDocs.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground">
                    Set document types:
                  </p>
                  {additionalDocs.map((doc, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs truncate max-w-[180px]">
                        {doc.name}
                      </span>
                      <Select
                        value={doc.type}
                        onValueChange={(value) =>
                          setAdditionalDocs((prev) =>
                            prev.map((d, i) =>
                              i === idx ? { ...d, type: value } : d
                            )
                          )
                        }
                      >
                        <SelectTrigger className="h-7 w-[140px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amendment">Amendment</SelectItem>
                          <SelectItem value="addendum">Addendum</SelectItem>
                          <SelectItem value="exhibit">Exhibit</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Upload Pricing File
              </CardTitle>
              <CardDescription>
                Upload a CSV or Excel file with vendor item numbers and pricing to link to this contract
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pricingItems.length > 0 ? (
                <div className="flex items-center justify-between p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
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
                    <Badge variant="secondary">{pricingItems.length} items</Badge>
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
                <div className="flex flex-col items-center gap-4 py-6">
                  <p className="text-sm text-muted-foreground text-center">
                    Upload a CSV or Excel file with columns like vendor_item_no, description, contract_price
                  </p>
                  <Button
                    variant="outline"
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
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual Entry Tab */}
        <TabsContent value="manual" className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            Fill in the contract details manually using the form below.
          </p>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main form - 2 columns */}
            <div className="lg:col-span-2 space-y-6">
              <ContractFormBasicInfo
                form={form}
                vendors={vendors}
                categories={liveCategories}
              />

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
                    <ContractTermsEntry terms={terms} onChange={setTerms} />
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Actions */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={handleSubmit}
                      disabled={createMutation.isPending}
                      className="w-full"
                    >
                      {createMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {createMutation.isPending
                        ? "Creating..."
                        : "Create Contract"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleSaveAsDraft}
                      disabled={createMutation.isPending}
                      className="w-full"
                    >
                      Save as Draft
                    </Button>
                    <Button variant="outline" asChild className="w-full">
                      <Link href="/dashboard/contracts">Cancel</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Review Summary */}
              <ContractFormReview
                values={form.getValues()}
                terms={terms}
                vendors={vendors}
                categories={liveCategories}
              />

              {/* Pricing File */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h4 className="font-medium flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" />
                    Pricing File
                  </h4>
                  {pricingItems.length > 0 ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium truncate max-w-[160px]">{pricingFileName}</p>
                        <p className="text-xs text-muted-foreground">{pricingItems.length} items</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => { setPricingItems([]); setPricingFileName(null) }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
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
                      <Upload className="mr-2 h-3 w-3" />
                      Upload Pricing File
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Help */}
              <Card className="bg-muted/50">
                <CardContent className="p-4">
                  <h4 className="font-medium mb-2">Need help?</h4>
                  <p className="text-sm text-muted-foreground">
                    After creating the contract, you can add terms with specific
                    rebate structures, tiers, and product pricing.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
