import { describe, expect, it } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dirname, "..", "..", "..")
const ACTIONS_DIR = join(ROOT, "lib", "actions")
const APP_DIR = join(ROOT, "app")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") walk(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function routeSegmentDir(segments: string[]): string | null {
  let dir = APP_DIR
  for (const seg of segments) {
    const direct = join(dir, seg)
    if (existsSync(direct) && statSync(direct).isDirectory()) {
      dir = direct
      continue
    }
    const dynamic = readdirSync(dir).find(
      (e) => /^\[.+\]$/.test(e) && statSync(join(dir, e)).isDirectory(),
    )
    if (!dynamic) return null
    dir = join(dir, dynamic)
  }
  return dir
}

describe("revalidatePath targets resolve to real app routes", () => {
  const files = walk(ACTIONS_DIR)
  const calls: { file: string; line: number; path: string }[] = []

  for (const file of files) {
    const src = readFileSync(file, "utf8")
    const re = /revalidatePath\(\s*(["'`])([^"'`]*)\1/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length
      calls.push({ file: relative(ROOT, file), line, path: m[2] })
    }
  }

  it("finds the calls it is guarding", () => {
    expect(calls.length).toBeGreaterThan(10)
  })

  for (const call of calls) {
    it(`${call.file}:${call.line} → ${call.path}`, () => {
      const segments = call.path
        .split("/")
        .filter(Boolean)
        .map((s) => (s.startsWith("${") ? "[param]" : s))
      const dir = routeSegmentDir(segments)
      expect(dir, `no app directory for ${call.path}`).not.toBeNull()
      if (!dir) return
      const hasPage = existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "layout.tsx"))
      expect(hasPage, `${call.path} has no page.tsx or layout.tsx`).toBe(true)
    })
  }
})
