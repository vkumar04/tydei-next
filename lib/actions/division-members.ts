"use server"

import { z } from "zod"
import { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCan } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { divisionInputSchema } from "@/lib/validators/divisions"

/**
 * Vendor division membership — super-user managed (Settings/Users feature).
 *
 * Divisions are vendor-scoped business units; a user is attached to zero or
 * more divisions within ONE vendor org via `DivisionMember`. Visibility
 * hard-scopes to attached divisions elsewhere; this module owns the CRUD.
 *
 * IDOR is the #1 invariant: every read AND write is scoped to the caller's
 * own vendor (`requireVendor().vendor.id`). Division ids and user ids passed
 * from the client are re-verified against that vendor before any mutation —
 * never a bare `where: { id }`. Writes additionally gate on
 * `requireCan("members.manage")` (only Super passes).
 *
 * `"use server"` files may only export async functions; the `interface`
 * declarations below are erased by the transform.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface DivisionMemberUser {
  id: string
  name: string
  email: string
}

export interface DivisionWithMembers {
  id: string
  name: string
  code: string
  categories: string[]
  isDefault: boolean
  members: DivisionMemberUser[]
}

// ─── Validators ──────────────────────────────────────────────────

const idSchema = z.string().min(1)

// ─── Reads ───────────────────────────────────────────────────────

/**
 * Every division in the caller's vendor org, each with its attached users.
 * Vendor-scoped via `requireVendor`.
 */
export async function getVendorDivisionsWithMembers(): Promise<DivisionWithMembers[]> {
  let vendorId: string | undefined
  try {
    const { vendor } = await requireVendor()
    vendorId = vendor.id

    const divisions = await prisma.vendorDivision.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        categories: true,
        isDefault: true,
        members: {
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    const rows: DivisionWithMembers[] = divisions.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      categories: d.categories,
      isDefault: d.isDefault,
      members: d.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
    }))

    return serialize(rows)
  } catch (err) {
    console.error("[getVendorDivisionsWithMembers]", err, { vendorId })
    throw err
  }
}

/**
 * The vendor org's members (User rows) eligible to be attached to a
 * division. Vendor-scoped: only members of the caller's vendor org.
 */
export async function getAttachableVendorUsers(): Promise<DivisionMemberUser[]> {
  let vendorId: string | undefined
  try {
    const { vendor } = await requireVendor()
    vendorId = vendor.id
    if (!vendor.organizationId) return []

    const members = await prisma.member.findMany({
      where: { organizationId: vendor.organizationId },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    })

    // De-dupe by user id (a user could theoretically hold >1 member row).
    const seen = new Set<string>()
    const users: DivisionMemberUser[] = []
    for (const m of members) {
      if (seen.has(m.user.id)) continue
      seen.add(m.user.id)
      users.push({ id: m.user.id, name: m.user.name, email: m.user.email })
    }

    return serialize(users)
  } catch (err) {
    console.error("[getAttachableVendorUsers]", err, { vendorId })
    throw err
  }
}

// ─── Division CRUD (Super only) ──────────────────────────────────

export async function createVendorDivision(input: {
  name: string
  code: string
  categories?: string[]
}): Promise<DivisionWithMembers> {
  let vendorId: string | undefined
  try {
    await requireCan("members.manage")
    const { vendor } = await requireVendor()
    vendorId = vendor.id

    const parsed = divisionInputSchema.parse(input)

    const created = await prisma.vendorDivision.create({
      data: {
        vendorId: vendor.id,
        name: parsed.name,
        code: parsed.code,
        categories: parsed.categories ?? [],
      },
      select: { id: true, name: true, code: true, categories: true, isDefault: true },
    })

    return serialize({ ...created, members: [] })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new Error(
        `A division with code "${input.code}" already exists in your organization.`,
      )
    }
    console.error("[createVendorDivision]", err, { vendorId })
    throw err
  }
}

export async function updateVendorDivision(input: {
  id: string
  name: string
  code: string
  categories?: string[]
}): Promise<DivisionWithMembers> {
  let vendorId: string | undefined
  try {
    await requireCan("members.manage")
    const { vendor } = await requireVendor()
    vendorId = vendor.id

    const id = idSchema.parse(input.id)
    const parsed = divisionInputSchema.parse(input)

    // IDOR guard: only update a division that belongs to the caller's
    // vendor. `updateMany` with a compound where returns count 0 (rather
    // than throwing) when the id isn't owned, so we can detect & reject.
    const result = await prisma.vendorDivision.updateMany({
      where: { id, vendorId: vendor.id },
      data: {
        name: parsed.name,
        code: parsed.code,
        categories: parsed.categories ?? [],
      },
    })
    if (result.count === 0) {
      throw new Error("Division not found")
    }

    const updated = await prisma.vendorDivision.findFirstOrThrow({
      where: { id, vendorId: vendor.id },
      select: {
        id: true,
        name: true,
        code: true,
        categories: true,
        isDefault: true,
        members: {
          select: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    return serialize({
      id: updated.id,
      name: updated.name,
      code: updated.code,
      categories: updated.categories,
      isDefault: updated.isDefault,
      members: updated.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new Error(
        `A division with code "${input.code}" already exists in your organization.`,
      )
    }
    console.error("[updateVendorDivision]", err, { vendorId })
    throw err
  }
}

export async function deleteVendorDivision(id: string): Promise<void> {
  let vendorId: string | undefined
  try {
    await requireCan("members.manage")
    const { vendor } = await requireVendor()
    vendorId = vendor.id

    const divisionId = idSchema.parse(id)

    // IDOR guard: scope the delete to the caller's vendor.
    const result = await prisma.vendorDivision.deleteMany({
      where: { id: divisionId, vendorId: vendor.id },
    })
    if (result.count === 0) {
      throw new Error("Division not found")
    }
  } catch (err) {
    console.error("[deleteVendorDivision]", err, { vendorId })
    throw err
  }
}

// ─── Member attach / detach (Super only) ─────────────────────────

/**
 * Attach a user to a division. IDOR guards (both re-verified server-side):
 *   1. the division belongs to the caller's vendor;
 *   2. the user is a member of the SAME vendor org (no cross-tenant attach).
 */
export async function attachUserToDivision(
  divisionId: string,
  userId: string,
): Promise<void> {
  let vendorId: string | undefined
  try {
    await requireCan("members.manage")
    const { vendor } = await requireVendor()
    vendorId = vendor.id

    const divId = idSchema.parse(divisionId)
    const uId = idSchema.parse(userId)

    await prisma.$transaction(async (tx) => {
      // Guard 1: division is in the caller's vendor.
      const division = await tx.vendorDivision.findFirst({
        where: { id: divId, vendorId: vendor.id },
        select: { id: true },
      })
      if (!division) throw new Error("Division not found")

      // Guard 2: user is a member of the caller's vendor org.
      if (!vendor.organizationId) {
        throw new Error("Vendor has no organization")
      }
      const member = await tx.member.findFirst({
        where: { userId: uId, organizationId: vendor.organizationId },
        select: { id: true },
      })
      if (!member) {
        throw new Error("User is not a member of your organization")
      }

      await tx.divisionMember.upsert({
        where: { divisionId_userId: { divisionId: divId, userId: uId } },
        create: { divisionId: divId, userId: uId },
        update: {},
      })
    })
  } catch (err) {
    console.error("[attachUserToDivision]", err, { vendorId, divisionId, userId })
    throw err
  }
}

/**
 * Detach a user from a division. IDOR guard: the division must belong to
 * the caller's vendor before any row is removed.
 */
export async function detachUserFromDivision(
  divisionId: string,
  userId: string,
): Promise<void> {
  let vendorId: string | undefined
  try {
    await requireCan("members.manage")
    const { vendor } = await requireVendor()
    vendorId = vendor.id

    const divId = idSchema.parse(divisionId)
    const uId = idSchema.parse(userId)

    await prisma.$transaction(async (tx) => {
      // IDOR guard: division belongs to the caller's vendor.
      const division = await tx.vendorDivision.findFirst({
        where: { id: divId, vendorId: vendor.id },
        select: { id: true },
      })
      if (!division) throw new Error("Division not found")

      await tx.divisionMember.deleteMany({
        where: { divisionId: divId, userId: uId },
      })
    })
  } catch (err) {
    console.error("[detachUserFromDivision]", err, { vendorId, divisionId, userId })
    throw err
  }
}
