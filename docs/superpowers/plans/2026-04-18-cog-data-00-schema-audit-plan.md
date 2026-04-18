# COG Data Rewrite — Subsystem 0: Schema + Action Audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 5 additive enrichment columns on `COGRecord` + 11 additive stats columns on `PricingFile`, plus catalog the 643-line `lib/actions/cog-records.ts` + 1093-line `lib/actions/mass-upload.ts` action files into per-function summaries that subsequent subsystems (especially subsystem 9's mega-file split) will consume.

**Architecture:** One additive Prisma migration + two audit reports. Zero code changes to existing actions — subsystem 1 consumes the enrichment columns, subsystem 9 uses the audit reports to drive the mega-file split.

**Tech Stack:** Prisma 7, PostgreSQL, `bun run db:push`, `bunx prisma generate`, Vitest, ripgrep.

**Parent spec:** `docs/superpowers/specs/2026-04-18-cog-data-rewrite.md` §3.

---

## File structure

**Files touched:**

- Modify: `prisma/schema.prisma` — add 5 `COGRecord` columns + 11 `PricingFile` columns + 2 indexes
- Create: `tests/contracts/cog-enrichment-schema.test.ts` — sanity test the new columns exist + default correctly
- Create: `docs/superpowers/plans/2026-04-18-cog-data-00-actions-audit.md` — catalog of `lib/actions/cog-records.ts` + `lib/actions/mass-upload.ts` functions for subsystem 9 consumption

**Files audited (read-only — no changes this subsystem):**

- `lib/actions/cog-records.ts` (643 lines) — full function catalog
- `lib/actions/mass-upload.ts` (1093 lines) — full function catalog + domain classification (COG / pricing / invoice / case-costing)

---

## Task 1: Add 5 enrichment columns to `COGRecord`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Locate `model COGRecord`**

Run:
```bash
grep -n "^model COGRecord" prisma/schema.prisma
```

- [ ] **Step 2: Add 5 enrichment columns + 1 new index**

Insert the 5 new columns before `createdAt`, after `matchStatus` (which landed in platform-data-model subsystem 0):

```prisma
  matchStatus          COGMatchStatus @default(pending)
  contractId           String?
  contractPrice        Decimal? @db.Decimal(12, 2)
  isOnContract         Boolean  @default(false)
  savingsAmount        Decimal? @db.Decimal(14, 2)
  variancePercent      Decimal? @db.Decimal(6, 2)
  createdAt            DateTime @default(now())
```

And add one new index (the `matchStatus` indexes are already present from platform-data-model):

```prisma
  @@index([contractId])
  @@index([facilityId, isOnContract])
```

- [ ] **Step 3: Validate schema**

Run:
```bash
bunx prisma validate --schema=prisma/schema.prisma
```

Expected: valid.

---

## Task 2: Create `FileImport` model (file-level import batch record)

**Files:**
- Modify: `prisma/schema.prisma`

**Context (corrected):** tydei's existing `PricingFile` model is a **per-item pricing table** (vendorId + vendorItemNo + contractPrice), not a file-level import-batch record. The canonical COG doc's `COGFileRecord` concept needs a **new** model — matching the existing `CaseCostingFile` shape at `prisma/schema.prisma:1228`.

We add a unified `FileImport` model (with `FileImportType` discriminator) that handles COG, pricing-file, and any future domain imports. COGRecord gets an optional `fileImportId` FK so rows can trace back to their import batch; PricingFile stays unchanged for now (pricing-file imports will use the same `FileImport` model with `fileType = 'pricing'`).

- [ ] **Step 1: Add `FileImportType` enum + `FileImportStatus` enum**

Add near the other enums (top of file, before first `model`):

```prisma
enum FileImportType {
  cog
  pricing
  invoice
}

enum FileImportStatus {
  processing
  completed
  failed
}
```

- [ ] **Step 2: Add `FileImport` model**

Insert after `model PricingFile` (around line 893, before the `// ─── Alerts ───` divider):

```prisma
model FileImport {
  id                   String            @id @default(cuid())
  facilityId           String
  vendorId             String?
  fileType             FileImportType
  fileName             String
  recordCount          Int?
  onContractSpend      Decimal?          @db.Decimal(14, 2)
  offContractSpend     Decimal?          @db.Decimal(14, 2)
  totalSavings         Decimal?          @db.Decimal(14, 2)
  matchedRecords       Int?
  unmatchedRecords     Int?
  uniqueVendors        Int?
  uniqueItems          Int?
  minTransactionDate   DateTime?         @db.Date
  maxTransactionDate   DateTime?         @db.Date
  errorCount           Int               @default(0)
  warningCount         Int               @default(0)
  processingDurationMs Int?
  status               FileImportStatus  @default(processing)
  createdBy            String?
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt

  facility  Facility    @relation(fields: [facilityId], references: [id])
  vendor    Vendor?     @relation(fields: [vendorId], references: [id])
  cogRecords COGRecord[]

  @@index([facilityId])
  @@index([facilityId, fileType])
  @@index([facilityId, status])
  @@index([vendorId])
  @@map("file_import")
}
```

- [ ] **Step 3: Add `fileImportId` FK to `COGRecord`**

Edit `model COGRecord` — add the column before `createdAt` and the relation after the existing `vendor` relation:

```prisma
  fileImportId         String?
  ...
  createdAt            DateTime @default(now())
  ...
  fileImport FileImport? @relation(fields: [fileImportId], references: [id])
```

And add an index:
```prisma
  @@index([fileImportId])
```

- [ ] **Step 4: Add back-relations on `Facility` + `Vendor`**

Search for `model Facility {` and add `fileImports FileImport[]` to its relations block.
Search for `model Vendor {` and add `fileImports FileImport[]` to its relations block.

- [ ] **Step 5: Validate schema**

Run:
```bash
bunx prisma validate --schema=prisma/schema.prisma
```

Expected: valid.

---

## Task 3: Push schema + regenerate

**Files:** no edits; DB + generated client update.

- [ ] **Step 1: Push to DB**

Run:
```bash
bun run db:push
```

Expected: `Your database is now in sync with your Prisma schema.` with **zero data-loss warnings**.

- [ ] **Step 2: Regenerate Prisma client + Zod**

Run:
```bash
bunx prisma generate --schema=prisma/schema.prisma
```

Expected: ✔ Generated Prisma Client + Zod.

---

## Task 4: Write sanity test

**Files:**
- Create: `tests/contracts/cog-enrichment-schema.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/db"

describe("COGRecord enrichment schema", () => {
  it("allows reading the 5 new enrichment columns with correct defaults", async () => {
    const row = await prisma.cOGRecord.findFirst({
      select: {
        contractId: true,
        contractPrice: true,
        isOnContract: true,
        savingsAmount: true,
        variancePercent: true,
        matchStatus: true,
      },
    })
    if (row) {
      expect(row.isOnContract).toBe(false)
      expect(row.matchStatus).toBe("pending")
      expect(row.contractId).toBeNull()
    } else {
      // Empty DB — compile-time verification of shape only
      expect(true).toBe(true)
    }
  })
})

describe("FileImport schema", () => {
  it("exposes the file-level import batch shape with correct defaults", async () => {
    const batch = await prisma.fileImport.findFirst({
      select: {
        fileType: true,
        fileName: true,
        recordCount: true,
        onContractSpend: true,
        errorCount: true,
        warningCount: true,
        status: true,
      },
    })
    if (batch) {
      expect(batch.errorCount).toBe(0)
      expect(batch.warningCount).toBe(0)
      expect(["processing", "completed", "failed"]).toContain(batch.status)
    } else {
      // Empty DB — compile-time verification of shape only
      expect(true).toBe(true)
    }
  })

  it("allows COGRecord to trace back to its import batch", async () => {
    const row = await prisma.cOGRecord.findFirst({
      select: { fileImportId: true },
    })
    // Nullable — existing rows will have null; new rows can back-reference
    expect(row === null || row.fileImportId === null || typeof row.fileImportId === "string").toBe(true)
  })
})
```

- [ ] **Step 2: Run test**

Run:
```bash
bunx vitest run tests/contracts/cog-enrichment-schema.test.ts
```

Expected: 2 tests passing.

---

## Task 5: Audit `lib/actions/cog-records.ts` (643 lines)

**Files:**
- Create: `docs/superpowers/plans/2026-04-18-cog-data-00-actions-audit.md`

- [ ] **Step 1: Generate function catalog**

Run:
```bash
grep -nE "^export (async )?function|^export (const|async)" lib/actions/cog-records.ts
```

Capture exported function names + line ranges.

- [ ] **Step 2: Generate second file's catalog**

Run:
```bash
grep -nE "^export (async )?function|^export (const|async)" lib/actions/mass-upload.ts
```

- [ ] **Step 3: Write the audit report**

Create `docs/superpowers/plans/2026-04-18-cog-data-00-actions-audit.md` with this shape:

```markdown
# COG Actions Audit — 2026-04-18

## lib/actions/cog-records.ts (643 lines)

### Function catalog
| Function | Lines | Purpose | Split target (subsystem 9) |
|---|---|---|---|
| getCogRecords | L-L | ... | stays |
| importCogBatch | L-L | ... | moves to lib/actions/cog-import.ts |
| ... | | | |

### Findings
- Any function >80 lines flagged
- Any duplicated vendor-matching / normalization logic flagged
- Any sign-convention violations flagged (should be none after
  platform-data-model sign-convention audit)

## lib/actions/mass-upload.ts (1093 lines)

### Function catalog (with domain classification)
| Function | Lines | Domain | Split target |
|---|---|---|---|
| ... | | | |

### Domain breakdown
- COG functions: N (~X lines) → move to lib/actions/cog-import.ts
- Pricing functions: N (~X lines) → move to lib/actions/pricing-import.ts
- Invoice functions: N → stay in lib/actions/invoices.ts
- Case-costing functions: N → stay in lib/actions/cases.ts
- Shared helpers: N → move to lib/actions/mass-upload-shared.ts

## Recommendation for subsystem 9 splits
- cog-records.ts: keep root ≤400 lines; extract [N helpers] into lib/actions/cog/
- mass-upload.ts: split into [4 per-domain files] + orchestrator ≤150 lines
```

Fill in the tables with the grep output.

- [ ] **Step 4: Commit the audit report**

```bash
git add docs/superpowers/plans/2026-04-18-cog-data-00-actions-audit.md
git commit -m "docs: COG actions audit — cog-data-rewrite subsystem 0"
```

---

## Task 6: Full verification

- [ ] **Step 1: Typecheck**

Run:
```bash
bunx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Tests**

Run:
```bash
bunx vitest run --exclude tests/workflows --exclude tests/visual
```

Expected: all pass (1 new + 90 existing = 91).

- [ ] **Step 3: Reseed + QA sanity**

Run:
```bash
bun run db:seed
```

Expected: qa-sanity OK, 10/10 passing.

- [ ] **Step 4: Build**

Run:
```bash
bun run build
```

Expected: compiled successfully.

---

## Task 7: Commit schema + test

- [ ] **Step 1: Stage + commit**

```bash
git add prisma/schema.prisma \
        lib/generated/zod/index.ts \
        tests/contracts/cog-enrichment-schema.test.ts \
        docs/superpowers/plans/2026-04-18-cog-data-00-schema-audit-plan.md

git commit -m "$(cat <<'EOF'
feat(cog): subsystem 0 — enrichment columns + FileImport model

Adds additive schema required by COG enrichment pipeline (subsystems
1-9 of cog-data-rewrite spec):

COGRecord (6 new columns):
- contractId String?
- contractPrice Decimal?(12,2)
- isOnContract Boolean @default(false)
- savingsAmount Decimal?(14,2)
- variancePercent Decimal?(6,2)
- fileImportId String? (FK → FileImport)
+ indexes on contractId, [facilityId, isOnContract], fileImportId

FileImport (new model — file-level import batch record):
- fileType (cog | pricing | invoice)
- fileName, recordCount
- onContractSpend, offContractSpend, totalSavings
- matchedRecords, unmatchedRecords, uniqueVendors, uniqueItems
- minTransactionDate, maxTransactionDate
- errorCount (default 0), warningCount (default 0)
- processingDurationMs
- status (processing | completed | failed, default processing)

Enums: FileImportType, FileImportStatus.
PricingFile (per-item pricing table) unchanged — kept for per-item
contract-price lookups; FileImport covers file-level batch tracking
for both COG and pricing-file uploads via the fileType discriminator.

All additive / nullable-default. Existing rows unchanged.

Acceptance:
- prisma validate: valid
- db:push: in sync, zero data-loss warnings
- prisma generate: Zod types regenerated
- tsc --noEmit: 0 errors
- vitest: passing
- db:seed + qa-sanity: 10/10
- next build: compiled

Audit report for cog-records.ts + mass-upload.ts committed separately.

Part of: docs/superpowers/specs/2026-04-18-cog-data-rewrite.md

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: FF merge to main**

```bash
cd /Users/vickkumar/code/tydei-next
git merge --ff-only contracts-rewrite-00-schema
```

---

## Acceptance

- Schema migration applied; 5 + 13 new columns.
- `bunx tsc --noEmit` → 0 errors.
- Sanity test passing.
- Action audits filed as separate commit.
- `bun run build` compiled.
- `bun run db:seed` qa-sanity OK.
