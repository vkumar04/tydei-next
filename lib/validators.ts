import { z } from "zod"

// ─── Enum Validators ──────────────────────────────────────────────

export const UserRoleSchema = z.enum(["facility", "vendor", "admin"])
export const ContractTypeSchema = z.enum(["usage", "capital", "service", "tie_in", "grouped", "pricing_only"])
export const ContractStatusSchema = z.enum(["active", "expired", "expiring", "draft", "pending"])
export const TermTypeSchema = z.enum(["spend_rebate", "volume_rebate", "price_reduction", "market_share", "market_share_price_reduction", "capitated_price_reduction", "capitated_pricing_rebate", "po_rebate", "carve_out", "payment_rebate", "growth_rebate", "compliance_rebate", "fixed_fee", "locked_pricing", "rebate_per_use"])
export const VolumeTypeSchema = z.enum(["product_category", "catalog_cap_based", "procedure_code"])
export const RebateTypeSchema = z.enum(["percent_of_spend", "fixed_rebate", "fixed_rebate_per_unit", "per_procedure_rebate"])
export const RebateMethodSchema = z.enum(["cumulative", "marginal"])
export const BaselineTypeSchema = z.enum(["spend_based", "volume_based", "growth_based"])
export const PerformancePeriodSchema = z.enum(["monthly", "quarterly", "semi_annual", "annual"])
export const AlertTypeSchema = z.enum(["off_contract", "expiring_contract", "tier_threshold", "rebate_due", "payment_due", "pricing_error", "compliance", "compliance_drop", "vendor_inactive", "tie_in_at_risk"])
export const AlertSeveritySchema = z.enum(["high", "medium", "low"])
export const AlertStatusSchema = z.enum(["new_alert", "read", "resolved", "dismissed"])
export const POStatusSchema = z.enum(["draft", "pending", "approved", "sent", "completed", "cancelled"])
export const FacilityTypeSchema = z.enum(["hospital", "asc", "clinic", "surgery_center"])
export const VendorTierSchema = z.enum(["standard", "premium"])
export const ConnectionStatusSchema = z.enum(["pending", "accepted", "rejected", "expired"])
export const PendingContractStatusSchema = z.enum(["draft", "submitted", "approved", "rejected", "revision_requested", "withdrawn"])

// ─── Login / Auth Validators ──────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export const signUpSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Confirm your password"),
  role: z.enum(["facility", "vendor"]),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
})

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
})

export const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignUpInput = z.infer<typeof signUpSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
