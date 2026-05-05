# Morning. Here's what to do.

## Start the app

You have `rural-health` (vite) running on port 3000. Either stop it, or run tydei on a different port:

```bash
# Option A — stop the other server first, then:
cd /Users/vickkumar/code/tydei-next
bun run dev
# → http://localhost:3000

# Option B — keep rural-health running, use a different port:
cd /Users/vickkumar/code/tydei-next
PORT=3001 bun run dev
# → http://localhost:3001
```

## Test order (start with the surfaces I touched, then expand)

Open the app, log in, then click through in this order. Anything broken = I missed it.

### Polish work I did (verify these look right)
1. `/dashboard/ai-agent` — only **Chat** tab visible (Documents and Reports tabs gone)
2. `/vendor/ai-agent` — same: only **Chat** tab
3. `/dashboard/invoice-validation` — toolbar has no Bulk-dispute or Export button. Per-row dispute still works.
4. `/dashboard/purchase-orders` — no Scan or Export button in toolbar
5. `/dashboard/reports/price-discrepancy` — no Download/Export button (table still renders)
6. `/vendor/contracts/[any-id]` — no "Document upload" button
7. `/admin/billing` — no "Export Report" button in header

### Then sweep everything else (high-traffic first)
8. `/dashboard` — KPIs, charts
9. `/dashboard/contracts` — list loads, click a row, detail loads, Performance tab renders
10. `/dashboard/cog-data` — try a small import
11. `/dashboard/rebate-optimizer` — scenarios run
12. `/vendor/dashboard`, `/vendor/contracts` — vendor portal works
13. `/admin/dashboard`, `/admin/facilities` — admin works

## What I did overnight

Branch: `main` (9 commits ahead of `origin/main`, none pushed).

```
227defb chore(v1): hide vendor contract document upload + admin billing export for v1 ship
93f8f48 chore(v1): hide price-discrepancy report export button for v1 ship
5bf0f35 chore(v1): hide PO scan + export buttons for v1 ship
218d333 chore(v1): hide invoice-validation bulk-dispute + export buttons for v1 ship
cbcae4d chore(v1): hide facility AI Agent Documents + Reports tabs for v1 ship
f421c07 chore(v1): hide vendor AI Agent Documents + Reports tabs for v1 ship
474d2e7 docs(spec+plan): tydei v1 ship — declare done, hide stubs, ship
e019386 docs(specs): clear all specs to start v1-ship cycle
e603772 docs(spec): v0 parity inventory — turn the prototype into a checkable spec
```

**Verify results:**
- `bunx tsc --noEmit` → ✅ 0 errors
- `bunx vitest run` → ✅ 2541 pass, 1 fail (the failure is in YOUR uncommitted `lib/actions/pricing-files.ts` — see below)
- `bun run build` → ✅ all 70+ routes compiled
- Dev server smoke → ✅ proxy auth gates work, login renders, gated routes redirect

## One thing for you to look at

Your uncommitted changes to `lib/actions/pricing-files.ts` (lines 380 and 509) tripped the auth-scope scanner test:

```
prisma.pricingFile.delete({ where: { id } })          // line 380
prisma.contractPricing.update({ where: { id } })       // line 509
```

These are unscoped raw-id Prisma ops — the scanner is the same one that caught the 17 BLOCKERs in the April audit. Wrap with `{ id, facilityId: facility.id }` or use `contractOwnershipWhere(id, facility.id)` from `lib/actions/contracts-auth.ts`. **I did not touch your WIP.** Fix it when you get to that surface.

(Other uncommitted files — `new-contract-client.tsx`, `cog/pricing-columns.tsx`, `cog/pricing-files-table.tsx`, `validators/pricing-files.ts`, `docker-compose.yml` — also untouched.)

## If something's broken

Each polish commit is independently revertable:

```bash
git revert <SHA>          # reverts ONE commit, keeps the others
```

If you hate the whole v1 cycle:

```bash
git reset --hard 5e536dc  # back to where you were before tonight (loses v1 work)
```

The 42 deleted specs are recoverable any time:

```bash
git checkout 5e536dc -- docs/superpowers/specs/
```

## What's NOT shipped

These are deferred, not deleted — handlers/components still in the codebase:
- AI Agent Documents + Reports tabs
- Invoice Validation bulk dispute + export
- Purchase Orders scan + export
- Price Discrepancy report export
- Vendor Contract document upload
- Admin Billing export report

Pick them up in a future cycle.

## TL;DR

Boot the app, click through the 7 polish surfaces, then test the rest. If everything looks right, v1 is done. If something's broken on a polished surface, revert that one commit. The substrate (math, oracles, auth) is unchanged.
