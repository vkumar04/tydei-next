"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
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
} from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractTerm } from "@/lib/actions/contract-terms"
import { createContractDocument } from "@/lib/actions/contracts"
import { importContractPricing, type ContractPricingItem } from "@/lib/actions/pricing-files"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractFormReview } from "@/components/contracts/contract-form-review"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  const [entryMode, setEntryMode] = useState<"ai" | "manual" | "pdf">("manual")
  const [aiExtractOpen, setAiExtractOpen] = useState(false)
  const [pricingItems, setPricingItems] = useState<ContractPricingItem[]>([])
  const [pricingFileName, setPricingFileName] = useState<string | null>(null)
  const [pricingCategories, setPricingCategories] = useState<string[]>([])
  const [contractS3Key, setContractS3Key] = useState<string | null>(null)
  const [contractFileName, setContractFileName] = useState<string | null>(null)
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
        // CSV: parse client-side
        const text = await file.text()
        const lines = text.split(/\r?\n/).filter((l) => l.trim())
        rawHeaders = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, "")) ?? []
        dataRows = lines.slice(1).map((line) =>
          line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""))
        )
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
      "vendor_item_no", "vendoritemno", "item_no", "itemno", "sku",
      "part_no", "partnumber", "catalog_no",
      "itemnumber", "item", "itemid", "itemcode",
      "stockno", "stocknumber", "materialid", "materialnumber",
      "productid", "productcode", "vendorpart", "vendorcatalog",
      "catalogno", "catalognumber", "referenceno", "refno", "refnumber",
      "vendor_item_number", "vendoritemnumber", "item_number",
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
      "productcategory", "productline", "productgroup", "producttype",
      "segment", "classification", "dept", "division",
    )
    const idxUom = find(
      "uom", "unit_of_measure", "unit",
      "unitofmeasure", "packsize", "packaging", "pkg", "measure",
    )

    const items: ContractPricingItem[] = dataRows.map((vals) => {
      const g = (idx: number) => (idx >= 0 ? vals[idx] ?? "" : "")
      return {
        vendorItemNo: g(idxItem),
        description: g(idxDesc) || undefined,
        unitPrice: parseFloat(g(idxPrice).replace(/[^0-9.-]/g, "") || "0"),
        listPrice: parseFloat(g(idxList).replace(/[^0-9.-]/g, "") || "0") || undefined,
        category: g(idxCat) || undefined,
        uom: g(idxUom) || "EA",
      }
    }).filter((i) => i.vendorItemNo)

    if (items.length === 0) {
      toast.error("No valid pricing items found. Check your file has columns like vendor_item_no and contract_price.")
      return
    }

    // Extract unique categories
    const cats = Array.from(
      new Set(items.map((i) => i.category).filter((c): c is string => !!c))
    )
    setPricingCategories(cats)

    // Auto-compute total value if the form's totalValue is 0
    const totalFromPricing = items.reduce((sum, i) => sum + i.unitPrice, 0)
    if (form.getValues("totalValue") === 0 && totalFromPricing > 0) {
      form.setValue("totalValue", totalFromPricing)
    }

    setPricingItems(items)
    setPricingFileName(file.name)
    toast.success(`Loaded ${items.length} pricing items from ${file.name}`)
  }, [form])

  function handleAIExtract(data: ExtractedContractData, s3Key?: string, fileName?: string) {
    if (s3Key) setContractS3Key(s3Key)
    if (fileName) setContractFileName(fileName)

    form.setValue("name", data.contractName)
    form.setValue("contractType", data.contractType)
    form.setValue("effectiveDate", data.effectiveDate)
    form.setValue("expirationDate", data.expirationDate)
    if (data.totalValue) form.setValue("totalValue", data.totalValue)
    if (data.description) form.setValue("description", data.description)

    // Try to match vendor by name
    const matchedVendor = vendors.find(
      (v) =>
        v.name.toLowerCase().includes(data.vendorName.toLowerCase()) ||
        (v.displayName ?? "")
          .toLowerCase()
          .includes(data.vendorName.toLowerCase())
    )
    if (matchedVendor) form.setValue("vendorId", matchedVendor.id)

    // Populate terms if extracted
    if (data.terms.length > 0) {
      setTerms(
        data.terms.map((t) => ({
          termName: t.termName,
          termType: "spend_rebate" as const,
          baselineType: "spend_based" as const,
          evaluationPeriod: "annual",
          paymentTiming: "quarterly",
          appliesTo: "all_products",
          effectiveStart: data.effectiveDate,
          effectiveEnd: data.expirationDate,
          tiers: t.tiers.map((tier) => ({
            tierNumber: tier.tierNumber,
            spendMin: tier.spendMin ?? 0,
            spendMax: tier.spendMax,
            rebateType: "percent_of_spend" as const,
            rebateValue: tier.rebateValue ?? 0,
          })),
        }))
      )
    }

    toast.success("Contract data extracted and populated")
    setEntryMode("manual")
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
        <TabsContent value="ai" className="mt-4">
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
                categories={categories}
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
                categories={categories}
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
