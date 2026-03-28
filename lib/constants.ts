import type { NavItem, StatusConfig } from "@/lib/types"

// ─── Facility Portal Nav ──────────────────────────────────────────

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

// ─── Vendor Portal Nav ────────────────────────────────────────────

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

// ─── Admin Portal Nav ─────────────────────────────────────────────

export const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "LayoutDashboard" },
  { label: "Facilities", href: "/admin/facilities", icon: "Building2" },
  { label: "Vendors", href: "/admin/vendors", icon: "Truck" },
  { label: "Users", href: "/admin/users", icon: "Users" },
  { label: "Billing", href: "/admin/billing", icon: "CreditCard" },
  { label: "Payor Contracts", href: "/admin/payor-contracts", icon: "Shield" },
]

// ─── Status Badge Configs ─────────────────────────────────────────

export const contractStatusConfig: Record<string, StatusConfig> = {
  active: { label: "Active", variant: "default", className: "bg-emerald-600 hover:bg-emerald-600" },
  expired: { label: "Expired", variant: "destructive" },
  expiring: { label: "Expiring", variant: "secondary", className: "bg-amber-600 hover:bg-amber-600 text-white" },
  draft: { label: "Draft", variant: "outline" },
  pending: { label: "Pending", variant: "secondary" },
}

export const alertTypeConfig: Record<string, StatusConfig> = {
  off_contract: { label: "Off-Contract", variant: "destructive" },
  expiring_contract: { label: "Expiring", variant: "secondary", className: "bg-amber-600 hover:bg-amber-600 text-white" },
  tier_threshold: { label: "Tier Threshold", variant: "default" },
  rebate_due: { label: "Rebate Due", variant: "secondary" },
  payment_due: { label: "Payment Due", variant: "secondary" },
  pricing_error: { label: "Pricing Error", variant: "destructive" },
  compliance: { label: "Compliance", variant: "outline" },
}

export const poStatusConfig: Record<string, StatusConfig> = {
  draft: { label: "Draft", variant: "outline" },
  pending: { label: "Pending", variant: "secondary" },
  approved: { label: "Approved", variant: "default", className: "bg-emerald-600 hover:bg-emerald-600" },
  sent: { label: "Sent", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

export const alertSeverityConfig: Record<string, StatusConfig> = {
  high: { label: "High", variant: "destructive" },
  medium: { label: "Medium", variant: "secondary", className: "bg-amber-600 hover:bg-amber-600 text-white" },
  low: { label: "Low", variant: "outline" },
}

// ─── Role Configs ─────────────────────────────────────────────────

export const roleConfig = {
  facility: { label: "Facility", defaultRedirect: "/dashboard" },
  vendor: { label: "Vendor", defaultRedirect: "/vendor/dashboard" },
  admin: { label: "Admin", defaultRedirect: "/admin/dashboard" },
} as const
