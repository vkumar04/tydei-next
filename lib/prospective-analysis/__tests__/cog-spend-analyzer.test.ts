/**
 * Tests for analyzeCOGSpendPatterns — COG spend-pattern analyzer
 * (spec §subsystem-8).
 *
 * Covers: empty purchases, steady vs seasonal spend, top-5 ordering,
 * price-drift computation, tie-in threshold, and custom reference-date.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeCOGSpendPatterns,
  type CogPurchase,
  type PricingFileRow,
} from "../cog-spend-analyzer";

function purchase(
  year: number,
  month: number,
  day: number,
  extendedPrice: number,
  extras: Partial<CogPurchase> = {},
): CogPurchase {
  return {
    transactionDate: new Date(Date.UTC(year, month - 1, day)),
    extendedPrice,
    vendorId: "V1",
    vendorItemNo: "ITEM-A",
    productDescription: "Item A",
    productCategory: "Gloves",
    ...extras,
  };
}

describe("analyzeCOGSpendPatterns", () => {
  it("empty purchases → all zeros, flags false", () => {
    const result = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases: [],
      pricingFile: [],
    });

    expect(result.vendorId).toBe("V1");
    expect(result.totalSpend12Mo).toBe(0);
    expect(result.monthlyStdevPct).toBe(0);
    expect(result.seasonalityFlag).toBe(false);
    expect(result.top5ItemsBySpend).toEqual([]);
    expect(result.priceDriftVsPricingFile).toBe(0);
    expect(result.categoryMarketShare).toBe(0);
    expect(result.tieInRiskFlag).toBe(false);
  });

  it("steady monthly spend ($10K × 12 months) → stdev 0, flag false", () => {
    // Reference: 2026-04-15. One purchase per calendar month in window.
    const referenceDate = new Date(Date.UTC(2026, 3, 15));
    const purchases: CogPurchase[] = [];
    // Months 2025-05 .. 2026-04 → 12 month window.
    for (let offset = 11; offset >= 0; offset -= 1) {
      const d = new Date(Date.UTC(2026, 3, 15));
      d.setUTCMonth(d.getUTCMonth() - offset);
      purchases.push(
        purchase(d.getUTCFullYear(), d.getUTCMonth() + 1, 10, 10_000),
      );
    }

    const result = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile: [],
      referenceDate,
    });

    expect(result.totalSpend12Mo).toBe(120_000);
    expect(result.monthlyStdevPct).toBe(0);
    expect(result.seasonalityFlag).toBe(false);
  });

  it("seasonal spend (9 months $0, 3 months $40K each) → stdev > 100%, flag true", () => {
    const referenceDate = new Date(Date.UTC(2026, 3, 15));
    // Put $40K in three months: Jan, Feb, Mar 2026. Other 9 months are zero.
    const purchases: CogPurchase[] = [
      purchase(2026, 1, 10, 40_000),
      purchase(2026, 2, 10, 40_000),
      purchase(2026, 3, 10, 40_000),
    ];

    const result = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile: [],
      referenceDate,
    });

    expect(result.totalSpend12Mo).toBe(120_000);
    // mean=10K, stdev across [0×9, 40K×3] = sqrt((9×100M + 3×900M)/12) = sqrt(300M)
    // ≈ 17320.5; stdevPct ≈ 173.2% → well above 100.
    expect(result.monthlyStdevPct).toBeGreaterThan(100);
    expect(result.seasonalityFlag).toBe(true);
  });

  it("top 5 items correct order by spend", () => {
    const referenceDate = new Date(Date.UTC(2026, 3, 15));
    const purchases: CogPurchase[] = [
      purchase(2026, 2, 1, 1_000, { vendorItemNo: "A", productDescription: "Alpha" }),
      purchase(2026, 2, 1, 5_000, { vendorItemNo: "B", productDescription: "Bravo" }),
      purchase(2026, 2, 2, 5_000, { vendorItemNo: "B", productDescription: "Bravo" }),
      purchase(2026, 2, 1, 2_000, { vendorItemNo: "C", productDescription: "Charlie" }),
      purchase(2026, 2, 1, 500, { vendorItemNo: "D", productDescription: "Delta" }),
      purchase(2026, 2, 1, 300, { vendorItemNo: "E", productDescription: "Echo" }),
      purchase(2026, 2, 1, 100, { vendorItemNo: "F", productDescription: "Foxtrot" }),
    ];

    const result = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile: [],
      referenceDate,
    });

    expect(result.top5ItemsBySpend.map((i) => i.vendorItemNo)).toEqual([
      "B", // 10_000
      "C", // 2_000
      "A", // 1_000
      "D", // 500
      "E", // 300
    ]);
    expect(result.top5ItemsBySpend[0]?.spend).toBe(10_000);
    expect(result.top5ItemsBySpend[0]?.description).toBe("Bravo");
  });

  it("price drift positive when purchases exceed contract prices", () => {
    const referenceDate = new Date(Date.UTC(2026, 3, 15));
    // Single purchase per item → avgPurchasePrice = extendedPrice / 1.
    const purchases: CogPurchase[] = [
      purchase(2026, 2, 1, 110, { vendorItemNo: "A" }),
      purchase(2026, 2, 1, 220, { vendorItemNo: "B" }),
    ];
    const pricingFile: PricingFileRow[] = [
      { vendorItemNo: "A", contractPrice: 100 }, // drift = +10%
      { vendorItemNo: "B", contractPrice: 200 }, // drift = +10%
    ];

    const result = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile,
      referenceDate,
    });

    expect(result.priceDriftVsPricingFile).toBeCloseTo(10, 6);
  });

  it("price drift zero when no pricing-file matches", () => {
    const referenceDate = new Date(Date.UTC(2026, 3, 15));
    const purchases: CogPurchase[] = [
      purchase(2026, 2, 1, 110, { vendorItemNo: "A" }),
    ];
    const pricingFile: PricingFileRow[] = [
      { vendorItemNo: "ZZ", contractPrice: 50 },
    ];

    const result = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile,
      referenceDate,
    });

    expect(result.priceDriftVsPricingFile).toBe(0);
  });

  it("tieInRiskFlag true when market share > 40%", () => {
    const referenceDate = new Date(Date.UTC(2026, 3, 15));
    const purchases: CogPurchase[] = [
      purchase(2026, 2, 1, 500_000),
    ];

    const over = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile: [],
      categoryTotalSpend12Mo: 1_000_000,
      referenceDate,
    });
    expect(over.categoryMarketShare).toBeCloseTo(0.5, 6);
    expect(over.tieInRiskFlag).toBe(true);

    const under = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile: [],
      categoryTotalSpend12Mo: 2_000_000, // 25%
      referenceDate,
    });
    expect(under.categoryMarketShare).toBeCloseTo(0.25, 6);
    expect(under.tieInRiskFlag).toBe(false);

    const exactly40 = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases,
      pricingFile: [],
      categoryTotalSpend12Mo: 1_250_000, // exactly 40%
      referenceDate,
    });
    // strict > 0.4 → exactly 40% is NOT flagged.
    expect(exactly40.tieInRiskFlag).toBe(false);
  });

  it("custom referenceDate respected — older purchases excluded", () => {
    // Reference date set 2 years after the purchase → purchase falls outside
    // the 12-month window and contributes nothing.
    const oldPurchase = purchase(2023, 1, 1, 100_000);
    const referenceDate = new Date(Date.UTC(2026, 3, 15));

    const result = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases: [oldPurchase],
      pricingFile: [],
      referenceDate,
    });

    expect(result.totalSpend12Mo).toBe(0);
    expect(result.top5ItemsBySpend).toEqual([]);

    // Same purchase, reference date shortly after it → included.
    const nearReference = new Date(Date.UTC(2023, 5, 1));
    const includedResult = analyzeCOGSpendPatterns({
      vendorId: "V1",
      purchases: [oldPurchase],
      pricingFile: [],
      referenceDate: nearReference,
    });
    expect(includedResult.totalSpend12Mo).toBe(100_000);
  });
});
