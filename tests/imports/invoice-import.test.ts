/**
 * End-to-end test for ingestExtractedInvoices.
 *
 * Input is pre-extracted (AI-parsed) invoice data, not CSV. This action
 * persists Invoice rows with vendor resolution + logs audit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const invoiceCreates: Array<Record<string, unknown>> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        invoiceCreates.push(data)
        return {
          id: `inv-${invoiceCreates.length}`,
          invoiceNumber: String(data.invoiceNumber),
        }
      }),
    },
    vendor: { update: vi.fn(async () => ({})) },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))

vi.mock("@/lib/vendors/resolve", () => ({
  resolveVendorId: vi.fn(async (name: string | null) => {
    if (!name) return "v-unknown"
    return `v-${name.replace(/\s+/g, "-").toLowerCase()}`
  }),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }))

import { ingestExtractedInvoices } from "@/lib/actions/imports/invoice-import"

beforeEach(() => {
  vi.clearAllMocks()
  invoiceCreates.length = 0
})

describe("ingestExtractedInvoices", () => {
  it("creates invoices from a batch of extracted items", async () => {
    const result = await ingestExtractedInvoices([
      {
        invoiceNumber: "INV-1001",
        vendorName: "Arthrex",
        invoiceDate: "2026-03-15",
        totalAmount: 1250,
        sourceFilename: "inv-1001.pdf",
      },
      {
        invoiceNumber: "INV-1002",
        vendorName: "Stryker",
        invoiceDate: "2026-03-16",
        totalAmount: 3500,
      },
    ])

    expect(result.created).toBe(2)
    expect(result.failed).toBe(0)
    expect(invoiceCreates).toHaveLength(2)
    expect(invoiceCreates[0]).toMatchObject({
      invoiceNumber: "INV-1001",
      facilityId: "fac-test",
      vendorId: "v-arthrex",
    })
    expect(Number(invoiceCreates[0].totalInvoiceCost)).toBe(1250)
  })

  it("derives invoiceNumber from sourceFilename when absent", async () => {
    await ingestExtractedInvoices([
      {
        invoiceNumber: null,
        vendorName: "Arthrex",
        invoiceDate: null,
        totalAmount: 100,
        sourceFilename: "ACME-Invoice-99.pdf",
      },
    ])

    expect(invoiceCreates[0].invoiceNumber).toBe("ACME-Invoice-99")
  })

  it("generates synthetic invoiceNumber when both absent", async () => {
    await ingestExtractedInvoices([
      {
        invoiceNumber: null,
        vendorName: "Arthrex",
        invoiceDate: null,
        totalAmount: 100,
      },
    ])

    expect(String(invoiceCreates[0].invoiceNumber)).toMatch(/^INV-\d+/)
  })

  it("defaults totalInvoiceCost to 0 when totalAmount null", async () => {
    await ingestExtractedInvoices([
      {
        invoiceNumber: "INV-ZERO",
        vendorName: "Arthrex",
        invoiceDate: null,
        totalAmount: null,
      },
    ])

    expect(Number(invoiceCreates[0].totalInvoiceCost)).toBe(0)
  })

  it("sets status to 'pending' on every new invoice", async () => {
    await ingestExtractedInvoices([
      {
        invoiceNumber: "INV-1",
        vendorName: "Arthrex",
        invoiceDate: "2026-03-15",
        totalAmount: 100,
      },
    ])

    expect(invoiceCreates[0].status).toBe("pending")
  })

  it("captures per-item errors without killing the batch", async () => {
    const { prisma } = await import("@/lib/db")
    const createMock = prisma.invoice.create as ReturnType<typeof vi.fn>
    createMock.mockImplementationOnce(async () => {
      throw new Error("duplicate invoice number")
    })

    const result = await ingestExtractedInvoices([
      {
        invoiceNumber: "INV-BAD",
        vendorName: "Arthrex",
        invoiceDate: "2026-03-15",
        totalAmount: 100,
      },
      {
        invoiceNumber: "INV-GOOD",
        vendorName: "Arthrex",
        invoiceDate: "2026-03-15",
        totalAmount: 100,
      },
    ])

    expect(result.created).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining("duplicate invoice"),
    })
  })

  it("handles empty input", async () => {
    const result = await ingestExtractedInvoices([])
    expect(result.created).toBe(0)
    expect(result.failed).toBe(0)
  })
})
