# tydei-next — Claude Code instructions

## Default workflow: superpowers

For ANY non-trivial task in this repo (anything that touches more than one file or
introduces new behavior), default to the superpowers skills flow:

1. **brainstorming** — clarify scope by asking one question at a time, propose 2-3
   approaches, get explicit user approval on a design before writing code.
2. **writing-plans** — turn the approved design into a step-by-step plan with
   bite-sized tasks (each step 2-5 minutes, exact file paths, exact code).
3. **subagent-driven-development** — dispatch a fresh general-purpose subagent per
   task in an isolated git worktree, then cherry-pick the commit to main.

This applies to:
- New features (per-page rewrites, new server actions, new UI surfaces)
- Bug bashes that span more than one file
- v0-prototype parity work
- Any "make it look like X" or "build the rest of Y" request

**Trivial single-file edits** (rename a constant, fix a typo, tweak one prop) can
skip brainstorming and ship directly. Use judgment — when in doubt, brainstorm.

## Project conventions

- **Stack:** Next.js 16 App Router, React 19, Prisma 7, TypeScript strict, Vitest,
  TanStack Query, shadcn/ui, recharts, better-auth.
- **DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei` (local).
  Demo facility = "Lighthouse Community Hospital", `cmo4sbr8p0004wthl91ubwfwb`.
- **No `any` in TypeScript.** Strict mode is on; use proper types.
- **Server actions** live under `lib/actions/`. `"use server"` files can ONLY
  export async functions (interfaces/types are fine — they're erased).
- **Prisma client:** `import { prisma } from "@/lib/db"`. Don't construct your own.
- **Auth gates:** `requireFacility()` / `requireVendor()` / `requireAdmin()` from
  `@/lib/actions/auth`. Use these, never raw session checks.
- **Facility scoping:** every query that reads contracts must use
  `contractsOwnedByFacility(facility.id)` from `@/lib/actions/contracts-auth.ts`.
  Single-row reads use `contractOwnershipWhere(id, facility.id)`.
- **Rebates are NEVER auto-computed for display.** Earned/collected rebate values
  on the contracts list, contract detail, dashboard, reports, etc. come from
  explicit `Rebate` rows or `ContractPeriod` rollups — never from
  `computeRebateFromPrismaTiers`. The tier engine is reserved for clearly-labeled
  *projection* surfaces (rebate-optimizer scenarios, tier-progress estimates).
  Earned counts only periods where `payPeriodEnd <= today`; collected counts
  only rows with a `collectionDate` set. See:
  - `docs/superpowers/specs/2026-04-18-contracts-rewrite.md` (cross-cutting rule)
  - `docs/superpowers/specs/2026-04-18-contracts-list-closure.md` Subsystem 1
- **Canonical "Collected" aggregate:** every surface that renders a "Rebates
  Collected" number (contracts list, contract detail header card, contract
  Transactions tab summary card, dashboard, reports) MUST go through
  `sumCollectedRebates` in `lib/contracts/rebate-collected-filter.ts`. Do not
  hand-roll a `r.collectionDate ? ... : ...` reducer — the helper is the one
  place the filter lives so surfaces cannot drift. See Charles W1.R.
- **Rebate engine units:** `ContractTier.rebateValue` is stored as a fraction
  (0.02 = 2%). The math engine in `lib/contracts/rebate-method.ts` expects integer
  percent. `computeRebateFromPrismaTiers` and `lib/contracts/tier-rebate-label.ts`
  scale by 100 at the Prisma boundary — don't hand-roll the conversion elsewhere.
- **Specs live in `docs/superpowers/specs/`** as `YYYY-MM-DD-<topic>-design.md`.
  **Plans live in `docs/superpowers/plans/`** as `YYYY-MM-DD-<topic>.md`.
- **Worktrees** for parallel subagent work: `.claude/worktrees/agent-<id>/`.
  `.claude/` and `.worktrees/` are gitignored. Cherry-pick the subagent's commit
  by SHA from main; don't merge whole branches.

## Reference codebase

The v0 prototype lives at `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`. When the
user asks to port v0 features, treat that path as the read-only reference — the
spec/plan documents the gap; subagents implement against tydei's Prisma + Next
architecture, not v0's localStorage stores.
