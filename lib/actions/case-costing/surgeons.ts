"use server"

/**
 * Case-costing — surgeons tab server actions.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.0 (Subsystem 0)
 * and §4.2 (Subsystem 2 — Surgeons tab).
 *
 * Thin wrappers around pure helpers:
 *   - `deriveSurgeons` (lib/case-costing/surgeon-derivation.ts)
 *   - `computeFacilityAverages` (lib/case-costing/facility-averages.ts)
 *
 * This module is intentionally I/O-only: it loads Case rows scoped to the
 * active facility, maps them into the pure helper's input shape, and serializes
 * the result so it can cross the server/client boundary.
 *
 * Schema notes:
 *   - `Case` currently has no direct `payorType` column. Until the model grows
 *     one (or a `Payor` join), we pass `payorType: null` to `deriveSurgeons`;
 *     the pure helper handles null safely (distinct-payor tallies stay at 0).
 *   - `Case.timeInOr` / `timeOutOr` are `String?` (time-of-day); computing a
 *     true duration requires date-qualifying them. We leave
 *     `timeInOrMinutes` as null here so `computeFacilityAverages` reports a
 *     null `avgTimeInOrMinutes` rather than a garbage value.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import {
  deriveSurgeons,
  type CaseForDerivation,
  type Surgeon,
} from "@/lib/case-costing/surgeon-derivation"
import {
  computeFacilityAverages,
  type CaseForAverages,
  type FacilityAverages,
} from "@/lib/case-costing/facility-averages"

// ─── Surgeon scorecards ──────────────────────────────────────────

/**
 * Load the active facility's cases and produce aggregated surgeon scorecards.
 * Sorted by `overallScore` DESC (then `totalSpend` DESC) by the pure helper.
 */
export async function getSurgeonScorecardsForFacility(): Promise<Surgeon[]> {
  const { facility, user } = await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id },
    select: {
      surgeonName: true,
      primaryCptCode: true,
      totalSpend: true,
      totalReimbursement: true,
    },
  })

  const input: CaseForDerivation[] = cases
    .filter((c): c is typeof c & { surgeonName: string } =>
      c.surgeonName !== null && c.surgeonName !== "",
    )
    .map((c) => ({
      surgeonName: c.surgeonName,
      primaryCptCode: c.primaryCptCode,
      totalSpend: Number(c.totalSpend),
      totalReimbursement: Number(c.totalReimbursement),
      // Case.payorType does not exist on the current schema — see file header.
      payorType: null,
    }))

  const surgeons = deriveSurgeons({ cases: input })

  await logAudit({
    userId: user.id,
    action: "case_costing.surgeons_viewed",
    entityType: "facility",
    entityId: facility.id,
    metadata: {
      caseCount: input.length,
      surgeonCount: surgeons.length,
    },
  })

  return serialize(surgeons)
}

// ─── Facility averages ───────────────────────────────────────────

/**
 * Load the active facility's cases and compute baseline averages used as a
 * comparison benchmark (per-case cost, reimbursement, margin, OR time).
 */
export async function getFacilityAveragesForFacility(): Promise<FacilityAverages> {
  const { facility, user } = await requireFacility()

  // Charles 2026-04-25 (Bug 27): the case-list (`getCases`) backfills
  // each case's reimbursement from a live PayorContract.cptRates lookup
  // when `Case.totalReimbursement` is 0 (which it is for most seed
  // rows). The hero card was reading `totalReimbursement` raw and
  // therefore showing 0.0% Avg Margin while the per-case rows showed
  // real margins — a parity gap. Apply the same fallback here.
  const [cases, payorContracts] = await Promise.all([
    prisma.case.findMany({
      where: { facilityId: facility.id },
      select: {
        totalSpend: true,
        totalReimbursement: true,
        primaryCptCode: true,
        procedures: { select: { cptCode: true } },
      },
    }),
    prisma.payorContract.findMany({
      where: { facilityId: facility.id, status: "active" },
      select: { cptRates: true },
    }),
  ])

  const cptRateMap = new Map<string, number>()
  for (const pc of payorContracts) {
    const rates =
      (pc.cptRates as
        | Array<{ cpt?: string; cptCode?: string; rate: number }>
        | null) ?? []
    for (const r of rates) {
      const code = r.cptCode ?? r.cpt
      if (!code || typeof r.rate !== "number") continue
      const existing = cptRateMap.get(code)
      if (existing === undefined || r.rate > existing) {
        cptRateMap.set(code, r.rate)
      }
    }
  }

  const input: CaseForAverages[] = cases.map((c) => {
    const stored = Number(c.totalReimbursement)
    let computed = 0
    if (c.primaryCptCode && cptRateMap.has(c.primaryCptCode)) {
      computed = cptRateMap.get(c.primaryCptCode) ?? 0
    }
    for (const p of c.procedures) {
      if (p.cptCode && cptRateMap.has(p.cptCode)) {
        computed = Math.max(computed, cptRateMap.get(p.cptCode) ?? 0)
      }
    }
    return {
      totalSpend: Number(c.totalSpend),
      totalReimbursement: stored > 0 ? stored : computed,
      // Case.timeInOr is time-of-day (String?) — see file header.
      timeInOrMinutes: null,
    }
  })

  const averages = computeFacilityAverages({ cases: input })

  await logAudit({
    userId: user.id,
    action: "case_costing.facility_averages_viewed",
    entityType: "facility",
    entityId: facility.id,
    metadata: { caseCount: input.length },
  })

  return serialize(averages)
}
