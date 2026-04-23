"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { revalidatePath } from "next/cache"
import { computeBundleStatus } from "@/lib/contracts/bundle-compute"
import { z } from "zod"

// ─── Schemas ───────────────────────────────────────────────────────

const bundleModeSchema = z.enum([
  "all_or_nothing",
  "proportional",
  "cross_vendor",
])

const memberInputSchema = z.object({
  contractId: z.string().min(1).optional(),
  vendorId: z.string().min(1).optional(),
  weightPercent: z.number().min(0).max(100).default(0),
  minimumSpend: z.number().min(0).optional(),
  rebateContribution: z.number().min(0).max(100).optional(),
})

const createBundleSchema = z.object({
  primaryContractId: z.string().min(1, "Primary contract is required"),
  complianceMode: bundleModeSchema,
  baseRate: z.number().min(0).max(100).optional(),
  bonusRate: z.number().min(0).max(100).optional(),
  acceleratorMultiplier: z.number().min(0).max(10).optional(),
  facilityBonusRate: z.number().min(0).max(100).optional(),
  effectiveStart: z.string().optional(),
  effectiveEnd: z.string().optional(),
  members: z.array(memberInputSchema).min(1, "At least one member required"),
})

export type CreateBundleInput = z.infer<typeof createBundleSchema>

// ─── Reads ─────────────────────────────────────────────────────────

export async function listBundles() {
  try {
    const { facility } = await requireFacility()
    const bundles = await prisma.tieInBundle.findMany({
      where: {
        primaryContract: {
          OR: [
            { facilityId: facility.id },
            { contractFacilities: { some: { facilityId: facility.id } } },
          ],
        },
      },
      include: {
        primaryContract: {
          select: {
            id: true,
            name: true,
            vendor: { select: { id: true, name: true } },
          },
        },
        _count: { select: { members: true } },
      },
      orderBy: { updatedAt: "desc" },
    })
    return serialize(bundles)
  } catch (err) {
    console.error("[listBundles]", err)
    throw err
  }
}

export async function getBundle(bundleId: string) {
  try {
    const { facility } = await requireFacility()
    const bundle = await prisma.tieInBundle.findUnique({
      where: { id: bundleId },
      include: {
        primaryContract: {
          select: {
            id: true,
            name: true,
            vendor: { select: { id: true, name: true } },
          },
        },
        members: {
          include: {
            contract: {
              select: {
                id: true,
                name: true,
                vendor: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    })
    if (!bundle) return null
    const status = await computeBundleStatus(prisma, bundleId, facility.id)
    return serialize({ bundle, status })
  } catch (err) {
    console.error("[getBundle]", err, { bundleId })
    throw err
  }
}

// ─── Writes ────────────────────────────────────────────────────────

export async function createBundle(input: CreateBundleInput) {
  try {
    await requireFacility()
    const data = createBundleSchema.parse(input)

    // Cross-vendor members must carry vendorId + rebateContribution.
    // All-or-nothing / proportional members must carry contractId.
    for (const m of data.members) {
      if (data.complianceMode === "cross_vendor") {
        if (!m.vendorId || m.rebateContribution == null) {
          throw new Error(
            "cross_vendor members require vendorId + rebateContribution",
          )
        }
      } else if (!m.contractId) {
        throw new Error(
          `${data.complianceMode} members require contractId`,
        )
      }
    }

    const bundle = await prisma.tieInBundle.create({
      data: {
        primaryContractId: data.primaryContractId,
        complianceMode: data.complianceMode,
        baseRate: data.baseRate,
        bonusRate: data.bonusRate,
        acceleratorMultiplier: data.acceleratorMultiplier,
        facilityBonusRate: data.facilityBonusRate,
        effectiveStart: data.effectiveStart
          ? new Date(data.effectiveStart)
          : null,
        effectiveEnd: data.effectiveEnd ? new Date(data.effectiveEnd) : null,
        members: {
          create: data.members.map((m) => ({
            contractId: m.contractId ?? null,
            vendorId: m.vendorId ?? null,
            weightPercent: m.weightPercent,
            minimumSpend: m.minimumSpend,
            rebateContribution: m.rebateContribution,
          })),
        },
      },
      select: { id: true },
    })
    revalidatePath("/dashboard/contracts/bundles")
    return serialize(bundle)
  } catch (err) {
    console.error("[createBundle]", err, {
      primaryContractId: input.primaryContractId,
    })
    throw err
  }
}

export async function deleteBundle(bundleId: string) {
  try {
    await requireFacility()
    await prisma.tieInBundleMember.deleteMany({ where: { bundleId } })
    await prisma.tieInBundle.delete({ where: { id: bundleId } })
    revalidatePath("/dashboard/contracts/bundles")
  } catch (err) {
    console.error("[deleteBundle]", err, { bundleId })
    throw err
  }
}
