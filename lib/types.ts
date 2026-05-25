import type { LucideIcon } from "lucide-react"
import type { UserRole } from "@/lib/generated/prisma/client"

export type PortalRole = "facility" | "vendor" | "admin"

export interface NavItem {
  label: string
  href: string
  icon: string
  badgeKey?: string
}

export interface BadgeCounts {
  alertCount?: number
}

export interface StatusConfig {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
  className?: string
}

export type { UserRole, LucideIcon }
