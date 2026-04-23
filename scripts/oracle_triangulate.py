#!/usr/bin/env python3
"""
Triangulation oracle — three INDEPENDENT classification paths that
should converge on the same on-contract count. If all three agree,
the answer is strongly correct. Where they disagree, the row is
flagged for human review.

Signals:
  A. Ref-number exact match (case-insensitive).  [baseline]
  B. Ref appears as a substring of the CSV's product-name field
     (tests data-quality: does the PO's human-readable description
     actually mention the ref a user would recognize?).
  C. Catalog-description token-overlap with CSV product-name
     (uses a totally different field — catalog description vs CSV
     product name. A bug in ref normalization on one side can't
     affect this path because it doesn't touch refs).

Plus algebraic cross-checks:
  - lifetime = 2025 + 2026 + other_years
  - lifetime = trailing_12mo + pre_window + future_dated
  - on_contract + not_priced = total

Plus a random sample of 10 on-contract and 10 off-contract rows,
rendered so a human can eyeball whether the classification is right.

Usage:
  python3 scripts/oracle_triangulate.py \
    > docs/superpowers/diagnostics/2026-04-23-oracle-triangulate.md
"""
from __future__ import annotations

import csv
import datetime as dt
import random
import re
from collections import defaultdict
from pathlib import Path

from numbers_parser import Document  # type: ignore[import-untyped]

DESKTOP = Path("/Users/vickkumar/Desktop")
COG_CSV = DESKTOP / "experiment COG vendor short NEW.csv"
CONTRACT_NUMBERS = DESKTOP / "Arthrex Ada Format.numbers"

TODAY = dt.date(2026, 4, 23)
TRAILING_12MO_START = TODAY - dt.timedelta(days=365)

SAMPLE_SIZE = 10
RANDOM_SEED = 42  # deterministic sampling

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOPWORDS = {
    "mm", "ea", "pk", "bx", "cs", "std", "the", "of", "and", "for", "with",
    "to", "a", "an", "in", "on", "at", "x",
}


# ─── IO ────────────────────────────────────────────────────────────


def load_catalog() -> list[dict]:
    doc = Document(str(CONTRACT_NUMBERS))
    table = doc.sheets[0].tables[0]
    rows = list(table.rows(values_only=True))
    out: list[dict] = []
    for r in rows[1:]:
        ref = r[1]
        if not ref:
            continue
        out.append(
            {
                "ref": str(ref).strip(),
                "ref_lower": str(ref).strip().lower(),
                "description": str(r[2] or "").strip(),
                "category": str(r[0] or "").strip(),
            }
        )
    return out


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


def parse_money(s: str) -> float:
    s = (s or "").strip().replace("$", "").replace(",", "").replace('"', "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def load_arthrex_pos() -> list[dict]:
    pos: list[dict] = []
    with open(COG_CSV, encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            if not (row.get("Vendor") or "").strip().upper().startswith("ARTHREX"):
                continue
            date = parse_date(row.get("Date Ordered") or "")
            if date is None:
                continue  # matches importer skip
            pos.append(
                {
                    "po": (row.get("Purchase Order Number") or "").strip(),
                    "ref": (row.get("Product ref number") or "").strip(),
                    "ref_lower": (row.get("Product ref number") or "").strip().lower(),
                    "product": (row.get("product name") or "").strip(),
                    "product_lower": (row.get("product name") or "").strip().lower(),
                    "date": date,
                    "extended": parse_money(row.get("Extended Cost") or ""),
                }
            )
    return pos


# ─── Tokenization ──────────────────────────────────────────────────


def tokens(s: str) -> set[str]:
    return {t for t in TOKEN_RE.findall(s.lower()) if t not in STOPWORDS and len(t) >= 3}


# ─── Three independent classifications ────────────────────────────


def classify_a_ref_exact(pos: list[dict], catalog: list[dict]) -> list[bool]:
    """Signal A: exact ref-number match (case-insensitive)."""
    refs = {c["ref_lower"] for c in catalog}
    return [bool(p["ref_lower"]) and p["ref_lower"] in refs for p in pos]


def classify_b_ref_in_product(pos: list[dict], catalog: list[dict]) -> list[bool]:
    """Signal B: catalog ref appears as a substring of the CSV's
    product-name. Independent of what the CSV puts in its ref column —
    tests whether the human-readable description contains a SKU the
    catalog recognizes. Requires at least 5 chars so short refs like
    'EA' don't trivially match."""
    ref_list = [c["ref_lower"] for c in catalog if len(c["ref_lower"]) >= 5]
    out: list[bool] = []
    for p in pos:
        prod = p["product_lower"]
        if not prod:
            out.append(False)
            continue
        out.append(any(ref in prod for ref in ref_list))
    return out


def classify_c_description_tokens(
    pos: list[dict], catalog: list[dict], min_overlap: int = 2
) -> list[bool]:
    """Signal C: token-set overlap between the catalog's
    ProductDescription and the CSV's product-name. A row is
    on-contract if ≥`min_overlap` meaningful tokens from any catalog
    description appear in the PO's product name. Uses a DIFFERENT
    FIELD than A and B (catalog description, not ref). An inverted
    index keeps this O(rows × tokens) instead of O(rows × catalog)."""
    catalog_token_sets = [tokens(c["description"]) for c in catalog]
    # Inverted index: token → set of catalog-item indices containing it
    inv: dict[str, set[int]] = defaultdict(set)
    for i, toks in enumerate(catalog_token_sets):
        for t in toks:
            inv[t].add(i)
    out: list[bool] = []
    for p in pos:
        prod_toks = tokens(p["product"])
        if not prod_toks:
            out.append(False)
            continue
        hits: dict[int, int] = defaultdict(int)
        for t in prod_toks:
            for idx in inv.get(t, ()):
                hits[idx] += 1
        matched = any(v >= min_overlap for v in hits.values())
        out.append(matched)
    return out


# ─── Formatting ────────────────────────────────────────────────────


def fmt_money(n: float) -> str:
    return f"${n:,.2f}"


def main() -> None:
    print("# Triangulation oracle — three independent paths to on-contract classification")
    print()
    print(f"_Generated {dt.datetime.now(dt.timezone.utc).isoformat()}Z_")
    print()

    catalog = load_catalog()
    pos = load_arthrex_pos()
    print(f"- Catalog: **{len(catalog)}** line items")
    print(f"- Arthrex POs (importer-parity, null-date skipped): **{len(pos)}**")
    print(f"- Total lifetime spend: **{fmt_money(sum(p['extended'] for p in pos))}**")
    print()

    # ─── Run all three signals ───
    a = classify_a_ref_exact(pos, catalog)
    b = classify_b_ref_in_product(pos, catalog)
    c = classify_c_description_tokens(pos, catalog)

    def bucket_stats(flags: list[bool]) -> dict:
        rows = sum(1 for f in flags if f)
        spend = sum(p["extended"] for p, f in zip(pos, flags) if f)
        return {"rows": rows, "spend": spend}

    print("## 1. Signal agreement")
    print()
    print("| signal | method | on-contract rows | on-contract spend |")
    print("|---|---|---:|---:|")
    sa = bucket_stats(a)
    sb = bucket_stats(b)
    sc = bucket_stats(c)
    print(f"| A | ref-number exact match | {sa['rows']} | {fmt_money(sa['spend'])} |")
    print(f"| B | ref appears in product name | {sb['rows']} | {fmt_money(sb['spend'])} |")
    print(f"| C | catalog description token overlap | {sc['rows']} | {fmt_money(sc['spend'])} |")
    print()

    # Consensus: 3 of 3, 2 of 3, 1 of 3, 0 of 3
    print("## 2. Per-row consensus")
    print()
    print("Each row voted on by all three signals:")
    print()
    by_consensus: dict[int, dict] = defaultdict(lambda: {"rows": 0, "spend": 0.0})
    for p, fa, fb, fc in zip(pos, a, b, c):
        votes = int(fa) + int(fb) + int(fc)
        by_consensus[votes]["rows"] += 1
        by_consensus[votes]["spend"] += p["extended"]
    print("| signals agreeing | rows | spend | interpretation |")
    print("|---:|---:|---:|---|")
    interpret = {
        3: "Strong on-contract (all three agree)",
        2: "Probable on-contract (two of three)",
        1: "Weak signal (one of three — review)",
        0: "Strong off-contract (none agree)",
    }
    for k in (3, 2, 1, 0):
        d = by_consensus[k]
        print(
            f"| {k}/3 | {d['rows']} | {fmt_money(d['spend'])} | {interpret[k]} |"
        )
    print()

    # A-vs-B, A-vs-C agreement matrices
    print("## 3. Pairwise agreement")
    print()
    def pairwise(x: list[bool], y: list[bool]) -> dict:
        both = sum(1 for a_, b_ in zip(x, y) if a_ and b_)
        only_x = sum(1 for a_, b_ in zip(x, y) if a_ and not b_)
        only_y = sum(1 for a_, b_ in zip(x, y) if not a_ and b_)
        neither = sum(1 for a_, b_ in zip(x, y) if not a_ and not b_)
        return {"both": both, "only_x": only_x, "only_y": only_y, "neither": neither}

    for label, x, y in [("A vs B", a, b), ("A vs C", a, c), ("B vs C", b, c)]:
        p_ = pairwise(x, y)
        agree = p_["both"] + p_["neither"]
        print(f"**{label}** — agree {agree}/{len(pos)} ({agree/len(pos)*100:.1f}%)")
        print()
        print(f"- both-on-contract: {p_['both']}")
        print(f"- both-off-contract: {p_['neither']}")
        print(f"- only first says on: {p_['only_x']}")
        print(f"- only second says on: {p_['only_y']}")
        print()

    # Algebraic cross-checks
    print("## 4. Algebraic cross-checks")
    print()
    by_year: dict[int, float] = defaultdict(float)
    for p in pos:
        by_year[p["date"].year] += p["extended"]
    year_sum = sum(by_year.values())
    total = sum(p["extended"] for p in pos)

    trailing = sum(
        p["extended"]
        for p in pos
        if TRAILING_12MO_START <= p["date"] <= TODAY
    )
    pre = sum(p["extended"] for p in pos if p["date"] < TRAILING_12MO_START)
    future = sum(p["extended"] for p in pos if p["date"] > TODAY)

    print(f"- Lifetime spend: **{fmt_money(total)}**")
    for y in sorted(by_year):
        print(f"  - {y}: {fmt_money(by_year[y])}")
    print(f"  - **sum-of-years = {fmt_money(year_sum)}** → equal to lifetime: {abs(year_sum - total) < 0.01}")
    print()
    print(f"- Time partition (trailing-12mo + pre-window + future-dated):")
    print(f"  - trailing: {fmt_money(trailing)}")
    print(f"  - pre-window: {fmt_money(pre)}")
    print(f"  - future-dated: {fmt_money(future)}")
    partition_sum = trailing + pre + future
    print(f"  - **sum = {fmt_money(partition_sum)}** → equal to lifetime: {abs(partition_sum - total) < 0.01}")
    print()
    on_spend = sa["spend"]
    off_spend = sum(p["extended"] for p, fa in zip(pos, a) if not fa)
    print(f"- Signal-A partition:")
    print(f"  - on-contract: {fmt_money(on_spend)}")
    print(f"  - off-contract: {fmt_money(off_spend)}")
    print(f"  - **sum = {fmt_money(on_spend + off_spend)}** → equal to lifetime: {abs(on_spend + off_spend - total) < 0.01}")
    print()

    # Human-readable sample
    print("## 5. Random 10-row sample per bucket (human eyeball)")
    print()
    print("_Seed = 42 so this is reproducible. For each sampled row, is the classification obviously right?_")
    print()
    rng = random.Random(RANDOM_SEED)
    on_rows = [p for p, fa in zip(pos, a) if fa]
    off_rows = [p for p, fa in zip(pos, a) if not fa]

    print("### On-contract sample (should all be valid Arthrex catalog SKUs)")
    print()
    print("| ref | product name | extended | date |")
    print("|---|---|---:|---|")
    for p in rng.sample(on_rows, min(SAMPLE_SIZE, len(on_rows))):
        prod = (p["product"] or "")[:60]
        print(f"| `{p['ref']}` | {prod} | {fmt_money(p['extended'])} | {p['date']} |")
    print()

    print("### Off-contract sample (should be things NOT on the Arthrex catalog)")
    print()
    print("| ref | product name | extended | date |")
    print("|---|---|---:|---|")
    for p in rng.sample(off_rows, min(SAMPLE_SIZE, len(off_rows))):
        prod = (p["product"] or "")[:60]
        print(f"| `{p['ref'] or '(empty)'}` | {prod} | {fmt_money(p['extended'])} | {p['date']} |")
    print()

    # Headline
    print("## 6. Headline")
    print()
    print(f"- Signal A (ref exact): **{sa['rows']} on-contract, {fmt_money(sa['spend'])}**")
    print(f"- Signal B (ref in name): **{sb['rows']} on-contract, {fmt_money(sb['spend'])}**")
    print(f"- Signal C (description tokens): **{sc['rows']} on-contract, {fmt_money(sc['spend'])}**")
    print(f"- Unanimous on-contract (3/3): **{by_consensus[3]['rows']} rows, {fmt_money(by_consensus[3]['spend'])}**")
    print(f"- Unanimous off-contract (0/3): **{by_consensus[0]['rows']} rows, {fmt_money(by_consensus[0]['spend'])}**")
    print(
        f"- Disputed (1/3 or 2/3): **{by_consensus[1]['rows'] + by_consensus[2]['rows']} rows, "
        f"{fmt_money(by_consensus[1]['spend'] + by_consensus[2]['spend'])}**"
    )
    print()


if __name__ == "__main__":
    main()
