"use server"

/**
 * Facility "Evaluate Proposals" persistence (2026-06-26).
 *
 * Replaces the prior localStorage-only store for scored proposal evaluations
 * with real DB rows (`ProposalEvaluation`), so a facility's evaluations survive
 * refresh / device, can be reopened in a detail dialog, and re-run. The rich
 * engine payload (input / result / clauseAnalysis — the UI `ScoredProposal`
 * shape) rides in the `payload` JSON column, mirroring how the vendor side
 * stores proposal data in `PendingContract.pricingData`.
 *
 * Every action is facility-scoped (`requireFacility` + `facilityId` predicate)
 * and mutations gate on `requireCanMutate` (read-only `user` tier blocked).
 */

import { z } from "zod"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import type {
  AnalyzeProposalInput,
  AnalyzeProposalResult,
  ClauseAnalysis,
} from "@/lib/actions/prospective-analysis"
import type { ProposalVerdictSignals } from "@/lib/prospective-analysis/proposal-verdict"

export type ProposalEvaluationSource = "upload" | "manual"

/**
 * A persisted scored proposal — same shape as the UI `ScoredProposal`
 * (`components/facility/analysis/prospective/types.ts`) so the tabs consume it
 * unchanged.
 */
export interface SavedProposalEvaluation {
  id: string
  vendorName: string
  createdAt: string
  source: ProposalEvaluationSource
  input: AnalyzeProposalInput
  result: AnalyzeProposalResult
  clauseAnalysis: ClauseAnalysis | null
  /** Lookback / pricing / legal summaries captured at score time (F-C3). */
  signals: ProposalVerdictSignals | null
}

export interface SaveProposalEvaluationInput {
  vendorName: string
  source: ProposalEvaluationSource
  input: AnalyzeProposalInput
  result: AnalyzeProposalResult
  clauseAnalysis: ClauseAnalysis | null
  signals?: ProposalVerdictSignals | null
}

// Validate only the envelope + the two denormalized fields. The deep
// input/result are engine-produced DISPLAY data (not fed to canonical
// reducers), so we validate the shape we read and persist the ORIGINAL payload
// un-stripped (a strict nested schema would drop the rest of the engine output).
const envelopeSchema = z.object({
  vendorName: z.string().min(1),
  source: z.enum(["upload", "manual"]),
  result: z.object({
    scores: z.object({ overall: z.number() }),
    recommendation: z.object({ verdict: z.string() }),
  }),
})

type EvaluationRow = {
  id: string
  vendorName: string
  source: string
  createdAt: Date
  payload: Prisma.JsonValue
}

// Structural guard for the READ path: the payload is engine-produced display
// data persisted as JSON, so a row written by an older shape (or hand-edited)
// must be dropped from the list instead of crashing every consumer on
// `result.scores.overall` (bug-bash F-C5). Mirrors what the UI dereferences.
const readPayloadSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  result: z.object({
    scores: z.object({ overall: z.number() }),
    recommendation: z.object({ verdict: z.string() }),
  }),
})

function rowToEvaluation(row: EvaluationRow): SavedProposalEvaluation | null {
  const p = (row.payload ?? {}) as {
    input?: unknown
    result?: unknown
    clauseAnalysis?: unknown
    signals?: unknown
  }
  if (!readPayloadSchema.safeParse(p).success) {
    console.error("[proposal-evaluations] dropping malformed payload", {
      id: row.id,
    })
    return null
  }
  return {
    id: row.id,
    vendorName: row.vendorName,
    createdAt: row.createdAt.toISOString(),
    source: row.source === "upload" ? "upload" : "manual",
    input: p.input as AnalyzeProposalInput,
    result: p.result as AnalyzeProposalResult,
    clauseAnalysis: (p.clauseAnalysis ?? null) as ClauseAnalysis | null,
    signals: (p.signals ?? null) as ProposalVerdictSignals | null,
  }
}

/** Write-path variant: the payload was envelope-validated this request, so a
 *  read-back failure is a programming error, not user data. */
function rowToEvaluationOrThrow(row: EvaluationRow): SavedProposalEvaluation {
  const evaluation = rowToEvaluation(row)
  if (!evaluation) throw new Error("Evaluation payload failed validation")
  return evaluation
}

function toPayload(input: SaveProposalEvaluationInput): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      input: input.input,
      result: input.result,
      clauseAnalysis: input.clauseAnalysis ?? null,
      signals: input.signals ?? null,
    }),
  ) as Prisma.InputJsonValue
}

export async function getProposalEvaluations(): Promise<
  SavedProposalEvaluation[]
> {
  const { facility } = await requireFacility()
  const rows = await prisma.proposalEvaluation.findMany({
    where: { facilityId: facility.id },
    orderBy: { createdAt: "desc" },
  })
  return serialize(
    rows
      .map(rowToEvaluation)
      .filter((e): e is SavedProposalEvaluation => e !== null),
  )
}

export async function saveProposalEvaluation(
  input: SaveProposalEvaluationInput,
): Promise<SavedProposalEvaluation> {
  const { facility } = await requireFacility()
  await requireCanMutate()
  envelopeSchema.parse({
    vendorName: input.vendorName,
    source: input.source,
    result: input.result,
  })
  const row = await prisma.proposalEvaluation.create({
    data: {
      facilityId: facility.id,
      vendorName: input.vendorName,
      source: input.source,
      overallScore: input.result.scores.overall,
      verdict: input.result.recommendation.verdict,
      payload: toPayload(input),
    },
  })
  return serialize(rowToEvaluationOrThrow(row))
}

export async function updateProposalEvaluation(
  id: string,
  input: SaveProposalEvaluationInput,
): Promise<SavedProposalEvaluation> {
  const { facility } = await requireFacility()
  await requireCanMutate()
  envelopeSchema.parse({
    vendorName: input.vendorName,
    source: input.source,
    result: input.result,
  })
  const existing = await prisma.proposalEvaluation.findFirst({
    where: { id, facilityId: facility.id },
    select: { id: true },
  })
  if (!existing) throw new Error("Evaluation not found")
  // auth-scope-scanner-skip: row authorized via the facility-scoped findFirst above
  const row = await prisma.proposalEvaluation.update({
    where: { id: existing.id },
    data: {
      vendorName: input.vendorName,
      // `source` is intentionally NOT updated: provenance is immutable — a
      // Manual-tab re-run of an uploaded evaluation must not flip its badge
      // to "Manual" or move it under deleteBySource("manual") (F-C1).
      overallScore: input.result.scores.overall,
      verdict: input.result.recommendation.verdict,
      payload: toPayload(input),
    },
  })
  return serialize(rowToEvaluationOrThrow(row))
}

export async function deleteProposalEvaluation(id: string): Promise<void> {
  const { facility } = await requireFacility()
  await requireCanMutate()
  // deleteMany scopes by facilityId — a foreign id deletes nothing (tenant-safe).
  await prisma.proposalEvaluation.deleteMany({
    where: { id, facilityId: facility.id },
  })
}

export async function deleteProposalEvaluationsBySource(
  source: ProposalEvaluationSource,
): Promise<void> {
  const { facility } = await requireFacility()
  await requireCanMutate()
  await prisma.proposalEvaluation.deleteMany({
    where: { facilityId: facility.id, source },
  })
}
