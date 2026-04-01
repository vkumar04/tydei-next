"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface FacilityPayorContract {
  id: string
  payorName: string
  payorType: string
  contractNumber: string
  effectiveDate: string
  expirationDate: string
  status: string
  cptRates: { cptCode: string; description?: string; rate: number }[]
  implantPassthrough: boolean
  implantMarkup: number
}

export async function getFacilityPayorContracts(): Promise<FacilityPayorContract[]> {
  const { facility } = await requireFacility()

  const contracts = await prisma.payorContract.findMany({
    where: {
      facilityId: facility.id,
      status: "active",
    },
    orderBy: { payorName: "asc" },
  })

  return serialize(
    contracts.map((c) => ({
      id: c.id,
      payorName: c.payorName,
      payorType: c.payorType,
      contractNumber: c.contractNumber,
      effectiveDate: c.effectiveDate.toISOString(),
      expirationDate: c.expirationDate.toISOString(),
      status: c.status,
      cptRates: (c.cptRates as { cptCode: string; description?: string; rate: number }[]) ?? [],
      implantPassthrough: c.implantPassthrough,
      implantMarkup: Number(c.implantMarkup),
    }))
  )
}

/**
 * Calculate margin for cases using a specific payor contract's CPT rates
 */
export async function calculatePayorMargins(input: {
  facilityId?: string
  payorContractId: string
}) {
  const { facility } = await requireFacility()

  const [contract, cases] = await Promise.all([
    prisma.payorContract.findUniqueOrThrow({
      where: { id: input.payorContractId },
    }),
    prisma.case.findMany({
      where: { facilityId: facility.id },
      include: { procedures: true },
    }),
  ])

  const cptRates = (contract.cptRates as { cptCode: string; rate: number }[]) ?? []
  const rateMap = new Map(cptRates.map((r) => [r.cptCode, r.rate]))

  let totalEstimatedReimbursement = 0
  let totalSpend = 0
  let matchedCases = 0

  const caseMargins = cases.map((c) => {
    const spend = Number(c.totalSpend)
    totalSpend += spend

    // Look up reimbursement from CPT rate
    let reimbursement = 0
    if (c.primaryCptCode && rateMap.has(c.primaryCptCode)) {
      reimbursement = rateMap.get(c.primaryCptCode)!
      matchedCases++
    } else {
      // Fall back to existing reimbursement data
      reimbursement = Number(c.totalReimbursement)
    }
    totalEstimatedReimbursement += reimbursement

    return {
      caseId: c.id,
      caseNumber: c.caseNumber,
      surgeonName: c.surgeonName,
      primaryCptCode: c.primaryCptCode,
      spend,
      estimatedReimbursement: reimbursement,
      margin: reimbursement - spend,
      marginPercent: reimbursement > 0 ? ((reimbursement - spend) / reimbursement) * 100 : 0,
    }
  })

  return serialize({
    payorName: contract.payorName,
    totalCases: cases.length,
    matchedCases,
    totalSpend,
    totalEstimatedReimbursement,
    totalMargin: totalEstimatedReimbursement - totalSpend,
    avgMarginPercent:
      totalEstimatedReimbursement > 0
        ? ((totalEstimatedReimbursement - totalSpend) / totalEstimatedReimbursement) * 100
        : 0,
    caseMargins: caseMargins.slice(0, 50),
  })
}
