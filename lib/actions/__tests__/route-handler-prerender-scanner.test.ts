import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dirname, "..", "..", "..")
const API_DIR = join(ROOT, "app", "api")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === "route.ts" || entry === "route.tsx") out.push(full)
  }
  return out
}

const getHandlers = walk(API_DIR)
  .map((file) => ({ file: relative(ROOT, file), src: readFileSync(file, "utf8") }))
  .filter(({ src }) => /export\s+async\s+function\s+GET\b/.test(src))

describe("GET route handlers are not prerendered into static responses", () => {
  it("finds the handlers it is guarding", () => {
    expect(getHandlers.length).toBeGreaterThan(5)
  })

  for (const { file, src } of getHandlers) {
    const readsEnv = /process\.env\./.test(src)
    const wrapsInTry = /\btry\s*\{/.test(src)
    const awaitsConnection = /await\s+connection\(\)/.test(src)
    const needsConnection = readsEnv || wrapsInTry

    it(`${file}${needsConnection ? " awaits connection() before env reads / try blocks" : " has no prerender hazard"}`, () => {
      expect(/export\s+const\s+dynamic\b/.test(src), "route segment `dynamic` export is rejected under cacheComponents").toBe(false)
      if (!needsConnection) return
      expect(
        awaitsConnection,
        `${file} reads process.env or wraps request access in try/catch; under cacheComponents a GET handler that returns before touching the request is baked into the build as a static response, and a caught prerender bail-out is swallowed. Add \`await connection()\` (next/server) as the first statement of GET.`,
      ).toBe(true)
      const getBody = src.slice(src.search(/export\s+async\s+function\s+GET\b/))
      const connIdx = getBody.search(/await\s+connection\(\)/)
      const envIdx = getBody.search(/process\.env\./)
      const tryIdx = getBody.search(/\btry\s*\{/)
      expect(connIdx, "connection() must be inside GET").toBeGreaterThan(-1)
      if (envIdx > -1) expect(connIdx, "connection() must precede the first process.env read in GET").toBeLessThan(envIdx)
      if (tryIdx > -1) expect(connIdx, "connection() must precede the first try block in GET").toBeLessThan(tryIdx)
    })
  }
})
