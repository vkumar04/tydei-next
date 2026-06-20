"use server"

import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import type { CreatePayorContractInput, UpdatePayorContractInput } from "@/lib/validators/payor-contracts"
import {
  createPayorContractSchema,
  updatePayorContractSchema,
  payorContractRateSchema,
} from "@/lib/validators/payor-contracts"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

export async function createFacilityPayorContract(input: CreatePayorContractInput) {
  const session = await requireFacility()
  await requireCanMutate()

  // Validate the client payload before any of it lands in the DB. NEVER spread
  // the raw input — a facility user must not be able to set `facilityId` (that
  // would re-home the row to another tenant); it always comes from the session.
  const parsed = createPayorContractSchema.parse(input)

  // contractNumber is NOT NULL + part of the unique(facilityId, payorName,
  // contractNumber) key, but executed amendments often have no agreement
  // number. Derive a stable, human-readable fallback so the upload can save
  // without forcing the user to invent one.
  const contractNumber =
    parsed.contractNumber?.trim() || `${parsed.payorName} (${parsed.effectiveDate})`

  // cptRates feeds the canonical buildCptRateMap/resolveCaseReimbursement
  // backfill — validate the array before the JSON write.
  const cptRates = z.array(payorContractRateSchema).parse(parsed.cptRates)
  const grouperRates = parsed.grouperRates

  const contract = await prisma.payorContract.create({
    data: {
      payorName: parsed.payorName,
      payorType: parsed.payorType,
      // Tenant scope is session-derived, NEVER from client input.
      facilityId: session.facility.id,
      contractNumber,
      effectiveDate: new Date(parsed.effectiveDate),
      expirationDate: new Date(parsed.expirationDate),
      status: parsed.status ?? "active",
      cptRates: JSON.parse(JSON.stringify(cptRates)),
      grouperRates: JSON.parse(JSON.stringify(grouperRates)),
      implantPassthrough: parsed.implantPassthrough,
      implantMarkup: parsed.implantMarkup,
      notes: parsed.notes,
      uploadedBy: session.user.id,
    },
  })

  await logAudit({
    userId: session.user.id,
    action: "payor_contract.created",
    entityType: "payorContract",
    entityId: contract.id,
    metadata: { payorName: parsed.payorName, cptRateCount: cptRates.length },
  })

  return serialize(contract)
}

export async function updateFacilityPayorContract(id: string, input: UpdatePayorContractInput) {
  const session = await requireFacility()
  await requireCanMutate()

  // Validate the partial payload. We assign fields explicitly below — NEVER
  // spread `input` into `data`: a raw spread lets the client set `facilityId`
  // (re-homing the row to another tenant) and writes `cptRates` JSON unvalidated.
  const parsed = updatePayorContractSchema.parse(input)

  // Explicit allow-list of assignable fields (NEVER spread input, NEVER
  // facilityId). Record<string, unknown> matches the admin twin's proven
  // shape and tolerates the JSON-column writes below.
  const data: Record<string, unknown> = {}
  if (parsed.payorName !== undefined) data.payorName = parsed.payorName
  if (parsed.payorType !== undefined) data.payorType = parsed.payorType
  if (parsed.contractNumber !== undefined) data.contractNumber = parsed.contractNumber
  if (parsed.status !== undefined) data.status = parsed.status
  if (parsed.implantPassthrough !== undefined)
    data.implantPassthrough = parsed.implantPassthrough
  if (parsed.implantMarkup !== undefined) data.implantMarkup = parsed.implantMarkup
  if (parsed.notes !== undefined) data.notes = parsed.notes
  if (parsed.effectiveDate) data.effectiveDate = new Date(parsed.effectiveDate)
  if (parsed.expirationDate) data.expirationDate = new Date(parsed.expirationDate)
  if (parsed.cptRates) {
    const cptRates = z.array(payorContractRateSchema).parse(parsed.cptRates)
    data.cptRates = JSON.parse(JSON.stringify(cptRates))
  }
  if (parsed.grouperRates) {
    data.grouperRates = JSON.parse(JSON.stringify(parsed.grouperRates))
  }
  // facilityId is intentionally never assignable here — tenant scope stays
  // pinned to the session via the compound where below.

  const contract = await prisma.payorContract.update({
    where: { id, facilityId: session.facility.id },
    data,
  })

  return serialize(contract)
}

export async function deleteFacilityPayorContract(id: string) {
  const session = await requireFacility()
  await requireCanMutate()

  await prisma.payorContract.delete({
    where: { id, facilityId: session.facility.id },
  })

  await logAudit({
    userId: session.user.id,
    action: "payor_contract.deleted",
    entityType: "payorContract",
    entityId: id,
  })
}

export async function importPayorContractRates(
  contractId: string,
  rates: { cptCode: string; description?: string; rate: number }[],
) {
  const session = await requireFacility()
  await requireCanMutate()

  // Validate the incoming rate rows before they reach the cptRates JSON column
  // — it feeds the canonical buildCptRateMap/resolveCaseReimbursement backfill.
  const validRates = z.array(payorContractRateSchema).parse(rates)

  const contract = await prisma.payorContract.findUniqueOrThrow({
    where: { id: contractId, facilityId: session.facility.id },
  })

  const existingRates =
    (contract.cptRates as { cptCode: string; description?: string; rate: number }[]) ?? []

  // Audit L20: dedupe on cptCode — re-importing a rate sheet must replace
  // the prior rate for a CPT, not append a second entry (downstream rate
  // maps would otherwise depend on iteration order). Newer rate wins.
  const merged = new Map<
    string,
    { cptCode: string; description?: string; rate: number }
  >()
  for (const r of existingRates) merged.set(r.cptCode, r)
  for (const r of validRates) merged.set(r.cptCode, r)
  const mergedRates = [...merged.values()]

  await prisma.payorContract.update({
    // auth-scope-scanner-skip: contractId ownership verified above via
    // findUniqueOrThrow({id, facilityId}) before this re-read by id.
    where: { id: contractId },
    data: { cptRates: JSON.parse(JSON.stringify(mergedRates)) },
  })

  return { imported: validRates.length, total: mergedRates.length }
}
