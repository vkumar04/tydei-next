import { tool } from "ai"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

/**
 * AI Agent chat tools — auth-bound factory.
 *
 * SECURITY: These tools are exposed to a Claude model that obeys
 * user-supplied prompts. A naive static export of tools whose input
 * schemas accept `vendorId` / `facilityId` / `contractId` lets a user
 * social-engineer the model into reading another tenant's data
 * (confirmed exploited live during the 2026-04-26 audit).
 *
 * The fix: each tool's auth scope is bound at construction time via
 * `buildVendorChatTools(ctx)` / `buildFacilityChatTools(ctx)`. The
 * caller (the chat route) derives the tenant id from the session, NEVER
 * from the request body. Tools then use compound `where` clauses
 * (`{ id: contractId, vendorId: ctx.vendorId }`) so a foreign id silently
 * misses, returning `{ error: "Contract not found" }` instead of leaking.
 *
 * Tools that accept a `facilityId` (vendor side) verify the vendor has
 * an existing relationship with that facility before returning data —
 * vendors should not be able to enumerate facilities they don't sell to.
 *
 * Per `docs/architecture/role-model.md`:
 *   "Identity comes from requireX(), not from input."
 */

export type VendorChatToolContext = { vendorId: string; userId: string }
export type FacilityChatToolContext = { facilityId: string; userId: string }

// ─── Vendor-side tools ───────────────────────────────────────────
export function buildVendorChatTools(ctx: VendorChatToolContext) {
  return {
    getContractPerformance: tool({
      description:
        "Get contract spend, tier progress, and rebate data for a specific contract owned by your vendor",
      inputSchema: z.object({
        contractId: z.string().describe("The contract ID to analyze"),
      }),
      execute: async ({ contractId }) => {
        const contract = await prisma.contract.findFirst({
          where: { id: contractId, vendorId: ctx.vendorId },
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
      description:
        "Get market share breakdown for your vendor at a specific facility you have a relationship with",
      inputSchema: z.object({
        facilityId: z
          .string()
          .describe("The facility ID where you have an existing contract"),
      }),
      execute: async ({ facilityId }) => {
        // Defense-in-depth: confirm the vendor actually has a contract at
        // this facility before returning any data. Without this, a vendor
        // could enumerate facilities they have no business relationship with.
        const hasRel = await prisma.contract.count({
          where: { vendorId: ctx.vendorId, facilityId },
        })
        if (hasRel === 0) {
          return { error: "No relationship with that facility" }
        }

        const contracts = await prisma.contract.findMany({
          where: { vendorId: ctx.vendorId, facilityId, status: "active" },
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

    getRebateProjection: tool({
      description:
        "Get projected rebate for a contract's current period (must be your vendor's contract)",
      inputSchema: z.object({
        contractId: z.string().describe("The contract ID"),
      }),
      execute: async ({ contractId }) => {
        const latestPeriod = await prisma.contractPeriod.findFirst({
          where: { contractId, contract: { vendorId: ctx.vendorId } },
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
            ? toDisplayRebateValue(
                String(currentTier.rebateType ?? "percent_of_spend"),
                Number(currentTier.rebateValue),
              )
            : 0,
          rebateEarned: Number(latestPeriod.rebateEarned),
          nextTierSpendMin: nextTier ? Number(nextTier.spendMin) : null,
          spendToNextTier: nextTier
            ? Number(nextTier.spendMin ?? 0) - currentSpend
            : null,
        }
      },
    }),

    getAlertsSummary: tool({
      description:
        "Get a summary of active alerts for your vendor's contracts",
      inputSchema: z.object({}),
      execute: async () => {
        const alerts = await prisma.alert.findMany({
          where: {
            OR: [
              { vendorId: ctx.vendorId },
              { contract: { vendorId: ctx.vendorId } },
            ],
            status: "new_alert",
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            contract: { select: { name: true } },
            vendor: { select: { name: true } },
          },
        })

        const byType: Record<string, number> = {}
        const bySeverity: Record<string, number> = {}
        for (const a of alerts) {
          byType[a.alertType] = (byType[a.alertType] ?? 0) + 1
          bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1
        }

        return {
          totalActive: alerts.length,
          byType,
          bySeverity,
          topAlerts: alerts.slice(0, 5).map((a) => ({
            type: a.alertType,
            severity: a.severity,
            title: a.title,
            description: a.description,
            vendor: a.vendor?.name ?? null,
            contract: a.contract?.name ?? null,
            createdAt: a.createdAt.toISOString(),
          })),
        }
      },
    }),

    calculateProspectiveRebate: prospectiveRebateTool(),
  }
}

// ─── Facility-side tools ─────────────────────────────────────────
export function buildFacilityChatTools(ctx: FacilityChatToolContext) {
  return {
    getContractPerformance: tool({
      description:
        "Get contract spend, tier progress, and rebate data for a specific contract at your facility",
      inputSchema: z.object({
        contractId: z.string().describe("The contract ID to analyze"),
      }),
      execute: async ({ contractId }) => {
        const contract = await prisma.contract.findFirst({
          where: { id: contractId, facilityId: ctx.facilityId },
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

    getSpendAnalysis: tool({
      description:
        "Get spend analysis for your facility within a date range",
      inputSchema: z.object({
        startDate: z.string().describe("Start date YYYY-MM-DD"),
        endDate: z.string().describe("End date YYYY-MM-DD"),
      }),
      execute: async ({ startDate, endDate }) => {
        const periods = await prisma.contractPeriod.findMany({
          where: {
            contract: { facilityId: ctx.facilityId },
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
      description:
        "Get projected rebate for a contract's current period (must be a contract at your facility)",
      inputSchema: z.object({
        contractId: z.string().describe("The contract ID"),
      }),
      execute: async ({ contractId }) => {
        const latestPeriod = await prisma.contractPeriod.findFirst({
          where: {
            contractId,
            contract: { facilityId: ctx.facilityId },
          },
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
            ? toDisplayRebateValue(
                String(currentTier.rebateType ?? "percent_of_spend"),
                Number(currentTier.rebateValue),
              )
            : 0,
          rebateEarned: Number(latestPeriod.rebateEarned),
          nextTierSpendMin: nextTier ? Number(nextTier.spendMin) : null,
          spendToNextTier: nextTier
            ? Number(nextTier.spendMin ?? 0) - currentSpend
            : null,
        }
      },
    }),

    getSurgeonPerformance: tool({
      description:
        "Get surgeon-level performance metrics (case volume, total spend, margin, compliance) for your facility, optionally scoped to a specific surgeon name",
      inputSchema: z.object({
        surgeonName: z
          .string()
          .nullable()
          .describe("Optional surgeon name to scope to one surgeon"),
      }),
      execute: async ({ surgeonName }) => {
        const rows = await prisma.surgeonUsage.findMany({
          where: {
            facilityId: ctx.facilityId,
            ...(surgeonName ? { surgeonName: { contains: surgeonName } } : {}),
          },
          orderBy: { periodStart: "desc" },
          take: 50,
        })

        if (rows.length === 0) {
          return {
            surgeonName: surgeonName ?? "All Surgeons",
            caseVolume: 0,
            totalSpend: 0,
            complianceRate: 0,
            note: "No surgeon usage records found for this facility.",
          }
        }

        const totalSpend = rows.reduce(
          (sum, r) => sum + Number(r.usageAmount),
          0
        )
        const caseVolume = rows.reduce((sum, r) => sum + r.caseCount, 0)
        const avgCompliance =
          rows.reduce((sum, r) => sum + Number(r.complianceRate), 0) / rows.length

        return {
          surgeonName: surgeonName ?? "All Surgeons",
          caseVolume,
          totalSpend,
          complianceRate: Math.round(avgCompliance * 10) / 10,
          recentPeriods: rows.slice(0, 5).map((r) => ({
            surgeon: r.surgeonName,
            start: r.periodStart.toISOString().slice(0, 10),
            end: r.periodEnd.toISOString().slice(0, 10),
            cases: r.caseCount,
            spend: Number(r.usageAmount),
            compliance: Number(r.complianceRate),
          })),
        }
      },
    }),

    getAlertsSummary: tool({
      description:
        "Get a summary of active alerts for your facility, including a breakdown by type and severity",
      inputSchema: z.object({}),
      execute: async () => {
        const alerts = await prisma.alert.findMany({
          where: {
            OR: [
              { facilityId: ctx.facilityId },
              { contract: { facilityId: ctx.facilityId } },
            ],
            status: "new_alert",
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            contract: { select: { name: true } },
            vendor: { select: { name: true } },
          },
        })

        const byType: Record<string, number> = {}
        const bySeverity: Record<string, number> = {}
        for (const a of alerts) {
          byType[a.alertType] = (byType[a.alertType] ?? 0) + 1
          bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1
        }

        return {
          totalActive: alerts.length,
          byType,
          bySeverity,
          topAlerts: alerts.slice(0, 5).map((a) => ({
            type: a.alertType,
            severity: a.severity,
            title: a.title,
            description: a.description,
            vendor: a.vendor?.name ?? null,
            contract: a.contract?.name ?? null,
            createdAt: a.createdAt.toISOString(),
          })),
        }
      },
    }),

    getOptimizationSuggestions: tool({
      description: "Get rebate optimization suggestions for your facility",
      inputSchema: z.object({}),
      execute: async () => {
        const contracts = await prisma.contract.findMany({
          where: { facilityId: ctx.facilityId, status: "active" },
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
            const potentialRebate = toDisplayRebateValue(
              String(nextTier.rebateType ?? "percent_of_spend"),
              Number(nextTier.rebateValue ?? 0),
            )

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

    calculateProspectiveRebate: prospectiveRebateTool(),
  }
}

// ─── Pure-math tool (shared) ─────────────────────────────────────
// No DB access, no auth context needed. Shared between vendor + facility.
function prospectiveRebateTool() {
  return tool({
    description:
      "Calculate projected rebates for a prospective contract scenario, returning a yearly breakdown and totals",
    inputSchema: z.object({
      annualSpend: z.number().describe("Expected annual spend in dollars"),
      rebateRate: z.number().describe("Rebate percentage (e.g., 3 for 3%)"),
      contractYears: z
        .number()
        .describe("Contract length in years (e.g., 3)"),
      growthRate: z
        .number()
        .nullable()
        .describe("Annual growth rate as a percentage; null for no growth"),
    }),
    execute: async ({ annualSpend, rebateRate, contractYears, growthRate }) => {
      const growth = growthRate ?? 0
      let totalRebate = 0
      const yearlyBreakdown: Array<{
        year: number
        spend: number
        rebate: number
      }> = []

      for (let year = 1; year <= contractYears; year++) {
        const yearSpend =
          annualSpend * Math.pow(1 + growth / 100, year - 1)
        const yearRebate = yearSpend * (rebateRate / 100)
        totalRebate += yearRebate
        yearlyBreakdown.push({
          year,
          spend: Math.round(yearSpend),
          rebate: Math.round(yearRebate),
        })
      }

      return {
        totalProjectedRebate: Math.round(totalRebate),
        yearlyBreakdown,
        averageAnnualRebate: Math.round(totalRebate / contractYears),
      }
    },
  })
}
