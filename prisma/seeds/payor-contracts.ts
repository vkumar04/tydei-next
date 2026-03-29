import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"

const now = new Date()
const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
const twoYearsFromNow = new Date(now.getFullYear() + 2, now.getMonth(), 1)

export async function seedPayorContracts(
  prisma: PrismaClient,
  deps: { facilities: Facilities }
) {
  const { facilities: f } = deps

  await prisma.payorContract.createMany({
    data: [
      {
        payorName: "Blue Cross Blue Shield",
        payorType: "commercial",
        facilityId: f.lighthouseSurgical.id,
        contractNumber: "BCBS-2025-LSC",
        effectiveDate: oneYearAgo,
        expirationDate: twoYearsFromNow,
        status: "active",
        cptRates: [
          { cpt: "27447", description: "Total Knee Arthroplasty", rate: 18500 },
          { cpt: "27130", description: "Total Hip Arthroplasty", rate: 19200 },
          { cpt: "29881", description: "Knee Arthroscopy w/ Meniscectomy", rate: 4800 },
          { cpt: "27236", description: "Open Treatment Femoral Fracture", rate: 12400 },
        ],
        grouperRates: [
          { drg: "470", description: "Major Hip & Knee Joint Replacement", rate: 22000 },
          { drg: "473", description: "Cervical Spinal Fusion", rate: 28500 },
        ],
        multiProcedureRule: { reductionPercent: 50, appliesTo: "secondary" },
        implantPassthrough: true,
        implantMarkup: 15.0,
      },
      {
        payorName: "Aetna Medicare Advantage",
        payorType: "medicare_advantage",
        facilityId: f.lighthouseSurgical.id,
        contractNumber: "AETNA-MA-2025-LSC",
        effectiveDate: oneYearAgo,
        expirationDate: twoYearsFromNow,
        status: "active",
        cptRates: [
          { cpt: "27447", description: "Total Knee Arthroplasty", rate: 16200 },
          { cpt: "27130", description: "Total Hip Arthroplasty", rate: 17100 },
          { cpt: "29881", description: "Knee Arthroscopy w/ Meniscectomy", rate: 3900 },
          { cpt: "22612", description: "Lumbar Spinal Fusion", rate: 15800 },
        ],
        grouperRates: [
          { drg: "470", description: "Major Hip & Knee Joint Replacement", rate: 19500 },
        ],
        multiProcedureRule: { reductionPercent: 50, appliesTo: "secondary" },
        implantPassthrough: true,
        implantMarkup: 10.0,
      },
      {
        payorName: "UnitedHealthcare",
        payorType: "commercial",
        facilityId: f.heritageRegional.id,
        contractNumber: "UHC-2025-HRM",
        effectiveDate: oneYearAgo,
        expirationDate: twoYearsFromNow,
        status: "active",
        cptRates: [
          { cpt: "27447", description: "Total Knee Arthroplasty", rate: 17800 },
          { cpt: "27130", description: "Total Hip Arthroplasty", rate: 18500 },
          { cpt: "63030", description: "Lumbar Laminotomy", rate: 8200 },
          { cpt: "22551", description: "Cervical Spinal Fusion", rate: 21000 },
        ],
        grouperRates: [
          { drg: "470", description: "Major Hip & Knee Joint Replacement", rate: 21000 },
          { drg: "460", description: "Spinal Fusion (non-cervical)", rate: 32000 },
        ],
        multiProcedureRule: { reductionPercent: 50, appliesTo: "secondary" },
        implantPassthrough: true,
        implantMarkup: 12.5,
      },
    ],
  })

  console.log("  Payor Contracts: 3")
}
