import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dirname, "..", "..", "..")
const SCAN_DIRS = ["lib", "app", "components"].map((d) => join(ROOT, d))
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "generated", ".worktrees", ".claude"])

const REQUEST_BOUND = [
  /\brequire(Facility|Vendor|Admin|Auth|Role|ContractScope|CanMutate|Can)\s*\(/,
  /\bgetPrincipal\s*\(/,
  /\bgetSession\s*\(/,
  /\bheaders\s*\(\)/,
  /\bcookies\s*\(\)/,
  /\bconnection\s*\(\)/,
  /\bnew Date\s*\(\s*\)/,
  /\bDate\.now\s*\(\)/,
  /\bMath\.random\s*\(\)/,
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

interface CachedFn {
  file: string
  line: number
  name: string
  exported: boolean
  body: string
}

function extractCachedFunctions(file: string, src: string): CachedFn[] {
  const out: CachedFn[] = []
  const directive = /^\s*["']use cache["']\s*;?\s*$/gm
  let m: RegExpExecArray | null
  while ((m = directive.exec(src))) {
    const before = src.slice(0, m.index)
    const fnStart = before.lastIndexOf("function ")
    if (fnStart < 0) continue
    const header = src.slice(fnStart, m.index)
    const name = /function\s+([A-Za-z0-9_$]+)/.exec(header)?.[1] ?? "<anonymous>"
    const lineStart = before.lastIndexOf("\n", fnStart) + 1
    const exported = /^\s*export\s/.test(src.slice(lineStart, fnStart + 1))
    const open = src.indexOf("{", m.index - header.length + header.lastIndexOf("{"))
    let depth = 0
    let end = open
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}") {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    out.push({
      file: relative(ROOT, file),
      line: before.split("\n").length,
      name,
      exported,
      body: src.slice(m.index + m[0].length, end),
    })
  }
  return out
}

const cached = SCAN_DIRS.flatMap((dir) => walk(dir)).flatMap((file) =>
  extractCachedFunctions(file, readFileSync(file, "utf8")),
)

describe("'use cache' functions are tenant-keyed and request-free", () => {
  it("finds the functions it is guarding", () => {
    expect(cached.length).toBeGreaterThan(0)
  })

  for (const fn of cached) {
    it(`${fn.file}:${fn.line} ${fn.name}`, () => {
      expect(
        fn.exported,
        "a cached function must stay unexported: callers resolve the tenant through an auth gate and pass only ids in, so a client cannot request another tenant's cache entry",
      ).toBe(false)
      expect(/\bcacheTag\s*\(/.test(fn.body), "cached function must call cacheTag() so writes can invalidate it").toBe(true)
      expect(/\bcacheLife\s*\(/.test(fn.body), "cached function must set an explicit cacheLife()").toBe(true)
      for (const re of REQUEST_BOUND) {
        expect(re.test(fn.body), `cached function must not use ${re.source}; resolve it outside and pass the value in`).toBe(false)
      }
    })
  }
})
