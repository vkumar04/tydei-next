# Subsystem 0 — Schema Migration (Contracts Rewrite)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Additive-only Prisma schema changes that unblock subsystems 1 (rebate method), 3 (accrual), 4 (compliance + market share), 5 (price variance), and 7 (tie-in).

**Architecture:** Schema-first via `bun run db:push` (repo convention — no migration files). All additions are nullable or have defaults so existing rows don't break. Zod types regenerate automatically via `zod-prisma-types` generator.

**Tech Stack:** Prisma 7, PostgreSQL, `zod-prisma-types`, Bun.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`

---

## Task 1: Add enums for new concepts

**Files:**
- Modify: `prisma/schema.prisma` — enum section (after line 209, before `model User`)

- [ ] **Step 1: Add six new enums to `prisma/schema.prisma`**

Insert after the `CreditTierId` enum (around line 216), before `model User`:

```prisma
enum RebateMethod {
  cumulative
  marginal
}

enum AccrualGranularity {
  monthly
  quarterly
  annual
}

enum AccrualStatus {
  pending
  trued_up
  settled
}

enum TieInMode {
  all_or_nothing
  proportional
}

enum VarianceDirection {
  overcharge
  undercharge
  at_price
}

enum VarianceSeverity {
  minor
  moderate
  major
}
```

- [ ] **Step 2: Verify schema parses**

Run: `bunx prisma validate --schema=prisma/schema.prisma`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

---

## Task 2: Add fields to existing contract models

**Files:**
- Modify: `prisma/schema.prisma:471-522` (Contract) — add `complianceRate`, `currentMarketShare`, `marketShareCommitment`
- Modify: `prisma/schema.prisma:548-574` (ContractTerm) — add `rebateMethod`
- Modify: `prisma/schema.prisma:576-594` (ContractTier) — add `tierName`

- [ ] **Step 1: Add three fields to `Contract` model**

In `model Contract` (around line 492, between `isMultiFacility` and `tieInCapitalContractId`):

```prisma
  complianceRate         Decimal?          @db.Decimal(5, 2)
  currentMarketShare     Decimal?          @db.Decimal(5, 2)
  marketShareCommitment  Decimal?          @db.Decimal(5, 2)
```

- [ ] **Step 2: Add `rebateMethod` field to `ContractTerm`**

In `model ContractTerm` (around line 556, after `appliesTo`):

```prisma
  rebateMethod         RebateMethod @default(cumulative)
```

- [ ] **Step 3: Add `tierName` field to `ContractTier`**

In `model ContractTier` (around line 586, before `rebateType`):

```prisma
  tierName       String?
```

- [ ] **Step 4: Add tie-in bundle back-relation to `Contract`**

In `model Contract` relations block (after `changeProposals` around line 515):

```prisma
  tieInBundlePrimary  TieInBundle?       @relation("PrimaryContract")
  tieInBundleMembers  TieInBundleMember[]
  priceVariances      InvoicePriceVariance[]
  accruals            RebateAccrual[]
```

- [ ] **Step 5: Add accrual back-relation to `ContractPeriod`** (optional — accruals roll up under contract, not period)

Skip if adding this creates ambiguity. `RebateAccrual.contractId` is the canonical link.

- [ ] **Step 6: Validate**

Run: `bunx prisma validate --schema=prisma/schema.prisma`
Expected: valid

---

## Task 3: Add `RebateAccrual` model

**Files:**
- Modify: `prisma/schema.prisma` — after `model Rebate` (around line 942)

- [ ] **Step 1: Add model**

```prisma
model RebateAccrual {
  id             String             @id @default(cuid())
  contractId     String
  periodStart    DateTime           @db.Date
  periodEnd      DateTime           @db.Date
  granularity    AccrualGranularity
  accruedAmount  Decimal            @default(0) @db.Decimal(14, 2)
  trueUpAmount   Decimal            @default(0) @db.Decimal(14, 2)
  status         AccrualStatus      @default(pending)
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@index([contractId])
  @@index([contractId, periodStart])
  @@map("rebate_accrual")
}
```

- [ ] **Step 2: Validate**

Run: `bunx prisma validate --schema=prisma/schema.prisma`
Expected: valid

---

## Task 4: Add tie-in bundle models

**Files:**
- Modify: `prisma/schema.prisma` — after `model ContractPeriod` (around line 684)

- [ ] **Step 1: Add `TieInBundle` and `TieInBundleMember` models**

```prisma
model TieInBundle {
  id                String    @id @default(cuid())
  primaryContractId String    @unique
  complianceMode   TieInMode @default(all_or_nothing)
  bonusMultiplier  Decimal?  @db.Decimal(5, 4)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  primaryContract Contract            @relation("PrimaryContract", fields: [primaryContractId], references: [id], onDelete: Cascade)
  members         TieInBundleMember[]

  @@map("tie_in_bundle")
}

model TieInBundleMember {
  id            String   @id @default(cuid())
  bundleId      String
  contractId    String
  weightPercent Decimal  @db.Decimal(5, 2)
  minimumSpend  Decimal? @db.Decimal(14, 2)
  createdAt     DateTime @default(now())

  bundle   TieInBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  contract Contract    @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@unique([bundleId, contractId])
  @@index([bundleId])
  @@map("tie_in_bundle_member")
}
```

- [ ] **Step 2: Validate**

Run: `bunx prisma validate --schema=prisma/schema.prisma`
Expected: valid

---

## Task 5: Add `InvoicePriceVariance` model

**Files:**
- Modify: `prisma/schema.prisma` — after `model InvoiceLineItem` (around line 917)

- [ ] **Step 1: Add model**

```prisma
model InvoicePriceVariance {
  id                String             @id @default(cuid())
  invoiceLineItemId String             @unique
  contractId        String
  contractPrice     Decimal            @db.Decimal(12, 2)
  actualPrice       Decimal            @db.Decimal(12, 2)
  variancePercent   Decimal            @db.Decimal(6, 2)
  direction         VarianceDirection
  severity          VarianceSeverity
  dollarImpact      Decimal            @db.Decimal(14, 2)
  detectedAt        DateTime           @default(now())

  invoiceLineItem InvoiceLineItem @relation(fields: [invoiceLineItemId], references: [id], onDelete: Cascade)
  contract        Contract        @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@index([contractId])
  @@index([severity])
  @@map("invoice_price_variance")
}
```

- [ ] **Step 2: Add back-relation on `InvoiceLineItem`**

In `model InvoiceLineItem` (around line 913, after `invoice` relation):

```prisma
  priceVariance InvoicePriceVariance?
```

- [ ] **Step 3: Validate**

Run: `bunx prisma validate --schema=prisma/schema.prisma`
Expected: valid

---

## Task 6: Push schema + regenerate client

- [ ] **Step 1: Ensure Postgres is running**

Run: `docker ps --format '{{.Names}}' | grep tydei-next-postgres`
Expected: `tydei-next-postgres-1` in output. If missing, run `docker compose up -d` from repo root.

- [ ] **Step 2: Push schema**

Run: `bun run db:push`
Expected: `Your database is now in sync with your Prisma schema.` · zero data loss warnings (all changes additive).

- [ ] **Step 3: Generate Prisma client + Zod types**

Run: `bunx prisma generate --schema=prisma/schema.prisma`
Expected: `✔ Generated Prisma Client` + `✔ Generated Zod Prisma Types`

---

## Task 7: Backfill defaults on existing rows

All added columns are nullable OR have defaults, so no backfill script is required. Verify by counting unaffected rows.

- [ ] **Step 1: Verify no orphan rows**

Run:
```bash
bun -e '
  import { prisma } from "./lib/db";
  const terms = await prisma.contractTerm.count({ where: { rebateMethod: "cumulative" } });
  const total = await prisma.contractTerm.count();
  console.log(`${terms}/${total} terms on cumulative (should be ${total}/${total})`);
  await prisma.$disconnect();
'
```
Expected: all existing terms defaulted to `cumulative`.

---

## Task 8: Verify typecheck + seed + build

- [ ] **Step 1: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Re-seed DB (drops + rewrites seed data, exercises new columns' defaults)**

Run: `bun run db:seed`
Expected: seed completes, QA sanity passes.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: all routes emit, 0 TypeScript errors, 0 new lint errors.

---

## Task 9: Commit

- [ ] **Step 1: Stage + commit**

```bash
git add prisma/schema.prisma docs/superpowers/plans/2026-04-18-contracts-rewrite-00-schema-plan.md
git commit -m "$(cat <<'EOF'
feat(contracts): subsystem 0 — schema migration

Adds fields and models required by later contracts-rewrite subsystems:
- ContractTerm.rebateMethod (cumulative | marginal)
- ContractTier.tierName
- Contract.complianceRate / currentMarketShare / marketShareCommitment
- RebateAccrual (monthly/quarterly/annual accrual tracking)
- TieInBundle + TieInBundleMember (multi-contract bundles with weighted compliance)
- InvoicePriceVariance (per-line contract-price variance detection)

All additions are nullable or defaulted; no existing data breaks.

Part of: docs/superpowers/specs/2026-04-18-contracts-rewrite.md

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds, pre-commit hook passes (if any).

---

## Acceptance

- `bunx prisma validate` → valid
- `bun run db:push` → zero data-loss warnings
- `bunx prisma generate` → succeeds, zod types regenerate
- `bunx tsc --noEmit` → 0 errors
- `bun run db:seed` → succeeds, QA sanity passes
- `bun run build` → all routes emit
- New models visible in Prisma Studio after `bun run db:studio`

---

## Self-review checklist

- [x] Every new enum/model has `@@map` directive? — `rebate_accrual`, `tie_in_bundle`, `tie_in_bundle_member`, `invoice_price_variance` all mapped.
- [x] Every back-relation specified? — `Contract` gets 4 new relations; `InvoiceLineItem` gets 1.
- [x] All additions nullable or defaulted? — yes; no `NOT NULL` without default on pre-existing tables.
- [x] Cascades declared where orphaning would be wrong? — all new child→parent relations use `onDelete: Cascade`.
- [x] No column type changes on existing tables? — confirmed, purely additive.
