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
