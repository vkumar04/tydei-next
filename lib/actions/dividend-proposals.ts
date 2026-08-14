"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import {
  saveDividendProposalSchema,
  dividendProposalPayloadSchema,
  type DividendProposalPayload,
  type SaveDividendProposalInput,
} from "@/lib/validators/dividend-proposals"
import type { DividendVerdict } from "@/lib/financial-analysis/proforma-pnl"
import { resolveDividendProposalSummary } from "@/lib/financial-analysis/dividend-proposal-summary"

// Vendor-side Dividend/DCF proposals — every read and write is scoped to the
// caller's own vendor (tenant isolation invariant #1). Rows live in the
// dedicated DividendProposal table (ProposalEvaluation pattern: full scenario
// snapshot in `payload`, headline figures denormalized for the list).

export interface DividendProposalListItem {
  id: string
  name: string
  facilityKey: string | null
  facilityLabel: string
  verdict: DividendVerdict | null
  annualDividendImpact: number | null
  netPresentValue: number | null
  paybackYears: number | null
  noiImpact: number | null
  /** False when the stored payload could not drive the engine, so the five
   *  figures above are null and MUST NOT be rendered as numbers — a `?? 0`
   *  fallback prints "+$0", which reads as a real result. */
  recomputed: boolean
  createdAt: string
  updatedAt: string
}

export interface SavedDividendProposal extends DividendProposalListItem {
  payload: DividendProposalPayload
}

// The headline columns are deliberately not selected — see
// resolveDividendProposalSummary. Reading the payload makes staleness
// structurally impossible.
const LIST_SELECT = {
  id: true,
  name: true,
  facilityKey: true,
  facilityLabel: true,
  payload: true,
  createdAt: true,
  updatedAt: true,
} as const

type ListRow = {
  id: string
  name: string
  facilityKey: string | null
  facilityLabel: string
  payload: unknown
  createdAt: Date
  updatedAt: Date
}

function toListItem(row: ListRow): DividendProposalListItem {
  // Fields listed explicitly rather than spread so `payload` — and `vendorId`,
  // on the full-row findFirst path — cannot leak to the client.
  const summary = resolveDividendProposalSummary(row.payload)
  return {
    id: row.id,
    name: row.name,
    facilityKey: row.facilityKey,
    facilityLabel: row.facilityLabel,
    verdict: summary?.verdict ?? null,
    annualDividendImpact: summary?.annualDividendImpact ?? null,
    netPresentValue: summary?.netPresentValue ?? null,
    paybackYears: summary?.paybackYears ?? null,
    noiImpact: summary?.noiImpact ?? null,
    recomputed: summary !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listDividendProposals(): Promise<DividendProposalListItem[]> {
  const { vendor } = await requireVendor()
  const rows = await prisma.dividendProposal.findMany({
    where: { vendorId: vendor.id },
    select: LIST_SELECT,
    orderBy: { updatedAt: "desc" },
  })
  return serialize(rows.map(toListItem))
}

export async function getDividendProposal(
  id: string,
): Promise<SavedDividendProposal | null> {
  const { vendor } = await requireVendor()
  const row = await prisma.dividendProposal.findFirst({
    where: { id, vendorId: vendor.id },
  })
  if (!row) return null
  // Tolerant read: a payload that no longer parses (shape drift) is surfaced
  // as null rather than crashing the tab.
  const payload = dividendProposalPayloadSchema.safeParse(row.payload)
  if (!payload.success) {
    console.error("[getDividendProposal] stale payload shape", {
      vendorId: vendor.id,
      proposalId: id,
    })
    return null
  }
  return serialize({ ...toListItem(row), payload: payload.data })
}

export async function saveDividendProposal(
  input: SaveDividendProposalInput,
): Promise<DividendProposalListItem> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  const parsed = saveDividendProposalSchema.parse(input)

  try {
    // The client still posts `parsed.summary` for wire compatibility, but it is
    // not trusted: the columns are derived server-side by the same helper the
    // read path uses, so a stale client bundle cannot persist a figure that
    // disagrees with the payload.
    const summary = resolveDividendProposalSummary(parsed.payload)
    if (!summary) throw new Error("Invalid proposal payload")

    const data = {
      name: parsed.name,
      facilityKey: parsed.facilityKey,
      facilityLabel: parsed.facilityLabel,
      verdict: summary.verdict,
      annualDividendImpact: summary.annualDividendImpact,
      netPresentValue: summary.netPresentValue,
      paybackYears: summary.paybackYears,
      noiImpact: summary.noiImpact,
      payload: parsed.payload,
    }

    if (parsed.id) {
      const existing = await prisma.dividendProposal.findFirst({
        where: { id: parsed.id, vendorId: vendor.id },
        select: { id: true },
      })
      if (!existing) throw new Error("Proposal not found")
      // auth-scope-scanner-skip: row authorized via the vendor-scoped findFirst above
      const updated = await prisma.dividendProposal.update({
        where: { id: existing.id },
        data,
        select: LIST_SELECT,
      })
      return serialize(toListItem(updated))
    }

    const created = await prisma.dividendProposal.create({
      data: { ...data, vendorId: vendor.id },
      select: LIST_SELECT,
    })
    return serialize(toListItem(created))
  } catch (err) {
    console.error("[saveDividendProposal]", err, { vendorId: vendor.id })
    throw new Error(
      err instanceof Error &&
      (err.message === "Proposal not found" ||
        err.message === "Invalid proposal payload")
        ? err.message
        : "Failed to save the dividend proposal",
    )
  }
}

export async function deleteDividendProposal(id: string): Promise<void> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  try {
    const existing = await prisma.dividendProposal.findFirst({
      where: { id, vendorId: vendor.id },
      select: { id: true },
    })
    if (!existing) return
    // auth-scope-scanner-skip: row authorized via the vendor-scoped findFirst above
    await prisma.dividendProposal.delete({
      where: { id: existing.id },
    })
  } catch (err) {
    console.error("[deleteDividendProposal]", err, { vendorId: vendor.id })
    throw new Error("Failed to delete the dividend proposal")
  }
}
