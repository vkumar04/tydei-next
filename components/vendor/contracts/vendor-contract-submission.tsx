"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getUploadUrl } from "@/lib/actions/uploads"
import { useCreatePendingContract } from "@/hooks/use-pending-contracts"
import type { CreatePendingContractInput } from "@/lib/validators/pending-contracts"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import type { ContractPricingItem } from "@/lib/actions/pricing-files"
import type { ExtractedContractData } from "@/lib/ai/schemas"
import { normalizeAIRebateValue } from "@/lib/contracts/rebate-value-normalize"
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
import { VendorPhase2FieldsCard } from "./submission/vendor-phase2-fields-card"

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

  // Charles 2026-04-25 (audit follow-up): vendor-mirror Phase 2 added
  // these columns to PendingContract but the submission UI never grew
  // inputs for them. Capital/tie-in submissions silently dropped the
  // financial structure on approve. State here; UI rendered below in a
  // conditional card; payload includes all of them on submit.
  const [contractNumber, setContractNumber] = useState("")
  const [annualValue, setAnnualValue] = useState("")
  const [autoRenewal, setAutoRenewal] = useState(false)
  const [terminationNoticeDays, setTerminationNoticeDays] = useState("90")
  // Capital tie-in fields — only relevant when contractType is
  // capital or tie_in. Stored as strings so empty input doesn't
  // coerce to 0.
  const [capitalCost, setCapitalCost] = useState("")
  const [interestRate, setInterestRate] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [downPayment, setDownPayment] = useState("")
  const [paymentCadence, setPaymentCadence] = useState<
    "monthly" | "quarterly" | "annual"
  >("monthly")
  const [amortizationShape, setAmortizationShape] = useState<
    "symmetrical" | "custom"
  >("symmetrical")

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
    // AI extractor returns null for undated / evergreen fields; skip when null.
    if (data.effectiveDate) {
      const effDate = new Date(data.effectiveDate)
      if (!isNaN(effDate.getTime())) setEffectiveDate(effDate)
    }
    if (data.expirationDate) {
      const expDate = new Date(data.expirationDate)
      if (!isNaN(expDate.getTime())) setExpirationDate(expDate)
    }
    if (data.totalValue) setContractTotal(String(data.totalValue))
    if (data.description) setDescription(data.description)

    // Auto-select first facility if none selected
    if (!facilityId && facilities.length > 0) {
      setFacilityId(facilities[0].id)
    }

    // Populate terms if extracted.
    // Charles 2026-04-25 (audit follow-up — vendor walkthrough C):
    // the prior implementation hard-coded `termType: spend_rebate`,
    // `baselineType: spend_based`, `rebateMethod: cumulative` for
    // EVERY extracted term — silently mistyping volume / growth /
    // market-share contracts as spend rebates so the engines never
    // matched the contract's actual semantics. Now we honor what
    // the AI extracted, with conservative fallbacks only when the
    // AI didn't return a value or returned something we don't
    // recognize.
    if (data.terms.length > 0) {
      setContractTerms(
        data.terms.map((t) => {
          const aiTermType = String(t.termType ?? "").trim()
          const termType: TermFormValues["termType"] = (
            [
              "spend_rebate",
              "volume_rebate",
              "growth_rebate",
              "rebate_per_use",
              "po_rebate",
              "payment_rebate",
              "compliance_rebate",
              "market_share",
              "fixed_fee",
              "locked_pricing",
              "price_reduction",
              "market_share_price_reduction",
              "capitated_price_reduction",
              "capitated_pricing_rebate",
              "carve_out",
            ] as const
          ).includes(aiTermType as TermFormValues["termType"])
            ? (aiTermType as TermFormValues["termType"])
            : "spend_rebate"

          // Charles 2026-04-25 (audit C2): honor what the AI returned
          // for the term shape; only fall back when the field is
          // missing. Fallbacks are termType-aware — e.g. a market_share
          // or compliance_rebate has no spend baseline, growth_rebate
          // is growth_based, volume_rebate is volume_based — so even
          // when the AI omits the field we don't actively mistype the
          // term as a spend_based / cumulative rebate.
          const defaultBaselineForTermType = (
            tt: TermFormValues["termType"],
          ): TermFormValues["baselineType"] => {
            switch (tt) {
              case "growth_rebate":
                return "growth_based"
              case "volume_rebate":
              case "rebate_per_use":
              case "po_rebate":
              case "payment_rebate":
              case "capitated_pricing_rebate":
                return "volume_based"
              // market_share / compliance / fixed_fee / locked_pricing /
              // price_reduction / market_share_price_reduction /
              // capitated_price_reduction / carve_out have no real
              // spend-baseline semantics — keep spend_based as the
              // schema-required default but the engines ignore it.
              default:
                return "spend_based"
            }
          }
          const defaultRebateMethodForTermType = (
            tt: TermFormValues["termType"],
          ): TermFormValues["rebateMethod"] => {
            // Tier-engine `marginal` makes sense for ordered $/unit
            // ladders (spend, growth, volume); flat-trigger types are
            // always cumulative-equivalent. Charles audit re-pass C6:
            // volume_rebate / growth_rebate previously fell through to
            // cumulative even when the AI's contract is clearly a
            // marginal ladder. Bias to `marginal` for those two so
            // AI-extracted volume/growth contracts compute correctly
            // when the AI omits the field.
            switch (tt) {
              case "volume_rebate":
              case "growth_rebate":
                return "marginal"
              case "market_share":
              case "compliance_rebate":
              case "fixed_fee":
              case "locked_pricing":
              case "price_reduction":
              case "market_share_price_reduction":
              case "capitated_price_reduction":
                return "cumulative"
              default:
                return "cumulative"
            }
          }

          const baselineType: TermFormValues["baselineType"] =
            t.baselineType ?? defaultBaselineForTermType(termType)
          const rebateMethod: TermFormValues["rebateMethod"] =
            t.rebateMethod ?? defaultRebateMethodForTermType(termType)
          const evaluationPeriod: string = t.evaluationPeriod ?? "annual"
          const paymentTiming: string = t.paymentTiming ?? "quarterly"
          const appliesTo: string = t.appliesTo ?? "all_products"

          return {
            termName: t.termName,
            termType,
            baselineType,
            evaluationPeriod,
            paymentTiming,
            appliesTo,
            rebateMethod,
            effectiveStart: data.effectiveDate ?? "",
            effectiveEnd: data.expirationDate ?? "",
            // Charles 2026-04-25 (audit Bug 2): honor every term-level
            // baseline / scope / procedure field the AI returned.
            // Pre-fix the mapper dropped these even when the
            // extractedContractSchema delivered them, so the
            // resulting pending row had nothing for the engine to
            // match on after approval.
            volumeType: t.volumeType,
            spendBaseline: t.spendBaseline,
            volumeBaseline: t.volumeBaseline,
            growthBaselinePercent: t.growthBaselinePercent,
            desiredMarketShare: t.desiredMarketShare,
            scopedCategoryIds: t.scopedCategoryIds,
            scopedItemNumbers: t.scopedItemNumbers,
            cptCodes: t.cptCodes,
            tiers: t.tiers.map((tier) => ({
              tierNumber: tier.tierNumber,
              tierName: tier.tierName ?? null,
              spendMin: tier.spendMin ?? 0,
              spendMax: tier.spendMax,
              // Charles 2026-04-25 (audit Bug 2): per-tier volume /
              // market-share thresholds. Without these the volume +
              // market-share engines collapse the ladder to a single
              // tier (every tier starts at 0).
              volumeMin: tier.volumeMin,
              volumeMax: tier.volumeMax,
              marketShareMin: tier.marketShareMin,
              marketShareMax: tier.marketShareMax,
              // Charles 2026-04-25 audit pass-2 B2: honor the AI's
              // tier.rebateType (the schema accepts percent_of_spend /
              // fixed_rebate / fixed_rebate_per_unit / per_procedure_rebate).
              // Hardcoding percent_of_spend was silently mistyping
              // every market_share / fixed_fee / volume contract:
              // a $1500/period flat payout was stored as 15% of spend.
              rebateType: ((tier.rebateType ?? "percent_of_spend") as
                | "percent_of_spend"
                | "fixed_rebate"
                | "fixed_rebate_per_unit"
                | "per_procedure_rebate"),
              // Charles R5.25 — AI often returns "3" for 3%; the DB
              // stores percent_of_spend as a fraction (0.03). Other
              // rebate types are flat dollars and don't normalize.
              rebateValue: normalizeAIRebateValue(
                tier.rebateType ?? "percent_of_spend",
                tier.rebateValue,
              ),
            })),
          }
        })
      )
    }

    toast.success("Contract data extracted and populated")
    setEntryMode("manual")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    // Charles audit round-1 vendor C1: multi-facility submission used
    // to silently take only selectedFacilities[0]. The remaining
    // selections were dropped — vendor saw "Submitted" but only one
    // facility got the row. Now: when isMultiFacility, fan out one
    // PendingContract per selected facility so the GPO membership all
    // receive it. Single-facility path unchanged.
    const facilityIdsToSubmit: string[] = isMultiFacility
      ? selectedFacilities.filter(Boolean)
      : facilityId
        ? [facilityId]
        : []

    if (
      !contractName ||
      !contractType ||
      facilityIdsToSubmit.length === 0 ||
      !effectiveDate ||
      !expirationDate
    ) {
      toast.error("Please fill in all required fields")
      setIsSubmitting(false)
      return
    }

    const buildPayloadFor = (
      facId: string,
    ): CreatePendingContractInput => ({
      vendorId,
      vendorName,
      contractName,
      contractType: contractType as CreatePendingContractInput["contractType"],
      facilityId: facId,
      facilityName: facilities.find((f) => f.id === facId)?.name,
      effectiveDate: effectiveDate.toISOString().split("T")[0],
      expirationDate: expirationDate.toISOString().split("T")[0],
      totalValue: contractTotal ? parseFloat(contractTotal) : undefined,
      terms: contractTerms.length > 0 ? contractTerms : undefined,
      documents: uploadedDocs.length > 0 ? uploadedDocs : undefined,
      notes: description || undefined,
      division: division || undefined,
      // Charles audit deferred-fix: tieInContractId is facility-scoped
      // (the parent capital contract belongs to ONE facility). On
      // multi-facility fan-out, only the facility whose contract was
      // actually selected as the tie-in target should receive the
      // reference. For all other facilities in the fan-out, drop it.
      // The vendor must follow up with a per-facility tie-in once the
      // approved contracts exist on each facility's side.
      tieInContractId:
        isMultiFacility && facilityIdsToSubmit.length > 1
          ? undefined
          : tieInRef || undefined,
      // Charles 2026-04-25 (audit follow-up): all Phase-2 fields now
      // sent. The form gathers everything PendingContract supports;
      // approvePendingContract ports them onto the real Contract on
      // approve. Capital tie-in fields only have meaningful values
      // when contractType is capital or tie_in — for other types
      // they're empty strings → undefined and skipped server-side.
      gpoAffiliation: gpoAffiliation || undefined,
      performancePeriod: (performancePeriod || undefined) as
        | "monthly"
        | "quarterly"
        | "semi_annual"
        | "annual"
        | undefined,
      rebatePayPeriod: (rebatePayPeriod || undefined) as
        | "monthly"
        | "quarterly"
        | "semi_annual"
        | "annual"
        | undefined,
      contractNumber: contractNumber || undefined,
      annualValue: annualValue ? parseFloat(annualValue) : undefined,
      autoRenewal: autoRenewal || undefined,
      terminationNoticeDays: terminationNoticeDays
        ? parseInt(terminationNoticeDays, 10)
        : undefined,
      ...(contractType === "capital" || contractType === "tie_in"
        ? {
            capitalCost: capitalCost ? parseFloat(capitalCost) : undefined,
            interestRate: interestRate
              ? parseFloat(interestRate) / 100 // user enters %, schema stores fraction
              : undefined,
            termMonths: termMonths ? parseInt(termMonths, 10) : undefined,
            downPayment: downPayment ? parseFloat(downPayment) : undefined,
            paymentCadence,
            amortizationShape,
          }
        : {}),
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
    })

    try {
      // Charles audit round-2 vendor CONCERN 2: fan out with
      // Promise.allSettled so a mid-flight failure on one facility
      // doesn't skip the rest, and surface a single rolled-up toast
      // (instead of one per success) telling the user exactly what
      // succeeded and what failed.
      const results = await Promise.allSettled(
        facilityIdsToSubmit.map((facId) =>
          create.mutateAsync(buildPayloadFor(facId)),
        ),
      )
      const failures = results
        .map((r, i) =>
          r.status === "rejected"
            ? {
                facilityName:
                  facilities.find((f) => f.id === facilityIdsToSubmit[i])
                    ?.name ?? facilityIdsToSubmit[i],
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
              }
            : null,
        )
        .filter((x): x is { facilityName: string; error: string } => x !== null)
      const successes = results.length - failures.length
      if (failures.length === 0) {
        toast.success(
          successes === 1
            ? "Contract submitted for review"
            : `Contract submitted to ${successes} facilities`,
        )
        router.push("/vendor/contracts")
        return
      }
      toast.error(
        `Submitted to ${successes} of ${results.length} facilities. Failed: ${failures
          .map((f) => f.facilityName)
          .join(", ")}`,
      )
      setIsSubmitting(false)
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

            {/*
             * Charles 2026-04-25 (audit follow-up): Phase-2 field
             * parity inputs. These columns exist on PendingContract
             * but had no UI surface — vendor submissions were
             * silently dropping the values at the form layer.
             * Capital tie-in fields render only when contractType
             * is capital or tie_in.
             */}
            <VendorPhase2FieldsCard
              contractNumber={contractNumber}
              onContractNumberChange={setContractNumber}
              annualValue={annualValue}
              onAnnualValueChange={setAnnualValue}
              autoRenewal={autoRenewal}
              onAutoRenewalChange={setAutoRenewal}
              terminationNoticeDays={terminationNoticeDays}
              onTerminationNoticeDaysChange={setTerminationNoticeDays}
              gpoAffiliation={gpoAffiliation}
              onGpoAffiliationChange={setGpoAffiliation}
              showCapital={
                contractType === "capital" || contractType === "tie_in"
              }
              capitalCost={capitalCost}
              onCapitalCostChange={setCapitalCost}
              interestRate={interestRate}
              onInterestRateChange={setInterestRate}
              termMonths={termMonths}
              onTermMonthsChange={setTermMonths}
              downPayment={downPayment}
              onDownPaymentChange={setDownPayment}
              paymentCadence={paymentCadence}
              onPaymentCadenceChange={setPaymentCadence}
              amortizationShape={amortizationShape}
              onAmortizationShapeChange={setAmortizationShape}
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
