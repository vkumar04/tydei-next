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
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"

/**
 * Charles R5.36 P0 — invoke the accrual recompute without letting a
 * failure inside it rollback the term/tier write that just committed.
 * Previously a bug (missing COG data, malformed tier, etc.) would bubble
 * out of the server action, the client's term-save loop would abort,
 * and subsequent tier edits in the same save never ran. The user saw
 * "Contract updated successfully" (from the basic-info mutation) and
 * landed on a detail page that still showed the pre-edit tier values.
 *
 * Accrual recompute is a downstream/rebuild side-effect — the same
 * pattern the contract-level `recomputeContractScore` uses.
 */
async function recomputeAccrualSafe(contractId: string): Promise<void> {
  try {
    await recomputeAccrualForContract(contractId)
  } catch (err) {
    console.warn(
      `[contract-terms] recomputeAccrualForContract(${contractId}) failed:`,
      err,
    )
  }
}

// Charles W1.T — tie-in capital moved to Contract, so this file no
// longer persists ContractAmortizationSchedule rows on term save. That
// lives on the contract update path now (lib/actions/contracts.ts).

// ─── Get Terms ───────────────────────────────────────────────────

export async function getContractTerms(contractId: string) {
  await requireFacility()

  const terms = await prisma.contractTerm.findMany({
    where: { contractId },
    include: {
      tiers: { orderBy: { tierNumber: "asc" } },
      products: { select: { vendorItemNo: true } },
    },
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
  // scopedCategoryIds maps to the ContractTerm.categories String[] column.
  // scopedCategoryId (singular) is back-compat only and has no DB column.
  //
  // Charles W1.T — capital fields (capitalCost, interestRate, termMonths,
  // downPayment, paymentCadence, amortizationShape) plus
  // customAmortizationRows are contract-level now; they're accepted on
  // the term validator for back-compat but dropped before we hit Prisma.
  const {
    tiers,
    scopedItemNumbers,
    scopedCategoryId: _scopedCategoryId,
    scopedCategoryIds,
    customAmortizationRows: _customAmortizationRows,
    capitalCost: _capitalCost,
    interestRate: _interestRate,
    termMonths: _termMonths,
    downPayment: _downPayment,
    paymentCadence: _paymentCadence,
    amortizationShape: _amortizationShape,
    ...termData
  } = data
  void _scopedCategoryId
  void _customAmortizationRows
  void _capitalCost
  void _interestRate
  void _termMonths
  void _downPayment
  void _paymentCadence
  void _amortizationShape

  // scopedCategoryIds maps to the ContractTerm.categories String[] column.
  // (Formerly consumed by lib/rebates/from-prisma.ts::buildConfigFromPrismaTerm,
  // removed in the 2026-04-19 engine-param-coverage audit resolution — the
  // column is still read by the accrual/display path and by AI extraction.)
  // Include it on the term itself when provided.
  const termDataWithCategories: typeof termData & {
    categories?: string[]
  } = { ...termData }
  if (scopedCategoryIds && scopedCategoryIds.length > 0) {
    termDataWithCategories.categories = scopedCategoryIds
  }

  const term = await prisma.contractTerm.create({
    data: {
      ...termDataWithCategories,
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

  // Charles R5.21 — keep auto-generated Rebate rows in sync with the
  // term's current evaluationPeriod / tier shape. Without this, the
  // detail-page "Rebates Earned" card continues to show the pre-edit
  // $0 even though `getAccrualTimeline` would compute a non-zero.
  await recomputeAccrualSafe(data.contractId)

  return serialize(term)
}

// ─── Update Term ─────────────────────────────────────────────────

export async function updateContractTerm(id: string, input: UpdateTermInput) {
  await requireFacility()
  const data = updateTermSchema.parse(input)

  // Scope fields don't live on ContractTerm itself:
  //   - scopedItemNumbers → ContractTermProduct join rows (handled below).
  //   - scopedCategoryIds → ContractTerm.categories String[] column.
  //   - scopedCategoryId (singular) → back-compat only, no DB column.
  //
  // Charles W1.T — capital fields are contract-level now; strip them
  // off the term update payload before hitting Prisma.
  const {
    tiers: _tiers,
    scopedItemNumbers,
    scopedCategoryId: _scopedCategoryId,
    scopedCategoryIds,
    customAmortizationRows: _customAmortizationRows,
    capitalCost: _capitalCost,
    interestRate: _interestRate,
    termMonths: _termMonths,
    downPayment: _downPayment,
    paymentCadence: _paymentCadence,
    amortizationShape: _amortizationShape,
    ...termData
  } = data
  void _tiers
  void _scopedCategoryId
  void _customAmortizationRows
  void _capitalCost
  void _interestRate
  void _termMonths
  void _downPayment
  void _paymentCadence
  void _amortizationShape

  const updateData: Record<string, unknown> = { ...termData }
  if (termData.effectiveStart) {
    updateData.effectiveStart = new Date(termData.effectiveStart)
  }
  if (termData.effectiveEnd) {
    updateData.effectiveEnd = new Date(termData.effectiveEnd)
  }
  if (scopedCategoryIds !== undefined) {
    updateData.categories = scopedCategoryIds
  }

  const term = await prisma.contractTerm.update({
    where: { id },
    data: updateData,
    include: { tiers: { orderBy: { tierNumber: "asc" } } },
  })

  // Replace ContractTermProduct join rows when scopedItemNumbers is provided
  // (undefined = don't touch; [] = clear; non-empty = replace).
  if (scopedItemNumbers !== undefined) {
    await prisma.contractTermProduct.deleteMany({ where: { termId: id } })
    if (scopedItemNumbers.length > 0) {
      await prisma.contractTermProduct.createMany({
        data: scopedItemNumbers.map((vendorItemNo) => ({
          termId: id,
          vendorItemNo,
        })),
        skipDuplicates: true,
      })
    }
  }

  // Charles R5.21 — see createContractTerm for the rationale.
  await recomputeAccrualSafe(term.contractId)

  return serialize(term)
}

// ─── Delete Term ─────────────────────────────────────────────────

export async function deleteContractTerm(id: string) {
  await requireFacility()

  // Capture contractId before the delete cascades the term row away.
  const term = await prisma.contractTerm.findUnique({
    where: { id },
    select: { contractId: true },
  })

  await prisma.contractTerm.delete({ where: { id } })

  if (term) {
    // Charles R5.21 — regenerate Rebate rows once the term is gone so
    // the detail-page aggregate drops to $0 (or reflects the next
    // remaining term, if any).
    await recomputeAccrualSafe(term.contractId)
  }
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

  // Charles R5.21 — tier edits reshape the accrual curve; regenerate
  // the Rebate rows so the detail-page aggregate stays in sync.
  const parentTerm = await prisma.contractTerm.findUnique({
    where: { id: termId },
    select: { contractId: true },
  })
  if (parentTerm) {
    await recomputeAccrualSafe(parentTerm.contractId)
  }

  return serialize(created)
}
