/**
 * Tests for getRenewalAlertSettings / saveRenewalAlertSettings —
 * per-user renewal alert configuration actions (renewals-rewrite spec §4.2).
 *
 * Exercises default-row creation, upsert semantics, validation delegation,
 * and audit emission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface SettingsRow {
  id: string
  userId: string
  renewalReminderDaysBefore: number[]
  expirationAlertDays: number
  includeUnderperformingContracts: boolean
  includeOverperformingContracts: boolean
  notifyChannels: string[]
  createdAt: Date
  updatedAt: Date
}

let byUserId: Record<string, SettingsRow | null> = {}
let lastUpsert: Record<string, unknown> | null = null
let lastCreate: Record<string, unknown> | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    renewalAlertSettings: {
      findUnique: vi.fn(
        async ({ where }: { where: { userId: string } }) =>
          byUserId[where.userId] ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        lastCreate = data
        const row: SettingsRow = {
          id: "s-new",
          userId: data.userId as string,
          renewalReminderDaysBefore: data.renewalReminderDaysBefore as number[],
          expirationAlertDays: data.expirationAlertDays as number,
          includeUnderperformingContracts:
            data.includeUnderperformingContracts as boolean,
          includeOverperformingContracts:
            data.includeOverperformingContracts as boolean,
          notifyChannels: data.notifyChannels as string[],
          createdAt: new Date("2026-04-18T00:00:00Z"),
          updatedAt: new Date("2026-04-18T00:00:00Z"),
        }
        byUserId[row.userId] = row
        return row
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId: string }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          lastUpsert = { where, create, update }
          const existing = byUserId[where.userId]
          if (existing) {
            const merged: SettingsRow = {
              ...existing,
              ...(update as Partial<SettingsRow>),
              updatedAt: new Date("2026-04-19T00:00:00Z"),
            }
            byUserId[where.userId] = merged
            return merged
          }
          const row: SettingsRow = {
            id: "s-up",
            userId: where.userId,
            renewalReminderDaysBefore:
              create.renewalReminderDaysBefore as number[],
            expirationAlertDays: create.expirationAlertDays as number,
            includeUnderperformingContracts:
              create.includeUnderperformingContracts as boolean,
            includeOverperformingContracts:
              create.includeOverperformingContracts as boolean,
            notifyChannels: create.notifyChannels as string[],
            createdAt: new Date("2026-04-18T00:00:00Z"),
            updatedAt: new Date("2026-04-18T00:00:00Z"),
          }
          byUserId[where.userId] = row
          return row
        },
      ),
    },
  },
}))

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

import {
  getRenewalAlertSettings,
  saveRenewalAlertSettings,
} from "@/lib/actions/renewals/alert-settings"

beforeEach(() => {
  vi.clearAllMocks()
  byUserId = {}
  lastCreate = null
  lastUpsert = null
})

describe("getRenewalAlertSettings", () => {
  it("returns the existing row when one exists", async () => {
    byUserId["user-1"] = {
      id: "s-1",
      userId: "user-1",
      renewalReminderDaysBefore: [90, 30],
      expirationAlertDays: 45,
      includeUnderperformingContracts: false,
      includeOverperformingContracts: true,
      notifyChannels: ["email", "in_app"],
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    }

    const result = await getRenewalAlertSettings()
    expect(result.id).toBe("s-1")
    expect(result.renewalReminderDaysBefore).toEqual([90, 30])
    // serialize flattens Date → ISO string
    expect(typeof result.createdAt).toBe("string")
    // No create occurred
    expect(lastCreate).toBeNull()
  })

  it("creates a default row for first-time users", async () => {
    const result = await getRenewalAlertSettings()

    expect(lastCreate?.userId).toBe("user-1")
    expect(lastCreate?.renewalReminderDaysBefore).toEqual([180, 90, 30])
    expect(lastCreate?.expirationAlertDays).toBe(60)
    expect(lastCreate?.includeUnderperformingContracts).toBe(true)
    expect(lastCreate?.includeOverperformingContracts).toBe(false)
    expect(lastCreate?.notifyChannels).toEqual(["email"])
    expect(result.id).toBe("s-new")
  })
})

describe("saveRenewalAlertSettings", () => {
  it("upserts with normalized (descending-sorted) reminders and logs audit", async () => {
    await saveRenewalAlertSettings({
      renewalReminderDaysBefore: [30, 90, 180], // out of order
      expirationAlertDays: 30,
      includeUnderperformingContracts: true,
      includeOverperformingContracts: false,
      notifyChannels: ["email"],
    })

    const upsert = lastUpsert as {
      where: { userId: string }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(upsert.where.userId).toBe("user-1")
    expect(upsert.create.renewalReminderDaysBefore).toEqual([180, 90, 30])
    expect(upsert.update.renewalReminderDaysBefore).toEqual([180, 90, 30])

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "renewal.alert_settings_saved" }),
    )
  })

  it("throws when validation fails (bad reminders)", async () => {
    await expect(
      saveRenewalAlertSettings({
        renewalReminderDaysBefore: [],
        expirationAlertDays: 30,
        includeUnderperformingContracts: true,
        includeOverperformingContracts: false,
        notifyChannels: ["email"],
      }),
    ).rejects.toThrow(/non-empty/i)

    expect(lastUpsert).toBeNull()
    expect(logAuditMock).not.toHaveBeenCalled()
  })

  it("throws when notifyChannels contains an invalid channel", async () => {
    await expect(
      saveRenewalAlertSettings({
        renewalReminderDaysBefore: [30],
        expirationAlertDays: 30,
        includeUnderperformingContracts: true,
        includeOverperformingContracts: false,
        // @ts-expect-error — intentional bad input for test
        notifyChannels: ["carrier_pigeon"],
      }),
    ).rejects.toThrow(/notifyChannels/)
  })

  it("dedupes channel entries (first-wins)", async () => {
    await saveRenewalAlertSettings({
      renewalReminderDaysBefore: [30],
      expirationAlertDays: 30,
      includeUnderperformingContracts: true,
      includeOverperformingContracts: false,
      notifyChannels: ["email", "in_app", "email"],
    })

    const upsert = lastUpsert as {
      create: Record<string, unknown>
    }
    expect(upsert.create.notifyChannels).toEqual(["email", "in_app"])
  })

  it("updates an existing row without creating a duplicate", async () => {
    byUserId["user-1"] = {
      id: "s-1",
      userId: "user-1",
      renewalReminderDaysBefore: [60],
      expirationAlertDays: 30,
      includeUnderperformingContracts: false,
      includeOverperformingContracts: false,
      notifyChannels: ["email"],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await saveRenewalAlertSettings({
      renewalReminderDaysBefore: [120, 60],
      expirationAlertDays: 45,
      includeUnderperformingContracts: true,
      includeOverperformingContracts: true,
      notifyChannels: ["in_app"],
    })

    expect(byUserId["user-1"]?.id).toBe("s-1")
    expect(byUserId["user-1"]?.renewalReminderDaysBefore).toEqual([120, 60])
    expect(byUserId["user-1"]?.notifyChannels).toEqual(["in_app"])
  })
})
