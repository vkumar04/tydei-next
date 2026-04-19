/**
 * Tests for getRenewalTasks / toggleRenewalTask — facility-side
 * renewal checklist persistence (plans/2026-04-19-renewals-v0-parity.md W1.6).
 *
 * Asserts:
 *   - Merge-read fills missing rows with computed auto-completion
 *   - Toggle upsert creates rows and stamps completedBy/At
 *   - Uncomplete clears completedBy/At
 *   - Idempotent: toggling twice to the same value remains correct
 *   - Ownership guard: unknown contract → [] for read, throws on write
 *   - Unknown taskKey throws
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface ContractRow {
  id: string
}

interface TaskRow {
  id: string
  contractId: string
  taskKey: string
  completed: boolean
  completedBy: string | null
  completedAt: Date | null
  completer: { id: string; name: string } | null
}

let contractRows: ContractRow[] = []
let taskRows: TaskRow[] = []
let upsertCalls: Array<Record<string, unknown>> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; OR?: unknown } }) =>
          contractRows.find((c) => c.id === where.id) ?? null,
      ),
    },
    renewalTask: {
      findMany: vi.fn(
        async ({ where }: { where: { contractId: string } }) =>
          taskRows.filter((t) => t.contractId === where.contractId),
      ),
      upsert: vi.fn(
        async (args: {
          where: { contractId_taskKey: { contractId: string; taskKey: string } }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          upsertCalls.push(args as unknown as Record<string, unknown>)
          const { contractId, taskKey } = args.where.contractId_taskKey
          const existing = taskRows.find(
            (t) => t.contractId === contractId && t.taskKey === taskKey,
          )
          if (existing) {
            const update = args.update as {
              completed: boolean
              completedBy: string | null
              completedAt: Date | null
            }
            existing.completed = update.completed
            existing.completedBy = update.completedBy
            existing.completedAt = update.completedAt
            existing.completer = update.completedBy
              ? { id: update.completedBy, name: `User ${update.completedBy}` }
              : null
            return existing
          }
          const create = args.create as {
            contractId: string
            taskKey: string
            completed: boolean
            completedBy: string | null
            completedAt: Date | null
          }
          const row: TaskRow = {
            id: `task-row-${taskRows.length + 1}`,
            contractId: create.contractId,
            taskKey: create.taskKey,
            completed: create.completed,
            completedBy: create.completedBy,
            completedAt: create.completedAt,
            completer: create.completedBy
              ? { id: create.completedBy, name: `User ${create.completedBy}` }
              : null,
          }
          taskRows.push(row)
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
  getRenewalTasks,
  toggleRenewalTask,
} from "@/lib/actions/renewals/tasks"

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  taskRows = []
  upsertCalls = []
  requireFacilityMock.mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })
})

describe("getRenewalTasks", () => {
  it("returns [] when the facility doesn't own the contract", async () => {
    contractRows = []
    const result = await getRenewalTasks("c-1", 90)
    expect(result).toEqual([])
  })

  it("returns 5 tasks keyed with stable keys, all un-persisted by default", async () => {
    contractRows = [{ id: "c-1" }]
    const result = await getRenewalTasks("c-1", 0)
    expect(result).toHaveLength(5)
    expect(result.map((r) => r.key)).toEqual([
      "review-performance",
      "analyze-market-pricing",
      "prepare-negotiation-strategy",
      "draft-renewal-terms",
      "schedule-renewal-meeting",
    ])
    expect(result.every((r) => r.persisted === false)).toBe(true)
    expect(result.every((r) => r.completed === false)).toBe(true)
  })

  it("applies auto-complete fallback from commitmentMet when no rows persisted", async () => {
    contractRows = [{ id: "c-1" }]
    const result = await getRenewalTasks("c-1", 95)
    expect(
      result.find((r) => r.key === "review-performance")?.completed,
    ).toBe(true)
    expect(
      result.find((r) => r.key === "analyze-market-pricing")?.completed,
    ).toBe(true)
    expect(
      result.find((r) => r.key === "prepare-negotiation-strategy")?.completed,
    ).toBe(false)
  })

  it("persisted rows override the auto-complete fallback", async () => {
    contractRows = [{ id: "c-1" }]
    taskRows = [
      {
        id: "r-1",
        contractId: "c-1",
        taskKey: "review-performance",
        completed: false, // explicitly un-complete despite commitmentMet=100
        completedBy: null,
        completedAt: null,
        completer: null,
      },
      {
        id: "r-2",
        contractId: "c-1",
        taskKey: "draft-renewal-terms",
        completed: true,
        completedBy: "user-7",
        completedAt: new Date("2026-04-18T12:00:00Z"),
        completer: { id: "user-7", name: "Alex Example" },
      },
    ]
    const result = await getRenewalTasks("c-1", 100)
    const review = result.find((r) => r.key === "review-performance")
    expect(review?.persisted).toBe(true)
    expect(review?.completed).toBe(false)

    const draft = result.find((r) => r.key === "draft-renewal-terms")
    expect(draft?.persisted).toBe(true)
    expect(draft?.completed).toBe(true)
    expect(draft?.completedById).toBe("user-7")
    expect(draft?.completedByName).toBe("Alex Example")
  })
})

describe("toggleRenewalTask", () => {
  it("creates a row with completedBy/completedAt when completed=true", async () => {
    contractRows = [{ id: "c-1" }]
    const result = await toggleRenewalTask({
      contractId: "c-1",
      taskKey: "prepare-negotiation-strategy",
      completed: true,
    })
    expect(result.persisted).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.completedById).toBe("user-1")
    expect(result.completedAt).not.toBeNull()
    expect(taskRows).toHaveLength(1)
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "renewal.task_completed" }),
    )
  })

  it("clears completedBy/completedAt when toggled back to false", async () => {
    contractRows = [{ id: "c-1" }]
    await toggleRenewalTask({
      contractId: "c-1",
      taskKey: "prepare-negotiation-strategy",
      completed: true,
    })
    const result = await toggleRenewalTask({
      contractId: "c-1",
      taskKey: "prepare-negotiation-strategy",
      completed: false,
    })
    expect(result.completed).toBe(false)
    expect(result.completedById).toBeNull()
    expect(result.completedAt).toBeNull()
    expect(taskRows).toHaveLength(1) // upsert updates existing
    expect(logAuditMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "renewal.task_uncompleted" }),
    )
  })

  it("is idempotent: toggling to the same value yields the same state", async () => {
    contractRows = [{ id: "c-1" }]
    const first = await toggleRenewalTask({
      contractId: "c-1",
      taskKey: "draft-renewal-terms",
      completed: true,
    })
    const second = await toggleRenewalTask({
      contractId: "c-1",
      taskKey: "draft-renewal-terms",
      completed: true,
    })
    expect(first.completed).toBe(true)
    expect(second.completed).toBe(true)
    expect(second.completedById).toBe("user-1")
    expect(taskRows).toHaveLength(1)
  })

  it("throws when contract not owned by facility", async () => {
    contractRows = []
    await expect(
      toggleRenewalTask({
        contractId: "c-other",
        taskKey: "review-performance",
        completed: true,
      }),
    ).rejects.toThrow(/contract not found/i)
    expect(logAuditMock).not.toHaveBeenCalled()
    expect(taskRows).toHaveLength(0)
  })

  it("throws on unknown taskKey", async () => {
    contractRows = [{ id: "c-1" }]
    await expect(
      toggleRenewalTask({
        contractId: "c-1",
        taskKey: "not-a-real-key",
        completed: true,
      }),
    ).rejects.toThrow(/unknown renewal task key/i)
  })
})
