/**
 * lint-ai-schema-describe — forbids `: any`, `as any`, and `z.any()` in any
 * file matching `lib/ai/*-schemas.ts`.
 *
 * Background (backlog B4): our AI schemas must be precise enough for Claude
 * to emit structured output. An `any` (or Zod `z.any()`) is a footgun —
 * Zod serializes it to an empty JSON Schema `{}` and Claude responds with
 * anything it pleases. `z.unknown()` is allowed because it still forces
 * the caller to handle the type explicitly at the call site.
 *
 * Runs via: `bun run lint:ai-schema`.
 * Exits non-zero with a `file:line:col` list when any violation is found.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..")
const AI_DIR = join(REPO_ROOT, "lib", "ai")

type Violation = {
  file: string
  line: number
  col: number
  rule: string
  snippet: string
}

/**
 * Find all files matching `lib/ai/*-schemas.ts` (one level, hyphen-schemas).
 */
function findSchemaFiles(): string[] {
  const entries = readdirSync(AI_DIR)
  return entries
    .filter((name) => /-schemas\.ts$/.test(name))
    .map((name) => join(AI_DIR, name))
    .filter((p) => statSync(p).isFile())
}

/**
 * Strip single-line and block comments from a line of TypeScript source.
 * This is imprecise (it ignores multi-line block comments that span lines)
 * but sufficient for a lint-grep: we only care about violations outside
 * comments, and the failing patterns are short enough that their entire
 * match will be on the same line as their open.
 */
function stripComments(line: string): string {
  // Remove // ... to end of line.
  const slashIdx = line.indexOf("//")
  const stripped = slashIdx >= 0 ? line.slice(0, slashIdx) : line
  // Remove /* ... */ on the same line.
  return stripped.replace(/\/\*[\s\S]*?\*\//g, "")
}

const RULES: ReadonlyArray<{ name: string; regex: RegExp }> = [
  // `: any` — declared `any` type annotation.
  {
    name: ": any type annotation",
    regex: /:\s*any(?:\s|\||\)|,|=|;|\[|>|$)/,
  },
  // `as any` — cast to any.
  {
    name: "as any cast",
    regex: /\bas\s+any\b/,
  },
  // `z.any()` — Zod any schema.
  {
    name: "z.any() schema",
    regex: /\bz\s*\.\s*any\s*\(/,
  },
]

function lintFile(path: string): Violation[] {
  const text = readFileSync(path, "utf8")
  const lines = text.split(/\r?\n/)
  const out: Violation[] = []

  // Track block comment state coarsely — skip violations inside /* ... */.
  let inBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    let line = raw

    if (inBlockComment) {
      const endIdx = line.indexOf("*/")
      if (endIdx < 0) continue
      inBlockComment = false
      line = line.slice(endIdx + 2)
    }
    // If a block comment opens and doesn't close on this line, flag and skip.
    const openIdx = line.indexOf("/*")
    const closeIdx = line.indexOf("*/", openIdx + 2)
    if (openIdx >= 0 && closeIdx < 0) {
      line = line.slice(0, openIdx)
      inBlockComment = true
    }

    const code = stripComments(line)
    for (const rule of RULES) {
      const m = rule.regex.exec(code)
      if (m) {
        out.push({
          file: path,
          line: i + 1,
          col: (m.index ?? 0) + 1,
          rule: rule.name,
          snippet: raw.trim().slice(0, 160),
        })
      }
    }
  }

  return out
}

function main() {
  const files = findSchemaFiles()
  const violations: Violation[] = []
  for (const f of files) {
    violations.push(...lintFile(f))
  }

  if (violations.length === 0) {
    const rel = files.map((f) => f.replace(`${REPO_ROOT}/`, ""))
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.log(
      `lint-ai-schema-describe: OK (${files.length} file${
        files.length === 1 ? "" : "s"
      } scanned: ${rel.join(", ") || "none"})`,
    )
    return
  }

  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    `lint-ai-schema-describe: FAIL — ${violations.length} violation(s)\n`,
  )
  for (const v of violations) {
    const rel = v.file.replace(`${REPO_ROOT}/`, "")
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.error(`  ${rel}:${v.line}:${v.col}  [${v.rule}]  ${v.snippet}`)
  }
  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    `\nFix: replace 'any' with an explicit type (or z.unknown() for Zod) and re-run.`,
  )
  process.exit(1)
}

main()
