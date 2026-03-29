"use client"

import { Building2, Truck, ShieldCheck } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const DEMO_ACCOUNTS = {
  facility: { email: "demo-facility@tydei.com", password: "demo-facility-2024" },
  vendor: { email: "demo-vendor@tydei.com", password: "demo-vendor-2024" },
  admin: { email: "demo-admin@tydei.com", password: "demo-admin-2024" },
} as const

interface DemoLoginButtonsProps {
  onFill: (email: string, password: string) => void
  isLoading: boolean
}

const roles = [
  { role: "facility" as const, label: "Facility Demo", icon: Building2 },
  { role: "vendor" as const, label: "Vendor Demo", icon: Truck },
  { role: "admin" as const, label: "Admin Demo", icon: ShieldCheck },
]

export function DemoLoginButtons({ onFill, isLoading }: DemoLoginButtonsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or try a demo</span>
        <Separator className="flex-1" />
      </div>
      <motion.div
        className="grid grid-cols-3 gap-2"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {roles.map(({ role, label, icon: Icon }) => (
          <motion.div key={role} variants={fadeInUp}>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={isLoading}
              onClick={() => {
                const creds = DEMO_ACCOUNTS[role]
                onFill(creds.email, creds.password)
              }}
              className="w-full text-xs"
            >
              <Icon className="mr-1 size-3" />
              {label}
            </Button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
