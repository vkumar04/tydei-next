"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  createTermSchemaWithTierCheck,
  updateTermSchema,
  tierInputSchema,
  refineTierOrdering,
  type CreateTermInput,
  type UpdateTermInput,
  type TierInput,
} from "@/lib/validators/contract-terms"
import { z } from "zod"
import { serialize } from "@/lib/serialize"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"
import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"
import { normalizeScopedItemNumbers } from "@/lib/contracts/normalize-scoped-item-numbers"

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
  // Charles audit round-9 BLOCKER: scope by contract ownership.
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })

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
  try {
    return await _createContractTermImpl(input)
  } catch (err) {
    console.error("[createContractTerm]", err, { contractId: input.contractId })
    throw err
  }
}

async function _createContractTermImpl(input: CreateTermInput) {
  // Charles audit round-9 BLOCKER: contract must belong to facility.
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  // Charles 2026-04-25 (Bug 21): use the with-check variant so tier
  // overlaps are rejected at the server boundary even on direct
  // createContractTerm calls (the contract-create path is already
  // guarded via termFormSchemaWithTierCheck).
  const data = createTermSchemaWithTierCheck.parse(input)

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
    // UI picks category IDs; downstream readers (buildCategoryWhereClause,
    // match engine, accrual) compare against COGRecord.category which
    // stores NAMES. Resolve IDs → names once at the write boundary so
    // every read path can treat term.categories as the canonical form.
    termDataWithCategories.categories = await resolveCategoryIdsToNames(scopedCategoryIds)
  }

  // Mirror the sentinel pattern in lib/actions/contracts.ts:806-814 so
  // the standalone "Add Term" path to an existing evergreen contract
  // doesn't blow up on `new Date("")` → Invalid Date → Prisma reject.
  // createTermSchema.effectiveEnd was relaxed to z.string() in bdef6b2.
  const EVERGREEN = new Date(Date.UTC(9999, 11, 31))
  const term = await prisma.contractTerm.create({
    data: {
      ...termDataWithCategories,
      effectiveStart: termData.effectiveStart
        ? new Date(termData.effectiveStart)
        : new Date(Date.UTC(1970, 0, 1)),
      effectiveEnd: termData.effectiveEnd
        ? new Date(termData.effectiveEnd)
        : EVERGREEN,
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

  const normalizedScopedItemNumbers = normalizeScopedItemNumbers(
    scopedItemNumbers,
  )
  if (normalizedScopedItemNumbers.length > 0) {
    await prisma.contractTermProduct.createMany({
      data: normalizedScopedItemNumbers.map((vendorItemNo) => ({
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
  try {
    return await _updateContractTermImpl(id, input)
  } catch (err) {
    // CLAUDE.md "AI-action error path" — surface real reason to server
    // logs. Prod clients only see a redacted digest.
    console.error("[updateContractTerm]", err, { termId: id })
    throw err
  }
}

async function _updateContractTermImpl(
  id: string,
  input: UpdateTermInput,
) {
  // Charles audit round-9 BLOCKER: resolve contract via term, then
  // verify ownership.
  const { facility } = await requireFacility()
  const ownerLookup = await prisma.contractTerm.findUniqueOrThrow({
    where: { id },
    select: { contractId: true },
  })
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(ownerLookup.contractId, facility.id),
    select: { id: true },
  })
  const data = updateTermSchema.parse(input)
  // Charles 2026-04-25 (Bug 21): apply the tier-overlap refinement
  // manually here. updateTermSchema is `.partial()` so it can't carry a
  // superRefine — but if the caller IS sending tiers, we still want
  // the same overlap check the create path enforces.
  if (data.tiers !== undefined) {
    const result = z.object({}).superRefine((_, ctx) => {
      refineTierOrdering(data.tiers ?? [], ctx)
    }).safeParse({})
    if (!result.success) {
      throw new z.ZodError(result.error.issues)
    }
  }

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
  // Empty string = explicit user intent to mark evergreen (no fixed
  // end). Distinct from `undefined` which means "field not in the
  // payload, don't touch the column". Silent-skip on empty would drop
  // the user's change without feedback.
  if (termData.effectiveStart !== undefined) {
    updateData.effectiveStart = termData.effectiveStart
      ? new Date(termData.effectiveStart)
      : new Date(Date.UTC(1970, 0, 1))
  }
  if (termData.effectiveEnd !== undefined) {
    updateData.effectiveEnd = termData.effectiveEnd
      ? new Date(termData.effectiveEnd)
      : new Date(Date.UTC(9999, 11, 31))
  }
  if (scopedCategoryIds !== undefined) {
    // Same ID → name resolution as the create path; see createContractTerm.
    updateData.categories = await resolveCategoryIdsToNames(scopedCategoryIds)
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
    const normalized = normalizeScopedItemNumbers(scopedItemNumbers)
    if (normalized.length > 0) {
      await prisma.contractTermProduct.createMany({
        data: normalized.map((vendorItemNo) => ({
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
  try {
    return await _deleteContractTermImpl(id)
  } catch (err) {
    console.error("[deleteContractTerm]", err, { termId: id })
    throw err
  }
}

async function _deleteContractTermImpl(id: string) {
  const { facility } = await requireFacility()

  // Capture contractId before the delete cascades the term row away.
  const term = await prisma.contractTerm.findUnique({
    where: { id },
    select: { contractId: true },
  })
  // Charles audit round-9 BLOCKER: verify ownership before deleting.
  if (term) {
    await prisma.contract.findUniqueOrThrow({
      where: contractOwnershipWhere(term.contractId, facility.id),
      select: { id: true },
    })
  }

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
  try {
    return await _upsertContractTiersImpl(termId, tiers)
  } catch (err) {
    console.error("[upsertContractTiers]", err, { termId })
    throw err
  }
}

async function _upsertContractTiersImpl(
  termId: string,
  tiers: TierInput[],
) {
  // Charles audit round-9 BLOCKER: verify ownership via term→contract.
  const { facility } = await requireFacility()
  const term = await prisma.contractTerm.findUniqueOrThrow({
    where: { id: termId },
    select: { contractId: true },
  })
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(term.contractId, facility.id),
    select: { id: true },
  })
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
