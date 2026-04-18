# AI Agent Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18) via batch approval
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Required dependency: `2026-04-18-ai-integration-foundation.md` (context pack, structured outputs, prompt caching, error handling, review UI primitives; also retires the 984-line `ai-agent-client.tsx` via subsystem 5)
- Required dependency: `2026-04-18-contracts-rewrite.md` (contract calc engines that the AI agent queries)
- Required dependency: `2026-04-18-cog-data-rewrite.md` (COG aggregation the AI agent queries)

**Goal:** Rewrite `/dashboard/ai-agent` as a **three-tab page**:
1. **Chat** — streaming LLM chat (already wired to Claude via `@ai-sdk/anthropic`; extend with context-pack-backed tools)
2. **Document Search** — indexed contract document search (new; uses embedding-based retrieval)
3. **Report Generator** — natural-language structured-report creation

Extends the AI foundation primitives to cover agent-style workflows while staying faithful to the pure-advisory rule (nothing mutates state without user confirmation).

**Architecture:** Server actions on `/api/ai-agent` route use `@ai-sdk/anthropic` `streamText` with tool definitions that wrap the contracts-rewrite / COG engines. Document search builds an embedding index over uploaded contract PDFs (the contracts-rewrite pipeline already stores them). Report generator constructs a context pack + calls Claude with structured output for typed `GeneratedReport`.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, `@ai-sdk/anthropic`, `@ai-sdk/react`, `ai`, Zod, shadcn/ui. Reuses contracts-rewrite engines + COG enrichment + audit log.

---

## 1. Scope

### In scope

- **Chat tab** — streaming chat with tool calls into contract / COG / case-costing / alert data. Advisory-only (no state changes from chat). Preserves session history client-side only (no Memory tool).
- **Tools exposed to the chat model:**
  - `getContractPerformance(contractId?)`
  - `getMarketShareAnalysis(category?)`
  - `getSurgeonPerformance(surgeonName?)`
  - `getAlertsSummary(status?)`
  - `calculateProspectiveRebate(annualSpend, rebateRate, contractYears, growthRate?)` (already exists in `lib/ai/tools.ts`)
  - `calculateRebateOpportunities(facilityId)` (new; wraps rebate-optimizer engine)
- **Document Search tab** — embedding-index-based retrieval over uploaded contract PDFs with vendor + type filter
- **Report Generator tab** — natural-language prompt → typed `GeneratedReport` via structured outputs (same pattern as AI foundation subsystem 2)
- **Six suggested questions** on empty chat state (per canonical doc)
- **Upload-document dialog** on Document tab (reuses contracts-rewrite document upload flow; extends with embedding indexing)
- **Share/save reports** — download as CSV
- **Tech debt:** uses the ai-agent-client split that lands via AI foundation subsystem 5

### Out of scope

- **Memory tool / cross-session history** — each session starts fresh
- **Managed Agents / Claude containers** — out of scope platform-wide
- **AI actioning** — chat never mutates state; all actions remain advisory
- **Voice input** — text only
- **Multi-modal (image/PDF) in chat** — reserved for future spec
- **Custom model fine-tune** — base Claude Opus 4.6 / Haiku 4.5
- **Vendor-agent parity** — vendor AI agent is a separate spec (vendor portal)

### Non-goals (preserved)

- No stack swaps. No replacement of existing Vercel AI SDK abstractions.

---

## 2. Translation notes — canonical prototype → tydei

| Prototype pattern | Tydei equivalent |
|---|---|
| `useChat` with `DefaultChatTransport` → `/api/ai-agent` | Same wiring; already exists. Route handler verifies `userRole` and scopes data to the facility |
| `sampleSearchResults` mock dataset | Real embedding search over `ContractDocument` rows with embeddings stored in pgvector (requires Prisma Postgres extension) OR a simpler text-match MVP |
| `generateReportFromPrompt` switch on keywords | Claude call with structured-output schema; keyword router becomes the system prompt for the model to reason about |
| Message render: join `text`-type parts from `message.parts[]` | Same |
| Indexed documents array with `status: 'indexed' | 'processing'` | Real `ContractDocument.indexStatus` column + background (or synchronous on upload) embedding job |
| Report generation returns hardcoded report types (contract / surgeon / rebate / invoice / case / etc.) | Claude picks the report type + produces typed output via Zod schema; fallback to a generic report shape |

---

## 3. Data model changes

**Minimal additive changes.**

### 3.1 `ContractDocument` extension — embedding status + vector

```prisma
enum DocumentIndexStatus {
  pending
  processing
  indexed
  failed
}

model ContractDocument {
  // ... existing fields

  indexStatus  DocumentIndexStatus @default(pending)
  indexedAt    DateTime?
  pageCount    Int?
  // Vector storage: one embedding per page, stored in a separate join table
}

// One row per document page, with embedding
model ContractDocumentPage {
  id          String   @id @default(cuid())
  documentId  String
  pageNumber  Int
  text        String   @db.Text
  embedding   Unsupported("vector(1536)")?  // pgvector
  createdAt   DateTime @default(now())

  document ContractDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("contract_document_page")
}
```

**MVP alternative** (if pgvector setup is out of scope for v1): drop the `embedding` column, keep `text`, use Postgres full-text search (`to_tsvector` + `@@`) for retrieval. Re-introduce embeddings as a v2 upgrade without breaking the page-level row shape.

**Default for v1:** start with text-search; flag pgvector as a follow-up. Subsystem 0 makes this call based on the Postgres environment in use.

### 3.2 No other schema changes

Report generator outputs aren't persisted — ephemeral per-request. If we later want "saved reports," that's a follow-up (and maps to the existing `ReportSchedule` model).

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Schema decision + chat tool expansion (P0)

**Priority:** P0.

**Files:**
- Modify: `prisma/schema.prisma` — add `DocumentIndexStatus` enum; `ContractDocument.indexStatus/indexedAt/pageCount`; new `ContractDocumentPage` model (with or without pgvector based on environment check)
- Modify: `lib/ai/tools.ts` — add `calculateRebateOpportunities` tool definition
- Audit: `app/api/ai-agent/route.ts` — verify tool wiring and system prompt

**Decision in subsystem 0:** pgvector or Postgres FTS? Document the choice in the plan.

**Acceptance:**
- Schema validated + pushed.
- New tool callable end-to-end from chat.
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `00-schema-tools-plan.md`.

---

### Subsystem 1 — Chat tab (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/ai-agent/chat-tab.tsx` (extracted from the 984-line ai-agent-client.tsx via AI foundation subsystem 5)
- Add: 6 suggested questions from canonical doc
- Add: "New Chat" button on non-empty state
- Verify streaming render + auto-scroll

**Suggested questions (empty state, canonical §2):**

| Category | Question |
|---|---|
| Contract Performance | How are our top contracts performing this quarter? |
| Rebate Analysis | What is our total earned rebate this year and how close are we to hitting the next tier? |
| Alerts Summary | What are the critical alerts I should address today? |
| Cost Savings | Where are our biggest opportunities to save money on contracts? |
| Market Share | What does our market share look like across product categories? |
| Surgeon Metrics | Which surgeons have the best spend efficiency scores? |

Each chip dispatches `sendMessage({ text })` directly; bypasses input field.

**Request body** (injected server-side per canonical §6):
```ts
{
  messages,
  userRole: "facility"  // vendor portal sends "vendor"; server scopes data access
}
```

**Acceptance:**
- Streaming renders incrementally; auto-scroll sticks to bottom.
- Suggested-question chips fire `sendMessage` directly (6 chips; hidden when `messages.length > 0`).
- Tool invocations render inline (per-tool-call display).
- `userRole: 'facility'` is injected via `prepareSendMessagesRequest`.

**Plan detail:** On-demand — `01-chat-tab-plan.md`.

---

### Subsystem 2 — Document indexing pipeline (P1)

**Priority:** P1.

**Files:**
- Create: `lib/ai/document-index.ts`:
  - `extractPages(pdfBuffer)` — PDF → array of `{ pageNumber, text }`
  - `indexDocument(documentId)` — runs on upload; populates `ContractDocumentPage` rows
  - If pgvector: also compute + store embeddings (via Anthropic embedding endpoint or OpenAI compatible; pick one)
  - If FTS: skip embedding; populate `text` only
- Wire: `lib/actions/documents.ts::uploadDocument` — kicks off indexing (synchronous for MVP; async-via-QStash follow-up)
- Expose status: `ContractDocument.indexStatus` drives UI state badge

**Acceptance:**
- Uploading a PDF produces populated `ContractDocumentPage` rows.
- `indexStatus` transitions `pending → processing → indexed` (or `failed`).
- Text extracted correctly (sample PDF test).

**Plan detail:** On-demand — `02-index-pipeline-plan.md`.

---

### Subsystem 3 — Document search tab (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/ai-agent/documents-tab.tsx`
- Create: `lib/ai/document-search.ts` — `searchDocuments(query, filters?)`:
  - pgvector variant: embedding-based similarity search with distance threshold
  - FTS variant: `to_tsvector(text) @@ plainto_tsquery(query)` with ranking
- Create: `components/facility/ai-agent/document-preview-dialog.tsx` — shows page text with highlight
- Filters: vendor (single-select), document type (single-select)

**Acceptance:**
- Search returns relevance-ranked page-level results.
- Preview dialog shows context with `matchedText` highlighted.
- Filters work; empty results render polished empty state.

**Plan detail:** On-demand — `03-doc-search-plan.md`.

---

### Subsystem 4 — Report generator tab (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/ai-agent/reports-tab.tsx`
- Create: `lib/ai/report-generator.ts` — server action:
  - Input: user prompt + facilityId + optional date range
  - Output: structured `GeneratedReport` (Zod schema)
  - Model: Opus 4.6 (reasoning + tool use for data fetching)
  - Streaming: stream the report rendering as columns + rows arrive
- Typed report shape:

```ts
const generatedReportSchema = z.object({
  title: z.string(),
  description: z.string(),
  columns: z.array(z.string()),
  data: z.array(z.record(z.union([z.string(), z.number()]))),
  generatedAt: z.string(),
  notes: z.string().optional(),
  reportType: z.enum([
    "contract_performance",
    "surgeon_performance",
    "rebate_analysis",
    "invoice_discrepancy",
    "custom",
  ]),
})
```

**Prompt routing** (canonical §4.3, deterministic pre-filter before the Claude call to pick a column template — lowest-priority match wins the fallback):

| Substring in prompt (case-insensitive) | reportType | Columns |
|---|---|---|
| `contract` or `vendor` | `contract_performance` | Vendor, Contract ID, Start Date, End Date, Total Spend, Rebate Earned, Compliance % |
| `surgeon` or `physician` | `surgeon_performance` | Surgeon, Specialty, Total Cases, Avg Case Cost, Contract Compliance, Rebate Contribution, Cost Efficiency |
| `rebate` or `tier` | `rebate_analysis` | Vendor, Contract, Current Tier, Next Tier, Current Spend, Spend to Next Tier, Potential Additional Rebate |
| `invoice`, `discrepancy`, or `variance` | `invoice_discrepancy` | Invoice #, Vendor, Invoice Date, Invoiced Amount, Contract Amount, Variance, Status |
| fallback | `custom` | Category, Metric, Value, Change, Status |

- Download as CSV button
- CSV filename pattern: `${title.replace(/\s+/g, '_')}_${YYYY-MM-DD}.csv`
- Every column value double-quoted to handle commas in cell values

**Acceptance:**
- "What are my top 10 rebate opportunities?" → routes to `rebate_analysis` → structured table output.
- "Show me surgeon efficiency" → routes to `surgeon_performance`.
- CSV download respects the generated report's columns + data, with proper quoting.
- Filename format matches pattern.
- Credits deducted; audit log populated.

**Plan detail:** On-demand — `04-report-generator-plan.md`.

---

### Subsystem 5 — Upload dialog + indexing status UI (P2)

**Priority:** P2.

**Files:**
- Create: `components/facility/ai-agent/upload-document-dialog.tsx` — reuses contracts-rewrite doc upload; extends with "Index for AI search" checkbox (default: on)
- Modify: documents-tab to show `indexStatus` badge per document + re-index action

**Acceptance:**
- Users can upload a PDF, see it move through pending → processing → indexed.
- Re-index action re-triggers pipeline.
- Failed index shows retry button.

**Plan detail:** On-demand — `05-upload-status-plan.md`.

---

### Subsystem 6 — UI polish (P2)

**Priority:** P2.

Standard polish subsystem — empty states, a11y, responsive, streaming loading indicators.

**Acceptance:**
- Lighthouse a11y pass.
- Manual smoke at all breakpoints.

**Plan detail:** On-demand — `06-ui-polish-plan.md`.

---

## 5. Execution model

```
Subsystem 0 (schema + tool expansion)
  ↓                                      ↘
Subsystem 1 (chat tab)     Subsystem 2 (indexing pipeline)
  ↓                           ↓
                    Subsystem 3 (doc search)
                           ↓
                    Subsystem 4 (report generator)
                           ↓
                    Subsystem 5 (upload + status UI)
                           ↓
                    Subsystem 6 (UI polish)
```

**Global verification:**
```bash
bunx tsc --noEmit
bun run test
bun run build
bun run test lib/ai/__tests__/  # includes document-index + report-generator tests
```

---

## 6. Acceptance

- All 7 subsystems merged.
- Chat streams with real tool calls; tool calls invoke real engines.
- Document search returns ranked results from real indexed PDFs.
- Report generator produces typed structured output; CSV download works.
- `bunx tsc --noEmit` → 0.
- Credits + audit log work across all 3 tabs.

---

## 7. Known risks

1. **pgvector availability.** Not all Postgres environments have it. Subsystem 0 makes the call; FTS fallback is documented. pgvector upgrade is a later migration if needed.
2. **Document index cost.** Embedding generation for every PDF page incurs API cost. Mitigation: index only on user's opt-in ("Index for AI search" checkbox); allow facility admins to disable indexing.
3. **PDF extraction quality.** Scanned PDFs may produce garbage text. Mitigation: use `pdfplumber`-class extractor; flag documents with `pageCount > 0 && avg-page-text-length < 50` as "likely OCR needed" for admin re-upload.
4. **Report generator structured-output failures.** Claude sometimes produces malformed JSON under complex schemas. Mitigation: AI foundation's retry-once-then-error pattern.
5. **Chat context cost.** Long chats blow out prompt cache. Mitigation: cap at 20 turns before suggesting user start a new chat; audit log tracks cache hit rates.
6. **Tool call security.** Tools must verify facilityId scope. Mitigation: every tool action wraps in `requireFacility` + explicit facility check.

---

## 8. Out of scope (explicit)

- Memory / cross-session history
- Managed Agents / Claude containers
- AI actioning (chat never mutates state)
- Voice input
- Image/PDF input in chat
- Custom model fine-tuning
- Vendor AI agent (separate spec)
- Persisted reports / saved reports library (use existing ReportSchedule for that)

---

## 9. How to iterate

1. Start with subsystem 0.
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
