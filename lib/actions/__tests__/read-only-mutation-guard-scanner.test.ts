import { describe, it, expect } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import ts from "@typescript/typescript6"

/**
 * Read-only-tier bypass regression catcher (2026-06-19 security remediation,
 * Part 3).
 *
 * The `user` access tier (read-only) is enforced by the access-tier matrix in
 * `lib/auth/permissions.ts`, surfaced as the one-line gate
 * `await requireCanMutate()` (`lib/actions/auth-permissions.ts`). But
 * `requireFacility()` / `requireVendor()` / `requireAuth()` do NOT check
 * `Member.accessTier` — so a read-only member could call a mutating server
 * action directly and still write.
 *
 * Two surfaces are walked with the TypeScript AST:
 *   - every exported function of a `"use server"` file under `lib/actions/**`
 *   - every POST/PUT/PATCH/DELETE handler of an `app/api/**` route
 *
 * A function is a writer when its body, or any same-file helper it calls
 * (transitively), contains a prisma WRITE op on `prisma` or `tx`. A writer
 * must CALL a capability gate (a gate name in a comment does not count):
 *   - `requireCanMutate()` / `requireCan(...)` / `requireAdmin()`, OR
 *   - in a route, `denyUnlessPortalWriter()` / `denyUnlessWriter()`, OR
 *   - a `// read-only-guard-skip: <reason>` comment inside the function
 *     (for legitimate system / best-effort / pre-auth writes), OR
 *   - the function name is in the explicit `ALLOWLIST` below.
 *
 * False-positive policy: prefer a one-line `read-only-guard-skip:` comment
 * (or an ALLOWLIST entry with a justification) over a silent ungated
 * mutation shipping to prod. If skips accumulate without good reasons, the
 * convention has eroded — re-audit that surface.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..")

const WRITE_OPS = new Set([
  "create",
  "update",
  "delete",
  "upsert",
  "createMany",
  "createManyAndReturn",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
])
const RAW_WRITE_OPS = new Set(["$executeRaw", "$executeRawUnsafe"])
const DB_ROOTS = new Set(["prisma", "tx"])
const ACTION_GATES = new Set(["requireCanMutate", "requireCan", "requireAdmin"])
const ROUTE_GATES = new Set([...ACTION_GATES, "denyUnlessPortalWriter", "denyUnlessWriter"])
const ROUTE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const SKIP_MARKER = "read-only-guard-skip:"

/**
 * Exported writers that are intentionally NOT gated by `requireCanMutate`.
 * Keyed by `relativePath#functionName`. Each MUST carry a justification.
 */
const ALLOWLIST = new Set<string>([
  // Unauthenticated self-service password flow — no requireFacility/requireVendor,
  // no Member.accessTier in scope; the caller is (by definition) not yet a
  // gated member. Mutates better-auth state, not tenant data.
  "lib/actions/auth.ts#requestPasswordReset",
  "lib/actions/auth.ts#resetPassword",
])

interface Hit {
  file: string
  fn: string
  line: number
}

interface FnFacts {
  writes: boolean
  gated: boolean
  calls: Set<string>
}

async function walk(dir: string, out: string[], match: (name: string) => boolean): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue
      await walk(full, out, match)
    } else if (e.isFile() && match(e.name)) {
      out.push(full)
    }
  }
}

function rootIdentifier(expr: ts.Expression): string | null {
  let cur: ts.Expression = expr
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur)) {
    cur = cur.expression
  }
  return ts.isIdentifier(cur) ? cur.text : null
}

function isDbWrite(call: ts.CallExpression): boolean {
  const callee = call.expression
  if (ts.isTaggedTemplateExpression(callee)) return false
  if (!ts.isPropertyAccessExpression(callee)) return false
  const op = callee.name.text
  if (!WRITE_OPS.has(op) && !RAW_WRITE_OPS.has(op)) return false
  const root = rootIdentifier(callee.expression)
  return root !== null && DB_ROOTS.has(root)
}

function isRawTaggedWrite(node: ts.TaggedTemplateExpression): boolean {
  const tag = node.tag
  return (
    ts.isPropertyAccessExpression(tag) &&
    RAW_WRITE_OPS.has(tag.name.text) &&
    DB_ROOTS.has(rootIdentifier(tag.expression) ?? "")
  )
}

function collectFacts(body: ts.Node, gates: ReadonlySet<string>): FnFacts {
  const facts: FnFacts = { writes: false, gated: false, calls: new Set() }
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && isRawTaggedWrite(node)) facts.writes = true
    if (ts.isCallExpression(node)) {
      if (isDbWrite(node)) facts.writes = true
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text
        if (gates.has(name)) facts.gated = true
        facts.calls.add(name)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return facts
}

function functionLike(node: ts.Node): ts.FunctionLikeDeclaration | null {
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return node
  }
  return null
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  )
}

interface NamedFn {
  name: string
  fn: ts.FunctionLikeDeclaration
  exported: boolean
}

function topLevelFunctions(sf: ts.SourceFile): NamedFn[] {
  const out: NamedFn[] = []
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      out.push({ name: stmt.name.text, fn: stmt, exported: isExported(stmt) })
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const fn = decl.initializer ? functionLike(decl.initializer) : null
        if (fn && ts.isIdentifier(decl.name)) {
          out.push({ name: decl.name.text, fn, exported: isExported(stmt) })
        }
      }
    }
  }
  return out
}

function scanSource(
  rel: string,
  text: string,
  gates: ReadonlySet<string>,
  include: (fn: NamedFn) => boolean,
): Hit[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fns = topLevelFunctions(sf)
  const facts = new Map<string, FnFacts>()
  for (const f of fns) {
    if (!f.fn.body) continue
    const fnFacts = collectFacts(f.fn.body, gates)
    if (f.fn.getText(sf).includes(SKIP_MARKER)) fnFacts.writes = false
    facts.set(f.name, fnFacts)
  }

  const resolve = (name: string, key: "writes" | "gated", seen: Set<string>): boolean => {
    const f = facts.get(name)
    if (!f || seen.has(name)) return false
    seen.add(name)
    if (f[key]) return true
    for (const callee of f.calls) if (resolve(callee, key, seen)) return true
    return false
  }

  const hits: Hit[] = []
  for (const f of fns) {
    if (!include(f) || !f.fn.body) continue
    if (!resolve(f.name, "writes", new Set())) continue
    if (ALLOWLIST.has(`${rel}#${f.name}`)) continue
    if (resolve(f.name, "gated", new Set())) continue
    const line = sf.getLineAndCharacterOfPosition(f.fn.getStart(sf)).line + 1
    hits.push({ file: rel, fn: f.name, line })
  }
  return hits
}

async function scanActions(): Promise<Hit[]> {
  const files: string[] = []
  await walk(path.join(REPO_ROOT, "lib/actions"), files, (n) => n.endsWith(".ts") || n.endsWith(".tsx"))
  const hits: Hit[] = []
  for (const abs of files) {
    const text = await fs.readFile(abs, "utf8")
    if (!/^['"]use server['"]/m.test(text)) continue
    hits.push(...scanSource(path.relative(REPO_ROOT, abs), text, ACTION_GATES, (f) => f.exported))
  }
  return hits
}

async function scanRoutes(): Promise<Hit[]> {
  const files: string[] = []
  await walk(path.join(REPO_ROOT, "app/api"), files, (n) => n === "route.ts")
  const hits: Hit[] = []
  for (const abs of files) {
    const text = await fs.readFile(abs, "utf8")
    hits.push(
      ...scanSource(path.relative(REPO_ROOT, abs), text, ROUTE_GATES, (f) => f.exported && ROUTE_METHODS.has(f.name)),
    )
  }
  return hits
}

function failureMessage(hits: Hit[]): string {
  const detail = hits.map((h) => `  ${h.file}:${h.line}  →  ${h.fn}()`).join("\n")
  return `Found ${hits.length} writer(s) with NO read-only-tier gate.

A read-only ("user" tier) member can call these directly and still write
to the DB. Fix each by adding, before the write:

    await requireCanMutate()                  // server action
    const denied = await denyUnlessWriter(id) // route handler

If the write is a legitimate system / best-effort / pre-auth path that the
read-only tier does not govern, add a one-line comment inside the function:

    // read-only-guard-skip: <reason>

…or add the "relativePath#functionName" key to the ALLOWLIST in this test
with a justification.

Ungated writers:
${detail}`
}

describe("read-only mutation guard scanner (Part 3 security remediation)", () => {
  it("every exported writing server action under lib/actions is gated", async () => {
    const hits = await scanActions()
    if (hits.length > 0) throw new Error(failureMessage(hits))
    expect(hits).toEqual([])
  })

  it("every writing POST/PUT/PATCH/DELETE route handler under app/api is gated", async () => {
    const hits = await scanRoutes()
    if (hits.length > 0) throw new Error(failureMessage(hits))
    expect(hits).toEqual([])
  })

  it("does not accept a gate that only appears in a comment", () => {
    const src = `"use server"
export async function f() {
  // await requireCanMutate()
  await prisma.contract.update({ where: { id: "x" }, data: {} })
}`
    expect(scanSource("x.ts", src, ACTION_GATES, (f) => f.exported)).toHaveLength(1)
  })

  it("reads a body whose parameter type contains braces", () => {
    const src = `"use server"
export async function f(input: { id: string }): Promise<{ ok: true }> {
  await prisma.contract.update({ where: { id: input.id }, data: {} })
  return { ok: true }
}`
    expect(scanSource("x.ts", src, ACTION_GATES, (f) => f.exported)).toHaveLength(1)
  })

  it("follows writes through a same-file helper", () => {
    const src = `"use server"
async function write(tx: Tx) { await tx.rebate.deleteMany({ where: {} }) }
export async function f() { await write(prisma) }`
    expect(scanSource("x.ts", src, ACTION_GATES, (f) => f.exported)).toHaveLength(1)
  })

  it("accepts a gate called from a same-file helper", () => {
    const src = `"use server"
async function gate() { await requireCanMutate() }
export async function f() { await gate(); await prisma.rebate.create({ data: {} }) }`
    expect(scanSource("x.ts", src, ACTION_GATES, (f) => f.exported)).toEqual([])
  })
})
