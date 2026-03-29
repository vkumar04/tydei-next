"use client"

import { motion } from "motion/react"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { scaleIn } from "@/lib/animations"

interface AuthCardProps {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <motion.div variants={scaleIn} initial="hidden" animate="show">
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent">
          <span className="text-lg font-bold text-primary-foreground">T</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">TYDEi</h1>
          <p className="text-sm text-muted-foreground">Platform</p>
        </div>
      </div>

      <Card className="w-full border-0 shadow-lg">
        <CardHeader className="text-center">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer && <CardFooter className="justify-center">{footer}</CardFooter>}
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        By signing in, you agree to our Terms of Service and Privacy Policy
      </p>
    </motion.div>
  )
}
