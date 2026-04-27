"use server"

import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface VendorDivisionRow {
  id: string
  name: string
  code: string
  categories: string[]
}

// ─── Validators ──────────────────────────────────────────────────

const divisionItemSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  categories: z.array(z.string()).optional().default([]),
})

const setVendorDivisionsSchema = z.array(divisionItemSchema)

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
