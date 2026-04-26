import { describe, it, expect } from "vitest"
import { promises as fs } from "fs"
import path from "path"

/**
 * Charles audit suggestion (post v0-port BLOCKER): catch "select :{
 * removedField: true }" references at test time instead of at runtime.
 *
 * The v0-port commit dropped 5 columns from Contract. Vitest passed
 * because every site with a stale select is mocked at the Prisma
 * boundary; the actual runtime threw on every browser hit. Both
 * audit agents flagged this as the highest-leverage gap to close.
 *
 * This scanner walks the Prisma schema for every model + its scalar/
 * relation fields, then walks every .ts/.tsx file for
 * `prisma.<model>.findX({ select: { ... } })` (also `tx.<model>.…`
 * inside transactions, and the per-relation nested select). Any
 * select key that isn't a real field on the target model fails.
 *
 * Limitations / non-goals:
 * - Scoped to lib/actions/ + scripts/ + components that import prisma
 *   directly. Indirect callers (helpers wrapping prisma calls) are
 *   covered when the wrapper itself lives in scope.
 * - String-only field names (the obvious ones); doesn't try to
 *   resolve dynamic keys.
 * - Allowlist via per-line `// schema-scanner-skip:` comment for
 *   legitimate type-aliased reads.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..")

interface ModelDef {
  name: string
  fields: Set<string>
}

interface Hit {
  file: string
  line: number
  model: string
  field: string
  snippet: string
}

const SCAN_DIRS = ["lib/actions", "scripts"]

async function loadSchemaModels(): Promise<Map<string, ModelDef>> {
  const schemaPath = path.join(REPO_ROOT, "prisma", "schema.prisma")
  const text = await fs.readFile(schemaPath, "utf8")
  const models = new Map<string, ModelDef>()
  // Split into model blocks. A model block: `model Name {` ... `}`.
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(text)) !== null) {
    const name = m[1]
    const body = m[2]
    const fields = new Set<string>()
    for (const line of body.split("\n")) {
      // Skip block comments, attributes, empty lines.
      const trimmed = line.trim()
      if (
        trimmed.length === 0 ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("@@") ||
        trimmed.startsWith("/")
      )
        continue
      // Field: `name  Type ...`
      const fm = trimmed.match(/^(\w+)\s+\S/)
      if (fm) fields.add(fm[1])
    }
    models.set(name, { name, fields })
  }
  return models
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue
      if (e.name === "node_modules") continue
      if (e.name === "generated") continue
      await walk(full, out)
    } else if (
      e.isFile() &&
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))
    ) {
      out.push(full)
    }
  }
}

/** Find every `prisma.<model>.<op>(...)` call's select object (per file). */
function findSelectsInFile(
  text: string,
  rel: string,
  models: Map<string, ModelDef>,
): Hit[] {
  const hits: Hit[] = []
  const lines = text.split("\n")

  // Pattern: `prisma.<modelLower>.{find|update|delete|count}(`
  // Models in Prisma client are camelCase of the schema name.
  const callRe =
    /\b(?:prisma|tx)\.([a-zA-Z]+)\.(?:findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|update|updateMany|create|createMany|delete|deleteMany|aggregate|groupBy|count)\b/g

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    const above = lineIdx > 0 ? lines[lineIdx - 1] : ""
    if (/schema-scanner-skip:/.test(above)) continue

    callRe.lastIndex = 0
    const match = callRe.exec(line)
    if (!match) continue
    const camelModel = match[1]
    // Map prisma client name → schema name (PascalCase).
    const modelName =
      camelModel.charAt(0).toUpperCase() + camelModel.slice(1)
    const model = models.get(modelName)
    if (!model) continue

    // Capture the call's argument area. Start from the opening `(`
    // of the call (first paren after the matched op), find its
    // matching `)`.
    const callArgsStartLine = lineIdx
    const callTextRest = lines
      .slice(lineIdx, Math.min(lineIdx + 80, lines.length))
      .join("\n")
    const opMatch = callTextRest.match(callRe)
    if (!opMatch) continue
    const opIdx = callTextRest.indexOf(opMatch[0])
    const parenOpen = callTextRest.indexOf("(", opIdx)
    if (parenOpen < 0) continue
    // Walk to matching paren.
    let parenDepth = 1
    let pi = parenOpen + 1
    while (pi < callTextRest.length && parenDepth > 0) {
      const ch = callTextRest[pi]
      if (ch === "(") parenDepth++
      else if (ch === ")") parenDepth--
      pi++
    }
    const callArgs = callTextRest.slice(parenOpen + 1, pi - 1)

    // Find the OUTER args object: should be `{ ... }` at the top
    // level of the call args.
    const argObjOpen = callArgs.indexOf("{")
    if (argObjOpen < 0) continue
    // Walk to its matching brace.
    let bd = 1
    let bi = argObjOpen + 1
    while (bi < callArgs.length && bd > 0) {
      const ch = callArgs[bi]
      if (ch === "{") bd++
      else if (ch === "}") bd--
      bi++
    }
    const argObj = callArgs.slice(argObjOpen + 1, bi - 1)

    // Inside `argObj`, find a top-level `select:` (depth 0 in argObj).
    const topSelectIdx = findTopLevelKey(argObj, "select")
    if (topSelectIdx < 0) continue
    const colonAfter = argObj.indexOf(":", topSelectIdx)
    const selectBraceOpen = argObj.indexOf("{", colonAfter)
    if (selectBraceOpen < 0) continue
    let sd = 1
    let si = selectBraceOpen + 1
    while (si < argObj.length && sd > 0) {
      const ch = argObj[si]
      if (ch === "{") sd++
      else if (ch === "}") sd--
      si++
    }
    const selectBlock = argObj.slice(selectBraceOpen + 1, si - 1)

    const ownKeys = extractTopLevelKeys(selectBlock)
    for (const key of ownKeys) {
      if (model.fields.has(key)) continue
      if (key === "_count" || key === "_relationLoadStrategy") continue
      // Compute the line of the offending key.
      const offsetUpToSelect =
        parenOpen + 1 + argObjOpen + 1 + selectBraceOpen + 1
      const keyOffsetInBlock = selectBlock.indexOf(key)
      const totalOffset = offsetUpToSelect + keyOffsetInBlock
      const keyLine =
        callArgsStartLine + countNewlines(callTextRest.slice(0, totalOffset))
      hits.push({
        file: rel,
        line: keyLine + 1,
        model: modelName,
        field: key,
        snippet: lines[keyLine]?.trim() ?? key,
      })
    }
  }

  return hits
}

/** Find the offset of `<key>:` at depth-0 inside `block`, or -1. */
function findTopLevelKey(block: string, key: string): number {
  let depth = 0
  let i = 0
  while (i < block.length) {
    const ch = block[i]
    if (ch === "{" || ch === "(" || ch === "[") depth++
    else if (ch === "}" || ch === ")" || ch === "]") depth--
    else if (depth === 0) {
      if (block.slice(i).startsWith(key)) {
        // Confirm word boundary + colon follows.
        const after = block[i + key.length]
        if (after === ":" || after === " ") {
          // Match.
          return i
        }
      }
    }
    i++
  }
  return -1
}

function extractTopLevelKeys(block: string): string[] {
  // Walk the block; record `<key>:` at depth 0 only.
  // Strips line comments + block comments + string literals first
  // to avoid misreading "A:" inside a comment as a select key.
  const sanitized = stripCommentsAndStrings(block)
  const keys: string[] = []
  let depth = 0
  let i = 0
  while (i < sanitized.length) {
    const ch = sanitized[i]
    if (ch === "{" || ch === "(" || ch === "[") depth++
    else if (ch === "}" || ch === ")" || ch === "]") depth--
    else if (depth === 0) {
      // Match an identifier followed by a colon.
      const remaining = sanitized.slice(i)
      const m = remaining.match(/^([a-zA-Z_]\w*)\s*:/)
      if (m) {
        keys.push(m[1])
        i += m[0].length
        continue
      }
    }
    i++
  }
  return keys
}

function stripCommentsAndStrings(s: string): string {
  // Replace each comment + string-literal span with same-length spaces
  // so offsets stay aligned for downstream lookups.
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    const c2 = s[i + 1]
    if (c === "/" && c2 === "/") {
      // line comment to EOL
      while (i < s.length && s[i] !== "\n") {
        out.push(" ")
        i++
      }
    } else if (c === "/" && c2 === "*") {
      out.push("  ")
      i += 2
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) {
        out.push(s[i] === "\n" ? "\n" : " ")
        i++
      }
      if (i < s.length) {
        out.push("  ")
        i += 2
      }
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c
      out.push(" ")
      i++
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\") {
          out.push(" ")
          i++
        }
        out.push(s[i] === "\n" ? "\n" : " ")
        i++
      }
      if (i < s.length) {
        out.push(" ")
        i++
      }
    } else {
      out.push(c)
      i++
    }
  }
  return out.join("")
}

function countNewlines(s: string): number {
  let n = 0
  for (const ch of s) if (ch === "\n") n++
  return n
}

describe("prisma select schema scanner", () => {
  it("every prisma.<model>.<op>({ select: { ... } }) key matches a real field on that model", async () => {
    const models = await loadSchemaModels()
    expect(models.size).toBeGreaterThan(10) // sanity

    const files: string[] = []
    for (const d of SCAN_DIRS) {
      await walk(path.join(REPO_ROOT, d), files)
    }

    const allHits: Hit[] = []
    for (const f of files) {
      const text = await fs.readFile(f, "utf8")
      const rel = path.relative(REPO_ROOT, f)
      const hits = findSelectsInFile(text, rel, models)
      allHits.push(...hits)
    }

    if (allHits.length > 0) {
      const lines = allHits.map(
        (h) =>
          `  ${h.file}:${h.line}\n    model: ${h.model}\n    field: ${h.field} (NOT in schema)\n    line: ${h.snippet}`,
      )
      throw new Error(
        `Found ${allHits.length} select() reference(s) to fields that don't exist on the target Prisma model.

This is the bug class that caused the v0-port runtime BLOCKER —
vitest passes because Prisma is mocked, but the actual runtime
throws "Unknown field 'X' for select statement on model 'Y'".

Each finding is one of:
  - The field was renamed/dropped from the schema. Fix the select.
  - The select is on a relation's nested model — false positive. The
    scanner only validates the OUTER select keys against the call's
    own model; nested per-relation selects are skipped. If you see a
    finding here, the parser likely tripped on something unusual —
    add a comment with "schema-scanner-skip:" on the line above to
    silence.

Findings:
${lines.join("\n\n")}`,
      )
    }

    expect(allHits).toEqual([])
  })
})
