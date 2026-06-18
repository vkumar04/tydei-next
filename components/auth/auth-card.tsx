"use client"

import { motion } from "motion/react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { scaleIn } from "@/lib/animations"

interface AuthCardProps {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  showTermsFooter?: boolean
}

export function AuthCard({ title, description, children, footer, showTermsFooter = true }: AuthCardProps) {
  return (
    <motion.div className="flex flex-col gap-6" variants={scaleIn} initial="hidden" animate="show">
      {/* Logo — canonical brand mark, matches marketing header + portals
          (Vick 2026-06-18: auth card had drifted to a FileText icon). */}
      <div className="flex items-center justify-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg">
          <span className="text-xl font-bold text-primary-foreground">T</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">TYDEi</h1>
          <p className="text-sm text-muted-foreground">Healthcare Platform</p>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>

      {showTermsFooter && (
        <p className="text-center text-xs text-muted-foreground">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      )}

      {footer}
    </motion.div>
  )
}
