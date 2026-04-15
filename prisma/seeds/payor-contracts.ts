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
          // Joint replacement
          { cpt: "27447", description: "Total Knee Arthroplasty", rate: 18500 },
          { cpt: "27130", description: "Total Hip Arthroplasty", rate: 19200 },
          { cpt: "27125", description: "Hip Hemiarthroplasty", rate: 14800 },
          { cpt: "27236", description: "Open Treatment Femoral Fracture", rate: 12400 },
          { cpt: "27487", description: "Revision Total Knee", rate: 22600 },
          { cpt: "27486", description: "Revision Total Hip", rate: 24100 },
          // Arthroscopy — knee/shoulder
          { cpt: "29881", description: "Knee Arthroscopy w/ Meniscectomy", rate: 4800 },
          { cpt: "29880", description: "Knee Arthroscopy - Medial+Lateral", rate: 5100 },
          { cpt: "29888", description: "ACL Reconstruction", rate: 8200 },
          { cpt: "29826", description: "Shoulder Arthroscopy - Subacromial", rate: 4200 },
          { cpt: "29827", description: "Shoulder Arthroscopy w/ Rotator Cuff Repair", rate: 7400 },
          { cpt: "29828", description: "Shoulder Arthroscopy - Biceps Tenodesis", rate: 4600 },
          { cpt: "29914", description: "Hip Arthroscopy", rate: 5800 },
          // Spine
          { cpt: "22551", description: "Cervical Spinal Fusion", rate: 21000 },
          { cpt: "22612", description: "Lumbar Spinal Fusion", rate: 22800 },
          { cpt: "63030", description: "Lumbar Laminotomy", rate: 8200 },
          { cpt: "62321", description: "Lumbar Epidural Injection", rate: 850 },
          // General
          { cpt: "64721", description: "Carpal Tunnel Release", rate: 2400 },
          { cpt: "G0260", description: "Sacroiliac Joint Injection", rate: 620 },
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
          { cpt: "27125", description: "Hip Hemiarthroplasty", rate: 13100 },
          { cpt: "29881", description: "Knee Arthroscopy w/ Meniscectomy", rate: 3900 },
          { cpt: "29888", description: "ACL Reconstruction", rate: 6800 },
          { cpt: "29826", description: "Shoulder Arthroscopy - Subacromial", rate: 3500 },
          { cpt: "29827", description: "Shoulder Arthroscopy w/ Rotator Cuff Repair", rate: 6200 },
          { cpt: "22612", description: "Lumbar Spinal Fusion", rate: 15800 },
          { cpt: "63030", description: "Lumbar Laminotomy", rate: 6900 },
          { cpt: "64721", description: "Carpal Tunnel Release", rate: 2000 },
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
