/**
 * Data pipeline — invoice variance population.
 *
 * Pure helper that takes invoice line items + a contract price lookup
 * and builds the `InvoicePriceVariance` upsert input for subsystem 1 of
 * the data-pipeline rewrite.
 *
 * This helper wraps the domain logic in `lib/contracts/price-variance.ts::
 * analyzePriceDiscrepancies` (contracts-rewrite subsystem 5) and shapes
 * the result into the exact row shape the Prisma `InvoicePriceVariance`
 * upsert expects. Keeping this in the data-pipeline module means
 * `lib/actions/invoices.ts` only depends on a pure, well-typed helper —
 * easy to unit test without touching the database.
 *
 * Reference: docs/superpowers/specs/2026-04-18-data-pipeline-rewrite.md §4.1
 */

import {
  analyzePriceDiscrepancies,
  type InvoiceLineForVariance as ContractInvoiceLine,
} from "@/lib/contracts/price-variance"

export interface InvoiceLineForVariance {
  id: string
  contractId: string
  vendorItemNo: string
  /** Actual price on the invoice line. */
  invoicePrice: number
  invoiceQuantity: number
}

export interface VarianceRow {
  invoiceLineItemId: string
  contractId: string
  contractPrice: number
  actualPrice: number
  variancePercent: number
  /** Dollars = (actualPrice - contractPrice) × quantity. Signed. */
  variance: number
  severity: "minor" | "moderate" | "major"
}

export interface ComputeInvoiceVariancesInput {
  lineItems: InvoiceLineForVariance[]
  /** Key convention: `${contractId}::${vendorItemNo}` → unit price. */
  priceLookup: Map<string, number>
}

/**
 * Compute the variance rows to upsert for a set of invoice line items.
 *
 * Algorithm:
 *  - For each line item, look up the contract price via
 *    `${contractId}::${vendorItemNo}`.
 *  - Lines with no matching contract price are skipped (not covered by
 *    this contract).
 *  - `variancePercent = ((invoicePrice - contractPrice) / contractPrice) × 100`
 *  - `variance = (invoicePrice - contractPrice) × invoiceQuantity`
 *  - Severity on `|variancePercent|`:
 *    - `< 2` → minor
 *    - `< 10` → moderate
 *    - `else` → major
 *  - Lines with zero variance (exact contract-price match) are skipped —
 *    no-variance rows aren't stored.
 */
export function computeInvoiceVariances(
  input: ComputeInvoiceVariancesInput,
): VarianceRow[] {
  const { lineItems, priceLookup } = input

  // Adapt our input shape to the one `analyzePriceDiscrepancies` expects.
  const adapted: ContractInvoiceLine[] = lineItems.map((li) => ({
    id: li.id,
    contractId: li.contractId,
    vendorItemNo: li.vendorItemNo,
    actualPrice: li.invoicePrice,
    quantity: li.invoiceQuantity,
  }))

  const analysis = analyzePriceDiscrepancies(adapted, priceLookup)

  const rows: VarianceRow[] = []
  for (const a of analysis.lines) {
    // Skip exact-match lines — no variance row to persist.
    if (a.variancePercent === 0) continue

    rows.push({
      invoiceLineItemId: a.line.id,
      contractId: a.line.contractId,
      contractPrice: a.contractPrice,
      actualPrice: a.line.actualPrice,
      variancePercent: a.variancePercent,
      variance: a.dollarImpact,
      severity: a.severity,
    })
  }

  return rows
}
