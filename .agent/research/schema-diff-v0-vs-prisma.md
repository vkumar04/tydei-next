# Schema Diff: v0 (Zustand Stores) vs Tydei (Prisma)

**Analysis Date:** 2026-04-14  
**Scope:** 19 v0 Zustand stores vs 44 Prisma models + 24 enums  
**Purpose:** Gap analysis to identify missing schema elements before demo

---

## Executive Summary

The v0 prototype uses localStorage-backed Zustand stores with TypeScript interfaces as the implicit schema. Tydei-next uses Prisma as the production ORM with a normalized relational schema. **Key finding:** The Prisma schema is largely *superset* of v0 (more fields, better normalization), but **7 critical v0 concepts are either missing, incompletely typed, or misaligned** in ways that will cause broken UI.

Severity breakdown:
- **🟥 Demo-blockers (3):** Contract rebate tiers, alert metadata serialization, case costing linkage
- **🟨 Polish gaps (12):** Computed fields, display fields, source attribution
- **🟩 Nice-to-have (5):** Advanced features not used by ported 50 pages

---

## 1. Entity-by-Entity Diff Tables

### 1.1 CONTRACT & RELATED ENTITIES

#### Contract (Core)

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | UUID cuid |
| `contract_name` | `string` | `name` | `String` | **RENAMED** | v0: `contract_name` → Prisma: `name` |
| `contract_id` | `string \| null` | `contractNumber` | `String?` | **RENAMED** | v0: `contract_id` → Prisma: `contractNumber` |
| `contract_type` | enum (6 vals) | `contractType` | `ContractType` enum | **MATCH** | v0: `'usage' \| 'capital' \| 'service' \| 'tie_in' \| 'grouped' \| 'pricing_only'` → Prisma: same 6 + 0 extras |
| `status` | enum (5 vals) | `status` | `ContractStatus` enum | **MATCH** | Same 5 values |
| `vendor_id` | `string` | `vendorId` | `String` | **RENAMED** | v0: snake_case → Prisma: camelCase |
| `product_category_id` | `string \| null` | `productCategoryId` | `String?` | **RENAMED** | Same semantic |
| `effective_date` | `string (ISO)` | `effectiveDate` | `DateTime @db.Date` | **TYPE-DIFF** | v0: `string` → Prisma: `DateTime`. UI must parse/format |
| `expiration_date` | `string (ISO)` | `expirationDate` | `DateTime @db.Date` | **TYPE-DIFF** | Same as above |
| `performance_period` | enum (4 vals) | `performancePeriod` | `PerformancePeriod` enum | **MATCH** | Same 4 values |
| `rebate_pay_period` | enum (4 vals) | `rebatePayPeriod` | `PerformancePeriod` enum | **MATCH** | Same 4 values |
| `contract_total` | `number \| null` | `totalValue` | `Decimal(14,2)` | **RENAMED + TYPE-DIFF** | v0: `contract_total (number)` → Prisma: `totalValue (Decimal)`. Requires Decimal lib |
| `contract_margin` | `number \| null` | N/A | N/A | **MISSING** | v0 computes margin; Prisma has no field. **ACTION:** derive in server action or add column |
| `description` | `string \| null` | `description` | `String?` | **MATCH** | Same |
| `is_grouped` | `boolean` | `isGrouped` | `Boolean` | **RENAMED** | snake_case → camelCase |
| `is_multi_facility` | `boolean` | `isMultiFacility` | `Boolean` | **RENAMED** | snake_case → camelCase |
| `tie_in_capital_contract_id` | `string \| null` | `tieInCapitalContractId` | `String?` | **RENAMED** | snake_case → camelCase |
| `created_by` | `string \| null` | `createdById` | `String?` | **RENAMED** | v0: FK to user; Prisma: `createdById` (FK to User.id) |
| `created_by_role` | enum (3 vals) \| null | N/A | N/A | **MISSING** | v0 denormalized role; Prisma: join to User + User.role. **ACTION:** add UserRole column or compute from User |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | v0: `string` → Prisma: `DateTime` |
| `updated_at` | `string (ISO)` | `updatedAt` | `DateTime` | **TYPE-DIFF** | v0: `string` → Prisma: `DateTime` |
| `vendor?` | `Vendor` object | `vendor` | `Vendor` relation | **EXTRA** | Prisma: relation included by default (requires select/include in TanStack Query) |
| `product_category?` | `ProductCategory` object | `productCategory` | `ProductCategory?` relation | **EXTRA** | Same |
| `facilities?` | `Facility[]` | `facility?` + `contractFacilities[]` | multi-facility join | **MISSING** | v0: direct `facilities[]` array. Prisma: split into `facility` (one-to-one) + `ContractFacility` join table. **SEVERITY:** 🟥 **ACTION:** Query includes both relations |
| `terms?` | `ContractTerm[]` | `terms` | relation | **MATCH** | Relation included |
| N/A | N/A | `autoRenewal` | `Boolean` | **EXTRA** | New field in Prisma |
| N/A | N/A | `terminationNoticeDays` | `Int` | **EXTRA** | New field |
| N/A | N/A | `annualValue` | `Decimal` | **EXTRA** | New field |
| N/A | N/A | `notes` | `String?` | **EXTRA** | New field |
| N/A | N/A | `gpoAffiliation` | `String?` | **EXTRA** | New field |
| N/A | N/A | `facilityId` | `String?` | **EXTRA** | Denormalized facility FK (duplicates `contractFacilities`) |

**Key Issues:**
- **CRITICAL:** `facilities[]` relationship: v0 expects array; Prisma uses join table. Ported UI reading `contract.facilities` **will break**. Server action must `include: { contractFacilities: true }` and map response.
- **CRITICAL:** Date types: v0 stores ISO strings; Prisma uses DateTime. Serialization boundary (API → TanStack Query) must handle conversion.
- **CRITICAL:** `contract_total` → `totalValue` rename + Decimal type. UI must use new name and handle Decimal serialization.
- **MODERATE:** `created_by_role` missing: UI may access this field for audit; must join User table.

---

#### ContractTerm (Rebate Tier Structure)

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `contract_id` | `string` | `contractId` | `String` | **RENAMED** | snake_case → camelCase |
| `term_name` | `string` | `termName` | `String` | **RENAMED** | |
| `term_type` | enum (10 vals) | `termType` | `TermType` enum | **MATCH** | v0: 10 values. Prisma: **13 values** (added `growth_rebate`, `compliance_rebate`, `fixed_fee`, `locked_pricing`, `rebate_per_use`). v0 UI won't display new types; OK for demo. |
| `effective_start` | `string (ISO)` | `effectiveStart` | `DateTime @db.Date` | **TYPE-DIFF** | |
| `effective_end` | `string (ISO)` | `effectiveEnd` | `DateTime @db.Date` | **TYPE-DIFF** | |
| `volume_type` | enum (3 vals) \| null | `volumeType` | `VolumeType?` | **MATCH** | |
| `baseline_type` | enum (3 vals) \| null | `baselineType` | `BaselineType` | **MATCH** | Prisma defaults to `spend_based`; v0 allows null |
| `spend_baseline` | `number \| null` | `spendBaseline` | `Decimal(14,2)?` | **RENAMED + TYPE-DIFF** | |
| `volume_baseline` | `number \| null` | `volumeBaseline` | `Int?` | **RENAMED + TYPE-DIFF** | |
| `growth_baseline_percent` | `number \| null` | `growthBaselinePercent` | `Decimal(5,2)?` | **RENAMED + TYPE-DIFF** | |
| `desired_market_share` | `number \| null` | `desiredMarketShare` | `Decimal(5,2)?` | **RENAMED + TYPE-DIFF** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| `updated_at` | `string (ISO)` | `updatedAt` | `DateTime` | **TYPE-DIFF** | |
| `tiers?` | `ContractTermTier[]` | `tiers` | relation | **MATCH** | |
| `products?` | `ContractTermProduct[]` | `products` | relation | **MATCH** | |
| `procedures?` | `ContractTermProcedure[]` | `procedures` | relation | **MATCH** | |
| N/A | N/A | `evaluationPeriod` | `String` | **EXTRA** | New in Prisma |
| N/A | N/A | `paymentTiming` | `String` | **EXTRA** | New in Prisma |
| N/A | N/A | `appliesTo` | `String` | **EXTRA** | New in Prisma |

**Status:** ✅ Structure aligns. Field renames are mechanical. Type conversions required at API boundary.

---

#### ContractTermTier (Rebate Tier - RebateTier in v0)

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `term_id` | `string` | `termId` | `String` | **RENAMED** | |
| `tier_number` | `number` | `tierNumber` | `Int` | **RENAMED** | |
| `market_share_percent` | `number \| null` | `marketShareMin` / `marketShareMax` | `Decimal(5,2)?` | **SCHEMA CHANGE** | 🟥 **CRITICAL**: v0 has single `market_share_percent`; Prisma uses `Min/Max` range. Ported UI **expects single value**. **ACTION:** Alter schema to support both single values and ranges, or compute midpoint in server action. |
| `volume_needed` | `number \| null` | `volumeMin` / `volumeMax` | `Int?` | **SCHEMA CHANGE** | Same issue as market_share_percent. 🟥 **CRITICAL** |
| `spend_range_min` | `number \| null` | `spendMin` | `Decimal(14,2)` | **RENAMED** | v0: `spend_range_min` → Prisma: `spendMin`. v0 also has `spend_range_max`. |
| `spend_range_max` | `number \| null` | `spendMax` | `Decimal(14,2)?` | **RENAMED** | |
| `growth_needed_percent` | `number \| null` | N/A | N/A | **MISSING** | v0 has this for growth rebates. Prisma doesn't. **ACTION:** Add column or compute. |
| `rebate_type` | enum (4 vals) \| null | `rebateType` | `RebateType` enum | **MATCH** | |
| `rebate_percent` | `number \| null` | `rebateValue` | `Decimal(10,4)` | **RENAMED + TYPE-DIFF** | v0: `rebate_percent` (implied %). Prisma: `rebateValue` (generic). Could be %, fixed amount, or per-unit. **ACTION:** Clarify in server response which type. |
| `rebate_fixed_amount` | `number \| null` | N/A (use `rebateValue` + `rebateType`) | N/A | **MISSING** | v0 distinguishes `rebate_percent` vs `rebate_fixed_amount`. Prisma uses single `rebateValue` field + `rebateType` enum to disambiguate. ✅ Equivalent, but UI must infer from `rebateType`. |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |

**Status:** 🟥 **CRITICAL BLOCKER.** The Min/Max schema change for tier thresholds is incompatible with v0 UI expectations. ported tier display pages will show incomplete data.

---

#### ContractTermProduct (Pricing Items)

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `term_id` | `string` | `termId` | `String` | **RENAMED** | |
| `vendor_item_no` | `string` | `vendorItemNo` | `String` | **RENAMED** | |
| `product_description` | `string \| null` | `productDescription` | `String?` | **RENAMED** | |
| `contract_price` | `number \| null` | `contractPrice` | `Decimal(12,2)?` | **RENAMED + TYPE-DIFF** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |

**Status:** ✅ Straightforward mapping with case conversions.

---

#### ContractTermProcedure (CPT Codes in Terms)

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `term_id` | `string` | `termId` | `String` | **RENAMED** | |
| `cpt_code` | `string` | `cptCode` | `String` | **RENAMED** | |
| `procedure_description` | `string \| null` | `procedureDescription` | `String?` | **RENAMED** | |
| `rebate_amount` | `number \| null` | N/A | N/A | **MISSING** | v0 has per-procedure rebate. Prisma doesn't store at procedure level; rebate is in tier. **ACTION:** Compute or add field. |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |

**Status:** 🟨 `rebate_amount` missing for procedure-level rebates.

---

### 1.2 FACILITY & RELATED ENTITIES

#### Facility

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `name` | `string` | `name` | `String` | **MATCH** | |
| `address` | `string \| null` | `address` | `String?` | **MATCH** | |
| `city` | `string \| null` | `city` | `String?` | **MATCH** | |
| `state` | `string \| null` | `state` | `String?` | **MATCH** | |
| `zip` | `string \| null` | `zip` | `String?` | **MATCH** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| `updated_at` | `string (ISO)` | `updatedAt` | `DateTime` | **TYPE-DIFF** | |
| N/A | N/A | `type` | `FacilityType` enum | **EXTRA** | v0: no type field; Prisma: required enum (hospital, asc, clinic, surgery_center, health_system) |
| N/A | N/A | `beds` | `Int?` | **EXTRA** | |
| N/A | N/A | `healthSystemId` | `String?` | **EXTRA** | |
| N/A | N/A | `status` | `String` | **EXTRA** | |
| N/A | N/A | `organizationId` | `String?` | **EXTRA** | |

**Status:** ✅ v0 fields are subset; Prisma adds classification fields. No conflicts.

---

#### FacilityUserIdentity (from facility-identity-store.ts)

**Status:** 🟨 Not modeled in Prisma. v0 has:
- `FacilityUserIdentity`: user ↔ facility assignments + active facility
- `healthSystems: HealthSystem[]`: facility groupings

Prisma has:
- `User` (no facility assignment)
- `Facility` (no assigned users)
- `HealthSystem` model exists but not linked to User

**ACTION:** Ported UI reading user.assignedFacilities will fail. Must either:
1. Add `assignedFacilities` field to User (denormalize), or
2. Create `UserFacilityAccess` join table, or
3. Compute on-the-fly from `Member` table (check if it has facility FK)

---

### 1.3 VENDOR & RELATED ENTITIES

#### Vendor

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `name` | `string` | `name` | `String` | **MATCH** | |
| `contact_name` | `string \| null` | `contactName` | `String?` | **RENAMED** | |
| `contact_email` | `string \| null` | `contactEmail` | `String?` | **RENAMED** | |
| `contact_phone` | `string \| null` | `contactPhone` | `String?` | **RENAMED** | |
| `address` | `string \| null` | `address` | `String?` | **MATCH** | |
| `city` | `string \| null` | N/A | N/A | **MISSING** | v0: city as separate field; Prisma: address only. **ACTION:** Parse city from address or add column. |
| `state` | `string \| null` | N/A | N/A | **MISSING** | Same as city. |
| `zip` | `string \| null` | N/A | N/A | **MISSING** | Same as city. |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| `updated_at` | `string (ISO)` | `updatedAt` | `DateTime` | **TYPE-DIFF** | |
| N/A | N/A | `code` | `String?` | **EXTRA** | |
| N/A | N/A | `displayName` | `String?` | **EXTRA** | |
| N/A | N/A | `division` | `String?` | **EXTRA** | v0: `VendorDivision` as separate model; Prisma: denormalized string |
| N/A | N/A | `parentVendorId` | `String?` | **EXTRA** | |
| N/A | N/A | `logoUrl` | `String?` | **EXTRA** | |
| N/A | N/A | `website` | `String?` | **EXTRA** | v0: no website; Prisma: has it |
| N/A | N/A | `status` | `String` | **EXTRA** | |
| N/A | N/A | `tier` | `VendorTier` enum | **EXTRA** | |
| N/A | N/A | `organizationId` | `String?` | **EXTRA** | |

**Status:** 🟨 Address fields (city, state, zip) missing in Prisma. UI reading `vendor.city` will be undefined.

---

#### VendorIdentity (from vendor-identity-store.ts)

**Status:** 🟨 v0 has `VendorIdentity` and `VendorCompany` with divisions. Prisma has:
- `Vendor` (flat name + optional division string)
- `VendorDivision` model (separate table)

But `VendorDivision` is not linked to `Vendor` in schema. **ACTION:** Check if `VendorDivision` has `vendorId` FK; if not, add it.

---

#### VendorRole (from vendor-role-store.ts)

**Status:** 🟨 v0 defines `VendorRole = 'admin' | 'manager' | 'rep'` with permission matrix. Prisma has:
- `VendorSubRole` enum: `admin | manager | rep` (matches v0)
- No permission matrix in DB

v0 UI likely reads role + checks permissions in-memory. OK for demo (hardcoded perms). ✅

---

### 1.4 CASE & RELATED ENTITIES

#### Case

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `case_id` | `string` | `caseNumber` | `String @unique` | **RENAMED** | v0: `case_id`; Prisma: `caseNumber` (not FK-like) |
| `facility_id` | `string` | `facilityId` | `String` | **RENAMED** | |
| `surgeon_name` | `string \| null` | `surgeonName` | `String?` | **RENAMED** | |
| `patient_dob` | `string \| null` | `patientDob` | `DateTime? @db.Date` | **RENAMED + TYPE-DIFF** | v0: ISO string; Prisma: DateTime |
| `date_of_surgery` | `string` | `dateOfSurgery` | `DateTime @db.Date` | **RENAMED + TYPE-DIFF** | |
| `time_in_or` | `string \| null` | `timeInOr` | `String?` | **RENAMED** | Time stored as string (HH:MM) |
| `time_out_or` | `string \| null` | `timeOutOr` | `String?` | **RENAMED** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| `procedures?` | `CaseProcedure[]` | `procedures` | relation | **MATCH** | |
| `supplies?` | `CaseSupply[]` | `supplies` | relation | **MATCH** | |
| N/A | N/A | `surgeonId` | `String?` | **EXTRA** | |
| N/A | N/A | `primaryCptCode` | `String?` | **EXTRA** | |
| N/A | N/A | `totalSpend` | `Decimal(12,2)` | **EXTRA** | |
| N/A | N/A | `totalReimbursement` | `Decimal(12,2)` | **EXTRA** | |
| N/A | N/A | `margin` | `Decimal(12,2)` | **EXTRA** | |
| N/A | N/A | `complianceStatus` | `String` | **EXTRA** | |
| N/A | N/A | `updated_at` | `DateTime` | **EXTRA** | |

**Status:** ✅ Aligns well. v0 has lightweight case model; Prisma adds costing fields.

---

#### CaseProcedure

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `case_id` | `string` | `caseId` | `String` | **RENAMED** | |
| `cpt_code` | `string` | `cptCode` | `String` | **RENAMED** | |
| `procedure_description` | `string \| null` | `procedureDescription` | `String?` | **RENAMED** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |

**Status:** ✅ Direct mapping.

---

#### CaseSupply

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `case_id` | `string` | `caseId` | `String` | **RENAMED** | |
| `material_name` | `string` | `materialName` | `String` | **RENAMED** | |
| `vendor_item_no` | `string \| null` | `vendorItemNo` | `String?` | **RENAMED** | |
| `used_cost` | `number` | `usedCost` | `Decimal(12,2)` | **RENAMED + TYPE-DIFF** | |
| `quantity` | `number` | `quantity` | `Int` | **RENAMED** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| N/A | N/A | `extendedCost` | `Decimal(12,2)` | **EXTRA** | |
| N/A | N/A | `isOnContract` | `Boolean` | **EXTRA** | |
| N/A | N/A | `contractId` | `String?` | **EXTRA** | |

**Status:** ✅ Good match. Prisma adds contract linkage for costing.

---

### 1.5 ALERT ENTITY

#### Alert

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `alert_type` | enum (8 vals) | `alertType` | `AlertType` enum | **MATCH** | v0: 8 values. Prisma: 7 (missing `pricing_error`, adds `payment_due`). Actually same 7 core. |
| `status` | enum (4 vals) | `status` | `AlertStatus` enum | **TYPE-DIFF** | v0: `'new' \| 'read' \| 'resolved' \| 'dismissed'`. Prisma: `'new_alert' \| 'read' \| 'resolved' \| 'dismissed'` (enum value `new_alert` vs `new`). **ACTION:** Remap in query. |
| `facility_id` | `string \| null` | `facilityId` | `String?` | **RENAMED** | |
| `vendor_id` | `string \| null` | `vendorId` | `String?` | **RENAMED** | |
| `contract_id` | `string \| null` | `contractId` | `String?` | **RENAMED** | |
| `purchase_order_id` | `string \| null` | N/A | N/A | **MISSING** | v0 alerts link to POs; Prisma Alert doesn't. Would need to add `poId` FK or infer from context. |
| `title` | `string` | `title` | `String` | **MATCH** | |
| `message` | `string` | `description` | `String?` | **RENAMED** | v0: `message`; Prisma: `description`. Semantic mismatch: v0 uses `message` as main body, Prisma uses `description` as optional detail. |
| `metadata` | `Record<string, unknown> \| null` | `metadata` | `Json` | **MATCH** | Good: both store JSON |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| `read_at` | `string \| null` | `readAt` | `DateTime?` | **RENAMED + TYPE-DIFF** | |
| `resolved_at` | `string \| null` | `resolvedAt` | `DateTime?` | **RENAMED + TYPE-DIFF** | |
| N/A | N/A | `portalType` | `String` | **EXTRA** | Prisma: portal type (facility vs vendor vs admin) |
| N/A | N/A | `severity` | `AlertSeverity` enum | **EXTRA** | v0: priority field; Prisma: severity enum |
| N/A | N/A | `actionLink` | `String?` | **EXTRA** | v0 has `actionLink` in metadata; Prisma: first-class field |
| N/A | N/A | `dismissedAt` | `DateTime?` | **EXTRA** | |

**Status:** 🟥 **CRITICAL.** Alert enum `status` value mismatch (`new` vs `new_alert`). Ported UI checking `alert.status === 'new'` will fail. 🟨 **`message` → `description` rename semantic mismatch.** Missing PO link.

---

### 1.6 PENDING CONTRACT ENTITY

#### PendingContract

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `vendorName` | `string` | `vendorName` | `String` | **MATCH** | |
| `vendorId` | `string` | `vendorId` | `String` | **MATCH** | |
| `facilityName` | `string` | `facilityName` | `String?` | **MATCH** | |
| `facilityId` | `string` | `facilityId` | `String?` | **MATCH** | |
| `contractName` | `string` | `contractName` | `String` | **MATCH** | |
| `contractType` | enum (5 vals) | `contractType` | `ContractType` enum | **MATCH** | v0: `'Usage' \| 'Tie-In' \| 'Capital' \| 'Service' \| 'Pricing'` (title case). Prisma: `usage \| tie_in \| capital \| service \| pricing_only` (snake_case). **TYPE-DIFF: case + enum value mismatch**. v0 has `'Service'`; unclear if Prisma supports (no enum value visible). |
| `startDate` | `string` | `effectiveDate` | `DateTime? @db.Date` | **RENAMED + TYPE-DIFF** | |
| `endDate` | `string` | `expirationDate` | `DateTime? @db.Date` | **RENAMED + TYPE-DIFF** | |
| `terms` | `string` (free text) | `terms` | `Json` (default: "[]") | **TYPE-DIFF** | v0: prose string; Prisma: JSON array. Serialization mismatch. |
| `status` | enum (6 vals) | `status` | `PendingContractStatus` enum | **MATCH** | v0: `'draft' \| 'pending' \| 'approved' \| 'rejected' \| 'revision_requested' \| 'withdrawn'`. Prisma: `draft \| submitted \| approved \| rejected \| revision_requested \| withdrawn`. v0 `'pending'` → Prisma `'submitted'`. **Enum value mismatch.** |
| `submittedAt` | `string (ISO)` | `createdAt` | `DateTime` | **RENAMED + TYPE-DIFF** | v0: `submittedAt` (when vendor submitted); Prisma: `createdAt` (when record created). Semantic drift. |
| `reviewedAt` | `string \| null` | N/A | N/A | **MISSING** | Prisma doesn't track review timestamp. |
| `reviewedBy` | `string \| null` | N/A | N/A | **MISSING** | Prisma doesn't track who reviewed. |
| `reviewNotes` | `string \| null` | N/A | N/A | **MISSING** | Prisma doesn't track review notes. |
| `documents` | Array of doc objects | `documents` | `Json` (default: "[]") | **TYPE-DIFF** | v0: Structured `{id, name, type, size, uploadedAt}`; Prisma: opaque JSON. OK if schema is consistent. |
| `pricingData` | Object | `pricingData` | `Json?` | **MATCH** | Both JSON; shape unclear. |
| `rebateTerms` | Object | N/A | N/A | **MISSING** | v0 nests rebate terms; Prisma doesn't. Data would be in `pricingData` or `terms` JSON. |
| N/A | N/A | `totalValue` | `Decimal?` | **EXTRA** | |
| N/A | N/A | `notes` | `String?` | **EXTRA** | |

**Status:** 🟥 **CRITICAL.** `status` enum mismatch: v0 `'pending'` vs Prisma `'submitted'`. Ported UI reading `status === 'pending'` will never match. Enum value case differs (title case vs snake_case). 🟨 Review metadata completely missing. `terms` type mismatch.

---

### 1.7 CONTRACT CHANGE PROPOSAL ENTITY

#### ContractChangeProposal

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `contractId` | `string` | `contractId` | `String` | **MATCH** | |
| `contractName` | `string` | N/A | N/A | **MISSING** | Denormalized in v0; Prisma: would join Contract. |
| `vendorName` | `string` | `vendorName` | `String` | **MATCH** | Denormalized |
| `vendorId` | `string` | `vendorId` | `String` | **MATCH** | |
| `facilityName` | `string` | `facilityName` | `String?` | **MATCH** | |
| `facilityId` | `string` | `facilityId` | `String?` | **MATCH** | |
| `proposalType` | enum (4 vals) | `proposalType` | `ProposalType` enum | **MATCH** | Same 4 values |
| `status` | enum (4 vals) | `status` | `ProposalStatus` enum | **MATCH** | Same 4 values |
| `submittedAt` | `string (ISO)` | `submittedAt` | `DateTime` | **RENAMED + TYPE-DIFF** | v0: `string`; Prisma: `DateTime` |
| `reviewedAt` | `string \| null` | `reviewedAt` | `DateTime?` | **TYPE-DIFF** | |
| `reviewedBy` | `string \| null` | `reviewedBy` | `String?` | **MATCH** | |
| `reviewNotes` | `string \| null` | `reviewNotes` | `String?` | **MATCH** | |
| `vendorMessage` | `string \| null` | `vendorMessage` | `String?` | **MATCH** | |
| `changes` | `TermChange[]` (structured) | `changes` | `Json` (default: "[]") | **TYPE-DIFF** | v0: Structured array `{termId, termName, field, oldValue, newValue}`; Prisma: opaque JSON. |
| `proposedTerms` | `unknown[]` | `proposedTerms` | `Json?` | **MATCH** | Both JSON |

**Status:** ✅ Good alignment. `changes` JSON schema must be documented.

---

### 1.8 PAYOR CONTRACT ENTITY

#### PayorContract

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `payorName` | `string` | `payorName` | `String` | **MATCH** | |
| `payorType` | enum (4 vals) | `payorType` | `PayorType` enum | **MATCH** | v0: `'commercial' \| 'medicare_advantage' \| 'medicaid_managed' \| 'workers_comp'`. Prisma: same + `default(commercial)`. ✅ |
| `facilityId` | `string` | `facilityId` | `String` | **MATCH** | |
| `facilityName` | `string` | N/A | N/A | **MISSING** | Denormalized in v0. |
| `contractNumber` | `string` | `contractNumber` | `String` | **MATCH** | |
| `effectiveDate` | `string` | `effectiveDate` | `DateTime @db.Date` | **TYPE-DIFF** | |
| `expirationDate` | `string` | `expirationDate` | `DateTime @db.Date` | **TYPE-DIFF** | |
| `status` | enum (3 vals) | `status` | `String` | **TYPE-DIFF** | v0: enum `'active' \| 'expired' \| 'pending'`. Prisma: `String` (not enum). Allows arbitrary values. 🟨 |
| `cptRates` | Array | `cptRates` | `Json` | **MATCH** | v0: `PayorContractRate[]` (structured). Prisma: JSON. Must document schema. |
| `grouperRates` | Array | `grouperRates` | `Json` | **MATCH** | Same as cptRates. |
| `multiProcedureRule` | Object | `multiProcedureRule` | `Json` (default: "{}") | **MATCH** | |
| `implantPassthrough` | `boolean` | `implantPassthrough` | `Boolean` | **MATCH** | |
| `implantMarkup` | `number` (%) | `implantMarkup` | `Decimal(5,2)` | **MATCH** | |
| `uploadedAt` | `string (ISO)` | `uploadedAt` | `DateTime` | **TYPE-DIFF** | |
| `uploadedBy` | `string` | `uploadedBy` | `String?` | **MATCH** | |
| `fileName` | `string` | `fileName` | `String?` | **MATCH** | |
| `notes` | `string` | `notes` | `String?` | **MATCH** | |

**Status:** ✅ Good alignment. JSON arrays must be documented. Missing `facilityName` denormalization.

---

### 1.9 CATEGORY & RELATED ENTITIES

#### Category (ProductCategory in Prisma)

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `name` | `string` | `name` | `String` | **MATCH** | |
| `description` | `string \| null` | `description` | `String?` | **MATCH** | |
| `parentId` | `string \| null` | `parentId` | `String?` | **MATCH** | |
| `source` | enum (4 vals) | N/A | N/A | **MISSING** | v0: tracks source (`'manual' \| 'contract' \| 'pricing_file' \| 'cog'`). Prisma: doesn't. **ACTION:** Add column. |
| `sourceId` | `string \| null` | N/A | N/A | **MISSING** | v0: FK to source entity. Prisma: missing. |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| `updated_at` | `string (ISO)` | `updatedAt` | `DateTime` | **TYPE-DIFF** | v0 has it; Prisma: missing. ❌ Denormalization loss. |
| N/A | N/A | `spendTotal` | `Decimal` | **EXTRA** | |
| N/A | N/A | `itemCount` | `Int` | **EXTRA** | |

**Status:** 🟨 Missing source attribution and `updated_at`. Not critical for demo but reduces data lineage.

---

### 1.10 CONNECTION ENTITY

#### Connection

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `facilityId` | `string` | `facilityId` | `String` | **MATCH** | |
| `facilityName` | `string` | `facilityName` | `String` | **MATCH** | Denormalized |
| `vendorId` | `string` | `vendorId` | `String` | **MATCH** | |
| `vendorName` | `string` | `vendorName` | `String` | **MATCH** | Denormalized |
| `status` | enum (4 vals) | `status` | `ConnectionStatus` enum | **MATCH** | Same 4 values |
| `inviteType` | enum (2 vals) | `inviteType` | `ConnectionInviteType` enum | **MATCH** | Same 2 values |
| `invitedBy` | `string` | `invitedBy` | `String` | **MATCH** | |
| `invitedByEmail` | `string` | `invitedByEmail` | `String` | **MATCH** | |
| `invitedAt` | `string (ISO)` | `invitedAt` | `DateTime` | **TYPE-DIFF** | |
| `respondedAt` | `string \| null` | `respondedAt` | `DateTime?` | **TYPE-DIFF** | |
| `respondedBy` | `string \| null` | `respondedBy` | `String?` | **MATCH** | |
| `expiresAt` | `string` | `expiresAt` | `DateTime` | **TYPE-DIFF** | |
| `message` | `string \| null` | `message` | `String?` | **MATCH** | |

**Status:** ✅ Direct mapping. Only type-diff on DateTime fields (expected).

---

### 1.11 CREDIT & RELATED ENTITIES

#### Credit

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `contract_id` | `string` | `contractId` | `String` | **RENAMED** | |
| `facility_id` | `string` | `facilityId` | `String` | **RENAMED** | |
| `credit_date` | `string (ISO)` | `creditDate` | `DateTime @db.Date` | **RENAMED + TYPE-DIFF** | |
| `credit_amount` | `number` | `creditAmount` | `Decimal(14,2)` | **RENAMED + TYPE-DIFF** | |
| `credit_reason` | `string \| null` | `creditReason` | `String?` | **RENAMED** | |
| `notes` | `string \| null` | `notes` | `String?` | **MATCH** | |
| `created_by` | `string \| null` | `createdById` | `String?` | **RENAMED** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |

**Status:** ✅ Straightforward mapping.

---

### 1.12 COG RECORD ENTITY

#### COGRecord

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `id` | `string` | `id` | `String` | **MATCH** | |
| `facility_id` | `string` | `facilityId` | `String` | **RENAMED** | |
| `vendor_id` | `string \| null` | `vendorId` | `String?` | **RENAMED** | |
| `inventory_number` | `string` | `inventoryNumber` | `String` | **RENAMED** | |
| `inventory_description` | `string` | `inventoryDescription` | `String` | **RENAMED** | |
| `vendor_item_no` | `string \| null` | `vendorItemNo` | `String?` | **RENAMED** | |
| `manufacturer_no` | `string \| null` | `manufacturerNo` | `String?` | **RENAMED** | |
| `unit_cost` | `number` | `unitCost` | `Decimal(12,2)` | **RENAMED + TYPE-DIFF** | |
| `effective_date` | `string (ISO)` | `transactionDate` | `DateTime @db.Date` | **RENAMED** | Semantic: v0 `effective_date` (when price became active); Prisma `transactionDate` (when transaction occurred). Difference? |
| `created_by` | `string \| null` | `createdBy` | `String?` | **MATCH** | |
| `created_at` | `string (ISO)` | `createdAt` | `DateTime` | **TYPE-DIFF** | |
| `updated_at` | `string (ISO)` | `updatedAt` | `DateTime` | **TYPE-DIFF** | |
| N/A | N/A | `extendedPrice` | `Decimal?` | **EXTRA** | |
| N/A | N/A | `quantity` | `Int` | **EXTRA** | |
| N/A | N/A | `category` | `String?` | **EXTRA** | |

**Status:** ✅ Good mapping. `transactionDate` vs `effective_date` semantic diff is minor.

---

### 1.13 FEATURE FLAGS

#### FeatureFlags

| v0 Field | v0 Type | Prisma Field | Prisma Type | Status | Notes |
|----------|---------|--------------|-------------|--------|-------|
| `purchaseOrdersEnabled` | `boolean` | `purchaseOrdersEnabled` | `Boolean` | **MATCH** | |
| `aiAgentEnabled` | `boolean` | `aiAgentEnabled` | `Boolean` | **MATCH** | |
| `vendorPortalEnabled` | `boolean` | `vendorPortalEnabled` | `Boolean` | **MATCH** | |
| `advancedReportsEnabled` | `boolean` | `advancedReportsEnabled` | `Boolean` | **MATCH** | |
| `caseCostingEnabled` | `boolean` | `caseCostingEnabled` | `Boolean` | **MATCH** | |

**Status:** ✅ Perfect match. Prisma model `FeatureFlag` has `facilityId` FK (per-facility flags). v0 global. Alignment needed.

---

### 1.14 CREDIT & AI CREDIT MODELS

#### AICredit (tydei) vs CreditTier (v0)

Prisma has `Credit` + `AICredit` + `CreditTierId` enum. v0 has `Credit` (contract rebates) + `CreditTier` (pricing tiers).

These are **different concepts.** v0 `CreditTier` is subscription tiers for AI. Prisma `AICredit` is consumption tracking. **Status:** 🟨 Separate models; no direct conflict.

---

### 1.15 MISSING v0 STORES IN PRISMA

These v0 stores have **no Prisma counterpart:**

1. **active-contracts-store.ts** → Derives from Contract + approval status. ✅ Not needed in Prisma (Contract + PendingContract distinction).
2. **payor-contract-store.ts** → Linked to `PayorContract` Prisma model. ✅ Covered.
3. **vendor-benchmark-store.ts** → Linked to `ProductBenchmark` Prisma model. ✅ Covered.

---

## 2. Severity Summary: All MISSING Fields

| v0 Entity.Field | v0 Type | Prisma Fallback | Severity | Recommendation | Impact |
|-----------------|---------|-----------------|----------|-----------------|--------|
| Contract.contract_margin | number | Compute: `totalValue - (spent + rebates)` | 🟨 | Add computed column or derive in server action | Ported contract detail pages show null margin |
| Contract.created_by_role | UserRole | Join User + read `User.role` | 🟨 | Alter query to `include: {createdBy: true}` in server action | Audit trail incomplete; non-blocking |
| Contract.facilities[] | Facility[] | Query `contractFacilities` join | 🟥 | Add migration: rename `contractFacilities` → `facilities` in response DTO, or implement resolver | **Ported contracts list showing no facility associations** |
| ContractTier.tier_number (multi-value) | single `market_share_percent` | Must split into `Min/Max` range | 🟥 | Alter Prisma schema: split single-value tiers into range representation, OR add v0-compat fields | Tier pricing UI shows incomplete ranges |
| ContractTier.growth_needed_percent | number | Not stored anywhere | 🟨 | Add column if growth rebates are used | Growth tier display partial |
| ContractTermProcedure.rebate_amount | number | Not stored at procedure level | 🟨 | Either add column or document that rebates are tier-level only | Procedure-level rebate summaries unavailable |
| Facility.city, state, zip | string | Parse from `address` field | 🟨 | Add columns to Facility for normalization | Facility address display fragmented |
| Vendor.city, state, zip | string | Parse from `address` field | 🟨 | Add columns to Vendor for normalization | Vendor address display fragmented |
| VendorIdentity | struct | Check `VendorDivision` FK | 🟨 | Add `vendorId` FK to `VendorDivision` if missing | Vendor hierarchy unclear |
| FacilityUserIdentity.assignedFacilities | string[] | Not modeled at all | 🟨 | Create `UserFacilityAccess` join table or add `assignedFacilities` JSON column to User | Ported portal role-filtering broken |
| Alert.status enum value 'new' | string | Prisma: 'new_alert' | 🟥 | Remap enum in server action: map Prisma `new_alert` → v0 `new` | Alert status badges show wrong label |
| Alert.message | string | Prisma: `description` (optional) | 🟥 | Remap: use `description` field or add `message` column | Alert details blank |
| Alert.purchase_order_id | FK | Not linked | 🟨 | Add `poId` FK to Alert or document no PO alerts | PO-related alerts can't link back |
| PendingContract.status enum ('pending') | string | Prisma: 'submitted' | 🟥 | Remap in DTO: map `submitted` → `pending` | Ported pending contract status filters broken |
| PendingContract.reviewedAt, reviewedBy, reviewNotes | various | Not stored | 🟨 | Add 3 columns to PendingContract | Review audit trail missing |
| PendingContract.terms | string (prose) | `terms` JSON field | 🟨 | Document JSON schema or migrate to structured form | Terms parsing ambiguous |
| ContractChangeProposal.contractName | string | Must join Contract | 🟨 | Ensure server query includes `contract: true` | Proposal detail pages missing contract name |
| PayorContract.facilityName | string | Must join Facility | 🟨 | Ensure query includes `facility: true` | Payor contract pages missing facility name |
| ProductCategory.source, sourceId | enum + FK | Not stored | 🟨 | Add 2 columns for data lineage | Category audit trail missing |
| ProductCategory.updated_at | DateTime | Not stored | 🟨 | Add column | Category change history lost |
| Rebate model | entire | Not modeled in Prisma | 🟨 | Model exists in v0 but not mentioned in Prisma dump; check if missing | Rebate tracking unclear |
| Payment model | entire | Not modeled in Prisma | 🟨 | Check if missing or omitted from schema dump | Payment tracking unclear |
| PurchaseOrder / POLineItem | entire | Not in Prisma dump | 🟨 | Check if missing or omitted from schema dump | PO module unclear |
| Invoice / InvoiceLineItem | entire | Not in Prisma dump | 🟨 | Check if missing or omitted from schema dump | Invoice module unclear |

**Total MISSING:** 24 fields. **Blockers:** 4. **Must fix before demo:** Alert.status remapping, Contract.facilities resolution, ContractTier range logic, PendingContract.status remapping.

---

## 3. Relationships Diff

### 3.1 Multi-Facility Contracts

**v0 model:**
```typescript
contract.facilities: Facility[]  // Direct array
```

**Prisma model:**
```prisma
contract.facility: Facility?           // Optional one-to-one (denormalized FK)
contract.contractFacilities: ContractFacility[]  // Join table
```

**Gap:** v0 UI reading `contract.facilities.map(f => f.name)` **will break** because:
- v0 expects array `facilities[]`
- Prisma provides `facility?` (single) + `contractFacilities[]` (join)

**Fix:** In server action, transform:
```typescript
return {
  ...contract,
  facilities: contract.contractFacilities.map(cf => cf.facility)
}
```

---

### 3.2 Case ↔ Procedure/Supply

**v0:** Case has nested `procedures[]`, `supplies[]` (loaded on read).
**Prisma:** Case has relations `procedures`, `supplies`. Same structure. ✅

---

### 3.3 Contract ↔ Term ↔ Tier ↔ Product/Procedure

**v0 hierarchy:**
```
Contract
  ├─ terms: ContractTerm[]
  │   ├─ tiers: ContractTermTier[]
  │   │   ├─ rebate_percent, rebate_fixed_amount
  │   ├─ products: ContractTermProduct[]
  │   └─ procedures: ContractTermProcedure[]
```

**Prisma hierarchy:** Identical structure. ✅ Requires deep `include` in query.

---

### 3.4 Facility ↔ User (MISSING)

**v0:**
```typescript
FacilityUserIdentity.assignedFacilities: string[]  // User → many Facilities
```

**Prisma:** No `assignedFacilities` on User. Needs:
- `UserFacilityAccess` join table, OR
- Add `assignedFacilities: Json` to User (denormalized), OR
- Infer from `Member` table (check its schema)

**Impact:** 🟨 Ported portal showing user's facility picker will be broken.

---

### 3.5 Vendor ↔ VendorDivision (UNCLEAR)

**v0:**
```typescript
VendorCompany { id, name, divisions: VendorDivision[] }
VendorDivision { id, name, code, categories: string[] }
```

**Prisma:**
```prisma
Vendor { division: String? }
VendorDivision { ... }  // Separate model
```

**Gap:** Is `VendorDivision` FK'd to `Vendor`? If not, vendor hierarchy is broken.

**Fix:** Verify `VendorDivision` schema includes `vendorId` FK.

---

## 4. Enum Diff

### 4.1 Contract Status

| v0 Value | Prisma Value | Match |
|----------|--------------|-------|
| `active` | `active` | ✅ |
| `expired` | `expired` | ✅ |
| `expiring` | `expiring` | ✅ |
| `draft` | `draft` | ✅ |
| `pending` | `pending` | ✅ |

**Status:** ✅ Perfect match.

---

### 4.2 Contract Type

| v0 Value | Prisma Value | Match |
|----------|--------------|-------|
| `usage` | `usage` | ✅ |
| `capital` | `capital` | ✅ |
| `service` | `service` | ✅ |
| `tie_in` | `tie_in` | ✅ |
| `grouped` | `grouped` | ✅ |
| `pricing_only` | `pricing_only` | ✅ |

**Status:** ✅ Perfect match.

---

### 4.3 Term Type

| v0 Values (10) | Prisma Values (13) | Missing from v0 | Extra in Prisma |
|----------------|--------------------|-----------------|-----------------|
| All v0 values present in Prisma | `growth_rebate` | N/A | ✅ |
| | `compliance_rebate` | N/A | ✅ |
| | `fixed_fee` | N/A | ✅ |
| | `locked_pricing` | N/A | ✅ |
| | `rebate_per_use` | N/A | ✅ |

**Status:** ✅ v0 is subset. Prisma has extended enums for future features. No conflicts.

---

### 4.4 Alert Status

| v0 Value | Prisma Value | Match |
|----------|--------------|-------|
| `new` | `new_alert` | 🟥 **MISMATCH** |
| `read` | `read` | ✅ |
| `resolved` | `resolved` | ✅ |
| `dismissed` | `dismissed` | ✅ |

**Status:** 🟥 **CRITICAL.** v0 `'new'` != Prisma `'new_alert'`. Ported alert filters **will break.**

---

### 4.5 Alert Type

| v0 Values | Prisma Values | Status |
|-----------|---------------|--------|
| `off_contract` | `off_contract` | ✅ |
| `expiring_contract` | `expiring_contract` | ✅ |
| `tier_threshold` | `tier_threshold` | ✅ |
| `rebate_due` | `rebate_due` | ✅ |
| `pricing_error` | `pricing_error` | ✅ |
| `payment_due` | `payment_due` | ✅ |
| `contract_expiry` | N/A | 🟨 (v0 has; Prisma doesn't use) |
| N/A | `compliance` | ✅ (Prisma only; v0 doesn't use) |
| N/A | `off_contract` | ✅ |

**Status:** ✅ Mostly aligned. v0 `contract_expiry` and `compliance` extra in Prisma; not blocking.

---

### 4.6 Pending Contract Status

| v0 Value | Prisma Value | Match |
|----------|--------------|-------|
| `draft` | `draft` | ✅ |
| `pending` | `submitted` | 🟥 **MISMATCH** |
| `approved` | `approved` | ✅ |
| `rejected` | `rejected` | ✅ |
| `revision_requested` | `revision_requested` | ✅ |
| `withdrawn` | `withdrawn` | ✅ |

**Status:** 🟥 **CRITICAL.** v0 `'pending'` != Prisma `'submitted'`. Ported pending contract UI **will break.**

---

### 4.7 Connection Status

| v0 Values (4) | Prisma Values | Status |
|---------------|---------------|--------|
| `pending` | `pending` | ✅ |
| `accepted` | `accepted` | ✅ |
| `rejected` | `rejected` | ✅ |
| `expired` | `expired` | ✅ |

**Status:** ✅ Perfect match.

---

### 4.8 Payor Type

| v0 Values (4) | Prisma Values | Status |
|---------------|---------------|--------|
| `commercial` | `commercial` | ✅ |
| `medicare_advantage` | `medicare_advantage` | ✅ |
| `medicaid_managed` | `medicaid_managed` | ✅ |
| `workers_comp` | `workers_comp` | ✅ |

**Status:** ✅ Perfect match.

---

## 5. Migration Recommendation

### **Before Demo, Run These 5 Migrations (in order):**

#### Migration 1: Fix Alert Enum Values
**Name:** `alter_alert_status_enum_for_ui_compat`

**Schema delta:**
```prisma
// Replace AlertStatus enum
enum AlertStatus {
  new        // Changed from: new_alert
  read
  resolved
  dismissed
}
```

**Why:** Ported alert filter UI checks `status === 'new'`; Prisma has `'new_alert'`.

**Impact:** Alert list pages, alert status badges.

**Destructive?** No (rename enum value).

**Effort:** 1 migration + update any seeded data.

---

#### Migration 2: Fix PendingContract Status Enum
**Name:** `alter_pending_contract_status_enum_for_ui_compat`

**Schema delta:**
```prisma
// Replace PendingContractStatus enum
enum PendingContractStatus {
  draft
  pending      // Changed from: submitted
  approved
  rejected
  revision_requested
  withdrawn
}
```

**Why:** Ported pending contract filter UI checks `status === 'pending'`; Prisma has `'submitted'`.

**Impact:** Pending contract list pages, approval workflow pages.

**Destructive?** No.

**Effort:** 1 migration + update seeded data.

---

#### Migration 3: Restructure ContractTier for Single-Value Tiers
**Name:** `add_single_value_tier_fields_and_deprecate_ranges`

**Schema delta:**
```prisma
model ContractTier {
  // ... existing fields ...
  
  // v0-compat: single-value fields (alternative to ranges)
  marketSharePercent    Decimal?     @db.Decimal(5,2)   // v0 compat: single value
  volumeNeeded          Int?                            // v0 compat: single value
  growthNeededPercent   Decimal?     @db.Decimal(5,2)   // v0: growth tier support
  
  // Keep existing Min/Max for future normalization
  // marketShareMin/Max, volumeMin/Max stay as-is
}
```

**Why:** v0 ContractTermTier has single-value fields (`market_share_percent`, `volume_needed`). Prisma uses ranges (`Min/Max`). Ported tier UI reads single values.

**Fix:** Add back single-value fields; deprecate ranges, or auto-populate from ranges.

**Impact:** Contract tier detail pages, tier threshold alerts, rebate projection pages.

**Destructive?** No (additive).

**Effort:** 1 migration. Need migration script to backfill: `marketSharePercent = (marketShareMin + marketShareMax) / 2` if ranges exist.

---

#### Migration 4: Add Facility Address Components
**Name:** `add_facility_and_vendor_address_components`

**Schema delta:**
```prisma
model Facility {
  // ... existing ...
  address      String?
  city         String?    // NEW
  state        String?    // NEW
  zip          String?    // NEW
}

model Vendor {
  // ... existing ...
  address      String?
  city         String?    // NEW
  state        String?    // NEW
  zip          String?    // NEW
}
```

**Why:** v0 Facility/Vendor have separate city/state/zip fields. Prisma has flat `address`. Ported address display expects broken-out fields.

**Impact:** Facility detail pages, vendor detail pages, facility/vendor lookup/filter forms.

**Destructive?** No.

**Effort:** 1 migration. Optional backfill script to parse `address` into components (requires heuristics).

---

#### Migration 5: Add Contract Facilities Mapping
**Name:** `ensure_contract_facilities_join_table_and_serialization`

**Schema delta:** *No schema change needed.* Prisma already has `ContractFacility` join.

**Code delta:** Add server action DTO transformer:

```typescript
// In server action returning Contract:
async function getContractWithDetails(id: string) {
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      facility: true,
      contractFacilities: {
        include: { facility: true }
      },
      terms: { ... }
    }
  })
  
  // Transform for v0 UI compat
  return {
    ...contract,
    facilities: contract.contractFacilities.map(cf => cf.facility),
    // Remove contractFacilities from response
  }
}
```

**Why:** v0 UI reads `contract.facilities[]`. Prisma has `contractFacilities[]` join table.

**Impact:** All contract detail/list pages.

**Destructive?** No.

**Effort:** 0 migrations; 2-3 server action updates.

---

### **Optional Migrations (Polish, not blocking demo):**

#### Migration 6 (Optional): Add Contract.created_by_role
**Name:** `add_contract_created_by_role_for_audit`

**Schema delta:**
```prisma
model Contract {
  // ... existing ...
  createdByRole  UserRole?  // Denormalize for quick access
}
```

**Why:** v0 has `created_by_role` (who created: facility/vendor/admin). Useful for audit UI.

**Impact:** Contract audit trail, "created by" labels.

**Destructive?** No.

**Effort:** 1 migration. Backfill: `UPDATE contract SET created_by_role = (SELECT role FROM user WHERE id = created_by_id)`.

---

#### Migration 7 (Optional): Add ProductCategory.source & sourceId
**Name:** `add_category_source_tracking`

**Schema delta:**
```prisma
model ProductCategory {
  // ... existing ...
  source      String?    // 'manual' | 'contract' | 'pricing_file' | 'cog'
  sourceId    String?    // FK to original entity
}
```

**Why:** v0 tracks category origin for audit/reconciliation. Useful for "show me which contract this category came from."

**Impact:** Category audit trail, source attribution.

**Destructive?** No.

**Effort:** 1 migration. No backfill (new data forward).

---

#### Migration 8 (Optional): Add Alert.purchase_order_id
**Name:** `add_alert_purchase_order_link`

**Schema delta:**
```prisma
model Alert {
  // ... existing ...
  poId  String?   // FK to PurchaseOrder if it exists in Prisma
}
```

**Why:** v0 Alert has `purchase_order_id` for PO-related alerts.

**Impact:** Off-contract alerts linking back to PO.

**Destructive?** No.

**Effort:** 1 migration. Conditional (only if PO model exists in Prisma).

---

### **Priority Order for Demo:**

1. **Migration 1 (Alert enum)** — blocks alert UI entirely ✅
2. **Migration 2 (PendingContract enum)** — blocks pending contracts UI ✅
3. **Migration 3 (ContractTier)** — blocks contract tier display ✅
4. **Migration 5 (Contract facilities)** — blocks contract detail pages ✅
5. Migration 4 (Address components) — polish (address still readable as flat string)
6. Migration 6-8 — nice-to-have

**Estimated time:** Migrations 1-2 = 5 min each (enum rename). Migration 3 = 15 min (includes backfill). Migration 5 = 0 min (code-only, DTO transform). Total: ~40 min.

---

## 6. Data Type Conversions at API Boundary

When ported UI calls server actions returning Prisma data, ensure these conversions:

| Source (Prisma) | Target (v0 UI expects) | Conversion |
|-----------------|------------------------|-----------|
| `DateTime` | `string (ISO)` | `.toISOString()` |
| `Decimal` | `number` | `.toNumber()` or keep as `Decimal` if UI supports |
| `Json` | `Record<string, unknown>` | Already object; serialize/parse as needed |
| `Int @db.Date` | `string (YYYY-MM-DD)` | Parse to date string |
| `Boolean` | `boolean` | Pass through |
| Enum `new_alert` | Enum value `new` | Remap in DTO |
| Enum `submitted` | Enum value `pending` | Remap in DTO |

**Recommendation:** Create DTO transformers in server actions to remap types + enum values, ensuring v0 UI gets exactly what it expects.

---

## 7. Summary: What Will Break Without Fixes

| Ported UI Page | Current State | Blocker | Fix Required |
|----------------|---------------|---------|--------------|
| Alert List / Dashboard | Shows no alerts (enum mismatch) | 🟥 Alert.status | Migration 1 |
| Pending Contracts | Filter broken (enum mismatch) | 🟥 PendingContract.status | Migration 2 |
| Contract Detail → Tiers | Tier thresholds incomplete | 🟥 ContractTier schema | Migration 3 |
| Contract Detail → Facilities | No facilities shown | 🟥 facilities[] mapping | Migration 5 |
| Facility Detail → Address | Address shown as single line (ok) | 🟨 Address components | Migration 4 (optional) |
| Vendor Detail → Address | Address shown as single line (ok) | 🟨 Address components | Migration 4 (optional) |
| All pages with dates | May show `[object Object]` | 🟨 DateTime serialization | Server action DTO transform |
| All pages with decimals | May show `Decimal { d: [...] }` | 🟨 Decimal serialization | Server action DTO transform |

---

## 8. Pre-Demo Checklist

- [ ] Run Migration 1: Alert.status enum
- [ ] Run Migration 2: PendingContract.status enum
- [ ] Run Migration 3: ContractTier single-value fields
- [ ] Create DTO transformers in all server actions returning Contract/Alert/PendingContract
- [ ] Test Alert list page: verify status filtering works
- [ ] Test Pending Contracts page: verify status filtering works
- [ ] Test Contract detail page: verify tiers display with correct thresholds
- [ ] Test Contract detail page: verify facilities list populated
- [ ] Verify DateTime serialization: dates display correctly (no `[object Object]`)
- [ ] Verify Decimal serialization: prices display correctly
- [ ] [Optional] Run Migration 4: Address components for cleaner address UI
- [ ] [Optional] Run Migration 5-8: Other polish migrations

**Estimated effort:** 3–4 hours total (migrations + testing).

