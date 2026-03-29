"use client"

import { Building2, Truck, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface DemoLoginButtonsProps {
  onDemoLogin: (role: "facility" | "vendor" | "admin") => void
  isLoading: boolean
}

const roles = [
  { role: "facility" as const, label: "Facility Demo", icon: Building2 },
  { role: "vendor" as const, label: "Vendor Demo", icon: Truck },
  { role: "admin" as const, label: "Admin Demo", icon: ShieldCheck },
]

export function DemoLoginButtons({ onDemoLogin, isLoading }: DemoLoginButtonsProps) {
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
            disabled={isLoading}
            onClick={() => onDemoLogin(role)}
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
