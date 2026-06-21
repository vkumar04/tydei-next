"use server"

import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { divisionInputSchema } from "@/lib/validators/divisions"

// ─── Types ───────────────────────────────────────────────────────

export interface VendorDivisionRow {
  id: string
  name: string
  code: string
  categories: string[]
}

// ─── Validators ──────────────────────────────────────────────────

const setVendorDivisionsSchema = z.array(divisionInputSchema)

// ─── Actions ─────────────────────────────────────────────────────

export async function getVendorDivisions(): Promise<VendorDivisionRow[]> {
  let vendorId: string | undefined
  try {
    const { vendor } = await requireVendor()
    vendorId = vendor.id

    const divisions = await prisma.vendorDivision.findMany({
      where: { vendorId: vendor.id },
      select: { id: true, name: true, code: true, categories: true },
      orderBy: { name: "asc" },
    })

    return serialize(divisions)
  } catch (err) {
    console.error("[getVendorDivisions]", err, { vendorId })
    throw err
  }
}

export async function setVendorDivisions(
  divisions: { name: string; code: string; categories?: string[] }[],
): Promise<void> {
  let vendorId: string | undefined
  try {
    const { vendor } = await requireVendor()
    vendorId = vendor.id
    await requireCanMutate()

    const parsed = setVendorDivisionsSchema.parse(divisions)

    await prisma.$transaction([
      prisma.vendorDivision.deleteMany({ where: { vendorId: vendor.id } }),
      prisma.vendorDivision.createMany({
        data: parsed.map((d) => ({
          vendorId: vendor.id,
          name: d.name,
          code: d.code,
          categories: d.categories ?? [],
        })),
      }),
    ])
  } catch (err) {
    console.error("[setVendorDivisions]", err, { vendorId })
    throw err
  }
}
