import { z } from "zod"

// ─── Case Input (for import) ───────────────────────────────────

export const caseInputSchema = z.object({
  caseNumber: z.string().min(1, "Case number is required"),
  surgeonName: z.string().optional(),
  surgeonId: z.string().optional(),
  dateOfSurgery: z.string().min(1, "Date of surgery is required"),
  primaryCptCode: z.string().optional(),
  totalSpend: z.number().min(0),
  totalReimbursement: z.number().min(0).optional(),
  timeInOr: z.string().optional(),
  timeOutOr: z.string().optional(),
})

export type CaseInput = z.infer<typeof caseInputSchema>

// ─── Case Supply Input ─────────────────────────────────────────

export const caseSupplyInputSchema = z.object({
  materialName: z.string().min(1, "Material name is required"),
  vendorItemNo: z.string().optional(),
  usedCost: z.number().min(0),
  quantity: z.number().int().min(1).default(1),
  isOnContract: z.boolean().default(false),
  contractId: z.string().optional(),
})

export type CaseSupplyInput = z.infer<typeof caseSupplyInputSchema>

// ─── Case Filters ──────────────────────────────────────────────

export const caseFiltersSchema = z.object({
  facilityId: z.string(),
  surgeonName: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  cptCode: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export type CaseFilters = z.infer<typeof caseFiltersSchema>

// ─── Surgeon Comparison Input ──────────────────────────────────

export const surgeonComparisonInputSchema = z.object({
  facilityId: z.string(),
  surgeonNames: z.array(z.string()).min(2, "Select at least 2 surgeons"),
  cptCode: z.string().optional(),
})

export type SurgeonComparisonInput = z.infer<typeof surgeonComparisonInputSchema>
