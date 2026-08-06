import type { DealConstruct } from "@/lib/prospective-analysis/blend-constructs"

export const NO_PROPOSAL = "__none__"
export const ALL_CATEGORIES = "__all__"

// One "construct" per product line: pick a benchmark (or free-text), then enter
// the Current / Floor / Target / Ask unit prices, annual volume and rebate %.
// Keyed by a stable UI-only _uid (CLAUDE.md: editable lists key by id, not idx).
export interface ConstructForm {
  _uid: string
  benchmarkId: string | null
  productName: string
  /** Editable per-construct category — seeded from the benchmark's Category
   *  column (when the uploaded file has one) or the attached proposal's single
   *  category, but always overridable so a benchmark file WITHOUT a Category
   *  column never strands the construct as "uncategorized" (Charles
   *  2026-07-06 "categories not coming through"). */
  category: string
  current: string
  floor: string
  target: string
  ask: string
  annualVolume: string
  rebatePercent: string
}

export function makeConstruct(seed?: Partial<ConstructForm>): ConstructForm {
  return {
    _uid: crypto.randomUUID(),
    benchmarkId: null,
    productName: "",
    category: "",
    current: "",
    floor: "",
    target: "",
    ask: "",
    annualVolume: "",
    rebatePercent: "0",
    ...seed,
  }
}

export function constructToDeal(c: ConstructForm): DealConstruct {
  return {
    current: Number(c.current || "0"),
    floor: Number(c.floor || "0"),
    target: Number(c.target || "0"),
    ask: Number(c.ask || "0"),
    annualVolume: Number(c.annualVolume || "0"),
    rebatePercent: Number(c.rebatePercent || "0"),
  }
}
