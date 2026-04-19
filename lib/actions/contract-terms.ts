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
import { buildScheduleForTerm } from "@/lib/contracts/tie-in-schedule"

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

/**
 * Wave D — persist (or clear) ContractAmortizationSchedule rows for a
 * term. Symmetrical-mode terms always clear the table so reads fall
 * back to the engine's on-the-fly PMT compute. Custom-mode terms
 * replace every row with the user-entered amortizationDue values,
 * rebuilding openingBalance / interestCharge / principalDue /
 * closingBalance from the schedule's running opening balance so the
 * detail-page card (Wave A) stays self-consistent.
 */
async function persistAmortizationRows(params: {
  termId: string
  contractId: string
  shape: "symmetrical" | "custom"
  customRows?: { periodNumber: number; amortizationDue: number }[]
  capitalCost: number | null
  downPayment: number | null
  interestRate: number | null
  termMonths: number | null
  paymentCadence: "monthly" | "quarterly" | "annual" | null
}): Promise<void> {
  const { termId, contractId, shape, customRows } = params

  // Symmetrical → always clear persisted rows so the read path
  // computes live from the current capital/interest/term inputs.
  if (shape === "symmetrical") {
    await prisma.contractAmortizationSchedule.deleteMany({
      where: { termId },
    })
    return
  }

  if (!customRows || customRows.length === 0) {
    // Custom mode but the caller didn't hand over rows — leave
    // whatever's already persisted alone so we don't destroy user
    // input on unrelated updates (e.g. toggling shortfall handling).
    return
  }

  const capitalCost = Number(params.capitalCost ?? 0)
  const downPayment = Number(params.downPayment ?? 0)
  const interestRate = Number(params.interestRate ?? 0)
  const termMonths = Number(params.termMonths ?? 0)
  const cadence = params.paymentCadence ?? "monthly"
  const periodsPerYear =
    cadence === "annual" ? 1 : cadence === "quarterly" ? 4 : 12
  const r = interestRate / periodsPerYear

  const sorted = [...customRows].sort(
    (a, b) => a.periodNumber - b.periodNumber,
  )

  const effectivePrincipal = Math.max(0, capitalCost - downPayment)
  let opening = effectivePrincipal

  const rows = sorted.map((row) => {
    const interestCharge = opening * r
    const amortizationDue = row.amortizationDue
    const principalDue = amortizationDue - interestCharge
    const closingBalance = opening - principalDue
    const built = {
      contractId,
      termId,
      periodNumber: row.periodNumber,
      openingBalance: opening,
      interestCharge,
      principalDue,
      amortizationDue,
      closingBalance,
    }
    opening = closingBalance
    return built
  })
  void termMonths // silence unused — validated at the schema layer

  await prisma.contractAmortizationSchedule.deleteMany({
    where: { termId },
  })
  if (rows.length > 0) {
    await prisma.contractAmortizationSchedule.createMany({ data: rows })
  }
}

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
  // capitalCost / interestRate / termMonths are real ContractTerm
  // columns and stay in `termData`.
  const {
    tiers,
    scopedItemNumbers,
    scopedCategoryId: _scopedCategoryId,
    scopedCategoryIds,
    customAmortizationRows,
    ...termData
  } = data
  void _scopedCategoryId

  // Wave D — normalise the nullish validator output to Prisma's
  // `AmortizationShape | undefined` shape before spreading. `null`
  // means "unset" and should fall back to the schema default.
  const { amortizationShape: rawShape, ...termDataSansShape } = termData
  const shapeForPrisma: "symmetrical" | "custom" | undefined =
    rawShape === "symmetrical" || rawShape === "custom" ? rawShape : undefined

  // scopedCategoryIds maps to the ContractTerm.categories String[] column
  // (already consumed by lib/rebates/from-prisma.ts::buildConfigFromPrismaTerm).
  // Include it on the term itself when provided.
  const termDataWithCategories: typeof termDataSansShape & {
    categories?: string[]
    amortizationShape?: "symmetrical" | "custom"
  } = { ...termDataSansShape }
  if (scopedCategoryIds && scopedCategoryIds.length > 0) {
    termDataWithCategories.categories = scopedCategoryIds
  }
  if (shapeForPrisma) {
    termDataWithCategories.amortizationShape = shapeForPrisma
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

  // Wave D — persist custom-mode rows / clear the table for symmetrical.
  // Default to symmetrical on create when the caller omits the field so
  // the table starts clean and reads fall back to the live engine.
  await persistAmortizationRows({
    termId: term.id,
    contractId: data.contractId,
    shape:
      termData.amortizationShape === "custom" ? "custom" : "symmetrical",
    customRows: customAmortizationRows,
    capitalCost: termData.capitalCost ?? null,
    downPayment: termData.downPayment ?? null,
    interestRate: termData.interestRate ?? null,
    termMonths: termData.termMonths ?? null,
    paymentCadence: termData.paymentCadence ?? null,
  })

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
  const {
    tiers: _tiers,
    scopedItemNumbers,
    scopedCategoryId: _scopedCategoryId,
    scopedCategoryIds,
    customAmortizationRows,
    ...termData
  } = data
  void _tiers
  void _scopedCategoryId

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
  // Wave D — drop null (treat as "not provided") so Prisma keeps the
  // existing column value instead of trying to assign `null` to an
  // enum column.
  if (updateData.amortizationShape == null) {
    delete updateData.amortizationShape
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

  // Wave D — only touch ContractAmortizationSchedule when the caller
  // actually sent the shape field; otherwise downstream updates (tier
  // shape, product scope, etc.) would clobber previously-persisted
  // custom rows.
  if (
    termData.amortizationShape === "symmetrical" ||
    termData.amortizationShape === "custom"
  ) {
    await persistAmortizationRows({
      termId: id,
      contractId: term.contractId,
      shape: termData.amortizationShape,
      customRows: customAmortizationRows,
      capitalCost: termData.capitalCost ?? null,
      downPayment: termData.downPayment ?? null,
      interestRate: termData.interestRate ?? null,
      termMonths: termData.termMonths ?? null,
      paymentCadence: termData.paymentCadence ?? null,
    })
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
