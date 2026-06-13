/**
 * logUploadHeaderEvent guards (uploader improvements 2, 2026-06-13).
 *
 * - inserts a row for a valid, authenticated call
 * - requires auth (no session → no insert)
 * - NEVER throws to the caller: telemetry must not break uploads
 *   (DB failure, invalid payload, auth redirect all swallow).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { createMock, authGetSessionMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  authGetSessionMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    uploadHeaderEvent: { create: createMock },
  },
}))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: authGetSessionMock } },
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

import {
  logUploadHeaderEvent,
  type UploadHeaderEventInput,
} from "@/lib/actions/upload-telemetry"

const validInput: UploadHeaderEventInput = {
  surface: "vendor-benchmarks",
  fileName: "prices.xlsx",
  headers: ["ReferenceNumber", "Description", " Price"],
  autoMapping: { itemNumber: "ReferenceNumber", nationalAvgPrice: null },
  finalMapping: { itemNumber: "ReferenceNumber", nationalAvgPrice: " Price" },
  missingRequired: [],
  outcome: "manual_fix",
}

beforeEach(() => {
  vi.clearAllMocks()
  authGetSessionMock.mockResolvedValue({
    user: { id: "u-1", name: "User One", email: "u1@example.com" },
  })
  createMock.mockResolvedValue({ id: "evt-1" })
})

describe("logUploadHeaderEvent", () => {
  it("inserts a row for a valid authenticated call", async () => {
    await logUploadHeaderEvent({ ...validInput })
    expect(createMock).toHaveBeenCalledTimes(1)
    const data = createMock.mock.calls[0]![0].data
    expect(data).toMatchObject({
      surface: "vendor-benchmarks",
      fileName: "prices.xlsx",
      headers: ["ReferenceNumber", "Description", " Price"],
      autoMapping: { itemNumber: "ReferenceNumber", nationalAvgPrice: null },
      finalMapping: { itemNumber: "ReferenceNumber", nationalAvgPrice: " Price" },
      outcome: "manual_fix",
    })
  })

  it("does not insert without a session (and does not throw)", async () => {
    authGetSessionMock.mockResolvedValue(null)
    await expect(logUploadHeaderEvent({ ...validInput })).resolves.toBeUndefined()
    expect(createMock).not.toHaveBeenCalled()
  })

  it("never throws when the insert fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    createMock.mockRejectedValue(new Error("db down"))
    await expect(logUploadHeaderEvent({ ...validInput })).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("rejects an invalid payload without inserting or throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      logUploadHeaderEvent({
        ...validInput,
        // @ts-expect-error — deliberately invalid outcome
        outcome: "nonsense",
      }),
    ).resolves.toBeUndefined()
    expect(createMock).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
