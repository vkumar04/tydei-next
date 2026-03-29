"use client"

import type { ReactNode } from "react"
import { motion } from "motion/react"
import { fadeIn } from "@/lib/animations"

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <motion.div
      className="flex items-start justify-between"
      variants={fadeIn}
      initial="hidden"
      animate="show"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </motion.div>
  )
}
