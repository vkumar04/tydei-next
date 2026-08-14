"use client"

import {
  resolveCapitalUsefulLifeYears,
  type ProformaLineItems,
  type PurchaseScenario,
  type PurchaseDividendImpact,
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

/** Pure builder, split from the download wrapper so it is testable under node. */
export function buildDividendReportHtml(ctx: DividendReportContext): string {
  const { impact } = ctx
  const usefulLifeYears = resolveCapitalUsefulLifeYears(
    ctx.purchase,
    impact.assumptions,
  )
  const distributablePct = Math.round(impact.assumptions.dcfPctOfEbitda * 100)
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
    opts: { invert?: boolean; indent?: boolean } = {},
  ) => {
    const d = after - before
    const good = opts.invert ? d < 0 : d > 0
    const color = Math.abs(d) < 1 ? "#525252" : good ? "#15803d" : "#b91c1c"
    return `<tr${opts.indent ? ` class="indent"` : ""}><td>${label}</td><td class="num">${fmtUSD(before)}</td><td class="num">${fmtUSD(
      after,
    )}</td><td class="num" style="color:${color}">${
      Math.abs(d) < 1 ? "—" : `${d > 0 ? "+" : ""}${fmtUSD(d)}`
    }</td></tr>`
  }

  // Not a before/after delta — a one-sided line the owners bear after the
  // purchase, rendered like the in-app row.
  const capitalChargeRow =
    impact.annualCapitalCharge > 0
      ? `<tr class="indent"><td>Annual capital charge <span class="note">(${fmtUSD(impact.capitalOutlay)} ÷ ${usefulLifeYears} yrs)</span></td><td class="num">—</td><td class="num">${fmtUSD(impact.annualCapitalCharge)}</td><td class="num" style="color:#b91c1c">−${fmtUSD(impact.annualCapitalCharge)}</td></tr>`
      : ""

  const caseVolumeDelta = impact.after.caseVolume - impact.before.caseVolume
  const caseVolumeRow = `<tr><td>Case Volume</td><td class="num">${fmtNum(impact.before.caseVolume)}</td><td class="num">${fmtNum(impact.after.caseVolume)}</td><td class="num">${caseVolumeDelta >= 0 ? "+" : ""}${fmtNum(caseVolumeDelta)}</td></tr>`

  // Spells out the NOI → dividend bridge; without it the reader sees NOI and
  // dividend differing by the capital charge with nothing naming it.
  const pnlFootnote = `Annual dividend = net operating income × ${distributablePct}% distributable cash flow${
    impact.annualCapitalCharge > 0
      ? `, less the ${fmtUSD(impact.annualCapitalCharge)} annual capital charge shown above (${fmtUSD(impact.capitalOutlay)} outlay ÷ ${usefulLifeYears} yrs)`
      : ""
  }. Change column: ${fmtUSD(impact.operatingDividendImpact)} operating${
    impact.annualCapitalCharge > 0
      ? ` − ${fmtUSD(impact.annualCapitalCharge)} capital`
      : ""
  } = ${fmtUSD(impact.annualDividendImpact)} net.`

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
  .kpi .sub { font-size: 10px; color: #737373; margin-top: 3px; }
  tr.indent td:first-child { padding-left: 26px; }
  .note { font-size: 11px; color: #737373; }
  .footnote { font-size: 11px; color: #737373; margin-top: 8px; }
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
    <div class="kpi"><div class="label">Annual Dividend (net of capital)</div><div class="value">${fmtUSD(impact.annualDividendImpact)}</div>${
      impact.annualCapitalCharge > 0
        ? `<div class="sub">${fmtUSD(impact.operatingDividendImpact)} operating − ${fmtUSD(impact.annualCapitalCharge)} capital</div>`
        : `<div class="sub">${fmtUSD(impact.annualDividendBefore)} → ${fmtUSD(impact.annualDividendAfter)}</div>`
    }</div>
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
    <div><span>Capital useful life</span><span>${usefulLifeYears} yrs</span></div>
    <div><span>Annual capital charge</span><span>${fmtUSD(impact.annualCapitalCharge)}</span></div>
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
      ${deltaRow("Total Revenue", impact.before.totalRevenue, impact.after.totalRevenue)}
      ${deltaRow("Medical Supplies", impact.before.medicalSupplyExpense, impact.after.medicalSupplyExpense, { invert: true, indent: true })}
      ${deltaRow("Other Variable Expenses", impact.before.otherVariableExpense, impact.after.otherVariableExpense, { invert: true, indent: true })}
      ${deltaRow("Total Variable Expenses", impact.before.totalVariableExpense, impact.after.totalVariableExpense, { invert: true })}
      ${deltaRow("Fixed Expenses", impact.before.fixedExpenses, impact.after.fixedExpenses, { invert: true })}
      ${deltaRow("Net Operating Income", impact.before.netOperatingIncome, impact.after.netOperatingIncome)}
      ${capitalChargeRow}
      ${deltaRow("Annual Dividend (Distributable CF)", impact.annualDividendBefore, impact.annualDividendAfter)}
      ${caseVolumeRow}
    </tbody>
  </table>
  <div class="footnote">${pnlFootnote}</div>

  <h2>Enterprise Value Impact (net of capital)</h2>
  <table>
    <thead><tr><th>Multiple</th><th class="num">EV impact</th></tr></thead>
    <tbody>${evRows}</tbody>
  </table>

  <footer>Generated by Tyde-I Health · Figures are modeled estimates based on the entered facility proforma and payor-reported volume.</footer>
</body></html>`

  return html
}

export function exportDividendReportHtml(ctx: DividendReportContext) {
  download(
    `${safeName(ctx.proposalName)}_dividend_report.html`,
    buildDividendReportHtml(ctx),
    "text/html",
  )
}

/** Pure builder — returns the report CSV text. */
export function buildDividendReportCsv(ctx: DividendReportContext): string {
  const { impact } = ctx
  const usefulLifeYears = resolveCapitalUsefulLifeYears(
    ctx.purchase,
    impact.assumptions,
  )
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
    ["Capital useful life years", usefulLifeYears],
    ["Annual capital charge", Math.round(impact.annualCapitalCharge)],
    ["Recurring annual cost", ctx.purchase.recurringAnnualCost],
    ["Reimbursement per case", ctx.purchase.caseReimbursement ?? ""],
    ["Procedure groups", ctx.payorGroupNames.join("; ")],
    ["Selected volume per year", ctx.totalSelectedVolume],
    ["Medicare rate per case", Math.round(ctx.medicareRate)],
    ["Percent of Medicare", ctx.percentOfMedicare],
    ["Facility reimbursement per case", Math.round(ctx.facilityReimbursement)],
    ["NOI impact per year", Math.round(impact.noiImpact)],
    [
      "Distributable share of NOI percent",
      Math.round(impact.assumptions.dcfPctOfEbitda * 100),
    ],
    ["Annual dividend before", Math.round(impact.annualDividendBefore)],
    [
      "Annual dividend after (net of capital charge)",
      Math.round(impact.annualDividendAfter),
    ],
    [
      "Operating dividend impact per year (before capital charge)",
      Math.round(impact.operatingDividendImpact),
    ],
    [
      "Net annual dividend impact (operating less capital charge)",
      Math.round(impact.annualDividendImpact),
    ],
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
  return rows.map(([k, v]) => `${cell(k)},${cell(v)}`).join("\n")
}

export function exportDividendReportCsv(ctx: DividendReportContext) {
  download(
    `${safeName(ctx.proposalName)}_dividend_report.csv`,
    buildDividendReportCsv(ctx),
    "text/csv",
  )
}
