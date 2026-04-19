# Contracts Page Follow-Ups Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each task ships independently.

**Goal:** Wire the props that round-1 + round-2 + v0-parity created but didn't connect, then close the remaining smaller v0 gaps.

**Architecture:** All UI-layer; no schema or core action changes. The components (SpecificItemsPicker, tie-in fields, RadarChart, scope column, export button) already exist or have a clear v0 reference — these tasks just connect them or render them.

**Working DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = `cmo4sbr8p0004wthl91ubwfwb`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `components/contracts/new-contract-client.tsx` line ~907 | Pass `contractType={form.watch("contractType")}` + `availableItems={pricingItems}` to `<ContractTermsEntry>` | 1 |
| `components/contracts/edit-contract-client.tsx` line ~200 | Same wiring | 1 |
| `components/facility/contracts/contract-terms-page-client.tsx` line ~194 | Same wiring (read `contract.contractType` + fetch pricing items) | 1 |
| `components/contracts/contract-columns.tsx` | Add a "Scope" column (Single / Multi-facility / Grouped / Shared) per v0 list page | 2 |
| `components/contracts/contracts-list-client.tsx` | Add a "Download CSV" button next to filters | 3 |
| `components/contracts/contract-export.ts` (new) | Pure CSV builder — `buildContractsCSV(contracts) => string` | 3 |
| `components/contracts/__tests__/contract-export.test.ts` | Unit tests for CSV builder | 3 |
| `components/contracts/contract-score-radar.tsx` (new) | Recharts `RadarChart` of the 6 score dimensions on the score page | 4 |
| `components/contracts/contract-score-client.tsx` (or facility/contracts/) | Render `<ContractScoreRadar/>` next to the existing band/components display | 4 |

---

## Task 1: Wire ContractTermsEntry props (specific items + tie-in)

**Why:** Bug 9 (SpecificItemsPicker) and Bug 10 (tie-in capital fields) shipped today but aren't visible to users — the 3 callers of `<ContractTermsEntry>` don't pass `contractType` or `availableItems`. Without these props, the picker shows the empty-state hint and tie-in fields stay hidden even on tie-in contracts.

**Files:**
- Modify: `components/contracts/new-contract-client.tsx` (~line 907)
- Modify: `components/contracts/edit-contract-client.tsx` (~line 200)
- Modify: `components/facility/contracts/contract-terms-page-client.tsx` (~line 194)

- [ ] **Step 1: new-contract-client.tsx**

```tsx
<ContractTermsEntry
  terms={terms}
  onChange={setTerms}
  availableCategories={liveCategories}
  contractType={form.watch("contractType")}
  availableItems={pricingItems.map((p) => ({
    vendorItemNo: p.vendorItemNo,
    description: p.itemDescription ?? p.description ?? null,
  }))}
/>
```

If the local state variable is named `aiPricingItems` or similar instead of `pricingItems`, use that. The picker will show its own empty-state when the list is empty.

- [ ] **Step 2: edit-contract-client.tsx**

```tsx
<ContractTermsEntry
  terms={terms}
  onChange={setTerms}
  contractType={contract?.contractType}
  availableItems={(contract?.pricing ?? []).map((p) => ({
    vendorItemNo: p.vendorItemNo,
    description: p.description ?? null,
  }))}
/>
```

If `contract.pricing` doesn't exist on the loaded shape, leave `availableItems` omitted (defaults to `[]` and shows empty state).

- [ ] **Step 3: contract-terms-page-client.tsx**

```tsx
<ContractTermsEntry
  terms={editTerms}
  onChange={setEditTerms}
  availableCategories={availableCategories}
  contractType={contract?.contractType}
  availableItems={(contract?.pricing ?? []).map((p) => ({
    vendorItemNo: p.vendorItemNo,
    description: p.description ?? null,
  }))}
/>
```

- [ ] **Step 4: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/new-contract-client.tsx components/contracts/edit-contract-client.tsx components/facility/contracts/contract-terms-page-client.tsx
git commit -m "fix(contract-terms): wire contractType + availableItems to all callers"
```

Skip `components/vendor/contracts/submission/contract-terms-card.tsx` — vendor portal is out of scope.

---

## Task 2: Scope column on contracts list

**Why:** v0 list table has a "Scope" column showing "Single", "Multi-facility", "Grouped", or "Shared". Tydei has the boolean fields (`isMultiFacility`, `isGrouped`, plus `contractFacilities[]` join) but no column.

**Files:** `components/contracts/contract-columns.tsx`

- [ ] **Step 1: Add the column**

After the Vendor column (or wherever fits), add:

```tsx
{
  accessorKey: "scope",
  header: "Scope",
  cell: ({ row }) => {
    const c = row.original
    const label = c.isGrouped
      ? "Grouped"
      : c.isMultiFacility
      ? "Multi-facility"
      : (c._count?.contractFacilities ?? 0) > 1
      ? "Shared"
      : "Single"
    const variant =
      label === "Grouped" || label === "Multi-facility"
        ? "default"
        : label === "Shared"
        ? "secondary"
        : "outline"
    return <Badge variant={variant}>{label}</Badge>
  },
},
```

If `_count.contractFacilities` isn't currently selected by `getContracts`, fall back to `(c.contractFacilities?.length ?? 0)` or simply omit the "Shared" case.

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-columns.tsx
git commit -m "feat(contracts-list): scope column showing Single/Multi/Grouped/Shared"
```

---

## Task 3: Download CSV button

**Why:** v0 list has an export icon in the filter bar. Tydei has none. Quick UX win — users want to pull contracts into Excel.

**Files:**
- Create: `components/contracts/contract-export.ts`
- Create: `components/contracts/__tests__/contract-export.test.ts`
- Modify: `components/contracts/contracts-list-client.tsx`

- [ ] **Step 1: Pure CSV builder + test**

```ts
// components/contracts/contract-export.ts
export interface ExportRow {
  name: string
  vendorName: string
  contractType: string
  status: string
  effectiveDate: string
  expirationDate: string
  totalValue: number
  spend: number
  rebateEarned: number
}

const HEADERS = [
  "Contract Name",
  "Vendor",
  "Type",
  "Status",
  "Effective Date",
  "Expiration Date",
  "Total Value",
  "Spend",
  "Rebate Earned",
]

function quote(v: string | number): string {
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildContractsCSV(rows: ExportRow[]): string {
  const lines = [HEADERS.join(",")]
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.vendorName,
        r.contractType.replace(/_/g, " "),
        r.status,
        r.effectiveDate,
        r.expirationDate,
        r.totalValue,
        r.spend,
        r.rebateEarned,
      ]
        .map(quote)
        .join(","),
    )
  }
  return lines.join("\n")
}
```

```ts
// components/contracts/__tests__/contract-export.test.ts
import { describe, it, expect } from "vitest"
import { buildContractsCSV } from "@/components/contracts/contract-export"

describe("buildContractsCSV", () => {
  it("emits a header row and one row per contract", () => {
    const csv = buildContractsCSV([
      {
        name: "Stryker Spine",
        vendorName: "Stryker",
        contractType: "usage",
        status: "active",
        effectiveDate: "2025-01-01",
        expirationDate: "2027-01-01",
        totalValue: 1_000_000,
        spend: 600_000,
        rebateEarned: 30_000,
      },
    ])
    const lines = csv.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("Contract Name")
    expect(lines[1]).toContain("Stryker Spine")
    expect(lines[1]).toContain("Stryker")
    expect(lines[1]).toContain("1000000")
  })

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = buildContractsCSV([
      {
        name: 'Acme, Corp.',
        vendorName: 'O"Brien',
        contractType: "usage",
        status: "active",
        effectiveDate: "2025-01-01",
        expirationDate: "2027-01-01",
        totalValue: 0,
        spend: 0,
        rebateEarned: 0,
      },
    ])
    const dataLine = csv.split("\n")[1]
    expect(dataLine.startsWith('"Acme, Corp."')).toBe(true)
    expect(dataLine).toContain('"O""Brien"')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL → implement → expect PASS**

```bash
bunx vitest run components/contracts/__tests__/contract-export.test.ts
```

- [ ] **Step 3: Wire button in list client**

In `components/contracts/contracts-list-client.tsx`, add a "Download" button next to the existing filter/sort actions:

```tsx
import { Download } from "lucide-react"
import { buildContractsCSV } from "./contract-export"
// ...
<Button
  variant="outline"
  size="sm"
  onClick={() => {
    const rows = filteredContracts.map((c) => ({
      name: c.name,
      vendorName: c.vendor.name,
      contractType: c.contractType,
      status: c.status,
      effectiveDate: new Date(c.effectiveDate).toISOString().slice(0, 10),
      expirationDate: new Date(c.expirationDate).toISOString().slice(0, 10),
      totalValue: Number(c.totalValue),
      spend: Number(metricsBatch[c.id]?.spend ?? 0),
      rebateEarned: Number(metricsBatch[c.id]?.rebate ?? 0),
    }))
    const csv = buildContractsCSV(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `contracts-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }}
>
  <Download className="mr-2 h-4 w-4" /> Download CSV
</Button>
```

- [ ] **Step 4: tsc + commit**

```bash
bunx vitest run components/contracts/__tests__/contract-export.test.ts
bunx tsc --noEmit
git add components/contracts/contract-export.ts components/contracts/__tests__/contract-export.test.ts components/contracts/contracts-list-client.tsx
git commit -m "feat(contracts-list): Download CSV button"
```

---

## Task 4: Score radar chart

**Why:** v0 score page has a 6-axis RadarChart of contract score dimensions (pricingCompetitiveness, rebateStructure, contractFlexibility, volumeAlignment, marketComparison, riskAssessment). Tydei score page lacks any visualization of these dimensions.

**Files:**
- Create: `components/contracts/contract-score-radar.tsx`
- Modify: `components/facility/contracts/contract-score-client.tsx` (or wherever the score page client lives)

- [ ] **Step 1: Find the existing score-component data**

```bash
grep -rn "ContractScoreResult\|components.*pricingCompetitiveness\|riskAssessment" lib/contracts/ | head -10
```

The pure scoring engine in `lib/contracts/scoring.ts` returns a `ContractScoreResult` with `components` map. Use those keys as the radar dimensions.

- [ ] **Step 2: Build the radar component**

```tsx
"use client"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"

interface Props {
  components: {
    pricing?: number
    rebate?: number
    flexibility?: number
    volume?: number
    market?: number
    risk?: number
  }
}

export function ContractScoreRadar({ components }: Props) {
  const data = [
    { dim: "Pricing", value: components.pricing ?? 0 },
    { dim: "Rebate", value: components.rebate ?? 0 },
    { dim: "Flexibility", value: components.flexibility ?? 0 },
    { dim: "Volume", value: components.volume ?? 0 },
    { dim: "Market", value: components.market ?? 0 },
    { dim: "Risk", value: components.risk ?? 0 },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Score by Dimension</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey="dim" />
            <PolarRadiusAxis domain={[0, 100]} />
            <Tooltip />
            <Radar
              dataKey="value"
              stroke="#10b981"
              fill="#10b981"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

If the scoring engine returns different key names than `pricing/rebate/flexibility/volume/market/risk`, adapt the prop shape and the data array. The actual dimension names in the engine win — match them.

- [ ] **Step 3: Render on the score page**

Find the score-page client (likely `components/facility/contracts/contract-score-client.tsx`). Insert `<ContractScoreRadar components={scoreResult.components} />` next to the existing band/score-number display. Use a 2-col grid if needed.

- [ ] **Step 4: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-score-radar.tsx components/facility/contracts/contract-score-client.tsx
git commit -m "feat(contract-score): radar chart for score dimensions"
```

---

## Task 5: Smoke + finalize

- [ ] **Step 1: Full unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

- [ ] **Step 2: Smoke contracts pages**

```bash
PORT=3002 bun run start &
sleep 6
curl -sL -c /tmp/c.txt -X POST http://localhost:3002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' > /dev/null
for p in /dashboard/contracts /dashboard/contracts/new; do
  code=$(curl -sL -b /tmp/c.txt -o /tmp/p.html -w "%{http_code}" "http://localhost:3002$p")
  err=$(grep -c '"digest"' /tmp/p.html 2>/dev/null)
  echo "$p HTTP=$code digest_errors=$err"
done
```

Expected: all 200, all `digest_errors=0`.

---

## Self-Review

| Task | Outcome |
|---|---|
| 1 | SpecificItemsPicker now visible when "Specific Items" picked; tie-in capital fields visible on tie-in contracts |
| 2 | Scope column on list shows Single / Multi-facility / Grouped / Shared |
| 3 | "Download CSV" button on list page exports the current filtered rows |
| 4 | Radar chart on contract score page visualizes 6 score dimensions |

**Type consistency:** `ExportRow` (Task 3) — name/vendorName/contractType/status/effectiveDate/expirationDate/totalValue/spend/rebateEarned. Used in builder + test + caller. `Props.components` (Task 4) — adapt keys to whatever `ContractScoreResult.components` actually exposes.
