// scripts/oracles/source/_shared/xlsx-loader.ts
/**
 * XLSX fixture loader for source-level oracle scenarios. Mirrors the
 * CSV loader but reads .xlsx via exceljs.
 *
 * Path convention:
 *   fixtures/oracle/<scenario-name>/pricing.xlsx
 *
 * Per-scenario override:
 *   ORACLE_PRICING_XLSX_<SCENARIO_NAME>=/abs/path/to/file.xlsx
 *
 * Real customer XLSX files (Charles's Arthrex bundle) are typically
 * too large + sensitive to check in — the env-var override is the
 * usual path for those.
 *
 * Column resolution: by default, treats the FIRST row as headers and
 * matches by name (vendorItemNo, unitCost). For non-standard files
 * with positional column meanings, callers can pass a column-index
 * map.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import type { ScenarioPricingRow } from "./scenario"

const FIXTURES_ROOT = "fixtures/oracle"

function envVarKey(prefix: string, scenarioName: string): string {
  return `${prefix}_${scenarioName.toUpperCase().replace(/-/g, "_")}`
}

function resolvePath(scenarioName: string, fileName: "pricing.xlsx"): string {
  const override = process.env[envVarKey("ORACLE_PRICING_XLSX", scenarioName)]
  if (override) return override
  const repoPath = join(FIXTURES_ROOT, scenarioName, fileName)
  if (existsSync(repoPath)) return repoPath
  throw new Error(
    `XLSX fixture not found for scenario "${scenarioName}". Looked at:\n  - ${envVarKey("ORACLE_PRICING_XLSX", scenarioName)} (env var)\n  - ${repoPath}`,
  )
}

export interface XlsxColumnMap {
  /** 1-indexed column for vendorItemNo. Default: matches header. */
  vendorItemNo?: number
  /** 1-indexed column for unitCost. Default: matches header. */
  unitCost?: number
  /** 1-indexed column for category. Default: matches header (optional). */
  category?: number
}

export interface ParseXlsxOptions {
  /** First row is headers (default true). */
  hasHeader?: boolean
  /** Sheet name or index. Default: first sheet. */
  sheet?: string | number
  /** Override column positions when headers don't match. */
  columns?: XlsxColumnMap
}

function cellString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.trim()
  if (typeof v === "number") return String(v)
  if (typeof v === "object" && "text" in (v as object)) {
    return String((v as { text?: unknown }).text ?? "").trim()
  }
  return String(v).trim()
}

function cellNumber(v: unknown): number {
  if (typeof v === "number") return v
  const n = Number(cellString(v))
  return Number.isFinite(n) ? n : 0
}

export async function parsePricingXlsx(
  buffer: Buffer | ArrayBuffer,
  options: ParseXlsxOptions = {},
): Promise<ScenarioPricingRow[]> {
  const wb = new ExcelJS.Workbook()
  // exceljs accepts both Buffer and ArrayBuffer via load()
  await wb.xlsx.load(buffer as ArrayBuffer)
  const sheet =
    typeof options.sheet === "number"
      ? wb.worksheets[options.sheet]
      : typeof options.sheet === "string"
        ? wb.getWorksheet(options.sheet)
        : wb.worksheets[0]
  if (!sheet) {
    throw new Error("XLSX file has no worksheet")
  }

  const hasHeader = options.hasHeader ?? true
  let cols: XlsxColumnMap = options.columns ?? {}

  // If columns aren't explicitly mapped, resolve by header name on row 1.
  if (hasHeader && (!cols.vendorItemNo || !cols.unitCost)) {
    const headerRow = sheet.getRow(1)
    const headerMap = new Map<string, number>()
    headerRow.eachCell((cell, col) => {
      headerMap.set(cellString(cell.value).toLowerCase(), col)
    })
    cols = {
      vendorItemNo:
        cols.vendorItemNo ??
        headerMap.get("vendoritemno") ??
        headerMap.get("vendor item no") ??
        headerMap.get("item") ??
        undefined,
      unitCost:
        cols.unitCost ??
        headerMap.get("unitcost") ??
        headerMap.get("unit cost") ??
        headerMap.get("unitprice") ??
        headerMap.get("unit price") ??
        headerMap.get("price") ??
        undefined,
      category: cols.category ?? headerMap.get("category"),
    }
  }

  if (!cols.vendorItemNo || !cols.unitCost) {
    throw new Error(
      `XLSX missing required columns. Resolved: ${JSON.stringify(cols)}. Set columns explicitly via options.columns when headers don't match.`,
    )
  }

  const rows: ScenarioPricingRow[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (hasHeader && rowNum === 1) return
    const itemNo = cellString(row.getCell(cols.vendorItemNo!).value)
    if (!itemNo) return
    const unit = cellNumber(row.getCell(cols.unitCost!).value)
    const cat = cols.category
      ? cellString(row.getCell(cols.category).value) || undefined
      : undefined
    rows.push({
      vendorItemNo: itemNo,
      unitCost: unit,
      category: cat,
    })
  })
  return rows
}

export async function loadPricingXlsx(
  scenarioName: string,
  options: ParseXlsxOptions = {},
): Promise<ScenarioPricingRow[]> {
  const path = resolvePath(scenarioName, "pricing.xlsx")
  return parsePricingXlsx(readFileSync(path), options)
}
