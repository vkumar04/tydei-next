# v0 Parity — Master Design Spec

**Date:** 2026-04-12
**Branch:** `v0-parity`
**Author:** Claude (autonomous execution approved by Vick)
**Status:** Anchor doc (not an approval gate — execution already in progress)

## Context

Two copies of TYDEi exist:

- **v0** — `~/Downloads/b_kkwtOYstuRr/` — v0.dev export. Next.js 16 + Supabase + Zustand mock stores + Vercel AI Gateway (gpt-4o-mini + claude-sonnet-4.6). Better-looking, prototype-grade. Read-only source material.
- **prod** — `/Users/vickkumar/code/tydei-next/` — Vick's hand-rebuilt production version. Next.js 16 + Prisma 7 + Better Auth (org + stripe) + Postgres + Bun + TanStack Query + server actions + Gemini. Real multi-tenant, real auth, real Stripe, real AI. 49 Prisma models, 3 portals, 39 server-action files.

Goal: make prod match v0 feature-for-feature and pixel-for-pixel without regressing prod's stack, infrastructure, or data model.

## Goal

Feature + UI parity. Every v0 facility-scope feature and page exists in prod with the same visual design (tokens, typography, layout, components, copy, icons, charts) and the same functional behavior, backed by prod's Prisma/server-action data layer.

## Non-goals (protected)

- No stack swaps. Next.js 16, Prisma 7, Better Auth, Tailwind v4, shadcn/ui, TanStack Query, react-hook-form + Zod, Bun — all stay.
- No infrastructure removal. Stripe (`@better-auth/stripe`), Better Auth org + invitations, forgot/reset-password routes, S3 presigned uploads, Upstash rate-limiting, audit log, webhooks — all stay and remain functional.
- No AI model swap. Gemini via `@ai-sdk/google` stays. v0's prompts/tool schemas/PDF extraction schema get ported to prod's `lib/ai/`, adapted for Gemini. Vercel AI Gateway is not introduced.
- No data model regression. Prod's 49 Prisma models stay; only *additions* where v0 features need them.
- No debug route ports. v0's `/clear-cog` and `/force-clear` are not ported.
- **No vendor portal work in this initiative.** Deferred to a post-facility follow-up.
- **No admin portal work in this initiative.** Deferred.

## Scope (this initiative)

Three sub-projects, ordered by dependency, all on one `v0-parity` branch:

1. **Foundation** — design tokens (oklch), typography (Inter), Tailwind v4 config, shadcn/ui variant sweep, shared shells reskin (`PortalShell`, `SidebarNav`, `MetricCard`, `ChartCard`, `StatusBadge`), `lib/constants.ts` badge configs
2. **Landing + (auth) group** — marketing root + login/sign-up pixel match v0; forgot/reset kept but restyled to match
3. **Facility portal** — all 12 facility pages, including AI agent port, plus any Prisma additions needed for facility-side features v0 has but prod doesn't (e.g., facility `contract-renewals`)

## Visual fidelity: Tight (pixel-perfect)

Match v0's design tokens, Inter font and weights, spacing, copy strings, icon choices, chart types, card variants, gradient backgrounds, and layout grids exactly. Prod's current shadcn theme is replaced where it conflicts with v0.

## Acceptance: Playwright-captured v0 baselines

Ship `scripts/capture-v0-baselines.ts` that boots v0 with fake Supabase env + `demo_session=true` cookie and captures every facility-scope page at desktop (1440×900) and mobile (390×844), in both light and dark mode. PNGs land in `docs/v0-reference/<slug>/<theme>-<viewport>.png` and are committed to the repo. During implementation, each prod page is visually compared against its baseline before being marked done.

## Infrastructure: keep everything (option 1)

When v0 and prod disagree because prod has infrastructure v0 lacks:
- **Stripe** — prod's `/admin/billing` keeps Stripe plugin wiring; UI is out of scope for this initiative.
- **Better Auth org/invitations** — prod's `/admin/users` team/invite UI is out of scope; APIs stay.
- **Forgot/reset password** — routes stay functional; pages get restyled to visually match the v0 auth aesthetic even though v0 doesn't link to them.
- **S3 presigned uploads** — prod's `app/api/upload/` stays; v0 file-upload flows (PDF parse, COG CSV) get wired through it.
- **Upstash rate-limiting** — stays wrapping AI endpoints.
- **Audit log** — stays.

## AI: Gemini stays, v0 content ports into prod's `lib/ai/`

Prod already has `lib/ai/` (config, prompts, tools, schemas) using `@ai-sdk/google`. Port work:

| v0 file | Port destination | Adapted for |
|---|---|---|
| `app/api/ai-agent/route.ts` system prompts (facility + vendor branches) | `lib/ai/prompts/ai-agent.ts` | Facility-only branch used now |
| `app/api/ai-agent/route.ts` `contractTools` (analyzeContractPerformance, getMarketShareAnalysis, calculateProspectiveRebate, getSurgeonPerformance, getAlertsSummary) | `lib/ai/tools/` | Replace mocks with real Prisma queries via server actions |
| `app/api/parse-contract-pdf/route.ts` `contractExtractSchema` Zod schema | `lib/ai/schemas/contract-extract.ts` | Used by prod's existing `app/api/parse-file/` |
| `app/api/parse-contract-pdf/route.ts` `getDemoExtractedData` vendor/filename fallback | `lib/ai/demo-contract-extract.ts` | Preserved for when Gemini rate-limits or API key is missing |
| `app/api/analyze-deal/route.ts` prompt + schema | `lib/ai/prompts/analyze-deal.ts` + `lib/ai/schemas/analyze-deal.ts` | Deferred until vendor portal sub-project, since it's vendor-only |

All port adaptations route through `@ai-sdk/google`'s `google()` model factory. No `@ai-sdk/gateway` dependency is added.

## Data model additions (expected)

Identified gaps v0 has that prod's Prisma schema may not fully cover. Exact additions confirmed during facility-page porting:

- **Facility-side contract renewals** — v0 has `/dashboard/contract-renewals` as a facility page. Prod has `Renewal`-adjacent data inside vendor context. Likely needs a query extension or a new query helper, not necessarily a new model.
- **Rebate optimizer inputs** — v0 has richer tier comparison shapes. Likely additive to `ContractTier` or computed in server actions.
- **Case-costing `surgeonUsage`** — prod has `SurgeonUsage` model already; verify field parity.
- **COG parser artifacts** — v0's `vendor-name-mappings` and `category-mappings` already exist in prod as Prisma models. Verify the UI flow uses them.

Any additive Prisma migrations go in `prisma/migrations/` and run via `bun run db:migrate` with a descriptive name.

## Execution order

```
1.  Capture v0 baselines (scripts/capture-v0-baselines.ts)  ← foundation for visual review
2.  Foundation (tokens, typography, ui primitives, shared shells)
3.  Landing page pixel match
4.  Auth pages pixel match
5.  Facility dashboard home
6-16. Facility portal pages in priority order:
      contracts, cog-data, alerts, reports, purchase-orders,
      invoice-validation, contract-renewals, rebate-optimizer,
      case-costing, analysis, ai-agent, settings
17. AI layer port (prompts, tools, schemas)
18. Verify each page against its v0 baseline, iterate
19. bun run build + oxlint + vitest + playwright
20. Open PR
```

Each step commits independently with a clear message. The PR is opened when a cohesive, shippable slice is done — at minimum foundation + landing + auth + as many facility pages as I can complete with confidence. Follow-up PRs continue the work if needed.

## Checkpoints where I WILL stop and ask

Autonomous execution is authorized, but I'll pause and surface if:

- A Prisma migration would be destructive (drops columns, narrows types, renames models with data in them).
- A port would require removing existing prod functionality that's not obviously dead code.
- v0 has a feature that depends on behavior I can't reproduce (e.g., Supabase Realtime, a live subscription).
- Type-check or tests regress in a way I can't cleanly fix within the current page's scope.
- Scope drift threatens to blow past what a single PR can cover — I'll open a narrower PR and surface the remaining backlog.

## Out of scope for this initiative (explicitly deferred)

- Vendor portal (all 11 pages) — separate post-facility brainstorm + sub-project
- Admin portal (all 5 pages) — separate
- Billing/Stripe UI — owned by admin portal sub-project
- Vendor AI agent and `analyze-deal` flow — owned by vendor portal sub-project
- Visual regression Playwright tests (as CI gates) — out of scope; baselines are used for manual comparison, not automated diffs
- Mobile-app, PWA work — out of scope; desktop is primary, mobile viewport baselines captured as reference only
