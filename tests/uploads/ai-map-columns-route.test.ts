import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelCall } from "../support/ai-route-helpers"

const ai = vi.hoisted(() => ({
  generateObject: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  generateText: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  streamObject: vi.fn<(opts: ModelCall) => unknown>(),
}))
const getSession = vi.hoisted(() => vi.fn())

vi.mock("ai", async (importActual) => ({
  ...(await importActual<typeof import("ai")>()),
  generateObject: ai.generateObject,
  generateText: ai.generateText,
  streamObject: ai.streamObject,
}))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))

import { POST } from "@/app/api/ai/map-columns/route"
import { claudeSonnet } from "@/lib/ai/config"
import { localMapColumns, mapColumns } from "@/lib/map-columns"
import { fakeTextResult, promptText } from "../support/ai-route-helpers"

const URL = "http://localhost/api/ai/map-columns"

const SOURCE_HEADERS = ["PO #", "Order Dt", "Supplier", "Cat No", "Item Desc", "Qty", "Each $", "Ext $"]

const COG_FIELDS = [
  { key: "vendorName", label: "Vendor Name", required: true },
  { key: "inventoryNumber", label: "Product Ref Number", required: true },
  { key: "inventoryDescription", label: "Product Name", required: true },
  { key: "transactionDate", label: "Date Ordered", required: true },
  { key: "quantity", label: "Quantity Ordered", required: true },
  { key: "unitCost", label: "Unit Cost", required: true },
  { key: "extendedPrice", label: "Extended Cost", required: false },
  { key: "poNumber", label: "PO Number", required: false },
]

const SAMPLE_ROWS = [
  { "PO #": "PO-1", "Order Dt": "2026-03-01", Supplier: "Stryker", "Cat No": "SYK-1", "Item Desc": "Cup", Qty: "2", "Each $": "10", "Ext $": "20" },
]

let userId: string
let seq = 0

beforeEach(() => {
  seq += 1
  userId = `map-user-${seq}`
  getSession.mockReset().mockResolvedValue({ user: { id: userId } })
  ai.generateText.mockReset()
  ai.generateObject.mockReset()
  ai.streamObject.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mapRequest(body: unknown): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = { sourceHeaders: SOURCE_HEADERS, targetFields: COG_FIELDS, sampleRows: SAMPLE_ROWS }

describe("POST /api/ai/map-columns", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    getSession.mockResolvedValue(null)
    expect((await POST(mapRequest(validBody))).status).toBe(401)
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("rate-limits a single user to 30 mappings per minute", async () => {
    ai.generateText.mockResolvedValue(fakeTextResult({}))
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) statuses.push((await POST(mapRequest(validBody))).status)
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  it("returns the model's mapping, dropping blanks and headers that do not exist", async () => {
    ai.generateText.mockResolvedValue(
      fakeTextResult({
        vendorName: "Supplier",
        inventoryNumber: "Cat No",
        inventoryDescription: "Item Desc",
        transactionDate: "Order Dt",
        quantity: "Qty",
        unitCost: "Each $",
        extendedPrice: "Extended Price",
        poNumber: "",
      }),
    )
    const res = await POST(mapRequest(validBody))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mapping: {
        vendorName: "Supplier",
        inventoryNumber: "Cat No",
        inventoryDescription: "Item Desc",
        transactionDate: "Order Dt",
        quantity: "Qty",
        unitCost: "Each $",
      },
    })
  })

  it("starts at Sonnet and prompts with headers, required markers, and sample rows", async () => {
    ai.generateText.mockResolvedValue(fakeTextResult({}))
    await POST(mapRequest(validBody))
    const call = ai.generateText.mock.calls[0]![0]
    expect(call.model).toBe(claudeSonnet)
    const prompt = promptText(call)
    expect(prompt).toContain('- "Cat No"')
    expect(prompt).toContain('- vendorName ("Vendor Name") [REQUIRED]')
    expect(prompt).toContain('- poNumber ("PO Number")\n')
    expect(prompt).toContain("Supplier: Stryker | Cat No: SYK-1")
  })

  it("returns 500 'Mapping failed' when the model call fails", async () => {
    ai.generateText.mockRejectedValue(new Error("Invalid request: authentication_error"))
    const res = await POST(mapRequest(validBody))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Mapping failed" })
  })

  it("rejects a malformed body with 400 instead of a 500", async () => {
    const res = await POST(mapRequest({ sourceHeaders: [], targetFields: COG_FIELDS }))
    expect(res.status).toBe(400)
  })
})

describe("mapColumns (client) — AI with local fallback", () => {
  it("falls back to localMapColumns entirely on a non-200 response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }))
    vi.stubGlobal("fetch", fetchMock)
    const headers = ["Vendor", "Product Ref Number", "Description", "Date Ordered", "Qty", "Unit Cost"]
    const result = await mapColumns(headers, COG_FIELDS, [])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(localMapColumns(headers, COG_FIELDS))
    expect(result).toMatchObject({ vendorName: "Vendor", inventoryNumber: "Product Ref Number", unitCost: "Unit Cost", quantity: "Qty" })
  })

  it("uses the AI mapping as-is when it covers every required field", async () => {
    const aiMapping = {
      vendorName: "Supplier",
      inventoryNumber: "Cat No",
      inventoryDescription: "Item Desc",
      transactionDate: "Order Dt",
      quantity: "Qty",
      unitCost: "Each $",
    }
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ mapping: aiMapping }))
    vi.stubGlobal("fetch", fetchMock)
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...SAMPLE_ROWS[0]!, "PO #": `PO-${i}` }))
    expect(await mapColumns(SOURCE_HEADERS, COG_FIELDS, rows)).toEqual(aiMapping)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("/api/ai/map-columns")
    const sent = JSON.parse(String(init?.body)) as { sampleRows: unknown[]; sourceHeaders: string[] }
    expect(sent.sampleRows).toHaveLength(3)
    expect(sent.sourceHeaders).toEqual(SOURCE_HEADERS)
  })

  it("fills required fields the AI missed from the local fallback, keeping the AI's picks", async () => {
    const headers = ["Vendor", "Product Ref Number", "Description", "Date Ordered", "Qty", "Unit Cost", "Each $"]
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mapping: { unitCost: "Each $", vendorName: "Vendor" } })))
    const result = await mapColumns(headers, COG_FIELDS, [])
    expect(result.unitCost).toBe("Each $")
    expect(result.inventoryNumber).toBe("Product Ref Number")
    expect(result.transactionDate).toBe("Date Ordered")
  })

  it("falls back locally end-to-end when the route's model call fails", async () => {
    ai.generateText.mockRejectedValue(new Error("Invalid request: authentication_error"))
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => POST(new Request(new globalThis.URL(input, "http://localhost"), init))),
    )
    const headers = ["Vendor", "Product Ref Number", "Description", "Date Ordered", "Qty", "Unit Cost"]
    const result = await mapColumns(headers, COG_FIELDS, [])
    expect(ai.generateText).toHaveBeenCalled()
    expect(result).toEqual(localMapColumns(headers, COG_FIELDS))
  })
})
