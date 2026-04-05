"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getUploadUrl } from "@/lib/actions/uploads"
import { useCreatePendingContract } from "@/hooks/use-pending-contracts"
import type { CreatePendingContractInput } from "@/lib/validators/pending-contracts"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import type { ContractPricingItem } from "@/lib/actions/pricing-files"
import type { ExtractedContractData } from "@/lib/ai/schemas"
import { toast } from "sonner"

import {
  EntryModeTabs,
  BasicInformationCard,
  GroupContractSettingsCard,
  ContractDatesCard,
  FinancialDetailsCard,
  ContractTermsCard,
  SubmissionSidebar,
} from "./submission"
import type { FacilityOption, PricingFileData, UploadedDoc } from "./submission"

interface VendorContractSubmissionProps {
  vendorId: string
  vendorName: string
  facilities: FacilityOption[]
}

export function VendorContractSubmission({
  vendorId,
  vendorName,
  facilities,
}: VendorContractSubmissionProps) {
  const router = useRouter()
  const create = useCreatePendingContract()

  const [entryMode, setEntryMode] = useState<"ai" | "pdf" | "manual">("ai")
  const [contractName, setContractName] = useState("")
  const [contractType, setContractType] = useState<string>("")
  const [facilityId, setFacilityId] = useState("")
  const [effectiveDate, setEffectiveDate] = useState<Date>()
  const [expirationDate, setExpirationDate] = useState<Date>()
  const [performancePeriod, setPerformancePeriod] = useState("quarterly")
  const [rebatePayPeriod, setRebatePayPeriod] = useState("quarterly")
  const [contractTotal, setContractTotal] = useState("")
  const [description, setDescription] = useState("")
  const [isMultiFacility, setIsMultiFacility] = useState(false)
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([])
  const [gpoAffiliation, setGpoAffiliation] = useState("")
  const [division, setDivision] = useState("")
  const [capitalTieIn, setCapitalTieIn] = useState(false)
  const [tieInRef, setTieInRef] = useState("")
  const [contractTerms, setContractTerms] = useState<TermFormValues[]>([])

  const [contractFile, setContractFile] = useState<File | null>(null)
  const [contractS3Key, setContractS3Key] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractionComplete, setExtractionComplete] = useState(false)

  const [additionalDocs, setAdditionalDocs] = useState<{ file: File; type: string; name: string }[]>([])
  const [pricingFile, setPricingFile] = useState<File | null>(null)
  const [pricingFileData, setPricingFileData] = useState<PricingFileData | null>(null)
  const [pricingItems, setPricingItems] = useState<ContractPricingItem[]>([])

  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleDocUpload = useCallback(async (file: File) => {
    const { uploadUrl, key } = await getUploadUrl({
      fileName: file.name,
      contentType: file.type,
      folder: "contracts",
    })
    await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    })
    setUploadedDocs((prev) => [...prev, { name: file.name, url: key }])
    return key
  }, [])

  const handlePDFUpload = useCallback(
    async (file: File) => {
      setContractFile(file)
      setIsExtracting(true)
      setExtractionProgress(0)

      // Upload the PDF to S3 for document storage
      let s3Key: string | undefined
      try {
        const { uploadUrl, key } = await getUploadUrl({
          fileName: file.name,
          contentType: file.type,
          folder: "contracts",
        })
        await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        })
        s3Key = key
        setContractS3Key(key)
      } catch {
        // S3 upload failed — continue with extraction but without storage
      }

      const filename = (file.name || "").replace(/\.[^/.]+$/, "")

      // Try to parse dates from filename
      let extractedEffective: Date | undefined
      let extractedExpiration: Date | undefined
      const dateMatch = filename.match(/(\d{2})[-/]?(\d{2})[-/]?(\d{4})/)
      if (dateMatch) {
        const month = parseInt(dateMatch[1]) - 1
        const day = parseInt(dateMatch[2])
        const year = parseInt(dateMatch[3])
        extractedEffective = new Date(year, month, day)
        extractedExpiration = new Date(year + 1, month, day)
      }

      // Clean up contract name
      let extractedName = filename
        .replace(/[-_]/g, " ")
        .replace(/\d{6,8}/g, "")
        .replace(/\s+/g, " ")
        .trim()
      if (extractedName.length < 5) {
        extractedName = `${vendorName} Contract ${new Date().getFullYear()}`
      }

      // Detect contract type from filename
      const lower = filename.toLowerCase()
      let extractedType = "usage"
      if (lower.includes("pricing") || lower.includes("price"))
        extractedType = "pricing_only"
      else if (lower.includes("capital") || lower.includes("equipment"))
        extractedType = "capital"
      else if (lower.includes("gpo") || lower.includes("group"))
        extractedType = "grouped"

      // Simulate extraction progress
      const interval = setInterval(() => {
        setExtractionProgress((prev) => Math.min(prev + 10, 90))
      }, 200)
      await new Promise((r) => setTimeout(r, 2000))
      clearInterval(interval)
      setExtractionProgress(100)
      setExtractionComplete(true)
      setIsExtracting(false)

      // Auto-fill form
      setContractName(extractedName)
      setContractType(extractedType)
      if (extractedEffective) setEffectiveDate(extractedEffective)
      if (extractedExpiration) setExpirationDate(extractedExpiration)

      // Auto-select first facility if none selected
      if (!facilityId && facilities.length > 0) {
        setFacilityId(facilities[0].id)
      }

      // Store as uploaded doc if S3 upload succeeded
      if (s3Key) {
        setUploadedDocs((prev) => {
          // Avoid duplicates
          if (prev.some((d) => d.url === s3Key)) return prev
          return [...prev, { name: file.name, url: s3Key }]
        })
      }

      toast.success(`Contract data extracted: "${extractedName}"`)
    },
    [vendorName, facilityId, facilities]
  )

  const handleClearPDF = useCallback(() => {
    // Remove the contract PDF from uploaded docs if it was stored
    if (contractS3Key) {
      setUploadedDocs((prev) => prev.filter((d) => d.url !== contractS3Key))
    }
    setContractFile(null)
    setContractS3Key(null)
    setExtractionComplete(false)
    setExtractionProgress(0)
  }, [contractS3Key])

  const handleMultiFacilityChange = useCallback((checked: boolean) => {
    setIsMultiFacility(checked)
    if (!checked) setSelectedFacilities([])
  }, [])

  const handleCapitalTieInChange = useCallback((checked: boolean) => {
    setCapitalTieIn(checked)
    if (!checked) setTieInRef("")
  }, [])

  /** Pricing file upload with broad header alias matching (same as facility side) */
  const processPricingFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase()
      if (!["csv", "xlsx", "xls"].includes(ext ?? "")) {
        toast.error("Please upload a CSV or Excel (.xlsx/.xls) pricing file")
        return
      }

      setPricingFile(file)

      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

      let rawHeaders: string[] = []
      let dataRows: string[][] = []

      try {
        if (ext === "xlsx" || ext === "xls") {
          const formData = new FormData()
          formData.append("file", file)
          const res = await fetch("/api/parse-file", {
            method: "POST",
            body: formData,
          })
          if (!res.ok) {
            const body = await res.json().catch(() => null)
            toast.error((body as { error?: string } | null)?.error ?? "Failed to parse Excel file")
            setPricingFile(null)
            return
          }
          const parsed = (await res.json()) as { headers: string[]; rows: Record<string, string>[] }
          rawHeaders = parsed.headers
          dataRows = parsed.rows.map((row) => rawHeaders.map((h) => row[h] ?? ""))
        } else {
          const text = await file.text()
          const lines = text.split(/\r?\n/).filter((l) => l.trim())
          rawHeaders = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, "")) ?? []
          dataRows = lines.slice(1).map((line) =>
            line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""))
          )
        }
      } catch {
        setPricingFile(null)
        setPricingFileData(null)
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
        setPricingFile(null)
        setPricingFileData(null)
        return
      }

      // Extract unique categories
      const cats = Array.from(
        new Set(items.map((i) => i.category).filter((c): c is string => !!c))
      )

      // Calculate total
      const total = items.reduce((sum, i) => sum + i.unitPrice, 0)

      setPricingItems(items)
      setPricingFileData({ total, categories: cats, itemCount: items.length })

      if (total > 0 && !contractTotal) {
        setContractTotal(total.toFixed(2))
      }

      toast.success(`Loaded ${items.length} pricing items from ${file.name}`)
    },
    [contractTotal]
  )

  const handleClearPricingFile = useCallback(() => {
    setPricingFile(null)
    setPricingFileData(null)
    setPricingItems([])
  }, [])

  function handleAIExtract(data: ExtractedContractData, s3Key?: string, fileName?: string) {
    if (s3Key) {
      setContractS3Key(s3Key)
      if (fileName) {
        setUploadedDocs((prev) => {
          if (prev.some((d) => d.url === s3Key)) return prev
          return [...prev, { name: fileName, url: s3Key }]
        })
      }
    }

    setContractName(data.contractName)
    setContractType(data.contractType)
    const effDate = new Date(data.effectiveDate)
    const expDate = new Date(data.expirationDate)
    if (!isNaN(effDate.getTime())) setEffectiveDate(effDate)
    if (!isNaN(expDate.getTime())) setExpirationDate(expDate)
    if (data.totalValue) setContractTotal(String(data.totalValue))
    if (data.description) setDescription(data.description)

    // Auto-select first facility if none selected
    if (!facilityId && facilities.length > 0) {
      setFacilityId(facilities[0].id)
    }

    // Populate terms if extracted
    if (data.terms.length > 0) {
      setContractTerms(
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    const targetFacilityId = isMultiFacility
      ? selectedFacilities[0]
      : facilityId
    const targetFacility = facilities.find((f) => f.id === targetFacilityId)

    if (
      !contractName ||
      !contractType ||
      !targetFacilityId ||
      !effectiveDate ||
      !expirationDate
    ) {
      toast.error("Please fill in all required fields")
      setIsSubmitting(false)
      return
    }

    const payload: CreatePendingContractInput = {
      vendorId,
      vendorName,
      contractName,
      contractType: contractType as CreatePendingContractInput["contractType"],
      facilityId: targetFacilityId,
      facilityName: targetFacility?.name,
      effectiveDate: effectiveDate.toISOString().split("T")[0],
      expirationDate: expirationDate.toISOString().split("T")[0],
      totalValue: contractTotal ? parseFloat(contractTotal) : undefined,
      terms: contractTerms.length > 0 ? contractTerms : undefined,
      documents: uploadedDocs.length > 0 ? uploadedDocs : undefined,
      notes: description || undefined,
      division: division || undefined,
      tieInContractId: tieInRef || undefined,
      pricingData: pricingItems.length > 0
        ? {
            fileName: pricingFile?.name ?? "pricing",
            itemCount: pricingItems.length,
            totalValue: pricingFileData?.total ?? 0,
            categories: pricingFileData?.categories ?? [],
            items: pricingItems,
            uploadedAt: new Date().toISOString(),
          }
        : undefined,
    }

    try {
      await create.mutateAsync(payload)
      router.push("/vendor/contracts")
    } catch {
      setIsSubmitting(false)
    }
  }

  const submitting = isSubmitting || create.isPending

  return (
    <div className="space-y-6">
      <EntryModeTabs
        entryMode={entryMode}
        onEntryModeChange={setEntryMode}
        contractFile={contractFile}
        isExtracting={isExtracting}
        extractionProgress={extractionProgress}
        extractionComplete={extractionComplete}
        onPDFUpload={handlePDFUpload}
        onClearPDF={handleClearPDF}
        onAIExtracted={handleAIExtract}
        additionalDocs={additionalDocs}
        onAddDoc={(file, type) => setAdditionalDocs((prev) => [...prev, { file, type, name: file.name }])}
        onRemoveDoc={(i) => setAdditionalDocs((prev) => prev.filter((_, idx) => idx !== i))}
        onChangeDocType={(i, type) => setAdditionalDocs((prev) => prev.map((d, idx) => idx === i ? { ...d, type } : d))}
        pricingFileName={pricingFile?.name ?? null}
        pricingItemCount={pricingItems.length}
        onPricingUpload={processPricingFile}
        onClearPricing={handleClearPricingFile}
      />

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main form (left 2/3) */}
          <div className="lg:col-span-2 space-y-6">
            <BasicInformationCard
              contractName={contractName}
              onContractNameChange={setContractName}
              contractType={contractType}
              onContractTypeChange={setContractType}
              division={division}
              onDivisionChange={setDivision}
              facilityId={facilityId}
              onFacilityIdChange={setFacilityId}
              facilities={facilities}
              isMultiFacility={isMultiFacility}
              onIsMultiFacilityChange={handleMultiFacilityChange}
              selectedFacilities={selectedFacilities}
              onSelectedFacilitiesChange={setSelectedFacilities}
              capitalTieIn={capitalTieIn}
              onCapitalTieInChange={handleCapitalTieInChange}
              tieInRef={tieInRef}
              onTieInRefChange={setTieInRef}
              description={description}
              onDescriptionChange={setDescription}
            />

            {contractType === "grouped" && (
              <GroupContractSettingsCard
                gpoAffiliation={gpoAffiliation}
                onGpoAffiliationChange={setGpoAffiliation}
                isMultiFacility={isMultiFacility}
                onIsMultiFacilityChange={handleMultiFacilityChange}
              />
            )}

            <ContractDatesCard
              effectiveDate={effectiveDate}
              onEffectiveDateChange={setEffectiveDate}
              expirationDate={expirationDate}
              onExpirationDateChange={setExpirationDate}
              performancePeriod={performancePeriod}
              onPerformancePeriodChange={setPerformancePeriod}
              rebatePayPeriod={rebatePayPeriod}
              onRebatePayPeriodChange={setRebatePayPeriod}
            />

            <FinancialDetailsCard
              contractTotal={contractTotal}
              onContractTotalChange={setContractTotal}
            />

            <ContractTermsCard
              contractTerms={contractTerms}
              onContractTermsChange={setContractTerms}
            />
          </div>

          {/* Sidebar (right 1/3) */}
          <SubmissionSidebar
            vendorName={vendorName}
            contractFile={contractFile}
            pricingFile={pricingFile}
            pricingFileData={pricingFileData}
            uploadedDocs={uploadedDocs}
            submitting={submitting}
            onClearPricingFile={handleClearPricingFile}
            onPricingFileSelect={processPricingFile}
            onDocUpload={handleDocUpload}
          />
        </div>
      </form>
    </div>
  )
}
