# Source Oracle Fixture Loaders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add a CSV fixture loader so source-level scenarios can pull pricing rows + COG rows from `fixtures/oracle/<scenario-name>/` files instead of inlining hundreds of items in TypeScript. Plumbs the path-resolution convention (`fixtures/oracle/` checked-in for small fixtures; env-var override for larger desktop-only files). XLSX loader and the migration of `scripts/verify-app-against-oracle.ts` are explicitly deferred — they have dependencies on real-customer files that aren't in the repo.

**Architecture:** New module `scripts/oracles/source/_shared/fixture-loader.ts` exporting `loadPricingCsv(scenarioName)` and `loadCogCsv(scenarioName)`. Each takes a scenario name, resolves the file at `fixtures/oracle/<name>/{pricing.csv,cog.csv}` (or an env-var-pointed override for that scenario), parses headers and rows, and returns `ScenarioPricingRow[]` / `ScenarioCogRow[]`. Pure function over a file path string + the file's contents — no Prisma, no IO except `readFileSync`. Unit-tested with in-memory CSV fixtures.

**Tech Stack:** TypeScript strict, Bun runtime, Vitest for unit tests. No new deps — Node's built-in CSV parsing via splitting works for the simple shape we use.

**Why this scope:** Plan #2 from `2026-04-26-source-level-oracle-design.md`. Provides the missing piece for scenarios that have hundreds of pricing/COG rows (real customer files). Without it, Plan #3 scenarios are constrained to inline JSON (~10-50 rows).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/oracles/source/_shared/fixture-loader.ts` | Create | CSV loaders + path resolution. Pure over file content. |
| `scripts/oracles/source/_shared/__tests__/fixture-loader.test.ts` | Create | Unit tests using in-memory CSV strings. |
| `fixtures/oracle/.gitkeep` | Create | Empty marker so the dir exists in git. |
| `fixtures/oracle/README.md` | Create | One-page convention doc. |

XLSX loader deferred — it requires `exceljs`, the parser logic is non-trivial, and the only prospective consumer (`verify-app-against-oracle.ts`) is itself deferred. Punted to its own plan.

---

## Task 1: Failing test

**Files:**
- Create: `scripts/oracles/source/_shared/__tests__/fixture-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/oracles/source/_shared/__tests__/fixture-loader.test.ts
import { describe, it, expect } from "vitest"
import { parsePricingCsv, parseCogCsv } from "../fixture-loader"

describe("parsePricingCsv", () => {
  it("parses standard headers", () => {
    const csv = `vendorItemNo,unitCost,category,manufacturer
ARC-1,100.00,Spine,Stryker
ARC-2,200.50,Joint Replacement,
`
    const rows = parsePricingCsv(csv)
    expect(rows).toEqual([
      { vendorItemNo: "ARC-1", unitCost: 100.0, category: "Spine", manufacturer: "Stryker" },
      { vendorItemNo: "ARC-2", unitCost: 200.5, category: "Joint Replacement", manufacturer: undefined },
    ])
  })

  it("ignores blank lines and surrounding whitespace", () => {
    const csv = `vendorItemNo,unitCost
   ARC-1  ,  100.00

ARC-2,200.00
`
    const rows = parsePricingCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0].vendorItemNo).toBe("ARC-1")
    expect(rows[0].unitCost).toBe(100)
  })

  it("throws if vendorItemNo or unitCost columns missing", () => {
    expect(() => parsePricingCsv(`foo,bar\n1,2\n`)).toThrow(
      /vendorItemNo|unitCost/i,
    )
  })

  it("throws if a unitCost cell is not parseable", () => {
    expect(() =>
      parsePricingCsv(`vendorItemNo,unitCost\nARC-1,abc\n`),
    ).toThrow(/unitCost/)
  })
})

describe("parseCogCsv", () => {
  it("parses standard headers", () => {
    const csv = `vendorItemNo,quantity,unitCost,extendedPrice,transactionDate,category
ARC-1,5,100.00,500.00,2024-03-15,Spine
ARC-2,2,250.00,500.00,2024-04-01,
`
    const rows = parseCogCsv(csv)
    expect(rows).toEqual([
      { vendorItemNo: "ARC-1", quantity: 5, unitCost: 100, extendedPrice: 500, transactionDate: "2024-03-15", category: "Spine" },
      { vendorItemNo: "ARC-2", quantity: 2, unitCost: 250, extendedPrice: 500, transactionDate: "2024-04-01", category: undefined },
    ])
  })

  it("derives extendedPrice = quantity × unitCost when blank", () => {
    const csv = `vendorItemNo,quantity,unitCost,extendedPrice,transactionDate
ARC-1,5,100.00,,2024-03-15
`
    const rows = parseCogCsv(csv)
    expect(rows[0].extendedPrice).toBe(500)
  })

  it("throws if required columns missing", () => {
    expect(() => parseCogCsv(`foo\n1\n`)).toThrow(
      /vendorItemNo|quantity|unitCost|transactionDate/i,
    )
  })
})
```

- [ ] **Step 2: Run** — `bunx vitest run scripts/oracles/source/_shared/__tests__/fixture-loader.test.ts`. Expect FAIL on import resolution.

---

## Task 2: Implement loaders

**Files:**
- Create: `scripts/oracles/source/_shared/fixture-loader.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source/_shared/fixture-loader.ts
/**
 * CSV fixture loaders for source-level oracle scenarios.
 *
 * Path convention:
 *   fixtures/oracle/<scenario-name>/pricing.csv
 *   fixtures/oracle/<scenario-name>/cog.csv
 *
 * Per-scenario override (for files too large to check in):
 *   process.env.ORACLE_PRICING_<NAME>      → absolute path to pricing.csv
 *   process.env.ORACLE_COG_<NAME>          → absolute path to cog.csv
 *
 * The parsers are pure functions over file content — separated from
 * fs.readFileSync so unit tests can pass in-memory CSV strings without
 * touching disk.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type {
  ScenarioPricingRow,
  ScenarioCogRow,
} from "./scenario"

const FIXTURES_ROOT = "fixtures/oracle"

function envVarKey(prefix: string, scenarioName: string): string {
  return `${prefix}_${scenarioName.toUpperCase().replace(/-/g, "_")}`
}

function resolvePath(
  scenarioName: string,
  fileName: "pricing.csv" | "cog.csv",
  envPrefix: "ORACLE_PRICING" | "ORACLE_COG",
): string {
  const override = process.env[envVarKey(envPrefix, scenarioName)]
  if (override) return override
  const repoPath = join(FIXTURES_ROOT, scenarioName, fileName)
  if (existsSync(repoPath)) return repoPath
  throw new Error(
    `Fixture not found for scenario "${scenarioName}". Looked at:\n  - ${envVarKey(envPrefix, scenarioName)} (env var)\n  - ${repoPath}`,
  )
}

interface ParsedRow {
  [header: string]: string
}

function parseCsv(csv: string): ParsedRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const headers = lines[0].split(",").map((h) => h.trim())
  const rows: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim())
    const row: ParsedRow = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? ""
    }
    rows.push(row)
  }
  return rows
}

function requireHeaders(rows: ParsedRow[], required: string[]): void {
  if (rows.length === 0) {
    throw new Error(`CSV has no data rows. Required: ${required.join(", ")}`)
  }
  const sample = rows[0]
  const missing = required.filter((h) => !(h in sample))
  if (missing.length > 0) {
    throw new Error(
      `CSV missing required column(s): ${missing.join(", ")}. Saw: ${Object.keys(sample).join(", ")}`,
    )
  }
}

function parseNumber(value: string, label: string, line: number): number {
  const n = Number(value)
  if (Number.isNaN(n)) {
    throw new Error(
      `${label} on row ${line + 1}: "${value}" is not a parseable number`,
    )
  }
  return n
}

export function parsePricingCsv(csv: string): ScenarioPricingRow[] {
  const rows = parseCsv(csv)
  requireHeaders(rows, ["vendorItemNo", "unitCost"])
  return rows.map((r, i) => ({
    vendorItemNo: r.vendorItemNo,
    unitCost: parseNumber(r.unitCost, "unitCost", i),
    category: r.category || undefined,
    manufacturer: r.manufacturer || undefined,
  }))
}

export function parseCogCsv(csv: string): ScenarioCogRow[] {
  const rows = parseCsv(csv)
  requireHeaders(rows, [
    "vendorItemNo",
    "quantity",
    "unitCost",
    "transactionDate",
  ])
  return rows.map((r, i) => {
    const quantity = parseNumber(r.quantity, "quantity", i)
    const unitCost = parseNumber(r.unitCost, "unitCost", i)
    const extendedPrice = r.extendedPrice
      ? parseNumber(r.extendedPrice, "extendedPrice", i)
      : quantity * unitCost
    return {
      vendorItemNo: r.vendorItemNo,
      quantity,
      unitCost,
      extendedPrice,
      transactionDate: r.transactionDate,
      category: r.category || undefined,
      inventoryNumber: r.inventoryNumber || undefined,
      inventoryDescription: r.inventoryDescription || undefined,
    }
  })
}

export function loadPricingCsv(scenarioName: string): ScenarioPricingRow[] {
  const path = resolvePath(scenarioName, "pricing.csv", "ORACLE_PRICING")
  return parsePricingCsv(readFileSync(path, "utf8"))
}

export function loadCogCsv(scenarioName: string): ScenarioCogRow[] {
  const path = resolvePath(scenarioName, "cog.csv", "ORACLE_COG")
  return parseCogCsv(readFileSync(path, "utf8"))
}
```

- [ ] **Step 2: Run unit tests**

`bunx vitest run scripts/oracles/source/_shared/__tests__/fixture-loader.test.ts`. Expect 7/7 PASS.

- [ ] **Step 3: Typecheck**

`bunx tsc --noEmit`. 0 errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/oracles/source/_shared/fixture-loader.ts scripts/oracles/source/_shared/__tests__/fixture-loader.test.ts
git commit -m "feat(oracles): CSV fixture loaders for source scenarios

parsePricingCsv + parseCogCsv (pure, content-in / rows-out) plus
loadPricingCsv / loadCogCsv that resolve fixtures/oracle/<name>/...
with env-var overrides for files too large to check in.

Spec 2026-04-26-source-level-oracle-design.md Plan #2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Repo convention + README

**Files:**
- Create: `fixtures/oracle/.gitkeep`
- Create: `fixtures/oracle/README.md`

- [ ] **Step 1: Create the directory + README**

```bash
mkdir -p fixtures/oracle
touch fixtures/oracle/.gitkeep
```

```markdown
# fixtures/oracle/

Source-level oracle scenarios load their pricing and COG fixtures from
this directory. Layout:

```
fixtures/oracle/
  <scenario-name>/
    pricing.csv      # ScenarioPricingRow[] (vendorItemNo, unitCost, [category, manufacturer])
    cog.csv          # ScenarioCogRow[] (vendorItemNo, quantity, unitCost, [extendedPrice], transactionDate, [category, inventoryNumber, inventoryDescription])
```

Small fixtures (under ~1MB) get checked in. Larger files use an
env-var-pointed override:

```
ORACLE_PRICING_<SCENARIO_NAME>=/abs/path/to/pricing.csv
ORACLE_COG_<SCENARIO_NAME>=/abs/path/to/cog.csv
```

Where `<SCENARIO_NAME>` is the scenario's `name` field upper-cased with
hyphens replaced by underscores. So a scenario named
`arthrex-canonical` looks up `ORACLE_PRICING_ARTHREX_CANONICAL`.

## Conventions

- CSVs are UTF-8, comma-separated, with a header row.
- Header names are exact (case-sensitive). Required columns:
  - pricing: `vendorItemNo`, `unitCost`
  - cog: `vendorItemNo`, `quantity`, `unitCost`, `transactionDate`
- Optional columns are read if present, ignored if absent.
- `extendedPrice` defaults to `quantity × unitCost` when blank.
- Dates are ISO `YYYY-MM-DD`.

## When to inline vs file

Inline JSON in the scenario `.ts` file when the fixture has fewer than
~50 rows. Use checked-in CSV files in `fixtures/oracle/<scenario>/`
when there are more rows or the data should be human-editable. Use an
env-var override only when the file is too large or sensitive to check
in.
```

- [ ] **Step 2: Commit**

```bash
git add fixtures/oracle/.gitkeep fixtures/oracle/README.md
git commit -m "docs(oracles): fixture/oracle/ convention + README

Marks the dir + documents the loader contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Push

- [ ] **Step 1: Verify** — `bunx tsc --noEmit && bunx vitest run scripts/oracles`. All green.

- [ ] **Step 2: Rebase + push**

```bash
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

---

## Self-review

**1. Coverage:** loaders done; XLSX deferred (separate plan); `verify-app-against-oracle.ts` migration deferred.

**2. No placeholders:** every step has the actual code.

**3. Risk:** the simple `split(",")` parser doesn't handle quoted commas or escaped quotes — fine for the small synthetic fixtures we'll check in. If/when we need real-world CSVs, swap in `papaparse` or similar.

---

## Out of scope / follow-ups

- **XLSX loader** (separate plan). The existing `scripts/verify-app-against-oracle.ts` has an exceljs-based loader; reuse it once we generalize.
- **Migration of `verify-app-against-oracle.ts`** as a real-customer-file scenario. Needs XLSX loader + a decision on whether Charles's desktop files belong in the repo or stay env-var-pointed.
- **Robust CSV parser** (quoted commas, embedded newlines). YAGNI until a real fixture needs it.
