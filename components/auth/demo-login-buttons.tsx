"use client"

import { Building2, Truck } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
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
]

export function DemoLoginButtons({ onFill, isLoading }: DemoLoginButtonsProps) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or</span>
        </div>
      </div>
      <motion.div
        className="grid grid-cols-2 gap-2"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {roles.map(({ role, label, icon: Icon }) => (
          <motion.div key={role} variants={fadeInUp}>
            <Button
              variant="outline"
              type="button"
              disabled={isLoading}
              onClick={() => {
                const creds = DEMO_ACCOUNTS[role]
                onFill(creds.email, creds.password)
              }}
              className="w-full"
            >
              <Icon className="mr-2 size-4" />
              {label}
            </Button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
