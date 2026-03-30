"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { motion } from "motion/react"
import * as Icons from "lucide-react"
import { cn } from "@/lib/utils"
import type { NavItem, BadgeCounts } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { staggerContainer, fadeInUp } from "@/lib/animations"

interface SidebarNavProps {
  items: NavItem[]
  badgeCounts?: BadgeCounts
}

export function SidebarNav({ items, badgeCounts }: SidebarNavProps) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-1">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-1"
      >
        {items.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/vendor/dashboard" &&
              item.href !== "/admin/dashboard" &&
              pathname.startsWith(item.href))

          const IconComponent = Icons[
            item.icon as keyof typeof Icons
          ] as Icons.LucideIcon | undefined

          const badgeCount = item.badgeKey
            ? badgeCounts?.[item.badgeKey as keyof BadgeCounts]
            : undefined

          return (
            <motion.div key={item.href} variants={fadeInUp}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                {IconComponent && <IconComponent className="h-4 w-4" />}
                <span className="flex-1">{item.label}</span>
                {badgeCount != null && badgeCount > 0 && (
                  <Badge className="ml-auto h-5 min-w-5 justify-center bg-destructive text-destructive-foreground text-xs">
                    {badgeCount}
                  </Badge>
                )}
              </Link>
            </motion.div>
          )
        })}
      </motion.div>
    </nav>
  )
}
