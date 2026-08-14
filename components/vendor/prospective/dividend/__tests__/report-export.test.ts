/**
 * Regression tests for the Dividend/DCF report exports (finding 6).
 *
 * The exported HTML P&L used to jump straight from "Net operating income" to
 * "Annual dividend" — the two lines differ by the annual capital charge, but
 * nothing on the page named that charge. To a CFO reading the printed report
 * it looked like an arithmetic error: NOI × 80% did not equal the dividend.
 * The fix adds the charge row (between NOI and the dividend), the
 * "(<outlay> ÷ <N> yrs)" divisor note, the bridge footnote, and renames the
 * KPI tile / CSV columns so the operating-vs-net distinction is explicit.
 *
 * Only the PURE builders are exercised — `buildDividendReportHtml` /
 * `buildDividendReportCsv` were split out of the download wrappers precisely
 * so they run under vitest's node environment (no Blob/URL/document).
 *
 * The `impact` object is produced by the REAL engine
 * (`computePurchaseDividendImpact`) rather than hand-written, so the figures
 * the report prints are the figures the app computes.
 */

import { describe, expect, it } from "vitest"
import {
  buildDividendReportCsv,
  buildDividendReportHtml,
  type DividendReportContext,
} from "../report-export"
import {
  DEFAULT_DIVIDEND_ASSUMPTIONS,
  computePurchaseDividendImpact,
  lineItemsToProforma,
  type ProformaLineItems,
  type PurchaseScenario,
} from "@/lib/financial-analysis/proforma-pnl"

/**
 * A deliberately round proforma so every downstream figure is exact:
 *   total revenue        20,000,000 − 10,000,000 = 10,000,000
 *   medical supplies                              3,000,000
 *   other variable                                2,000,000
 *   fixed                                         1,000,000
 *   net operating income                          4,000,000
 *   case volume 1,000 → $10,000 rev / $3,000 supply / $2,000 other per case
 */
const LINE_ITEMS: ProformaLineItems = {
  standardBillingRevenue: 20_000_000,
  contractualAdjustment: 10_000_000,
  salaryBenefits: 2_000_000,
  medicalSupplies: 3_000_000,
  smallEquipment: 0,
  officeExpenses: 0,
  legal: 0,
  computerServices: 0,
  managementFees: 0,
  billingCollection: 0,
  otherOutsideServices: 0,
  insurance: 1_000_000,
  administrative: 0,
  rentTiUtilities: 0,
  otherFacility: 0,
  repairsMaintenance: 0,
  propTax: 0,
  stateTaxes: 0,
  softwareMaintenance: 0,
  equipRentInterestOther: 0,
  caseVolume: 1_000,
}

/**
 * A $1M robot on a 10-year life adding 100 cases/yr at $12,000 reimbursement:
 *   after revenue  10,000,000 + 100 × 12,000 = 11,200,000
 *   after supplies  3,000,000 + 100 ×  3,000 =  3,300,000
 *   after other     2,000,000 + 100 ×  2,000 =  2,200,000
 *   after NOI      11,200,000 − 5,500,000 − 1,000,000 = 4,700,000  (Δ 700,000)
 *   dividend before 4,000,000 × 80% = 3,200,000
 *   operating impact  700,000 × 80% =   560,000
 *   capital charge  1,000,000 ÷ 10  =   100,000
 *   net impact        560,000 − 100,000 = 460,000
 */
const PURCHASE: PurchaseScenario = {
  productName: "Surgical Robot",
  supplyCostDeltaPerCase: 0,
  affectedCases: 0,
  incrementalCases: 100,
  revenueDeltaPerCase: 0,
  capitalOutlay: 1_000_000,
  capitalUsefulLifeYears: 10,
  recurringAnnualCost: 0,
  caseReimbursement: 12_000,
}

function makeContext(
  purchaseOverrides: Partial<PurchaseScenario> = {},
): DividendReportContext {
  const purchase: PurchaseScenario = { ...PURCHASE, ...purchaseOverrides }
  const impact = computePurchaseDividendImpact(
    lineItemsToProforma(LINE_ITEMS),
    purchase,
  )
  return {
    proposalName: "Robot Proposal",
    facilityLabel: "Lighthouse Surgical Center",
    lineItems: LINE_ITEMS,
    purchase,
    payorGroupNames: ["Orthopedics"],
    percentOfMedicare: 120,
    medicareRate: 10_000,
    facilityReimbursement: 12_000,
    totalSelectedVolume: 1_000,
    impact,
  }
}

/**
 * The P&L table only. "Annual capital charge" also appears in the Purchase
 * Scenario summary grid ABOVE this table, so a whole-document indexOf would
 * silently pass on the wrong occurrence.
 */
function pnlSection(html: string): string {
  const start = html.indexOf("<h2>P&amp;L Impact")
  const end = html.indexOf("<h2>Enterprise Value Impact")
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
}

/** The text of the `<div class="footnote">…</div>` under the P&L table. */
function footnote(html: string): string {
  const open = '<div class="footnote">'
  const start = html.indexOf(open)
  expect(start).toBeGreaterThan(-1)
  const from = start + open.length
  return html.slice(from, html.indexOf("</div>", from))
}

/** label → raw cell text, from the two-column report CSV. */
function csvMap(csv: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of csv.split("\n")) {
    const m = /^"((?:[^"]|"")*)","((?:[^"]|"")*)"$/.exec(line)
    expect(m).not.toBeNull()
    if (!m) continue
    out[m[1].replace(/""/g, '"')] = m[2].replace(/""/g, '"')
  }
  return out
}

describe("engine figures the report prints (derivation guard)", () => {
  it("computePurchaseDividendImpact produces the exact bridge the report renders", () => {
    const { impact } = makeContext()
    expect(impact.before.netOperatingIncome).toBe(4_000_000)
    expect(impact.after.netOperatingIncome).toBe(4_700_000)
    expect(impact.noiImpact).toBe(700_000)
    expect(impact.annualDividendBefore).toBe(3_200_000)
    // 700,000 ΔNOI × the 80% distributable share.
    expect(impact.operatingDividendImpact).toBe(560_000)
    // $1,000,000 outlay ÷ 10-year useful life.
    expect(impact.annualCapitalCharge).toBe(100_000)
    // The bridge the footnote must state: operating − capital = net.
    expect(impact.annualDividendImpact).toBe(460_000)
    expect(
      impact.operatingDividendImpact - impact.annualCapitalCharge,
    ).toBe(impact.annualDividendImpact)
    expect(impact.annualDividendAfter).toBe(3_660_000)
  })
})

describe("buildDividendReportHtml — capital charge row (finding 6 regression)", () => {
  it("REGRESSION: the P&L carries an 'Annual capital charge' row BETWEEN NOI and the dividend", () => {
    const html = buildDividendReportHtml(makeContext())
    const pnl = pnlSection(html)

    const noi = pnl.indexOf("Net Operating Income")
    const charge = pnl.indexOf("Annual capital charge")
    const dividend = pnl.indexOf("Annual Dividend (Distributable CF)")

    // Pre-fix this was -1: the report showed NOI and the dividend differing
    // by $100,000 with no line naming the charge.
    expect(charge).toBeGreaterThan(-1)
    expect(noi).toBeGreaterThan(-1)
    expect(dividend).toBeGreaterThan(-1)
    expect(noi).toBeLessThan(charge)
    expect(charge).toBeLessThan(dividend)
  })

  it("prints the charge with the outlay ÷ useful-life divisor note and a negative change cell", () => {
    const pnl = pnlSection(buildDividendReportHtml(makeContext()))
    expect(pnl).toContain(
      `Annual capital charge <span class="note">($1,000,000 ÷ 10 yrs)</span>`,
    )
    // One-sided line: no "before", and the change column is the charge as a
    // negative (U+2212 minus, matching the in-app row).
    expect(pnl).toContain(
      `<td class="num">—</td><td class="num">$100,000</td><td class="num" style="color:#b91c1c">−$100,000</td>`,
    )
  })

  it("the divisor comes from resolveCapitalUsefulLifeYears — absent useful life falls back to the DCF horizon", () => {
    const horizon = DEFAULT_DIVIDEND_ASSUMPTIONS.dcfProjectionYears
    expect(horizon).toBe(5) // the engine default the report must echo

    const ctx = makeContext({ capitalUsefulLifeYears: undefined })
    // $1,000,000 ÷ 5-year horizon.
    expect(ctx.impact.annualCapitalCharge).toBe(200_000)

    const pnl = pnlSection(buildDividendReportHtml(ctx))
    expect(pnl).toContain(`($1,000,000 ÷ ${horizon} yrs)`)
    expect(pnl).toContain(
      `<td class="num" style="color:#b91c1c">−$200,000</td>`,
    )
    // The stale 10-year divisor from the other scenario must not leak in.
    expect(pnl).not.toContain("÷ 10 yrs")
  })

  it("the row ORDER mirrors the in-app DividendImpactSection table", () => {
    const pnl = pnlSection(buildDividendReportHtml(makeContext()))
    const order = [
      "Total Revenue",
      "Medical Supplies",
      "Other Variable Expenses",
      "Total Variable Expenses",
      "Fixed Expenses",
      "Net Operating Income",
      "Annual capital charge",
      "Annual Dividend (Distributable CF)",
      "Case Volume",
    ]
    const positions = order.map((label) => pnl.indexOf(label))
    positions.forEach((p, i) => {
      expect(p, `${order[i]} missing from the P&L table`).toBeGreaterThan(-1)
    })
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `${order[i]} must come after ${order[i - 1]}`,
      ).toBeGreaterThan(positions[i - 1])
    }
  })
})

describe("buildDividendReportHtml — the NOI → dividend footnote", () => {
  it("states operating − capital = net, with figures matching the impact object", () => {
    const ctx = makeContext()
    const note = footnote(buildDividendReportHtml(ctx))

    expect(note).toBe(
      "Annual dividend = net operating income × 80% distributable cash flow, " +
        "less the $100,000 annual capital charge shown above " +
        "($1,000,000 outlay ÷ 10 yrs). " +
        "Change column: $560,000 operating − $100,000 capital = $460,000 net.",
    )

    // Internally consistent with the engine, not just with itself.
    const usd = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n)
    expect(note).toContain(`${usd(ctx.impact.operatingDividendImpact)} operating`)
    expect(note).toContain(`${usd(ctx.impact.annualCapitalCharge)} capital`)
    expect(note).toContain(`= ${usd(ctx.impact.annualDividendImpact)} net.`)
  })

  it("with NO capital outlay the charge row and the capital clause are BOTH suppressed", () => {
    const ctx = makeContext({ capitalOutlay: 0, capitalUsefulLifeYears: 10 })
    expect(ctx.impact.annualCapitalCharge).toBe(0)
    // Same operating impact, now flowing straight through as the net impact.
    expect(ctx.impact.operatingDividendImpact).toBe(560_000)
    expect(ctx.impact.annualDividendImpact).toBe(560_000)

    const html = buildDividendReportHtml(ctx)
    const pnl = pnlSection(html)
    expect(pnl).not.toContain("Annual capital charge")

    expect(footnote(html)).toBe(
      "Annual dividend = net operating income × 80% distributable cash flow. " +
        "Change column: $560,000 operating = $560,000 net.",
    )
    // No stray zero-valued artifacts anywhere in the document.
    expect(html).not.toContain("÷ 0 yrs")
    expect(html).not.toContain("− $0 capital")
    expect(html).not.toContain("$0 operating")
  })
})

describe("buildDividendReportHtml — KPI tiles", () => {
  it("the dividend tile reads 'Annual Dividend (net of capital)' and the old label is gone", () => {
    const html = buildDividendReportHtml(makeContext())
    expect(html).toContain(
      `<div class="label">Annual Dividend (net of capital)</div>`,
    )
    // The pre-fix label printed the NET number under a name that implied the
    // operating figure.
    expect(html).not.toContain("Dividend impact / yr")
    // Sub-line spells the split out on the tile too.
    expect(html).toContain(
      `<div class="sub">$560,000 operating − $100,000 capital</div>`,
    )
  })

  it("without capital the tile sub-line falls back to before → after", () => {
    const html = buildDividendReportHtml(makeContext({ capitalOutlay: 0 }))
    expect(html).toContain(
      `<div class="label">Annual Dividend (net of capital)</div>`,
    )
    expect(html).toContain(`<div class="sub">$3,200,000 → $3,760,000</div>`)
  })
})

describe("buildDividendReportCsv — capital columns", () => {
  it("carries the new capital and operating-vs-net columns", () => {
    const csv = buildDividendReportCsv(makeContext())
    for (const label of [
      "Capital useful life years",
      "Annual capital charge",
      "Operating dividend impact per year (before capital charge)",
      "Net annual dividend impact (operating less capital charge)",
      "Annual dividend after (net of capital charge)",
    ]) {
      expect(csv, `missing CSV column: ${label}`).toContain(`"${label}",`)
    }
  })

  it("the two AMBIGUOUS old column names are gone as standalone cells", () => {
    const csv = buildDividendReportCsv(makeContext())
    // Asserted on the full quoted cell — the new labels contain the old ones
    // as prefixes, so a bare substring check would pass vacuously.
    expect(csv).not.toContain(`"Annual dividend after",`)
    expect(csv).not.toContain(`"Annual dividend impact",`)
    // Sanity: the new, disambiguated names really are present.
    expect(csv).toContain(`"Annual dividend after (net of capital charge)",`)
    expect(csv).toContain(
      `"Net annual dividend impact (operating less capital charge)",`,
    )
  })

  it("the CSV arithmetic reconciles: outlay ÷ life = charge, operating − charge = net", () => {
    const map = csvMap(buildDividendReportCsv(makeContext()))

    const outlay = Number(map["Capital outlay"])
    const life = Number(map["Capital useful life years"])
    const charge = Number(map["Annual capital charge"])
    const operating = Number(
      map["Operating dividend impact per year (before capital charge)"],
    )
    const net = Number(
      map["Net annual dividend impact (operating less capital charge)"],
    )
    const before = Number(map["Annual dividend before"])
    const after = Number(map["Annual dividend after (net of capital charge)"])

    expect(outlay).toBe(1_000_000)
    expect(life).toBe(10)
    expect(charge).toBe(outlay / life) // 100,000
    expect(net).toBe(operating - charge) // 560,000 − 100,000 = 460,000
    expect(after).toBe(before + net) // 3,200,000 + 460,000 = 3,660,000
    // The distributable share the bridge is stated in terms of.
    expect(Number(map["Distributable share of NOI percent"])).toBe(80)
    expect(Number(map["NOI impact per year"]) * 0.8).toBe(operating)
  })

  it("reports a zero charge (not a NaN divisor) when there is no outlay", () => {
    const map = csvMap(buildDividendReportCsv(makeContext({ capitalOutlay: 0 })))
    expect(map["Capital outlay"]).toBe("0")
    expect(map["Annual capital charge"]).toBe("0")
    // The life column still prints the resolved divisor, never blank/NaN.
    expect(map["Capital useful life years"]).toBe("10")
    expect(
      Number(map["Net annual dividend impact (operating less capital charge)"]),
    ).toBe(
      Number(map["Operating dividend impact per year (before capital charge)"]),
    )
  })
})
