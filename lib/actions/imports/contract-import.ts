"use server"

/**
 * Ingest AI-extracted contracts.
 *
 * Extracted from lib/actions/mass-upload.ts during F16 tech debt split.
 */
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import type { RichContractExtractData } from "@/lib/ai/schemas"
import { normalizeAIRebateValue } from "@/lib/contracts/rebate-value-normalize"
import {
  findOrCreateVendorByName,
  toContractType,
  toPerfPeriod,
  toTermType,
  toRebateType,
  toSafeDate,
} from "./shared"

export type IngestContractInput = {
  extracted: RichContractExtractData
  sourceFilename?: string
  s3Key?: string
}

export type IngestContractResult =
  | { ok: true; contractId: string; name: string }
  | { ok: false; error: string; name: string }

export async function ingestExtractedContracts(
  items: IngestContractInput[],
): Promise<{
  created: number
  failed: number
  results: IngestContractResult[]
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const results: IngestContractResult[] = []

  for (const item of items) {
    const { extracted, sourceFilename } = item
    const displayName =
      extracted.contractName ||
      sourceFilename?.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ") ||
      "Untitled Contract"

    try {
      const vendorId = await findOrCreateVendorByName(
        extracted.vendorName,
        extracted.vendorDivision,
      )

      const today = new Date()
      const inOneYear = new Date(
        today.getFullYear() + 1,
        today.getMonth(),
        today.getDate(),
      )
      const effectiveDate = toSafeDate(extracted.effectiveDate, today)
      const expirationDate = toSafeDate(extracted.expirationDate, inOneYear)

      const contract = await prisma.contract.create({
        data: {
          name: displayName,
          contractNumber: extracted.contractId ?? null,
          vendorId,
          facilityId,
          contractType: toContractType(extracted.contractType),
          status: "active",
          effectiveDate,
          expirationDate,
          totalValue: extracted.tieInDetails?.capitalEquipmentValue ?? 0,
          description:
            extracted.specialConditions && extracted.specialConditions.length > 0
              ? extracted.specialConditions.join(" · ")
              : null,
          rebatePayPeriod: toPerfPeriod(extracted.rebatePayPeriod) ?? "quarterly",
          isGrouped: extracted.isGroupedContract ?? false,
          isMultiFacility:
            (extracted.facilities && extracted.facilities.length > 1) ?? false,
          createdById: userId,
          contractFacilities: {
            create: [{ facilityId }],
          },
          ...(extracted.terms && extracted.terms.length > 0
            ? {
                terms: {
                  create: extracted.terms.map((term) => ({
                    termName: term.termName,
                    termType: toTermType(term.termType),
                    effectiveStart: toSafeDate(term.effectiveFrom, effectiveDate),
                    effectiveEnd: toSafeDate(term.effectiveTo, expirationDate),
                    evaluationPeriod: term.performancePeriod ?? "annual",
                    paymentTiming: extracted.rebatePayPeriod ?? "quarterly",
                    ...(term.tiers && term.tiers.length > 0
                      ? {
                          tiers: {
                            create: term.tiers.map((tier) => {
                              const rebateType = toRebateType(tier.rebateType)
                              return {
                                tierNumber: tier.tierNumber ?? 1,
                                spendMin: tier.spendMin ?? 0,
                                spendMax: tier.spendMax ?? null,
                                volumeMin: tier.volumeMin ?? null,
                                volumeMax: tier.volumeMax ?? null,
                                marketShareMin: tier.marketShareMin ?? null,
                                marketShareMax: tier.marketShareMax ?? null,
                                rebateType,
                                // Charles R5.25 — AI often returns whole
                                // percent (3) but the DB stores
                                // percent_of_spend as a fraction (0.03).
                                rebateValue: normalizeAIRebateValue(
                                  rebateType,
                                  tier.rebateValue,
                                ),
                              }
                            }),
                          },
                        }
                      : {}),
                  })),
                },
              }
            : {}),
        },
        select: { id: true, name: true },
      })

      await logAudit({
        userId,
        action: "contract.imported_via_mass_upload",
        entityType: "contract",
        entityId: contract.id,
        metadata: {
          vendorName: extracted.vendorName,
          sourceFilename: sourceFilename ?? null,
        },
      })

      results.push({ ok: true, contractId: contract.id, name: contract.name })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[ingestExtractedContracts] failure:", err)
      results.push({ ok: false, error: message.slice(0, 4000), name: displayName })
    }
  }

  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")

  const created = results.filter((r) => r.ok).length
  const failed = results.length - created
  return serialize({ created, failed, results })
}
