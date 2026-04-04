# Flow Comparison: v0 Prototype vs Production App

**Generated:** 2026-04-01
**v0 source:** `/Users/vickkumar/Downloads/b_FtKM0pV2dZE-1775131904894/`
**Production source:** `/Users/vickkumar/code/tydei-next/`

---

## Flow 1: Create Contract via AI Extraction

### v0 Flow
1. **Page renders** (`app/dashboard/contracts/new/page.tsx`) -- monolithic 1000+ line component with all state as `useState` hooks. Reads vendors/categories from client-side stores (`getActiveVendors()`, `getAllCategories()`).
2. **Three entry mode tabs** (`ai`, `pdf`, `manual`) default to `ai`.
3. **AI Assistant tab** renders `AIContractDescription` component (dynamic import). This is a **text-based AI chat** -- user describes the contract in natural language and the AI extracts structured fields. On extraction, it calls `onDataExtracted()` which populates form fields and switches to `manual` tab.
4. **Upload PDF tab** renders `ContractPDFUpload` component -- a full multi-document upload flow:
   - Step 1 (`upload`): Drag-and-drop zone for **multiple PDFs**. Each uploaded file gets tagged as `main`, `amendment`, `addendum`, `exhibit`, or `pricing_schedule`. Documents listed in a queue with type selectors.
   - Also supports **mass upload mode** (`MassUpload` component).
   - **User instructions field** for AI context hints.
   - **Pricing file upload toggle** with separate dropzone for CSV/Excel pricing files.
   - Processing: Sends each PDF to `/api/parse-contract-pdf` endpoint. Falls back to `generateDemoExtraction()` for files >4MB (client-side template extraction from filename patterns).
   - Step 2 (`review`): Shows consolidated extracted data with editable fields. Terms are shown inline with expand/collapse.
   - **Pricing file processing**: Parses with XLSX.js client-side, auto-detects category column, shows column mapping UI for category selection.
   - On "Accept": Calls `onExtracted(data, documents, pricingData)` which triggers `handlePDFExtracted`.
5. **handlePDFExtracted** (in parent page):
   - Auto-fills: contractName, contractId/contractNumber, vendorName (fuzzy match to store), contractType (with type mapping), product categories (multi-match), dates, rebatePayPeriod, isGrouped, multi-facility detection.
   - **Auto-creates vendor** if not found via `addVendor()`.
   - **Categories from pricing file**: Matches to existing categories, auto-creates new ones with name as ID.
   - **Terms extraction**: Maps each term with full type mapping (10 term types), period mapping, tier conversion with intelligent name generation (e.g., "Quarterly Spend Rebate (2%-4%)").
   - Switches to `manual` tab for review.
6. **Manual Entry tab**: Full form with:
   - Basic info: name, contract ID, vendor (single or multi for grouped), contract type (6 types with descriptions), product categories (multi-select with pricing file categories).
   - **Grouped contract support**: Multi-vendor selection with badges.
   - **Multi-facility support**: Checkbox to enable, facility selector.
   - **Tie-in contract support**: Links to capital contracts.
   - Dates via Calendar popover, performance period, rebate pay period.
   - **Auto-calculated contract total** from COG data based on selected vendor.
   - **Auto-calculated margin** from case costing data (reimbursement - cost + rebates).
   - Description with AI-generated suggestions.
   - **ContractTermsEntry** component for rebate term management.
   - **Pricing file display** in sidebar showing linked file info.
7. **Submit** (`handleSubmit`): Calls `addContractWithCOGEnrichment()` which stores to localStorage client-side store with COG-derived fields. Saves pricing data items. Navigates to `/dashboard/contracts`.

### Production Flow
1. **Page renders** (`app/dashboard/contracts/new/page.tsx` server component) -- fetches vendors and categories from database via `getVendors()` and `getCategories()`. Passes to `NewContractClient`.
2. **`NewContractClient`** (`components/contracts/new-contract-client.tsx`) -- uses `useContractForm()` hook (react-hook-form based) and `useCreateContract()` mutation.
3. **Three entry mode tabs** (`ai`, `pdf`, `manual`) default to `ai`.
4. **AI Assistant tab**:
   - Card with "Start AI Extraction" button that opens `AIExtractDialog`.
   - **Also renders `AITextExtract`** -- a separate text-paste extraction component (not in v0).
5. **AIExtractDialog** (`components/contracts/ai-extract-dialog.tsx`):
   - Stage 1 (`upload`): Simple file input for **single PDF/TXT** file.
   - Stage 2 (`extracting`): Progress stepper showing 3 steps: "Uploading document", "Reading contract PDF", "Structuring extracted data". Smooth animated progress bar.
   - Sends to `/api/ai/extract-contract` as FormData.
   - Stage 3 (`review`): Renders `AIExtractReview` component.
   - Stage 4 (`error`): Error message with "Try Again" button.
6. **AIExtractReview** (`components/contracts/ai-extract-review.tsx`):
   - Shows confidence badge (High/Medium/Low with color coding).
   - **Inline-editable fields**: Contract Name, Vendor, Contract Type (select), Effective Date, Expiration Date, Total Value, Description.
   - **Terms display**: Collapsible list showing term names, types, tier counts, and tier details.
   - "Accept & Populate Form" button.
7. **handleAIExtract** (in NewContractClient):
   - Populates react-hook-form values: name, contractNumber, contractType, dates, totalValue (with auto-computed annualValue), description.
   - **Vendor matching**: Fuzzy match by name/displayName to existing vendors. Sets vendorId.
   - **Terms population**: Maps to `TermFormValues` with hardcoded defaults (termType: `spend_rebate`, baselineType: `spend_based`, evaluationPeriod: `annual`, paymentTiming: `quarterly`, appliesTo: `all_products`).
   - Stores S3 key and filename for document attachment.
   - Toast: "Contract data extracted -- upload a pricing file or switch to Manual Entry to review"
   - **Switches to `pdf` tab** (not manual).
8. **Upload PDF tab**:
   - Same "Upload & Extract with AI" button (re-opens AIExtractDialog).
   - **Pricing File Upload** section: Separate card for CSV/Excel upload.
   - Pricing parsing: Client-side CSV parse or server-side Excel parse via `/api/parse-file`.
   - **Smart column auto-mapping** with extensive alias lists for vendorItemNo, description, unitPrice, listPrice, category, uom.
   - If auto-mapping fails (missing vendorItemNo or unitPrice), opens `PricingColumnMapper` dialog.
   - On success: `finalizePricingImport()` -- auto-creates missing categories via `createCategory()`, auto-computes totalValue and annualValue from pricing sums, refreshes router.
9. **Manual Entry tab**: Form with:
   - `ContractFormBasicInfo` (extracted component).
   - `ContractTermsEntry` for terms (hidden for `pricing_only` type).
   - Sidebar: Actions (Create/Draft/Cancel), `ContractFormReview` summary, Pricing File status.
   - **No grouped contract support** (single vendor only).
   - **No multi-facility support**.
   - **No tie-in contract linking**.
   - **No auto-calculated total from COG data**.
10. **Submit** (`handleSubmit`):
    - Validates via `form.trigger()`.
    - Creates contract via `createMutation.mutateAsync()` (server action).
    - Creates terms via `createContractTerm()` server actions (sequentially).
    - Imports pricing via `importContractPricing()`.
    - Creates contract document (PDF attachment) via `createContractDocument()`.
    - Navigates to `/dashboard/contracts/${contract.id}`.
11. **Save as Draft**: Allows saving with only a name, sets status to `draft`.

### Differences

| Aspect | v0 | Production | Impact |
|--------|-----|-----------|--------|
| **AI Assistant tab** | Text-based AI chat (`AIContractDescription`) -- describe contract in words | PDF upload dialog (`AIExtractDialog`) + text paste (`AITextExtract`) | Different UX paradigm; v0 allows NL description |
| **PDF Upload tab** | Multi-document upload with type tagging (main, amendment, addendum, exhibit) | Single PDF upload via AI Extract dialog + separate pricing file upload | v0 handles complex multi-doc contracts; prod only supports 1 PDF |
| **Mass upload mode** | Supported via `MassUpload` component | Not present | Missing batch document processing |
| **AI user instructions** | User can provide context hints to AI | Not present | Less AI guidance in production |
| **File size fallback** | Client-side template extraction for files >4MB with vendor name pattern matching | No explicit fallback -- API error shown | v0 more resilient to large files |
| **AI extraction API** | `/api/parse-contract-pdf` | `/api/ai/extract-contract` | Different endpoints, different response formats |
| **Extraction review** | Full inline review in PDF upload component (step 2) | Separate `AIExtractReview` component in dialog with confidence score | Prod has confidence scoring; v0 review is more integrated |
| **Vendor auto-creation** | Auto-creates vendor via `addVendor()` if not found | Only matches existing vendors; does not create new ones | Vendor must pre-exist in production |
| **Term types** | 10 types: spend_rebate, volume_rebate, price_reduction, market_share, market_share_price_reduction, capitated_price_reduction, capitated_pricing_rebate, po_rebate, carve_out, payment_rebate | Hardcoded to `spend_rebate` for all extracted terms | Major gap -- production loses term type diversity |
| **Term fields** | Full: termType, performancePeriod, volumeType, baselineType, spendBaseline, volumeBaseline, growthBaselinePercent, desiredMarketShare, effectiveFrom/To, products, procedureCodes | Minimal: termName, hardcoded type/baseline/evaluation/payment/appliesTo, tiers with spendMin/Max + rebateValue | Significant fidelity loss |
| **Intelligent term naming** | Auto-generates names like "Quarterly Spend Rebate (2%-4%)" based on structure | Uses raw termName from AI extraction | UX regression |
| **Grouped contracts** | Full support: multi-vendor selection with badges, `isGrouped` flag | Not supported | Missing contract type support |
| **Multi-facility** | Checkbox + facility multi-selector | Not supported | Missing feature |
| **Tie-in contracts** | Links to capital contracts via dropdown | Not supported | Missing contract type support |
| **Auto-calc total from COG** | Calculates contract total from COG data for selected vendor | Not present | Missing COG integration during creation |
| **Auto-calc margin** | Calculates margin from case costing (reimbursement - cost + rebates) | Not present | Missing case costing integration |
| **Contract types** | 6 types with inline descriptions in dropdown | 6 types (same list) | Parity |
| **Product categories** | Multi-select, auto-imports from pricing file, creates new ones | Multi-select via separate component, auto-creates from pricing import | Similar, different implementation |
| **Pricing file in AI flow** | Pricing file toggle built into PDF upload component | Separate card in Upload PDF tab | Different UX organization |
| **Pricing column mapper** | Category column auto-detect + selection in v0 PDF upload | Full column mapper dialog (`PricingColumnMapper`) for all fields | Prod has better general mapping; v0 had pricing-integrated category detection |
| **Save as Draft** | Not present | Supported -- saves with only name required | Production improvement |
| **Form library** | Raw useState for every field | react-hook-form via `useContractForm()` | Prod has better validation/state management |
| **Data storage** | localStorage client-side stores | Server actions -> Prisma -> PostgreSQL | Prod is real persistence |
| **Contract ID field** | Separate editable field | `contractNumber` auto-generated or from AI | Slightly different |
| **Post-extraction redirect** | Switches to `manual` tab | Switches to `pdf` tab (for pricing upload) | Different flow after AI extraction |

### Required Changes
- [ ] **Add multi-document upload support** -- allow uploading main contract + amendments/addendums/exhibits as separate tagged PDFs
- [ ] **Add mass upload mode** for batch document processing
- [ ] **Preserve term type diversity** during AI extraction -- map extracted termType to actual types instead of hardcoding `spend_rebate`
- [ ] **Enrich term field extraction** -- capture baselineType, volumeType, performancePeriod, effectiveFrom/To from AI output
- [ ] **Add intelligent term naming** when AI termName is generic
- [ ] **Auto-create vendors** when AI extraction identifies a vendor not in the system
- [ ] **Add grouped contract support** -- multi-vendor selection, `isGrouped` flag
- [ ] **Add multi-facility support** -- checkbox + facility selector
- [ ] **Add tie-in contract linking** -- dropdown to link capital contracts
- [ ] **Auto-calculate contract total from COG data** when vendor is selected
- [ ] **Auto-calculate margin from case costing data** when case data exists
- [ ] **Add AI user instructions field** for guiding extraction
- [ ] **Add file size fallback** for large PDFs (template extraction)
- [ ] **Add text-based AI description mode** (v0's `AIContractDescription`)

---

## Flow 2: COG Data Import

### v0 Flow
1. **Component**: `components/cog/cog-importer.tsx` (`COGCSVUpload`)
2. **Step 1 (upload)**: Drag-and-drop zone accepting CSV, Excel, and PDF files. Facility selector dropdown (loaded from localStorage).
3. **Analysis**: Sends file to `/api/cog-parser` with `action: analyze`. Returns column mappings with confidence scores, headers, sample rows, total row count.
4. **Step 2 (mapping)**: Table showing source columns -> target field dropdowns. 14 target fields including: Vendor/Supplier, Item Number, Description, Category, UOM, Unit Cost, Extended/Total, Quantity, Multiplier, Date, Facility/Location, Case/Procedure ID, Surgeon/Physician, Skip. Each has extensive aliases for auto-detection.
5. **Apply Mappings**: Sends file again to `/api/cog-parser` with `action: parse` and the finalized mappings. Applies selected facility to all records.
6. **Step 3 (vendor_match)**: Detects unmatched vendor names using `detectUnmatchedVendors()` with a hardcoded `KNOWN_VENDORS` list. Shows similarity scores (character-level distance). Users can map each COG vendor name to a known vendor or mark as new.
7. **Step 4 (duplicates)**: Uses `detectDuplicates()` against mock `existingCOGRecords`. Shows duplicate groups with resolution options: keep_existing, replace, skip.
8. **Step 5 (preview)**: Shows parsed data table with record count.
9. **Confirm**: Auto-creates vendors for unmatched names via `addVendor()`. Calls `onImported()` with parsed data.

### Production Flow
1. **Component**: `components/facility/cog/cog-import-dialog.tsx` (`COGImportDialog`)
2. **Step 1 (upload)**: `FileDropzone` component accepting .csv, .xlsx, .xls. Uses `useFileParser()` hook for parsing.
3. **Step 2 (mapping)**: Brief AI mapping animation, then `COGColumnMapper` component with source-to-target dropdowns. Uses `useCOGImport()` hook for state management.
4. **Step 3 (map)**: Manual column mapping review with `COGColumnMapper`. Back/Next buttons.
5. **Step 4 (vendor_match)**: Table showing import vendor names with `Select` dropdowns to match to existing vendors (from database via `useQuery`). Auto-matches using `matchVendorByAlias()` from `lib/vendor-aliases`. "Keep as text" option for unmatched.
6. **Step 5 (duplicate_check)**: Server-side duplicate check via `checkCOGDuplicates()` action. Shows matches with checkbox to exclude individual records.
7. **Step 6 (preview)**: `COGImportPreview` component showing mapped records.
8. **Step 7 (import)**: Calls `importMutation.mutateAsync()` with facilityId, records, and duplicateStrategy. Shows result (imported/skipped/errors counts).

### Differences

| Aspect | v0 | Production | Impact |
|--------|-----|-----------|--------|
| **File types** | CSV, Excel, PDF | CSV, Excel only | v0 supports PDF COG files |
| **Parsing** | Server-side via `/api/cog-parser` | Client-side `useFileParser()` hook for parsing, AI for mapping | Different parsing architecture |
| **Column mapping** | Server returns AI-suggested mappings with confidence scores | AI mapping step (animation), then manual review | Similar outcome, different UX |
| **Target fields** | 14 fields including Multiplier, Surgeon, Case ID | Managed by `useCOGImport` hook | Need to verify field parity |
| **Vendor matching** | Client-side against hardcoded `KNOWN_VENDORS` with character distance | Server-side against real vendors with `matchVendorByAlias()` | Prod is more accurate with real data |
| **Vendor auto-creation** | Creates new vendors via `addVendor()` on confirm | "Keep as text" option only; no auto-creation | Vendors not auto-created in prod |
| **Duplicate detection** | Client-side against mock data | Server-side via `checkCOGDuplicates()` against real DB | Prod is real duplicate checking |
| **Duplicate resolution** | Per-group: keep_existing, replace, skip | Per-record checkbox exclusion + duplicateStrategy | Different granularity |
| **Facility assignment** | Facility selector in upload step, applies to all records | facilityId passed as prop from parent | Similar, different UX |
| **State management** | Local useState in single component | `useCOGImport()` custom hook + `useFileParser()` | Prod is better organized |
| **Data persistence** | Client-side store | Server action -> database | Prod is real persistence |

### Required Changes
- [ ] **Add PDF file support** for COG imports (parse PDF cost-of-goods reports)
- [ ] **Auto-create vendors** option when vendor names don't match existing records
- [ ] **Show AI confidence scores** for column mapping suggestions
- [ ] **Add Multiplier field** to target field list if missing

---

## Flow 3: Case Costing Import

### v0 Flow
1. **Page**: `app/dashboard/case-costing/page.tsx` -- massive monolithic component (~1500+ lines).
2. **Import flow** is embedded in the main page with an "Import Data" dialog.
3. **File types defined**: 5 file types across 2 sources:
   - **Purchasing** (affects rebates): PO History File, Invoice History File
   - **Clinical** (procedural data): Case Procedures File, Supply Field File, Patient Fields File
4. **Upload**: Each file type has specific required fields listed. User uploads one file at a time.
5. **Parsing**: Client-side CSV parsing. Column matching uses hardcoded field name patterns.
6. **Case assembly**: Links data across files by Case ID. Builds case records with procedures, supplies, surgeon, facility, reimbursement, costs.
7. **Reimbursement estimation**: Uses `nationalReimbursementRates` and CPT code descriptions from `cptDescriptions` store.
8. **Data stored**: In `case-data-store` (localStorage).
9. **Additional features**: AI Supply Matcher, Payor Contracts Manager, case comparison page, reports page.

### Production Flow
1. **Component**: `components/facility/case-costing/case-import-dialog.tsx` (`CaseImportDialog`).
2. **Same 5 file types** defined with identical structure (PO History, Invoice History, Case Procedures, Supply Field, Patient Fields) split into purchasing vs clinical sources.
3. **Upload**: Same file type card layout. User uploads CSV files per type.
4. **Parsing**: Custom `parseCSVFile()` with proper quoted-field handling (handles commas inside quotes). `splitCSVLine()` helper.
5. **Column matching**: `findValue()` helper checks lowercase row keys against candidate field name lists.
6. **Date parsing**: `parseDate()` handles MM/DD/YYYY, YYYY-MM-DD, and fallback native Date parsing.
7. **Reimbursement**: Uses `estimateReimbursement()` from `lib/national-reimbursement-rates`.
8. **Import**: `useImportCases()` mutation for server-side persistence.
9. **Case assembly**: Builds `CaseInput` objects matching Zod schema from `lib/validators/cases`.

### Differences

| Aspect | v0 | Production | Impact |
|--------|-----|-----------|--------|
| **Component structure** | Embedded in massive page component | Standalone dialog component | Prod is better organized |
| **File types** | 5 types (PO, Invoice, Procedures, Supply, Patient) | Same 5 types | Parity |
| **CSV parsing** | Basic `split(",")` | Proper quoted-field parsing via `splitCSVLine()` | Prod handles edge cases better |
| **Date parsing** | Various formats via store | Dedicated `parseDate()` with MM/DD/YYYY and ISO support | Prod more robust |
| **Data persistence** | localStorage store | Server action + database via `useImportCases()` | Prod is real persistence |
| **Reimbursement rates** | `nationalReimbursementRates` in store | `estimateReimbursement()` in lib | Similar, different location |
| **AI Supply Matcher** | Present as separate component | Not present in import dialog | May exist elsewhere |
| **Payor Contracts** | `PayorContractsManager` component | Not present in import dialog | May exist elsewhere |
| **Case comparison** | Separate page (`/dashboard/case-costing/compare`) | Not confirmed | Need to check |

### Required Changes
- [ ] **Verify AI Supply Matcher exists** in production case costing
- [ ] **Verify Payor Contracts Manager exists** in production
- [ ] **Verify case comparison page** exists in production
- [ ] **Add Excel file support** for case imports if not present

---

## Flow 4: Contract Detail + Terms + Transactions

### v0 Flow
1. **Contract Detail** (`app/dashboard/contracts/[id]/page.tsx`): Stub page showing only contract ID with "Contract details coming soon" message.
2. **Terms Page** (`app/dashboard/contracts/[id]/terms/page.tsx`): Full terms management:
   - Lists contract terms with tier visualization.
   - Term types: spend-based, volume-based, fixed, market-share.
   - CRUD: Add/Edit/Delete terms via dialog forms.
   - Tier management: Add tiers with spend ranges and rebate percentages.
   - Current tier progress indicator.
   - Data from `contract-data-store`.
3. **Score Page** (`app/dashboard/contracts/[id]/score/page.tsx`): AI-powered contract scoring:
   - Overall score with radar chart (6 dimensions).
   - Dimensions: Financial Performance, Rebate Optimization, Market Share Compliance, Price Lock Value, Commitment Progress, Time Value.
   - Scoring based on COG data and industry benchmarks.
   - Bar charts for benchmark comparison.
   - Tabs: Overview, Financial, Compliance, Optimization.
4. **Edit Page** (`app/dashboard/contracts/[id]/edit/page.tsx`): Exists but not read.

### Production Flow
1. **Contract Detail** (`components/contracts/contract-detail-client.tsx`): Full detail page with:
   - `PageHeader` with title and contractNumber.
   - Action buttons: AI Score, Extract Amendment, Edit, Delete.
   - Main content: `ContractTermsDisplay`, `ContractDocumentsList`, `ContractTransactions`.
   - Sidebar: `ContractDetailOverview`.
   - Delete confirmation via `ConfirmDialog`.
   - Amendment extraction via `AmendmentExtractor` dialog.
2. **Terms**: Rendered inline via `ContractTermsDisplay` component (read-only display).
3. **Documents**: `ContractDocumentsList` shows uploaded documents.
4. **Transactions**: `ContractTransactions` shows COG transactions linked to the contract.
5. **Amendment Extractor**: Upload a PDF amendment and AI extracts changes to apply.

### Differences

| Aspect | v0 | Production | Impact |
|--------|-----|-----------|--------|
| **Contract detail page** | Stub -- "coming soon" | Full implementation with overview, terms, documents, transactions | Prod is ahead |
| **Terms management** | Separate page with full CRUD | Inline read-only display (`ContractTermsDisplay`) | v0 has term editing; prod may have it elsewhere |
| **Score page** | Full AI scoring with radar chart, benchmarks, 4 tabs | Button linking to `/dashboard/contracts/{id}/score` | Need to verify prod score page exists |
| **Amendment extraction** | Part of PDF upload flow (multi-document) | Standalone `AmendmentExtractor` dialog on detail page | Different placement, similar concept |
| **Documents list** | Part of contract creation flow | Dedicated `ContractDocumentsList` component | Prod shows docs on detail page |
| **Transactions** | Not on detail page | `ContractTransactions` component | Production improvement |
| **Delete contract** | Not visible | `ConfirmDialog` with destructive action | Production has it |

### Required Changes
- [ ] **Add inline term editing** on contract detail page (CRUD for terms/tiers)
- [ ] **Verify AI Score page** is fully implemented in production at `/dashboard/contracts/[id]/score`
- [ ] **Ensure score page** has radar chart, benchmark comparison, and multi-tab layout like v0

---

## Flow 5: Vendor Contract Submission

### v0 Flow
1. **Page**: `app/vendor/contracts/new/page.tsx` -- ~500+ line component.
2. **Entry modes**: Same 3 tabs (AI, PDF, Manual) defaulting to `ai`.
3. **Vendor identity**: Loaded from `useVendorIdentity()` store.
4. **Form fields**: contractName, contractType, facilityId (from mock `facilityOptions`), dates, performancePeriod, rebatePayPeriod, contractTotal, description.
5. **Grouped contract support**: `isGroupedContract` toggle with vendor division multi-selector (`vendorDivisions` mock list).
6. **Multi-facility support**: Checkbox + `ScalableFacilitySelector` (dynamic import).
7. **Tie-in capital contract**: Links to `capitalContractOptions`.
8. **Contract terms**: `ContractTermsEntry` component.
9. **PDF upload**: Sets `contractFile`, simulates extraction progress, extracts name/type/dates from filename patterns.
10. **Pricing file**: Processes CSV/Excel with column detection for price and category.
11. **COG integration**: Auto-calculates expected total from COG data for vendor.
12. **Submit**: Creates `PendingContract` via `usePendingContracts().addContract()`.

### Production Flow
1. **Component**: `components/vendor/contracts/vendor-contract-submission.tsx`
2. **Entry modes**: Same 3 tabs (AI, PDF, Manual) defaulting to `ai`.
3. **Props**: Receives `vendorId`, `vendorName`, `facilities` from server.
4. **Sub-components** (from `./submission/`): `EntryModeTabs`, `BasicInformationCard`, `GroupContractSettingsCard`, `ContractDatesCard`, `FinancialDetailsCard`, `ContractTermsCard`, `SubmissionSidebar`.
5. **Form fields**: contractName, contractType, facilityId, dates, performancePeriod, rebatePayPeriod, contractTotal, description, gpoAffiliation, division, capitalTieIn + tieInRef.
6. **Multi-facility**: `isMultiFacility` + `selectedFacilities`.
7. **PDF upload** (`handlePDFUpload`):
   - Uploads PDF to S3 via `getUploadUrl()` + PUT.
   - Extracts name/type/dates from filename patterns (same logic as v0).
   - **Simulates** extraction progress (not real AI extraction -- just filename parsing).
   - Auto-selects first facility.
8. **Pricing file**: `processPricingFile()` with broad header alias matching.
9. **Document upload**: `handleDocUpload()` uploads to S3.
10. **Submit**: Creates via `useCreatePendingContract()` mutation.

### Differences

| Aspect | v0 | Production | Impact |
|--------|-----|-----------|--------|
| **Component structure** | Monolithic page | Parent + 7 sub-components | Prod is better organized |
| **Vendor identity** | Client-side store | Server-passed props | Prod uses real data |
| **Facilities list** | Mock `facilityOptions` | Real facilities from server | Prod uses real data |
| **Grouped contract** | Multi-division selector with mock divisions | `GroupContractSettingsCard` component | Need to verify sub-component details |
| **PDF extraction** | Filename pattern parsing only | Same -- filename parsing only (no real AI) | Both are simulated extraction |
| **S3 upload** | Not present | Real S3 upload via `getUploadUrl()` | Prod handles file storage |
| **GPO affiliation** | Not present | `gpoAffiliation` field | Production addition |
| **Division field** | Via grouped contract divisions | Standalone `division` field | Different approach |
| **COG auto-total** | Present -- calculates from COG store | Not present | Missing feature |
| **Submit target** | Client-side pending contracts store | Server action via `useCreatePendingContract()` | Prod is real persistence |
| **AI text extraction** | Via `AIContractDescription` | Unclear -- likely same `EntryModeTabs` | Need to verify |

### Required Changes
- [ ] **Add real AI extraction** for vendor PDF uploads (currently simulated)
- [ ] **Add COG-based auto-total** calculation when vendor is known
- [ ] **Verify grouped contract settings** sub-component matches v0 division support
- [ ] **Verify AI Assistant tab** in vendor flow has text/chat extraction

---

## Flow 6: Analysis / Prospective

### v0 Flow
1. **Page**: `app/dashboard/analysis/prospective/page.tsx` -- large monolithic component.
2. **Upload**: `useDropzone` for drag-and-drop. Accepts contract/proposal PDFs and pricing files.
3. **Analysis types**:
   - **Contract proposal analysis**: Full deal scoring with 5 facility-centric dimensions: costSavings, priceCompetitiveness, rebateAttainability, lockInRisk, totalCostOfOwnership.
   - **Pricing file analysis**: Compares proposed pricing against COG data. Shows item-level variance, items above/below COG, total savings.
4. **Deal scoring**: Overall score 0-100, recommendation (accept/negotiate/decline).
5. **Negotiation points**: AI-generated list of specific risks.
6. **Visualization**: RadarChart for scores, BarChart for comparisons.
7. **COG integration**: Pulls `getAllCogRecords()` to compare against proposed pricing.
8. **Manual entry mode**: Form for entering proposal terms (vendor, category, value, length, discount, rebate, minimum spend, market share).
9. **Scenario modeling**: Sliders for discount and volume increase to see impact.

### Production Flow
1. **Component**: `components/facility/analysis/prospective-client.tsx`
2. **Props**: `facilityId` for data scoping.
3. **Analysis**: `useAnalyzeProposal()` mutation + `useCOGStats()` for baseline data.
4. **Tabs** (4 sub-components):
   - `ProposalUploadTab`: File upload for proposals.
   - `PricingComparisonTab`: Item-level pricing comparison.
   - `AnalysisOverviewTab`: Summary with deal score.
   - `ProposalListTab`: History of analyzed proposals.
5. **Deal scoring**: `ProposalAnalysis` type with `dealScore` containing: financialValue, rebateEfficiency, pricingCompetitiveness, marketShareAlignment, complianceLikelihood. Recommendation: strong_accept, accept, negotiate, reject.
6. **Comparison rows**: Total Cost, Avg Unit Price computed from analysis.
7. **Scenario modeling**: `scenarioDiscount` and `scenarioVolumeIncrease` sliders.
8. **Radar chart**: 6 dimensions from dealScore.

### Differences

| Aspect | v0 | Production | Impact |
|--------|-----|-----------|--------|
| **Score dimensions** | 5: costSavings, priceCompetitiveness, rebateAttainability, lockInRisk, totalCostOfOwnership | 5: financialValue, rebateEfficiency, pricingCompetitiveness, marketShareAlignment, complianceLikelihood + costSavings | Different naming/focus |
| **Recommendation levels** | accept, negotiate, decline | strong_accept, accept, negotiate, reject | Prod has 4 levels vs 3 |
| **Component structure** | Monolithic | 4 sub-tab components | Prod better organized |
| **COG integration** | Direct from `getAllCogRecords()` store | Via `useCOGStats()` hook (server data) | Prod uses real data |
| **Proposal history** | Not clearly present | `ProposalListTab` component | Production improvement |
| **Manual entry** | Full form for manual proposal entry | `manualEntry` state exists in component | Both support it |
| **Pricing file analysis** | Dedicated `PricingAnalysis` type with item-level COG matching | `PricingComparisonTab` component | Need to verify parity |
| **Scenario modeling** | Sliders for discount + volume | Same sliders | Parity |

### Required Changes
- [ ] **Verify pricing file item-level comparison** matches v0 detail (items below/above COG, variance %)
- [ ] **Verify lockInRisk and totalCostOfOwnership** dimensions are captured (v0 facility-centric scores)
- [ ] **Verify manual entry form** has all v0 fields (vendor, category, value, length, discount, rebate, minimum spend, market share)

---

## Flow 7: Dashboard

### v0 Flow
1. **Page**: `app/dashboard/page.tsx` -- simple layout component.
2. **Components**: `DashboardMetrics`, `DashboardCharts`, `DashboardFilters`, `RecentContracts`, `RecentAlerts`.
3. **Date range filter**: `from` and `to` as Date objects, default undefined (all time).
4. **Layout**: Filters -> Metrics (4 cards) -> Charts (2-col) -> Recent (2-col: contracts + alerts).
5. **Data source**: Client-side stores.
6. **Loading**: Suspense boundaries with Skeleton fallbacks.

### Production Flow
1. **Component**: `components/facility/dashboard/dashboard-client.tsx`
2. **Components**: `DashboardFilters`, `DashboardStats`, `TotalSpendChart`, `SpendByVendorChart`, `SpendByCategoryChart`, `RecentContracts`, `RecentAlerts`.
3. **Date range**: Default 12-month lookback (from 1 year ago to now) as ISO strings.
4. **Data hooks**: `useDashboardStats`, `useMonthlySpend`, `useSpendByVendor`, `useSpendByCategory`, `useRecentContracts`, `useRecentAlerts` -- all query hooks with facilityId + dateRange.
5. **Layout**: Header -> Filters -> Metrics (4 cards) -> Charts (full-width spend trend, then 2-col vendor + category) -> Recent (2-col).
6. **Loading**: Conditional render with Skeleton fallbacks per section.

### Differences

| Aspect | v0 | Production | Impact |
|--------|-----|-----------|--------|
| **Default date range** | All time (undefined) | Last 12 months | Prod shows relevant data by default |
| **Charts** | `DashboardCharts` (single component) | 3 separate charts: TotalSpendChart, SpendByVendorChart, SpendByCategoryChart | Prod is more modular |
| **Chart layout** | 2-column grid | Full-width trend + 2-col vendor/category | Prod has better hierarchy |
| **Data source** | Client-side stores | Server queries via React Query hooks | Prod uses real data |
| **Loading strategy** | React Suspense boundaries | Conditional render with Skeletons | Similar UX |
| **Facility scoping** | Implicit from active facility | Explicit `facilityId` prop | Prod is explicit |

### Required Changes
- [ ] **Verify metrics match** -- compare the 4 stat cards between v0 and production
- [ ] **Verify chart types match** -- ensure same visualizations (spend trend, vendor breakdown, etc.)
- [ ] **Verify recent items** show same fields and link to same destinations
