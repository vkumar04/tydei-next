/**
 * Charles audit suggestion #4 (v0-port): per-asset capital line items.
 *
 * v0's tie-in shape is `LeasedServiceItem[]` — one Contract can finance
 * multiple pieces of equipment with their own description / serial /
 * cost / rate / payment cadence. This helper normalizes the read path:
 *
 *   - Contract has line items in `ContractCapitalLineItem` → return them.
 *   - Contract has none but has legacy `Contract.capitalCost > 0` → synthesize
 *     a single line item from the contract-level fields (backward compat).
 *   - Otherwise → empty array.
 *
 * Schedule aggregation downstream sums per-item PMT to produce the
 * combined amortization view.
 */

import type { Contract, ContractCapitalLineItem } from "@prisma/client"

export interface NormalizedCapitalLineItem {
  id: string
  description: string
  itemNumber: string | null
  serialNumber: string | null
  contractTotal: number
  initialSales: number
  /** Per-item interest rate as a fraction (0.05 = 5%). */
  interestRate: number
  termMonths: number
  paymentType: "fixed" | "variable"
  paymentCadence: "monthly" | "quarterly" | "annual"
  /** True when this row was synthesized from the legacy Contract.capitalCost
   * fields (no real ContractCapitalLineItem row exists). UI can hide the
   * "edit item" button when isLegacy=true to nudge migration. */
  isLegacy: boolean
}

type ContractWithLineItems = Pick<
  Contract,
  | "id"
  | "name"
  | "capitalCost"
  | "downPayment"
  | "interestRate"
  | "termMonths"
  | "paymentCadence"
> & {
  capitalLineItems?: ContractCapitalLineItem[]
}

const CADENCE_FALLBACK = "monthly" as const

export function normalizeCapitalLineItems(
  contract: ContractWithLineItems,
): NormalizedCapitalLineItem[] {
  const real = contract.capitalLineItems ?? []
  if (real.length > 0) {
    return real.map((r) => ({
      id: r.id,
      description: r.description,
      itemNumber: r.itemNumber,
      serialNumber: r.serialNumber,
      contractTotal: Number(r.contractTotal),
      initialSales: Number(r.initialSales ?? 0),
      interestRate: Number(r.interestRate ?? 0),
      termMonths: r.termMonths ?? 0,
      paymentType: (r.paymentType === "variable" ? "variable" : "fixed") as
        | "fixed"
        | "variable",
      paymentCadence: normalizeCadence(r.paymentCadence),
      isLegacy: false,
    }))
  }

  // Legacy fallback — synthesize a single item from contract-level fields.
  const capitalCost = Number(contract.capitalCost ?? 0)
  if (capitalCost <= 0) return []
  return [
    {
      id: `legacy-${contract.id}`,
      description: contract.name,
      itemNumber: null,
      serialNumber: null,
      contractTotal: capitalCost,
      initialSales: Number(contract.downPayment ?? 0),
      interestRate: Number(contract.interestRate ?? 0),
      termMonths: contract.termMonths ?? 0,
      paymentType: "fixed",
      paymentCadence: normalizeCadence(contract.paymentCadence),
      isLegacy: true,
    },
  ]
}

/**
 * Sum financed principal across all items.
 * financedPrincipal = sum(contractTotal − initialSales) per item.
 */
export function sumFinancedPrincipal(
  items: ReadonlyArray<NormalizedCapitalLineItem>,
): number {
  return items.reduce(
    (acc, i) => acc + Math.max(0, i.contractTotal - i.initialSales),
    0,
  )
}

export function sumCapitalCost(
  items: ReadonlyArray<NormalizedCapitalLineItem>,
): number {
  return items.reduce((acc, i) => acc + i.contractTotal, 0)
}

export function sumInitialSales(
  items: ReadonlyArray<NormalizedCapitalLineItem>,
): number {
  return items.reduce((acc, i) => acc + i.initialSales, 0)
}

function normalizeCadence(
  raw: string | null | undefined,
): "monthly" | "quarterly" | "annual" {
  if (raw === "quarterly" || raw === "annual") return raw
  if (raw === "monthly") return "monthly"
  return CADENCE_FALLBACK
}
