import {
  AlertTriangle,
  Clock,
  TrendingUp,
  DollarSign,
  CreditCard,
  AlertCircle,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react"
import type { StatusConfig } from "@/lib/types"

export const alertTypeIconConfig: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  off_contract: { icon: AlertTriangle, color: "text-red-500", label: "Off-Contract" },
  expiring_contract: { icon: Clock, color: "text-amber-500", label: "Expiring" },
  tier_threshold: { icon: TrendingUp, color: "text-blue-500", label: "Tier Threshold" },
  rebate_due: { icon: DollarSign, color: "text-emerald-500", label: "Rebate Due" },
  payment_due: { icon: CreditCard, color: "text-purple-500", label: "Payment Due" },
  pricing_error: { icon: AlertCircle, color: "text-red-500", label: "Pricing Error" },
  compliance: { icon: ShieldAlert, color: "text-amber-500", label: "Compliance" },
}

export const alertSeverityBadgeConfig: Record<string, StatusConfig> = {
  high: { label: "High", variant: "destructive" },
  medium: { label: "Medium", variant: "secondary", className: "bg-amber-600 hover:bg-amber-600 text-white" },
  low: { label: "Low", variant: "outline" },
}
