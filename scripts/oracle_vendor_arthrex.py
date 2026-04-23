#!/usr/bin/env python3
"""
Oracle (vendor POV) — ground-truth numbers Arthrex's dashboard SHOULD
show, computed directly from Charles's three source files on Desktop.

Mirrors `scripts/oracle_all_desktop.py` but flips the perspective:
instead of asking "how much of this facility's spend is on Arthrex's
contract", we ask "how much revenue does Arthrex earn, and how much of
it is on vs off contract."

Inputs (same files as the facility oracle):
  - /Users/vickkumar/Desktop/experiment COG vendor short NEW.csv
      The COG transaction log. Every row with Vendor startswith
      "ARTHREX" is one Arthrex revenue event. Extended Cost (from the
      facility's book) == revenue recognized by Arthrex.
  - /Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx
      Contract pricing sheet — unused here; category lives in the
      `.numbers` file.
  - /Users/vickkumar/Desktop/Arthrex Ada Format.numbers
      Arthrex's master item list. Column A = Product Category, B = ref.
      The contract catalog for the vendor-side "on-contract" join.

Importer-parity rules (inherited from the facility oracle):
  - Rows with no parseable Date Ordered are dropped (schema requires
    transactionDate; `bulkImportCOGRecords` rejects them too).
  - Trailing-12mo window is BOTH-bounds: [today - 365d, today]. The
    source CSV runs through end-of-2026, so an open upper bound
    over-counts future-dated rows.
  - Case-insensitive ref join (matches `matchCOGRecordToContract`).

Usage:
  python3 scripts/oracle_vendor_arthrex.py \
    > docs/superpowers/diagnostics/2026-04-23-oracle-vendor-arthrex.md
"""
from __future__ import annotations

import csv
import datetime as dt
from collections import defaultdict
from pathlib import Path

from numbers_parser import Document  # type: ignore[import-untyped]

DESKTOP = Path("/Users/vickkumar/Desktop")
CONTRACT_NUMBERS = DESKTOP / "Arthrex Ada Format.numbers"
COG_CSV = DESKTOP / "experiment COG vendor short NEW.csv"

TODAY = dt.date(2026, 4, 23)
TRAILING_12MO_START = TODAY - dt.timedelta(days=365)
YEAR_START = dt.date(TODAY.year, 1, 1)
PRIOR_YEAR_START = dt.date(TODAY.year - 1, 1, 1)
PRIOR_YTD_END = dt.date(TODAY.year - 1, TODAY.month, TODAY.day)


# ─── Contract catalog (Arthrex's master item list) ─────────────────


def load_contract_scope() -> dict[str, dict]:
    doc = Document(str(CONTRACT_NUMBERS))
    table = doc.sheets[0].tables[0]
    rows = list(table.rows(values_only=True))
    scope: dict[str, dict] = {}
    for r in rows[1:]:
        ref = r[1]
        if not ref:
            continue
        key = str(ref).strip().lower()
        scope[key] = {
            "category": r[0],
            "description": r[2],
            "price": r[5],
            "carveout": r[6],
        }
    return scope


# ─── CSV parsing (parity with facility oracle) ─────────────────────


def parse_money(s: str) -> float:
    s = (s or "").strip()
    if not s:
        return 0.0
    for ch in ("$", ",", '"'):
        s = s.replace(ch, "")
    try:
        return float(s)
    except ValueError:
        return 0.0


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
    with open(COG_CSV, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []

        def pick(candidates: tuple[str, ...]) -> str | None:
            lowered = {h.lower().strip(): h for h in headers}
            for c in candidates:
                if c in lowered:
                    return lowered[c]
            return None

        ref_col = pick(("product ref number", "vendor item number"))
        desc_col = pick(("product name", "inventory description"))
        fac_col = pick(("facility", "facility name", "site"))
        if not ref_col:
            raise RuntimeError(f"no ref column found in {headers}")

        pos: list[dict] = []
        for row in reader:
            if not (row.get("Vendor") or "").strip().upper().startswith("ARTHREX"):
                continue
            date = parse_date(row.get("Date Ordered") or "")
            if date is None:
                # Importer-parity: rows with unparseable date are dropped.
                continue
            pos.append(
                {
                    "ref": (row.get(ref_col) or "").strip(),
                    "product": (row.get(desc_col) or "").strip() if desc_col else "",
                    "date": date,
                    "extended": parse_money(row.get("Extended Cost") or ""),
                    "unit_cost": parse_money(row.get("Unit Cost") or ""),
                    "po": (row.get("Purchase Order Number") or "").strip(),
                    "facility": (row.get(fac_col) or "").strip() if fac_col else "",
                }
            )
        return pos


# ─── Classification + aggregation ──────────────────────────────────


def classify(pos: list[dict], scope: dict[str, dict]) -> None:
    for po in pos:
        key = po["ref"].lower() if po["ref"] else ""
        hit = scope.get(key) if key else None
        if hit:
            po["on_contract"] = True
            po["category"] = hit["category"] or "Uncategorized"
        else:
            po["on_contract"] = False
            po["category"] = None


def fmt(n: float) -> str:
    return f"${n:,.2f}"


def window_sum(pos: list[dict], start: dt.date | None, end: dt.date | None) -> dict:
    gated = [
        p
        for p in pos
        if (start is None or p["date"] >= start)
        and (end is None or p["date"] <= end)
    ]
    total = sum(p["extended"] for p in gated)
    on = sum(p["extended"] for p in gated if p["on_contract"])
    off = total - on
    return {
        "rows": len(gated),
        "total": total,
        "on": on,
        "off": off,
        "on_pct": (on / total * 100) if total else 0.0,
    }


def main() -> None:
    scope = load_contract_scope()
    pos = load_arthrex_pos()
    classify(pos, scope)

    lifetime = window_sum(pos, None, None)
    trailing = window_sum(pos, TRAILING_12MO_START, TODAY)
    ytd = window_sum(pos, YEAR_START, TODAY)
    prior_ytd = window_sum(pos, PRIOR_YEAR_START, PRIOR_YTD_END)

    # Top 10 products by revenue
    by_ref: dict[str, dict] = defaultdict(
        lambda: {"spend": 0.0, "rows": 0, "product": "", "on_contract": False}
    )
    for p in pos:
        key = p["ref"] or "(empty)"
        agg = by_ref[key]
        agg["spend"] += p["extended"]
        agg["rows"] += 1
        if not agg["product"]:
            agg["product"] = p["product"]
        agg["on_contract"] = agg["on_contract"] or p["on_contract"]
    top_products = sorted(by_ref.items(), key=lambda kv: kv[1]["spend"], reverse=True)[:10]

    # Category-mix — on-contract rows only (off-contract rows have no
    # category in the contract catalog; reporting uncategorized spend
    # separately keeps the signal clean).
    by_cat: dict[str, dict] = defaultdict(lambda: {"spend": 0.0, "rows": 0})
    for p in pos:
        if not p["on_contract"]:
            continue
        cat = p["category"] or "Uncategorized"
        by_cat[cat]["spend"] += p["extended"]
        by_cat[cat]["rows"] += 1
    cat_rows = sorted(by_cat.items(), key=lambda kv: kv[1]["spend"], reverse=True)

    # Per-facility — this dataset is a single facility (CSV lacks a
    # Facility column). Still emit a single-row breakdown so future
    # multi-facility files plug into the same shape.
    by_fac: dict[str, dict] = defaultdict(lambda: {"spend": 0.0, "rows": 0})
    for p in pos:
        fac = p["facility"] or "(single facility — CSV has no Facility column)"
        by_fac[fac]["spend"] += p["extended"]
        by_fac[fac]["rows"] += 1
    fac_rows = sorted(by_fac.items(), key=lambda kv: kv[1]["spend"], reverse=True)

    # ── Markdown output ────────────────────────────────────────────
    print("# Oracle — Arthrex vendor POV")
    print()
    print(f"_Generated: {dt.datetime.now(dt.timezone.utc).isoformat()}Z_")
    print(f"_Today: {TODAY.isoformat()}_")
    print()
    print("## Headline")
    print()
    print(f"- **Total revenue (lifetime):** {fmt(lifetime['total'])}")
    print(f"- **Contract utilization:** {lifetime['on_pct']:.1f}%  "
          f"({fmt(lifetime['on'])} on-contract / {fmt(lifetime['total'])})")
    print()
    print("## Sources")
    print(f"- COG: `{COG_CSV.name}`")
    print(f"- Contract catalog: `{CONTRACT_NUMBERS.name}` ({len(scope)} items)")
    print(f"- Arthrex PO rows (after null-date skip): **{lifetime['rows']}**")
    print()

    print("## Revenue by window")
    print()
    print("| window | rows | total | on-contract | off-contract | on % |")
    print("|---|---:|---:|---:|---:|---:|")
    for label, s in (
        ("lifetime", lifetime),
        ("trailing-12mo", trailing),
        ("ytd", ytd),
        ("prior-ytd", prior_ytd),
    ):
        print(
            f"| {label} | {s['rows']} | {fmt(s['total'])} | "
            f"{fmt(s['on'])} | {fmt(s['off'])} | {s['on_pct']:.1f}% |"
        )
    print()

    # YoY
    print("## YoY (YTD vs prior-YTD)")
    print()
    ytd_total = ytd["total"]
    prior_total = prior_ytd["total"]
    delta = ytd_total - prior_total
    yoy_pct = ((ytd_total / prior_total - 1) * 100) if prior_total else 0.0
    print(f"- {TODAY.year} YTD: **{fmt(ytd_total)}**")
    print(f"- {TODAY.year - 1} YTD (through {PRIOR_YTD_END.isoformat()}): **{fmt(prior_total)}**")
    print(f"- Delta: {fmt(delta)}  ({yoy_pct:+.1f}%)")
    print()

    # Top 10
    print("## Top 10 products by revenue (lifetime)")
    print()
    print("| # | ref | product (50ch) | rows | revenue | on-contract |")
    print("|---:|---|---|---:|---:|:---:|")
    for i, (ref, agg) in enumerate(top_products, 1):
        print(
            f"| {i} | `{ref}` | {(agg['product'] or '')[:50]} | "
            f"{agg['rows']} | {fmt(agg['spend'])} | "
            f"{'yes' if agg['on_contract'] else 'no'} |"
        )
    print()

    # Category mix
    print("## Category-mix breakdown (on-contract revenue only)")
    print()
    if cat_rows:
        on_total = lifetime["on"] or 1.0
        print("| category | rows | revenue | share of on-contract |")
        print("|---|---:|---:|---:|")
        for cat, agg in cat_rows:
            share = agg["spend"] / on_total * 100
            print(
                f"| {cat} | {agg['rows']} | {fmt(agg['spend'])} | {share:.1f}% |"
            )
    else:
        print("_No on-contract rows — no categories to report._")
    print()
    print(
        f"_Off-contract (uncategorized) revenue: {fmt(lifetime['off'])} "
        f"({lifetime['off'] / (lifetime['total'] or 1.0) * 100:.1f}% of total)._"
    )
    print()

    # Per-facility
    print("## Per-facility revenue (lifetime)")
    print()
    print("| facility | rows | revenue |")
    print("|---|---:|---:|")
    for fac, agg in fac_rows:
        print(f"| {fac} | {agg['rows']} | {fmt(agg['spend'])} |")
    print()
    print(
        "_The big CSV has no `Facility` column, so every row maps to the "
        "same implicit facility (the demo-facility Lighthouse Community "
        "Hospital in the tydei seed). If Charles later ships a CSV with "
        "a Facility column, this section auto-splits by it._"
    )


if __name__ == "__main__":
    main()
