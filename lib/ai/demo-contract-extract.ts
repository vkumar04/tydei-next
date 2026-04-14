import type { RichContractExtractData } from "@/lib/ai/schemas"

/**
 * Demo mode extraction — simulates AI parsing without requiring API access.
 * Ported from v0's `getDemoExtractedData`, adapted to tydei's lowercase/
 * snake_case Prisma enum casing.
 */
export function getDemoExtractedData(filename: string): RichContractExtractData {
  const lowerFilename = filename.toLowerCase()
  let vendor = "Unknown Vendor"
  let productCategory = "Medical Supplies"
  let productCategories = ["Medical Supplies"]

  if (lowerFilename.includes("stryker") || lowerFilename.includes("str")) {
    vendor = "Stryker"
    productCategory = "Ortho Trauma"
    productCategories = ["Ortho Trauma", "Ortho Spine", "Sports Medicine"]
  } else if (lowerFilename.includes("depuy") || lowerFilename.includes("dep")) {
    vendor = "DePuy Synthes"
    productCategory = "Ortho Joints"
    productCategories = ["Ortho Joints", "Ortho Spine", "Ortho Trauma"]
  } else if (lowerFilename.includes("zimmer") || lowerFilename.includes("zim")) {
    vendor = "Zimmer Biomet"
    productCategory = "Ortho Reconstruction"
    productCategories = ["Ortho Reconstruction", "Ortho Joints", "Sports Medicine"]
  } else if (lowerFilename.includes("djo")) {
    vendor = "DJO Surgical"
    productCategory = "Ortho Joints"
    productCategories = ["Ortho Joints", "Ortho Bracing"]
  } else if (lowerFilename.includes("arthrex")) {
    vendor = "Arthrex"
    productCategory = "Sports Medicine"
    productCategories = ["Sports Medicine", "Ortho Reconstruction"]
  } else if (lowerFilename.includes("abbott")) {
    vendor = "Abbott Medical"
    productCategory = "Neuromodulation"
    productCategories = ["Neuromodulation", "Cardiac Rhythm"]
  }

  // Detect contract type
  let contractType: "usage" | "capital" | "service" | "tie_in" | "grouped" | "pricing_only" =
    "usage"
  if (lowerFilename.includes("pricing") || lowerFilename.includes("price")) {
    contractType = "pricing_only"
  } else if (lowerFilename.includes("rebate")) {
    contractType = "usage"
  } else if (lowerFilename.includes("capital")) {
    contractType = "capital"
  }

  const today = new Date()
  const effectiveDate = new Date(today.getFullYear(), today.getMonth() - 6, 1)
    .toISOString()
    .split("T")[0]
  const expirationDate = new Date(today.getFullYear() + 3, today.getMonth(), 1)
    .toISOString()
    .split("T")[0]

  // Extract contract ID from filename
  const idMatch =
    filename.match(/([A-Z]{2,5}[-_]?\d{4,}[-_]?\d*)/i) || filename.match(/(\d{6,})/i)
  const contractId = idMatch
    ? idMatch[1].replace(/[-_]/g, "-").toUpperCase()
    : `${vendor.substring(0, 3).toUpperCase()}-${new Date().getFullYear()}-001`

  return {
    contractName: filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
    contractId,
    vendorName: vendor,
    vendorDivision: null,
    contractType,
    productCategory,
    productCategories,
    effectiveDate,
    expirationDate,
    rebatePayPeriod: "quarterly",
    isGroupedContract: false,
    isCapitalContract: contractType === "capital",
    isServiceContract: false,
    isPricingOnly: contractType === "pricing_only",
    facilities: [{ name: "Main Facility", city: null, state: null }],
    terms:
      contractType !== "pricing_only"
        ? [
            {
              termName: "Standard Rebate",
              termType: "spend_rebate",
              effectiveFrom: effectiveDate,
              effectiveTo: expirationDate,
              performancePeriod: "quarterly",
              volumeType: "product_category",
              tiers: [
                {
                  tierNumber: 1,
                  marketShareMin: 0,
                  marketShareMax: 30,
                  spendMin: 0,
                  spendMax: 500000,
                  volumeMin: null,
                  volumeMax: null,
                  rebateType: "percent_of_spend",
                  rebateValue: 2,
                  spendBaseline: null,
                  growthBaseline: null,
                },
                {
                  tierNumber: 2,
                  marketShareMin: 30,
                  marketShareMax: 50,
                  spendMin: 500000,
                  spendMax: 1000000,
                  volumeMin: null,
                  volumeMax: null,
                  rebateType: "percent_of_spend",
                  rebateValue: 3,
                  spendBaseline: null,
                  growthBaseline: null,
                },
                {
                  tierNumber: 3,
                  marketShareMin: 50,
                  marketShareMax: 100,
                  spendMin: 1000000,
                  spendMax: null,
                  volumeMin: null,
                  volumeMax: null,
                  rebateType: "percent_of_spend",
                  rebateValue: 5,
                  spendBaseline: null,
                  growthBaseline: null,
                },
              ],
              products: null,
            },
          ]
        : null,
    tieInDetails: null,
    specialConditions: ["Demo mode - actual contract terms not extracted"],
    contactInfo: null,
  }
}

/**
 * Project the rich contract extract shape into the legacy
 * `ExtractedContractData` shape so existing callers (AIExtractReview,
 * ai-extract-dialog, contract form hook) keep working unchanged.
 */
export function toLegacyExtractedContract(rich: RichContractExtractData) {
  const today = new Date().toISOString().split("T")[0]
  return {
    contractName: rich.contractName ?? "Untitled Contract",
    contractNumber: rich.contractId ?? undefined,
    vendorName: rich.vendorName ?? "Unknown Vendor",
    contractType: rich.contractType ?? "usage",
    effectiveDate: rich.effectiveDate ?? today,
    expirationDate: rich.expirationDate ?? today,
    totalValue: rich.tieInDetails?.capitalEquipmentValue ?? undefined,
    description: rich.specialConditions?.join(" ") || undefined,
    terms: (rich.terms ?? []).map((t) => ({
      termName: t.termName,
      termType: t.termType ?? "spend_rebate",
      tiers: (t.tiers ?? []).map((tier) => ({
        tierNumber: tier.tierNumber,
        spendMin: tier.spendMin ?? undefined,
        spendMax: tier.spendMax ?? undefined,
        rebateType: tier.rebateType ?? undefined,
        rebateValue: tier.rebateValue ?? undefined,
      })),
    })),
  }
}
