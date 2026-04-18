/**
 * Tests for the live-data alerts server actions
 * (synthesizeAndPersistAlerts, bulkUpdateAlerts, markAllAlertsRead,
 * getRankedAlerts) — the subsystem-4 pipeline that wires the pure
 * helpers in lib/alerts/* onto Prisma.
 *
 * Exercises ownership scoping, legal-transition filtering, priority
 * ranking from stored metadata, and create/resolve delta application.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type AlertRow = {
  id: string
  facilityId: string
  portalType: string
  alertType: string
  title: string
  description: string | null
  severity: "low" | "medium" | "high"
  status: "new_alert" | "read" | "resolved" | "dismissed"
  contractId: string | null
  vendorId: string | null
  metadata: Record<string, unknown>
  actionLink: string | null
  createdAt: Date
  readAt: Date | null
  resolvedAt: Date | null
  dismissedAt: Date | null
}

// ─── In-memory fixtures ──────────────────────────────────────────

let alertRows: AlertRow[] = []
let cogRows: Array<Record<string, unknown>> = []
let contractRows: Array<Record<string, unknown>> = []
let periodRows: Array<Record<string, unknown>> = []

const createdAlerts: Array<Record<string, unknown>> = []
const updatedAlerts: Array<{ id: string; data: Record<string, unknown> }> = []

// ─── Prisma mock ─────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    alert: {
      findMany: vi.fn(
        async ({ where }: { where?: Record<string, unknown> } = {}) => {
          const w = (where ?? {}) as {
            facilityId?: string
            status?:
              | AlertRow["status"]
              | { in?: AlertRow["status"][] }
            portalType?: string
            id?: { in?: string[] }
          }
          return alertRows
            .filter((r) =>
              w.facilityId === undefined ? true : r.facilityId === w.facilityId,
            )
            .filter((r) =>
              w.portalType === undefined ? true : r.portalType === w.portalType,
            )
            .filter((r) => {
              if (w.status === undefined) return true
              if (typeof w.status === "string") return r.status === w.status
              const list = w.status.in
              return list ? list.includes(r.status) : true
            })
            .filter((r) => {
              if (w.id === undefined) return true
              return w.id.in ? w.id.in.includes(r.id) : true
            })
        },
      ),
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          createdAlerts.push(data)
          const row: AlertRow = {
            id: `new-${createdAlerts.length}`,
            facilityId: (data.facilityId as string) ?? "",
            portalType: (data.portalType as string) ?? "facility",
            alertType: (data.alertType as string) ?? "other",
            title: (data.title as string) ?? "",
            description: (data.description as string) ?? null,
            severity:
              (data.severity as AlertRow["severity"]) ?? "medium",
            status: "new_alert",
            contractId: (data.contractId as string | null) ?? null,
            vendorId: (data.vendorId as string | null) ?? null,
            metadata: (data.metadata as Record<string, unknown>) ?? {},
            actionLink: (data.actionLink as string | null) ?? null,
            createdAt: new Date(),
            readAt: null,
            resolvedAt: null,
            dismissedAt: null,
          }
          alertRows.push(row)
          return row
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; facilityId?: string }
          data: Record<string, unknown>
        }) => {
          const row = alertRows.find(
            (r) =>
              r.id === where.id &&
              (where.facilityId === undefined ||
                r.facilityId === where.facilityId),
          )
          if (!row) throw new Error(`alert ${where.id} not found`)
          updatedAlerts.push({ id: where.id, data })
          Object.assign(row, data)
          return row
        },
      ),
    },
    cOGRecord: {
      findMany: vi.fn(async () => cogRows),
    },
    contract: {
      findMany: vi.fn(async () => contractRows),
    },
    contractPeriod: {
      findMany: vi.fn(async () => periodRows),
    },
    $transaction: vi.fn(
      async (ops: Promise<unknown>[]) => Promise.all(ops),
    ),
  },
}))

// ─── auth + audit mocks ──────────────────────────────────────────

const requireFacilityMock = vi.fn(async () => ({
  facility: { id: "fac-1" },
  user: { id: "user-1" },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: () => requireFacilityMock(),
}))

const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))

// generate-alerts helpers reach into a lot of the schema; stub them
// because the new actions don't need them but they're imported at the
// top of lib/actions/alerts.ts.
vi.mock("@/lib/alerts/generate-alerts", () => ({
  generateExpiringContractAlerts: vi.fn(async () => []),
  generateTierThresholdAlerts: vi.fn(async () => []),
  generateOffContractAlerts: vi.fn(async () => []),
  generateRebateDueAlerts: vi.fn(async () => []),
}))

vi.mock("@/lib/actions/notifications", () => ({
  sendAlertNotification: vi.fn(async () => undefined),
}))

// ─── Imports under test ──────────────────────────────────────────

import {
  bulkUpdateAlerts,
  markAllAlertsRead,
  getRankedAlerts,
  synthesizeAndPersistAlerts,
} from "@/lib/actions/alerts"

// ─── Fixture factories ───────────────────────────────────────────

function mkAlert(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: "a-1",
    facilityId: "fac-1",
    portalType: "facility",
    alertType: "off_contract",
    title: "Sample",
    description: null,
    severity: "medium",
    status: "new_alert",
    contractId: null,
    vendorId: null,
    metadata: {},
    actionLink: null,
    createdAt: new Date("2026-04-10T00:00:00Z"),
    readAt: null,
    resolvedAt: null,
    dismissedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  alertRows = []
  cogRows = []
  contractRows = []
  periodRows = []
  createdAlerts.length = 0
  updatedAlerts.length = 0
})

// ─── bulkUpdateAlerts ────────────────────────────────────────────

describe("bulkUpdateAlerts", () => {
  it("all-transitionable → all updated", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "new_alert" }),
      mkAlert({ id: "a-2", status: "new_alert" }),
      mkAlert({ id: "a-3", status: "read" }),
    ]
    const result = await bulkUpdateAlerts({
      alertIds: ["a-1", "a-2", "a-3"],
      action: "resolve",
    })
    expect(result.updated).toBe(3)
    expect(result.skipped).toBe(0)
    const statuses = alertRows.map((r) => r.status).sort()
    expect(statuses).toEqual(["resolved", "resolved", "resolved"])
    expect(alertRows.every((r) => r.resolvedAt !== null)).toBe(true)
  })

  it("mixed → some skipped (dismissed can't go back)", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "new_alert" }),
      mkAlert({ id: "a-2", status: "dismissed" }), // terminal
      mkAlert({ id: "a-3", status: "read" }),
    ]
    const result = await bulkUpdateAlerts({
      alertIds: ["a-1", "a-2", "a-3"],
      action: "resolve",
    })
    expect(result.updated).toBe(2)
    expect(result.skipped).toBe(1)
    expect(alertRows.find((r) => r.id === "a-2")?.status).toBe("dismissed")
  })

  it("skips mark_read on already-read rows", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "new_alert" }),
      mkAlert({ id: "a-2", status: "read" }),
    ]
    const result = await bulkUpdateAlerts({
      alertIds: ["a-1", "a-2"],
      action: "mark_read",
    })
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(1)
    expect(alertRows.find((r) => r.id === "a-1")?.status).toBe("read")
    expect(alertRows.find((r) => r.id === "a-1")?.readAt).not.toBeNull()
  })

  it("does not touch alerts belonging to another facility", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "new_alert" }),
      mkAlert({ id: "a-foreign", facilityId: "fac-2", status: "new_alert" }),
    ]
    const result = await bulkUpdateAlerts({
      alertIds: ["a-1", "a-foreign"],
      action: "dismiss",
    })
    expect(result.updated).toBe(1)
    // Foreign row is counted as skipped (not owned by facility).
    expect(result.skipped).toBe(1)
    expect(alertRows.find((r) => r.id === "a-foreign")?.status).toBe(
      "new_alert",
    )
    expect(alertRows.find((r) => r.id === "a-foreign")?.dismissedAt).toBeNull()
  })

  it("returns zeroes on empty input", async () => {
    const result = await bulkUpdateAlerts({
      alertIds: [],
      action: "resolve",
    })
    expect(result).toEqual({ updated: 0, skipped: 0 })
  })

  it("writes an audit log entry", async () => {
    alertRows = [mkAlert({ id: "a-1", status: "new_alert" })]
    await bulkUpdateAlerts({ alertIds: ["a-1"], action: "dismiss" })
    expect(logAuditMock).toHaveBeenCalled()
    const call = logAuditMock.mock.calls[0][0]
    expect(call.action).toBe("alerts.bulk_dismiss")
    expect(call.entityType).toBe("alert")
  })
})

// ─── markAllAlertsRead ───────────────────────────────────────────

describe("markAllAlertsRead", () => {
  it("only updates new_alert rows", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "new_alert" }),
      mkAlert({ id: "a-2", status: "new_alert" }),
      mkAlert({ id: "a-3", status: "read" }),
      mkAlert({ id: "a-4", status: "resolved" }),
      mkAlert({ id: "a-5", status: "dismissed" }),
    ]
    const result = await markAllAlertsRead()
    expect(result.updated).toBe(2)
    expect(alertRows.find((r) => r.id === "a-1")?.status).toBe("read")
    expect(alertRows.find((r) => r.id === "a-2")?.status).toBe("read")
    expect(alertRows.find((r) => r.id === "a-1")?.readAt).not.toBeNull()
    // Non-new_alert statuses untouched.
    expect(alertRows.find((r) => r.id === "a-3")?.status).toBe("read")
    expect(alertRows.find((r) => r.id === "a-4")?.status).toBe("resolved")
    expect(alertRows.find((r) => r.id === "a-5")?.status).toBe("dismissed")
  })

  it("does not touch another facility's new_alert rows", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "new_alert" }),
      mkAlert({ id: "a-foreign", facilityId: "fac-2", status: "new_alert" }),
    ]
    const result = await markAllAlertsRead()
    expect(result.updated).toBe(1)
    expect(alertRows.find((r) => r.id === "a-foreign")?.status).toBe(
      "new_alert",
    )
  })

  it("is a no-op when nothing unread", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "read" }),
      mkAlert({ id: "a-2", status: "resolved" }),
    ]
    const result = await markAllAlertsRead()
    expect(result.updated).toBe(0)
  })
})

// ─── getRankedAlerts ─────────────────────────────────────────────

describe("getRankedAlerts", () => {
  it("sorts high severity + big dollar impact above low severity", async () => {
    const now = new Date("2026-04-18T00:00:00Z")
    alertRows = [
      mkAlert({
        id: "a-low",
        severity: "low",
        alertType: "tier_threshold",
        metadata: { amount_needed: 100 },
        createdAt: now,
      }),
      mkAlert({
        id: "a-high",
        severity: "high",
        alertType: "off_contract",
        metadata: { total_amount: 200_000 },
        createdAt: now,
      }),
      mkAlert({
        id: "a-med",
        severity: "medium",
        alertType: "rebate_due",
        metadata: { amount: 10_000 },
        createdAt: now,
      }),
    ]
    const ranked = await getRankedAlerts({ limit: 10 })
    expect(ranked.map((r) => r.id)).toEqual(["a-high", "a-med", "a-low"])
    // dollar impact extracted from the typed metadata fields
    expect(ranked[0].dollarImpact).toBe(200_000)
    expect(ranked[1].dollarImpact).toBe(10_000)
  })

  it("applies age decay — newer alerts beat older ones at equal severity", async () => {
    const now = new Date()
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000)
    alertRows = [
      mkAlert({
        id: "a-old",
        severity: "medium",
        alertType: "rebate_due",
        metadata: { amount: 1_000 },
        createdAt: old,
      }),
      mkAlert({
        id: "a-new",
        severity: "medium",
        alertType: "rebate_due",
        metadata: { amount: 1_000 },
        createdAt: now,
      }),
    ]
    const ranked = await getRankedAlerts({ limit: 10 })
    expect(ranked[0].id).toBe("a-new")
    expect(ranked[1].id).toBe("a-old")
    expect(ranked[0].priorityScore).toBeGreaterThan(ranked[1].priorityScore)
  })

  it("honours the limit option", async () => {
    alertRows = Array.from({ length: 5 }, (_, i) =>
      mkAlert({ id: `a-${i}`, severity: "high", alertType: "off_contract" }),
    )
    const ranked = await getRankedAlerts({ limit: 2 })
    expect(ranked).toHaveLength(2)
  })

  it("filters by status when provided", async () => {
    alertRows = [
      mkAlert({ id: "a-1", status: "new_alert" }),
      mkAlert({ id: "a-2", status: "resolved" }),
    ]
    const ranked = await getRankedAlerts({ statusFilter: "resolved" })
    expect(ranked.map((r) => r.id)).toEqual(["a-2"])
  })

  it("excludes alerts owned by other facilities", async () => {
    alertRows = [
      mkAlert({ id: "a-1", facilityId: "fac-1", severity: "high" }),
      mkAlert({ id: "a-foreign", facilityId: "fac-2", severity: "high" }),
    ]
    const ranked = await getRankedAlerts({ limit: 10 })
    expect(ranked.map((r) => r.id)).toEqual(["a-1"])
  })
})

// ─── synthesizeAndPersistAlerts ──────────────────────────────────

describe("synthesizeAndPersistAlerts", () => {
  it("creates new alerts for novel conditions and resolves stale ones", async () => {
    // An expiring contract that should trigger a new alert.
    const expDate = new Date()
    expDate.setDate(expDate.getDate() + 30) // 30 days out
    contractRows = [
      {
        id: "c-1",
        name: "Widget Supply",
        status: "active",
        expirationDate: expDate,
        annualValue: 500_000,
        vendorId: "v-1",
        vendor: { name: "Acme" },
        terms: [],
        periods: [],
      },
    ]
    cogRows = []
    periodRows = []
    // A stale existing alert whose dedupeKey will NOT be in keepKeys →
    // should get resolved.
    alertRows = [
      mkAlert({
        id: "stale-1",
        alertType: "off_contract",
        status: "new_alert",
        metadata: { dedupeKey: "off_contract:v-gone:po-gone" },
      }),
    ]

    const result = await synthesizeAndPersistAlerts()
    expect(result.created).toBe(1)
    expect(result.resolved).toBe(1)
    // Stale alert is now resolved in the store.
    const stale = alertRows.find((r) => r.id === "stale-1")
    expect(stale?.status).toBe("resolved")
    expect(stale?.resolvedAt).not.toBeNull()
    // A new alert row exists for the expiring contract.
    const created = alertRows.find((r) => r.id.startsWith("new-"))
    expect(created?.alertType).toBe("expiring_contract")
    expect(created?.contractId).toBe("c-1")
    expect(logAuditMock).toHaveBeenCalled()
  })

  it("is a no-op when state matches existing alerts", async () => {
    contractRows = []
    cogRows = []
    periodRows = []
    alertRows = []
    const result = await synthesizeAndPersistAlerts()
    expect(result).toEqual({ created: 0, resolved: 0 })
  })

  it("only pulls data scoped to the caller's facility", async () => {
    const { prisma } = await import("@/lib/db")
    contractRows = []
    cogRows = []
    periodRows = []
    alertRows = []
    await synthesizeAndPersistAlerts()
    // Confirm every query filter used facilityId = fac-1.
    const contractCall = (prisma.contract.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0]
    expect(contractCall.where.facilityId).toBe("fac-1")
    const cogCall = (prisma.cOGRecord.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0]
    expect(cogCall.where.facilityId).toBe("fac-1")
    const periodCall = (
      prisma.contractPeriod.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0]
    expect(periodCall.where.facilityId).toBe("fac-1")
    const alertCall = (prisma.alert.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0]
    expect(alertCall.where.facilityId).toBe("fac-1")
  })
})
