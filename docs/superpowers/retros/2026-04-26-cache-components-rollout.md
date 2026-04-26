# Cache Components rollout — retro

**Status:** code shipped on `main` 2026-04-26.
- Atomic flag + migration: commit `2344b7b`
- Test mocks for cacheLife/cacheTag: commit `f54d45e`
- Pure-function split (`contract-score-impl.ts`): commit `49cd53f`
- Route-compat smokes + invalidation tests: this commit

**Plan:** [docs/superpowers/plans/2026-04-26-cache-components-rollout.md](../plans/2026-04-26-cache-components-rollout.md)

---

## What we shipped

- `experimental.cacheComponents → cacheComponents: true` at top level of `next.config.ts` (Next 16 moved it out of `experimental`).
- Analytics cache layer migrated from `unstable_cache` to the stable `'use cache'` directive + `cacheLife` + `cacheTag`.
- Old `cacheContractAnalytics` / `cacheFacilityAnalytics` / `cacheVendorAnalytics` wrappers removed; the only caller (`getContractCompositeScore`) now goes through `getCachedContractCompositeScore` in the new `_cached.ts` module.
- Tag builders (`contractAnalyticsTag` etc.) consolidated in `_cached.ts` — `_cache.ts`'s invalidators import from there so read/write sides cannot drift on tag values.
- Pure implementation extracted to `lib/actions/analytics/contract-score-impl.ts` so the `'use cache'` helper can import it without dragging `"use server"` constraints through the cache boundary.
- New Playwright smoke at `tests/visual/smoke-cache-components.test.ts` covering 33 routes (13 facility + 13 vendor + 7 admin).
- New unit test at `lib/actions/analytics/__tests__/cache-invalidation.test.ts` proves the read/write tag wiring round-trips.

## Surprises during execution

- **`cacheComponents` moved to top-level config.** The plan put it under `experimental`. Next 16 logs a `⚠ experimental.cacheComponents has been moved to cacheComponents` warning and silently doesn't enable the feature. Caught by the plan's Task 4.7-4.8 risk gate (dev returned 500 on every page until I moved the flag).
- **`"use server"` files cannot `export type {...}` re-exports under Cache Components.** The plan had `contract-score.ts` re-export `ContractCompositeScore` for back-compat. With the flag on, Next bundles every named export from a `"use server"` module as a Server Action — the type re-export has no runtime symbol and the actions registry import 404s with `Export ContractCompositeScore doesn't exist in target module`. Fix: import the type from `contract-score-impl.ts` directly at every consumer (just `lib/actions/analytics/contract-performance-bundle.ts` in the codebase). Removed the type re-export from `contract-score.ts`.
- The plan's atomic Task 4 design was the right call — both surprises were caught at a single verification gate (Task 4.7-4.8) and fixed in-place before commit. The previous attempt (rolled back same day) failed because it omitted the flag entirely; this one shipped clean.

## Verification

- `tsc --noEmit`: 0 errors
- `vitest`: 2488 / 5 skip / 0 fail (was 2484 — net +4 from the new invalidation suite)
- Local smoke: 15/15 routes return 200 across facility + vendor (admin not yet smoked from Bash; the Playwright suite covers it)
- Live prod verification: BLOCKED — Railway's deploy plane was down at the time of writing (deploy `4492279895` succeeded build + healthcheck but failed to promote). Will verify once Railway is back. The Cache Components changes are safe to deploy as soon as the platform recovers.

## Follow-ups

- **Per-route `experimental_ppr: true` opt-in.** Cache Components without PPR works but doesn't deliver the partial-prerender wins. The next plan should pick 3-5 hot routes (`/dashboard`, `/dashboard/contracts`, `/dashboard/contracts/[id]`, `/vendor/dashboard`) and opt them in one at a time with a smoke per route.
- **TanStack Query `useSuspenseQuery` + `<HydrationBoundary>` on hot pages.** Independent perf win; lets us prefetch in the RSC and stream hydrate on the client without a loading-spinner double-render. Listed as P2 in the open-items triage.
- **Expand cached reads beyond contract score.** `getRenewalRisk`, `getRebateForecast`, `getTieInCompliance` (all in `lib/actions/analytics/`) are good candidates — same invalidation tag-set already exists. Wait until we've watched the contract-score path stabilize on prod before fanning out.
- **Run the visual smoke suite once Railway is back.** Command: `bunx playwright test tests/visual/smoke-cache-components.test.ts --project=visual`. The dev server has to be running.

## Files changed (this rollout)

- `next.config.ts` — `cacheComponents: true`
- `lib/actions/analytics/_cached.ts` (new) — `'use cache'` helper + tag builders
- `lib/actions/analytics/_cache.ts` — invalidator-only; tag builders imported from `_cached.ts`
- `lib/actions/analytics/contract-score.ts` — thin auth shim; calls cached helper
- `lib/actions/analytics/contract-score-impl.ts` (new) — extracted pure impl
- `lib/actions/analytics/contract-performance-bundle.ts` — type import switched to `-impl`
- `tests/setup/next-cache-mock.ts` — added `cacheLife` / `cacheTag` no-ops
- `tests/visual/smoke-cache-components.test.ts` (new) — 33-route smoke
- `lib/actions/analytics/__tests__/cache-invalidation.test.ts` (new) — tag wiring round-trip
