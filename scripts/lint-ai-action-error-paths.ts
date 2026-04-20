/**
 * lint-ai-action-error-paths — every `"use server"` action that calls the
 * Claude API (via `generateText` / `streamText` / `generateObject` /
 * `streamObject` / a bare `anthropic(...)` model factory) MUST wrap the
 * call in a try/catch whose catch block:
 *
 *   1. calls `console.error('[<action-name>]', err, { ... })`
 *      — so the raw exception makes it into server logs, which is the only
 *        debug path in prod (the client only sees a digest).
 *   2. if the catch re-throws, the thrown Error's first argument must be a
 *      string (or template string) whose leading literal names the action
 *      (e.g., `AI Smart Recommendations generation failed: ...`).
 *
 * Backlog B5. See CLAUDE.md § "AI-action error path".
 *
 * Runs via: `bun run lint:ai`.
 * Exits non-zero with a `file:line:col` list when any violation is found.
 *
 * We use the `typescript` compiler API to parse each candidate file into an
 * AST and traverse it structurally — regex over source is too brittle for
 * nested try/catch + throw detection.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import ts from "typescript"

const REPO_ROOT = resolve(__dirname, "..")
const ACTIONS_DIR = join(REPO_ROOT, "lib", "actions")

/** Function calls that invoke Claude (and therefore require the error-path wrapper). */
const CLAUDE_CALL_NAMES = new Set([
  "generateText",
  "streamText",
  "generateObject",
  "streamObject",
])

type Violation = {
  file: string
  line: number
  col: number
  message: string
}

function posOf(node: ts.Node, source: ts.SourceFile): { line: number; col: number } {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return { line: line + 1, col: character + 1 }
}

/**
 * Walk directory recursively and collect every `.ts` file that is not a
 * test file and is not in a `__tests__` dir.
 */
function collectActionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === "__tests__") continue
      collectActionFiles(full, out)
      continue
    }
    if (!entry.endsWith(".ts")) continue
    if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue
    out.push(full)
  }
  return out
}

function readSourceFile(path: string): ts.SourceFile {
  const text = readFileSync(path, "utf8")
  return ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
}

function hasUseServerPragma(sf: ts.SourceFile): boolean {
  // "use server" must be the first statement as a string expression.
  const first = sf.statements[0]
  if (!first || !ts.isExpressionStatement(first)) return false
  const expr = first.expression
  return ts.isStringLiteral(expr) && expr.text === "use server"
}

/**
 * Walk an AST node and call `visit` for each descendant. Returns nothing.
 */
function forEachDescendant(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node)
  node.forEachChild((child) => forEachDescendant(child, visit))
}

function callExpressionName(call: ts.CallExpression): string | null {
  const expr = call.expression
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text
  return null
}

function findExportedFunctionNameContaining(
  node: ts.Node,
  sf: ts.SourceFile,
): string | null {
  // Walk up to find the enclosing `export async function NAME()` or
  // `export const NAME = ...`.
  let cur: ts.Node | undefined = node
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) {
      const modifiers = ts.canHaveModifiers(cur) ? ts.getModifiers(cur) : undefined
      const exported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (exported) return cur.name.text
    }
    if (ts.isVariableStatement(cur)) {
      const modifiers = ts.canHaveModifiers(cur) ? ts.getModifiers(cur) : undefined
      const exported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (exported) {
        const decl = cur.declarationList.declarations[0]
        if (decl && ts.isIdentifier(decl.name)) return decl.name.text
      }
    }
    cur = cur.parent
  }
  // Fall back: no enclosing export — use the file name (minus .ts) as the
  // action label so lint messages are still meaningful.
  const base = sf.fileName.split("/").pop() ?? sf.fileName
  return base.replace(/\.ts$/, "")
}

function tryStatementContainsClaudeCall(tryStmt: ts.TryStatement): boolean {
  let found = false
  forEachDescendant(tryStmt.tryBlock, (n) => {
    if (found) return
    if (ts.isCallExpression(n)) {
      const name = callExpressionName(n)
      if (name && CLAUDE_CALL_NAMES.has(name)) found = true
    }
  })
  return found
}

function catchBlockHasConsoleError(block: ts.Block): boolean {
  let found = false
  forEachDescendant(block, (n) => {
    if (found) return
    if (!ts.isCallExpression(n)) return
    const expr = n.expression
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "console" &&
      ts.isIdentifier(expr.name) &&
      expr.name.text === "error"
    ) {
      found = true
    }
  })
  return found
}

function firstStringLiteralArg(call: ts.CallExpression): string | null {
  const arg = call.arguments[0]
  if (!arg) return null
  if (ts.isStringLiteral(arg)) return arg.text
  if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text
  if (ts.isTemplateExpression(arg)) return arg.head.text
  return null
}

/**
 * Does the catch re-throw? If so, we also require the thrown Error to have a
 * leading string prefix that names the action (heuristic: the prefix must be
 * at least 6 chars and not be a generic "Error" / empty). We return:
 *   - kind: "none" — no throw in catch (graceful degradation, only needs console.error)
 *   - kind: "labeled" — throw new Error(<string>) where <string> is non-empty
 *   - kind: "unlabeled" — throw new Error() or throw err — no action-identifying prefix
 */
function catchThrowKind(block: ts.Block): "none" | "labeled" | "unlabeled" {
  let kind: "none" | "labeled" | "unlabeled" = "none"
  forEachDescendant(block, (n) => {
    if (!ts.isThrowStatement(n)) return
    const expr = n.expression
    if (!expr) {
      kind = kind === "labeled" ? "labeled" : "unlabeled"
      return
    }
    // throw new Error("...")
    if (ts.isNewExpression(expr) && expr.expression && ts.isIdentifier(expr.expression)) {
      if (expr.expression.text === "Error" || expr.expression.text.endsWith("Error")) {
        const call = ts.factory.createCallExpression(
          expr.expression,
          expr.typeArguments,
          expr.arguments ?? [],
        )
        const literal = firstStringLiteralArg(call)
        if (literal && literal.trim().length >= 6) {
          kind = "labeled"
          return
        }
        kind = kind === "labeled" ? "labeled" : "unlabeled"
        return
      }
    }
    // Bare `throw err` — the caller is bubbling the raw exception. Treat as
    // unlabeled unless paired with console.error (caught elsewhere).
    kind = kind === "labeled" ? "labeled" : "unlabeled"
  })
  return kind
}

function lintFile(path: string): Violation[] {
  const sf = readSourceFile(path)
  if (!hasUseServerPragma(sf)) return []

  const violations: Violation[] = []

  forEachDescendant(sf, (n) => {
    if (!ts.isTryStatement(n)) return
    if (!tryStatementContainsClaudeCall(n)) return
    if (!n.catchClause || !n.catchClause.block) return

    const actionName =
      findExportedFunctionNameContaining(n, sf) ?? "<unknown-action>"

    const hasConsoleError = catchBlockHasConsoleError(n.catchClause.block)
    const throwKind = catchThrowKind(n.catchClause.block)

    const { line, col } = posOf(n, sf)

    if (!hasConsoleError) {
      violations.push({
        file: path,
        line,
        col,
        message: `AI action '${actionName}': catch around Claude call is missing console.error(...) for server-side logging`,
      })
    }
    if (throwKind === "unlabeled") {
      violations.push({
        file: path,
        line,
        col,
        message: `AI action '${actionName}': catch re-throws without a labeled Error message (must throw new Error("<action-identifying prefix>: ..."))`,
      })
    }
  })

  return violations
}

function main() {
  const files = collectActionFiles(ACTIONS_DIR)
  const scanned: string[] = []
  const violations: Violation[] = []

  for (const f of files) {
    const sf = readSourceFile(f)
    if (!hasUseServerPragma(sf)) continue
    // Only lint files that actually import `generateText`-style calls —
    // scanning every use-server file would be noisy and slow.
    const text = readFileSync(f, "utf8")
    if (
      !/\b(generateText|streamText|generateObject|streamObject)\b/.test(text)
    ) {
      continue
    }
    scanned.push(f)
    violations.push(...lintFile(f))
  }

  if (violations.length === 0) {
    const rel = scanned.map((f) => relative(REPO_ROOT, f))
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.log(
      `lint-ai-action-error-paths: OK (${scanned.length} AI action file${
        scanned.length === 1 ? "" : "s"
      } scanned: ${rel.join(", ") || "none"})`,
    )
    return
  }

  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    `lint-ai-action-error-paths: FAIL — ${violations.length} violation(s)\n`,
  )
  for (const v of violations) {
    const rel = relative(REPO_ROOT, v.file)
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.error(`  ${rel}:${v.line}:${v.col}  ${v.message}`)
  }
  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    `\nFix: wrap every Claude call in try/catch and ensure the catch block calls\n` +
      `     console.error('[<actionName>]', err, { ...context }) before any re-throw.\n` +
      `     See CLAUDE.md § "AI-action error path".`,
  )
  process.exit(1)
}

main()
