import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getSession = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))

import { POST } from "@/app/api/ai/map-columns/route"
import { localMapColumns, mapColumns } from "@/lib/map-columns"

const URL = "http://localhost/api/ai/map-columns"
const TYPESAFE = "https://api.typesafe.ai/v1/systemone"

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

type JevBody = {
  model: string
  state: { headers: string[]; sample_rows: Record<string, string>[] }
  questions: Record<string, { type: string; criteria: Record<string, string | null> }>
}

function jevAnswers(picks: Record<string, Record<string, number>>) {
  const answers: Record<string, unknown> = {}
  for (const [key, probabilities] of Object.entries(picks)) {
    const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0]
    answers[key] = { type: "choice", choice, probabilities, confidence: 0.9 }
  }
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } }
}

let userId: string
let seq = 0
let jev: ReturnType<typeof vi.fn<(body: JevBody) => Response | Promise<Response>>>
let realFetch: typeof fetch

beforeEach(() => {
  seq += 1
  userId = `map-user-${seq}`
  getSession.mockReset().mockResolvedValue({ user: { id: userId } })
  vi.stubEnv("TYPESAFE_API_KEY", "test-key")
  jev = vi.fn(() => Response.json(jevAnswers({})))
  realFetch = globalThis.fetch
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === TYPESAFE) return jev(JSON.parse(String(init?.body)) as JevBody)
      return realFetch(input, init)
    }),
  )
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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
    expect(jev).not.toHaveBeenCalled()
  })

  it("rate-limits a single user to 30 mappings per minute", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) statuses.push((await POST(mapRequest(validBody))).status)
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  it("asks Jev one Choice per target field over the headers plus a no-match option", async () => {
    await POST(mapRequest(validBody))
    const body = jev.mock.calls[0]![0]
    expect(body.model).toBe("jev-latest")
    expect(body.state.headers).toEqual(SOURCE_HEADERS)
    expect(body.state.sample_rows[0]).toMatchObject({ Supplier: "Stryker", "Cat No": "SYK-1" })
    expect(Object.keys(body.questions)).toEqual(COG_FIELDS.map((f) => f.key))
    for (const q of Object.values(body.questions)) {
      expect(q.type).toBe("choice")
      expect(Object.keys(q.criteria)).toEqual([...SOURCE_HEADERS, "(none)"])
    }
  })

  it("returns Jev's picks, dropping no-match answers and options that are not headers", async () => {
    jev.mockReturnValue(
      Response.json(
        jevAnswers({
          vendorName: { Supplier: 0.97, "(none)": 0.03 },
          inventoryNumber: { "Cat No": 0.9, "Item Desc": 0.1 },
          inventoryDescription: { "Item Desc": 0.95, "(none)": 0.05 },
          transactionDate: { "Order Dt": 0.99, "(none)": 0.01 },
          quantity: { Qty: 0.99, "(none)": 0.01 },
          unitCost: { "Each $": 0.8, "Ext $": 0.2 },
          extendedPrice: { "Extended Price": 0.9, "(none)": 0.1 },
          poNumber: { "(none)": 0.6, "PO #": 0.4 },
        }),
      ),
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

  it("gives a contested header to the more confident field and moves the other to its next pick", async () => {
    jev.mockReturnValue(
      Response.json(
        jevAnswers({
          unitCost: { "Each $": 0.9, "Ext $": 0.1 },
          extendedPrice: { "Each $": 0.55, "Ext $": 0.45 },
        }),
      ),
    )
    const res = await POST(mapRequest(validBody))
    expect((await res.json()).mapping).toEqual({ unitCost: "Each $", extendedPrice: "Ext $" })
  })

  it("lets a required field claim a contested header ahead of a more confident optional one", async () => {
    jev.mockReturnValue(
      Response.json(
        jevAnswers({
          inventoryNumber: { "Cat No": 0.7, "(none)": 0.3 },
          poNumber: { "Cat No": 0.6, "PO #": 0.4 },
        }),
      ),
    )
    const res = await POST(mapRequest(validBody))
    expect((await res.json()).mapping).toEqual({ inventoryNumber: "Cat No", poNumber: "PO #" })
  })

  it("leaves a field unmapped rather than cascading it onto an unlikely runner-up header", async () => {
    jev.mockReturnValue(
      Response.json(
        jevAnswers({
          inventoryNumber: { "Cat No": 0.95, "(none)": 0.05 },
          poNumber: { "Cat No": 0.85, Qty: 0.02, "(none)": 0.13 },
          quantity: { Qty: 0.97, "(none)": 0.03 },
        }),
      ),
    )
    const res = await POST(mapRequest(validBody))
    expect((await res.json()).mapping).toEqual({ inventoryNumber: "Cat No", quantity: "Qty" })
  })

  it("shares a header between fields only when the second field is near-certain", async () => {
    jev.mockReturnValue(
      Response.json(
        jevAnswers({
          inventoryNumber: { "Cat No": 1.0 },
          vendorName: { "Cat No": 0.95, "(none)": 0.05 },
          poNumber: { "Cat No": 0.65, "(none)": 0.35 },
        }),
      ),
    )
    const res = await POST(mapRequest(validBody))
    expect((await res.json()).mapping).toEqual({ inventoryNumber: "Cat No", vendorName: "Cat No" })
  })

  it("masks patient-identifier sample values before they reach Jev", async () => {
    await POST(
      mapRequest({
        sourceHeaders: ["Patient MRN", "Case ID"],
        targetFields: [{ key: "caseNumber", label: "Case ID", required: true }],
        sampleRows: [{ "Patient MRN": "MRN-48213", "Case ID": "C-1" }],
      }),
    )
    const rows = jev.mock.calls[0]![0].state.sample_rows
    expect(rows[0]).toEqual({ "Patient MRN": "XXX-00000", "Case ID": "C-1" })
  })

  it("returns 500 'Mapping failed' when Jev errors", async () => {
    jev.mockReturnValue(new Response("upstream down", { status: 502 }))
    const res = await POST(mapRequest(validBody))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Mapping failed" })
  })

  it("returns 503 without calling out when TYPESAFE_API_KEY is unset", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "")
    const res = await POST(mapRequest(validBody))
    expect(res.status).toBe(503)
    expect(jev).not.toHaveBeenCalled()
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

  it("falls back locally end-to-end when the route's Jev call fails", async () => {
    jev.mockReturnValue(new Response("upstream down", { status: 502 }))
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) =>
        input === TYPESAFE
          ? jev(JSON.parse(String(init?.body)) as JevBody)
          : POST(new Request(new globalThis.URL(input, "http://localhost"), init)),
      ),
    )
    const headers = ["Vendor", "Product Ref Number", "Description", "Date Ordered", "Qty", "Unit Cost"]
    const result = await mapColumns(headers, COG_FIELDS, [])
    expect(jev).toHaveBeenCalled()
    expect(result).toEqual(localMapColumns(headers, COG_FIELDS))
  })
})
