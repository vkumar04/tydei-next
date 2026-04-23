#!/usr/bin/env python3
"""
Oracle (multi-dataset) — runs ground-truth classification against every
Arthrex-format COG file on Charles's Desktop and reports per-file +
consolidated results.

Auto-detects column layout so both CSV shapes work:
  - Big "experiment COG vendor short NEW.csv":
      Vendor, Purchase Order Number, Date Ordered, product name,
      Product ref number, Quantity Ordered, ..., Unit Cost, Extended Cost
  - Short "New New New Short.csv(f).csv":
      Purchase Order Number, Vendor, Vendor Item Number,
      Inventory Description, Date Ordered, Return Date, ...,
      Unit Cost, Extended Cost

Classification uses the same strict item-join against the Arthrex
contract catalog (`Arthrex Ada Format.numbers`, 10,394 items). Case-
insensitive join to match the app's `matchCOGRecordToContract` behavior
(`vendorItemNo.toLowerCase()`).

Usage:
  python3 scripts/oracle_all_desktop.py \
    > docs/superpowers/diagnostics/2026-04-23-oracle-all-desktop.md
"""
from __future__ import annotations

import csv
import datetime as dt
from collections import defaultdict
from pathlib import Path

from numbers_parser import Document  # type: ignore[import-untyped]

DESKTOP = Path("/Users/vickkumar/Desktop")
CONTRACT_NUMBERS = DESKTOP / "Arthrex Ada Format.numbers"
COG_FILES = [
    DESKTOP / "experiment COG vendor short NEW.csv",
    DESKTOP / "New New New Short.csv",
    DESKTOP / "New New New Short.csvf.csv",
]

TODAY = dt.date(2026, 4, 23)
TRAILING_12MO_START = TODAY - dt.timedelta(days=365)
YEAR_START = dt.date(TODAY.year, 1, 1)


# ─── Contract scope loader ─────────────────────────────────────────────


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


# ─── CSV column-shape detection ────────────────────────────────────────


REF_ALIASES = ("product ref number", "vendor item number", "catalog number")
DESC_ALIASES = ("product name", "inventory description", "item description")


def pick(headers: list[str], candidates: tuple[str, ...]) -> str | None:
    lowered = {h.lower().strip(): h for h in headers}
    for c in candidates:
        if c in lowered:
            return lowered[c]
    return None


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


def load_arthrex_pos(cog_path: Path) -> list[dict]:
    with open(cog_path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        ref_col = pick(headers, REF_ALIASES)
        desc_col = pick(headers, DESC_ALIASES)
        if not ref_col:
            raise RuntimeError(f"{cog_path.name}: no ref column in {headers}")

        pos: list[dict] = []
        for row in reader:
            if not (row.get("Vendor") or "").strip().upper().startswith("ARTHREX"):
                continue
            pos.append(
                {
                    "ref": (row.get(ref_col) or "").strip(),
                    "product": (row.get(desc_col) or "").strip() if desc_col else "",
                    "date": parse_date(row.get("Date Ordered") or ""),
                    "extended": parse_money(row.get("Extended Cost") or ""),
                    "unit_cost": parse_money(row.get("Unit Cost") or ""),
                    "po": (row.get("Purchase Order Number") or "").strip(),
                }
            )
        return pos


def classify(pos: list[dict], scope: dict[str, dict]) -> list[dict]:
    for po in pos:
        key = po["ref"].lower() if po["ref"] else ""
        if key and key in scope:
            po["bucket"] = "on_contract"
            po["category"] = scope[key]["category"]
        else:
            po["bucket"] = "not_priced"
            po["category"] = None
    return pos


def fmt(n: float) -> str:
    return f"${n:,.2f}"


def summarize(label: str, pos: list[dict]) -> dict:
    total = sum(p["extended"] for p in pos)
    on = sum(p["extended"] for p in pos if p["bucket"] == "on_contract")
    not_priced = sum(p["extended"] for p in pos if p["bucket"] == "not_priced")
    on_rows = sum(1 for p in pos if p["bucket"] == "on_contract")
    not_rows = sum(1 for p in pos if p["bucket"] == "not_priced")
    return {
        "label": label,
        "rows": len(pos),
        "total": total,
        "on_rows": on_rows,
        "on_spend": on,
        "not_rows": not_rows,
        "not_spend": not_priced,
        "on_pct": (on / total * 100) if total else 0,
    }


def main() -> None:
    print("# Oracle — all Arthrex datasets on Desktop")
    print()
    print(f"_Generated: {dt.datetime.now(dt.timezone.utc).isoformat()}Z_")
    print()
    print("## Contract scope")
    scope = load_contract_scope()
    print(f"- Source: `{CONTRACT_NUMBERS.name}`")
    print(f"- Line items: **{len(scope)}**")
    print()

    per_file: list[dict] = []
    for cog_path in COG_FILES:
        if not cog_path.exists():
            print(f"## {cog_path.name}\n")
            print(f"_missing_\n")
            continue
        pos = load_arthrex_pos(cog_path)
        classify(pos, scope)

        lifetime = summarize("lifetime", pos)
        trailing = summarize(
            "trailing-12mo",
            [p for p in pos if p["date"] and p["date"] >= TRAILING_12MO_START],
        )
        ytd = summarize(
            "ytd", [p for p in pos if p["date"] and p["date"] >= YEAR_START]
        )
        per_file.append({"path": cog_path, "lifetime": lifetime, "trailing": trailing, "ytd": ytd})

        print(f"## {cog_path.name}")
        print()
        print(f"- Arthrex PO rows: **{lifetime['rows']}**")
        print(f"- Grand total spend: **{fmt(lifetime['total'])}**")
        print()
        print("| window | rows | on-contract | not-priced | on-contract % |")
        print("|---|---:|---:|---:|---:|")
        for s in (lifetime, trailing, ytd):
            print(
                f"| {s['label']} | {s['rows']} | "
                f"{s['on_rows']} · {fmt(s['on_spend'])} | "
                f"{s['not_rows']} · {fmt(s['not_spend'])} | "
                f"{s['on_pct']:.1f}% |"
            )
        print()

        # Top 5 unmatched refs
        unmatched: dict[tuple[str, str], dict] = defaultdict(
            lambda: {"spend": 0.0, "rows": 0}
        )
        for p in pos:
            if p["bucket"] != "not_priced":
                continue
            key = (p["ref"], p["product"])
            unmatched[key]["spend"] += p["extended"]
            unmatched[key]["rows"] += 1
        top = sorted(unmatched.items(), key=lambda kv: kv[1]["spend"], reverse=True)[:5]
        if top:
            print("Top 5 unmatched refs by spend:")
            print()
            print("| ref | product (50ch) | rows | spend |")
            print("|---|---|---:|---:|")
            for (ref, product), agg in top:
                print(
                    f"| `{ref or '(empty)'}` | {(product or '')[:50]} | "
                    f"{agg['rows']} | {fmt(agg['spend'])} |"
                )
            print()

    # Consolidated
    if per_file:
        print("## Cross-dataset comparison (lifetime)")
        print()
        print("| dataset | rows | on-contract rows | on-contract spend | on % |")
        print("|---|---:|---:|---:|---:|")
        for f in per_file:
            s = f["lifetime"]
            print(
                f"| {f['path'].name} | {s['rows']} | {s['on_rows']} | "
                f"{fmt(s['on_spend'])} | {s['on_pct']:.1f}% |"
            )
        print()


if __name__ == "__main__":
    main()
