import { tool } from "ai"
import { z } from "zod"
import { prisma } from "@/lib/db"

export const chatTools = {
  getContractPerformance: tool({
    description:
      "Get contract spend, tier progress, and rebate data for a specific contract",
    inputSchema: z.object({
      contractId: z.string().describe("The contract ID to analyze"),
    }),
    execute: async ({ contractId }) => {
      const contract = await prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          vendor: { select: { name: true } },
          terms: { include: { tiers: true } },
          periods: { orderBy: { periodStart: "desc" }, take: 4 },
        },
      })
      if (!contract) return { error: "Contract not found" }

      return {
        name: contract.name,
        vendor: contract.vendor.name,
        status: contract.status,
        type: contract.contractType,
        effectiveDate: contract.effectiveDate.toISOString().slice(0, 10),
        expirationDate: contract.expirationDate.toISOString().slice(0, 10),
        termsCount: contract.terms.length,
        recentPeriods: contract.periods.map((p) => ({
          start: p.periodStart.toISOString().slice(0, 10),
          end: p.periodEnd.toISOString().slice(0, 10),
          spend: Number(p.totalSpend),
          rebateEarned: Number(p.rebateEarned),
          currentTier: p.tierAchieved,
        })),
      }
    },
  }),

  getMarketShareAnalysis: tool({
    description: "Get market share breakdown for a vendor at a facility",
    inputSchema: z.object({
      vendorId: z.string().describe("The vendor ID"),
      facilityId: z.string().describe("The facility ID"),
    }),
    execute: async ({ vendorId, facilityId }) => {
      const contracts = await prisma.contract.findMany({
        where: { vendorId, facilityId, status: "active" },
        include: {
          periods: { orderBy: { periodStart: "desc" }, take: 1 },
          productCategory: { select: { name: true } },
        },
      })

      const totalSpend = contracts.reduce(
        (sum, c) => sum + Number(c.periods[0]?.totalSpend ?? 0),
        0
      )

      return {
        contractCount: contracts.length,
        totalSpend,
        categories: contracts.map((c) => ({
          category: c.productCategory?.name ?? "Uncategorized",
          spend: Number(c.periods[0]?.totalSpend ?? 0),
          contract: c.name,
        })),
      }
    },
  }),

  getSpendAnalysis: tool({
    description: "Get spend analysis for a facility within a date range",
    inputSchema: z.object({
      facilityId: z.string().describe("The facility ID"),
      startDate: z.string().describe("Start date YYYY-MM-DD"),
      endDate: z.string().describe("End date YYYY-MM-DD"),
    }),
    execute: async ({ facilityId, startDate, endDate }) => {
      const periods = await prisma.contractPeriod.findMany({
        where: {
          contract: { facilityId },
          periodStart: { gte: new Date(startDate) },
          periodEnd: { lte: new Date(endDate) },
        },
        include: {
          contract: {
            include: {
              vendor: { select: { name: true } },
              productCategory: { select: { name: true } },
            },
          },
        },
      })

      const byVendor: Record<string, number> = {}
      const byCategory: Record<string, number> = {}
      let total = 0

      for (const p of periods) {
        const spend = Number(p.totalSpend)
        total += spend
        const vendor = p.contract.vendor.name
        const category = p.contract.productCategory?.name ?? "Uncategorized"
        byVendor[vendor] = (byVendor[vendor] ?? 0) + spend
        byCategory[category] = (byCategory[category] ?? 0) + spend
      }

      return { totalSpend: total, byVendor, byCategory }
    },
  }),

  getRebateProjection: tool({
    description: "Get projected rebate for a contract's current period",
    inputSchema: z.object({
      contractId: z.string().describe("The contract ID"),
    }),
    execute: async ({ contractId }) => {
      const latestPeriod = await prisma.contractPeriod.findFirst({
        where: { contractId },
        orderBy: { periodStart: "desc" },
        include: {
          contract: {
            include: {
              terms: {
                include: { tiers: { orderBy: { tierNumber: "asc" } } },
              },
            },
          },
        },
      })

      if (!latestPeriod) return { error: "No performance period found" }

      const currentSpend = Number(latestPeriod.totalSpend)
      const term = latestPeriod.contract.terms[0]
      const tiers = term?.tiers ?? []
      const currentTier = tiers.find(
        (t) =>
          currentSpend >= Number(t.spendMin ?? 0) &&
          (t.spendMax === null || currentSpend <= Number(t.spendMax))
      )
      const nextTier = tiers.find(
        (t) => Number(t.spendMin ?? 0) > currentSpend
      )

      return {
        currentSpend,
        currentTierNumber: currentTier?.tierNumber ?? 0,
        currentRebateValue: currentTier
          ? Number(currentTier.rebateValue)
          : 0,
        rebateEarned: Number(latestPeriod.rebateEarned),
        nextTierSpendMin: nextTier ? Number(nextTier.spendMin) : null,
        spendToNextTier: nextTier
          ? Number(nextTier.spendMin ?? 0) - currentSpend
          : null,
      }
    },
  }),

  getOptimizationSuggestions: tool({
    description: "Get rebate optimization suggestions for a facility",
    inputSchema: z.object({
      facilityId: z.string().describe("The facility ID"),
    }),
    execute: async ({ facilityId }) => {
      const contracts = await prisma.contract.findMany({
        where: { facilityId, status: "active" },
        include: {
          vendor: { select: { name: true } },
          terms: {
            include: { tiers: { orderBy: { tierNumber: "asc" } } },
          },
          periods: { orderBy: { periodStart: "desc" }, take: 1 },
        },
      })

      const suggestions = contracts
        .map((c) => {
          const spend = Number(c.periods[0]?.totalSpend ?? 0)
          const term = c.terms[0]
          const tiers = term?.tiers ?? []
          const nextTier = tiers.find(
            (t) => Number(t.spendMin ?? 0) > spend
          )

          if (!nextTier) return null

          const gap = Number(nextTier.spendMin ?? 0) - spend
          const potentialRebate = Number(nextTier.rebateValue ?? 0)

          return {
            contract: c.name,
            vendor: c.vendor.name,
            currentSpend: spend,
            spendToNextTier: gap,
            nextTierRebateValue: potentialRebate,
          }
        })
        .filter(Boolean)

      return { suggestions }
    },
  }),
}
