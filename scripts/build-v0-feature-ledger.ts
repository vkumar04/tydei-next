/**
 * V0 feature ledger — walks the v0 source tree and extracts every
 * user-visible string from a fixed set of "feature-bearing" JSX
 * components: TabsTrigger, DialogTitle, CardTitle, Button, Field,
 * FormLabel, AccordionTrigger, SelectValue placeholder.
 *
 * Writes two artifacts:
 *   docs/v0-feature-ledger.json  — canonical ledger (sorted, stable)
 *   docs/v0-feature-ledger.md    — human-readable summary
 *
 * The ledger exists as a tripwire against "visual parity" refactors
 * that silently delete real features. Concretely: the Pending Approval
 * tab, Payor Contracts tab, and Clear Prior Data button were all
 * lost in one such refactor because nothing verified they still
 * existed. This script is the missing verification.
 *
 * Two commands:
 *   bun run scripts/build-v0-feature-ledger.ts          # rebuild
 *   bun run scripts/build-v0-feature-ledger.ts --check  # CI diff
 *
 * --check reads the current ledger on disk, rebuilds in memory, and
 * exits non-zero if anything changed. Use in qa scripts.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, relative } from "path"
import ts from "typescript"

// ─── Config ─────────────────────────────────────────────────────

const V0_ROOT = process.env.V0_ROOT ?? `${process.env.HOME}/Downloads/b_kkwtOYstuRr`
const V0_APP_DIR = join(V0_ROOT, "app")
const V0_COMPONENTS_DIR = join(V0_ROOT, "components")
const OUT_JSON = join(process.cwd(), "docs/v0-feature-ledger.json")
const OUT_MD = join(process.cwd(), "docs/v0-feature-ledger.md")

// The components whose children/props represent a "feature" a user
// can see. Extend this list carefully — false positives dilute
// the tripwire.
const FEATURE_COMPONENTS = new Set([
  "TabsTrigger",
  "DialogTitle",
  "AlertDialogTitle",
  "SheetTitle",
  "CardTitle",
  "Button",
  "FormLabel",
  "Label",
  "AccordionTrigger",
])

// Components whose text label lives in a prop (not children).
const PROP_LABELED_COMPONENTS: Record<string, string[]> = {
  Field: ["label"],
  FormField: ["label"],
  SelectValue: ["placeholder"],
  Input: ["placeholder"],
  Textarea: ["placeholder"],
}

// ─── File walk ──────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || ent.name === "node_modules") continue
    const full = join(dir, ent.name)
    if (ent.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) out.push(full)
  }
  return out
}

// ─── Feature extraction ─────────────────────────────────────────

interface FeatureEntry {
  kind: string // e.g. "TabsTrigger"
  label: string // the user-visible text
  file: string // relative path under V0_ROOT
}

function normalizeLabel(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\{[^}]*\}/g, "") // strip JSX expressions
    .trim()
}

function extractFromFile(filePath: string): FeatureEntry[] {
  const src = readFileSync(filePath, "utf8")
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rel = relative(V0_ROOT, filePath)
  const out: FeatureEntry[] = []

  const getTagName = (node: ts.JsxOpeningLikeElement): string => {
    const tag = node.tagName
    if (ts.isIdentifier(tag)) return tag.text
    if (ts.isPropertyAccessExpression(tag)) return tag.name.text
    return ""
  }

  const getChildText = (el: ts.JsxElement): string => {
    const parts: string[] = []
    for (const child of el.children) {
      if (ts.isJsxText(child)) {
        const t = child.text.trim()
        if (t) parts.push(t)
      } else if (
        ts.isJsxExpression(child) &&
        child.expression &&
        ts.isStringLiteral(child.expression)
      ) {
        parts.push(child.expression.text)
      } else if (ts.isJsxElement(child)) {
        // Recurse one level — catches <Button><Icon /> Save </Button>
        const nested = getChildText(child)
        if (nested) parts.push(nested)
      }
    }
    return normalizeLabel(parts.join(" "))
  }

  const getPropString = (
    node: ts.JsxOpeningLikeElement,
    propName: string,
  ): string | null => {
    for (const attr of node.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue
      if (!ts.isIdentifier(attr.name)) continue
      if (attr.name.text !== propName) continue
      const init = attr.initializer
      if (!init) return null
      if (ts.isStringLiteral(init)) return normalizeLabel(init.text)
      if (
        ts.isJsxExpression(init) &&
        init.expression &&
        ts.isStringLiteral(init.expression)
      ) {
        return normalizeLabel(init.expression.text)
      }
      return null
    }
    return null
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const tag = getTagName(node.openingElement)
      if (FEATURE_COMPONENTS.has(tag)) {
        const text = getChildText(node)
        if (text) out.push({ kind: tag, label: text, file: rel })
      }
      if (PROP_LABELED_COMPONENTS[tag]) {
        for (const p of PROP_LABELED_COMPONENTS[tag]) {
          const v = getPropString(node.openingElement, p)
          if (v) out.push({ kind: `${tag}@${p}`, label: v, file: rel })
        }
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      const tag = getTagName(node)
      if (PROP_LABELED_COMPONENTS[tag]) {
        for (const p of PROP_LABELED_COMPONENTS[tag]) {
          const v = getPropString(node, p)
          if (v) out.push({ kind: `${tag}@${p}`, label: v, file: rel })
        }
      }
      // Self-closing Button etc. with children={"..."} — rare but possible
      if (FEATURE_COMPONENTS.has(tag)) {
        const v = getPropString(node, "children")
        if (v) out.push({ kind: tag, label: v, file: rel })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return out
}

// ─── Route mapping ──────────────────────────────────────────────
//
// Group extracted entries by the nearest parent `page.tsx` route so
// the ledger is navigable ("every feature that appears on
// /dashboard/case-costing"). Component files are bucketed as "shared".

function routeFor(filePath: string): string {
  const rel = relative(V0_ROOT, filePath)
  if (!rel.startsWith("app/")) return "_shared"
  // Drop leading "app/", then trim the trailing filename
  const trimmed = rel.replace(/^app\//, "").replace(/\/[^/]+$/, "")
  if (!trimmed) return "/"
  return "/" + trimmed
}

// ─── Build ──────────────────────────────────────────────────────

interface Ledger {
  generatedAt: string
  v0Root: string
  totals: { files: number; entries: number }
  // route → kind → sorted, deduped labels
  routes: Record<string, Record<string, string[]>>
}

function buildLedger(): Ledger {
  const files = [...walk(V0_APP_DIR), ...walk(V0_COMPONENTS_DIR)]
  const all: FeatureEntry[] = []
  for (const f of files) {
    try {
      all.push(...extractFromFile(f))
    } catch (err) {
      console.warn(`skip ${f}: ${(err as Error).message}`)
    }
  }

  const routes: Record<string, Record<string, Set<string>>> = {}
  for (const entry of all) {
    const abs = join(V0_ROOT, entry.file)
    const route = routeFor(abs)
    routes[route] ??= {}
    routes[route][entry.kind] ??= new Set()
    routes[route][entry.kind].add(entry.label)
  }

  // Sort keys and values for deterministic output
  const sortedRoutes: Record<string, Record<string, string[]>> = {}
  for (const route of Object.keys(routes).sort()) {
    const kinds = routes[route]
    sortedRoutes[route] = {}
    for (const kind of Object.keys(kinds).sort()) {
      sortedRoutes[route][kind] = [...kinds[kind]].sort()
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    v0Root: V0_ROOT,
    totals: { files: files.length, entries: all.length },
    routes: sortedRoutes,
  }
}

function renderMarkdown(ledger: Ledger): string {
  const lines: string[] = []
  lines.push(`# V0 Feature Ledger`)
  lines.push(``)
  lines.push(`_Auto-generated from \`${ledger.v0Root}\`_`)
  lines.push(
    `_${ledger.totals.entries} entries across ${ledger.totals.files} files — last built ${ledger.generatedAt}_`,
  )
  lines.push(``)
  lines.push(
    `> Tripwire ledger. Every string below is a user-visible feature in the v0 prototype. `,
  )
  lines.push(
    `> If tydei is missing a non-deprecated entry from this list, we've deleted a real feature. `,
  )
  lines.push(
    `> Run \`bun run scripts/build-v0-feature-ledger.ts --check\` to diff against the committed ledger.`,
  )
  lines.push(``)
  for (const route of Object.keys(ledger.routes)) {
    const kinds = ledger.routes[route]
    lines.push(`## \`${route}\``)
    for (const kind of Object.keys(kinds)) {
      lines.push(`  **${kind}:** ${kinds[kind].map((l) => `\`${l}\``).join(", ")}`)
    }
    lines.push(``)
  }
  return lines.join("\n")
}

// ─── Entrypoint ─────────────────────────────────────────────────

function main() {
  const check = process.argv.includes("--check")

  if (!existsSync(V0_ROOT)) {
    console.error(`\x1b[31mv0 source not found at ${V0_ROOT}\x1b[0m`)
    console.error(`set V0_ROOT env var to override`)
    process.exit(1)
  }

  const ledger = buildLedger()
  const json = JSON.stringify(ledger, null, 2)
  const md = renderMarkdown(ledger)

  if (check) {
    if (!existsSync(OUT_JSON)) {
      console.error(`\x1b[31mno committed ledger at ${OUT_JSON} — run without --check first\x1b[0m`)
      process.exit(1)
    }
    const prev = JSON.parse(readFileSync(OUT_JSON, "utf8")) as Ledger
    // Compare routes tree, ignore generatedAt
    const a = JSON.stringify(prev.routes)
    const b = JSON.stringify(ledger.routes)
    if (a !== b) {
      console.error(
        `\x1b[31mv0 feature ledger has drifted — re-run without --check to accept the new baseline\x1b[0m`,
      )
      // Diff at the route level to give a useful hint
      const allRoutes = new Set([...Object.keys(prev.routes), ...Object.keys(ledger.routes)])
      for (const r of [...allRoutes].sort()) {
        const left = JSON.stringify(prev.routes[r] ?? {})
        const right = JSON.stringify(ledger.routes[r] ?? {})
        if (left !== right) console.error(`  changed: ${r}`)
      }
      process.exit(1)
    }
    console.log(
      `\x1b[32m✓ v0 feature ledger unchanged (${ledger.totals.entries} entries, ${Object.keys(ledger.routes).length} routes)\x1b[0m`,
    )
    return
  }

  mkdirSync(join(process.cwd(), "docs"), { recursive: true })
  writeFileSync(OUT_JSON, json + "\n")
  writeFileSync(OUT_MD, md)
  console.log(
    `\x1b[32mwrote ${OUT_JSON}\x1b[0m (${ledger.totals.entries} entries, ${Object.keys(ledger.routes).length} routes)`,
  )
  console.log(`\x1b[32mwrote ${OUT_MD}\x1b[0m`)
}

main()
