/**
 * Charles audit suggestion #4 (v0-port): per-asset capital line items.
 *
 * v0's tie-in shape is `LeasedServiceItem[]` — one Contract can finance
 * multiple pieces of equipment with their own description / serial /
 * cost / rate / payment cadence.
 *
 * Capital lives ONLY in `ContractCapitalLineItem` rows. The legacy
 * single-row capital fields on Contract were removed in the v0-port
 * cleanup; existing data was migrated via
 * `scripts/migrate-capital-to-line-items.ts`. Schedule aggregation
 * downstream sums per-item PMT to produce the combined view.
 */

import type { Contract, ContractCapitalLineItem } from "@/lib/generated/prisma/client"

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
  paymentCadence: "monthly" | "quarterly" | "semi_annual" | "annual"
}

type ContractWithLineItems = Pick<Contract, "id" | "name"> & {
  capitalLineItems?: ContractCapitalLineItem[]
}

export function normalizeCapitalLineItems(
  contract: ContractWithLineItems,
): NormalizedCapitalLineItem[] {
  const real = contract.capitalLineItems ?? []
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
  }))
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
): "monthly" | "quarterly" | "semi_annual" | "annual" {
  // Bug 2026-06-08 ("monthly amortization schedule going back to monthly
  // again — I selected semi annual"): `semi_annual` was missing from the
  // allow-list, so a semi-annual capital line item silently downgraded to
  // monthly in the amortization schedule. Include every cadence the enum
  // (and the form's selector) supports.
  if (raw === "quarterly" || raw === "semi_annual" || raw === "annual") {
    return raw
  }
  return "monthly"
}
