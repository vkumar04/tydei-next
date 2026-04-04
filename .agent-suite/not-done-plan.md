# NOT DONE Items: Phased Implementation Plan

**Priority:** Demo is tomorrow (April 2). Phases ordered by demo impact.

---

## Phase A: HIGH IMPACT (Items 1-3) -- Do First

---

### Item 1: Pricing File Integrated into AI Extract Dialog

**Problem:** After AI extracts the PDF, the user must accept, then navigate to the Upload PDF tab, then upload a pricing file. The v0 `ContractPDFUpload` does both in a single "Upload + Review" flow (pricing dropzone appears right on the same upload/review card).

**What to change:** Add an optional pricing file upload step to `AIExtractReview` (the review screen inside the AI extraction dialog). After the user sees the extracted data and before they hit "Accept & Fill Form", they can attach a pricing file. When they accept, pass the pricing data alongside the contract data.

**Files to modify:**

1. **`components/contracts/ai-extract-review.tsx`**
   - Add a collapsible "Attach Pricing File" section below the extracted fields, above the Accept button.
   - Reuse the existing `handlePricingUpload` logic from `new-contract-client.tsx` (move into a shared hook or inline).
   - Add a simple drag-drop zone (CSV/XLSX) with a summary badge showing item count once loaded.
   - New props: `onPricingFile?: (items: ContractPricingItem[], fileName: string) => void`

2. **`components/contracts/ai-extract-dialog.tsx`**
   - Thread pricing data through. Update `handleAccept` to pass pricing data: `onExtracted(data, s3Key, fileName, pricingItems?, pricingFileName?)`.
   - Update `AIExtractDialogProps.onExtracted` signature to accept optional `pricingItems` and `pricingFileName` parameters.

3. **`components/contracts/new-contract-client.tsx`**
   - Update `handleAIExtract` to accept the optional pricing parameters.
   - If pricing data is provided from the dialog, call `finalizePricingImport(items, fileName)` immediately (already exists in this file).
   - Remove the toast that says "upload a pricing file or switch to Manual Entry" when pricing is already attached.

**Reuse:**
- `handlePricingUpload` logic already in `new-contract-client.tsx` (lines 67-192) -- extract `buildPricingItems` and the auto-map logic into a small `parsePricingFile(file: File)` helper, or duplicate the simple version inline.
- `PricingColumnMapper` component already exists at `components/contracts/pricing-column-mapper.tsx` -- render it from within the dialog if auto-mapping fails.

**Props/interface change:**
```ts
// ai-extract-dialog.tsx
interface AIExtractDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExtracted: (
    data: ExtractedContractData,
    s3Key?: string,
    fileName?: string,
    pricingItems?: ContractPricingItem[],
    pricingFileName?: string,
  ) => void
}
```

---

### Item 2: COG-Based Auto-Total When Vendor Selected

**Problem:** When a vendor is selected on the contract form, the total value and annual value fields stay blank. The v0 calculates the contract total from COG records by filtering `extendedPrice` for the selected vendor and summing them (see v0 `app/dashboard/contracts/new/page.tsx` lines 134-157).

**What to change:** Add a server action to sum COG spend for a vendor, then call it from the contract form when `vendorId` changes.

**Files to create/modify:**

1. **`lib/actions/cog-records.ts`** -- Add a new server action:
   ```ts
   export async function getVendorCOGSpend(vendorId: string): Promise<number> {
     const { facility } = await requireFacility()
     const result = await prisma.cOGRecord.aggregate({
       where: { facilityId: facility.id, vendorId },
       _sum: { extendedPrice: true },
     })
     return Number(result._sum.extendedPrice ?? 0)
   }
   ```

2. **`components/contracts/new-contract-client.tsx`**
   - Add a `useEffect` or `watch` callback on `form.watch("vendorId")`.
   - When `vendorId` changes and is non-empty, call `getVendorCOGSpend(vendorId)`.
   - If the result > 0 and `totalValue` is currently 0, auto-fill `totalValue` and compute `annualValue` from dates.
   - Show a small info badge: "Auto-filled from $X COG spend".

**Reuse:**
- The pattern already exists in `lib/actions/vendor-dashboard.ts` (line 36-45) where `prisma.cOGRecord.aggregate({ where: { vendorId }, _sum: { extendedPrice: true } })` is used. The new action just scopes to the current facility.
- The annual value calculation already exists in `finalizePricingImport` (lines 258-266 of `new-contract-client.tsx`).

---

### Item 3: Auto-Create Vendors in COG Import

**Problem:** During COG import, when the vendor matching step shows unrecognized vendor names, the user can only map them to existing vendors or "Keep as text". The v0's `VendorMatcher` component offers an "Auto-Create" action. In contract creation, we already auto-create vendors (see `new-contract-client.tsx` lines 320-329).

**What to change:** Add a "Create as New Vendor" option to the vendor matching dropdown in the COG import dialog.

**Files to modify:**

1. **`components/facility/cog/cog-import-dialog.tsx`**
   - In the `vendor_match` step (line 255 area), add a `SelectItem` for `__create_new__` below the vendor list.
   - When `__create_new__` is selected, call `createVendor({ name: importedVendorName, displayName: importedVendorName, tier: "standard" })`.
   - After creation, update `importState.vendorMappings` with the newly created vendor's ID.
   - Show a toast: `Vendor "X" created`.

2. **`hooks/use-cog-import.ts`**
   - No changes needed -- `vendorMappings` already maps string name to vendor ID, and `goToDuplicateCheck` applies those IDs to records.

**Reuse:**
- `createVendor` from `lib/actions/vendors.ts` (already imported in `new-contract-client.tsx` -- just import it here too).
- The auto-create pattern from `new-contract-client.tsx` lines 320-329.

**Implementation detail:**
```tsx
// Inside the vendor_match Select, after existing vendors:
<SelectItem value="__create_new__">
  + Create "{name}" as new vendor
</SelectItem>

// onValueChange handler:
if (v === "__create_new__") {
  const newVendor = await createVendor({ name, displayName: name, tier: "standard" })
  importState.setVendorMappings({
    ...importState.vendorMappings,
    [name]: newVendor.id,
  })
  toast.success(`Vendor "${name}" created`)
}
```

---

## Phase B: MEDIUM IMPACT (Items 4-6) -- Do Next

---

### Item 4: AI Extraction User Instructions Field

**Problem:** Users cannot give the AI hints about the contract before extraction. The v0's `ContractPDFUpload` has a `userInstructions` state with a collapsible textarea (line 225).

**What to change:** Add an optional instructions textarea to the AI extract dialog's upload screen.

**Files to modify:**

1. **`components/contracts/ai-extract-dialog.tsx`**
   - Add a `userInstructions` state variable.
   - In the `stage === "upload"` section, add a collapsible textarea below the Upload button:
     ```
     [optional] "Instructions for AI" link that expands a Textarea
     Placeholder: "e.g., This is a usage-based rebate contract. Extract vendor name, product categories, tier thresholds."
     ```
   - Pass `userInstructions` in the FormData when calling `/api/ai/extract-contract`.

2. **`app/api/ai/extract-contract/route.ts`** (or wherever the API handler lives)
   - Read the `userInstructions` field from formData.
   - Append it to the AI prompt as a "User notes" section.

**Reuse:**
- `Textarea` from `@/components/ui/textarea`.
- `Collapsible` / `CollapsibleTrigger` / `CollapsibleContent` from `@/components/ui/collapsible` (already used in v0).

---

### Item 5: Tie-In Contract Dropdown

**Problem:** When contract type is "tie_in" or "capital", there's no way to link to an existing parent/related contract. The v0 has `tieInDetails.linkedProductCategories` but no dropdown. We need a "Linked Contract" dropdown.

**What to change:** Add a conditional "Linked Contract" dropdown to the contract form that appears when type is `tie_in` or `capital`.

**Files to modify:**

1. **`prisma/schema.prisma`** -- Add an optional self-relation to the Contract model:
   ```prisma
   parentContractId String?
   parentContract   Contract? @relation("ContractLink", fields: [parentContractId], references: [id])
   childContracts   Contract[] @relation("ContractLink")
   ```
   Then run `npx prisma migrate dev --name add-parent-contract-link`.

2. **`lib/validators/contracts.ts`** -- Add `parentContractId: z.string().optional()` to `createContractSchema`.

3. **`components/contracts/contract-form.tsx`**
   - Watch `contractType`. When it's `tie_in` or `capital`, render a Select dropdown of existing contracts.
   - Need a `contracts` prop (list of `{ id: string; name: string }[]`).
   - Or fetch via a query inside the component.

4. **`app/dashboard/contracts/new/page.tsx`**
   - Fetch contracts list and pass to `NewContractClient`, which passes to `ContractFormBasicInfo`.

5. **`lib/actions/contracts.ts`** -- Save `parentContractId` on contract creation.

---

### Item 6: Multi-Document Upload in Contract Creation

**Problem:** The production Upload PDF tab only has a single "Upload & Extract with AI" button and a separate pricing file upload. The v0's `ContractPDFUpload` supports multiple documents tagged as main/amendment/addendum/exhibit/pricing_schedule.

**What to change:** Add a multi-document upload card to the Upload PDF tab.

**Files to modify:**

1. **`components/contracts/new-contract-client.tsx`**
   - In the "Upload PDF" TabsContent, add a third Card for "Additional Documents" (amendments, exhibits).
   - Store them in a `additionalDocuments` state: `{ file: File; type: string; label: string }[]`.
   - On submit, upload each additional document using `createContractDocument` (already imported, line 20).

2. **`components/contracts/multi-doc-upload.tsx`** -- **NEW FILE**
   - Simple component: drag-drop zone that accepts multiple PDFs.
   - Each file gets a type selector (amendment/addendum/exhibit) and an optional label.
   - Remove button per document.
   - Props:
     ```ts
     interface MultiDocUploadProps {
       documents: { file: File; type: string; label: string }[]
       onChange: (docs: { file: File; type: string; label: string }[]) => void
     }
     ```

**Reuse:**
- `FileDropzone` from `components/facility/cog/file-dropzone.tsx` pattern (or clone for PDF accept types).
- `createContractDocument` server action from `lib/actions/contracts.ts`.
- Document type constants from v0's `DOCUMENT_TYPES` array.

---

## Phase C: LOWER IMPACT (Items 7-9) -- If Time Permits

---

### Item 7: Grouped Multi-Vendor Selection

**Problem:** When contract type is "grouped", the form only shows a GPO Affiliation text field. Should allow selecting multiple vendors.

**What to change:** When `contractType === "grouped"`, show a multi-select vendor picker.

**Files to modify:**

1. **`lib/validators/contracts.ts`** -- Add `vendorIds: z.array(z.string()).optional()` to `createContractSchema`. Make `vendorId` optional when type is grouped.

2. **`components/contracts/contract-form.tsx`**
   - When `contractType === "grouped"`, replace the single vendor Select with a multi-select.
   - Use a checkmark-based multi-select or the shadcn `Command` combobox pattern for multi-select.

3. **`lib/actions/contracts.ts`** -- On creation, if `vendorIds` is provided, create `ContractVendor` junction records (may need a new junction table in Prisma).

4. **`prisma/schema.prisma`** -- Potentially add a `ContractVendor` many-to-many join model if it doesn't exist.

---

### Item 8: PDF Support for COG Imports

**Problem:** The COG import dialog only accepts CSV/Excel. The v0's `COGImportModal` also only accepts CSV, but the requirement is to support PDF files too.

**What to change:** Accept PDF in the COG import dropzone, send to a server-side PDF parser, and return tabular data.

**Files to modify:**

1. **`components/facility/cog/file-dropzone.tsx`** -- Add `.pdf` to the accept list.

2. **`hooks/use-file-parser.ts`** -- Detect PDF by extension. If PDF, call a new API endpoint `/api/parse-cog-pdf` that uses AI to extract tabular COG data from the PDF.

3. **`app/api/parse-cog-pdf/route.ts`** -- **NEW FILE**
   - Accept a PDF via FormData.
   - Use the same AI extraction pattern as contract PDF extraction.
   - Return `{ headers: string[], rows: Record<string, string>[] }` like the existing CSV parser does.
   - Prompt the AI to extract: vendor name, item number, description, unit cost, extended price, quantity, date, category.

4. **`components/facility/cog/cog-import-dialog.tsx`** -- No changes needed if `useFileParser` handles the new format.

---

### Item 9: Large PDF Fallback

**Problem:** PDFs over 4MB time out during AI extraction. The v0 has a `MAX_API_FILE_SIZE = 4 * 1024 * 1024` check and falls back to `generateDemoExtraction(filename)` which does filename-based vendor/template extraction.

**What to change:** Add a pre-flight size check in the AI extract dialog and fall back to a template extraction.

**Files to modify:**

1. **`components/contracts/ai-extract-dialog.tsx`**
   - In `handleFile`, check `file.size > 4 * 1024 * 1024`.
   - If too large, skip the API call and use a client-side template extraction function.
   - Show a warning banner: "File too large for AI analysis. Using template extraction from filename."

2. **`lib/ai/fallback-extraction.ts`** -- **NEW FILE**
   - Port the v0's `generateDemoExtraction` function (v0 `contract-pdf-upload.tsx` lines 318-388) and `extractVendorFromFilename` (lines 168-189).
   - Return an `ExtractedContractData` object with vendor name inferred from filename, sensible defaults for dates and terms.
   - Mark `description` with "Template extraction -- review all fields carefully".

**Reuse:**
- Vendor name patterns from v0's `extractVendorFromFilename` (Arthrex, Stryker, DePuy, etc.).
- The `ExtractedContractData` type from `lib/ai/schemas.ts`.

---

## Execution Order (for demo)

| Priority | Item | Est. Time | Demo Impact |
|----------|------|-----------|-------------|
| 1        | Item 1: Pricing in AI dialog | 45 min | Shows unified AI extraction flow |
| 2        | Item 2: COG auto-total | 20 min | Auto-fills dollar values -- impressive |
| 3        | Item 3: Auto-create vendors in COG | 20 min | Eliminates manual vendor setup |
| 4        | Item 4: AI instructions field | 15 min | Shows AI flexibility |
| 5        | Item 5: Tie-in dropdown | 30 min | Requires migration |
| 6        | Item 6: Multi-doc upload | 30 min | New component needed |
| 7-9      | Items 7-9 | 30 min each | Lower demo relevance |

**Total for Phase A:** ~85 min
**Total for Phase A+B:** ~2.5 hr
**Total all phases:** ~4 hr
