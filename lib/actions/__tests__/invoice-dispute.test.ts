/**
 * Tests for flagInvoiceAsDisputed + resolveInvoiceDispute —
 * the facility-side invoice dispute actions (data-pipeline subsystem 3).
 *
 * Exercises ownership scoping, status guards, note persistence,
 * and audit-log emission with mocked prisma + auth + audit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type InvoiceRow = {
  id: string
  invoiceNumber: string
  facilityId: string
  disputeStatus: "none" | "disputed" | "resolved" | "rejected"
  disputeNote: string | null
  disputeAt: Date | null
}

let invoiceByKey: Record<string, InvoiceRow | null> = {}
let lastUpdate: { where: unknown; data: Record<string, unknown> } | null = null

const findUnique = vi.fn(
  async ({ where }: { where: { id: string; facilityId?: string } }) => {
    const row = invoiceByKey[where.id] ?? null
    if (!row) return null
    if (where.facilityId && row.facilityId !== where.facilityId) return null
    return row
  }
)

const update = vi.fn(
  async ({
    where,
    data,
  }: {
    where: { id: string }
    data: Record<string, unknown>
  }) => {
    lastUpdate = { where, data }
    const current = invoiceByKey[where.id]
    if (!current) throw new Error("not found")
    const next: InvoiceRow = {
      ...current,
      ...(data as Partial<InvoiceRow>),
    }
    invoiceByKey[where.id] = next
    return next
  }
)

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findUnique: (args: { where: { id: string; facilityId?: string } }) =>
        findUnique(args),
      update: (args: { where: { id: string }; data: Record<string, unknown> }) =>
        update(args),
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

const revalidatePathMock = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePathMock(p),
}))

// serialize is pure — leave real impl in place.

import {
  flagInvoiceAsDisputed,
  resolveInvoiceDispute,
} from "@/lib/actions/invoices/dispute"

beforeEach(() => {
  vi.clearAllMocks()
  invoiceByKey = {}
  lastUpdate = null
})

function seed(row: Partial<InvoiceRow> & { id: string }): InvoiceRow {
  const full: InvoiceRow = {
    id: row.id,
    invoiceNumber: row.invoiceNumber ?? "INV-0001",
    facilityId: row.facilityId ?? "fac-1",
    disputeStatus: row.disputeStatus ?? "none",
    disputeNote: row.disputeNote ?? null,
    disputeAt: row.disputeAt ?? null,
  }
  invoiceByKey[full.id] = full
  return full
}

describe("flagInvoiceAsDisputed", () => {
  it("updates disputeStatus to disputed, persists note, sets disputeAt", async () => {
    seed({ id: "inv-1", invoiceNumber: "INV-42" })

    const result = await flagInvoiceAsDisputed({
      invoiceId: "inv-1",
      note: "Price mismatch on line 3",
    })

    expect(lastUpdate?.data.disputeStatus).toBe("disputed")
    expect(lastUpdate?.data.disputeNote).toBe("Price mismatch on line 3")
    expect(lastUpdate?.data.disputeAt).toBeInstanceOf(Date)
    // Returned value is serialized — Date → ISO string
    expect(typeof result.disputeAt).toBe("string")
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/dashboard/invoice-validation"
    )
  })

  it("throws when note is empty", async () => {
    seed({ id: "inv-1" })

    await expect(
      flagInvoiceAsDisputed({ invoiceId: "inv-1", note: "" })
    ).rejects.toThrow(/note is required/i)

    expect(update).not.toHaveBeenCalled()
  })

  it("throws when note is whitespace-only", async () => {
    seed({ id: "inv-1" })

    await expect(
      flagInvoiceAsDisputed({ invoiceId: "inv-1", note: "   " })
    ).rejects.toThrow(/note is required/i)
  })

  it("throws when invoice belongs to another facility", async () => {
    seed({ id: "inv-1", facilityId: "fac-other" })

    await expect(
      flagInvoiceAsDisputed({ invoiceId: "inv-1", note: "hello" })
    ).rejects.toThrow(/not found/i)

    expect(update).not.toHaveBeenCalled()
  })

  it("writes audit log with invoice.flagged_disputed action", async () => {
    seed({ id: "inv-1", invoiceNumber: "INV-99" })

    await flagInvoiceAsDisputed({
      invoiceId: "inv-1",
      note: "short-note",
    })

    expect(logAuditMock).toHaveBeenCalledTimes(1)
    const firstCall = logAuditMock.mock.calls[0] as unknown as [
      {
        userId: string
        action: string
        entityType: string
        entityId: string
        metadata: { invoiceNumber: string; noteLength: number }
      },
    ]
    const auditArgs = firstCall[0]
    expect(auditArgs.userId).toBe("user-1")
    expect(auditArgs.action).toBe("invoice.flagged_disputed")
    expect(auditArgs.entityType).toBe("invoice")
    expect(auditArgs.entityId).toBe("inv-1")
    expect(auditArgs.metadata.invoiceNumber).toBe("INV-99")
    expect(auditArgs.metadata.noteLength).toBe("short-note".length)
  })
})

describe("resolveInvoiceDispute", () => {
  it("transitions disputed → resolved", async () => {
    seed({
      id: "inv-1",
      disputeStatus: "disputed",
      disputeNote: "Original complaint",
    })

    await resolveInvoiceDispute({
      invoiceId: "inv-1",
      resolution: "resolved",
    })

    expect(lastUpdate?.data.disputeStatus).toBe("resolved")
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "invoice.dispute_resolved" })
    )
  })

  it("transitions disputed → rejected", async () => {
    seed({
      id: "inv-1",
      disputeStatus: "disputed",
      disputeNote: "Original complaint",
    })

    await resolveInvoiceDispute({
      invoiceId: "inv-1",
      resolution: "rejected",
    })

    expect(lastUpdate?.data.disputeStatus).toBe("rejected")
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "invoice.dispute_rejected" })
    )
  })

  it("throws when invoice is not currently disputed", async () => {
    seed({ id: "inv-1", disputeStatus: "none" })

    await expect(
      resolveInvoiceDispute({ invoiceId: "inv-1", resolution: "resolved" })
    ).rejects.toThrow(/disputed invoices/i)

    expect(update).not.toHaveBeenCalled()
  })

  it("throws when trying to re-resolve an already-resolved invoice", async () => {
    seed({ id: "inv-1", disputeStatus: "resolved" })

    await expect(
      resolveInvoiceDispute({ invoiceId: "inv-1", resolution: "resolved" })
    ).rejects.toThrow(/disputed invoices/i)
  })

  it("appends resolution note to existing disputeNote", async () => {
    seed({
      id: "inv-1",
      disputeStatus: "disputed",
      disputeNote: "Line 3 overcharge",
    })

    await resolveInvoiceDispute({
      invoiceId: "inv-1",
      resolution: "resolved",
      note: "Credit memo issued",
    })

    expect(lastUpdate?.data.disputeNote).toBe(
      "Line 3 overcharge\nResolution: Credit memo issued"
    )
  })

  it("leaves disputeNote unchanged when no resolution note provided", async () => {
    seed({
      id: "inv-1",
      disputeStatus: "disputed",
      disputeNote: "Original",
    })

    await resolveInvoiceDispute({
      invoiceId: "inv-1",
      resolution: "resolved",
    })

    expect(lastUpdate?.data.disputeNote).toBe("Original")
  })

  it("throws when invoice belongs to another facility", async () => {
    seed({
      id: "inv-1",
      facilityId: "fac-other",
      disputeStatus: "disputed",
    })

    await expect(
      resolveInvoiceDispute({ invoiceId: "inv-1", resolution: "resolved" })
    ).rejects.toThrow(/not found/i)
  })
})
