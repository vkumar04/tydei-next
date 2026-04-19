export interface ExportRow {
  name: string
  vendorName: string
  contractType: string
  status: string
  effectiveDate: string
  expirationDate: string
  totalValue: number
  spend: number
  rebateEarned: number
}

const HEADERS = [
  "Contract Name",
  "Vendor",
  "Type",
  "Status",
  "Effective Date",
  "Expiration Date",
  "Total Value",
  "Spend",
  "Rebate Earned",
]

function quote(v: string | number): string {
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildContractsCSV(rows: ExportRow[]): string {
  const lines = [HEADERS.join(",")]
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.vendorName,
        r.contractType.replace(/_/g, " "),
        r.status,
        r.effectiveDate,
        r.expirationDate,
        r.totalValue,
        r.spend,
        r.rebateEarned,
      ]
        .map(quote)
        .join(","),
    )
  }
  return lines.join("\n")
}
