"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getUploadUrl } from "@/lib/actions/uploads"
import { useCreatePendingContract } from "@/hooks/use-pending-contracts"
import type { CreatePendingContractInput } from "@/lib/validators/pending-contracts"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import { toast } from "sonner"

import {
  EntryModeTabs,
  BasicInformationCard,
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

  const [entryMode, setEntryMode] = useState<"pdf" | "manual">("manual")
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
  const [division, setDivision] = useState("")
  const [capitalTieIn, setCapitalTieIn] = useState(false)
  const [tieInRef, setTieInRef] = useState("")
  const [contractTerms, setContractTerms] = useState<TermFormValues[]>([])

  const [contractFile, setContractFile] = useState<File | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractionComplete, setExtractionComplete] = useState(false)

  const [pricingFile, setPricingFile] = useState<File | null>(null)
  const [pricingFileData, setPricingFileData] = useState<PricingFileData | null>(null)

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

      toast.success(`Contract data extracted: "${extractedName}"`)
    },
    [vendorName, facilityId, facilities]
  )

  const handleClearPDF = useCallback(() => {
    setContractFile(null)
    setExtractionComplete(false)
    setExtractionProgress(0)
  }, [])

  const handleMultiFacilityChange = useCallback((checked: boolean) => {
    setIsMultiFacility(checked)
    if (!checked) setSelectedFacilities([])
  }, [])

  const handleCapitalTieInChange = useCallback((checked: boolean) => {
    setCapitalTieIn(checked)
    if (!checked) setTieInRef("")
  }, [])

  const processPricingFile = useCallback(
    async (file: File) => {
      setPricingFile(file)
      try {
        let headers: string[] = []
        let rows: string[][] = []

        if (file.name.match(/\.csv$/i)) {
          const text = await file.text()
          const lines = text.split("\n").filter((l) => l.trim())
          headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""))
          rows = lines.slice(1).map((l) =>
            l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
          )
        } else {
          const formData = new FormData()
          formData.append("file", file)
          const res = await fetch("/api/parse-file", {
            method: "POST",
            body: formData,
          })
          if (!res.ok) throw new Error("Failed to parse file")
          const parsed = await res.json()
          headers = parsed.headers
          rows = parsed.rows
        }

        // Find price column
        const priceKeywords = [
          "price",
          "cost",
          "amount",
          "unit",
          "extended",
          "total",
        ]
        let priceIdx = headers.findIndex((h) =>
          priceKeywords.some((k) => h.toLowerCase().includes(k))
        )
        if (priceIdx === -1) priceIdx = headers.length - 1

        // Find category column
        const catKeywords = ["category", "cat", "type", "class", "group"]
        const catIdx = headers.findIndex((h) =>
          catKeywords.some((k) => h.toLowerCase().includes(k))
        )

        let total = 0
        const categories = new Set<string>()
        let itemCount = 0

        for (const row of rows) {
          if (row.length <= priceIdx) continue
          const val = parseFloat(row[priceIdx].replace(/[$,]/g, ""))
          if (!isNaN(val)) {
            total += val
            itemCount++
          }
          if (catIdx >= 0 && row[catIdx]?.trim()) {
            categories.add(row[catIdx].trim())
          }
        }

        const cats = Array.from(categories).slice(0, 10)
        setPricingFileData({ total, categories: cats, itemCount })

        if (total > 0 && !contractTotal) {
          setContractTotal(total.toFixed(2))
        }

        toast.success(
          `Pricing file processed: ${itemCount} items, $${total.toLocaleString(
            undefined,
            { minimumFractionDigits: 2 }
          )} total${cats.length > 0 ? `, ${cats.length} categories` : ""}`
        )
      } catch {
        setPricingFile(null)
        setPricingFileData(null)
        toast.error("Failed to process pricing file")
      }
    },
    [contractTotal]
  )

  const handleClearPricingFile = useCallback(() => {
    setPricingFile(null)
    setPricingFileData(null)
  }, [])

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
      pricingData: pricingFile
        ? {
            fileName: pricingFile.name,
            itemCount: pricingFileData?.itemCount ?? 0,
            totalValue: pricingFileData?.total ?? 0,
            categories: pricingFileData?.categories ?? [],
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
