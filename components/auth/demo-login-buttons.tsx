"use client"

import { Building2, Truck, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

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
      <div className="grid grid-cols-3 gap-2">
        {roles.map(({ role, label, icon: Icon }) => (
          <Button
            key={role}
            variant="outline"
            size="sm"
            type="button"
            disabled={isLoading}
            onClick={() => {
              const creds = DEMO_ACCOUNTS[role]
              onFill(creds.email, creds.password)
            }}
            className="text-xs"
          >
            <Icon className="mr-1 size-3" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
