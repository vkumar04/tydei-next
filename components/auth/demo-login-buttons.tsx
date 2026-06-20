"use client"

import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { staggerContainer, fadeInUp } from "@/lib/animations"
import type { DemoAccount } from "@/lib/auth/demo-accounts"

interface DemoLoginButtonsProps {
  /** Accounts to render, grouped by side. Supplied by the server (login page)
   *  only when SHOW_DEMO_LOGINS is on — no credentials are hardcoded here. */
  accounts: DemoAccount[]
  onFill: (email: string, password: string) => void
  isLoading: boolean
}

const GROUP_ORDER: DemoAccount["group"][] = ["Facility", "Vendor", "Admin"]

export function DemoLoginButtons({ accounts, onFill, isLoading }: DemoLoginButtonsProps) {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: accounts.filter((a) => a.group === group),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Demo logins</span>
        </div>
      </div>

      <motion.div
        className="space-y-2"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {groups.map(({ group, items }) => (
          <motion.div key={group} variants={fadeInUp} className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {group}
            </p>
            <div
              className={cn(
                "grid gap-2",
                items.length === 1 ? "grid-cols-1" : "grid-cols-3",
              )}
            >
              {items.map((acc) => (
                <Button
                  key={acc.email}
                  variant="outline"
                  type="button"
                  size="sm"
                  disabled={isLoading}
                  onClick={() => onFill(acc.email, acc.password)}
                  className="w-full min-w-0 truncate px-2 text-xs"
                  title={acc.email}
                >
                  {acc.label}
                </Button>
              ))}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
