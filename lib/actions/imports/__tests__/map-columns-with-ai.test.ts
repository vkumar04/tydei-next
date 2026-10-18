import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localFallbackMap, mapColumnsWithAI, type TargetField } from "@/lib/actions/imports/shared"

const FIELDS: TargetField[] = [
  { key: "vendorName", label: "Vendor / Supplier Name", required: true },
  { key: "quantity", label: "Quantity Ordered", required: false },
]
const HEADERS = ["Proveedor", "Cantidad", "Patient MRN"]
const ROWS = [{ Proveedor: "Stryker", Cantidad: "4", "Patient MRN": "MRN-1" }]

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("mapColumnsWithAI", () => {
  it("maps with Jev and never sends raw patient identifiers", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    fetchMock.mockResolvedValue(
      Response.json({
        answers: {
          vendorName: { type: "choice", choice: "Proveedor", probabilities: { Proveedor: 0.96, Cantidad: 0.01, "Patient MRN": 0.01, "(none)": 0.02 }, confidence: 0.9 },
          quantity: { type: "choice", choice: "Cantidad", probabilities: { Proveedor: 0.01, Cantidad: 0.97, "Patient MRN": 0.0, "(none)": 0.02 }, confidence: 0.92 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )
    expect(await mapColumnsWithAI(HEADERS, FIELDS, ROWS)).toEqual({ vendorName: "Proveedor", quantity: "Cantidad" })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key")
    expect(String(init?.body)).not.toContain("MRN-1")
  })

  it("falls back to the local matcher when Jev errors", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }))
    expect(await mapColumnsWithAI(HEADERS, FIELDS, ROWS)).toEqual(localFallbackMap(HEADERS, FIELDS))
    expect(console.error).toHaveBeenCalled()
  })

  it("uses the local matcher without a network call when TYPESAFE_API_KEY is unset", async () => {
    expect(await mapColumnsWithAI(HEADERS, FIELDS, ROWS)).toEqual(localFallbackMap(HEADERS, FIELDS))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
