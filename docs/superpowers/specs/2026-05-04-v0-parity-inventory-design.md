---
date: 2026-05-04
status: draft
topic: v0-parity-inventory
related:
  - docs/superpowers/specs/2026-04-25-v0-calculations-port.md
  - docs/superpowers/specs/2026-04-26-v0-parity-engines-design.md
---

# v0 Parity Inventory — turn the prototype into a checkable spec

## Problem

Three weeks into porting the v0 prototype (`/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`)
to tydei-next, work is not converging:

- **Parity gaps** — surfaces marked "done" still drift from v0 weeks later
- **Regressions** — fixes land, new bugs appear; the canonical-helper layer catches
  numeric drift but not visual/behavioral drift
- **Velocity** — each subsystem takes days through brainstorm → plan → subagents
  → bug-bash, and 5+ surfaces still need work
- **No "done" signal** — Charles (human reviewer) eyeballs each surface; bug lists
  stay open indefinitely

Root cause: **v0 is the ground truth, but it is only consulted by humans.** Every
parity check is a manual side-by-side. There is no executable definition of "this
surface matches v0," so drift accumulates silently, regressions sneak through, and
"done" stays a vibe.

The math layer already solved this with oracles (`scripts/oracles/full-sweep.ts`,
`source-scenarios.ts`, `schema-invariants.ts`). The UI/behavior layer has nothing
equivalent.

## Goal

Produce one **flat, line-itemed parity checklist** per v0 surface — written by
reading v0's source — that:

1. Defines "done" for the corresponding tydei surface (every checkbox ticked = parity)
2. Drives all remaining tydei port work as a structured spec
3. Serves as a QA script for verification subagents and human reviewers
4. Stays cheap to produce (~half-day for the whole app, no harness build)

Non-goals (explicitly deferred):

- Building a Playwright screenshot-diff harness — only escalate to this if a
  surface keeps regressing after the inventory is in use
- Adopting v0 source code into tydei — v0 is messy; tydei stays the prod codebase
- Re-porting already-shipped surfaces — the inventory documents what they should
  contain so future regressions can be caught, but does not trigger re-work
  unless the user asks

## Approach

### What gets inventoried

Every v0 page under `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/app/`. From the
recon, that's 52 `page.tsx` files across `app/`, `app/dashboard/`, `app/admin/`,
`app/vendor/`, and `app/auth/`. Each page produces one inventory file. Some routes
will be filtered out as not worth inventorying (`/clear-cog`, `/force-clear` look
like prototype debug pages — confirm during Phase 1 and skip with a note in the
index).

### Inventory file structure

Location: `docs/superpowers/v0-inventory/<route>.md`
Naming: replace `/` with `_`, drop bracket params (e.g.,
`dashboard/contracts/[id]/page.tsx` → `dashboard_contracts_id.md`)

Each file contains:

```md
---
v0_source: app/dashboard/contracts/page.tsx
tydei_target: app/dashboard/contracts/page.tsx
status: inventory-only | tydei-walked | parity-verified
last_checked: YYYY-MM-DD
---

# /dashboard/contracts — Contracts List (facility)

## Purpose
One-line summary of what this page shows the user.

## Visual regions (top to bottom, left to right)
- [ ] Page header: title "Contracts", subtitle "<text>", "+ New Contract" button (top-right)
- [ ] Filters bar: vendor multi-select, status dropdown, term filter, search input
- [ ] KPI strip: 4 cards (Active Contracts, Total Spend, Earned, Collected)
- [ ] Table: columns + sort + pagination
- [ ] Empty state: copy + CTA

## Data fields per row (table)
- [ ] Vendor: name, links to /vendor/[id]
- [ ] Term: "MMM YYYY – MMM YYYY" format
- [ ] Spend (trailing 12mo): formatted $X,XXX with thousands separators
- [ ] Earned (lifetime): from sumEarnedRebatesLifetime helper
- [ ] Collected (lifetime): from sumCollectedRebates helper
- [ ] Compliance %: badge color by threshold (green ≥90, yellow 70-89, red <70)
- [ ] Status: badge (Active / Expiring / Expired)

## Interactions
- [ ] Click row → /dashboard/contracts/[id]
- [ ] Click "+ New Contract" → /dashboard/contracts/new
- [ ] Sort column header → toggles asc/desc
- [ ] Pagination → 25 rows/page

## Empty / Loading / Error states
- [ ] Empty: "No contracts yet" + "+ New Contract" CTA
- [ ] Loading: skeleton rows (5)
- [ ] Error: red banner + "Reload" link

## Notes / quirks observed in v0
- v0 stores filter state in URL params (?vendor=...&status=...). Worth preserving.
- v0 sorts by Earned desc by default.
```

### Index file

`docs/superpowers/v0-inventory/INDEX.md` lists every inventoried surface with
status (inventory-only / tydei-walked / parity-verified) and links. This is the
"what's left" dashboard. ~150 lines max — keep it grep-friendly.

### Per-surface workflow (after inventory exists)

For each surface that needs parity work:

1. Open inventory file + load the tydei surface (in browser)
2. A verification subagent or Charles walks the checklist, ticks confirmed items,
   files unchecked items as a diff report
3. The diff report becomes the input to a normal `writing-plans` cycle
4. After fixes land, re-walk checklist; promote `status: parity-verified` when clean
5. Surface stays parity-verified until v0 is updated or tydei refactors touch it

### Why this is the right level of effort

| Approach | Cost | Parity strength | Drift caught |
|---|---|---|---|
| Status quo (Charles eyeballs) | high (3 weeks ongoing) | weak | none — relies on memory |
| Full Playwright screenshot-diff harness | 1-2 days build + ongoing seed alignment | strongest | all visual + structural |
| **Inventory checklist (this design)** | **~half-day, one-time** | **explicit, line-itemed** | **everything inventoried** |
| Inventory + budget per surface | half-day + 1d/surface | explicit | everything inventoried |

The checklist is ~80% of the parity signal at ~10% of the harness cost. If, after
2-3 surfaces, regressions are still leaking on items that were checked off, the
worst-offender surface escalates to a Playwright diff. The inventory work is not
wasted in that case — it becomes the spec for what the harness should assert.

## Deliverables

Phase 1 (this spec → first plan):
- `docs/superpowers/v0-inventory/` directory
- ~50 inventory files (one per v0 page, minus debug routes)
- `docs/superpowers/v0-inventory/INDEX.md`
- `docs/superpowers/v0-inventory/README.md` — short usage guide for future Claude
  sessions and human reviewers (how to walk a checklist, when to escalate)

Phase 2 (separate spec, after Phase 1):
- A "remaining surfaces" prioritization based on the index
- Per-surface walking workflow as a verification subagent template

Phase 3 (only if escalation needed):
- Playwright screenshot-diff harness for the worst-offender surfaces

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| v0 page is hard to read (messy code, unclear structure) | Inventory subagent runs the page in browser if needed (v0 is runnable Next.js); falls back to source for hidden behavior |
| Inventory files drift from v0 if v0 is updated | v0 is a frozen reference per CLAUDE.md ("read-only reference"); if it changes, treat that as a new event |
| Checklists become rote / not actually walked | Walking step is a subagent task with a structured diff report; not a free-form "looks good" |
| 47 files is a lot to maintain | Each file is small (~50 lines); index is the maintenance surface |
| Tydei has surfaces v0 doesn't (`bundles/`, `compliance/`, `forgot-password/`) | Inventory documents v0-only routes; tydei-only surfaces are out of scope (no parity to check) |

## Success criteria

- [ ] All ~50 in-scope v0 pages have an inventory file (debug routes documented as skipped)
- [ ] INDEX.md exists and is current
- [ ] Next porting task uses an inventory file as its spec input (not a free-form
      "port v0's contracts page" brief)
- [ ] One surface gets walked end-to-end (inventory → walk → diff → fix → verify)
      to prove the workflow before scaling

## Open questions (none blocking)

- Should the inventory include screenshots of v0 surfaces alongside the text? Defer
  — text is enough to start, can add screenshots if a walking subagent needs them.
- Should we inventory the v0 component library (`/components/`) too, or just pages?
  Just pages — components are implementation detail; the page file enumerates which
  components are present and that's what parity actually means.
