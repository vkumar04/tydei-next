"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  createTermSchema,
  updateTermSchema,
  tierInputSchema,
  type CreateTermInput,
  type UpdateTermInput,
  type TierInput,
} from "@/lib/validators/contract-terms"
import { z } from "zod"
import { serialize } from "@/lib/serialize"

// ─── Get Terms ───────────────────────────────────────────────────

export async function getContractTerms(contractId: string) {
  await requireFacility()

  const terms = await prisma.contractTerm.findMany({
    where: { contractId },
    include: { tiers: { orderBy: { tierNumber: "asc" } } },
    orderBy: { createdAt: "asc" },
  })
  return serialize(terms)
}

// ─── Create Term ─────────────────────────────────────────────────

export async function createContractTerm(input: CreateTermInput) {
  await requireFacility()
  const data = createTermSchema.parse(input)

  // scopedItemNumbers doesn't belong on ContractTerm itself — it
  // maps to ContractTermProduct join rows written after the term.
  // capitalCost / interestRate / termMonths are real ContractTerm
  // columns and stay in `termData`.
  const { tiers, scopedItemNumbers, ...termData } = data

  const term = await prisma.contractTerm.create({
    data: {
      ...termData,
      effectiveStart: new Date(termData.effectiveStart),
      effectiveEnd: new Date(termData.effectiveEnd),
      ...(tiers.length > 0 && {
        tiers: {
          create: tiers.map((tier) => ({
            tierNumber: tier.tierNumber,
            spendMin: tier.spendMin,
            spendMax: tier.spendMax,
            volumeMin: tier.volumeMin,
            volumeMax: tier.volumeMax,
            marketShareMin: tier.marketShareMin,
            marketShareMax: tier.marketShareMax,
            rebateType: tier.rebateType,
            rebateValue: tier.rebateValue,
          })),
        },
      }),
    },
    include: { tiers: { orderBy: { tierNumber: "asc" } } },
  })

  if (scopedItemNumbers && scopedItemNumbers.length > 0) {
    await prisma.contractTermProduct.createMany({
      data: scopedItemNumbers.map((vendorItemNo) => ({
        termId: term.id,
        vendorItemNo,
      })),
      skipDuplicates: true,
    })
  }

  return serialize(term)
}

// ─── Update Term ─────────────────────────────────────────────────

export async function updateContractTerm(id: string, input: UpdateTermInput) {
  await requireFacility()
  const data = updateTermSchema.parse(input)

  const { tiers, ...termData } = data

  const updateData: Record<string, unknown> = { ...termData }
  if (termData.effectiveStart) {
    updateData.effectiveStart = new Date(termData.effectiveStart)
  }
  if (termData.effectiveEnd) {
    updateData.effectiveEnd = new Date(termData.effectiveEnd)
  }

  const term = await prisma.contractTerm.update({
    where: { id },
    data: updateData,
    include: { tiers: { orderBy: { tierNumber: "asc" } } },
  })

  return serialize(term)
}

// ─── Delete Term ─────────────────────────────────────────────────

export async function deleteContractTerm(id: string) {
  await requireFacility()

  await prisma.contractTerm.delete({ where: { id } })
}

// ─── Upsert Tiers ────────────────────────────────────────────────

export async function upsertContractTiers(termId: string, tiers: TierInput[]) {
  await requireFacility()
  const validated = z.array(tierInputSchema).parse(tiers)

  await prisma.contractTier.deleteMany({ where: { termId } })

  const created = await Promise.all(
    validated.map((tier) =>
      prisma.contractTier.create({
        data: {
          termId,
          tierNumber: tier.tierNumber,
          spendMin: tier.spendMin,
          spendMax: tier.spendMax,
          volumeMin: tier.volumeMin,
          volumeMax: tier.volumeMax,
          marketShareMin: tier.marketShareMin,
          marketShareMax: tier.marketShareMax,
          rebateType: tier.rebateType,
          rebateValue: tier.rebateValue,
        },
      })
    )
  )

  return serialize(created)
}
