import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"

const now = new Date()
const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 15)
const twoWeeksAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14)
const oneYearFromNow = new Date(now.getFullYear() + 1, now.getMonth(), 1)
const twoYearsFromNow = new Date(now.getFullYear() + 2, now.getMonth(), 1)

export async function seedPendingContracts(
  prisma: PrismaClient,
  deps: { vendors: Vendors; facilities: Facilities }
) {
  const { vendors: v, facilities: f } = deps

  await prisma.pendingContract.createMany({
    data: [
      {
        vendorId: v.conmed.id,
        vendorName: "CONMED Corporation",
        facilityId: f.summitGeneral.id,
        facilityName: "Summit General Hospital",
        contractName: "Conmed General Surgery Instruments",
        contractType: "usage",
        status: "submitted",
        effectiveDate: now,
        expirationDate: twoYearsFromNow,
        totalValue: 480000,
        terms: [
          { termType: "spend_rebate", tierCount: 2, baselineSpend: 200000 },
        ],
        documents: [
          { name: "CONMED_Proposal_2025.pdf", uploadedAt: twoWeeksAgo.toISOString() },
        ],
        notes: "Proposal for electrosurgery and gastroenterology product lines.",
        submittedAt: twoWeeksAgo,
      },
      {
        vendorId: v.nuvasive.id,
        vendorName: "NuVasive, Inc.",
        facilityId: f.summitGeneral.id,
        facilityName: "Summit General Hospital",
        contractName: "NuVasive Spine Interbody Agreement",
        contractType: "usage",
        status: "approved",
        effectiveDate: now,
        expirationDate: twoYearsFromNow,
        totalValue: 720000,
        terms: [
          { termType: "volume_rebate", tierCount: 3, baselineVolume: 100 },
        ],
        documents: [
          { name: "NuVasive_Spine_Agreement_2025.pdf", uploadedAt: oneMonthAgo.toISOString() },
        ],
        notes: "Approved for XLIF and TLIF interbody cages.",
        submittedAt: oneMonthAgo,
        reviewedAt: twoWeeksAgo,
        reviewedBy: "System Admin",
        reviewNotes: "Approved. Competitive pricing verified against benchmarks.",
      },
      {
        vendorId: v.zimmerBiomet.id,
        vendorName: "Zimmer Biomet Holdings",
        facilityId: f.rockyMountain.id,
        facilityName: "Rocky Mountain Outpatient Center",
        contractName: "Zimmer Biomet Partial Knee - Rocky Mountain",
        contractType: "usage",
        status: "revision_requested",
        effectiveDate: now,
        expirationDate: oneYearFromNow,
        totalValue: 350000,
        terms: [
          { termType: "spend_rebate", tierCount: 2, baselineSpend: 150000 },
        ],
        documents: [
          { name: "ZB_PartialKnee_Proposal.pdf", uploadedAt: oneMonthAgo.toISOString() },
        ],
        notes: "Proposal for Oxford Partial Knee system.",
        submittedAt: oneMonthAgo,
        reviewedAt: twoWeeksAgo,
        reviewedBy: "System Admin",
        reviewNotes: "Tier 1 rebate rate below benchmark. Please revise to 2.5% minimum.",
      },
    ],
  })

  console.log("  Pending Contracts: 3")
}
