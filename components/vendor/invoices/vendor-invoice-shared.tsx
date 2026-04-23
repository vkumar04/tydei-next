"use client"

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  FileUp,
} from "lucide-react"

/**
 * Shared status + row types for the Vendor Invoices surface.
 * Kept as a sibling so the list, hero, and dialog stay in sync
 * on the status vocabulary.
 */
export type InvoiceStatus =
  | "draft"
  | "submitted"
  | "pending"
  | "validated"
  | "disputed"
  | "approved"
  | "paid"

export type InvoiceRow = {
  id: string
  invoiceNumber: string
  facility: { name: string } | null
  purchaseOrder: { id: string; poNumber: string } | null
  invoiceDate: Date | string
  totalInvoiceCost: number | string | null
  status: string
  lineItemCount: number
  flaggedCount: number
  variance: number
  variancePercent: number
}

export interface StatusConfigEntry {
  label: string
  color: string
  icon: React.ElementType
}

export const statusConfig: Record<string, StatusConfigEntry> = {
  draft: {
    label: "Draft",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    icon: Clock,
  },
  submitted: {
    label: "Submitted",
    color:
      "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    icon: FileUp,
  },
  pending: {
    label: "Pending",
    color:
      "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    icon: FileText,
  },
  validated: {
    label: "Validated",
    color:
      "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    icon: CheckCircle2,
  },
  disputed: {
    label: "Disputed",
    color: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    icon: AlertTriangle,
  },
  approved: {
    label: "Approved",
    color:
      "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  paid: {
    label: "Paid",
    color:
      "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
    icon: DollarSign,
  },
}

export const statusTabs: {
  value: string
  label: string
  icon: React.ElementType
}[] = [
  { value: "all", label: "All", icon: FileText },
  { value: "draft", label: "Draft", icon: Clock },
  { value: "submitted", label: "Sent", icon: FileUp },
  { value: "paid", label: "Paid", icon: DollarSign },
  { value: "disputed", label: "Disputed", icon: AlertTriangle },
]
