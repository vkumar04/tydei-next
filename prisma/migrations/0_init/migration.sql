
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('facility', 'vendor', 'admin');

-- CreateEnum
CREATE TYPE "VendorSubRole" AS ENUM ('admin', 'manager', 'rep');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('usage', 'capital', 'service', 'tie_in', 'grouped', 'pricing_only');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('active', 'expired', 'expiring', 'draft', 'pending');

-- CreateEnum
CREATE TYPE "TermType" AS ENUM ('spend_rebate', 'volume_rebate', 'price_reduction', 'market_share', 'market_share_price_reduction', 'capitated_price_reduction', 'capitated_pricing_rebate', 'po_rebate', 'carve_out', 'payment_rebate', 'growth_rebate', 'compliance_rebate', 'fixed_fee', 'locked_pricing', 'rebate_per_use');

-- CreateEnum
CREATE TYPE "VolumeType" AS ENUM ('product_category', 'catalog_cap_based', 'procedure_code');

-- CreateEnum
CREATE TYPE "RebateType" AS ENUM ('percent_of_spend', 'fixed_rebate', 'fixed_rebate_per_unit', 'per_procedure_rebate');

-- CreateEnum
CREATE TYPE "BaselineType" AS ENUM ('spend_based', 'volume_based', 'growth_based');

-- CreateEnum
CREATE TYPE "PerformancePeriod" AS ENUM ('monthly', 'quarterly', 'semi_annual', 'annual');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('off_contract', 'expiring_contract', 'tier_threshold', 'rebate_due', 'payment_due', 'pricing_error', 'compliance', 'compliance_drop', 'vendor_inactive', 'tie_in_at_risk');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('new_alert', 'read', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('main', 'amendment', 'addendum', 'exhibit', 'pricing');

-- CreateEnum
CREATE TYPE "PendingContractStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'revision_requested', 'withdrawn');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('draft', 'pending', 'approved', 'sent', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('term_change', 'new_term', 'remove_term', 'contract_edit');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'approved', 'rejected', 'revision_requested', 'countered', 'withdrawn');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('pending', 'accepted', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "ConnectionInviteType" AS ENUM ('facility_to_vendor', 'vendor_to_facility');

-- CreateEnum
CREATE TYPE "PayorType" AS ENUM ('commercial', 'medicare_advantage', 'medicaid_managed', 'workers_comp');

-- CreateEnum
CREATE TYPE "CaseCostingFileType" AS ENUM ('case_procedures', 'supply_field', 'patient_fields', 'po_history', 'invoice_history');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('hospital', 'asc', 'clinic', 'surgery_center');

-- CreateEnum
CREATE TYPE "VendorTier" AS ENUM ('standard', 'premium');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('contract_performance', 'rebate_summary', 'spend_analysis', 'market_share', 'case_costing');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "CreditTierId" AS ENUM ('starter', 'professional', 'enterprise', 'unlimited');

-- CreateEnum
CREATE TYPE "RebateMethod" AS ENUM ('cumulative', 'marginal');

-- CreateEnum
CREATE TYPE "AccrualGranularity" AS ENUM ('monthly', 'quarterly', 'annual');

-- CreateEnum
CREATE TYPE "AccrualStatus" AS ENUM ('pending', 'trued_up', 'settled');

-- CreateEnum
CREATE TYPE "TieInMode" AS ENUM ('all_or_nothing', 'proportional', 'cross_vendor');

-- CreateEnum
CREATE TYPE "VarianceDirection" AS ENUM ('overcharge', 'undercharge', 'at_price');

-- CreateEnum
CREATE TYPE "VarianceSeverity" AS ENUM ('acceptable', 'warning', 'critical', 'minor', 'moderate', 'major');

-- CreateEnum
CREATE TYPE "COGMatchStatus" AS ENUM ('pending', 'on_contract', 'off_contract_item', 'out_of_scope', 'unknown_vendor', 'price_variance');

-- CreateEnum
CREATE TYPE "FileImportType" AS ENUM ('cog', 'pricing', 'invoice');

-- CreateEnum
CREATE TYPE "FileImportStatus" AS ENUM ('processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "TierBoundaryRule" AS ENUM ('exclusive', 'inclusive');

-- CreateEnum
CREATE TYPE "PriceReductionTrigger" AS ENUM ('retroactive', 'forward_only');

-- CreateEnum
CREATE TYPE "TrueUpShortfallHandling" AS ENUM ('bill_immediately', 'carry_forward');

-- CreateEnum
CREATE TYPE "PaymentCadence" AS ENUM ('monthly', 'quarterly', 'annual');

-- CreateEnum
CREATE TYPE "AmortizationShape" AS ENUM ('symmetrical', 'custom');

-- CreateEnum
CREATE TYPE "InvoiceDisputeStatus" AS ENUM ('none', 'disputed', 'resolved', 'rejected');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'facility',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_system" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "headquarters" TEXT,
    "logoUrl" TEXT,
    "primaryContactEmail" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_system_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL DEFAULT 'hospital',
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "beds" INTEGER,
    "healthSystemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "displayName" TEXT,
    "division" TEXT,
    "parentVendorId" TEXT,
    "logoUrl" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tier" "VendorTier" NOT NULL DEFAULT 'standard',
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_vendor_tie_in" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityBonusRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "facilityBonusRequirement" TEXT NOT NULL DEFAULT 'all_compliant',
    "status" TEXT NOT NULL DEFAULT 'active',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_vendor_tie_in_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_vendor_tie_in_member" (
    "id" TEXT NOT NULL,
    "crossVendorTieInId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "minimumSpend" DECIMAL(14,2) NOT NULL,
    "rebateContribution" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_vendor_tie_in_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_division" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "source" TEXT,
    "sourceId" TEXT,
    "spendTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT,
    "name" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "facilityId" TEXT,
    "productCategoryId" TEXT,
    "contractType" "ContractType" NOT NULL DEFAULT 'usage',
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "effectiveDate" DATE NOT NULL,
    "expirationDate" DATE NOT NULL,
    "autoRenewal" BOOLEAN NOT NULL DEFAULT false,
    "terminationNoticeDays" INTEGER NOT NULL DEFAULT 90,
    "totalValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "annualValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "notes" TEXT,
    "gpoAffiliation" TEXT,
    "performancePeriod" "PerformancePeriod" NOT NULL DEFAULT 'monthly',
    "rebatePayPeriod" "PerformancePeriod" NOT NULL DEFAULT 'quarterly',
    "isGrouped" BOOLEAN NOT NULL DEFAULT false,
    "isMultiFacility" BOOLEAN NOT NULL DEFAULT false,
    "tieInCapitalContractId" TEXT,
    "division" TEXT,
    "amortizationShape" "AmortizationShape" NOT NULL DEFAULT 'symmetrical',
    "complianceRate" DECIMAL(5,2),
    "currentMarketShare" DECIMAL(5,2),
    "marketShareCommitment" DECIMAL(5,2),
    "marketShareCommitmentByCategory" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_product_category" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "productCategoryId" TEXT NOT NULL,

    CONSTRAINT "contract_product_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_facility" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,

    CONSTRAINT "contract_facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_term" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "termName" TEXT NOT NULL,
    "termType" "TermType" NOT NULL DEFAULT 'spend_rebate',
    "baselineType" "BaselineType" NOT NULL DEFAULT 'spend_based',
    "evaluationPeriod" TEXT NOT NULL DEFAULT 'annual',
    "paymentTiming" TEXT NOT NULL DEFAULT 'quarterly',
    "appliesTo" TEXT NOT NULL DEFAULT 'all_products',
    "rebateMethod" "RebateMethod" NOT NULL DEFAULT 'cumulative',
    "effectiveStart" DATE NOT NULL,
    "effectiveEnd" DATE NOT NULL,
    "volumeType" "VolumeType",
    "spendBaseline" DECIMAL(14,2),
    "volumeBaseline" INTEGER,
    "growthBaselinePercent" DECIMAL(5,2),
    "desiredMarketShare" DECIMAL(5,2),
    "boundaryRule" "TierBoundaryRule",
    "priceReductionTrigger" "PriceReductionTrigger",
    "shortfallHandling" "TrueUpShortfallHandling" DEFAULT 'carry_forward',
    "negotiatedBaseline" DECIMAL(14,2),
    "growthOnly" BOOLEAN NOT NULL DEFAULT false,
    "periodCap" DECIMAL(14,2),
    "fixedRebatePerOccurrence" DECIMAL(12,2),
    "minimumPurchaseCommitment" DECIMAL(14,2),
    "adminFeePercent" DECIMAL(5,4),
    "cptCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupedReferenceNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referenceNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marketShareVendorId" TEXT,
    "marketShareCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_tier" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "tierNumber" INTEGER NOT NULL DEFAULT 1,
    "tierName" TEXT,
    "spendMin" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "spendMax" DECIMAL(14,2),
    "volumeMin" INTEGER,
    "volumeMax" INTEGER,
    "marketShareMin" DECIMAL(5,2),
    "marketShareMax" DECIMAL(5,2),
    "rebateType" "RebateType" NOT NULL DEFAULT 'percent_of_spend',
    "rebateValue" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "fixedRebateAmount" DECIMAL(14,2),
    "reducedPrice" DECIMAL(12,4),
    "priceReductionPercent" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_amortization_schedule" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "interestCharge" DECIMAL(14,2) NOT NULL,
    "principalDue" DECIMAL(14,2) NOT NULL,
    "amortizationDue" DECIMAL(14,2) NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_amortization_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_term_product" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "vendorItemNo" TEXT NOT NULL,
    "productDescription" TEXT,
    "contractPrice" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_term_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_term_procedure" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "cptCode" TEXT NOT NULL,
    "procedureDescription" TEXT,
    "rebateAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_term_procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_pricing" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "vendorItemNo" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "listPrice" DECIMAL(12,2),
    "discountPercentage" DECIMAL(5,2),
    "carveOutPercent" DECIMAL(5,4),
    "escalatorPercent" DECIMAL(5,4),
    "effectiveDate" DATE,
    "expirationDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_capital_line_item" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "itemNumber" TEXT,
    "serialNumber" TEXT,
    "contractTotal" DECIMAL(14,2) NOT NULL,
    "initialSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interestRate" DECIMAL(6,4),
    "termMonths" INTEGER,
    "paymentType" TEXT NOT NULL DEFAULT 'fixed',
    "paymentCadence" TEXT NOT NULL DEFAULT 'monthly',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_capital_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_document" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'main',
    "uploadDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" DATE,
    "size" INTEGER,
    "url" TEXT,
    "indexStatus" TEXT NOT NULL DEFAULT 'pending',
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_document_page" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_document_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_note" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renewal_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_task" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_alert_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "renewalReminderDaysBefore" INTEGER[] DEFAULT ARRAY[180, 90, 30]::INTEGER[],
    "expirationAlertDays" INTEGER NOT NULL DEFAULT 60,
    "includeUnderperformingContracts" BOOLEAN NOT NULL DEFAULT true,
    "includeOverperformingContracts" BOOLEAN NOT NULL DEFAULT false,
    "notifyChannels" TEXT[] DEFAULT ARRAY['email']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_alert_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_period" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "facilityId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalSpend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalVolume" INTEGER NOT NULL DEFAULT 0,
    "rebateEarned" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rebateCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentExpected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentActual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceExpected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceActual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tierAchieved" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tie_in_bundle" (
    "id" TEXT NOT NULL,
    "primaryContractId" TEXT NOT NULL,
    "complianceMode" "TieInMode" NOT NULL DEFAULT 'all_or_nothing',
    "baseRate" DECIMAL(5,2),
    "bonusRate" DECIMAL(5,2),
    "acceleratorMultiplier" DECIMAL(4,2),
    "bonusMultiplier" DECIMAL(5,4),
    "effectiveStart" TIMESTAMP(3),
    "effectiveEnd" TIMESTAMP(3),
    "facilityBonusRate" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tie_in_bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tie_in_bundle_member" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "contractId" TEXT,
    "vendorId" TEXT,
    "weightPercent" DECIMAL(5,2) NOT NULL,
    "minimumSpend" DECIMAL(14,2),
    "rebateContribution" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tie_in_bundle_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "actionUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_contract" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "facilityId" TEXT,
    "facilityName" TEXT,
    "contractName" TEXT NOT NULL,
    "contractType" "ContractType" NOT NULL DEFAULT 'usage',
    "status" "PendingContractStatus" NOT NULL DEFAULT 'submitted',
    "effectiveDate" DATE,
    "expirationDate" DATE,
    "totalValue" DECIMAL(14,2),
    "contractNumber" TEXT,
    "annualValue" DECIMAL(14,2),
    "gpoAffiliation" TEXT,
    "performancePeriod" TEXT,
    "rebatePayPeriod" TEXT,
    "autoRenewal" BOOLEAN NOT NULL DEFAULT false,
    "terminationNoticeDays" INTEGER,
    "capitalCost" DECIMAL(14,2),
    "interestRate" DECIMAL(6,4),
    "termMonths" INTEGER,
    "downPayment" DECIMAL(14,2),
    "paymentCadence" TEXT,
    "amortizationShape" TEXT,
    "capitalLineItems" JSONB,
    "tieInContractId" TEXT,
    "division" TEXT,
    "terms" JSONB NOT NULL DEFAULT '[]',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "pricingData" JSONB,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNotes" TEXT,

    CONSTRAINT "pending_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_change_proposal" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "facilityId" TEXT,
    "facilityName" TEXT,
    "proposalType" "ProposalType" NOT NULL DEFAULT 'term_change',
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "proposedTerms" JSONB,
    "vendorMessage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNotes" TEXT,

    CONSTRAINT "contract_change_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cog_record" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT,
    "inventoryNumber" TEXT NOT NULL,
    "inventoryDescription" TEXT NOT NULL,
    "vendorItemNo" TEXT,
    "manufacturerNo" TEXT,
    "poNumber" TEXT,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "extendedPrice" DECIMAL(14,2),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "transactionDate" DATE NOT NULL,
    "category" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "matchStatus" "COGMatchStatus" NOT NULL DEFAULT 'pending',
    "contractId" TEXT,
    "contractPrice" DECIMAL(12,2),
    "isOnContract" BOOLEAN NOT NULL DEFAULT false,
    "savingsAmount" DECIMAL(14,2),
    "variancePercent" DECIMAL(6,2),
    "fileImportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cog_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_file" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorItemNo" TEXT NOT NULL,
    "manufacturerNo" TEXT,
    "productDescription" TEXT NOT NULL,
    "listPrice" DECIMAL(12,2),
    "contractPrice" DECIMAL(12,2),
    "carveOutPercent" DECIMAL(5,4),
    "effectiveDate" DATE NOT NULL,
    "expirationDate" DATE,
    "category" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_import" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorId" TEXT,
    "fileType" "FileImportType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "recordCount" INTEGER,
    "onContractSpend" DECIMAL(14,2),
    "offContractSpend" DECIMAL(14,2),
    "totalSavings" DECIMAL(14,2),
    "matchedRecords" INTEGER,
    "unmatchedRecords" INTEGER,
    "uniqueVendors" INTEGER,
    "uniqueItems" INTEGER,
    "minTransactionDate" DATE,
    "maxTransactionDate" DATE,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "processingDurationMs" INTEGER,
    "status" "FileImportStatus" NOT NULL DEFAULT 'processing',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "portalType" TEXT NOT NULL,
    "alertType" "AlertType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'medium',
    "status" "AlertStatus" NOT NULL DEFAULT 'new_alert',
    "contractId" TEXT,
    "facilityId" TEXT,
    "vendorId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "actionLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "contractId" TEXT,
    "orderDate" DATE NOT NULL,
    "totalCost" DECIMAL(14,2),
    "status" "POStatus" NOT NULL DEFAULT 'draft',
    "isOffContract" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_line_item" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "sku" TEXT,
    "inventoryDescription" TEXT NOT NULL,
    "vendorItemNo" TEXT,
    "manufacturerNo" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "extendedPrice" DECIMAL(14,2) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "isOffContract" BOOLEAN NOT NULL DEFAULT false,
    "contractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "invoiceDate" DATE NOT NULL,
    "totalInvoiceCost" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "disputeStatus" "InvoiceDisputeStatus" NOT NULL DEFAULT 'none',
    "disputeNote" TEXT,
    "disputeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_item" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "inventoryDescription" TEXT NOT NULL,
    "vendorItemNo" TEXT,
    "invoicePrice" DECIMAL(12,2) NOT NULL,
    "invoiceQuantity" INTEGER NOT NULL,
    "totalLineCost" DECIMAL(14,2) NOT NULL,
    "contractPrice" DECIMAL(12,2),
    "variancePercent" DECIMAL(5,2),
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_price_variance" (
    "id" TEXT NOT NULL,
    "invoiceLineItemId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractPrice" DECIMAL(12,2) NOT NULL,
    "actualPrice" DECIMAL(12,2) NOT NULL,
    "variancePercent" DECIMAL(6,2) NOT NULL,
    "direction" "VarianceDirection" NOT NULL,
    "severity" "VarianceSeverity" NOT NULL,
    "dollarImpact" DECIMAL(14,2) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_price_variance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "periodId" TEXT,
    "rebateEarned" DECIMAL(14,2) NOT NULL,
    "rebateCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rebateUnearned" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payPeriodStart" DATE NOT NULL,
    "payPeriodEnd" DATE NOT NULL,
    "collectionDate" DATE,
    "notes" TEXT,
    "engineVersion" TEXT,
    "engineWarnings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rebate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_accrual" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "granularity" "AccrualGranularity" NOT NULL,
    "accruedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "trueUpAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "AccrualStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rebate_accrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "paymentAmount" DECIMAL(14,2) NOT NULL,
    "paymentType" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "creditDate" DATE NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL,
    "creditReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_name_mapping" (
    "id" TEXT NOT NULL,
    "cogVendorName" TEXT NOT NULL,
    "mappedVendorId" TEXT,
    "mappedVendorName" TEXT,
    "confidenceScore" DECIMAL(5,2),
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_name_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_mapping" (
    "id" TEXT NOT NULL,
    "cogCategory" TEXT NOT NULL,
    "contractCategory" TEXT,
    "similarityScore" DECIMAL(5,2),
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_benchmark" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorItemNo" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "nationalAvgPrice" DECIMAL(12,2),
    "percentile25" DECIMAL(12,2),
    "percentile50" DECIMAL(12,2),
    "percentile75" DECIMAL(12,2),
    "minPrice" DECIMAL(12,2),
    "maxPrice" DECIMAL(12,2),
    "sampleSize" INTEGER,
    "dataDate" DATE,
    "source" TEXT NOT NULL DEFAULT 'national_benchmark',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_benchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_record" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "surgeonName" TEXT,
    "surgeonId" TEXT,
    "patientDob" DATE,
    "patientBmi" DECIMAL(5,2),
    "payorClass" TEXT,
    "dateOfSurgery" DATE NOT NULL,
    "timeInOr" TEXT,
    "timeOutOr" TEXT,
    "primaryCptCode" TEXT,
    "totalSpend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalReimbursement" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "margin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "complianceStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_procedure" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "cptCode" TEXT NOT NULL,
    "procedureDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_supply" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "vendorItemNo" TEXT,
    "usedCost" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "extendedCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isOnContract" BOOLEAN NOT NULL DEFAULT false,
    "contractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_costing_file" (
    "id" TEXT NOT NULL,
    "fileType" "CaseCostingFileType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "columnHeaders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_costing_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgeon_usage" (
    "id" TEXT NOT NULL,
    "surgeonId" TEXT NOT NULL,
    "surgeonName" TEXT,
    "contractId" TEXT,
    "facilityId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "usageAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "complianceRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgeon_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payor_contract" (
    "id" TEXT NOT NULL,
    "payorName" TEXT NOT NULL,
    "payorType" "PayorType" NOT NULL DEFAULT 'commercial',
    "facilityId" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "expirationDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cptRates" JSONB NOT NULL DEFAULT '[]',
    "grouperRates" JSONB NOT NULL DEFAULT '[]',
    "multiProcedureRule" JSONB NOT NULL DEFAULT '{}',
    "implantPassthrough" BOOLEAN NOT NULL DEFAULT true,
    "implantMarkup" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,
    "fileName" TEXT,
    "notes" TEXT,

    CONSTRAINT "payor_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'pending',
    "inviteType" "ConnectionInviteType" NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "invitedByEmail" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT,

    CONSTRAINT "connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "purchaseOrdersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiAgentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "vendorPortalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "advancedReportsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "caseCostingEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "vendorId" TEXT,
    "tierId" "CreditTierId" NOT NULL DEFAULT 'starter',
    "monthlyCredits" INTEGER NOT NULL DEFAULT 500,
    "usedCredits" INTEGER NOT NULL DEFAULT 0,
    "rolloverCredits" INTEGER NOT NULL DEFAULT 0,
    "billingPeriodStart" DATE NOT NULL,
    "billingPeriodEnd" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_record" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "creditsUsed" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedule" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "emailRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_insight_cache" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "costCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rebate_insight_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_insight_flag" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "flaggedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rebate_insight_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_brief_cache" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "costCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_brief_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_role_idx" ON "user"("role");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "health_system_code_key" ON "health_system"("code");

-- CreateIndex
CREATE UNIQUE INDEX "facility_organizationId_key" ON "facility"("organizationId");

-- CreateIndex
CREATE INDEX "facility_status_idx" ON "facility"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_organizationId_key" ON "vendor"("organizationId");

-- CreateIndex
CREATE INDEX "cross_vendor_tie_in_facilityId_status_idx" ON "cross_vendor_tie_in"("facilityId", "status");

-- CreateIndex
CREATE INDEX "cross_vendor_tie_in_member_crossVendorTieInId_idx" ON "cross_vendor_tie_in_member"("crossVendorTieInId");

-- CreateIndex
CREATE INDEX "cross_vendor_tie_in_member_vendorId_idx" ON "cross_vendor_tie_in_member"("vendorId");

-- CreateIndex
CREATE INDEX "contract_vendorId_idx" ON "contract"("vendorId");

-- CreateIndex
CREATE INDEX "contract_facilityId_idx" ON "contract"("facilityId");

-- CreateIndex
CREATE INDEX "contract_status_idx" ON "contract"("status");

-- CreateIndex
CREATE INDEX "contract_expirationDate_idx" ON "contract"("expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "contract_product_category_contractId_productCategoryId_key" ON "contract_product_category"("contractId", "productCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_facility_contractId_facilityId_key" ON "contract_facility"("contractId", "facilityId");

-- CreateIndex
CREATE INDEX "contract_term_contractId_idx" ON "contract_term"("contractId");

-- CreateIndex
CREATE INDEX "contract_tier_termId_idx" ON "contract_tier"("termId");

-- CreateIndex
CREATE INDEX "contract_amortization_schedule_contractId_idx" ON "contract_amortization_schedule"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_amortization_schedule_contractId_periodNumber_key" ON "contract_amortization_schedule"("contractId", "periodNumber");

-- CreateIndex
CREATE INDEX "contract_pricing_contractId_idx" ON "contract_pricing"("contractId");

-- CreateIndex
CREATE INDEX "contract_pricing_vendorItemNo_idx" ON "contract_pricing"("vendorItemNo");

-- CreateIndex
CREATE UNIQUE INDEX "contract_pricing_contractId_vendorItemNo_key" ON "contract_pricing"("contractId", "vendorItemNo");

-- CreateIndex
CREATE INDEX "contract_capital_line_item_contractId_idx" ON "contract_capital_line_item"("contractId");

-- CreateIndex
CREATE INDEX "contract_document_contractId_idx" ON "contract_document"("contractId");

-- CreateIndex
CREATE INDEX "contract_document_page_documentId_idx" ON "contract_document_page"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_document_page_documentId_pageNumber_key" ON "contract_document_page"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "renewal_note_contractId_idx" ON "renewal_note"("contractId");

-- CreateIndex
CREATE INDEX "renewal_note_createdAt_idx" ON "renewal_note"("createdAt");

-- CreateIndex
CREATE INDEX "renewal_note_authorId_idx" ON "renewal_note"("authorId");

-- CreateIndex
CREATE INDEX "renewal_task_contractId_idx" ON "renewal_task"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "renewal_task_contractId_taskKey_key" ON "renewal_task"("contractId", "taskKey");

-- CreateIndex
CREATE UNIQUE INDEX "renewal_alert_settings_userId_key" ON "renewal_alert_settings"("userId");

-- CreateIndex
CREATE INDEX "contract_period_contractId_idx" ON "contract_period"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "tie_in_bundle_primaryContractId_key" ON "tie_in_bundle"("primaryContractId");

-- CreateIndex
CREATE INDEX "tie_in_bundle_member_bundleId_idx" ON "tie_in_bundle_member"("bundleId");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "pending_contract_vendorId_idx" ON "pending_contract"("vendorId");

-- CreateIndex
CREATE INDEX "pending_contract_facilityId_idx" ON "pending_contract"("facilityId");

-- CreateIndex
CREATE INDEX "pending_contract_status_idx" ON "pending_contract"("status");

-- CreateIndex
CREATE INDEX "contract_change_proposal_contractId_idx" ON "contract_change_proposal"("contractId");

-- CreateIndex
CREATE INDEX "contract_change_proposal_status_idx" ON "contract_change_proposal"("status");

-- CreateIndex
CREATE INDEX "cog_record_facilityId_idx" ON "cog_record"("facilityId");

-- CreateIndex
CREATE INDEX "cog_record_vendorId_idx" ON "cog_record"("vendorId");

-- CreateIndex
CREATE INDEX "cog_record_transactionDate_idx" ON "cog_record"("transactionDate");

-- CreateIndex
CREATE INDEX "cog_record_vendorItemNo_idx" ON "cog_record"("vendorItemNo");

-- CreateIndex
CREATE INDEX "cog_record_matchStatus_idx" ON "cog_record"("matchStatus");

-- CreateIndex
CREATE INDEX "cog_record_facilityId_matchStatus_idx" ON "cog_record"("facilityId", "matchStatus");

-- CreateIndex
CREATE INDEX "cog_record_contractId_idx" ON "cog_record"("contractId");

-- CreateIndex
CREATE INDEX "cog_record_facilityId_isOnContract_idx" ON "cog_record"("facilityId", "isOnContract");

-- CreateIndex
CREATE INDEX "cog_record_fileImportId_idx" ON "cog_record"("fileImportId");

-- CreateIndex
CREATE INDEX "pricing_file_vendorId_idx" ON "pricing_file"("vendorId");

-- CreateIndex
CREATE INDEX "pricing_file_facilityId_idx" ON "pricing_file"("facilityId");

-- CreateIndex
CREATE INDEX "pricing_file_vendorItemNo_idx" ON "pricing_file"("vendorItemNo");

-- CreateIndex
CREATE INDEX "file_import_facilityId_idx" ON "file_import"("facilityId");

-- CreateIndex
CREATE INDEX "file_import_facilityId_fileType_idx" ON "file_import"("facilityId", "fileType");

-- CreateIndex
CREATE INDEX "file_import_facilityId_status_idx" ON "file_import"("facilityId", "status");

-- CreateIndex
CREATE INDEX "file_import_vendorId_idx" ON "file_import"("vendorId");

-- CreateIndex
CREATE INDEX "alert_facilityId_idx" ON "alert"("facilityId");

-- CreateIndex
CREATE INDEX "alert_vendorId_idx" ON "alert"("vendorId");

-- CreateIndex
CREATE INDEX "alert_status_idx" ON "alert"("status");

-- CreateIndex
CREATE INDEX "alert_alertType_idx" ON "alert"("alertType");

-- CreateIndex
CREATE INDEX "purchase_order_facilityId_idx" ON "purchase_order"("facilityId");

-- CreateIndex
CREATE INDEX "purchase_order_vendorId_idx" ON "purchase_order"("vendorId");

-- CreateIndex
CREATE INDEX "purchase_order_status_idx" ON "purchase_order"("status");

-- CreateIndex
CREATE INDEX "invoice_facilityId_idx" ON "invoice"("facilityId");

-- CreateIndex
CREATE INDEX "invoice_vendorId_idx" ON "invoice"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_price_variance_invoiceLineItemId_key" ON "invoice_price_variance"("invoiceLineItemId");

-- CreateIndex
CREATE INDEX "invoice_price_variance_contractId_idx" ON "invoice_price_variance"("contractId");

-- CreateIndex
CREATE INDEX "invoice_price_variance_severity_idx" ON "invoice_price_variance"("severity");

-- CreateIndex
CREATE INDEX "rebate_contractId_idx" ON "rebate"("contractId");

-- CreateIndex
CREATE INDEX "rebate_accrual_contractId_idx" ON "rebate_accrual"("contractId");

-- CreateIndex
CREATE INDEX "rebate_accrual_contractId_periodStart_idx" ON "rebate_accrual"("contractId", "periodStart");

-- CreateIndex
CREATE INDEX "vendor_name_mapping_cogVendorName_idx" ON "vendor_name_mapping"("cogVendorName");

-- CreateIndex
CREATE INDEX "product_benchmark_vendorItemNo_idx" ON "product_benchmark"("vendorItemNo");

-- CreateIndex
CREATE UNIQUE INDEX "case_record_caseNumber_key" ON "case_record"("caseNumber");

-- CreateIndex
CREATE INDEX "case_record_facilityId_idx" ON "case_record"("facilityId");

-- CreateIndex
CREATE INDEX "case_record_surgeonName_idx" ON "case_record"("surgeonName");

-- CreateIndex
CREATE INDEX "case_record_dateOfSurgery_idx" ON "case_record"("dateOfSurgery");

-- CreateIndex
CREATE INDEX "case_record_facilityId_payorClass_idx" ON "case_record"("facilityId", "payorClass");

-- CreateIndex
CREATE INDEX "case_supply_caseId_idx" ON "case_supply"("caseId");

-- CreateIndex
CREATE INDEX "case_supply_vendorItemNo_idx" ON "case_supply"("vendorItemNo");

-- CreateIndex
CREATE INDEX "payor_contract_facilityId_idx" ON "payor_contract"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "payor_contract_facilityId_payorName_contractNumber_key" ON "payor_contract"("facilityId", "payorName", "contractNumber");

-- CreateIndex
CREATE INDEX "connection_facilityId_idx" ON "connection"("facilityId");

-- CreateIndex
CREATE INDEX "connection_vendorId_idx" ON "connection"("vendorId");

-- CreateIndex
CREATE INDEX "connection_status_idx" ON "connection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_facilityId_key" ON "feature_flag"("facilityId");

-- CreateIndex
CREATE INDEX "ai_credit_facilityId_idx" ON "ai_credit"("facilityId");

-- CreateIndex
CREATE INDEX "ai_credit_vendorId_idx" ON "ai_credit"("vendorId");

-- CreateIndex
CREATE INDEX "ai_credit_billingPeriodStart_idx" ON "ai_credit"("billingPeriodStart");

-- CreateIndex
CREATE INDEX "audit_log_userId_idx" ON "audit_log"("userId");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "rebate_insight_cache_facilityId_expiresAt_idx" ON "rebate_insight_cache"("facilityId", "expiresAt");

-- CreateIndex
CREATE INDEX "rebate_insight_cache_facilityId_inputHash_idx" ON "rebate_insight_cache"("facilityId", "inputHash");

-- CreateIndex
CREATE INDEX "rebate_insight_flag_facilityId_createdAt_idx" ON "rebate_insight_flag"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "renewal_brief_cache_contractId_expiresAt_idx" ON "renewal_brief_cache"("contractId", "expiresAt");

-- CreateIndex
CREATE INDEX "renewal_brief_cache_contractId_inputHash_idx" ON "renewal_brief_cache"("contractId", "inputHash");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility" ADD CONSTRAINT "facility_healthSystemId_fkey" FOREIGN KEY ("healthSystemId") REFERENCES "health_system"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility" ADD CONSTRAINT "facility_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_parentVendorId_fkey" FOREIGN KEY ("parentVendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_vendor_tie_in" ADD CONSTRAINT "cross_vendor_tie_in_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_vendor_tie_in_member" ADD CONSTRAINT "cross_vendor_tie_in_member_crossVendorTieInId_fkey" FOREIGN KEY ("crossVendorTieInId") REFERENCES "cross_vendor_tie_in"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_vendor_tie_in_member" ADD CONSTRAINT "cross_vendor_tie_in_member_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_division" ADD CONSTRAINT "vendor_division_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "product_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "product_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_product_category" ADD CONSTRAINT "contract_product_category_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_product_category" ADD CONSTRAINT "contract_product_category_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "product_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_facility" ADD CONSTRAINT "contract_facility_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_facility" ADD CONSTRAINT "contract_facility_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_term" ADD CONSTRAINT "contract_term_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_tier" ADD CONSTRAINT "contract_tier_termId_fkey" FOREIGN KEY ("termId") REFERENCES "contract_term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amortization_schedule" ADD CONSTRAINT "contract_amortization_schedule_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_term_product" ADD CONSTRAINT "contract_term_product_termId_fkey" FOREIGN KEY ("termId") REFERENCES "contract_term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_term_procedure" ADD CONSTRAINT "contract_term_procedure_termId_fkey" FOREIGN KEY ("termId") REFERENCES "contract_term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_pricing" ADD CONSTRAINT "contract_pricing_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_capital_line_item" ADD CONSTRAINT "contract_capital_line_item_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document" ADD CONSTRAINT "contract_document_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document_page" ADD CONSTRAINT "contract_document_page_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "contract_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_note" ADD CONSTRAINT "renewal_note_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_note" ADD CONSTRAINT "renewal_note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_task" ADD CONSTRAINT "renewal_task_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_task" ADD CONSTRAINT "renewal_task_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_alert_settings" ADD CONSTRAINT "renewal_alert_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_period" ADD CONSTRAINT "contract_period_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_period" ADD CONSTRAINT "contract_period_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tie_in_bundle" ADD CONSTRAINT "tie_in_bundle_primaryContractId_fkey" FOREIGN KEY ("primaryContractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tie_in_bundle_member" ADD CONSTRAINT "tie_in_bundle_member_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "tie_in_bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tie_in_bundle_member" ADD CONSTRAINT "tie_in_bundle_member_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_contract" ADD CONSTRAINT "pending_contract_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_contract" ADD CONSTRAINT "pending_contract_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_change_proposal" ADD CONSTRAINT "contract_change_proposal_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cog_record" ADD CONSTRAINT "cog_record_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cog_record" ADD CONSTRAINT "cog_record_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cog_record" ADD CONSTRAINT "cog_record_fileImportId_fkey" FOREIGN KEY ("fileImportId") REFERENCES "file_import"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_file" ADD CONSTRAINT "pricing_file_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_file" ADD CONSTRAINT "pricing_file_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_item" ADD CONSTRAINT "po_line_item_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_price_variance" ADD CONSTRAINT "invoice_price_variance_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "invoice_line_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_price_variance" ADD CONSTRAINT "invoice_price_variance_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate" ADD CONSTRAINT "rebate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate" ADD CONSTRAINT "rebate_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate" ADD CONSTRAINT "rebate_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "contract_period"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate_accrual" ADD CONSTRAINT "rebate_accrual_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit" ADD CONSTRAINT "credit_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit" ADD CONSTRAINT "credit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit" ADD CONSTRAINT "credit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_name_mapping" ADD CONSTRAINT "vendor_name_mapping_mappedVendorId_fkey" FOREIGN KEY ("mappedVendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_benchmark" ADD CONSTRAINT "product_benchmark_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_record" ADD CONSTRAINT "case_record_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_procedure" ADD CONSTRAINT "case_procedure_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_supply" ADD CONSTRAINT "case_supply_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeon_usage" ADD CONSTRAINT "surgeon_usage_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeon_usage" ADD CONSTRAINT "surgeon_usage_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payor_contract" ADD CONSTRAINT "payor_contract_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection" ADD CONSTRAINT "connection_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection" ADD CONSTRAINT "connection_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit" ADD CONSTRAINT "ai_credit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit" ADD CONSTRAINT "ai_credit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_record" ADD CONSTRAINT "ai_usage_record_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "ai_credit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate_insight_cache" ADD CONSTRAINT "rebate_insight_cache_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate_insight_flag" ADD CONSTRAINT "rebate_insight_flag_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate_insight_flag" ADD CONSTRAINT "rebate_insight_flag_flaggedBy_fkey" FOREIGN KEY ("flaggedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_brief_cache" ADD CONSTRAINT "renewal_brief_cache_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

