"use client"

import type { LucideIcon } from "lucide-react"
import { motion } from "motion/react"
import { ArrowUpRight, ArrowDownRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { fadeInUp } from "@/lib/animations"

interface MetricCardProps {
  title: string
  value: string | number
  description?: string
  icon: LucideIcon
  change?: string
  changeType?: "positive" | "negative"
  secondaryValue?: string
  secondaryLabel?: string
}

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  change,
  changeType = "positive",
  secondaryValue,
  secondaryLabel,
}: MetricCardProps) {
  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            {change && (
              <div
                className={`flex items-center gap-1 text-sm font-medium ${
                  changeType === "positive" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                }`}
              >
                {changeType === "positive" ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
                {change}
              </div>
            )}
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{title}</p>
            {secondaryValue && (
              <div className="mt-2 flex items-center gap-2 rounded bg-muted/50 px-2 py-1">
                <span className="text-sm font-semibold text-primary">
                  {secondaryValue}
                </span>
                <span className="text-xs text-muted-foreground">
                  {secondaryLabel}
                </span>
              </div>
            )}
          </div>
          {description && (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
