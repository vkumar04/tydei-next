# New Contract page — single-flow redesign

**Date:** 2026-04-19
**Surface:** `/dashboard/contracts/new`
**Trigger:** Charles feedback — "can we combine ai assistant and upload pdf?"

## Problem

The New Contract page has three tabs — **AI Assistant**, **Upload PDF**, **Manual Entry** — and the first two duplicate the same action. Both call `setAiExtractOpen(true)` (same `AIExtractDialog`). The tab split confuses users about which to pick.

Distinctions that actually exist:
- `AITextExtract` (paste-text fallback) lives only on AI Assistant
- `Additional Documents` + `Upload Pricing File` cards live only on Upload PDF

## Design

Single-flowing page, no tabs. Sections top → bottom:

1. Page header
2. **Upload Contract PDF** card — "Upload & Extract with AI" button. On success, auto-fills the form.
3. **Additional Documents** card — amendments/addendums/exhibits
4. **Upload Pricing File** card — CSV/xlsx pricing
5. **Contract Details form** — always visible, empty by default, populates after AI extract, fully editable
6. Submit

## Changes

**File:** `components/contracts/new-contract-client.tsx`

- Remove `<Tabs>` / `<TabsList>` / `<TabsTrigger>` / `<TabsContent>` wrapping
- Remove `entryMode` state + `setEntryMode` calls
- Remove `<AITextExtract>` usage + import
- Remove `<ExtractedReviewCard>` usage + import + `extractedReady` state
- Keep `<AIExtractDialog>` (unchanged)
- Update the extraction-success toast — drop "switch to Manual Entry to review", say "review the form below"

Dead-code candidates after this change: `components/contracts/ai-text-extract.tsx` and the `ExtractedReviewCard` component (if no other callers). Grep before deleting.

## Behavior

- **PDF path:** upload PDF → AI extracts → form populates → user reviews + edits inline → submit
- **Manual path:** form is visible from load → user fills → submit
- **PDF + pricing + docs:** all three persist on submit (unchanged)
- **Extract failure:** toast error, form stays empty, manual fallback is always available

## Testing

- `bunx tsc --noEmit` → 0 errors
- Vitest unchanged (presentation-layer change, no new logic)
- Live smoke:
  1. Upload PDF → form populates → submit → contract created
  2. Skip upload → fill form manually → submit → contract created
  3. Upload PDF + pricing CSV + additional docs → submit → all three persisted
  4. `/dashboard/contracts/new` HTTP 200, 0 digest errors
