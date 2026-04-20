# Charles W1.Y-A — Contract edit save regression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the edit-contract flow so user-changed fields persist on save. W1.W-E (commit `19b38ab`) only addressed contractType flips + new terms; other field domains still revert to "beginning only" values on reload.

**Architecture:** Diagnostic-first. Instrument the edit action, reproduce Charles's path, identify which field category drops, fix that path. Add a regression test that edits every field domain in one contract and reloads.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1y-a-edit-save-regression-design.md`

---

### Task 1: Diagnostic — find which fields drop

**Files:**
- Create: `scripts/diagnose-edit-save-regression.ts`
- Create: `docs/superpowers/diagnostics/2026-04-20-w1y-a-edit-save.md`

- [ ] **Step 1: Read the current update path**

Open `lib/actions/contracts.ts`. Find the update server action (likely `updateContract` or similar). Also open `components/contracts/edit-contract-client.tsx` and `components/contracts/contract-form.tsx`. Note the full field set the form renders vs the fields the update action accepts.

- [ ] **Step 2: Write the diagnostic script**

```ts
// scripts/diagnose-edit-save-regression.ts
// Usage: bun scripts/diagnose-edit-save-regression.ts <contractId>

import { prisma } from "@/lib/db"

async function main() {
  const contractId = process.argv[2]
  if (!contractId) throw new Error("Usage: bun scripts/... <contractId>")

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { terms: { include: { tiers: true } } },
  })

  console.log("# Edit-save diagnostic\n")
  console.log("## Contract scalar fields\n")
  const scalars: Record<string, unknown> = { ...contract }
  delete scalars.terms
  console.log("```json")
  console.log(JSON.stringify(scalars, null, 2))
  console.log("```\n")

  console.log("## Terms + tiers\n")
  console.log("```json")
  console.log(JSON.stringify(contract.terms, null, 2))
  console.log("```\n")

  console.log("## Update-action field catalog\n")
  console.log("Scalar fields on Contract: " + Object.keys(scalars).join(", "))
  console.log("Term scalar fields: " + (contract.terms[0] ? Object.keys(contract.terms[0]).filter(k => k !== "tiers").join(", ") : "(no terms)"))

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Run + capture**

```bash
bun scripts/diagnose-edit-save-regression.ts <contractId> > docs/superpowers/diagnostics/2026-04-20-w1y-a-edit-save.md
```

If you don't have a specific contract id, use the first tie-in or usage contract on facility `cmo4sbr8p0004wthl91ubwfwb` (the demo facility).

- [ ] **Step 4: Read the update action + compare field sets**

Open `lib/actions/contracts.ts` update action. List every field the action's Zod schema accepts and the Prisma `update` `data` includes. Compare against the contract's scalar + term + tier field set from the diagnostic. Any field on the contract NOT in the update path is a suspect.

Append findings to the diagnostic file under `## Suspected drop set`.

- [ ] **Step 5: Commit**

```bash
git add scripts/diagnose-edit-save-regression.ts docs/superpowers/diagnostics/2026-04-20-w1y-a-edit-save.md
git commit -m "docs(diagnostic): W1.Y-A edit-save regression field catalog"
```

---

### Task 2: Regression test (Charles-pattern)

**Files:**
- Create: `lib/actions/__tests__/contract-edit-save-regression.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/db"
import { updateContract } from "@/lib/actions/contracts"
import { seedEditableContract } from "@/tests/helpers/contract-fixtures"

describe("contract edit save persists every field domain", () => {
  it("persists every field domain on a contract edit (Charles iMessage 2026-04-20)", async () => {
    const { contractId } = await seedEditableContract()
    // Change one field in each domain: scalar, term scalar, tier, category, amortization, capital.
    await updateContract({
      id: contractId,
      name: "EDITED-NAME",
      // Term edits
      terms: [{
        id: "<the first term id>",
        evaluationPeriod: "quarterly",       // was annual
        paymentCadence: "quarterly",         // was annual
        tiers: [{
          tierNumber: 1,
          spendMin: 999_999,                 // was 100_000
          rebateValue: 0.07,                 // was 0.05
          rebateType: "percent_of_spend",
        }],
      }],
      // Scalar fields
      capitalAmount: 500_000,
      capitalMonths: 60,
      minAnnualPurchase: 250_000,
      effectiveDate: new Date("2025-01-01"),
    })

    const after = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { terms: { include: { tiers: true } } },
    })

    expect(after.name).toBe("EDITED-NAME")
    expect(after.terms[0].evaluationPeriod).toBe("quarterly")
    expect(after.terms[0].paymentCadence).toBe("quarterly")
    expect(Number(after.terms[0].tiers[0].spendMin)).toBe(999_999)
    expect(Number(after.terms[0].tiers[0].rebateValue)).toBe(0.07)
    expect(Number(after.capitalAmount)).toBe(500_000)
    expect(after.capitalMonths).toBe(60)
    expect(Number(after.minAnnualPurchase)).toBe(250_000)
    expect(after.effectiveDate.toISOString().slice(0, 10)).toBe("2025-01-01")
  })
})
```

If `seedEditableContract` helper doesn't exist, inline it — seed a Contract with the "beginning" values matching the assertions' "was …" comments.

If the actual field name differs (e.g., `capitalAmount` lives on `ContractTerm` not `Contract`), adjust accordingly.

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run lib/actions/__tests__/contract-edit-save-regression.test.ts`
Expected: at least one assertion fails — the field that drops on save.

- [ ] **Step 3: Commit the failing test**

```bash
git add lib/actions/__tests__/contract-edit-save-regression.test.ts tests/helpers/contract-fixtures.ts
git commit -m "test(contracts): W1.Y-A failing edit-save parity test"
```

---

### Task 3: Fix gated on diagnostic

**Files (depending on diagnostic):**
- Modify: `lib/actions/contracts.ts`
- Modify: `lib/validators/contracts.ts`
- Modify: `components/contracts/edit-contract-client.tsx`
- Modify: `components/contracts/contract-form.tsx`

- [ ] **Step 1: Identify the root cause**

From Task 1's diagnostic, the update-action field catalog comparison identified which field(s) drop. Pick the most likely of these three shapes:

- **Form serializer drops fields.** Fix: change the form's submit handler to send the full dirty form state. In `contract-form.tsx` or `edit-contract-client.tsx` find the `onSubmit` builder; ensure every field the form renders is included in the payload. Common bug: spreading `formState.values` but ignoring `formState.dirtyFields`, or only sending fields whose inputs have been touched.

- **Server schema strips fields.** Fix: broaden the update-action Zod schema in `lib/validators/contracts.ts` to accept every field the contract has that's user-editable. Typical miss: tie-in capital fields (added late in W1.T) or `minAnnualPurchase` (new in W1.Y-D).

- **Server picks subset into Prisma data.** Fix: the update action reads the validated input but constructs a narrow `data` object. Add the dropped fields to the Prisma `update({ data: { ... } })` call.

- [ ] **Step 2: Implement the fix**

Make the minimum change that routes the dropped field from client → validator → server → Prisma. Do not refactor unrelated code.

- [ ] **Step 3: Run test — expect PASS**

Run: `bunx vitest run lib/actions/__tests__/contract-edit-save-regression.test.ts`
Expected: all assertions PASS.

- [ ] **Step 4: Typecheck + broader tests**

Run: `bunx tsc --noEmit && bunx vitest run lib/actions/__tests__/ lib/validators/__tests__/`
Expected: clean; all pass.

- [ ] **Step 5: Commit**

```bash
git add <files-touched>
git commit -m "fix(contracts): W1.Y-A persist every field domain on edit save

W1.W-E's edit-save fix covered contractType flips + new terms but
<FIELD DOMAIN IDENTIFIED BY DIAGNOSTIC> still dropped on reload
because <ROOT CAUSE>. Fix: <SHORT-FIX-DESCRIPTION>. Regression
test covers scalar + term + tier + category + amortization + capital
edits in one pass."
```

Replace the placeholders with the actual cause the diagnostic surfaced.

---

### Task 4: Full verify

- [ ] **Step 1: Typecheck + tests**

Run: `bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: clean; all pass (ignore the 7 pre-existing Playwright-in-Vitest errors under `tests/workflows/`).

- [ ] **Step 2: Commit hygiene** — none expected unless Task 3 spawned extra edits.

---

## Self-Review

- ✓ Diagnostic captures actual field drop (Task 1)
- ✓ Failing test locks the bug (Task 2)
- ✓ Diagnostic-driven fix (Task 3)
- ✓ Broad regression test covers every field domain Charles might hit (Task 2 — scalar, term, tier, capital, amortization, date)
