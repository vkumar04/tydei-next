"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import {
  medicareRateOverrideSchema,
  medicareRateOverridesSchema,
} from "@/lib/validators/dividend-proposals"
import type { MedicareRateOverrideInput } from "@/lib/financial-analysis/medicare-asc-rates"

// Hand-entered AUTHORITATIVE Medicare rates. These beat both an uploaded rate
// table and the built-in estimate — see resolveMedicareAscRate. Vendor-scoped
// like every other Dividend/DCF surface.

export interface MedicareRateOverrideView extends MedicareRateOverrideInput {
  id: string
  updatedAt: string
}

export async function listMedicareRateOverrides(): Promise<
  MedicareRateOverrideView[]
> {
  const { vendor } = await requireVendor()
  const rows = await prisma.medicareRateOverride.findMany({
    where: { vendorId: vendor.id },
    orderBy: { group: "asc" },
  })
  return serialize(
    rows.map((r) => ({
      id: r.id,
      group: r.group,
      label: r.label ?? undefined,
      code: r.code,
      medicareRate: r.medicareRate,
      note: r.note ?? undefined,
      rateEntered: r.rateEntered,
      updatedAt: r.updatedAt.toISOString(),
    })),
  )
}

/**
 * Upsert one or more per-group overrides. Batched because the editor saves
 * every dirty row at once, and a partial save would leave the table in a
 * state the user did not intend.
 */
export async function saveMedicareRateOverrides(
  input: MedicareRateOverrideInput[],
): Promise<{ saved: number }> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const parsed = medicareRateOverridesSchema.parse(input)
  if (parsed.length === 0) return { saved: 0 }

  try {
    await prisma.$transaction(
      parsed.map((r) => {
        const group = r.group.trim()
        // A label equal to the group is not a rename — store nothing, so the
        // row keeps rendering the group and cannot drift out of sync.
        const label = r.label?.trim()
        const data = {
          label: label && label !== group ? label : null,
          code: r.code.trim(),
          medicareRate: Math.max(0, Math.round(r.medicareRate)),
          rateEntered: r.rateEntered !== false,
          note: r.note?.trim() || null,
          updatedBy: user.id,
        }
        return prisma.medicareRateOverride.upsert({
          where: { vendorId_group: { vendorId: vendor.id, group } },
          create: { ...data, vendorId: vendor.id, group },
          update: data,
        })
      }),
    )
    return { saved: parsed.length }
  } catch (err) {
    console.error("[saveMedicareRateOverrides]", err, { vendorId: vendor.id })
    throw new Error("Failed to save the Medicare rate changes")
  }
}

/** Revert one group to whatever the next tier down supplies. */
export async function removeMedicareRateOverride(group: string): Promise<void> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  const parsed = medicareRateOverrideSchema.shape.group.parse(group)
  try {
    // deleteMany, not delete: composite-unique + vendorId scoping in one
    // statement, and a no-op when the row is already gone.
    await prisma.medicareRateOverride.deleteMany({
      where: { vendorId: vendor.id, group: parsed.trim() },
    })
  } catch (err) {
    console.error("[removeMedicareRateOverride]", err, { vendorId: vendor.id })
    throw new Error("Failed to revert the Medicare rate")
  }
}

/** Clear every override, reverting the whole table to its lower tiers. */
export async function resetMedicareRateOverrides(): Promise<{ removed: number }> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  try {
    const { count } = await prisma.medicareRateOverride.deleteMany({
      where: { vendorId: vendor.id },
    })
    return { removed: count }
  } catch (err) {
    console.error("[resetMedicareRateOverrides]", err, { vendorId: vendor.id })
    throw new Error("Failed to reset the Medicare rates")
  }
}
