import { NextResponse } from "next/server"

export type RouteHandler = (request: Request) => Promise<Response>

export type JsonBody = Record<string, unknown>

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export interface UploadResult {
  status: number
  body: JsonBody
}

export function fileFor(name: string, bytes: Buffer | Uint8Array | string, type = "application/octet-stream"): File {
  const data = typeof bytes === "string" ? bytes : new Uint8Array(bytes)
  return new File([data], name, { type })
}

export async function postForm(
  handler: RouteHandler,
  url: string,
  fields: Record<string, string | File>,
): Promise<UploadResult> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const res = await handler(new Request(url, { method: "POST", body: form }))
  return { status: res.status, body: (await res.json()) as JsonBody }
}

export async function postOversized(
  handler: RouteHandler,
  url: string,
  name: string,
  sizeBytes: number,
  extra: Record<string, string> = {},
): Promise<UploadResult> {
  const big = new File([new Uint8Array(1)], name, { type: XLSX_TYPE })
  Object.defineProperty(big, "size", { value: sizeBytes })
  const form = new FormData()
  form.append("file", big)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  const req = new Request(url, { method: "POST" })
  Object.defineProperty(req, "formData", { value: async () => form })
  const res = await handler(req)
  return { status: res.status, body: (await res.json()) as JsonBody }
}

export function forbidden(error = "Not authorized"): NextResponse {
  return NextResponse.json({ error }, { status: 403 })
}

export const MB = 1024 * 1024
