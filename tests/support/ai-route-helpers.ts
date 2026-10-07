import { NoObjectGeneratedError, type LanguageModelUsage } from "ai"
import { extractedContractSchema, type ExtractedContractData } from "@/lib/ai/schemas"
import type { ChunkExtractData } from "@/lib/ai/contract-extract-merger"
import { CONTRACT_FIXTURE, buildTextPdf } from "./upload-fixtures"

export type ContentPart = {
  type: string
  text?: string
  data?: unknown
  mediaType?: string
  filename?: string
}

export type ModelMessageLike = {
  role: string
  content: string | ContentPart[]
}

export type ModelCall = {
  model?: unknown
  prompt?: string
  messages?: ModelMessageLike[]
  maxOutputTokens?: number
  onFinish?: (event: { object: unknown }) => Promise<void> | void
  onError?: (event: { error: unknown }) => void
}

export function fakeUsage(inputTokens = 4_200, outputTokens = 610): LanguageModelUsage {
  return {
    inputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokens,
    outputTokenDetails: { textTokens: outputTokens, reasoningTokens: 0 },
    totalTokens: inputTokens + outputTokens,
  }
}

export function fakeTextResult<T>(output: T, text = JSON.stringify(output)) {
  return { output, text, usage: fakeUsage(), finishReason: "stop" as const, warnings: [] }
}

export function fakeObjectResult<T>(object: T) {
  return { object, usage: fakeUsage(1_800, 320), finishReason: "stop" as const, warnings: [] }
}

export function noObjectError(text = "{}"): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    text,
    response: { id: "resp_test", timestamp: new Date(0), modelId: "claude-haiku-4-5-20251001" },
    usage: fakeUsage(1_000, 2),
    finishReason: "tool-calls",
  })
}

export function fakeContract(overrides: Partial<ExtractedContractData> = {}): ExtractedContractData {
  const c = CONTRACT_FIXTURE
  return extractedContractSchema.parse({
    contractName: "Supply and Rebate Agreement",
    contractNumber: c.contractNumber,
    vendorName: c.vendor,
    contractType: "tie_in",
    effectiveDate: "2026-01-01",
    expirationDate: "2028-12-31",
    totalValue: 1_250_000,
    capitalCost: 785_195,
    productCategories: ["Joint Replacement", "Spine"],
    terms: [
      {
        termName: "Spend Rebate",
        termType: "spend_rebate",
        tiers: [
          { tierNumber: 1, spendMin: 0, rebateType: "percent_of_spend", rebateValue: 2 },
          { tierNumber: 2, spendMin: 500_000, rebateType: "percent_of_spend", rebateValue: 3 },
          { tierNumber: 3, spendMin: 1_000_000, rebateType: "percent_of_spend", rebateValue: 4 },
        ],
      },
    ],
    ...overrides,
  })
}

export function fakeChunk(overrides: Partial<ChunkExtractData> = {}): ChunkExtractData {
  return {
    contractName: null,
    vendorName: null,
    contractType: null,
    effectiveDate: null,
    expirationDate: null,
    terms: [],
    ...overrides,
  }
}

export function contentParts(call: ModelCall | undefined): ContentPart[] {
  const parts: ContentPart[] = []
  for (const m of call?.messages ?? []) {
    if (typeof m.content === "string") parts.push({ type: "text", text: m.content })
    else parts.push(...m.content)
  }
  return parts
}

export function promptText(call: ModelCall | undefined): string {
  const texts = contentParts(call)
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
  return [call?.prompt ?? "", ...texts].join("\n")
}

export function fileParts(call: ModelCall | undefined): ContentPart[] {
  return contentParts(call).filter((p) => p.type === "file")
}

export function pageLines(pageNo: number, label = "CONTRACT"): string[] {
  return [
    `${label} PAGE ${pageNo} MARKER-P${pageNo}`,
    `Section ${pageNo}. The Vendor shall supply orthopedic implants and instruments under this Agreement.`,
    `Section ${pageNo}.1 Pricing on Exhibit ${pageNo} applies to all Joint Replacement and Spine purchases.`,
    `Section ${pageNo}.2 Rebates accrue on eligible spend and are paid within sixty days of each period end.`,
  ]
}

export async function multiPagePdf(pages: number, label = "CONTRACT"): Promise<Uint8Array> {
  return buildTextPdf(Array.from({ length: pages }, (_, i) => pageLines(i + 1, label)))
}

export function multipartRequest(
  url: string,
  fields: Record<string, string | File>,
  init: { headers?: Record<string, string> } = {},
): Request {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new Request(url, { method: "POST", body: form, headers: init.headers })
}

export function fileOf(bytes: Uint8Array | Buffer | string, name: string, type: string): File {
  const part = typeof bytes === "string" ? bytes : new Uint8Array(bytes)
  return new File([part], name, { type })
}

export function oversizeFileRequest(
  url: string,
  name: string,
  type: string,
  sizeBytes: number,
  extraFields: Record<string, string> = {},
): Request {
  const big = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type })
  Object.defineProperty(big, "size", { value: sizeBytes })
  const form = new FormData()
  form.append("file", big)
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v)
  const req = new Request(url, { method: "POST" })
  Object.defineProperty(req, "formData", { value: async () => form })
  return req
}

export function oversizeContentLengthRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-length": String(26 * 1024 * 1024),
      "content-type": "multipart/form-data; boundary=----tydei",
    },
    body: "------tydei--",
  })
}

export const MB = 1024 * 1024

export async function readBody(res: Response): Promise<string> {
  return res.body ? await new Response(res.body).text() : ""
}
