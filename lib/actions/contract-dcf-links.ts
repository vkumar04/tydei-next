"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { serialize } from "@/lib/serialize"
import { toEngineRebateUnits } from "@/lib/rebates/calculate"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
import { annualizePeriodCap } from "@/lib/contracts/rebate-accrual-schedule"
import type { AccrualTier } from "@/lib/contracts/rebate-accrual-schedule"
import {
  contractDcfLinkInputSchema,
  dividendProposalPayloadSchema,
} from "@/lib/validators/dividend-proposals"
import type { DividendProposalPayload } from "@/lib/validators/dividend-proposals"
import { resolveDividendProposalSummary } from "@/lib/financial-analysis/dividend-proposal-summary"
import type { DividendVerdict } from "@/lib/financial-analysis/proforma-pnl"

// Links between a vendor contract and saved Dividend/DCF proposals. Both sides
// are vendor-owned, and every query is scoped to the caller's own vendor —
// contracts via the canonical contractsOwnedByVendor predicate.

export interface LinkedDcfProposal {
  id: string
  name: string
  facilityLabel: string
  /** Recomputed from `payload`, never the denormalized column. */
  verdict: DividendVerdict | null
  payload: DividendProposalPayload
}

/**
 * The contract's spend-dollar rebate ladder in ENGINE units — percent in
 * `rebateValue`, flat dollars in `fixedRebateAmount`, mapped by
 * `toEngineRebateUnits` — ready for `projectRebateAccrualSchedule`.
 *
 * Only spend-dollar ladders qualify — market-share and volume terms key off a
 * different metric entirely, and carve-out/tie-in placeholder tiers are not a
 * real ladder. `hasSpendDollarTierLadder` gates the THRESHOLD unit; the rebate
 * VALUE unit is `toEngineRebateUnits`' job.
 */
export interface ContractRebateLadder {
  tiers: AccrualTier[]
  rebateMethod: "cumulative" | "marginal"
  boundaryRule: "exclusive" | "inclusive"
  termName: string | null
  /** `ContractTerm.spendBaseline` in annual dollars; null when unset. Only
   *  reduces the rebate base when `growthOnly`. */
  spendBaseline: number | null
  growthOnly: boolean
  /** `ContractTerm.periodCap` converted to dollars per projection year. A
   *  ceiling on the spend the ladder may earn on, not on the rebate. */
  annualSpendCap: number | null
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
  contractIdInput: string,
): Promise<ContractDcfBundle> {
  const { vendor } = await requireVendor()
  // Parse before the id reaches any Prisma predicate — server-action args are
  // deserialized client JSON and the declared `string` type is erased.
  const contractId =
    contractDcfLinkInputSchema.shape.contractId.parse(contractIdInput)
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
          evaluationPeriod: true,
          spendBaseline: true,
          growthOnly: true,
          periodCap: true,
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
      verdict: resolveDividendProposalSummary(parsed.data)?.verdict ?? null,
      payload: parsed.data,
    })
  }

  // Divisor for the total-value spend fallback below, and the spread for a
  // `lifetime` period cap.
  const termStart = new Date(contract.effectiveDate).getTime()
  const termEnd = new Date(contract.expirationDate).getTime()
  const termYears =
    termEnd > termStart
      ? (termEnd - termStart) / (1000 * 60 * 60 * 24 * 365.25)
      : 1

  // First term carrying a real, payable spend-dollar ladder wins.
  let ladder: ContractRebateLadder | null = null
  for (const term of contract.terms) {
    const shaped = {
      termType: term.termType,
      tiers: term.tiers.map((t) => ({ rebateValue: t.rebateValue })),
    }
    if (!hasSpendDollarTierLadder(shaped)) continue

    const tiers: AccrualTier[] = term.tiers.map((t) => {
      const units = toEngineRebateUnits(t.rebateValue, t.rebateType)
      return {
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax === null ? null : Number(t.spendMax),
        rebateValue: units.rebateValue,
        fixedRebateAmount: units.fixedRebateAmount,
      }
    })

    // fixed_rebate_per_unit / per_procedure_rebate earn units × rate and pay
    // nothing on a spend-driven projection, so a term made only of those maps
    // to an all-zero ladder. Fall through rather than render badges earning $0.
    const payable = tiers.some(
      (t) => t.rebateValue > 0 || (t.fixedRebateAmount ?? 0) > 0,
    )
    if (!payable) continue

    ladder = {
      tiers,
      rebateMethod: term.rebateMethod === "marginal" ? "marginal" : "cumulative",
      boundaryRule: term.boundaryRule === "inclusive" ? "inclusive" : "exclusive",
      termName: term.termName ?? null,
      // `== null`, not `===`: these are Decimal? columns and an absent value can
      // arrive as undefined, which Number() turns into NaN.
      spendBaseline: term.spendBaseline == null ? null : Number(term.spendBaseline),
      growthOnly: term.growthOnly ?? false,
      annualSpendCap: annualizePeriodCap(
        term.periodCap == null ? null : Number(term.periodCap),
        term.evaluationPeriod,
        termYears,
      ),
    }
    break
  }

  // Year-1 spend basis: the stated annual value, else total ÷ term length.
  const annual = Number(contract.annualValue)
  let baseAnnualSpend = annual
  if (!(baseAnnualSpend > 0)) {
    const total = Number(contract.totalValue)
    baseAnnualSpend = termYears > 0 && total > 0 ? total / termYears : 0
  }

  return serialize({ linked, ladder, baseAnnualSpend })
}

export async function linkDcfProposalToContract(input: {
  contractId: string
  proposalId: string
}): Promise<void> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const { contractId, proposalId } = contractDcfLinkInputSchema.parse(input)
  await assertContractVisible(contractId, vendor.id)

  // The proposal must be this vendor's too — never link across tenants.
  const proposal = await prisma.dividendProposal.findFirst({
    where: { id: proposalId, vendorId: vendor.id },
    select: { id: true },
  })
  if (!proposal) throw new Error("Proposal not found")

  try {
    await prisma.contractDcfLink.upsert({
      where: { contractId_proposalId: { contractId, proposalId } },
      create: {
        vendorId: vendor.id,
        contractId,
        proposalId,
        createdBy: user.id,
      },
      update: {},
    })
  } catch (err) {
    console.error("[linkDcfProposalToContract]", err, {
      vendorId: vendor.id,
      contractId,
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
  // Parse before the predicate is built. Without this a payload of
  // {contractId:{not:""}, proposalId:{not:""}} is a structurally valid Prisma
  // StringFilter and widens this DELETE from one row to every link the vendor
  // owns — deleteMany is the one shape where a filter object widens the row set
  // rather than failing closed.
  const { contractId, proposalId } = contractDcfLinkInputSchema.parse(input)
  // Same visibility rule as the read and link paths.
  await assertContractVisible(contractId, vendor.id)
  try {
    // deleteMany with the vendor in the predicate: scoping and the composite
    // key in one statement, and a no-op when already gone.
    await prisma.contractDcfLink.deleteMany({
      where: { vendorId: vendor.id, contractId, proposalId },
    })
  } catch (err) {
    console.error("[unlinkDcfProposalFromContract]", err, {
      vendorId: vendor.id,
      contractId,
    })
    throw new Error("Failed to unlink the proposal")
  }
}
