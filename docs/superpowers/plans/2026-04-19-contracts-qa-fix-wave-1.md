# Contracts QA Fix Wave 1 — P0 Unblocks

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each task ships independently — dispatch in own worktree, review, cherry-pick.

**Goal:** Fix the 5 P0 bugs from `docs/superpowers/qa/2026-04-19-contracts-sweep.md` that block core user flows (AI scoring, term saves, PDF upload, document upload).

**Architecture:** Schema tightening (drop unsupported JSON-Schema keywords from Zod), action destructuring fixes, missing server action + UI wiring. No new schemas, no new engines.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript strict, Vitest, Vercel AI SDK, Anthropic.

**DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = `cmo4sbr8p0004wthl91ubwfwb`.

**Source:** QA report `docs/superpowers/qa/2026-04-19-contracts-sweep.md` — bugs score-1, terms-1, terms-2, new-1, detail-3.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/ai/schemas.ts` | Drop `.min()/.max()` from every numeric in `dealScoreSchema` + `richContractExtractSchema`; reduce nullable/union count in `richContractExtractSchema` below 16 | 1, 3 |
| `app/api/ai/score-deal/route.ts` | Clamp returned score values server-side to 0-100 since Zod bounds no longer enforce | 1 |
| `lib/ai/__tests__/schemas.test.ts` | Assert schemas no longer use `.min/.max` on numeric fields (guard regression) | 1, 3 |
| `lib/actions/contract-terms.ts` | Destructure `scopedCategoryId/Ids` + `scopedItemNumbers` out of create AND update payloads; persist `scopedItemNumbers` via `ContractTermProduct` join; write `scopedCategoryIds` onto `categories: string[]` column | 2 |
| `lib/actions/__tests__/contract-terms-save.test.ts` | Regression: create + update with scope fields succeeds (no PrismaClientValidationError) | 2 |
| `lib/actions/contracts/documents.ts` (new) | `createContractDocument` server action | 4 |
| `components/contracts/contract-detail-client.tsx` | Wire `<DocumentUpload>` dialog into facility Documents tab via `onUpload` callback | 4 |
| `lib/actions/__tests__/contract-documents.test.ts` | Regression: facility-scoped create works, owner check rejects foreign facilities | 4 |

---

## Task 1: Unblock AI scoring (score-1)

**Spec:** `score-1` P0. `dealScoreSchema` uses Zod `.min(0).max(100)`; Anthropic Messages API rejects JSON-Schema `minimum/maximum` on number types with `status 400`. Every call to `/api/ai/score-deal` returns 500, and the client shows a full-page error that hides the rule-based radar too.

**Files:**
- Modify: `lib/ai/schemas.ts` (the `dealScoreSchema` block — find via `grep -n dealScoreSchema`)
- Modify: `app/api/ai/score-deal/route.ts` (post-response clamp)
- Create: `lib/ai/__tests__/schemas.test.ts`

- [ ] **Step 1: Write the failing schema-shape test**

```ts
// lib/ai/__tests__/schemas.test.ts
import { describe, it, expect } from "vitest"
import { dealScoreSchema } from "@/lib/ai/schemas"

/** Anthropic's Messages API rejects JSON Schema `minimum`/`maximum` on `number`
 * types. Zod .min().max() on numbers compile to those keywords via the AI SDK.
 * Guard the schema by asserting no numeric leaf has min/max constraints. */
describe("dealScoreSchema — Anthropic compatibility", () => {
  it("has no min/max constraints on numeric fields", () => {
    const json = JSON.stringify(dealScoreSchema._def, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    )
    // Zod serializes number checks as { kind: "min", value: N } and
    // { kind: "max", value: N } in _def.checks. If any numeric field
    // has these, the schema will fail against Anthropic.
    expect(json).not.toMatch(/"kind":"min"/)
    expect(json).not.toMatch(/"kind":"max"/)
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/ai/__tests__/schemas.test.ts
```

Expected: FAIL — existing schema has `.min(0).max(100)` on all score fields.

- [ ] **Step 3: Strip `.min()/.max()` from dealScoreSchema**

Open `lib/ai/schemas.ts`. Find every field on `dealScoreSchema` that looks like:

```ts
financialValue: z.number().min(0).max(100).describe("..."),
```

Replace with:

```ts
financialValue: z.number().describe("Score 0-100. ..."),
```

Embed the `0-100` guidance in the `.describe()` text so the model still aims for the right range. Do this for every `z.number().min(0).max(100)` and `z.number().min(0).max(N)` variant on `dealScoreSchema` (typically: financialValue, rebateEfficiency, commitmentRisk, priceLeverage, contractFlexibility, overallScore, plus any sub-scores).

- [ ] **Step 4: Run test, expect PASS**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/ai/__tests__/schemas.test.ts
```

- [ ] **Step 5: Server-side clamp**

Now the Zod schema no longer enforces 0-100. Add a clamp in the route so bad model output doesn't leak.

In `app/api/ai/score-deal/route.ts`, find the block where `generateText`/`generateObject` returns the parsed score (likely `const result = await generateText({ ... })` followed by `result.object` or similar). Right before returning to the client, clamp:

```ts
function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))
}

// Assuming `score` is the parsed dealScoreSchema result:
const clamped = {
  ...score,
  financialValue: clamp01to100(score.financialValue),
  rebateEfficiency: clamp01to100(score.rebateEfficiency),
  commitmentRisk: clamp01to100(score.commitmentRisk),
  priceLeverage: clamp01to100(score.priceLeverage),
  contractFlexibility: clamp01to100(score.contractFlexibility),
  overallScore: clamp01to100(score.overallScore),
}
return NextResponse.json(clamped)
```

Adjust the field list to match whatever keys `dealScoreSchema` actually has — read the schema to be sure. Apply clamp to every numeric key.

- [ ] **Step 6: Also surface underlying error in non-production**

Still in `app/api/ai/score-deal/route.ts`, find the catch block (around line 60-63 per QA report) that returns `{error: "Scoring failed"}`. Update:

```ts
} catch (err) {
  console.error("Deal scoring error:", err)
  const message = err instanceof Error ? err.message : "Unknown error"
  return NextResponse.json(
    {
      error: "Scoring failed",
      details: process.env.NODE_ENV === "production" ? undefined : message,
    },
    { status: 500 },
  )
}
```

- [ ] **Step 7: Smoke against live server**

```bash
# Assumes bun run dev is already up on :3000 per prior QA session
curl -s -c /tmp/c.txt -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' > /dev/null
CID=$(DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun -e 'import{prisma}from "/Users/vickkumar/code/tydei-next/lib/db";const c=await prisma.contract.findFirst({where:{facilityId:"cmo4sbr8p0004wthl91ubwfwb",status:"active"}});console.log(c!.id);process.exit(0)')
curl -s -b /tmp/c.txt -X POST http://localhost:3000/api/ai/score-deal \
  -H "Content-Type: application/json" \
  -d "{\"contractId\":\"$CID\"}" -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 200 with populated score JSON. (If still 500, inspect response body — the error details will show what Anthropic is rejecting now.)

- [ ] **Step 8: Commit**

```bash
git add lib/ai/schemas.ts app/api/ai/score-deal/route.ts lib/ai/__tests__/schemas.test.ts
git commit -m "fix(ai-scoring): drop Zod .min/.max from dealScoreSchema (Anthropic 400)"
```

---

## Task 2: Unblock term save (terms-1 + terms-2)

**Spec:** `terms-1` + `terms-2` P0. `createContractTerm` destructures `{tiers, scopedItemNumbers, ...termData}` and passes `termData` into `prisma.contractTerm.create.data` — but `termData` still contains `scopedCategoryId` + `scopedCategoryIds`, neither of which are `ContractTerm` columns. Prisma rejects. `updateContractTerm` has the same bug plus also leaves `scopedItemNumbers` in `termData`. Every category/item-scoped term save throws.

**Files:**
- Modify: `lib/actions/contract-terms.ts` — both `createContractTerm` and `updateContractTerm`
- Create: `lib/actions/__tests__/contract-terms-save.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/actions/__tests__/contract-terms-save.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const createMock = vi.fn()
const updateMock = vi.fn()
const createManyProductMock = vi.fn()
const deleteManyProductMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    contractTerm: { create: createMock, update: updateMock },
    contractTermProduct: {
      createMany: createManyProductMock,
      deleteMany: deleteManyProductMock,
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import {
  createContractTerm,
  updateContractTerm,
} from "@/lib/actions/contract-terms"

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({
    id: "term-1",
    tiers: [],
  })
  updateMock.mockResolvedValue({
    id: "term-1",
    tiers: [],
  })
  createManyProductMock.mockResolvedValue({ count: 0 })
  deleteManyProductMock.mockResolvedValue({ count: 0 })
})

describe("createContractTerm — scope-field destructuring", () => {
  it("does not pass scopedCategoryId into prisma.contractTerm.create", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Test",
      termType: "spend_rebate",
      baselineType: "spend_based",
      rebateMethod: "cumulative",
      appliesTo: "specific_category",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      scopedCategoryId: "cat-1",
      scopedCategoryIds: ["cat-1", "cat-2"],
      scopedItemNumbers: ["STK-1", "STK-2"],
      tiers: [],
    })
    const callData = createMock.mock.calls[0][0].data
    expect(callData.scopedCategoryId).toBeUndefined()
    expect(callData.scopedCategoryIds).toBeUndefined()
    expect(callData.scopedItemNumbers).toBeUndefined()
  })

  it("writes scopedCategoryIds into the categories column", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Test",
      termType: "spend_rebate",
      baselineType: "spend_based",
      rebateMethod: "cumulative",
      appliesTo: "specific_category",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      scopedCategoryIds: ["cat-1", "cat-2"],
      tiers: [],
    })
    const callData = createMock.mock.calls[0][0].data
    expect(callData.categories).toEqual(["cat-1", "cat-2"])
  })

  it("writes scopedItemNumbers as ContractTermProduct rows", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Test",
      termType: "spend_rebate",
      baselineType: "spend_based",
      rebateMethod: "cumulative",
      appliesTo: "specific_items",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      scopedItemNumbers: ["STK-1", "STK-2"],
      tiers: [],
    })
    expect(createManyProductMock).toHaveBeenCalledWith({
      data: [
        { termId: "term-1", vendorItemNo: "STK-1" },
        { termId: "term-1", vendorItemNo: "STK-2" },
      ],
      skipDuplicates: true,
    })
  })
})

describe("updateContractTerm — scope-field destructuring", () => {
  it("does not pass scopedCategoryId into prisma.contractTerm.update", async () => {
    await updateContractTerm("term-1", {
      scopedCategoryId: "cat-1",
      scopedCategoryIds: ["cat-1"],
      scopedItemNumbers: ["STK-1"],
    })
    const callData = updateMock.mock.calls[0][0].data
    expect(callData.scopedCategoryId).toBeUndefined()
    expect(callData.scopedCategoryIds).toBeUndefined()
    expect(callData.scopedItemNumbers).toBeUndefined()
  })

  it("replaces ContractTermProduct rows (deleteMany + createMany)", async () => {
    await updateContractTerm("term-1", {
      scopedItemNumbers: ["STK-NEW"],
    })
    expect(deleteManyProductMock).toHaveBeenCalledWith({
      where: { termId: "term-1" },
    })
    expect(createManyProductMock).toHaveBeenCalledWith({
      data: [{ termId: "term-1", vendorItemNo: "STK-NEW" }],
      skipDuplicates: true,
    })
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/contract-terms-save.test.ts
```

- [ ] **Step 3: Fix `createContractTerm`**

Open `lib/actions/contract-terms.ts`. Find the `createContractTerm` function (around line 31). The current destructure is:

```ts
const { tiers, scopedItemNumbers, ...termData } = data
```

Replace with:

```ts
const {
  tiers,
  scopedItemNumbers,
  scopedCategoryId,
  scopedCategoryIds,
  ...termData
} = data

// scopedCategoryIds maps to the ContractTerm.categories String[] column
// (already consumed by lib/rebates/from-prisma.ts::buildConfigFromPrismaTerm).
// Include it on the term itself when provided.
if (scopedCategoryIds && scopedCategoryIds.length > 0) {
  ;(termData as { categories?: string[] }).categories = scopedCategoryIds
}
```

`scopedCategoryId` (singular) is intentionally dropped — it's back-compat only and has no DB column.

- [ ] **Step 4: Fix `updateContractTerm`**

In the same file, find `updateContractTerm` (around line 67). Change its destructure from:

```ts
const { tiers, ...updateData } = data
```

to:

```ts
const {
  tiers,
  scopedItemNumbers,
  scopedCategoryId,
  scopedCategoryIds,
  ...updateData
} = data

if (scopedCategoryIds !== undefined) {
  ;(updateData as { categories?: string[] }).categories = scopedCategoryIds
}
```

After the existing `prisma.contractTerm.update(...)` call, add:

```ts
// Replace ContractTermProduct join rows when scopedItemNumbers is provided
// (undefined = don't touch; [] = clear; non-empty = replace).
if (scopedItemNumbers !== undefined) {
  await prisma.contractTermProduct.deleteMany({ where: { termId: id } })
  if (scopedItemNumbers.length > 0) {
    await prisma.contractTermProduct.createMany({
      data: scopedItemNumbers.map((vendorItemNo) => ({
        termId: id,
        vendorItemNo,
      })),
      skipDuplicates: true,
    })
  }
}
```

- [ ] **Step 5: Run test, expect PASS**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/contract-terms-save.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Verify tsc + adjacent tests**

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/contract-terms
```

- [ ] **Step 7: Commit**

```bash
git add lib/actions/contract-terms.ts lib/actions/__tests__/contract-terms-save.test.ts
git commit -m "fix(contract-terms): destructure scope fields out of Prisma payloads"
```

---

## Task 3: Unblock PDF upload (new-1)

**Spec:** `new-1` P0. `richContractExtractSchema` has ~70 nullable/optional/union fields. Anthropic rejects tool-input schemas with >16 unions. Every PDF upload to `/api/ai/extract-contract` returns 502 with raw SDK error leaked to UI.

**Decision:** the minimum fix is to route PDF extraction through the existing `extractedContractSchema` (which is simpler and already works on the text path). The rich schema stays available for callers who want the deeper shape, but the PDF path no longer uses it.

**Files:**
- Modify: `app/api/ai/extract-contract/route.ts` — switch PDF path from `richContractExtractSchema` to `extractedContractSchema`; drop the legacy-mapper wrapping since the shape is already legacy-native
- Modify: `lib/ai/__tests__/schemas.test.ts` (created in Task 1) — add an assertion that `extractedContractSchema` has ≤ 16 unioned fields

- [ ] **Step 1: Extend the schema test**

Add to `lib/ai/__tests__/schemas.test.ts`:

```ts
import { extractedContractSchema, richContractExtractSchema } from "@/lib/ai/schemas"

function countUnionLeaves(def: unknown): number {
  const seen = new Set<unknown>()
  let count = 0
  function walk(node: unknown) {
    if (!node || typeof node !== "object" || seen.has(node)) return
    seen.add(node)
    const obj = node as Record<string, unknown>
    // Zod "optional" / "nullable" / "union" types each compile to a union
    // in JSON Schema.
    if (
      obj.typeName === "ZodOptional" ||
      obj.typeName === "ZodNullable" ||
      obj.typeName === "ZodUnion"
    ) {
      count += 1
    }
    for (const v of Object.values(obj)) walk(v)
  }
  walk(def)
  return count
}

describe("extract schemas — Anthropic tool-input compatibility", () => {
  it("extractedContractSchema has at most 16 union-typed leaves", () => {
    expect(countUnionLeaves(extractedContractSchema._def)).toBeLessThanOrEqual(16)
  })
})
```

(This test lets the rich schema stay over-limit for now — we're intentionally routing PDF through the simpler schema.)

- [ ] **Step 2: Run test, confirm `extractedContractSchema` is under-16**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/ai/__tests__/schemas.test.ts
```

If `extractedContractSchema` also trips the limit, the fix has to go further (split the schema or drop some fields). Expected: PASS.

- [ ] **Step 3: Swap PDF path to `extractedContractSchema`**

Open `app/api/ai/extract-contract/route.ts`. Find the PDF block (around line 185-209 per QA report). It currently reads:

```ts
const result = await generateText({
  model: claudeModel,
  output: Output.object({ schema: richContractExtractSchema }),
  messages: [/* ...with file block... */],
})
let rich: RichContractExtractData | undefined
try { rich = result.output }
catch { /* fallback parse */ }
// then: const legacy = toLegacyExtractedContract(rich)
```

Replace with:

```ts
const result = await generateText({
  model: claudeModel,
  output: Output.object({ schema: extractedContractSchema }),
  messages: [/* ...same file block... */],
})
let extracted: ExtractedContractData | undefined
try {
  extracted = result.output
} catch {
  const rawText = result.text ?? ""
  extracted = tryParseLegacy(rawText)
}

if (!extracted) {
  return Response.json(
    {
      error: "Could not parse AI response",
      details:
        "The model returned a response that did not match the expected contract schema. Try uploading again or use Manual Entry.",
      s3Key,
    },
    { status: 502 },
  )
}

return Response.json({
  success: true,
  extracted,
  confidence: 0.9, // legacy schema is simpler — high confidence when it parses
  s3Key,
})
```

Update the file's imports: remove `richContractExtractSchema` and `toLegacyExtractedContract` if they're no longer referenced elsewhere in this file (check the text path at the top of the route — it already uses `extractedContractSchema`, so these may still be imported there; leave them if so).

- [ ] **Step 4: Run tests + tsc**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/ai/__tests__/schemas.test.ts
bunx tsc --noEmit
```

- [ ] **Step 5: Smoke with a real PDF**

```bash
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000053 00000 n \ntrailer<</Size 3/Root 1 0 R>>\nstartxref\n90\n%%EOF\n' > /tmp/test.pdf
curl -s -c /tmp/c.txt -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' > /dev/null
curl -s -b /tmp/c.txt -X POST http://localhost:3000/api/ai/extract-contract \
  -F "file=@/tmp/test.pdf;type=application/pdf" -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 200 (or 502 with a *different* error — the "too many unions" should be gone).

- [ ] **Step 6: Commit**

```bash
git add app/api/ai/extract-contract/route.ts lib/ai/__tests__/schemas.test.ts
git commit -m "fix(contracts-new): route PDF extract through simpler schema (Anthropic union limit)"
```

---

## Task 4: Wire document upload on facility detail page (detail-3)

**Spec:** `detail-3` P0. `DocumentUpload` component exists and works. Vendor portal passes `onUpload` into `ContractDocumentsList`. Facility portal doesn't. Also no `createContractDocument` server action exists — needs to be created.

**Files:**
- Create: `lib/actions/contracts/documents.ts` — `createContractDocument` action
- Create: `lib/actions/__tests__/contract-documents.test.ts` — regression
- Modify: `components/contracts/contract-detail-client.tsx` — wire `onUpload` + dialog state

- [ ] **Step 1: Write the failing action test**

```ts
// lib/actions/__tests__/contract-documents.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const findUniqueOrThrowMock = vi.fn()
const createMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: findUniqueOrThrowMock },
    contractDocument: { create: createMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))

import { createContractDocument } from "@/lib/actions/contracts/documents"

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
  createMock.mockResolvedValue({
    id: "doc-1",
    contractId: "c-1",
    name: "Amendment A.pdf",
    url: "https://example.com/doc-1",
    type: "amendment",
    uploadDate: new Date("2026-04-19"),
  })
})

describe("createContractDocument", () => {
  it("creates a document row owned by the current facility's contract", async () => {
    const result = await createContractDocument({
      contractId: "c-1",
      name: "Amendment A.pdf",
      url: "https://example.com/doc-1",
      type: "amendment",
    })
    expect(findUniqueOrThrowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "c-1", facilityId: "fac-1" }),
      }),
    )
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractId: "c-1",
          name: "Amendment A.pdf",
          url: "https://example.com/doc-1",
          type: "amendment",
        }),
      }),
    )
    expect(result.id).toBe("doc-1")
  })

  it("rejects when contract belongs to a different facility", async () => {
    findUniqueOrThrowMock.mockRejectedValue(new Error("No Contract found"))
    await expect(
      createContractDocument({
        contractId: "c-other",
        name: "x.pdf",
        url: "https://example.com/x",
        type: "amendment",
      }),
    ).rejects.toThrow()
    expect(createMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/contract-documents.test.ts
```

Expected: FAIL — `createContractDocument` doesn't exist yet.

- [ ] **Step 3: Implement the action**

```ts
// lib/actions/contracts/documents.ts
"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { revalidatePath } from "next/cache"

export interface CreateContractDocumentInput {
  contractId: string
  name: string
  url: string
  type?: string
  effectiveDate?: string | null
  size?: number | null
}

export async function createContractDocument(
  input: CreateContractDocumentInput,
) {
  const { facility, user } = await requireFacility()

  // Ownership gate — throws if the contract isn't on this facility.
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })

  const doc = await prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      url: input.url,
      type: input.type ?? "other",
      effectiveDate: input.effectiveDate
        ? new Date(input.effectiveDate)
        : null,
      size: input.size ?? null,
    },
  })

  await logAudit({
    userId: user.id,
    action: "contract.document_uploaded",
    entityType: "contract_document",
    entityId: doc.id,
    metadata: { contractId: input.contractId, name: input.name, type: doc.type },
  })

  revalidatePath(`/dashboard/contracts/${input.contractId}`)

  return serialize(doc)
}
```

Check `prisma/schema.prisma model ContractDocument` for the actual column list — if `effectiveDate` / `size` / `type` don't exist or have different names, adapt. The action's *public* shape should still accept the input above; the Prisma `data` block adjusts internally.

- [ ] **Step 4: Run test, expect PASS**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/contract-documents.test.ts
```

- [ ] **Step 5: Wire into detail client**

Open `components/contracts/contract-detail-client.tsx`. At the top, add imports:

```tsx
import { useState } from "react"  // likely already imported
import { DocumentUpload } from "@/components/contracts/document-upload"
import { createContractDocument } from "@/lib/actions/contracts/documents"
```

Add state + callbacks inside the component:

```tsx
const [docDialogOpen, setDocDialogOpen] = useState(false)

async function handleDocUploaded(params: {
  name: string
  url: string
  type?: string
  size?: number
}) {
  await createContractDocument({
    contractId,
    name: params.name,
    url: params.url,
    type: params.type,
    size: params.size,
  })
  queryClient.invalidateQueries({ queryKey: queryKeys.contracts.detail(contractId) })
  toast.success("Document uploaded")
  setDocDialogOpen(false)
}
```

Then find the `<ContractDocumentsList documents={contract.documents} contractId={contractId} />` call (around line 620 per QA report). Change to:

```tsx
<ContractDocumentsList
  documents={contract.documents}
  contractId={contractId}
  onUpload={() => setDocDialogOpen(true)}
/>
<DocumentUpload
  contractId={contractId}
  open={docDialogOpen}
  onOpenChange={setDocDialogOpen}
  onUploaded={handleDocUploaded}
/>
```

Verify that `DocumentUpload`'s `onUploaded` callback matches the signature above. If it differs, adapt `handleDocUploaded` to the component's real prop shape. Check the vendor portal's wiring (`app/vendor/contracts/[id]/vendor-contract-detail-client.tsx:47` per QA report) for reference.

- [ ] **Step 6: tsc + smoke**

```bash
bunx tsc --noEmit
# Optional: load /dashboard/contracts/<id>, click Documents tab, verify "Upload" button renders
```

- [ ] **Step 7: Commit**

```bash
git add lib/actions/contracts/documents.ts lib/actions/__tests__/contract-documents.test.ts components/contracts/contract-detail-client.tsx
git commit -m "feat(contract-detail): wire document upload on facility Documents tab"
```

---

## Task 5: Smoke + finalize

- [ ] **Step 1: Full unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

Expected: all unit tests pass. 7 pre-existing Playwright-style files may still fail — that's fine.

- [ ] **Step 2: tsc**

```bash
bunx tsc --noEmit 2>&1 | tail -3
```

- [ ] **Step 3: Smoke the 4 affected flows**

1. **Score page** — load `/dashboard/contracts/<id>/score` as demo facility → AI score populates instead of "Scoring Failed" card.
2. **Term save** — edit any term with a specific-category or specific-items scope → Save → refresh → scope fields persisted.
3. **PDF upload** — upload a small PDF via `/dashboard/contracts/new` PDF tab → extraction returns populated fields (or a meaningful error that isn't "too many unions").
4. **Doc upload** — visit a contract's Documents tab → click Upload button → upload a PDF → doc appears in the list.

- [ ] **Step 4: Push** (already done per-task; this is a sanity check)

```bash
git push origin main
```

---

## Self-Review

| QA bug | Task |
|---|---|
| score-1 (P0) | Task 1 |
| terms-1 (P0) | Task 2 |
| terms-2 (P0) | Task 2 |
| new-1 (P0) | Task 3 |
| detail-3 (P0) | Task 4 |

**Type consistency:** `CreateContractDocumentInput` (Task 4) is defined once and used by both the action and the test. `dealScoreSchema` field list (Task 1) is consumed by both the schema regression test and the route's clamp. Scope-field names (`scopedCategoryId`, `scopedCategoryIds`, `scopedItemNumbers`) are identical across validator (already shipped), action, and tests.

**Placeholder scan:** every step has runnable code or a runnable command. No "add appropriate error handling" — error returns are spelled out (Task 3 Step 3 shows the 502 payload verbatim).

**Scope:** each task is independent. Task 1 touches AI scoring only; Task 2 touches term persistence only; Task 3 touches the PDF route only; Task 4 touches the detail page + documents only. No cross-task file conflicts if dispatched in parallel subagents.
