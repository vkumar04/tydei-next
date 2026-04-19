/**
 * Pure builder that turns selected contracts into the rows rendered by
 * the side-by-side compare modal. Kept isolated from React so the row
 * structure is unit-testable.
 *
 * Each row represents one metric (e.g. "Vendor"); each value slot maps
 * positionally to the contract at the same index in the input array,
 * so the modal can render a stable `metric -> columns` table.
 */

export interface CompareContract {
  id: string
  name: string
  vendorName: string
  contractType: string
  status: string
  effectiveDate: Date
  expirationDate: Date
  totalValue: number
  rebateEarned: number
  spend: number
  score: number | null
  scoreBand: string | null
}

export interface CompareRow {
  /** Human-readable metric label. */
  label: string
  /** One rendered value per input contract, in the same order. */
  values: string[]
}

export function buildCompareRows(contracts: CompareContract[]): CompareRow[] {
  const fmtMoney = (n: number): string => `$${n.toLocaleString()}`
  const fmtDate = (d: Date): string => d.toISOString().slice(0, 10)

  return [
    { label: "Vendor", values: contracts.map((c) => c.vendorName) },
    {
      label: "Type",
      values: contracts.map((c) => c.contractType.replace(/_/g, " ")),
    },
    { label: "Status", values: contracts.map((c) => c.status) },
    {
      label: "Effective",
      values: contracts.map((c) => fmtDate(c.effectiveDate)),
    },
    {
      label: "Expires",
      values: contracts.map((c) => fmtDate(c.expirationDate)),
    },
    {
      label: "Total Value",
      values: contracts.map((c) => fmtMoney(c.totalValue)),
    },
    { label: "Spend", values: contracts.map((c) => fmtMoney(c.spend)) },
    {
      label: "Rebate Earned",
      values: contracts.map((c) => fmtMoney(c.rebateEarned)),
    },
    {
      label: "Score",
      values: contracts.map((c) => (c.score == null ? "—" : String(c.score))),
    },
    {
      label: "Score Band",
      values: contracts.map((c) => c.scoreBand ?? "—"),
    },
  ]
}
