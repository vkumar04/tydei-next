---
date: 2026-05-04
spec: docs/superpowers/specs/2026-05-04-tydei-v1-ship-spec.md
status: in-progress
---

# v1 Polish Plan — hide stub buttons, run verify

Six tasks. Each is one or two file edits. Each gets its own commit so the user
can revert any one independently in the morning.

## Constraints

- Do not delete the underlying components/handlers — only hide the trigger UI
- Do not refactor surrounding code; surgical edits only
- Each commit message: `chore(v1): hide <surface> <button> for v1 ship`
- After each task, run `bunx tsc --noEmit --pretty false 2>&1 | tail -5` to
  confirm no new type errors

## Tasks

### T1 — Hide AI Agent Documents + Reports tabs (vendor portal)

**File:** `components/vendor/ai-agent-client.tsx`
**Action:** Locate the tab list (around lines 278, 286 per audit). Remove or
conditionally hide the `<TabsTrigger>` for "Documents" and "Reports" AND the
matching `<TabsContent>` blocks. Keep "Chat" tab.

If a default-tab assumption is `documents` or `reports` anywhere, change it to
`chat`. Verify with grep.

**Acceptance:** `/vendor/ai-agent` loads, only Chat tab visible.

### T2 — Hide AI Agent Documents + Reports tabs (facility portal)

**File:** Likely `components/facility/ai-agent/ai-agent-client.tsx` (audit
flagged the path as needing confirmation). If the facility version doesn't have
those tabs, skip this task and note "skipped — facility AI agent already
Chat-only" in the commit message.

**Acceptance:** `/dashboard/ai-agent` loads, only Chat tab visible.

### T3 — Hide Invoice Validation bulk dispute + export buttons

**File:** `components/facility/invoices/invoice-validation-client.tsx`
**Action:** Locate the toolbar containing the "Bulk dispute" trigger
(around line 158 per audit) and "Export" trigger (around line 202). Remove the
buttons (and any wrapping toolbar div if it's now empty). Per-row dispute flow
must stay functional.

**Acceptance:** `/dashboard/invoice-validation` loads. Per-row "Dispute" still
works (don't test functionality — just that the per-row button still renders).
Bulk-dispute and Export buttons gone.

### T4 — Hide Purchase Orders Scan + Export buttons

**File:** `components/facility/purchase-orders/po-list.tsx`
**Action:** Locate the toolbar buttons (audit flags lines 145-146). Remove the
two buttons; leave the rest of the toolbar intact.

**Acceptance:** `/dashboard/purchase-orders` loads. List + per-row actions
intact. Scan and Export buttons gone.

### T5 — Hide Price Discrepancy Export button

**File:** `app/dashboard/reports/price-discrepancy/page.tsx` (or its child
client component if extracted — grep for the `exportReport` function)
**Action:** The button calls a fake `toast.success(...)` with no real export.
Remove the button. Leave the table rendering intact.

**Acceptance:** `/dashboard/reports/price-discrepancy` loads, table renders,
no Download/Export button.

### T6 — Hide Vendor Contract Detail upload button + Admin Billing Export

**Files:**
- `components/vendor/contracts/vendor-contract-detail-client.tsx` (around line 77 per audit)
- `app/admin/billing/page.tsx` (button without `onClick`)

**Action:** Remove both buttons. They're independent surfaces; one commit is fine.

**Acceptance:** `/vendor/contracts/[any-id]` and `/admin/billing` load with
those buttons gone.

## After all tasks

### Verify

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'
```

Both must be green. If either fails, commit the work-so-far on a separate
branch named `v1-polish-failed` and report what failed in MORNING.md.

### MORNING.md

Generate `MORNING.md` at repo root with:
- Summary of commits landed overnight (with SHAs)
- Verify result (pass/fail with details)
- Test plan: route → what to click → what to look for, ordered by likelihood
  of finding bugs (start with high-traffic, end with niche)
- Known limitations for v1
- "If something's broken" guide — how to revert any single commit

## Time budget

- T1–T6: ~5 min each = ~30 min total
- Verify: ~3 min
- MORNING.md: ~5 min

Total: ~40 min.
