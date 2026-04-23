#!/usr/bin/env python3
"""
Theme contrast audit — WCAG AA check on every meaningful color pair in
app/globals.css (light + dark), plus hover-state pairs derived from the
shadcn / tailwind defaults the app uses.

Usage:
  python3 scripts/theme_audit.py > docs/superpowers/diagnostics/2026-04-22-theme-audit.md

No external deps — pure Python implementation of oklch → sRGB → WCAG L*.

AA thresholds (WCAG 2.1):
  - Normal text (body copy): contrast ≥ 4.5
  - Large text (≥ 18pt or ≥ 14pt bold): contrast ≥ 3.0
  - Non-text UI (borders, focus rings): contrast ≥ 3.0
"""
from __future__ import annotations

import math
import re
from pathlib import Path


# ─── oklch → sRGB ────────────────────────────────────────────────────


def oklch_to_oklab(l: float, c: float, h_deg: float) -> tuple[float, float, float]:
    h_rad = math.radians(h_deg)
    return l, c * math.cos(h_rad), c * math.sin(h_rad)


def oklab_to_linear_rgb(
    ok_l: float, ok_a: float, ok_b: float
) -> tuple[float, float, float]:
    l_ = ok_l + 0.3963377774 * ok_a + 0.2158037573 * ok_b
    m_ = ok_l - 0.1055613458 * ok_a - 0.0638541728 * ok_b
    s_ = ok_l - 0.0894841775 * ok_a - 1.2914855480 * ok_b
    L, M, S = l_**3, m_**3, s_**3
    return (
        +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
        -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
        -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S,
    )


def linear_to_srgb(v: float) -> float:
    v = max(0.0, min(1.0, v))
    return 12.92 * v if v <= 0.0031308 else 1.055 * (v ** (1 / 2.4)) - 0.055


def oklch_to_srgb(l: float, c: float, h: float) -> tuple[float, float, float]:
    L, a, b = oklab_to_linear_rgb(*oklch_to_oklab(l, c, h))
    return linear_to_srgb(L), linear_to_srgb(a), linear_to_srgb(b)


def relative_luminance(r: float, g: float, b: float) -> float:
    def chan(v: float) -> float:
        v = max(0.0, min(1.0, v))
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def contrast(c1: tuple[float, float, float], c2: tuple[float, float, float]) -> float:
    L1, L2 = relative_luminance(*c1), relative_luminance(*c2)
    lighter, darker = max(L1, L2), min(L1, L2)
    return (lighter + 0.05) / (darker + 0.05)


# ─── Parse globals.css ────────────────────────────────────────────────


OKLCH_RE = re.compile(
    r"--([\w-]+):\s*oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*/\s*[0-9.]+)?\)"
)


def parse_tokens(text: str) -> dict[str, dict[str, tuple[float, float, float]]]:
    """Return {mode: {token_name: (L, c, h)}} for 'light' and 'dark'."""
    result: dict[str, dict[str, tuple[float, float, float]]] = {
        "light": {},
        "dark": {},
    }
    # Only match selector-start-of-line to avoid `.dark` inside @custom-variant etc.
    selector_re = re.compile(r"^(\:root|\.dark)\s*\{", re.MULTILINE)
    blocks: list[tuple[str, str]] = []
    for m in selector_re.finditer(text):
        mode = "light" if m.group(1) == ":root" else "dark"
        # Balanced-brace extraction: find the matching close.
        depth = 1
        i = m.end()
        while i < len(text) and depth > 0:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        blocks.append((mode, text[m.end() : i - 1]))

    for mode, block in blocks:
        for m in OKLCH_RE.finditer(block):
            name = m.group(1)
            L, c, h = float(m.group(2)), float(m.group(3)), float(m.group(4))
            result[mode].setdefault(name, (L, c, h))
    return result


# ─── Audit pairs ──────────────────────────────────────────────────────


# Meaningful (foreground, surface) pairs we care about.
# `kind` is "text-normal" | "text-large" | "ui" — threshold differs.
TEXT_PAIRS: list[tuple[str, str, str, str]] = [
    # (description, fg_token, bg_token, kind)
    ("body text on page", "foreground", "background", "text-normal"),
    ("card text", "card-foreground", "card", "text-normal"),
    ("popover text", "popover-foreground", "popover", "text-normal"),
    ("muted text on card", "muted-foreground", "card", "text-normal"),
    ("muted text on page", "muted-foreground", "background", "text-normal"),
    ("muted text on muted surface", "muted-foreground", "muted", "text-normal"),
    ("primary button label", "primary-foreground", "primary", "text-normal"),
    ("secondary button label", "secondary-foreground", "secondary", "text-normal"),
    ("accent button label", "accent-foreground", "accent", "text-normal"),
    ("destructive button label", "destructive-foreground", "destructive", "text-normal"),
    ("success text on success bg", "success-foreground", "success", "text-normal"),
    ("warning text on warning bg", "warning-foreground", "warning", "text-normal"),
    ("info text on info bg", "info-foreground", "info", "text-normal"),
    ("sidebar text", "sidebar-foreground", "sidebar", "text-normal"),
    ("sidebar accent text", "sidebar-accent-foreground", "sidebar-accent", "text-normal"),
    ("sidebar primary label", "sidebar-primary-foreground", "sidebar-primary", "text-normal"),
]

UI_PAIRS: list[tuple[str, str, str, str]] = [
    ("border on page", "border", "background", "ui"),
    ("border on card", "border", "card", "ui"),
    ("input border on card", "input", "card", "ui"),
    ("focus ring on page", "ring", "background", "ui"),
    ("focus ring on card", "ring", "card", "ui"),
    ("sidebar border on sidebar", "sidebar-border", "sidebar", "ui"),
    ("sidebar ring on sidebar", "sidebar-ring", "sidebar", "ui"),
]

# Hover-state pairs. The app uses shadcn patterns; the common ones are:
#   hover:bg-accent  hover:text-accent-foreground  — on menu items / nav links
#   hover:bg-muted                                  — on row hover
#   hover:bg-secondary                              — on ghost buttons
#   hover:bg-primary/90                             — on primary buttons
# We check whether the hover background is *visibly different* from the
# base surface (ΔL > 0.04 in oklch-L space — roughly JND threshold), and
# whether the hover's foreground (if different from base) still contrasts.
HOVER_BG_PAIRS: list[tuple[str, str, str]] = [
    # (description, hover_bg_token, base_surface_token)
    ("menu item hover (accent on card)", "accent", "card"),
    ("menu item hover (accent on popover)", "accent", "popover"),
    ("row hover on card (muted over card)", "muted", "card"),
    ("sidebar item hover (sidebar-accent over sidebar)", "sidebar-accent", "sidebar"),
    ("ghost button hover (secondary over card)", "secondary", "card"),
    ("ghost button hover (secondary over background)", "secondary", "background"),
    ("dropdown item hover (accent on popover)", "accent", "popover"),
]


def fmt_pair(mode: str, fg: str, bg: str, kind: str, tokens: dict[str, tuple[float, float, float]]) -> str:
    if fg not in tokens or bg not in tokens:
        return f"| {mode} | `{fg}` on `{bg}` | ??? | missing token |"
    ratio = contrast(oklch_to_srgb(*tokens[fg]), oklch_to_srgb(*tokens[bg]))
    threshold = 4.5 if kind == "text-normal" else 3.0
    status = "✅ pass" if ratio >= threshold else "❌ FAIL"
    return f"| {mode} | `{fg}` on `{bg}` | {ratio:.2f} | {threshold} | {status} |"


def fmt_hover(mode: str, hover: str, base: str, tokens: dict[str, tuple[float, float, float]]) -> str:
    if hover not in tokens or base not in tokens:
        return f"| {mode} | `{hover}` over `{base}` | ??? | missing |"
    dL = abs(tokens[hover][0] - tokens[base][0])
    delta_bucket = "imperceptible" if dL < 0.02 else "subtle" if dL < 0.04 else "visible"
    status = "❌ INVISIBLE" if dL < 0.02 else "⚠ subtle" if dL < 0.04 else "✅ visible"
    return f"| {mode} | `{hover}` over `{base}` | ΔL={dL:.3f} | {delta_bucket} | {status} |"


def main() -> None:
    css = Path("app/globals.css").read_text()
    tokens = parse_tokens(css)

    print("# Theme Audit — WCAG AA contrast + hover-state visibility")
    print()
    print("Generated by `scripts/theme_audit.py` on 2026-04-22.")
    print()
    print("## 1. Text contrast (foreground on surface)")
    print()
    print("| mode | pair | ratio | threshold | status |")
    print("|---|---|---:|---:|---|")
    for desc, fg, bg, kind in TEXT_PAIRS:
        for mode in ("light", "dark"):
            print(fmt_pair(mode, fg, bg, kind, tokens[mode]))
    print()

    print("## 2. UI element contrast (borders / rings on surface)")
    print()
    print("| mode | pair | ratio | threshold | status |")
    print("|---|---|---:|---:|---|")
    for desc, fg, bg, kind in UI_PAIRS:
        for mode in ("light", "dark"):
            print(fmt_pair(mode, fg, bg, kind, tokens[mode]))
    print()

    print("## 3. Hover-state visibility (does hover actually change the surface?)")
    print()
    print("Threshold: ΔL ≥ 0.04 in OKLab-L is roughly the JND for adjacent surfaces.")
    print("ΔL < 0.02 means the hover state is visually indistinguishable from the base.")
    print()
    print("| mode | pair | delta | bucket | status |")
    print("|---|---|---|---|---|")
    for desc, hover, base in HOVER_BG_PAIRS:
        for mode in ("light", "dark"):
            print(fmt_hover(mode, hover, base, tokens[mode]))
    print()

    print("## 4. Surface-on-surface contrast (card over background, popover over card, etc.)")
    print()
    print("Surfaces need to be distinguishable — if `card` L matches `background` L,")
    print("cards 'float' without separation. ΔL ≥ 0.02 is the minimum perceptual step.")
    print()
    SURFACE_STACK = [
        ("card vs background", "card", "background"),
        ("popover vs background", "popover", "background"),
        ("popover vs card", "popover", "card"),
        ("muted vs background", "muted", "background"),
        ("muted vs card", "muted", "card"),
        ("secondary vs card", "secondary", "card"),
        ("sidebar vs background", "sidebar", "background"),
        ("sidebar-accent vs sidebar", "sidebar-accent", "sidebar"),
    ]
    print("| mode | pair | ΔL | status |")
    print("|---|---|---|---|")
    for desc, a, b in SURFACE_STACK:
        for mode in ("light", "dark"):
            if a not in tokens[mode] or b not in tokens[mode]:
                print(f"| {mode} | {desc} | — | missing |")
                continue
            dL = abs(tokens[mode][a][0] - tokens[mode][b][0])
            st = "❌ INVISIBLE" if dL < 0.01 else "⚠ subtle" if dL < 0.02 else "✅ visible"
            print(f"| {mode} | {desc} (`{a}` vs `{b}`) | {dL:.3f} | {st} |")
    print()

    print("## 5. Summary of issues")
    print()
    fails: list[str] = []
    for desc, fg, bg, kind in TEXT_PAIRS + UI_PAIRS:
        for mode in ("light", "dark"):
            if fg not in tokens[mode] or bg not in tokens[mode]:
                continue
            ratio = contrast(oklch_to_srgb(*tokens[mode][fg]), oklch_to_srgb(*tokens[mode][bg]))
            threshold = 4.5 if kind == "text-normal" else 3.0
            if ratio < threshold:
                fails.append(f"- **{mode}**: {desc} — `{fg}` on `{bg}` = {ratio:.2f} (need {threshold})")
    for desc, hover, base in HOVER_BG_PAIRS:
        for mode in ("light", "dark"):
            if hover not in tokens[mode] or base not in tokens[mode]:
                continue
            dL = abs(tokens[mode][hover][0] - tokens[mode][base][0])
            if dL < 0.02:
                fails.append(f"- **{mode}**: hover {desc} — ΔL={dL:.3f} (invisible)")
    if fails:
        print("\n".join(fails))
    else:
        print("_No AA or hover failures found._")
    print()


if __name__ == "__main__":
    main()
