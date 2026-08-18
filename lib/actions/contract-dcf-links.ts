"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { serialize } from "@/lib/serialize"
import {
  buildContractRebateLadder,
  contractTermYears,
  resolveBaseAnnualSpend,
} from "@/lib/contracts/dcf-ladder"
import { extractPendingTerms } from "@/lib/contracts/pending-extract"
import {
  contractDcfLinkInputSchema,
  dividendProposalPayloadSchema,
} from "@/lib/validators/dividend-proposals"
import type { DividendProposalPayload } from "@/lib/validators/dividend-proposals"
import type { ContractRebateLadder } from "@/lib/contracts/dcf-ladder"
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

// The from-form re-export is erased by the prod transform; a local
// `export type { X }` clause is not, and would kill every action in this file.
export type { ContractRebateLadder } from "@/lib/contracts/dcf-ladder"

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

  const termYears = contractTermYears(
    contract.effectiveDate,
    contract.expirationDate,
  )
  const ladder = buildContractRebateLadder(contract.terms, termYears)
  const baseAnnualSpend = resolveBaseAnnualSpend(
    contract.annualValue,
    contract.totalValue,
    termYears,
  )

  return serialize({ linked, ladder, baseAnnualSpend })
}

/**
 * The same bundle for a submission that is not an approved Contract yet.
 *
 * A PendingContract has no ContractTerm/ContractTier rows, but the submission
 * form persists the whole ladder into its `terms` JSON, so a real projection is
 * available before approval — which is the point: a vendor should be able to
 * see what a deal is worth while it is still being negotiated.
 *
 * `linked` is always empty. ContractDcfLink.contractId is a hard FK to Contract,
 * so a proposal cannot be PERSISTED against a submission; the tab lets the
 * vendor pick one ad hoc instead.
 */
export async function getPendingContractDcfBundle(
  pendingIdInput: string,
): Promise<ContractDcfBundle> {
  const { vendor } = await requireVendor()
  const pendingId =
    contractDcfLinkInputSchema.shape.contractId.parse(pendingIdInput)

  const pending = await prisma.pendingContract.findFirst({
    where: { id: pendingId, vendorId: vendor.id },
    select: {
      terms: true,
      totalValue: true,
      annualValue: true,
      effectiveDate: true,
      expirationDate: true,
    },
  })
  if (!pending) throw new Error("Submission not found")

  const termYears = contractTermYears(
    pending.effectiveDate,
    pending.expirationDate,
  )
  const terms = extractPendingTerms(pending.terms, pending.effectiveDate)
  const ladder = buildContractRebateLadder(terms, termYears)
  const baseAnnualSpend = resolveBaseAnnualSpend(
    pending.annualValue,
    pending.totalValue,
    termYears,
  )

  return serialize({ linked: [], ladder, baseAnnualSpend })
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
