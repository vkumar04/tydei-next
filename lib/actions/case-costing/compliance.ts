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

export interface FacilityCaseComplianceResult {
  perCase: CaseComplianceResult[]
  summary: FacilityComplianceSummary
}

export async function getFacilityCaseCompliance(): Promise<FacilityCaseComplianceResult> {
  const { facility, user } = await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id },
    select: {
      id: true,
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

  const perCase = computeCaseCompliance(input)
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
