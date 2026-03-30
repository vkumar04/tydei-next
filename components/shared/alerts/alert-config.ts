import {
  AlertTriangle,
  Clock,
  TrendingUp,
  DollarSign,
  CreditCard,
  AlertCircle,
  ShieldAlert,
  FileX,
  type LucideIcon,
} from "lucide-react"
import type { StatusConfig } from "@/lib/types"

export const alertTypeIconConfig: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  off_contract: { icon: FileX, color: "text-red-500", label: "Off-Contract" },
  expiring_contract: { icon: Clock, color: "text-yellow-600", label: "Expiring" },
  tier_threshold: { icon: TrendingUp, color: "text-blue-500", label: "Tier Threshold" },
  rebate_due: { icon: DollarSign, color: "text-green-500", label: "Rebate Due" },
  payment_due: { icon: DollarSign, color: "text-orange-500", label: "Payment Due" },
  pricing_error: { icon: AlertCircle, color: "text-red-500", label: "Pricing Error" },
  compliance: { icon: ShieldAlert, color: "text-amber-500", label: "Compliance" },
}

export const alertSeverityBadgeConfig: Record<string, StatusConfig & { className: string }> = {
  high: { label: "High", variant: "default", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  medium: { label: "Medium", variant: "default", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  low: { label: "Low", variant: "default", className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
}

export const alertColorBg: Record<string, string> = {
  off_contract: "text-red-500 bg-red-50 dark:bg-red-950",
  expiring_contract: "text-yellow-600 bg-yellow-50 dark:bg-yellow-950",
  tier_threshold: "text-blue-500 bg-blue-50 dark:bg-blue-950",
  rebate_due: "text-green-500 bg-green-50 dark:bg-green-950",
  payment_due: "text-orange-500 bg-orange-50 dark:bg-orange-950",
  pricing_error: "text-red-500 bg-red-50 dark:bg-red-950",
  compliance: "text-amber-500 bg-amber-50 dark:bg-amber-950",
}

export const statusColors: Record<string, string> = {
  new_alert: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  read: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  dismissed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
}
