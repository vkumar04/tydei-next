import type { VendorPORow, VendorFacilityRow, VendorProductRow } from "@/lib/actions/vendor-purchase-orders"

// ─── PO Type Config ────────────────────────────────────────────────

export type POType = "standard" | "blanket" | "planned" | "contract" | "emergency"

export const poTypeLabels: Record<POType, string> = {
  standard: "Standard",
  blanket: "Blanket",
  planned: "Planned",
  contract: "Contract",
  emergency: "Emergency",
}

export const poTypeDescriptions: Record<POType, string> = {
  standard: "One-time purchase order for immediate needs",
  blanket: "Ongoing order with set terms over a period",
  planned: "Scheduled future order with confirmed delivery",
  contract: "Order tied to an existing contract agreement",
  emergency: "Urgent order requiring expedited processing",
}

// ─── PO Status Config ──────────────────────────────────────────────

export const poStatusConfig: Record<string, { label: string; color: string; description: string }> = {
  pending_approval: { label: "Pending Approval", color: "bg-orange-100 text-orange-800", description: "Awaiting facility review" },
  pending: { label: "Pending", color: "bg-orange-100 text-orange-800", description: "Awaiting facility review" },
  draft: { label: "Draft", color: "bg-gray-100 text-gray-800", description: "Draft order" },
  approved: { label: "Approved", color: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300", description: "Facility approved - ready to process" },
  rejected: { label: "Rejected", color: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300", description: "Facility declined this order" },
  sent: { label: "Sent", color: "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300", description: "Order sent to facility" },
  acknowledged: { label: "Acknowledged", color: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-300", description: "Facility confirmed receipt" },
  processing: { label: "Processing", color: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300", description: "Order being prepared" },
  shipped: { label: "Shipped", color: "bg-purple-100 text-purple-800", description: "Order in transit" },
  fulfilled: { label: "Fulfilled", color: "bg-green-200 text-green-900", description: "Order completed" },
  completed: { label: "Completed", color: "bg-green-200 text-green-900", description: "Order completed" },
  cancelled: { label: "Cancelled", color: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300", description: "Order cancelled" },
}

// ─── Line Item Type ────────────────────────────────────────────────

export interface POLineItem {
  productId: string
  productName: string
  description?: string
  sku: string
  vendorItemNo?: string
  lotSn?: string
  quantity: number
  unitPrice: number
  uom: string
  isException?: boolean
  exceptionReason?: string
}

// ─── Stats Shape ───────────────────────────────────────────────────

export interface POStats {
  pendingApproval: number
  approved: number
  inProgress: number
  fulfilled: number
  rejected: number
  totalValue: number
}

// Re-export types from server actions for convenience
export type { VendorPORow, VendorFacilityRow, VendorProductRow }
