import { z } from "zod"
import { ContractTypeSchema } from "@/lib/validators"

export const createPendingContractSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  vendorName: z.string().min(1),
  facilityId: z.string().optional(),
  facilityName: z.string().optional(),
  contractName: z.string().min(1, "Contract name is required"),
  contractType: ContractTypeSchema,
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  totalValue: z.number().min(0).optional(),
  // Charles 2026-04-25 (vendor-mirror Phase 2): field-parity columns
  // now backed by real DB columns on PendingContract. The vendor
  // submission UI was already collecting these in local state but
  // the server boundary dropped them — all optional so older clients
  // stay compatible.
  contractNumber: z.string().optional(),
  annualValue: z.number().min(0).optional(),
  gpoAffiliation: z.string().optional(),
  performancePeriod: z
    .enum(["monthly", "quarterly", "semi_annual", "annual"])
    .optional(),
  rebatePayPeriod: z
    .enum(["monthly", "quarterly", "semi_annual", "annual"])
    .optional(),
  autoRenewal: z.boolean().optional(),
  terminationNoticeDays: z.number().int().min(0).optional(),
  // Charles 2026-04-25 (vendor-mirror Phase 2 cont.): capital tie-in
  // fields. Persisted as their own columns so vendor submissions of
  // capital/tie-in contracts carry through approval cleanly.
  capitalCost: z.number().min(0).optional(),
  interestRate: z.number().min(0).max(1).optional(),
  termMonths: z.number().int().min(0).optional(),
  downPayment: z.number().min(0).optional(),
  paymentCadence: z.enum(["monthly", "quarterly", "annual"]).optional(),
  amortizationShape: z.enum(["symmetrical", "custom"]).optional(),
  // Charles audit suggestion #4 (v0-port): multi-item capital on
  // vendor submission. Each item mirrors v0's LeasedServiceItem +
  // tydei's ContractCapitalLineItem.
  capitalLineItems: z
    .array(
      z.object({
        description: z.string().min(1),
        itemNumber: z.string().nullable().optional(),
        serialNumber: z.string().nullable().optional(),
        contractTotal: z.number().min(0),
        initialSales: z.number().min(0).default(0),
        interestRate: z.number().min(0).max(1).nullable().optional(),
        termMonths: z.number().int().min(0).nullable().optional(),
        paymentType: z.enum(["fixed", "variable"]).default("fixed"),
        paymentCadence: z
          .enum(["monthly", "quarterly", "annual"])
          .default("monthly"),
      }),
    )
    .optional(),
  // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5):
  // schema-gate the `terms` blob so a partial term (missing tiers,
  // wrong shape, etc.) can't silently land in the DB and then approve
  // into a contract with an empty rebate ladder. The shape carries
  // every field the engine needs — spend / growth / volume_rebate /
  // market_share — so vendors submitting volume- or market-share-style
  // contracts don't silently lose volumeBaseline / desiredMarketShare /
  // volumeMin / volumeMax / marketShareMin / marketShareMax at this
  // boundary (zod default-strict drops unknown keys).
  terms: z
    .array(
      z.object({
        termName: z.string().min(1),
        termType: z.string().min(1),
        baselineType: z.string().optional(),
        evaluationPeriod: z.string().optional(),
        paymentTiming: z.string().optional(),
        appliesTo: z.string().optional(),
        rebateMethod: z.string().optional(),
        spendBaseline: z
          .union([z.number(), z.string(), z.null()])
          .optional(),
        growthBaselinePercent: z
          .union([z.number(), z.string(), z.null()])
          .optional(),
        // volume_rebate / market_share / scope-style fields. Pre-fix
        // these were stripped here; post-approve the engines
        // (recompute-volume-accrual, recompute-threshold-accrual)
        // matched against missing volumeMin/volumeMax/marketShareMin/
        // marketShareMax columns and computed $0 forever.
        volumeBaseline: z
          .union([z.number(), z.string(), z.null()])
          .optional(),
        desiredMarketShare: z
          .union([z.number(), z.string(), z.null()])
          .optional(),
        volumeType: z.string().nullable().optional(),
        scopedCategoryIds: z.array(z.string()).optional(),
        scopedItemNumbers: z.array(z.string()).optional(),
        cptCodes: z.array(z.string()).optional(),
        effectiveStart: z.string().optional(),
        effectiveEnd: z.string().optional(),
        tiers: z
          .array(
            z.object({
              tierNumber: z.number().int().min(1),
              tierName: z.string().nullable().optional(),
              spendMin: z.union([z.number(), z.string()]),
              spendMax: z
                .union([z.number(), z.string(), z.null()])
                .optional(),
              // Per-tier volume + market-share thresholds. Same
              // null/numeric/string shape as spendMin/spendMax.
              volumeMin: z
                .union([z.number(), z.string(), z.null()])
                .optional(),
              volumeMax: z
                .union([z.number(), z.string(), z.null()])
                .optional(),
              marketShareMin: z
                .union([z.number(), z.string(), z.null()])
                .optional(),
              marketShareMax: z
                .union([z.number(), z.string(), z.null()])
                .optional(),
              rebateType: z.string().min(1),
              rebateValue: z.union([z.number(), z.string()]),
            }),
          )
          .min(1, "Each term must have at least one tier"),
      }),
    )
    .optional(),
  documents: z.any().optional(),
  pricingData: z.any().optional(),
  notes: z.string().optional(),
  division: z.string().optional(),
  tieInContractId: z.string().optional(),
})

export type CreatePendingContractInput = z.infer<typeof createPendingContractSchema>

export const updatePendingContractSchema = createPendingContractSchema.partial()

export type UpdatePendingContractInput = z.infer<typeof updatePendingContractSchema>

export const reviewPendingContractSchema = z.object({
  reviewedBy: z.string().min(1),
  notes: z.string().optional(),
})

export type ReviewPendingContractInput = z.infer<typeof reviewPendingContractSchema>
