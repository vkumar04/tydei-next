"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { motion } from "motion/react"
import * as Icons from "lucide-react"
import type { NavItem, BadgeCounts } from "@/lib/types"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { staggerContainer, fadeInUp } from "@/lib/animations"

interface SidebarNavProps {
  items: NavItem[]
  badgeCounts?: BadgeCounts
}

export function SidebarNav({ items, badgeCounts }: SidebarNavProps) {
  const pathname = usePathname()

  return (
    <SidebarMenu className="px-2">
      <motion.div variants={staggerContainer} initial="hidden" animate="show">
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
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                  <Link href={item.href}>
                    {IconComponent && <IconComponent className="size-4" />}
                    <span className="flex-1">{item.label}</span>
                    {badgeCount != null && badgeCount > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-auto h-5 min-w-5 px-1 text-xs"
                      >
                        {badgeCount}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </motion.div>
          )
        })}
      </motion.div>
    </SidebarMenu>
  )
}
