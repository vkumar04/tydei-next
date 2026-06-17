"use server"

import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import type {
  CreatePayorContractInput,
  UpdatePayorContractInput,
  PayorContractRate,
} from "@/lib/validators/payor-contracts"
import { serialize } from "@/lib/serialize"

// Tolerate the dual CPT-rate shape that the canonical rate-map builder
// (`buildCptRateMap` / `resolveCaseReimbursement` in
// lib/case-costing/cpt-rate-map.ts) reads: seeded payor JSON uses
// `{cpt, rate, description}`, a future relational migration may use
// `{cptCode, rate}`. At least one of cpt/cptCode is required and rate
// must be a finite number — otherwise the row would silently poison the
// canonical reimbursement backfill. Rows that fail are dropped (see
// importCPTRates), matching the lenient ingest convention.
const importCptRateRowSchema = z
  .object({
    cpt: z.string().min(1).optional(),
    cptCode: z.string().min(1).optional(),
    rate: z.number().finite(),
    description: z.string().optional(),
    effectiveDate: z.string().optional(),
  })
  .refine((r) => Boolean(r.cpt) || Boolean(r.cptCode), {
    message: "each rate row needs a cpt or cptCode",
  })

type ImportCptRateRow = z.infer<typeof importCptRateRowSchema>

// ─── List Payor Contracts ───────────────────────────────────────

export async function getPayorContracts(input: {
  facilityId?: string
  status?: string
  page?: number
  pageSize?: number
}) {
  await requireAdmin()
  const { facilityId, status, page = 1, pageSize = 20 } = input

  const where: Record<string, unknown> = {}
  if (facilityId) where.facilityId = facilityId
  if (status) where.status = status

  const [contracts, total] = await Promise.all([
    prisma.payorContract.findMany({
      where,
      include: { facility: { select: { name: true } } },
      orderBy: { uploadedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.payorContract.count({ where }),
  ])

  return serialize({
    contracts: contracts.map((c) => ({
      ...c,
      effectiveDate: c.effectiveDate.toISOString(),
      expirationDate: c.expirationDate.toISOString(),
      uploadedAt: c.uploadedAt.toISOString(),
      implantMarkup: Number(c.implantMarkup),
      facilityName: c.facility.name,
    })),
    total,
  })
}

// ─── Create Payor Contract ──────────────────────────────────────

export async function createPayorContract(input: CreatePayorContractInput) {
  await requireAdmin()

  const contract = await prisma.payorContract.create({
    data: {
      payorName: input.payorName,
      payorType: input.payorType,
      facilityId: input.facilityId,
      contractNumber: input.contractNumber,
      effectiveDate: new Date(input.effectiveDate),
      expirationDate: new Date(input.expirationDate),
      status: input.status ?? "active",
      cptRates: JSON.parse(JSON.stringify(input.cptRates)),
      grouperRates: JSON.parse(JSON.stringify(input.grouperRates)),
      implantPassthrough: input.implantPassthrough,
      implantMarkup: input.implantMarkup,
      notes: input.notes,
    },
  })
  return serialize(contract)
}

// ─── Update Payor Contract ──────────────────────────────────────

export async function updatePayorContract(id: string, input: UpdatePayorContractInput) {
  await requireAdmin()

  const data: Record<string, unknown> = { ...input }
  if (input.effectiveDate) data.effectiveDate = new Date(input.effectiveDate)
  if (input.expirationDate) data.expirationDate = new Date(input.expirationDate)
  if (input.cptRates) data.cptRates = JSON.parse(JSON.stringify(input.cptRates))
  if (input.grouperRates) data.grouperRates = JSON.parse(JSON.stringify(input.grouperRates))

  const contract = await prisma.payorContract.update({ where: { id }, data })
  return serialize(contract)
}

// ─── Delete Payor Contract ──────────────────────────────────────

export async function deletePayorContract(id: string) {
  await requireAdmin()

  await prisma.payorContract.delete({ where: { id } })
}

// ─── Import CPT Rates ───────────────────────────────────────────

export async function importCPTRates(contractId: string, rates: PayorContractRate[]) {
  await requireAdmin()

  // Validate before this JSON lands in the `cptRates` column — it feeds
  // the canonical `buildCptRateMap`/`resolveCaseReimbursement` backfill,
  // which silently skips malformed rows (no code, or a non-number rate).
  // Reject when the payload isn't an array at all; otherwise drop
  // individual malformed rows so one bad row can't poison the column
  // (and a single bad row doesn't reject an otherwise-good import).
  if (!Array.isArray(rates)) {
    throw new Error("importCPTRates: rates must be an array")
  }
  const validRates: ImportCptRateRow[] = []
  for (const row of rates) {
    const parsed = importCptRateRowSchema.safeParse(row)
    if (parsed.success) validRates.push(parsed.data)
  }
  const skipped = rates.length - validRates.length

  const contract = await prisma.payorContract.findUniqueOrThrow({
    where: { id: contractId },
  })

  const existingRates = (contract.cptRates as unknown as ImportCptRateRow[]) ?? []
  const mergedRates = [...existingRates, ...validRates]

  await prisma.payorContract.update({
    where: { id: contractId },
    data: { cptRates: JSON.parse(JSON.stringify(mergedRates)) },
  })

  return { imported: validRates.length, skipped }
}

// ─── Assign to Facility ─────────────────────────────────────────

export async function assignPayorContractToFacility(contractId: string, facilityId: string) {
  await requireAdmin()

  await prisma.payorContract.update({
    where: { id: contractId },
    data: { facilityId },
  })
}
