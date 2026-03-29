"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"

// ─── Admin Dashboard Stats ──────────────────────────────────────

export async function getAdminDashboardStats() {
  await requireAdmin()

  const [totalFacilities, totalVendors, totalUsers, totalContracts, activeSubscriptions] =
    await Promise.all([
      prisma.facility.count(),
      prisma.vendor.count(),
      prisma.user.count(),
      prisma.contract.count({ where: { status: "active" } }),
      prisma.facility.count({ where: { status: "active" } }),
    ])

  return {
    totalFacilities,
    totalVendors,
    totalUsers,
    totalContracts,
    mrr: activeSubscriptions * 499, // placeholder MRR calc
    activeSubscriptions,
  }
}

// ─── Recent Activity ────────────────────────────────────────────

export interface ActivityEntry {
  id: string
  type: "user_created" | "facility_created" | "contract_created" | "alert"
  description: string
  timestamp: string
}

export async function getAdminRecentActivity(limit = 10): Promise<ActivityEntry[]> {
  await requireAdmin()

  const [recentUsers, recentContracts] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: Math.ceil(limit / 2) }),
    prisma.contract.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.ceil(limit / 2),
      include: { vendor: { select: { name: true } } },
    }),
  ])

  const entries: ActivityEntry[] = [
    ...recentUsers.map((u) => ({
      id: u.id,
      type: "user_created" as const,
      description: `New user registered: ${u.name} (${u.email})`,
      timestamp: u.createdAt.toISOString(),
    })),
    ...recentContracts.map((c) => ({
      id: c.id,
      type: "contract_created" as const,
      description: `Contract created: ${c.name} with ${c.vendor.name}`,
      timestamp: c.createdAt.toISOString(),
    })),
  ]

  return entries
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}

// ─── Pending Actions ────────────────────────────────────────────

export async function getAdminPendingActions() {
  await requireAdmin()

  const now = new Date()
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [newFacilitySetups, trialExpirations, failedPayments] = await Promise.all([
    prisma.facility.count({ where: { status: "pending" } }),
    prisma.contract.count({
      where: {
        status: "active",
        expirationDate: { lte: thirtyDaysOut, gte: now },
      },
    }),
    prisma.alert.count({
      where: { alertType: "payment_due", status: "new_alert" },
    }),
  ])

  return { newFacilitySetups, trialExpirations, failedPayments }
}
