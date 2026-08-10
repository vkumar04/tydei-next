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
  createdAt: string
  updatedAt: string
}

export interface SavedDividendProposal extends DividendProposalListItem {
  payload: DividendProposalPayload
}

const LIST_SELECT = {
  id: true,
  name: true,
  facilityKey: true,
  facilityLabel: true,
  verdict: true,
  annualDividendImpact: true,
  netPresentValue: true,
  paybackYears: true,
  noiImpact: true,
  createdAt: true,
  updatedAt: true,
} as const

type ListRow = {
  id: string
  name: string
  facilityKey: string | null
  facilityLabel: string
  verdict: string | null
  annualDividendImpact: number | null
  netPresentValue: number | null
  paybackYears: number | null
  noiImpact: number | null
  createdAt: Date
  updatedAt: Date
}

function toListItem(row: ListRow): DividendProposalListItem {
  return {
    ...row,
    verdict: (row.verdict as DividendVerdict | null) ?? null,
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
    const data = {
      name: parsed.name,
      facilityKey: parsed.facilityKey,
      facilityLabel: parsed.facilityLabel,
      verdict: parsed.summary.verdict,
      annualDividendImpact: parsed.summary.annualDividendImpact,
      netPresentValue: parsed.summary.netPresentValue,
      paybackYears: parsed.summary.paybackYears,
      noiImpact: parsed.summary.noiImpact,
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
      err instanceof Error && err.message === "Proposal not found"
        ? "Proposal not found"
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
