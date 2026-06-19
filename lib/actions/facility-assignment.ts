"use server"

import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCan, getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"

/**
 * Per-user facility assignment — facility enterprise scoping (Settings/Users).
 *
 * A scoped facility user sees only the facilities assigned to them via
 * `FacilityAssignment`; an enterprise / Super user sees every facility in
 * their `HealthSystem`. Super users manage the assignment matrix.
 *
 * IDOR is the #1 invariant: every read/write is scoped to the caller's own
 * facility org + HealthSystem. The facility-universe is bounded to the
 * caller facility's `healthSystemId`, the user-universe to the caller's
 * org members, and writes re-verify BOTH the target facility (within the
 * HealthSystem) and the target user (in the caller's org) before touching
 * any row — never a bare `where: { id }`. Writes gate on
 * `requireCan("members.manage")` (only Super passes).
 *
 * `"use server"` files may only export async functions; the `interface`
 * declarations below are erased by the transform.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface AssignmentFacility {
  id: string
  name: string
}

export interface FacilityAssignmentUserRow {
  userId: string
  name: string
  email: string
  assignedFacilityIds: string[]
}

export interface FacilityAssignmentMatrix {
  /** Every facility in the caller facility's HealthSystem (the universe). */
  facilities: AssignmentFacility[]
  /** Every org user + the facilities currently assigned to them. */
  users: FacilityAssignmentUserRow[]
}

// ─── Validators ──────────────────────────────────────────────────

const idSchema = z.string().min(1)

// ─── Internal: enterprise facility universe ──────────────────────

/**
 * The set of facility ids in the same HealthSystem as the caller facility.
 * Always includes the caller's home facility (even when it has no
 * `healthSystemId`). Bounded — never returns every facility globally.
 */
async function enterpriseFacilityIds(
  homeFacilityId: string,
  healthSystemId: string | null,
): Promise<string[]> {
  if (!healthSystemId) return [homeFacilityId]
  const facilities = await prisma.facility.findMany({
    where: { healthSystemId },
    select: { id: true },
  })
  const ids = new Set(facilities.map((f) => f.id))
  ids.add(homeFacilityId)
  return [...ids]
}

// ─── Reads ───────────────────────────────────────────────────────

/**
 * The full assignment matrix for the caller's facility org: every user in
 * the org, their assigned facilities, plus the HealthSystem facility
 * universe to assign from. Facility-scoped via `requireFacility`.
 */
export async function getFacilityAssignments(): Promise<FacilityAssignmentMatrix> {
  let facilityId: string | undefined
  try {
    const { facility } = await requireFacility()
    facilityId = facility.id

    const universeIds = await enterpriseFacilityIds(facility.id, facility.healthSystemId)

    const [facilities, members] = await Promise.all([
      prisma.facility.findMany({
        where: { id: { in: universeIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      facility.organizationId
        ? prisma.member.findMany({
            where: { organizationId: facility.organizationId },
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  facilityAssignments: {
                    // Only surface assignments WITHIN this HealthSystem so a
                    // stray cross-tenant row never leaks into the matrix.
                    where: { facilityId: { in: universeIds } },
                    select: { facilityId: true },
                  },
                },
              },
            },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([]),
    ])

    const seen = new Set<string>()
    const users: FacilityAssignmentUserRow[] = []
    for (const m of members) {
      if (seen.has(m.user.id)) continue
      seen.add(m.user.id)
      users.push({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        assignedFacilityIds: m.user.facilityAssignments.map((a) => a.facilityId),
      })
    }

    return serialize({ facilities, users })
  } catch (err) {
    console.error("[getFacilityAssignments]", err, { facilityId })
    throw err
  }
}

/**
 * Resolve the caller's accessible facility set (the building block for
 * enterprise-scoped reads):
 *   - Super / enterprise tier → every facility in their HealthSystem;
 *   - otherwise → their `FacilityAssignment` set, ALWAYS including their
 *     home facility (so a scoped user can never be locked out of their own).
 *
 * Facility-scoped via `requireFacility`.
 */
export async function getCallerFacilityIds(): Promise<string[]> {
  let facilityId: string | undefined
  try {
    const session = await requireFacility()
    const { facility } = session
    facilityId = facility.id

    const ctx = await getCurrentAccessContext()
    const isEnterprise = ctx?.tier === "super"

    if (isEnterprise) {
      return enterpriseFacilityIds(facility.id, facility.healthSystemId)
    }

    const assignments = await prisma.facilityAssignment.findMany({
      where: { userId: session.user.id },
      select: { facilityId: true },
    })
    const ids = new Set(assignments.map((a) => a.facilityId))
    ids.add(facility.id)
    return [...ids]
  } catch (err) {
    console.error("[getCallerFacilityIds]", err, { facilityId })
    throw err
  }
}

// ─── Assign / unassign (Super only) ──────────────────────────────

/**
 * Assign a facility to a user. IDOR guards (re-verified server-side):
 *   1. the target facility is within the caller's HealthSystem universe;
 *   2. the target user is a member of the caller's facility org.
 */
export async function assignFacilityToUser(
  userId: string,
  targetFacilityId: string,
): Promise<void> {
  let facilityId: string | undefined
  try {
    await requireCan("members.manage")
    const { facility } = await requireFacility()
    facilityId = facility.id

    const uId = idSchema.parse(userId)
    const targetId = idSchema.parse(targetFacilityId)

    await prisma.$transaction(async (tx) => {
      // Guard 1: target facility is within the caller's HealthSystem.
      const universeIds = await enterpriseFacilityIds(
        facility.id,
        facility.healthSystemId,
      )
      if (!universeIds.includes(targetId)) {
        throw new Error("Facility is not within your health system")
      }

      // Guard 2: target user is a member of the caller's org.
      if (!facility.organizationId) {
        throw new Error("Facility has no organization")
      }
      const member = await tx.member.findFirst({
        where: { userId: uId, organizationId: facility.organizationId },
        select: { id: true },
      })
      if (!member) {
        throw new Error("User is not a member of your organization")
      }

      await tx.facilityAssignment.upsert({
        where: { userId_facilityId: { userId: uId, facilityId: targetId } },
        create: { userId: uId, facilityId: targetId },
        update: {},
      })
    })
  } catch (err) {
    console.error("[assignFacilityToUser]", err, {
      facilityId,
      userId,
      targetFacilityId,
    })
    throw err
  }
}

/**
 * Unassign a facility from a user. IDOR guards: the target facility must be
 * within the caller's HealthSystem AND the user in the caller's org before
 * any row is removed.
 */
export async function unassignFacilityFromUser(
  userId: string,
  targetFacilityId: string,
): Promise<void> {
  let facilityId: string | undefined
  try {
    await requireCan("members.manage")
    const { facility } = await requireFacility()
    facilityId = facility.id

    const uId = idSchema.parse(userId)
    const targetId = idSchema.parse(targetFacilityId)

    await prisma.$transaction(async (tx) => {
      const universeIds = await enterpriseFacilityIds(
        facility.id,
        facility.healthSystemId,
      )
      if (!universeIds.includes(targetId)) {
        throw new Error("Facility is not within your health system")
      }

      if (!facility.organizationId) {
        throw new Error("Facility has no organization")
      }
      const member = await tx.member.findFirst({
        where: { userId: uId, organizationId: facility.organizationId },
        select: { id: true },
      })
      if (!member) {
        throw new Error("User is not a member of your organization")
      }

      await tx.facilityAssignment.deleteMany({
        where: { userId: uId, facilityId: targetId },
      })
    })
  } catch (err) {
    console.error("[unassignFacilityFromUser]", err, {
      facilityId,
      userId,
      targetFacilityId,
    })
    throw err
  }
}
