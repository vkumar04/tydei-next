#!/usr/bin/env python3
"""
Oracle — Charles's Arthrex contract ground-truth calculator.

Computes what every number on the Arthrex contract-detail page SHOULD be,
independently of the tydei app. Any app surface that disagrees with this
oracle is wrong, regardless of what other app surfaces say.

Inputs (Charles's test docs on ~/Desktop):
  - COG:      experiment COG vendor short NEW.csv   (all-vendor PO history)
  - Pricing:  Cogsart01012024 Price file.xlsx       (Arthrex canonical price list)
  - Contract: Arthrex Ada Format.numbers            (contract scope + carveout)

Outputs: markdown report to stdout. Redirect into
  docs/superpowers/diagnostics/2026-04-22-oracle-arthrex-cluster.md
"""
from __future__ import annotations

import csv
import datetime as dt
from collections import defaultdict
from pathlib import Path

import openpyxl  # type: ignore[import-untyped]
from numbers_parser import Document  # type: ignore[import-untyped]

DESKTOP = Path("/Users/vickkumar/Desktop")
COG_CSV = DESKTOP / "experiment COG vendor short NEW.csv"
PRICE_XLSX = DESKTOP / "Cogsart01012024 Price file.xlsx"
CONTRACT_NUMBERS = DESKTOP / "Arthrex Ada Format.numbers"

TODAY = dt.date(2026, 4, 22)
TRAILING_12MO_START = TODAY - dt.timedelta(days=365)
YEAR_START = dt.date(TODAY.year, 1, 1)


def load_price_list() -> dict[str, dict]:
    wb = openpyxl.load_workbook(PRICE_XLSX, data_only=True)
    ws = wb["Sheet1"]
    items: dict[str, dict] = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        ref = row[2]
        if not ref:
            continue
        items[str(ref).strip()] = {
            "description": row[3],
            "category": row[4],
            "uom": row[5],
            "price": row[6],
        }
    return items


def load_contract_scope() -> dict[str, dict]:
    doc = Document(str(CONTRACT_NUMBERS))
    table = doc.sheets[0].tables[0]
    rows = list(table.rows(values_only=True))
    scope: dict[str, dict] = {}
    for r in rows[1:]:
        ref = r[1]
        if not ref:
            continue
        scope[str(ref).strip()] = {
            "category": r[0],
            "description": r[2],
            "uom": r[3],
            "price": r[5],
            "carveout": r[6],
        }
    return scope


def parse_date(s: str) -> dt.date | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def load_arthrex_pos() -> list[dict]:
    pos: list[dict] = []
    with open(COG_CSV, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not (row.get("Vendor") or "").strip().upper().startswith("ARTHREX"):
                continue
            try:
                extended = float((row.get("Extended Cost") or "0").replace(",", ""))
            except ValueError:
                extended = 0.0
            date = parse_date(row.get("Date Ordered") or "")
            pos.append(
                {
                    "po": row.get("Purchase Order Number", "").strip(),
                    "date": date,
                    "product": (row.get("product name") or "").strip(),
                    "ref": (row.get("Product ref number") or "").strip(),
                    "qty": row.get("Quantity Ordered", "").strip(),
                    "unit_cost": row.get("Unit Cost", "").strip(),
                    "extended": extended,
                }
            )
    return pos


def classify(
    pos: list[dict], contract_scope: dict[str, dict], price_list: dict[str, dict]
) -> list[dict]:
    for po in pos:
        ref = po["ref"]
        if ref in contract_scope:
            po["bucket"] = "on_contract"
            po["contract_price"] = contract_scope[ref]["price"]
            po["carveout"] = contract_scope[ref]["carveout"]
            po["category"] = contract_scope[ref]["category"]
        elif ref in price_list:
            po["bucket"] = "priced_off_contract"
            po["contract_price"] = price_list[ref]["price"]
            po["category"] = price_list[ref]["category"]
        else:
            po["bucket"] = "not_priced"
            po["contract_price"] = None
            po["category"] = None
    return pos


def fmt_currency(n: float) -> str:
    return f"${n:,.2f}"


def section_totals(pos: list[dict], label: str, *, filter_fn=None) -> tuple[float, int, dict[str, float]]:
    rows = pos if filter_fn is None else [p for p in pos if filter_fn(p)]
    total = sum(p["extended"] for p in rows)
    by_bucket: dict[str, float] = defaultdict(float)
    for p in rows:
        by_bucket[p["bucket"]] += p["extended"]
    return total, len(rows), dict(by_bucket)


def main() -> None:
    print("# Oracle — Arthrex contract ground truth")
    print()
    print(f"_Generated: {dt.datetime.now(dt.timezone.utc).isoformat()}Z_")
    print()
    print("## Inputs")
    print()
    print(f"- COG: `{COG_CSV}`")
    print(f"- Pricing: `{PRICE_XLSX}`")
    print(f"- Contract: `{CONTRACT_NUMBERS}`")
    print(f"- Today: {TODAY.isoformat()}")
    print(f"- Trailing-12mo window: [{TRAILING_12MO_START.isoformat()}, {TODAY.isoformat()}]")
    print(f"- YTD window: [{YEAR_START.isoformat()}, {TODAY.isoformat()}]")
    print()

    price_list = load_price_list()
    contract_scope = load_contract_scope()
    pos = load_arthrex_pos()

    print("## 1. Raw input stats")
    print()
    print(f"- Arthrex contract scope: **{len(contract_scope)}** line items")
    print(f"- Pricing catalog: **{len(price_list)}** items")
    print(f"- Arthrex POs in COG CSV: **{len(pos)}**")
    print(
        f"- Grand total Arthrex spend (all dates): "
        f"**{fmt_currency(sum(p['extended'] for p in pos))}**"
    )
    print()

    classify(pos, contract_scope, price_list)

    print("## 2. Spend classification — lifetime")
    print()
    total, n, by_bucket = section_totals(pos, "lifetime")
    print("| bucket | rows | spend | % of Arthrex total |")
    print("|---|---:|---:|---:|")
    for b in ("on_contract", "priced_off_contract", "not_priced"):
        spend = by_bucket.get(b, 0)
        pct = (spend / total * 100) if total else 0
        print(f"| {b} | {sum(1 for p in pos if p['bucket'] == b)} | {fmt_currency(spend)} | {pct:.1f}% |")
    print(f"| **total** | **{n}** | **{fmt_currency(total)}** | 100.0% |")
    print()

    trailing_pos = [p for p in pos if p["date"] and p["date"] >= TRAILING_12MO_START]
    print("## 3. Spend classification — trailing 12 months")
    print()
    total_t, n_t, by_bucket_t = section_totals(trailing_pos, "trailing")
    print("| bucket | rows | spend | % of trailing |")
    print("|---|---:|---:|---:|")
    for b in ("on_contract", "priced_off_contract", "not_priced"):
        spend = by_bucket_t.get(b, 0)
        pct = (spend / total_t * 100) if total_t else 0
        print(f"| {b} | {sum(1 for p in trailing_pos if p['bucket'] == b)} | {fmt_currency(spend)} | {pct:.1f}% |")
    print(f"| **total** | **{n_t}** | **{fmt_currency(total_t)}** | 100.0% |")
    print()

    ytd_pos = [p for p in pos if p["date"] and p["date"] >= YEAR_START]
    print("## 4. Spend classification — YTD (year-to-date)")
    print()
    total_y, n_y, by_bucket_y = section_totals(ytd_pos, "ytd")
    print("| bucket | rows | spend |")
    print("|---|---:|---:|")
    for b in ("on_contract", "priced_off_contract", "not_priced"):
        spend = by_bucket_y.get(b, 0)
        print(f"| {b} | {sum(1 for p in ytd_pos if p['bucket'] == b)} | {fmt_currency(spend)} |")
    print(f"| **total** | **{n_y}** | **{fmt_currency(total_y)}** |")
    print()

    print("## 5. Spend by date year (all years present)")
    print()
    by_year: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for p in pos:
        if not p["date"]:
            continue
        y = p["date"].year
        by_year[y]["total"] += p["extended"]
        by_year[y][p["bucket"]] += p["extended"]
    print("| year | total | on_contract | priced_off | not_priced |")
    print("|---|---:|---:|---:|---:|")
    for y in sorted(by_year.keys()):
        row = by_year[y]
        print(
            f"| {y} | {fmt_currency(row['total'])} | "
            f"{fmt_currency(row.get('on_contract', 0))} | "
            f"{fmt_currency(row.get('priced_off_contract', 0))} | "
            f"{fmt_currency(row.get('not_priced', 0))} |"
        )
    print()

    print("## 6. Top 10 unmatched (not_priced) refs by spend")
    print()
    unmatched_agg: dict[tuple[str, str], dict] = defaultdict(lambda: {"spend": 0.0, "rows": 0})
    for p in pos:
        if p["bucket"] != "not_priced":
            continue
        key = (p["ref"], p["product"])
        unmatched_agg[key]["spend"] += p["extended"]
        unmatched_agg[key]["rows"] += 1
    top = sorted(unmatched_agg.items(), key=lambda kv: kv[1]["spend"], reverse=True)[:10]
    print("| ref | product (50ch) | rows | spend |")
    print("|---|---|---:|---:|")
    for (ref, product), agg in top:
        print(f"| {ref} | {(product or '')[:50]} | {agg['rows']} | {fmt_currency(agg['spend'])} |")
    print()

    print("## 7. Category breakdown (on-contract only, lifetime)")
    print()
    by_cat: dict[str, float] = defaultdict(float)
    for p in pos:
        if p["bucket"] == "on_contract":
            by_cat[str(p.get("category") or "(unknown)")] += p["extended"]
    print("| category | spend |")
    print("|---|---:|")
    for cat, spend in sorted(by_cat.items(), key=lambda kv: kv[1], reverse=True):
        print(f"| {cat} | {fmt_currency(spend)} |")
    print()

    print("## 8. Carveout check (on-contract rows with carveout != 0)")
    print()
    carveout_rows = [p for p in pos if p["bucket"] == "on_contract" and (p.get("carveout") or 0) != 0]
    carveout_spend = sum(p["extended"] for p in carveout_rows)
    print(f"- Rows: **{len(carveout_rows)}**")
    print(f"- Spend with non-zero carveout: **{fmt_currency(carveout_spend)}**")
    print()

    print("## 9. Side-by-side vs. Charles's screenshots")
    print()
    on_contract_lifetime = by_bucket.get("on_contract", 0)
    not_priced_lifetime = by_bucket.get("not_priced", 0) + by_bucket.get("priced_off_contract", 0)
    on_contract_trailing = by_bucket_t.get("on_contract", 0)
    trailing_total = total_t
    grand = sum(p["extended"] for p in pos)

    print("| surface | screenshot | oracle | delta |")
    print("|---|---:|---:|---:|")
    print(f"| On-Contract (lifetime) | $0 | {fmt_currency(on_contract_lifetime)} | {fmt_currency(on_contract_lifetime)} |")
    print(f"| Not-Priced (lifetime) | $3,389,667 | {fmt_currency(not_priced_lifetime)} | {fmt_currency(not_priced_lifetime - 3_389_667)} |")
    print(f"| Arthrex grand total | n/a | {fmt_currency(grand)} | — |")
    print(f"| Current Spend (trailing 12mo) | $1,559,528 | {fmt_currency(trailing_total)} | {fmt_currency(trailing_total - 1_559_528)} |")
    print(f"| Rebates Earned YTD (header) | $0 | needs tier struct | — |")
    print(f"| Rebates Earned lifetime (tab) | $639,390 | needs tier struct | — |")
    print()

    print("## 10. Interpretation")
    print()
    print("- **Bug 1 (Nothing on contract).** If the oracle's on-contract spend is > $0 but")
    print("  the app's On/Off card shows $0, the matcher is broken — CSV refs are not being")
    print("  joined to the contract catalog.")
    print("- **Bug 2 (current-spend flicker).** The oracle's trailing-12mo total is a single")
    print("  deterministic number. The app's two values ($0 on first load, $1.56M on reload)")
    print("  cannot both be right.")
    print("- **Bugs 3–4 (rebate disagreement).** Cannot be computed without the contract's")
    print("  tier structure. Send me the tier thresholds and rebate percentages and this")
    print("  script will extend section 9 with expected rebate per period + lifetime.")
    print()


if __name__ == "__main__":
    main()
