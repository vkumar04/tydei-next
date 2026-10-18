import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..")

const INTERNAL_MODULES = [
  "lib/actions/notifications.ts",
  "lib/ai/record-usage.ts",
  "lib/contracts/recompute/accrual-engine.ts",
  "lib/contracts/recompute/tie-in-shortfall-engine.ts",
  "lib/contracts/refresh-metrics-for-vendor.ts",
  "lib/contracts/synthetic-periods.ts",
  "lib/contracts/health-system-facilities.ts",
  "lib/divisions/caller-divisions.ts",
  "lib/actions/analytics/_cache.ts",
]

const MOVED_EXPORTS: Array<[string, string]> = [
  ["lib/actions/contracts/recompute-accrual.ts", "WithFacility"],
  ["lib/actions/contracts/tie-in-shortfall.ts", "WithFacility"],
  ["lib/actions/contracts/refresh-metrics.ts", "refreshContractMetricsForVendor"],
  ["lib/actions/contract-periods.ts", "computeSyntheticContractPeriods"],
  ["lib/actions/division-auth.ts", "callerVendorDivisionIds"],
  ["lib/actions/division-auth.ts", "divisionScopeWhere"],
]

function hasUseServerDirective(src: string): boolean {
  return /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src)
}

describe("helpers that take a caller-supplied tenant id are never server actions", () => {
  it.each(INTERNAL_MODULES)("%s has no \"use server\" directive", (file) => {
    expect(hasUseServerDirective(readFileSync(join(ROOT, file), "utf8"))).toBe(false)
  })

  it.each(MOVED_EXPORTS)("%s does not export %s", (file, name) => {
    const src = readFileSync(join(ROOT, file), "utf8")
    expect(src).not.toMatch(new RegExp(`export async function \\w*${name}`))
  })
})
