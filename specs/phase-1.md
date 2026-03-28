# Phase 1 -- Foundation (Schema + Auth + Layouts)

## Objective

Establish the complete data model (Prisma schema with all models, enums, relations, and indexes), Better Auth with organization plugin for multi-tenant role-based access, seed data, and the three portal shell layouts. After this phase a user can register, log in, and navigate an empty but fully chromed portal.

## Dependencies

- Phase 0 (scaffold, tooling, folder structure)

## Tech Stack

| Tool | Purpose |
|------|---------|
| Prisma 7 + `@prisma/adapter-pg` | ORM with PostgreSQL driver adapter |
| Better Auth + prismaAdapter + org plugin | Auth with Prisma plugin for DB, org plugin for multi-tenancy |
| Resend | Transactional emails (verification, password reset, invitations) |
| zod-prisma-types | Auto-generate Zod validators from Prisma |
| next-themes | Dark/light/system toggle |
| Lucide React | Icons for sidebar nav |
| shadcn Sidebar + Sheet | Collapsible sidebar shell |

---

## Data Models (Prisma Schema)

### Enums

```prisma
enum UserRole {
  facility
  vendor
  admin
}

enum VendorSubRole {
  admin
  manager
  rep
}

enum ContractType {
  usage
  capital
  service
  tie_in
  grouped
  pricing_only
}

enum ContractStatus {
  active
  expired
  expiring
  draft
  pending
}

enum TermType {
  spend_rebate
  volume_rebate
  price_reduction
  market_share
  market_share_price_reduction
  capitated_price_reduction
  capitated_pricing_rebate
  po_rebate
  carve_out
  payment_rebate
  growth_rebate
  compliance_rebate
  fixed_fee
  locked_pricing
}

enum VolumeType {
  product_category
  catalog_cap_based
  procedure_code
}

enum RebateType {
  percent_of_spend
  fixed_rebate
  fixed_rebate_per_unit
  per_procedure_rebate
}

enum BaselineType {
  spend_based
  volume_based
  growth_based
}

enum PerformancePeriod {
  monthly
  quarterly
  semi_annual
  annual
}

enum AlertType {
  off_contract
  expiring_contract
  tier_threshold
  rebate_due
  payment_due
  pricing_error
  compliance
}

enum AlertSeverity {
  high
  medium
  low
}

enum AlertStatus {
  new_alert
  read
  resolved
  dismissed
}

enum DocumentType {
  main
  amendment
  addendum
  exhibit
  pricing
}

enum PendingContractStatus {
  draft
  submitted
  approved
  rejected
  revision_requested
  withdrawn
}

enum POStatus {
  draft
  pending
  approved
  sent
  completed
  cancelled
}

enum ProposalType {
  term_change
  new_term
  remove_term
  contract_edit
}

enum ProposalStatus {
  pending
  approved
  rejected
  revision_requested
}

enum ConnectionStatus {
  pending
  accepted
  rejected
  expired
}

enum ConnectionInviteType {
  facility_to_vendor
  vendor_to_facility
}

enum PayorType {
  commercial
  medicare_advantage
  medicaid_managed
  workers_comp
}

enum CaseCostingFileType {
  case_procedures
  supply_field
  patient_fields
  po_history
  invoice_history
}

enum FacilityType {
  hospital
  asc
  clinic
  surgery_center
}

enum VendorTier {
  standard
  premium
}

enum ReportType {
  contract_performance
  rebate_summary
  spend_analysis
  market_share
  case_costing
}

enum ReportFrequency {
  daily
  weekly
  monthly
}

enum CreditTierId {
  starter
  professional
  enterprise
  unlimited
}
```

### Models

```prisma
// ─── Better Auth managed tables ───────────────────────────────────

model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  role          UserRole  @default(facility)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions      Session[]
  accounts      Account[]
  members       Member[]

  createdContracts Contract[] @relation("CreatedByUser")
  payments         Payment[]
  credits          Credit[]

  @@map("user")
}

model Session {
  id        String   @id @default(cuid())
  expiresAt DateTime
  token     String   @unique
  ipAddress String?
  userAgent String?
  userId    String

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("session")
}

model Account {
  id                    String    @id @default(cuid())
  accountId             String
  providerId            String
  userId                String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("account")
}

model Verification {
  id         String   @id @default(cuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@map("verification")
}

// ─── Better Auth Organization plugin tables ───────────────────────

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  logo      String?
  metadata  String?
  createdAt DateTime @default(now())

  members    Member[]
  invitations Invitation[]

  // TYDEi-specific: link org to facility or vendor
  facility   Facility? @relation
  vendor     Vendor?   @relation

  @@map("organization")
}

model Member {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  role           String   @default("member")
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("member")
}

model Invitation {
  id             String   @id @default(cuid())
  organizationId String
  email          String
  role           String?
  status         String   @default("pending")
  expiresAt      DateTime
  inviterId      String

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("invitation")
}

// ─── Domain Models ────────────────────────────────────────────────

model HealthSystem {
  id                  String   @id @default(cuid())
  name                String
  code                String?  @unique
  headquarters        String?
  logoUrl             String?
  primaryContactEmail String?
  phone               String?
  website             String?
  createdAt           DateTime @default(now())

  facilities Facility[]

  @@map("health_system")
}

model Facility {
  id             String       @id @default(cuid())
  name           String
  type           FacilityType @default(hospital)
  address        String?
  city           String?
  state          String?
  zip            String?
  beds           Int?
  healthSystemId String?
  status         String       @default("active")
  organizationId String?      @unique
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  healthSystem   HealthSystem?  @relation(fields: [healthSystemId], references: [id])
  organization   Organization?  @relation(fields: [organizationId], references: [id])

  contracts          Contract[]
  pendingContracts   PendingContract[]
  cogRecords         COGRecord[]
  pricingFiles       PricingFile[]
  purchaseOrders     PurchaseOrder[]
  invoices           Invoice[]
  alerts             Alert[]          @relation("FacilityAlerts")
  contractPeriods    ContractPeriod[]
  rebates            Rebate[]
  payments           Payment[]
  creditEntries      Credit[]
  cases              Case[]
  surgeonUsages      SurgeonUsage[]
  connections        Connection[]     @relation("FacilityConnections")
  featureFlags       FeatureFlag[]
  aiCredits          AICredit[]       @relation("FacilityAICredits")
  reportSchedules    ReportSchedule[]
  contractFacilities ContractFacility[]
  payorContracts     PayorContract[]

  @@map("facility")
}

model Vendor {
  id             String     @id @default(cuid())
  name           String
  code           String?
  displayName    String?
  division       String?
  parentVendorId String?
  logoUrl        String?
  contactName    String?
  contactEmail   String?
  contactPhone   String?
  website        String?
  address        String?
  status         String     @default("active")
  tier           VendorTier @default(standard)
  organizationId String?    @unique
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  parentVendor   Vendor?  @relation("VendorHierarchy", fields: [parentVendorId], references: [id])
  childVendors   Vendor[] @relation("VendorHierarchy")
  organization   Organization? @relation(fields: [organizationId], references: [id])

  contracts           Contract[]
  pendingContracts    PendingContract[]
  cogRecords          COGRecord[]
  pricingFiles        PricingFile[]
  purchaseOrders      PurchaseOrder[]
  invoices            Invoice[]
  alerts              Alert[]          @relation("VendorAlerts")
  vendorNameMappings  VendorNameMapping[]
  connections         Connection[]     @relation("VendorConnections")
  aiCredits           AICredit[]       @relation("VendorAICredits")
  divisions           VendorDivision[]
  productBenchmarks   ProductBenchmark[]

  @@map("vendor")
}

model VendorDivision {
  id         String   @id @default(cuid())
  vendorId   String
  name       String
  code       String
  categories String[] @default([])
  createdAt  DateTime @default(now())

  vendor Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  @@map("vendor_division")
}

model ProductCategory {
  id          String   @id @default(cuid())
  name        String
  description String?
  parentId    String?
  spendTotal  Decimal  @default(0) @db.Decimal(14, 2)
  itemCount   Int      @default(0)
  createdAt   DateTime @default(now())

  parent   ProductCategory?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children ProductCategory[] @relation("CategoryHierarchy")

  contracts Contract[]

  @@map("product_category")
}

// ─── Contract Models ──────────────────────────────────────────────

model Contract {
  id                     String            @id @default(cuid())
  contractNumber         String?
  name                   String
  vendorId               String
  facilityId             String?
  productCategoryId      String?
  contractType           ContractType      @default(usage)
  status                 ContractStatus    @default(draft)
  effectiveDate          DateTime          @db.Date
  expirationDate         DateTime          @db.Date
  autoRenewal            Boolean           @default(false)
  terminationNoticeDays  Int               @default(90)
  totalValue             Decimal           @default(0) @db.Decimal(14, 2)
  annualValue            Decimal           @default(0) @db.Decimal(14, 2)
  description            String?
  notes                  String?
  gpoAffiliation         String?
  performancePeriod      PerformancePeriod @default(monthly)
  rebatePayPeriod        PerformancePeriod @default(quarterly)
  isGrouped              Boolean           @default(false)
  isMultiFacility        Boolean           @default(false)
  tieInCapitalContractId String?
  createdById            String?
  createdAt              DateTime          @default(now())
  updatedAt              DateTime          @updatedAt

  vendor          Vendor           @relation(fields: [vendorId], references: [id])
  facility        Facility?        @relation(fields: [facilityId], references: [id])
  productCategory ProductCategory? @relation(fields: [productCategoryId], references: [id])
  createdBy       User?            @relation("CreatedByUser", fields: [createdById], references: [id])

  terms              ContractTerm[]
  pricingItems       ContractPricing[]
  documents          ContractDocument[]
  periods            ContractPeriod[]
  rebates            Rebate[]
  payments           Payment[]
  creditEntries      Credit[]
  alerts             Alert[]
  purchaseOrders     PurchaseOrder[]
  surgeonUsages      SurgeonUsage[]
  contractFacilities ContractFacility[]
  changeProposals    ContractChangeProposal[]

  @@index([vendorId])
  @@index([facilityId])
  @@index([status])
  @@index([expirationDate])
  @@map("contract")
}

model ContractFacility {
  id         String @id @default(cuid())
  contractId String
  facilityId String

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  facility Facility @relation(fields: [facilityId], references: [id], onDelete: Cascade)

  @@unique([contractId, facilityId])
  @@map("contract_facility")
}

model ContractTerm {
  id                   String        @id @default(cuid())
  contractId           String
  termName             String
  termType             TermType      @default(spend_rebate)
  baselineType         BaselineType  @default(spend_based)
  evaluationPeriod     String        @default("annual")
  paymentTiming        String        @default("quarterly")
  appliesTo            String        @default("all_products")
  effectiveStart       DateTime      @db.Date
  effectiveEnd         DateTime      @db.Date
  volumeType           VolumeType?
  spendBaseline        Decimal?      @db.Decimal(14, 2)
  volumeBaseline       Int?
  growthBaselinePercent Decimal?      @db.Decimal(5, 2)
  desiredMarketShare   Decimal?      @db.Decimal(5, 2)
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt

  contract   Contract       @relation(fields: [contractId], references: [id], onDelete: Cascade)
  tiers      ContractTier[]
  products   ContractTermProduct[]
  procedures ContractTermProcedure[]

  @@index([contractId])
  @@map("contract_term")
}

model ContractTier {
  id             String      @id @default(cuid())
  termId         String
  tierNumber     Int         @default(1)
  spendMin       Decimal     @default(0) @db.Decimal(14, 2)
  spendMax       Decimal?    @db.Decimal(14, 2)
  volumeMin      Int?
  volumeMax      Int?
  marketShareMin Decimal?    @db.Decimal(5, 2)
  marketShareMax Decimal?    @db.Decimal(5, 2)
  rebateType     RebateType  @default(percent_of_spend)
  rebateValue    Decimal     @default(0) @db.Decimal(10, 4)
  createdAt      DateTime    @default(now())

  term ContractTerm @relation(fields: [termId], references: [id], onDelete: Cascade)

  @@index([termId])
  @@map("contract_tier")
}

model ContractTermProduct {
  id                 String   @id @default(cuid())
  termId             String
  vendorItemNo       String
  productDescription String?
  contractPrice      Decimal? @db.Decimal(12, 2)
  createdAt          DateTime @default(now())

  term ContractTerm @relation(fields: [termId], references: [id], onDelete: Cascade)

  @@map("contract_term_product")
}

model ContractTermProcedure {
  id                   String   @id @default(cuid())
  termId               String
  cptCode              String
  procedureDescription String?
  rebateAmount         Decimal? @db.Decimal(12, 2)
  createdAt            DateTime @default(now())

  term ContractTerm @relation(fields: [termId], references: [id], onDelete: Cascade)

  @@map("contract_term_procedure")
}

model ContractPricing {
  id                 String    @id @default(cuid())
  contractId         String
  vendorItemNo       String
  description        String?
  category           String?
  unitPrice          Decimal   @db.Decimal(12, 2)
  uom                String    @default("EA")
  listPrice          Decimal?  @db.Decimal(12, 2)
  discountPercentage Decimal?  @db.Decimal(5, 2)
  effectiveDate      DateTime? @db.Date
  expirationDate     DateTime? @db.Date
  createdAt          DateTime  @default(now())

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@index([contractId])
  @@index([vendorItemNo])
  @@map("contract_pricing")
}

model ContractDocument {
  id            String       @id @default(cuid())
  contractId    String
  name          String
  type          DocumentType @default(main)
  uploadDate    DateTime     @default(now())
  effectiveDate DateTime?    @db.Date
  size          Int?
  url           String?
  createdAt     DateTime     @default(now())

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@index([contractId])
  @@map("contract_document")
}

model ContractPeriod {
  id              String   @id @default(cuid())
  contractId      String
  facilityId      String?
  periodStart     DateTime @db.Date
  periodEnd       DateTime @db.Date
  totalSpend      Decimal  @default(0) @db.Decimal(14, 2)
  totalVolume     Int      @default(0)
  rebateEarned    Decimal  @default(0) @db.Decimal(14, 2)
  rebateCollected Decimal  @default(0) @db.Decimal(14, 2)
  paymentExpected Decimal  @default(0) @db.Decimal(14, 2)
  paymentActual   Decimal  @default(0) @db.Decimal(14, 2)
  balanceExpected Decimal  @default(0) @db.Decimal(14, 2)
  balanceActual   Decimal  @default(0) @db.Decimal(14, 2)
  tierAchieved    Int?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  contract Contract  @relation(fields: [contractId], references: [id], onDelete: Cascade)
  facility Facility? @relation(fields: [facilityId], references: [id])
  rebates  Rebate[]

  @@index([contractId])
  @@map("contract_period")
}

// ─── Pending Contracts (Vendor Submissions) ───────────────────────

model PendingContract {
  id             String                @id @default(cuid())
  vendorId       String
  vendorName     String
  facilityId     String?
  facilityName   String?
  contractName   String
  contractType   ContractType          @default(usage)
  status         PendingContractStatus @default(submitted)
  effectiveDate  DateTime?             @db.Date
  expirationDate DateTime?             @db.Date
  totalValue     Decimal?              @db.Decimal(14, 2)
  terms          Json                  @default("[]")
  documents      Json                  @default("[]")
  pricingData    Json?
  notes          String?
  submittedAt    DateTime              @default(now())
  reviewedAt     DateTime?
  reviewedBy     String?
  reviewNotes    String?

  vendor   Vendor    @relation(fields: [vendorId], references: [id])
  facility Facility? @relation(fields: [facilityId], references: [id])

  @@index([vendorId])
  @@index([facilityId])
  @@index([status])
  @@map("pending_contract")
}

// ─── Contract Change Proposals ────────────────────────────────────

model ContractChangeProposal {
  id            String         @id @default(cuid())
  contractId    String
  vendorId      String
  vendorName    String
  facilityId    String?
  facilityName  String?
  proposalType  ProposalType   @default(term_change)
  status        ProposalStatus @default(pending)
  changes       Json           @default("[]")
  proposedTerms Json?
  vendorMessage String?
  submittedAt   DateTime       @default(now())
  reviewedAt    DateTime?
  reviewedBy    String?
  reviewNotes   String?

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@index([contractId])
  @@index([status])
  @@map("contract_change_proposal")
}

// ─── COG Data ─────────────────────────────────────────────────────

model COGRecord {
  id                   String    @id @default(cuid())
  facilityId           String
  vendorId             String?
  vendorName           String?
  inventoryNumber      String
  inventoryDescription String
  vendorItemNo         String?
  manufacturerNo       String?
  unitCost             Decimal   @db.Decimal(12, 2)
  extendedPrice        Decimal?  @db.Decimal(14, 2)
  quantity             Int       @default(1)
  transactionDate      DateTime  @db.Date
  category             String?
  createdBy            String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  facility Facility @relation(fields: [facilityId], references: [id])
  vendor   Vendor?  @relation(fields: [vendorId], references: [id])

  @@index([facilityId])
  @@index([vendorId])
  @@index([transactionDate])
  @@index([vendorItemNo])
  @@map("cog_record")
}

model PricingFile {
  id                 String    @id @default(cuid())
  vendorId           String
  facilityId         String
  vendorItemNo       String
  manufacturerNo     String?
  productDescription String
  listPrice          Decimal?  @db.Decimal(12, 2)
  contractPrice      Decimal?  @db.Decimal(12, 2)
  effectiveDate      DateTime  @db.Date
  expirationDate     DateTime? @db.Date
  category           String?
  uom                String    @default("EA")
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  vendor   Vendor   @relation(fields: [vendorId], references: [id])
  facility Facility @relation(fields: [facilityId], references: [id])

  @@index([vendorId])
  @@index([facilityId])
  @@index([vendorItemNo])
  @@map("pricing_file")
}

// ─── Alerts ───────────────────────────────────────────────────────

model Alert {
  id          String        @id @default(cuid())
  portalType  String
  alertType   AlertType
  title       String
  description String?
  severity    AlertSeverity @default(medium)
  status      AlertStatus   @default(new_alert)
  contractId  String?
  facilityId  String?
  vendorId    String?
  metadata    Json          @default("{}")
  actionLink  String?
  createdAt   DateTime      @default(now())
  readAt      DateTime?
  resolvedAt  DateTime?
  dismissedAt DateTime?

  contract Contract? @relation(fields: [contractId], references: [id])
  facility Facility? @relation("FacilityAlerts", fields: [facilityId], references: [id])
  vendor   Vendor?   @relation("VendorAlerts", fields: [vendorId], references: [id])

  @@index([facilityId])
  @@index([vendorId])
  @@index([status])
  @@index([alertType])
  @@map("alert")
}

// ─── Purchase Orders ──────────────────────────────────────────────

model PurchaseOrder {
  id            String   @id @default(cuid())
  poNumber      String
  facilityId    String
  vendorId      String
  contractId    String?
  orderDate     DateTime @db.Date
  totalCost     Decimal? @db.Decimal(14, 2)
  status        POStatus @default(draft)
  isOffContract Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  facility  Facility      @relation(fields: [facilityId], references: [id])
  vendor    Vendor        @relation(fields: [vendorId], references: [id])
  contract  Contract?     @relation(fields: [contractId], references: [id])
  lineItems POLineItem[]
  invoices  Invoice[]

  @@index([facilityId])
  @@index([vendorId])
  @@index([status])
  @@map("purchase_order")
}

model POLineItem {
  id                   String   @id @default(cuid())
  purchaseOrderId      String
  sku                  String?
  inventoryDescription String
  vendorItemNo         String?
  manufacturerNo       String?
  quantity             Int
  unitPrice            Decimal  @db.Decimal(12, 2)
  extendedPrice        Decimal  @db.Decimal(14, 2)
  uom                  String   @default("EA")
  isOffContract        Boolean  @default(false)
  contractId           String?
  createdAt            DateTime @default(now())

  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)

  @@map("po_line_item")
}

// ─── Invoices ─────────────────────────────────────────────────────

model Invoice {
  id               String   @id @default(cuid())
  invoiceNumber    String
  facilityId       String
  vendorId         String
  purchaseOrderId  String?
  invoiceDate      DateTime @db.Date
  totalInvoiceCost Decimal? @db.Decimal(14, 2)
  status           String   @default("pending")
  createdAt        DateTime @default(now())

  facility      Facility       @relation(fields: [facilityId], references: [id])
  vendor        Vendor         @relation(fields: [vendorId], references: [id])
  purchaseOrder PurchaseOrder? @relation(fields: [purchaseOrderId], references: [id])
  lineItems     InvoiceLineItem[]

  @@index([facilityId])
  @@index([vendorId])
  @@map("invoice")
}

model InvoiceLineItem {
  id                   String  @id @default(cuid())
  invoiceId            String
  inventoryDescription String
  vendorItemNo         String?
  invoicePrice         Decimal @db.Decimal(12, 2)
  invoiceQuantity      Int
  totalLineCost        Decimal @db.Decimal(14, 2)
  contractPrice        Decimal? @db.Decimal(12, 2)
  variancePercent      Decimal? @db.Decimal(5, 2)
  isFlagged            Boolean @default(false)
  createdAt            DateTime @default(now())

  invoice Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@map("invoice_line_item")
}

// ─── Rebates / Payments / Credits ─────────────────────────────────

model Rebate {
  id               String    @id @default(cuid())
  contractId       String
  facilityId       String
  periodId         String?
  rebateEarned     Decimal   @db.Decimal(14, 2)
  rebateCollected  Decimal   @default(0) @db.Decimal(14, 2)
  rebateUnearned   Decimal   @default(0) @db.Decimal(14, 2)
  payPeriodStart   DateTime  @db.Date
  payPeriodEnd     DateTime  @db.Date
  collectionDate   DateTime? @db.Date
  notes            String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  contract Contract        @relation(fields: [contractId], references: [id], onDelete: Cascade)
  facility Facility        @relation(fields: [facilityId], references: [id])
  period   ContractPeriod? @relation(fields: [periodId], references: [id])

  @@index([contractId])
  @@map("rebate")
}

model Payment {
  id            String   @id @default(cuid())
  contractId    String
  facilityId    String
  paymentDate   DateTime @db.Date
  paymentAmount Decimal  @db.Decimal(14, 2)
  paymentType   String?
  notes         String?
  createdById   String?
  createdAt     DateTime @default(now())

  contract  Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  facility  Facility @relation(fields: [facilityId], references: [id])
  createdBy User?    @relation(fields: [createdById], references: [id])

  @@map("payment")
}

model Credit {
  id           String   @id @default(cuid())
  contractId   String
  facilityId   String
  creditDate   DateTime @db.Date
  creditAmount Decimal  @db.Decimal(14, 2)
  creditReason String?
  notes        String?
  createdById  String?
  createdAt    DateTime @default(now())

  contract  Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  facility  Facility @relation(fields: [facilityId], references: [id])
  createdBy User?    @relation(fields: [createdById], references: [id])

  @@map("credit")
}

// ─── Vendor Name / Category Mappings ──────────────────────────────

model VendorNameMapping {
  id              String   @id @default(cuid())
  cogVendorName   String
  mappedVendorId  String?
  mappedVendorName String?
  confidenceScore Decimal? @db.Decimal(5, 2)
  isConfirmed     Boolean  @default(false)
  createdAt       DateTime @default(now())

  vendor Vendor? @relation(fields: [mappedVendorId], references: [id])

  @@index([cogVendorName])
  @@map("vendor_name_mapping")
}

model CategoryMapping {
  id               String   @id @default(cuid())
  cogCategory      String
  contractCategory String?
  similarityScore  Decimal? @db.Decimal(5, 2)
  isConfirmed      Boolean  @default(false)
  createdAt        DateTime @default(now())

  @@map("category_mapping")
}

// ─── Product Benchmarks ───────────────────────────────────────────

model ProductBenchmark {
  id              String    @id @default(cuid())
  vendorId        String?
  vendorItemNo    String
  description     String?
  category        String?
  nationalAvgPrice Decimal? @db.Decimal(12, 2)
  percentile25    Decimal?  @db.Decimal(12, 2)
  percentile50    Decimal?  @db.Decimal(12, 2)
  percentile75    Decimal?  @db.Decimal(12, 2)
  minPrice        Decimal?  @db.Decimal(12, 2)
  maxPrice        Decimal?  @db.Decimal(12, 2)
  sampleSize      Int?
  dataDate        DateTime? @db.Date
  source          String    @default("national_benchmark")
  createdAt       DateTime  @default(now())

  vendor Vendor? @relation(fields: [vendorId], references: [id])

  @@index([vendorItemNo])
  @@map("product_benchmark")
}

// ─── Case Costing ─────────────────────────────────────────────────

model Case {
  id                 String   @id @default(cuid())
  caseNumber         String   @unique
  facilityId         String
  surgeonName        String?
  surgeonId          String?
  patientDob         DateTime? @db.Date
  dateOfSurgery      DateTime  @db.Date
  timeInOr           String?
  timeOutOr          String?
  primaryCptCode     String?
  totalSpend         Decimal   @default(0) @db.Decimal(12, 2)
  totalReimbursement Decimal   @default(0) @db.Decimal(12, 2)
  margin             Decimal   @default(0) @db.Decimal(12, 2)
  complianceStatus   String    @default("pending")
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  facility   Facility        @relation(fields: [facilityId], references: [id])
  procedures CaseProcedure[]
  supplies   CaseSupply[]

  @@index([facilityId])
  @@index([surgeonName])
  @@index([dateOfSurgery])
  @@map("case_record")
}

model CaseProcedure {
  id                   String   @id @default(cuid())
  caseId               String
  cptCode              String
  procedureDescription String?
  createdAt            DateTime @default(now())

  caseRecord Case @relation(fields: [caseId], references: [id], onDelete: Cascade)

  @@map("case_procedure")
}

model CaseSupply {
  id           String  @id @default(cuid())
  caseId       String
  materialName String
  vendorItemNo String?
  usedCost     Decimal @db.Decimal(12, 2)
  quantity     Int     @default(1)
  extendedCost Decimal @default(0) @db.Decimal(12, 2)
  isOnContract Boolean @default(false)
  contractId   String?
  createdAt    DateTime @default(now())

  caseRecord Case @relation(fields: [caseId], references: [id], onDelete: Cascade)

  @@index([caseId])
  @@index([vendorItemNo])
  @@map("case_supply")
}

model CaseCostingFile {
  id            String             @id @default(cuid())
  fileType      CaseCostingFileType
  fileName      String
  rowCount      Int                @default(0)
  columnHeaders String[]           @default([])
  uploadedAt    DateTime           @default(now())

  @@map("case_costing_file")
}

model SurgeonUsage {
  id             String   @id @default(cuid())
  surgeonId      String
  surgeonName    String?
  contractId     String?
  facilityId     String
  periodStart    DateTime @db.Date
  periodEnd      DateTime @db.Date
  usageAmount    Decimal  @default(0) @db.Decimal(14, 2)
  caseCount      Int      @default(0)
  complianceRate Decimal  @default(0) @db.Decimal(5, 2)
  createdAt      DateTime @default(now())

  contract Contract? @relation(fields: [contractId], references: [id])
  facility Facility  @relation(fields: [facilityId], references: [id])

  @@map("surgeon_usage")
}

// ─── Payor Contracts ──────────────────────────────────────────────

model PayorContract {
  id                   String    @id @default(cuid())
  payorName            String
  payorType            PayorType @default(commercial)
  facilityId           String
  contractNumber       String
  effectiveDate        DateTime  @db.Date
  expirationDate       DateTime  @db.Date
  status               String    @default("active")
  cptRates             Json      @default("[]")
  grouperRates         Json      @default("[]")
  multiProcedureRule   Json      @default("{}")
  implantPassthrough   Boolean   @default(true)
  implantMarkup        Decimal   @default(0) @db.Decimal(5, 2)
  uploadedAt           DateTime  @default(now())
  uploadedBy           String?
  fileName             String?
  notes                String?

  facility Facility @relation(fields: [facilityId], references: [id])

  @@index([facilityId])
  @@map("payor_contract")
}

// ─── Connections ──────────────────────────────────────────────────

model Connection {
  id             String               @id @default(cuid())
  facilityId     String
  facilityName   String
  vendorId       String
  vendorName     String
  status         ConnectionStatus     @default(pending)
  inviteType     ConnectionInviteType
  invitedBy      String
  invitedByEmail String
  invitedAt      DateTime             @default(now())
  respondedAt    DateTime?
  respondedBy    String?
  expiresAt      DateTime
  message        String?

  facility Facility @relation("FacilityConnections", fields: [facilityId], references: [id])
  vendor   Vendor   @relation("VendorConnections", fields: [vendorId], references: [id])

  @@index([facilityId])
  @@index([vendorId])
  @@index([status])
  @@map("connection")
}

// ─── Feature Flags ────────────────────────────────────────────────

model FeatureFlag {
  id                     String  @id @default(cuid())
  facilityId             String
  purchaseOrdersEnabled  Boolean @default(true)
  aiAgentEnabled         Boolean @default(true)
  vendorPortalEnabled    Boolean @default(true)
  advancedReportsEnabled Boolean @default(true)
  caseCostingEnabled     Boolean @default(true)

  facility Facility @relation(fields: [facilityId], references: [id])

  @@unique([facilityId])
  @@map("feature_flag")
}

// ─── AI Credits ───────────────────────────────────────────────────

model AICredit {
  id               String      @id @default(cuid())
  facilityId       String?
  vendorId         String?
  tierId           CreditTierId @default(starter)
  monthlyCredits   Int          @default(500)
  usedCredits      Int          @default(0)
  rolloverCredits  Int          @default(0)
  billingPeriodStart DateTime   @db.Date
  billingPeriodEnd   DateTime   @db.Date
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  facility Facility? @relation("FacilityAICredits", fields: [facilityId], references: [id])
  vendor   Vendor?   @relation("VendorAICredits", fields: [vendorId], references: [id])
  usageRecords AIUsageRecord[]

  @@map("ai_credit")
}

model AIUsageRecord {
  id          String   @id @default(cuid())
  creditId    String
  action      String
  creditsUsed Int
  userId      String
  userName    String
  description String
  metadata    Json?
  createdAt   DateTime @default(now())

  credit AICredit @relation(fields: [creditId], references: [id], onDelete: Cascade)

  @@map("ai_usage_record")
}

// ─── Report Scheduling ────────────────────────────────────────────

model ReportSchedule {
  id              String          @id @default(cuid())
  facilityId      String
  reportType      ReportType
  frequency       ReportFrequency
  dayOfWeek       Int?
  dayOfMonth      Int?
  emailRecipients String[]        @default([])
  isActive        Boolean         @default(true)
  lastSentAt      DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  facility Facility @relation(fields: [facilityId], references: [id])

  @@map("report_schedule")
}
```

---

## Server Actions

### `lib/actions/auth.ts`

```typescript
"use server"
// requireAuth(): Promise<{ user: User; session: Session }>
// requireRole(role: UserRole): Promise<{ user: User; session: Session }>
// requireFacility(): Promise<{ user: User; facility: Facility }>
// requireVendor(): Promise<{ user: User; vendor: Vendor }>
// requireAdmin(): Promise<{ user: User }>
```

### `lib/auth-server.ts`

```typescript
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { organization } from "better-auth/plugins"
import { Resend } from "resend"
import { prisma } from "@/lib/db"

const resend = new Resend(process.env.RESEND_API_KEY)

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await resend.emails.send({
        from: "TYDEi <noreply@tydei.com>",
        to: user.email,
        subject: "Reset your password",
        html: `<a href="${url}">Reset password</a>`,
      })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await resend.emails.send({
        from: "TYDEi <noreply@tydei.com>",
        to: user.email,
        subject: "Verify your email",
        html: `<a href="${url}">Verify email</a>`,
      })
    },
  },
  plugins: [
    organization(),
  ],
})
```

**Key points:**
- `prismaAdapter` is the Better Auth Prisma plugin — it reads/writes auth tables (user, session, account, verification) directly via Prisma
- Resend handles all transactional emails (verification, password reset, invitations in later phases)
- Organization plugin enables multi-tenant facility/vendor orgs
- React Email templates replace the inline HTML in later phases (Phase 7)

### `lib/auth.ts`

```typescript
// Better Auth client
// export const authClient = createAuthClient({ baseURL: process.env.NEXT_PUBLIC_SITE_URL })
```

---

## Components

### `components/shared/shells/portal-shell.tsx`

- **Props:** `{ role: "facility" | "vendor" | "admin"; navItems: NavItem[]; children: ReactNode }`
- **shadcn deps:** Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, Sheet
- **Description:** Base shell layout used by all three portal layouts. Renders collapsible sidebar with nav, top header with theme toggle + user menu, and content area. ~80 lines.

### `components/shared/shells/sidebar-nav.tsx`

- **Props:** `{ items: NavItem[]; collapsed: boolean }`
- **shadcn deps:** SidebarMenu, SidebarMenuItem, SidebarMenuButton, Badge
- **Description:** Renders sidebar nav items with icon, label, active state (via `usePathname`), and optional badge count (for alerts). ~50 lines.

### `components/shared/shells/entity-selector.tsx`

- **Props:** `{ entities: { id: string; name: string }[]; selectedId: string; onSelect: (id: string) => void; label: string }`
- **shadcn deps:** Select, SelectTrigger, SelectValue, SelectContent, SelectItem
- **Description:** Generic dropdown for facility/vendor/division context switching. ~30 lines.

### `components/shared/shells/user-menu.tsx`

- **Props:** `{ user: { name: string; email: string; image?: string } }`
- **shadcn deps:** DropdownMenu, Avatar, AvatarFallback
- **Description:** User avatar dropdown with profile link, settings link, sign-out action. ~40 lines.

### `components/shared/page-header.tsx`

- **Props:** `{ title: string; description?: string; action?: ReactNode }`
- **shadcn deps:** none (plain Tailwind)
- **Description:** Reusable page title with optional description and action button slot. ~20 lines.

### `components/shared/empty-state.tsx`

- **Props:** `{ icon: LucideIcon; title: string; description: string; action?: ReactNode }`
- **shadcn deps:** Button (optional)
- **Description:** Centered empty state with icon, text, and optional CTA. ~25 lines.

### `components/shared/theme-toggle.tsx`

- **Props:** none
- **shadcn deps:** DropdownMenu, Button
- **Description:** Light/dark/system theme toggle button. ~30 lines.

---

## Pages

### `app/(auth)/layout.tsx`

- **Route:** Auth route group
- **Layout:** Centered card with logo, no sidebar
- **Auth:** No auth required
- **Data loading:** None
- **Lines:** ~20 lines

### `app/(facility)/layout.tsx`

- **Route:** Facility portal route group
- **Layout:** `<PortalShell role="facility" navItems={facilityNav} />`
- **Auth:** `requireRole("facility")` -- redirect to `/login` if unauthenticated, redirect to correct portal if wrong role
- **Data loading:** Load user session server-side
- **Lines:** ~30 lines

### `app/(vendor)/layout.tsx`

- **Route:** Vendor portal route group
- **Layout:** `<PortalShell role="vendor" navItems={vendorNav} />`
- **Auth:** `requireRole("vendor")`
- **Data loading:** Load user session server-side
- **Lines:** ~30 lines

### `app/(admin)/layout.tsx`

- **Route:** Admin portal route group
- **Layout:** `<PortalShell role="admin" navItems={adminNav} />`
- **Auth:** `requireRole("admin")`
- **Data loading:** Load user session server-side
- **Lines:** ~30 lines

### `app/(facility)/dashboard/page.tsx`

- **Route:** `/dashboard`
- **Auth:** facility role
- **Content:** `<PageHeader title="Dashboard" />` + `<EmptyState icon={LayoutDashboard} title="Dashboard" description="Coming soon" />`
- **Lines:** ~15 lines

### `app/(vendor)/dashboard/page.tsx`

- **Route:** `/vendor/dashboard`
- **Auth:** vendor role
- **Content:** Same pattern as above
- **Lines:** ~15 lines

### `app/(admin)/dashboard/page.tsx`

- **Route:** `/admin/dashboard`
- **Auth:** admin role
- **Content:** Same pattern as above
- **Lines:** ~15 lines

---

## `proxy.ts` (Route Protection)

```typescript
import { NextRequest, NextResponse } from "next/server"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Get session token from cookie
  const sessionToken = request.cookies.get("better-auth.session_token")?.value

  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/sign-up")
  const isFacilityRoute = pathname.startsWith("/dashboard")
  const isVendorRoute = pathname.startsWith("/vendor")
  const isAdminRoute = pathname.startsWith("/admin")
  const isProtectedRoute = isFacilityRoute || isVendorRoute || isAdminRoute

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !sessionToken) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && sessionToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return undefined
}
```

Note: Full role-based routing (checking actual role from session) will require the auth server. The proxy handles the basic session-exists check. Layout-level `requireRole()` handles role-specific access.

---

## Seed Script (`prisma/seed.ts`)

```typescript
// ~200 lines
// Creates:
// - 2 health systems: "Lighthouse Health" and "Heritage Medical Group"
// - 4 facilities: "Lighthouse Surgery Center" (ASC), "Lighthouse Main Hospital",
//                 "Heritage Medical Center", "Heritage Orthopedic Clinic"
// - 3 vendors: "Stryker" (premium), "Medtronic" (premium), "Smith & Nephew" (standard)
//   Each with 1-2 divisions
// - 5 product categories: "Joint Replacement", "Spine", "Biologics", "Arthroscopy", "Trauma"
// - Demo users:
//   - facility@demo.com (role: facility, linked to Lighthouse Surgery Center org)
//   - vendor@demo.com (role: vendor, linked to Stryker org)
//   - admin@demo.com (role: admin)
// - 5-8 contracts with terms and tiers spanning different types (usage, capital, tie_in)
// - Sample COG records (20-30 rows)
// - Sample alerts (5-10)
```

---

## Constants (`lib/constants.ts`)

```typescript
// Nav configs for all three portals
export const facilityNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  { label: "Contracts", href: "/dashboard/contracts", icon: "FileText" },
  { label: "COG Data", href: "/dashboard/cog-data", icon: "Database" },
  { label: "Alerts", href: "/dashboard/alerts", icon: "Bell", badgeKey: "alertCount" },
  { label: "Reports", href: "/dashboard/reports", icon: "BarChart3" },
  { label: "Purchase Orders", href: "/dashboard/purchase-orders", icon: "ShoppingCart" },
  { label: "Invoice Validation", href: "/dashboard/invoice-validation", icon: "FileCheck" },
  { label: "Renewals", href: "/dashboard/renewals", icon: "RefreshCw" },
  { label: "Rebate Optimizer", href: "/dashboard/rebate-optimizer", icon: "TrendingUp" },
  { label: "Case Costing", href: "/dashboard/case-costing", icon: "Stethoscope" },
  { label: "Analysis", href: "/dashboard/analysis", icon: "LineChart" },
  { label: "AI Agent", href: "/dashboard/ai-agent", icon: "Bot" },
  { label: "Settings", href: "/dashboard/settings", icon: "Settings" },
]

export const vendorNav: NavItem[] = [
  { label: "Dashboard", href: "/vendor/dashboard", icon: "LayoutDashboard" },
  { label: "Contracts", href: "/vendor/contracts", icon: "FileText" },
  { label: "Alerts", href: "/vendor/alerts", icon: "Bell", badgeKey: "alertCount" },
  { label: "Invoices", href: "/vendor/invoices", icon: "Receipt" },
  { label: "Market Share", href: "/vendor/market-share", icon: "PieChart" },
  { label: "Performance", href: "/vendor/performance", icon: "Activity" },
  { label: "Prospective", href: "/vendor/prospective", icon: "Target" },
  { label: "Purchase Orders", href: "/vendor/purchase-orders", icon: "ShoppingCart" },
  { label: "Renewals", href: "/vendor/renewals", icon: "RefreshCw" },
  { label: "Reports", href: "/vendor/reports", icon: "BarChart3" },
  { label: "AI Agent", href: "/vendor/ai-agent", icon: "Bot" },
  { label: "Settings", href: "/vendor/settings", icon: "Settings" },
]

export const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "LayoutDashboard" },
  { label: "Facilities", href: "/admin/facilities", icon: "Building2" },
  { label: "Vendors", href: "/admin/vendors", icon: "Truck" },
  { label: "Users", href: "/admin/users", icon: "Users" },
  { label: "Billing", href: "/admin/billing", icon: "CreditCard" },
  { label: "Payor Contracts", href: "/admin/payor-contracts", icon: "Shield" },
]

// Status badge configs
export const contractStatusConfig = { ... }
export const alertTypeConfig = { ... }
export const poStatusConfig = { ... }
```

---

## Query Keys (`lib/query-keys.ts`)

```typescript
// Factory pattern
export const queryKeys = {
  contracts: {
    all: ["contracts"] as const,
    list: (filters: ContractFilters) => ["contracts", "list", filters] as const,
    detail: (id: string) => ["contracts", "detail", id] as const,
  },
  vendors: { ... },
  facilities: { ... },
  alerts: { ... },
  cogRecords: { ... },
  pricingFiles: { ... },
  purchaseOrders: { ... },
  invoices: { ... },
  cases: { ... },
}
```

---

## File Checklist

### Schema & DB
- [ ] `prisma/schema.prisma` -- full schema with all models, enums, relations, indexes
- [ ] `prisma/prisma.config.ts` -- Prisma 7 config
- [ ] `prisma/seed.ts` -- seed script
- [ ] `lib/db.ts` -- Prisma client singleton with adapter-pg

### Auth
- [ ] `lib/auth-server.ts` -- Better Auth server config with prismaAdapter, org plugin, Resend email integration
- [ ] `lib/auth.ts` -- Better Auth client
- [ ] `lib/actions/auth.ts` -- requireAuth, requireRole, requireFacility, requireVendor, requireAdmin
- [ ] `app/api/auth/[...all]/route.ts` -- Better Auth catch-all route handler
- [ ] `proxy.ts` -- route protection (session check, auth redirect)

### Layouts
- [ ] `components/shared/shells/portal-shell.tsx` -- base shell
- [ ] `components/shared/shells/sidebar-nav.tsx` -- nav item rendering
- [ ] `components/shared/shells/entity-selector.tsx` -- context switcher
- [ ] `components/shared/shells/user-menu.tsx` -- user dropdown
- [ ] `components/shared/theme-toggle.tsx` -- light/dark/system toggle
- [ ] `components/shared/page-header.tsx` -- reusable page header
- [ ] `components/shared/empty-state.tsx` -- empty state placeholder

### Portal Layouts
- [ ] `app/(facility)/layout.tsx` -- facility shell layout
- [ ] `app/(vendor)/layout.tsx` -- vendor shell layout
- [ ] `app/(admin)/layout.tsx` -- admin shell layout
- [ ] `app/(auth)/layout.tsx` -- centered auth layout

### Placeholder Pages
- [ ] `app/(facility)/dashboard/page.tsx`
- [ ] `app/(vendor)/dashboard/page.tsx`
- [ ] `app/(admin)/dashboard/page.tsx`

### Config
- [ ] `lib/constants.ts` -- nav configs, status configs, role configs
- [ ] `lib/query-keys.ts` -- TanStack Query key factory
- [ ] `lib/validators.ts` -- auto-generated Zod schemas (run `bunx prisma generate`)

### Types
- [ ] `lib/types.ts` -- NavItem, PortalRole, and shared TypeScript types

---

## Acceptance Criteria

1. `bunx prisma migrate dev` succeeds and creates all tables in PostgreSQL
2. `bunx prisma generate` produces the Prisma client and zod-prisma-types validators
3. `bun run db:seed` populates demo data (2 health systems, 4 facilities, 3 vendors, 5 categories, 3 demo users, 5-8 contracts with terms/tiers, sample COG records, sample alerts)
4. Navigating to `/login` shows the auth layout (centered card, no sidebar)
5. Demo user `facility@demo.com` can log in and sees the facility portal sidebar with all nav items
6. Demo user `vendor@demo.com` can log in and sees the vendor portal sidebar
7. Demo user `admin@demo.com` can log in and sees the admin portal sidebar
8. Unauthenticated users are redirected from `/dashboard` to `/login`
9. Facility users are redirected away from `/vendor/*` routes
10. Theme toggle works in all portal layouts
11. Sidebar collapses on mobile (responsive)
12. Entity selector renders in the sidebar header (facility selector for facility portal, vendor division selector for vendor portal)
13. User menu shows name, email, and sign-out button
14. All placeholder pages render `<PageHeader>` + `<EmptyState>` with correct titles
15. Zero TypeScript errors with strict mode
