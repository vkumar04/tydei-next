"use server"

/**
 * Case-costing — compliance server action.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md
 * (Subsystem 0 — contract compliance rollup).
 *
 * Thin wrapper around the pure helpers in `lib/case-costing/compliance.ts`.
 * Loads the active facility's cases with their supplies (including the
 * pre-enriched `isOnContract` flag, which is maintained by the COG
 * enrichment pipeline) and returns both per-case and facility-summary views.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import {
  computeCaseCompliance,
  summarizeFacilityCompliance,
  type CaseForCompliance,
  type CaseComplianceResult,
  type FacilityComplianceSummary,
} from "@/lib/case-costing/compliance"

export interface CaseComplianceWithNumber extends CaseComplianceResult {
  /** Human-readable case number (audit L19 — the table showed cuids). */
  caseNumber: string
  /** Surgeon on the case (Charles 2026-06-18 — per-case surgeon column). */
  surgeonName: string | null
}

export interface FacilityCaseComplianceResult {
  perCase: CaseComplianceWithNumber[]
  summary: FacilityComplianceSummary
}

export async function getFacilityCaseCompliance(): Promise<FacilityCaseComplianceResult> {
  const { facility, user } = await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id },
    select: {
      id: true,
      caseNumber: true,
      surgeonName: true,
      supplies: {
        select: {
          vendorItemNo: true,
          isOnContract: true,
          extendedCost: true,
        },
      },
    },
  })

  const input: CaseForCompliance[] = cases.map((c) => ({
    caseId: c.id,
    supplies: c.supplies.map((s) => ({
      vendorItemNo: s.vendorItemNo,
      isOnContract: s.isOnContract,
      extendedCost: Number(s.extendedCost),
    })),
  }))

  const caseNumberById = new Map(cases.map((c) => [c.id, c.caseNumber]))
  const surgeonNameById = new Map(cases.map((c) => [c.id, c.surgeonName]))
  const perCase: CaseComplianceWithNumber[] = computeCaseCompliance(
    input,
  ).map((r) => ({
    ...r,
    caseNumber: caseNumberById.get(r.caseId) ?? r.caseId,
    surgeonName: surgeonNameById.get(r.caseId) ?? null,
  }))
  const summary = summarizeFacilityCompliance(perCase)

  await logAudit({
    userId: user.id,
    action: "case_costing.compliance_viewed",
    entityType: "facility",
    entityId: facility.id,
    metadata: {
      caseCount: input.length,
      casesWithLowCompliance: summary.casesWithLowCompliance,
    },
  })

  return serialize({ perCase, summary })
}
