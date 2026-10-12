import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { CONTRACT_FIXTURE, buildTextPdf, contractPdfLines, rasterizeToScannedPdf } from "../support/upload-fixtures"

const getSession = vi.hoisted(() => vi.fn())
const denyUnlessPortalWriter = vi.hoisted(() => vi.fn<(userId: string, portal: "facility" | "vendor") => Promise<Response | null>>())

vi.mock("@/lib/auth-server", () => ({ auth: { api: { getSession: (a: unknown) => getSession(a) } } }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/api/import-route-auth", () => ({ denyUnlessPortalWriter }))

import { POST } from "@/app/api/ai/document-text/route"
import { splitTextIntoPages } from "@/lib/ai/text-extraction"

let textPdf: Uint8Array
let scannedPdf: Uint8Array
let seq = 0

beforeAll(async () => {
  textPdf = await buildTextPdf(contractPdfLines())
  scannedPdf = await rasterizeToScannedPdf(textPdf)
})

beforeEach(() => {
  seq += 1
  getSession.mockResolvedValue({ user: { id: `doc-text-user-${seq}` } })
  denyUnlessPortalWriter.mockReset().mockResolvedValue(null)
})

async function post(bytes: Uint8Array, name = "contract.pdf", type = "application/pdf", headers?: Record<string, string>) {
  const form = new FormData()
  form.append("file", new File([new Uint8Array(bytes)], name, { type }))
  const res = await POST(new Request("http://localhost/api/ai/document-text", { method: "POST", body: form, headers }))
  return { status: res.status, body: (await res.json()) as { text?: string; pageCount?: number; ocr?: boolean; error?: string } }
}

describe("POST /api/ai/document-text", () => {
  it("rejects unauthenticated callers", async () => {
    getSession.mockResolvedValue(null)
    expect((await post(textPdf)).status).toBe(401)
  })

  it("rejects callers who are not facility writers", async () => {
    denyUnlessPortalWriter.mockResolvedValue(Response.json({ error: "Not authorized" }, { status: 403 }))
    expect((await post(textPdf)).status).toBe(403)
  })

  it("rejects an oversize declared content-length with 413", async () => {
    expect((await post(textPdf, "c.pdf", "application/pdf", { "content-length": String(26 * 1024 * 1024) })).status).toBe(413)
  })

  it("rejects non-PDF files with 415", async () => {
    expect((await post(new TextEncoder().encode("hello"), "notes.txt", "text/plain")).status).toBe(415)
  })

  it("returns the text layer as form-feed separated pages the indexer splits correctly", async () => {
    const { status, body } = await post(textPdf)
    expect(status).toBe(200)
    expect(body.ocr).toBe(false)
    expect(body.pageCount).toBe(2)
    const pages = splitTextIntoPages(body.text!)
    expect(pages).toHaveLength(2)
    expect(pages[0]!.text).toContain(CONTRACT_FIXTURE.contractNumber)
    expect(pages[1]!.text).toContain(CONTRACT_FIXTURE.capitalValue)
    expect(body.text).not.toMatch(/%PDF|endobj|stream/)
  })

  it("OCRs an image-only scan into readable page text", async () => {
    const { status, body } = await post(scannedPdf, "scan.PDF", "")
    expect(status).toBe(200)
    expect(body.ocr).toBe(true)
    const pages = splitTextIntoPages(body.text!)
    expect(pages).toHaveLength(2)
    expect(pages[0]!.text.replace(/\s+/g, " ")).toContain(CONTRACT_FIXTURE.contractNumber)
    expect(pages[1]!.text.replace(/\s+/g, "")).toContain(CONTRACT_FIXTURE.capitalValue)
  }, 180_000)
})
