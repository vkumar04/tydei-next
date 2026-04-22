# W2.B — Locate the terms-and-conditions surface

**Date:** 2026-04-22
**Bug:** Charles — "every time I enter a contract I am getting a different
result on terms and conditions."

## 1. Surfaces rendering "Terms" on contract detail

Two surfaces render contract terms content on the facility dashboard:

1. **Dedicated Terms page** — `app/dashboard/contracts/[id]/terms/page.tsx`
   → `components/facility/contracts/contract-terms-page-client.tsx` →
   `<ContractTermsDisplay terms={terms ?? []} currentSpend={contract?.currentSpend ?? undefined} />`
   (from `components/contracts/contract-terms-display.tsx`).
2. **"Rebates & Tiers" tab** on the main contract-detail view —
   `components/contracts/contract-detail-client.tsx` line 1121 renders the
   same `<ContractTermsDisplay terms={contract.terms} currentSpend={stats?.totalSpend} />`.

Grep used:

```
grep -rn -i "terms and conditions\|terms & conditions\|^Terms$\|\"Terms\"" \
  components/ app/ --include="*.tsx" --include="*.ts"
```

No hit on the literal "terms and conditions" string anywhere in the app
tree (only `components/marketing/value-props.tsx` which is the marketing
site). Charles's phrase "terms and conditions" is his label for the
Terms & Tiers content. No separate AI-authored "T&C summary" surface
exists.

## 2. Feeding server actions

### Dedicated `/terms` page

`components/facility/contracts/contract-terms-page-client.tsx` imports:

- `getContractTerms(contractId)` from `@/lib/actions/contract-terms` — the
  primary feeder.
- `useContract(contractId)` from `@/hooks/use-contracts` → `getContract`
  in `lib/actions/contracts.ts` — feeds `contract.currentSpend` and
  `contract.productCategory` for the category picker.
- `getCategories()` and `getContractPricing(contractId)` — fallbacks.

### "Rebates & Tiers" tab

`components/contracts/contract-detail-client.tsx` uses only `useContract`
→ `getContract`. `contract.terms` is the sole feed into
`ContractTermsDisplay` on that tab.

## 3. Drift-class audit

### `getContractTerms` (lib/actions/contract-terms.ts:46-58)

```ts
const terms = await prisma.contractTerm.findMany({
  where: { contractId },
  include: {
    tiers: { orderBy: { tierNumber: "asc" } },
    products: { select: { vendorItemNo: true } },  // ← no orderBy
  },
  orderBy: { createdAt: "asc" },
})
```

- **AI calls (`generateText` / `generateObject`):** none.
- **Non-deterministic time (`new Date()` / `Date.now()`):** none at read.
- **`findMany` / nested include without `orderBy`:** YES — the `products`
  include (ContractTermProduct join) has no `orderBy`. Postgres without
  `ORDER BY` gives no row-order guarantee; after enough inserts/updates
  the returned order can shuffle.

### `getContract` (lib/actions/contracts.ts:424-565)

- **AI calls:** none.
- **`new Date()`:** yes — `const today = new Date()` (for earned-YTD
  aggregate) and `const windowEnd = new Date()` (for currentSpend 12-mo
  horizon). These only tick over at day boundaries, not per-reload, so
  they don't explain "every time I enter" drift.
- **`findMany` / nested include without `orderBy`:**
  - `terms` — has `orderBy: createdAt asc` ✓
  - `tiers` — has `orderBy: tierNumber asc` ✓
  - `documents` — has `orderBy: uploadDate desc` ✓
  - `contractFacilities` — **no `orderBy`**
  - `contractCategories` — **no `orderBy`**
  - `rebates` — **no `orderBy`**
  - `periods` — has `orderBy: periodStart asc` ✓

None of `contractFacilities`, `contractCategories`, `rebates` flow into
the **Terms** display directly (they feed header cards, aggregates which
are commutative sums). But the unordered `terms.products` include is
copied through by `ContractTermsPageClient.startEditing` into
`editTerms[*].scopedItemNumbers`, so on Edit-mode the picker would also
reflect any drift.

## 4. Classification

**Class C — missing `orderBy`.**

Primary offender: `ContractTerm.products` include in `getContractTerms`
(and the sibling `terms.*.products` via `getContract` — same model,
same missing orderBy once that path is used).

Caveats worth noting for the fix implementer:

- The demo DB currently has zero `contract_term_product` rows
  (`SELECT COUNT(*) FROM contract_term_product;` → 0). That means a
  deep-equal vitest against the demo seed may not actually reproduce the
  drift — both calls come back with `products: []`. The test in Task 2
  will confirm.
- If the vitest passes, the drift Charles sees is probably either
  (a) coming from a different surface he's calling "terms and conditions"
  (worth re-confirming with him which tab he's on), or (b) happening in
  a surface with richer data than the demo seed (a real contract with
  10+ term-scoped items). Either way, adding the orderBy is still the
  right fix — it closes a real hazard.

**No AI call (not class A), no per-reload time source (not class B),
no obvious class D candidate.** If the Task-2 test fails against the
products-include, class C stands. If it passes, the fix implementer
should (a) still add the orderBy as preventative, and (b) dig into the
other tab surfaces with Vick before declaring victory.
