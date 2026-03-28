import type { ReactNode } from "react"
import { Label } from "@/components/ui/label"

interface FieldProps {
  label: string
  error?: string
  required?: boolean
  children: ReactNode
}

export function Field({ label, error, required, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
