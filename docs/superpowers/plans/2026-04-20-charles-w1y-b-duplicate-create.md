# Charles W1.Y-B — Duplicate contract create

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining contract-create duplicate pathways that W1.W-E's idempotency-key fix did not cover.

**Architecture:** Diagnostic pulls the last 24h of duplicates and classifies by submit path. Fix either the missed client paths (add idempotency key) or add a DB-level soft-dedupe rule. Regression tests per path.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1y-b-duplicate-create-design.md`

---

### Task 1: Diagnostic — classify the duplicates

**Files:**
- Create: `scripts/diagnose-duplicate-contracts.ts`
- Create: `docs/superpowers/diagnostics/2026-04-20-w1y-b-duplicates.md`

- [ ] **Step 1: Write script**

```ts
// scripts/diagnose-duplicate-contracts.ts
// Usage: bun scripts/diagnose-duplicate-contracts.ts [facilityId]

import { prisma } from "@/lib/db"

async function main() {
  const facilityId = process.argv[2] ?? "cmo4sbr8p0004wthl91ubwfwb"
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const contracts = await prisma.contract.findMany({
    where: { facilityId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, vendorId: true, contractType: true,
      effectiveDate: true, createdAt: true, createdBy: true,
    },
  })

  const groups = new Map<string, typeof contracts>()
  for (const c of contracts) {
    const key = `${c.name}|${c.vendorId}|${c.contractType}|${c.effectiveDate?.toISOString().slice(0,10)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  console.log("# Duplicate contracts — last 24h\n")
  const dupes = [...groups.entries()].filter(([, rows]) => rows.length > 1)
  for (const [key, rows] of dupes) {
    console.log(`## ${key}\n`)
    console.log("| id | createdAt | createdBy | gap from first (ms) |")
    console.log("|---|---|---|---:|")
    const first = rows[0].createdAt.getTime()
    for (const r of rows) {
      console.log(`| ${r.id} | ${r.createdAt.toISOString()} | ${r.createdBy ?? ""} | ${r.createdAt.getTime() - first} |`)
    }
    console.log()
  }
  if (dupes.length === 0) console.log("_No duplicate groups detected in the last 24h._")
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run + capture**

```bash
bun scripts/diagnose-duplicate-contracts.ts > docs/superpowers/diagnostics/2026-04-20-w1y-b-duplicates.md
```

- [ ] **Step 3: Classify**

Open the diagnostics file. For each duplicate group, check the `gap from first` column:

- **Gap < 1s:** client-side double-click that escaped the idempotency map. Check which path — the manual new-contract form (wired in W1.W-E) or a different path.
- **Gap > 30s:** user hit "Create" twice across page nav → idempotency TTL expired. DB soft-dedupe will catch.
- **Different `createdBy`:** two users. Out of scope for this fix.

Note the class for each duplicate at the top of the diagnostic file.

- [ ] **Step 4: Commit**

```bash
git add scripts/diagnose-duplicate-contracts.ts docs/superpowers/diagnostics/2026-04-20-w1y-b-duplicates.md
git commit -m "docs(diagnostic): W1.Y-B duplicate classification snapshot"
```

---

### Task 2: Audit every submit path for idempotency key

**Files:**
- Read: `components/contracts/contract-form.tsx`
- Read: `components/contracts/ai-extract-review.tsx`
- Read: `components/contracts/contract-form-review.tsx`
- Read: `components/contracts/edit-contract-client.tsx`
- Read: any `new-contract` page client under `app/dashboard/contracts/new/`

- [ ] **Step 1: Grep for createContract + idempotencyKey usage**

```bash
bunx grep -rn "createContract\|idempotencyKey\|crypto.randomUUID" components/contracts/ app/dashboard/contracts/
```

Enumerate every client call site that invokes the create action. For each, confirm whether it generates and passes an `idempotencyKey`. Create a checklist:

```
- [ ] new-contract page client — ?
- [ ] ai-extract-review submit — ?
- [ ] amendment-extractor submit — ?
- [ ] pdf-drop-zone upload-and-create — ?
```

- [ ] **Step 2: Fix missing paths**

For any client that doesn't pass an idempotencyKey, add one. Pattern:

```tsx
// Generate once per form session.
const idempotencyKey = useMemo(() => crypto.randomUUID(), [])

// Attach to the mutation.
await createContract({ ...input, idempotencyKey })
```

Also disable the submit button while the mutation is pending (`createMutation.isPending`).

- [ ] **Step 3: Test each path**

Write one Vitest per path in `lib/actions/__tests__/contract-create-dedupe-paths.test.ts`:

```ts
describe("contract-create dedupe across submit paths", () => {
  it.each([
    ["manual new-contract form"],
    ["AI extract review submit"],
    ["amendment extractor submit"],
    ["PDF drop-zone create"],
  ])("deduplicates double-submit from the %s flow (Charles iMessage 2026-04-20)", async (_path) => {
    const input = buildValidCreateInput()
    const key = crypto.randomUUID()
    const first = await createContract({ ...input, idempotencyKey: key })
    const second = await createContract({ ...input, idempotencyKey: key })
    expect(second.id).toBe(first.id)
    const count = await prisma.contract.count({ where: { id: first.id } })
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 4: Run + commit**

Run: `bunx vitest run lib/actions/__tests__/contract-create-dedupe-paths.test.ts`
Expected: PASS after Step 2 fixes.

```bash
git add components/contracts/ lib/actions/__tests__/contract-create-dedupe-paths.test.ts
git commit -m "fix(contracts): W1.Y-B idempotency key on every submit path"
```

---

### Task 3: DB-level soft-dedupe fallback

**Files:**
- Modify: `lib/actions/contracts.ts`

- [ ] **Step 1: Write test**

Append to the dedupe test file:

```ts
it("DB soft-dedupe: second create with same (facility,vendor,name,effectiveDate) inside 30s returns the first row", async () => {
  const input = buildValidCreateInput()
  const first = await createContract(input)
  // No idempotency key on the second call — simulates a different session.
  const second = await createContract(input)
  expect(second.id).toBe(first.id)
})
```

- [ ] **Step 2: Implement the server check**

In `lib/actions/contracts.ts` `createContract`, before the `prisma.contract.create`, run a lookup:

```ts
const recent = await prisma.contract.findFirst({
  where: {
    facilityId: input.facilityId,
    vendorId: input.vendorId,
    name: input.name,
    effectiveDate: input.effectiveDate,
    createdAt: { gte: new Date(Date.now() - 30_000) },
  },
})
if (recent) return serialize(recent)
```

- [ ] **Step 3: Run + commit**

```bash
git add lib/actions/contracts.ts lib/actions/__tests__/contract-create-dedupe-paths.test.ts
git commit -m "fix(contracts): W1.Y-B DB-level 30s soft-dedupe fallback"
```

---

### Task 4: Full verify

- [ ] **Step 1: Typecheck + tests**

Run: `bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: clean; all pass (skip the known pre-existing Playwright collection failures).

---

## Self-Review

- ✓ Diagnostic classifies duplicates by gap → client-vs-TTL root cause (Task 1)
- ✓ Every client submit path wired (Task 2)
- ✓ DB-level safety net covers path omissions (Task 3)
- ✓ Regression tests per path + DB fallback (Tasks 2, 3)
