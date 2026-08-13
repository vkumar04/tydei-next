"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { serialize } from "@/lib/serialize"
import { scaleRebateValueForEngine } from "@/lib/rebates/calculate"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
import type { AccrualTier } from "@/lib/contracts/rebate-accrual-schedule"
import { dividendProposalPayloadSchema } from "@/lib/validators/dividend-proposals"
import type { DividendProposalPayload } from "@/lib/validators/dividend-proposals"

// Links between a vendor contract and saved Dividend/DCF proposals. Both sides
// are vendor-owned, and every query is scoped to the caller's own vendor —
// contracts via the canonical contractsOwnedByVendor predicate.

export interface LinkedDcfProposal {
  id: string
  name: string
  facilityLabel: string
  verdict: string | null
  payload: DividendProposalPayload
}

/**
 * The contract's spend-dollar rebate ladder, already scaled to ENGINE units
 * (percent), ready for `projectRebateAccrualSchedule`.
 *
 * Only spend-dollar ladders qualify — market-share and volume terms key off a
 * different metric entirely, and carve-out/tie-in placeholder tiers are not a
 * real ladder. `hasSpendDollarTierLadder` owns that judgement.
 */
export interface ContractRebateLadder {
  tiers: AccrualTier[]
  rebateMethod: "cumulative" | "marginal"
  boundaryRule: "exclusive" | "inclusive"
  termName: string | null
}

export interface ContractDcfBundle {
  linked: LinkedDcfProposal[]
  ladder: ContractRebateLadder | null
  /** Year-1 contract spend basis: annualValue, else totalValue ÷ term years. */
  baseAnnualSpend: number
}

async function assertContractVisible(contractId: string, vendorId: string) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, ...contractsOwnedByVendor(vendorId) },
    select: { id: true },
  })
  if (!contract) throw new Error("Contract not found")
  return contract
}

export async function getContractDcfBundle(
  contractId: string,
): Promise<ContractDcfBundle> {
  const { vendor } = await requireVendor()
  await assertContractVisible(contractId, vendor.id)

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, ...contractsOwnedByVendor(vendor.id) },
    select: {
      totalValue: true,
      annualValue: true,
      effectiveDate: true,
      expirationDate: true,
      terms: {
        select: {
          termName: true,
          termType: true,
          rebateMethod: true,
          boundaryRule: true,
          tiers: {
            select: {
              tierNumber: true,
              spendMin: true,
              spendMax: true,
              rebateValue: true,
              rebateType: true,
            },
            orderBy: { tierNumber: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      dcfLinks: {
        where: { vendorId: vendor.id },
        select: {
          proposal: {
            select: {
              id: true,
              name: true,
              facilityLabel: true,
              verdict: true,
              payload: true,
            },
          },
        },
      },
    },
  })
  if (!contract) throw new Error("Contract not found")

  const linked: LinkedDcfProposal[] = []
  for (const l of contract.dcfLinks) {
    const parsed = dividendProposalPayloadSchema.safeParse(l.proposal.payload)
    if (!parsed.success) {
      console.error("[getContractDcfBundle] stale proposal payload", {
        vendorId: vendor.id,
        proposalId: l.proposal.id,
      })
      continue
    }
    linked.push({
      id: l.proposal.id,
      name: l.proposal.name,
      facilityLabel: l.proposal.facilityLabel,
      verdict: l.proposal.verdict,
      payload: parsed.data,
    })
  }

  // First term carrying a real spend-dollar ladder wins.
  let ladder: ContractRebateLadder | null = null
  for (const term of contract.terms) {
    const shaped = {
      termType: term.termType,
      tiers: term.tiers.map((t) => ({ rebateValue: t.rebateValue })),
    }
    if (!hasSpendDollarTierLadder(shaped)) continue
    ladder = {
      // scaleRebateValueForEngine is the ONLY sanctioned Prisma→engine unit
      // conversion; rebateValue is a fraction for percent_of_spend and plain
      // dollars for every other type.
      tiers: term.tiers.map((t) => ({
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax === null ? null : Number(t.spendMax),
        rebateValue: scaleRebateValueForEngine(t.rebateValue, t.rebateType),
      })),
      rebateMethod: term.rebateMethod === "marginal" ? "marginal" : "cumulative",
      boundaryRule: term.boundaryRule === "inclusive" ? "inclusive" : "exclusive",
      termName: term.termName ?? null,
    }
    break
  }

  // Year-1 spend basis: the stated annual value, else total ÷ term length.
  const annual = Number(contract.annualValue)
  let baseAnnualSpend = annual
  if (!(baseAnnualSpend > 0)) {
    const start = new Date(contract.effectiveDate).getTime()
    const end = new Date(contract.expirationDate).getTime()
    const years = end > start ? (end - start) / (1000 * 60 * 60 * 24 * 365.25) : 1
    const total = Number(contract.totalValue)
    baseAnnualSpend = years > 0 && total > 0 ? total / years : 0
  }

  return serialize({ linked, ladder, baseAnnualSpend })
}

export async function linkDcfProposalToContract(input: {
  contractId: string
  proposalId: string
}): Promise<void> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  await assertContractVisible(input.contractId, vendor.id)

  // The proposal must be this vendor's too — never link across tenants.
  const proposal = await prisma.dividendProposal.findFirst({
    where: { id: input.proposalId, vendorId: vendor.id },
    select: { id: true },
  })
  if (!proposal) throw new Error("Proposal not found")

  try {
    await prisma.contractDcfLink.upsert({
      where: {
        contractId_proposalId: {
          contractId: input.contractId,
          proposalId: input.proposalId,
        },
      },
      create: {
        vendorId: vendor.id,
        contractId: input.contractId,
        proposalId: input.proposalId,
        createdBy: user.id,
      },
      update: {},
    })
  } catch (err) {
    console.error("[linkDcfProposalToContract]", err, {
      vendorId: vendor.id,
      contractId: input.contractId,
    })
    throw new Error("Failed to link the proposal")
  }
}

export async function unlinkDcfProposalFromContract(input: {
  contractId: string
  proposalId: string
}): Promise<void> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  try {
    // deleteMany with the vendor in the predicate: scoping and the composite
    // key in one statement, and a no-op when already gone.
    await prisma.contractDcfLink.deleteMany({
      where: {
        vendorId: vendor.id,
        contractId: input.contractId,
        proposalId: input.proposalId,
      },
    })
  } catch (err) {
    console.error("[unlinkDcfProposalFromContract]", err, {
      vendorId: vendor.id,
    })
    throw new Error("Failed to unlink the proposal")
  }
}
