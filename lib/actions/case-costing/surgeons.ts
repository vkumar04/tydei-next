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
 *   - Payor data lives on `Case.payorClass` (audit M8 — an earlier note
 *     here claimed no payor column existed, which went stale once the
 *     schema grew `payorClass`). Raw classes are mapped to the canonical
 *     payor-mix buckets via `classifyPayorClass`, so `deriveSurgeons`'
 *     payorMixScore computes from real data.
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
import { classifyPayorClass } from "@/lib/case-costing/payor-mix"
import {
  buildCptRateMap,
  resolveCaseReimbursement,
} from "@/lib/case-costing/cpt-rate-map"

// ─── Surgeon scorecards ──────────────────────────────────────────

/**
 * Load the active facility's cases and produce aggregated surgeon scorecards.
 * Sorted by `overallScore` DESC (then `totalSpend` DESC) by the pure helper.
 */
export async function getSurgeonScorecardsForFacility(): Promise<Surgeon[]> {
  const { facility, user } = await requireFacility()

  // 2026-06-14: surgeon margin% read raw `totalReimbursement` (0 for most
  // rows) → every surgeon showed "—". Apply the SAME canonical CPT-rate
  // backfill the hero card + cases list use (`buildCptRateMap` +
  // `resolveCaseReimbursement`) so margin% reflects payor-contract rates.
  const [cases, payorContracts] = await Promise.all([
    prisma.case.findMany({
      where: { facilityId: facility.id },
      select: {
        surgeonName: true,
        primaryCptCode: true,
        payorClass: true,
        totalSpend: true,
        totalReimbursement: true,
        procedures: { select: { cptCode: true } },
      },
    }),
    prisma.payorContract.findMany({
      where: { facilityId: facility.id, status: "active" },
      select: { cptRates: true },
    }),
  ])

  const cptRateMap = buildCptRateMap(payorContracts)

  const input: CaseForDerivation[] = cases
    .filter((c): c is typeof c & { surgeonName: string } =>
      c.surgeonName !== null && c.surgeonName !== "",
    )
    .map((c) => ({
      surgeonName: c.surgeonName,
      primaryCptCode: c.primaryCptCode,
      totalSpend: Number(c.totalSpend),
      totalReimbursement: resolveCaseReimbursement(
        {
          storedReimbursement: Number(c.totalReimbursement),
          primaryCptCode: c.primaryCptCode,
          procedureCptCodes: c.procedures.map((p) => p.cptCode),
        },
        cptRateMap,
      ),
      // Audit M8: map Case.payorClass → canonical payor-mix bucket so
      // payorMixScore computes from real data instead of a hardcoded null.
      payorType: classifyPayorClass(c.payorClass),
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

  // Canonical CPT-rate map (audit H5) — shared with getCases, the
  // payor-margin calculator, and the case-costing report.
  const cptRateMap = buildCptRateMap(payorContracts)

  const input: CaseForAverages[] = cases.map((c) => ({
    totalSpend: Number(c.totalSpend),
    totalReimbursement: resolveCaseReimbursement(
      {
        storedReimbursement: Number(c.totalReimbursement),
        primaryCptCode: c.primaryCptCode,
        procedureCptCodes: c.procedures.map((p) => p.cptCode),
      },
      cptRateMap,
    ),
    // Case.timeInOr is time-of-day (String?) — see file header.
    timeInOrMinutes: null,
  }))

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
