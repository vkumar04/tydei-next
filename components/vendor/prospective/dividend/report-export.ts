"use client"

import type {
  ProformaLineItems,
  PurchaseScenario,
  PurchaseDividendImpact,
} from "@/lib/financial-analysis/proforma-pnl"

// Client-side report exports for a Dividend/DCF proposal: a printable,
// self-contained HTML report (print-to-PDF from the browser) and a CSV of the
// key figures. No PDF library involved — the server-side PDF pipeline
// (lib/pdf.ts) stays the only PDF renderer in the app.

export interface DividendReportContext {
  proposalName: string
  facilityLabel: string
  lineItems: ProformaLineItems
  purchase: PurchaseScenario
  payorGroupNames: string[]
  percentOfMedicare: number
  medicareRate: number
  facilityReimbursement: number
  totalSelectedVolume: number
  impact: PurchaseDividendImpact
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n))
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function safeName(name: string): string {
  return (
    name
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "proposal"
  )
}

/** Escape user-entered text for interpolation into the HTML report. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function exportDividendReportHtml(ctx: DividendReportContext) {
  const { impact } = ctx
  const verdictLabel =
    impact.verdict === "accretive"
      ? "Accretive — increases the dividend"
      : impact.verdict === "dilutive"
        ? "Dilutive — reduces the dividend"
        : "Neutral — no material effect"
  const verdictColor =
    impact.verdict === "accretive"
      ? "#15803d"
      : impact.verdict === "dilutive"
        ? "#b91c1c"
        : "#525252"

  const deltaRow = (
    label: string,
    before: number,
    after: number,
    invert = false,
  ) => {
    const d = after - before
    const good = invert ? d < 0 : d > 0
    const color = Math.abs(d) < 1 ? "#525252" : good ? "#15803d" : "#b91c1c"
    return `<tr><td>${label}</td><td class="num">${fmtUSD(before)}</td><td class="num">${fmtUSD(
      after,
    )}</td><td class="num" style="color:${color}">${
      Math.abs(d) < 1 ? "—" : `${d > 0 ? "+" : ""}${fmtUSD(d)}`
    }</td></tr>`
  }

  const evRows = impact.evScenarios
    .map(
      (s) =>
        `<tr><td>${s.multiple.toFixed(1)}× EBITDA</td><td class="num">${fmtUSD(
          s.incrementalEvNetOfCapital,
        )}</td></tr>`,
    )
    .join("")

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(ctx.proposalName)} — Dividend & DCF Impact Report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #171717; margin: 0 auto; padding: 40px; max-width: 900px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #525252; margin: 32px 0 8px; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
  .muted { color: #737373; font-size: 13px; }
  .verdict { display: inline-block; margin-top: 12px; padding: 10px 16px; border-radius: 8px; font-weight: 600; color: #fff; background: ${verdictColor}; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
  .kpi { border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px; }
  .kpi .label { font-size: 11px; color: #737373; }
  .kpi .value { font-size: 18px; font-weight: 700; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #f0f0f0; }
  th { font-size: 11px; text-transform: uppercase; color: #737373; letter-spacing: .03em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 13px; margin-top: 8px; }
  .grid2 div { display: flex; justify-content: space-between; border-bottom: 1px solid #f5f5f5; padding: 5px 0; }
  .grid2 span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
  footer { margin-top: 40px; font-size: 11px; color: #a3a3a3; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } table, .kpis { break-inside: avoid; } }
</style></head>
<body>
  <h1>${esc(ctx.proposalName)}</h1>
  <div class="muted">Dividend &amp; DCF Impact Report · ${esc(ctx.facilityLabel)} · Generated ${new Date().toLocaleString()}</div>
  <div class="verdict">${verdictLabel}</div>

  <div class="kpis">
    <div class="kpi"><div class="label">NOI impact / yr</div><div class="value">${fmtUSD(impact.noiImpact)}</div></div>
    <div class="kpi"><div class="label">Dividend impact / yr</div><div class="value">${fmtUSD(impact.annualDividendImpact)}</div></div>
    <div class="kpi"><div class="label">Net present value</div><div class="value">${fmtUSD(impact.netPresentValue)}</div></div>
    <div class="kpi"><div class="label">Payback</div><div class="value">${
      impact.paybackYears !== null ? `${impact.paybackYears.toFixed(1)} yrs` : impact.capitalOutlay > 0 ? "None" : "n/a"
    }</div></div>
  </div>

  <h2>Purchase Scenario</h2>
  <div class="grid2">
    <div><span>Product / proposal</span><span>${esc(ctx.purchase.productName)}</span></div>
    <div><span>Supply cost Δ / case</span><span>${fmtUSD(ctx.purchase.supplyCostDeltaPerCase)}</span></div>
    <div><span>Affected cases / yr</span><span>${fmtNum(ctx.purchase.affectedCases)}</span></div>
    <div><span>Incremental new cases / yr</span><span>${fmtNum(ctx.purchase.incrementalCases)}</span></div>
    <div><span>Revenue Δ / case</span><span>${fmtUSD(ctx.purchase.revenueDeltaPerCase)}</span></div>
    <div><span>Capital outlay</span><span>${fmtUSD(ctx.purchase.capitalOutlay)}</span></div>
    <div><span>Recurring annual cost</span><span>${fmtUSD(ctx.purchase.recurringAnnualCost)}</span></div>
    <div><span>Reimbursement / case</span><span>${
      ctx.purchase.caseReimbursement ? fmtUSD(ctx.purchase.caseReimbursement) : "—"
    }</span></div>
  </div>

  <h2>Payor &amp; Medicare Basis</h2>
  <div class="grid2">
    <div><span>Procedure groups</span><span>${
      ctx.payorGroupNames.length ? esc(ctx.payorGroupNames.join(", ")) : "—"
    }</span></div>
    <div><span>Selected volume / yr</span><span>${fmtNum(ctx.totalSelectedVolume)}</span></div>
    <div><span>Medicare rate / case</span><span>${ctx.medicareRate ? fmtUSD(ctx.medicareRate) : "—"}</span></div>
    <div><span>% of Medicare</span><span>${ctx.percentOfMedicare}% (${(ctx.percentOfMedicare / 100).toFixed(2)}×)</span></div>
    <div><span>Facility reimbursement / case</span><span>${
      ctx.facilityReimbursement ? fmtUSD(ctx.facilityReimbursement) : "—"
    }</span></div>
  </div>

  <h2>P&amp;L Impact (Before → After)</h2>
  <table>
    <thead><tr><th>Line</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th></tr></thead>
    <tbody>
      ${deltaRow("Total revenue", impact.before.totalRevenue, impact.after.totalRevenue)}
      ${deltaRow("Medical supply expense", impact.before.medicalSupplyExpense, impact.after.medicalSupplyExpense, true)}
      ${deltaRow("Net operating income", impact.before.netOperatingIncome, impact.after.netOperatingIncome)}
      ${deltaRow("Annual dividend", impact.annualDividendBefore, impact.annualDividendAfter)}
    </tbody>
  </table>

  <h2>Enterprise Value Impact (net of capital)</h2>
  <table>
    <thead><tr><th>Multiple</th><th class="num">EV impact</th></tr></thead>
    <tbody>${evRows}</tbody>
  </table>

  <footer>Generated by Tyde-I Health · Figures are modeled estimates based on the entered facility proforma and payor-reported volume.</footer>
</body></html>`

  download(`${safeName(ctx.proposalName)}_dividend_report.html`, html, "text/html")
}

export function exportDividendReportCsv(ctx: DividendReportContext) {
  const { impact } = ctx
  const rows: [string, string | number][] = [
    ["Proposal", ctx.proposalName],
    ["Facility", ctx.facilityLabel],
    ["Generated", new Date().toISOString()],
    ["Verdict", impact.verdict],
    ["Product", ctx.purchase.productName],
    ["Supply cost delta per case", ctx.purchase.supplyCostDeltaPerCase],
    ["Affected cases per year", ctx.purchase.affectedCases],
    ["Incremental cases per year", ctx.purchase.incrementalCases],
    ["Revenue delta per case", ctx.purchase.revenueDeltaPerCase],
    ["Capital outlay", ctx.purchase.capitalOutlay],
    ["Recurring annual cost", ctx.purchase.recurringAnnualCost],
    ["Reimbursement per case", ctx.purchase.caseReimbursement ?? ""],
    ["Procedure groups", ctx.payorGroupNames.join("; ")],
    ["Selected volume per year", ctx.totalSelectedVolume],
    ["Medicare rate per case", Math.round(ctx.medicareRate)],
    ["Percent of Medicare", ctx.percentOfMedicare],
    ["Facility reimbursement per case", Math.round(ctx.facilityReimbursement)],
    ["NOI impact per year", Math.round(impact.noiImpact)],
    ["Annual dividend before", Math.round(impact.annualDividendBefore)],
    ["Annual dividend after", Math.round(impact.annualDividendAfter)],
    ["Annual dividend impact", Math.round(impact.annualDividendImpact)],
    ["Net present value", Math.round(impact.netPresentValue)],
    [
      "Payback years",
      impact.paybackYears ?? (impact.capitalOutlay > 0 ? "Never" : "n/a"),
    ],
  ]
  // Formula-injection guard: user-entered TEXT starting with = + - @ or a
  // tab/CR gets a leading apostrophe so Excel/Sheets treat it as a literal.
  // Numeric values are stringified numbers and stay unguarded.
  const cell = (v: string | number): string => {
    const s = String(v).replace(/"/g, '""')
    const guard = typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? "'" : ""
    return `"${guard}${s}"`
  }
  const csv = rows.map(([k, v]) => `${cell(k)},${cell(v)}`).join("\n")
  download(`${safeName(ctx.proposalName)}_dividend_report.csv`, csv, "text/csv")
}
